// server.js
// Carrega as variáveis de ambiente definidas em .env
// no topo do intranet/server.js
require('dotenv').config();
const OMIE_WEBHOOK_TOKEN = process.env.OMIE_WEBHOOK_TOKEN || null; // se NULL, não exige token
// Em server.js (topo do arquivo)
// chave: id da etiqueta (p.ex. número da OP), valor: { fileName, printed: boolean }
// local padrão para a UI (pode setar ALMOX_LOCAL_PADRAO no Render)
const ALMOX_LOCAL_PADRAO = process.env.ALMOX_LOCAL_PADRAO || '10408201806';
// ——————————————————————————————
// 1) Imports e configurações iniciais
// ——————————————————————————————
const express       = require('express');
const session       = require('express-session');
const fs  = require('fs');           // todas as funções sync
const fsp = fs.promises;            // parte assíncrona (equivale a fs/promises)
const path          = require('path');
const multer        = require('multer');
const fetch = require('node-fetch');
// logo após os outros requires:
const archiver = require('archiver');
const crypto   = require('crypto');
// (se você usar fetch no Node <18, também faça: const fetch = require('node-fetch');)
const { parse: csvParse }         = require('csv-parse/sync');
const estoquePath = path.join(__dirname, 'data', 'estoque_acabado.json');
const app = express();
// ===== Ingestão inicial de OPs (Omie → Postgres) ============================
const OP_REGS_PER_PAGE = 200; // ajuste fino: 100~500 (Omie aceita até 500)

// ==== SSE (Server-Sent Events) para avisar o front ao vivo ==================
const sseClients = new Set();
// polyfill de fetch (Node < 18)
const safeFetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

app.get('/api/produtos/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // evita buffering em proxies (ex.: Render/Nginx)
  if (res.flushHeaders) res.flushHeaders();

  // dica: instrui reconexão do EventSource em 10s se cair
  res.write('retry: 10000\n');

  // hello inicial
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);

  // heartbeat a cada 15s (comentário SSE não vira onmessage, mas mantém conexão viva)
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 15000);

  const client = { res, heartbeat };
  sseClients.add(client);

  // limpeza completa em fechamento/erro
  const clean = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    try { res.end(); } catch {}
  };
  req.on('close', clean);
  res.on('error', clean);
});

// Conexão Postgres (Render)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // no Render, já vem setado
  ssl: { rejectUnauthorized: false }          // necessário no Render
});

// opcional: log de saúde
pool.query('SELECT 1').then(() => {
  console.log('[pg] conectado');
}).catch(err => {
  console.error('[pg] falha conexão:', err?.message || err);
});

// broadcast
function sseBroadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const { res } of sseClients) {
    try { res.write(line); } catch {/* cliente já caiu */}
  }
}
app.set('sseBroadcast', sseBroadcast);

// ============================================================================


// ─── Config. dinâmica de etiqueta ─────────────────────────
const etqConfigPath = path.join(__dirname, 'csv', 'Configuração_etq_caracteristicas.csv');
const { dbQuery, isDbEnabled } = require('./src/db');   // nosso módulo do Passo 1
const produtosRouter = require('./routes/produtos');
// helper central: só usa DB se houver pool E a requisição não for local
 function shouldUseDb(req) {
   if (process.env.FORCE_DB === '1') return true; // força Postgres mesmo em localhost
   return isDbEnabled && !isLocalRequest(req);
 }

let etqConfig = [];
function loadEtqConfig() {
  if (etqConfig.length) return;              // já carregado
  const raw = fs.readFileSync(etqConfigPath, 'utf8');
  etqConfig = csvParse(raw, { columns: true, skip_empty_lines: true })
               .sort((a, b) => Number(a.Ordem) - Number(b.Ordem)); // mantém ordem
}
loadEtqConfig();
// *DEBUG ────────────────────────────────────────────────
console.log('\n⇢ Cabeçalhos que o csv-parse leu:');
console.table(etqConfig.slice(0, 5));
// Fim *DEBUG ─────────────────────────────────────────────

// Detecta se a requisição é local (localhost/127.0.0.1)
function isLocalRequest(req) {
  const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const host = hostHeader.split(':')[0].toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}



/**
 * Separa as linhas para a coluna E (esquerda) e D (direita)
 * @param {object} cad – produto vindo do Omie
 * @returns {{E:Array, D:Array}}
 */
function separarLinhas(cad) {
// letras até encontrar o 1º dígito ou hífen
const prefixoModelo =
  ((cad.codigo || cad.modelo || '').match(/^[A-Za-z]+/) || [''])[0]
    .toUpperCase();


  return etqConfig.reduce((acc, row) => {
    const modo   = (row.modo     || '').trim().toUpperCase();   // C / E
    const coluna = (row.coluna   || '').trim().toUpperCase();   // E / D
const lista = (row.Prefixos || '')
                .toUpperCase()
                .split(';')
                .filter(Boolean);        // ['FT','FH','FTI', …]

const ehComum    = modo === 'C';
const ehDoModelo = modo === 'E' && lista.includes(prefixoModelo);


    if (ehComum || ehDoModelo) acc[coluna].push(row);
    return acc;
  }, { E: [], D: [] });
}




const { stringify: csvStringify } = require('csv-stringify/sync');
const loginOmie     = require('./routes/login_omie');
const malhaRouter   = require('./routes/malha');
const malhaConsultar= require('./routes/malhaConsultar');
const estoqueRouter = require('./routes/estoque');
const estoqueResumoRouter = require('./routes/estoqueResumo');
const authRouter    = require('./routes/auth');
const etiquetasRouter = require('./routes/etiquetas');   // ⬅️  NOVO
const omieCall      = require('./utils/omieCall');
const bcrypt = require('bcrypt');
const INACTIVE_HASH = '$2b$10$ltPcvabuKvEU6Uj1FBUmi.ME4YjVq/dhGh4Z3PpEyNlphjjXCDkTG';   // ← seu HASH_INATIVO aqui
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const {
  OMIE_APP_KEY,
  OMIE_APP_SECRET,
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  GITHUB_PATH
} = require('./config.server');
const KANBAN_FILE = path.join(__dirname, 'data', 'kanban.json');

const ETAPA_TO_STATUS = {
  '10': 'A Produzir',
  '20': 'Produzindo',
  '30': 'teste 1',
  '40': 'teste final',
  '60': 'concluido'
};
const STATUS_TO_ETAPA = Object.fromEntries(
  Object.entries(ETAPA_TO_STATUS).map(([k,v]) => [v, k])
);


function toOmieDate(d) {
  if (!d) return undefined;
  if (typeof d === 'string' && d.includes('/')) return d; // já dd/mm/aaaa
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return undefined;
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// retry simples para 500 BG
async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      if (!String(e.message).includes('Broken response')) break; // só retry p/ BG intermitente
      await new Promise(r => setTimeout(r, [300, 800, 1500][i] || 1500));
    }
  }
  throw lastErr;
}



