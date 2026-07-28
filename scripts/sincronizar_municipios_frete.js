#!/usr/bin/env node
require('dotenv').config();

const { Pool } = require('pg');
const { normalizarTexto } = require('../utils/freteEngine');

const aplicar = process.argv.includes('--apply');
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_INTERNAL_URL;
const URL_IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';

function obterUf(municipio) {
  return municipio?.microrregiao?.mesorregiao?.UF?.sigla
    || municipio?.['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla
    || null;
}

async function main() {
  const resposta = await fetch(URL_IBGE, { signal: AbortSignal.timeout(60_000) });
  if (!resposta.ok) throw new Error(`IBGE respondeu HTTP ${resposta.status}.`);
  const municipios = (await resposta.json()).map((item) => ({
    codigo_ibge: Number(item.id),
    uf: obterUf(item),
    nome: String(item.nome || '').trim(),
    nome_normalizado: normalizarTexto(item.nome)
  })).filter((item) => item.codigo_ibge && /^[A-Z]{2}$/.test(item.uf) && item.nome);

  console.log(`[frete/municipios] ${municipios.length} municípios recebidos do IBGE.`);
  const capitalSp = municipios.find((item) => item.codigo_ibge === 3550308);
  if (!capitalSp || capitalSp.nome !== 'São Paulo' || capitalSp.uf !== 'SP') {
    throw new Error('Validação da capital São Paulo falhou; carga cancelada.');
  }
  if (!aplicar) {
    console.log('[frete/municipios] Prévia concluída. Use --apply para gravar no SQL.');
    return;
  }
  if (!connectionString) throw new Error('DATABASE_URL não configurada.');

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS frete.municipio (
        codigo_ibge BIGINT PRIMARY KEY,
        uf CHAR(2) NOT NULL,
        nome TEXT NOT NULL,
        nome_normalizado TEXT NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS frete_municipio_uf_nome_idx
      ON frete.municipio (uf, nome_normalizado)
    `);
    await client.query(`
      INSERT INTO frete.municipio (codigo_ibge, uf, nome, nome_normalizado, atualizado_em)
      SELECT x.codigo_ibge, x.uf, x.nome, x.nome_normalizado, NOW()
      FROM jsonb_to_recordset($1::jsonb) AS x(codigo_ibge bigint, uf char(2), nome text, nome_normalizado text)
      ON CONFLICT (codigo_ibge) DO UPDATE SET
        uf = EXCLUDED.uf,
        nome = EXCLUDED.nome,
        nome_normalizado = EXCLUDED.nome_normalizado,
        atualizado_em = NOW()
    `, [JSON.stringify(municipios)]);
    await client.query('COMMIT');
    console.log(`[frete/municipios] ${municipios.length} municípios sincronizados no SQL.`);
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((erro) => {
  console.error('[frete/municipios]', erro);
  process.exitCode = 1;
});
