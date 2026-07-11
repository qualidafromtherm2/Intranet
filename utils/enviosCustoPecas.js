/**
 * Custo de peças enviadas (CMC) amarrado a envios.solicitacoes + OS (id_at).
 * Fonte do valor unitário: logistica.estoque_atual.cmc
 */
'use strict';

function parseConteudoItens(conteudoRaw) {
  let itens = [];
  try {
    const parsed = typeof conteudoRaw === 'string' ? JSON.parse(conteudoRaw || '[]') : conteudoRaw;
    itens = Array.isArray(parsed) ? parsed : [];
  } catch {
    itens = [];
  }
  return itens.map((it) => {
    const texto = String(it?.conteudo || it?.descricao || '').trim();
    const qtdRaw = it?.quantidade ?? it?.qtd ?? 1;
    const qtd = Math.max(0, Number(String(qtdRaw).replace(',', '.')) || 1);
    let codigo = '';
    let descricao = texto;
    const dash = texto.indexOf(' - ');
    if (dash > 0) {
      codigo = texto.slice(0, dash).trim();
      descricao = texto.slice(dash + 3).trim() || texto;
    } else {
      const m = texto.match(/^([0-9A-Za-z.\/_-]+)\s+/);
      if (m) {
        codigo = m[1];
        descricao = texto.slice(m[0].length).trim() || texto;
      }
    }
    return { codigo, descricao, quantidade: qtd, texto };
  }).filter((it) => it.texto || it.codigo);
}

async function ensureCustoPecasTable(db) {
  await db.query(`
    CREATE SCHEMA IF NOT EXISTS envios;
    CREATE TABLE IF NOT EXISTS envios.custo_pecas (
      id BIGSERIAL PRIMARY KEY,
      id_envio BIGINT NOT NULL REFERENCES envios.solicitacoes(id) ON DELETE CASCADE,
      id_at BIGINT,
      codigo_produto TEXT,
      descricao TEXT,
      quantidade NUMERIC(12,3) NOT NULL DEFAULT 1,
      cmc_unitario NUMERIC(15,4),
      valor_total NUMERIC(15,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_envios_custo_pecas_id_envio
      ON envios.custo_pecas (id_envio);
    CREATE INDEX IF NOT EXISTS idx_envios_custo_pecas_id_at
      ON envios.custo_pecas (id_at)
      WHERE id_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_envios_custo_pecas_codigo
      ON envios.custo_pecas (codigo_produto)
      WHERE codigo_produto IS NOT NULL;
  `);
}

async function buscarCmcMap(db, codigos) {
  const uniq = [...new Set((codigos || []).map((c) => String(c || '').trim()).filter(Boolean))];
  const map = new Map();
  if (!uniq.length) return map;
  const { rows } = await db.query(
    `SELECT UPPER(TRIM(codigo)) AS codigo,
            MAX(cmc) FILTER (WHERE cmc IS NOT NULL) AS cmc
       FROM logistica.estoque_atual
      WHERE UPPER(TRIM(codigo)) = ANY($1::text[])
      GROUP BY UPPER(TRIM(codigo))`,
    [uniq.map((c) => c.toUpperCase())]
  );
  for (const r of rows) {
    if (r.cmc != null) map.set(String(r.codigo).toUpperCase(), Number(r.cmc));
  }
  return map;
}

/**
 * Regenera linhas de envios.custo_pecas para um envio (a partir de conteudo + CMC atual).
 */
