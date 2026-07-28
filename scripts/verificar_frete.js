#!/usr/bin/env node
require('dotenv').config();

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_INTERNAL_URL;
if (!connectionString) throw new Error('DATABASE_URL não configurada.');

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });

async function main() {
  const [fontes, normalizados, status, ultimaCotacao, origem] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM frete.importacao_linha'),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM frete.cobertura) AS coberturas,
      (SELECT COUNT(*)::int FROM frete.tarifa_faixa) AS faixas`),
    pool.query('SELECT status, COUNT(*)::int AS total FROM frete.tabela_preco GROUP BY status ORDER BY status'),
    pool.query(`SELECT c.id, c.criado_em, c.destino_cidade, c.destino_uf,
      (SELECT COUNT(*)::int FROM frete.cotacao_item i WHERE i.cotacao_id = c.id) AS itens,
      (SELECT COUNT(*)::int FROM frete.cotacao_resultado r WHERE r.cotacao_id = c.id) AS resultados
      FROM frete.cotacao c ORDER BY c.id DESC LIMIT 1`),
    pool.query("SELECT valor FROM frete.configuracao WHERE chave = 'origem_padrao'")
  ]);

  console.log(JSON.stringify({
    linhas_fonte: fontes.rows[0].total,
    normalizados: normalizados.rows[0],
    tabelas_por_status: status.rows,
    origem: origem.rows[0]?.valor || null,
    ultima_cotacao: ultimaCotacao.rows[0] || null
  }, null, 2));
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
