// routes/pcp_estrutura.js
const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');

// ── Pool Postgres (usa variáveis do ambiente) ────────────────────────────────
const pool = new Pool({
  host:     process.env.PGHOST || 'localhost',
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port:     Number(process.env.PGPORT || 5432),
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
});

// — helper: tenta ler pela view v2 (com comp_operacao). Se falhar, tenta a v1 e projeta comp_operacao como NULL —
// Mantém o shape unificado para o front (sempre devolve comp_operacao).
async function fetchEstruturaViaView(client, pai) {
  // tenta v2 (tem a coluna nova)
  try {
    const r = await client.query(`
      SELECT pai_cod_produto, comp_codigo, comp_descricao, comp_qtd, comp_unid,
             comp_operacao, custo_real, ordem
      FROM public.vw_estrutura_para_front_v2
      WHERE pai_cod_produto = $1
      ORDER BY COALESCE(ordem, 999999), comp_descricao
    `, [pai]);
    if (r?.rows?.length) return r.rows;
  } catch (e) {
    // segue para v1
  }

  // tenta v1 (não tem a coluna; projetamos NULL p/ manter compatibilidade)
  try {
    const r = await client.query(`
      SELECT pai_cod_produto, comp_codigo, comp_descricao, comp_qtd, comp_unid,
             NULL::text AS comp_operacao, custo_real, ordem
      FROM public.vw_estrutura_para_front
      WHERE pai_cod_produto = $1
      ORDER BY COALESCE(ordem, 999999), comp_descricao
    `, [pai]);
    return r.rows;
  } catch (e) {
    return null;
  }
}

function extractPaiCodigo(req) {
  // aceita body e query, independente do método
  const b = req.body || {};
  const q = req.query || {};
  const v = b.pai_codigo || b.codigo || b.pai_cod_produto ||
            q.pai_codigo || q.codigo || q.pai_cod_produto || '';
  return String(v || '').trim();
}

// Normaliza linhas do layout "Listagem dos Materiais (B.O.M.)"
// ─────────────────────────────────────────────────────────────────────────────
// Normalizador de cabeçalhos do CSV: remove acentos, espaços duplicados,
// força minúsculas. Assim "Operação", "Operacao", "OperaÃ§Ã£o", "OPER A Ç Ã O"
// viram todos "operacao".
// ─────────────────────────────────────────────────────────────────────────────
function _normKey(s) {
  return String(s ?? '')
    .replace(/^\uFEFF/, '')                    // remove BOM se existir
    .normalize('NFKD')                         // separa diacríticos
    .replace(/[\u0300-\u036f]/g, '')           // remove diacríticos (acentos)
    .replace(/\s+/g, ' ')                      // colapsa espaços internos
    .trim()
    .toLowerCase();
}

// Retorna o valor do primeiro cabeçalho "equivalente" encontrado
function _pick(obj, candidates) {
  const map = new Map(Object.keys(obj).map(k => [_normKey(k), k]));
  for (const c of candidates) {
    const nk = _normKey(c);
    if (map.has(nk)) return obj[map.get(nk)];
  }
  // fallback heurístico: qualquer chave que contenha "operac"
  for (const [nk, orig] of map) {
    if (nk.includes('operac')) return obj[orig];
  }
  return undefined;
}

// Conversor numérico amigável ao BR ("1.234,56" → 1234.56)
function parseNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/\./g, '').replace(',', '.').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normaliza linhas do layout "Listagem dos Materiais (B.O.M.)"
// Campos esperados (com tolerância a variações de nomes):
// - Identificação do Produto (descrição do componente)
// - Descrição do Produto     (código do componente)
// - Qtde Prevista            (quantidade)
// - Unidade                  (unidade)
// - Operação                 (nova, pode vir com/sem acento ou corrompida)
// ─────────────────────────────────────────────────────────────────────────────
function mapFromBOMRows(bomRows = []) {
  if (!Array.isArray(bomRows)) return [];
  return bomRows.map(r => {
    const comp_descricao = String(_pick(r, [
      'Identificação do Produto', 'Identificacao do Produto',
      'Identificação', 'Identificacao'
    ]) ?? '').trim();

    const comp_codigo = String(_pick(r, [
      'Descrição do Produto', 'Descricao do Produto',
      'Código', 'Codigo', 'Produto'
    ]) ?? '').trim();

    const comp_qtd = parseNumber(_pick(r, [
      'Qtde Prevista', 'Qtde', 'Quantidade'
    ]));

    const comp_unid = String(_pick(r, [
      'Unidade', 'Und', 'Un'
    ]) ?? '').trim() || null;

    const comp_operacao = String(_pick(r, [
      'Operação', 'Operacao', 'Operaçao', 'OperaÃ§Ã£o', 'Operação', 'Operações', 'Operacoes'
    ]) ?? '').trim() || null;

    return { comp_codigo, comp_descricao, comp_qtd, comp_unid, comp_operacao };
  }).filter(x => x.comp_codigo);
}


