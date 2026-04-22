'use strict';

/**
 * Carga inicial das tabelas de notas fiscais de vendas.
 *
 * Objetivos:
 * 1) Remover registros de teste em "Vendas".notas_fiscais_omie(_eventos)
 * 2) Popular "Vendas".notas_fiscais_omie com base em logistica.recebimentos_nfe_omie
 * 3) Registrar evento técnico de sincronização inicial em "Vendas".notas_fiscais_omie_eventos
 *
 * Modo opcional de replay por endpoint (3 req/s):
 *   node scripts/popular_notas_fiscais_vendas.js --replay-endpoint
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const REPLAY_RATE_MS = 350; // ~3 req/s
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function garantirTabelas(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS "Vendas";

    CREATE TABLE IF NOT EXISTS "Vendas".notas_fiscais_omie (
      id BIGSERIAL PRIMARY KEY,
      identidade TEXT NOT NULL UNIQUE,
      tipo_documento VARCHAR(10) NOT NULL,
      topic_ultimo VARCHAR(100) NOT NULL,
      status_ultimo VARCHAR(40) NOT NULL,
      numero_nota VARCHAR(40),
      chave_nfe VARCHAR(60),
      numero_pedido VARCHAR(40),
      valor_total NUMERIC(18,2),
      cnpj_emitente VARCHAR(20),
      razao_emitente VARCHAR(200),
      data_emissao VARCHAR(40),
      message_id_ultimo VARCHAR(120),
      author_ultimo VARCHAR(120),
      payload_ultimo JSONB,
      ativa BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "Vendas".notas_fiscais_omie_eventos (
      id BIGSERIAL PRIMARY KEY,
      identidade TEXT,
      tipo_documento VARCHAR(10),
      topic VARCHAR(100) NOT NULL,
      status VARCHAR(40),
      numero_nota VARCHAR(40),
      chave_nfe VARCHAR(60),
      numero_pedido VARCHAR(40),
      message_id VARCHAR(120),
      author VARCHAR(120),
      payload JSONB,
      recebido_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      processado_com_sucesso BOOLEAN,
      erro TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_fiscais_omie_eventos_message_topic
      ON "Vendas".notas_fiscais_omie_eventos(message_id, topic)
      WHERE message_id IS NOT NULL;
  `);
}

async function limparDadosTeste(client) {
  const delEventos = await client.query(`
    DELETE FROM "Vendas".notas_fiscais_omie_eventos
    WHERE COALESCE(message_id, '') ILIKE 'teste-%'
       OR COALESCE(numero_pedido, '') ILIKE 'PV-TESTE-%'
       OR COALESCE(author, '') ILIKE '%teste%'
  `);

  const delNotas = await client.query(`
    DELETE FROM "Vendas".notas_fiscais_omie
    WHERE COALESCE(message_id_ultimo, '') ILIKE 'teste-%'
       OR COALESCE(numero_pedido, '') ILIKE 'PV-TESTE-%'
       OR COALESCE(razao_emitente, '') ILIKE '%Fornecedor Teste%'
  `);

  return {
    eventosRemovidos: delEventos.rowCount || 0,
    notasRemovidas: delNotas.rowCount || 0,
  };
}

function statusFromRecebimento(row) {
  const cancelada = String(row.c_cancelada || '').trim().toUpperCase() === 'S';
  if (cancelada) return 'Cancelada';
  const recebida = String(row.c_recebido || '').trim().toUpperCase() === 'S';
  return recebida ? 'Autorizada' : 'Desconhecida';
}

function identidadeFromRow(row) {
  if (row.c_chave_nfe && String(row.c_chave_nfe).trim()) {
    return `chave:${String(row.c_chave_nfe).trim()}`;
  }
  if (row.c_numero_nfe && String(row.c_numero_nfe).trim()) {
    return `NFe:${String(row.c_numero_nfe).trim()}`;
  }
  return `n_id_receb:${row.n_id_receb}`;
}

function formatDateIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 40);
  return d.toISOString().slice(0, 10);
}

async function backfillDireto(client) {
  const { rows } = await client.query(`
    SELECT
      n_id_receb,
      c_numero_nfe,
      c_chave_nfe,
      c_nome_fornecedor,
      c_cnpj_cpf_fornecedor,
      n_valor_nfe,
      c_cancelada,
      c_recebido,
      d_emissao_nfe,
      updated_at
    FROM logistica.recebimentos_nfe_omie
    WHERE n_id_receb IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
  `);

  let upserts = 0;
  let eventos = 0;

  for (const row of rows) {
    const status = statusFromRecebimento(row);
    const identidade = identidadeFromRow(row);
    const topic = 'NFe.SincronizacaoInicial';
    const messageId = `backfill-${row.n_id_receb}`;

    await client.query(`
      INSERT INTO "Vendas".notas_fiscais_omie (
        identidade, tipo_documento, topic_ultimo, status_ultimo,
        numero_nota, chave_nfe, numero_pedido, valor_total,
        cnpj_emitente, razao_emitente, data_emissao,
        message_id_ultimo, author_ultimo, payload_ultimo,
        ativa, updated_at
      ) VALUES (
        $1,'NFe',$2,$3,
        $4,$5,NULL,$6,
        $7,$8,$9,
        $10,'script-backfill',$11,
        $12,NOW()
      )
      ON CONFLICT (identidade)
      DO UPDATE SET
        topic_ultimo = EXCLUDED.topic_ultimo,
        status_ultimo = EXCLUDED.status_ultimo,
        numero_nota = COALESCE(EXCLUDED.numero_nota, "Vendas".notas_fiscais_omie.numero_nota),
        chave_nfe = COALESCE(EXCLUDED.chave_nfe, "Vendas".notas_fiscais_omie.chave_nfe),
        valor_total = COALESCE(EXCLUDED.valor_total, "Vendas".notas_fiscais_omie.valor_total),
        cnpj_emitente = COALESCE(EXCLUDED.cnpj_emitente, "Vendas".notas_fiscais_omie.cnpj_emitente),
        razao_emitente = COALESCE(EXCLUDED.razao_emitente, "Vendas".notas_fiscais_omie.razao_emitente),
        data_emissao = COALESCE(EXCLUDED.data_emissao, "Vendas".notas_fiscais_omie.data_emissao),
        message_id_ultimo = EXCLUDED.message_id_ultimo,
        author_ultimo = EXCLUDED.author_ultimo,
        payload_ultimo = EXCLUDED.payload_ultimo,
        ativa = EXCLUDED.ativa,
        updated_at = NOW()
    `, [
      identidade,
      topic,
      status,
      row.c_numero_nfe || null,
      row.c_chave_nfe || null,
      row.n_valor_nfe || null,
      row.c_cnpj_cpf_fornecedor || null,
      row.c_nome_fornecedor || null,
      formatDateIso(row.d_emissao_nfe),
      messageId,
      {
        origem: 'logistica.recebimentos_nfe_omie',
        n_id_receb: row.n_id_receb,
        updated_at: row.updated_at,
      },
      status !== 'Cancelada',
    ]);
    upserts++;

    await client.query(`
      INSERT INTO "Vendas".notas_fiscais_omie_eventos (
        identidade, tipo_documento, topic, status,
        numero_nota, chave_nfe, numero_pedido,
        message_id, author, payload,
        recebido_em, processado_com_sucesso, erro
      ) VALUES (
        $1,'NFe',$2,$3,
        $4,$5,NULL,
        $6,'script-backfill',$7,
        NOW(),TRUE,NULL
      )
      ON CONFLICT DO NOTHING
    `, [
      identidade,
      topic,
      status,
      row.c_numero_nfe || null,
      row.c_chave_nfe || null,
      messageId,
      {
        origem: 'backfill',
        n_id_receb: row.n_id_receb,
      },
    ]);
    eventos++;
  }

  return { processados: rows.length, upserts, eventos };
}

async function replayPorEndpoint(client) {
  const token = process.env.OMIE_WEBHOOK_TOKEN;
  if (!token) throw new Error('OMIE_WEBHOOK_TOKEN não configurado para replay por endpoint');

  const endpoint = `https://intranet-30av.onrender.com/webhooks/omie/notas-vendas?token=${encodeURIComponent(token)}`;
  const { rows } = await client.query(`
    SELECT n_id_receb, c_numero_nfe, c_chave_nfe, c_nome_fornecedor, c_cnpj_cpf_fornecedor, n_valor_nfe, d_emissao_nfe, c_cancelada
    FROM logistica.recebimentos_nfe_omie
    WHERE n_id_receb IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 300
  `);

  let enviados = 0;
  let falhas = 0;

  for (const row of rows) {
    const topic = String(row.c_cancelada || '').trim().toUpperCase() === 'S'
      ? 'NFe.NotaCancelada'
      : 'NFe.NotaAutorizada';

    const payload = {
      topic,
      messageId: `replay-${row.n_id_receb}`,
      event: {
        numero_nota: row.c_numero_nfe,
        cChaveNFe: row.c_chave_nfe,
        cRazaoSocial: row.c_nome_fornecedor,
        cCNPJ: row.c_cnpj_cpf_fornecedor,
        nValorTotal: row.n_valor_nfe,
        data_emissao: row.d_emissao_nfe,
      },
    };

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) falhas++;
      else enviados++;
    } catch (_) {
      falhas++;
    }

    // Respeita limite de envio de requisição (máx. 3/s)
    await sleep(REPLAY_RATE_MS);
  }

  return { enviados, falhas, limiteReqPorSegundo: 3 };
}

async function main() {
  const replayEndpoint = process.argv.includes('--replay-endpoint');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await garantirTabelas(client);

    const limpeza = await limparDadosTeste(client);
    const backfill = await backfillDireto(client);

    await client.query('COMMIT');

    console.log('Limpeza de testes:', limpeza);
    console.log('Backfill direto:', backfill);

    if (replayEndpoint) {
      const replay = await replayPorEndpoint(client);
      console.log('Replay por endpoint:', replay);
    }

    const resumo = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM "Vendas".notas_fiscais_omie) AS total_notas,
        (SELECT COUNT(*) FROM "Vendas".notas_fiscais_omie_eventos) AS total_eventos
    `);
    console.log('Resumo final:', resumo.rows[0]);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Erro no script:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
