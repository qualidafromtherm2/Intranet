'use strict';
/**
 * Sincroniza notas fiscais via Omie (endpoint nfconsultar/ListarNF)
 * para a tabela "Vendas".notas_fiscais_omie.
 *
 * Uso:
 *   node scripts/sync_notas_fiscais_vendas_omie.js
 *   node scripts/sync_notas_fiscais_vendas_omie.js --limpar-testes
 *   node scripts/sync_notas_fiscais_vendas_omie.js --apenas-pendentes
 *
 * Observação:
 * - Este script preenche apenas "Vendas".notas_fiscais_omie.
 * - A tabela de eventos não é utilizada neste fluxo.
 *
 * Variáveis de ambiente necessárias (via .env ou ambiente):
 *   DATABASE_URL, OMIE_APP_KEY, OMIE_APP_SECRET
 */

require('dotenv').config();
const { Pool } = require('pg');

// ─── Config ───────────────────────────────────────────────────────────────────
const DATABASE_URL     = process.env.DATABASE_URL;
const OMIE_APP_KEY     = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET  = process.env.OMIE_APP_SECRET;
const OMIE_NF_URL      = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';

// ~3 req/s (350ms entre chamadas)
const DELAY_MS              = 350;
const REGISTROS_POR_PAGINA  = 100;

