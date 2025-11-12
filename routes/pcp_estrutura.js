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

// Atualiza a coluna "local_produção" em public.omie_estrutura a partir do id_produto (Código OMIE)
// Body: { id_produto: number|string, local_producao: string|null }
router.post('/estrutura/localproducao', async (req, res) => {
  try {
    const rawId = req.body?.id_produto;
    const rawVal = req.body?.local_producao ?? req.body?.local_produção; // aceita ambos

    // valida id_produto (6-14 dígitos geralmente, mas aceitamos númerico genérico)
    const id = rawId == null ? null : Number(String(rawId).trim());
    if (!id || !Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'id_produto inválido.' });
    }

    const val = (rawVal == null || String(rawVal).trim() === '')
      ? null
      : String(rawVal).trim();

    const q = `
      UPDATE public.omie_estrutura
         SET "local_produção" = $2,
             updated_at = now()
       WHERE id_produto = $1
       RETURNING id, id_produto, "local_produção"`;
    const { rows } = await pool.query(q, [id, val]);

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado para id_produto informado.' });
    }

    return res.json({ ok: true, registro: rows[0] });
  } catch (err) {
    console.error('[POST /api/pcp/estrutura/localproducao] ERRO:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar local de produção.', detail: err.message });
  }
});

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

  // Parâmetros opcionais para contexto de OP
  const b = req.body || {};
  const q = req.query || {};
  const versaoReq = String(b.versao || q.versao || '').trim();
  const opRef     = String(b.op || b.numero_referencia || q.op || q.numero_referencia || '').trim();

  console.log('[PCP][Estrutura] pai:', pai, 'versao:', versaoReq, 'op:', opRef);

  const client = await pool.connect();
  try {
    let origem = '';
    let rows = [];

    // 0) Se vier 'versao', tenta snapshot da tabela de versões primeiro
    if (versaoReq) {
      try {
        const { rows: vers } = await client.query(
          `
          SELECT
            i.cod_prod_malha                  AS comp_codigo,
            i.descr_prod_malha                AS comp_descricao,
            i.quant_prod_malha::numeric(18,6) AS comp_qtd,
            i.unid_prod_malha                 AS comp_unid,
            i.operacao                        AS comp_operacao
          FROM public.omie_estrutura_item_versao i
          JOIN public.omie_estrutura          e ON e.id = i.parent_id
          WHERE e.cod_produto = $1 AND i.versao = $2::int
          ORDER BY i.descr_prod_malha NULLS LAST, i.cod_prod_malha
          `,
          [pai, versaoReq]
        );
        if (vers?.length) {
          rows = vers;
          origem = `versao_${versaoReq}`;
        }
      } catch {}
    }

    // 1) VIEW v2 (se existir) - apenas se não carregou da versão
    if (!rows.length) {
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
    }

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


    // 5.5) Se houver uma personalização (op/numero_referencia), aplica substituições
    //      pcp_personalizacao_item: troca comp_codigo original -> trocado
    let trocadosSet = new Set(); // inicializa fora do if para estar disponível no escopo
    let trocasMap = new Map(); // Mapa de trocado -> {original, descOriginal, descTrocada}
    if (opRef) {
      console.log('[PCP][Estrutura] Buscando personalização para op:', opRef);
      try {
        const pr = await client.query(
          `SELECT id FROM public.pcp_personalizacao WHERE numero_referencia = $1 ORDER BY id DESC LIMIT 1`,
          [opRef]
        );
        const pid = pr?.rows?.[0]?.id || null;
        console.log('[PCP][Estrutura] personalizacao_id encontrado:', pid);
        if (pid) {
          const it = await client.query(
            `SELECT codigo_original, codigo_trocado, descricao_original, descricao_trocada 
             FROM public.pcp_personalizacao_item WHERE personalizacao_id = $1`,
            [pid]
          );
          console.log('[PCP][Estrutura] trocas encontradas:', it?.rows?.length || 0);
          if (it?.rows?.length) {
            const replMap = new Map();
            for (const r of it.rows) {
              const orig = String(r.codigo_original || '').trim();
              const novo = String(r.codigo_trocado  || '').trim();
              if (orig && novo) { 
                replMap.set(orig, novo); 
                trocadosSet.add(novo); // adiciona ao Set do escopo externo
                trocasMap.set(novo, {
                  original: orig,
                  descOriginal: String(r.descricao_original || '').trim(),
                  descTrocada: String(r.descricao_trocada || '').trim()
                });
                console.log('[PCP][Estrutura] Troca:', orig, '→', novo);
              }
            }
            if (replMap.size) {
              console.log('[PCP][Estrutura] Aplicando', replMap.size, 'trocas em', rows.length, 'itens');
              // aplica troca de código
              rows = rows.map(r => {
                const cc = String(r?.comp_codigo || '').trim();
                if (replMap.has(cc)) {
                  console.log('[PCP][Estrutura] Substituindo item:', cc, '→', replMap.get(cc));
                  return { ...r, comp_codigo: replMap.get(cc) };
                }
                return r;
              });

              // opcional: tentar ajustar descrição dos códigos trocados
              try {
                const list = Array.from(trocadosSet);
                if (list.length) {
                  const { rows: descRows } = await client.query(
                    `
                    WITH want AS (SELECT UNNEST($1::text[]) AS c)
                    SELECT
                      w.c AS codigo,
                      COALESCE(v.descricao, p.descricao) AS descricao
                    FROM want w
                    LEFT JOIN public.vw_lista_produtos v ON v.codigo = w.c
                    LEFT JOIN public.produtos         p ON p.codigo = w.c
                    `,
                    [list]
                  );
                  const descMap = new Map(descRows.map(r => [String(r.codigo || '').trim(), String(r.descricao || '').trim()]));
                  rows = rows.map(r => {
                    const cc = String(r?.comp_codigo || '').trim();
                    const nd = descMap.get(cc);
                    if (nd) return { ...r, comp_descricao: nd };
                    return r;
                  });
                  origem += '+personalizacao';
                }
              } catch {}
            }
          }
        }
      } catch (e) {
        console.error('[PCP][Estrutura] Erro ao aplicar personalização:', e);
        // falha ao aplicar personalização não deve derrubar a resposta base
      }
    }

    // 6) Monta payload final — inclui "qtd_prod" (contagem por FILHO) + "id_produto" (Código OMIE do filho)
    // Adiciona _trocado: true nos itens trocados
    const dados = rows.map(r => {
      const comp_codigo = String(r?.comp_codigo || '').trim();
      const prodId      = compToId.get(comp_codigo) || ''; // id Omie do filho
      const qtd_prod    = totalsById.get(prodId) || 0;
      const obj = {
        comp_codigo,
        comp_descricao : r?.comp_descricao ?? null,
        comp_qtd       : Number(r?.comp_qtd ?? 0),
        comp_unid      : r?.comp_unid ?? null,
        comp_operacao  : r?.comp_operacao ?? null,
        comp_perda_pct : 0,
        id_produto     : prodId || null,  // Código OMIE do filho (usado para lookups)
        qtd_prod
      };
      // Marca itens trocados com _trocado: true
      if (trocadosSet && trocadosSet.size > 0 && trocadosSet.has(comp_codigo)) {
        obj._trocado = true;
        const trocaInfo = trocasMap.get(comp_codigo);
        if (trocaInfo) {
          obj._codigo_original = trocaInfo.original;
          obj._descricao_original = trocaInfo.descOriginal;
        }
        console.log('[PCP][Estrutura] Marcando item como trocado:', comp_codigo);
      }
      return obj;
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
// Calendário de OPs: retorna códigos agrupados por dia (criação e impressão)
router.get('/calendario', async (req, res) => {
  const ano  = parseInt(req.query.ano, 10);
  const mes0 = parseInt(req.query.mes, 10); // 1-12
  if (!Number.isInteger(ano) || !Number.isInteger(mes0) || mes0 < 1 || mes0 > 12) {
    return res.status(400).json({ ok:false, error:'Parâmetros ano/mes inválidos.' });
  }
  const mes = mes0; // legível
  const localReq = String(req.query.local || '').trim(); // filtro opcional (case-insensitive)

  // intervalo: [primeiro dia do mês, primeiro dia do mês seguinte)
  const inicio = new Date(Date.UTC(ano, mes-1, 1, 0,0,0));
  const prox   = new Date(Date.UTC(ano, mes, 1, 0,0,0));

  let sql = `
    SELECT codigo_produto,
           codigo_produto_id,
           numero_op,
           etapa,
           date_trunc('day', data_impressao) AS dia_impressao,
           local_impressao
      FROM "OrdemProducao".tab_op
     WHERE data_impressao >= $1 AND data_impressao < $2
  `;

  const params = [inicio.toISOString(), prox.toISOString()];
  if (localReq) {
    sql += ` AND lower(local_impressao) = lower($3)`;
    params.push(localReq);
  }

  const client = await pool.connect();
  try {
  const { rows } = await client.query(sql, params);
    const byDay = {}; // { dia: { locais: [{nome, status}], porLocal: { lower: { display, codigos:Set, status } } } }
    const canonMap = new Map(); // lower(local) -> display original (primeiro visto)

    const aggStatus = (cur, etapa) => {
      const e = String(etapa || '').toLowerCase();
      // prioridade: excluido > produzindo > produzido
      if (e.includes('exclu')) return 'excluido';
      if (e.includes('produz') && !e.includes('produzid')) return cur === 'excluido' ? 'excluido' : 'produzindo';
      if (e.includes('produzid')) return cur || 'produzido';
      return cur || null;
    };

    for (const r of rows) {
      if (!r.dia_impressao) continue;
      const cod = r.codigo_produto || '';
      const localRaw = String(r.local_impressao || '').trim();
      const localLower = localRaw.toLowerCase();
      if (localRaw) {
        if (!canonMap.has(localLower)) canonMap.set(localLower, localRaw); // preserva primeira variação
      }
      const diaKey = r.dia_impressao.toISOString().slice(0,10);
      const entry = byDay[diaKey] || { locais: [], porLocal: {} };
      if (localRaw) {
        if (!entry.porLocal[localLower]) entry.porLocal[localLower] = { display: localRaw, codigos: new Set(), status: null };
        entry.porLocal[localLower].codigos.add(cod);
        entry.porLocal[localLower].status = aggStatus(entry.porLocal[localLower].status, r.etapa);
      }
      byDay[diaKey] = entry;
    }

    // preencher array locais por dia e lista global de locais (case-insensitive)
    const globalLocaisSet = new Set();
    Object.values(byDay).forEach(d => {
      const locaisArr = Object.entries(d.porLocal).map(([ll,obj]) => ({
        nome: canonMap.get(ll) || obj.display,
        status: obj.status || null
      }));
      d.locais = locaisArr.sort((a,b)=>a.nome.localeCompare(b.nome));
      locaisArr.forEach(l => globalLocaisSet.add(l.nome.toLowerCase()));
      // converte sets para arrays para clientes que usem porLocal
      Object.values(d.porLocal).forEach(o => { o.codigos = Array.from(o.codigos); });
    });

    const locais = Array.from(globalLocaisSet).map(ll => canonMap.get(ll) || ll).filter(Boolean).sort((a,b)=>a.localeCompare(b));

    // Consulta itens sem data_impressao
    let sqlSem = `
      SELECT local_impressao, etapa
        FROM "OrdemProducao".tab_op
       WHERE data_impressao IS NULL
         AND local_impressao IS NOT NULL
    `;
    const paramsSem = [];
    if (localReq) { sqlSem += ' AND lower(local_impressao) = lower($1)'; paramsSem.push(localReq); }
    const { rows: rowsSem } = await client.query(sqlSem, paramsSem);
    const semDataMap = new Map(); // lower(local) -> { display, count, status }
    const aggStatus2 = (cur, etapa) => {
      const e = String(etapa || '').toLowerCase();
      if (e.includes('exclu')) return 'excluido';
      if (e.includes('aguard')) return cur === 'excluido' ? 'excluido' : 'aguardando';
      if (e.includes('produz') && !e.includes('produzid')) return cur && cur !== 'excluido' ? cur : 'produzindo';
      if (e.includes('produzid')) return cur || 'produzido';
      return cur || null;
    };
    for (const r of rowsSem) {
      const locRaw = String(r.local_impressao || '').trim();
      if (!locRaw) continue;
      const ll = locRaw.toLowerCase();
      const obj = semDataMap.get(ll) || { display: locRaw, count: 0, status: null };
      obj.count += 1;
      obj.status = aggStatus2(obj.status, r.etapa);
      semDataMap.set(ll, obj);
    }
    const semData = {
      locais: Array.from(semDataMap.entries()).map(([ll,o])=>({ nome: canonMap.get(ll) || o.display, status: o.status || 'aguardando', count: o.count }))
                  .sort((a,b)=>a.nome.localeCompare(b.nome))
    };

    return res.json({ ok:true, ano, mes, dias: byDay, locais, semData });
  } catch (err) {
    console.error('[pcp][calendario] erro:', err);
    return res.status(500).json({ ok:false, error:'Falha ao gerar calendário.' });
  } finally {
    client.release();
  }
});

// Detalhes de um dia específico: produtos, descrição, ops e status
router.get('/calendario/dia', async (req, res) => {
  const dataStr = String(req.query.data || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
    return res.status(400).json({ ok:false, error:'Parâmetro data inválido (YYYY-MM-DD).' });
  }
  const localReq = String(req.query.local || '').trim();
  const inicio = new Date(dataStr + 'T00:00:00Z');
  const fim    = new Date(dataStr + 'T00:00:00Z');
  fim.setUTCDate(fim.getUTCDate()+1);

  let sql = `
    SELECT op.codigo_produto,
           op.codigo_produto_id,
           op.numero_op,
           op.etapa,
           op.local_impressao,
           po.descricao
      FROM "OrdemProducao".tab_op op
      LEFT JOIN public.produtos_omie po ON po.codigo_produto = op.codigo_produto_id
     WHERE op.data_impressao >= $1 AND op.data_impressao < $2
  `;
  const params = [inicio.toISOString(), fim.toISOString()];
  if (localReq) { sql += ' AND lower(op.local_impressao) = lower($3)'; params.push(localReq); }
  sql += ' ORDER BY op.local_impressao, op.codigo_produto, op.numero_op';

  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, params);
    // Agrupar por (local, codigo_produto) para não misturar produtos em locais diferentes
    const porLocalProduto = new Map(); // key: `${loc}||${cod}`
    for (const r of rows) {
      const cod = r.codigo_produto || '';
      const desc = r.descricao || '';
      const loc  = r.local_impressao || '';
      const etapa = String(r.etapa || '').toLowerCase();
      let status = null;
      if (etapa.includes('exclu')) status = 'excluido';
      else if (etapa.includes('produz') && !etapa.includes('produzid')) status = 'produzindo';
      else if (etapa.includes('produzid')) status = 'produzido';

      const key = `${loc}||${cod}`;
      const obj = porLocalProduto.get(key) || { codigo_produto: cod, descricao: desc, local: loc, status: null, ops: [] };
      if (!obj.ops.includes(r.numero_op)) obj.ops.push(r.numero_op);
      // prioridade de status: excluido > produzindo > produzido
      const cur = obj.status;
      if (status === 'excluido' || (status === 'produzindo' && cur !== 'excluido') || (status === 'produzido' && !cur)) {
        obj.status = status;
      }
      porLocalProduto.set(key, obj);
    }
    return res.json({ ok:true, data: dataStr, itens: Array.from(porLocalProduto.values()) });
  } catch (err) {
    console.error('[pcp][calendario][dia] erro:', err);
    return res.status(500).json({ ok:false, error:'Falha ao obter detalhes do dia.' });
  } finally {
    client.release();
  }
});

function escapeLikePattern(term) {
  return String(term ?? '').replace(/[%_\\]/g, '\\$&');
}

router.post('/estrutura/busca', express.json({ limit: '512kb' }), async (req, res) => {
  const raw = String(req.body?.q ?? '').trim();
  if (raw.length < 2) return res.json({ ok: true, itens: [] });

  // Busca deve vir de public.produtos_omie (colunas: codigo, descricao)
  const tokens = raw.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!tokens.length) return res.json({ ok: true, itens: [] });

  const params = [];
  const clauses = tokens.map((tok) => {
    const likeTok = `%${escapeLikePattern(tok)}%`;
    params.push(likeTok);
    return `(p.codigo ILIKE $${params.length} ESCAPE '\\' OR p.descricao ILIKE $${params.length} ESCAPE '\\')`;
  });

  // Parâmetros extras para rankear prefixos e conteúdo do termo completo
  const containsParamIndex = params.length + 1; // %raw%
  const prefixParamIndex   = params.length + 2; // raw%
  params.push(`%${escapeLikePattern(raw)}%`);
  params.push(`${escapeLikePattern(raw)}%`);

  const sql = `
    SELECT DISTINCT ON (p.codigo)
           p.codigo,
           p.descricao
    FROM public.produtos_omie p
    WHERE ${clauses.join(' AND ')}
    ORDER BY
      p.codigo,
      CASE WHEN p.codigo   ILIKE $${prefixParamIndex}   ESCAPE '\\' THEN 0 ELSE 1 END,
      CASE WHEN p.codigo   ILIKE $${containsParamIndex} ESCAPE '\\' THEN 0 ELSE 1 END,
      CASE WHEN p.descricao ILIKE $${containsParamIndex} ESCAPE '\\' THEN 0 ELSE 1 END,
      p.descricao
    LIMIT 120;
  `;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, params);
    return res.json({ ok: true, itens: rows });
  } catch (err) {
    console.error('[pcp][estrutura][busca] erro:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao buscar produtos.' });
  } finally {
    client.release();
  }
});

