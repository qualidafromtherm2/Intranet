/**
 * Migração: reestrutura engenharia.codigos_erro em 3 tabelas relacionadas.
 *
 * ANTES (flat):  codigos_erro(id, codigo, analise, solucao_problema, ...)
 *
 * DEPOIS:
 *   codigos_erro   (id, codigo, ...)          — um registro por código único
 *   codigo_analise (id, codigo_erro_id, analise) — N análises por código
 *   codigo_solucao (id, codigo_analise_id, solucao_problema) — N soluções por análise
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    // ── 1. Ler todos os dados ANTES da migração ──────────────────────────────
    const { rows: dados } = await client.query(
      'SELECT id, codigo, analise, solucao_problema, criado_por, criado_em FROM engenharia.codigos_erro ORDER BY id'
    );
    console.log(`Lidos ${dados.length} registros existentes.`);

    await client.query('BEGIN');

    // ── 2. Truncar tabela e resetar serial ───────────────────────────────────
    await client.query('TRUNCATE engenharia.codigos_erro RESTART IDENTITY CASCADE');

    // ── 3. Remover colunas que serão movidas para as novas tabelas ───────────
    await client.query('ALTER TABLE engenharia.codigos_erro DROP COLUMN IF EXISTS analise');
    await client.query('ALTER TABLE engenharia.codigos_erro DROP COLUMN IF EXISTS solucao_problema');

    // ── 4. Criar tabela codigo_analise ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS engenharia.codigo_analise (
        id              SERIAL PRIMARY KEY,
        codigo_erro_id  INTEGER NOT NULL
                          REFERENCES engenharia.codigos_erro(id) ON DELETE CASCADE,
        analise         TEXT,
        criado_por      TEXT,
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // ── 5. Criar tabela codigo_solucao ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS engenharia.codigo_solucao (
        id                SERIAL PRIMARY KEY,
        codigo_analise_id INTEGER NOT NULL
                            REFERENCES engenharia.codigo_analise(id) ON DELETE CASCADE,
        solucao_problema  TEXT,
        criado_por        TEXT,
        criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // ── 6. Re-inserir códigos únicos em codigos_erro ─────────────────────────
    const codigosUnicos = [...new Set(dados.map(r => r.codigo))];
    console.log(`Códigos únicos: ${codigosUnicos.length}`);

    const codigoIdMap = {}; // codigo (string) → novo id
    for (const codigo of codigosUnicos) {
      const r = await client.query(
        `INSERT INTO engenharia.codigos_erro (codigo, criado_por)
         VALUES ($1, 'importacao_csv') RETURNING id`,
        [codigo]
      );
      codigoIdMap[codigo] = r.rows[0].id;
    }

    // ── 7. Inserir análises e soluções ───────────────────────────────────────
    let totalAnalises = 0;
    let totalSolucoes = 0;

    for (const row of dados) {
      const codigoErroId = codigoIdMap[row.codigo];
      if (!codigoErroId) continue;

      const analiseRes = await client.query(
        `INSERT INTO engenharia.codigo_analise (codigo_erro_id, analise, criado_por, criado_em)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [codigoErroId, row.analise || null, row.criado_por || 'importacao_csv', row.criado_em]
      );
      totalAnalises++;
      const analiseId = analiseRes.rows[0].id;

      if (row.solucao_problema && row.solucao_problema.trim()) {
        await client.query(
          `INSERT INTO engenharia.codigo_solucao (codigo_analise_id, solucao_problema, criado_por, criado_em)
           VALUES ($1, $2, $3, $4)`,
          [analiseId, row.solucao_problema, row.criado_por || 'importacao_csv', row.criado_em]
        );
        totalSolucoes++;
      }
    }

    await client.query('COMMIT');
    console.log('✅ Migração concluída com sucesso!');
    console.log(`   codigos_erro:   ${codigosUnicos.length} registros`);
    console.log(`   codigo_analise: ${totalAnalises} registros`);
    console.log(`   codigo_solucao: ${totalSolucoes} registros`);

  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Erro — rollback executado:', e.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
})();
