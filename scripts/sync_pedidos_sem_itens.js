#!/usr/bin/env node
/**
 * sync_pedidos_sem_itens.js
 * Busca pedidos que estão em pedidos_venda mas SEM itens em pedidos_venda_itens,
 * consulta cada um na API Omie (ConsultarPedido) e faz upsert completo (cabeçalho + itens).
 * Rate limit: ~2.8 req/s (350ms entre chamadas)
 */

'use strict';

const { Pool } = require('pg');

const DATABASE_URL    = process.env.DATABASE_URL    || 'postgresql://intranet_db_yd0w_user:amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho@dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com:5432/intranet_db_yd0w?sslmode=require';
const OMIE_APP_KEY    = process.env.OMIE_APP_KEY    || '4244634488206';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '10d9dde2e4e3bac7e62a2cc01bfba01e';
const DELAY_MS        = 2000; // 1 req/2s — conservador para evitar bloqueio 425

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
}

async function consultarPedido(codigoPedido) {
  const res = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarPedido',
      app_key:    OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ codigo_pedido: Number(codigoPedido) }]
    }),
    signal: AbortSignal.timeout(20000)
  });
  await sleep(DELAY_MS);

  // 403 = pedido não existe na Omie (teste/inválido) — não tenta novamente
  if (res.status === 403) {
    const txt = await res.text().catch(() => '');
    const err = new Error(`HTTP 403 (pedido inexistente na Omie): ${txt.substring(0, 150)}`);
    err.skip = true;
    throw err;
  }

  // 425 = bloqueio temporário por consumo excessivo — espera e tenta de novo
  if (res.status === 425) {
    const txt = await res.text().catch(() => '{}');
    let waitSec = 60;
    try {
      const body = JSON.parse(txt);
      const match = String(body.faultstring || '').match(/(\d+)\s*segundo/);
      if (match) waitSec = Math.min(Number(match[1]) + 5, 1810);
    } catch (_) {}
    const err = new Error(`HTTP 425 — bloqueado, aguardar ${waitSec}s`);
    err.retryAfter = waitSec;
    throw err;
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${txt.substring(0, 200)}`);
  }
  return res.json();
}

async function main() {
  log('Buscando pedidos sem itens...');

  // Filtra apenas pedidos NÃO cancelados/encerrados (etapa 70 = cancelado na Omie)
  // Pedidos cancelados retornam 403 e nunca terão itens
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

  log(`Total de pedidos sem itens: ${pendentes.length}`);
  if (pendentes.length === 0) {
    log('Nenhum pedido pendente. Tabela já está sincronizada!');
    await pool.end();
    return;
  }

  let ok = 0, erros = 0, sem_itens_omie = 0, ignorados = 0;

  for (let i = 0; i < pendentes.length; i++) {
    const { codigo_pedido, numero_pedido } = pendentes[i];
    const progresso = `[${i + 1}/${pendentes.length}]`;

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
      if (e.skip) {
        // 403: pedido não existe na Omie, ignora silenciosamente
        log(`${progresso} #${numero_pedido} (${codigo_pedido}) — ignorado (inexistente na Omie)`);
        ignorados++;
        continue;
      }
      if (e.retryAfter) {
        // 425: bloqueio temporário — aguarda e retenta este mesmo pedido
        log(`${progresso} #${numero_pedido} (${codigo_pedido}) — BLOQUEADO. Aguardando ${e.retryAfter}s...`);
        await sleep(e.retryAfter * 1000);
        i--; // retenta o mesmo índice
        continue;
      }
      log(`${progresso} #${numero_pedido} (${codigo_pedido}) — ERRO: ${e.message}`);
      erros++;
    }
  }

  log('─'.repeat(50));
  log(`Concluído: ${ok} sincronizados | ${ignorados} inexistentes na Omie | ${sem_itens_omie} sem dados | ${erros} erros`);

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
