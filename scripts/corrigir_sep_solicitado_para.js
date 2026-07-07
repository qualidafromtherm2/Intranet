/**
 * Corrige SEPs pendentes que compartilham o mesmo n_solic com solicitado_para
 * (ou nome_user) diferente — cada combinação deve ter seu próprio SEP.
 *
 * Uso:
 *   node scripts/corrigir_sep_solicitado_para.js          # dry-run (só mostra)
 *   node scripts/corrigir_sep_solicitado_para.js --apply  # aplica no banco
 */
require('dotenv').config();
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_INTERNAL_URL,
  ssl: { rejectUnauthorized: false },
});

function normPara(v, fallback) {
  const s = String(v || '').trim();
  return s || String(fallback || '').trim();
}

async function proximoSepBase(client) {
  const { rows: [seq] } = await client.query(`
    SELECT COALESCE(MAX(
      CASE WHEN n_solic ~ '^SEP-[0-9]+$'
           THEN SUBSTRING(n_solic FROM 5)::integer
           ELSE NULL END
    ), 999) + 1 AS next_num
      FROM solicitacao_produto.itens_solicitados
  `);
  return `SEP-${Math.max(1000, seq.next_num)}`;
}

async function buscarConflitos(client) {
  const { rows: grupos } = await client.query(`
    SELECT
      i.n_solic,
      c.nome_user,
      COALESCE(NULLIF(TRIM(c.retirada_por), ''), NULLIF(TRIM(ss.solicitado_para), ''), c.nome_user) AS solicitado_para,
      MIN(COALESCE(ss.criado_em, i.criado_em, now())) AS primeiro_em,
      COUNT(DISTINCT i.id) AS qtd_itens,
      COUNT(DISTINCT ss.id) AS qtd_ss
    FROM solicitacao_produto.itens_solicitados i
    JOIN logistica.carrinho c ON c.id = i.id_carr
    LEFT JOIN solicitacao_produto.solicitacoes_separacao ss
      ON ss.n_solic = i.n_solic
     AND ss.codigo_produto = c.codigo_produto
     AND ss.id_user = c.id_user
     AND ss.nome_user = c.nome_user
    WHERE i.n_solic ~ '^SEP-[0-9]+$'
      AND i.status = 'pendente'
    GROUP BY i.n_solic, c.nome_user,
      COALESCE(NULLIF(TRIM(c.retirada_por), ''), NULLIF(TRIM(ss.solicitado_para), ''), c.nome_user)
    ORDER BY i.n_solic, primeiro_em
  `);

  const porSep = new Map();
  for (const g of grupos) {
    if (!porSep.has(g.n_solic)) porSep.set(g.n_solic, []);
    porSep.get(g.n_solic).push(g);
  }

  const remapeamentos = [];
  for (const [nSolic, lista] of porSep.entries()) {
    if (lista.length <= 1) continue;
    const [manter, ...mover] = lista;
    for (const g of mover) {
      remapeamentos.push({
        de: nSolic,
        para: null,
        nome_user: g.nome_user,
        solicitado_para: g.solicitado_para,
        qtd_itens: g.qtd_itens,
        qtd_ss: g.qtd_ss,
      });
    }
    console.log(`[conflito] ${nSolic}: mantém ${manter.nome_user} → ${manter.solicitado_para} (${manter.qtd_itens} itens)`);
    for (const g of mover) {
      console.log(`           mover ${g.nome_user} → ${g.solicitado_para} (${g.qtd_itens} itens)`);
    }
  }
  return remapeamentos;
}

async function aplicarRemapeamentos(client, remapeamentos) {
  let alterados = 0;
  for (const map of remapeamentos) {
    const novoSep = await proximoSepBase(client);
    map.para = novoSep;

    const { rowCount: ssCount } = await client.query(
      `UPDATE solicitacao_produto.solicitacoes_separacao
          SET n_solic = $1
        WHERE n_solic = $2
          AND nome_user = $3
          AND COALESCE(NULLIF(TRIM(solicitado_para), ''), nome_user) = $4
          AND status = 'pendente'`,
      [novoSep, map.de, map.nome_user, map.solicitado_para]
    );

    const { rowCount: itCount } = await client.query(
      `UPDATE solicitacao_produto.itens_solicitados i
          SET n_solic = $1
         FROM logistica.carrinho c
        WHERE i.id_carr = c.id
          AND i.n_solic = $2
          AND c.nome_user = $3
          AND COALESCE(NULLIF(TRIM(c.retirada_por), ''), c.nome_user) = $4
          AND i.status = 'pendente'`,
      [novoSep, map.de, map.nome_user, map.solicitado_para]
    );

    const { rowCount: envCount } = await client.query(
      `UPDATE envios.solicitacoes e
          SET numero_sep = $1
        WHERE e.numero_sep = $2
          AND e.usuario = $3
          AND NOT EXISTS (
            SELECT 1 FROM envios.solicitacoes e2 WHERE e2.numero_sep = $1
          )`,
      [novoSep, map.de, map.nome_user]
    );

    console.log(`  ✓ ${map.de} → ${novoSep}  (${map.nome_user} / ${map.solicitado_para})  ss=${ssCount} itens=${itCount} envios=${envCount}`);
    alterados++;
  }
  return alterados;
}

async function main() {
  const client = await pool.connect();
  try {
    console.log(APPLY ? '=== APLICANDO correção ===' : '=== DRY-RUN (use --apply para gravar) ===');
    const remapeamentos = await buscarConflitos(client);
    if (!remapeamentos.length) {
      console.log('Nenhum conflito encontrado.');
      return;
    }
    console.log(`\nTotal de grupos a remapear: ${remapeamentos.length}`);

    if (!APPLY) {
      console.log('\nExecute com --apply para gravar as alterações.');
      return;
    }

    await client.query('BEGIN');
    const n = await aplicarRemapeamentos(client, remapeamentos);
    await client.query('COMMIT');
    console.log(`\nConcluído: ${n} SEP(s) corrigida(s).`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Erro:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
