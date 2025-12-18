// scripts/sync_omie_estrutura.js
require('dotenv').config();

// Helpers para normalizar datas/horas vindas da Omie
function parseDateBR(s) {
  if (!s) return null;
  if (s instanceof Date && !isNaN(+s)) {
    // Date -> YYYY-MM-DD
    return s.toISOString().slice(0, 10);
  }
  const str = String(s).trim();
  // já no padrão ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // DD/MM/YYYY
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  // fallback: se não reconheceu, retorna null pra não quebrar
  return null;
}

function parseTimeSafe(s) {
  if (!s) return null;
  const str = String(s).trim();
  // aceita HH:MM ou HH:MM:SS
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(str)) return str.length === 5 ? `${str}:00` : str;
  return null;
}

const { Pool } = require('pg');
// no topo do arquivo:
const path = require('path');

// SUBSTITUA qualquer require antigo do client por ESTE:
const ProdutosEstruturaJsonClient = require(
  path.resolve(__dirname, '../utils/omie/ProdutosEstruturaJsonClient.js')
);


// 1) Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// 3) Helper: encontra ou cria o registro do "pai" em omie_estrutura
async function upsertCabecalho(client, ident, observacoes, custoProducao) {
  const {
    idProduto = null, intProduto = null, codProduto = null,
    descrProduto = null, tipoProduto = null, unidProduto = null,
    pesoLiqProduto = null, pesoBrutoProduto = null,
  } = ident || {};

  const obsRelevantes = (observacoes && observacoes.obsRelevantes) || null;
  const vMOD = (custoProducao && custoProducao.vMOD) || null;
  const vGGF = (custoProducao && custoProducao.vGGF) || null;

  // tenta localizar por prioridade: cod → id → int
  const sel = await client.query(
    `SELECT id FROM public.omie_estrutura
       WHERE (cod_produto = $1 AND $1 IS NOT NULL)
          OR (id_produto  = $2 AND $2 IS NOT NULL)
          OR (int_produto = $3 AND $3 IS NOT NULL)
       ORDER BY id ASC
       LIMIT 1`,
    [codProduto, idProduto, intProduto]
  );

  if (sel.rows.length) {
    const parentId = sel.rows[0].id;
    await client.query(
      `UPDATE public.omie_estrutura
         SET descr_produto = $1,
             tipo_produto  = $2,
             unid_produto  = $3,
             peso_liq_produto   = $4,
             peso_bruto_produto = $5,
             obs_relevantes = $6,
             v_mod = $7,
             v_ggf = $8,
             id_produto = COALESCE(id_produto, $9),
             int_produto = COALESCE(int_produto, $10),
             cod_produto = COALESCE(cod_produto, $11)
       WHERE id = $12`,
      [descrProduto, tipoProduto, unidProduto,
       pesoLiqProduto, pesoBrutoProduto,
       obsRelevantes, vMOD, vGGF,
       idProduto, intProduto, codProduto, parentId]
    );
    return parentId;
  }

  const ins = await client.query(
    `INSERT INTO public.omie_estrutura
       (id_produto, int_produto, cod_produto, descr_produto, tipo_produto,
        unid_produto, peso_liq_produto, peso_bruto_produto,
        obs_relevantes, v_mod, v_ggf, origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'omie')
     RETURNING id`,
    [idProduto, intProduto, codProduto, descrProduto, tipoProduto,
     unidProduto, pesoLiqProduto, pesoBrutoProduto,
     obsRelevantes, vMOD, vGGF]
  );
  return ins.rows[0].id;
}

