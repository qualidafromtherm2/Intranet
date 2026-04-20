#!/usr/bin/env node
/**
 * sync_pedidos_sem_itens.js
 * Estratégia em duas fases para evitar rate limit 425:
 *
 * FASE 1 — ListarPedidos paginado (50/página): monta um Set com todos os
 *           nCodPed válidos que existem na Omie. Essa chamada é menos restrita.
 *
 * FASE 2 — ConsultarPedido: só para os pedidos que existem na Omie E estão
 *           no banco sem itens. Evita as centenas de chamadas que retornam 403
 *           (que também consomem quota).
 */

'use strict';

const { Pool } = require('pg');

require('dotenv').config();

const DATABASE_URL    = process.env.DATABASE_URL;
const OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

if (!DATABASE_URL || !OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('Erro: variáveis DATABASE_URL, OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórias (.env)');
  process.exit(1);
}
const DELAY_MS        = 3000; // 1 req/3s — conservador para evitar bloqueio 425

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
}

async function omiePost(call, param) {
  const res = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] }),
    signal: AbortSignal.timeout(30000)
  });
  await sleep(DELAY_MS);

  if (res.status === 425) {
    const txt = await res.text().catch(() => '{}');
    let waitSec = 1810;
    try {
      const body = JSON.parse(txt);
      const match = String(body.faultstring || '').match(/(\d+)\s*segundo/);
      if (match) waitSec = Math.min(Number(match[1]) + 5, 1810);
    } catch (_) {}
    const err = new Error(`HTTP 425 — bloqueado ${waitSec}s`);
    err.retryAfter = waitSec;
    throw err;
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json();
}

/**
 * FASE 1: Busca todas as páginas de ListarPedidos e retorna um Set com os
 * nCodPed de pedidos que existem na Omie.
 */
async function buscarIdsValidosOmie(codigosParaChecar) {
  const validos = new Set();
  const alvo = new Set(codigosParaChecar.map(String));

  let pagina = 1;
  const porPagina = 50;

  log(`FASE 1: Listando pedidos na Omie para identificar IDs válidos...`);

  while (true) {
    let json;
    try {
      json = await omiePost('ListarPedidos', {
        pagina,
        registros_por_pagina: porPagina,
        apenas_importado_api: 'N'
      });
    } catch (e) {
      if (e.retryAfter) {
        log(`  BLOQUEADO na listagem. Aguardando ${e.retryAfter}s...`);
        await sleep(e.retryAfter * 1000);
        continue; // retenta mesma página
      }
      throw e;
    }

    const pedidos = json?.pedido_venda_produto || [];
    for (const p of pedidos) {
      const cab = p?.cabecalho || p;
      const id = String(cab?.nCodPed || cab?.codigo_pedido || '');
      if (id && alvo.has(id)) validos.add(id);
    }

    const totalPages = json?.total_de_paginas ?? 1;
    log(`  Página ${pagina}/${totalPages} — encontrados ${validos.size} válidos até agora`);

    if (pagina >= totalPages) break;
    pagina++;
  }

  log(`FASE 1 concluída: ${validos.size} de ${alvo.size} IDs encontrados na Omie`);
  return validos;
}

async function consultarPedido(codigoPedido) {
  let json;
  while (true) {
    try {
      json = await omiePost('ConsultarPedido', { codigo_pedido: Number(codigoPedido) });
      break;
    } catch (e) {
      if (e.retryAfter) {
        log(`  BLOQUEADO em ConsultarPedido. Aguardando ${e.retryAfter}s...`);
        await sleep(e.retryAfter * 1000);
        continue;
      }
      throw e;
    }
  }
  return json;
}

async function main() {
  log('Buscando pedidos sem itens no banco...');

  // Pedidos no banco sem itens, excluindo cancelados (etapa 70) e teste (12345)
  const { rows: pendentes } = await pool.query(`
    SELECT p.codigo_pedido, p.numero_pedido
    FROM public.pedidos_venda p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pedidos_venda_itens i
      WHERE i.codigo_pedido = p.codigo_pedido
    )
    AND (p.etapa IS NULL OR p.etapa NOT IN ('70', 'CANCELADO'))
    AND p.codigo_pedido != '12345'
    ORDER BY p.codigo_pedido
  `);

  log(`Total de pedidos sem itens no banco: ${pendentes.length}`);
  if (pendentes.length === 0) {
    log('Nenhum pedido pendente. Tabela já está sincronizada!');
    await pool.end();
    return;
  }

  // FASE 1: Descobrir quais desses IDs realmente existem na Omie
  const idsValidos = await buscarIdsValidosOmie(pendentes.map(p => p.codigo_pedido));

  const paraConsultar = pendentes.filter(p => idsValidos.has(String(p.codigo_pedido)));
  log(`\nFASE 2: ${paraConsultar.length} pedidos válidos para sincronizar via ConsultarPedido`);

  if (paraConsultar.length === 0) {
    log('Nenhum pedido válido encontrado na Omie. Nada a sincronizar.');
    await pool.end();
    return;
  }

  let ok = 0, erros = 0, sem_itens_omie = 0;

  for (let i = 0; i < paraConsultar.length; i++) {
    const { codigo_pedido, numero_pedido } = paraConsultar[i];
    const progresso = `[${i + 1}/${paraConsultar.length}]`;

    try {
      const j = await consultarPedido(codigo_pedido);

      const ped = Array.isArray(j?.pedido_venda_produto)
        ? j.pedido_venda_produto
        : (j?.pedido_venda_produto ? [j.pedido_venda_produto] : []);

      if (!ped.length) {
        log(`${progresso} #${numero_pedido} (${codigo_pedido}) — sem dados na Omie, pulando`);
        sem_itens_omie++;
        continue;
      }

      await pool.query(
        'SELECT public.pedidos_upsert_from_list($1::jsonb)',
        [{ pedido_venda_produto: ped }]
      );

      log(`${progresso} #${numero_pedido} (${codigo_pedido}) — OK`);
      ok++;
    } catch (e) {
      log(`${progresso} #${numero_pedido} (${codigo_pedido}) — ERRO: ${e.message}`);
      erros++;
    }
  }

  log('─'.repeat(50));
  log(`Concluído: ${ok} sincronizados | ${sem_itens_omie} sem dados | ${erros} erros`);

  // Verificação final
  const { rows: [final] } = await pool.query(`
    SELECT COUNT(*) AS sem_itens
    FROM public.pedidos_venda p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pedidos_venda_itens i WHERE i.codigo_pedido = p.codigo_pedido
    )
  `);
  log(`Pedidos ainda sem itens após sync: ${final.sem_itens}`);

  await pool.end();
}

main().catch(e => {
  console.error('Erro fatal:', e.message);
  process.exit(1);
});
