// server.js
// Carrega as variáveis de ambiente definidas em .env
// no topo do intranet/server.js
require('dotenv').config();
const OMIE_WEBHOOK_TOKEN = process.env.OMIE_WEBHOOK_TOKEN || null; // se NULL, não exige token
// Em server.js (topo do arquivo)
// chave: id da etiqueta (p.ex. número da OP), valor: { fileName, printed: boolean }
// local padrão para a UI (pode setar ALMOX_LOCAL_PADRAO no Render)
const ALMOX_LOCAL_PADRAO     = process.env.ALMOX_LOCAL_PADRAO     || '10408201806';
const PRODUCAO_LOCAL_PADRAO  = process.env.PRODUCAO_LOCAL_PADRAO  || '10564345392';
// outros requires de rotas...





// ——————————————————————————————
// 1) Imports e configurações iniciais
// ——————————————————————————————
const express = require('express');
const session       = require('express-session');
const fs  = require('fs');           // todas as funções sync
const fsp = fs.promises;            // parte assíncrona (equivale a fs/promises)
const path          = require('path');
const multer        = require('multer');
// logo após os outros requires:
const archiver = require('archiver');
const crypto   = require('crypto');
const uuid     = () => crypto.randomUUID();
const XLSX     = require('xlsx');
// (se você usar fetch no Node <18, também faça: const fetch = require('node-fetch');)
const { parse: csvParse }         = require('csv-parse/sync');
const estoquePath = path.join(__dirname, 'data', 'estoque_acabado.json');
if (!globalThis.fetch) {
  globalThis.fetch = require("node-fetch");
}
const safeFetch = (...args) => globalThis.fetch(...args);
global.safeFetch = (...args) => globalThis.fetch(...args);
const app = express();
const axios = require('axios');
const http  = require('http');
const https = require('https');
// ===== Ingestão inicial de OPs (Omie → Postgres) ============================
const OP_REGS_PER_PAGE = 200; // ajuste fino: 100~500 (Omie aceita até 500)

// ==== SSE (Server-Sent Events) para avisar o front ao vivo ==================
const sseClients = new Set();
// server.js — sessão/cookies (COLE ANTES DAS ROTAS!)

// 🔐 Sessão (cookies) — DEVE vir antes das rotas /api/*
const isProd = process.env.NODE_ENV === 'production';
const callOmieDedup = require('./utils/callOmieDedup');
app.set('trust proxy', 1); // necessário no Render (proxy) para cookie Secure funcionar
app.use(express.json({ limit: '5mb' })); // precisa vir ANTES de app.use('/api/auth', ...)

// server.js (antes das rotas HTML)
app.use('/pst_prep_eletrica',
  express.static(path.join(__dirname, 'pst_prep_eletrica'), { etag:false, maxAge:'1h' })
);


app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'troque-isto-em-producao',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,                    // true em produção (HTTPS), false em dev local (HTTP)
    maxAge: 7 * 24 * 60 * 60 * 1000    // 7 dias
  }
}));

app.use('/api/nav', require('./routes/nav'));

// Registra endpoints de Qualidade (Consulta Abertura de OS)
app.use('/api/qualidade', require('./routes/qualidade'));

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
  req.on('close', () => {
    try { console.debug('[sse] conexão encerrada pelo cliente'); } catch {}
    clean();
  });
  res.on('error', (err) => {
    try { console.warn('[sse] erro na conexão SSE:', err?.message || err); } catch {}
    clean();
  });
});

// Conexão Postgres (Render)
const { Pool } = require('pg');
const { spawn, execFile, exec } = require('child_process');

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
  GITHUB_PATH,
  IAPP_TOKEN,
  IAPP_SECRET,
  IAPP_DOMAIN,
  IAPP_INSECURE
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
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

// retry simples para 500 BG
// retry com tratamento para "Consumo redundante" do Omie
async function withRetry(fn, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);

      // Caso clássico do Omie: mesmo payload repetido em < 30s
      if (/Consumo redundante/i.test(msg) || /SOAP-ENV:Client-6/.test(msg)) {
        // o Omie fala "aguarde 30 segundos": espera um pouco mais e tenta de novo
        await new Promise(r => setTimeout(r, 35000));
        continue;
      }

      // BG do Omie às vezes devolve "Broken response"/timeout → retry curto
      if (/Broken response|timeout/i.test(msg)) {
        await new Promise(r => setTimeout(r, [300, 800, 1500][i] || 1500));
        continue;
      }

      // outros erros: não insistir
      throw e;
    }
  }
  throw lastErr;
}


// === NAV SYNC =====================================================
// Precisa estar DEPOIS de app.use(session(...)) e app.use(express.json())

function ensureLoggedIn(req, res, next) {
  if (req.session && req.session.user && req.session.user.id) return next();
  return res.status(401).json({ error: 'Não autenticado' });
}

app.post('/api/nav/sync', ensureLoggedIn, async (req, res) => {
  try {
    const { nodes } = req.body || {};
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return res.json({ ok: true, updated: 0 });
    }

    // upsert de nós (key única), resolvendo parent por parentKey se vier
    // usa transação simples p/ evitar FK quebrada
    await pool.query('BEGIN');

    // cache de {key->id} para resolver parent mais tarde
    const ids = new Map();

    // 1) garanta todos os pais (sem parent) primeiro
    for (const n of nodes.filter(n => !n.parentKey)) {
      const r = await pool.query(
        `INSERT INTO public.nav_node(key,label,position,parent_id,sort,active,selector)
         VALUES ($1,$2,$3,NULL,COALESCE($4,0),TRUE,$5)
         ON CONFLICT (key) DO UPDATE
            SET label=EXCLUDED.label, position=EXCLUDED.position,
                sort=EXCLUDED.sort, active=TRUE, selector=EXCLUDED.selector
         RETURNING id,key`,
        [n.key, n.label, n.position, n.sort ?? 0, n.selector || null]
      );
      ids.set(r.rows[0].key, r.rows[0].id);
    }

    // 2) agora os que têm pai
    for (const n of nodes.filter(n => n.parentKey)) {
      // pega id do pai pelo cache; se não tiver, tenta buscar do DB
      let parentId = ids.get(n.parentKey);
      if (!parentId) {
        const p = await pool.query('SELECT id FROM public.nav_node WHERE key=$1', [n.parentKey]);
        parentId = p.rows[0]?.id || null;
      }
      const r = await pool.query(
        `INSERT INTO public.nav_node(key,label,position,parent_id,sort,active,selector)
         VALUES ($1,$2,$3,$4,COALESCE($5,0),TRUE,$6)
         ON CONFLICT (key) DO UPDATE
            SET label=EXCLUDED.label, position=EXCLUDED.position,
                parent_id=EXCLUDED.parent_id, sort=EXCLUDED.sort,
                active=TRUE, selector=EXCLUDED.selector
         RETURNING id,key`,
        [n.key, n.label, n.position, parentId, n.sort ?? 0, n.selector || null]
      );
      ids.set(r.rows[0].key, r.rows[0].id);
    }

    await pool.query('COMMIT');
    res.json({ ok: true, updated: ids.size });
  } catch (e) {
    await pool.query('ROLLBACK').catch(()=>{});
    console.error('[nav/sync]', e);
    res.status(500).json({ error: 'Falha ao sincronizar navegação' });
  }
});

// Timeout p/ chamadas OMIE (evita pendurar quando o BG "trava")
// Implementado com axios + agentes sem keepAlive + timeout manual/AbortController
async function omiePost(url, payload, timeoutMs = 15000) {
  console.log('[omiePost] Iniciando POST:', { url, timeoutMs, call: payload.call });
  // Forçar uso do fallback com https.request (axios tem travado neste ambiente)
  return omiePostHttpFallback(url, payload, timeoutMs);
}

// Fallback de POST usando https.request puro com timeout rígido
function omiePostHttpFallback(urlStr, payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const lib = isHttps ? require('https') : require('http');
      const body = Buffer.from(JSON.stringify(payload), 'utf8');
      const options = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close',
          'Content-Length': body.length
        },
        agent: new (isHttps ? require('https').Agent : require('http').Agent)({ keepAlive: false })
      };
      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          clearTimeout(overallTimer);
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`Omie HTTP ${res.statusCode} – ${text.slice(0,200)}`));
          }
          try {
            const json = JSON.parse(text || '{}');
            if (json.faultstring || json.faultcode) {
              return reject(new Error(`Omie fault: ${json.faultstring || json.faultcode}`));
            }
            resolve(json);
          } catch (e) {
            reject(new Error('Falha ao parsear JSON da Omie'));
          }
        });
      });
      req.on('error', (err) => { clearTimeout(overallTimer); reject(err); });
      // Timeout de inatividade no socket
      req.setTimeout(timeoutMs + 1000, () => {
        try { req.destroy(new Error('Timeout no socket Omie (fallback)')); } catch {}
      });
      // Timeout geral (inclui DNS)
      const overallTimer = setTimeout(() => {
        try { req.destroy(new Error('Timeout geral na chamada Omie (fallback)')); } catch {}
      }, timeoutMs + 2000);
      req.end(body);
    } catch (e) {
      reject(e);
    }
  });
}

// Chamada GET para IAPP usando https.request com timeout rígido
function iappGetHttp(urlPath, timeoutMs = 15000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
  const base = 'https://api.iniciativaaplicativos.com.br';
      const urlStr = base.replace(/\/$/, '') + '/api' + (urlPath.startsWith('/') ? urlPath : '/' + urlPath);
      const u = new URL(urlStr);
      const lib = require('https');
      const options = {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + (u.search || ''),
        method: 'GET',
        servername: u.hostname, // SNI explícito
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close',
          // Alguns serviços aceitam maiúsculas; outros minúsculas. Enviamos ambos por segurança.
          'Token': IAPP_TOKEN || '',
          'Secret': IAPP_SECRET || '',
          'token': IAPP_TOKEN || '',
          'secret': IAPP_SECRET || '',
          ...extraHeaders
        },
        agent: new lib.Agent({ keepAlive: false, rejectUnauthorized: !IAPP_INSECURE })
      };
      const req = lib.request(options, (res) => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          clearTimeout(overallTimer);
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`IAPP HTTP ${res.statusCode} – ${text.slice(0,200)}`));
          }
          try {
            resolve(JSON.parse(text || '{}'));
          } catch (e) {
            resolve({ raw: text }); // algumas respostas podem não ser JSON
          }
        });
      });
      req.on('error', err => { clearTimeout(overallTimer); reject(err); });
      req.setTimeout(timeoutMs + 1000, () => {
        try { req.destroy(new Error('Timeout no socket IAPP')); } catch {}
      });
      const overallTimer = setTimeout(() => {
        try { req.destroy(new Error('Timeout geral na chamada IAPP')); } catch {}
      }, timeoutMs + 2000);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
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