// 4) Helper: substitui os itens do pai
// 4) Helper: substitui os itens do pai (agora com DEDUP)
async function replaceItens(client, parentId, itens = []) {
  // 4.1) remove itens antigos do pai
  await client.query(`DELETE FROM public.omie_estrutura_item WHERE parent_id = $1`, [parentId]);

  if (!Array.isArray(itens) || itens.length === 0) return;

  // 4.2) DEDUP – a UNIQUE do banco é:
  // (parent_id, COALESCE(cod_prod_malha,''), COALESCE(int_prod_malha,''), COALESCE(id_prod_malha::text,''))
  // então vamos normalizar da MESMA forma aqui.
  const norm = v => (v === undefined || v === null) ? '' : String(v);
  const seen = new Set();
  const dedup = [];
  let dropped = 0;

  for (const it of itens) {
    const key = [ norm(it.codProdMalha), norm(it.intProdMalha), norm(it.idProdMalha) ].join('|');
    if (seen.has(key)) {
      dropped++;
      continue; // ignora duplicado
    }
    seen.add(key);
    dedup.push(it);
  }

  if (dropped > 0) {
    console.log(`[SYNC][parent=${parentId}] removidos ${dropped} itens duplicados (antes ${itens.length}, depois ${dedup.length}).`);
  }

  if (dedup.length === 0) return;

  // 4.3) INSERT em lote (igual ao antes, só que usando 'dedup')
  const text = `
    INSERT INTO public.omie_estrutura_item (
      parent_id,
      id_malha, int_malha,
      id_prod_malha, int_prod_malha, cod_prod_malha, descr_prod_malha,
      quant_prod_malha, unid_prod_malha, tipo_prod_malha,
      id_fam_malha, cod_fam_malha, descr_fam_malha,
      peso_liq_prod_malha, peso_bruto_prod_malha,
      perc_perda_prod_malha, obs_prod_malha,
      d_inc_prod_malha, h_inc_prod_malha, u_inc_prod_malha,
      d_alt_prod_malha, h_alt_prod_malha, u_alt_prod_malha,
      codigo_local_estoque
    )
    VALUES
    ${dedup.map((_, i) => `(
      $1,
      $${2 + i*23}, $${3 + i*23},
      $${4 + i*23}, $${5 + i*23}, $${6 + i*23}, $${7 + i*23},
      $${8 + i*23}, $${9 + i*23}, $${10 + i*23},
      $${11 + i*23}, $${12 + i*23}, $${13 + i*23},
      $${14 + i*23}, $${15 + i*23},
      $${16 + i*23}, $${17 + i*23},
      $${18 + i*23}, $${19 + i*23}, $${20 + i*23},
      $${21 + i*23}, $${22 + i*23}, $${23 + i*23},
      $${24 + i*23}
    )`).join(',')}
  `;

  const vals = [parentId];
  for (const it of dedup) {
    vals.push(
      it.idMalha ?? null, it.intMalha ?? null,
      it.idProdMalha ?? null, it.intProdMalha ?? null, it.codProdMalha ?? null, it.descrProdMalha ?? null,
      it.quantProdMalha ?? 0, it.unidProdMalha ?? null, it.tipoProdMalha ?? null,
      it.idFamMalha ?? null, it.codFamMalha ?? null, it.descrFamMalha ?? null,
      it.pesoLiqProdMalha ?? null, it.pesoBrutoProdMalha ?? null,
      it.percPerdaProdMalha ?? null, it.obsProdMalha ?? null,

      // 🔻 aqui usamos os parsers
      parseDateBR(it.dIncProdMalha),  parseTimeSafe(it.hIncProdMalha),  it.uIncProdMalha ?? null,
      parseDateBR(it.dAltProdMalha),  parseTimeSafe(it.hAltProdMalha),  it.uAltProdMalha ?? null,

      it.codigo_local_estoque ?? null
    );
  }


  await client.query(text, vals);
}


// 5) Salva JSON bruto para auditoria
async function saveRaw(client, keyRef, payload) {
  await client.query(
    `INSERT INTO public.omie_estrutura_raw (key_ref, payload) VALUES ($1,$2)`,
    [keyRef, payload]
  );
}

// 6) Loop de paginação do ListarEstruturas
async function syncAll() {
  const omie = new ProdutosEstruturaJsonClient();

  let nPagina = 1;
  const nRegPorPagina = 80;

  // checagem simples de credenciais
  if (!process.env.OMIE_APP_KEY || !process.env.OMIE_APP_SECRET) {
    console.error('Faltam OMIE_APP_KEY / OMIE_APP_SECRET no .env');
    process.exit(1);
  }

  while (true) {
    console.log(`[SYNC] Requisitando página ${nPagina}...`);

    // chamada Omie
    const resp = omie.ListarEstruturas({
      nPagina,
      nRegPorPagina,
      cOrdenarPor: null,
      dIncProdMalhaIni: null, dIncProdMalhaFim: null,
      hIncProdMalhaIni: null, hIncProdMalhaFim: null,
      dAltProdMalhaIni: null, dAltProdMalhaFim: null,
      hAltProdMalhaIni: null, hAltProdMalhaFim: null,
    });

    if (resp && resp.omie_fail) {
      console.error('Falha Omie:', resp);
      process.exit(2);
    }

    const { nPagina: pag, nTotPaginas, produtosEncontrados = [] } = resp || {};
    console.log(`[SYNC] Página ${pag}/${nTotPaginas} – ${produtosEncontrados.length} produtos`);

    // transação por página
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const p of produtosEncontrados) {
        const ident = p.ident || {};
        const keyRef = ident.codProduto || String(ident.idProduto || ident.intProduto || '');

        // salva raw
        await saveRaw(client, keyRef, p);

        // upsert cabeçalho
        const parentId = await upsertCabecalho(client, p.ident, p.observacoes, p.custoProducao);

        // substitui itens
        await replaceItens(client, parentId, Array.isArray(p.itens) ? p.itens : []);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[SYNC] Erro na página', nPagina, err);
      process.exit(3);
    } finally {
      client.release();
    }

    if (!nTotPaginas || nPagina >= nTotPaginas) break;
    nPagina += 1;
  }

  console.log('[SYNC] Concluído.');
  await pool.end();
}

// run
syncAll().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(9);
});