// [/api/pcp/estrutura]
// Fonte da estrutura: mesma da "Estrutura de produto" (view v2 → v1 → tabelas).
// Qtd prod (PCP): CONTAGEM de cartões na kanban_preparacao_view
// nas colunas "A Produzir" + "Produzindo" POR produto FILHO.
// A ligação é feita por ID Omie do filho:
//   comp (BOM) → omie_estrutura_item.id_prod_malha  ==  kanban_preparacao_view.c_cod_int_prod
// Observação: não há "quantidade" numérica no Kanban; o número que você vê é o total de cartões.
async function handleEstruturaSQL(req, res) {
  const pai = extractPaiCodigo(req);
  if (!pai) return res.status(400).json({ ok:false, msg:'Informe pai_codigo.' });

  const client = await pool.connect();
  try {
    let origem = '';
    let rows = [];

    // 1) VIEW v2 (se existir)
    try {
      const qv2 = await client.query(`
        SELECT
          comp_codigo,
          comp_descricao,
          comp_qtd::numeric(18,6) AS comp_qtd,
          comp_unid,
          comp_operacao
        FROM public.vw_estrutura_para_front_v2
        WHERE pai_cod_produto = $1
        ORDER BY comp_descricao NULLS LAST, comp_codigo
      `, [pai]);
      rows = qv2.rows || [];
      origem = 'view_v2';
    } catch {}

    // 2) VIEW v1 (mínimo garantido)
    if (!rows.length) {
      try {
        const qv1 = await client.query(`
          SELECT
            comp_codigo,
            comp_descricao,
            comp_qtd::numeric(18,6) AS comp_qtd,
            comp_unid,
            NULL::text AS comp_operacao
          FROM public.vw_estrutura_para_front
          WHERE pai_cod_produto = $1
          ORDER BY comp_descricao NULLS LAST, comp_codigo
        `, [pai]);
        rows = qv1.rows || [];
        origem = 'view_v1';
      } catch {}
    }

    // 3) Fallback: tabelas (omie_estrutura + omie_estrutura_item)
    if (!rows.length) {
      const qtb = await client.query(`
        SELECT
          i.cod_prod_malha                  AS comp_codigo,
          i.descr_prod_malha                AS comp_descricao,
          i.quant_prod_malha::numeric(18,6) AS comp_qtd,
          i.unid_prod_malha                 AS comp_unid,
          i.operacao                        AS comp_operacao
        FROM public.omie_estrutura_item i
        JOIN public.omie_estrutura    e ON e.id = i.parent_id
        WHERE e.cod_produto = $1
        ORDER BY i.descr_prod_malha NULLS LAST, i.cod_prod_malha
      `, [pai]);
      rows = qtb.rows || [];
      origem = 'tabelas';
    }

    // 4) Mapeia cada comp_codigo do BOM → ID Omie do filho (id_prod_malha)
    //    Usamos a MESMA COALESCE da view p/ a chave, garantindo match 1:1.
    const mapRes = await client.query(`
      SELECT
        COALESCE(i.cod_prod_malha, (i.id_prod_malha)::text, i.int_prod_malha) AS comp_key,
        (i.id_prod_malha)::text AS prod_id_str
      FROM public.omie_estrutura_item i
      JOIN public.omie_estrutura    e ON e.id = i.parent_id
      WHERE e.cod_produto = $1
    `, [pai]);

    const compToId = new Map();
    for (const r of mapRes.rows) {
      const k = String(r.comp_key || '').trim();
      const v = String(r.prod_id_str || '').trim();
      if (k) compToId.set(k, v);
    }

    // 5) Busca no Kanban (view) a contagem de cartões por ID de produto (filho) nas colunas 10/20
    //    Filtra somente os IDs presentes na estrutura do PAI, para eficiência.
    const childIds = Array.from(new Set(
      rows.map(r => compToId.get(String(r.comp_codigo || '').trim()))
          .filter(Boolean)
    ));

// soma de OPs do FILHO em "A Produzir + Produzindo"
// No seu banco: 10 = A Produzir, 40 = Produzindo (confirmado em SQL).
let totalsById = new Map();
if (childIds.length) {
  const qOps = await client.query(`
    SELECT
      produto_codigo::text AS prod_id_str,
      COUNT(*)::numeric(18,6) AS total
    FROM public.op_info
    WHERE c_etapa IN ('10','40')            -- 10=A Produzir, 40=Produzindo
      AND produto_codigo::text = ANY($1::text[])
    GROUP BY produto_codigo::text
  `, [childIds]);

  totalsById = new Map(
    qOps.rows.map(r => [String(r.prod_id_str).trim(), Number(r.total) || 0])
  );
  origem += '+op_info(10,40)'; // marca a fonte na resposta
}


    // 6) Monta payload final — inclui "qtd_prod" (contagem por FILHO)
    const dados = rows.map(r => {
      const comp_codigo = String(r?.comp_codigo || '').trim();
      const prodId      = compToId.get(comp_codigo) || ''; // id Omie do filho
      const qtd_prod    = totalsById.get(prodId) || 0;

      return {
        comp_codigo,
        comp_descricao : r?.comp_descricao ?? null,
        comp_qtd       : Number(r?.comp_qtd ?? 0),
        comp_unid      : r?.comp_unid ?? null,
        comp_operacao  : r?.comp_operacao ?? null,
        comp_perda_pct : 0,
        qtd_prod
      };
    });

    res.setHeader('X-From', origem || 'desconhecido');
    return res.json({ ok:true, origem: origem || 'desconhecido', dados });
  } catch (err) {
    console.error('[pcp/estrutura] erro:', err);
    return res.status(500).json({ ok:false, error:String(err?.message || err) });
  } finally {
    client.release();
  }
}