if (!DATABASE_URL || !OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('Erro: DATABASE_URL, OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórios.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Omie API ─────────────────────────────────────────────────────────────────
async function omiePost(call, param) {
  const res = await fetch(OMIE_NF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call,
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [param],
    }),
  });
  await sleep(DELAY_MS);

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}

  if (!res.ok) {
    const msg = json?.faultstring || text;
    throw new Error(`Omie [${call}] HTTP ${res.status}: ${msg}`);
  }
  return json || {};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function convertOmieDate(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function parseIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeAmbiente(tpAmb) {
  const s = String(tpAmb || '').trim();
  if (!s) return null;
  if (s === '1') return 'P';
  if (s === '2') return 'H';
  return s;
}

function inferStatusNota(nf = {}) {
  const ide = nf.ide || {};
  const dCan = String(ide.dCan || '').trim();
  const cDeneg = String(ide.cDeneg || '').trim().toUpperCase();
  if (dCan) return 'Cancelada';
  if (cDeneg === 'S') return 'Denegada';
  return 'Autorizada';
}

function extractNota(nf = {}) {
  const compl = nf.compl || {};
  const ide = nf.ide || {};
  const total = nf.total || {};
  const icmsTot = total.ICMSTot || {};
  const dest = nf.nfDestInt || {};

  const chaveNfe = String(compl.cChaveNFe || '').trim() || null;
  const numeroNota = String(ide.nNF || '').trim() || null;
  const numeroPedido = String(compl.nIdPedido || '').trim() || null;
  const valorTotal = Number(icmsTot.vNF || icmsTot.vProd || 0) || null;
  const cnpj = onlyDigits(dest.cnpj_cpf) || null;
  const razao = String(dest.cRazao || '').trim() || null;
  const dataEmissao = convertOmieDate(ide.dEmi || ide.dReg || null);
  const idNfOmie = parseIntOrNull(compl.nIdNF || compl.nIdNf || null);
  const idPedidoOmie = parseIntOrNull(compl.nIdPedido || null);
  const serie = String(ide.serie || '').trim() || null;
  const ambiente = normalizeAmbiente(ide.tpAmb);
  const horaEmissao = String(ide.hEmi || '').trim() || null;

  const status = inferStatusNota(nf);
  const topic = status === 'Cancelada' ? 'NFe.NotaCancelada' : 'NFe.NotaAutorizada';
  const acao = status === 'Cancelada' ? 'cancelada' : 'autorizada';

  const identidade = chaveNfe
    ? `chave:${chaveNfe}`
    : (numeroNota ? `NFe:${numeroNota}` : null);

  return {
    identidade,
    topic,
    status,
    numeroNota,
    chaveNfe,
    numeroPedido,
    valorTotal,
    cnpj,
    razao,
    dataEmissao,
    acao,
    idNfOmie,
    serie,
    ambiente,
    horaEmissao,
    idPedidoOmie,
    empresaCnpj: cnpj,
    payload: nf,
  };
}

// ─── Upsert ───────────────────────────────────────────────────────────────────
async function upsertNFe(client, dados) {
  if (!dados.identidade) return false;

  const ativa = dados.status !== 'Cancelada';
  const messageId = `sync-omie-nfe-${dados.numeroNota || dados.chaveNfe || Date.now()}`;

  await client.query(`
    INSERT INTO "Vendas".notas_fiscais_omie (
      identidade, tipo_documento, topic_ultimo, status_ultimo,
      numero_nota, chave_nfe, numero_pedido,
      acao_ultimo, id_nf_omie, serie, ambiente,
      hora_emissao, id_pedido_omie, empresa_cnpj,
      valor_total,
      cnpj_emitente, razao_emitente, data_emissao,
      message_id_ultimo, author_ultimo, payload_ultimo,
      ativa, updated_at
    ) VALUES (
      $1,'NFe',$2,$3,
      $4,$5,$6,
      $7,$8,$9,$10,
      $11,$12,$13,
      $14,
      $15,$16,$17,
      $18,'script-sync-omie',$19,
      $20,NOW()
    )
    ON CONFLICT (identidade)
    DO UPDATE SET
      topic_ultimo    = EXCLUDED.topic_ultimo,
      status_ultimo   = EXCLUDED.status_ultimo,
      numero_nota     = COALESCE(EXCLUDED.numero_nota,   "Vendas".notas_fiscais_omie.numero_nota),
      chave_nfe       = COALESCE(EXCLUDED.chave_nfe,     "Vendas".notas_fiscais_omie.chave_nfe),
      numero_pedido   = COALESCE(EXCLUDED.numero_pedido, "Vendas".notas_fiscais_omie.numero_pedido),
      acao_ultimo     = COALESCE(EXCLUDED.acao_ultimo,   "Vendas".notas_fiscais_omie.acao_ultimo),
      id_nf_omie      = COALESCE(EXCLUDED.id_nf_omie,    "Vendas".notas_fiscais_omie.id_nf_omie),
      serie           = COALESCE(EXCLUDED.serie,         "Vendas".notas_fiscais_omie.serie),
      ambiente        = COALESCE(EXCLUDED.ambiente,      "Vendas".notas_fiscais_omie.ambiente),
      hora_emissao    = COALESCE(EXCLUDED.hora_emissao,  "Vendas".notas_fiscais_omie.hora_emissao),
      id_pedido_omie  = COALESCE(EXCLUDED.id_pedido_omie,"Vendas".notas_fiscais_omie.id_pedido_omie),
      empresa_cnpj    = COALESCE(EXCLUDED.empresa_cnpj,  "Vendas".notas_fiscais_omie.empresa_cnpj),
      valor_total     = COALESCE(EXCLUDED.valor_total,   "Vendas".notas_fiscais_omie.valor_total),
      cnpj_emitente   = COALESCE(EXCLUDED.cnpj_emitente, "Vendas".notas_fiscais_omie.cnpj_emitente),
      razao_emitente  = COALESCE(EXCLUDED.razao_emitente,"Vendas".notas_fiscais_omie.razao_emitente),
      data_emissao    = COALESCE(EXCLUDED.data_emissao,  "Vendas".notas_fiscais_omie.data_emissao),
      message_id_ultimo = EXCLUDED.message_id_ultimo,
      author_ultimo   = EXCLUDED.author_ultimo,
      payload_ultimo  = EXCLUDED.payload_ultimo,
      ativa           = EXCLUDED.ativa,
      updated_at      = NOW()
  `, [
    dados.identidade,
    dados.topic,
    dados.status,
    dados.numeroNota,
    dados.chaveNfe,
    dados.numeroPedido,
    dados.acao,
    dados.idNfOmie,
    dados.serie,
    dados.ambiente,
    dados.horaEmissao,
    dados.idPedidoOmie,
    dados.empresaCnpj,
    dados.valorTotal,
    dados.cnpj,
    dados.razao,
    dados.dataEmissao,
    messageId,
    dados.payload,
    ativa,
  ]);

  return true;
}

// ─── Limpar testes ────────────────────────────────────────────────────────────
async function limparTestes(client) {
  const r2 = await client.query(`
    DELETE FROM "Vendas".notas_fiscais_omie
    WHERE COALESCE(message_id_ultimo,'') ILIKE 'teste-%'
       OR COALESCE(razao_emitente,'') ILIKE '%Fornecedor Teste%'
  `);
  console.log(`Limpeza: ${r2.rowCount} notas de teste removidas.`);
}

async function ensureFlatColumns(client) {
  await client.query(`
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS acao_ultimo VARCHAR(40);
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS id_nf_omie BIGINT;
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS serie VARCHAR(10);
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS ambiente VARCHAR(10);
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS hora_emissao VARCHAR(20);
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS id_pedido_omie BIGINT;
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS empresa_cnpj VARCHAR(20);
  `);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const limparTestes_ = process.argv.includes('--limpar-testes');
  const apenasPendentes = process.argv.includes('--apenas-pendentes');
  const client = await pool.connect();

  try {
    await ensureFlatColumns(client);

    if (limparTestes_) {
      await client.query('BEGIN');
      await limparTestes(client);
      await client.query('COMMIT');
    }

    let identidadesPendentes = null;
    if (apenasPendentes) {
      const pend = await client.query(`
        SELECT identidade
        FROM "Vendas".notas_fiscais_omie
        WHERE identidade IS NOT NULL
          AND tipo_documento = 'NFe'
          AND (
            id_nf_omie IS NULL
            OR serie IS NULL
            OR ambiente IS NULL
            OR hora_emissao IS NULL
            OR id_pedido_omie IS NULL
          )
      `);
      identidadesPendentes = new Set(
        pend.rows
          .map((r) => String(r.identidade || '').trim())
          .filter(Boolean)
      );
      console.log(`Modo --apenas-pendentes: ${identidadesPendentes.size} identidades alvo.`);
    }

    let pagina = 1;
    let totalProcessados = 0;
    let totalUpserts = 0;
    let totalIgnorados = 0;
    let totalErros = 0;
    let continuar = true;

    console.log('Iniciando sync de NF-e via Omie nfconsultar/ListarNF...');

    while (continuar) {
      let resp;
      try {
        resp = await omiePost('ListarNF', {
          pagina,
          registros_por_pagina: REGISTROS_POR_PAGINA,
          ordenar_por: 'CODIGO',
        });
      } catch (err) {
        console.error(`Erro ao chamar Omie (página ${pagina}):`, err.message);
        // Tentar continuar na próxima página
        pagina++;
        totalErros++;
        if (totalErros > 10) {
          console.error('Muitos erros consecutivos, abortando.');
          break;
        }
        continue;
      }

      const registros = Array.isArray(resp.nfCadastro) ? resp.nfCadastro : [];
      const totalPaginas = Number(resp.total_de_paginas || 1);
      const totalRegistros = Number(resp.total_de_registros || 0);

      if (pagina === 1) {
        console.log(`Total de NF-e no Omie: ${totalRegistros} em ${totalPaginas} páginas`);
      }

      if (!Array.isArray(registros) || registros.length === 0) {
        console.log(`Página ${pagina}: nenhum registro, finalizando.`);
        break;
      }

      // Batch insert - sem transação por página para evitar timeout
      for (const nf of registros) {
        const dados = extractNota(nf);
        if (!dados.identidade) {
          totalErros++;
          continue;
        }
        if (identidadesPendentes && !identidadesPendentes.has(dados.identidade)) {
          totalIgnorados++;
          continue;
        }
        try {
          await upsertNFe(client, dados);
          totalUpserts++;
        } catch (err) {
          console.error(`Erro ao upsert NF-e ${dados.numeroNota || dados.chaveNfe}:`, err.message);
          totalErros++;
        }
        totalProcessados++;
      }

      console.log(`Página ${pagina}/${totalPaginas}: ${registros.length} NF-e processadas (total: ${totalProcessados})`);

      if (pagina >= totalPaginas) {
        continuar = false;
      } else {
        pagina++;
      }
    }

    const resumo = await client.query(`
      SELECT COUNT(*)::int AS total_notas, COUNT(*) FILTER (WHERE ativa)::int AS ativas
      FROM "Vendas".notas_fiscais_omie
    `);
    console.log('\n=== Resumo final ===');
    console.log(`Processados: ${totalProcessados} | Upserts OK: ${totalUpserts} | Ignorados: ${totalIgnorados} | Erros: ${totalErros}`);
    console.log(`Tabela: ${resumo.rows[0].total_notas} notas (${resumo.rows[0].ativas} ativas)`);
  } catch (err) {
    console.error('Erro fatal:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