// Timeout p/ chamadas OMIE (evita pendurar quando o BG “trava”)
async function omiePost(url, payload, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Omie HTTP ${r.status}${text ? ` – ${text}` : ''}`);
    return JSON.parse(text || '{}');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Omie timeout (${timeoutMs}ms)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}



async function listarOPPagina(pagina, filtros = {}) {
  const payload = {
    call: 'ListarOrdemProducao',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      pagina,
      registros_por_pagina: OP_REGS_PER_PAGE,
      // ✅ datas a Omie aceita — se quiser usar
      ...(filtros.data_de  ? { dDtPrevisaoDe:  toOmieDate(filtros.data_de) }  : {}),
      ...(filtros.data_ate ? { dDtPrevisaoAte: toOmieDate(filtros.data_ate) } : {})
      // 🔴 NÃO enviar codigo_local_estoque — a API não suporta!
    }]
  };

  return withRetry(() =>
    omiePost('https://app.omie.com.br/api/v1/produtos/op/', payload)
  );
}

app.post('/api/preparacao/importar', express.json(), async (req, res) => {
  const { codigo_local_estoque, data_de, data_ate, max_paginas = 999 } = req.body || {};
  const filtros = { codigo_local_estoque, data_de, data_ate };

  if (!isDbEnabled) {
    return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
  }

  try {
    let pagina = 1;
    let totalPaginas = 1;
    let totalRegistros = 0;
    let importados = 0;

    while (pagina <= totalPaginas && pagina <= Number(max_paginas)) {
      const lote = await listarOPPagina(pagina, filtros);
      pagina++;

      totalPaginas   = Number(lote.total_de_paginas || 1);
      totalRegistros = Number(lote.total_de_registros || 0);
      const cadastros = Array.isArray(lote.cadastros) ? lote.cadastros : [];

      for (const op of cadastros) {
        if (filtros.codigo_local_estoque) {
          const cod = op?.identificacao?.codigo_local_estoque;
          if (Number(cod) !== Number(filtros.codigo_local_estoque)) continue;
        }
        await dbQuery('select public.op_upsert_from_payload($1::jsonb)', [op]);
        importados++;
      }
    }

    // backfill de códigos após importar
    let backfill = null;
    try {
      const r = await fetch(`http://localhost:${process.env.PORT || 5001}/api/preparacao/backfill-codigos`, { method: 'POST' });
      backfill = await r.json().catch(() => null);
    } catch (e) {
      console.error('[importar] backfill-codigos falhou:', e);
    }

    return res.json({
      ok: true,
      mode: 'postgres',
      total_registros: totalRegistros,
      importados,
      ...(backfill ? { backfill } : {})
    });

  } catch (err) {
    console.error('[importar OPs] erro:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});


/* lê o MAIOR nº que existir em QUALQUER cartão.local-[]  */
function nextOpFromKanban () {
  try {
    const items = JSON.parse(fs.readFileSync(KANBAN_FILE,'utf8'));   // ← é um array
    const nums  = items
      .flatMap(it => Array.isArray(it.local) ? it.local : [])
      .map(s => {
        const m = String(s).match(/,\s*(\d+)\s*$/);   // “…,21007”
        return m ? Number(m[1]) : NaN;
      })
      .filter(n => !Number.isNaN(n));

    const maior = nums.length ? Math.max(...nums) : 21000;
    return String(maior + 1);           // 21001, 21002, …
  } catch (err) {
    console.error('[nextOpFromKanban]', err);
    return '21001';
  }
}

function lerEstoque() {
  return JSON.parse(fs.readFileSync(estoquePath, 'utf8'));
}
function gravarEstoque(obj) {
  fs.writeFileSync(estoquePath, JSON.stringify(obj, null, 2), 'utf8');
}


// valida o token do OMIE presente na query ?token=...
function chkOmieToken(req, res, next) {
  const token = req.query.token || req.headers['x-omie-token'];
  if (!token || token !== process.env.OMIE_WEBHOOK_TOKEN) {
    return res.status(401).json({ ok:false, error:'unauthorized' });
  }
  next();
}

// recebe 1 ou N OPs e grava via função SQL
async function handleOpWebhook(req, res) {
  try {
    const body = req.body || {};
    const cadastros = Array.isArray(body.cadastros)
      ? body.cadastros
      : (body.identificacao ? [body] : []);

    let recebidos = 0;
    for (const cad of cadastros) {
      await dbQuery('select public.op_upsert_from_payload($1::jsonb)', [cad]); // <<< usa sua função no DB
      recebidos++;
    }
    return res.json({ ok:true, recebidos });
  } catch (e) {
    console.error('[webhooks/omie/op] erro:', e);
    return res.status(500).json({ ok:false, error: e.message || String(e) });
  }
}

// === WEBHOOK: OP da Omie ====================================================
app.post('/webhooks/omie/op', chkOmieToken, express.json(), async (req, res) => {
  const usarDb = shouldUseDb(req);

  try {
    const body = req.body || {};
    let cadastros = [];

    // 1) Se vier no formato "cadastros: [ ... ]"
    if (Array.isArray(body.cadastros)) {
      cadastros = body.cadastros;
    } else {
      // 2) Compat: formato Omie Connect 2.0 (topic/event) ou payload simples
      const ev = body.event || body;

      const ident = ev.identificacao || {
        cCodIntOP: ev.cCodIntOP,
        cNumOP: ev.cNumOP,
        nCodOP: ev.nCodOP,
        nCodProduto: ev.nCodProd ?? ev.nCodProduto,
        codigo_local_estoque: ev.codigo_local_estoque,
        nQtde: ev.nQtde,
        dDtPrevisao: ev.dDtPrevisao
      };

      const inf = ev.infAdicionais || {
        cEtapa: ev.cEtapa,
        dDtInicio: ev.dDtInicio,
        dDtConclusao: ev.dDtConclusao,
        nCodProjeto: ev.nCodProjeto
      };

      const out = ev.outrasInf || {
        cConcluida: ev.cConcluida,
        dAlteracao: ev.dAlteracao,
        dInclusao: ev.dInclusao,
        uAlt: ev.uAlt,
        uInc: ev.uInc
      };

      cadastros = [{ identificacao: ident, infAdicionais: inf, outrasInf: out }];
    }

    let recebidos = 0;

    if (usarDb) {
      for (const op of cadastros) {
        await dbQuery('select public.op_upsert_from_payload($1::jsonb)', [op]);
        recebidos++;
      }

      // dispara o backfill pra garantir "produto" como Código
      let backfill = null;
      try {
        const resp = await fetch(`http://localhost:${process.env.PORT || 5001}/api/preparacao/backfill-codigos`, {
          method: 'POST'
        });
        backfill = await resp.json().catch(() => null);
      } catch (e) {
        console.error('[webhooks/omie/op] backfill-codigos falhou:', e);
      }

      return res.json({ ok: true, recebidos, backfill });
    } else {
      // modo local-json (raro pra webhook): só confirma recebimento
      recebidos = cadastros.length;
      return res.json({ ok: true, recebidos, mode: 'local-json' });
    }
  } catch (e) {
    console.error('[webhooks/omie/op] erro:', e);
    return res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// ——— Webhook de Pedidos de Venda (OMIE Connect 2.0) ———
app.post(['/webhooks/omie/pedidos', '/api/webhooks/omie/pedidos'],
  chkOmieToken,                     // valida ?token=...
  express.json(),
  async (req, res) => {
    const usarDb = true;           // webhook só faz sentido com DB
    const body   = req.body || {};
    const ev     = body.event || body;

    // Campos que podem vir no Connect 2.0:
    const etapa          = String(ev.etapa || ev.cEtapa || '').trim();   // ex.: "80", "20"…
    const idPedido       = ev.idPedido || ev.codigo_pedido || ev.codigoPedido;
    const numeroPedido   = ev.numeroPedido || ev.numero_pedido;

    const ret = { ok:true, updated:0, upserted:false, etapa: etapa || null,
                  idPedido: idPedido || null, numeroPedido: numeroPedido || null };

    try {
      // 1) Atualiza etapa rapidamente (reflexo imediato no Kanban /api/comercial/pedidos/kanban)
      if (usarDb && (idPedido || numeroPedido) && etapa) {
        if (idPedido) {
          const r = await pool.query(
            `UPDATE public.pedidos_venda
               SET etapa = $1, updated_at = now()
             WHERE codigo_pedido = $2`,
            [etapa, idPedido]
          );
          ret.updated += r.rowCount|0;
        }
        if (!ret.updated && numeroPedido) {
          const r = await pool.query(
            `UPDATE public.pedidos_venda
               SET etapa = $1, updated_at = now()
             WHERE numero_pedido = $2`,
            [etapa, String(numeroPedido)]
          );
          ret.updated += r.rowCount|0;
        }
      }

      // 2) Busca o pedido completo na OMIE e faz upsert (cabecalho + itens)
      //    Isso garante que o SQL reflita descontos, valores, itens etc.
      try {
        const param = [];
        if (numeroPedido)       param.push({ numero_pedido: String(numeroPedido) });
        else if (idPedido)      param.push({ codigo_pedido: Number(idPedido) });

        if (param.length) {
          const payload = {
            call: 'ConsultarPedido',
            app_key:    process.env.OMIE_APP_KEY,
            app_secret: process.env.OMIE_APP_SECRET,
            param
          };

          const j = await omiePost('https://app.omie.com.br/api/v1/produtos/pedido/', payload, 20000);
          // normaliza em lista:
          const ped = Array.isArray(j?.pedido_venda_produto)
                        ? j.pedido_venda_produto
                        : (j?.pedido_venda_produto ? [j.pedido_venda_produto] : []);
          if (ped.length) {
            // usa sua função de upsert em lote que já criamos no Postgres:
            //   SELECT public.pedidos_upsert_from_list($1::jsonb)
            await dbQuery('select public.pedidos_upsert_from_list($1::jsonb)', [{ pedido_venda_produto: ped }]);
            ret.upserted = true;
          }
        }
      } catch (e) {
        // Não derruba o webhook se a OMIE estiver indisponível;
        // ao menos a etapa já ficou correta no SQL.
        ret.upsert_error = String(e?.message || e);
      }

      // 3) Notifica a UI (SSE) para recarregar o quadro, se você quiser “ao vivo”
      try { req.app.get('sseBroadcast')?.({ type:'produtos_changed', at: Date.now() }); } catch {}

      return res.json(ret);
    } catch (err) {
      console.error('[webhooks/omie/pedidos] erro:', err);
      return res.status(500).json({ ok:false, error:String(err?.message||err) });
    }
  }
);


// --- Buscar produtos no Postgres (autocomplete do PCP) ---
app.get('/api/produtos/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit ?? '40', 10) || 40, 100);

    if (q.length < 2) {
      return res.status(400).json({ ok: false, error: 'Informe ?q= com pelo menos 2 caracteres' });
    }

    // Busca por código OU pela descrição (case/accent-insensitive)
    // Usa índices: idx_produtos_codigo, idx_produtos_desc_trgm
// SUBSTITUA o SQL dentro de GET /api/produtos/search por isto:
const { rows } = await pool.query(
  `
  WITH m AS (
    SELECT p.codigo, p.descricao, p.tipo, 1 AS prio
      FROM public.produtos p
     WHERE p.codigo ILIKE $1
        OR unaccent(p.descricao) ILIKE unaccent($2)

    UNION ALL

    SELECT v.codigo, v.descricao, NULL::text AS tipo, 2 AS prio
      FROM public.vw_lista_produtos v
     WHERE v.codigo ILIKE $1
        OR unaccent(v.descricao) ILIKE unaccent($2)
  ),
  dedup AS (
    SELECT DISTINCT ON (codigo) codigo, descricao, tipo, prio
      FROM m
     ORDER BY codigo, prio        -- prefere linha da tabela (prio=1) se existir
  )
  SELECT codigo, descricao, tipo
    FROM dedup
   ORDER BY
     (CASE WHEN codigo ILIKE $3 THEN 0 ELSE 1 END),
     codigo
   LIMIT $4
  `,
  [`%${q}%`, `%${q}%`, `${q}%`, limit]
);


    res.json({ ok: true, total: rows.length, data: rows });
  } catch (err) {
    console.error('[GET /api/produtos/search] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// alias com /api para ficar consistente com suas outras rotas
app.post('/api/omie/op',      chkOmieToken, express.json(), handleOpWebhook);

// helper único: usa a MESMA lógica da rota principal
async function alterarEtapaImpl(req, res, etapa) {
  const op = req.params.op;
  const isCodInt = !/^\d+$/.test(op);  // se não for só dígito, trata como cCodIntOP
  const hojeISO = new Date().toISOString().slice(0,10);

  const identificacao = isCodInt ? { cCodIntOP: op } : { nCodOP: Number(op) };
  const infAdicionais = { cEtapa: etapa };
  if (etapa === '20') infAdicionais.dDtInicio    = hojeISO;
  if (etapa === '60') infAdicionais.dDtConclusao = hojeISO;

  const payload = {
    call: 'AlterarOrdemProducao',
    app_key: process.env.OMIE_APP_KEY,
    app_secret: process.env.OMIE_APP_SECRET,
    param: [{ identificacao, infAdicionais }]
  };


      // 🔹 LOGA O PAYLOAD ANTES DE ENVIAR
    console.log('[OMIE payload]', JSON.stringify(payload, null, 2));

  // 1) Omie
  const r = await fetch('https://app.omie.com.br/api/v1/industria/op/', {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!r.ok || j?.faultstring || j?.error) {
    return res.status(400).json({ ok:false, stage: etapa, omie: j });
  }

  // 2) Reflete no Postgres
  const ETAPA_TO_STATUS = { '10':'A Produzir', '20':'Produzindo', '30':'teste 1', '40':'teste final', '60':'concluido' };
  const status = ETAPA_TO_STATUS[etapa] || 'A Produzir';
  try { await dbQuery('select public.mover_op($1,$2)', [op, status]); } catch (e) { console.warn('[mover_op] falhou:', e.message); }

  // 3) Dispara SSE
  req.app.get('notifyProducts')?.();

  return res.json({ ok:true, stage: etapa, mode:'pg', omie: j });
}

app.post('/api/preparacao/op/:op/etapa/:etapa', (req, res) =>
  alterarEtapaImpl(req, res, String(req.params.etapa)));

// === Preparação: INICIAR produção (mover_op + overlay "Produzindo") =========
app.post('/api/preparacao/op/:op/iniciar', async (req, res) => {
  const op = String(req.params.op || '').trim().toUpperCase();
  if (!op) return res.status(400).json({ ok:false, error:'OP inválida' });

  const STATUS_UI   = 'Produzindo';                     // ← chave que a UI usa
  const TRY_TARGETS = ['Produzindo', 'Em produção', '30'];

  const out = { ok:false, op, attempts:[], before:null, after:null, overlay:null, errors:[] };

  try {
    // estado "antes"
    try {
      const b = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view
          WHERE op = $1
          LIMIT 1`, [op]
      );
      out.before = b.rows;
    } catch (e) { out.errors.push('[before] '+(e?.message||e)); }

    // 1) tenta mover na base oficial
    let changed = false;
    let beforeStatus = out.before?.[0]?.status || null;

    for (const tgt of TRY_TARGETS) {
      try {
        await pool.query('SELECT mover_op($1,$2)', [op, tgt]);
        out.attempts.push({ via:'mover_op', target:tgt, ok:true });

        // revalida a view
        const chk = await pool.query(
          `SELECT kanban_coluna FROM public.kanban_preparacao_view WHERE op = $1 LIMIT 1`, [op]
        );
        const now = chk.rows[0]?.kanban_coluna;
        if (now && now !== beforeStatus) { changed = true; break; }
      } catch (e) {
        out.attempts.push({ via:'mover_op', target:tgt, ok:false, err:String(e?.message||e) });
        out.errors.push('[mover_op '+tgt+'] '+(e?.message||e));
      }
    }

    // 2) FORCE overlay = "Produzindo" (mesmo se a view já mudou; é idempotente)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.op_status_overlay (
          op         text PRIMARY KEY,
          status     text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const up = await pool.query(
        `INSERT INTO public.op_status_overlay (op, status, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (op) DO UPDATE
           SET status = EXCLUDED.status,
               updated_at = now()`,
        [op, STATUS_UI]
      );
      out.overlay = { via:'overlay.upsert', rowCount: up.rowCount };
    } catch (e) {
      out.overlay = { via:'overlay.upsert', err:String(e?.message||e) };
      out.errors.push('[overlay] '+(e?.message||e));
    }

    // 3) estado "depois"
    try {
      const a = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view
          WHERE op = $1
          LIMIT 1`, [op]
      );
      out.after = a.rows;
    } catch (e) { out.errors.push('[after] '+(e?.message||e)); }

    out.ok = true;
    return res.json(out);

  } catch (err) {
    out.errors.push(String(err?.message||err));
    return res.status(500).json(out);
  }
});


// GET /api/produtos/codigos?cp=10569202060&cp=10634218771
// (compat: também aceita ?n=...)
app.get('/api/produtos/codigos', async (req, res) => {
  try {
    let cps = req.query.cp ?? req.query.n;
    if (!cps) return res.status(400).json({ ok:false, error:'informe ?cp=...' });

    // aceita "cp=1&cp=2" ou "cp=1,2"
    if (typeof cps === 'string') cps = cps.split(',').map(s => s.trim()).filter(Boolean);
    if (!Array.isArray(cps)) cps = [String(cps)];

    const wanted = [...new Set(cps.map(String))].filter(s => /^\d+$/.test(s));
    if (wanted.length === 0) return res.json({ ok:true, data:{} });

    const q = await pool.query(
      `
      WITH want AS (SELECT UNNEST($1::text[]) AS cp)
      SELECT
        w.cp AS codigo_produto,
        COALESCE(v.codigo, p.codigo)     AS codigo,
        COALESCE(v.descricao, p.descricao) AS descricao
      FROM want w
      LEFT JOIN public.vw_lista_produtos v ON v.codigo_produto::text = w.cp
      LEFT JOIN public.produtos         p ON p.codigo_prod::text     = w.cp
      `,
      [wanted]
    );

    const map = {};
    for (const r of q.rows) {
      map[r.codigo_produto] = { codigo: r.codigo || null, descricao: r.descricao || null };
    }
    return res.json({ ok:true, data: map });
  } catch (err) {
    console.error('[api/produtos/codigos] erro:', err);
    return res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
});


// GET /api/produtos/por-codigo?c=04.PP.N.51005&c=07.MP.N.31400
app.get('/api/produtos/por-codigo', async (req, res) => {
  try {
    let cs = req.query.c;
    if (!cs) return res.status(400).json({ ok:false, error:'informe ?c=...' });

    if (typeof cs === 'string') cs = cs.split(',').map(s => s.trim()).filter(Boolean);
    if (!Array.isArray(cs)) cs = [String(cs)];

    const wanted = [...new Set(cs.map(String))];
    if (wanted.length === 0) return res.json({ ok:true, data:{} });

    const q = await pool.query(
      `
      WITH want AS (SELECT UNNEST($1::text[]) AS c)
      SELECT
        w.c AS codigo,
        COALESCE(v.descricao, p.descricao) AS descricao
      FROM want w
      LEFT JOIN public.vw_lista_produtos v ON v.codigo = w.c
      LEFT JOIN public.produtos         p ON p.codigo = w.c
      `,
      [wanted]
    );

    const map = {};
    for (const r of q.rows) {
      map[r.codigo] = { descricao: r.descricao || null };
    }
    return res.json({ ok:true, data: map });
  } catch (err) {
    console.error('[api/produtos/por-codigo] erro:', err);
    return res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
});

// === Preparação: CONCLUIR produção (Omie + SQL + overlay, sempre 200) ======
app.post('/api/preparacao/op/:op/concluir', async (req, res) => {
  const op = String(req.params.op || '').trim().toUpperCase();
  if (!op) return res.status(400).json({ ok:false, error:'OP inválida' });

  // chaves de status aceitas pela sua base/view
  const STATUS_UI      = 'concluido';
  const TRY_TARGETS    = ['concluido', 'Concluído', '60', '80'];

  // datas
  const pad2 = n => String(n).padStart(2,'0');
  const fmtDDMMYYYY = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
  const parseData = (s) => {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d,m,y]=s.split('/').map(Number); return new Date(y,m-1,d); }
    return null;
  };

  const qtd = Math.max(1, Number(req.body?.quantidade ?? req.body?.nQtdeProduzida ?? 1));
  const dt  = parseData(req.body?.data || req.body?.dDtConclusao) || new Date();
  const dDtConclusao = fmtDDMMYYYY(dt);

  const out = { ok:false, op, omie:{}, attempts:[], overlay:null, before:null, after:null, errors:[] };

  try {
    // estado ANTES
    try {
      const b = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view WHERE op = $1 LIMIT 1`, [op]);
      out.before = b.rows;
    } catch (e) { out.errors.push('[before] '+(e?.message||e)); }

    // 1) Concluir na OMIE (se houver credenciais)
    const APP_KEY = process.env.OMIE_APP_KEY || process.env.APP_KEY || process.env.OMIE_KEY;
    const APP_SEC = process.env.OMIE_APP_SECRET || process.env.APP_SECRET || process.env.OMIE_SECRET;

    if (APP_KEY && APP_SEC) {
      const payload = {
        call: 'ConcluirOrdemProducao',
        app_key: APP_KEY,
        app_secret: APP_SEC,
        param: [{ cCodIntOP: op, dDtConclusao, nQtdeProduzida: qtd }]
      };

      try {
        const resp = await safeFetch('https://app.omie.com.br/api/v1/produtos/op/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const text = await resp.text();
        let j = null; try { j = JSON.parse(text); } catch {}
        const omieErr = (!resp.ok) || (j && (j.faultstring || j.faultcode || j.error));
        if (omieErr) {
          out.omie = { ok:false, http:resp.status, body:j||text };
          // não aborta; seguimos para mover localmente e aplicar overlay
        } else {
          out.omie = { ok:true, body:j||text };
        }
      } catch (e) {
        out.omie = { ok:false, error:String(e?.message||e) };
        // segue fluxo local mesmo assim
      }
    } else {
      out.omie = { skipped:true, reason:'Credenciais OMIE ausentes (OMIE_APP_KEY/SECRET).' };
    }

    // 2) Mover na base "oficial"
    let changed = false;
    let beforeStatus = out.before?.[0]?.status || null;

    for (const tgt of TRY_TARGETS) {
// 3) SEMPRE aplicar overlay = 'concluido' (garante UI instantânea)
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.op_status_overlay (
      op         text PRIMARY KEY,
      status     text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const up = await pool.query(
    `INSERT INTO public.op_status_overlay (op, status, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (op) DO UPDATE
       SET status = EXCLUDED.status,
           updated_at = now()`,
    [op, 'concluido']
  );
  out.overlay = { via:'overlay.upsert', rowCount: up.rowCount };
} catch (e) {
  out.overlay = { via:'overlay.upsert', err:String(e?.message||e) };
  out.errors.push('[overlay] ' + (e?.message||e));
}

    }

    // 3) Overlay para UI se a view não mudou
    if (!changed) {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS public.op_status_overlay (
            op         text PRIMARY KEY,
            status     text NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `);
        const up = await pool.query(
          `INSERT INTO public.op_status_overlay (op, status, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (op) DO UPDATE
             SET status = EXCLUDED.status, updated_at = now()`,
          [op, STATUS_UI]
        );
        out.overlay = { via:'overlay.upsert', rowCount: up.rowCount };
      } catch (e) {
        out.overlay = { via:'overlay.upsert', err:String(e?.message||e) };
      }
    }

    // estado DEPOIS
    try {
      const a = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view WHERE op = $1 LIMIT 1`, [op]);
      out.after = a.rows;
    } catch (e) { out.errors.push('[after] '+(e?.message||e)); }

    out.ok = true;
    return res.json(out);

  } catch (err) {
    out.errors.push(String(err?.message||err));
    // ainda assim devolve 200 para a UI poder se atualizar e você ver o log
    return res.json(out);
  }
});


// === DEBUG: ver como o banco enxerga a OP ===========================
app.get('/api/preparacao/debug/:op', async (req, res) => {
  const op = String(req.params.op || '').trim().toUpperCase();
  try {
    const view = await pool.query(
      `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
         FROM public.kanban_preparacao_view
        WHERE op = $1
        ORDER BY 1
        LIMIT 20`, [op]);

    const os = await pool.query(
      `SELECT produto_codigo, op, status, updated_at
         FROM public.op_status
        WHERE op = $1
        ORDER BY updated_at DESC
        LIMIT 20`, [op]);

    const oi = await pool.query(
      `SELECT c_cod_int_op, c_num_op, n_cod_op, c_cod_int_prod, n_cod_prod, updated_at
         FROM public.op_info
        WHERE c_cod_int_op = $1
           OR c_num_op = $1
           OR n_cod_op::text = $1
        ORDER BY updated_at DESC
        LIMIT 20`, [op]);

    res.json({ ok:true, op, view:view.rows, op_status:os.rows, op_info:oi.rows });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
});


app.use(require('express').json({ limit: '5mb' }));

app.use('/api/produtos', produtosRouter);

// (opcional) compat: algumas partes do código usam "notifyProducts"
app.set('notifyProducts', (msg) => {
  const payload = msg || { type: 'produtos_changed', at: Date.now() };
  try { app.get('sseBroadcast')?.(payload); } catch {}


});




/* GET /api/serie/next/:codigo → { ns:"101002" } */
app.get('/api/serie/next/:codigo', (req, res) => {
  const codReq = req.params.codigo.toLowerCase();
  const db = lerEstoque();

  const item = db.find(p => (p.codigo || '').toLowerCase() === codReq);
  if (!item || !Array.isArray(item.NS) || !item.NS.length)
    return res.status(404).json({ error: 'Sem NS disponível' });

  const ns = item.NS.sort()[0];            // menor disponível
  item.NS = item.NS.filter(n => n !== ns); // remove
  item.quantidade = item.NS.length;        // atualiza qtd

  gravarEstoque(db);
  res.json({ ns });
});

// ——————————————————————————————
// 2) Cria a app e configura middlewares globais
// ——————————————————————————————



// ——— Etiquetas ————————————————————
const etiquetasRoot = path.join(__dirname, 'etiquetas');   // raiz única
// garante as pastas mínimas usadas hoje
fs.mkdirSync(path.join(etiquetasRoot, 'Expedicao',  'Printed'), { recursive: true });
fs.mkdirSync(path.join(etiquetasRoot, 'Recebimento', 'Printed'), { recursive: true });

function getDirs(tipo = 'Expedicao') {
  const dirTipo   = path.join(etiquetasRoot, tipo);                // p.ex. …/Expedicao
  const dirPrint  = path.join(dirTipo,    'Printed');              // …/Expedicao/Printed
  fs.mkdirSync(dirPrint, { recursive: true });
  return { dirTipo, dirPrint };
}



app.use('/etiquetas', express.static(etiquetasRoot));

// ——————————————————————————————
// proteger rotas de etiquetas com token
// ——————————————————————————————
function chkToken(req, res, next) {
  if (req.query.token !== process.env.MY_ZPL_SECRET) {
    return res.sendStatus(401);          // Unauthorized
  }
  next();
}

// Sessão (cookies) para manter usuário logado
app.use(session({
  secret: 'uma_chave_secreta_forte', // troque por algo mais seguro
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 dia
    httpOnly: true,
    secure: false              // em produção, true se rodar via HTTPS
  }
}));
const LOG_FILE = path.join(__dirname, 'data', 'kanban.log');  // ou outro nome

app.post('/api/logs/arrasto', express.json(), (req, res) => {
  const log = req.body;
  const linha = `[${log.timestamp}] ${log.etapa} – Pedido: ${log.pedido}, Código: ${log.codigo}, Qtd: ${log.quantidade}\n`;

  fs.appendFile(LOG_FILE, linha, err => {
    if (err) {
      console.error('Erro ao gravar log:', err);
      return res.status(500).json({ error: 'Falha ao registrar log' });
    }
    res.json({ ok: true });
  });
});

// Multer para upload de imagens
const upload = multer({ storage: multer.memoryStorage() });


// ——————————————————————————————
// 3) Inicializa Octokit (GitHub) e monta todas as rotas
// ——————————————————————————————
(async () => {
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: GITHUB_TOKEN });


/* ============================================================================
   2) Lista pendentes (lê direto a pasta)
   ============================================================================ */
app.get('/api/etiquetas/pending', (req, res) => {
  const { dirTipo } = getDirs('Expedicao');               // só “Expedicao” hoje
  const files = fs.readdirSync(dirTipo).filter(f => f.endsWith('.zpl'));

  const list = files.map(f => ({
    id: f.match(/^etiqueta_(.+)\.zpl$/)[1],
    zplUrl: `${req.protocol}://${req.get('host')}/etiquetas/Expedicao/${f}`
  }));

  res.json(list);
});

// NOVO – salva o buffer em csv/BOM.csv
app.post('/api/upload/bom', upload.single('bom'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const destDir  = path.join(__dirname, 'csv');
    const destFile = path.join(destDir, 'BOM.csv');
    await fsp.mkdir(destDir, { recursive: true });
    await fsp.writeFile(destFile, req.file.buffer);
    res.json({ ok: true });
  } catch (err) {
    console.error('[upload/bom]', err);
    res.status(500).json({ error: String(err) });
  }
});

// polyfill de fetch (Node < 18)
const httpFetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

// ===================== mover OP (A Produzir / Produzindo / concluido + Omie) =====================
app.post('/api/preparacao/op/:op/mover', async (req, res) => {
  const op = String(req.params.op || '').trim().toUpperCase();
  if (!op) return res.status(400).json({ ok:false, error:'OP inválida' });

  // normalização
  const norm = (s) => {
    const x = String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').trim();
    if (['a produzir','fila de producao','fila de produção','20'].includes(x)) return 'A Produzir';
    if (['produzindo','em producao','em produção','30'].includes(x))          return 'Produzindo';
    if (['concluido','concluido.','concluido ','60','80','concluído'].includes(x)) return 'concluido';
    return null;
  };

  const target = norm(req.body?.status);
  if (!target) return res.status(422).json({ ok:false, error:'status inválido', got:req.body?.status });

  const TRY_TARGETS = {
    'A Produzir': ['A Produzir','Fila de produção','Fila de producao','20'],
    'Produzindo': ['Produzindo','Em produção','Em producao','30'],
    'concluido' : ['concluido','Concluído','Concluido','60','80'],
  }[target];

  // Sempre concluir com qtd=1 e data de hoje
  const pad2 = n => String(n).padStart(2,'0');
  const fmtDDMMYYYY = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
  const dDtConclusao = fmtDDMMYYYY(new Date());
  const qtd = 1;

  const out = { ok:false, op, target, omie_concluir:null, omie_reverter:null, attempts:[], before:null, after:null, overlay:null, errors:[] };

  try {
    // Estado ANTES (para saber se estava concluído)
    try {
      const b = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view
          WHERE op = $1 LIMIT 1`, [op]
      );
      out.before = b.rows;
    } catch (e) { out.errors.push('[before] ' + (e?.message||e)); }

    const beforeStatusRaw = out.before?.[0]?.status || null;
    const beforeStatus = norm(beforeStatusRaw);
    const wasConcluded = beforeStatus === 'concluido';
    const goingToConcluded = target === 'concluido';

    // Credenciais Omie (se existirem)
    const APP_KEY = process.env.OMIE_APP_KEY || process.env.APP_KEY || process.env.OMIE_KEY;
    const APP_SEC = process.env.OMIE_APP_SECRET || process.env.APP_SECRET || process.env.OMIE_SECRET;

    // 1A) Se arrastou PARA concluído → ConcluirOrdemProducao (qtd=1, hoje)
    if (goingToConcluded && APP_KEY && APP_SEC) {
      const payload = {
        call: 'ConcluirOrdemProducao',
        app_key: APP_KEY,
        app_secret: APP_SEC,
        param: [{ cCodIntOP: op, dDtConclusao, nQtdeProduzida: qtd }]
      };
      try {
        const resp = await httpFetch('https://app.omie.com.br/api/v1/produtos/op/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const text = await resp.text();
        let j = null; try { j = JSON.parse(text); } catch {}
        const omieErr = (!resp.ok) || (j && (j.faultstring || j.faultcode || j.error));
        out.omie_concluir = omieErr ? { ok:false, http:resp.status, body:j||text } : { ok:true, body:j||text };
      } catch (e) {
        out.omie_concluir = { ok:false, error:String(e?.message||e) };
      }
    } else if (goingToConcluded) {
      out.omie_concluir = { skipped:true, reason:'Credenciais OMIE ausentes (OMIE_APP_KEY/SECRET).' };
    }

    // 1B) Se estava concluído E foi arrastado para outra coluna → ReverterOrdemProducao
    if (wasConcluded && !goingToConcluded) {
      if (APP_KEY && APP_SEC) {
        const payload = {
          call: 'ReverterOrdemProducao',
          app_key: APP_KEY,
          app_secret: APP_SEC,
          param: [{ cCodIntOP: op }]
        };
        try {
          const resp = await httpFetch('https://app.omie.com.br/api/v1/produtos/op/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const text = await resp.text();
          let j = null; try { j = JSON.parse(text); } catch {}
          const omieErr = (!resp.ok) || (j && (j.faultstring || j.faultcode || j.error));
          out.omie_reverter = omieErr ? { ok:false, http:resp.status, body:j||text } : { ok:true, body:j||text };
        } catch (e) {
          out.omie_reverter = { ok:false, error:String(e?.message||e) };
        }
      } else {
        out.omie_reverter = { skipped:true, reason:'Credenciais OMIE ausentes (OMIE_APP_KEY/SECRET).' };
      }
    }

    // 2) Mover na base oficial
    let changed = false;
    for (const tgt of TRY_TARGETS) {
      try {
        await pool.query('SELECT mover_op($1,$2)', [op, tgt]);
        out.attempts.push({ via:'mover_op', target:tgt, ok:true });
        // Não precisamos revalidar aqui para "break" — seguimos para overlay idempotente
        changed = true;
        break;
      } catch (e) {
        out.attempts.push({ via:'mover_op', target:tgt, ok:false, err:String(e?.message||e) });
        out.errors.push('[mover_op '+tgt+'] ' + (e?.message||e));
      }
    }

    // 3) Overlay garante UI instantânea
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.op_status_overlay (
          op         text PRIMARY KEY,
          status     text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const up = await pool.query(
        `INSERT INTO public.op_status_overlay (op, status, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (op) DO UPDATE
           SET status = EXCLUDED.status,
               updated_at = now()`,
        [op, target]
      );
      out.overlay = { via:'overlay.upsert', rowCount: up.rowCount };
    } catch (e) {
      out.overlay = { via:'overlay.upsert', err:String(e?.message||e) };
      out.errors.push('[overlay] ' + (e?.message||e));
    }

    // 4) Estado DEPOIS
    try {
      const a = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view
          WHERE op = $1 LIMIT 1`, [op]
      );
      out.after = a.rows;
    } catch (e) { out.errors.push('[after] ' + (e?.message||e)); }

    out.ok = true;
    return res.json(out);

  } catch (err) {
    out.errors.push(String(err?.message||err));
    return res.status(500).json(out);
  }
});



// === Consulta de eventos de OP (JSON & CSV) ===============================
// Parâmetros (query):
//   op=P101086           → filtra por uma OP
//   limit=100            → máximo de registros (padrão 100, máx 1000)
//   order=asc|desc       → ordenação por data (padrão desc)
//   tz=America/Sao_Paulo → fuso para formatar no Postgres

// === Consulta de eventos (com filtros por data) ===========================
app.get('/api/preparacao/eventos', async (req, res) => {
  const {
    op,
    limit = '100',
    order = 'desc',
    tz = 'America/Sao_Paulo',
    from,   // AAAA-MM-DD
    to      // AAAA-MM-DD
  } = req.query;

  const lim = Math.min(parseInt(limit, 10) || 100, 1000);
  const ord = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // boundaries (strings) → Date (local) para comparar no modo local
  const hasRange = !!(from || to);
  let startDate = null, endDate = null;
  if (hasRange) {
    const norm = (s) => String(s || '').trim();
    const f = norm(from);
    const t = norm(to);
    if (f) startDate = new Date(`${f}T00:00:00`);
    if (t) endDate   = new Date(`${t}T23:59:59`);
  }

  try {
    // LOCAL (JSON)
    if (!shouldUseDb(req)) {
      const arr = await loadPrepArray();
      const eventos = [];

      for (const item of arr) {
        for (const s of (item.local || [])) {
          const m = String(s).match(/^([^,]+)\s*,\s*([^,]+)\s*(?:,(.*))?$/);
          if (!m) continue;
          const [, , opId, rest] = m;
          if (op && opId !== op) continue;
          if (!rest) continue;

          const stamps = rest.split(',').map(x => x.trim()).filter(Boolean);
          for (const stamp of stamps) {
            const sm = stamp.match(/^([IF])\s*-\s*(.+?)\s*-\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2}:\d{2})$/);
            if (!sm) continue;
            const tipo    = sm[1];
            const usuario = sm[2];
            const dataBR  = sm[3];
            const hora    = sm[4];

            // cria Date local a partir de “dd/mm/aaaa HH:MM:SS”
            const [dd, mm, yyyy] = dataBR.split('/');
            const isoLocal = `${yyyy}-${mm}-${dd}T${hora}`;
            const dt = new Date(isoLocal);

            // aplica filtro de datas, se houver
            if (startDate && dt < startDate) continue;
            if (endDate   && dt > endDate)   continue;

            eventos.push({
              op: opId,
              tipo,
              usuario,
              quando: `${dataBR} ${hora}`,
              _ts: dt.getTime()
            });
          }
        }
      }

      eventos.sort((a, b) => (ord === 'ASC' ? a._ts - b._ts : b._ts - a._ts));
      const out = eventos.slice(0, lim).map(({ _ts, ...rest }) => rest);

      return res.json({ mode: 'local-json', op: op || null, eventos: out });
    }

    // REMOTO (Postgres)
    // monta WHERE dinâmico
    const where = [];
    const params = [tz]; // $1 = tz
    if (op) { where.push(`op = $${params.length + 1}`); params.push(op); }
    if (from) {
      where.push(`(momento AT TIME ZONE $1) >= $${params.length + 1}::timestamp`);
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where.push(`(momento AT TIME ZONE $1) <= $${params.length + 1}::timestamp`);
      params.push(`${to} 23:59:59`);
    }

    let sql = `
      SELECT op, tipo, usuario,
             to_char(momento AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI:SS') AS quando
        FROM op_event
    `;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY momento ${ord}`;
    sql += ` LIMIT $${params.length + 1}`;
    params.push(lim);

    const { rows } = await dbQuery(sql, params);
    return res.json({ mode: 'postgres', op: op || null, eventos: rows });
  } catch (err) {
    console.error('[preparacao/eventos] erro:', err);
    res.status(500).json({ error: err.message || 'Erro ao consultar eventos' });
  }
});


app.get('/api/preparacao/eventos.csv', async (req, res) => {
  try {
    // Reaproveita a rota JSON acima chamando o próprio servidor
    // (ou poderia duplicar a lógica; aqui mantemos simples)
    const url = new URL(req.protocol + '://' + req.get('host') + req.originalUrl.replace(/\.csv(\?.*)?$/, '$1'));
    url.pathname = '/api/preparacao/eventos';

    const r = await fetch(url.toString());
    if (!r.ok) return res.status(r.status).send(await r.text());
    const { eventos } = await r.json();

    const csv = csvStringify(eventos, { header: true, columns: ['op','tipo','usuario','quando'] });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="op_eventos.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[preparacao/eventos.csv] erro:', err);
    res.status(500).json({ error: err.message || 'Erro ao gerar CSV de eventos' });
  }
});


// Grava um ZPL pronto vindo do front
app.post('/api/etiquetas/gravar', express.json(), (req, res) => {
  const { file, zpl, tipo = 'Teste' } = req.body || {};
  if (!file || !zpl) return res.status(400).json({ error: 'faltam campos' });

  const pasta = path.join(__dirname, 'etiquetas', tipo);
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });

  fs.writeFileSync(path.join(pasta, file), zpl.trim(), 'utf8');
  res.json({ ok: true });
});

/* ============================================================================
   3) Marca como impressa (move para …/Printed)
   ============================================================================ */
app.post('/api/etiquetas/:id/printed', (req, res) => {
  const id = req.params.id;
  const { dirTipo, dirPrint } = getDirs('Expedicao');
  const src = path.join(dirTipo,  `etiqueta_${id}.zpl`);
  const dst = path.join(dirPrint, `etiqueta_${id}.zpl`);

  if (!fs.existsSync(src)) return res.sendStatus(404);
  try {
    fs.renameSync(src, dst);
    res.sendStatus(200);
  } catch (err) {
    console.error('[etiquetas/printed] Falha ao mover:', err);
    res.status(500).json({ error: 'Falha ao mover etiqueta' });
  }
});

/**
 * Quebra um texto em linhas de até maxChars caracteres, 
 * sempre respeitando os espaços.
 */
function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= maxChars) {
      current = (current + ' ' + w).trim();
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/* ============================================================================
   /api/etiquetas – gera o .zpl da etiqueta no layout “compacto” aprovado
   ============================================================================ */
app.post('/api/etiquetas', async (req, res) => {
  try {
    const { numeroOP, tipo = 'Expedicao', codigo, ns } = req.body;


      // Garante existência da pasta dinâmica (Teste ou Expedicao)
  const folder = path.join(__dirname, 'etiquetas', tipo);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

    if (!numeroOP) return res.status(400).json({ error: 'Falta numeroOP' });

    /* ---------------------------------------------------------------------
       1) Consulta Omie (se veio código)
    --------------------------------------------------------------------- */
    let produtoDet = {};
    if (codigo) {
      produtoDet = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'ConsultarProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [{ codigo }]
        }
      );
    }

    /* ---------------------------------------------------------------------
       2) Diretório de saída
    --------------------------------------------------------------------- */
    const { dirTipo } = getDirs(tipo);

    /* ---------------------------------------------------------------------
       3) Data de fabricação (MM/AAAA)
    --------------------------------------------------------------------- */
    const hoje          = new Date();
    const hojeFormatado =
      `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;

    /* ---------------------------------------------------------------------
       4) Características → objeto d   (troca ~ → _7E)
    --------------------------------------------------------------------- */
    const cad = produtoDet.produto_servico_cadastro?.[0] || produtoDet;
    // -------------------------------------------------------------
// código interno do produto (vem do Omie)
// -------------------------------------------------------------
// -------------------------------------------------------------
// MODELO na etiqueta = código com hífen antes do 1º dígito
// Ex.: ft160 → ft-160   |   FH200 → FH-200   |   fti25b → fti-25b
// -------------------------------------------------------------
const modeloParaEtiqueta = (cad.codigo || '')
  .replace(/^([A-Za-z]+)(\d)/, '$1-$2');


    const d   = {};
    const encodeTilde = s => (s || '').replace(/~/g, '_7E');

    (cad.caracteristicas || []).forEach(c => {
      d[c.cCodIntCaract] = encodeTilde(c.cConteudo);
    });

    d.modelo          = cad.modelo      || '';
    d.ncm             = cad.ncm         || '';
    d.pesoLiquido     = cad.peso_liq    || '';
    d.dimensaoProduto =
      `${cad.largura || ''}x${cad.profundidade || ''}x${cad.altura || ''}`;

    const z = v => v || '';            // evita undefined em ^FD

/* ---------------------------------------------------------------------
   5) ZPL – mesmo layout, mas linhas dinâmicas a partir do CSV
--------------------------------------------------------------------- */
const linhas = separarLinhas(cad);     // usa função criada no topo

// parâmetros de espaçamento (ajuste só se mudar fonte ou margens)
const startY_E = 540;  // Y inicial da coluna esquerda
const startY_D = 540;  // Y inicial da coluna direita

const CHAR_W        = 11;  // acertado na calibragem
const STEP_ITEM     = 40;  // distância até o próximo item “normal”
const STEP_SUFIXO   = 30;  // distância quando é só o sufixo “(…)”
const STEP_WRAP     = 20;  // distância entre linhas quebradas do MESMO rótulo


function montarColuna(col, startY, xLabel, xValue) {
  const blocos = [];
  let   y      = startY;

  const xParenByBase = {};        // base → X do '('
  let   baseAnterior = '';

  for (const row of col) {
    const cod   = (row.Caracteristica || '').trim();
    const valor = z(d[cod]);

    /* separa base + sufixo */
    const full = (row.Label || '').trim();
    const m    = full.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    const base   = m ? m[1].trim() : full;
    const sufixo = m ? `(${m[2]})`  : '';

    const sufixoOnly = base === baseAnterior && sufixo;

    /* decide texto + X */
    let labelPrint, xLabelNow = xLabel;
    if (sufixoOnly) {
      labelPrint = sufixo;
      xLabelNow  = xParenByBase[base];
    } else {
      labelPrint   = full;
      baseAnterior = base;
      const p = full.indexOf('(');
      if (p >= 0) xParenByBase[base] = xLabel + p * CHAR_W;
    }

    /* quebra >25 chars --------------- */
    const LIM = 25;
    const partes = [];
    let txt = labelPrint;
    while (txt.length > LIM) {
      const pos = txt.lastIndexOf(' ', LIM);
      if (pos > 0) { partes.push(txt.slice(0,pos)); txt = txt.slice(pos+1); }
      else break;
    }
    partes.push(txt);

    /* imprime LABEL(es) --------------- */
    partes.forEach((ln, idx) => {
      const stepIntra = idx === 0 ? 0 : STEP_WRAP; // 1ª linha = 0
      blocos.push(
        `^A0R,25,25`,
        `^FO${y - stepIntra},${xLabelNow}^FD${ln}^FS`
      );
      y -= stepIntra;          // só para linhas quebradas
    });

    /* imprime VALOR ------------------- */
    blocos.push(
      `^A0R,20,20`,
      `^FO${y},${xValue}^FB200,1,0,R^FH_^FD${valor}^FS`
    );

    /* avança para o PRÓXIMO item ------ */
    y -= sufixoOnly ? STEP_SUFIXO : STEP_ITEM;
  }

  return blocos.join('\n');
}

const blocoE = montarColuna(linhas.E, startY_E,  25, 240); // esquerda
const blocoD = montarColuna(linhas.D, startY_D, 470, 688); // direita



const zpl = `
^XA
^CI28
^PW1150
^LL700

; ── Cabeçalho fixo ───────────────────────────────────────────────────────
^A0R,42,40
^FO640,15^FDBOMBA DE CALOR FROMTHERM^FS
^A0R,20,20
^FO650,690^FD FABRICAÇÃO:^FS
^A0R,20,20
^FO650,820^FH_^FD${hojeFormatado}^FS

^FO580,20^GB60,375,2^FS
^A0R,22,22
^FO593,35^FDMODELO^FS
^A0R,40,40
^FO585,120^FH_^FD${z(modeloParaEtiqueta)}^FS
^FO580,400^GB60,190,2^FS
^A0R,25,25
^FO585,405^FH_^FDNCM: ${z(d.ncm)}^FS

^FO580,595^GB60,235,60^FS
^A0R,25,25                 ; tamanho da letra do NS numero de serie
^FO585,600^FR^FDNS:^FS
^A0R,40,40
^FO585,640^FR^FH_^FD${ns || numeroOP}^FS
^FO580,825^BQN,2,3^FH_^FDLA,${ns || numeroOP}^FS
^FO30,450^GB545,2,2^FS

; ── BLOCO ESQUERDO (CSV) ────────────────────────────────────────────────
${blocoE}

; ── BLOCO DIREITO (CSV) ─────────────────────────────────────────────────
${blocoD}

^XZ
`;


    /* ---------------------------------------------------------------------
       6) Salva o arquivo .zpl
    --------------------------------------------------------------------- */
    const fileName = `etiqueta_${numeroOP}.zpl`;
    fs.writeFileSync(path.join(dirTipo, fileName), zpl.trim(), 'utf8');

    return res.json({ ok: true });
  } catch (err) {
    console.error('[etiquetas] erro →', err);
    return res.status(500).json({ error: 'Erro ao gerar etiqueta' });
  }
});

app.get('/api/op/next-code/:dummy', (req,res)=>{ return res.json({ nextCode: nextOpFromKanban() }); });
  // ——————————————————————————————
  // 3.1) Rotas CSV (Tipo.csv)
  // ——————————————————————————————
  app.post('/api/omie/updateTipo', (req, res) => {
    const { groupId, listaPecas } = req.body;
const csvPath = path.join(__dirname, 'csv', 'Configuração_etq_caracteristicas.csv');
const csvText = fs.readFileSync(csvPath, 'utf8');
// OBS.: o arquivo usa “;” – indicamos o delimitador explicitamente
const rows = csvParse(csvText, {
  columns:           true,
  skip_empty_lines:  true,
  delimiter:         ','          // <<< a parte que estava faltando
});

    const updated = rows.map(row => {
      if (+row.Grupo === groupId) row['lista_peças'] = listaPecas;
      return row;
    });

    fs.writeFileSync(csvPath, csvStringify(updated, { header: true }), 'utf8');
    res.json({ ok: true });
  });


  // para imprimir etiquetas ZPL

const uuid = require('uuid').v4;  // para gerar um nome único, se desejar


  app.post('/api/omie/updateNaoListar', (req, res) => {
    const { groupId, prefix } = req.body;
    const csvPath = path.join(__dirname, 'csv', 'Tipo.csv');
    const text    = fs.readFileSync(csvPath, 'utf8');
    const rows    = csvParse(text, { columns: true, skip_empty_lines: true });

    const updated = rows.map(row => {
      if (+row.Grupo === groupId) {
        const arr = row.nao_listar_comeca_com
                      .replace(/(^"|"$)/g,'')
                      .split(',')
                      .filter(s => s);
        if (!arr.includes(prefix)) arr.push(prefix);
        row.nao_listar_comeca_com = arr.join(',');
      }
      return row;
    });

    fs.writeFileSync(csvPath, csvStringify(updated, { header: true }), 'utf8');
    res.json({ ok: true });
  });

app.post('/api/omie/produtos/op', express.json(), async (req, res) => {
  try {
    const front = req.body || {};
    front.param = front.param || [{}];
    front.param[0] = front.param[0] || {};
    front.param[0].identificacao = front.param[0].identificacao || {};
    const ident = front.param[0].identificacao;

    // 1) Defaults obrigatórios (servidor é a fonte da verdade)
    ident.codigo_local_estoque = 10564345392;             // fixo
    ident.nQtde       = Math.max(1, Number(ident.nQtde || 1));
    ident.dDtPrevisao = toOmieDate(new Date());

    // 2) Descobrir o código textual do produto (para regra do prefixo "P")
    const nCodProduto = Number(ident.nCodProduto) || null;
    let prodCodigo = null;
    try {
      const r = await dbQuery(
        'SELECT codigo FROM produtos WHERE codigo_prod = $1 LIMIT 1',
        [nCodProduto]
      );
      prodCodigo = r?.rows?.[0]?.codigo || null;
    } catch {}

    // 3) Pede ao Postgres o próximo código de OP (regra do "PP")
    async function nextOpFromDb(codigoProduto) {
      try {
        const r = await dbQuery('SELECT next_c_cod_int_op($1) AS op', [codigoProduto]);
        return r?.rows?.[0]?.op || null;
      } catch { return null; }
    }

    // Sempre sobrepõe qualquer cCodIntOP vindo do front
    ident.cCodIntOP = await nextOpFromDb(prodCodigo) || ident.cCodIntOP || String(Date.now());
    front.param[0].identificacao = ident;

    // 4) Logs úteis
    console.log('[produtos/op] nCodProduto →', nCodProduto, 'prodCodigo →', prodCodigo);
    console.log('[produtos/op] cCodIntOP gerado →', ident.cCodIntOP);

    // 5) Tenta incluir OP (retry para duplicidade)
    let tentativa = 0;
    let resposta;
    while (tentativa < 5) {
      resposta = await omieCall('https://app.omie.com.br/api/v1/produtos/op/', front);

      // Duplicado? Gere OUTRO número no banco e tente de novo
      if (resposta?.faultcode === 'SOAP-ENV:Client-102') {
        ident.cCodIntOP = await nextOpFromDb(prodCodigo) || String(Date.now());
        front.param[0].identificacao.cCodIntOP = ident.cCodIntOP;
        tentativa++;
        continue;
      }
      break; // sucesso ou erro diferente
    }

    // Resposta: mantém campos da Omie e adiciona o código efetivamente usado
    const payload = { used_cCodIntOP: ident.cCodIntOP, ...resposta };
    res.status(resposta?.faultstring ? 500 : 200).json(payload);

  } catch (err) {
    console.error('[produtos/op] erro →', err);
    res.status(err.status || 500).json({ error: String(err?.faultstring || err?.message || err) });
  }
});


  // lista pedidos
app.post('/api/omie/pedidos', express.json(), async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/produtos/pedido/',
      {
        call:       'ListarPedidos',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    return res.json(data);
  } catch (err) {
    console.error('[pedidos] erro →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});

// ─── Ajuste / Transferência de estoque ───────────────────────────
app.post('/api/omie/estoque/ajuste', express.json(), async (req, res) => {
  // 1) loga o que veio do browser
  console.log('\n[ajuste] payload recebido →\n',
              JSON.stringify(req.body, null, 2));

  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/estoque/ajuste/',
      req.body
    );

    // 2) loga a resposta OK do OMIE
    console.log('[ajuste] OMIE respondeu OK →\n',
                JSON.stringify(data, null, 2));

    return res.json(data);

  } catch (err) {
    // 3) loga a falha (faultstring, faultcode, etc.)
    console.error('[ajuste] ERRO OMIE →',
                  err.faultstring || err.message,
                  '\nDetalhes:', err);

    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message, details: err });
  }
});

//------------------------------------------------------------------
// Armazéns → Almoxarifado (LENDO DO POSTGRES)
//------------------------------------------------------------------
app.post('/api/armazem/almoxarifado', express.json(), async (req, res) => {
  try {
    const local = String(req.query.local || req.body?.local || ALMOX_LOCAL_PADRAO);

    const { rows } = await pool.query(`
      SELECT
        local,
        produto_codigo     AS codigo,
        produto_descricao  AS descricao,
        estoque_minimo     AS min,
        fisico,
        reservado,
        saldo,
        cmc
      FROM v_almoxarifado_grid
      WHERE local = $1
      ORDER BY produto_codigo
    `, [local]);

    const dados = rows.map(r => ({
      codigo   : r.codigo || '',
      descricao: r.descricao || '',
      min      : Number(r.min)       || 0,
      fisico   : Number(r.fisico)    || 0,
      reservado: Number(r.reservado) || 0,
      saldo    : Number(r.saldo)     || 0,
      cmc      : Number(r.cmc)       || 0,
    }));

    res.json({ ok:true, local, pagina:1, totalPaginas:1, dados });
  } catch (err) {
    console.error('[almoxarifado SQL]', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});

app.post('/api/admin/sync/almoxarifado/all', express.json(), async (req, res) => {
  try {
    const data = req.body?.data || new Date().toLocaleDateString('pt-BR');
    const timeout = Number(req.query.timeout || 90000);
    const retry   = Number(req.query.retry || 1);

    const { rows } = await pool.query('SELECT local_codigo FROM omie_locais_estoque WHERE ativo = TRUE ORDER BY local_codigo');
    const results = [];

    for (const r of rows) {
      const local = String(r.local_codigo);
      try {
        const resp = await fetch(`http://localhost:${process.env.PORT || 5001}/api/admin/sync/almoxarifado?timeout=${timeout}&retry=${retry}`, {
          method : 'POST',
          headers: { 'Content-Type':'application/json' },
          body   : JSON.stringify({ local: Number(local), data }),
        });
        const json = await resp.json();
        results.push({ local, ...json });
        await new Promise(ok => setTimeout(ok, 800)); // respiro entre chamadas
      } catch (e) {
        results.push({ local, ok:false, error:String(e.message || e) });
      }
    }

    res.json({ ok:true, total: results.length, results });
  } catch (err) {
    console.error('[admin/sync/almox ALL]', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});

// ---------------------------------------------------------------
// Webhook Omie (genérico) -> armazena e agenda re-sync do estoque
// ---------------------------------------------------------------
const SYNC_DEBOUNCE_MS = 45_000; // >= 30s do cache da Omie
const syncTimers = new Map();
function scheduleSync(localCodigo, dataBR) {
  clearTimeout(syncTimers.get(localCodigo));
  const t = setTimeout(async () => {
    try {
      await fetch(`http://localhost:${process.env.PORT || 5001}/api/admin/sync/almoxarifado?timeout=90000&retry=1`, {
        method : 'POST',
        headers: { 'Content-Type':'application/json' },
        body   : JSON.stringify({ local: Number(localCodigo), data: dataBR }),
      });
    } catch (e) {
      console.error('[webhook] re-sync falhou', e);
    }
  }, SYNC_DEBOUNCE_MS);
  syncTimers.set(localCodigo, t);
}

async function scheduleSyncAll(dataBR) {
  const { rows } = await pool.query('SELECT local_codigo FROM omie_locais_estoque WHERE ativo = TRUE');
  for (const r of rows) scheduleSync(String(r.local_codigo), dataBR);
}

function pickLocalFromPayload(body) {
  return (
    body?.codigo_local_estoque ??
    body?.param?.[0]?.codigo_local_estoque ??
    body?.dados?.codigo_local_estoque ??
    null
  );
}

// ====== rota do webhook ======
app.post('/webhooks/omie/estoque', express.json({ limit:'2mb' }), async (req, res) => {
  try {
    // 1) token opcional (se OMIE_WEBHOOK_TOKEN estiver setado, passa a exigir)
    if (OMIE_WEBHOOK_TOKEN) {
      const token = req.query.token || req.headers['x-omie-token'];
      if (token !== OMIE_WEBHOOK_TOKEN) {
        return res.status(401).json({ ok:false, error:'token inválido' });
      }
    }

    const body = req.body || {};
    const tipo = body?.event_type || body?.tipoEvento || 'estoque';

    // 2) guarda o evento cru (auditoria)
    await pool.query(
      `INSERT INTO omie_webhook_events (event_id, event_type, payload_json)
       VALUES ($1,$2,$3)`,
      [ body?.event_id || null, tipo, body ]
    );

    // 3) agenda re-sync
    const hojeBR = new Date().toLocaleDateString('pt-BR');
    const localDoPayload = pickLocalFromPayload(body);

    if (localDoPayload) {
      scheduleSync(String(localDoPayload), hojeBR);
      return res.json({ ok:true, scheduled:true, scope:'local', local:String(localDoPayload) });
    } else {
      await scheduleSyncAll(hojeBR);
      return res.json({ ok:true, scheduled:true, scope:'all' });
    }
  } catch (err) {
    console.error('[webhook/omie/estoque]', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});

app.post('/api/webhooks/omie/estoque', express.json({ limit:'2mb' }), async (req, res) => {
  try {
    const body = req.body || {};

    // 1) guarda o evento "como veio"
    await pool.query(
      `INSERT INTO omie_webhook_events (event_id, event_type, payload_json)
       VALUES ($1,$2,$3)`,
      [ body?.event_id || null, body?.event_type || 'estoque', body ]
    );

    // 2) tenta descobrir o local do estoque no payload; se não achar, usa o padrão
    const localDoPayload =
      body?.codigo_local_estoque ||
      body?.param?.[0]?.codigo_local_estoque ||
      body?.dados?.codigo_local_estoque ||
      10408201806;

    // data de posição padrão = hoje (BR)
    const hojeBR = new Date().toLocaleDateString('pt-BR');

    // 3) agenda re-sync (debounced)
    scheduleSync(String(localDoPayload), hojeBR);

    res.json({ ok:true, scheduled:true, local: String(localDoPayload) });
  } catch (err) {
    console.error('[webhook/omie/estoque]', err);
    res.status(500).json({ ok:false, error: String(err.message || err) });
  }
});

// ------------------------------------------------------------------
// Admin → Importar posição de estoque da Omie para o Postgres
// POST /api/admin/sync/almoxarifado[?dry=1&timeout=60000&retry=2]
// Body JSON: { "local": 10408201806, "data": "28/08/2025" }  // dd/mm/aaaa ou ISO
// ------------------------------------------------------------------
app.post('/api/admin/sync/almoxarifado', express.json(), async (req, res) => {
  const startedAt = Date.now();

  // chaves Omie (env)
  const OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
  const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    return res.status(500).json({ ok:false, error: 'OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente.' });
  }

  // params
  const localCodigo = String(req.body?.local || 10408201806);
  const dataInput   = String(req.body?.data || new Date().toLocaleDateString('pt-BR')); // dd/mm/aaaa
  const dry         = String(req.query.dry || '0') === '1';
  const tmo         = Number(req.query.timeout || 60000); // ms
  const retryCount  = Number(req.query.retry || 2);       // tentativas extra ao detectar cache da Omie
  const perPage     = 200; // menor página = respostas mais rápidas/estáveis

  const brToISO = (s) => {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      const [d,m,y] = s.split('/');
      return `${y}-${m}-${d}`;
    }
    return s;
  };
  const dataBR  = /^\d{4}-\d{2}-\d{2}$/.test(dataInput) ? dataInput.split('-').reverse().join('/') : dataInput;
  const dataISO = brToISO(dataInput);
  const clamp   = n => Math.max(0, Number(n) || 0);
  const sleep   = ms => new Promise(r => setTimeout(r, ms));

  if (dry) {
    return res.json({ ok:true, dry:true, local: localCodigo, data: dataBR, msg:'rota viva ✅' });
  }

  // fetch com timeout
  const fetchWithTimeout = async (url, opts = {}, ms = 20000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      return resp;
    } finally {
      clearTimeout(id);
    }
  };

  const omieFetch = async (payload) => {
    const resp = await fetchWithTimeout(
      'https://app.omie.com.br/api/v1/estoque/consulta/',
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify(payload),
      },
      tmo
    );
    if (!resp.ok) {
      const text = await resp.text().catch(()=>'');
      throw new Error(`Omie HTTP ${resp.status} ${resp.statusText} :: ${text.slice(0,300)}`);
    }
    return resp.json();
  };

  // retry quando a Omie retornar "Consumo redundante detectado" (cache de 30s)
  const omieFetchRetry = async (payload) => {
    for (let i = 0; i <= retryCount; i++) {
      try {
        return await omieFetch(payload);
      } catch (e) {
        const msg = String(e?.message || '');
        const isCache = msg.includes('Consumo redundante detectado');
        if (isCache && i < retryCount) {
          const wait = 35000; // 35s > 30s do cache
          console.warn(`[almox sync] cache Omie detectado; aguardando ${wait}ms e tentando de novo (${i+1}/${retryCount})`);
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }
  };

  try {
    // 1) primeira página para total
    const basePayload = {
      call     : 'ListarPosEstoque',
      app_key  : OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{
        nPagina            : 1,
        nRegPorPagina      : perPage,
        dDataPosicao       : dataBR,   // dd/mm/aaaa
        cExibeTodos        : 'S',      // pega tudo (com e sem saldo)
        codigo_local_estoque: Number(localCodigo)
      }]
    };

    const r0     = await omieFetchRetry(basePayload);
    const total  = Number(r0.nTotRegistros || (Array.isArray(r0.produtos) ? r0.produtos.length : 0));
    const paginas = Math.max(1, Math.ceil(total / perPage));

    // 2) paginação
    const itens = [];
    for (let pg = 1; pg <= paginas; pg++) {
      const payload = { ...basePayload, param: [{ ...basePayload.param[0], nPagina: pg, nRegPorPagina: perPage }] };
      const r = await omieFetchRetry(payload);
      const arr = Array.isArray(r.produtos) ? r.produtos : [];
      itens.push(...arr);
    }

    if (!itens.length) {
      return res.json({ ok:true, imported: 0, local: localCodigo, data_posicao: dataISO, msg: 'Sem itens retornados pela Omie.' });
    }

    // 3) transação + UPSERT
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');

      await cli.query(
        `INSERT INTO omie_locais_estoque (local_codigo, nome, ativo, updated_at)
         VALUES ($1, $2, TRUE, now())
         ON CONFLICT (local_codigo)
         DO UPDATE SET nome = EXCLUDED.nome, ativo = TRUE, updated_at = now()`,
        [localCodigo, 'Almoxarifado']
      );

      const upsertSQL = `
        INSERT INTO omie_estoque_posicao (
          data_posicao, ingested_at, local_codigo,
          omie_prod_id, cod_int, codigo, descricao,
          preco_unitario, saldo, cmc, pendente, estoque_minimo, reservado, fisico
        ) VALUES (
          $1::date, now(), $2,
          $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13
        )
        ON CONFLICT ON CONSTRAINT uq_posicao_uni
        DO UPDATE SET
          descricao      = EXCLUDED.descricao,
          preco_unitario = EXCLUDED.preco_unitario,
          saldo          = EXCLUDED.saldo,
          cmc            = EXCLUDED.cmc,
          pendente       = EXCLUDED.pendente,
          estoque_minimo = EXCLUDED.estoque_minimo,
          reservado      = EXCLUDED.reservado,
          fisico         = EXCLUDED.fisico,
          ingested_at    = now()
      `;

      let count = 0;
      for (const p of itens) {
        const row = {
          omie_prod_id   : Number(p.nCodProd) || 0,
          cod_int        : p.cCodInt || null,
          codigo         : p.cCodigo || null,
          descricao      : p.cDescricao || '',
          preco_unitario : clamp(p.nPrecoUnitario),
          saldo          : clamp(p.nSaldo),
          cmc            : clamp(p.nCMC),
          pendente       : clamp(p.nPendente),
          estoque_minimo : clamp(p.estoque_minimo),
          reservado      : clamp(p.reservado),
          fisico         : clamp(p.fisico),
        };

        await cli.query(upsertSQL, [
          dataISO, localCodigo,
          row.omie_prod_id, row.cod_int, row.codigo, row.descricao,
          row.preco_unitario, row.saldo, row.cmc, row.pendente, row.estoque_minimo, row.reservado, row.fisico
        ]);
        count++;
      }

      await cli.query('COMMIT');
      const ms = Date.now() - startedAt;
      return res.json({ ok:true, imported: count, local: localCodigo, data_posicao: dataISO, ms });
    } catch (e) {
      await cli.query('ROLLBACK');
      throw e;
    } finally {
      cli.release();
    }
  } catch (err) {
    console.error('[almox sync] FAIL', err);
    return res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
});



// ========== Produção ==========
// Produção → só estoque atual do local e com saldo positivo
const PRODUCAO_LOCAL_PADRAO = process.env.PRODUCAO_LOCAL_PADRAO || '10564345392';

app.post('/api/armazem/producao', express.json(), async (req, res) => {
  try {
    const local = String(req.query.local || req.body?.local || PRODUCAO_LOCAL_PADRAO);

    const { rows } = await pool.query(`
      SELECT
        produto_codigo     AS codigo,
        produto_descricao  AS descricao,
        estoque_minimo     AS min,
        fisico,
        reservado,
        saldo,
        cmc
      FROM v_almoxarifado_grid_atual
      WHERE local = $1
        AND COALESCE(saldo,0) > 0
      ORDER BY codigo
    `, [local]);

    const dados = rows.map(r => ({
      codigo   : r.codigo || '',
      descricao: r.descricao || '',
      min      : Number(r.min)       || 0,
      fisico   : Number(r.fisico)    || 0,
      reservado: Number(r.reservado) || 0,
      saldo    : Number(r.saldo)     || 0,
      cmc      : Number(r.cmc)       || 0,
    }));

    res.json({ ok:true, local, pagina:1, totalPaginas:1, dados });
  } catch (err) {
    console.error('[armazem/producao SQL]', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});


// ========== Almoxarifado ==========
const ALMOX_LOCAL_PADRAO = process.env.ALMOX_LOCAL_PADRAO || '10408201806';

app.post('/api/armazem/almoxarifado', express.json(), async (req, res) => {
  try {
    const local = String(req.query.local || req.body?.local || ALMOX_LOCAL_PADRAO);

    const { rows } = await pool.query(`
      SELECT
        produto_codigo     AS codigo,
        produto_descricao  AS descricao,
        estoque_minimo     AS min,
        fisico,
        reservado,
        saldo,
        cmc
      FROM v_almoxarifado_grid_atual
      WHERE local = $1
        AND (COALESCE(saldo,0) > 0 OR COALESCE(fisico,0) > 0 OR COALESCE(reservado,0) > 0)
      ORDER BY codigo
    `, [local]);

    const dados = rows.map(r => ({
      codigo   : r.codigo || '',
      descricao: r.descricao || '',
      min      : Number(r.min)       || 0,
      fisico   : Number(r.fisico)    || 0,
      reservado: Number(r.reservado) || 0,
      saldo    : Number(r.saldo)     || 0,
      cmc      : Number(r.cmc)       || 0,
    }));

    res.json({ ok:true, local, pagina:1, totalPaginas:1, dados });
  } catch (err) {
    console.error('[almoxarifado SQL]', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});



// ------------------------------------------------------------------
// Alias: /api/omie/produto  →  mesma lógica de /api/omie/produtos
// ------------------------------------------------------------------
app.post('/api/omie/produto', async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      {
        call:       req.body.call,    // ex.: "ConsultarProduto"
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    return res.json(data);
  } catch (err) {
    console.error('[produto] erro →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});

// ─── Rota para ConsultarCliente ───
app.post('/api/omie/cliente', express.json(), async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/clientes/',
      {
        call:       'ConsultarCliente',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    return res.json(data);
  } catch (err) {
    console.error('[cliente] erro →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});


// ─── Rota para ConsultarPedido ───
// ─── Rota para ConsultarPedido (com debug) ───
app.post('/api/omie/pedido', express.json(), async (req, res) => {
  console.log('[pedido] body recebido →', JSON.stringify(req.body, null, 2));
  console.log('[pedido] chaves Omie →', OMIE_APP_KEY, OMIE_APP_SECRET ? 'OK' : 'MISSING');
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/produtos/pedido/',
      {
        call:       'ConsultarPedido',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    console.log('[pedido] resposta OMIE →', JSON.stringify(data, null, 2));
    return res.json(data);
  } catch (err) {
    console.error('[pedido] erro ao chamar OMIE →', err.faultstring || err.message, err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});


// ─── Proxy manual para ObterEstoqueProduto ───
app.post('/api/omie/estoque/resumo', express.json(), async (req, res) => {
  console.log('[server][estoque/resumo] req.body.param:', req.body.param);
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/estoque/resumo/',
      {
        call:       'ObterEstoqueProduto',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      }
    );
    console.log('[server][estoque/resumo] OMIE respondeu:', data);
    return res.json(data);
  } catch (err) {
    console.error('[server][estoque/resumo] ERRO →', err);
    return res
      .status(err.status || 500)
      .json({ error: err.faultstring || err.message });
  }
});


// server.js (ou onde você centraliza as rotas OMIE)

// Rota para servir de proxy à chamada de PosicaoEstoque do OMIE
app.post('/api/omie/estoque/consulta', express.json(), async (req, res) => {
  console.log('[estoque/consulta] req.body →', JSON.stringify(req.body, null, 2));
  try {
    const omieResponse = await fetch('https://app.omie.com.br/api/v1/estoque/consulta/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const text = await omieResponse.text();
    console.log('[estoque/consulta] OMIE responded status', omieResponse.status, 'body:', text);
    if (!omieResponse.ok) {
      return res.status(omieResponse.status).send(text);
    }
    const json = JSON.parse(text);
    return res.json(json);
  } catch (err) {
    console.error('[estoque/consulta] Erro ao chamar OMIE:', err);
    // devolve o erro para o cliente para depuração
    return res.status(err.status || 500).json({
      error: err.faultstring || err.message,
      stack: err.stack
    });
  }
});

// server.js (dentro do seu IIFE, após as outras rotas OMIE)
app.post(
  '/api/omie/contatos-incluir',
  express.json(),
  async (req, res) => {
    const usersFile = path.join(__dirname, 'data', 'users.json');

    // 0) carrega lista local de usuários
    let users = [];
    try {
      users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    } catch (e) {
      // se falhar ao ler, considere vazio
      users = [];
    }

    // 1) extrai o username que vai ser criado
    const newUsername = req.body.identificacao.cCodInt;

    // 2) verifica duplicidade local
    if (users.some(u => u.username.toLowerCase() === newUsername.toLowerCase())) {
      return res
        .status(400)
        .json({ error: `Já existe um usuário com o nome "${newUsername}".` });
    }

    try {
      // 3) chama o OMIE para incluir o contato
      const omieResult = await omieCall(
        'https://app.omie.com.br/api/v1/crm/contatos/',
        {
          call:       'IncluirContato',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [ req.body ]
        }
      );

      // 4) só se OMIE aprovou, insere no users.json
      const newId = users.length
        ? Math.max(...users.map(u => u.id)) + 1
        : 1;

      const plainPwd    = '123';
      const passwordHash = bcrypt.hashSync(plainPwd, 10);

      const { cNome, cSobrenome } = req.body.identificacao;
      const fullName = `${cNome} ${cSobrenome || ''}`.trim();
      const msn = [
        `Seja bem vindo ao SIGFT (Sistema Integrado de Gestão FromTherm) ${fullName}, seja bem vindo.`
      ];

      users.push({
        id:           newId,
        username:     newUsername,
        passwordHash,
        roles:        [],
        msn
      });

      fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');

      // 5) retorna sucesso
      return res.json(omieResult);

    } catch (err) {
      console.error('[contatos-incluir] erro →', err);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);

// logo depois das outras rotas /api/omie/*
app.post(
  '/api/omie/contatos-excluir',
  express.json(),
  async (req, res) => {
    try {
      const { cCodInt } = req.body;
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/crm/contatos/',
        {
          call:       'ExcluirContato',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [ { cCodInt } ]
        }
      );
      console.log('[contatos-excluir] resposta →', data);
      return res.json(data);
    } catch (err) {
      console.error('[contatos-excluir] erro →', err);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);


  app.post('/api/omie/removeNaoListar', (req, res) => {
    const { groupId, prefix } = req.body;
    const csvPath = path.join(__dirname, 'csv', 'Tipo.csv');
    const text    = fs.readFileSync(csvPath, 'utf8');
    const rows    = csvParse(text, { columns: true, skip_empty_lines: true });

    const updated = rows.map(row => {
      if (+row.Grupo === groupId) {
        const arr = row.nao_listar_comeca_com
                      .replace(/(^"|"$)/g,'')
                      .split(',')
                      .filter(s => s && s !== prefix);
        row.nao_listar_comeca_com = arr.join(',');
      }
      return row;
    });

    fs.writeFileSync(csvPath, csvStringify(updated, { header: true }), 'utf8');
    res.json({ ok: true });
  });


  // ——————————————————————————————
  // 3.2) Rotas de autenticação e proxy OMIE
  // ——————————————————————————————
  app.use('/api/omie/login', loginOmie);
  app.use('/api/auth',     authRouter);
  app.use('/api/etiquetas', etiquetasRouter);   // ⬅️  NOVO
  app.use('/api/users', require('./routes/users'));

  app.use('/api/omie/estoque',       estoqueRouter);
  // app.use('/api/omie/estoque/resumo',estoqueResumoRouter);

  app.post('/api/omie/produtos', async (req, res) => {
    console.log('☞ BODY recebido em /api/omie/produtos:', req.body);

    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       req.body.call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


app.post(
  '/api/omie/contatos-alterar',
  express.json(),
  async (req, res) => {
    try {
      // chama a API REST do OMIE para AlterarContato
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/crm/contatos/',
        {
          call:      'AlterarContato',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:     [ req.body ]           // OMIE espera array
        }
      );

     /* ───────────────────────────────────────────────
        Se Inativo = 'S' → troca passwordHash no users.json
     ─────────────────────────────────────────────── */
     const flagInativo = (req.body.telefone_email?.cNumFax || '')
                           .trim().toUpperCase();
     if (flagInativo === 'S') {
       const users   = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
       const username = (req.body.identificacao?.cCodInt || '').toLowerCase();
       const userObj  = users.find(u => u.username.toLowerCase() === username);
       if (userObj && userObj.passwordHash !== INACTIVE_HASH) {
         userObj.passwordHash = INACTIVE_HASH;
         fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
         console.log(`[Inativo] passwordHash redefinido para ${username}`);
       }
     }

      return res.json(data);

    } catch (err) {
      console.error('[contatos-alterar] erro →', err);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);


  app.post('/api/omie/familias', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/familias/',
        {
          call:       req.body.call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/omie/caracteristicas', async (req, res) => {
    try {
      const { call, param } = req.body;
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/caracteristicas/',
        {
          call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/omie/prodcaract', async (req, res) => {
    try {
      const { call, param } = req.body;
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/prodcaract/',
        {
          call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


  // ——————————————————————————————
  // 3.3) Rotas de produtos e características
  // ——————————————————————————————
  app.get('/api/produtos/detalhes/:codigo', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'ConsultarProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [{ codigo: req.params.codigo }]
        }
      );
      return res.json(data);
    } catch (err) {
      if (err.message.includes('faultstring')) {
        return res.json({ error: 'Produto não cadastrado' });
      }
      return res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/produtos/alterar', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'UpsertProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [req.body.produto_servico_cadastro]
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/prodcaract/alterar', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/prodcaract/',
        {
          call:       'AlterarCaractProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


  // ——————————————————————————————
  // 3.4) Rotas de “malha” (estrutura de produto)
  // ——————————————————————————————
  app.post('/api/malha', async (req, res) => {
    try {
      const result = await require('./routes/helpers/malhaEstrutura')(req.body);
      res.json(result);
    } catch (err) {
      if (err.message.includes('Client-103') || err.message.includes('não encontrado')) {
        return res.json({ itens: [] });
      }
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.post('/api/omie/malha', async (req, res) => {
    try {
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/malha/',
        {
          call:       req.body.call,
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


// dentro do seu IIFE, logo após:
//   app.post('/api/omie/malha', …)
// e antes de: app.use('/api/malha/consultar', malhaConsultar);
app.post(
  '/api/omie/estrutura',
  express.json(),
  async (req, res) => {
    try {
      // chama o OMIE /geral/malha/ com call=ConsultarEstrutura
      const data = await omieCall(
        'https://app.omie.com.br/api/v1/geral/malha/',
        {
          call:       'ConsultarEstrutura',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      req.body.param
        }
      );
      return res.json(data);
    } catch (err) {
      console.error('[estrutura] erro →', err.faultstring || err.message);
      return res
        .status(err.status || 500)
        .json({ error: err.faultstring || err.message });
    }
  }
);



  app.use('/api/malha/consultar', malhaConsultar);


  // ——————————————————————————————
  // 3.5) Upload / Deleção de fotos
  // ——————————————————————————————
  app.post(
    '/api/produtos/:codigo/foto',
    upload.single('file'),
    async (req, res) => {
      try {
        const { codigo } = req.params;
        const index      = parseInt(req.body.index, 10);
        const file       = req.file;
        const ext        = file.mimetype.split('/')[1];
        const safeLabel  = req.body.label.replace(/[\/\\?#]/g, '-');
        const filename   = `${safeLabel} ${codigo}.${ext}`;
        const ghPath     = `${GITHUB_PATH}/${filename}`;

        let sha;
        try {
          const { data } = await octokit.repos.getContent({
            owner: GITHUB_OWNER,
            repo:  GITHUB_REPO,
            path:  ghPath,
            ref:   GITHUB_BRANCH
          });
          sha = data.sha;
        } catch (err) {
          if (err.status !== 404) throw err;
        }

        await octokit.repos.createOrUpdateFileContents({
          owner:   GITHUB_OWNER,
          repo:    GITHUB_REPO,
          branch:  GITHUB_BRANCH,
          path:    ghPath,
          message: `Atualiza ${req.body.label} do produto ${codigo}`,
          content: file.buffer.toString('base64'),
          sha
        });

        const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${encodeURIComponent(ghPath)}`;
        const produto = await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'ConsultarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo }]
          }
        );

        const imgs = (produto.imagens || []).map(i => i.url_imagem);
        if (!isNaN(index) && index >= 0 && index < imgs.length) {
          imgs[index] = rawUrl;
        } else {
          imgs.push(rawUrl);
        }

        await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'AlterarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo, imagens: imgs.map(u => ({ url_imagem: u })) }]
          }
        );

        res.json({ imagens: imgs });
      } catch (err) {
        console.error('Erro no upload GitHub/Omie:', err);
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

  app.post(
    '/api/produtos/:codigo/foto-delete',
    express.json(),
    async (req, res) => {
      try {
        const { codigo } = req.params;
        const { index }  = req.body;
        const rawLogo    = `${req.protocol}://${req.get('host')}/img/logo.png`;

        const produto = await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'ConsultarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo }]
          }
        );
        const imgs = (produto.imagens || []).map(i => i.url_imagem);
        if (index >= 0 && index < imgs.length) {
          imgs[index] = rawLogo;
        }

        await omieCall(
          'https://app.omie.com.br/api/v1/geral/produtos/',
          {
            call:       'AlterarProduto',
            app_key:    OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:      [{ codigo, imagens: imgs.map(u => ({ url_imagem: u })) }]
          }
        );

        res.json({ imagens: imgs });
      } catch (err) {
        console.error('Erro ao deletar foto no Omie:', err);
        res.status(err.status || 500).json({ error: err.message });
      }
    }
  );

// substitua seu fetch manual por isto:
// dentro do seu IIFE em server.js, antes de app.use(express.static)
app.post(
  '/api/omie/anexo-file',
  upload.single('file'),
  async (req, res) => {
    try {
      const file     = req.file;
      const filename = file.originalname;
      // o client envia req.body.param como JSON-stringify
      const param0   = (req.body.param && JSON.parse(req.body.param)[0]) || {};
      const nId      = Number(param0.nId);
      const cCodInt  = param0.cCodIntAnexo;
      const cTabela  = param0.cTabela;

      // 1) monta o ZIP em memória de forma determinística
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks  = [];
      archive.on('data', chunk => chunks.push(chunk));
      archive.append(file.buffer, {
        name: filename,
        date: new Date(0)           // força timestamp constante
      });
      await archive.finalize();
      const zipBuffer = Buffer.concat(chunks);
      const base64Zip = zipBuffer.toString('base64');

      // 2) calcula MD5 do ZIP
      const md5zip = crypto
        .createHash('md5')
        .update(zipBuffer)
        .digest('hex');

      // 3) prepara o objeto comum de param
      const buildParam = md5 => ({
        cCodIntAnexo: cCodInt,
        cTabela,
        nId,
        cNomeArquivo: filename,
        cTipoArquivo: filename.split('.').pop(),
        cMd5:         md5,
        cArquivo:     base64Zip
      });

      // 4) tentativa única, ou fallback se o OMIE reclamar do MD5
      let resultado;
      try {
        resultado = await omieCall(
          'https://app.omie.com.br/api/v1/geral/anexo/',
          {
            call:     'IncluirAnexo',
            app_key:  OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param:    [ buildParam(md5zip) ]
          }
        );
      } catch (err) {
        // extrai o MD5 que o OMIE esperava
        const msg = err.faultstring || err.message || '';
        const m   = msg.match(/Esperado\s+o\s+MD5\s*\[([0-9a-f]+)\]/i);
        if (m && m[1]) {
          // refaz a chamada com o MD5 “mágico”
          resultado = await omieCall(
            'https://app.omie.com.br/api/v1/geral/anexo/',
            {
              call:     'IncluirAnexo',
              app_key:  OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET,
              param:    [ buildParam(m[1]) ]
            }
          );
        } else {
          throw err;
        }
      }

      return res.json(resultado);
    } catch (err) {
      console.error('🔥 Erro no /api/omie/anexo-file:', err);
      return res
        .status(500)
        .json({ error: 'Falha ao processar anexo', details: err.faultstring || err.message });
    }
  }
);
// Listar anexos
app.post('/api/omie/anexo-listar', express.json(), async (req, res) => {
  try {
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/anexo/',
      {
        call:    'ListarAnexo',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [ req.body ] // { cTabela, nId, cCodIntAnexo? }
      }
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Excluir anexo
app.post('/api/omie/anexo-excluir', express.json(), async (req, res) => {
  try {
    const { cTabela, nId, cCodIntAnexo, nIdAnexo } = req.body;
    const data = await omieCall(
      'https://app.omie.com.br/api/v1/geral/anexo/',
      {
        call:    'ExcluirAnexo',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ cTabela, nId, cCodIntAnexo, nIdAnexo }]
      }
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obter o link do anexo (cLinkDownload) via OMIE “ObterAnexo”
app.post('/api/omie/anexo-obter', express.json(), async (req, res) => {
  try {
    const { cTabela, nId, cCodIntAnexo, cNomeArquivo } = req.body;
    // monta o objeto de param aceitando _ou_ cCodIntAnexo _ou_ cNomeArquivo
    const paramObj = { cTabela, nId };
    if (cNomeArquivo) paramObj.cNomeArquivo = cNomeArquivo;
    else              paramObj.cCodIntAnexo = cCodIntAnexo;

    const result = await omieCall(
      'https://app.omie.com.br/api/v1/geral/anexo/',
      {
        call:      'ObterAnexo',
        app_key:   OMIE_APP_KEY,
        app_secret:OMIE_APP_SECRET,
        param:     [ paramObj ]
      }
    );

    // OMIE devolve array com 1 objeto
    const obj = Array.isArray(result) ? result[0] : result;
    return res.json({
      cLinkDownload: obj.cLinkDownload,
      cTipoArquivo:  obj.cTipoArquivo,
      cNomeArquivo:  obj.cNomeArquivo
    });
  } catch (err) {
    console.error('Erro em /api/omie/anexo-obter:', err);
    res.status(err.status || 500).json({ error: err.faultstring || err.message });
  }
});


// Proxy ViaCEP para evitar problemas de CORS
app.get('/api/viacep/:cep', async (req, res) => {
  try {
    const cep = req.params.cep.replace(/\D/g, '');
    const viacepRes = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!viacepRes.ok) {
      return res.status(viacepRes.status).json({ error: 'ViaCEP retornou erro' });
    }
    const data = await viacepRes.json();
    return res.json(data);
  } catch (err) {
    console.error('Erro no proxy ViaCEP:', err);
    return res.status(500).json({ error: err.message });
  }
});


// ——— Helpers de carimbo de usuário/data ————————————————
function userFromReq(req) {
  // tente extrair do seu objeto de sessão; ajuste se o seu auth usar outro nome/campo
  return (req.session?.user?.fullName)
      || (req.session?.user?.username)
      || 'Not-user';
}
function stampNowBR() {
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} - ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function buildStamp(prefix, req) {
  return `${prefix} - ${userFromReq(req)} - ${stampNowBR()}`;
}

// ────────────────────────────────────────────
// 4) Sirva todos os arquivos estáticos (CSS, JS, img) normalmente
// ────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ────────────────────────────────────────────
// 5) Só para rotas HTML do seu SPA, devolva o index
// ────────────────────────────────────────────
// Isso não intercepta /menu_produto.js, /requisicoes_omie/xx.js, etc.
app.get(['/', '/menu_produto.html', '/kanban/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'menu_produto.html'));
});

app.post('/api/produtos/caracteristicas-aplicar-teste', express.json(), async (req, res) => {
  try {
    const csvPath = path.join(__dirname, 'produtos', 'dadosEtiquetasMaquinas - dadosFT.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const linhas = csvParse(csvContent, { delimiter: ',', from_line: 1 });

    const headers = linhas[0]; // Cabeçalho
    const resultados = [];

    const app_key = process.env.OMIE_APP_KEY;
    const app_secret = process.env.OMIE_APP_SECRET;

    // Percorre da linha 2 em diante
    for (let linhaIndex = 1; linhaIndex < linhas.length; linhaIndex++) {
      const valores = linhas[linhaIndex];
      const codigoProduto = valores[0]; // Coluna A

      if (!codigoProduto?.trim()) break; // parou ao encontrar linha vazia

      for (let i = 2; i <= 24; i++) { // Colunas C a Y
        const caract = headers[i];
        let conteudo = valores[i];
if (conteudo?.endsWith('_7E')) {
  conteudo = conteudo.replace('_7E', '~');
}

        if (!caract?.trim() || !conteudo?.trim()) continue;

        const body = {
          call: 'IncluirCaractProduto',
          app_key,
          app_secret,
          param: [{
            cCodIntProd:        codigoProduto,
            cCodIntCaract:      caract,
            cConteudo:          conteudo,
            cExibirItemNF:      'N',
            cExibirItemPedido:  'N',
            cExibirOrdemProd:   'N'
          }]
        };

        const resp = await fetch('https://app.omie.com.br/api/v1/geral/prodcaract/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const json = await resp.json();
        resultados.push({
          produto: codigoProduto,
          caract,
          conteudo,
          resposta: json
        });

        await new Promise(r => setTimeout(r, 350)); // respeita limite
      }
    }

    res.json({ total: resultados.length, resultados });
  } catch (err) {
    console.error('[caracteristicas-aplicar-teste] erro:', err);
    res.status(500).json({ error: 'Erro ao aplicar características em múltiplos produtos' });
  }
});

app.get('/api/preparacao/listar', async (req, res) => {
  try {
    // garante a tabela de overlay
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.op_status_overlay (
        op         text PRIMARY KEY,
        status     text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // status_raw = overlay → op_status → view
    const { rows } = await pool.query(`
      WITH src AS (
        SELECT
          v.op,
          v.c_cod_int_prod AS produto_codigo,
          COALESCE(ov.status, os.status, v.kanban_coluna) AS status_raw
        FROM public.kanban_preparacao_view v
        LEFT JOIN public.op_status_overlay ov ON ov.op = v.op
        LEFT JOIN public.op_status        os ON os.op = v.op
      )
      SELECT DISTINCT
        op,
        produto_codigo,
        CASE
          WHEN lower(status_raw) IN ('a produzir','fila de produção','fila de producao')      THEN 'A Produzir'
          WHEN lower(status_raw) IN ('produzindo','em produção','em producao','30')           THEN 'Produzindo'
          WHEN lower(status_raw) IN ('teste 1','teste1')                                       THEN 'teste 1'
          WHEN lower(status_raw) IN ('teste final','testefinal')                               THEN 'teste final'
          WHEN lower(status_raw) IN ('concluido','concluído','60','80')                        THEN 'concluido'
          ELSE status_raw
        END AS status
      FROM src
      ORDER BY status, op
    `);

    const data = {
      'A Produzir':  [],
      'Produzindo':  [],
      'teste 1':     [],
      'teste final': [],
      'concluido':   []
    };

    for (const r of rows) {
      if (!data[r.status]) data[r.status] = [];
      data[r.status].push({ op: r.op, produto_codigo: r.produto_codigo });
    }

    res.json({ mode: 'pg', data });
  } catch (err) {
    console.error('[preparacao/listar] erro:', err);
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});




// Comercial: lista itens por coluna a partir do Postgres
app.get('/api/kanban/comercial/listar', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isDbEnabled) {
    return res.status(503).json({ error: 'Banco de dados não configurado.' });
  }
  try {
    const { rows } = await dbQuery(`
      SELECT
        numero_pedido   AS pedido,
        produto_codigo  AS codigo,
        quantidade,
        kanban_coluna   AS status
      FROM kanban_comercial_view
      ORDER BY kanban_coluna, numero_pedido, produto_codigo
    `);

    const data = {
      'Pedido aprovado'     : [],
      'Separação logística' : [],
      'Fila de produção'    : []
    };

    for (const r of rows) {
      if (!data[r.status]) continue; // ignora status não mapeado
      data[r.status].push({
        pedido: r.pedido,
        codigo: r.codigo,
        quantidade: r.quantidade,
        status: r.status
      });
    }
    return res.json({ mode: 'pg', data });
  } catch (err) {
    console.error('[comercial/listar] erro:', err);
    return res.status(500).json({ error: err.message || 'Erro ao consultar comercial no banco' });
  }
});


// ——— Kanban Preparação – backfill de códigos (1 só rota, rápida, usando produtos já no DB) ———
async function runBackfillCodigos() {
  if (!isDbEnabled) {
    return { ok:false, error:'DB desativado neste modo' };
  }
  const sql = `
    WITH m AS (
      SELECT
        i.n_cod_op,
        i.n_cod_prod,
        COALESCE(p.codigo, p.codigo_familia, p.codigo_produto::text) AS novo_codigo
      FROM public.op_info i
      JOIN public.produtos p
            ON p.codigo_produto::text = i.n_cod_prod::text
      WHERE (i.produto_codigo IS NULL OR i.produto_codigo ~ '^[0-9]+$')
        AND i.n_cod_prod IS NOT NULL
    )
    UPDATE public.op_info i
       SET produto_codigo = m.novo_codigo,
           updated_at     = now()
      FROM m
     WHERE i.n_cod_op = m.n_cod_op
    RETURNING i.n_cod_op, i.n_cod_prod, i.produto_codigo;
  `;
  const { rows } = await dbQuery(sql);
  return { ok:true, total: rows.length, atualizados: rows.length, exemplos: rows.slice(0,5) };
}

// Disponibiliza tanto POST quanto GET (facilita testar no Render)
app.post('/api/preparacao/backfill-codigos', async (req, res) => {
  try {
    const out = await runBackfillCodigos();
    res.json(out);
  } catch (e) {
    console.error('[backfill-codigos]', e);
    res.status(500).json({ ok:false, error:String(e.message||e) });
  }
});

app.get('/api/preparacao/backfill-codigos', async (req, res) => {
  try {
    const out = await runBackfillCodigos();
    res.json(out);
  } catch (e) {
    console.error('[backfill-codigos][GET]', e);
    res.status(500).json({ ok:false, error:String(e.message||e) });
  }
});

async function ensureOverlayTable() {
  // Cria se não existir (idempotente)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.op_status_overlay (
      op         text PRIMARY KEY,
      status     text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
ensureOverlayTable()
  .then(() => console.log('[db] op_status_overlay pronto'))
  .catch(err => console.warn('[db] overlay: falha ao garantir tabela:', err?.message || err));


// ====== COMERCIAL: Importador de Pedidos (OMIE → Postgres) ======
const PV_REGS_PER_PAGE = 200;

async function omiePedidosListarPagina(pagina, filtros = {}) {
  const payload = {
    call: 'ListarPedidos',
    app_key: process.env.OMIE_APP_KEY,
    app_secret: process.env.OMIE_APP_SECRET,
    param: [{
      pagina,
      registros_por_pagina: PV_REGS_PER_PAGE,
      ...(filtros.data_de  ? { data_previsao_de:  toOmieDate(filtros.data_de) }  : {}),
      ...(filtros.data_ate ? { data_previsao_ate: toOmieDate(filtros.data_ate) } : {}),
      ...(filtros.etapa    ? { etapa: String(filtros.etapa) }                     : {}) // <- AQUI
    }]
  };
  return omiePost('https://app.omie.com.br/api/v1/produtos/pedido/', payload);
}


// ====== COMERCIAL: leitura do Kanban (somente "Pedido aprovado" = etapa 80)
app.get('/api/comercial/pedidos/kanban', async (req, res) => {
  try {
// substitua a query da rota /api/comercial/pedidos/kanban por esta:
const r = await pool.query(`
  SELECT
    p.codigo_pedido,
    p.numero_pedido,
    p.numero_pedido_cliente,
    p.codigo_cliente,
    p.etapa,
    p.data_previsao,                                -- date “cru”
    to_char(p.data_previsao, 'DD/MM/YYYY') AS data_previsao_br, -- pronto p/ tela
    p.valor_total_pedido,
    i.seq,
    i.codigo        AS produto_codigo_txt,
    i.descricao     AS produto_descricao,
    i.quantidade,
    i.unidade
  FROM public.pedidos_venda p
  LEFT JOIN public.pedidos_venda_itens i
    ON i.codigo_pedido = p.codigo_pedido
  WHERE p.etapa = '80'
  ORDER BY p.data_previsao NULLS LAST, p.codigo_pedido DESC, i.seq ASC
  LIMIT 500
`);
return res.json({ ok:true, colunas: { "Pedido aprovado": r.rows } });

  } catch (e) {
    console.error('[kanban comercial etapa 80] erro:', e);
    return res.status(500).json({ ok:false, error: String(e?.message||e) });
  }
});


app.post('/api/comercial/pedidos/importar', express.json(), async (req, res) => {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
    }
  const { data_de, data_ate, max_paginas = 999, etapa } = req.body || {};
    let pagina = 1, totalPaginas = 1, totalRegistros = 0, importados = 0;

    while (pagina <= totalPaginas && pagina <= Number(max_paginas)) {
      const lote = await omiePedidosListarPagina(pagina, { data_de, data_ate, etapa });
      pagina++;
      totalPaginas   = Number(lote.total_de_paginas || 1);
      totalRegistros = Number(lote.total_de_registros || 0);
      const arr = Array.isArray(lote.pedido_venda_produto) ? lote.pedido_venda_produto : [];

      for (const pedido of arr) {
        await pool.query('select public.pedido_upsert_from_payload($1::jsonb)', [pedido]);
        importados++;
      }
    }

    // avisa consumidores SSE (se houver)
    req.app.get('sseBroadcast')?.({ type:'pedidos_changed', at: Date.now() });

    return res.json({ ok:true, mode:'postgres', total_registros: totalRegistros, importados });
  } catch (e) {
    console.error('[importar Pedidos] erro:', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});


// === KANBAN COMERCIAL (Render) — monta via OMIE e retorna no formato do JSON local ===
app.get('/api/kanban/sync', async (req, res) => {
  try {
    // Ajuste estas 3 linhas conforme seu projeto:
    const OMIE_APP_KEY    = process.env.OMIE_APP_KEY    || (global.config && global.config.OMIE_APP_KEY);
    const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || (global.config && global.config.OMIE_APP_SECRET);
    const COD_LOCAL_ESTOQUE = Number(process.env.COD_LOCAL_ESTOQUE) || 10564345392; // ← ajuste se necessário

    if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return res.status(500).json({ error: 'OMIE_APP_KEY/SECRET ausentes no servidor.' });
    }

    const hojeBR = (() => {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = d.getFullYear();
      return `${dd}/${mm}/${yy}`;
    })();

    const sleep = ms => new Promise(s => setTimeout(s, ms));

    // 1) ListarPedidos (etapa 80 = aprovado)
    const payloadLP = {
      call: 'ListarPedidos',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ pagina: 1, registros_por_pagina: 100, etapa: '80', apenas_importado_api: 'N' }]
    };

    const rp = await fetch('https://app.omie.com.br/api/v1/produtos/pedido/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadLP)
    });
    if (!rp.ok) {
      const msg = await rp.text().catch(() => '');
      return res.status(502).json({ error: 'OMIE ListarPedidos falhou', status: rp.status, body: msg });
    }
const dataLP = await rp.json();

const todos = Array.isArray(dataLP.pedido_venda_produto)
  ? dataLP.pedido_venda_produto
  : [];

// 🔒 Garantia: só etapa 80 (Aprovado). Itens em 70 (Em aprovação) ficam fora.
const pedidos = todos.filter(p => String(p?.cabecalho?.etapa) === '80');


    // 2) Monta itens no MESMO formato do kanban.json
    const items = [];
    for (const p of pedidos) {
      const np = p?.cabecalho?.numero_pedido;
      const dets = Array.isArray(p?.det) ? p.det : [];
      for (const det of dets) {
        const codigo  = det?.produto?.codigo;
        const id_prod = det?.produto?.codigo_produto;
        const qtd     = Number(det?.produto?.quantidade) || 0;
        if (!np || !codigo || !id_prod || !qtd) continue;

        // 2.1) Consulta estoque (PosicaoEstoque)
        let estoque = 0;
        try {
          const payloadEst = {
            call: 'PosicaoEstoque',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
              codigo_local_estoque: COD_LOCAL_ESTOQUE,
              id_prod,
              cod_int: codigo,
              data: hojeBR
            }]
          };
          const re = await fetch('https://app.omie.com.br/api/v1/estoque/consulta/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadEst)
          });
          const je = re.ok ? await re.json() : {};
          estoque = je.saldo ?? je.posicao?.[0]?.saldo_atual ?? 0;
        } catch {
          estoque = 0;
        }

        items.push({
          pedido: np,
          codigo,
          quantidade: qtd,
          local: Array(qtd).fill('Pedido aprovado'),
          estoque
        });

        // Respeita limite de chamadas da OMIE
        await sleep(250);
      }
    }

    // 3) Retorna no mesmo formato do JSON local (array de itens)
    return res.json(items);
  } catch (err) {
    console.error('[api/kanban/sync] erro:', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});


// CSV da preparação (local JSON ou Postgres)
app.get('/api/preparacao/csv', async (req, res) => {
  try {
    const r = await dbQuery(
      `SELECT op, produto_codigo AS produto, status
         FROM op_status
        ORDER BY status, op`
    );
    const rows = r.rows;

    const csv = csvStringify(rows, { header: true, columns: ['op','produto','status'] });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="preparacao.csv"');
    res.send(csv);
  } catch (err) {
    console.error('[preparacao/csv]', err);
    res.status(500).json({ error: err.message || 'Erro ao gerar CSV' });
  }
});

// === WEBHOOK: Pedidos de Venda (Omie) =======================================
// Aceita (A) payload Omie Connect 2.0 { event: { numero_pedido, tipo, ... } }
//     ou (B) um objeto com { cabecalho, det, ... } para upsert direto.
app.post('/webhooks/omie/pedidos', chkOmieToken, express.json(), async (req, res) => {
  try {
    const usarDb = shouldUseDb?.(req) ?? true; // mesmo helper usado nas outras rotas
    let pedObj = null;

    // B1) Se já veio o pedido completo, usa direto
    if (req.body?.cabecalho && req.body?.det) {
      pedObj = req.body;

    // A) Omie Connect: vem algo como { event: { numero_pedido, tipo, ... } }
    } else if (req.body?.event?.numero_pedido) {
      const numero_pedido = String(req.body.event.numero_pedido);
      // consulta 1 pedido completo na Omie
      const data = await omieCall('https://app.omie.com.br/api/v1/produtos/pedido/', {
        call: 'ConsultarPedido',
        app_key:    process.env.OMIE_APP_KEY,
        app_secret: process.env.OMIE_APP_SECRET,
        param: [{ numero_pedido }]
      });
      pedObj = Array.isArray(data?.pedido_venda_produto)
        ? data.pedido_venda_produto[0]
        : data.pedido_venda_produto;
    }

    if (!pedObj) {
      return res.status(400).json({ ok:false, error:'payload inválido (sem pedido nem numero_pedido)' });
    }

    // grava no Postgres (funções que já criamos no SQL)
    if (usarDb) {
      await dbQuery('select public.pedido_upsert_from_payload($1::jsonb)', [pedObj]);
      await dbQuery('select public.pedido_itens_upsert_from_payload($1::jsonb)', [pedObj]);
      return res.json({ ok:true, mode:'postgres', codigo_pedido: pedObj?.cabecalho?.codigo_pedido });
    }

    // fallback (sem DB)
    return res.json({ ok:true, mode:'no-db' });

  } catch (e) {
    console.error('[webhooks/omie/pedidos] erro:', e);
    return res.status(500).json({ ok:false, error: String(e?.faultstring || e?.message || e) });
  }
});

// (Opcional) alias com /api, como já existe para /api/omie/op
app.post('/api/webhooks/omie/pedidos', chkOmieToken, express.json(),
  (req,res) => app._router.handle(req, res, () => {},) // reusa handler acima
);


// .env (ou variável no Render)
// OMIE_WEBHOOK_TOKEN=um_token_bem_secreto

app.post('/api/webhooks/omie/pedidos', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const token = req.query.token || req.headers['x-webhook-token'];
    if (!token || token !== process.env.OMIE_WEBHOOK_TOKEN) {
      return res.status(401).json({ ok:false, error:'unauthorized' });
    }

    // normaliza: aceita objeto ou wrapper com "pedido_venda_produto"
    const body = req.body || {};
    const wrapper = body.pedido_venda_produto ? body : { pedido_venda_produto: [body] };

    const r = await pool.query('SELECT public.pedidos_upsert_from_list($1::jsonb) AS n;', [wrapper]);
    const n = r.rows?.[0]?.n ?? 0;

    // responda rápido para não estourar timeout do Omie
    return res.json({ ok:true, upserts:n });
  } catch (err) {
    console.error('[WEBHOOK][OMIE] erro:', err);
    // mesmo em erro, responda 200 para evitar desativação; loga tudo
    return res.status(200).json({ ok:false, error:String(err.message||err) });
  }
});

  // ——————————————————————————————
  // 5) Inicia o servidor
  // ——————————————————————————————
const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});


})();




// DEBUG: lista as rotas registradas
app.get('/__routes', (req, res) => {
  const list = [];
  app._router.stack.forEach((m) => {
    if (m.route && m.route.path) {
      list.push({ methods: m.route.methods, path: m.route.path });
    } else if (m.name === 'router' && m.handle?.stack) {
      m.handle.stack.forEach((h) => {
        if (h.route?.path) list.push({ methods: h.route.methods, path: h.route.path });
      });
    }
  });
  res.json({ ok: true, routes: list });
});

// DEBUG: sanity check do webhook (GET simples)
app.get('/webhooks/omie/pedidos', (req, res) => {
  res.json({ ok: true, method: 'GET', msg: 'rota existe (POST é o real)' });
});

// DEBUG: lista as rotas registradas
app.get('/__routes', (req, res) => {
  const list = [];
  app._router?.stack?.forEach(m => {
    if (m.route?.path) list.push({ methods: m.route.methods, path: m.route.path });
    else if (m.name === 'router' && m.handle?.stack) {
      m.handle.stack.forEach(h => {
        if (h.route?.path) list.push({ methods: h.route.methods, path: h.route.path });
      });
    }
  });
  res.json({ ok: true, routes: list });
});

// DEBUG: checagem simples do webhook (GET)
app.get('/webhooks/omie/pedidos', (req, res) => {
  res.json({ ok: true, method: 'GET', msg: 'rota existe (POST é o real)' });
});
