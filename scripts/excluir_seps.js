/**
 * Remove SEPs específicas e todos os registros relacionados (exceto schema sac).
 *
 * Uso:
 *   node scripts/excluir_seps.js          # dry-run (só mostra contagens)
 *   node scripts/excluir_seps.js --apply  # aplica no banco
 */
require('dotenv').config();
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const SEPS = [
  'SEP-1001.1',
  'SEP-1023.2',
  'SEP-1001.4',
  'SEP-1001.5',
  'SEP-1000.1',
  'SEP-1000.2',
  'SEP-1011.1',
  'SEP-1001.2',
  'SEP-1001.3',
  'SEP-1003.1',
  'SEP-1023.1',
  'SEP-1021.1',
  'SEP-1002.1',
  'SEP-1004.1',
  'SEP-1004.2',
  'SEP-1019.1',
  'SEP-1014.1',
  'SEP-1009.1',
  'SEP-1002.2',
];

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_INTERNAL_URL,
  ssl: { rejectUnauthorized: false },
});

async function tableExists(client, schema, table) {
  const { rows } = await client.query(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
     ) AS ok`,
    [schema, table]
  );
  return !!rows[0]?.ok;
}

async function countRows(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return parseInt(rows[0]?.cnt || '0', 10);
}

/** Vincula solicitacoes_separacao às SEPs derivadas (ex.: SEP-1001.1 → base SEP-1001 + produto). */
const SQL_SS_RELACIONADO = `
  ss.n_solic = ANY($1::text[])
  OR EXISTS (
    SELECT 1 FROM solicitacao_produto.itens_solicitados i
    JOIN logistica.carrinho c ON c.id = i.id_carr
    WHERE i.n_solic = ANY($1::text[])
      AND ss.codigo_produto = c.codigo_produto
      AND (
        ss.n_solic = i.n_solic
        OR ss.n_solic = regexp_replace(i.n_solic, '\\.[0-9]+$', '')
        OR (
          ss.n_solic IS NULL
          AND COALESCE(NULLIF(TRIM(ss.solicitado_para), ''), ss.nome_user) =
              COALESCE(NULLIF(TRIM(c.retirada_por), ''), c.nome_user)
        )
      )
  )
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log(`\n=== Exclusão de ${SEPS.length} SEPs ===`);
    console.log(`Modo: ${APPLY ? 'APLICAR (DELETE real)' : 'DRY-RUN (só leitura)'}\n`);

    const { rows: meta } = await client.query(
      `SELECT i.id, i.n_solic, i.status, i.id_carr, c.codigo_produto, c.nome_user
         FROM solicitacao_produto.itens_solicitados i
         LEFT JOIN logistica.carrinho c ON c.id = i.id_carr
        WHERE i.n_solic = ANY($1::text[])
        ORDER BY i.n_solic, i.id`,
      [SEPS]
    );

    const solicIds = meta.map((r) => r.id);
    const carrIds = [...new Set(meta.map((r) => r.id_carr).filter(Boolean))];

    console.log(`itens_solicitados encontrados: ${meta.length}`);
    if (meta.length) {
      const porSep = {};
      for (const r of meta) {
        porSep[r.n_solic] = (porSep[r.n_solic] || 0) + 1;
      }
      for (const [sep, qtd] of Object.entries(porSep).sort()) {
        console.log(`  ${sep}: ${qtd} item(ns)`);
      }
    }

    const counts = {};

    counts.solicitacoes_separacao = await countRows(
      client,
      `SELECT COUNT(*)::int AS cnt FROM solicitacao_produto.solicitacoes_separacao ss WHERE ${SQL_SS_RELACIONADO}`,
      [SEPS]
    );

    counts.registro_troca = 0;
    if (solicIds.length && await tableExists(client, 'solicitacao_produto', 'registro_troca')) {
      counts.registro_troca = await countRows(
          client,
          `SELECT COUNT(*)::int AS cnt FROM solicitacao_produto.registro_troca WHERE id_item_original = ANY($1::bigint[])`,
          [solicIds]
        );
    }

    counts.movimentacoes_kanban = solicIds.length || carrIds.length
      ? await countRows(
          client,
          `SELECT COUNT(*)::int AS cnt
             FROM solicitacao_produto.movimentacoes_kanban_itens
            WHERE ($1::bigint[] <> '{}' AND solic_id = ANY($1::bigint[]))
               OR ($2::bigint[] <> '{}' AND id_carr = ANY($2::bigint[]))`,
          [solicIds, carrIds]
        )
      : 0;

    counts.carrinho = carrIds.length
      ? await countRows(
          client,
          `SELECT COUNT(*)::int AS cnt FROM logistica.carrinho WHERE id = ANY($1::bigint[])`,
          [carrIds]
        )
      : 0;

    if (await tableExists(client, 'envios', 'solicitacoes')) {
      counts.envios_solicitacoes = await countRows(
        client,
        `SELECT COUNT(*)::int AS cnt FROM envios.solicitacoes WHERE numero_sep = ANY($1::text[])`,
        [SEPS]
      );
    } else {
      counts.envios_solicitacoes = 0;
    }

    // Tabelas legadas no schema logistica (se ainda existirem)
    for (const leg of ['itens_solicitados', 'solicitacoes_separacao']) {
      if (await tableExists(client, 'logistica', leg)) {
        counts[`logistica_${leg}`] = await countRows(
          client,
          `SELECT COUNT(*)::int AS cnt FROM logistica."${leg}" WHERE n_solic = ANY($1::text[])`,
          [SEPS]
        );
      }
    }

    console.log('\nRegistros relacionados a excluir:');
    for (const [tabela, qtd] of Object.entries(counts)) {
      console.log(`  ${tabela}: ${qtd}`);
    }

    if (!APPLY) {
      console.log('\nNada foi alterado. Rode com --apply para executar os DELETEs.\n');
      return;
    }

    await client.query('BEGIN');

    if (solicIds.length) {
      if (await tableExists(client, 'solicitacao_produto', 'registro_troca')) {
        await client.query(
          `DELETE FROM solicitacao_produto.registro_troca WHERE id_item_original = ANY($1::bigint[])`,
          [solicIds]
        );
      }
      await client.query(
        `DELETE FROM solicitacao_produto.movimentacoes_kanban_itens
          WHERE solic_id = ANY($1::bigint[])
             OR id_carr = ANY($2::bigint[])`,
        [solicIds, carrIds]
      );
    }

    await client.query(
      `DELETE FROM solicitacao_produto.solicitacoes_separacao ss WHERE ${SQL_SS_RELACIONADO}`,
      [SEPS]
    );

    await client.query(
      `DELETE FROM solicitacao_produto.itens_solicitados WHERE n_solic = ANY($1::text[])`,
      [SEPS]
    );

    if (carrIds.length) {
      await client.query(
        `DELETE FROM logistica.carrinho c
          WHERE c.id = ANY($1::bigint[])
            AND NOT EXISTS (
              SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = c.id
            )`,
        [carrIds]
      );
    }

    if (counts.envios_solicitacoes) {
      await client.query(
        `DELETE FROM envios.solicitacoes WHERE numero_sep = ANY($1::text[])`,
        [SEPS]
      );
    }

    for (const leg of ['itens_solicitados', 'solicitacoes_separacao']) {
      if (await tableExists(client, 'logistica', leg)) {
        await client.query(
          `DELETE FROM logistica."${leg}" WHERE n_solic = ANY($1::text[])`,
          [SEPS]
        );
      }
    }

    await client.query('COMMIT');
    console.log('\nExclusão concluída com sucesso.\n');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('Erro:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