// Lista unidades de medida distintas usadas em produtos_omie
router.get('/unidades', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT DISTINCT TRIM(UPPER(unidade)) AS unidade
         FROM public.produtos_omie
        WHERE unidade IS NOT NULL AND TRIM(unidade) <> ''
        ORDER BY 1`
    );
    const unidades = rows.map(r => r.unidade).filter(Boolean);
    return res.json({ ok: true, unidades });
  } catch (err) {
    console.error('[pcp][unidades] erro:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao listar unidades.' });
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

// ─────────────────────────────────────────────────────────────────────────────
// Atualizar OP com nova estrutura customizada
// POST /api/pcp/atualizar-op
// Body: { numero_referencia, codigo_produto, versao, itens: [{codigo, descricao, trocado}] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/atualizar-op', express.json({ limit: '2mb' }), async (req, res) => {
  const { numero_referencia, codigo_produto, versao, itens } = req.body;

  if (!numero_referencia || !codigo_produto) {
    return res.status(400).json({ 
      ok: false, 
      error: 'numero_referencia e codigo_produto são obrigatórios.' 
    });
  }

  if (!Array.isArray(itens)) {
    return res.status(400).json({ 
      ok: false, 
      error: 'itens deve ser um array.' 
    });
  }

  console.log('[PCP][Atualizar OP] Recebido:', { numero_referencia, codigo_produto, versao, itens_count: itens.length });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Busca a estrutura original (da versão ou atual)
    let estruturaOriginal = [];
    
    if (versao) {
      // Tenta carregar da versão específica
      const { rows } = await client.query(`
        SELECT 
          i.cod_prod_malha AS codigo
        FROM public.omie_estrutura_item_versao i
        JOIN public.omie_estrutura e ON e.id = i.parent_id
        WHERE e.cod_produto = $1 AND i.versao = $2::int
      `, [codigo_produto, versao]);
      estruturaOriginal = rows.map(r => String(r.codigo || '').trim());
    }
    
    if (estruturaOriginal.length === 0) {
      // Fallback: estrutura atual
      const { rows } = await client.query(`
        SELECT 
          i.cod_prod_malha AS codigo
        FROM public.omie_estrutura_item i
        JOIN public.omie_estrutura e ON e.id = i.parent_id
        WHERE e.cod_produto = $1
      `, [codigo_produto]);
      estruturaOriginal = rows.map(r => String(r.codigo || '').trim());
    }

    console.log('[PCP][Atualizar OP] Estrutura original:', estruturaOriginal);

    // 2) Identifica quais itens foram trocados (não estão na original)
    const itensTrocados = [];
    const itensOriginais = new Set(estruturaOriginal);

    for (const item of itens) {
      const codigo = String(item.codigo || '').trim();
      if (!codigo) continue;
      
      // Se o item não está na estrutura original ou está marcado como trocado
      if (!itensOriginais.has(codigo) || item.trocado === true) {
        // Precisa encontrar qual item original foi substituído
        // Para isso, vamos comparar com a personalização existente
        itensTrocados.push(codigo);
      }
    }

    console.log('[PCP][Atualizar OP] Itens trocados identificados:', itensTrocados);

    // 3) Busca personalização existente para esta OP
    const { rows: persoRows } = await client.query(
      `SELECT id FROM public.pcp_personalizacao WHERE numero_referencia = $1 ORDER BY id DESC LIMIT 1`,
      [numero_referencia]
    );

    let personalizacaoId = persoRows?.[0]?.id || null;

    // 4) Se há itens trocados, precisa atualizar/criar personalização
    if (itensTrocados.length > 0) {
      // Busca as trocas existentes
      let trocasExistentes = new Map();
      if (personalizacaoId) {
        const { rows: itemRows } = await client.query(
          `SELECT codigo_original, codigo_trocado FROM public.pcp_personalizacao_item WHERE personalizacao_id = $1`,
          [personalizacaoId]
        );
        for (const r of itemRows) {
          trocasExistentes.set(String(r.codigo_trocado || '').trim(), String(r.codigo_original || '').trim());
        }
      }

      console.log('[PCP][Atualizar OP] Trocas existentes:', Array.from(trocasExistentes.entries()));

      // Cria personalização se não existir
      if (!personalizacaoId) {
        const { rows: newPerso } = await client.query(
          `INSERT INTO public.pcp_personalizacao (numero_referencia, criado_em) 
           VALUES ($1, NOW()) RETURNING id`,
          [numero_referencia]
        );
        personalizacaoId = newPerso[0].id;
        console.log('[PCP][Atualizar OP] Nova personalização criada:', personalizacaoId);
      }

  // Determina quais trocas devem existir
  const novasTrocas = new Map();
  const adicoesSemOriginal = new Set();
      
      // Para cada item trocado, tenta encontrar o original correspondente
      for (const codigoTrocado of itensTrocados) {
        // Se já existe uma troca registrada, mantém
        if (trocasExistentes.has(codigoTrocado)) {
          novasTrocas.set(codigoTrocado, trocasExistentes.get(codigoTrocado));
        } else {
          // Novo item trocado - precisa descobrir qual original foi substituído
          // Para isso, vamos buscar na estrutura original qual item não está mais presente
          const codigosAtuais = new Set(itens.map(it => String(it.codigo || '').trim()));
          const originaisRemovidos = estruturaOriginal.filter(orig => !codigosAtuais.has(orig));
          
          if (originaisRemovidos.length > 0) {
            // Assume que o primeiro removido foi substituído por este novo
            const codigoOriginal = originaisRemovidos[0];
            novasTrocas.set(codigoTrocado, codigoOriginal);
            console.log('[PCP][Atualizar OP] Nova troca identificada:', codigoOriginal, '→', codigoTrocado);
            
            // Remove da lista para não reutilizar
            const idx = estruturaOriginal.indexOf(codigoOriginal);
            if (idx >= 0) estruturaOriginal.splice(idx, 1);
          } else {
            // Não há removidos suficientes: trata como adição sem original
            adicoesSemOriginal.add(codigoTrocado);
          }
        }
      }

      // Limpa itens existentes e reinsere
      await client.query(
        `DELETE FROM public.pcp_personalizacao_item WHERE personalizacao_id = $1`,
        [personalizacaoId]
      );

      for (const [trocado, original] of novasTrocas.entries()) {
        // Busca informações do item trocado e original
        const itemAtual = itens.find(it => String(it.codigo || '').trim() === trocado);
        
        let descTrocada = itemAtual?.descricao || null;
        let descOriginal = itemAtual?.descricao_original || null;
        const tipo = itemAtual?.tipo || 'peca';
        const grupo = itemAtual?.grupo || 'pecas';
        const parentCodigo = itemAtual?.parent_codigo || codigo_produto;
        const quantidade = itemAtual?.quantidade || null;
        
        // Se não temos descrição original, busca no banco
        if (!descOriginal) {
          try {
            const { rows: descRows } = await client.query(
              `SELECT COALESCE(v.descricao, p.descricao) AS descricao
               FROM (SELECT $1::text AS c) AS w
               LEFT JOIN public.vw_lista_produtos v ON v.codigo = w.c
               LEFT JOIN public.produtos p ON p.codigo = w.c
               WHERE w.c = $1
               LIMIT 1`,
              [original]
            );
            if (descRows.length > 0) {
              descOriginal = descRows[0].descricao;
            }
          } catch {}
        }
        
        await client.query(
          `INSERT INTO public.pcp_personalizacao_item 
           (personalizacao_id, tipo, grupo, codigo_original, codigo_trocado, 
            descricao_original, descricao_trocada, parent_codigo, quantidade, criado_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [personalizacaoId, tipo, grupo, original, trocado, descOriginal, descTrocada, parentCodigo, quantidade]
        );
      }

      // Insere adições puras (sem original) — codigo_original NULL
      for (const trocado of adicoesSemOriginal) {
        const itemAtual = itens.find(it => String(it.codigo || '').trim() === trocado);
        const descTrocada = itemAtual?.descricao || null;
        const tipo = itemAtual?.tipo || 'peca';
        const grupo = itemAtual?.grupo || 'pecas';
        const parentCodigo = itemAtual?.parent_codigo || codigo_produto;
        const quantidade = itemAtual?.quantidade || null;
        await client.query(
          `INSERT INTO public.pcp_personalizacao_item 
           (personalizacao_id, tipo, grupo, codigo_original, codigo_trocado, 
            descricao_original, descricao_trocada, parent_codigo, quantidade, criado_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [personalizacaoId, tipo, grupo, null, trocado, null, descTrocada, parentCodigo, quantidade]
        );
      }

      console.log('[PCP][Atualizar OP] Personalizações atualizadas:', novasTrocas.size);

    } else {
      // Não há itens trocados - se existir personalização, remove
      if (personalizacaoId) {
        await client.query(
          `DELETE FROM public.pcp_personalizacao_item WHERE personalizacao_id = $1`,
          [personalizacaoId]
        );
        await client.query(
          `DELETE FROM public.pcp_personalizacao WHERE id = $1`,
          [personalizacaoId]
        );
        console.log('[PCP][Atualizar OP] Personalização removida (estrutura voltou ao original)');
      }
    }

    await client.query('COMMIT');

    return res.json({ 
      ok: true, 
      message: 'OP atualizada com sucesso!',
      personalizacao_id: personalizacaoId,
      itens_trocados: itensTrocados.length
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PCP][Atualizar OP] Erro:', err);
    return res.status(500).json({ 
      ok: false, 
      error: 'Falha ao atualizar OP.', 
      detail: err.message 
    });
  } finally {
    client.release();
  }
});


module.exports = router;