// === OMIE: incluir OP (compat) =========================================
app.post('/api/omie/op/incluir', express.json(), async (req, res) => {
  try {
    const front = req.body && req.body.call
      ? req.body
      : {
          call      : 'IncluirOrdemProducao',
          app_key   : req.body.app_key,
          app_secret: req.body.app_secret,
          param     : req.body.param
        };

    const r = await require('./utils/omieCall')
      .omieCall('https://app.omie.com.br/api/v1/produtos/op/', front);

    res.json(r);
  } catch (e) {
    res.status(e.status || 500).send(e.message || String(e));
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

// outros requires de rotas...
const produtosFotosRouter = require('./routes/produtosFotos'); // <-- ADICIONE ESTA LINHA

//app.use(require('express').json({ limit: '5mb' }));

app.use('/api/produtos', produtosRouter);

// adiciona o router das fotos no MESMO prefixo:
app.use('/api/produtos', produtosFotosRouter);

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
// 🔐 sessão (cookies) — antes das rotas que usam req.session
app.set('trust proxy', 1); // necessário atrás de proxy (Render) p/ cookie "secure" funcionar

app.use(require('express-session')({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'troque-isto-em-producao',
  resave: false,
  saveUninitialized: false,
  proxy: true,                           // reconhece X-Forwarded-* do Render
  cookie: {
    httpOnly: true,
    sameSite: 'lax',                     // funciona bem com navegação normal
    secure: process.env.NODE_ENV === 'production', // true em prod (HTTPS)
    maxAge: 7 * 24 * 60 * 60 * 1000      // 7 dias
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
const httpFetch = (...args) => globalThis.fetch(...args);

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
    } catch (e) { out.errors.push('[before] '+(e?.message||e)); }

    const beforeStatusRaw = out.before?.[0]?.status || null;
    const beforeStatus = norm(beforeStatusRaw);
    const wasConcluded = beforeStatus === 'concluido';
    const goingToConcluded = target === 'concluido';

    // Credenciais Omie (se existirem)
    const APP_KEY = process.env.OMIE_APP_KEY || process.env.APP_KEY || process.env.OMIE_SECRET;
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
          WHERE op = $1 LIMIT 1`, [op]);
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

// Salva etiqueta no PostgreSQL (sem gerar arquivo)
app.post('/api/etiquetas/salvar-db', express.json(), async (req, res) => {
  try {
        console.log('[POST /api/etiquetas/salvar-db] body=', {
      numero_op, codigo_produto, tipo_etiqueta, local_impressao,
      zpl_len: conteudo_zpl ? conteudo_zpl.length : 0
    });

    const {
      numero_op,
      codigo_produto,
      tipo_etiqueta = 'Teste',
      local_impressao = 'localhost',
      conteudo_zpl,
      usuario_criacao = null,
      observacoes = null,
    } = req.body || {};

    if (!numero_op || !codigo_produto || !conteudo_zpl) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: numero_op, codigo_produto, conteudo_zpl' });
    }

    const sql = `
      INSERT INTO etiquetas_impressas
        (numero_op, codigo_produto, tipo_etiqueta, local_impressao, conteudo_zpl, usuario_criacao, observacoes)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, data_criacao
    `;
    const params = [
      String(numero_op),
      String(codigo_produto),
      String(tipo_etiqueta),
      String(local_impressao),
      String(conteudo_zpl),
      usuario_criacao,
      observacoes,
    ];

    const { rows } = await pool.query(sql, params);
    return res.json({ ok: true, id: rows?.[0]?.id, data_criacao: rows?.[0]?.data_criacao });
  } catch (err) {
    console.error('[etiquetas/salvar-db] erro:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Falha ao salvar etiqueta no banco' });
  }
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
  // ===================== HELPERS LOCAIS ======================
  const { Pool } = require('pg');
  const omieCall = require('./utils/omieCall.js');

  // Data no formato dd/mm/aaaa (OMIE)
  const toOmieDate = (d) => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  };

  // === SUA FUNÇÃO DE ETIQUETA (mantida 1:1) ==================
function gerarEtiquetaPP({ codMP, op, descricao = '' }) {
  // ====== CONFIGURAÇÃO DA MÍDIA (em milímetros) ======
  const DPI = 203;                          // Densidade da impressora (203 dpi é padrão Zebra)
  const DOTS_PER_MM = DPI / 25.4;           // Conversão mm -> dots (~8.0 em 203 dpi)
  const LABEL_W_MM = 50;                    // Largura física da etiqueta (ajuste p/ sua mídia)
  const LABEL_H_MM = 30;                    // Altura física da etiqueta (ajuste p/ sua mídia)

  // Converte mm da mídia para "dots" usados pelo ZPL
  const PW = Math.round(LABEL_W_MM * DOTS_PER_MM); // ^PW = Print Width (largura total em dots)
  const LL = Math.round(LABEL_H_MM * DOTS_PER_MM); // ^LL = Label Length (altura total em dots)

  // ====== AJUSTES FINOS DE POSIÇÃO ======
  let DX = 5;                               // Offset horizontal global (empurra tudo p/ direita)
  let DY = 5;                               // Offset vertical global (empurra tudo p/ baixo)
  const DESENHAR_BORDA = true;              // true = desenha um retângulo da área útil (debug)

  // Data/hora carimbada na etiqueta
  const agora = new Date();
  const dataHora =
    agora.toLocaleDateString('pt-BR') + ' ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Helper: gera ^FO somando os offsets DX/DY (x=coluna, y=linha, em dots)
  const fo = (x, y) => `^FO${x + DX},${y + DY}`; // Ex.: ${fo(7,10)} → desloca 7 à direita e 10 p/ baixo

  // ====== CONSTRUÇÃO DO ZPL ======
  const z = [];

  z.push('^XA');                            // ^XA = início do formato ZPL (obrigatório)
  z.push(`^PW${PW}`);                       // ^PW = largura total da etiqueta (em dots)
  z.push(`^LL${LL}`);                       // ^LL = altura total da etiqueta (em dots)
  z.push('^FWB');                           // ^FW = orientação do texto/gráficos; B = 90° (rotate)
                                            // Troque para ^FWN se quiser sem rotação

  if (DESENHAR_BORDA) {
    z.push(`^FO0,0^GB${PW},${LL},1^FS`);    // ^GB = desenha uma borda (w=PW, h=LL, espessura=1px)
  }

  // ---- QRCode (conteúdo: codMP-OP) ----
  z.push(`${fo(7, 10)}`);                   // ^FO = posiciona o próximo elemento (x=7,y=10) + offsets
  z.push('^BQN,2,4');                       // ^BQN = QR Code (Modelo 2; Modo 2; escala 4)
  z.push(`^FDQA,${codMP}-${op}^FS`);        // ^FD = dados do QR (QA=modo automático); ^FS = fim do campo

  // ---- Código do material (grande) ----
  z.push(`${fo(135, 10)}`);                 // Posição do texto do codMP (ajuste se precisar)
  z.push('^A0B,35,30');                     // ^A0B = fonte 0, orientação B (90°); altura=40, largura=35
  z.push(`^FD ${codMP} ^FS`);               // Conteúdo do campo: codMP em destaque

  // ---- Data/hora ----
  z.push(`${fo(170, 50)}`);                 // Posição da data/hora
  z.push('^A0B,20,20');                     // Fonte 0, orientação B; tamanho menor
  z.push(`^FD ${dataHora} ^FS`);            // Conteúdo: data/hora atual

  // ---- Separador 1 ----
  z.push(`${fo(180, 0)}`);                  // Posição do separador
  z.push('^A0B,23,23');                     // Define fonte/altura para a linha de traços (opcional)
  z.push('^FB320,1,0,L,0');                 // ^FB = bloco de texto (largura=320, 1 linha, alinhado à esquerda)
  z.push('^FD --------------- ^FS');        // Traços (você pode trocar por ^GB horizontal, se preferir)

  // ---- Número da OP ----
  z.push(`${fo(20, 0)}`);                   // Posição do campo "OP: ..."
  z.push('^A0B,17,17');                     // Fonte 0, orientação B; tamanho 20/20
  z.push('^FB230,2,0,L,0');                 // Bloco de texto com largura 230, máx 2 linhas
  z.push(`^FD OP: ${op} ^FS`);              // Conteúdo: número interno da OP

  // ---- Separador 2 ----
  z.push(`${fo(196, 0)}`);                  // Posição do segundo separador
  z.push('^A0B,23,23');                     // Mesmo tamanho do separador anterior
  z.push('^FB320,1,0,L,0');                 // Bloco com largura 320
  z.push('^FD --------------- ^FS');        // Traços

  // ---- Descrição (com quebra automática) ----
  z.push(`${fo(210, 10)}`);                 // Posição da descrição
  z.push('^A0B,23,23');                     // Fonte 0, orientação B; tamanho 23/23 (ajuste se cortar)
  z.push('^FB220,8,0,L,0');                 // ^FB = largura 220, máx 8 linhas, alinhado à esquerda
  z.push(`^FD ${descricao || 'SEM DESCRIÇÃO'} ^FS`); // Conteúdo da descrição (fallback se vazio)

  // ---- Rodapé ----
  z.push(`${fo(110, 10)}`);                 // Posição do rodapé (ajuste conforme necessário)
  z.push('^A0B,20,20');                     // Tamanho 20/20
  z.push('^FB225,1,0,L,0');                 // Largura 225, 1 linha
  z.push('^FD FT-M00-ETQP - REV01 ^FS');    // Texto fixo do rodapé (troque a revisão se mudar layout)

  z.push('^XZ');                            // ^XZ = fim do formato ZPL (obrigatório)

  return z.join('\n');                      // Retorna o ZPL completo
}



  // Salva uma etiqueta na tabela etiquetas_impressas (permitindo injetar o ZPL já pronto)
  async function salvarEtiquetaOP(pool, {
    numero_op,
    codigo_produto,
    conteudo_zpl,                 // <- se vier pronto, usa; se não, monta com gerarEtiquetaPP
    tipo_etiqueta   = 'Expedicao',
    local_impressao = 'Preparação elétrica',
    impressa        = false,
    usuario_criacao = 'API',
    observacoes     = null
  }) {
    if (!numero_op)      throw new Error('numero_op obrigatório');
    if (!codigo_produto) throw new Error('codigo_produto obrigatório');
    if (!tipo_etiqueta)  throw new Error('tipo_etiqueta obrigatório');
    if (!local_impressao)throw new Error('local_impressao obrigatório');

    const zpl = conteudo_zpl && String(conteudo_zpl).trim().length
      ? conteudo_zpl
      : gerarEtiquetaPP({ codMP: codigo_produto, op: numero_op, descricao: '' });

    const sql = `
      INSERT INTO etiquetas_impressas
        (numero_op, codigo_produto, tipo_etiqueta, local_impressao, conteudo_zpl, impressa, usuario_criacao, observacoes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, data_criacao
    `;
    const params = [
      numero_op,
      codigo_produto,
      tipo_etiqueta,
      local_impressao,
      zpl,
      impressa,
      usuario_criacao,
      observacoes
    ];

    const { rows } = await pool.query(sql, params);
    return rows[0]; // { id, data_criacao }
  }

  // Próximo código sequencial PaaNNNNN (ignora se registros antigos têm ou não 'P')
  async function getNextPPCode(pg, ano2) {
    await pg.query(`
      CREATE TABLE IF NOT EXISTS op_codigos_log (
        id          BIGSERIAL PRIMARY KEY,
        ccodintop   TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    const { rows } = await pg.query(`
      WITH x AS (
        SELECT (regexp_matches(UPPER(ccodintop), '^[P]?([0-9]{2})([0-9]{5})$')) AS m
        FROM op_codigos_log
      ),
      y AS (
        SELECT (m)[1]::int AS yy, (m)[2]::int AS seq
        FROM x
        WHERE m IS NOT NULL
      )
      SELECT COALESCE(MAX(seq), 0) AS max_seq
      FROM y
      WHERE yy = $1::int
    `, [ano2]);
    const next = (rows?.[0]?.max_seq || 0) + 1;
    const seq5 = String(next).padStart(5, '0');
    return `P${String(ano2).padStart(2, '0')}${seq5}`;
  }
  async function logGeneratedCode(pg, ccod) {
    try { await pg.query('INSERT INTO op_codigos_log(ccodintop) VALUES ($1)', [ccod]); } catch {}
  }

  // ===================== INÍCIO DA ROTA ======================
  const dsn = process.env.DATABASE_URL
    || 'postgresql://intranet_db_yd0w_user:amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho@dpg-d2d4b0a4d50c7385vm50-a/intranet_db_yd0w';
  const pool = new Pool({ connectionString: dsn, ssl: { rejectUnauthorized: false } });

  try {
    const OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
    const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

    // 0) payload de entrada
    const front = req.body || {};
    front.call       = front.call       || 'IncluirOrdemProducao';
    front.app_key    = front.app_key    || OMIE_APP_KEY;
    front.app_secret = front.app_secret || OMIE_APP_SECRET;

    if (!front.app_key || !front.app_secret) {
      return res.status(200).json({
        faultstring: 'A chave de acesso não está preenchida ou não é válida. (faltam OMIE_APP_KEY/OMIE_APP_SECRET)',
        faultcode  : 'SOAP-ENV:Server'
      });
    }

    // 1) normalize param/ident
    front.param = Array.isArray(front.param) && front.param.length ? front.param : [{}];
    front.param[0] = front.param[0] || {};
    front.param[0].identificacao = front.param[0].identificacao || {};
    const ident = front.param[0].identificacao;

    // recebe informações do front
    const codigoTextual = String(front.codigo || front.cCodigo || '').trim(); // codMP
    const descricaoFront = (typeof front.descricao === 'string') ? front.descricao.trim() : '';

    // 2) defaults
    ident.dDtPrevisao          = ident.dDtPrevisao || toOmieDate(new Date());
    ident.nQtde                = Math.max(1, Number(ident.nQtde || 1));
    ident.codigo_local_estoque = Number(process.env.PRODUCAO_LOCAL_PADRAO) || 10564345392;

    // 3) resolver nCodProduto via ConsultarProduto (se necessário)
    if (!ident.nCodProduto && codigoTextual) {
      try {
        const consultarPayload = {
          call: 'ConsultarProduto',
          app_key: front.app_key,
          app_secret: front.app_secret,
          param: [{ codigo: codigoTextual }]
        };
        const prod = await omieCall('https://app.omie.com.br/api/v1/geral/produtos/', consultarPayload);
        const n = Number(
          prod?.codigo_produto ||
          prod?.produto_servico_cadastro?.codigo_produto ||
          0
        );
        if (n) ident.nCodProduto = n;

        // tenta puxar uma descrição básica do retorno, se veio
        if (!descricaoFront) {
          front.descricao = prod?.descricao || prod?.produto_servico_cadastro?.descricao || '';
        }
      } catch (e) {
        console.warn('[produtos/op] ConsultarProduto falhou:', e?.message || e);
      }
    }
    if (!ident.nCodProduto) {
      return res.status(200).json({
        faultstring: 'nCodProduto ausente e não foi possível resolver via "codigo".',
        faultcode  : 'SOAP-ENV:Server'
      });
    }

    // 4) Gerar cCodIntOP PaaNNNNN quando contém ".PP."
    const temPP = /\.PP\./i.test(codigoTextual);
    if (temPP) {
      const ano2 = (new Date().getFullYear() % 100);
      const novoCodigo = await getNextPPCode(pool, ano2);
      await logGeneratedCode(pool, novoCodigo);
      ident.cCodIntOP = novoCodigo;
    } else {
      ident.cCodIntOP = ident.cCodIntOP || String(Date.now());
    }

    // 5) Chamar OMIE
    front.param[0].identificacao = ident;

    let omieResp;
    try {
      omieResp = await omieCall('https://app.omie.com.br/api/v1/produtos/op/', front);
    } catch (e) {
      const raw = String(e?.message || '');
      try {
        const j = JSON.parse(raw);
        if (j?.faultstring || j?.error) {
          return res.status(200).json(j); // devolve para o front tratar mensagem
        }
      } catch (_) {}
      if (e?.status === 403) {
        return res.status(200).json({
          faultstring: 'A OMIE recusou a requisição (403). Verifique app_key/app_secret.',
          faultcode  : 'SOAP-ENV:Server'
        });
      }
      console.error('[omie/produtos/op] EXCEPTION:', e);
      return res.status(500).json({ error: 'internal', message: String(e?.message || e) });
    }

    if (omieResp?.faultstring || omieResp?.error) {
      return res.status(200).json(omieResp);
    }

    // 6) Pós-sucesso: GERAR ETIQUETA com seu layout e inserir pendente
    try {
      const ccodintop = omieResp?.cCodIntOP || ident.cCodIntOP || null;  // op
      const ncodop    = omieResp?.nCodOP   || null;
      const numeroOP  = ccodintop || String(ncodop || '');
      const codMP     = codigoTextual || '';
      // prioridade da descrição: front.descricao -> DB -> fallback
      let descricao   = (front.descricao || descricaoFront || '').trim();

      // tenta buscar descrição no DB se não veio do front
      if (!descricao) {
        try {
          const q1 = await pool.query(`
            SELECT descricao FROM produtos WHERE codigo = $1 LIMIT 1
          `, [codMP]);
          descricao = q1.rows?.[0]?.descricao || descricao;
        } catch {}
        if (!descricao) {
          try {
            const q2 = await pool.query(`
              SELECT descricao FROM produtos_omie WHERE codigo = $1 LIMIT 1
            `, [codMP]);
            descricao = q2.rows?.[0]?.descricao || descricao;
          } catch {}
        }
      }
      if (!descricao) descricao = 'SEM DESCRIÇÃO';

      const zpl = gerarEtiquetaPP({ codMP, op: numeroOP, descricao });

      await salvarEtiquetaOP(pool, {
        numero_op: numeroOP,
        codigo_produto: codMP,
        conteudo_zpl: zpl,                     // usa exatamente seu layout
        tipo_etiqueta: 'Expedicao',
        local_impressao: 'Preparação elétrica',
        impressa: false,                       // o agente marca como true
        usuario_criacao: (req.user?.name || 'API'),
        observacoes: null
      });

      console.log('[etiquetas] gerada para OP', numeroOP, 'codMP', codMP);
    } catch (e) {
      console.error('[etiquetas] falha ao salvar etiqueta:', e?.message || e);
      // não quebra a resposta da OP
    }

    // resposta final para o front
    const ccodintop = omieResp?.cCodIntOP || ident.cCodIntOP || null;
    const codprod   = codigoTextual || null;
    return res.json({ ...omieResp, cCodIntOP: ccodintop, codigo: codprod });

  } catch (e) {
    console.error('[omie/produtos/op] EXCEPTION (outer):', e);
    return res.status(500).json({ error: 'internal', message: String(e?.message || e) });
  } finally {
    try { await pool.end(); } catch {}
  }
});




// === salva uma etiqueta de OP na tabela `etiquetas_impressas` ===
function buildZPL({ titulo = 'OP – Expedição', numero_op = '', codigo_produto = '' } = {}) {
  return [
    '^XA',
    '^PW800',
    '^LL500',
    '^CF0,40',
    `^FO40,40^FD${titulo}^FS`,
    '^FO40,100^GB700,2,2^FS',
    '^CF0,30',
    `^FO40,150^FDOP: ${numero_op}^FS`,
    `^FO40,200^FDCódigo: ${codigo_produto}^FS`,
    '^FO40,260^BQN,2,4^FDMA,Fromtherm OP^FS',
    '^XZ',
  ].join('\n');
}

async function salvarEtiquetaOP(pool, {
  numero_op,
  codigo_produto,
  tipo_etiqueta   = 'Expedicao',
  local_impressao = 'Preparação elétrica',
  impressa        = false,
  usuario_criacao = 'API',
  observacoes     = null
}) {
  // valida mínimos exigidos pela tabela (NOT NULL)
  if (!numero_op)      throw new Error('numero_op obrigatório');
  if (!codigo_produto) throw new Error('codigo_produto obrigatório');
  if (!tipo_etiqueta)  throw new Error('tipo_etiqueta obrigatório');
  if (!local_impressao)throw new Error('local_impressao obrigatório');

  const conteudo_zpl = buildZPL({ numero_op, codigo_produto });

  const sql = `
    INSERT INTO etiquetas_impressas
      (numero_op, codigo_produto, tipo_etiqueta, local_impressao, conteudo_zpl, impressa, usuario_criacao, observacoes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id, data_criacao
  `;
  const params = [
    numero_op,
    codigo_produto,
    tipo_etiqueta,
    local_impressao,
    conteudo_zpl,
    impressa,
    usuario_criacao,
    observacoes
  ];

  const { rows } = await pool.query(sql, params);
  return rows[0]; // { id, data_criacao }
}


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


// === Agendamento diário: sincronização de produtos Omie =====================
// Objetivo: permitir configurar um horário diário (HH:MM) para executar
// automaticamente a rotina de sincronização dos produtos da Omie
// (equivalente à rota POST /api/admin/sync/produtos-omie).

async function ensureScheduledTaskTable() {
  if (!isDbEnabled) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.scheduled_task (
        key         text PRIMARY KEY,
        time        char(5) NOT NULL,   -- formato 'HH:MM'
        enabled     boolean NOT NULL DEFAULT true,
        filter_column text,
        filter_values text[],
        last_run_at   timestamptz,
        last_ok       boolean,
        last_summary  text,
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    // assegura colunas extras caso tabela exista de versões anteriores
    await pool.query(`ALTER TABLE public.scheduled_task ADD COLUMN IF NOT EXISTS filter_column text`);
    await pool.query(`ALTER TABLE public.scheduled_task ADD COLUMN IF NOT EXISTS filter_values text[]`);
    await pool.query(`ALTER TABLE public.scheduled_task ADD COLUMN IF NOT EXISTS last_run_at timestamptz`);
    await pool.query(`ALTER TABLE public.scheduled_task ADD COLUMN IF NOT EXISTS last_ok boolean`);
    await pool.query(`ALTER TABLE public.scheduled_task ADD COLUMN IF NOT EXISTS last_summary text`);
  } catch (e) {
    console.warn('[db] scheduled_task: falha ao garantir tabela:', e?.message || e);
  }
}
ensureScheduledTaskTable()
  .then(() => console.log('[db] scheduled_task pronto'))
  .catch(err => console.warn('[db] scheduled_task: erro:', err?.message || err));

function parseHHMM(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return { hh, mm };
}

function nextOccurrenceTodayOrTomorrow(hh, mm) {
  const now = new Date();
  const next = new Date();
  next.setHours(hh, mm, 0, 0);
  if (next <= now) {
    // amanhã
    next.setDate(next.getDate() + 1);
  }
  return next;
}

let produtosOmieTimer = null;

async function scheduleProdutosOmieJobFromDb() {
  try {
    if (!isDbEnabled) return;
    const { rows } = await pool.query(`
      SELECT time, enabled, filter_column, filter_values FROM public.scheduled_task WHERE key = 'produtos-omie'
    `);
    const conf = rows[0];
    if (!conf || conf.enabled !== true) {
      if (produtosOmieTimer) { clearTimeout(produtosOmieTimer); produtosOmieTimer = null; }
      return;
    }
    const t = parseHHMM(conf.time || '');
    if (!t) {
      if (produtosOmieTimer) { clearTimeout(produtosOmieTimer); produtosOmieTimer = null; }
      return;
    }

    const next = nextOccurrenceTodayOrTomorrow(t.hh, t.mm);
    const waitMs = Math.max(0, next.getTime() - Date.now());

    if (produtosOmieTimer) clearTimeout(produtosOmieTimer);
    produtosOmieTimer = setTimeout(async () => {
      try {
        // executa sincronização direta (evita problemas com child process + PM2)
        const filter = (conf.filter_column && Array.isArray(conf.filter_values) && conf.filter_values.length)
          ? { column: conf.filter_column, values: conf.filter_values }
          : null;
        const result = await doSyncProdutosOmie({ max_paginas: 999, filtros: {}, filter });
        try {
          await pool.query(`UPDATE public.scheduled_task SET last_run_at = now(), last_ok = $1, last_summary = $2, updated_at = now() WHERE key = 'produtos-omie'`, [true, JSON.stringify(result)]);
        } catch {}
      } catch (e) {
        console.error('[agendamento produtos-omie] erro na execução:', e);
        try {
          await pool.query(`UPDATE public.scheduled_task SET last_run_at = now(), last_ok = $1, last_summary = $2, updated_at = now() WHERE key = 'produtos-omie'`, [false, String(e?.message || e)]);
        } catch {}
      } finally {
        // agenda a próxima ocorrência (amanhã)
        scheduleProdutosOmieJobFromDb();
      }
    }, waitMs);

    console.log('[agendamento produtos-omie] próximo disparo em', Math.round(waitMs/1000), 's');
  } catch (e) {
    console.warn('[agendamento produtos-omie] falha ao agendar:', e?.message || e);
  }
}

async function getProdutosOmieSchedule() {
  if (!isDbEnabled) return { enabled: false, time: null, next_run_iso: null };
  const { rows } = await pool.query(`
    SELECT time, enabled, filter_column, filter_values, last_run_at, last_ok, last_summary
      FROM public.scheduled_task WHERE key = 'produtos-omie'
  `);
  const conf = rows[0] || null;
  if (!conf || conf.enabled !== true) return {
    enabled: false,
    time: conf?.time?.trim() || null,
    next_run_iso: null,
    filter_column: conf?.filter_column || null,
    filter_values: conf?.filter_values || [],
    last_run_at: conf?.last_run_at || null,
    last_ok: conf?.last_ok ?? null,
    last_summary: conf?.last_summary || null
  };
  const t = parseHHMM(conf.time || '');
  if (!t) return {
    enabled: false,
    time: conf.time?.trim() || null,
    next_run_iso: null,
    filter_column: conf?.filter_column || null,
    filter_values: conf?.filter_values || [],
    last_run_at: conf?.last_run_at || null,
    last_ok: conf?.last_ok ?? null,
    last_summary: conf?.last_summary || null
  };
  const next = nextOccurrenceTodayOrTomorrow(t.hh, t.mm);
  return {
    enabled: true,
    time: conf.time.trim(),
    next_run_iso: next.toISOString(),
    filter_column: conf?.filter_column || null,
    filter_values: conf?.filter_values || [],
    last_run_at: conf?.last_run_at || null,
    last_ok: conf?.last_ok ?? null,
    last_summary: conf?.last_summary || null
  };
}

// inicia o agendador ao subir o servidor
scheduleProdutosOmieJobFromDb()
  .then(() => console.log('[agendamento produtos-omie] verificação inicial concluída'))
  .catch(err => console.warn('[agendamento produtos-omie] erro na inicialização:', err?.message || err));

// Executor alternativo: roda via exec com timeout para garantir que funciona independente do PM2
async function runSyncViaChild(max_paginas = 1) {
  appendSyncLog(`[sync] iniciando via exec: node sync_omie_to_sql.js ${max_paginas}`);
  
  return new Promise((resolve, reject) => {
    const cmd = `node ${path.join(__dirname, 'sync_omie_to_sql.js')} ${max_paginas} 2>&1`;
    
    // Timeout manual de 4 minutos
    const timer = setTimeout(() => {
      appendSyncLog(`[sync] TIMEOUT após 240s sem resposta`);
      reject(new Error('Timeout: exec não retornou em 240s'));
    }, 240000);
    
    exec(cmd, {
      cwd: __dirname,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
      timeout: 240000
    }, (error, stdout, stderr) => {
      clearTimeout(timer);
      
      let totalUpserts = 0;
      
      // Log stdout
      if (stdout) {
        stdout.split('\n').forEach(line => {
          if (line.trim()) {
            appendSyncLog(`[sync] ${line}`);
            const m = line.match(/Total de upserts:\s*(\d+)/i);
            if (m) totalUpserts = Number(m[1] || 0);
          }
        });
      }
      
      // Log stderr
      if (stderr) {
        stderr.split('\n').forEach(line => {
          if (line.trim()) appendSyncLog(`[sync][err] ${line}`);
        });
      }
      
      if (error) {
        appendSyncLog(`[sync] erro no exec: ${error.message} (code=${error.code}, signal=${error.signal})`);
        reject(error);
      } else {
        appendSyncLog(`[sync] finalizado. totalUpserts=${totalUpserts}`);
        resolve({ ok: true, total_upserts: totalUpserts });
      }
    });
  });
}


// ====== COMERCIAL: Importador de Pedidos (OMIE → Postgres) ======
const PV_REGS_PER_PAGE = 200;
const PRODUTOS_REGS_PER_PAGE = 500; // alinhar com uso via cURL/teste e reduzir chamadas

async function omiePedidosListarPagina(pagina, filtros = {}) {
  const app_key = process.env.OMIE_APP_KEY || OMIE_APP_KEY;
  const app_secret = process.env.OMIE_APP_SECRET || OMIE_APP_SECRET;
  const payload = {
    call: 'ListarPedidos',
    app_key,
    app_secret,
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

async function omieProdutosListarPagina(pagina, filtros = {}) {
  const app_key = process.env.OMIE_APP_KEY || OMIE_APP_KEY;
  const app_secret = process.env.OMIE_APP_SECRET || OMIE_APP_SECRET;
  
  // Log de depuração: confirma se as credenciais estão presentes
  if (!app_key || !app_secret) {
    console.error('[omieProdutosListarPagina] Credenciais ausentes:', { app_key: !!app_key, app_secret: !!app_secret });
    throw new Error('OMIE_APP_KEY ou OMIE_APP_SECRET ausentes');
  }
  
  const payload = {
    call: 'ListarProdutos',
    app_key,
    app_secret,
    param: [{
      pagina,
      registros_por_pagina: PRODUTOS_REGS_PER_PAGE,
      apenas_importado_api: "N",
      filtrar_apenas_omiepdv: "N"
    }]
  };
  console.log('[omieProdutosListarPagina] Requisição iniciada:', { pagina, registros: PRODUTOS_REGS_PER_PAGE });
  console.log('[omieProdutosListarPagina] Payload param:', payload.param[0]);
  return omiePost('https://app.omie.com.br/api/v1/geral/produtos/', payload);
}

// Consulta um único produto na Omie por codigo (texto) ou codigo_produto (numérico)
async function omieProdutosConsultar({ codigo = null, codigo_produto = null }) {
  const app_key = process.env.OMIE_APP_KEY || OMIE_APP_KEY;
  const app_secret = process.env.OMIE_APP_SECRET || OMIE_APP_SECRET;
  if (!app_key || !app_secret) throw new Error('OMIE_APP_KEY/SECRET ausentes');
  const param = [{}];
  if (codigo_produto) {
    // garantir numérico
    param[0].codigo_produto = Number(codigo_produto);
  } else if (codigo) {
    param[0].codigo = String(codigo);
  } else {
    throw new Error('Forneça codigo ou codigo_produto');
  }
  const payload = { call: 'ConsultarProduto', app_key, app_secret, param };
  return omiePost('https://app.omie.com.br/api/v1/geral/produtos/', payload, 15000);
}

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
  app.use('/api/auth',     authRouter);
  app.use('/api/etiquetas', etiquetasRouter);   // ⬅️  NOVO
  app.use('/api/users', require('./routes/users'));

  app.use('/api/omie/estoque',       estoqueRouter);
  // app.use('/api/omie/estoque/resumo',estoqueResumoRouter);

  app.post('/api/omie/produtos', async (req, res) => {

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


app.get('/api/produtos/detalhes/:codigo', async (req, res) => {
  try {
    const data = await callOmieDedup(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      {
        call:       'ConsultarProduto',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      [{ codigo: req.params.codigo }]
      },
      { waitMs: 5000 } // opcional: 5s entre tentativas se cair no redundante
    );
    return res.json(data);
  } catch (err) {
    if (String(err.message || '').includes('faultstring')) {
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
// estáticos unificados (CSS/JS/img) — antes das rotas HTML
app.use(express.static(path.join(__dirname), {
  etag: false,                 // evita servir HTML por engano via cache
  maxAge: '1h',
  setHeaders: (res, p) => {
    if (p.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
    if (p.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));



app.get('/preparacao_eletrica.html', (req, res) => {
  if (!req.session || !req.session.user) {
    // redireciona para a home (que tem o login visível)
    return res.redirect('/menu_produto.html#login-required');
  }
  return res.sendFile(path.join(__dirname, 'preparacao_eletrica.html'));
});

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
  if (IAPP_INSECURE) {
    console.warn('[IAPP] Atenção: IAPP_INSECURE=true — validação TLS desabilitada para chamadas IAPP (apenas desenvolvimento).');
  }
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

// ===================== PCP / ESTRUTURAS (BOM) — BLOCO AUTOSSUFICIENTE =====================

// URLs/keys
const PCP_OMIE_ESTRUTURA_URL = process.env.OMIE_ESTRUTURA_URL
  || 'https://app.omie.com.br/api/v1/geral/malha/';

const PCP_OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
const PCP_OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

// Helpers isolados (nomes únicos pra não colidir)
const pcpSleep = (ms) => new Promise(r => setTimeout(r, ms));
const pcpFetchWithTimeout = async (url, opts = {}, ms = 60000) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
};
const pcpBrToISO = (s) => {
  if (!s) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d,m,y] = s.split('/'); return `${y}-${m}-${d}`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
};
const pcpClampN = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Chamada à Omie (com retry/debounce de cache)
const pcpOmieCall = async (call, param, { timeout = 60000, retry = 2 } = {}) => {
  if (!PCP_OMIE_APP_KEY || !PCP_OMIE_APP_SECRET) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente.');
  }
  const payload = {
    call,
    app_key: PCP_OMIE_APP_KEY,
    app_secret: PCP_OMIE_APP_SECRET,
    param: Array.isArray(param) ? param : [param],
  };

  for (let i = 0; i <= retry; i++) {
    try {
      const resp = await pcpFetchWithTimeout(PCP_OMIE_ESTRUTURA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, timeout);
      if (!resp.ok) {
        const txt = await resp.text().catch(()=> '');
        throw new Error(`Omie HTTP ${resp.status} ${resp.statusText} :: ${txt.slice(0,300)}`);
      }
      const json = await resp.json();
      if (json?.faultstring) throw new Error(`${json.faultstring} (${json.faultcode||''})`);
      return json;
    } catch (e) {
      const msg = String(e?.message || '');
      const isCache = msg.includes('Consumo redundante detectado');
      if (isCache && i < retry) { await pcpSleep(35000); continue; }
      if (i < retry) { await pcpSleep(1500); continue; }
      throw e;
    }
  }
};

// Persistência
async function pcpUpsertEstruturaCab(cli, ident) {
  const sql = `
    INSERT INTO omie_malha_cab (
      produto_id, produto_codigo, produto_descricao,
      familia_id, familia_codigo, familia_descricao,
      tipo_produto, unidade, peso_liq, peso_bruto, last_synced_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
    ON CONFLICT (produto_id) DO UPDATE SET
      produto_codigo    = EXCLUDED.produto_codigo,
      produto_descricao = EXCLUDED.produto_descricao,
      familia_id        = EXCLUDED.familia_id,
      familia_codigo    = EXCLUDED.familia_codigo,
      familia_descricao = EXCLUDED.familia_descricao,
      tipo_produto      = EXCLUDED.tipo_produto,
      unidade           = EXCLUDED.unidade,
      peso_liq          = EXCLUDED.peso_liq,
      peso_bruto        = EXCLUDED.peso_bruto,
      last_synced_at    = now()
  `;
  await cli.query(sql, [
    Number(ident.idProduto) || 0,
    ident.codProduto || null,
    ident.descrProduto || null,
    Number(ident.idFamilia) || null,
    ident.codFamilia || null,
    ident.descrFamilia || null,
    ident.tipoProduto || null,
    ident.unidProduto || null,
    pcpClampN(ident.pesoLiqProduto),
    pcpClampN(ident.pesoBrutoProduto),
  ]);
}

async function pcpReplaceEstruturaItens(cli, produtoId, itens) {
  await cli.query('DELETE FROM omie_malha_item WHERE produto_id = $1', [produtoId]);
  if (!Array.isArray(itens) || !itens.length) return 0;

  const sql = `
    INSERT INTO omie_malha_item (
      produto_id, item_malha_id, item_prod_id, item_codigo, item_descricao,
      item_unidade, item_tipo,
      item_familia_id, item_familia_codigo, item_familia_desc,
      quantidade, perc_perda, peso_liq, peso_bruto,
      codigo_local_estoque,
      d_inc, h_inc, u_inc, d_alt, h_alt, u_alt
    ) VALUES (
      $1,$2,$3,$4,$5,
      $6,$7,
      $8,$9,$10,
      $11,$12,$13,$14,
      $15,
      $16,$17,$18,$19,$20,$21
    )
    ON CONFLICT ON CONSTRAINT uq_malha_item
    DO UPDATE SET
      item_codigo     = EXCLUDED.item_codigo,
      item_descricao  = EXCLUDED.item_descricao,
      item_unidade    = EXCLUDED.item_unidade,
      item_tipo       = EXCLUDED.item_tipo,
      item_familia_id = EXCLUDED.item_familia_id,
      item_familia_codigo = EXCLUDED.item_familia_codigo,
      item_familia_desc   = EXCLUDED.item_familia_desc,
      quantidade      = EXCLUDED.quantidade,
      perc_perda      = EXCLUDED.perc_perda,
      peso_liq        = EXCLUDED.peso_liq,
      peso_bruto      = EXCLUDED.peso_bruto,
      codigo_local_estoque = EXCLUDED.codigo_local_estoque,
      d_inc = EXCLUDED.d_inc, h_inc = EXCLUDED.h_inc, u_inc = EXCLUDED.u_inc,
      d_alt = EXCLUDED.d_alt, h_alt = EXCLUDED.h_alt, u_alt = EXCLUDED.u_alt
  `;

  let count = 0;
  for (const it of itens) {
    await cli.query(sql, [
      Number(produtoId) || 0,
      Number(it.idMalha) || null,
      Number(it.idProdMalha) || 0,
      it.codProdMalha || '',
      it.descrProdMalha || null,
      it.unidProdMalha || null,
      it.tipoProdMalha || null,
      Number(it.idFamMalha) || null,
      it.codFamMalha || null,
      it.descrFamMalha || null,
      pcpClampN(it.quantProdMalha),
      pcpClampN(it.percPerdaProdMalha),
      pcpClampN(it.pesoLiqProdMalha),
      pcpClampN(it.pesoBrutoProdMalha),
      it.codigo_local_estoque ? Number(it.codigo_local_estoque) : null,
      pcpBrToISO(it.dIncProdMalha), it.hIncProdMalha || null, it.uIncProdMalha || null,
      pcpBrToISO(it.dAltProdMalha), it.hAltProdMalha || null, it.uAltProdMalha || null,
    ]);
    count++;
  }
  return count;
}

// ---------- SYNC: uma estrutura (por idProduto ou codProduto) ----------
app.post('/api/admin/sync/pcp/estrutura', express.json(), async (req, res) => {
  try {
    const timeout = Number(req.query.timeout || 60000);
    const retry   = Number(req.query.retry || 2);
    const codProduto = req.body?.codProduto ? String(req.body.codProduto) : null;
    const idProduto  = req.body?.idProduto ? Number(req.body.idProduto) : null;

    if (!codProduto && !idProduto) {
      return res.status(400).json({ ok:false, error:'Informe idProduto OU codProduto' });
    }

    const param = idProduto ? { idProduto } : { codProduto };
    const r = await pcpOmieCall('ConsultarEstrutura', param, { timeout, retry });

    const ident = r?.ident || {};
    const itens = Array.isArray(r?.itens) ? r.itens : [];

    if (!ident?.idProduto) {
      return res.json({ ok:true, imported:0, warn:'Estrutura não encontrada', ident });
    }

    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      await pcpUpsertEstruturaCab(cli, ident);
      const n = await pcpReplaceEstruturaItens(cli, ident.idProduto, itens);
      await cli.query('COMMIT');
      return res.json({ ok:true, imported:n, produto_id: ident.idProduto, cod: ident.codProduto });
    } catch (e) {
      await cli.query('ROLLBACK'); throw e;
    } finally {
      cli.release();
    }
  } catch (err) {
    console.error('[pcp/estrutura one] FAIL', err);
    res.status(500).json({ ok:false, error:String(err.message||err) });
  }
});

// ---------- SYNC: todas as estruturas (ListarEstruturas → ConsultarEstrutura) ----------
// ---------- SYNC: todas as estruturas (ListarEstruturas paginado → persiste ident+itens) ----------
app.post('/api/admin/sync/pcp/estruturas', express.json(), async (req, res) => {
  try {
    const timeout = Number(req.query.timeout || 60000);
    const retry   = Number(req.query.retry || 2);
    const perPage = Number(req.query.perPage || 200);
    const sleepMs = Number(req.query.sleepMs || 150);

    let pagina = 1, nTotPaginas = 1;
    let totalPais = 0, totalItens = 0;

    const cli = await pool.connect();
    try {
      while (pagina <= nTotPaginas) {
        // 1) página da Omie
        const r = await pcpOmieCall('ListarEstruturas', {
          nPagina: pagina,
          nRegPorPagina: perPage
          // você pode adicionar filtros de data se quiser (dInc*/dAlt*), mas aqui deixamos geral
        }, { timeout, retry });

        // 2) pega a lista correta
        const lista = Array.isArray(r?.produtosEncontrados) ? r.produtosEncontrados : [];

        // 3) persiste cada produto-pai + seus itens
        for (const item of lista) {
          const ident = item?.ident || {};
          const itens = Array.isArray(item?.itens) ? item.itens : [];

          if (!ident?.idProduto) continue;

          try {
            await cli.query('BEGIN');
            await pcpUpsertEstruturaCab(cli, ident);
            const n = await pcpReplaceEstruturaItens(cli, ident.idProduto, itens);
            await cli.query('COMMIT');

            totalPais += 1;
            totalItens += n;
          } catch (e) {
            await cli.query('ROLLBACK').catch(()=>{});
            console.warn('[pcp/estruturas] falha ao persistir', ident?.codProduto || ident?.idProduto, e.message);
          }

          if (sleepMs) await pcpSleep(sleepMs);
        }

        // 4) paginação
        nTotPaginas = Number(r?.nTotPaginas || nTotPaginas || 1);
        if (!nTotPaginas) nTotPaginas = 1;
        pagina++;
      }
    } finally {
      cli.release();
    }

    res.json({ ok:true, pais: totalPais, itens: totalItens });
  } catch (err) {
    console.error('[pcp/estruturas ALL] FAIL', err);
    res.status(500).json({ ok:false, error:String(err.message||err) });
  }
});

// Log simples em arquivo para acompanhar o processo no VS Code
const syncLogFile = path.join(__dirname, 'data', 'omie_sync.log');
function appendSyncLog(line) {
  try {
    const dir = path.dirname(syncLogFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const msg = `[${new Date().toISOString()}] ${line}`;
    fs.appendFileSync(syncLogFile, msg + "\n", 'utf8');
    // também loga no terminal (PM2) para acompanhar em tempo real
    try { console.log('[omie-sync]', line); } catch {}
  } catch (e) {
    console.warn('[omie-sync log] falha ao gravar log:', e?.message || e);
  }
}

async function doSyncProdutosOmie(options = {}) {
  const { max_paginas = 999, filtros = {}, filter = null } = options;
  if (!isDbEnabled) {
    throw new Error('Banco de dados não configurado.');
  }
  const appKey = process.env.OMIE_APP_KEY || OMIE_APP_KEY;
  const appSec = process.env.OMIE_APP_SECRET || OMIE_APP_SECRET;
  if (!appKey || !appSec) {
    appendSyncLog('Falha: OMIE_APP_KEY/OMIE_APP_SECRET ausentes (nem env nem config.server.js).');
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET não configurados no servidor.');
  }
  appendSyncLog('Iniciando sincronização de produtos (manual/agendada)');
  let pagina = 1;
  let totalPaginas = 1;
  let totalRegistros = 0;
  let processados = 0;
  const limitePaginas = Number(max_paginas) > 0 ? Number(max_paginas) : 999;

  // Se houver filtro por coluna, determine o conjunto de códigos a processar
  let allowedCodes = null;
  if (filter && filter.column && Array.isArray(filter.values) && filter.values.length) {
    const col = String(filter.column).toLowerCase();
    const allowedCols = new Set([
      'tipoitem','descricao_familia','origem_mercadoria','marca','modelo','importado_api','market_place','inativo','bloqueado','produto_lote','produto_variacao'
    ]);
    if (!allowedCols.has(col)) {
      throw new Error(`Coluna de filtro não permitida: ${col}`);
    }
    const values = filter.values.filter(v => v != null).map(v => String(v));
    if (values.length) {
      const q = `SELECT codigo_produto FROM public.produtos_omie WHERE ${col} = ANY($1)`;
      const r = await dbQuery(q, [values]);
      allowedCodes = new Set(r.rows.map(x => String(x.codigo_produto)));
      appendSyncLog(`Filtro ativo: coluna=${col}, valores=${values.length}, codigos=${allowedCodes.size}`);
    }
  }

  while (pagina <= totalPaginas && pagina <= limitePaginas) {
    appendSyncLog(`Baixando página ${pagina} (limite=${limitePaginas})`);
    
    // Rate limit: ~3 req/s → espera mínima de 333ms entre requisições
    if (pagina > 1) {
      await new Promise(r => setTimeout(r, 350));
    }
    
    let lote;
    try {
      lote = await withRetry(() => omieProdutosListarPagina(pagina, filtros));
      appendSyncLog(`Página ${pagina} recebida: pagina=${lote?.pagina ?? '?'}, registros=${lote?.registros ?? '?'}, total_de_paginas=${lote?.total_de_paginas ?? '?'}`);
    } catch (err) {
      appendSyncLog(`Erro ao baixar página ${pagina}: ${err?.message || err}`);
      throw err;
    }
    pagina += 1;

    totalPaginas = Number(lote?.total_de_paginas ?? lote?.nTotPaginas ?? lote?.totPaginas ?? totalPaginas);
    totalRegistros = Number(lote?.total_de_registros ?? lote?.nTotRegistros ?? totalRegistros);

    let produtos = Array.isArray(lote?.produto_servico_cadastro)
      ? lote.produto_servico_cadastro
      : (lote?.produto_servico_cadastro ? [lote.produto_servico_cadastro] : []);

    if (allowedCodes) {
      produtos = produtos.filter(p => {
        const cod = p?.codigo_produto ?? p?.codigo ?? p?.cCodigo ?? null;
        return cod != null && allowedCodes.has(String(cod));
      });
    }

    appendSyncLog(`Página processada: produtos=${produtos.length}`);

    if (produtos.length) {
      const wrapper = { produto_servico_cadastro: produtos };
      appendSyncLog(`Iniciando upsert no SQL: itens=${produtos.length}`);
      try {
        const { rows } = await dbQuery('SELECT public.omie_import_listarprodutos($1::jsonb) AS qtd', [wrapper]);
        const inc = Number(rows?.[0]?.qtd || 0);
        processados += inc;
        appendSyncLog(`Upsert realizados: +${inc} (acumulado ${processados})`);
      } catch (e) {
        appendSyncLog(`Falha no upsert SQL: ${e?.message || e}`);
        throw e;
      }
    } else {
      appendSyncLog('Nenhum produto na página após filtros.');
    }

    if (!totalPaginas || totalPaginas < 1) {
      totalPaginas = pagina - 1;
    }
  }

  const result = {
    ok: true,
    paginas_processadas: pagina - 1,
    total_paginas: totalPaginas,
    total_registros: totalRegistros,
    produtos_processados: processados
  };
  appendSyncLog(`Concluída sincronização: paginas=${result.paginas_processadas}, registros=${result.total_registros}, processados=${result.produtos_processados}`);
  return result;
}

app.post('/api/admin/sync/produtos-omie', express.json(), async (req, res) => {
  if (!isDbEnabled) {
    return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
  }

  const { max_paginas = 999, apenas_importado_api = false, apenas_omiepdv = false, filter } = req.body || {};
  const filtros = {
    apenas_importado_api,
    apenas_omiepdv
  };

  // Logs detalhados desde o clique do botão
  console.log('[sync/produtos-omie] requisição recebida:', { max_paginas, filtros, filter });
  appendSyncLog(`Requisição recebida no endpoint: max_paginas=${max_paginas}, filtros=${JSON.stringify(filtros)}, filter=${JSON.stringify(filter)}`);

  // Executa em background e responde imediatamente
  setImmediate(async () => {
    try {
      appendSyncLog('Iniciando tarefa em background para sincronização de produtos Omie…');

      // Usar método direto (evita problemas com child process + PM2)
  const result = await doSyncProdutosOmie({ max_paginas: Math.min(Number(max_paginas) || 1, 999), filtros, filter });
  appendSyncLog(`Sincronização finalizada com sucesso: total processado=${result?.total_upserts ?? result?.produtos_processados ?? 0}`);
      try {
        await pool.query(`UPDATE public.scheduled_task SET last_run_at = now(), last_ok = $1, last_summary = $2, updated_at = now() WHERE key = 'produtos-omie'`, [true, JSON.stringify(result)]);
      } catch {}
    } catch (err) {
      console.error('[sync/produtos-omie]', err);
      try { appendSyncLog(`Falha na sincronização: ${String(err?.message || err)}`); } catch {}
      try {
        await pool.query(`UPDATE public.scheduled_task SET last_run_at = now(), last_ok = $1, last_summary = $2, updated_at = now() WHERE key = 'produtos-omie'`, [false, String(err?.message || err)]);
      } catch {}
    }
  });

  res.status(202).json({ ok:true, started:true, message:'Sincronização iniciada. Acompanhe os logs e o histórico.' });
});

// Configuração de agendamento (GET/POST)
app.get('/api/admin/schedule/produtos-omie', async (req, res) => {
  try {
    const conf = await getProdutosOmieSchedule();
    return res.json({ ok: true, ...conf });
  } catch (e) {
    console.error('[GET schedule/produtos-omie]', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

app.post('/api/admin/schedule/produtos-omie', express.json(), async (req, res) => {
  try {
    if (!isDbEnabled) return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
    const { time, enabled = true, filter_column = null, filter_values = [] } = req.body || {};
    const t = parseHHMM(time || '');
    if (!t) return res.status(400).json({ ok:false, error:'Formato de horário inválido. Use HH:MM (00–23:59).' });

    await pool.query(
      `INSERT INTO public.scheduled_task(key, time, enabled, filter_column, filter_values, updated_at)
       VALUES ('produtos-omie', $1, $2, $3, $4, now())
       ON CONFLICT (key) DO UPDATE SET time = EXCLUDED.time, enabled = EXCLUDED.enabled, filter_column = EXCLUDED.filter_column, filter_values = EXCLUDED.filter_values, updated_at = now()`,
      [time, enabled === true, filter_column, Array.isArray(filter_values) ? filter_values : []]
    );

    // reprograma o timer atual
    await scheduleProdutosOmieJobFromDb();
    const conf = await getProdutosOmieSchedule();
    return res.json({ ok:true, ...conf });
  } catch (e) {
    console.error('[POST schedule/produtos-omie]', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Lista de colunas permitidas para filtro
const PRODUTOS_OMIE_ALLOWED_FILTER_COLUMNS = [
  { key: 'tipoitem', label: 'Tipo de Item' },
  { key: 'descricao_familia', label: 'Família (descrição)' },
  { key: 'origem_mercadoria', label: 'Origem da Mercadoria' },
  { key: 'marca', label: 'Marca' },
  { key: 'modelo', label: 'Modelo' },
  { key: 'importado_api', label: 'Importado via API (S/N)' },
  { key: 'market_place', label: 'Market Place (S/N)' },
  { key: 'inativo', label: 'Inativo (S/N)' },
  { key: 'bloqueado', label: 'Bloqueado (S/N)' },
  { key: 'produto_lote', label: 'Produto por Lote (S/N)' },
  { key: 'produto_variacao', label: 'Produto com Variação (S/N)' }
];

app.get('/api/admin/schedule/produtos-omie/columns', async (req, res) => {
  return res.json({ ok:true, columns: PRODUTOS_OMIE_ALLOWED_FILTER_COLUMNS });
});

app.get('/api/admin/schedule/produtos-omie/column-values', async (req, res) => {
  try {
    if (!isDbEnabled) return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
    const col = String(req.query.column || '').toLowerCase();
    const allowed = new Set(PRODUTOS_OMIE_ALLOWED_FILTER_COLUMNS.map(c => c.key));
    if (!allowed.has(col)) return res.status(400).json({ ok:false, error:'Coluna não permitida' });
    const q = `SELECT DISTINCT ${col} AS v FROM public.produtos_omie WHERE ${col} IS NOT NULL ORDER BY ${col} LIMIT 500`;
    const { rows } = await dbQuery(q, []);
    const values = rows.map(r => r.v).filter(v => v !== null).map(v => String(v));
    return res.json({ ok:true, column: col, values });
  } catch (e) {
    console.error('[GET column-values]', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Objetivo: Listar uma página específica de produtos da Omie (ListarProdutos)
// e opcionalmente filtrar um item pelo codigo (texto) ou codigo_produto (numérico).
// Uso: GET /api/admin/produtos-omie/listar-pagina?pagina=5&codigo=03.MP.N.62025
app.get('/api/admin/produtos-omie/listar-pagina', async (req, res) => {
  try {
    const pagina = Math.max(1, parseInt(String(req.query.pagina || '1'), 10) || 1);
    const codigo = req.query.codigo ? String(req.query.codigo).trim() : null;
    const codigoProduto = req.query.codigo_produto ? String(req.query.codigo_produto).trim() : null;

    // Chama a Omie para a página solicitada (registros_por_pagina = 500 por padrão no código)
    const lote = await omieProdutosListarPagina(pagina, {});
    const arr = Array.isArray(lote?.produto_servico_cadastro)
      ? lote.produto_servico_cadastro
      : (lote?.produto_servico_cadastro ? [lote.produto_servico_cadastro] : []);

    let itens = arr;
    if (codigo) {
      itens = itens.filter(p => String(p?.codigo || '').trim() === codigo);
    }
    if (codigoProduto) {
      itens = itens.filter(p => String(p?.codigo_produto || '') === String(codigoProduto));
    }

    return res.json({ ok:true, pagina: lote?.pagina, total_de_paginas: lote?.total_de_paginas, total_de_registros: lote?.total_de_registros, itens });
  } catch (e) {
    console.error('[GET /api/admin/produtos-omie/listar-pagina] erro →', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Objetivo: Expor um endpoint simples para checar rapidamente se um produto específico
// (identificado por codigo_produto) está atualizado no banco, permitindo validação
// pós-sincronização sem precisar abrir o banco manualmente.
// Uso: GET /api/admin/produtos-omie/check?codigo=03.MP.N.62025
// Retorna: { ok:true, produto: { codigo_produto, descricao, descricao_familia, ... } } ou 404 se não encontrado
app.get('/api/admin/produtos-omie/check', async (req, res) => {
  try {
    if (!isDbEnabled) {
      return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
    }
    const codigoText = (req.query.codigo ? String(req.query.codigo) : '').trim();
    const codigoProdRaw = (req.query.codigo_produto ? String(req.query.codigo_produto) : '').trim();

    let rows;
    if (codigoProdRaw) {
      // Busca por codigo_produto (bigint)
      const codigoProd = BigInt(codigoProdRaw);
      const q = `
        SELECT codigo_produto, codigo, descricao, descricao_familia, tipoitem, origem_mercadoria, marca, modelo,
               importado_api, market_place, inativo, bloqueado, produto_lote, produto_variacao, updated_at
          FROM public.produtos_omie
         WHERE codigo_produto = $1
         LIMIT 1`;
      ({ rows } = await dbQuery(q, [codigoProd.toString()]));
    } else if (codigoText) {
      // Busca por codigo (texto como '03.MP.N.62025')
      const q = `
        SELECT codigo_produto, codigo, descricao, descricao_familia, tipoitem, origem_mercadoria, marca, modelo,
               importado_api, market_place, inativo, bloqueado, produto_lote, produto_variacao, updated_at
          FROM public.produtos_omie
         WHERE codigo = $1
         LIMIT 1`;
      ({ rows } = await dbQuery(q, [codigoText]));
    } else {
      return res.status(400).json({ ok:false, error:'Forneça ?codigo (texto) ou ?codigo_produto (numérico).' });
    }
    if (!rows.length) {
      return res.status(404).json({ ok:false, error:'Produto não encontrado.' });
    }
    return res.json({ ok:true, produto: rows[0] });
  } catch (e) {
    console.error('[GET /api/admin/produtos-omie/check] erro →', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Objetivo: Comparar o estado do produto na Omie (via ConsultarProduto)
// versus o que está persistido no Postgres, retornando ambos e um diff simples.
// Uso: GET /api/admin/produtos-omie/compare?codigo=03.MP.N.62025
//      ou  /api/admin/produtos-omie/compare?codigo_produto=10516614657
app.get('/api/admin/produtos-omie/compare', async (req, res) => {
  try {
    if (!isDbEnabled) return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
    const codigoText = (req.query.codigo ? String(req.query.codigo) : '').trim();
    const codigoProdRaw = (req.query.codigo_produto ? String(req.query.codigo_produto) : '').trim();
    if (!codigoText && !codigoProdRaw) {
      return res.status(400).json({ ok:false, error:'Informe ?codigo (texto) ou ?codigo_produto (numérico).' });
    }

    // 1) Consultar na Omie
    const omie = await omieProdutosConsultar({
      codigo: codigoText || null,
      codigo_produto: codigoProdRaw || null
    });

    // Normalizar objeto Omie esperado
    const omieItem = omie?.produto_servico_cadastro || omie; // dependendo do formato
    const omieOut = {
      codigo_produto: omieItem?.codigo_produto ?? omieItem?.codigo ?? null,
      codigo: omieItem?.codigo ?? null,
      descricao: omieItem?.descricao ?? null,
      descricao_familia: omieItem?.descricao_familia ?? omieItem?.familia?.descricao ?? null,
      tipoitem: omieItem?.tipoitem ?? null,
      ncm: omieItem?.ncm ?? null,
      marca: omieItem?.marca ?? null,
      modelo: omieItem?.modelo ?? null,
      inativo: omieItem?.inativo ?? null,
      bloqueado: omieItem?.bloqueado ?? null,
      importado_api: omieItem?.importado_api ?? null
    };

    // 2) Buscar no Postgres
    let dbRows;
    if (codigoProdRaw || (omieOut.codigo_produto && String(omieOut.codigo_produto).match(/^\d+$/))) {
      const id = String(codigoProdRaw || omieOut.codigo_produto);
      const q = `SELECT codigo_produto::text AS codigo_produto, codigo, descricao, descricao_familia, tipoitem, ncm, marca, modelo, inativo, bloqueado, importado_api
                   FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`;
      ({ rows: dbRows } = await dbQuery(q, [id]));
    } else if (codigoText || omieOut.codigo) {
      const code = codigoText || omieOut.codigo;
      const q = `SELECT codigo_produto::text AS codigo_produto, codigo, descricao, descricao_familia, tipoitem, ncm, marca, modelo, inativo, bloqueado, importado_api
                   FROM public.produtos_omie WHERE codigo = $1 LIMIT 1`;
      ({ rows: dbRows } = await dbQuery(q, [code]));
    } else {
      dbRows = [];
    }

    const dbOut = dbRows?.[0] || null;

    // 3) Diff simples
    const keys = ['codigo_produto','codigo','descricao','descricao_familia','tipoitem','ncm','marca','modelo','inativo','bloqueado','importado_api'];
    const diff = [];
    for (const k of keys) {
      const a = omieOut?.[k] != null ? String(omieOut[k]).trim() : null;
      const b = dbOut?.[k] != null ? String(dbOut[k]).trim() : null;
      if (a !== b) diff.push({ campo: k, omie: a, db: b });
    }

    return res.json({ ok:true, codigo: codigoText || codigoProdRaw, omie: omieOut, db: dbOut, diff });
  } catch (e) {
    console.error('[GET /api/admin/produtos-omie/compare] erro →', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// IAPP: proxy para consultar ordens de produção por ID
// GET /api/iapp/ordens-producao/busca/:id → chama GET /manufatura/ordens-producao/busca/{id}
app.get('/api/iapp/ordens-producao/busca/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok:false, error:'Parâmetro :id é obrigatório.' });
    if (!IAPP_TOKEN || !IAPP_SECRET) {
      return res.status(503).json({ ok:false, error:'Credenciais IAPP ausentes.' });
    }
  const domain = String(req.query.domain || req.query.dominio || IAPP_DOMAIN || '').trim();
    let path = `/manufatura/ordens-producao/busca/${encodeURIComponent(id)}`;
    const hdrs = { Referer: 'http://localhost:5001' };
    const data = await iappGetHttp(path, 15000, hdrs);
    return res.json({ ok:true, id, data });
  } catch (e) {
    console.error('[IAPP busca OP] erro →', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// IAPP: proxy para listar ordens de produção
// GET /api/iapp/ordens-producao/lista
// → chama GET /manufatura/ordens-producao/lista?offset=0 (offset é obrigatório)
app.get('/api/iapp/ordens-producao/lista', async (req, res) => {
  try {
    if (!IAPP_TOKEN || !IAPP_SECRET) {
      return res.status(503).json({ ok:false, error:'Credenciais IAPP ausentes.' });
    }
    // A API IAPP exige o parâmetro offset obrigatoriamente
    // offset=0 retorna desde o início
    const offset = parseInt(req.query.offset || '0', 10);
    const path = `/manufatura/ordens-producao/lista?offset=${offset}`;
    const hdrs = { Referer: 'http://localhost:5001' };
    const data = await iappGetHttp(path, 15000, hdrs);
    return res.json({ ok:true, data });
  } catch (e) {
    console.error('[IAPP lista OP] erro →', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// IAPP: proxy para consultar ordens por identificação (preferido)
// GET /api/iapp/ordens-producao/busca-por-identificacao/:identificacao
// → chama GET /manufatura/ordens-producao/busca?identificacao={valor}
app.get('/api/iapp/ordens-producao/busca-por-identificacao/:identificacao', async (req, res) => {
  try {
    const identificacao = String(req.params.identificacao || '').trim();
    if (!identificacao) return res.status(400).json({ ok:false, error:'Parâmetro :identificacao é obrigatório.' });
    if (!IAPP_TOKEN || !IAPP_SECRET) {
      return res.status(503).json({ ok:false, error:'Credenciais IAPP ausentes.' });
    }
    const domain = String(req.query.domain || req.query.dominio || IAPP_DOMAIN || '').trim();
    let path = `/manufatura/ordens-producao/busca?identificacao=${encodeURIComponent(identificacao)}`;
    const hdrs = { Referer: 'http://localhost:5001' };
    const data = await iappGetHttp(path, 15000, hdrs);
    return res.json({ ok:true, identificacao, data });
  } catch (e) {
    console.error('[IAPP busca OP por identificacao] erro →', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Objetivo: Reprocessar (upsert) um único produto no Postgres puxando dados frescos da Omie
// via ConsultarProduto. Não altera schemas, só reaplica a função de importação.
// Uso: POST /api/admin/produtos-omie/upsert-one?codigo=... ou ?codigo_produto=...
app.post('/api/admin/produtos-omie/upsert-one', async (req, res) => {
  try {
    if (!isDbEnabled) return res.status(503).json({ ok:false, error:'Banco de dados não configurado.' });
    const codigoText = (req.query.codigo ? String(req.query.codigo) : '').trim();
    const codigoProdRaw = (req.query.codigo_produto ? String(req.query.codigo_produto) : '').trim();
    if (!codigoText && !codigoProdRaw) {
      return res.status(400).json({ ok:false, error:'Informe ?codigo (texto) ou ?codigo_produto (numérico).' });
    }
    const omie = await omieProdutosConsultar({ codigo: codigoText || null, codigo_produto: codigoProdRaw || null });
    const item = omie?.produto_servico_cadastro || omie;
    if (!item || (!item.codigo && !item.codigo_produto)) {
      return res.status(404).json({ ok:false, error:'Produto não encontrado na Omie.' });
    }
    const wrapper = { produto_servico_cadastro: [ item ] };
    const { rows } = await dbQuery('SELECT public.omie_import_listarprodutos($1::jsonb) AS qtd', [wrapper]);
    const qtd = Number(rows?.[0]?.qtd || 0);
    return res.json({ ok:true, upserts:qtd });
  } catch (e) {
    console.error('[POST /api/admin/produtos-omie/upsert-one] erro →', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

// Últimos logs do processo de sincronização (para UI)
app.get('/api/admin/schedule/produtos-omie/logs', async (req, res) => {
  try {
    const maxLines = Math.min(Math.max(parseInt(req.query.lines || '200', 10) || 200, 1), 1000);
    try {
      const st = fs.statSync(syncLogFile);
      const txt = fs.readFileSync(syncLogFile, 'utf8');
      const parts = txt.split(/\r?\n/);
      const lines = parts.slice(Math.max(0, parts.length - maxLines));
      return res.json({ ok:true, lines, size: st.size, mtime: st.mtime.toISOString() });
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        return res.json({ ok:true, lines: [], size: 0, mtime: null });
      }
      throw e;
    }
  } catch (e) {
    console.error('[GET logs produtos-omie]', e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});


// ---------- UI: leitura da estrutura (SQL) ----------
app.post('/api/pcp/estrutura', express.json(), async (req, res) => {
  try {
    const pai_codigo = (req.body?.pai_codigo || req.query.pai_codigo || '').toString().trim();
    const pai_id     = req.body?.pai_id ? Number(req.body.pai_id) : (
      req.query?.pai_id ? Number(req.query.pai_id) : null
    );

    let rows;
    if (pai_id || pai_codigo) {
      const where = pai_id ? 'cab.produto_id = $1' : 'cab.produto_codigo = $1';
      const param = pai_id ? [pai_id] : [pai_codigo];

      rows = (await pool.query(`
        SELECT
          cab.produto_id            AS pai_id,
          cab.produto_codigo        AS pai_codigo,
          cab.produto_descricao     AS pai_descricao,
          it.item_prod_id           AS comp_id,
          it.item_codigo            AS comp_codigo,
          it.item_descricao         AS comp_descricao,
          it.item_unidade           AS comp_unid,
          it.item_tipo              AS comp_tipo,
          it.quantidade             AS comp_qtd,
          it.perc_perda             AS comp_perda_pct,
          (it.quantidade * (1 + COALESCE(it.perc_perda,0)/100.0))::NUMERIC(18,6) AS comp_qtd_bruta
        FROM omie_malha_item it
        JOIN omie_malha_cab  cab ON cab.produto_id = it.produto_id
        WHERE ${where}
        ORDER BY it.item_codigo
      `, param)).rows;
    } else {
      rows = (await pool.query(`
        SELECT produto_id AS pai_id, produto_codigo AS pai_codigo, produto_descricao AS pai_descricao
        FROM omie_malha_cab
        ORDER BY produto_codigo
        LIMIT 500
      `)).rows;
    }

    const dados = rows.map(r => ({
      pai_id         : Number(r.pai_id) || null,
      pai_codigo     : r.pai_codigo || '',
      pai_descricao  : r.pai_descricao || '',
      comp_id        : r.comp_id || null,
      comp_codigo    : r.comp_codigo || '',
      comp_descricao : r.comp_descricao || '',
      comp_unid      : r.comp_unid || '',
      comp_tipo      : r.comp_tipo || '',
      comp_qtd       : Number(r.comp_qtd) || 0,
      comp_perda_pct : Number(r.comp_perda_pct) || 0,
      comp_qtd_bruta : Number(r.comp_qtd_bruta) || 0,
    }));

    res.json({ ok:true, count: dados.length, dados });
  } catch (err) {
    console.error('[pcp/estrutura SQL]', err);
    res.status(500).json({ ok:false, error:String(err.message||err) });
  }
});

// --- SQL helper: saldos por local para uma lista de códigos ---
app.post('/api/armazem/saldos_duplos', express.json(), async (req, res) => {
  try {
    const codigos = Array.isArray(req.body?.codigos) ? req.body.codigos.filter(Boolean) : [];
    if (!codigos.length) return res.json({ ok: true, pro: {}, alm: {} });

const sql = `
  SELECT
    local,
    produto_codigo AS codigo,         -- alias p/ manter o nome "codigo" na resposta
    COALESCE(saldo,0) AS saldo
  FROM v_almoxarifado_grid_atual
  WHERE local IN ($1, $2)
    AND produto_codigo = ANY($3::text[])   -- <— aqui também usa produto_codigo
`;

    const { rows } = await pool.query(sql, [PRODUCAO_LOCAL_PADRAO, ALMOX_LOCAL_PADRAO, codigos]);

    const pro = {}, alm = {};
    for (const r of rows) {
      const k = String(r.codigo || '');
      if (r.local === PRODUCAO_LOCAL_PADRAO) pro[k] = Number(r.saldo) || 0;
      else if (r.local === ALMOX_LOCAL_PADRAO) alm[k] = Number(r.saldo) || 0;
    }
    // faltantes viram 0 no front
    res.json({ ok: true, pro, alm, locais: { producao: PRODUCAO_LOCAL_PADRAO, almox: ALMOX_LOCAL_PADRAO } });
  } catch (err) {
    console.error('[saldos_duplos] FAIL', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});


const { PRE2024_COLUMNS, mapPre2024Rows } = require('./src/pre2024');

app.post('/api/iapp/historico-pre2024/sync', upload.single('file'), async (req, res) => {
  console.info('[pre2024-sync] início da sincronização');
  if (!req.file) {
    console.warn('[pre2024-sync] nenhuma planilha anexada ao request');
    return res.status(400).json({ ok:false, error:'Nenhum arquivo anexado.' });
  }

  try {
    console.info('[pre2024-sync] arquivo recebido', {
      nome: req.file.originalname,
      mimetype: req.file.mimetype,
      tamanho_bytes: req.file.size
    });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    // Sempre usa a aba 'PEDIDOS'
    const sheet = workbook.Sheets['PEDIDOS'];
    if (!sheet) {
      console.warn('[pre2024-sync] aba "PEDIDOS" não encontrada');
      return res.status(400).json({ ok:false, error:'A planilha precisa conter a aba "PEDIDOS".' });
    }

    const rawRows = XLSX.utils.sheet_to_json(sheet, { range: 1, defval: null });
    const mappedRows = mapPre2024Rows(rawRows);

    console.info('[pre2024-sync] linhas lidas', {
      total_sheet: rawRows.length,
      validas: mappedRows.length
    });

    if (!mappedRows.length) {
      console.warn('[pre2024-sync] nenhuma linha válida após mapeamento — abortando');
      return res.status(400).json({ ok:false, error:'Nenhuma linha válida encontrada na planilha.' });
    }

    const client = await pool.connect();
    let inserted = 0;
    let updated = 0;
    try {
      await client.query('BEGIN');
      let processed = 0;
      for (const row of mappedRows) {
        const keyParams = [row.pedido, row.modelo, row.ano, row.data_entrada_pedido];
        const deleteRes = await client.query(
          `DELETE FROM public.historico_pre2024
             WHERE pedido = $1
               AND COALESCE(modelo, '') = COALESCE($2, '')
               AND COALESCE(ano::text, '') = COALESCE($3::text, '')
               AND ((data_entrada_pedido = $4) OR (data_entrada_pedido IS NULL AND $4 IS NULL))`,
          keyParams
        );

        const insertValues = PRE2024_COLUMNS.map(col => row[col] ?? null);
        const placeholders = PRE2024_COLUMNS.map((_, idx) => `$${idx + 1}`).join(', ');
        await client.query(
          `INSERT INTO public.historico_pre2024 (${PRE2024_COLUMNS.join(', ')}) VALUES (${placeholders})`,
          insertValues
        );

        if (deleteRes.rowCount) updated += 1;
        else inserted += 1;
        processed += 1;

        if (processed <= 5) {
          console.debug('[pre2024-sync] linha processada', {
            pedido: row.pedido,
            modelo: row.modelo,
            ano: row.ano,
            data_entrada_pedido: row.data_entrada_pedido,
            foi_atualizacao: deleteRes.rowCount > 0
          });
        }
      }
      await client.query('COMMIT');
      console.info('[pre2024-sync] transação concluída', {
        inseridas: inserted,
        atualizadas: updated,
        total_processadas: mappedRows.length
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[pre2024-sync] erro durante transação, rollback executado');
      throw err;
    } finally {
      client.release();
    }

    res.json({
      ok: true,
      processed: mappedRows.length,
      inserted,
      updated,
      sheetName: 'PEDIDOS'
    });
  } catch (err) {
    console.error('[pre2024-sync] erro inesperado', err);
    res.status(500).json({ ok:false, error: err?.message || 'Erro ao processar planilha.' });
  }
});