router.get('/estrutura', handleEstruturaSQL);
router.post('/estrutura', express.json({ limit: '1mb' }), handleEstruturaSQL);

function escapeLikePattern(term) {
  return String(term ?? '').replace(/[%_\\]/g, '\\$&');
}

router.post('/estrutura/busca', express.json({ limit: '512kb' }), async (req, res) => {
  const raw = String(req.body?.q ?? '').trim();
  if (raw.length < 2) return res.json({ ok:true, itens: [] });

  const tokens = raw.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!tokens.length) return res.json({ ok:true, itens: [] });

  const params = [];
  const clauses = tokens.map((tok) => {
    const escaped = `%${escapeLikePattern(tok)}%`;
    params.push(escaped);
    return `(e.cod_produto ILIKE $${params.length} ESCAPE '\\' OR e.descr_produto ILIKE $${params.length} ESCAPE '\\')`;
  });

  const fullMatchParamIndex = params.length + 1;
  params.push(`%${escapeLikePattern(raw)}%`);

  const sql = `
    SELECT DISTINCT ON (e.cod_produto)
           e.cod_produto   AS codigo,
           e.descr_produto AS descricao
    FROM public.omie_estrutura e
    WHERE ${clauses.join(' AND ')}
    ORDER BY
      e.cod_produto,
      CASE WHEN e.cod_produto ILIKE $${fullMatchParamIndex} ESCAPE '\\' THEN 0 ELSE 1 END,
      CASE WHEN e.descr_produto ILIKE $${fullMatchParamIndex} ESCAPE '\\' THEN 0 ELSE 1 END,
      e.descr_produto
    LIMIT 80;
  `;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, params);
    return res.json({ ok:true, itens: rows });
  } catch (err) {
    console.error('[pcp][estrutura][busca] erro:', err);
    return res.status(500).json({ ok:false, error: 'Falha ao buscar produtos.' });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REPLACE da Estrutura de produto
// - Rota: POST /estrutura/replace
// - Payload aceito:
//    { pai_codigo: "FTI...", itens: [{comp_codigo, comp_descricao, comp_qtd, comp_unid, comp_operacao}, ...] }
//    ou
//    { pai_codigo: "FTI...", bom: [ { "Identificação do Produto": "...", "Descrição do Produto": "...", "Operação": "...", "Qtde Prevista": "1", "Unidade": "PC", ... }, ... ] }
// - Estratégia: limpa itens antigos do pai e insere nova lista
// - Agregação: SOMA somente quando (comp_codigo **e** comp_operacao) coincidirem
// ─────────────────────────────────────────────────────────────────────────────
router.post('/estrutura/replace', express.json({ limit: '8mb' }), async (req, res) => {
  // ── helpers locais (escopo da rota p/ evitar conflitos de nome) ───────────
  const parseNumber = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/\./g, '').replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const normKey = (s) => String(s ?? '')
    .replace(/^\uFEFF/, '')            // remove BOM
    .normalize('NFKD')                 // separa diacríticos
    .replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const pick = (obj, candidates) => {
    const map = new Map(Object.keys(obj).map(k => [normKey(k), k]));
    for (const c of candidates) {
      const nk = normKey(c);
      if (map.has(nk)) return obj[map.get(nk)];
    }
    // heurística p/ Operação quando cabeçalho vier corrompido
    for (const [nk, orig] of map) {
      if (nk.includes('operac')) return obj[orig];
    }
    return undefined;
  };

  const mapFromBOMRows = (bomRows = []) => {
    if (!Array.isArray(bomRows)) return [];
    return bomRows.map(r => {
      const comp_descricao = String(pick(r, [
        'Identificação do Produto', 'Identificacao do Produto', 'Identificação', 'Identificacao'
      ]) ?? '').trim();

      const comp_codigo = String(pick(r, [
        'Descrição do Produto', 'Descricao do Produto', 'Código', 'Codigo', 'Produto'
      ]) ?? '').trim();

      const comp_qtd = parseNumber(pick(r, ['Qtde Prevista', 'Qtde', 'Quantidade'])) ?? 0;

      const comp_unid = String(pick(r, ['Unidade', 'Und', 'Un']) ?? '').trim() || null;

      const comp_operacao = String(pick(r, [
        'Operação', 'Operacao', 'Operaçao', 'OperaÃ§Ã£o', 'Operação', 'Operações', 'Operacoes'
      ]) ?? '').trim() || null;

      return { comp_codigo, comp_descricao, comp_qtd, comp_unid, comp_operacao };
    }).filter(x => x.comp_codigo);
  };

  const mapFromItens = (itens = []) => {
    if (!Array.isArray(itens)) return [];
    return itens.map(r => ({
      comp_codigo:    String(r?.comp_codigo ?? '').trim(),
      comp_descricao: String(r?.comp_descricao ?? '').trim() || null,
      comp_qtd:       parseNumber(r?.comp_qtd) ?? 0,
      comp_unid:      String(r?.comp_unid ?? '').trim() || null,
      comp_operacao:  String(r?.comp_operacao ?? '').trim() || null,
    })).filter(x => x.comp_codigo);
  };

  // ── extração do pai ────────────────────────────────────────────────────────
  const b = req.body || {};
  const pai = String(b.pai_codigo || b.codigo || b.pai_cod_produto || '').trim();

  if (!pai) {
    return res.status(400).json({ ok: false, error: 'Informe pai_codigo.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 0) Diagnóstico de ambiente (db/schema/coluna)
    try {
      const dbg = await client.query(`
        SELECT current_database() AS db,
               current_schema()   AS schema,
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name   = 'omie_estrutura_item'
                   AND column_name  = 'operacao'
               ) AS has_operacao
      `);
      console.log('[Estrutura][REPLACE][DB]', dbg.rows[0]);
    } catch {}

    // 1) Garante o cabeçalho (pai) na public.omie_estrutura
    let parentId = null;
    const qSel = await client.query(
      `SELECT id FROM public.omie_estrutura WHERE cod_produto = $1 LIMIT 1`, [pai]
    );
    if (qSel.rowCount) {
      parentId = qSel.rows[0].id;
    } else {
      const qIns = await client.query(
        `INSERT INTO public.omie_estrutura (cod_produto, descr_produto, unid_produto, origem)
         VALUES ($1, NULL, NULL, 'local')
         RETURNING id`, [pai]
      );
      parentId = qIns.rows[0].id;
    }

    // 2) Normaliza itens vindo de BOM ou itens diretos
    let rows = [];
    if (Array.isArray(b.itens) && b.itens.length) {
      rows = mapFromItens(b.itens);
    } else if (Array.isArray(b.bom) && b.bom.length) {
      rows = mapFromBOMRows(b.bom);
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok:false, error:'Informe "itens" ou "bom" com linhas.' });
    }

    // 3) Agregação por CHAVE (código + operação) — NÃO mistura operações diferentes
    const byKey = new Map();
    const makeKey = (r) => `${(r.comp_codigo||'').trim()}||${(r.comp_operacao||'').trim()}`;

    for (const r of rows) {
      const comp_codigo    = (r.comp_codigo ?? '').toString().trim();
      if (!comp_codigo) continue;

      const comp_descricao = (r.comp_descricao ?? '').toString().trim() || null;
      const comp_unid      = (r.comp_unid ?? null) || null;
      const comp_qtd       = Number(r.comp_qtd ?? 0) || 0;
      const comp_operacao  = (r.comp_operacao ?? '').toString().trim() || null;

      const key = makeKey({ comp_codigo, comp_operacao });
      if (byKey.has(key)) {
        const acc = byKey.get(key);
        acc.comp_qtd = (acc.comp_qtd ?? 0) + comp_qtd; // soma só quando operação coincide
        if (!acc.comp_descricao && comp_descricao) acc.comp_descricao = comp_descricao;
        if (!acc.comp_unid      && comp_unid)      acc.comp_unid      = comp_unid;
      } else {
        byKey.set(key, { comp_codigo, comp_descricao, comp_unid, comp_qtd, comp_operacao });
      }
    }

    rows = Array.from(byKey.values());
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok:false, error:'Nenhuma linha válida após saneamento.' });
    }

    // 4) Snapshot da versão atual + limpa itens antigos (sempre no schema public)
    //
    // Regras:
    //  - Descobre a versão atual (sem incrementar ainda).
    //  - Copia TODOS os itens atuais para a tabela de versões com (versao = atual, modificador).
    //  - Só depois apaga os itens antigos.
    //  - Atualiza cabeçalho (versao/modificador).
    //
    // Observação: 'modificador' vem do header 'x-user' enviado pelo front.
    //             Se não vier, caímos para 'sistema'.

    // 4.1) Descobre a versão atual (com lock na linha do pai)
    const { rows: verRows } = await client.query(
      `SELECT COALESCE(versao,1) AS versao
         FROM public.omie_estrutura
        WHERE id = $1
        FOR UPDATE`,
      [parentId]
    );
    const versaoAtual = Number(verRows?.[0]?.versao || 1);

    // 4.2) Quem está modificando?
    const modificador =
      (req.headers['x-user'] && String(req.headers['x-user']).trim()) ||
      'sistema';

    // 4.3) Snapshot: copia estado ATUAL dos itens para a tabela de versões
    await client.query(
      `
      INSERT INTO public.omie_estrutura_item_versao
      SELECT t.*, $2::int AS versao, $3::text AS modificador, now() as snapshot_at
        FROM public.omie_estrutura_item t
       WHERE t.parent_id = $1
      `,
      [parentId, versaoAtual, modificador]
    );

    // 4.4) Agora sim, limpa os itens antigos do pai
    const delRes = await client.query(
      `DELETE FROM public.omie_estrutura_item WHERE parent_id = $1`,
      [parentId]
    );
    const hadPrevious = Number(delRes.rowCount || 0) > 0;

    // 4.5) Atualiza a versão/modificador no cabeçalho (omie_estrutura)
    //      - se já havia itens, incrementa; se é a 1ª carga, mantém 1
    if (hadPrevious) {
      await client.query(
        `UPDATE public.omie_estrutura
            SET versao = COALESCE(versao, 1) + 1,
                modificador = $2,
                updated_at = now()
          WHERE id = $1`,
        [parentId, modificador]
      );
    } else {
      // 1ª carga: mantém versao = 1, mas já registra o modificador
      await client.query(
        `UPDATE public.omie_estrutura
            SET versao = COALESCE(versao, 1),
                modificador = $2,
                updated_at = now()
          WHERE id = $1`,
        [parentId, modificador]
      );
    }

    // 5) INSERT em lote incluindo a coluna 'operacao'
    const cols   = ['parent_id','cod_prod_malha','descr_prod_malha','quant_prod_malha','unid_prod_malha','operacao'];
    const tuples = [];
    const values = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const base = values.length;
      tuples.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6})`);
      values.push(
        parentId,
        r.comp_codigo,
        r.comp_descricao,
        r.comp_qtd,
        r.comp_unid,
        r.comp_operacao || null
      );
    }
    const sqlIns = `INSERT INTO public.omie_estrutura_item (${cols.join(',')}) VALUES ${tuples.join(',')}`;
    await client.query(sqlIns, values);

    await client.query('COMMIT');

    // resposta com um sumário por operação (útil para debug/UX)
    const porOper = {};
    for (const r of rows) {
      const k = (r.comp_operacao || 'SEM OPERAÇÃO');
      porOper[k] = (porOper[k] || 0) + 1;
    }

    return res.json({
      ok: true,
      pai,
      parent_id: parentId,
      total_itens: rows.length,
      por_operacao: porOper
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[Estrutura][REPLACE][SQL][ERR]', err);
    return res.status(500).json({ ok:false, error:'Falha ao substituir estrutura.', detail: err.message });
  } finally {
    client.release();
  }
});


module.exports = router;