async function syncCustoPecasEnvio(db, envioId) {
  const id = parseInt(envioId, 10);
  if (!id || id < 1) return { ok: false, inserted: 0 };

  await ensureCustoPecasTable(db);

  const { rows } = await db.query(
    `SELECT id, id_at, conteudo FROM envios.solicitacoes WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!rows.length) return { ok: false, inserted: 0 };

  const envio = rows[0];
  const itens = parseConteudoItens(envio.conteudo);
  await db.query(`DELETE FROM envios.custo_pecas WHERE id_envio = $1`, [id]);

  if (!itens.length) return { ok: true, inserted: 0 };

  const cmcMap = await buscarCmcMap(db, itens.map((i) => i.codigo));
  const values = [];
  const params = [];
  let p = 1;
  for (const it of itens) {
    const cmc = it.codigo ? (cmcMap.get(it.codigo.toUpperCase()) ?? null) : null;
    const valorTotal = cmc != null
      ? Math.round(Number(cmc) * Number(it.quantidade) * 100) / 100
      : null;
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(
      id,
      envio.id_at != null ? Number(envio.id_at) : null,
      it.codigo || null,
      it.descricao || it.texto || null,
      it.quantidade,
      cmc,
      valorTotal
    );
  }

  await db.query(
    `INSERT INTO envios.custo_pecas
       (id_envio, id_at, codigo_produto, descricao, quantidade, cmc_unitario, valor_total)
     VALUES ${values.join(',')}`,
    params
  );
  return { ok: true, inserted: itens.length };
}

/**
 * Backfill em lote (rápido): 1 leitura de envios + 1 CMC + inserts em batch.
 */
async function backfillCustoPecas(db, { onlyMissing = true, limit = 5000 } = {}) {
  await ensureCustoPecasTable(db);
  const { rows: envios } = await db.query(
    onlyMissing
      ? `SELECT e.id, e.id_at, e.conteudo
           FROM envios.solicitacoes e
          WHERE e.conteudo IS NOT NULL
            AND TRIM(e.conteudo) <> ''
            AND NOT EXISTS (SELECT 1 FROM envios.custo_pecas c WHERE c.id_envio = e.id)
          ORDER BY e.id DESC
          LIMIT $1`
      : `SELECT e.id, e.id_at, e.conteudo
           FROM envios.solicitacoes e
          WHERE e.conteudo IS NOT NULL
            AND TRIM(e.conteudo) <> ''
          ORDER BY e.id DESC
          LIMIT $1`,
    [limit]
  );

  if (!envios.length) {
    console.log('[custo_pecas] backfill: nada pendente');
    return { envios: 0, linhas: 0 };
  }

  if (!onlyMissing) {
    await db.query(`DELETE FROM envios.custo_pecas WHERE id_envio = ANY($1::bigint[])`, [
      envios.map((e) => e.id),
    ]);
  }

  const prepared = [];
  const codigos = [];
  for (const e of envios) {
    const itens = parseConteudoItens(e.conteudo);
    for (const it of itens) {
      if (it.codigo) codigos.push(it.codigo);
      prepared.push({
        id_envio: e.id,
        id_at: e.id_at != null ? Number(e.id_at) : null,
        ...it,
      });
    }
  }

  const cmcMap = await buscarCmcMap(db, codigos);
  let inserted = 0;
  const BATCH = 300;
  for (let i = 0; i < prepared.length; i += BATCH) {
    const chunk = prepared.slice(i, i + BATCH);
    const values = [];
    const params = [];
    let p = 1;
    for (const it of chunk) {
      const cmc = it.codigo ? (cmcMap.get(it.codigo.toUpperCase()) ?? null) : null;
      const valorTotal = cmc != null
        ? Math.round(Number(cmc) * Number(it.quantidade) * 100) / 100
        : null;
      values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      params.push(
        it.id_envio,
        it.id_at,
        it.codigo || null,
        it.descricao || it.texto || null,
        it.quantidade,
        cmc,
        valorTotal
      );
    }
    await db.query(
      `INSERT INTO envios.custo_pecas
         (id_envio, id_at, codigo_produto, descricao, quantidade, cmc_unitario, valor_total)
       VALUES ${values.join(',')}`,
      params
    );
    inserted += chunk.length;
  }

  await db.query(`
    UPDATE envios.custo_pecas c
       SET id_at = e.id_at
      FROM envios.solicitacoes e
     WHERE c.id_envio = e.id
       AND c.id_at IS DISTINCT FROM e.id_at
  `);

  console.log(`[custo_pecas] backfill: ${envios.length} envios, ${inserted} linhas`);
  return { envios: envios.length, linhas: inserted };
}

module.exports = {
  parseConteudoItens,
  ensureCustoPecasTable,
  syncCustoPecasEnvio,
  backfillCustoPecas,
};
