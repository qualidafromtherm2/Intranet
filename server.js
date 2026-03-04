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

// no topo: já deve ter dotenv/express carregados
const pcpEstruturaRoutes = require('./routes/pcp_estrutura');



// ——————————————————————————————
// 1) Imports e configurações iniciais
// ——————————————————————————————
const express = require('express');
const session       = require('express-session');
const { AsyncLocalStorage } = require('async_hooks');
const fs  = require('fs');           // todas as funções sync
const fsp = fs.promises;            // parte assíncrona (equivale a fs/promises)
const path          = require('path');
const multer        = require('multer');
// logo após os outros requires:
const archiver = require('archiver');
const crypto   = require('crypto');
// (se você usar fetch no Node <18, também faça: const fetch = require('node-fetch');)
const { parse: csvParse }         = require('csv-parse/sync');
const estoquePath = path.join(__dirname, 'data', 'estoque_acabado.json');
if (!globalThis.fetch) {
  globalThis.fetch = require("node-fetch");
}
const safeFetch = (...args) => globalThis.fetch(...args);
global.safeFetch = (...args) => globalThis.fetch(...args);
const app = express();
// Flag de debug para chat (silencia logs em produção por padrão)
const CHAT_DEBUG = process.env.CHAT_DEBUG === '1' || process.env.NODE_ENV === 'development';
// ===== Ingestão inicial de OPs (Omie → Postgres) ============================
const OP_REGS_PER_PAGE = 200; // ajuste fino: 100~500 (Omie aceita até 500)

// ==== SSE (Server-Sent Events) para avisar o front ao vivo ==================
const sseClients = new Set();
// server.js — sessão/cookies (COLE ANTES DAS ROTAS!)

// 🔐 Sessão (cookies) — DEVE vir antes das rotas /api/*
const isProd = process.env.NODE_ENV === 'production';
const callOmieDedup = require('./utils/callOmieDedup');
// Helper para registrar histórico de modificações de produto
const { registrarModificacao } = require('./utils/auditoria');
const LOCAIS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const locaisEstoqueCache = { at: 0, data: [], fonte: 'omie' };
app.set('trust proxy', 1); // necessário no Render (proxy) para cookie Secure funcionar
app.use(express.json({ limit: '5mb' })); // precisa vir ANTES de app.use('/api/auth', ...)

// server.js (antes das rotas HTML)
app.use('/pst_prep_eletrica',
  express.static(path.join(__dirname, 'pst_prep_eletrica'), { etag:false, maxAge:'1h' })
);

// === DEBUG BOOT / VIDA ======================================================
app.get('/__ping', (req, res) => {
  res.type('text/plain').send(`[OK] ${new Date().toISOString()}`);
});

app.post('/api/client-log', express.json({ limit: '200kb' }), (req, res) => {
  try {
    const payload = req.body || {};
    const level = String(payload.level || 'info').toLowerCase();
    const origem = String(payload.origem || 'frontend').slice(0, 120);
    const mensagem = String(payload.mensagem || '').slice(0, 2000);
    const contexto = payload.contexto && typeof payload.contexto === 'object' ? payload.contexto : {};
    const username = resolverUsuarioAuditoria(req) || 'anon';

    const linha = `[ClientLog/${origem}] user=${username} level=${level} msg=${mensagem}`;
    if (level === 'error') {
      console.error(linha, contexto);
    } else if (level === 'warn' || level === 'warning') {
      console.warn(linha, contexto);
    } else {
      console.log(linha, contexto);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[ClientLog] Falha ao processar payload:', err?.message || err);
    return res.status(500).json({ ok: false, error: 'Falha ao registrar log do cliente' });
  }
});


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
app.use('/api/colaboradores', require('./routes/colaboradores'));
app.use('/api/ri', require('./routes/ri'));
app.use('/api/pir', require('./routes/pir'));
app.use('/api/qualidade', require('./routes/qualidadeFotos'));
app.use('/api/registros', require('./routes/registros'));
app.use('/api/sac', require('./routes/sacEnvios'));

app.get('/api/produtos/stream', (req, res) => {
  const accept = String(req.headers?.accept || '');
  if (!accept.includes('text/event-stream')) {
    return res.status(406).json({ ok: false, error: 'Endpoint exclusivo para SSE (text/event-stream).' });
  }

  req.socket?.setTimeout?.(0);   // nunca expira
  req.socket?.setNoDelay?.(true);
  req.socket?.setKeepAlive?.(true, 15000);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  if (res.flushHeaders) res.flushHeaders();

  // instrui reconexão do EventSource em 10s caso a conexão caia
  res.write('retry: 10000\n\n');
  res.flush?.();

  // hello inicial
  res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`);
  res.flush?.();

  // heartbeat a cada 15s (comentário SSE mantém a conexão viva sem gerar eventos)
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
      res.flush?.();
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 15000);

  const client = { res, heartbeat };
  sseClients.add(client);
  console.log('[SSE] cliente conectado. total=', sseClients.size);

  const clean = () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    console.log('[SSE] cliente desconectado. total=', sseClients.size);
    try { res.end(); } catch {}
  };

  req.on('close', clean);
  res.on('error', clean);
  res.on('close', clean);
});

// ===== Endpoint de Verificação de Versão/Atualização ======================
// Objetivo: Permitir que o frontend detecte quando há uma nova versão disponível
// Busca a versão do banco de dados (tabela configuracoes.versao_sistema)
app.get('/api/check-version', async (req, res) => {
  try {
    // Busca versão do banco de dados
    const result = await pool.query(
      'SELECT versao, data_atualizacao FROM configuracoes.versao_sistema LIMIT 1'
    );
    
    if (result.rows.length === 0) {
      // Se tabela não existe, retorna erro instruindo a criação
      return res.status(500).json({ 
        ok: false, 
        error: 'Tabela versao_sistema não encontrada. Execute: sql/create_versao_sistema.sql',
        version: null
      });
    }
    
    const row = result.rows[0];
    const version = row.versao;
    const dataAtualizacao = row.data_atualizacao;
    
    console.log('[VERSION-CHECK] Versão atual do sistema:', version);
    
    res.json({
      ok: true,
      version: version,
      timestamp: new Date().toISOString(),
      dataAtualizacao: dataAtualizacao,
      message: 'Versão do sistema (do banco de dados)'
    });
  } catch (err) {
    console.error('[VERSION-CHECK] Erro ao buscar versão:', err);
    res.status(500).json({ 
      ok: false, 
      error: err.message || 'Erro ao buscar versão do sistema',
      version: null
    });
  }
});

// Conexão Postgres (Render)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});
const comprasAuditContext = new AsyncLocalStorage();
const originalPoolQuery = pool.query.bind(pool);
const originalPoolConnect = pool.connect.bind(pool);

function resolverUsuarioAuditoria(req) {
  const user = req?.session?.user || {};
  const candidato = user.username || user.fullName || user.login || user.id || null;
  return String(candidato || '').trim() || null;
}

// Encaminha pool.query para o client de contexto quando a rota está em /api/compras.
pool.query = function queryComContexto(...args) {
  const ctx = comprasAuditContext.getStore();
  if (ctx?.client) {
    return ctx.client.query(...args);
  }
  return originalPoolQuery(...args);
};

// Garante app.current_user também para clients obtidos via pool.connect dentro do contexto.
pool.connect = async function connectComContexto(...args) {
  const client = await originalPoolConnect(...args);
  const ctx = comprasAuditContext.getStore();
  if (ctx?.username) {
    try {
      await client.query(`SELECT set_config('app.current_user', $1, false)`, [ctx.username]);
    } catch (err) {
      console.warn('[Compras/Auditoria] Falha ao aplicar app.current_user no client:', err?.message || err);
    }
  }
  return client;
};

// Contexto de auditoria apenas para endpoints de compras.
app.use('/api/compras', (req, res, next) => {
  const inicio = Date.now();
  const usuario = resolverUsuarioAuditoria(req) || 'anon';
  const metodo = String(req.method || 'GET').toUpperCase();
  const rota = req.originalUrl || req.url || '/api/compras';

  console.log(`[Compras/Trace] -> ${metodo} ${rota} user=${usuario}`);

  res.on('finish', () => {
    const duracaoMs = Date.now() - inicio;
    console.log(`[Compras/Trace] <- ${metodo} ${rota} status=${res.statusCode} duracaoMs=${duracaoMs}`);
  });

  next();
});

app.use('/api/compras', async (req, res, next) => {
  const metodo = String(req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)) {
    return next();
  }

  const username = resolverUsuarioAuditoria(req);
  if (!username) {
    return next();
  }

  let client;
  let released = false;
  const releaseClient = () => {
    if (released) return;
    released = true;
    try { client?.release?.(); } catch {}
  };

  try {
    client = await originalPoolConnect();
    await client.query(`SELECT set_config('app.current_user', $1, false)`, [username]);
  } catch (err) {
    releaseClient();
    console.warn('[Compras/Auditoria] Falha ao criar contexto de auditoria:', err?.message || err);
    return next();
  }

  res.on('finish', releaseClient);
  res.on('close', releaseClient);

  comprasAuditContext.run({ username, client }, () => next());
});
const ProdutosEstruturaJsonClient = require(
  path.resolve(__dirname, 'utils/omie/ProdutosEstruturaJsonClient.js')
);
// opcional: log de saúde
pool.query('SELECT 1').then(() => {
  console.log('[pg] conectado');
}).catch(err => {
  console.error('[pg] falha conexão:', err?.message || err);
});


function parseDateBR(s){ if(!s) return null; const t=String(s).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t); return m?`${m[3]}-${m[2]}-${m[1]}`:null; }
function parseTimeSafe(s){ if(!s) return null; const t=String(s).trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(t) ? (t.length===5?`${t}:00`:t) : null; }

// upsert do cabeçalho
async function upsertCabecalho(client, ident={}, observacoes={}, custoProducao={}) {
  const {
    idProduto=null, intProduto=null, codProduto=null, descrProduto=null,
    tipoProduto=null, unidProduto=null, pesoLiqProduto=null, pesoBrutoProduto=null
  } = ident;
  const obs = observacoes?.obsRelevantes ?? null;
  const vMOD = custoProducao?.vMOD ?? null;
  const vGGF = custoProducao?.vGGF ?? null;

  const sel = await client.query(
    `SELECT id FROM public.omie_estrutura
       WHERE (cod_produto=$1 AND $1 IS NOT NULL)
          OR (id_produto=$2 AND $2 IS NOT NULL)
          OR (int_produto=$3 AND $3 IS NOT NULL)
       ORDER BY id ASC LIMIT 1`,
    [codProduto, idProduto, intProduto]
  );

  if (sel.rowCount) {
    const pid = sel.rows[0].id;
    await client.query(
      `UPDATE public.omie_estrutura
         SET descr_produto=$1, tipo_produto=$2, unid_produto=$3,
             peso_liq_produto=$4, peso_bruto_produto=$5,
             obs_relevantes=$6, v_mod=$7, v_ggf=$8,
             id_produto=COALESCE(id_produto,$9),
             int_produto=COALESCE(int_produto,$10),
             cod_produto=COALESCE(cod_produto,$11),
             origem='omie'
       WHERE id=$12`,
      [descrProduto,tipoProduto,unidProduto,pesoLiqProduto,pesoBrutoProduto,
       obs,vMOD,vGGF,idProduto,intProduto,codProduto,pid]
    );
    return pid;
  }

  const ins = await client.query(
    `INSERT INTO public.omie_estrutura
     (id_produto,int_produto,cod_produto,descr_produto,tipo_produto,unid_produto,
      peso_liq_produto,peso_bruto_produto,obs_relevantes,v_mod,v_ggf,origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'omie') RETURNING id`,
    [idProduto,intProduto,codProduto,descrProduto,tipoProduto,unidProduto,
     pesoLiqProduto,pesoBrutoProduto,obs,vMOD,vGGF]
  );
  return ins.rows[0].id;
}

// Atualiza integralmente a lista de itens da estrutura do 'parentId'.
// Regras:
//  - Snapshot ANTES de deletar itens (versao = atual, modificador = 'omie-sync').
//  - Se já existiam itens, incrementa omie_estrutura.versao; senão mantém 1.
//  - Atualiza omie_estrutura.modificador em TODOS os casos.
//  - Depois insere os itens (se houver).
async function replaceItens(client, parentId, itens = []) {
  // 1) Versão atual com lock
  const { rows: verRows } = await client.query(
    `SELECT COALESCE(versao,1) AS versao
       FROM public.omie_estrutura
      WHERE id = $1
      FOR UPDATE`,
    [parentId]
  );
  const versaoAtual = Number(verRows?.[0]?.versao || 1);

  // 2) Snapshot do estado ATUAL (antes de apagar)
  const MOD_SINC = 'omie-sync';
  await client.query(
    `
    INSERT INTO public.omie_estrutura_item_versao
    SELECT t.*, $2::int AS versao, $3::text AS modificador, now() as snapshot_at
      FROM public.omie_estrutura_item t
     WHERE t.parent_id = $1
    `,
    [parentId, versaoAtual, MOD_SINC]
  );

  // 3) Apaga itens antigos e mede se havia algo
  const delRes = await client.query(
    `DELETE FROM public.omie_estrutura_item WHERE parent_id=$1`,
    [parentId]
  );
  const hadPrevious = Number(delRes.rowCount || 0) > 0;

  // 4) Se não vierem itens, apenas atualiza cabeçalho e sai
  if (!Array.isArray(itens) || itens.length === 0) {
    if (hadPrevious) {
      await client.query(
        `UPDATE public.omie_estrutura
            SET versao = COALESCE(versao, 1) + 1,
                modificador = $2,
                updated_at = now()
          WHERE id = $1`,
        [parentId, MOD_SINC]
      );
    } else {
      await client.query(
        `UPDATE public.omie_estrutura
            SET versao = COALESCE(versao, 1),
                modificador = $2,
                updated_at = now()
          WHERE id = $1`,
        [parentId, MOD_SINC]
      );
    }
    return;
  }

  // 5) Dedup itens recebidos
  const norm = v => (v == null ? '' : String(v));
  const seen = new Set(); const dedup = [];
  for (const it of itens) {
    const key = [norm(it.codProdMalha), norm(it.intProdMalha), norm(it.idProdMalha)].join('|');
    if (seen.has(key)) continue; seen.add(key); dedup.push(it);
  }
  if (!dedup.length) {
    if (hadPrevious) {
      await client.query(
        `UPDATE public.omie_estrutura
            SET versao = COALESCE(versao, 1) + 1,
                modificador = $2,
                updated_at = now()
          WHERE id = $1`,
        [parentId, MOD_SINC]
      );
    } else {
      await client.query(
        `UPDATE public.omie_estrutura
            SET versao = COALESCE(versao, 1),
                modificador = $2,
                updated_at = now()
          WHERE id = $1`,
        [parentId, MOD_SINC]
      );
    }
    return;
  }

  // 6) INSERT em lote (como já estava)
  const text = `
    INSERT INTO public.omie_estrutura_item(
      parent_id,
      id_malha,int_malha,
      id_prod_malha,int_prod_malha,cod_prod_malha,descr_prod_malha,
      quant_prod_malha,unid_prod_malha,tipo_prod_malha,
      id_fam_malha,cod_fam_malha,descr_fam_malha,
      peso_liq_prod_malha,peso_bruto_prod_malha,
      perc_perda_prod_malha,obs_prod_malha,
      d_inc_prod_malha,h_inc_prod_malha,u_inc_prod_malha,
      d_alt_prod_malha,h_alt_prod_malha,u_alt_prod_malha,
      codigo_local_estoque
    )
    VALUES
    ${dedup.map((_,i)=>`(
      $1,
      $${2+i*23},$${3+i*23},
      $${4+i*23},$${5+i*23},$${6+i*23},$${7+i*23},
      $${8+i*23},$${9+i*23},$${10+i*23},
      $${11+i*23},$${12+i*23},$${13+i*23},
      $${14+i*23},$${15+i*23},
      $${16+i*23},$${17+i*23},
      $${18+i*23},$${19+i*23},$${20+i*23},
      $${21+i*23},$${22+i*23},$${23+i*23},
      $${24+i*23}
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
      parseDateBR(it.dIncProdMalha), parseTimeSafe(it.hIncProdMalha), it.uIncProdMalha ?? null,
      parseDateBR(it.dAltProdMalha), parseTimeSafe(it.hAltProdMalha), it.uAltProdMalha ?? null,
      it.codigo_local_estoque ?? null
    );
  }
  await client.query(text, vals);

  // 7) Incrementa/garante versão **e** marca modificador
  if (hadPrevious) {
    await client.query(
      `UPDATE public.omie_estrutura
          SET versao = COALESCE(versao, 1) + 1,
              modificador = $2,
              updated_at = now()
        WHERE id = $1`,
      [parentId, MOD_SINC]
    );
  } else {
    await client.query(
      `UPDATE public.omie_estrutura
          SET versao = COALESCE(versao, 1),
              modificador = $2,
              updated_at = now()
        WHERE id = $1`,
      [parentId, MOD_SINC]
    );
  }
}


async function resyncEstruturaDeProduto({ cod_produto=null, id_produto=null, int_produto=null }) {
  const omie = new ProdutosEstruturaJsonClient();
  let registro = null;
  try {
    if (omie.ConsultarEstrutura) {
registro = omie.ConsultarEstrutura({
  ident: {
    idProduto:  id_produto  || null,
    codProduto: cod_produto || null,
    intProduto: int_produto || null,
  }
});

    } else {
      const r = omie.ListarEstruturas({ nPagina:1, nRegPorPagina:200 });
      registro = (r?.produtosEncontrados || []).find(p=>{
        const i=p.ident||{};
        return (cod_produto && i.codProduto===cod_produto)
            || (id_produto && Number(i.idProduto)===Number(id_produto))
            || (int_produto && String(i.intProduto)===String(int_produto));
      }) || null;
    }
  } catch(e) {
    console.error('[estrutura webhook] consulta Omie:', e);
    registro = null;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!registro) { await client.query('COMMIT'); return; } // NUNCA apaga em "Excluido"
    const pid = await upsertCabecalho(client, registro.ident, registro.observacoes, registro.custoProducao);
    await replaceItens(client, pid, Array.isArray(registro.itens)?registro.itens:[]);
    await client.query('COMMIT');
  } catch(e){
    await client.query('ROLLBACK'); console.error('[estrutura webhook] upsert:', e);
  } finally { client.release(); }
}

// --- endpoint interno para re-sincronizar a estrutura de um produto ---
// proteção simples com token opcional
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || null;

app.post('/internal/pcp/estrutura/resync', express.json(), async (req, res) => {
  try {
    if (INTERNAL_TOKEN) {
      const tok = req.get('X-Internal-Token') || req.query.token || '';
      if (tok !== INTERNAL_TOKEN) return res.status(401).json({ ok:false, error:'unauthorized' });
    }
    const { cod_produto = null, id_produto = null, int_produto = null } = req.body || {};
    await resyncEstruturaDeProduto({ cod_produto, id_produto, int_produto });
    return res.json({ ok:true });
  } catch (e) {
    console.error('[estrutura/resync] erro:', e);
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
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
app.post('/api/users/:id/permissions/override', express.json(), async (req, res) => {
  const { id } = req.params;
  const { permissions, overrides } = req.body || {};

  // aceita tanto {permissions:[...]} quanto {overrides:[...]}
  const raw = Array.isArray(permissions)
    ? permissions
    : (Array.isArray(overrides) ? overrides : []);

  // normaliza e valida
  const rows = raw
    .map(p => ({
      node_id: Number(p?.node_id ?? p?.node ?? p?.id),
      allow: !!p?.allow
    }))
    .filter(p => Number.isInteger(p.node_id) && p.node_id > 0);

  try {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM auth_user_permission WHERE user_id = $1', [id]);

    if (rows.length) {
      const ids    = rows.map(r => r.node_id);
      const allows = rows.map(r => r.allow);

      // insere em lote com unnest (rápido e 100% SQL)
      await pool.query(
        `INSERT INTO auth_user_permission (user_id, node_id, allow)
         SELECT $1, unnest($2::bigint[]), unnest($3::boolean[])`,
        [id, ids, allows]
      );
    }

    await pool.query('COMMIT');
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('[permissions/override]', e);
    res.status(500).json({ error: 'Erro ao salvar permissões', detail: String(e.message || e) });
  }
});

// Resetar senha para 123 (provisória)
app.post('/api/users/:id/password/reset', express.json(), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      `UPDATE public.auth_user
         SET password_hash = crypt('123', gen_salt('bf')),
             updated_at = now()
       WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[password/reset]', e);
    res.status(500).json({ error: 'Erro ao resetar senha' });
  }
});


app.get('/api/users/:id/permissions', async (req,res)=>{
  const { id } = req.params;
  try {
    const q = await pool.query(`
      SELECT n.id, n.name, n.parent_id,
             COALESCE(up.allow, false) AS allow
      FROM auth_node n
      LEFT JOIN auth_user_permission up
        ON up.node_id = n.id AND up.user_id = $1
      ORDER BY n.parent_id NULLS FIRST, n.id
    `, [id]);
    res.json(q.rows);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:'Erro ao listar permissões' });
  }
});


// ─── Config. dinâmica de etiqueta ─────────────────────────
const etqConfigPath = path.join(__dirname, 'csv', 'Configuração_etq_caracteristicas.csv');
const { dbQuery, isDbEnabled } = require('./src/db');   // nosso módulo do Passo 1
const produtosRouter = require('./routes/produtos');
const engenhariaRouter = require('./routes/engenharia')(pool);
const comprasRouter = require('./routes/compras')(pool);
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
const CHAT_FILE  = path.join(__dirname, 'data', 'chat.json');
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

// === Busca de produtos SOMENTE em public.produtos_omie =======================
// Espera { q } e retorna { itens: [{ codigo, descricao, fontes: ['public.produtos_omie'] }] }
app.post('/api/produtos/busca', express.json(), async (req, res) => {
  try {
    console.log('\n[API] /api/produtos/busca -> recebido body:', req.body);
    const q = String(req.body?.q || '').trim();
    if (q.length < 2) {
      console.log('[API] /api/produtos/busca -> termo curto, ignorando. q="' + q + '"');
      return res.json({ itens: [] });
    }

    // Ajuste o schema abaixo se não for "public"
    const schemaTable = 'public.produtos_omie';

    // DISTINCT/Group para evitar duplicatas; PP primeiro; limita volume
    const sql = `
      SELECT
        s.codigo,
        s.descricao,
        s.codigo_produto,
        ARRAY['${schemaTable}']::text[] AS fontes
      FROM (
        SELECT DISTINCT
          codigo::text   AS codigo,
          descricao::text AS descricao,
          codigo_produto::bigint AS codigo_produto
        FROM ${schemaTable}
        WHERE codigo ILIKE $1 OR descricao ILIKE $1
      ) s
      ORDER BY (CASE WHEN s.codigo ILIKE '%.PP.%' THEN 1 ELSE 0 END) DESC,
               s.codigo ASC
      LIMIT 300
    `;

    const term = `%${q}%`;
    console.log('[API] /api/produtos/busca -> executando SQL com term =', term);
    const { rows } = await pool.query(sql, [term]);

    // Log (até 20 itens)
    try {
      const maxLog = Math.min(rows.length, 20);
      console.log(`[API] /api/produtos/busca (produtos_omie) q="${q}" → ${rows.length} itens (mostrando ${maxLog})`);
      for (let i = 0; i < maxLog; i++) {
        const r = rows[i];
        console.log(`  ${r.codigo} | ${String(r.descricao || '').slice(0, 90)} | fontes: ${r.fontes.join(', ')}`);
      }
    } catch (_) {}

    res.json({ itens: rows || [] });
  } catch (err) {
    console.error('[API] /api/produtos/busca erro:', err, 'body:', req.body);
    res.status(500).json({ error: 'Falha na busca' });
  }
});

// Qualidade: registra inspeção em qualidade.produtos_liberado
app.post('/api/qualidade/produtos-liberado', express.json(), async (req, res) => {
  try {
    const cod_produto = String(req.body?.cod_produto || '').trim();
    const nfe = String(req.body?.nfe || '').trim();
    const frequencia = String(req.body?.frequencia || '').trim();
    const quantidadeOk = req.body?.quantidade_ok;
    const quantidadeNok = req.body?.quantidade_nok;

    if (!cod_produto) {
      return res.status(400).json({ ok: false, error: 'cod_produto é obrigatório' });
    }
    if (!nfe) {
      return res.status(400).json({ ok: false, error: 'nfe é obrigatória' });
    }
    if (quantidadeOk === undefined || quantidadeOk === null || Number.isNaN(Number(quantidadeOk))) {
      return res.status(400).json({ ok: false, error: 'quantidade_ok é obrigatória' });
    }

    const quantidadeOkNum = Number(quantidadeOk);
    const quantidadeNokNum = quantidadeNok === null || quantidadeNok === undefined || quantidadeNok === ''
      ? null
      : Number(quantidadeNok);

    if (quantidadeNokNum !== null && Number.isNaN(quantidadeNokNum)) {
      return res.status(400).json({ ok: false, error: 'quantidade_nok inválida' });
    }

    const frequenciaValor = frequencia ? frequencia : null;
    const nfeValor = nfe ? nfe : null;

    const colunaNfe = await pool.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'qualidade'
          AND table_name = 'produtos_liberado'
          AND column_name = 'nfe'
        LIMIT 1`
    );
    const temNfe = colunaNfe.rowCount > 0;
    if (!temNfe) {
      return res.status(400).json({ ok: false, error: 'Coluna nfe não existe. Execute a migração.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO qualidade.produtos_liberado
        (cod_produto, data_inspecao, nfe, frequencia, status, quantidade_ok, quantidade_nok)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
       RETURNING id`,
      [cod_produto, nfeValor, frequenciaValor, 'Liberado', quantidadeOkNum, quantidadeNokNum]
    );

    res.json({ ok: true, id: rows[0]?.id || null });
  } catch (err) {
    console.error('[API] /api/qualidade/produtos-liberado erro:', err);
    res.status(500).json({ ok: false, error: 'Erro ao registrar inspeção' });
  }
});

// Qualidade: lista NFe recentes por produto (últimos 3 recebimentos)
app.get('/api/qualidade/nfe-por-produto/:codigo_produto', async (req, res) => {
  try {
    const codigoProduto = String(req.params.codigo_produto || '').trim();
    if (!codigoProduto) {
      return res.json({ ok: true, itens: [] });
    }

    const { rows } = await pool.query(
      `WITH ultimos AS (
         SELECT n_id_receb, created_at
           FROM logistica.recebimentos_nfe_itens
          WHERE n_id_produto = $1
          ORDER BY created_at DESC NULLS LAST
          LIMIT 3
       )
       SELECT u.n_id_receb, r.c_numero_nfe
         FROM ultimos u
         JOIN logistica.recebimentos_nfe_omie r
           ON r.n_id_receb = u.n_id_receb
        WHERE r.c_numero_nfe IS NOT NULL
        ORDER BY u.created_at DESC NULLS LAST`,
      [codigoProduto]
    );

    const unicos = [];
    const vistos = new Set();
    rows.forEach((row) => {
      const valor = String(row.c_numero_nfe || '').trim();
      if (!valor || vistos.has(valor)) return;
      vistos.add(valor);
      unicos.push(valor);
    });

    res.json({ ok: true, itens: unicos });
  } catch (err) {
    console.error('[API] /api/qualidade/nfe-por-produto erro:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar NFe' });
  }
});

// Qualidade: lista todos os registros de produtos liberados
app.get('/api/qualidade/produtos-liberado', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
         FROM qualidade.produtos_liberado
        ORDER BY id DESC`
    );
    res.json({ ok: true, itens: rows || [] });
  } catch (err) {
    console.error('[API] /api/qualidade/produtos-liberado GET erro:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar registros' });
  }
});

// GET /api/produtos/imagem/:codigo_produto - Retorna a primeira imagem do produto
app.get('/api/produtos/imagem/:codigo_produto', async (req, res) => {
  try {
    const codigoProduto = String(req.params.codigo_produto || '').trim();
    if (!codigoProduto) {
      return res.json({ ok: true, url_imagem: null });
    }
    const { rows } = await pool.query(
      `SELECT TRIM(url_imagem) AS url_imagem
       FROM public.produtos_omie_imagens
       WHERE codigo_produto = $1
       ORDER BY pos NULLS LAST, id ASC
       LIMIT 1`,
      [codigoProduto]
    );
    const url = rows[0]?.url_imagem || null;
    res.json({ ok: true, url_imagem: url });
  } catch (err) {
    console.error('[API] /api/produtos/imagem erro:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar imagem do produto' });
  }
});

// === Engenharia: listar produtos "Em criação" com contagem de Check-Proj ===
// Retorna JSON { itens: [{ codigo, descricao, check_concluidas, check_total, check_percentual }] }
app.get('/api/engenharia/em-criacao', async (req, res) => {
  try {
    // Busca produtos "Em criação" com suas atividades de engenharia (Check-Proj) e compras
    const sql = `
      WITH produtos_eng AS (
        SELECT 
          codigo::text AS codigo, 
          descricao::text AS descricao,
          codigo_familia::text AS familia
        FROM public.produtos_omie
        WHERE descricao ILIKE 'Em criação%' 
        ORDER BY codigo ASC
        LIMIT 1000
      ),
      stats_check_eng AS (
        -- Atividades de engenharia da família
        SELECT 
          pe.codigo,
          COUNT(af.id) AS total_atividades,
          COUNT(CASE WHEN s.concluido = true OR s.nao_aplicavel = true THEN 1 END) AS concluidas
        FROM produtos_eng pe
        LEFT JOIN engenharia.atividades_familia af 
          ON af.familia_codigo = pe.familia AND af.ativo = true
        LEFT JOIN engenharia.atividades_produto_status s
          ON s.atividade_id = af.id AND s.produto_codigo = pe.codigo
        GROUP BY pe.codigo
        
        UNION ALL
        
        -- Atividades de engenharia específicas do produto
        SELECT 
          ap.produto_codigo AS codigo,
          COUNT(ap.id) AS total_atividades,
          COUNT(CASE WHEN aps.concluido = true OR aps.nao_aplicavel = true THEN 1 END) AS concluidas
        FROM engenharia.atividades_produto ap
        LEFT JOIN engenharia.atividades_produto_status_especificas aps
          ON aps.atividade_produto_id = ap.id AND aps.produto_codigo = ap.produto_codigo
        WHERE ap.ativo = true
        GROUP BY ap.produto_codigo
      ),
      stats_check_compras AS (
        -- Atividades de compras da família
        SELECT 
          pe.codigo,
          COUNT(af.id) AS total_atividades,
          COUNT(CASE WHEN s.concluido = true OR s.nao_aplicavel = true THEN 1 END) AS concluidas
        FROM produtos_eng pe
        LEFT JOIN compras.atividades_familia af 
          ON af.familia_codigo = pe.familia AND af.ativo = true
        LEFT JOIN compras.atividades_produto_status s
          ON s.atividade_id = af.id AND s.produto_codigo = pe.codigo
        GROUP BY pe.codigo
        
        UNION ALL
        
        -- Atividades de compras específicas do produto
        SELECT 
          ap.produto_codigo AS codigo,
          COUNT(ap.id) AS total_atividades,
          COUNT(CASE WHEN aps.concluido = true OR aps.nao_aplicavel = true THEN 1 END) AS concluidas
        FROM compras.atividades_produto ap
        LEFT JOIN compras.atividades_produto_status_especificas aps
          ON aps.atividade_produto_id = ap.id AND aps.produto_codigo = ap.produto_codigo
        WHERE ap.ativo = true
        GROUP BY ap.produto_codigo
      ),
      stats_agregadas_eng AS (
        SELECT 
          codigo,
          SUM(total_atividades) AS total_atividades,
          SUM(concluidas) AS concluidas
        FROM stats_check_eng
        GROUP BY codigo
      ),
      stats_agregadas_compras AS (
        SELECT 
          codigo,
          SUM(total_atividades) AS total_atividades,
          SUM(concluidas) AS concluidas
        FROM stats_check_compras
        GROUP BY codigo
      )
      SELECT 
        pe.codigo,
        pe.descricao,
        pe.familia,
        COALESCE(sae.concluidas, 0)::int AS eng_concluidas,
        COALESCE(sae.total_atividades, 0)::int AS eng_total,
        CASE 
          WHEN COALESCE(sae.total_atividades, 0) = 0 THEN 0
          ELSE ROUND((COALESCE(sae.concluidas, 0)::decimal / sae.total_atividades) * 100)
        END AS eng_percentual,
        COALESCE(sac.concluidas, 0)::int AS compras_concluidas,
        COALESCE(sac.total_atividades, 0)::int AS compras_total,
        CASE 
          WHEN COALESCE(sac.total_atividades, 0) = 0 THEN 0
          ELSE ROUND((COALESCE(sac.concluidas, 0)::decimal / sac.total_atividades) * 100)
        END AS compras_percentual
      FROM produtos_eng pe
      LEFT JOIN stats_agregadas_eng sae ON sae.codigo = pe.codigo
      LEFT JOIN stats_agregadas_compras sac ON sac.codigo = pe.codigo
      ORDER BY pe.codigo ASC;
    `;
    const { rows: produtos } = await pool.query(sql);
    
    // Para cada produto, calcular completude (gráfico circular)
    const resultado = [];
    for (const produto of produtos) {
      try {
        // Busca dados completos do produto via API interna
        const detalhesResp = await fetch(`http://localhost:5001/api/produtos/detalhe?codigo=${encodeURIComponent(produto.codigo)}`);
        if (!detalhesResp.ok) {
          resultado.push({
            codigo: produto.codigo,
            descricao: produto.descricao,
            completude_concluidas: 0,
            completude_total: 0,
            completude_percentual: 0,
            eng_concluidas: produto.eng_concluidas,
            eng_total: produto.eng_total,
            eng_percentual: produto.eng_percentual,
            compras_concluidas: produto.compras_concluidas,
            compras_total: produto.compras_total,
            compras_percentual: produto.compras_percentual
          });
          continue;
        }
        
        const dados = await detalhesResp.json();
        
        // Busca campos obrigatórios da família
        const camposQuery = `
          SELECT cg.chave
          FROM configuracoes.familia_campos_obrigatorios fco
          INNER JOIN configuracoes.campos_guias cg ON cg.chave = fco.campo_chave
          WHERE fco.familia_codigo = $1 AND fco.obrigatorio = true
        `;
        const { rows: campos } = await pool.query(camposQuery, [produto.familia]);
        
        const totalCampos = campos.length;
        let camposPreenchidos = 0;
        
        // Verifica cada campo obrigatório
        campos.forEach(campo => {
          const chave = campo.chave;
          // Busca valor no objeto dados (suporta chaves aninhadas)
          const valor = chave.split('.').reduce((o, k) => o?.[k], dados);
          // Considera preenchido se não for null, undefined, string vazia
          if (valor !== null && valor !== undefined && String(valor).trim() !== '') {
            camposPreenchidos++;
          }
        });
        
        const percentual = totalCampos > 0 ? Math.round((camposPreenchidos / totalCampos) * 100) : 0;
        
        resultado.push({
          codigo: produto.codigo,
          descricao: produto.descricao,
          completude_concluidas: camposPreenchidos,
          completude_total: totalCampos,
          completude_percentual: percentual,
          eng_concluidas: produto.eng_concluidas,
          eng_total: produto.eng_total,
          eng_percentual: produto.eng_percentual,
          compras_concluidas: produto.compras_concluidas,
          compras_total: produto.compras_total,
          compras_percentual: produto.compras_percentual
        });
      } catch (err) {
        console.error(`[API] Erro ao processar produto ${produto.codigo}:`, err);
        resultado.push({
          codigo: produto.codigo,
          descricao: produto.descricao,
          completude_concluidas: 0,
          completude_total: 0,
          completude_percentual: 0,
          eng_concluidas: produto.eng_concluidas,
          eng_total: produto.eng_total,
          eng_percentual: produto.eng_percentual,
          compras_concluidas: produto.compras_concluidas,
          compras_total: produto.compras_total,
          compras_percentual: produto.compras_percentual
        });
      }
    }
    
    res.json({ itens: resultado });
  } catch (err) {
    console.error('[API] /api/engenharia/em-criacao erro:', err);
    res.status(500).json({ error: 'Falha ao listar produtos em criação' });
  }
});

// Endpoint para detalhes de cadastro (campos pendentes)
app.get('/api/engenharia/produto-cadastro/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    // Busca dados completos do produto
    const detalhesResp = await fetch(`http://localhost:5001/api/produtos/detalhe?codigo=${encodeURIComponent(codigo)}`);
    if (!detalhesResp.ok) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    const dados = await detalhesResp.json();
    const familia = dados.codigo_familia;
    
    if (!familia) {
      return res.json({ campos_pendentes: [], campos_preenchidos: [] });
    }
    
    // Busca campos obrigatórios da família
    const camposQuery = `
      SELECT cg.chave, cg.rotulo
      FROM configuracoes.familia_campos_obrigatorios fco
      INNER JOIN configuracoes.campos_guias cg ON cg.chave = fco.campo_chave
      WHERE fco.familia_codigo = $1 AND fco.obrigatorio = true
      ORDER BY cg.rotulo
    `;
    const { rows: campos } = await pool.query(camposQuery, [familia]);
    
    const camposPendentes = [];
    const camposPreenchidos = [];
    
    // Verifica cada campo obrigatório
    campos.forEach(campo => {
      const chave = campo.chave;
      const valor = chave.split('.').reduce((o, k) => o?.[k], dados);
      const preenchido = valor !== null && valor !== undefined && String(valor).trim() !== '';
      
      if (preenchido) {
        camposPreenchidos.push({
          chave: campo.chave,
          nome: campo.rotulo,
          valor: String(valor)
        });
      } else {
        camposPendentes.push({
          chave: campo.chave,
          nome: campo.rotulo
        });
      }
    });
    
    res.json({ campos_pendentes: camposPendentes, campos_preenchidos: camposPreenchidos });
  } catch (err) {
    console.error('[API] /api/engenharia/produto-cadastro erro:', err);
    res.status(500).json({ error: 'Falha ao buscar detalhes do cadastro' });
  }
});

// Endpoint para detalhes de engenharia (tarefas)
app.get('/api/engenharia/produto-tarefas/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    // Busca produto para pegar a família
    const produtoQuery = `SELECT codigo_familia FROM public.produtos_omie WHERE codigo = $1`;
    const { rows: [produto] } = await pool.query(produtoQuery, [codigo]);
    
    if (!produto) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    // Busca atividades da família
    const atividadesFamiliaQuery = `
      SELECT 
        af.id,
        af.nome_atividade,
        af.descricao_atividade,
        COALESCE(s.concluido, false) AS concluido,
        COALESCE(s.nao_aplicavel, false) AS nao_aplicavel,
        s.observacao,
        s.data_conclusao,
        s.responsavel_username AS responsavel,
        s.autor_username AS autor,
        s.prazo,
        'familia' AS origem
      FROM engenharia.atividades_familia af
      LEFT JOIN engenharia.atividades_produto_status s
        ON s.atividade_id = af.id AND s.produto_codigo = $1
      WHERE af.familia_codigo = $2 AND af.ativo = true
      ORDER BY af.ordem ASC, af.created_at ASC
    `;
    const { rows: atividadesFamilia } = await pool.query(atividadesFamiliaQuery, [codigo, produto.codigo_familia]);
    
    // Busca atividades específicas do produto
    const atividadesProdutoQuery = `
      SELECT 
        ap.id,
        ap.descricao AS nome_atividade,
        ap.observacoes AS descricao_atividade,
        COALESCE(s.concluido, false) AS concluido,
        COALESCE(s.nao_aplicavel, false) AS nao_aplicavel,
        s.observacao_status AS observacao,
        s.atualizado_em AS data_conclusao,
        s.responsavel_username AS responsavel,
        s.autor_username AS autor,
        s.prazo,
        'produto' AS origem
      FROM engenharia.atividades_produto ap
      LEFT JOIN engenharia.atividades_produto_status_especificas s
        ON s.atividade_produto_id = ap.id AND s.produto_codigo = $1
      WHERE ap.produto_codigo = $1 AND ap.ativo = true
      ORDER BY ap.criado_em DESC
    `;
    const { rows: atividadesProduto } = await pool.query(atividadesProdutoQuery, [codigo]);
    
    const todasAtividades = [...atividadesFamilia, ...atividadesProduto];
    const concluidas = todasAtividades.filter(a => a.concluido || a.nao_aplicavel);
    const pendentes = todasAtividades.filter(a => !a.concluido && !a.nao_aplicavel);
    
    res.json({ concluidas, pendentes, total: todasAtividades.length });
  } catch (err) {
    console.error('[API] /api/engenharia/produto-tarefas erro:', err);
    res.status(500).json({ error: 'Falha ao buscar tarefas de engenharia' });
  }
});

// Endpoint para detalhes de compras (tarefas)
app.get('/api/engenharia/produto-compras/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    // Busca produto para pegar a família
    const produtoQuery = `SELECT codigo_familia FROM public.produtos_omie WHERE codigo = $1`;
    const { rows: [produto] } = await pool.query(produtoQuery, [codigo]);
    
    if (!produto) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    // Busca atividades da família
    const atividadesFamiliaQuery = `
      SELECT 
        af.id,
        af.nome_atividade,
        af.descricao_atividade,
        COALESCE(s.concluido, false) AS concluido,
        COALESCE(s.nao_aplicavel, false) AS nao_aplicavel,
        s.observacao,
        s.data_conclusao,
        s.responsavel_username AS responsavel,
        s.autor_username AS autor,
        s.prazo,
        'familia' AS origem
      FROM compras.atividades_familia af
      LEFT JOIN compras.atividades_produto_status s
        ON s.atividade_id = af.id AND s.produto_codigo = $1
      WHERE af.familia_codigo = $2 AND af.ativo = true
      ORDER BY af.ordem ASC, af.created_at ASC
    `;
    const { rows: atividadesFamilia } = await pool.query(atividadesFamiliaQuery, [codigo, produto.codigo_familia]);
    
    // Busca atividades específicas do produto
    const atividadesProdutoQuery = `
      SELECT 
        ap.id,
        ap.descricao AS nome_atividade,
        ap.observacoes AS descricao_atividade,
        COALESCE(s.concluido, false) AS concluido,
        COALESCE(s.nao_aplicavel, false) AS nao_aplicavel,
        s.observacao_status AS observacao,
        s.data_conclusao,
        s.responsavel_username AS responsavel,
        s.autor_username AS autor,
        s.prazo,
        'produto' AS origem
      FROM compras.atividades_produto ap
      LEFT JOIN compras.atividades_produto_status_especificas s
        ON s.atividade_produto_id = ap.id AND s.produto_codigo = $1
      WHERE ap.produto_codigo = $1 AND ap.ativo = true
      ORDER BY ap.criado_em DESC
    `;
    const { rows: atividadesProduto } = await pool.query(atividadesProdutoQuery, [codigo]);
    
    const todasAtividades = [...atividadesFamilia, ...atividadesProduto];
    const concluidas = todasAtividades.filter(a => a.concluido || a.nao_aplicavel);
    const pendentes = todasAtividades.filter(a => !a.concluido && !a.nao_aplicavel);
    
    res.json({ concluidas, pendentes, total: todasAtividades.length });
  } catch (err) {
    console.error('[API] /api/engenharia/produto-compras erro:', err);
    res.status(500).json({ error: 'Falha ao buscar tarefas de compras' });
  }
});

// Endpoint: usuários ativos (auth_user)
app.get('/api/usuarios/ativos', async (req, res) => {
  try {
    const query = `SELECT username FROM public.auth_user WHERE is_active = true ORDER BY username ASC`;
    const { rows } = await pool.query(query);
    res.json({ usuarios: rows });
  } catch (err) {
    console.error('[API] /api/usuarios/ativos erro:', err);
    res.status(500).json({ error: 'Falha ao listar usuários ativos' });
  }
});


// === Busca total de registros da Omie para gerar código sequencial ===========
app.get('/api/produtos/total-omie', async (req, res) => {
  try {
    const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
    const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

    if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return res.status(500).json({ error: 'Credenciais Omie não configuradas' });
    }

    const omieResp = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarProdutosResumido',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina: 1,
          registros_por_pagina: 1,
          apenas_importado_api: 'N',
          filtrar_apenas_omiepdv: 'N'
        }]
      })
    });

    if (!omieResp.ok) {
      const errText = await omieResp.text();
      console.error('[API] /api/produtos/total-omie erro Omie:', omieResp.status, errText);
      return res.status(omieResp.status).json({ error: 'Erro ao buscar total de produtos da Omie' });
    }

    const omieData = await omieResp.json();
    const totalRegistros = omieData.total_de_registros || 0;

    console.log('[API] /api/produtos/total-omie → total:', totalRegistros);
    res.json({ total_de_registros: totalRegistros });
  } catch (err) {
    console.error('[API] /api/produtos/total-omie erro:', err);
    res.status(500).json({ error: 'Falha ao buscar total de produtos' });
  }
});

// === Listar unidades do banco de dados =============================================
app.get('/api/produtos/unidades', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, unidade AS codigo, descricao FROM configuracoes.unidade ORDER BY unidade ASC'
    );

    const unidades = result.rows || [];

    console.log('[API] /api/produtos/unidades → total:', unidades.length);
    res.json({ unidade_cadastro: unidades });
  } catch (err) {
    console.error('[API] /api/produtos/unidades erro:', err);
    res.status(500).json({ error: 'Falha ao buscar unidades' });
  }
});

// === Incluir produto na Omie =============================================
app.post('/api/produtos/incluir-omie', async (req, res) => {
  try {
    const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
    const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

    if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return res.status(500).json({ error: 'Credenciais Omie não configuradas' });
    }

    const { codigo_produto_integracao, codigo, descricao, unidade } = req.body;

    if (!codigo_produto_integracao || !codigo || !descricao || !unidade) {
      return res.status(400).json({ error: 'Parâmetros obrigatórios faltando' });
    }

    console.log('[API] /api/produtos/incluir-omie recebido:', {
      codigo_produto_integracao,
      codigo,
      descricao,
      unidade
    });

    const omieResp = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'IncluirProduto',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          codigo_produto_integracao,
          codigo,
          descricao,
          ncm: '0000.00.00',
          unidade
        }]
      })
    });

    if (!omieResp.ok) {
      const errText = await omieResp.text();
      console.error('[API] /api/produtos/incluir-omie erro Omie:', omieResp.status, errText);
      return res.status(omieResp.status).json({ error: 'Erro ao incluir produto na Omie' });
    }

    const omieData = await omieResp.json();
    
    console.log('[API] /api/produtos/incluir-omie → sucesso:', omieData);
    res.json(omieData);
  } catch (err) {
    console.error('[API] /api/produtos/incluir-omie erro:', err);
    res.status(500).json({ error: 'Falha ao incluir produto' });
  }
});

// === Consultar produto na Omie =============================================
app.get('/api/produtos/consultar-omie/:codigoProduto', async (req, res) => {
  try {
    const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
    const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

    if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return res.status(500).json({ error: 'Credenciais Omie não configuradas' });
    }

    const codigoProduto = req.params.codigoProduto;

    if (!codigoProduto) {
      return res.status(400).json({ error: 'codigo_produto é obrigatório' });
    }

    console.log('[API] /api/produtos/consultar-omie → buscando:', codigoProduto);

    const omieResp = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ConsultarProduto',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ codigo_produto: parseInt(codigoProduto) }]
      })
    });

    if (!omieResp.ok) {
      const errText = await omieResp.text();
      console.error('[API] /api/produtos/consultar-omie erro Omie:', omieResp.status, errText);
      return res.status(omieResp.status).json({ error: 'Produto não encontrado ou erro na Omie', encontrado: false });
    }

    const omieData = await omieResp.json();
    
    console.log('[API] /api/produtos/consultar-omie → encontrado:', omieData.codigo_produto);
    
    // Sincroniza produto para o PostgreSQL
    try {
      await sincronizarProdutoParaPostgres(omieData);
      console.log('[API] Produto sincronizado para PostgreSQL:', omieData.codigo);
    } catch (syncErr) {
      console.error('[API] Erro ao sincronizar produto:', syncErr);
      // Não falha a requisição se a sincronização der erro
    }
    
    res.json({ ...omieData, encontrado: true });
  } catch (err) {
    console.error('[API] /api/produtos/consultar-omie erro:', err);
    res.json({ error: 'Falha ao consultar produto', encontrado: false });
  }
});

// ============================================================================
// Solicitação de Compras: criar e listar
// ============================================================================

// Cria schema/tabela e insere solicitação de compras
app.post('/api/engenharia/solicitacao-compras', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      produto_codigo,
      produto_descricao,
      quantidade,
      responsavel,
      observacao,
      prazo_solicitado,
      prazo_estipulado,
      solicitante
    } = req.body || {};

    if (!produto_codigo) return res.status(400).json({ error: 'produto_codigo é obrigatório' });

    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS compras');
    await client.query(`
      CREATE TABLE IF NOT EXISTS compras.solicitacao_compras (
        id SERIAL PRIMARY KEY,
        produto_codigo TEXT NOT NULL,
        produto_descricao TEXT,
        quantidade NUMERIC,
        responsavel TEXT,
        observacao TEXT,
        observacao_reprovacao TEXT,
        prazo_solicitado DATE,
        prazo_estipulado DATE,
        quem_recebe TEXT,
        solicitante TEXT,
        status TEXT DEFAULT 'aguardando aprovação',
        criado_em TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'aguardando aprovação';`);
    await client.query(`ALTER TABLE compras.solicitacao_compras ALTER COLUMN status SET DEFAULT 'aguardando aprovação';`);
    await client.query(`UPDATE compras.solicitacao_compras SET status = 'aguardando aprovação' WHERE status IS NULL;`);
    await client.query(`ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS quem_recebe TEXT;`);
    await client.query(`ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS observacao_reprovacao TEXT;`);

    const insertSql = `
      INSERT INTO compras.solicitacao_compras
        (produto_codigo, produto_descricao, quantidade, responsavel, observacao, prazo_solicitado, prazo_estipulado, quem_recebe, solicitante)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id;
    `;
    const { rows } = await client.query(insertSql, [
      produto_codigo,
      produto_descricao || null,
      quantidade || null,
      (responsavel || solicitante || null),
      observacao || null,
      prazo_solicitado || null,
      prazo_estipulado || null,
      null,
      solicitante || null
    ]);

    await client.query('COMMIT');
    res.json({ success: true, id: rows[0]?.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[API] /api/engenharia/solicitacao-compras erro:', err);
    res.status(500).json({ error: 'Falha ao salvar solicitação' });
  } finally {
    client.release();
  }
});

// Lista todas as solicitações de compras
app.get('/api/compras/solicitacoes', async (_req, res) => {
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS compras');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras.solicitacao_compras (
        id SERIAL PRIMARY KEY,
        produto_codigo TEXT NOT NULL,
        produto_descricao TEXT,
        quantidade NUMERIC,
        responsavel TEXT,
        observacao TEXT,
        observacao_reprovacao TEXT,
        prazo_solicitado DATE,
        prazo_estipulado DATE,
        quem_recebe TEXT,
        solicitante TEXT,
        status TEXT DEFAULT 'aguardando aprovação',
        criado_em TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'aguardando aprovação';`);
    await pool.query(`ALTER TABLE compras.solicitacao_compras ALTER COLUMN status SET DEFAULT 'aguardando aprovação';`);
    await pool.query(`UPDATE compras.solicitacao_compras SET status = 'aguardando aprovação' WHERE status IS NULL;`);
    await pool.query(`ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS quem_recebe TEXT;`);
    await pool.query(`ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS quem_recebe TEXT;`);
    await pool.query(`ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS observacao_reprovacao TEXT;`);

    const { rows } = await pool.query(`
      SELECT 
        id,
        produto_codigo,
        produto_descricao,
        quantidade,
        responsavel,
        observacao,
        observacao_reprovacao,
        prazo_solicitado,
        prazo_estipulado,
        quem_recebe,
        solicitante,
        status,
        criado_em,
        anexos,
        familia_produto,
        retorno_cotacao,
        departamento,
        objetivo_compra
      FROM compras.solicitacao_compras
      ORDER BY criado_em DESC, id DESC;
    `);

    res.json({ solicitacoes: rows });
  } catch (err) {
    console.error('[API] /api/compras/solicitacoes erro:', err);
    res.status(500).json({ error: 'Falha ao listar solicitações de compras' });
  }
});

// Atualiza retorno_cotacao em lote para itens do mesmo grupo de requisição
app.put('/api/compras/solicitacoes/retorno-cotacao/lote', express.json(), async (req, res) => {
  try {
    const { ids, retorno_cotacao } = req.body || {};
    const idsNumericos = Array.isArray(ids)
      ? [...new Set(ids.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))]
      : [];

    if (!idsNumericos.length) {
      return res.status(400).json({ success: false, error: 'Informe ao menos um ID válido' });
    }

    const retornoTexto = String(retorno_cotacao ?? '').trim().toLowerCase();
    let retornoNormalizado = null;
    if (['s', 'sim', 'yes', 'true', '1'].includes(retornoTexto)) {
      retornoNormalizado = 'Sim';
    } else if (['n', 'nao', 'não', 'no', 'false', '0'].includes(retornoTexto)) {
      retornoNormalizado = 'Não';
    } else {
      return res.status(400).json({ success: false, error: 'retorno_cotacao inválido. Use Sim ou Não' });
    }

    const gruposRes = await pool.query(`
      SELECT DISTINCT COALESCE(grupo_requisicao, '') AS grupo_requisicao
      FROM compras.solicitacao_compras
      WHERE id = ANY($1::int[])
    `, [idsNumericos]);

    if (!gruposRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Itens não encontrados em solicitacao_compras' });
    }

    if (gruposRes.rows.length > 1) {
      return res.status(400).json({
        success: false,
        error: 'Os itens informados pertencem a grupos diferentes. A alteração em massa deve ser por grupo.'
      });
    }

    const updateRes = await pool.query(`
      UPDATE compras.solicitacao_compras
         SET retorno_cotacao = $1,
             updated_at = NOW()
       WHERE id = ANY($2::int[])
       RETURNING id, grupo_requisicao, retorno_cotacao
    `, [retornoNormalizado, idsNumericos]);

    return res.json({
      success: true,
      atualizados: updateRes.rowCount,
      grupo_requisicao: updateRes.rows[0]?.grupo_requisicao || null,
      retorno_cotacao: retornoNormalizado
    });
  } catch (err) {
    console.error('[API] PUT /api/compras/solicitacoes/retorno-cotacao/lote erro:', err);
    return res.status(500).json({ success: false, error: 'Falha ao atualizar retorno_cotacao em lote' });
  }
});

// Atualiza status ou previsão de chegada de uma solicitação
app.put('/api/compras/solicitacoes/:id', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

    const { status, prazo_estipulado, quem_recebe, quantidade, grupo_requisicao, retorno_cotacao, produto_descricao } = req.body || {};
    
    const allowedStatus = [
      'aguardando aprovação',
      'aguardando cotação',
      'cotado',
      'aguardando compra',
      'compra realizada',
      'faturada pelo fornecedor',
      'aguardando liberação',
      'compra cancelada',
      'recebido'
    ];

    const fields = [];
    const values = [];
    let idx = 1;

    if (status) {
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ error: 'Status inválido' });
      }
      fields.push(`status = $${idx++}`);
      values.push(status);
    }

    if (typeof prazo_estipulado !== 'undefined') {
      fields.push(`prazo_estipulado = $${idx++}`);
      values.push(prazo_estipulado || null);
    }

    if (typeof quem_recebe !== 'undefined') {
      fields.push(`quem_recebe = $${idx++}`);
      values.push(quem_recebe || null);
    }

    // Permite atualizar quantidade
    if (typeof quantidade !== 'undefined') {
      const quantidadeNum = Number(quantidade);
      if (!Number.isFinite(quantidadeNum) || quantidadeNum <= 0) {
        return res.status(400).json({ error: 'Quantidade inválida' });
      }
      fields.push(`quantidade = $${idx++}`);
      values.push(quantidadeNum);
    }

    if (typeof grupo_requisicao !== 'undefined') {
      const novoGrupo = (String(grupo_requisicao).trim() === '__novo__')
        ? gerarNumeroGrupoRequisicao()
        : (grupo_requisicao ? String(grupo_requisicao).trim() : null);
      fields.push(`grupo_requisicao = $${idx++}`);
      values.push(novoGrupo);
    }

    if (typeof retorno_cotacao !== 'undefined') {
      const retornoTexto = String(retorno_cotacao ?? '').trim();
      let retornoNormalizado = null;

      if (retornoTexto) {
        const retornoLower = retornoTexto.toLowerCase();
        if (['s', 'sim', 'yes', 'true', '1'].includes(retornoLower)) {
          retornoNormalizado = 'Sim';
        } else if (['n', 'nao', 'não', 'no', 'false', '0'].includes(retornoLower)) {
          retornoNormalizado = 'Não';
        } else {
          return res.status(400).json({ error: 'retorno_cotacao inválido. Use Sim ou Não' });
        }
      }

      fields.push(`retorno_cotacao = $${idx++}`);
      values.push(retornoNormalizado);
    }

    if (typeof produto_descricao !== 'undefined') {
      fields.push(`produto_descricao = $${idx++}`);
      values.push(produto_descricao || null);
    }
    
    if (!fields.length) return res.status(400).json({ error: 'Nada para atualizar' });

    await client.query('CREATE SCHEMA IF NOT EXISTS compras');
    await client.query(`
      CREATE TABLE IF NOT EXISTS compras.solicitacao_compras (
        id SERIAL PRIMARY KEY,
        produto_codigo TEXT NOT NULL,
        produto_descricao TEXT,
        quantidade NUMERIC,
        responsavel TEXT,
        observacao TEXT,
        observacao_reprovacao TEXT,
        prazo_solicitado DATE,
        prazo_estipulado DATE,
        solicitante TEXT,
        status TEXT DEFAULT 'aguardando aprovação',
        criado_em TIMESTAMP DEFAULT NOW()
      );
    `);

    const sql = `UPDATE compras.solicitacao_compras SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *;`;
    values.push(id);
    const { rowCount, rows } = await client.query(sql, values);
    if (!rowCount) return res.status(404).json({ error: 'Registro não encontrado' });

    res.json({ success: true, solicitacao: rows[0] });
  } catch (err) {
    console.error('[API] PUT /api/compras/solicitacoes/:id erro:', err);
    res.status(500).json({ error: 'Falha ao atualizar solicitação' });
  } finally {
    client.release();
  }
});

// Envia requisição do item cotado (garante produto na Omie)
app.post('/api/compras/solicitacoes/:id/enviar-requisicao', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

    if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return res.status(500).json({ error: 'Credenciais Omie não configuradas' });
    }

    const { rows } = await pool.query(
      `SELECT 
        id,
        produto_codigo,
        produto_descricao,
        quantidade,
        objetivo_compra,
        solicitante,
        departamento,
        categoria_compra_codigo,
        previsao_chegada,
        prazo_solicitado,
        codigo_produto_omie,
        codigo_omie,
        retorno_cotacao,
        observacao,
        resp_inspecao_recebimento
       FROM compras.solicitacao_compras
       WHERE id = $1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Solicitação não encontrada' });

    const item = rows[0];
    const produtoCodigo = String(item.produto_codigo || '').trim();
    const produtoDescricao = String(item.produto_descricao || '').trim() || `Produto ${produtoCodigo}`;

    if (!produtoCodigo) {
      return res.status(400).json({ error: 'produto_codigo não informado' });
    }

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const incrementarCodigoProvisorio = (codigo) => {
      const match = String(codigo || '').match(/(CODPROV\s*-\s*)(\d{1,})/i);
      if (!match) return null;
      const prefixo = match[1];
      const numero = parseInt(match[2], 10);
      if (!Number.isFinite(numero)) return null;
      const proximo = String(numero + 1).padStart(match[2].length, '0');
      return `${prefixo}${proximo}`;
    };

    // Comentário: se não tiver codigo_omie, cadastra produto na Omie antes de seguir
    if (!item.codigo_omie) {
      let codigoAtual = produtoCodigo;
      let cadastroOk = null;

      for (let tent = 0; tent < 20; tent++) {
        const descricaoAtual = tent > 0 ? `${produtoDescricao} ${codigoAtual}` : produtoDescricao;
        const cadastro = await cadastrarProdutoNaOmie(codigoAtual, descricaoAtual);
        if (cadastro.ok) {
          cadastroOk = cadastro;
          if (descricaoAtual !== produtoDescricao) {
            await pool.query(
              `UPDATE compras.solicitacao_compras
               SET produto_descricao = $1
               WHERE id = $2`,
              [descricaoAtual, id]
            );
            item.produto_descricao = descricaoAtual;
          }
          break;
        }

        const msgErro = String(cadastro.error || '');
        const ehJaCadastrado = /já cadastrado|Client-102/i.test(msgErro);
        const ehDescricaoDuplicada = /descri.*já está sendo utilizada|Client-143/i.test(msgErro);
        const proximoCodigo = incrementarCodigoProvisorio(codigoAtual);

        if ((!ehJaCadastrado && !ehDescricaoDuplicada) || !proximoCodigo) {
          return res.status(500).json({ error: cadastro.error || 'Erro ao cadastrar produto na Omie' });
        }

        codigoAtual = proximoCodigo;
      }

      if (!cadastroOk) {
        return res.status(500).json({ error: 'Não foi possível gerar um código provisório disponível' });
      }

      // Atualiza produto_codigo na solicitação se o código mudou
      if (codigoAtual !== produtoCodigo) {
        await pool.query(
          `UPDATE compras.solicitacao_compras
           SET produto_codigo = $1
           WHERE id = $2`,
          [codigoAtual, id]
        );
        item.produto_codigo = codigoAtual;
      }

      // Aguarda o webhook popular o produto na tabela produtos_omie
      let codigoOmieEncontrado = null;
      for (let i = 0; i < 10; i++) {
        const { rows: prodRows } = await pool.query(
          `SELECT codigo_produto
           FROM public.produtos_omie
           WHERE codigo = $1 OR codigo_produto_integracao = $1
           LIMIT 1`,
          [codigoAtual]
        );
        if (prodRows.length > 0) {
          codigoOmieEncontrado = prodRows[0].codigo_produto;
          break;
        }
        await sleep(2000);
      }

      if (codigoOmieEncontrado) {
        item.codigo_omie = codigoOmieEncontrado;
        await pool.query(
          `UPDATE compras.solicitacao_compras
           SET codigo_omie = $1
           WHERE id = $2`,
          [codigoOmieEncontrado, id]
        );
      }
    }

    // Comentário: consulta produto na Omie se ainda não houver codigo_omie
    const consultarProdutoOmie = async (param) => {
      return withRetry(() => omieCall('https://app.omie.com.br/api/v1/geral/produtos/', {
        call: 'ConsultarProduto',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [param]
      }));
    };

    if (!item.codigo_omie) {
      let omieProduto = null;
      let encontrado = false;

      try {
        omieProduto = await consultarProdutoOmie({ codigo: produtoCodigo });
        encontrado = !(omieProduto?.faultstring || omieProduto?.faultcode);
      } catch (e) {
        console.warn('[Compras] ConsultarProduto (codigo) falhou:', e?.message || e);
      }

      if (!encontrado) {
        try {
          omieProduto = await consultarProdutoOmie({ codigo_produto_integracao: produtoCodigo });
          encontrado = !(omieProduto?.faultstring || omieProduto?.faultcode);
        } catch (e) {
          console.warn('[Compras] ConsultarProduto (codigo_produto_integracao) falhou:', e?.message || e);
        }
      }

      if (encontrado) {
        try {
          await sincronizarProdutoParaPostgres(omieProduto);
        } catch (syncErr) {
          console.warn('[Compras] Erro ao sincronizar produto Omie:', syncErr?.message || syncErr);
        }
      }
    }

    // Comentário: garante codigo_omie salvo na solicitação
    if (!item.codigo_omie) {
      try {
        const { rows: prodRows } = await pool.query(
          `SELECT codigo_produto
           FROM public.produtos_omie
           WHERE codigo = $1 OR codigo_produto_integracao = $1
           LIMIT 1`,
          [produtoCodigo]
        );
        if (prodRows.length > 0) {
          item.codigo_omie = prodRows[0].codigo_produto;
          await pool.query(
            `UPDATE compras.solicitacao_compras
             SET codigo_omie = $1
             WHERE id = $2`,
            [item.codigo_omie, id]
          );
        }
      } catch (e) {
        console.warn('[Compras] Não foi possível atualizar codigo_omie:', e?.message || e);
      }
    }

    const { codReqCompra, codIntReqCompra, omieResult } = await criarRequisicaoOmieParaItem(item, id);

    return res.json({
      ok: true,
      message: 'Requisição criada na Omie',
      numero_pedido: codIntReqCompra,
      ncodped: codReqCompra,
      omie_response: omieResult
    });
  } catch (err) {
    console.error('[API] POST /api/compras/solicitacoes/:id/enviar-requisicao erro:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Falha ao enviar requisição' });
  }
});

// POST /api/compras/solicitacoes/:id/cadastrar-omie - Cadastra itens CODPROV na Omie para solicitacao_compras
app.post('/api/compras/solicitacoes/:id/cadastrar-omie', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const { itens: itensRequest } = req.body || {};

    const { rows } = await pool.query(
      `SELECT id, produto_codigo, produto_descricao, quantidade
       FROM compras.solicitacao_compras
       WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }

    const itemDb = rows[0];
    const descricaoBase = String(itemDb.produto_descricao || '').trim();
    const quantidadeBase = Number(itemDb.quantidade) || 1;

    const processarItensDescricao = (descricao) => {
      if (!descricao || typeof descricao !== 'string') return [];
      return [{ descricao: String(descricao).trim(), quantidade: String(quantidadeBase) }].filter(i => i.descricao);
    };

    const itens = Array.isArray(itensRequest) && itensRequest.length
      ? itensRequest.map(i => ({
          descricao: String(i?.descricao || '').trim(),
          quantidade: String(i?.quantidade || '').trim(),
          codigo_omie: String(i?.codigo_omie || '').trim()
        })).filter(i => i.descricao)
      : processarItensDescricao(descricaoBase);

    if (!itens.length) {
      return res.status(400).json({ ok: false, error: 'Nenhum item válido para cadastro' });
    }

    const codigoBaseRaw = String(itemDb.produto_codigo || '').trim();
    const matchBase = codigoBaseRaw.match(/(CODPROV\s*-\s*)(\d{1,})/i);
    const baseNumeroAtual = matchBase ? parseInt(matchBase[2], 10) : null;
    const basePadLength = matchBase ? matchBase[2].length : 5;

    const buscarMaximoCodprov = async () => {
      const { rows: maxOmie } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM public.produtos_omie
         WHERE codigo LIKE 'CODPROV - %'`
      );
      const { rows: maxSolic } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(produto_codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM compras.solicitacao_compras
         WHERE produto_codigo LIKE 'CODPROV - %'`
      );
      const { rows: maxSem } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(produto_codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM compras.compras_sem_cadastro
         WHERE produto_codigo LIKE 'CODPROV - %'`
      );

      const nums = [maxOmie[0]?.max_num, maxSolic[0]?.max_num, maxSem[0]?.max_num]
        .map(n => Number(n) || 0);
      return Math.max(...nums, 0);
    };

    const maxExistente = await buscarMaximoCodprov();
    let baseNumero = Number.isFinite(baseNumeroAtual) ? baseNumeroAtual : (maxExistente + 1);
    if (baseNumero <= maxExistente) baseNumero = maxExistente + 1;

    const formatarBase = (num) => String(num).padStart(basePadLength, '0');
    const montarCodigoBase = (num) => `CODPROV - ${formatarBase(num)}`;

    const baseExiste = async (num) => {
      const prefixo = `${montarCodigoBase(num)}%`;
      const { rows: existe } = await pool.query(
        `SELECT 1 FROM public.produtos_omie WHERE codigo LIKE $1 LIMIT 1`,
        [prefixo]
      );
      return existe.length > 0;
    };

    while (await baseExiste(baseNumero)) {
      baseNumero += 1;
    }

    const baseCodigo = montarCodigoBase(baseNumero);

    if (baseCodigo !== codigoBaseRaw) {
      await pool.query(
        `UPDATE compras.solicitacao_compras
         SET produto_codigo = $1, updated_at = NOW()
         WHERE id = $2`,
        [baseCodigo, id]
      );
    }

    const resultados = [];
    for (let i = 0; i < itens.length; i++) {
      const itemAtual = itens[i];
      const codigoIntegracao = `${baseCodigo}.${i + 1}`;
      const descricaoProduto = itemAtual.descricao || `Produto ${codigoIntegracao}`;

      if (itemAtual?.codigo_omie) {
        resultados.push({
          index: i,
          codigo_integracao: codigoIntegracao,
          codigo_produto: itemAtual.codigo_omie,
          ja_existe: true
        });
        continue;
      }

      const { rows: prodRows } = await pool.query(
        `SELECT codigo_produto
         FROM public.produtos_omie
         WHERE codigo = $1 OR codigo_produto_integracao = $1
         LIMIT 1`,
        [codigoIntegracao]
      );

      if (prodRows.length > 0) {
        resultados.push({
          index: i,
          codigo_integracao: codigoIntegracao,
          codigo_produto: prodRows[0].codigo_produto || null,
          ja_existe: true
        });
        continue;
      }

      let cadastro = await cadastrarProdutoNaOmie(codigoIntegracao, descricaoProduto);
      if (!cadastro.ok) {
        const msgErro = String(cadastro.error || '');
        const ehDescricaoDuplicada = /descri.*já está sendo utilizada|Client-143/i.test(msgErro);

        if (ehDescricaoDuplicada) {
          const descricaoComCodigo = descricaoProduto.includes(codigoIntegracao)
            ? descricaoProduto
            : `${descricaoProduto} - ${codigoIntegracao}`;
          cadastro = await cadastrarProdutoNaOmie(codigoIntegracao, descricaoComCodigo);
        }

        if (!cadastro.ok) {
          return res.status(500).json({
            ok: false,
            error: cadastro.error || 'Erro ao cadastrar produto na Omie',
            resultados
          });
        }
      }

      resultados.push({
        index: i,
        codigo_integracao: codigoIntegracao,
        codigo_produto: cadastro.codigo_produto || null,
        ja_existe: false
      });
    }

    return res.json({
      ok: true,
      base_codigo: baseCodigo,
      itens: resultados
    });
  } catch (err) {
    console.error('[Solicitações] Erro ao cadastrar itens na Omie:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao cadastrar itens na Omie' });
  }
});

// Lista usuários ativos (para “Quem vai receber?”)
app.get('/api/users/ativos', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT username
      FROM public.auth_user
      WHERE is_active = TRUE
      ORDER BY username ASC;
    `);
    res.json({ users: rows.map(r => r.username) });
  } catch (err) {
    console.error('[API] /api/users/ativos erro:', err);
    res.status(500).json({ error: 'Falha ao listar usuários ativos' });
  }
});

// === Função auxiliar para sincronizar produto da Omie para PostgreSQL ===
async function sincronizarProdutoParaPostgres(produto) {
  // Função para converter data DD/MM/YYYY para YYYY-MM-DD
  const converterData = (dataStr) => {
    if (!dataStr || typeof dataStr !== 'string') return null;
    const partes = dataStr.split('/');
    if (partes.length !== 3) return null;
    return `${partes[2]}-${partes[1]}-${partes[0]}`; // YYYY-MM-DD
  };
  
  const sql = `
    INSERT INTO public.produtos_omie (
      codigo_produto, codigo_produto_integracao, codigo, descricao, descricao_familia, unidade,
      tipoitem, ncm, cfop, origem_mercadoria, cest, aliquota_ibpt,
      marca, modelo, descr_detalhada, obs_internas, inativo, bloqueado,
      bloquear_exclusao, quantidade_estoque, valor_unitario,
      dalt, halt, dinc, hinc, ualt, uinc, codigo_familia, codint_familia
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
    )
    ON CONFLICT (codigo_produto) DO UPDATE SET
      codigo_produto_integracao = EXCLUDED.codigo_produto_integracao,
      codigo = EXCLUDED.codigo,
      descricao = EXCLUDED.descricao,
      descricao_familia = EXCLUDED.descricao_familia,
      unidade = EXCLUDED.unidade,
      tipoitem = EXCLUDED.tipoitem,
      ncm = EXCLUDED.ncm,
      cfop = EXCLUDED.cfop,
      origem_mercadoria = EXCLUDED.origem_mercadoria,
      cest = EXCLUDED.cest,
      aliquota_ibpt = EXCLUDED.aliquota_ibpt,
      marca = EXCLUDED.marca,
      modelo = EXCLUDED.modelo,
      descr_detalhada = EXCLUDED.descr_detalhada,
      obs_internas = EXCLUDED.obs_internas,
      inativo = EXCLUDED.inativo,
      bloqueado = EXCLUDED.bloqueado,
      bloquear_exclusao = EXCLUDED.bloquear_exclusao,
      quantidade_estoque = EXCLUDED.quantidade_estoque,
      valor_unitario = EXCLUDED.valor_unitario,
      dalt = EXCLUDED.dalt,
      halt = EXCLUDED.halt,
      ualt = EXCLUDED.ualt
  `;
  
  const valores = [
    produto.codigo_produto || null,
    produto.codigo_produto_integracao || produto.codigo || null,
    produto.codigo || null,
    produto.descricao || null,
    produto.descricao_familia || null,
    produto.unidade || null,
    produto.tipoItem || null,
    produto.ncm || null,
    produto.cfop || null,
    produto.origem || null,
    produto.cest || null,
    produto.aliquota_ibpt || null,
    produto.marca || null,
    produto.modelo || null,
    produto.descr_detalhada || null,
    produto.obs_internas || null,
    produto.inativo === 'S' ? 'S' : 'N',
    produto.bloqueado === 'S' ? 'S' : 'N',
    produto.bloquear_exclusao === 'S' ? 'S' : 'N',
    produto.quantidade_estoque || 0,
    produto.valor_unitario || 0,
    converterData(produto.info?.dAlt),
    produto.info?.hAlt || null,
    converterData(produto.info?.dInc),
    produto.info?.hInc || null,
    produto.info?.uAlt || null,
    produto.info?.uInc || null,
    produto.codigo_familia || null,
    produto.codInt_familia || null
  ];
  
  await pool.query(sql, valores);
  
  // Sincroniza imagens do produto (se existirem)
  if (produto.imagens && Array.isArray(produto.imagens) && produto.imagens.length > 0) {
    const codigoProduto = produto.codigo_produto;
    
    // Remove imagens antigas
    await pool.query('DELETE FROM produtos_omie_imagens WHERE codigo_produto = $1', [codigoProduto]);
    
    // Insere novas imagens
    for (let pos = 0; pos < produto.imagens.length; pos++) {
      const img = produto.imagens[pos];
      if (img.url_imagem) {
        await pool.query(
          `INSERT INTO produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key)
           VALUES ($1, $2, $3, $4)`,
          [codigoProduto, pos, img.url_imagem, img.path_key || null]
        );
      }
    }
  }
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



function lerEstoque() {
  return JSON.parse(fs.readFileSync(estoquePath, 'utf8'));
}
function gravarEstoque(obj) {
  fs.writeFileSync(estoquePath, JSON.stringify(obj, null, 2), 'utf8');
}


// valida o token do OMIE presente na query ?token=...
function chkOmieToken(req, res, next) {
  // Se OMIE_WEBHOOK_TOKEN não estiver configurado, libera o acesso
  if (!process.env.OMIE_WEBHOOK_TOKEN || process.env.OMIE_WEBHOOK_TOKEN === 'null') {
    console.log('[chkOmieToken] Token não configurado, liberando acesso');
    return next();
  }
  
  // Se estiver configurado, valida o token
  const token = req.query.token || req.headers['x-omie-token'];
  if (!token || token !== process.env.OMIE_WEBHOOK_TOKEN) {
    console.log('[chkOmieToken] Token inválido ou ausente');
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

// ============================================================================
// WEBHOOKS E ENDPOINTS DE FORNECEDORES
// ============================================================================

// ============================================================================
// WEBHOOK DE FORNECEDORES/CLIENTES DA OMIE
// Eventos: ClienteFornecedor.Incluido, ClienteFornecedor.Alterado, ClienteFornecedor.Excluido
// ============================================================================

app.post(['/webhooks/omie/clientes', '/api/webhooks/omie/clientes'],
  chkOmieToken,
  express.json(),
  async (req, res) => {
    try {
      const body = req.body || {};
      const event = body.event || body;
      
      // Log do webhook recebido
      console.log('[webhooks/omie/clientes] Webhook recebido:', JSON.stringify(body, null, 2));
      
      // Campos que podem vir no webhook da Omie
      const topic = body.topic || event.topic || '';  // Ex: "ClienteFornecedor.Incluido"
      const codigoClienteOmie = event.codigo_cliente_omie || 
                                 event.codigoClienteOmie || 
                                 event.nCodCli ||
                                 body.codigo_cliente_omie ||
                                 body.codigoClienteOmie ||
                                 body.nCodCli;
      
      if (!codigoClienteOmie) {
        console.warn('[webhooks/omie/clientes] Webhook sem codigo_cliente_omie:', JSON.stringify(body));
        return res.json({ ok: true, msg: 'Sem codigo_cliente_omie para processar' });
      }
      
      console.log(`[webhooks/omie/clientes] Processando evento "${topic}" para cliente ${codigoClienteOmie}`);
      
      // Se for exclusão, apenas marca como inativo no banco
      if (topic.includes('Excluido') || event.excluido || body.excluido) {
        await pool.query(`
          UPDATE omie.fornecedores 
          SET inativo = true, updated_at = NOW()
          WHERE codigo_cliente_omie = $1
        `, [codigoClienteOmie]);
        
        console.log(`[webhooks/omie/clientes] Cliente ${codigoClienteOmie} marcado como inativo (excluído)`);
        
        return res.json({ 
          ok: true, 
          codigo_cliente_omie: codigoClienteOmie,
          acao: 'excluido',
          atualizado: true 
        });
      }
      
      // Para inclusão ou alteração, busca dados completos na API da Omie
      const response = await fetch('https://app.omie.com.br/api/v1/geral/clientes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarCliente',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{
            codigo_cliente_omie: parseInt(codigoClienteOmie)
          }]
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[webhooks/omie/clientes] Erro na API Omie: ${response.status} - ${errorText}`);
        throw new Error(`Omie API retornou ${response.status}`);
      }
      
      const cliente = await response.json();
      
      // Atualiza no banco
      await upsertFornecedor(cliente);
      
      const acao = topic.includes('Incluido') ? 'incluido' : 'alterado';
      console.log(`[webhooks/omie/clientes] Cliente ${codigoClienteOmie} ${acao} com sucesso`);
      
      res.json({ 
        ok: true, 
        codigo_cliente_omie: codigoClienteOmie,
        acao: acao,
        atualizado: true 
      });
    } catch (err) {
      console.error('[webhooks/omie/clientes] erro:', err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);

// ========================================
// Sincronização via webhooks - fornecedores são atualizados automaticamente pela Omie

// ========================================
// GET /api/fornecedores/status - Verificar status de fornecedores sincronizados
// ========================================
/**
 * Objetivo: Retornar informações sobre fornecedores da Omie sincronizados em omie.fornecedores
 */
app.get('/api/fornecedores/status', async (req, res) => {
  try {
    const { rows: fornecedoresCount } = await pool.query('SELECT COUNT(*) AS count FROM omie.fornecedores');
    const { rows: ultimoUpdate } = await pool.query(
      'SELECT MAX(updated_at) AS ultima_atualizacao FROM omie.fornecedores'
    );
    
    // inativo é BOOLEAN, então usamos conversão correta
    const { rows: inativoCount } = await pool.query(`
      SELECT COUNT(*) AS count FROM omie.fornecedores 
      WHERE inativo = true
    `);
    
    res.json({
      ok: true,
      total_fornecedores: parseInt(fornecedoresCount[0]?.count || 0),
      fornecedores_inativos: parseInt(inativoCount[0]?.count || 0),
      ultima_atualizacao: ultimoUpdate[0]?.ultima_atualizacao || null,
      msg: `${fornecedoresCount[0]?.count || 0} fornecedores cadastrados da Omie`
    });
  } catch (err) {
    console.error('[Fornecedores/Status] Erro:', err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// ——— WEBHOOK DE PRODUTOS DA OMIE (atualiza imagens) ———
app.post(['/webhooks/omie/produtos', '/api/webhooks/omie/produtos'],
  chkOmieToken,
  express.json(),
  async (req, res) => {
    try {
      const body = req.body || {};
      const { topic, author, appKey, event, messageId } = body;
      
      console.log('[webhooks/omie/produtos] Webhook recebido:', JSON.stringify(body, null, 2));
      
      // Campos que podem vir no webhook da Omie
      const codigoProduto = body.codigo_produto || body.nCodProd;
      
      if (!codigoProduto) {
        console.warn('[webhooks/omie/produtos] Webhook sem codigo_produto:', JSON.stringify(body));
        return res.json({ ok: true, message: 'Webhook sem codigo_produto, ignorado' });
      }
      
      console.log(`[webhooks/omie/produtos] Processando evento "${topic}" para produto ${codigoProduto}`);
      
      // Se produto foi excluído, remove imagens
      if (topic === 'Produto.Excluido' || body.inativo === 'S' || body.bloqueado === 'S') {
        await pool.query(
          'DELETE FROM public.produtos_omie_imagens WHERE codigo_produto = $1',
          [codigoProduto]
        );
        console.log(`[webhooks/omie/produtos] Imagens do produto ${codigoProduto} removidas (excluído/inativo)`);
        return res.json({ ok: true, codigo_produto: codigoProduto, acao: 'removido' });
      }
      
      // Consulta produto na Omie para pegar imagens atualizadas
      const omieBody = {
        call: 'ConsultarProduto',
        app_key: process.env.OMIE_APP_KEY,
        app_secret: process.env.OMIE_APP_SECRET,
        param: [{ codigo_produto: parseInt(codigoProduto) }]
      };
      
      const response = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(omieBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[webhooks/omie/produtos] Erro na API Omie: ${response.status} - ${errorText}`);
        return res.status(500).json({ ok: false, error: 'Erro ao consultar produto na Omie' });
      }
      
      const omieData = await response.json();

      // Atualiza também o cadastro do produto na tabela principal
      try {
        const upsertObj = { ...omieData };
        if (!upsertObj.codigo_produto_integracao) {
          upsertObj.codigo_produto_integracao = upsertObj.codigo || String(upsertObj.codigo_produto || '');
        }

        const client = await pool.connect();
        try {
          await client.query("SELECT set_config('app.produtos_omie_write_source', 'omie_webhook', true)");
          await client.query('SELECT omie_upsert_produto($1::jsonb)', [upsertObj]);
        } finally {
          client.release();
        }
      } catch (syncErr) {
        console.error(`[webhooks/omie/produtos] Erro ao atualizar public.produtos_omie (${codigoProduto}):`, syncErr?.message || syncErr);
      }
      
      // Remove imagens antigas
      await pool.query(
        'DELETE FROM public.produtos_omie_imagens WHERE codigo_produto = $1',
        [codigoProduto]
      );
      
      // Insere novas imagens
      let totalImagens = 0;
      if (omieData.imagens && Array.isArray(omieData.imagens) && omieData.imagens.length > 0) {
        for (let pos = 0; pos < omieData.imagens.length; pos++) {
          const img = omieData.imagens[pos];
          if (img.url_imagem) {
            await pool.query(
              `INSERT INTO public.produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key)
               VALUES ($1, $2, $3, $4)`,
              [codigoProduto, pos, img.url_imagem.trim(), img.path_key || null]
            );
            totalImagens++;
          }
        }
      }
      
      const acao = totalImagens > 0 ? `atualizado (${totalImagens} imagens)` : 'atualizado (sem imagens)';
      console.log(`[webhooks/omie/produtos] Produto ${codigoProduto} ${acao}`);
      
      res.json({ 
        ok: true, 
        codigo_produto: codigoProduto,
        acao: acao,
        total_imagens: totalImagens 
      });
    } catch (err) {
      console.error('[webhooks/omie/produtos] erro:', err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);

// ——— WEBHOOK DE CATEGORIAS DA OMIE ———
// Eventos: Categoria.Incluida, Categoria.Alterada
app.post([
  '/webhooks/omie/categorias',
  '/api/webhooks/omie/categorias',
  '/webhooks/omie/categorias/',
  '/api/webhooks/omie/categorias/',
  '/webhooks/omie/categorias.',
  '/api/webhooks/omie/categorias.'
],
  express.json(),
  async (req, res) => {
    try {
      const body = req.body || {};
      const event = body.event || body;
      const topic = body.topic || event.topic || '';

      console.log('[webhooks/omie/categorias] Webhook recebido:', JSON.stringify(body, null, 2));

      const codigoCategoria = event.codigo || event.codigo_categoria || body.codigo || body.codigo_categoria;

      if (!codigoCategoria) {
        console.warn('[webhooks/omie/categorias] Webhook sem codigo:', JSON.stringify(body));
        // fallback: sincroniza tudo
        await syncListarCategoriasOmie();
        return res.json({ ok: true, msg: 'Sem codigo, sincronizado full' });
      }

      console.log(`[webhooks/omie/categorias] Processando evento "${topic}" para categoria ${codigoCategoria}`);

      // Consulta categoria na Omie
      const response = await fetch('https://app.omie.com.br/api/v1/geral/categorias/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarCategoria',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{
            codigo: String(codigoCategoria)
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[webhooks/omie/categorias] Erro na API Omie: ${response.status} - ${errorText}`);
        throw new Error(`Omie API retornou ${response.status}`);
      }

      const categoria = await response.json();
      if (categoria.faultstring) {
        throw new Error(categoria.faultstring);
      }

      await pool.query(
        `INSERT INTO configuracoes."ListarCategorias"
         (codigo, descricao, conta_despesa, conta_inativa, categoria_superior, natureza, tipo_categoria, codigo_dre, raw, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (codigo) DO UPDATE SET
           descricao = EXCLUDED.descricao,
           conta_despesa = EXCLUDED.conta_despesa,
           conta_inativa = EXCLUDED.conta_inativa,
           categoria_superior = EXCLUDED.categoria_superior,
           natureza = EXCLUDED.natureza,
           tipo_categoria = EXCLUDED.tipo_categoria,
           codigo_dre = EXCLUDED.codigo_dre,
           raw = EXCLUDED.raw,
           updated_at = NOW()`,
        [
          categoria.codigo,
          categoria.descricao,
          categoria.conta_despesa,
          categoria.conta_inativa,
          categoria.categoria_superior,
          categoria.natureza,
          categoria.tipo_categoria,
          categoria.codigo_dre,
          categoria
        ]
      );

      res.json({ ok: true, codigo: categoria.codigo, acao: topic || 'atualizado' });
    } catch (err) {
      console.error('[webhooks/omie/categorias] erro:', err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);

// ============================================================================
// WEBHOOK DE PEDIDOS DE COMPRA DA OMIE
// Eventos: CompraProduto.Incluida, CompraProduto.Alterada, CompraProduto.Cancelada
//          CompraProduto.Encerrada, CompraProduto.EtapaAlterada, CompraProduto.Excluida
// ============================================================================

app.post(['/webhooks/omie/pedidos-compra', '/api/webhooks/omie/pedidos-compra'],
  express.json(),
  async (req, res) => {
    try {
      const body = req.body || {};
      // event pode ser body.event, body.evento, ou o próprio body
      const event = body.evento || (typeof body.event === 'object' ? body.event : null) || body;
      
      // Log do webhook recebido
      console.log('[webhooks/omie/pedidos-compra] Webhook recebido:', JSON.stringify(body, null, 2));
      
      // Campos que podem vir no webhook da Omie
      const topic = body.topic || event.topic || '';  // Ex: "CompraProduto.Incluida"
      const isRequisicaoTopic = topic.startsWith('RequisicaoProduto.');

      // ====== Tratamento de Requisições de Compra (RequisicaoProduto.*) ======
      if (isRequisicaoTopic) {
        // Extrai dados do cabecalho_consulta se existir
        const cabecalho = event.cabecalho_consulta || event.cabecalho || {};
        
        const codReqCompra = event.codReqCompra
          || event.cod_req_compra
          || body.codReqCompra
          || body.cod_req_compra
          || event.nCodReq
          || event.nCodReqCompra
          || event.nCodPed
          || body.nCodReq
          || body.nCodReqCompra
          || body.nCodPed
          || cabecalho.nCodPed;

        const codIntReqCompra = event.codIntReqCompra
          || event.cod_int_req_compra
          || body.codIntReqCompra
          || body.cod_int_req_compra
          || event.cCodIntReqCompra
          || event.cCodIntPed
          || body.cCodIntReqCompra
          || body.cCodIntPed
          || cabecalho.cCodIntReqCompra
          || cabecalho.cCodIntPed;

        if (!codReqCompra && !codIntReqCompra) {
          console.warn('[webhooks/omie/pedidos-compra] Webhook sem codReqCompra/codIntReqCompra:', JSON.stringify(body));
          return res.json({ ok: true, msg: 'Sem codReqCompra/codIntReqCompra para processar' });
        }

        console.log(`[webhooks/omie/pedidos-compra] Processando evento "${topic}" para requisição ${codReqCompra || codIntReqCompra}`);

        // ===== RESPOSTA IMEDIATA para evitar reenvio da Omie =====
        res.json({ ok: true, cod_req_compra: codReqCompra || null, cod_int_req_compra: codIntReqCompra || null, status: 'processing' });

        // ===== PROCESSAMENTO ASSÍNCRONO =====
        // Processa em background para não bloquear o webhook
        (async () => {
          try {
            // Log especial para requisições alteradas (pode ter novos itens)
            if (topic.includes('Alterada')) {
              console.log(`[webhooks/omie/pedidos-compra] 🔄 Requisição ALTERADA - verificará se há novos itens`);
            }
            
            // Se for exclusão, apenas marca como inativo
            if (topic.includes('Excluida') || event.excluido || body.excluido) {
              if (codReqCompra) {
                await pool.query(`
                  UPDATE compras.requisicoes_omie
                  SET inativo = true,
                      evento_webhook = $1,
                      data_webhook = NOW(),
                      updated_at = NOW()
                  WHERE cod_req_compra = $2
                `, [topic, codReqCompra]);
              } else {
                await pool.query(`
                  UPDATE compras.requisicoes_omie
                  SET inativo = true,
                      evento_webhook = $1,
                      data_webhook = NOW(),
                      updated_at = NOW()
                  WHERE cod_int_req_compra = $2
                `, [topic, codIntReqCompra]);
              }

              console.log(`[webhooks/omie/pedidos-compra] Requisição ${codReqCompra || codIntReqCompra} marcada como inativa (excluída)`);
              return;
            }

            // Para inclusão/alteração, busca dados completos na API da Omie
            // Implementa retry com delay pois a Omie pode demorar para processar os itens
        
            // Função auxiliar para mapear campos do cabecalho_consulta para nomes esperados
            const mapearCabecalhoParaRequisicao = (cabecalho) => {
              if (!cabecalho) return {};
              
              return {
                nCodPed: cabecalho.nCodPed,
                cCodIntPed: cabecalho.cCodIntPed,
                cNumero: cabecalho.cNumero,
                cEtapa: cabecalho.cEtapa,
                codCateg: cabecalho.cCodCateg || null,
                codProj: cabecalho.nCodProj || null,
                dtSugestao: cabecalho.dDtPrevisao || null,
                obsReqCompra: cabecalho.cObs || null,
                obsIntReqCompra: cabecalho.cObsInt || null,
                nCodCC: cabecalho.nCodCC || null,
                nCodCompr: cabecalho.nCodCompr || null,
                nCodFor: cabecalho.nCodFor || null
              };
            };
            
            const param = codReqCompra
              ? { codReqCompra: parseInt(codReqCompra) }
              : { codIntReqCompra: String(codIntReqCompra) };

            let requisicao = null;
            let tentativa = 0;
            const maxTentativas = 6; // 6 tentativas = 0s, 5s, 10s, 15s, 20s, 25s = 75s total
            const delayEntreTentativas = 5000; // 5 segundos

            // Função para buscar requisição da API com retry
            const buscarRequisicaoComRetry = async () => {
              while (tentativa < maxTentativas) {
                tentativa++;
                
                if (tentativa > 1) {
                  console.log(`[webhooks/omie/pedidos-compra] 🔄 Tentativa ${tentativa}/${maxTentativas} após ${(tentativa - 1) * 5}s de delay...`);
                  await new Promise(resolve => setTimeout(resolve, delayEntreTentativas));
                }

                // Tenta com codReqCompra primeiro
                let param = { codReqCompra: parseInt(codReqCompra) };
                
                const responseReq = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    call: 'ConsultarReq',
                    app_key: OMIE_APP_KEY,
                    app_secret: OMIE_APP_SECRET,
                    param: [param]
                  })
                });

                if (!responseReq.ok) {
                  const errorText = await responseReq.text();
                  console.error(`[webhooks/omie/pedidos-compra] ❌ Erro na API Omie (tentativa ${tentativa}): ${responseReq.status} - ${errorText}`);
                  
                  // Se for a última tentativa e temos dados no webhook, usa fallback
                  if (tentativa === maxTentativas && (event.cabecalho_consulta || body.requisicaoCadastro)) {
                    console.log('[webhooks/omie/pedidos-compra] Usando dados do webhook como fallback após todas tentativas');
                    const dadosMapeados = mapearCabecalhoParaRequisicao(event.cabecalho_consulta);
                    return {
                      requisicaoCadastro: {
                        ...body.requisicaoCadastro,
                        ...dadosMapeados,
                        nCodPed: codReqCompra,
                        cCodIntPed: codIntReqCompra
                      }
                    };
                  }
                  continue; // Tenta novamente
                }

                const reqData = await responseReq.json();
                
                // Log detalhado da resposta da API (somente no desenvolvimento)
                console.log(`[webhooks/omie/pedidos-compra] 🔍 Resposta da API (tentativa ${tentativa}):`, JSON.stringify(reqData, null, 2));
                
                // Tenta múltiplas localizações dos itens
                let itens = reqData?.requisicaoCadastro?.ItensReqCompra 
                         || reqData?.requisicaoCadastro?.itens_req_compra 
                         || reqData?.ItensReqCompra
                         || reqData?.itens_req_compra 
                         || [];
                
                // Se ainda não encontrou itens, tenta com codIntReqCompra (para requisições que só têm ID interno)
                if ((!itens || itens.length === 0) && codIntReqCompra && tentativa < maxTentativas) {
                  console.log(`[webhooks/omie/pedidos-compra] ⚠️ Nenhum item com codReqCompra na tentativa ${tentativa}, tentando com codIntReqCompra...`);
                  
                  // Aguarda um pouco mais antes de tentar com outro parâmetro
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  
                  param = { codIntReqCompra: String(codIntReqCompra) };
                  
                  const responseReq2 = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      call: 'ConsultarReq',
                      app_key: OMIE_APP_KEY,
                      app_secret: OMIE_APP_SECRET,
                      param: [param]
                    })
                  });
                  
                  if (responseReq2.ok) {
                    const reqData2 = await responseReq2.json();
                    console.log(`[webhooks/omie/pedidos-compra] 🔍 Resposta com codIntReqCompra:`, JSON.stringify(reqData2, null, 2));
                    
                    itens = reqData2?.requisicaoCadastro?.ItensReqCompra 
                         || reqData2?.requisicaoCadastro?.itens_req_compra 
                         || reqData2?.ItensReqCompra
                         || reqData2?.itens_req_compra 
                         || [];
                    
                    if (itens.length > 0) {
                      // Usa dados do segundo response
                      return {
                        requisicaoCadastro: {
                          ...reqData,
                          ...reqData2,
                          ItensReqCompra: itens
                        }
                      };
                    }
                  }
                }
                
                // Se encontrou itens, retorna sucesso
                if (itens.length > 0) {
                  console.log(`[webhooks/omie/pedidos-compra] ✅ ${itens.length} item(ns) encontrado(s) na tentativa ${tentativa}`);
                  return {
                    requisicaoCadastro: {
                      ...reqData,
                      ItensReqCompra: itens
                    }
                  };
                }
                
                // Se não tem itens e não é a última tentativa, tenta novamente
                if (tentativa < maxTentativas) {
                  console.log(`[webhooks/omie/pedidos-compra] ⚠️ Nenhum item encontrado na tentativa ${tentativa}, aguardando para tentar novamente...`);
                  continue;
                }
                
                // Última tentativa sem itens - usa fallback do webhook se disponível
                console.log('[webhooks/omie/pedidos-compra] ⚠️ Nenhum item encontrado após todas tentativas');
                return reqData;
              }
              
              throw new Error('Máximo de tentativas atingido sem sucesso');
            };

            requisicao = await buscarRequisicaoComRetry();
            
            // Se recebemos cabecalho_consulta no webhook, mesclamos com os dados da API
            if (event.cabecalho_consulta) {
              // Garante que requisicaoCadastro existe
              if (!requisicao) requisicao = {};
              if (!requisicao.requisicaoCadastro) requisicao.requisicaoCadastro = {};
              
              // Sobrescreve campos específicos do webhook (prioridade para webhook)
              // cNumero e cEtapa vêm do webhook e têm prioridade
              if (event.cabecalho_consulta.cNumero) {
                requisicao.requisicaoCadastro.cNumero = event.cabecalho_consulta.cNumero;
              }
              if (event.cabecalho_consulta.cEtapa) {
                requisicao.requisicaoCadastro.cEtapa = event.cabecalho_consulta.cEtapa;
              }
              
              // Garante que nCodPed e cCodIntPed estejam definidos
              if (!requisicao.requisicaoCadastro.nCodPed && event.cabecalho_consulta.nCodPed) {
                requisicao.requisicaoCadastro.nCodPed = event.cabecalho_consulta.nCodPed;
              }
              if (!requisicao.requisicaoCadastro.cCodIntPed && event.cabecalho_consulta.cCodIntPed) {
                requisicao.requisicaoCadastro.cCodIntPed = event.cabecalho_consulta.cCodIntPed;
              }
            }
            
            await upsertRequisicaoCompra(requisicao, topic);

            const acaoReq = topic.includes('Incluida') ? 'incluida' : 'alterada';
            console.log(`[webhooks/omie/pedidos-compra] ✅ Requisição ${codReqCompra || codIntReqCompra} ${acaoReq} com sucesso`);
            console.log(`[webhooks/omie/pedidos-compra] 📦 Itens processados: ${requisicao?.requisicaoCadastro?.ItensReqCompra?.length || requisicao?.requisicaoCadastro?.itens_req_compra?.length || 0}`);
          } catch (error) {
            console.error(`[webhooks/omie/pedidos-compra] ❌ Erro no processamento assíncrono:`, error);
          }
        })(); // Executa imediatamente sem esperar

        // Retorno já foi enviado acima (resposta imediata)
        return;
      }

      // ====== Tratamento de Pedidos de Compra (CompraProduto.*) ======
      // Extrai identificadores do webhook - cNumero (operacional) e nCodPed (técnico Omie)
      const cabecalho = event.cabecalho_consulta || event.cabecalho || {};
      const cNumero = cabecalho.cNumero ||
                      cabecalho.c_numero ||
                      cabecalho['cNúmero'] ||
                      event.cNumero ||
                      event.c_numero ||
                      event['cNúmero'] ||
                      body.cNumero ||
                      body.c_numero ||
                      body['cNúmero'] ||
                      event.codigo_numero ||
                      body.codigo_numero;
      
      let nCodPed = cabecalho.nCodPed ||        // PRIORIDADE: dentro do cabecalho primeiro
                    cabecalho.n_cod_ped ||
                    event.nCodPed || 
                    event.n_cod_ped || 
                    body.nCodPed ||
                    body.n_cod_ped ||
                    event.codigo_pedido ||
                    body.codigo_pedido;

      if (!nCodPed && cNumero) {
        const pedidoExistente = await pool.query(
          `SELECT n_cod_ped
             FROM compras.pedidos_omie
            WHERE TRIM(COALESCE(c_numero, '')) = TRIM($1)
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 1`,
          [String(cNumero)]
        );

        if (pedidoExistente.rows.length > 0) {
          nCodPed = pedidoExistente.rows[0].n_cod_ped;
          console.log(`[webhooks/omie/pedidos-compra] nCodPed resolvido via cNumero ${cNumero}: ${nCodPed}`);
        }
      }

      if (!nCodPed && !cNumero) {
        console.warn('[webhooks/omie/pedidos-compra] Webhook sem identificador de pedido (nCodPed/cNumero):', JSON.stringify(body));
        return res.json({ ok: true, msg: 'Sem nCodPed/cNumero para processar' });
      }
      
      const identificadorPedido = cNumero || nCodPed;
      
      // ===== DEDUPLICAÇÃO: Verifica se já processamos este messageId =====
      const messageId = body.messageId;
      if (messageId) {
        const checkDupe = await pool.query(
          'SELECT 1 FROM compras.pedidos_omie WHERE evento_webhook_message_id = $1',
          [messageId]
        );
        if (checkDupe.rows.length > 0) {
          console.log(`[webhooks/omie/pedidos-compra] ⚠ Webhook duplicado ignorado (messageId: ${messageId})`);
          return res.json({ ok: true, msg: 'Webhook duplicado - já processado' });
        }
      }
      
      console.log(`[webhooks/omie/pedidos-compra] Processando evento "${topic}" para pedido ${identificadorPedido}`);
      
      // Se for exclusão ou cancelamento, apenas marca como inativo no banco
      if (topic.includes('Excluida') || topic.includes('Cancelada') || event.excluido || body.excluido) {
        await pool.query(`
          UPDATE compras.pedidos_omie 
          SET inativo = true, 
              evento_webhook = $1,
              evento_webhook_message_id = $2,
              data_webhook = NOW(),
              updated_at = NOW()
          WHERE (n_cod_ped = $3)
             OR (TRIM(COALESCE(c_numero, '')) = TRIM($4))
        `, [topic, messageId || null, nCodPed || null, cNumero || null]);
        
        const acao = topic.includes('Excluida') ? 'excluido' : 'cancelado';
        console.log(`[webhooks/omie/pedidos-compra] Pedido ${identificadorPedido} marcado como inativo (${acao})`);
        
        return res.json({ 
          ok: true, 
          n_cod_ped: nCodPed || null,
          c_numero: cNumero || null,
          acao: acao,
          atualizado: true 
        });
      }
      
      // ===== RESPOSTA ASSÍNCRONA: Responde imediatamente para evitar timeout =====
      const acao = topic.includes('Incluida') ? 'incluido' : 
                   topic.includes('Encerrada') ? 'encerrado' :
                   topic.includes('EtapaAlterada') ? 'etapa alterada' : 'alterado';
      
      res.json({ 
        ok: true, 
        n_cod_ped: nCodPed || null,
        c_numero: cNumero || null,
        acao: acao,
        atualizado: true 
      });
      
      // ===== PROCESSAMENTO EM BACKGROUND =====
      // Para inclusão, alteração, encerramento ou mudança de etapa, busca dados completos na API da Omie
      (async () => {
        try {
          const etapaWebhook = String(cabecalho.cEtapa || cabecalho.c_etapa || '').trim();
          const numeroWebhook = String(cabecalho.cNumero || cabecalho.c_numero || cabecalho['cNúmero'] || cNumero || '').trim();

          const montarPedidoFallbackDoWebhook = () => ({
            cabecalho: {
              nCodPed: nCodPed ? (Number.parseInt(nCodPed, 10) || null) : null,
              cCodIntPed: cabecalho.cCodIntPed || cabecalho.c_cod_int_ped || null,
              cNumero: numeroWebhook || null,
              cEtapa: etapaWebhook || null,
              dIncData: cabecalho.dIncData || cabecalho.d_inc_data || null,
              dDtPrevisao: cabecalho.dDtPrevisao || cabecalho.d_dt_previsao || null,
              cCodCateg: cabecalho.cCodCateg || cabecalho.c_cod_categ || null,
              cCodParc: cabecalho.cCodParc || cabecalho.c_cod_parc || null,
              cObs: cabecalho.cObs || cabecalho.c_obs || null,
              cObsInt: cabecalho.cObsInt || cabecalho.c_obs_int || null,
              nCodCC: cabecalho.nCodCC || cabecalho.n_cod_cc || null,
              nCodCompr: cabecalho.nCodCompr || cabecalho.n_cod_compr || null,
              nCodFor: cabecalho.nCodFor || cabecalho.n_cod_for || null,
              nCodProj: cabecalho.nCodProj || cabecalho.n_cod_proj || null,
              nQtdeParc: cabecalho.nQtdeParc || cabecalho.n_qtde_parc || null
            },
            frete: event.frete_consulta || event.frete || {},
            produtos: [],
            parcelas: [],
            departamentos: []
          });

          let pedido = null;
          const maxTentativas = 4;

          for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
            if (!nCodPed) {
              break;
            }
            const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                call: 'ConsultarPedCompra',
                app_key: OMIE_APP_KEY,
                app_secret: OMIE_APP_SECRET,
                param: [{
                  nCodPed: parseInt(nCodPed, 10)
                }]
              })
            });

            if (!response.ok) {
              const errorText = await response.text();
              const ehConsumoRedundante = /Consumo redundante|Client-8/i.test(errorText || '');
              console.error(`[webhooks/omie/pedidos-compra] Erro na API Omie: ${response.status} - ${errorText}`);

              if (ehConsumoRedundante && tentativa < maxTentativas) {
                const esperaMs = tentativa * 3000;
                await new Promise(resolve => setTimeout(resolve, esperaMs));
                continue;
              }
              break;
            }

            const pedidoApi = await response.json().catch(() => null);
            const faultstring = String(pedidoApi?.faultstring || '').trim();
            const faultcode = String(pedidoApi?.faultcode || '').trim();

            if (faultstring) {
              const ehConsumoRedundante = /Consumo redundante|Client-8/i.test(`${faultstring} ${faultcode}`);
              console.error(`[webhooks/omie/pedidos-compra] Falha ConsultarPedCompra: ${faultstring}${faultcode ? ` (${faultcode})` : ''}`);

              if (ehConsumoRedundante && tentativa < maxTentativas) {
                const esperaMs = tentativa * 3000;
                await new Promise(resolve => setTimeout(resolve, esperaMs));
                continue;
              }
              break;
            }

            pedido = pedidoApi;
            break;
          }

          if (!pedido || typeof pedido !== 'object') {
            console.warn(`[webhooks/omie/pedidos-compra] ConsultarPedCompra sem payload válido para ${identificadorPedido}. Usando fallback do webhook.`);
            pedido = montarPedidoFallbackDoWebhook();
          }

          // Webhook tem prioridade para etapa/numero quando vier preenchido,
          // pois a API ConsultarPedCompra pode retornar dados defasados por alguns instantes.
          if (!pedido.cabecalho || typeof pedido.cabecalho !== 'object') {
            pedido.cabecalho = (pedido.cabecalho_consulta && typeof pedido.cabecalho_consulta === 'object')
              ? { ...pedido.cabecalho_consulta }
              : {};
          }

          if (!pedido.cabecalho.nCodPed && !pedido.cabecalho.n_cod_ped && nCodPed) {
            pedido.cabecalho.nCodPed = Number.parseInt(nCodPed, 10) || null;
          }
          if (!pedido.cabecalho.cCodIntPed && (cabecalho.cCodIntPed || cabecalho.c_cod_int_ped)) {
            pedido.cabecalho.cCodIntPed = cabecalho.cCodIntPed || cabecalho.c_cod_int_ped;
          }
          if (etapaWebhook) {
            pedido.cabecalho.cEtapa = etapaWebhook;
          }
          if (numeroWebhook) {
            pedido.cabecalho.cNumero = numeroWebhook;
          }
          
          // Atualiza no banco com messageId
          await upsertPedidoCompra(pedido, topic, messageId);
          
          // Sincroniza com solicitacao_compras
          if (nCodPed) {
            await sincronizarPedidoComSolicitacao(nCodPed);
          }
          
          console.log(`[webhooks/omie/pedidos-compra] Pedido ${nCodPed} ${acao} com sucesso`);
        } catch (err) {
          console.error(`[webhooks/omie/pedidos-compra] Erro no processamento assíncrono do pedido ${nCodPed}:`, err);
        }
      })();
    } catch (err) {
      console.error('[webhooks/omie/pedidos-compra] erro:', err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);

// ============================================================================
// WEBHOOK - Recebimentos de NF-e (RecebimentoProduto.*)
// ============================================================================
app.post(['/webhooks/omie/recebimentos-nfe', '/api/webhooks/omie/recebimentos-nfe'],
  express.json(),
  async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const event =
        (body.evento && typeof body.evento === 'object' ? body.evento : null)
        || (body.event && typeof body.event === 'object' ? body.event : null)
        || (body.payload && typeof body.payload.event === 'object' ? body.payload.event : null)
        || (body.data && typeof body.data.event === 'object' ? body.data.event : null)
        || body;
      
      // Log do webhook recebido
      console.log('[webhooks/omie/recebimentos-nfe] Webhook recebido:', JSON.stringify(body, null, 2));
      
      const topic = body.topic || event.topic || '';  // Ex: "RecebimentoProduto.Incluido"
      const messageId = body.messageId || body.message_id || null;
      
      // Extrai nIdReceb ou cChaveNfe do evento
      // Omie pode enviar em: event.nIdReceb, event.cabec.nIdReceb, event.cabecalho.nIdReceb, etc
      // Procura em múltiplas localizações possíveis
      const nIdReceb = event.nIdReceb 
        || event.n_id_receb 
        || body.nIdReceb 
        || body.n_id_receb
        || event.cabec?.nIdReceb
        || body.cabec?.nIdReceb
        || event.cabecalho?.nIdReceb        // ← Webhook real envia aqui!
        || body.cabecalho?.nIdReceb
        || null;
        
      const cChaveNfe = event.cChaveNfe
        || event.c_chave_nfe
        || body.cChaveNfe
        || body.c_chave_nfe
        || event.cabec?.cChaveNfe
        || body.cabec?.cChaveNfe
        || event.cabecalho?.cChaveNfe       // ← Para consistência
        || body.cabecalho?.cChaveNfe
        || null;

      const cDadosAdicionaisWebhook = event.cDadosAdicionais
        || event.c_dados_adicionais
        || event.cabec?.cDadosAdicionais
        || event.cabec?.c_dados_adicionais
        || body.cabec?.cDadosAdicionais
        || body.cabec?.c_dados_adicionais
        || event.cabecalho?.cDadosAdicionais
        || event.cabecalho?.c_dados_adicionais
        || body.cabecalho?.cDadosAdicionais
        || body.cabecalho?.c_dados_adicionais
        || null;
      
      if (!nIdReceb && !cChaveNfe) {
        console.warn('[webhooks/omie/recebimentos-nfe] Webhook sem nIdReceb/cChaveNfe:', JSON.stringify(body));
        return res.json({ ok: true, msg: 'Sem nIdReceb/cChaveNfe para processar' });
      }
      
      console.log(`[webhooks/omie/recebimentos-nfe] Processando evento "${topic}" para recebimento ${nIdReceb || cChaveNfe}`);
      
      // ===== RESPOSTA IMEDIATA =====
      res.json({ 
        ok: true, 
        n_id_receb: nIdReceb || null, 
        c_chave_nfe: cChaveNfe || null, 
        status: 'processing' 
      });
      
      // ===== PROCESSAMENTO ASSÍNCRONO =====
      (async () => {
        try {
          // Determina a ação baseada no evento
          let acao = 'processado';
          
          if (topic.includes('Incluido')) {
            acao = 'incluído';
          } else if (topic.includes('Alterado')) {
            acao = 'alterado';
          } else if (topic.includes('Concluido')) {
            acao = 'concluído';
          } else if (topic.includes('Devolvido')) {
            acao = 'devolvido';
          } else if (topic.includes('Revertido')) {
            acao = 'revertido';
          } else if (topic.includes('Excluido')) {
            acao = 'excluído';
          }
          
          // Para exclusão, marca como inativo
          if (topic.includes('Excluido')) {
            if (nIdReceb) {
              await pool.query(`
                UPDATE logistica.recebimentos_nfe_omie
                SET c_cancelada = 'S',
                    updated_at = NOW()
                WHERE n_id_receb = $1
              `, [nIdReceb]);
            } else if (cChaveNfe) {
              await pool.query(`
                UPDATE logistica.recebimentos_nfe_omie
                SET c_cancelada = 'S',
                    updated_at = NOW()
                WHERE c_chave_nfe = $1
              `, [cChaveNfe]);
            }
            
            console.log(`[webhooks/omie/recebimentos-nfe] ✓ Recebimento ${nIdReceb || cChaveNfe} marcado como cancelado`);
            return;
          }
          
          // Para os demais eventos, busca dados completos na API
          let recebimento = null;
          const param = nIdReceb 
            ? { nIdReceb: parseInt(nIdReceb) }
            : { cChaveNfe: String(cChaveNfe) };
          
          // Delay de 2 segundos para dar tempo da Omie processar
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          console.log(`[webhooks/omie/recebimentos-nfe] Consultando dados completos do recebimento com nIdReceb=${nIdReceb}...`);
          
          const response = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              call: 'ConsultarRecebimento',
              app_key: OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET,
              param: [param]
            })
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[webhooks/omie/recebimentos-nfe] Erro na API Omie: ${response.status} - ${errorText}`);
            return;
          }
          
          recebimento = await response.json();
          
          // Atualiza no banco - passa cChaveNfe e cDadosAdicionais vindos do webhook como fallback
          await upsertRecebimentoNFe(recebimento, topic, messageId, cChaveNfe, cDadosAdicionaisWebhook);
          
          console.log(`[webhooks/omie/recebimentos-nfe] ✓ Recebimento ${nIdReceb || cChaveNfe} ${acao} com sucesso`);
          
        } catch (err) {
          console.error(`[webhooks/omie/recebimentos-nfe] Erro no processamento assíncrono:`, err);
        }
      })();
      
    } catch (err) {
      console.error('[webhooks/omie/recebimentos-nfe] erro:', err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  }
);

// Endpoint para sincronizar todos os fornecedores manualmente
app.post('/api/fornecedores/sync', express.json(), async (req, res) => {
  try {
    const result = await syncFornecedoresOmie();
    res.json(result);
  } catch (err) {
    console.error('[API /api/fornecedores/sync] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// Endpoint para sincronizar todos os pedidos de compra da Omie manualmente
// ============================================================================
app.post('/api/compras/pedidos-omie/sync', express.json(), async (req, res) => {
  try {
    const filtros = req.body || {};
    
    console.log('[API] Iniciando sincronização de pedidos de compra da Omie...');
    const result = await syncPedidosCompraOmie(filtros);
    
    res.json(result);
  } catch (err) {
    console.error('[API /api/compras/pedidos-omie/sync] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// Endpoint para sincronizar todos os recebimentos de NF-e da Omie manualmente
// ============================================================================
app.post('/api/logistica/recebimentos-nfe/sync', express.json(), async (req, res) => {
  try {
    const filtros = req.body || {};
    
    console.log('[API] Iniciando sincronização de recebimentos de NF-e da Omie...');
    const result = await syncRecebimentosNFeOmie(filtros);
    
    res.json(result);
  } catch (err) {
    console.error('[API /api/logistica/recebimentos-nfe/sync] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// Endpoint para sincronizar todas as requisições de compra da Omie manualmente
// ============================================================================
app.post('/api/compras/requisicoes-omie/sync', express.json(), async (req, res) => {
  try {
    const filtros = req.body || {};

    console.log('[API] Iniciando sincronização de requisições de compra da Omie...');
    const result = await syncRequisicoesCompraOmie(filtros);

    res.json(result);
  } catch (err) {
    console.error('[API /api/compras/requisicoes-omie/sync] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// Endpoint para criar/atualizar uma requisição manualmente (dados diretos)
// ============================================================================
app.post('/api/compras/requisicoes-omie/upsert', express.json(), async (req, res) => {
  try {
    const requisicao = req.body || {};

    // Aceita codReqCompra, cod_req_compra, nCodPed, ou qualquer variação
    const hasCodReqCompra = requisicao.codReqCompra 
      || requisicao.cod_req_compra 
      || requisicao.nCodPed
      || requisicao.n_cod_ped;
    
    if (!hasCodReqCompra) {
      return res.status(400).json({ 
        ok: false, 
        error: 'codReqCompra/nCodPed é obrigatório' 
      });
    }

    // Normaliza o nome do campo
    if (!requisicao.codReqCompra && requisicao.nCodPed) {
      requisicao.codReqCompra = requisicao.nCodPed;
    } else if (!requisicao.codReqCompra && requisicao.n_cod_ped) {
      requisicao.codReqCompra = requisicao.n_cod_ped;
    } else if (!requisicao.codReqCompra && requisicao.cod_req_compra) {
      requisicao.codReqCompra = requisicao.cod_req_compra;
    }

    console.log(`[API /api/compras/requisicoes-omie/upsert] Inserindo requisição: ${requisicao.codReqCompra}`);
    
    await upsertRequisicaoCompra(requisicao, 'manual-api');

    res.json({ 
      ok: true, 
      cod_req_compra: requisicao.codReqCompra,
      msg: 'Requisição inserida/atualizada com sucesso'
    });
  } catch (err) {
    console.error('[API /api/compras/requisicoes-omie/upsert] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint GET para verificar requisição
app.get('/api/compras/requisicoes-omie/get', async (req, res) => {
  try {
    const { codReqCompra, nCodPed } = req.query;
    const cod = codReqCompra || nCodPed;
    
    if (!cod) {
      return res.status(400).json({ ok: false, error: 'codReqCompra ou nCodPed obrigatório' });
    }

    const result = await pool.query(
      'SELECT * FROM compras.requisicoes_omie WHERE cod_req_compra = $1 LIMIT 1',
      [cod]
    );

    if (result.rows.length === 0) {
      return res.json({ ok: false, msg: 'Requisição não encontrada' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[API /api/compras/requisicoes-omie/get] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint GET para consultar pedido específico
app.get('/api/compras/pedidos-omie/get', async (req, res) => {
  try {
    const { nCodPed, n_cod_ped } = req.query;
    const cod = nCodPed || n_cod_ped;
    
    if (!cod) {
      return res.status(400).json({ ok: false, error: 'nCodPed obrigatório' });
    }

    const result = await pool.query(
      'SELECT * FROM compras.pedidos_omie WHERE n_cod_ped = $1 LIMIT 1',
      [cod]
    );

    if (result.rows.length === 0) {
      return res.json({ ok: false, msg: 'Pedido não encontrado' });
    }

    res.json({ ok: true, data: result.rows[0] });
  } catch (err) {
    console.error('[API /api/compras/pedidos-omie/get] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para testar o que a API da Omie retorna
app.get('/api/compras/pedidos-omie/teste-api', async (req, res) => {
  try {
    console.log('[API] Testando TODAS as combinações de filtros da API Omie...');
    
    const analisarEtapas = (pedidos) => {
      const etapas = {};
      for (const ped of (pedidos || [])) {
        const etapa = ped.cabecalho?.cEtapa || ped.cabecalho_consulta?.cEtapa || 'SEM';
        etapas[etapa] = (etapas[etapa] || 0) + 1;
      }
      return etapas;
    };
    
    const testarFiltro = async (nome, filtros) => {
      const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'PesquisarPedCompra',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{
            nPagina: 1,
            nRegsPorPagina: 50,
            ...filtros
          }]
        })
      });
      const data = await response.json();
      return {
        nome,
        filtros_enviados: filtros,
        total_registros: data.nTotalRegistros || 0,
        retornados: data.pedidos_pesquisa?.length || 0,
        etapas: analisarEtapas(data.pedidos_pesquisa),
        tem_etapa_40_60_80: Object.keys(analisarEtapas(data.pedidos_pesquisa)).some(e => ['40', '60', '80'].includes(e))
      };
    };
    
    // Testa todas as combinações possíveis
    const testes = [
      { nome: "1. Sem filtros (padrão)", filtros: {} },
      { nome: "2. Apenas pendentes", filtros: { lExibirPedidosPendentes: true } },
      { nome: "3. Apenas faturados", filtros: { lExibirPedidosFaturados: true } },
      { nome: "4. Apenas recebidos", filtros: { lExibirPedidosRecebidos: true } },
      { nome: "5. Apenas cancelados", filtros: { lExibirPedidosCancelados: true } },
      { nome: "6. Apenas encerrados", filtros: { lExibirPedidosEncerrados: true } },
      { nome: "7. Faturados + Recebidos", filtros: { 
        lExibirPedidosFaturados: true,
        lExibirPedidosRecebidos: true 
      }},
      { nome: "8. Parciais (RecParciais)", filtros: { lExibirPedidosRecParciais: true } },
      { nome: "9. Parciais (FatParciais)", filtros: { lExibirPedidosFatParciais: true } },
      { nome: "10. Ambos parciais", filtros: { 
        lExibirPedidosRecParciais: true,
        lExibirPedidosFatParciais: true 
      }},
      { nome: "11. Todos = true", filtros: {
        lExibirPedidosPendentes: true,
        lExibirPedidosFaturados: true,
        lExibirPedidosRecebidos: true,
        lExibirPedidosCancelados: true,
        lExibirPedidosEncerrados: true
      }},
      { nome: "12. Todos = false", filtros: {
        lExibirPedidosPendentes: false,
        lExibirPedidosFaturados: false,
        lExibirPedidosRecebidos: false,
        lExibirPedidosCancelados: false,
        lExibirPedidosEncerrados: false
      }},
      { nome: "13. Só FALSE nos pendentes", filtros: {
        lExibirPedidosPendentes: false
      }},
      { nome: "14. Tudo TRUE + Parciais", filtros: {
        lExibirPedidosPendentes: true,
        lExibirPedidosFaturados: true,
        lExibirPedidosRecebidos: true,
        lExibirPedidosCancelados: true,
        lExibirPedidosEncerrados: true,
        lExibirPedidosRecParciais: true,
        lExibirPedidosFatParciais: true
      }}
    ];
    
    const resultados = [];
    for (const teste of testes) {
      const resultado = await testarFiltro(teste.nome, teste.filtros);
      resultados.push(resultado);
      console.log(`[TESTE] ${teste.nome}: ${resultado.total_registros} total, Etapas: ${JSON.stringify(resultado.etapas)}`);
      // Pequeno delay para não sobrecarregar a API
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Encontra qual teste retornou etapas 40, 60, 80
    const testeComEtapas = resultados.find(r => r.tem_etapa_40_60_80);
    
    const resposta = {
      ok: true,
      resumo: {
        total_testes: resultados.length,
        encontrou_etapas_40_60_80: !!testeComEtapas,
        melhor_configuracao: testeComEtapas?.nome || 'Nenhuma configuração retornou etapas 40, 60, 80'
      },
      resultados_completos: resultados
    };
    
    console.log('[API] Testes concluídos:', JSON.stringify(resposta.resumo, null, 2));
    res.json(resposta);
    
  } catch (err) {
    console.error('[API /api/compras/pedidos-omie/teste-api] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// Endpoint para listar pedidos de compra do banco local
app.get('/api/compras/pedidos-omie', async (req, res) => {
  try {
    const { 
      fornecedor, 
      etapa, 
      data_de, 
      data_ate, 
      limit = 100,
      offset = 0
    } = req.query;
    
    let query = 'SELECT * FROM compras.pedidos_omie WHERE 1=1';
    const params = [];
    let paramCount = 1;
    
    // Filtro por fornecedor
    if (fornecedor) {
      query += ` AND n_cod_for = $${paramCount}`;
      params.push(fornecedor);
      paramCount++;
    }
    
    // Filtro por etapa
    if (etapa) {
      query += ` AND c_etapa = $${paramCount}`;
      params.push(etapa);
      paramCount++;
    }
    
    // Filtro por data inicial
    if (data_de) {
      query += ` AND d_inc_data >= $${paramCount}`;
      params.push(data_de);
      paramCount++;
    }
    
    // Filtro por data final
    if (data_ate) {
      query += ` AND d_inc_data <= $${paramCount}`;
      params.push(data_ate);
      paramCount++;
    }
    
    // Ordenação e paginação
    query += ` ORDER BY d_inc_data DESC, n_cod_ped DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);
    
    const { rows } = await pool.query(query, params);
    
    // Buscar total de registros
    let countQuery = 'SELECT COUNT(*) as total FROM compras.pedidos_omie WHERE 1=1';
    const countParams = [];
    let countParamCount = 1;
    
    if (fornecedor) {
      countQuery += ` AND n_cod_for = $${countParamCount}`;
      countParams.push(fornecedor);
      countParamCount++;
    }
    
    if (etapa) {
      countQuery += ` AND c_etapa = $${countParamCount}`;
      countParams.push(etapa);
      countParamCount++;
    }
    
    if (data_de) {
      countQuery += ` AND d_inc_data >= $${countParamCount}`;
      countParams.push(data_de);
      countParamCount++;
    }
    
    if (data_ate) {
      countQuery += ` AND d_inc_data <= $${countParamCount}`;
      countParams.push(data_ate);
      countParamCount++;
    }
    
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);
    
    res.json({ 
      ok: true, 
      pedidos: rows,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('[API /api/compras/pedidos-omie] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para consultar um pedido específico com todos os detalhes
app.get('/api/compras/pedidos-omie/:nCodPed(\\d+)', async (req, res) => {
  try {
    const { nCodPed } = req.params;
    
    // Buscar cabeçalho
    const pedidoResult = await pool.query(
      'SELECT * FROM compras.pedidos_omie WHERE n_cod_ped = $1',
      [nCodPed]
    );
    
    if (pedidoResult.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    }
    
    const pedido = pedidoResult.rows[0];
    
    // Buscar produtos
    const produtosResult = await pool.query(
      'SELECT * FROM compras.pedidos_omie_produtos WHERE n_cod_ped = $1 ORDER BY id',
      [nCodPed]
    );
    
    // Buscar frete
    const freteResult = await pool.query(
      'SELECT * FROM compras.pedidos_omie_frete WHERE n_cod_ped = $1',
      [nCodPed]
    );
    
    // Buscar parcelas
    const parcelasResult = await pool.query(
      'SELECT * FROM compras.pedidos_omie_parcelas WHERE n_cod_ped = $1 ORDER BY n_parcela',
      [nCodPed]
    );
    
    // Buscar departamentos
    const departamentosResult = await pool.query(
      'SELECT * FROM compras.pedidos_omie_departamentos WHERE n_cod_ped = $1',
      [nCodPed]
    );
    
    res.json({
      ok: true,
      pedido: {
        ...pedido,
        produtos: produtosResult.rows,
        frete: freteResult.rows[0] || null,
        parcelas: parcelasResult.rows,
        departamentos: departamentosResult.rows
      }
    });
  } catch (err) {
    console.error('[API /api/compras/pedidos-omie/:nCodPed] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para listar fornecedores do banco local
app.get('/api/fornecedores', async (req, res) => {
  try {
    const { ativo, search, limit = 100 } = req.query;
    
    let query = 'SELECT * FROM omie.fornecedores WHERE 1=1';
    const params = [];
    let paramCount = 1;
    
    // Filtro por ativo/inativo
    if (ativo === 'true' || ativo === '1') {
      query += ` AND inativo = false`;
    } else if (ativo === 'false' || ativo === '0') {
      query += ` AND inativo = true`;
    }
    
    // Busca por nome, razão social ou CNPJ
    if (search && search.trim()) {
      query += ` AND (
        razao_social ILIKE $${paramCount} OR 
        nome_fantasia ILIKE $${paramCount} OR 
        cnpj_cpf ILIKE $${paramCount}
      )`;
      params.push(`%${search.trim()}%`);
      paramCount++;
    }
    
    query += ` ORDER BY razao_social LIMIT $${paramCount}`;
    params.push(parseInt(limit) || 100);
    
    const { rows } = await pool.query(query, params);
    
    res.json({ 
      ok: true, 
      total: rows.length,
      fornecedores: rows 
    });
  } catch (err) {
    console.error('[API /api/fornecedores] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para buscar um fornecedor específico
app.get('/api/fornecedores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { rows } = await pool.query(
      'SELECT * FROM omie.fornecedores WHERE codigo_cliente_omie = $1',
      [id]
    );
    
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Fornecedor não encontrado' });
    }
    
    res.json({ 
      ok: true, 
      fornecedor: rows[0] 
    });
  } catch (err) {
    console.error('[API /api/fornecedores/:id] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// Endpoint para buscar condições de pagamento (parcelas) da Omie
// Objetivo: Listar parcelas disponíveis para seleção no pedido de compra
app.get('/api/compras/parcelas', async (req, res) => {
  try {
    console.log('[API /api/compras/parcelas] Buscando parcelas da Omie...');
    
    const omiePayload = {
      call: 'ListarParcelas',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{
        pagina: 1,
        registros_por_pagina: 200
      }]
    };
    
    const resp = await fetch('https://app.omie.com.br/api/v1/geral/parcelas/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(omiePayload)
    });
    
    if (!resp.ok) {
      throw new Error(`Erro na API Omie: ${resp.status}`);
    }
    
    const data = await resp.json();
    
    console.log('[API /api/compras/parcelas] Resposta da Omie:', JSON.stringify(data).substring(0, 500));
    
    if (data.faultstring) {
      throw new Error(data.faultstring);
    }
    
    const parcelas = data.cadastros || []; // Omie retorna em "cadastros", não "lista_parcelas"
    console.log(`[API /api/compras/parcelas] ${parcelas.length} parcelas encontradas`);
    
    res.json({ ok: true, parcelas });
    
  } catch (err) {
    console.error('[API /api/compras/parcelas] Erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Comentário: sincroniza categorias da Omie para configuracoes.categoria_compra
async function syncCategoriasCompraOmie() {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('Credenciais Omie não configuradas');
  }

  const categorias = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const response = await fetch('https://app.omie.com.br/api/v1/geral/categorias/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarCategorias',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina,
          registros_por_pagina: 500
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Omie API retornou status ${response.status}`);
    }

    const data = await response.json();
    if (data.faultstring) {
      throw new Error(data.faultstring);
    }

    const lista = data.categoria_cadastro || [];
    categorias.push(...lista);

    totalPaginas = Number(data.total_de_paginas || 1);
    pagina++;
  }

  const filtradas = categorias.filter(cat => {
    return cat.conta_despesa === 'S' && cat.conta_inativa === 'N' && cat.categoria_superior === '2.01';
  });

  if (filtradas.length === 0) {
    return { total: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const cat of filtradas) {
      await client.query(
        `INSERT INTO configuracoes.categoria_compra
         (codigo, descricao, conta_despesa, conta_inativa, categoria_superior, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (codigo) DO UPDATE SET
           descricao = EXCLUDED.descricao,
           conta_despesa = EXCLUDED.conta_despesa,
           conta_inativa = EXCLUDED.conta_inativa,
           categoria_superior = EXCLUDED.categoria_superior,
           updated_at = NOW()` ,
        [
          cat.codigo,
          cat.descricao,
          cat.conta_despesa,
          cat.conta_inativa,
          cat.categoria_superior
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { total: filtradas.length };
}

// Comentário: sincroniza ListarCategorias da Omie para configuracoes."ListarCategorias"
async function syncListarCategoriasOmie() {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('Credenciais Omie não configuradas');
  }

  const categorias = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const response = await fetch('https://app.omie.com.br/api/v1/geral/categorias/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarCategorias',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina,
          registros_por_pagina: 500
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Omie API retornou status ${response.status}`);
    }

    const data = await response.json();
    if (data.faultstring) {
      throw new Error(data.faultstring);
    }

    const lista = data.categoria_cadastro || [];
    categorias.push(...lista);

    totalPaginas = Number(data.total_de_paginas || 1);
    pagina++;
  }

  if (categorias.length === 0) {
    return { total: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const cat of categorias) {
      await client.query(
        `INSERT INTO configuracoes."ListarCategorias"
         (codigo, descricao, conta_despesa, conta_inativa, categoria_superior, natureza, tipo_categoria, codigo_dre, raw, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (codigo) DO UPDATE SET
           descricao = EXCLUDED.descricao,
           conta_despesa = EXCLUDED.conta_despesa,
           conta_inativa = EXCLUDED.conta_inativa,
           categoria_superior = EXCLUDED.categoria_superior,
           natureza = EXCLUDED.natureza,
           tipo_categoria = EXCLUDED.tipo_categoria,
           codigo_dre = EXCLUDED.codigo_dre,
           raw = EXCLUDED.raw,
           updated_at = NOW()` ,
        [
          cat.codigo,
          cat.descricao,
          cat.conta_despesa,
          cat.conta_inativa,
          cat.categoria_superior,
          cat.natureza,
          cat.tipo_categoria,
          cat.codigo_dre,
          cat
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { total: categorias.length };
}

// Endpoint para sincronizar categorias da Omie
app.post('/api/compras/categorias/sync', async (_req, res) => {
  try {
    const result = await syncCategoriasCompraOmie();
    res.json({ ok: true, total: result.total });
  } catch (err) {
    console.error('[API /api/compras/categorias/sync] Erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para buscar categorias de compra (cache em configuracoes)
app.get('/api/compras/categorias', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT codigo, descricao
       FROM configuracoes.categoria_compra
       ORDER BY descricao ASC`
    );

    // Se não houver dados, tenta sincronizar uma vez
    if (rows.length === 0) {
      try {
        await syncCategoriasCompraOmie();
        const { rows: rows2 } = await pool.query(
          `SELECT codigo, descricao
           FROM configuracoes.categoria_compra
           ORDER BY descricao ASC`
        );
        return res.json({ ok: true, total: rows2.length, categorias: rows2 });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    res.json({ ok: true, total: rows.length, categorias: rows });
  } catch (err) {
    console.error('[API /api/compras/categorias] Erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para listar categorias (ListarCategorias) a partir do SQL
app.get('/api/compras/categorias-listar', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT codigo, descricao, categoria_superior, conta_inativa
       FROM configuracoes."ListarCategorias"
       WHERE conta_inativa = 'N'
       ORDER BY categoria_superior NULLS FIRST, codigo ASC`
    );

    res.json({ ok: true, total: rows.length, categorias: rows });
  } catch (err) {
    console.error('[API /api/compras/categorias-listar] Erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/compras/categoria-por-produto/:codigo_produto
// Busca a categoria da compra utilizada no último pedido/recebimento deste produto
app.get('/api/compras/categoria-por-produto/:codigo_produto', async (req, res) => {
  try {
    const codigoProduto = String(req.params.codigo_produto || '').trim();
    if (!codigoProduto) {
      return res.status(400).json({ ok: false, error: 'codigo_produto é obrigatório' });
    }

    console.log('[Compras/Categoria] Buscando categoria do último pedido', {
      codigo_produto: codigoProduto
    });

    // Busca a categoria do último recebimento deste produto ordenando por data de criação
    const { rows } = await pool.query(`
      SELECT c_categoria_item
      FROM logistica.recebimentos_nfe_itens
      WHERE c_codigo_produto = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `, [codigoProduto]);

    // Se não encontrar, usa categoria padrão para itens não localizados
    const codigoCat = rows[0]?.c_categoria_item || '2.14.94'; // Categoria padrão: Outros Materiais
    
    // Busca a descrição da categoria
    const { rows: catRows } = await pool.query(`
      SELECT codigo, descricao
      FROM configuracoes."ListarCategorias"
      WHERE codigo = $1
    `, [codigoCat]);
    
    const descricao = catRows[0]?.descricao || '';
    const categoriaCompleta = descricao ? `${codigoCat} - ${descricao}` : codigoCat;
    
    console.log('[Compras/Categoria] Resultado:', {
      codigo_produto: codigoProduto,
      categoria_codigo: codigoCat,
      categoria_descricao: descricao,
      categoria_completa: categoriaCompleta,
      encontrado_na_base: rows.length > 0
    });

    res.json({ 
      ok: true, 
      categoria: codigoCat,
      categoria_codigo: codigoCat,
      categoria_descricao: descricao,
      categoria_nome: categoriaCompleta
    });
  } catch (err) {
    console.error('[Compras] Erro ao buscar categoria por produto:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar categoria' });
  }
});

// GET /api/compras/config-responsavel-categoria - Lista configurações de responsáveis por categoria
app.get('/api/compras/config-responsavel-categoria', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, categoria_compra_codigo, categoria_compra_nome, responsavel_username, created_at, updated_at
      FROM compras.config_responsavel_categoria
      ORDER BY categoria_compra_nome
    `);
    
    res.json({ ok: true, configuracoes: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar configurações:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/compras/config-responsavel-categoria - Adiciona/Atualiza configuração
app.post('/api/compras/config-responsavel-categoria', express.json(), async (req, res) => {
  try {
    const { categoria_compra_codigo, categoria_compra_nome, responsavel_username } = req.body;
    
    if (!categoria_compra_codigo || !categoria_compra_nome || !responsavel_username) {
      return res.status(400).json({ ok: false, error: 'Campos obrigatórios: categoria_compra_codigo, categoria_compra_nome, responsavel_username' });
    }
    
    // Usa UPSERT (INSERT com ON CONFLICT UPDATE) para adicionar ou atualizar
    const { rows } = await pool.query(`
      INSERT INTO compras.config_responsavel_categoria (categoria_compra_codigo, categoria_compra_nome, responsavel_username, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (categoria_compra_codigo)
      DO UPDATE SET 
        categoria_compra_nome = EXCLUDED.categoria_compra_nome,
        responsavel_username = EXCLUDED.responsavel_username,
        updated_at = NOW()
      RETURNING *
    `, [categoria_compra_codigo, categoria_compra_nome, responsavel_username]);
    
    console.log(`[Compras] Configuração salva: ${categoria_compra_nome} → ${responsavel_username}`);
    res.json({ ok: true, configuracao: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao salvar configuração:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/compras/config-responsavel-categoria/:id - Remove configuração
app.delete('/api/compras/config-responsavel-categoria/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    
    const { rows } = await pool.query(`
      DELETE FROM compras.config_responsavel_categoria
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Configuração não encontrada' });
    }
    
    console.log(`[Compras] Configuração removida: ID ${id}`);
    res.json({ ok: true, configuracao: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao remover configuração:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ======== CONFIGURAÇÃO DE ACESSO AOS BOTÕES ========

// GET /api/compras/config-acesso-botoes - Lista permissões de acesso aos botões
app.get('/api/compras/config-acesso-botoes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM compras.config_acesso_botoes
      ORDER BY tipo_botao, departamento_nome, responsavel_username
    `);
    
    console.log(`[Compras] Listando ${rows.length} permissões de acesso`);
    res.json({ ok: true, permissoes: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar permissões:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/compras/config-acesso-botoes - Adiciona permissão de acesso
app.post('/api/compras/config-acesso-botoes', express.json(), async (req, res) => {
  try {
    const { tipo_botao, responsavel_username, departamento_nome } = req.body;
    
    if (!tipo_botao || !responsavel_username || !departamento_nome) {
      return res.status(400).json({ ok: false, error: 'Dados incompletos' });
    }
    
    if (!['aprovacao', 'pedido_compra'].includes(tipo_botao)) {
      return res.status(400).json({ ok: false, error: 'Tipo de botão inválido' });
    }
    
    const { rows } = await pool.query(`
      INSERT INTO compras.config_acesso_botoes (tipo_botao, responsavel_username, departamento_nome)
      VALUES ($1, $2, $3)
      ON CONFLICT (tipo_botao, responsavel_username, departamento_nome) DO NOTHING
      RETURNING *
    `, [tipo_botao, responsavel_username, departamento_nome]);
    
    if (rows.length === 0) {
      return res.status(409).json({ ok: false, error: 'Permissão já existe' });
    }
    
    console.log(`[Compras] Permissão adicionada: ${tipo_botao} - ${responsavel_username} - ${departamento_nome}`);
    res.json({ ok: true, permissao: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao adicionar permissão:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/compras/config-acesso-botoes/:id - Remove permissão
app.delete('/api/compras/config-acesso-botoes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    
    const { rows } = await pool.query(`
      DELETE FROM compras.config_acesso_botoes
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Permissão não encontrada' });
    }
    
    console.log(`[Compras] Permissão removida: ID ${id}`);
    res.json({ ok: true, permissao: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao remover permissão:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/compras/departamentos-categorias - Lista departamentos com categorias
app.get('/api/compras/departamentos-categorias', async (req, res) => {
  try {
    // Objetivo: listar todos os registros (inclusive inativos) para o painel de configuração
    const deptResult = await pool.query(`
      SELECT id, nome, ativo
      FROM configuracoes.departamento
      ORDER BY nome
    `);

    const catResult = await pool.query(`
      SELECT id, departamento_id, nome, ordem, ativo
      FROM configuracoes.categoria_departamento
      ORDER BY departamento_id, ordem, nome
    `);

    const subResult = await pool.query(`
      SELECT id, categoria_id, nome, ordem, ativo
      FROM configuracoes.subitem_departamento
      ORDER BY categoria_id, ordem, nome
    `);

    const departamentos = deptResult.rows.map((dept) => ({
      id: dept.id,
      nome: dept.nome,
      categorias: []
    }));

    const deptMap = new Map(departamentos.map((d) => [d.id, d]));

    const catMap = new Map();
    catResult.rows.forEach((cat) => {
      const dept = deptMap.get(cat.departamento_id);
      if (!dept) return;
      const categoria = {
        id: cat.id,
        nome: cat.nome,
        subitens: []
      };
      dept.categorias.push(categoria);
      catMap.set(cat.id, categoria);
    });

    subResult.rows.forEach((sub) => {
      const categoria = catMap.get(sub.categoria_id);
      if (!categoria) return;
      categoria.subitens.push({
        id: sub.id,
        nome: sub.nome
      });
    });

    res.json({ ok: true, departamentos });
  } catch (err) {
    console.error('[Compras] Erro ao listar departamentos/categorias:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/compras/departamentos - Cria departamento
app.post('/api/compras/departamentos', async (req, res) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    if (!nome) {
      return res.status(400).json({ ok: false, error: 'Nome do departamento é obrigatório' });
    }

    const { rows } = await pool.query(`
      INSERT INTO configuracoes.departamento (nome)
      VALUES ($1)
      RETURNING id, nome
    `, [nome]);

    res.json({ ok: true, departamento: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao criar departamento:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/compras/departamentos/:id - Renomeia departamento
app.put('/api/compras/departamentos/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const nome = String(req.body?.nome || '').trim();
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    if (!nome) {
      return res.status(400).json({ ok: false, error: 'Nome do departamento é obrigatório' });
    }

    const { rows } = await pool.query(`
      UPDATE configuracoes.departamento
      SET nome = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, nome
    `, [nome, id]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Departamento não encontrado' });
    }

    res.json({ ok: true, departamento: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao renomear departamento:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/compras/departamentos/:id - Remove departamento
app.delete('/api/compras/departamentos/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const { rows } = await pool.query(`
      DELETE FROM configuracoes.departamento
      WHERE id = $1
      RETURNING id
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Departamento não encontrado' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Compras] Erro ao excluir departamento:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/compras/departamentos/:id/categorias - Cria categoria
app.post('/api/compras/departamentos/:id/categorias', async (req, res) => {
  try {
    const departamentoId = parseInt(req.params.id);
    const nome = String(req.body?.nome || '').trim();
    if (!departamentoId || isNaN(departamentoId)) {
      return res.status(400).json({ ok: false, error: 'ID do departamento inválido' });
    }
    if (!nome) {
      return res.status(400).json({ ok: false, error: 'Nome da categoria é obrigatório' });
    }

    const { rows } = await pool.query(`
      WITH prox AS (
        SELECT COALESCE(MAX(ordem), 0) + 1 AS ordem
        FROM configuracoes.categoria_departamento
        WHERE departamento_id = $1
      )
      INSERT INTO configuracoes.categoria_departamento (departamento_id, nome, ordem)
      SELECT $1, $2, prox.ordem FROM prox
      RETURNING id, nome
    `, [departamentoId, nome]);

    res.json({ ok: true, categoria: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao criar categoria:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/compras/categorias-departamento/:id - Renomeia categoria
app.put('/api/compras/categorias-departamento/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const nome = String(req.body?.nome || '').trim();
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID da categoria inválido' });
    }
    if (!nome) {
      return res.status(400).json({ ok: false, error: 'Nome da categoria é obrigatório' });
    }

    const { rows } = await pool.query(`
      UPDATE configuracoes.categoria_departamento
      SET nome = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, nome
    `, [nome, id]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Categoria não encontrada' });
    }

    res.json({ ok: true, categoria: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao renomear categoria:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/compras/categorias-departamento/:id - Remove categoria
app.delete('/api/compras/categorias-departamento/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID da categoria inválido' });
    }

    const { rows } = await pool.query(`
      DELETE FROM configuracoes.categoria_departamento
      WHERE id = $1
      RETURNING id
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Categoria não encontrada' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Compras] Erro ao excluir categoria:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/compras/categorias-departamento/:id/subitens - Cria subitem
app.post('/api/compras/categorias-departamento/:id/subitens', async (req, res) => {
  try {
    const categoriaId = parseInt(req.params.id);
    const nome = String(req.body?.nome || '').trim();
    if (!categoriaId || isNaN(categoriaId)) {
      return res.status(400).json({ ok: false, error: 'ID da categoria inválido' });
    }
    if (!nome) {
      return res.status(400).json({ ok: false, error: 'Nome do subitem é obrigatório' });
    }

    const { rows } = await pool.query(`
      WITH prox AS (
        SELECT COALESCE(MAX(ordem), 0) + 1 AS ordem
        FROM configuracoes.subitem_departamento
        WHERE categoria_id = $1
      )
      INSERT INTO configuracoes.subitem_departamento (categoria_id, nome, ordem)
      SELECT $1, $2, prox.ordem FROM prox
      RETURNING id, nome
    `, [categoriaId, nome]);

    res.json({ ok: true, subitem: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao criar subitem:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/compras/subitens-departamento/:id - Renomeia subitem
app.put('/api/compras/subitens-departamento/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const nome = String(req.body?.nome || '').trim();
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID do subitem inválido' });
    }
    if (!nome) {
      return res.status(400).json({ ok: false, error: 'Nome do subitem é obrigatório' });
    }

    const { rows } = await pool.query(`
      UPDATE configuracoes.subitem_departamento
      SET nome = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, nome
    `, [nome, id]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Subitem não encontrado' });
    }

    res.json({ ok: true, subitem: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao renomear subitem:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/compras/subitens-departamento/:id - Remove subitem
app.delete('/api/compras/subitens-departamento/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ ok: false, error: 'ID do subitem inválido' });
    }

    const { rows } = await pool.query(`
      DELETE FROM configuracoes.subitem_departamento
      WHERE id = $1
      RETURNING id
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Subitem não encontrado' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Compras] Erro ao excluir subitem:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/compras/departamentos - Lista departamentos
app.get('/api/compras/departamentos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT nome FROM configuracoes.departamento
      ORDER BY nome
    `);
    
    console.log(`[Compras] Listando ${rows.length} departamentos`);
    res.json({ ok: true, departamentos: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar departamentos:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== ENDPOINTS DE HISTÓRICO DE SOLICITAÇÕES ==========

// GET /api/compras/historico/resumo - Estatísticas do histórico (DEVE VIR ANTES DO :id)
app.get('/api/compras/historico/resumo', async (req, res) => {
  try {
    const { dias = 30, table_source } = req.query;
    const diasInt = Number.parseInt(dias, 10) || 30;
    const tableSource = String(table_source || '').trim();

    let query = `
      SELECT 
        operacao,
        campo_alterado,
        COUNT(*) as total,
        COUNT(DISTINCT (COALESCE(table_source, 'solicitacao_compras') || ':' || solicitacao_id::TEXT)) as itens_afetados,
        COUNT(DISTINCT COALESCE(NULLIF(TRIM(usuario), ''), 'sistema')) as usuarios_distintos
      FROM compras.historico_solicitacao_compras
      WHERE created_at >= NOW() - ($1::INT * INTERVAL '1 day')
    `;
    const params = [diasInt];
    let paramIndex = 2;

    if (tableSource) {
      query += ` AND table_source = $${paramIndex}`;
      params.push(tableSource);
      paramIndex++;
    }

    query += `
      GROUP BY operacao, campo_alterado
      ORDER BY total DESC
    `;

    const { rows } = await pool.query(query, params);
    
    console.log(`[Compras] Resumo do histórico: ${rows.length} tipos de operações`);
    res.json({ ok: true, resumo: rows });
  } catch (err) {
    console.error(`[Compras] Erro ao gerar resumo do histórico:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/compras/historico - Lista histórico com filtros opcionais (DEVE VIR ANTES DO :id)
app.get('/api/compras/historico', async (req, res) => {
  try {
    const { usuario, operacao, table_source, dias = 30, limit = 100 } = req.query;
    const diasInt = Number.parseInt(dias, 10) || 30;
    const limitInt = Number.parseInt(limit, 10) || 100;
    const tableSource = String(table_source || '').trim();
    
    let query = `
      SELECT 
        id,
        solicitacao_id,
        table_source,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento,
        created_at
      FROM compras.historico_solicitacao_compras
      WHERE created_at >= NOW() - ($1::INT * INTERVAL '1 day')
    `;
    
    const params = [diasInt];
    let paramIndex = 2;
    
    if (tableSource) {
      query += ` AND table_source = $${paramIndex}`;
      params.push(tableSource);
      paramIndex++;
    }
    
    if (usuario) {
      query += ` AND usuario = $${paramIndex}`;
      params.push(usuario);
      paramIndex++;
    }
    
    if (operacao) {
      query += ` AND operacao = $${paramIndex}`;
      params.push(operacao.toUpperCase());
      paramIndex++;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limitInt);
    
    const { rows } = await pool.query(query, params);
    
    console.log(`[Compras] Histórico geral: ${rows.length} registros (últimos ${dias} dias)`);
    res.json({ ok: true, historico: rows });
  } catch (err) {
    console.error(`[Compras] Erro ao buscar histórico geral:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/compras/historico/:solicitacaoId - Busca histórico de um item específico (DEVE VIR POR ÚLTIMO)
app.get('/api/compras/historico/:solicitacaoId', async (req, res) => {
  try {
    const { solicitacaoId } = req.params;
    const tableSource = String(req.query?.table_source || '').trim();
    
    if (!solicitacaoId || isNaN(solicitacaoId)) {
      return res.status(400).json({ ok: false, error: 'ID da solicitação inválido' });
    }

    let query = `
      SELECT 
        id,
        solicitacao_id,
        table_source,
        operacao,
        campo_alterado,
        valor_anterior,
        valor_novo,
        usuario,
        descricao_item,
        status_item,
        departamento,
        created_at
      FROM compras.historico_solicitacao_compras
      WHERE solicitacao_id = $1
    `;
    const params = [solicitacaoId];

    if (tableSource) {
      query += ` AND table_source = $2`;
      params.push(tableSource);
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await pool.query(query, params);
    
    console.log(`[Compras] Histórico da solicitação ${solicitacaoId}: ${rows.length} registros`);
    res.json({ ok: true, historico: rows });
  } catch (err) {
    console.error(`[Compras] Erro ao buscar histórico:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para buscar famílias de produtos
// Objetivo: Listar todas as famílias cadastradas no banco para seleção no modal de compras
app.get('/api/compras/familias', async (req, res) => {
  try {
    console.log('[API /api/compras/familias] Buscando famílias do banco...');
    
    const result = await pool.query(
      'SELECT codigo, nome_familia FROM public.familia ORDER BY nome_familia ASC'
    );
    
    console.log('[API /api/compras/familias] Total de famílias encontradas:', result.rows.length);
    
    res.json({ 
      ok: true, 
      total: result.rows.length,
      familias: result.rows
    });
  } catch (err) {
    console.error('[API /api/compras/familias] Erro:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para buscar parcelas de pagamento da Omie
// Objetivo: Listar todas as condições de pagamento disponíveis para pedidos de compra
app.get('/api/compras/parcelas', async (req, res) => {
  try {
    console.log('[API /api/compras/parcelas] Buscando parcelas da Omie...');
    
    const response = await fetch('https://app.omie.com.br/api/v1/geral/parcelas/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarParcelas',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina: 1,
          registros_por_pagina: 200
        }]
      })
    });
    
    const data = await response.json();
    
    if (data.faultstring) {
      throw new Error(data.faultstring);
    }
    
    console.log('[API /api/compras/parcelas] Total de parcelas retornadas:', data.total_de_registros);
    
    // Mapeia as parcelas retornadas
    const parcelas = (data.lista_parcelas || []).map(parc => ({
      codigo: parc.codigo,
      descricao: parc.descricao
    }));
    
    console.log('[API /api/compras/parcelas] Parcelas mapeadas:', parcelas.length);
    
    res.json({ 
      ok: true, 
      total: parcelas.length,
      parcelas 
    });
  } catch (err) {
    console.error('[API /api/compras/parcelas] Erro:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para buscar dados do pedido de compra
// Objetivo: Recuperar dados gerais do pedido (fornecedor, previsão, categoria, frete)
app.get('/api/compras/pedido/:numero_pedido', async (req, res) => {
  try {
    const { numero_pedido } = req.params;
    
    const { rows } = await pool.query(
      'SELECT * FROM compras.ped_compra WHERE numero_pedido = $1',
      [numero_pedido]
    );
    
    res.json({ ok: true, pedido: rows[0] || null });
  } catch (err) {
    console.error('[API /api/compras/pedido GET] Erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para salvar/atualizar dados do pedido de compra
// Objetivo: Salvar dados gerais do pedido (UPSERT por numero_pedido)
// Endpoint para salvar/atualizar dados do pedido de compra (tabela ped_compra)
// Objetivo: UPSERT dos dados do pedido (fornecedor, categoria, frete, etc)
app.post('/api/compras/pedido/dados', express.json(), async (req, res) => {
  try {
    const {
      numero_pedido,
      fornecedor_nome,
      fornecedor_id,
      previsao_entrega,
      categoria_compra,
      categoria_compra_codigo,
      valores_unitarios, // Agora recebe um objeto com {itemId: valor}
      cod_parcela,
      descricao_parcela,
      incluir_frete,
      transportadora_nome,
      transportadora_id,
      tipo_frete,
      placa_veiculo,
      uf_veiculo,
      qtd_volumes,
      especie_volumes,
      marca_volumes,
      numero_volumes,
      peso_liquido,
      peso_bruto,
      valor_frete,
      valor_seguro,
      lacre,
      outras_despesas
    } = req.body;
    
    if (!numero_pedido) {
      return res.status(400).json({ ok: false, error: 'numero_pedido é obrigatório' });
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // UPSERT dos dados gerais do pedido (sem valor_unitario na tabela ped_compra)
      const queryPedido = `
        INSERT INTO compras.ped_compra (
          numero_pedido, fornecedor_nome, fornecedor_id, previsao_entrega,
          categoria_compra, categoria_compra_codigo, cod_parcela, descricao_parcela,
          incluir_frete, transportadora_nome, transportadora_id, tipo_frete,
          placa_veiculo, uf_veiculo, qtd_volumes, especie_volumes, marca_volumes,
          numero_volumes, peso_liquido, peso_bruto, valor_frete, valor_seguro,
          lacre, outras_despesas, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, NOW()
        )
        ON CONFLICT (numero_pedido) DO UPDATE SET
          fornecedor_nome = EXCLUDED.fornecedor_nome,
          fornecedor_id = EXCLUDED.fornecedor_id,
          previsao_entrega = EXCLUDED.previsao_entrega,
          categoria_compra = EXCLUDED.categoria_compra,
          categoria_compra_codigo = EXCLUDED.categoria_compra_codigo,
          cod_parcela = EXCLUDED.cod_parcela,
          descricao_parcela = EXCLUDED.descricao_parcela,
          incluir_frete = EXCLUDED.incluir_frete,
          transportadora_nome = EXCLUDED.transportadora_nome,
          transportadora_id = EXCLUDED.transportadora_id,
          tipo_frete = EXCLUDED.tipo_frete,
          placa_veiculo = EXCLUDED.placa_veiculo,
          uf_veiculo = EXCLUDED.uf_veiculo,
          qtd_volumes = EXCLUDED.qtd_volumes,
          especie_volumes = EXCLUDED.especie_volumes,
          marca_volumes = EXCLUDED.marca_volumes,
          numero_volumes = EXCLUDED.numero_volumes,
          peso_liquido = EXCLUDED.peso_liquido,
          peso_bruto = EXCLUDED.peso_bruto,
          valor_frete = EXCLUDED.valor_frete,
          valor_seguro = EXCLUDED.valor_seguro,
          lacre = EXCLUDED.lacre,
          outras_despesas = EXCLUDED.outras_despesas,
          updated_at = NOW()
        RETURNING *
      `;
      
      const { rows } = await client.query(queryPedido, [
        numero_pedido, fornecedor_nome, fornecedor_id, previsao_entrega,
        categoria_compra, categoria_compra_codigo, cod_parcela, descricao_parcela,
        incluir_frete, transportadora_nome, transportadora_id, tipo_frete,
        placa_veiculo, uf_veiculo, qtd_volumes, especie_volumes, marca_volumes,
        numero_volumes, peso_liquido, peso_bruto, valor_frete, valor_seguro,
        lacre, outras_despesas
      ]);
      
      // Cria coluna valor_unitario se não existir (migration)
      try {
        await client.query('ALTER TABLE compras.solicitacao_compras ADD COLUMN IF NOT EXISTS valor_unitario DECIMAL(15,2)');
        console.log('[MIGRATION] Coluna valor_unitario verificada/criada em solicitacao_compras');
      } catch (err) {
        console.log('[MIGRATION] Erro ao criar coluna valor_unitario:', err.message);
      }
      
      // Atualiza valores unitários de cada item na tabela solicitacao_compras
      if (valores_unitarios && typeof valores_unitarios === 'object') {
        for (const [itemId, valor] of Object.entries(valores_unitarios)) {
          await client.query(`
            UPDATE compras.solicitacao_compras
            SET valor_unitario = $1, updated_at = NOW()
            WHERE id = $2
          `, [valor, itemId]);
          console.log(`[SALVAR DADOS] Atualizado valor unitário ${valor} para item ${itemId}`);
        }
      }
      
      await client.query('COMMIT');
      res.json({ ok: true, pedido: rows[0] });
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[API /api/compras/pedido/dados POST] Erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para gerar pedido de compra na Omie
// Objetivo: Montar o JSON completo do pedido e enviar para IncluirPedCompra da Omie
app.post('/api/compras/pedido/gerar-omie/:numero_pedido', express.json(), async (req, res) => {
  try {
    const { numero_pedido } = req.params;
    
    console.log('\n========================================');
    console.log('🚀 [GERAR PEDIDO OMIE] Iniciando...');
    console.log('📋 Número do Pedido:', numero_pedido);
    console.log('========================================\n');
    
    // Busca email do usuário logado para campo cEmailAprovador
    let emailAprovador = null;
    if (req.session && req.session.user && req.session.user.id) {
      console.log('👤 Buscando email do usuário logado...');
      const { rows: userRows } = await pool.query(
        'SELECT email FROM public.auth_user WHERE id = $1',
        [req.session.user.id]
      );
      if (userRows.length && userRows[0].email) {
        emailAprovador = userRows[0].email;
        console.log('   Email aprovador:', emailAprovador);
      } else {
        console.log('   ⚠️ Email não encontrado para o usuário logado');
      }
    }
    
    // Busca dados do pedido
    console.log('📥 Buscando dados do pedido na tabela compras.ped_compra...');
    const { rows: pedidoRows } = await pool.query(
      'SELECT * FROM compras.ped_compra WHERE numero_pedido = $1',
      [numero_pedido]
    );
    
    if (!pedidoRows.length) {
      console.log('❌ Pedido não encontrado no banco!');
      return res.status(404).json({ ok: false, error: 'Dados do pedido não encontrados. Salve os dados antes de gerar a compra.' });
    }
    
    const pedido = pedidoRows[0];
    console.log('✅ Dados do pedido encontrados:');
    console.log('   Fornecedor:', pedido.fornecedor_nome, '(ID:', pedido.fornecedor_id + ')');
    console.log('   Previsão Entrega:', pedido.previsao_entrega);
    console.log('   Categoria:', pedido.categoria_compra, '(Código:', pedido.categoria_compra_codigo + ')');
    console.log('   Condição de Pagamento:', pedido.descricao_parcela, '(Código:', pedido.cod_parcela + ')');
    console.log('   Incluir Frete:', pedido.incluir_frete);
    
    // Busca itens do pedido
    console.log('\n📦 Buscando itens do pedido...');
    const { rows: itens } = await pool.query(
      `SELECT *
      FROM compras.solicitacao_compras
      WHERE numero_pedido = $1`,
      [numero_pedido]
    );
    
    if (!itens.length) {
      console.log('❌ Nenhum item encontrado para este pedido!');
      return res.status(400).json({ ok: false, error: 'Nenhum item encontrado no pedido' });
    }
    
    console.log(`✅ ${itens.length} item(ns) encontrado(s):`);
    itens.forEach((item, idx) => {
      console.log(`   ${idx + 1}. Produto: ${item.produto_descricao} (Código: ${item.produto_codigo}) - Qtd: ${item.quantidade}`);
      console.log(`      Código Omie: ${item.codigo_produto_omie || 'Não encontrado'}`);
      console.log(`      Valor Unitário: ${item.valor_unitario || 'Não informado'}`);
    });
    
    // Monta o cabeçalho do pedido
    console.log('\n🔧 Montando JSON para envio à Omie...');
    const cabecalho = {
      cCodIntPed: numero_pedido,
      dDtPrevisao: pedido.previsao_entrega ? new Date(pedido.previsao_entrega).toISOString().split('T')[0].split('-').reverse().join('/') : null,
      nCodFor: pedido.fornecedor_id ? parseInt(pedido.fornecedor_id) : null,
      cCodCateg: pedido.categoria_compra_codigo || null,
      cCodParc: pedido.cod_parcela || null
    };
    
    // Adiciona email do aprovador se disponível
    if (emailAprovador) {
      cabecalho.cEmailAprovador = emailAprovador;
      console.log('   ✅ Email aprovador incluído:', emailAprovador);
    }
    
    // Monta os produtos (usa valor_unitario de cada item)
    const produtos = itens.map((item, index) => {
      const produto = {
        nQtde: item.quantidade || 0,
        nValUnit: item.valor_unitario || null,
        cObs: item.observacao || null
      };
      
      // Prioriza nCodProd (código Omie numérico), senão usa cProduto (código interno)
      if (item.codigo_produto_omie) {
        produto.nCodProd = item.codigo_produto_omie;
      } else if (item.produto_codigo) {
        produto.cProduto = item.produto_codigo;
        console.log(`   ⚠️ Item ${index + 1}: Usando cProduto (${item.produto_codigo}) pois nCodProd não disponível`);
      } else {
        console.log(`   ❌ Item ${index + 1}: Sem código Omie nem código interno!`);
      }
      
      return produto;
    });
    
    // Monta o frete se incluído
    let frete = null;
    if (pedido.incluir_frete) {
      console.log('🚚 Adicionando dados de frete...');
      frete = {
        nCodTransp: pedido.transportadora_id ? parseInt(pedido.transportadora_id) : null,
        cTpFrete: pedido.tipo_frete || null,
        cPlaca: pedido.placa_veiculo || null,
        cUF: pedido.uf_veiculo || null,
        nQtdVol: pedido.qtd_volumes || null,
        cEspVol: pedido.especie_volumes || null,
        cMarVol: pedido.marca_volumes || null,
        cNumVol: pedido.numero_volumes || null,
        nPesoLiq: pedido.peso_liquido || null,
        nPesoBruto: pedido.peso_bruto || null,
        nValFrete: pedido.valor_frete || null,
        nValSeguro: pedido.valor_seguro || null,
        cLacre: pedido.lacre || null,
        nValOutras: pedido.outras_despesas || null
      };
      console.log('   Transportadora ID:', pedido.transportadora_id);
      console.log('   Tipo Frete:', pedido.tipo_frete);
    }
    
    // Monta o JSON completo para a Omie
    const pedidoCompra = {
      cabecalho_incluir: cabecalho,
      produtos_incluir: produtos
    };
    
    if (frete) {
      pedidoCompra.frete_incluir = frete;
    }
    
    console.log('\n📤 JSON COMPLETO PARA ENVIO À OMIE:');
    console.log(JSON.stringify(pedidoCompra, null, 2));
    
    const omiePayload = {
      call: 'IncluirPedCompra',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [pedidoCompra]
    };
    
    // Chama a API da Omie
    console.log('\n🌐 Enviando requisição para Omie...');
    console.log('   URL: https://app.omie.com.br/api/v1/produtos/pedidocompra/');
    
    let tentativa = 1;
    let maxTentativas = 2; // Primeira tentativa + 1 retry após cadastrar produto
    let data;
    
    while (tentativa <= maxTentativas) {
      console.log(`\n🔄 Tentativa ${tentativa} de ${maxTentativas}...`);
      
      const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(omiePayload)
      });
      
      data = await response.json();
      
      console.log('\n📥 RESPOSTA DA OMIE:');
      console.log('   Status HTTP:', response.status);
      console.log('   Dados:', JSON.stringify(data, null, 2));
      
      if (data.faultstring) {
        console.log('❌ Erro na API da Omie!');
        console.log('   Código:', data.faultcode);
        console.log('   Mensagem:', data.faultstring);
        
        // Verifica se é erro de produto não cadastrado (aceita qualquer encoding)
        const erroMatch = data.faultstring.match(/Produto n.{1,3}o cadastrado para o C.{1,3}digo \[(.*?)\]/i);
        
        if (erroMatch && tentativa < maxTentativas) {
          const codigoNaoCadastrado = erroMatch[1];
          console.log(`\n⚠️ Produto não cadastrado detectado: ${codigoNaoCadastrado}`);
          
          // Busca a descrição do produto nos itens
          const itemNaoCadastrado = itens.find(item => item.produto_codigo === codigoNaoCadastrado);
          const descricaoProduto = itemNaoCadastrado ? itemNaoCadastrado.produto_descricao : 'Produto provisório';
          
          console.log(`\n🔧 Tentando cadastrar produto automaticamente...`);
          const resultadoCadastro = await cadastrarProdutoNaOmie(codigoNaoCadastrado, descricaoProduto);
          
          if (resultadoCadastro.ok) {
            console.log(`\n⏳ Aguardando 5 segundos antes de tentar novamente...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Atualiza o nCodProd no JSON se foi obtido
            if (resultadoCadastro.codigo_produto) {
              const produtoIndex = produtos.findIndex(p => p.cProduto === codigoNaoCadastrado);
              if (produtoIndex !== -1) {
                produtos[produtoIndex].nCodProd = resultadoCadastro.codigo_produto;
                delete produtos[produtoIndex].cProduto;
                console.log(`✅ Item atualizado com nCodProd: ${resultadoCadastro.codigo_produto}`);
                
                // Recria o payload atualizado
                const pedidoCompraAtualizado = {
                  cabecalho_incluir: cabecalho,
                  produtos_incluir: produtos
                };
                if (frete) {
                  pedidoCompraAtualizado.frete_incluir = frete;
                }
                omiePayload.param = [pedidoCompraAtualizado];
              }
            }
            
            tentativa++;
            continue; // Tenta novamente
          } else {
            console.error(`❌ Falha ao cadastrar produto: ${resultadoCadastro.error}`);
            throw new Error(`Erro ao cadastrar produto ${codigoNaoCadastrado}: ${resultadoCadastro.error}`);
          }
        } else {
          // Erro diferente ou já tentou cadastrar
          throw new Error(data.faultstring);
        }
      } else {
        // Sucesso!
        break;
      }
    }
    
    console.log('✅ Pedido criado com sucesso na Omie!');
    console.log('   Número Pedido:', data.cNumero);
    console.log('   Código Pedido:', data.nCodPed || data.cCodIntPed);
    
    // Atualiza status dos itens para "compra realizada" e salva dados do pedido Omie
    console.log('\n🔄 Atualizando status e dados do pedido Omie nos itens...');
    await pool.query(
      `UPDATE compras.solicitacao_compras 
       SET status = $1, nCodPed = $2, cNumero = $3 
       WHERE numero_pedido = $4`,
      ['compra realizada', data.nCodPed, data.cNumero, numero_pedido]
    );
    console.log(`✅ ${itens.length} item(ns) atualizado(s):`);
    console.log(`   - Status: 'compra realizada'`);
    console.log(`   - nCodPed: ${data.nCodPed}`);
    console.log(`   - cNumero: ${data.cNumero}`);
    
    console.log('\n========================================');
    console.log('✅ PROCESSO CONCLUÍDO COM SUCESSO!');
    console.log('========================================\n');
    
    res.json({
      ok: true,
      numero: data.cNumero,
      codigo: data.nCodPed || data.cCodIntPed,
      mensagem: 'Pedido de compra gerado com sucesso na Omie'
    });
    
  } catch (err) {
    console.error('\n========================================');
    console.error('❌ ERRO NO PROCESSO:');
    console.error('   Mensagem:', err.message);
    console.error('   Stack:', err.stack);
    console.error('========================================\n');
    res.status(500).json({ ok: false, error: err.message });
  }
});


// --- Buscar produtos no Postgres (autocomplete do PCP) ---
app.get('/api/produtos/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit ?? '40', 10) || 40, 100);

    if (q.length < 2) {
      return res.status(400).json({ ok: false, error: 'Informe ?q= com pelo menos 2 caracteres' });
    }

    // Busca por código OU pela descrição (case/accent-insensitive)
    // Busca na tabela produtos_omie (coluna codigo, descricao, descricao_familia e codigo_produto)
    const { rows } = await pool.query(
      `
      SELECT 
        codigo,
        descricao,
        descricao_familia,
        codigo_produto
      FROM public.produtos_omie
      WHERE 
        codigo ILIKE $1
        OR unaccent(descricao) ILIKE unaccent($2)
      ORDER BY
        (CASE WHEN codigo ILIKE $3 THEN 0 ELSE 1 END),
        codigo
      LIMIT $4
      `,
      [`%${q}%`, `%${q}%`, `${q}%`, limit]
    );

    res.json({ ok: true, total: rows.length, produtos: rows });
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
  const ETAPA_TO_STATUS = { '10':'A Produzir', '20':'Produzindo', '30':'teste 1', '40':'teste final', '60':'Produzido' };
  const status = ETAPA_TO_STATUS[etapa] || 'A Produzir';
  try { await dbQuery('select public.mover_op($1,$2)', [op, status]); } catch (e) { console.warn('[mover_op] falhou:', e.message); }

  // 3) Dispara SSE
  req.app.get('notifyProducts')?.();

  return res.json({ ok:true, stage: etapa, mode:'pg', omie: j });
}

app.post('/api/preparacao/op/:op/etapa/:etapa', (req, res) =>
  alterarEtapaImpl(req, res, String(req.params.etapa)));

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDDMMYYYY = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const normValue = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
};
const maskOmieSecret = (value) => {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
};

async function abrirOrdemProducaoNaOmie({
  op,
  body = {},
  poolInstance,
  out,
  appKey,
  appSecret,
  estoquePadrao = PRODUCAO_LOCAL_PADRAO,
  hints = {}
}) {
  if (!out) return;
  out.errors = Array.isArray(out.errors) ? out.errors : [];

  const produtoDebug = {
    ...(out.produtoCodigo || {}),
    request_alpha: out.produtoCodigo?.request_alpha ?? null,
    request_num: out.produtoCodigo?.request_num ?? null,
    op_info_alpha: out.produtoCodigo?.op_info_alpha ?? null,
    op_info_num: out.produtoCodigo?.op_info_num ?? null,
    view_before_alpha: out.produtoCodigo?.view_before_alpha ?? null,
    view_after_alpha: out.produtoCodigo?.view_after_alpha ?? null,
    produtos_omie_num: out.produtoCodigo?.produtos_omie_num ?? null,
    final_alpha: out.produtoCodigo?.final_alpha ?? null,
    final_num: out.produtoCodigo?.final_num ?? null
  };

  const hintBeforeAlpha = normValue(hints.viewBeforeAlpha);
  if (hintBeforeAlpha) produtoDebug.view_before_alpha = hintBeforeAlpha;
  const hintAfterAlpha = normValue(hints.viewAfterAlpha);
  if (hintAfterAlpha) produtoDebug.view_after_alpha = hintAfterAlpha;

  const requestAlpha = normValue(body.produto_codigo) || normValue(body.codigo);
  if (requestAlpha) produtoDebug.request_alpha = requestAlpha;
  const requestNum = normValue(body.produto_codigo_num) ||
    normValue(body.nCodProd) ||
    normValue(body.nCodProduto);
  if (requestNum) produtoDebug.request_num = requestNum;

  let produtoCodigoAlpha =
    requestAlpha ||
    normValue(hints.fallbackAlpha) ||
    produtoDebug.view_before_alpha ||
    produtoDebug.view_after_alpha ||
    '';

  let produtoCodigoNum =
    requestNum ||
    normValue(hints.fallbackNum) ||
    '';

  let fetchedOpInfo = false;

  async function ensureProdutoInfoFromOp() {
    if (fetchedOpInfo) return;
    fetchedOpInfo = true;
    try {
      const { rows } = await poolInstance.query(
        `SELECT produto_codigo, c_cod_int_prod, n_cod_prod
           FROM public.op_info
          WHERE c_cod_int_op = $1
             OR c_num_op = $1
             OR n_cod_op::text = $1
          ORDER BY updated_at DESC
          LIMIT 1`,
        [op]
      );
      const row = rows?.[0];
      if (row) {
        const alpha = normValue(row.produto_codigo) || normValue(row.c_cod_int_prod);
        const num = normValue(row.n_cod_prod);
        if (!produtoCodigoAlpha && alpha) produtoCodigoAlpha = alpha;
        if (!produtoCodigoNum && num) produtoCodigoNum = num;
        produtoDebug.op_info_alpha = alpha || null;
        produtoDebug.op_info_num = num ? Number(num) || null : null;
      }
    } catch (err) {
      out.errors.push('[op_info lookup] ' + (err?.message || err));
    }
  }

  const digitsRegex = /^\d+$/;

  async function resolveNCodProduto() {
    if (produtoCodigoNum && digitsRegex.test(produtoCodigoNum)) {
      return Number(produtoCodigoNum);
    }
    await ensureProdutoInfoFromOp();
    if (produtoCodigoNum && digitsRegex.test(produtoCodigoNum)) {
      return Number(produtoCodigoNum);
    }

    const alpha = normValue(produtoCodigoAlpha);
    if (!alpha) return null;
    try {
      const { rows } = await poolInstance.query(
        `SELECT codigo_produto
           FROM public.produtos_omie
          WHERE TRIM(UPPER(codigo)) = TRIM(UPPER($1))
             OR TRIM(UPPER(codigo_produto_integracao::text)) = TRIM(UPPER($1))
          ORDER BY codigo_produto ASC
          LIMIT 1`,
        [alpha]
      );
      const row = rows?.[0];
      if (row && row.codigo_produto) {
        const num = Number(row.codigo_produto);
        if (!Number.isNaN(num) && num > 0) {
          produtoCodigoNum = String(num);
          produtoDebug.produtos_omie_num = num;
          return num;
        }
      }
    } catch (err) {
      out.errors.push('[produtos_omie lookup] ' + (err?.message || err));
    }
    return null;
  }

  const nCodProduto = await resolveNCodProduto();
  produtoDebug.final_alpha = produtoCodigoAlpha || null;
  produtoDebug.final_num = produtoCodigoNum || null;
  out.produtoCodigo = produtoDebug;

  if (!appKey || !appSecret) {
    out.omie_incluir = { skipped: true, reason: 'Credenciais OMIE ausentes (OMIE_APP_KEY/SECRET).' };
    return;
  }

  if (!nCodProduto) {
    out.omie_incluir = {
      ok: false,
      skipped: true,
      reason: 'Não foi possível determinar nCodProduto para abrir OP na OMIE.',
      produto_codigo: produtoCodigoAlpha || null
    };
    console.warn('[prep][omie_incluir] não abriu OP — nCodProduto indisponível', {
      op,
      produto_codigo: produtoCodigoAlpha || null
    });
    return;
  }

  const identificacao = {
    cCodIntOP: op,
    dDtPrevisao: fmtDDMMYYYY(new Date()),
    nCodProduto,
    nQtde: 1
  };

  if (estoquePadrao && /^\d+$/.test(String(estoquePadrao))) {
    identificacao.codigo_local_estoque = Number(estoquePadrao);
  }

  const payload = {
    call: 'IncluirOrdemProducao',
    app_key: appKey,
    app_secret: appSecret,
    param: [{ identificacao }]
  };

  console.log('[prep][omie_incluir] → preparando chamada IncluirOrdemProducao', {
    op,
    identificacao,
    app_key: maskOmieSecret(appKey),
    app_secret: maskOmieSecret(appSecret)
  });

  try {
    const resp = await omieCall('https://app.omie.com.br/api/v1/produtos/op/', payload);
    const fault = resp?.faultstring || resp?.faultcode || resp?.error;
    if (fault) {
      out.omie_incluir = { ok: false, body: resp, identificacao };
      console.warn('[prep][omie_incluir] ← retorno OMIE com fault', { op, fault: resp });
    } else {
      out.omie_incluir = { ok: true, body: resp, identificacao };
      console.log('[prep][omie_incluir] ← retorno OMIE sucesso', { op, body: resp });
    }
  } catch (err) {
    out.omie_incluir = { ok: false, error: String(err?.message || err), identificacao };
    console.error('[prep][omie_incluir] ← erro ao chamar OMIE', { op, error: err?.message || err });
  }

  return out.omie_incluir;
}

// === Preparação: INICIAR produção (mover_op + overlay "Produzindo") =========
app.post('/api/preparacao/op/:op/iniciar', async (req, res) => {
  const op = String(req.params.op || '').trim().toUpperCase();
  if (!op) return res.status(400).json({ ok:false, error:'OP inválida' });

  const body = req.body || {};

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

    const APP_KEY = process.env.OMIE_APP_KEY || process.env.APP_KEY || process.env.OMIE_KEY;
    const APP_SEC = process.env.OMIE_APP_SECRET || process.env.APP_SECRET || process.env.OMIE_SECRET;

    const omieInclude = await abrirOrdemProducaoNaOmie({
      op,
      body,
      poolInstance: pool,
      out,
      appKey: APP_KEY,
      appSecret: APP_SEC,
      hints: {
        viewBeforeAlpha: out.before?.[0]?.produto_codigo
      }
    });

    if (!omieInclude || omieInclude.skipped || omieInclude.ok !== true) {
      const errMsg = omieInclude?.reason || omieInclude?.error || omieInclude?.body?.faultstring || 'Falha ao abrir OP na OMIE.';
      out.errors.push('[omie_incluir] ' + errMsg);
      return res.status(409).json({
        ok: false,
        error: errMsg,
        omie: omieInclude || null,
        produtoCodigo: out.produtoCodigo
      });
    }

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
  const STATUS_UI      = 'Produzido';
  const TRY_TARGETS    = ['Produzido', 'concluido', 'Concluído', '60', '80'];

  // datas
  const parseData = (s) => {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d,m,y]=s.split('/').map(Number); return new Date(y,m-1,d); }
    return null;
  };

  const body = req.body || {};
  const norm = (value) => {
    if (typeof value === 'string') return value.trim();
    if (value === undefined || value === null) return '';
    return String(value).trim();
  };

  let produtoCodigoAlpha = norm(body.produto_codigo);
  if (!produtoCodigoAlpha) produtoCodigoAlpha = norm(body.codigo);

  let produtoCodigoNum = norm(body.produto_codigo_num);
  if (!produtoCodigoNum) produtoCodigoNum = norm(body.nCodProd);
  if (!produtoCodigoNum) produtoCodigoNum = norm(body.nCodProduto);

  const qtd = Math.max(1, Number(body.quantidade ?? body.nQtdeProduzida ?? 1));
  const dt  = parseData(body.data || body.dDtConclusao) || new Date();
  const dDtConclusao = fmtDDMMYYYY(dt);

  const out = {
    ok:false,
    op,
    omie:{},
    attempts:[],
    overlay:null,
    before:null,
    after:null,
    errors:[],
    produtoCodigo:{
      request_alpha: produtoCodigoAlpha || null,
      request_num: produtoCodigoNum || null,
      op_info_alpha: null,
      op_info_num: null,
      view_before_alpha: null,
      view_after_alpha: null,
      final_alpha: null,
      final_num: null
    }
  };

  let fetchedOpInfo = false;

  async function ensureProdutoInfoFromOp() {
    if (fetchedOpInfo) return;
    fetchedOpInfo = true;
    try {
      const { rows } = await pool.query(
        `SELECT produto_codigo, c_cod_int_prod, n_cod_prod
           FROM public.op_info
          WHERE c_cod_int_op = $1
             OR c_num_op = $1
             OR n_cod_op::text = $1
          ORDER BY updated_at DESC
          LIMIT 1`,
        [op]
      );
      const row = rows?.[0];
      if (row) {
        const alphaFromOp = norm(row.produto_codigo) || norm(row.c_cod_int_prod);
        const numFromOp = norm(row.n_cod_prod);
        if (!produtoCodigoAlpha && alphaFromOp) produtoCodigoAlpha = alphaFromOp;
        if (!produtoCodigoNum && numFromOp) produtoCodigoNum = numFromOp;
        out.produtoCodigo.op_info_alpha = alphaFromOp || null;
        out.produtoCodigo.op_info_num = numFromOp ? Number(numFromOp) || null : null;
      }
    } catch (err) {
      out.errors.push('[op_info lookup] ' + (err?.message || err));
    }
  }

  try {
    // estado ANTES
    try {
      const b = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view WHERE op = $1 LIMIT 1`, [op]);
      out.before = b.rows;
      const hintAlpha = norm(b.rows?.[0]?.produto_codigo);
      if (!produtoCodigoAlpha && hintAlpha) produtoCodigoAlpha = hintAlpha;
      out.produtoCodigo.view_before_alpha = hintAlpha || null;
    } catch (e) { out.errors.push('[before] '+(e?.message||e)); }

    await ensureProdutoInfoFromOp();

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

      const payloadLog = {
        ...payload,
        app_key: maskOmieSecret(APP_KEY),
        app_secret: maskOmieSecret(APP_SEC)
      };
      console.log('[prep][omie_concluir] → preparando chamada ConcluirOrdemProducao', {
        op,
        payload: payloadLog
      });

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
          console.warn('[prep][omie_concluir] ← retorno OMIE com fault', {
            op,
            status: resp.status,
            body: j || text
          });
          // não aborta; seguimos para mover localmente e aplicar overlay
        } else {
          out.omie = { ok:true, body:j||text };
          console.log('[prep][omie_concluir] ← retorno OMIE sucesso', {
            op,
            status: resp.status,
            body: j || text
          });
        }
      } catch (e) {
        out.omie = { ok:false, error:String(e?.message||e) };
        console.error('[prep][omie_concluir] ← erro ao chamar OMIE', {
          op,
          error: e?.message || e
        });
      }
    } else {
      out.omie = { skipped:true, reason:'Credenciais OMIE ausentes (OMIE_APP_KEY/SECRET).' };
    }

    if (!out.omie || out.omie.skipped || out.omie.ok !== true) {
      const errMsg = out.omie?.reason || out.omie?.error || out.omie?.body?.faultstring || 'Falha ao concluir OP na OMIE.';
      out.errors.push('[omie_concluir] ' + errMsg);
      return res.status(409).json({
        ok: false,
        error: errMsg,
        omie: out.omie || null,
        produtoCodigo: out.produtoCodigo
      });
    }

    // 2) Mover na base "oficial"
    let changed = false;
    let beforeStatus = out.before?.[0]?.status || null;

    for (const tgt of TRY_TARGETS) {
      try {
        await pool.query('SELECT mover_op($1,$2)', [op, tgt]);
        out.attempts.push({ via: 'mover_op', target: tgt, ok: true });

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

    // 3) Overlay garante UI imediata
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
      out.errors.push('[overlay] ' + (e?.message||e));
    }

    // estado DEPOIS
    try {
      const a = await pool.query(
        `SELECT op, c_cod_int_prod AS produto_codigo, kanban_coluna AS status
           FROM public.kanban_preparacao_view WHERE op = $1 LIMIT 1`, [op]);
      out.after = a.rows;
      const alphaAfter = norm(a.rows?.[0]?.produto_codigo);
      if (!produtoCodigoAlpha && alphaAfter) produtoCodigoAlpha = alphaAfter;
      out.produtoCodigo.view_after_alpha = alphaAfter || out.produtoCodigo.view_after_alpha || null;
    } catch (e) { out.errors.push('[after] '+(e?.message||e)); }

    out.produtoCodigo.final_alpha = produtoCodigoAlpha || null;
    out.produtoCodigo.final_num = produtoCodigoNum || null;

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
const produtosAnexosRouter = require('./routes/produtosAnexos');
const transferenciasRouter = require('./routes/transferencias');

//app.use(require('express').json({ limit: '5mb' }));

app.use('/api/produtos', produtosRouter);

// adiciona o router das fotos no MESMO prefixo:
app.use('/api/produtos', produtosFotosRouter);
app.use('/api/produtos', produtosAnexosRouter);
app.use('/api/transferencias', transferenciasRouter);
app.use('/api/engenharia', engenhariaRouter);
app.use('/api/compras', comprasRouter);

// Router de agendamento de sincronização
const agendamentoRouter = require('./routes/agendamento')(pool);
app.use('/api/sincronizacao/agendamento', agendamentoRouter);

// [API][produto/descricao] — retorna descr_produto a partir de int_produto (id) OU cod_produto (code)
app.get('/api/produto/descricao', async (req, res) => {
  try {
    const rawId = req.query?.id;
    const codeRaw = (req.query?.code || req.query?.codigo || '').toString().trim();
    const id = Number(rawId);

    console.log('[API][produto/descricao] ▶ params:', { rawId, id, codeRaw });

    let descr = null;
    let used  = null;

    // 1) Tenta por ID (int_produto ou id_produto)
    if (Number.isFinite(id) && id > 0) {
      const sqlId = `
        SELECT descr_produto
          FROM public.omie_estrutura
         WHERE CAST(int_produto AS BIGINT) = $1
            OR CAST(id_produto  AS BIGINT) = $1
         LIMIT 1
      `;
      const r1 = await pool.query(sqlId, [id]);
      console.log('[API][produto/descricao] ◀ by_id rowCount:', r1.rowCount, r1.rows[0] || null);
      if (r1.rowCount > 0) {
        descr = r1.rows[0].descr_produto || null;
        used  = 'by_id';
      }
    }

    // 2) Se não achou por ID e veio código, tenta por cod_produto
    if (!descr && codeRaw) {
      // 2.a) match exato
      const r2 = await pool.query(
        `SELECT descr_produto FROM public.omie_estrutura WHERE cod_produto = $1 LIMIT 1`,
        [codeRaw]
      );
      console.log('[API][produto/descricao] ◀ by_code_exact rowCount:', r2.rowCount, r2.rows[0] || null);
      if (r2.rowCount > 0) {
        descr = r2.rows[0].descr_produto || null;
        used  = 'by_code_exact';
      }
    }

    if (!descr && codeRaw) {
      // 2.b) TRIM + UPPER
      const r3 = await pool.query(
        `SELECT descr_produto
           FROM public.omie_estrutura
          WHERE UPPER(TRIM(cod_produto)) = UPPER(TRIM($1))
          LIMIT 1`,
        [codeRaw]
      );
      console.log('[API][produto/descricao] ◀ by_code_trim_upper rowCount:', r3.rowCount, r3.rows[0] || null);
      if (r3.rowCount > 0) {
        descr = r3.rows[0].descr_produto || null;
        used  = 'by_code_trim_upper';
      }
    }

    if (!descr && codeRaw) {
      // 2.c) prefixo (quando o back manda código truncado ou com sufixos)
      const r4 = await pool.query(
        `SELECT descr_produto
           FROM public.omie_estrutura
          WHERE cod_produto ILIKE $1
          ORDER BY LENGTH(cod_produto) ASC
          LIMIT 1`,
        [codeRaw + '%']
      );
      console.log('[API][produto/descricao] ◀ by_code_prefix rowCount:', r4.rowCount, r4.rows[0] || null);
      if (r4.rowCount > 0) {
        descr = r4.rows[0].descr_produto || null;
        used  = 'by_code_prefix';
      }
    }

    return res.json({
      ok: true,
      descr_produto: descr,
      used,
      id: (Number.isFinite(id) && id > 0) ? id : null,
      code: codeRaw || null
    });
  } catch (e) {
    console.error('[API][produto/descricao] ❌', e);
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});


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

// Servir anexos de compras
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Upload de arquivos para Supabase Storage (compras e outros anexos)
app.post('/api/upload/supabase', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    
    const { createClient } = require('@supabase/supabase-js');
    // Usa as credenciais corretas do .env (service_role para upload no backend)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[Supabase Upload] Credenciais não configuradas no .env');
      return res.status(500).json({ error: 'Supabase não configurado' });
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const bucketName = 'compras-anexos';
    const filePath = req.body.path || `uploads/${Date.now()}_${req.file.originalname}`;
    
    // Verifica se o bucket existe, se não existir, cria
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === bucketName);
      
      if (!bucketExists) {
        console.log(`[Supabase] Criando bucket '${bucketName}'...`);
        const { error: createError } = await supabase.storage.createBucket(bucketName, {
          public: true,
          fileSizeLimit: 10485760, // 10MB
          allowedMimeTypes: ['image/*', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
        });
        
        if (createError) {
          console.error('[Supabase] Erro ao criar bucket:', createError);
          // Continua tentando fazer upload mesmo se falhar ao criar
        } else {
          console.log(`[Supabase] Bucket '${bucketName}' criado com sucesso`);
        }
      }
    } catch (bucketError) {
      console.warn('[Supabase] Erro ao verificar/criar bucket:', bucketError.message);
      // Continua com o upload de qualquer forma
    }
    
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
    
    if (error) {
      console.error('[Supabase Upload Error]', error);
      return res.status(500).json({ error: error.message });
    }
    
    // Gera URL pública
    const { data: publicData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);
    
    res.json({ 
      ok: true, 
      path: filePath,
      url: publicData.publicUrl
    });
  } catch (err) {
    console.error('[upload/supabase]', err);
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
    if (['produzido'].includes(x))                                             return 'Produzido';
    if (['concluido','concluido.','concluido ','60','80','concluído'].includes(x)) return 'concluido';
    return null;
  };

  let target = norm(req.body?.status);
  if (!target) return res.status(422).json({ ok:false, error:'status inválido', got:req.body?.status });
  if (target === 'concluido') target = 'Produzido'; // compat: antigas chamadas

  const TRY_TARGETS = {
    'A Produzir': ['A Produzir','Fila de produção','Fila de producao','20'],
    'Produzindo': ['Produzindo','Em produção','Em producao','30'],
    'Produzido' : ['Produzido','concluido','Concluído','Concluido','60','80'],
    'concluido' : ['concluido','Concluído','Concluido','60','80'] // fallback legado
  }[target];
  if (!TRY_TARGETS) return res.status(422).json({ ok:false, error:'status inválido', got:req.body?.status });

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
    const wasProduzido = beforeStatus === 'Produzido' || beforeStatus === 'concluido';
    const goingToProduzido = target === 'Produzido';

    // Credenciais Omie (se existirem)
    const APP_KEY = process.env.OMIE_APP_KEY || process.env.APP_KEY || process.env.OMIE_KEY;
    const APP_SEC = process.env.OMIE_APP_SECRET || process.env.APP_SECRET || process.env.OMIE_SECRET;

    // 1A) Se arrastou PARA concluído → ConcluirOrdemProducao (qtd=1, hoje)
    if (goingToProduzido && APP_KEY && APP_SEC) {
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
    } else if (goingToProduzido) {
      out.omie_concluir = { skipped:true, reason:'Credenciais OMIE ausentes (OMIE_APP_KEY/SECRET).' };
    }

    // 1B) Se estava concluído E foi arrastado para outra coluna → ReverterOrdemProducao
    if (wasProduzido && !goingToProduzido) {
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

    const codigoProdutoId = await obterCodigoProdutoId(pool, codigo_produto);

    const sql = `
      INSERT INTO "OrdemProducao".tab_op
        (numero_op, codigo_produto, codigo_produto_id, tipo_etiqueta, local_impressao, conteudo_zpl, usuario_criacao, observacoes)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, data_criacao
    `;
    const params = [
      String(numero_op),
      String(codigo_produto),
      codigoProdutoId,
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

async function gerarEtiquetaCompactaZPL({
  numeroOP,
  codigo,
  ns,
  produtoDet
}) {
  if (!numeroOP) throw new Error('numeroOP obrigatório');

  let produtoDetalhado = produtoDet;
  if (!produtoDetalhado && codigo) {
    try {
      produtoDetalhado = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'ConsultarProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [{ codigo }]
        }
      );
    } catch (err) {
      console.warn('[etiquetas] falha ao consultar produto Omie:', err?.message || err);
      produtoDetalhado = {};
    }
  }

  const cad = produtoDetalhado?.produto_servico_cadastro?.[0] || produtoDetalhado || {};

  const encodeTilde = (s) => (s || '').replace(/~/g, '_7E');
  const z = (v) => v || '';

  const hoje = new Date();
  const hojeFormatado = `${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;

  const modeloParaEtiqueta = (cad.codigo || '')
    .replace(/^([A-Za-z]+)(\d)/, '$1-$2');

  const d = {};
  (cad.caracteristicas || []).forEach((c) => {
    if (!c) return;
    d[c.cCodIntCaract] = encodeTilde(c.cConteudo);
  });

  d.modelo          = cad.modelo      || '';
  d.ncm             = cad.ncm         || '';
  d.pesoLiquido     = cad.peso_liq    || '';
  d.dimensaoProduto = `${cad.largura || ''}x${cad.profundidade || ''}x${cad.altura || ''}`;

  const linhas = separarLinhas(cad);

  const startY_E = 540;
  const startY_D = 540;
  const CHAR_W   = 11;
  const STEP_ITEM   = 40;
  const STEP_SUFIXO = 30;
  const STEP_WRAP   = 20;

  const montarColuna = (col, startY, xLabel, xValue) => {
    const blocos = [];
    let y = startY;

    const xParenByBase = {};
    let baseAnterior = '';

    for (const row of col) {
      if (!row) continue;
      const cod   = (row.Caracteristica || '').trim();
      const valor = z(d[cod]);

      const full = (row.Label || '').trim();
      const m    = full.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
      const base   = m ? m[1].trim() : full;
      const sufixo = m ? `(${m[2]})`  : '';

      const sufixoOnly = base === baseAnterior && sufixo;

      let labelPrint;
      let xLabelNow = xLabel;
      if (sufixoOnly) {
        labelPrint = sufixo;
        xLabelNow  = xParenByBase[base] ?? xLabel;
      } else {
        labelPrint   = full;
        baseAnterior = base;
        const p = full.indexOf('(');
        if (p >= 0) xParenByBase[base] = xLabel + p * CHAR_W;
      }

      const LIM = 25;
      const partes = [];
      let txt = labelPrint;
      while (txt.length > LIM) {
        const pos = txt.lastIndexOf(' ', LIM);
        if (pos > 0) { partes.push(txt.slice(0, pos)); txt = txt.slice(pos + 1); }
        else break;
      }
      partes.push(txt);

      partes.forEach((ln, idx) => {
        const stepIntra = idx === 0 ? 0 : STEP_WRAP;
        blocos.push(
          '^A0R,25,25',
          `^FO${y - stepIntra},${xLabelNow}^FD${ln}^FS`
        );
        y -= stepIntra;
      });

      blocos.push(
        '^A0R,20,20',
        `^FO${y},${xValue}^FB200,1,0,R^FH_^FD${valor}^FS`
      );

      y -= sufixoOnly ? STEP_SUFIXO : STEP_ITEM;
    }

    return blocos.join('\n');
  };

  const blocoE = montarColuna(linhas.E, startY_E,  25, 240);
  const blocoD = montarColuna(linhas.D, startY_D, 470, 688);

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
^A0R,25,25
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
`.trim();

  return zpl;
}

async function gerarProximoNumeroOP(client, prefix = 'OP') {
  const prefixUp = String(prefix || 'OP').toUpperCase();
  const ano = String(new Date().getFullYear()).slice(-2);
  const likePattern = `${prefixUp}${ano}%`;

  const { rows } = await client.query(
    `
  SELECT numero_op
  FROM "OrdemProducao".tab_op
      WHERE numero_op LIKE $1
      ORDER BY numero_op DESC
      LIMIT 1
    `,
    [likePattern]
  );

  let seqAtual = 0;
  if (rows?.[0]?.numero_op) {
    const regex = new RegExp(`^${prefixUp}${ano}(\\d{5})(?:-.*)?$`, 'i');
    const match = String(rows[0].numero_op).match(regex);
    if (match) seqAtual = Number(match[1]) || 0;
  }

  const proximo = seqAtual + 1;
  const seqStr = String(proximo).padStart(5, '0');
  return {
    numero_op: `${prefixUp}${ano}${seqStr}`,
    ano,
    sequencia: proximo
  };
}

async function registrarAnexosOp(client, numeroOp, codigoProdutoId) {
  if (!numeroOp || !codigoProdutoId) return;
  await client.query(
    `INSERT INTO "OrdemProducao".tab_op_anexos (numero_op, id_anexo)
       SELECT $1, id
         FROM public.produtos_omie_anexos
        WHERE codigo_produto = $2
          AND ativo IS TRUE`,
    [numeroOp, codigoProdutoId]
  );
}

// Registra imagens da OP a partir das imagens ativas do produto
async function registrarImagensOp(client, numeroOp, codigoProdutoId) {
  if (!numeroOp || !codigoProdutoId) return;
  await client.query(
    `INSERT INTO "OrdemProducao".tab_op_imagens (numero_op, id_imagem, visivel_producao, visivel_assistencia_tecnica)
       SELECT $1, id, visivel_producao, visivel_assistencia_tecnica
         FROM public.produtos_omie_imagens
        WHERE codigo_produto = $2
          AND ativo IS TRUE
          AND COALESCE(visivel_assistencia_tecnica, true) = true`,
    [numeroOp, codigoProdutoId]
  );
}

function gerarEtiquetaPPZPL({ codMP, op, descricao = '' }) {
  const DPI = 203;
  const DOTS_PER_MM = DPI / 25.4;
  const LABEL_W_MM = 50;
  const LABEL_H_MM = 30;

  const PW = Math.round(LABEL_W_MM * DOTS_PER_MM);
  const LL = Math.round(LABEL_H_MM * DOTS_PER_MM);

  const DX = 5;
  const DY = 5;
  const DESENHAR_BORDA = true;

  const agora = new Date();
  const dataHora =
    agora.toLocaleDateString('pt-BR') + ' ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const fo = (x, y) => `^FO${x + DX},${y + DY}`;

  const z = [];

  z.push('^XA');
  z.push(`^PW${PW}`);
  z.push(`^LL${LL}`);
  z.push('^FWB');

  if (DESENHAR_BORDA) {
    z.push(`^FO0,0^GB${PW},${LL},1^FS`);
  }

  z.push(`${fo(7, 10)}`);
  z.push('^BQN,2,4');
  z.push(`^FDQA,${codMP}-${op}^FS`);

  z.push(`${fo(135, 10)}`);
  z.push('^A0B,35,30');
  z.push(`^FD ${codMP} ^FS`);

  z.push(`${fo(170, 50)}`);
  z.push('^A0B,20,20');
  z.push(`^FD ${dataHora} ^FS`);

  z.push(`${fo(180, 0)}`);
  z.push('^A0B,23,23');
  z.push('^FB320,1,0,L,0');
  z.push('^FD --------------- ^FS');

  z.push(`${fo(20, 0)}`);
  z.push('^A0B,17,17');
  z.push('^FB230,2,0,L,0');
  z.push(`^FD OP: ${op} ^FS`);

  z.push(`${fo(196, 0)}`);
  z.push('^A0B,23,23');
  z.push('^FB320,1,0,L,0');
  z.push('^FD --------------- ^FS');

  z.push(`${fo(210, 10)}`);
  z.push('^A0B,23,23');
  z.push('^FB220,8,0,L,0');
  z.push(`^FD ${descricao || 'SEM DESCRIÇÃO'} ^FS`);

  z.push(`${fo(110, 10)}`);
  z.push('^A0B,20,20');
  z.push('^FB225,1,0,L,0');
  z.push('^FD FT-M00-ETQP - REV01 ^FS');

  z.push('^XZ');

  return z.join('\n');
}

async function obterOperacaoPorCodigo(client, codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;
  try {
    const { rows } = await client.query(
      `
        SELECT COALESCE(NULLIF(operacao, ''), NULLIF(comp_operacao, ''), NULLIF(destino, ''), NULLIF(origem, '')) AS operacao
        FROM public.omie_estrutura_item
        WHERE cod_prod_malha = $1 OR int_prod_malha = $1 OR int_malha = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        LIMIT 1
      `,
      [cod]
    );
    return rows?.[0]?.operacao || null;
  } catch (err) {
    console.warn('[pcp][etiqueta] falha ao buscar operação:', err?.message || err);
    return null;
  }
}

async function obterDescricaoProduto(client, codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;

  const tryQueries = [
    ['SELECT descricao FROM produtos WHERE codigo = $1 LIMIT 1', [cod]],
    ['SELECT descricao FROM produtos_omie WHERE codigo = $1 LIMIT 1', [cod]]
  ];

  for (const [sql, params] of tryQueries) {
    try {
      const { rows } = await client.query(sql, params);
      if (rows?.[0]?.descricao) return String(rows[0].descricao).trim();
    } catch (err) {
      console.warn('[pcp][etiqueta] falha ao buscar descrição:', err?.message || err);
    }
  }

  return null;
}

// Resolve o ID Omie (codigo_produto) associado a um código alfanumérico.
async function obterCodigoProdutoId(pg, codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;

  try {
    const { rows } = await pg.query(
      `
        SELECT codigo_produto
          FROM public.produtos_omie
         WHERE TRIM(UPPER(codigo)) = TRIM(UPPER($1))
            OR TRIM(UPPER(codigo_produto_integracao::text)) = TRIM(UPPER($1))
         ORDER BY codigo_produto ASC
         LIMIT 1
      `,
      [cod]
    );

    const raw = rows?.[0]?.codigo_produto;
    if (raw == null) return null;

    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch (err) {
    console.warn('[pcp][codigo_produto_id] falha ao obter ID:', err?.message || err);
    return null;
  }
}

async function obterVersaoEstrutura(client, codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;
  try {
    const { rows } = await client.query(
      `
        SELECT versao
        FROM omie_estrutura
        WHERE cod_produto = $1 OR CAST(cod_produto AS TEXT) = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        LIMIT 1
      `,
      [cod]
    );
    const val = rows?.[0]?.versao;
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : null;
  } catch (err) {
    console.warn('[pcp][etiqueta] falha ao buscar versao estrutura:', err?.message || err);
    return null;
  }
}

// Busca o "local de produção" preferencial a partir da tabela public.omie_estrutura,
// usando SEMPRE o Código OMIE (id_produto) como chave de localização.
// - Primeiro resolve id_produto via public.produtos_omie (obterCodigoProdutoId)
// - Depois lê public.omie_estrutura."local_produção" por id_produto
// - Retorna string ou null se não houver valor
async function obterLocalProducaoPorCodigo(client, codigo) {
  const cod = String(codigo || '').trim();
  if (!cod) return null;
  try {
    const id = await obterCodigoProdutoId(client, cod);
    if (!id) return null;
    const { rows } = await client.query(
      `SELECT "local_produção" AS local
         FROM public.omie_estrutura
        WHERE id_produto = $1
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        LIMIT 1`,
      [id]
    );
    const v = rows?.[0]?.local;
    return v && String(v).trim() ? String(v).trim() : null;
  } catch (err) {
    console.warn('[pcp][etiqueta] falha ao buscar local_produção por código/ID:', err?.message || err);
    return null;
  }
}

function normalizeCustomizacao(item) {
  if (!item) return null;
  const original = (item.codigo_original ?? item.original ?? '').toString().trim();
  const novo = (item.codigo_novo ?? item.codigo_trocado ?? item.novo ?? '').toString().trim();
  if (!original || !novo || original === novo) return null;

  const descOrig = (item.descricao_original ?? item.descricaoAntiga ?? '').toString().trim() || null;
  const descNova = (item.descricao_nova ?? item.descricao_trocada ?? '').toString().trim() || null;
  const tipo = (item.tipo ?? '').toString().trim() || null;
  const grupo = (item.grupo ?? '').toString().trim() || null;
  const parentCodigo = (item.parent_codigo ?? '').toString().trim() || null;
  const qtdRaw = Number(item.quantidade);
  const quantidade = Number.isFinite(qtdRaw) ? qtdRaw : null;

  return {
    tipo,
    grupo,
    codigo_original: original,
    codigo_novo: novo,
    descricao_original: descOrig,
    descricao_trocada: descNova,
    parent_codigo: parentCodigo,
    quantidade
  };
}

async function registrarPersonalizacao(client, {
  codigoPai,
  versaoBase = null,
  usuario = null,
  customizacoes = []
} = {}) {
  if (!Array.isArray(customizacoes) || !customizacoes.length) {
    return { personalizacaoId: null, sufixoCustom: '' };
  }

  const { rows } = await client.query(
    `
      INSERT INTO pcp_personalizacao (codigo_pai, versao_base, criado_por)
      VALUES ($1,$2,$3)
      RETURNING id
    `,
    [codigoPai, versaoBase ?? null, usuario ?? null]
  );
  const personalizacaoId = rows?.[0]?.id || null;
  if (!personalizacaoId) return { personalizacaoId: null, sufixoCustom: '' };

  const insertItemSql = `
    INSERT INTO pcp_personalizacao_item
      (personalizacao_id, tipo, grupo, codigo_original, codigo_trocado, descricao_original, descricao_trocada, parent_codigo, quantidade)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `;
  for (const item of customizacoes) {
    await client.query(insertItemSql, [
      personalizacaoId,
      item.tipo || null,
      item.grupo || null,
      item.codigo_original || null,
      item.codigo_novo || null,
      item.descricao_original || null,
      item.descricao_trocada || null,
      item.parent_codigo || null,
      item.quantidade != null ? item.quantidade : null
    ]);
  }

  return { personalizacaoId, sufixoCustom: `C${personalizacaoId}` };
}

/* ============================================================================
   /api/etiquetas – gera o .zpl da etiqueta no layout “compacto” aprovado
   ============================================================================ */
app.post('/api/etiquetas', async (req, res) => {
  try {
    const { numeroOP, tipo = 'Expedicao', codigo, ns } = req.body;

    const folder = path.join(__dirname, 'etiquetas', tipo);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }

    if (!numeroOP) return res.status(400).json({ error: 'Falta numeroOP' });

    const { dirTipo } = getDirs(tipo);
    const zpl = await gerarEtiquetaCompactaZPL({ numeroOP, codigo, ns });
    const fileName = `etiqueta_${numeroOP}.zpl`;
    fs.writeFileSync(path.join(dirTipo, fileName), zpl, 'utf8');

    return res.json({ ok: true });
  } catch (err) {
    console.error('[etiquetas] erro →', err);
    return res.status(500).json({ error: 'Erro ao gerar etiqueta' });
  }
});

app.post('/api/pcp/etiquetas/pai', async (req, res) => {
  try {
    const {
      codigo_produto,
      codigo_produto_id,
      usuario_criacao,
      observacoes,
      ns,
      itens_pp,
      quantidade_pai,
      versao_estrutura,
      customizacoes: customizacoesRaw
    } = req.body || {};

    const codigo = String(codigo_produto || '').trim();
    if (!codigo) {
      return res.status(400).json({ ok: false, error: 'codigo_produto obrigatório' });
    }

    const usuario = usuario_criacao !== undefined && usuario_criacao !== null
      ? (String(usuario_criacao).trim() || null)
      : null;
    const obs = observacoes !== undefined && observacoes !== null
      ? (String(observacoes).trim() || null)
      : null;
    const itensPP = Array.isArray(itens_pp) ? itens_pp : [];
    const qtdPaiNum = Number(quantidade_pai);
    const quantidadePai = Number.isFinite(qtdPaiNum) && qtdPaiNum > 0
      ? Math.max(1, Math.round(qtdPaiNum))
      : 1;
    const versaoPaiRaw = Number(versao_estrutura);
    const versaoPai = Number.isFinite(versaoPaiRaw) && versaoPaiRaw > 0
      ? Math.max(1, Math.round(versaoPaiRaw))
      : 1;
    const sufixoPai = `-v${versaoPai}`;
    const customizacoes = Array.isArray(customizacoesRaw)
      ? customizacoesRaw.map(normalizeCustomizacao).filter(Boolean)
      : [];
    let personalizacaoId = null;
    let sufixoCustom = '';

    let produtoDet = null;
    try {
      produtoDet = await omieCall(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        {
          call:       'ConsultarProduto',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param:      [{ codigo }]
        }
      );
    } catch (err) {
      console.warn('[pcp/etiquetas/pai] consulta Omie falhou:', err?.message || err);
      produtoDet = {};
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
  await client.query('LOCK TABLE "OrdemProducao".tab_op IN SHARE ROW EXCLUSIVE MODE');

      const insertSql = `
  INSERT INTO "OrdemProducao".tab_op
          (numero_op, codigo_produto, codigo_produto_id, tipo_etiqueta, local_impressao, conteudo_zpl, usuario_criacao, observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id, data_criacao
      `;

      // Usa codigo_produto_id fornecido pelo frontend, ou faz lookup se não fornecido
      const codigoProdutoIdPai = (codigo_produto_id !== null && codigo_produto_id !== undefined)
        ? codigo_produto_id
        : await obterCodigoProdutoId(client, codigo);

      ({ personalizacaoId, sufixoCustom } = await registrarPersonalizacao(client, {
        codigoPai: codigo,
        versaoBase: versaoPai,
        usuario,
        customizacoes
      }));

  const opsGerados = [];
  let localImpressaoPaiLog = null;
      for (let i = 0; i < quantidadePai; i++) {
        const { numero_op: numeroBase } = await gerarProximoNumeroOP(client, 'OP');
        const numeroCompleto = `${numeroBase}${sufixoPai}${sufixoCustom}`;
        const zplPai = await gerarEtiquetaCompactaZPL({
          numeroOP: numeroCompleto,
          codigo,
          ns,
          produtoDet
        });

        // Determina local de impressão do PAI priorizando public.omie_estrutura.local_produção (por id_produto/"Código OMIE")
  const localImpressaoPai = await obterLocalProducaoPorCodigo(client, codigo) || 'Montagem';
  if (!localImpressaoPaiLog) localImpressaoPaiLog = localImpressaoPai;

        const paramsPai = [
          numeroCompleto,
          codigo,
          codigoProdutoIdPai,
          'Aguardando prazo',
          localImpressaoPai,
          zplPai,
          usuario,
          obs
        ];

        const { rows: rowPai } = await client.query(insertSql, paramsPai);
        await registrarAnexosOp(client, numeroCompleto, codigoProdutoIdPai);
        await registrarImagensOp(client, numeroCompleto, codigoProdutoIdPai);
        opsGerados.push({
          numero_op: numeroCompleto,
          id: rowPai?.[0]?.id || null,
          data_criacao: rowPai?.[0]?.data_criacao || null,
          versao: versaoPai
        });
      }

      const ppResultados = [];

      for (const raw of itensPP) {
        const codigoPP = String(raw?.codigo || raw?.cod || '').trim();
        if (!codigoPP) continue;

        const qtdRaw = Number(raw?.quantidade ?? raw?.qtd ?? 1);
        const qtdInt = Number.isFinite(qtdRaw) && qtdRaw > 0
          ? Math.max(1, Math.round(qtdRaw))
          : 1;

    const operacao = await obterOperacaoPorCodigo(client, codigoPP);
    // Usa codigo_produto_id fornecido pelo frontend para cada item PP, ou faz lookup
    const codigoProdutoIdPP = (raw?.codigo_produto_id !== null && raw?.codigo_produto_id !== undefined)
      ? raw.codigo_produto_id
      : await obterCodigoProdutoId(client, codigoPP);
        let descricaoPP = String(raw?.descricao || '').trim();
        if (!descricaoPP) {
          descricaoPP = await obterDescricaoProduto(client, codigoPP) || 'SEM DESCRIÇÃO';
        }
  // Determina local de impressão do ITEM (PP) priorizando public.omie_estrutura.local_produção (por id_produto/"Código OMIE")
  const localPreferencial = await obterLocalProducaoPorCodigo(client, codigoPP);
  const localImpressao = localPreferencial || operacao || 'Montagem';
        const versaoPP = await obterVersaoEstrutura(client, codigoPP) || 1;
        const sufixoPP = `-v${versaoPP}`;
        const geradosOps = [];

        for (let i = 0; i < qtdInt; i++) {
          const { numero_op: numeroOpsBase } = await gerarProximoNumeroOP(client, 'OPS');
          const numeroOpsSeq = `${numeroOpsBase}${sufixoPP}${sufixoCustom}`;

          const zplPP = gerarEtiquetaPPZPL({ codMP: codigoPP, op: numeroOpsSeq, descricao: descricaoPP });

          const paramsPP = [
            numeroOpsSeq,
            codigoPP,
            codigoProdutoIdPP,
            'Aguardando prazo',
            localImpressao,
            zplPP,
            usuario,
            obs
          ];

          const { rows: rowPP } = await client.query(insertSql, paramsPP);
          await registrarAnexosOp(client, numeroOpsSeq, codigoProdutoIdPP);
          await registrarImagensOp(client, numeroOpsSeq, codigoProdutoIdPP);
          geradosOps.push({
            numero_op: numeroOpsSeq,
            id: rowPP?.[0]?.id || null,
            data_criacao: rowPP?.[0]?.data_criacao || null
          });
        }

        ppResultados.push({
          codigo: codigoPP,
          codigo_produto_id: codigoProdutoIdPP,
          local_impressao: localImpressao,
          quantidade: qtdInt,
          versao: versaoPP,
          registros: geradosOps
        });
      }

      if (personalizacaoId) {
        await client.query(
          'UPDATE pcp_personalizacao SET numero_referencia = $1 WHERE id = $2',
          [opsGerados[0]?.numero_op || null, personalizacaoId]
        );
      }

      await client.query('COMMIT');

      // Auditoria: abertura de OP(s) do produto pai
      try {
        const usuarioAudit = (usuario && String(usuario).trim()) || userFromReq(req);
        if (opsGerados.length) {
          const nums = opsGerados.map(o => o.numero_op).filter(Boolean).join(', ');
          await registrarModificacao({
            codigo_omie: codigo, // compat
            codigo_texto: codigo,
            codigo_produto: codigoProdutoId,
            tipo_acao: 'ABERTURA_OP',
            usuario: usuarioAudit,
            origem: 'API',
            detalhes: `OP(s): ${nums}; versao=v${versaoPai}${sufixoCustom ? ' ' + sufixoCustom : ''}; local=${localImpressaoPaiLog || ''}`
          });
        }
        // Auditoria: abertura de OP(s) para cada PP
        if (Array.isArray(ppResultados) && ppResultados.length) {
          for (const pp of ppResultados) {
            const nums = (pp.registros || []).map(r => r.numero_op).filter(Boolean).join(', ');
            if (!nums) continue;
            await registrarModificacao({
              codigo_omie: pp.codigo, // compat
              codigo_texto: pp.codigo,
              codigo_produto: pp.codigo_produto_id,
              tipo_acao: 'ABERTURA_OP',
              usuario: usuarioAudit,
              origem: 'API',
              detalhes: `OP(s): ${nums}; versao=v${pp.versao}; local=${pp.local_impressao}`
            });
          }
        }
      } catch (e) {
        console.warn('[auditoria][etiquetas/pai] falhou ao registrar:', e?.message || e);
      }

      return res.json({
        ok: true,
        numero_op: opsGerados[0]?.numero_op || null,
        id: opsGerados[0]?.id || null,
        data_criacao: opsGerados[0]?.data_criacao || null,
        versao: versaoPai,
        personalizacao_id: personalizacaoId,
        op_registros: opsGerados,
        itens_pp: ppResultados
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[pcp/etiquetas/pai] erro:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Falha ao gerar etiqueta' });
  }
});

app.post('/api/pcp/etiquetas/pp', async (req, res) => {
  try {
    const {
      codigo_produto,
      codigo_produto_id,
      quantidade,
      descricao: descricaoInicial,
      usuario_criacao,
      observacoes,
      ns,
      customizacoes: customizacoesRaw
    } = req.body || {};

    const codigo = String(codigo_produto || '').trim();
    if (!codigo) {
      return res.status(400).json({ ok: false, error: 'codigo_produto obrigatório' });
    }

    const usuario = usuario_criacao !== undefined && usuario_criacao !== null
      ? (String(usuario_criacao).trim() || null)
      : null;
    const obs = observacoes !== undefined && observacoes !== null
      ? (String(observacoes).trim() || null)
      : null;

    const qtdRaw = Number(quantidade ?? 1);
    const qtdInt = Number.isFinite(qtdRaw) && qtdRaw > 0
      ? Math.max(1, Math.round(qtdRaw))
      : 1;
    const customizacoes = Array.isArray(customizacoesRaw)
      ? customizacoesRaw.map(normalizeCustomizacao).filter(Boolean)
      : [];
    let personalizacaoId = null;
    let sufixoCustom = '';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
  await client.query('LOCK TABLE "OrdemProducao".tab_op IN SHARE ROW EXCLUSIVE MODE');

  // Determina local de impressão priorizando public.omie_estrutura.local_produção (por id_produto/"Código OMIE")
  const localPreferencial = await obterLocalProducaoPorCodigo(client, codigo);
  const localImpressao = localPreferencial || (await obterOperacaoPorCodigo(client, codigo)) || 'Montagem';
      let descricao = String(descricaoInicial || '').trim();
      if (!descricao) {
        descricao = await obterDescricaoProduto(client, codigo) || 'SEM DESCRIÇÃO';
      }
      const versaoPP = await obterVersaoEstrutura(client, codigo) || 1;
      const sufixoPP = `-v${versaoPP}`;

      ({ personalizacaoId, sufixoCustom } = await registrarPersonalizacao(client, {
        codigoPai: codigo,
        versaoBase: versaoPP,
        usuario,
        customizacoes
      }));

      const insertSql = `
  INSERT INTO "OrdemProducao".tab_op
          (numero_op, codigo_produto, codigo_produto_id, tipo_etiqueta, local_impressao, conteudo_zpl, usuario_criacao, observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id, data_criacao
      `;

      // Usa codigo_produto_id fornecido pelo frontend, ou faz lookup se não fornecido
      const codigoProdutoId = (codigo_produto_id !== null && codigo_produto_id !== undefined)
        ? codigo_produto_id
        : await obterCodigoProdutoId(client, codigo);

      const registros = [];
      for (let i = 0; i < qtdInt; i++) {
        const { numero_op: baseNumero } = await gerarProximoNumeroOP(client, 'OPS');
        const numeroCompleto = `${baseNumero}${sufixoPP}${sufixoCustom}`;
        const zpl = gerarEtiquetaPPZPL({ codMP: codigo, op: numeroCompleto, descricao });

        const params = [
          numeroCompleto,
          codigo,
          codigoProdutoId,
          'Aguardando prazo',
          localImpressao,
          zpl,
          usuario,
          obs
        ];

        const { rows } = await client.query(insertSql, params);
        await registrarAnexosOp(client, numeroCompleto, codigoProdutoId);
        await registrarImagensOp(client, numeroCompleto, codigoProdutoId);
        registros.push({
          numero_op: numeroCompleto,
          id: rows?.[0]?.id || null,
          data_criacao: rows?.[0]?.data_criacao || null
        });
      }

      if (personalizacaoId) {
        await client.query(
          'UPDATE pcp_personalizacao SET numero_referencia = $1 WHERE id = $2',
          [registros[0]?.numero_op || null, personalizacaoId]
        );
      }

      await client.query('COMMIT');

      // Auditoria: abertura de OP(s) PP
      try {
        const usuarioAudit = (usuario && String(usuario).trim()) || userFromReq(req);
        if (Array.isArray(registros) && registros.length) {
          const nums = registros.map(r => r.numero_op).filter(Boolean).join(', ');
          await registrarModificacao({
            codigo_omie: codigo, // compat
            codigo_texto: codigo,
            codigo_produto: codigoProdutoId,
            tipo_acao: 'ABERTURA_OP',
            usuario: usuarioAudit,
            origem: 'API',
            detalhes: `OP(s): ${nums}; versao=v${versaoPP}; local=${localImpressao}`
          });
        }
      } catch (e) {
        console.warn('[auditoria][etiquetas/pp] falhou ao registrar:', e?.message || e);
      }

      return res.json({
        ok: true,
        codigo_produto: codigo,
        local_impressao: localImpressao,
        quantidade: qtdInt,
        versao: versaoPP,
        personalizacao_id: personalizacaoId,
        registros
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[pcp/etiquetas/pp] erro:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Falha ao gerar etiqueta PP' });
  }
});

app.post('/api/etiquetas/aguardando/confirmar', express.json(), async (req, res) => {
  try {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (!itens.length) {
      return res.status(400).json({ ok: false, error: 'Nenhuma OP informada.' });
    }

    const toTimestampString = (valor) => {
      if (!valor) return null;

      const pad = (n) => String(n).padStart(2, '0');

      const fromDate = (d) => {
        if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };

      if (valor instanceof Date) {
        return fromDate(valor);
      }

      const raw = String(valor).trim();
      if (!raw) return null;

      if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
        const dt = new Date(raw);
        const from = fromDate(dt);
        if (from) return from;
      }

      const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
      if (match) {
        const sec = match[4] || '00';
        return `${match[1]} ${match[2]}:${match[3]}:${sec}`;
      }

      const onlyDate = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (onlyDate) {
        return `${onlyDate[1]} 00:00:00`;
      }

      return null;
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateSql = `
        UPDATE "OrdemProducao".tab_op
           SET data_impressao = $2::timestamp,
               impressa = CASE WHEN $2 IS NULL THEN FALSE ELSE impressa END
         WHERE numero_op = $1
        RETURNING numero_op
      `;

      const atualizados = [];
      for (const it of itens) {
        const numeroOp = String(it?.numero_op || '').trim();
        if (!numeroOp) continue;
        const dataIso = toTimestampString(it?.data_impressao);
        const { rows } = await client.query(updateSql, [numeroOp, dataIso]);
        if (rows?.[0]?.numero_op) {
          atualizados.push(rows[0].numero_op);
        }
      }

      await client.query('COMMIT');

      // Auditoria: atualização de data_impressao por OP
      try {
        const usuarioAudit = userFromReq(req);
        if (Array.isArray(atualizados) && atualizados.length) {
          // Mapa OP -> data
          const itensArr = Array.isArray(itens) ? itens : [];
          const dataMap = new Map();
          for (const it of itensArr) {
            const n = String(it?.numero_op || '').trim();
            if (!n) continue;
            const d = toTimestampString(it?.data_impressao);
            dataMap.set(n, d);
          }
          // Busca códigos de produto para as OPs
          const { rows: mapRows } = await pool.query(
            'SELECT numero_op, codigo_produto_id, codigo_produto FROM "OrdemProducao".tab_op WHERE numero_op = ANY($1)',
            [atualizados]
          );
          for (const r of mapRows) {
            const op = r.numero_op;
            const codId = r.codigo_produto_id;
            const codTxt = r.codigo_produto;
            const d  = dataMap.get(op) || null;
            if (!codId && !codTxt) continue;
            await registrarModificacao({
              codigo_omie: codTxt || String(codId || ''),
              codigo_texto: codTxt || null,
              codigo_produto: codId || null,
              tipo_acao: 'OP_DATA_IMPRESSAO',
              usuario: usuarioAudit,
              origem: 'API',
              detalhes: `OP ${op} -> ${d || 'null'}`
            });
          }
        }
      } catch (e) {
        console.warn('[auditoria][aguardando/confirmar] falhou ao registrar:', e?.message || e);
      }

      return res.json({ ok: true, atualizados });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[etiquetas/aguardando/confirmar]', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Falha ao atualizar datas' });
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



  // Salva uma etiqueta na tabela OrdemProducao.tab_op (permitindo injetar o ZPL já pronto)
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

    const codigoProdutoId = await obterCodigoProdutoId(pool, codigo_produto);

    const sql = `
      INSERT INTO "OrdemProducao".tab_op
          (numero_op, codigo_produto, codigo_produto_id, tipo_etiqueta, local_impressao,
           conteudo_zpl, impressa, usuario_criacao, observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, data_criacao
    `;
    const params = [
      numero_op,
      codigo_produto,
      codigoProdutoId,
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




// === salva uma etiqueta de OP na tabela `OrdemProducao`.tab_op ===
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

  const codigoProdutoId = await obterCodigoProdutoId(pool, codigo_produto);

  const sql = `
    INSERT INTO "OrdemProducao".tab_op
      (numero_op, codigo_produto, codigo_produto_id, tipo_etiqueta, local_impressao,
       conteudo_zpl, impressa, usuario_criacao, observacoes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id, data_criacao
  `;
  const params = [
    numero_op,
    codigo_produto,
    codigoProdutoId,
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
    const rawLocal = req.query.local ?? req.body?.local;
    const local = String(rawLocal ?? '').trim() || ALMOX_LOCAL_PADRAO;

    // Usa apenas a tabela principal de posições do Omie, filtrando pelo local informado.
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (COALESCE(p.omie_prod_id::text, p.codigo))
        p.codigo,
        p.descricao,
        p.estoque_minimo,
        p.fisico,
        p.reservado,
        p.saldo,
        p.cmc,
        p.omie_prod_id,
        p.cod_int,
        p.data_posicao,
        p.ingested_at,
        po.codigo_familia,
        po.descricao_familia,
        po.preco_definido
      FROM public.omie_estoque_posicao p
      LEFT JOIN public.produtos_omie po
        ON po.codigo_produto = p.omie_prod_id
      WHERE p.local_codigo = $1
        AND COALESCE(p.saldo, 0) != 0
      ORDER BY COALESCE(p.omie_prod_id::text, p.codigo), p.data_posicao DESC, p.ingested_at DESC, p.id DESC
    `, [local]);

    const dados = rows.map(r => ({
      codigo   : r.codigo || '',
      descricao: r.descricao || '',
      min      : Number(r.estoque_minimo) || 0,
      fisico   : Number(r.fisico)        || 0,
      reservado: Number(r.reservado)     || 0,
      saldo    : Number(r.saldo)         || 0,
      cmc      : Number(r.cmc)           || 0,
      codOmie  : r.omie_prod_id != null ? String(r.omie_prod_id) : (r.cod_int || ''),
      origem   : local,
      dataPosicao: r.data_posicao,
      atualizadoEm: r.ingested_at,
      familiaCodigo: r.codigo_familia != null ? String(r.codigo_familia) : '',
      familiaNome: r.descricao_familia || '',
      preco_definido: r.preco_definido != null ? Number(r.preco_definido) : null,
    }));

    res.json({ ok:true, local, pagina:1, totalPaginas:1, dados });
  } catch (err) {
    console.error('[almoxarifado SQL]', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});

async function listarLocaisViaDb() {
  const { rows } = await pool.query(`
    SELECT
      local_codigo,
      nome,
      COALESCE(ativo, true) AS ativo
    FROM public.omie_locais_estoque
    ORDER BY nome NULLS LAST, local_codigo
  `);

  return rows.map(row => ({
    codigo: row.local_codigo || '',
    descricao: row.nome || '',
    codigo_local_estoque: String(row.local_codigo || ''),
    padrao: String(row.local_codigo || '') === ALMOX_LOCAL_PADRAO,
    inativo: row.ativo === false
  }));
}

function normalizarLocalOmie(loc) {
  return {
    codigo: loc.codigo || '',
    descricao: loc.descricao || '',
    codigo_local_estoque: String(loc.codigo_local_estoque || ''),
    padrao: String(loc.padrao || '').toUpperCase() === 'S',
    inativo: String(loc.inativo || '').toUpperCase() === 'S'
  };
}

// Lista locais de estoque consultando a Omie (com cache e fallback para o Postgres)
app.get('/api/armazem/locais', async (req, res) => {
  const preferSource = String(req.query?.fonte || req.query?.source || '').toLowerCase();
  const now = Date.now();

  const responder = (locais, fonte) => {
    const ordenados = [...locais].sort((a, b) => (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR'));
    return res.json({ ok: true, locais: ordenados, fonte });
  };

  const servirDoBanco = async () => {
    try {
      const locaisDb = await listarLocaisViaDb();
      locaisEstoqueCache.at = now;
      locaisEstoqueCache.data = locaisDb;
      locaisEstoqueCache.fonte = 'db_local';
      return responder(locaisDb, 'db_local');
    } catch (err) {
      console.error('[api/armazem/locais][db] erro →', err);
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  };

  if (preferSource === 'db') {
    return servirDoBanco();
  }

  const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
  const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    return servirDoBanco();
  }

  if (locaisEstoqueCache.data.length && (now - locaisEstoqueCache.at) < LOCAIS_CACHE_TTL_MS && locaisEstoqueCache.fonte === 'omie') {
    return responder(locaisEstoqueCache.data, 'omie_cache');
  }

  try {
    const payload = {
      call: 'ListarLocaisEstoque',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ nPagina: 1, nRegPorPagina: 200 }]
    };

    const primeira = await callOmieDedup('https://app.omie.com.br/api/v1/estoque/local/', payload, { waitMs: 3500 });
    let locaisRaw = Array.isArray(primeira?.locaisEncontrados) ? [...primeira.locaisEncontrados] : [];
    const totalPaginas = Number(primeira?.nTotPaginas || 1);

    for (let pagina = 2; pagina <= totalPaginas; pagina += 1) {
      const extra = await callOmieDedup(
        'https://app.omie.com.br/api/v1/estoque/local/',
        { ...payload, param: [{ nPagina: pagina, nRegPorPagina: 200 }] },
        { waitMs: 3500 }
      );
      if (Array.isArray(extra?.locaisEncontrados)) {
        locaisRaw = locaisRaw.concat(extra.locaisEncontrados);
      }
    }

    const normalizados = locaisRaw.map(normalizarLocalOmie);
    locaisEstoqueCache.at = now;
    locaisEstoqueCache.data = normalizados;
    locaisEstoqueCache.fonte = 'omie';

    return responder(normalizados, 'omie');
  } catch (err) {
    console.error('[api/armazem/locais][omie] erro →', err?.faultstring || err?.message || err);
    return servirDoBanco();
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

function isRecebimentoProdutoTopic(topic = '') {
  return /^RecebimentoProduto\./i.test(String(topic || ''));
}

async function upsertRecebimentoFromWebhookPayload(rawBody = {}) {
  const body = (rawBody && typeof rawBody === 'object') ? rawBody : {};
  const event =
    (body.event && typeof body.event === 'object' ? body.event : null)
    || (body.evento && typeof body.evento === 'object' ? body.evento : null)
    || body;
  const cab =
    (event.cabecalho && typeof event.cabecalho === 'object' ? event.cabecalho : null)
    || (event.cabec && typeof event.cabec === 'object' ? event.cabec : null)
    || (body.cabecalho && typeof body.cabecalho === 'object' ? body.cabecalho : null)
    || (body.cabec && typeof body.cabec === 'object' ? body.cabec : null)
    || {};

  const infoAdicionais =
    (event.infoAdicionais && typeof event.infoAdicionais === 'object' ? event.infoAdicionais : null)
    || (event.info_adicionais && typeof event.info_adicionais === 'object' ? event.info_adicionais : null)
    || (body.infoAdicionais && typeof body.infoAdicionais === 'object' ? body.infoAdicionais : null)
    || (body.info_adicionais && typeof body.info_adicionais === 'object' ? body.info_adicionais : null)
    || {};

  const nIdRecebRaw = cab.nIdReceb ?? cab.n_id_receb ?? null;
  const nIdReceb = nIdRecebRaw !== null && nIdRecebRaw !== undefined && String(nIdRecebRaw).trim() !== ''
    ? Number(nIdRecebRaw)
    : null;

  if (!Number.isFinite(nIdReceb) || nIdReceb <= 0) {
    return { ok: false, reason: 'missing_n_id_receb' };
  }

  const cDadosAdicionais =
    cab.cDadosAdicionais
    || cab.c_dados_adicionais
    || cab.cObsNFe
    || null;

  await pool.query(`
    INSERT INTO logistica.recebimentos_nfe_omie (
      n_id_receb,
      c_chave_nfe,
      c_numero_nfe,
      c_serie_nfe,
      c_modelo_nfe,
      d_emissao_nfe,
      d_registro,
      n_valor_nfe,
      n_id_fornecedor,
      c_nome_fornecedor,
      c_cnpj_cpf_fornecedor,
      c_etapa,
      n_id_conta,
      c_categ_compra,
      c_dados_adicionais,
      c_obs_nfe,
      updated_at
    )
    VALUES (
      $1,
      COALESCE($2, $3),
      COALESCE($4, $5),
      COALESCE($6, $7),
      COALESCE($8, $9),
      CASE
        WHEN COALESCE($10, $11) ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_date(COALESCE($10, $11), 'DD/MM/YYYY')
        ELSE NULL
      END,
      CASE
        WHEN COALESCE($12, $13) ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_date(COALESCE($12, $13), 'DD/MM/YYYY')
        ELSE NULL
      END,
      NULLIF($14::text, '')::numeric,
      NULLIF($15::text, '')::bigint,
      COALESCE($16, $17),
      COALESCE($18, $19, $20),
      $21,
      NULLIF($22::text, '')::bigint,
      $23,
      $24,
      COALESCE($25, $24),
      NOW()
    )
    ON CONFLICT (n_id_receb)
    DO UPDATE SET
      c_chave_nfe = COALESCE(EXCLUDED.c_chave_nfe, logistica.recebimentos_nfe_omie.c_chave_nfe),
      c_numero_nfe = COALESCE(EXCLUDED.c_numero_nfe, logistica.recebimentos_nfe_omie.c_numero_nfe),
      c_serie_nfe = COALESCE(EXCLUDED.c_serie_nfe, logistica.recebimentos_nfe_omie.c_serie_nfe),
      c_modelo_nfe = COALESCE(EXCLUDED.c_modelo_nfe, logistica.recebimentos_nfe_omie.c_modelo_nfe),
      d_emissao_nfe = COALESCE(EXCLUDED.d_emissao_nfe, logistica.recebimentos_nfe_omie.d_emissao_nfe),
      d_registro = COALESCE(EXCLUDED.d_registro, logistica.recebimentos_nfe_omie.d_registro),
      n_valor_nfe = COALESCE(EXCLUDED.n_valor_nfe, logistica.recebimentos_nfe_omie.n_valor_nfe),
      n_id_fornecedor = COALESCE(EXCLUDED.n_id_fornecedor, logistica.recebimentos_nfe_omie.n_id_fornecedor),
      c_nome_fornecedor = COALESCE(EXCLUDED.c_nome_fornecedor, logistica.recebimentos_nfe_omie.c_nome_fornecedor),
      c_cnpj_cpf_fornecedor = COALESCE(EXCLUDED.c_cnpj_cpf_fornecedor, logistica.recebimentos_nfe_omie.c_cnpj_cpf_fornecedor),
      c_etapa = COALESCE(EXCLUDED.c_etapa, logistica.recebimentos_nfe_omie.c_etapa),
      n_id_conta = COALESCE(EXCLUDED.n_id_conta, logistica.recebimentos_nfe_omie.n_id_conta),
      c_categ_compra = COALESCE(EXCLUDED.c_categ_compra, logistica.recebimentos_nfe_omie.c_categ_compra),
      c_dados_adicionais = COALESCE(EXCLUDED.c_dados_adicionais, logistica.recebimentos_nfe_omie.c_dados_adicionais),
      c_obs_nfe = COALESCE(EXCLUDED.c_obs_nfe, logistica.recebimentos_nfe_omie.c_obs_nfe),
      updated_at = NOW();
  `, [
    nIdReceb,
    cab.cChaveNFe,
    cab.cChaveNfe,
    cab.cNumeroNFe,
    cab.cNumeroNF,
    cab.cSerieNFe,
    cab.cSerie,
    cab.cModeloNFe,
    cab.cModelo,
    cab.dEmissaoNFe,
    cab.dDataEmissao,
    infoAdicionais.dRegistro,
    cab.dDataRegistro,
    cab.nValorNFe || cab.nValorNF,
    cab.nIdFornecedor || cab.nCodFor,
    cab.cNome,
    cab.cRazaoSocial,
    cab.cCNPJ_CPF,
    cab.cCNPJ,
    cab.cCpfCnpj,
    cab.cEtapa,
    infoAdicionais.nIdConta || cab.nCodCC,
    infoAdicionais.cCategCompra || cab.cCodCateg,
    cDadosAdicionais,
    cab.cObsNFe || null,
  ]);

  return { ok: true, nIdReceb };
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
    const topic = body?.topic || body?.event?.topic || body?.evento?.topic || '';
    const tipo = body?.event_type || body?.tipoEvento || (topic || 'estoque');

    // 2) guarda o evento cru (auditoria)
    await pool.query(
      `INSERT INTO omie_webhook_events (event_id, event_type, payload_json)
       VALUES ($1,$2,$3)`,
      [ body?.event_id || body?.messageId || body?.message_id || null, tipo, body ]
    );

    if (isRecebimentoProdutoTopic(topic)) {
      const upsertInfo = await upsertRecebimentoFromWebhookPayload(body);
      return res.json({ ok: true, routed: 'recebimentos-nfe', upsert: upsertInfo });
    }

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
    const topic = body?.topic || body?.event?.topic || body?.evento?.topic || '';

    // 1) guarda o evento "como veio"
    await pool.query(
      `INSERT INTO omie_webhook_events (event_id, event_type, payload_json)
       VALUES ($1,$2,$3)`,
      [ body?.event_id || body?.messageId || body?.message_id || null, body?.event_type || topic || 'estoque', body ]
    );

    if (isRecebimentoProdutoTopic(topic)) {
      const upsertInfo = await upsertRecebimentoFromWebhookPayload(body);
      return res.json({ ok: true, routed: 'recebimentos-nfe', upsert: upsertInfo });
    }

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
// Agora: cExibeTodos = 'N' (apenas itens com saldo) e filtro por codigo_local_estoque
// ------------------------------------------------------------------
app.post('/api/admin/sync/almoxarifado', express.json(), async (req, res) => {
  const startedAt = Date.now();

  const OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
  const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    return res.status(500).json({ ok:false, error: 'OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente.' });
  }

  const localCodigo = String(req.body?.local || 10408201806);
  const dataInput   = String(req.body?.data || new Date().toLocaleDateString('pt-BR')); // dd/mm/aaaa
  const tmo         = Number(req.query.timeout || 60000);
  const retryCount  = Number(req.query.retry || 2);
  const perPage     = 200;

  const brToISO = (s) => /^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.split('/').reverse().join('-') : s;
  const dataBR  = /^\d{4}-\d{2}-\d{2}$/.test(dataInput) ? dataInput.split('-').reverse().join('/') : dataInput;
  const dataISO = brToISO(dataInput);
  const clamp   = n => Math.max(0, Number(n) || 0);
  const sleep   = ms => new Promise(r => setTimeout(r, ms));

  const fetchWithTimeout = async (url, opts = {}, ms = 20000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try { return await fetch(url, { ...opts, signal: controller.signal }); }
    finally { clearTimeout(id); }
  };
  const omieFetch = async (payload) => {
    const resp = await fetchWithTimeout(
      'https://app.omie.com.br/api/v1/estoque/consulta/',
      { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) },
      tmo
    );
    if (!resp.ok) throw new Error(`Omie HTTP ${resp.status} ${resp.statusText} :: ${(await resp.text().catch(()=>''))?.slice(0,300)}`);
    return resp.json();
  };
  const omieFetchRetry = async (payload) => {
    for (let i = 0; i <= retryCount; i++) {
      try { return await omieFetch(payload); }
      catch (e) {
        const isCache = String(e?.message||'').includes('Consumo redundante detectado');
        if (isCache && i < retryCount) { await sleep(35000); continue; }
        throw e;
      }
    }
  };

  try {
    // 1) primeira página — **cExibeTodos: 'N'** (apenas itens com saldo)
    const basePayload = {
      call: 'ListarPosEstoque',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{
        nPagina: 1,
        nRegPorPagina: perPage,
        dDataPosicao: dataBR,
        cExibeTodos : 'N',                       // <<< aqui o ajuste
        codigo_local_estoque: Number(localCodigo)
      }]
    };

    const r0 = await omieFetchRetry(basePayload);
    const total   = Number(r0.nTotRegistros || (Array.isArray(r0.produtos) ? r0.produtos.length : 0));
    const paginas = Math.max(1, Math.ceil(total / perPage));

    // 2) paginação + **filtro por local** (defensivo)
    const itens = [];
    for (let pg = 1; pg <= paginas; pg++) {
      const payload = { ...basePayload, param: [{ ...basePayload.param[0], nPagina: pg }] };
      const r = await omieFetchRetry(payload);
      const arr = (Array.isArray(r.produtos) ? r.produtos : []).filter(
        it => Number(it?.codigo_local_estoque) === Number(localCodigo)
      );
      itens.push(...arr);
    }

    if (!itens.length) {
      return res.json({ ok:true, imported: 0, local: localCodigo, data_posicao: dataISO, msg: 'Sem itens com saldo para este local.' });
    }

    // 3) UPSERT
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');

      await cli.query(
        `INSERT INTO omie_locais_estoque (local_codigo, nome, ativo, updated_at)
         VALUES ($1, $2, TRUE, now())
         ON CONFLICT (local_codigo)
         DO UPDATE SET nome = EXCLUDED.nome, ativo = TRUE, updated_at = now()`,
        [localCodigo, 'Almoxarifado/Produção']
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
        await cli.query(upsertSQL, [
          dataISO, localCodigo,
          Number(p.nCodProd) || 0,
          p.cCodInt || null,
          p.cCodigo || '',
          p.cDescricao || '',
          clamp(p.nPrecoUnitario),
          clamp(p.nSaldo),
          clamp(p.nCMC),
          clamp(p.nPendente),
          clamp(p.estoque_minimo),
          clamp(p.reservado),
          clamp(p.fisico),
        ]);
        count++;
      }

      await cli.query('COMMIT');
      const ms = Date.now() - startedAt;
      return res.json({ ok:true, imported: count, local: localCodigo, data_posicao: dataISO, ms });
    } catch (e) {
      await cli.query('ROLLBACK'); throw e;
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
        cmc,
        familia_codigo     AS "familiaCodigo",
        familia_descricao  AS "familiaNome"
      FROM v_almoxarifado_grid_atual
      WHERE local = $1
        AND COALESCE(saldo,0) != 0
      ORDER BY codigo
    `, [local]);

    const dados = rows.map(r => ({
      codigo       : r.codigo || '',
      descricao    : r.descricao || '',
      min          : Number(r.min)       || 0,
      fisico       : Number(r.fisico)    || 0,
      reservado    : Number(r.reservado) || 0,
      saldo        : Number(r.saldo)     || 0,
      cmc          : Number(r.cmc)       || 0,
      familiaCodigo: r.familiaCodigo || '',
      familiaNome  : r.familiaNome || '',
    }));

    res.json({ ok:true, local, pagina:1, totalPaginas:1, dados });
  } catch (err) {
    console.error('[armazem/producao SQL]', err);
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});

// Endpoint para buscar todas as OPs da tabela OrdemProducao.tab_op (agora com data_impressao)
app.post('/api/ops/all', express.json(), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        id,
        numero_op,
        codigo_produto,
        codigo_produto_id,
        tipo_etiqueta,
        local_impressao,
        impressa,
        data_criacao,
        data_impressao,
        etapa,
        observacoes,
        usuario_criacao
      FROM "OrdemProducao".tab_op
      WHERE COALESCE(TRIM(UPPER(etapa)),'') <> 'EXCLUIDO'
      ORDER BY data_criacao DESC
    `);

    const ops = rows.map(r => ({
      id: r.id,
      numero_op: r.numero_op || '',
      codigo_produto: r.codigo_produto || '',
      local_impressao: r.local_impressao || '',
      tipo_etiqueta: r.tipo_etiqueta || '',
      impressa: !!r.impressa,
      data_criacao: r.data_criacao,
      data_impressao: r.data_impressao || null,
      etapa: r.etapa || null,
      observacoes: r.observacoes || '',
      usuario_criacao: r.usuario_criacao || '',
      // Status baseado em data_impressao: vazio = aguardando, preenchido = fila
      status: r.data_impressao ? 'fila' : 'aguardando',
      quantidade: 1
    }));

    res.json({ ok: true, ops });
  } catch (err) {
    console.error('[/api/ops/all] Erro:', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Endpoint para atualizar o prazo de uma OP
app.post('/api/ops/atualizar-prazo', express.json(), async (req, res) => {
  try {
    const { opId, prazo } = req.body;
    
    if (!opId) {
      return res.status(400).json({ success: false, error: 'ID da OP não informado' });
    }
    
    // Atualiza o campo de observações com o prazo (ou crie um campo específico se necessário)
    const { rowCount } = await pool.query(`
      UPDATE "OrdemProducao".tab_op
      SET observacoes = COALESCE(observacoes, '') || ' | Prazo: ' || $2
      WHERE id = $1
    `, [opId, prazo]);
    
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'OP não encontrada' });
    }
    
    res.json({ success: true, message: 'Prazo atualizado com sucesso' });
  } catch (err) {
    console.error('[/api/ops/atualizar-prazo] Erro:', err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// Endpoint para atualizar data_impressao de uma OP (guia Preparação)
app.post('/api/ops/atualizar-data-impressao', express.json(), async (req, res) => {
  try {
    const { id, numero_op, data_impressao } = req.body;
    
    if (!id && !numero_op) {
      return res.status(400).json({ success: false, error: 'ID ou número da OP não informado' });
    }
    
    if (!data_impressao) {
      return res.status(400).json({ success: false, error: 'Data de impressão não informada' });
    }
    
    const whereClause = id ? 'id = $1' : 'numero_op = $1';
    const whereValue = id || numero_op;
    
    const { rowCount } = await pool.query(`
      UPDATE "OrdemProducao".tab_op
      SET data_impressao = $2
      WHERE ${whereClause}
    `, [whereValue, data_impressao]);
    
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: 'OP não encontrada' });
    }
    
    res.json({ success: true, message: 'Data de impressão atualizada com sucesso' });
  } catch (err) {
    console.error('[/api/ops/atualizar-data-impressao] Erro:', err);
    res.status(500).json({ success: false, error: String(err.message || err) });
  }
});

// helpers locais deste bloco
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fetchWithTimeout = async (url, opts = {}, ms = 60000) => {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(id); }
};

app.post('/api/omie/produto', async (req, res) => {
  try {
    const data = await callOmieDedup(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      {
        call:       req.body.call,   // ex.: "ConsultarProduto"
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:      req.body.param
      },
      { waitMs: 5000 }
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
  app.use('/api/auth',     authRouter);
  app.use('/api/etiquetas', etiquetasRouter);   // ⬅️  NOVO
  app.use('/api/users', require('./routes/users'));

  // ——————————————————————————————
  // 3.3) Chat simples (arquivo JSON)
  // ——————————————————————————————
  function loadChatMessages() {
    try {
      if (!fs.existsSync(CHAT_FILE)) return [];
      const raw = fs.readFileSync(CHAT_FILE, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[chat] falha ao ler chat.json:', e?.message || e);
      return [];
    }
  }
  function saveChatMessages(msgs) {
    try {
      fs.writeFileSync(CHAT_FILE, JSON.stringify(msgs, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.warn('[chat] falha ao gravar chat.json:', e?.message || e);
      return false;
    }
  }

  // Lista usuários (id e username) – usa users.json/BD já existente
  // ============================================================================
  // ROTAS DE CHAT - Sistema de mensagens interno
  // ============================================================================
  
  // Lista usuários ativos disponíveis para chat (exclui o próprio usuário logado)
  app.get('/api/chat/users', ensureLoggedIn, async (req, res) => {
    try {
      const currentUserId = req.session.user.id;
      if (CHAT_DEBUG) console.log('[CHAT API] Buscando usuários para user ID:', currentUserId);
      let users = [];
      
      if (isDbEnabled) {
        try {
          if (CHAT_DEBUG) console.log('[CHAT API] Consultando banco de dados...');
          // Usa função SQL que filtra usuários ativos e retorna contagem de não lidas
          const { rows } = await pool.query(
            'SELECT * FROM get_active_chat_users($1)',
            [currentUserId]
          );
          if (CHAT_DEBUG) console.log('[CHAT API] Usuários retornados do SQL:', rows.length);
          users = rows.map(r => ({
            id: String(r.id),
            username: r.username,
            email: r.email,
            unreadCount: parseInt(r.unread_count || 0)
          }));
        } catch (err) {
          console.error('[CHAT] Erro ao buscar usuários ativos:', err);
        }
      }
      
      // Fallback para users.json se DB falhar ou não estiver disponível
      if (!users.length) {
        if (CHAT_DEBUG) console.log('[CHAT API] Usando fallback users.json');
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        const arr = JSON.parse(raw);
        users = (arr || [])
          .filter(u => String(u.id) !== String(currentUserId))
          .map(u => ({ 
            id: String(u.id), 
            username: u.username,
            unreadCount: 0 
          }));
      }
      
      if (CHAT_DEBUG) console.log('[CHAT API] Total de usuários a retornar:', users.length);
      res.json({ users });
    } catch (e) {
      console.error('[CHAT] Erro ao carregar usuários:', e);
      res.status(500).json({ error: 'Falha ao carregar usuários' });
    }
  });

  // Obter conversa entre usuário logado e outro usuário
  app.get('/api/chat/conversation', ensureLoggedIn, async (req, res) => {
    try {
      const me = req.session.user.id;
      const other = req.query.userId;
      
      if (!other) {
        return res.status(400).json({ error: 'userId obrigatório' });
      }
      
      let messages = [];
      
      if (isDbEnabled) {
        try {
          // Usa função SQL para obter histórico da conversa
          const { rows } = await pool.query(
            'SELECT * FROM get_conversation($1, $2, 100)',
            [me, other]
          );
          
          messages = rows.map(r => ({
            id: String(r.id),
            from: String(r.from_user_id),
            to: String(r.to_user_id),
            text: r.message_text,
            timestamp: r.created_at,
            read: r.is_read
          }));
          
          // Marca mensagens como lidas quando abre a conversa
          await pool.query(
            'SELECT mark_messages_as_read($1, $2)',
            [me, other]
          );
          
        } catch (err) {
          console.error('[CHAT] Erro ao buscar conversa:', err);
        }
      }
      
      // Fallback para arquivo JSON
      if (!messages.length && !isDbEnabled) {
        const all = loadChatMessages();
        messages = all
          .filter(m => (m.from === String(me) && m.to === String(other)) || 
                       (m.from === String(other) && m.to === String(me)))
          .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
      }
      
      res.json({ messages });
    } catch (e) {
      console.error('[CHAT] Erro ao carregar conversa:', e);
      res.status(500).json({ error: 'Falha ao carregar conversa' });
    }
  });

  // Enviar nova mensagem
  app.post('/api/chat/send', ensureLoggedIn, express.json(), async (req, res) => {
    try {
      const me = req.session.user.id;
      const { to, text } = req.body || {};
      const content = String(text || '').trim();
      
      if (!to || !content) {
        return res.status(400).json({ error: 'Parâmetros inválidos' });
      }
      
      let message = null;
      
      if (isDbEnabled) {
        try {
          // Usa função SQL para enviar mensagem (valida usuários ativos automaticamente)
          const { rows } = await pool.query(
            'SELECT send_chat_message($1, $2, $3) as message_id',
            [me, to, content]
          );
          
          const messageId = rows[0].message_id;
          
          // Busca a mensagem recém criada para retornar
          const { rows: msgRows } = await pool.query(
            'SELECT * FROM chat_messages WHERE id = $1',
            [messageId]
          );
          
          if (msgRows.length > 0) {
            const r = msgRows[0];
            message = {
              id: String(r.id),
              from: String(r.from_user_id),
              to: String(r.to_user_id),
              text: r.message_text,
              timestamp: r.created_at,
              read: r.is_read
            };
          }
          
        } catch (err) {
          console.error('[CHAT] Erro ao enviar mensagem:', err);
          // Se erro SQL for de validação, retorna erro específico
          if (err.message) {
            return res.status(400).json({ error: err.message });
          }
        }
      }
      
      // Fallback para arquivo JSON
      if (!message && !isDbEnabled) {
        const all = loadChatMessages();
        message = {
          id: String(Date.now()),
          from: String(me),
          to: String(to),
          text: content,
          timestamp: new Date().toISOString(),
          read: false
        };
        all.push(message);
        saveChatMessages(all);
      }
      
      if (message) {
        res.json({ ok: true, message });
      } else {
        res.status(500).json({ error: 'Falha ao enviar mensagem' });
      }
      
    } catch (e) {
      console.error('[CHAT] Erro ao enviar mensagem:', e);
      res.status(500).json({ error: 'Falha ao enviar mensagem' });
    }
  });

  // Contar mensagens não lidas (para badge de notificação)
  app.get('/api/chat/unread-count', ensureLoggedIn, async (req, res) => {
    try {
      const userId = req.session.user.id;
      let count = 0;
      
      if (isDbEnabled) {
        try {
          const { rows } = await pool.query(
            'SELECT count_unread_messages($1) as count',
            [userId]
          );
          count = parseInt(rows[0].count || 0);
        } catch (err) {
          console.error('[CHAT] Erro ao contar não lidas:', err);
        }
      } else {
        // Fallback para arquivo JSON
        const all = loadChatMessages();
        count = all.filter(m => m.to === String(userId) && !m.read).length;
      }
      
      res.json({ count });
    } catch (e) {
      console.error('[CHAT] Erro ao contar mensagens não lidas:', e);
      res.status(500).json({ error: 'Falha ao contar mensagens' });
    }
  });

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

// PCP (estrutura a partir do SQL) — manter só um app.use para evitar execução duplicada
app.use('/api/pcp', pcpEstruturaRoutes);

// ===== Endpoints de configuração de campos obrigatórios =====

// GET: Lista todos os campos cadastrados
app.get('/api/config/campos-produto', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS configuracoes');
    await client.query(`
      CREATE TABLE IF NOT EXISTS configuracoes.campos_guias (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        guia text NOT NULL,
        chave text NOT NULL,
        rotulo text,
        habilitado boolean DEFAULT false,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE(guia, chave)
      )
    `);

    const result = await client.query(`
      SELECT id, guia, chave, rotulo, habilitado
      FROM configuracoes.campos_guias
      ORDER BY guia, rotulo NULLS LAST, chave
    `);

    res.json({ ok: true, campos: result.rows });
  } catch (e) {
    console.error('[GET /api/config/campos-produto] erro:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  } finally {
    client.release();
  }
});

// POST: Escaneia e salva novos campos (não sobrescreve existentes)
app.post('/api/config/campos-produto/scan', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const campos = req.body.campos || [];
    
    if (!campos.length) {
      return res.json({ ok: true, novos: 0 });
    }

    await client.query('BEGIN');
    
    await client.query('CREATE SCHEMA IF NOT EXISTS configuracoes');
    await client.query(`
      CREATE TABLE IF NOT EXISTS configuracoes.campos_guias (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        guia text NOT NULL,
        chave text NOT NULL,
        rotulo text,
        habilitado boolean DEFAULT false,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE(guia, chave)
      )
    `);

    let novos = 0;
    
    for (const campo of campos) {
      const result = await client.query(`
        INSERT INTO configuracoes.campos_guias (guia, chave, rotulo, habilitado)
        VALUES ($1, $2, $3, false)
        ON CONFLICT (guia, chave) DO UPDATE
        SET rotulo = EXCLUDED.rotulo,
            updated_at = now()
        RETURNING (xmax = 0) AS inserted
      `, [campo.guia, campo.chave, campo.rotulo]);
      
      if (result.rows[0]?.inserted) {
        novos++;
      }
    }
    
    await client.query('COMMIT');
    res.json({ ok: true, novos, total: campos.length });
    
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /api/config/campos-produto/scan] erro:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  } finally {
    client.release();
  }
});

// POST: Atualiza o estado habilitado dos campos
app.post('/api/config/campos-produto', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const updates = req.body.updates || [];
    
    if (!updates.length) {
      return res.json({ ok: true });
    }

    await client.query('BEGIN');
    
    for (const upd of updates) {
      await client.query(`
        UPDATE configuracoes.campos_guias
        SET habilitado = $1, updated_at = now()
        WHERE id = $2
      `, [upd.habilitado, upd.id]);
    }
    
    await client.query('COMMIT');
    res.json({ ok: true });
    
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /api/config/campos-produto] erro:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  } finally {
    client.release();
  }
});

// GET: Busca configuração de campos obrigatórios de uma família
app.get('/api/config/familia-campos/:familiaCodigo', async (req, res) => {
  try {
    const { familiaCodigo } = req.params;
    
    // Busca todos os campos disponíveis
    const camposResult = await pool.query(`
      SELECT id, guia, chave, rotulo, habilitado
      FROM configuracoes.campos_guias
      ORDER BY guia, rotulo
    `);
    
    // Busca campos marcados como obrigatórios para esta família
    const obrigatoriosResult = await pool.query(`
      SELECT campo_chave
      FROM configuracoes.familia_campos_obrigatorios
      WHERE familia_codigo = $1 AND obrigatorio = true
    `, [familiaCodigo]);
    
    const obrigatorios = new Set(obrigatoriosResult.rows.map(r => r.campo_chave));
    
    // Adiciona flag 'obrigatorio' em cada campo
    const campos = camposResult.rows.map(c => ({
      ...c,
      obrigatorio: obrigatorios.has(c.chave)
    }));
    
    res.json(campos);
  } catch (e) {
    console.error('[GET /api/config/familia-campos] erro:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});

// POST: Salva configuração de campos obrigatórios para uma família
app.post('/api/config/familia-campos', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const { familiaCodigo, camposObrigatorios } = req.body;
    
    if (!familiaCodigo) {
      return res.status(400).json({ error: 'familiaCodigo é obrigatório' });
    }
    
    await client.query('BEGIN');
    
    // Remove configuração anterior desta família
    await client.query(`
      DELETE FROM configuracoes.familia_campos_obrigatorios
      WHERE familia_codigo = $1
    `, [familiaCodigo]);
    
    // Insere novos campos obrigatórios
    if (Array.isArray(camposObrigatorios) && camposObrigatorios.length > 0) {
      const values = camposObrigatorios
        .map((chave, idx) => `($1, $${idx + 2}, true)`)
        .join(',');
      
      const params = [familiaCodigo, ...camposObrigatorios];
      
      await client.query(`
        INSERT INTO configuracoes.familia_campos_obrigatorios (familia_codigo, campo_chave, obrigatorio)
        VALUES ${values}
      `, params);
    }
    
    await client.query('COMMIT');
    res.json({ ok: true, campos: camposObrigatorios.length });
    
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /api/config/familia-campos] erro:', e);
    res.status(500).json({ error: e.message || String(e) });
  } finally {
    client.release();;
  }
});


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

  // Lista famílias persistidas (cria tabela se não existir e sincroniza se vazia)
  app.get('/api/familia/list', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA IF NOT EXISTS configuracoes');
      await client.query(`CREATE TABLE IF NOT EXISTS configuracoes.familia (
        cod text PRIMARY KEY,
        nome_familia text NOT NULL,
        tipo text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

      const sel = await client.query('SELECT cod, nome_familia, tipo FROM configuracoes.familia ORDER BY nome_familia ASC');
      let rows = sel.rows || [];

      if (!rows.length) {
        // busca na Omie e persiste
        const data = await omieCall(
          'https://app.omie.com.br/api/v1/geral/familias/',
          {
            call: 'PesquisarFamilias',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{ pagina:1, registros_por_pagina:50 }]
          }
        );
        const fams = Array.isArray(data?.famCadastro) ? data.famCadastro : [];
        if (fams.length) {
          for (const f of fams) {
            const codigo = f?.codigo != null ? String(f.codigo) : null;
            const nome   = f?.nomeFamilia || null;
            if (!codigo || !nome) continue;
            await client.query(
              `INSERT INTO configuracoes.familia(cod, nome_familia)
               VALUES ($1, $2)
               ON CONFLICT (cod) DO UPDATE SET nome_familia=EXCLUDED.nome_familia, updated_at=now()`,
              [codigo, nome]
            );
          }
          const sel2 = await client.query('SELECT cod, nome_familia, tipo FROM configuracoes.familia ORDER BY nome_familia ASC');
          rows = sel2.rows || [];
        }
      }
      await client.query('COMMIT');
      res.json({ ok:true, familias: rows });
    } catch(e){
      await client.query('ROLLBACK').catch(()=>{});
      res.status(500).json({ ok:false, error: e.message || String(e) });
    } finally { client.release(); }
  });

  // Atualiza o código de uma família específica
  app.patch('/api/familia/:codigo/cod', express.json(), async (req, res) => {
    const { codigo } = req.params;
    const { newCod } = req.body;
    if (!codigo) return res.status(400).json({ ok:false, error:'Código original obrigatório' });
    if (!newCod) return res.status(400).json({ ok:false, error:'Novo código obrigatório' });
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Verifica se o novo código já existe
      const check = await client.query(
        `SELECT cod FROM configuracoes.familia WHERE cod = $1`,
        [newCod]
      );
      
      if (check.rowCount > 0 && newCod !== codigo) {
        throw new Error('Código já existe');
      }
      
      // Atualiza o código (como é chave primária, precisa criar novo registro e deletar o antigo)
      const oldData = await client.query(
        `SELECT nome_familia, tipo, created_at FROM configuracoes.familia WHERE cod = $1`,
        [codigo]
      );
      
      if (!oldData.rowCount) {
        throw new Error('Família não encontrada');
      }
      
      const { nome_familia, tipo, created_at } = oldData.rows[0];
      
      // Deleta o antigo
      await client.query(`DELETE FROM configuracoes.familia WHERE cod = $1`, [codigo]);
      
      // Insere com novo código
      await client.query(
        `INSERT INTO configuracoes.familia (cod, nome_familia, tipo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [newCod, nome_familia, tipo, created_at]
      );
      
      await client.query('COMMIT');
      res.json({ ok:true });
    } catch(e){
      await client.query('ROLLBACK').catch(()=>{});
      res.status(500).json({ ok:false, error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Atualiza o Tipo de uma família específica
  app.patch('/api/familia/:codigo/tipo', express.json(), async (req, res) => {
    const { codigo } = req.params;
    const { tipo } = req.body;
    if (!codigo) return res.status(400).json({ ok:false, error:'Código obrigatório' });
    const tipoStr = tipo != null ? String(tipo).trim() : '';
    try {
      const result = await pool.query(
        `UPDATE configuracoes.familia SET tipo=$1, updated_at=now() WHERE cod=$2 RETURNING cod, nome_familia, tipo`,
        [tipoStr || null, codigo]
      );
      if (!result.rowCount) return res.status(404).json({ ok:false, error:'Família não encontrada' });
      res.json({ ok:true, familia: result.rows[0] });
    } catch(e){
      res.status(500).json({ ok:false, error: e.message || String(e) });
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
        // Auditoria: alteração de cadastro do produto (Omie) - TODOS os campos
        try {
          const usuarioAudit = userFromReq(req);
          const payload = req.body?.produto_servico_cadastro || {};
          const codigoTxt  = String(payload?.codigo || payload?.cod_int || '').trim();
        
          let produtoAntes = null, codigoId = null;
          if (codigoTxt) {
            try {
              const q = await pool.query(
                `SELECT * FROM public.produtos_omie
                  WHERE codigo = $1 OR codigo_produto_integracao = $1
                  LIMIT 1`,
                [codigoTxt]
              );
              if (q.rowCount) {
                produtoAntes = q.rows[0];
                codigoId = produtoAntes.codigo_produto || null;
              }
            } catch {}
          }

          // Mapeamento de campos do payload para nomes amigáveis
          const campoLabels = {
            codigo: 'Código',
            descricao: 'Descrição',
            descricao_familia: 'Descrição família',
            codigo_familia: 'Código família',
            unidade: 'Unidade',
            tipoItem: 'Tipo item',
            marca: 'Marca',
            modelo: 'Modelo',
            descr_detalhada: 'Descrição detalhada',
            obs_internas: 'Obs internas',
            ncm: 'NCM',
            cfop: 'CFOP',
            origem: 'Origem mercadoria',
            cest: 'CEST',
            aliquota_ibpt: 'Alíquota IBPT',
            inativo: 'Inativo',
            bloqueado: 'Bloqueado',
            bloquear_exclusao: 'Bloquear exclusão',
            valor_unitario: 'Valor unitário',
            peso_bruto: 'Peso bruto',
            peso_liq: 'Peso líquido',
            altura: 'Altura',
            largura: 'Largura',
            profundidade: 'Profundidade',
            dias_crossdocking: 'Dias crossdocking',
            dias_garantia: 'Dias garantia',
            exibir_descricao_pedido: 'Exibir descrição no pedido',
            exibir_descricao_nfe: 'Exibir descrição na NF-e'
          };

          // Mapeamento de campos do DB para campos do payload (alguns têm nomes diferentes)
          const dbParaPayload = {
            tipoitem: 'tipoItem',
            origem_mercadoria: 'origem'
          };

          // Detecta campos alterados
          const camposAlterados = [];
          if (produtoAntes) {
            Object.keys(payload).forEach(key => {
              if (key === 'codigo') return; // código é o identificador, não mudança
            
              const dbKey = Object.keys(dbParaPayload).find(k => dbParaPayload[k] === key) || key;
              const valorAntes = produtoAntes[dbKey];
              const valorDepois = payload[key];
            
              // Normaliza valores para comparação (null, undefined, '' são equivalentes)
              const antesNorm = (valorAntes === null || valorAntes === undefined || valorAntes === '') ? null : String(valorAntes).trim();
              const depoisNorm = (valorDepois === null || valorDepois === undefined || valorDepois === '') ? null : String(valorDepois).trim();
            
              if (antesNorm !== depoisNorm) {
                const label = campoLabels[key] || key;
                camposAlterados.push({
                  campo: label,
                  antes: antesNorm || '(vazio)',
                  depois: depoisNorm || '(vazio)'
                });
              }
            });
          }

          // Só registra se houver alterações detectadas
          if (camposAlterados.length > 0 && (codigoTxt || codigoId)) {
            const listaCampos = camposAlterados.map(c => c.campo).join(', ');
            const detalhesLinhas = ['Origem: OMIE', `Campos: ${listaCampos}`, ''];
          
            camposAlterados.forEach(c => {
              detalhesLinhas.push(`${c.campo}:`);
              detalhesLinhas.push(`  antes: ${c.antes}`);
              detalhesLinhas.push(`  depois: ${c.depois}`);
              detalhesLinhas.push('');
            });
          
            const detalhes = detalhesLinhas.join('\n');

            await registrarModificacao({
              codigo_omie: codigoTxt || String(codigoId || ''),
              codigo_texto: codigoTxt || null,
              codigo_produto: codigoId || null,
              tipo_acao: 'ALTERACAO_CADASTRO',
              usuario: usuarioAudit,
              origem: 'OMIE',
              detalhes
            });
          }
        } catch (e) {
          console.warn('[auditoria][produtos/alterar] falhou ao registrar:', e?.message || e);
        }
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // Endpoint GET: Buscar produto individual por código
  app.get('/api/produtos/:codigo', async (req, res) => {
    try {
      const codigo = req.params.codigo;
      
      // Busca no banco local primeiro
      const result = await pool.query(
        `SELECT 
          codigo,
          descricao,
          lead_time,
          estoque_minimo,
          url_imagem,
          descricao_familia,
          codigo_familia,
          saldo_estoque
        FROM public.produtos_omie 
        WHERE codigo = $1 
        LIMIT 1`,
        [codigo]
      );
      
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Produto não encontrado' });
      }
      
      res.json(result.rows[0]);
    } catch (err) {
      console.error('[API] GET /api/produtos/:codigo erro:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Endpoint PUT: Atualizar produto (apenas campos permitidos)
  app.put('/api/produtos/:codigo', express.json(), async (req, res) => {
    try {
      const codigo = req.params.codigo;
      const { descricao, lead_time, estoque_minimo, url_imagem } = req.body;
      
      // Valida se o produto existe
      const checkResult = await pool.query(
        'SELECT codigo FROM public.produtos_omie WHERE codigo = $1 LIMIT 1',
        [codigo]
      );
      
      if (checkResult.rowCount === 0) {
        return res.status(404).json({ error: 'Produto não encontrado' });
      }
      
      // Atualiza apenas os campos permitidos
      const updateResult = await pool.query(
        `UPDATE public.produtos_omie 
        SET 
          descricao = COALESCE($1, descricao),
          lead_time = $2,
          estoque_minimo = $3,
          url_imagem = $4,
          updated_at = NOW()
        WHERE codigo = $5
        RETURNING *`,
        [descricao, lead_time, estoque_minimo, url_imagem, codigo]
      );
      
      // Auditoria
      try {
        const usuarioAudit = userFromReq(req);
        const campos = [];
        if (descricao) campos.push(`Descrição: ${descricao}`);
        if (lead_time !== undefined) campos.push(`Lead time: ${lead_time}`);
        if (estoque_minimo !== undefined) campos.push(`Estoque mínimo: ${estoque_minimo}`);
        if (url_imagem !== undefined) campos.push('URL imagem atualizada');
        
        await registrarModificacao({
          codigo_omie: codigo,
          codigo_texto: codigo,
          codigo_produto: null,
          tipo_acao: 'ALTERACAO_CATALOGO',
          usuario: usuarioAudit,
          origem: 'CATALOGO_WEB',
          detalhes: `Campos alterados: ${campos.join(', ')}`
        });
      } catch (e) {
        console.warn('[auditoria][produtos/:codigo PUT] falhou:', e?.message || e);
      }
      
      res.json({ 
        success: true, 
        message: 'Produto atualizado com sucesso',
        produto: updateResult.rows[0]
      });
    } catch (err) {
      console.error('[API] PUT /api/produtos/:codigo erro:', err);
      res.status(500).json({ error: err.message });
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
      // Auditoria: alteração de característica do produto (Omie)
      try {
        const usuarioAudit = userFromReq(req);
        // Procura campo cod_int/codigo dentro do primeiro param
        const p0 = Array.isArray(req.body?.param) ? req.body.param[0] : (req.body?.param || {});
        const codigoTxt = String(p0?.cod_int || p0?.codigo || '').trim();
        let codigoId = null;
        if (codigoTxt) {
          try {
            const q = await pool.query(
              `SELECT codigo_produto FROM public.produtos_omie WHERE codigo = $1 OR codigo_produto_integracao = $1 LIMIT 1`,
              [codigoTxt]
            );
            codigoId = q.rows?.[0]?.codigo_produto || null;
          } catch {}
        }
        const detalhes = Object.keys(p0 || {})
          .filter(k => k !== 'cod_int' && k !== 'codigo')
          .slice(0,30)
          .join(', ');
        if (codigoTxt || codigoId) {
          await registrarModificacao({
            codigo_omie: codigoTxt || String(codigoId || ''),
            codigo_texto: codigoTxt || null,
            codigo_produto: codigoId || null,
            tipo_acao: 'ALTERACAO_CARACTERISTICA',
            usuario: usuarioAudit,
            origem: 'OMIE',
            detalhes: `Campos: ${detalhes}`
          });
        }
      } catch (e) {
        console.warn('[auditoria][prodcaract/alterar] falhou ao registrar:', e?.message || e);
      }
      res.json(data);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });


  // ——————————————————————————————
  // 3.4) Rotas de “malha” (estrutura de produto)
  // ——————————————————————————————
// app.post('/api/malha', async (req, res) => {
//   try {
//     const result = await require('./routes/helpers/malhaEstrutura')(req.body);
//     res.json(result);
//   } catch (err) {
//     if (err.message.includes('Client-103') || err.message.includes('não encontrado')) {
//       return res.json({ itens: [] });
//     }
//     res.status(err.status || 500).json({ error: err.message });
//   }
// });


// ─────────────────────────────────────────────────────────────────────────────
// /api/omie/malha → AGORA VEM DO SQL (sem Omie)
// Aceita tanto cCodigo (código do produto) quanto intProduto.idProduto.
// Monta um payload "tipo Omie" simplificado para o front engolir sem mudança.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/omie/malha', express.json(), async (req, res) => {
  try {
    const param = (Array.isArray(req.body?.param) && req.body.param[0]) || {};
    const cCodigo = param?.cCodigo || null;
    const idProduto = param?.intProduto?.idProduto || param?.idProduto || null;

    // 1) Descobrir código se vier só idProduto
    let codigo = cCodigo;
    let ident = { idProduto: null, codProduto: null, descrProduto: null, unidProduto: null };

    if (!codigo && idProduto) {
      const { rows } = await dbQuery(`
        SELECT codigo AS cod, descricao AS descr, unidade AS un, codigo_produto AS id
        FROM public.produtos_omie
        WHERE codigo_produto = $1
        LIMIT 1;
      `, [idProduto]);
      if (!rows.length) return res.json({ ident: null, itens: [], source: 'sql' });
      codigo = rows[0].cod;
      ident = { idProduto: rows[0].id, codProduto: codigo, descrProduto: rows[0].descr, unidProduto: rows[0].un };
    }

    // 2) Se vier com código, preencher ident
    if (codigo && !ident.codProduto) {
      const { rows } = await dbQuery(`
        SELECT codigo_produto AS id, codigo AS cod, descricao AS descr, unidade AS un
        FROM public.produtos_omie
        WHERE codigo = $1
        LIMIT 1;
      `, [codigo]);
      if (rows.length) {
        ident = { idProduto: rows[0].id, codProduto: rows[0].cod, descrProduto: rows[0].descr, unidProduto: rows[0].un };
      } else {
        ident = { idProduto: null, codProduto: codigo, descrProduto: null, unidProduto: null };
      }
    }

    if (!codigo) {
      res.set('Cache-Control', 'no-store');
      return res.json({ ident, itens: [], source: 'sql' });
    }

    // 3) Buscar estrutura no SQL, tentando views mais novas → antigas → tabelas
    const lookupMatrix = [
      {
        tag: 'view_v3',
        sql: `
          SELECT comp_codigo, comp_descricao, comp_unid, comp_qtd, comp_operacao, comp_destino, custo_real
          FROM public.vw_estrutura_para_front_v3
          WHERE pai_cod_produto = $1 OR CAST(pai_cod_produto AS TEXT) = $1
          ORDER BY comp_descricao NULLS LAST, comp_codigo
        `,
        map: (r) => ({
          cod_item: r.comp_codigo,
          desc_item: r.comp_descricao,
          unid_item: r.comp_unid,
          quantidade: r.comp_qtd,
          operacao: r.comp_operacao || r.comp_destino || null,
          custo_real: r.custo_real ?? null,
        }),
      },
      {
        tag: 'view_v2',
        sql: `
          SELECT comp_codigo, comp_descricao, comp_unid, comp_qtd, comp_operacao, custo_real
          FROM public.vw_estrutura_para_front_v2
          WHERE pai_cod_produto = $1 OR CAST(pai_cod_produto AS TEXT) = $1
          ORDER BY comp_descricao NULLS LAST, comp_codigo
        `,
        map: (r) => ({
          cod_item: r.comp_codigo,
          desc_item: r.comp_descricao,
          unid_item: r.comp_unid,
          quantidade: r.comp_qtd,
          operacao: r.comp_operacao || null,
          custo_real: r.custo_real ?? null,
        }),
      },
      {
        tag: 'view_v1',
        sql: `
          SELECT comp_codigo, comp_descricao, comp_unid, comp_qtd, comp_operacao, custo_real
          FROM public.vw_estrutura_para_front
          WHERE pai_cod_produto = $1 OR CAST(pai_cod_produto AS TEXT) = $1
          ORDER BY comp_descricao NULLS LAST, comp_codigo
        `,
        map: (r) => ({
          cod_item: r.comp_codigo,
          desc_item: r.comp_descricao,
          unid_item: r.comp_unid,
          quantidade: r.comp_qtd,
          operacao: r.comp_operacao || null,
          custo_real: r.custo_real ?? null,
        }),
      },
      {
        tag: 'tabelas',
        sql: `
          SELECT
            COALESCE(i.cod_prod_malha, (i.id_prod_malha)::text, i.int_prod_malha) AS comp_codigo,
            i.descr_prod_malha                                                   AS comp_descricao,
            i.unid_prod_malha                                                    AS comp_unid,
            i.quant_prod_malha                                                   AS comp_qtd,
            NULLIF(COALESCE(i.operacao, i.comp_operacao, i.obs_prod_malha), '')  AS comp_operacao,
            i.custo_real                                                         AS custo_real,
            i.int_prod_malha                                                     AS int_prod_malha,
            i.int_malha                                                          AS int_malha
          FROM public.omie_estrutura_item i
          JOIN public.omie_estrutura e ON e.id = i.parent_id
          WHERE e.cod_produto = $1 OR e.cod_produto::text = $1
          ORDER BY i.descr_prod_malha NULLS LAST, comp_codigo
        `,
        map: (r) => ({
          cod_item: r.comp_codigo,
          desc_item: r.comp_descricao,
          unid_item: r.comp_unid,
          quantidade: r.comp_qtd,
          operacao: r.comp_operacao || null,
          custo_real: r.custo_real ?? null,
          int_prod_malha: r.int_prod_malha || null,
          int_malha: r.int_malha || null,
        }),
      },
    ];

    let itensSql = [];
    for (const attempt of lookupMatrix) {
      try {
        const { rows } = await dbQuery(attempt.sql, [codigo]);
        if (rows?.length) {
          itensSql = rows.map(attempt.map);
          break;
        }
      } catch (e) {
        // tenta próxima opção
      }
    }

    // 4) Montar payload compatível (simplificado) com o que o front já consome
    const payload = {
      ident,
      itens: itensSql
        .filter(r => r.cod_item != null)
        .map((r, i) => {
          const codigoItem = r.cod_item != null ? String(r.cod_item) : null;
          const descricaoItem = r.desc_item != null ? String(r.desc_item) : null;
          const unidadeItem = r.unid_item ? String(r.unid_item) : 'UN';
          const quantidadeRaw = r.quantidade;
          const quantidadeNum = quantidadeRaw == null ? null : Number(quantidadeRaw);
        const operacao = r.operacao || null;
        const custoReal = r.custo_real != null ? Number(r.custo_real) : null;
        const intProdMalha = r.int_prod_malha ? String(r.int_prod_malha) : null;
        const intMalha = r.int_malha ? String(r.int_malha) : null;

        return {
          pos: i + 1,
          codigo: codigoItem,
          descricao: descricaoItem,
          unidade: unidadeItem,
          quantidade: quantidadeNum,
          operacao,
          codProdMalha: codigoItem,
          descrProdMalha: descricaoItem,
          unidProdMalha: unidadeItem,
          quantProdMalha: quantidadeNum,
          compOperacao: operacao,
          custoReal,
          intProdMalha,
          intMalha
        };
      }),
      source: 'sql'
    };

    // nada de Omie aqui, então nenhum [omieCall] vai aparecer
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (err) {
    console.error('[server][malha/sql] erro:', err);
    return res.status(500).json({ error: 'Falha ao consultar estrutura (SQL).' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Proxy direto para OMIE (geral/malha) SOMENTE para chamadas específicas.
// NÃO usa SQL; serve para ConsultarEstrutura / ExcluirEstrutura / AlterarEstrutura / IncluirEstrutura.
// Front chama: POST /api/omie/malha/call  { call, param: [ {...} ] }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/omie/malha/call', express.json(), async (req, res) => {
  try {
    const { call, param } = req.body || {};
    if (!call || !Array.isArray(param)) {
      return res.status(400).json({ ok:false, error: 'Envie { call, param }' });
    }

    // 🔴 AGORA permitimos também AlterarEstrutura e IncluirEstrutura
    const ALLOW = new Set(['ConsultarEstrutura', 'ExcluirEstrutura', 'AlterarEstrutura', 'IncluirEstrutura']);
    if (!ALLOW.has(call)) {
      return res.status(400).json({ ok:false, error: `Método não permitido: ${call}` });
    }

    const omieCall = require('./utils/omieCall');
    const payload = {
      call,
      app_key   : process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param
    };

    const json = await omieCall('https://app.omie.com.br/api/v1/geral/malha/', payload);

    // OMIE pode retornar { faultstring, faultcode } em 200; preserve isso
    if (json?.faultstring) {
      return res.status(400).json(json);
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json(json);
  } catch (err) {
    console.error('[server][omie/malha/call][ERR]', err);
    return res.status(err.status || 500).json({ ok:false, error: err.message || 'Falha ao chamar OMIE' });
  }
});

  
  // ─────────────────────────────────────────────────────────────────────────────
// Resolve o ID OMIE do produto (para usar como idProdMalha / idProduto)
// usando as fontes na ORDEM especificada pelo usuário:
//
//  1) public.produtos_omie
//       - código → codigo_produto
//       - codigo_produto_integracao → codigo_produto
//  2) public.omie_estrutura
//       - int_produto | cod_produto → id_produto
//  3) public.omie_malha_cab
//       - produto_codigo → produto_id
//  4) public.omie_estoque_posicao
//       - codigo → omie_prod_id
//
// Retorno: { ok:true, codigo, codigo_produto, origem }
//
// OBS: não dá 500 se não achar; retorna 404 com mensagem clara.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/sql/produto-id/:codigo', async (req, res) => {
  const { codigo } = req.params;
  const client = await pool.connect();

  try {
    // 1) produtos_omie
    {
      const r = await client.query(`
        SELECT codigo::text AS codigo,
               codigo_produto::bigint AS id,
               'public.produtos_omie(codigo→codigo_produto)' AS origem
        FROM public.produtos_omie
        WHERE codigo = $1
        UNION ALL
        SELECT codigo_produto_integracao::text AS codigo,
               codigo_produto::bigint AS id,
               'public.produtos_omie(codigo_produto_integracao→codigo_produto)' AS origem
        FROM public.produtos_omie
        WHERE codigo_produto_integracao = $1
        LIMIT 1;
      `, [codigo]);

      if (r.rowCount) {
        const row = r.rows[0];
        return res.json({ ok: true, codigo: row.codigo, codigo_produto: Number(row.id), origem: row.origem });
      }
    }

    // 2) omie_estrutura (int_produto | cod_produto → id_produto)
    {
      const r = await client.query(`
        SELECT int_produto::text AS codigo, id_produto::bigint AS id,
               'public.omie_estrutura(int_produto→id_produto)' AS origem
        FROM public.omie_estrutura
        WHERE int_produto = $1
        UNION ALL
        SELECT cod_produto::text AS codigo, id_produto::bigint AS id,
               'public.omie_estrutura(cod_produto→id_produto)' AS origem
        FROM public.omie_estrutura
        WHERE cod_produto = $1
        LIMIT 1;
      `, [codigo]);

      if (r.rowCount) {
        const row = r.rows[0];
        return res.json({ ok: true, codigo: row.codigo, codigo_produto: Number(row.id), origem: row.origem });
      }
    }

    // 3) omie_malha_cab (produto_codigo → produto_id)
    {
      const r = await client.query(`
        SELECT produto_codigo::text AS codigo, produto_id::bigint AS id,
               'public.omie_malha_cab(produto_codigo→produto_id)' AS origem
        FROM public.omie_malha_cab
        WHERE produto_codigo = $1
        LIMIT 1;
      `, [codigo]);

      if (r.rowCount) {
        const row = r.rows[0];
        return res.json({ ok: true, codigo: row.codigo, codigo_produto: Number(row.id), origem: row.origem });
      }
    }

    // 4) omie_estoque_posicao (codigo → omie_prod_id)
    {
      const r = await client.query(`
        SELECT codigo::text AS codigo, omie_prod_id::bigint AS id,
               'public.omie_estoque_posicao(codigo→omie_prod_id)' AS origem
        FROM public.omie_estoque_posicao
        WHERE codigo = $1
        LIMIT 1;
      `, [codigo]);

      if (r.rowCount) {
        const row = r.rows[0];
        return res.json({ ok: true, codigo: row.codigo, codigo_produto: Number(row.id), origem: row.origem });
      }
    }

    // nada encontrado
    return res.status(404).json({
      ok: false,
      error: `ID não encontrado para "${codigo}" nas tabelas mapeadas.`
    });
  } catch (err) {
    console.error('[SQL][produto-id][ERR]', err);
    return res.status(500).json({ ok: false, error: 'Falha ao procurar ID do produto no SQL.' });
  } finally {
    client.release();
  }
});



// dentro do seu IIFE, logo após:
//   app.post('/api/omie/malha', …)
// e antes de: app.use('/api/malha/consultar', malhaConsultar);
// app.post('/api/omie/estrutura', express.json(), async (req, res) => {
//   try {
//     const data = await omieCall(
//       'https://app.omie.com.br/api/v1/geral/malha/',
//       { call: 'ConsultarEstrutura', app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: req.body.param }
//     );
//     return res.json(data);
//   } catch (err) {
//     console.error('[estrutura] erro →', err.faultstring || err.message);
//     return res.status(err.status || 500).json({ error: err.faultstring || err.message });
//   }
// });




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
  // Extrai usuário da sessão ou do header enviado pelo front (#userNameDisplay)
  const fromSession = (req.session?.user?.fullName)
                  || (req.session?.user?.username)
                  || (req.session?.user?.login);
  const fromHeader = String(req.headers?.['x-user'] || '').trim();
  return (fromSession && String(fromSession).trim()) || (fromHeader || 'sistema');
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
  maxAge: 0,
  setHeaders: (res, p) => {
    if (p.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
    if (p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));


// ────────────────────────────────────────────
// 5) Só para rotas HTML do seu SPA, devolva o index
// ────────────────────────────────────────────
// Isso não intercepta /menu_produto.js, /requisicoes_omie/xx.js, etc.
app.get(['/', '/menu_produto.html', '/kanban/*'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
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
  const normalizarStatus = (valor) => {
    const t = String(valor ?? '').trim().toLowerCase();
    if (!t) return null;
    if (t === 'a produzir' || t === 'fila de produção' || t === 'fila de producao') return 'A Produzir';
    if (t === 'produzindo' || t === 'em produção' || t === 'em producao') return 'Produzindo';
    if (t === 'teste 1' || t === 'teste1') return 'teste 1';
    if (t === 'teste final' || t === 'testefinal') return 'teste final';
    if (t === 'produzido') return 'Produzido';
    if (t === 'concluido' || t === 'concluído' || t === '60' || t === '80') return 'concluido';
    return null;
  };

  try {
    // garante a tabela de overlay (legado ainda utilizado em outros fluxos)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.op_status_overlay (
        op         text PRIMARY KEY,
        status     text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await pool.query(`
      WITH ranked AS (
        SELECT
          TRIM(UPPER(e.numero_op))        AS numero_op,
          TRIM(UPPER(e.codigo_produto))   AS codigo_produto,
          NULLIF(TRIM(e.etapa), '')       AS etapa,
          e.data_impressao,
          e.data_criacao,
          e.id,
          ROW_NUMBER() OVER (
            PARTITION BY TRIM(UPPER(e.numero_op)), TRIM(UPPER(e.codigo_produto))
            ORDER BY
              COALESCE(e.data_impressao, e.data_criacao) DESC NULLS LAST,
              e.id DESC
          ) AS rn
  FROM "OrdemProducao".tab_op e
        WHERE UPPER(e.local_impressao) IN (
          'QUADRO ELÉTRICO',
          'QUADRO ELETRICO'
        )
      )
      SELECT
        r.numero_op,
        r.codigo_produto,
        r.etapa,
        r.data_impressao,
        ov.status AS overlay_status
      FROM ranked r
      LEFT JOIN public.op_status_overlay ov ON ov.op = r.numero_op
      WHERE r.rn = 1
      ORDER BY r.numero_op
    `);

    const data = {
      'A Produzir':  [],
      'Produzindo':  [],
      'teste 1':     [],
      'teste final': [],
      'Produzido':   []
    };

    for (const row of rows) {
      const op = row.numero_op;
      const produtoCodigo = row.codigo_produto;
      if (!op || !produtoCodigo) continue;

      let status = normalizarStatus(row.overlay_status);
      const etapaNorm = normalizarStatus(row.etapa);

      if (!status) {
        status = etapaNorm;
      }

      if (!status && (!row.etapa || row.etapa === '') && row.data_impressao) {
        status = 'A Produzir';
      }

      if (!status) continue;

      if (status === 'A Produzir') {
        // Requisito: etapa vazia e data_impressao preenchida
        if (row.data_impressao && (!row.etapa || row.etapa === '')) {
          data['A Produzir'].push({ op, produto_codigo: produtoCodigo });
        }
        continue;
      }

      if (status === 'Produzindo') {
        data['Produzindo'].push({ op, produto_codigo: produtoCodigo });
        continue;
      }

      if (status === 'Produzido') {
        data['Produzido'].push({ op, produto_codigo: produtoCodigo });
        continue;
      }

      if (status === 'concluido') {
        if (etapaNorm === 'Produzido') {
          data['Produzido'].push({ op, produto_codigo: produtoCodigo });
        }
        continue;
      }

      if (data[status]) {
        data[status].push({ op, produto_codigo: produtoCodigo });
      }
    }

    res.json({ mode: 'pg', data });
  } catch (err) {
    console.error('[preparacao/listar] erro:', err);
    res.status(500).json({ ok:false, error:String(err?.message || err) });
  }
});

app.post('/api/preparacao/op/estrutura', express.json(), async (req, res) => {
  const opBruta       = String(req.body?.op || '').trim();
  const produtoCodigo = String(req.body?.produtoCodigo || '').trim();

  if (!opBruta || !produtoCodigo) {
    return res.status(400).json({ ok: false, error: 'Parâmetros op e produtoCodigo obrigatórios.' });
  }

  const opUpper = opBruta.toUpperCase();
  const versaoMatch = opUpper.match(/-V(\d+)(C\d+)?$/);
  const versaoNumero = versaoMatch ? Number.parseInt(versaoMatch[1], 10) : null;
  const sufixoCustom = versaoMatch && versaoMatch[2] ? versaoMatch[2].toUpperCase() : null;

  const client = await pool.connect();
  try {
    const normalizadoCodigo = produtoCodigo.trim();

    const { rows: cabRows } = await client.query(
      `
        SELECT id, COALESCE(versao,1) AS versao, cod_produto
          FROM public.omie_estrutura
         WHERE TRIM(UPPER(cod_produto)) = TRIM(UPPER($1))
         ORDER BY versao DESC, updated_at DESC NULLS LAST, id DESC
      `,
      [normalizadoCodigo]
    );

    const parentIdBase = cabRows?.[0]?.id || null;
    let cabSelecionada = null;
    if (versaoNumero != null) {
      cabSelecionada = cabRows.find(r => Number(r.versao) === versaoNumero) || null;
    }
    if (!cabSelecionada && cabRows.length) {
      cabSelecionada = cabRows[0];
    }

    let itens = [];
    let origem = null;
    let versaoUtilizada = cabSelecionada ? Number(cabSelecionada.versao || versaoNumero || 1) : (versaoNumero || 1);

    if (cabSelecionada) {
      const { rows } = await client.query(
        `
          SELECT
            id,
            parent_id,
            cod_prod_malha,
            descr_prod_malha,
            quant_prod_malha,
            unid_prod_malha,
            operacao,
            perc_perda_prod_malha
          FROM public.omie_estrutura_item
          WHERE parent_id = $1
          ORDER BY cod_prod_malha, descr_prod_malha
        `,
        [cabSelecionada.id]
      );
      itens = rows;
      origem = 'omie_estrutura_item';
    }

    if ((!itens || itens.length === 0) && parentIdBase && versaoNumero != null) {
      const { rows } = await client.query(
        `
          SELECT
            id,
            parent_id,
            cod_prod_malha,
            descr_prod_malha,
            quant_prod_malha,
            unid_prod_malha,
            operacao,
            perc_perda_prod_malha
          FROM public.omie_estrutura_item_versao
          WHERE parent_id = $1
            AND versao = $2
          ORDER BY cod_prod_malha, descr_prod_malha
        `,
        [parentIdBase, versaoNumero]
      );
      if (rows && rows.length) {
        itens = rows;
        origem = 'omie_estrutura_item_versao';
        versaoUtilizada = versaoNumero;
      }
    }

    if (!itens || itens.length === 0) {
      return res.json({
        ok: true,
        itens: [],
        meta: {
          versao: versaoUtilizada,
          custom_suffix: sufixoCustom,
          origem: null,
          personalizacoes: [],
          produto_codigo: normalizadoCodigo
        }
      });
    }

    const estruturaBase = itens.map(row => {
      const codigoBase = (row.cod_prod_malha || '').trim();
      return {
        codigo_original: codigoBase,
        codigo: codigoBase,
        descricao: (row.descr_prod_malha || '').trim(),
        unidade: (row.unid_prod_malha || '').trim(),
        quantidade: Number(row.quant_prod_malha || 0),
        operacao: (row.operacao || '').trim(),
        perc_perda: Number(row.perc_perda_prod_malha || 0),
        customizado: false,
        personalizacao_id: null,
        substituido_por: null,
        quantidade_personalizada: null
      };
    });

    let personalizacaoIds = [];
    if (sufixoCustom) {
      const { rows: persRows } = await client.query(
        `
        SELECT id
          FROM public.pcp_personalizacao
         WHERE TRIM(UPPER(numero_referencia)) = TRIM(UPPER($1))
         ORDER BY id
        `,
        [opUpper]
      );
      personalizacaoIds = persRows.map(r => Number(r.id));
      if (personalizacaoIds.length) {
        const { rows: itensPers } = await client.query(
          `
            SELECT
              personalizacao_id,
              codigo_original,
              codigo_trocado,
              descricao_original,
              descricao_trocada,
              quantidade
            FROM public.pcp_personalizacao_item
            WHERE personalizacao_id = ANY($1::bigint[])
          `,
          [personalizacaoIds]
        );

        const normalizaCodigo = (val) => (val || '').trim().toUpperCase();
        itensPers.forEach(pi => {
          const originalKey = normalizaCodigo(pi.codigo_original);
          if (!originalKey) return;
          const idx = estruturaBase.findIndex(item => normalizaCodigo(item.codigo_original) === originalKey);
          if (idx >= 0) {
            const alvo = estruturaBase[idx];
            const codigoNovo = (pi.codigo_trocado || '').trim();
            const descricaoNova = (pi.descricao_trocada || '').trim();
            alvo.customizado = true;
            alvo.personalizacao_id = Number(pi.personalizacao_id);
            alvo.substituido_por = codigoNovo || null;
            if (codigoNovo) alvo.codigo = codigoNovo;
            if (descricaoNova) alvo.descricao = descricaoNova;
            if (pi.quantidade != null) {
              const qtdPersonalizada = Number(pi.quantidade);
              if (!Number.isNaN(qtdPersonalizada)) {
                alvo.quantidade_personalizada = qtdPersonalizada;
                alvo.quantidade = qtdPersonalizada;
              }
            }
          } else {
            const codigoNovo = (pi.codigo_trocado || '').trim();
            estruturaBase.push({
              codigo_original: (pi.codigo_original || '').trim(),
              codigo: codigoNovo || (pi.codigo_original || '').trim(),
              descricao: (pi.descricao_trocada || pi.descricao_original || '').trim(),
              unidade: '',
              quantidade: pi.quantidade != null ? Number(pi.quantidade) : 0,
              operacao: '',
              perc_perda: 0,
              customizado: true,
              personalizacao_id: Number(pi.personalizacao_id),
              substituido_por: codigoNovo || null,
              quantidade_personalizada: pi.quantidade != null ? Number(pi.quantidade) : null
            });
          }
        });
      }
    }

    res.json({
      ok: true,
      itens: estruturaBase,
      meta: {
        versao: versaoUtilizada,
        custom_suffix: sufixoCustom,
        origem,
        personalizacoes: personalizacaoIds,
        produto_codigo: normalizadoCodigo
      }
    });
  } catch (err) {
    console.error('[preparacao][estrutura_por_op] erro:', err);
    res.status(500).json({ ok: false, error: 'Falha ao montar estrutura do produto.' });
  } finally {
    client.release();
  }
});

app.post('/api/etiquetas/op/:op/etapa', express.json(), async (req, res) => {
  const op = String(req.params.op || '').trim().toUpperCase();
  const etapa = String(req.body?.etapa || '').trim();
  const produtoCodigoRaw = req.body?.produto_codigo;
  const produtoCodigo = produtoCodigoRaw ? String(produtoCodigoRaw).trim().toUpperCase() : null;

  if (!op || !etapa) {
    return res.status(400).json({ ok: false, error: 'Informe OP e etapa.' });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
    `SELECT DISTINCT TRIM(UPPER(codigo_produto)) AS codigo_produto
      FROM "OrdemProducao".tab_op
        WHERE TRIM(UPPER(numero_op)) = $1` ,
      [op]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, reason: 'op_nao_encontrada' });
    }

    if (produtoCodigo) {
      const hasMatch = rows.some(r => (r.codigo_produto || '') === produtoCodigo);
      if (!hasMatch) {
        return res.status(409).json({ ok: false, reason: 'produto_mismatch' });
      }
    }

    const params = produtoCodigo ? [etapa, op, produtoCodigo] : [etapa, op];
    const sql = produtoCodigo
      ? `UPDATE "OrdemProducao".tab_op
            SET etapa = $1
          WHERE TRIM(UPPER(numero_op)) = $2
            AND TRIM(UPPER(codigo_produto)) = $3`
      : `UPDATE "OrdemProducao".tab_op
            SET etapa = $1
          WHERE TRIM(UPPER(numero_op)) = $2`;

    const up = await client.query(sql, params);
    return res.json({ ok: true, updated: up.rowCount });
  } catch (err) {
    console.error('[etiquetas][set etapa]', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar etapa.' });
  } finally {
    client.release();
  }
});

app.post('/api/etiquetas/op/:op/reativar', express.json(), async (req, res) => {
  const op = String(req.params.op || '').trim().toUpperCase();
  const produtoCodigoRaw = req.body?.produto_codigo;
  const produtoCodigo = produtoCodigoRaw ? String(produtoCodigoRaw).trim().toUpperCase() : null;

  if (!op) {
    return res.status(400).json({ ok: false, error: 'Informe a OP.' });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
    `SELECT DISTINCT TRIM(UPPER(codigo_produto)) AS codigo_produto
      FROM "OrdemProducao".tab_op
        WHERE TRIM(UPPER(numero_op)) = $1`,
      [op]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, reason: 'op_nao_encontrada' });
    }

    if (produtoCodigo) {
      const hasMatch = rows.some(r => (r.codigo_produto || '') === produtoCodigo);
      if (!hasMatch) {
        return res.status(409).json({ ok: false, reason: 'produto_mismatch' });
      }
    }

    const sql = produtoCodigo
  ? `UPDATE "OrdemProducao".tab_op
            SET etapa = NULL,
                data_impressao = NULL,
                impressa = FALSE
          WHERE TRIM(UPPER(numero_op)) = $1
            AND TRIM(UPPER(codigo_produto)) = $2`
  : `UPDATE "OrdemProducao".tab_op
            SET etapa = NULL,
                data_impressao = NULL,
                impressa = FALSE
          WHERE TRIM(UPPER(numero_op)) = $1`;

    const params = produtoCodigo ? [op, produtoCodigo] : [op];
    const up = await client.query(sql, params);
    return res.json({ ok: true, updated: up.rowCount });
  } catch (err) {
    console.error('[etiquetas][reativar]', err);
    return res.status(500).json({ ok: false, error: 'Falha ao reativar OP.' });
  } finally {
    client.release();
  }
});

app.post('/api/etiquetas/op/etapas', express.json(), async (req, res) => {
  let ops = req.body?.ops;
  if (typeof ops === 'string') ops = [ops];
  if (!Array.isArray(ops)) ops = [];

  const wanted = [...new Set(ops.map(op => String(op || '').trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) {
    return res.json({ ok: true, data: {} });
  }

  try {
    const { rows } = await pool.query(
      `
      WITH ranked AS (
        SELECT
          TRIM(UPPER(numero_op)) AS numero_op,
          etapa,
          ROW_NUMBER() OVER (
            PARTITION BY TRIM(UPPER(numero_op))
            ORDER BY (etapa IS NULL) ASC,
                     data_impressao DESC NULLS LAST,
                     data_criacao  DESC NULLS LAST,
                     id DESC
          ) AS rn
  FROM "OrdemProducao".tab_op
        WHERE TRIM(UPPER(numero_op)) = ANY($1)
      )
      SELECT numero_op, etapa
        FROM ranked
       WHERE rn = 1
      `,
      [wanted]
    );

    const map = {};
    rows.forEach(r => {
      map[r.numero_op] = r.etapa != null ? String(r.etapa).trim() : null;
    });

    return res.json({ ok: true, data: map });
  } catch (err) {
    console.error('[etiquetas][etapas]', err);
    return res.status(500).json({ ok: false, error: 'Falha ao consultar etapas.' });
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
      'Pedido aprovado'    : [],
      'Aguardando prazo'   : [],
      'Fila de produção'   : []
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
    const [aprovados, aguardando, fila, excluidos] = await Promise.all([
      pool.query(`
        SELECT
          i.codigo_pedido,
          i.codigo            AS produto_codigo,
          i.descricao         AS produto_descricao,
          i.quantidade,
          i.unidade,
          p.numero_pedido,
          p.numero_pedido_cliente,
          p.codigo_cliente,
          p.data_previsao,
          to_char(p.data_previsao, 'DD/MM/YYYY') AS data_previsao_br
        FROM public.pedidos_venda_itens i
        JOIN public.pedidos_venda p
          ON p.codigo_pedido = i.codigo_pedido
        WHERE p.etapa = '80'
        ORDER BY
          upper(i.codigo) ASC NULLS LAST,
          p.data_previsao ASC NULLS LAST,
          p.numero_pedido ASC
        LIMIT 2000
      `),
      pool.query(`
        SELECT
          id,
          numero_op,
          codigo_produto,
          tipo_etiqueta,
          local_impressao,
          data_criacao,
          data_impressao,
          impressa,
          usuario_criacao,
          etapa
  FROM "OrdemProducao".tab_op
        WHERE tipo_etiqueta = 'Aguardando prazo'
          AND (impressa IS DISTINCT FROM TRUE)
          AND data_impressao IS NULL
          AND (etapa IS NULL OR lower(etapa) NOT IN ('excluido','excluído'))
        ORDER BY
          upper(local_impressao) ASC NULLS LAST,
          upper(codigo_produto)  ASC NULLS LAST,
          data_criacao           ASC,
          id                     ASC
        LIMIT 2000
      `),
      pool.query(`
        SELECT
          id,
          numero_op,
          codigo_produto,
          tipo_etiqueta,
          local_impressao,
          data_criacao,
          data_impressao,
          impressa,
          usuario_criacao,
          etapa
  FROM "OrdemProducao".tab_op
        WHERE tipo_etiqueta = 'Aguardando prazo'
          AND data_impressao IS NOT NULL
          AND (etapa IS NULL OR lower(etapa) NOT IN ('excluido','excluído'))
        ORDER BY
          data_impressao ASC,
          upper(local_impressao) ASC NULLS LAST,
          upper(codigo_produto)  ASC NULLS LAST,
          id ASC
        LIMIT 2000
      `),
      pool.query(`
        SELECT
          id,
          numero_op,
          codigo_produto,
          tipo_etiqueta,
          local_impressao,
          data_criacao,
          data_impressao,
          impressa,
          usuario_criacao,
          etapa
  FROM "OrdemProducao".tab_op
        WHERE tipo_etiqueta = 'Aguardando prazo'
          AND lower(COALESCE(etapa, '')) IN ('excluido','excluído')
        ORDER BY
          upper(local_impressao) ASC NULLS LAST,
          upper(codigo_produto)  ASC NULLS LAST,
          id ASC
        LIMIT 2000
      `)
    ]);

    return res.json({
      ok: true,
      colunas: {
        'Pedido aprovado'  : aprovados.rows,
        'Aguardando prazo': aguardando.rows,
        'Fila de produção': fila.rows,
        'Excluido': excluidos.rows
      }
    });
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

// === ATIVIDADES ESPECÍFICAS DO PRODUTO (Check-Proj) ===
// Criar nova atividade específica para um produto
app.post('/api/engenharia/atividade-produto', express.json(), async (req, res) => {
  try {
    const { produto_codigo, descricao, observacoes } = req.body;
    
    if (!produto_codigo || !descricao) {
      return res.status(400).json({ error: 'produto_codigo e descricao são obrigatórios' });
    }
    
    const insertQuery = `
      INSERT INTO engenharia.atividades_produto 
        (produto_codigo, descricao, observacoes, ativo, criado_em)
      VALUES ($1, $2, $3, true, NOW())
      RETURNING id, produto_codigo, descricao, observacoes, ativo, criado_em
    `;
    
    const { rows } = await pool.query(insertQuery, [produto_codigo, descricao, observacoes || null]);
    
    console.log(`[API] Nova atividade criada para produto ${produto_codigo}: ${descricao}`);
    res.json({ success: true, atividade: rows[0] });
  } catch (err) {
    console.error('[API] /api/engenharia/atividade-produto erro:', err);
    res.status(500).json({ error: 'Falha ao criar atividade do produto' });
  }
});

// Listar atividades específicas de um produto
app.get('/api/engenharia/atividades-produto/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    
    const query = `
      SELECT 
        ap.id,
        ap.produto_codigo,
        ap.descricao AS nome,
        ap.observacoes,
        ap.ativo,
        ap.criado_em,
        COALESCE(aps.concluido, false) AS concluido,
        COALESCE(aps.nao_aplicavel, false) AS nao_aplicavel,
        COALESCE(aps.observacao_status, '') AS observacao_status,
        aps.responsavel_username AS responsavel,
        aps.autor_username AS autor,
        aps.prazo,
        aps.atualizado_em
      FROM engenharia.atividades_produto ap
      LEFT JOIN engenharia.atividades_produto_status_especificas aps
        ON aps.atividade_produto_id = ap.id AND aps.produto_codigo = ap.produto_codigo
      WHERE ap.produto_codigo = $1 AND ap.ativo = true
      ORDER BY ap.criado_em DESC
    `;
    
    const { rows } = await pool.query(query, [codigo]);
    res.json({ atividades: rows });
  } catch (err) {
    console.error('[API] /api/engenharia/atividades-produto erro:', err);
    res.status(500).json({ error: 'Falha ao buscar atividades do produto' });
  }
});

// Salvar status das atividades específicas do produto (em massa)
app.post('/api/engenharia/atividade-produto-status/bulk', express.json(), async (req, res) => {
  try {
    const { produto_codigo, itens } = req.body;
    
    if (!produto_codigo || !Array.isArray(itens)) {
      return res.status(400).json({ error: 'produto_codigo e itens são obrigatórios' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const item of itens) {
        const { atividade_produto_id, concluido, nao_aplicavel, observacao, responsavel, autor, prazo } = item;
        const prazoDate = prazo ? new Date(prazo) : null;
        
        await client.query(`
          INSERT INTO engenharia.atividades_produto_status_especificas 
            (atividade_produto_id, produto_codigo, concluido, nao_aplicavel, observacao_status, atualizado_em, responsavel_username, autor_username, prazo)
          VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
          ON CONFLICT (atividade_produto_id, produto_codigo)
          DO UPDATE SET
            concluido = EXCLUDED.concluido,
            nao_aplicavel = EXCLUDED.nao_aplicavel,
            observacao_status = EXCLUDED.observacao_status,
            atualizado_em = NOW(),
            responsavel_username = EXCLUDED.responsavel_username,
            autor_username = EXCLUDED.autor_username,
            prazo = EXCLUDED.prazo
        `, [
          atividade_produto_id,
          produto_codigo,
          concluido,
          nao_aplicavel,
          observacao || '',
          responsavel || null,
          autor || null,
          prazoDate
        ]);
      }
      
      await client.query('COMMIT');
      
      console.log(`[API] Status de ${itens.length} atividade(s) específica(s) salvo para produto ${produto_codigo}`);
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[API] /api/engenharia/atividade-produto-status/bulk erro:', err);
    res.status(500).json({ error: 'Falha ao salvar status das atividades específicas' });
  }
});

// ===================== COMPRAS - CARRINHO DE PEDIDOS =====================

// Cria schema e tabela de solicitações de compras com número de pedido
async function ensureComprasSchema() {
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS compras`);
    
    // Cria tabela se não existir
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras.solicitacao_compras (
        id SERIAL PRIMARY KEY,
        numero_pedido TEXT,
        produto_codigo TEXT NOT NULL,
        produto_descricao TEXT,
        quantidade NUMERIC(15,4) DEFAULT 0,
        prazo_solicitado DATE,
        previsao_chegada DATE,
        status TEXT DEFAULT 'pendente',
        observacao TEXT,
        observacao_reprovacao TEXT,
        solicitante TEXT,
        responsavel TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Adiciona coluna numero_pedido se não existir (migração)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'numero_pedido'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN numero_pedido TEXT;
        END IF;
      END $$;
    `);
    
    // Renomeia colunas antigas se existirem
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'observacao_reprovacao'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN observacao_reprovacao TEXT;
        END IF;

        -- Renomeia prazo_estipulado para previsao_chegada se existir
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'prazo_estipulado'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          RENAME COLUMN prazo_estipulado TO previsao_chegada;
        END IF;
        
        -- Renomeia criado_em para created_at se existir
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'criado_em'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          RENAME COLUMN criado_em TO created_at;
        END IF;
        
        -- Renomeia responsavel para resp_inspecao_recebimento se existir
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'responsavel'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          RENAME COLUMN responsavel TO resp_inspecao_recebimento;
        END IF;
        
        -- Remove coluna quem_recebe (substituída por resp_inspecao_recebimento)
        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'quem_recebe'
        ) THEN
          -- Copia dados de quem_recebe para resp_inspecao_recebimento se estiver vazio
          UPDATE compras.solicitacao_compras 
          SET resp_inspecao_recebimento = quem_recebe 
          WHERE resp_inspecao_recebimento IS NULL AND quem_recebe IS NOT NULL;
          
          ALTER TABLE compras.solicitacao_compras 
          DROP COLUMN quem_recebe;
        END IF;
        
        -- Adiciona coluna updated_at se não existir
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'updated_at'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
        END IF;
        
        -- Adiciona coluna fornecedor_nome se não existir
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'fornecedor_nome'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN fornecedor_nome TEXT;
        END IF;
        
        -- Adiciona coluna fornecedor_id se não existir
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'fornecedor_id'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN fornecedor_id TEXT;
        END IF;
        
        -- Adiciona coluna anexos se não existir (JSONB para armazenar array de objetos)
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'anexos'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN anexos JSONB;
        END IF;
        
        -- Adiciona coluna categoria_compra se não existir
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'categoria_compra'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN categoria_compra TEXT;
        END IF;
        
        -- Adiciona coluna categoria_compra_codigo se não existir
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'categoria_compra_codigo'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN categoria_compra_codigo TEXT;
        END IF;

        -- Adiciona coluna grupo_requisicao se não existir
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'grupo_requisicao'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN grupo_requisicao TEXT;
        END IF;
      END $$;
    `);
    
    // Cria tabela para armazenar dados do pedido de compra
    // Objetivo: Separar dados do pedido (que são únicos por numero_pedido) dos itens
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras.ped_compra (
        id SERIAL PRIMARY KEY,
        numero_pedido TEXT UNIQUE NOT NULL,
        fornecedor_nome TEXT,
        fornecedor_id TEXT,
        previsao_entrega DATE,
        categoria_compra TEXT,
        categoria_compra_codigo TEXT,
        cod_parcela TEXT,
        descricao_parcela TEXT,
        
        -- Dados de Frete
        incluir_frete BOOLEAN DEFAULT false,
        transportadora_nome TEXT,
        transportadora_id TEXT,
        tipo_frete TEXT,
        placa_veiculo TEXT,
        uf_veiculo TEXT,
        qtd_volumes INTEGER,
        especie_volumes TEXT,
        marca_volumes TEXT,
        numero_volumes TEXT,
        peso_liquido DECIMAL(15,3),
        peso_bruto DECIMAL(15,3),
        valor_frete DECIMAL(15,2),
        valor_seguro DECIMAL(15,2),
        lacre TEXT,
        outras_despesas DECIMAL(15,2),
        
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    // Cria índice para busca rápida por numero_pedido
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ped_compra_numero 
      ON compras.ped_compra(numero_pedido);
    `);
    
    // Cria tabela de cotações para armazenar múltiplos fornecedores por item
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras.cotacoes (
        id SERIAL PRIMARY KEY,
        solicitacao_id INTEGER NOT NULL,
        fornecedor_nome TEXT NOT NULL,
        fornecedor_id TEXT,
        valor_cotado DECIMAL(15,2),
        observacao TEXT,
        link TEXT,
        anexos JSONB,
        status_aprovacao VARCHAR(20) DEFAULT 'pendente' CHECK (status_aprovacao IN ('pendente', 'aprovado', 'reprovado')),
        criado_por TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Cria índice para busca rápida por solicitacao_id
      CREATE INDEX IF NOT EXISTS idx_cotacoes_solicitacao 
      ON compras.cotacoes(solicitacao_id);
      
      -- Cria índice para busca rápida por status_aprovacao
      CREATE INDEX IF NOT EXISTS idx_cotacoes_status_aprovacao
      ON compras.cotacoes(status_aprovacao);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras.cotacoes_itens (
        id SERIAL PRIMARY KEY,
        cotacao_id INTEGER NOT NULL REFERENCES compras.cotacoes(id) ON DELETE CASCADE,
        item_origem_id INTEGER NOT NULL,
        grupo_requisicao TEXT,
        table_source TEXT NOT NULL DEFAULT 'solicitacao_compras',
        produto_codigo TEXT,
        produto_descricao TEXT,
        quantidade NUMERIC,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (cotacao_id, item_origem_id, table_source)
      );

      CREATE INDEX IF NOT EXISTS idx_cotacoes_itens_cotacao
      ON compras.cotacoes_itens(cotacao_id);

      CREATE INDEX IF NOT EXISTS idx_cotacoes_itens_origem
      ON compras.cotacoes_itens(item_origem_id, table_source);
    `);

    // Migration: Remove constraint de foreign key se existir (para aceitar IDs de compras_sem_cadastro também)
    await pool.query(`
      DO $$ 
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_schema = 'compras' 
          AND table_name = 'cotacoes' 
          AND constraint_name = 'cotacoes_solicitacao_id_fkey'
          AND constraint_type = 'FOREIGN KEY'
        ) THEN
          ALTER TABLE compras.cotacoes 
          DROP CONSTRAINT cotacoes_solicitacao_id_fkey;
        END IF;
      END $$;
    `);
    
    // Migration: Adiciona coluna status_aprovacao se não existir
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'cotacoes' 
          AND column_name = 'status_aprovacao'
        ) THEN
          ALTER TABLE compras.cotacoes 
          ADD COLUMN status_aprovacao VARCHAR(20) DEFAULT 'pendente' 
          CHECK (status_aprovacao IN ('pendente', 'aprovado', 'reprovado'));
          
          -- Cria índice para a nova coluna
          CREATE INDEX idx_cotacoes_status_aprovacao 
          ON compras.cotacoes(status_aprovacao);
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'compras'
          AND table_name = 'cotacoes'
          AND column_name = 'moeda'
        ) THEN
          ALTER TABLE compras.cotacoes
          ADD COLUMN moeda VARCHAR(3) NOT NULL DEFAULT 'BRL'
          CHECK (moeda IN ('BRL', 'USD'));
        END IF;
      END $$;
    `);

    // Migration: Adiciona coluna link se não existir (armazena links da cotação em JSON string)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'cotacoes' 
          AND column_name = 'link'
        ) THEN
          ALTER TABLE compras.cotacoes 
          ADD COLUMN link TEXT;
        END IF;
      END $$;
    `);

    // Migration: Adiciona coluna produto_codigo se não existir e faz backfill
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'cotacoes' 
          AND column_name = 'produto_codigo'
        ) THEN
          ALTER TABLE compras.cotacoes 
          ADD COLUMN produto_codigo TEXT;

          -- Backfill inicial com base na solicitacao_compras
          UPDATE compras.cotacoes c
          SET produto_codigo = s.produto_codigo
          FROM compras.solicitacao_compras s
          WHERE s.id = c.solicitacao_id;
        END IF;
      END $$;
    `);

    // Migration: Adiciona coluna numero_pedido se não existir e faz backfill
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'cotacoes' 
          AND column_name = 'numero_pedido'
        ) THEN
          ALTER TABLE compras.cotacoes 
          ADD COLUMN numero_pedido TEXT;

          -- Backfill inicial com base na solicitacao_compras
          UPDATE compras.cotacoes c
          SET numero_pedido = s.numero_pedido
          FROM compras.solicitacao_compras s
          WHERE s.id = c.solicitacao_id;
        END IF;
      END $$;
    `);

    // Migration: Adiciona coluna table_source se não existir (identifica origem da cotação)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'cotacoes' 
          AND column_name = 'table_source'
        ) THEN
          ALTER TABLE compras.cotacoes 
          ADD COLUMN table_source VARCHAR(50) DEFAULT 'solicitacao_compras';
        END IF;
      END $$;
    `);
    
    // Cria schema configuracoes se não existir
    await pool.query(`CREATE SCHEMA IF NOT EXISTS configuracoes`);
    
    // Cria tabela de departamentos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes.departamento (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL UNIQUE,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Cria tabela de categorias de compra (sync Omie)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes.categoria_compra (
        codigo TEXT PRIMARY KEY,
        descricao TEXT,
        conta_despesa TEXT,
        conta_inativa TEXT,
        categoria_superior TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Cria tabela ListarCategorias (espelho Omie)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes."ListarCategorias" (
        codigo TEXT PRIMARY KEY,
        descricao TEXT,
        conta_despesa TEXT,
        conta_inativa TEXT,
        categoria_superior TEXT,
        natureza TEXT,
        tipo_categoria TEXT,
        codigo_dre TEXT,
        raw JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Popula tabela ListarCategorias na inicialização
    try {
      await syncListarCategoriasOmie();
    } catch (e) {
      console.warn('[Sync ListarCategorias] Falha ao popular na inicialização:', e?.message || e);
    }
    
    // Insere departamentos padrão se não existirem
    await pool.query(`
      INSERT INTO configuracoes.departamento (nome) 
      VALUES 
        ('Administrativo'),
        ('Produção'),
        ('Comercial')
      ON CONFLICT (nome) DO NOTHING
    `);
    
    // Cria tabela de centro de custo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes.centro_custo (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL UNIQUE,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Insere centros de custo padrão se não existirem
    await pool.query(`
      INSERT INTO configuracoes.centro_custo (nome)
      VALUES
        ('Materia prima'),
        ('Investimento na produção'),
        ('Maquinas e equipamentos'),
        ('Manutenção'),
        ('Certificação e qualidade'),
        ('P&D'),
        ('Engenharia'),
        ('Ferramentas'),
        ('Outros')
      ON CONFLICT (nome) DO NOTHING
    `);
    
    // Cria tabela de status de compras
    await pool.query(`
      CREATE TABLE IF NOT EXISTS configuracoes.status_compras (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL UNIQUE,
        ordem INTEGER DEFAULT 0,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Insere status padrão se não existirem
    await pool.query(`
      INSERT INTO configuracoes.status_compras (nome, ordem)
      VALUES
        ('aguardando aprovação', 1),
        ('aguardando cotação', 2),
        ('aguardando compra', 3),
        ('compra realizada', 4),
        ('faturada pelo fornecedor', 5),
        ('aguardando liberação', 6),
        ('compra cancelada', 7),
        ('recebido', 8),
        ('revisão', 9)
      ON CONFLICT (nome) DO NOTHING
    `);
    
    // Adiciona colunas departamento, centro_custo e objetivo_compra na tabela solicitacao_compras
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'departamento'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN departamento TEXT;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'centro_custo'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN centro_custo TEXT;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'objetivo_compra'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN objetivo_compra TEXT;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'anexo_url'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN anexo_url TEXT;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'retorno_cotacao'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN retorno_cotacao TEXT;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'compras' 
          AND table_name = 'solicitacao_compras' 
          AND column_name = 'grupo_requisicao'
        ) THEN
          ALTER TABLE compras.solicitacao_compras 
          ADD COLUMN grupo_requisicao TEXT;
        END IF;
      END $$;
    `);
    
    // Cria índices se não existirem
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_numero_pedido 
        ON compras.solicitacao_compras(numero_pedido);
      CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_solicitante 
        ON compras.solicitacao_compras(solicitante);
      CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_status 
        ON compras.solicitacao_compras(status);
    `);

    // Garante coluna codigo_produto_omie para vincular com produtos_omie (se ainda não existir)
    await pool.query(`
      ALTER TABLE compras.solicitacao_compras
      ADD COLUMN IF NOT EXISTS codigo_produto_omie TEXT;
    `);

    // Backfill: alguns registros antigos gravaram apenas codigo_omie
    // e ficaram sem codigo_produto_omie. Mantém o vínculo padronizado.
    try {
      const backfillCodigoProdutoOmie = await pool.query(`
        UPDATE compras.solicitacao_compras
           SET codigo_produto_omie = codigo_omie
         WHERE (codigo_produto_omie IS NULL OR TRIM(codigo_produto_omie::TEXT) = '')
           AND codigo_omie IS NOT NULL
           AND TRIM(codigo_omie::TEXT) <> '';
      `);
      if (backfillCodigoProdutoOmie.rowCount > 0) {
        console.log(`[Compras] ✓ Backfill codigo_produto_omie concluído (${backfillCodigoProdutoOmie.rowCount} registro(s) atualizado(s))`);
      }
    } catch (backfillCodigoErr) {
      console.warn('[Compras] Aviso no backfill de codigo_produto_omie:', backfillCodigoErr.message);
    }

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_solicitacao_compras_codigo_produto_omie
        ON compras.solicitacao_compras(codigo_produto_omie);
    `);

    // Trigger 1: ao inserir/alterar solicitacao_compras, preenche produto_descricao pela tabela produtos_omie
    await pool.query(`
      CREATE OR REPLACE FUNCTION compras.fn_preencher_desc_solicitacao_por_produto_omie()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $fn$
      DECLARE
        v_descricao TEXT;
      BEGIN
        IF NEW.codigo_produto_omie IS NULL OR TRIM(NEW.codigo_produto_omie::TEXT) = '' THEN
          RETURN NEW;
        END IF;

        SELECT po.descricao
          INTO v_descricao
          FROM public.produtos_omie po
         WHERE po.codigo_produto::TEXT = NEW.codigo_produto_omie::TEXT
         LIMIT 1;

        IF v_descricao IS NOT NULL THEN
          NEW.produto_descricao := v_descricao;
        END IF;

        RETURN NEW;
      EXCEPTION
        WHEN undefined_table THEN
          RETURN NEW;
      END;
      $fn$;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS trg_preencher_desc_solicitacao_por_produto_omie
      ON compras.solicitacao_compras;

      CREATE TRIGGER trg_preencher_desc_solicitacao_por_produto_omie
      BEFORE INSERT OR UPDATE OF codigo_produto_omie
      ON compras.solicitacao_compras
      FOR EACH ROW
      EXECUTE FUNCTION compras.fn_preencher_desc_solicitacao_por_produto_omie();
    `);

    // Trigger 2: quando descrição mudar em produtos_omie, propaga para solicitacao_compras
    await pool.query(`
      CREATE OR REPLACE FUNCTION compras.fn_sync_desc_produto_omie_para_solicitacao()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        IF NEW.codigo_produto IS NULL THEN
          RETURN NEW;
        END IF;

        UPDATE compras.solicitacao_compras sc
           SET produto_descricao = NEW.descricao,
               updated_at = NOW()
         WHERE sc.codigo_produto_omie IS NOT NULL
           AND sc.codigo_produto_omie::TEXT = NEW.codigo_produto::TEXT
           AND COALESCE(sc.produto_descricao, '') IS DISTINCT FROM COALESCE(NEW.descricao, '');

        RETURN NEW;
      END;
      $fn$;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'produtos_omie'
        ) THEN
          DROP TRIGGER IF EXISTS trg_sync_desc_produto_omie_para_solicitacao
          ON public.produtos_omie;

          CREATE TRIGGER trg_sync_desc_produto_omie_para_solicitacao
          AFTER INSERT OR UPDATE OF descricao
          ON public.produtos_omie
          FOR EACH ROW
          EXECUTE FUNCTION compras.fn_sync_desc_produto_omie_para_solicitacao();
        END IF;
      END $$;
    `);

    // Backfill inicial: sincroniza descrições já existentes
    try {
      const backfillDesc = await pool.query(`
        UPDATE compras.solicitacao_compras sc
           SET produto_descricao = po.descricao,
               updated_at = NOW()
          FROM public.produtos_omie po
         WHERE sc.codigo_produto_omie IS NOT NULL
           AND sc.codigo_produto_omie::TEXT = po.codigo_produto::TEXT
           AND COALESCE(sc.produto_descricao, '') IS DISTINCT FROM COALESCE(po.descricao, '');
      `);
      console.log(`[Compras] ✓ Backfill produto_descricao concluído (${backfillDesc.rowCount} registro(s) atualizado(s))`);
    } catch (backfillErr) {
      if (!String(backfillErr?.message || '').includes('does not exist')) {
        console.warn('[Compras] Aviso no backfill de produto_descricao:', backfillErr.message);
      }
    }
    
    // Migration: Corrigir tipo de n_qtde_parc de INTEGER para BIGINT
    // Motivo: Omie envia IDs grandes que não cabem em INTEGER (máximo ~2 bilhões)
    try {
      const typeCheck = await pool.query(`
        SELECT data_type FROM information_schema.columns 
        WHERE table_schema = 'compras' 
        AND table_name = 'pedidos_omie' 
        AND column_name = 'n_qtde_parc'
      `);
      
      if (typeCheck.rows.length > 0 && typeCheck.rows[0].data_type === 'integer') {
        console.log('[Compras] Migrando n_qtde_parc de INTEGER para BIGINT...');
        await pool.query(`
          ALTER TABLE compras.pedidos_omie 
          ALTER COLUMN n_qtde_parc TYPE BIGINT USING n_qtde_parc::BIGINT
        `);
        console.log('[Compras] ✓ Migração de n_qtde_parc concluída');
      }
    } catch (migErr) {
      // Tabela pode não existir ainda, é ok
      if (!migErr.message.includes('does not exist')) {
        console.error('[Compras] Erro na migração de n_qtde_parc:', migErr.message);
      }
    }
    
    // Migration: Adicionar colunas numero e etapa na tabela requisicoes_omie
    // Objetivo: Armazenar número do pedido e etapa do processo vindo do webhook Omie
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'compras' 
            AND table_name = 'requisicoes_omie' 
            AND column_name = 'numero'
          ) THEN
            ALTER TABLE compras.requisicoes_omie 
            ADD COLUMN numero VARCHAR(50);
          END IF;
          
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'compras' 
            AND table_name = 'requisicoes_omie' 
            AND column_name = 'etapa'
          ) THEN
            ALTER TABLE compras.requisicoes_omie 
            ADD COLUMN etapa VARCHAR(50);
          END IF;
        END $$;
      `);
      console.log('[Compras] ✓ Colunas numero e etapa verificadas/criadas em requisicoes_omie');
    } catch (migErr) {
      if (!migErr.message.includes('does not exist')) {
        console.warn('[Compras] Aviso na migração de colunas numero/etapa:', migErr.message);
      }
    }

    // Histórico completo de alterações (solicitacao_compras + compras_sem_cadastro)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras.historico_solicitacao_compras (
        id SERIAL PRIMARY KEY,
        solicitacao_id INTEGER NOT NULL,
        table_source TEXT NOT NULL DEFAULT 'solicitacao_compras',
        operacao TEXT NOT NULL,
        campo_alterado TEXT,
        valor_anterior TEXT,
        valor_novo TEXT,
        usuario TEXT,
        descricao_item TEXT,
        status_item TEXT,
        departamento TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE compras.historico_solicitacao_compras
      ADD COLUMN IF NOT EXISTS table_source TEXT NOT NULL DEFAULT 'solicitacao_compras';

      UPDATE compras.historico_solicitacao_compras
      SET table_source = 'solicitacao_compras'
      WHERE table_source IS NULL OR TRIM(table_source) = '';

      CREATE INDEX IF NOT EXISTS idx_historico_solicitacao_lookup
        ON compras.historico_solicitacao_compras(table_source, solicitacao_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_historico_solicitacao_created
        ON compras.historico_solicitacao_compras(created_at DESC);
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION compras.fn_registrar_historico_solicitacao()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $fn$
      DECLARE
        v_usuario TEXT;
        v_table_source TEXT := COALESCE(TG_TABLE_NAME, 'solicitacao_compras');
        v_descricao_item TEXT;
        v_status_item TEXT;
        v_departamento TEXT;
        v_valor_anterior TEXT;
        v_valor_novo TEXT;
        v_id_item INTEGER;
        rec RECORD;
        j_new JSONB;
        j_old JSONB;
      BEGIN
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          j_new := to_jsonb(NEW);
        ELSE
          j_new := '{}'::jsonb;
        END IF;

        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          j_old := to_jsonb(OLD);
        ELSE
          j_old := '{}'::jsonb;
        END IF;

        BEGIN
          v_usuario := NULLIF(TRIM(COALESCE(current_setting('app.current_user', true), '')), '');
        EXCEPTION WHEN OTHERS THEN
          v_usuario := NULL;
        END;

        IF v_usuario IS NULL THEN
          v_usuario := NULLIF(TRIM(COALESCE(
            j_new->>'usuario_comentario',
            j_old->>'usuario_comentario',
            j_new->>'solicitante',
            j_old->>'solicitante',
            ''
          )), '');
        END IF;

        IF v_usuario IS NULL THEN
          v_usuario := current_user;
        END IF;

        v_descricao_item := COALESCE(
          j_new->>'produto_descricao',
          j_old->>'produto_descricao',
          j_new->>'produto_codigo',
          j_old->>'produto_codigo',
          'Item sem descrição'
        );
        v_status_item := COALESCE(j_new->>'status', j_old->>'status');
        v_departamento := COALESCE(j_new->>'departamento', j_old->>'departamento');
        v_id_item := COALESCE((j_new->>'id')::INTEGER, (j_old->>'id')::INTEGER);

        IF TG_OP = 'INSERT' THEN
          INSERT INTO compras.historico_solicitacao_compras (
            solicitacao_id, table_source, operacao, campo_alterado, valor_anterior, valor_novo,
            usuario, descricao_item, status_item, departamento
          ) VALUES (
            v_id_item, v_table_source, 'INSERT', 'NOVO_ITEM', NULL,
            format('Descrição: %s | Qtd: %s | Solicitante: %s',
              COALESCE(j_new->>'produto_descricao', '-'),
              COALESCE(j_new->>'quantidade', '-'),
              COALESCE(j_new->>'solicitante', '-')),
            v_usuario, v_descricao_item, v_status_item, v_departamento
          );
          RETURN NEW;
        END IF;

        IF TG_OP = 'UPDATE' THEN
          FOR rec IN
            SELECT
              COALESCE(n.key, o.key) AS campo,
              o.value AS valor_antigo,
              n.value AS valor_novo
            FROM jsonb_each(COALESCE(j_new, '{}'::jsonb)) n
            FULL JOIN jsonb_each(COALESCE(j_old, '{}'::jsonb)) o
              ON o.key = n.key
            WHERE COALESCE(n.value, 'null'::jsonb) IS DISTINCT FROM COALESCE(o.value, 'null'::jsonb)
          LOOP
            IF rec.campo IN ('updated_at') THEN
              CONTINUE;
            END IF;

            IF rec.valor_antigo IS NULL OR rec.valor_antigo = 'null'::jsonb THEN
              v_valor_anterior := NULL;
            ELSIF jsonb_typeof(rec.valor_antigo) = 'string' THEN
              v_valor_anterior := rec.valor_antigo #>> '{}';
            ELSE
              v_valor_anterior := rec.valor_antigo::TEXT;
            END IF;

            IF rec.valor_novo IS NULL OR rec.valor_novo = 'null'::jsonb THEN
              v_valor_novo := NULL;
            ELSIF jsonb_typeof(rec.valor_novo) = 'string' THEN
              v_valor_novo := rec.valor_novo #>> '{}';
            ELSE
              v_valor_novo := rec.valor_novo::TEXT;
            END IF;

            INSERT INTO compras.historico_solicitacao_compras (
              solicitacao_id, table_source, operacao, campo_alterado, valor_anterior, valor_novo,
              usuario, descricao_item, status_item, departamento
            ) VALUES (
              v_id_item, v_table_source, 'UPDATE', rec.campo, v_valor_anterior, v_valor_novo,
              v_usuario, v_descricao_item, COALESCE(j_new->>'status', v_status_item), COALESCE(j_new->>'departamento', v_departamento)
            );
          END LOOP;
          RETURN NEW;
        END IF;

        IF TG_OP = 'DELETE' THEN
          INSERT INTO compras.historico_solicitacao_compras (
            solicitacao_id, table_source, operacao, campo_alterado, valor_anterior, valor_novo,
            usuario, descricao_item, status_item, departamento
          ) VALUES (
            v_id_item, v_table_source, 'DELETE', 'ITEM_REMOVIDO',
            format('Descrição: %s | Qtd: %s | Status: %s',
              COALESCE(j_old->>'produto_descricao', '-'),
              COALESCE(j_old->>'quantidade', '-'),
              COALESCE(j_old->>'status', '-')),
            NULL,
            v_usuario, v_descricao_item, v_status_item, v_departamento
          );
          RETURN OLD;
        END IF;

        RETURN NULL;
      END;
      $fn$;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS trg_historico_solicitacao_compras
      ON compras.solicitacao_compras;

      CREATE TRIGGER trg_historico_solicitacao_compras
      AFTER INSERT OR UPDATE OR DELETE
      ON compras.solicitacao_compras
      FOR EACH ROW
      EXECUTE FUNCTION compras.fn_registrar_historico_solicitacao();
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'compras'
            AND table_name = 'compras_sem_cadastro'
        ) THEN
          DROP TRIGGER IF EXISTS trg_historico_compras_sem_cadastro
          ON compras.compras_sem_cadastro;

          CREATE TRIGGER trg_historico_compras_sem_cadastro
          AFTER INSERT OR UPDATE OR DELETE
          ON compras.compras_sem_cadastro
          FOR EACH ROW
          EXECUTE FUNCTION compras.fn_registrar_historico_solicitacao();
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'compras'
            AND table_name = 'historico_compras'
        ) THEN
          CREATE OR REPLACE FUNCTION compras.fn_sync_historico_compras_upsert()
          RETURNS TRIGGER
          LANGUAGE plpgsql
          AS $fn$
          DECLARE
            v_row JSONB := to_jsonb(NEW);
            v_grupo_requisicao TEXT;
            v_status TEXT;
            v_referencia TIMESTAMP;
          BEGIN
            v_grupo_requisicao := NULLIF(BTRIM(v_row->>'grupo_requisicao'), '');
            IF v_grupo_requisicao IS NULL THEN
              RETURN NEW;
            END IF;

            v_status := NULLIF(BTRIM(v_row->>'status'), '');
            IF v_status IS NULL OR LOWER(v_status) = 'carrinho' THEN
              RETURN NEW;
            END IF;

            v_referencia := COALESCE(
              NULLIF(v_row->>'updated_at', '')::timestamp,
              NULLIF(v_row->>'created_at', '')::timestamp,
              NULLIF(v_row->>'criado_em', '')::timestamp,
              NOW()
            );

            UPDATE compras.historico_compras
               SET status = v_status,
                   tabela_origem = TG_TABLE_NAME,
                   dados = v_row,
                   created_at = v_referencia
             WHERE grupo_requisicao = v_grupo_requisicao;

            IF NOT FOUND THEN
              BEGIN
                INSERT INTO compras.historico_compras (
                  grupo_requisicao,
                  status,
                  tabela_origem,
                  dados,
                  created_at
                ) VALUES (
                  v_grupo_requisicao,
                  v_status,
                  TG_TABLE_NAME,
                  v_row,
                  v_referencia
                );
              EXCEPTION WHEN unique_violation THEN
                UPDATE compras.historico_compras
                   SET status = v_status,
                       tabela_origem = TG_TABLE_NAME,
                       dados = v_row,
                       created_at = v_referencia
                 WHERE grupo_requisicao = v_grupo_requisicao;
              END;
            END IF;

            RETURN NEW;
          END;
          $fn$;

          DROP TRIGGER IF EXISTS trg_historico_compras_solicitacao_insert
          ON compras.solicitacao_compras;
          DROP TRIGGER IF EXISTS trg_historico_compras_solicitacao_upsert
          ON compras.solicitacao_compras;

          CREATE TRIGGER trg_historico_compras_solicitacao_upsert
          AFTER INSERT OR UPDATE
          ON compras.solicitacao_compras
          FOR EACH ROW
          EXECUTE FUNCTION compras.fn_sync_historico_compras_upsert();

          DROP TRIGGER IF EXISTS trg_historico_compras_sem_cadastro_insert
          ON compras.compras_sem_cadastro;
          DROP TRIGGER IF EXISTS trg_historico_compras_sem_cadastro_upsert
          ON compras.compras_sem_cadastro;

          CREATE TRIGGER trg_historico_compras_sem_cadastro_upsert
          AFTER INSERT OR UPDATE
          ON compras.compras_sem_cadastro
          FOR EACH ROW
          EXECUTE FUNCTION compras.fn_sync_historico_compras_upsert();

          UPDATE compras.historico_compras hc
             SET status = src.status,
                 tabela_origem = src.tabela_origem,
                 dados = src.dados,
                 created_at = src.referencia_at
            FROM (
              SELECT DISTINCT ON (NULLIF(BTRIM(s.grupo_requisicao), ''))
                NULLIF(BTRIM(s.grupo_requisicao), '') AS grupo_requisicao,
                NULLIF(BTRIM(s.status), '') AS status,
                'solicitacao_compras'::text AS tabela_origem,
                to_jsonb(s) AS dados,
                COALESCE(
                  NULLIF(to_jsonb(s)->>'updated_at', '')::timestamp,
                  NULLIF(to_jsonb(s)->>'created_at', '')::timestamp,
                  NULLIF(to_jsonb(s)->>'criado_em', '')::timestamp,
                  NOW()
                ) AS referencia_at
              FROM compras.solicitacao_compras s
              WHERE NULLIF(BTRIM(s.grupo_requisicao), '') IS NOT NULL
                AND LOWER(COALESCE(BTRIM(s.status), '')) <> 'carrinho'
              ORDER BY
                NULLIF(BTRIM(s.grupo_requisicao), ''),
                COALESCE(
                  NULLIF(to_jsonb(s)->>'updated_at', '')::timestamp,
                  NULLIF(to_jsonb(s)->>'created_at', '')::timestamp,
                  NULLIF(to_jsonb(s)->>'criado_em', '')::timestamp,
                  NOW()
                ) DESC,
                s.id DESC
            ) src
           WHERE hc.grupo_requisicao = src.grupo_requisicao
             AND (
               hc.status IS DISTINCT FROM src.status
               OR hc.tabela_origem IS DISTINCT FROM src.tabela_origem
               OR hc.dados IS DISTINCT FROM src.dados
               OR hc.created_at IS DISTINCT FROM src.referencia_at
             );

          DELETE FROM compras.historico_compras
          WHERE LOWER(COALESCE(BTRIM(status), '')) = 'carrinho';
        END IF;
      END $$;
    `);
    
    console.log('[Compras] Schema e tabela garantidos com migrações aplicadas');
  } catch (e) {
    console.error('[Compras] Erro ao criar schema:', e);
  }
}
ensureComprasSchema();

// ============================================================================
// FORNECEDORES (CLIENTES) DA OMIE
// ============================================================================

async function ensureFornecedoresSchema() {
  try {
    // Cria schema omie se não existir
    await pool.query(`CREATE SCHEMA IF NOT EXISTS omie`);
    
    // Cria tabela de fornecedores
    await pool.query(`
      CREATE TABLE IF NOT EXISTS omie.fornecedores (
        id SERIAL PRIMARY KEY,
        codigo_cliente_omie BIGINT UNIQUE,
        codigo_cliente_integracao TEXT,
        razao_social TEXT,
        nome_fantasia TEXT,
        cnpj_cpf TEXT,
        telefone1_ddd TEXT,
        telefone1_numero TEXT,
        email TEXT,
        endereco TEXT,
        endereco_numero TEXT,
        complemento TEXT,
        bairro TEXT,
        cidade TEXT,
        estado TEXT,
        cep TEXT,
        inativo BOOLEAN DEFAULT false,
        tags TEXT[],
        info JSON,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Cria índices
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_fornecedores_codigo_omie 
        ON omie.fornecedores(codigo_cliente_omie);
      CREATE INDEX IF NOT EXISTS idx_fornecedores_cnpj 
        ON omie.fornecedores(cnpj_cpf);
      CREATE INDEX IF NOT EXISTS idx_fornecedores_nome 
        ON omie.fornecedores(razao_social);
    `);
    
    console.log('[Fornecedores] Schema e tabela garantidos');
  } catch (e) {
    console.error('[Fornecedores] Erro ao criar schema:', e);
  }
}
ensureFornecedoresSchema();

// Sincroniza todos os fornecedores da Omie
async function syncFornecedoresOmie() {
  try {
    console.log('[Fornecedores] Iniciando sincronização com Omie...');
    let pagina = 1;
    let totalSincronizados = 0;
    let continuar = true;
    
    while (continuar) {
      const body = {
        call: 'ListarClientes',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina: pagina,
          registros_por_pagina: 50,
          apenas_importado_api: 'N'
        }]
      };
      
      console.log(`[Fornecedores] Buscando página ${pagina}...`);
      
      const response = await fetch('https://app.omie.com.br/api/v1/geral/clientes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        throw new Error(`Omie API retornou ${response.status}`);
      }
      
      const data = await response.json();
      const clientes = data.clientes_cadastro || [];
      const totalPaginas = data.total_de_paginas || 1;
      const totalRegistros = data.total_de_registros || 0;
      
      console.log(`[Fornecedores] Página ${pagina}/${totalPaginas} - ${clientes.length} registros (Total na Omie: ${totalRegistros})`);
      
      if (!clientes.length) {
        continuar = false;
        break;
      }
      
      // Upsert em batch
      for (const cliente of clientes) {
        await upsertFornecedor(cliente);
        totalSincronizados++;
        
        // Log a cada 500 itens
        if (totalSincronizados % 500 === 0) {
          console.log(`[Fornecedores] ✓ Progresso: ${totalSincronizados} fornecedores sincronizados...`);
        }
      }
      
      // Verifica se tem mais páginas
      if (pagina >= totalPaginas) {
        continuar = false;
      } else {
        pagina++;
      }
    }
    
    console.log(`[Fornecedores] ✓✓✓ Sincronização concluída: ${totalSincronizados} fornecedores sincronizados com sucesso!`);
    return { ok: true, total: totalSincronizados };
  } catch (e) {
    console.error('[Fornecedores] ✗ Erro na sincronização:', e);
    return { ok: false, error: e.message };
  }
}

// Upsert de um fornecedor no banco
async function upsertFornecedor(cliente) {
  try {
    const {
      codigo_cliente_omie,
      codigo_cliente_integracao,
      razao_social,
      nome_fantasia,
      cnpj_cpf,
      telefone1_ddd,
      telefone1_numero,
      email,
      endereco,
      endereco_numero,
      complemento,
      bairro,
      cidade,
      estado,
      cep,
      inativo,
      tags,
      inscricao_estadual,
      inscricao_municipal,
      inscricao_suframa,
      cidade_ibge,
      contato,
      pais,
      pessoa_fisica,
      codigo_pais
    } = cliente;
    
    // Atualizar omie.fornecedores
    await pool.query(`
      INSERT INTO omie.fornecedores (
        codigo_cliente_omie,
        codigo_cliente_integracao,
        razao_social,
        nome_fantasia,
        cnpj_cpf,
        telefone1_ddd,
        telefone1_numero,
        email,
        endereco,
        endereco_numero,
        complemento,
        bairro,
        cidade,
        estado,
        cep,
        inativo,
        tags,
        info,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
      ON CONFLICT (codigo_cliente_omie) 
      DO UPDATE SET
        codigo_cliente_integracao = EXCLUDED.codigo_cliente_integracao,
        razao_social = EXCLUDED.razao_social,
        nome_fantasia = EXCLUDED.nome_fantasia,
        cnpj_cpf = EXCLUDED.cnpj_cpf,
        telefone1_ddd = EXCLUDED.telefone1_ddd,
        telefone1_numero = EXCLUDED.telefone1_numero,
        email = EXCLUDED.email,
        endereco = EXCLUDED.endereco,
        endereco_numero = EXCLUDED.endereco_numero,
        complemento = EXCLUDED.complemento,
        bairro = EXCLUDED.bairro,
        cidade = EXCLUDED.cidade,
        estado = EXCLUDED.estado,
        cep = EXCLUDED.cep,
        inativo = EXCLUDED.inativo,
        tags = EXCLUDED.tags,
        info = EXCLUDED.info,
        updated_at = NOW()
    `, [
      codigo_cliente_omie,
      codigo_cliente_integracao || null,
      razao_social || '',
      nome_fantasia || '',
      cnpj_cpf || '',
      telefone1_ddd || '',
      telefone1_numero || '',
      email || '',
      endereco || '',
      endereco_numero || '',
      complemento || '',
      bairro || '',
      cidade || '',
      estado || '',
      cep || '',
      inativo === 'S' || inativo === true,
      Array.isArray(tags) ? tags : [],
      JSON.stringify(cliente)
    ]);
    
    console.log('[upsertFornecedor] Cliente', codigo_cliente_omie, 'sincronizado com sucesso');
  } catch (e) {
    console.error('[Fornecedores] Erro ao fazer upsert:', e);
  }
}

// ============================================================================
// Upsert de um pedido de compra no banco (tabelas no schema compras)
// ============================================================================

// Função auxiliar para converter data do formato Omie (DD/MM/YYYY) para PostgreSQL (YYYY-MM-DD)
function convertOmieDate(omieDate) {
  if (!omieDate) return null;
  
  // Se já estiver no formato YYYY-MM-DD, retorna como está
  if (omieDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return omieDate;
  }
  
  // Converte DD/MM/YYYY para YYYY-MM-DD
  const match = omieDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, dia, mes, ano] = match;
    return `${ano}-${mes}-${dia}`;
  }
  
  return null;
}

async function upsertPedidoCompra(pedido, eventoWebhook = '', messageId = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Extrai os dados do cabeçalho
    const cabecalho = pedido.cabecalho || pedido.cabecalho_consulta || {};
    const produtos = pedido.produtos || pedido.produtos_consulta || [];
    const frete = pedido.frete || pedido.frete_consulta || {};
    const parcelas = pedido.parcelas || pedido.parcelas_consulta || [];
    const departamentos = pedido.departamentos || pedido.departamentos_consulta || [];
    
    const cNumero = cabecalho.cNumero || cabecalho.c_numero || cabecalho['cNúmero'] || null;
    let nCodPed = cabecalho.nCodPed || cabecalho.n_cod_ped;

    if (!nCodPed && cNumero) {
      const pedidoExistente = await client.query(
        `SELECT n_cod_ped
           FROM compras.pedidos_omie
          WHERE TRIM(COALESCE(c_numero, '')) = TRIM($1)
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        [String(cNumero)]
      );

      if (pedidoExistente.rows.length > 0) {
        nCodPed = pedidoExistente.rows[0].n_cod_ped;
      }
    }
    
    if (!nCodPed) {
      throw new Error(`nCodPed não encontrado no pedido (cNumero: ${cNumero || 'N/A'})`);
    }
    
    // 1. Upsert do cabeçalho
    await client.query(`
      INSERT INTO compras.pedidos_omie (
        n_cod_ped, c_cod_int_ped, c_numero,
        d_inc_data, c_inc_hora, d_dt_previsao,
        c_etapa, c_cod_status, c_desc_status,
        n_cod_for, c_cod_int_for, c_cnpj_cpf_for,
        c_cod_parc, n_qtde_parc,
        c_cod_categ, n_cod_compr, c_contato, c_contrato,
        n_cod_cc, n_cod_int_cc, n_cod_proj,
        c_num_pedido, c_obs, c_obs_int, c_email_aprovador,
        evento_webhook, evento_webhook_message_id, data_webhook, updated_at
      )
      VALUES (
        $1, $2, $3,
        $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12,
        $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21,
        $22, $23, $24, $25,
        $26, $27, NOW(), NOW()
      )
      ON CONFLICT (n_cod_ped) DO UPDATE SET
        c_cod_int_ped = EXCLUDED.c_cod_int_ped,
        c_numero = EXCLUDED.c_numero,
        d_inc_data = EXCLUDED.d_inc_data,
        c_inc_hora = EXCLUDED.c_inc_hora,
        d_dt_previsao = EXCLUDED.d_dt_previsao,
        c_etapa = EXCLUDED.c_etapa,
        c_cod_status = EXCLUDED.c_cod_status,
        c_desc_status = EXCLUDED.c_desc_status,
        n_cod_for = EXCLUDED.n_cod_for,
        c_cod_int_for = EXCLUDED.c_cod_int_for,
        c_cnpj_cpf_for = EXCLUDED.c_cnpj_cpf_for,
        c_cod_parc = EXCLUDED.c_cod_parc,
        n_qtde_parc = EXCLUDED.n_qtde_parc,
        c_cod_categ = EXCLUDED.c_cod_categ,
        n_cod_compr = EXCLUDED.n_cod_compr,
        c_contato = EXCLUDED.c_contato,
        c_contrato = EXCLUDED.c_contrato,
        n_cod_cc = EXCLUDED.n_cod_cc,
        n_cod_int_cc = EXCLUDED.n_cod_int_cc,
        n_cod_proj = EXCLUDED.n_cod_proj,
        c_num_pedido = EXCLUDED.c_num_pedido,
        c_obs = EXCLUDED.c_obs,
        c_obs_int = EXCLUDED.c_obs_int,
        c_email_aprovador = EXCLUDED.c_email_aprovador,
        evento_webhook = EXCLUDED.evento_webhook,
        evento_webhook_message_id = EXCLUDED.evento_webhook_message_id,
        data_webhook = NOW(),
        updated_at = NOW()
    `, [
      nCodPed,
      cabecalho.cCodIntPed || cabecalho.c_cod_int_ped || null,
      cabecalho.cNumero || cabecalho.c_numero || null,
      convertOmieDate(cabecalho.dIncData || cabecalho.d_inc_data),
      cabecalho.cIncHora || cabecalho.c_inc_hora || null,
      convertOmieDate(cabecalho.dDtPrevisao || cabecalho.d_dt_previsao),
      cabecalho.cEtapa || cabecalho.c_etapa || null,
      cabecalho.cCodStatus || cabecalho.c_cod_status || null,
      cabecalho.cDescStatus || cabecalho.c_desc_status || null,
      cabecalho.nCodFor || cabecalho.n_cod_for || null,
      cabecalho.cCodIntFor || cabecalho.c_cod_int_for || null,
      cabecalho.cCnpjCpfFor || cabecalho.c_cnpj_cpf_for || null,
      cabecalho.cCodParc || cabecalho.c_cod_parc || null,
      cabecalho.nQtdeParc || cabecalho.n_qtde_parc || null,
      cabecalho.cCodCateg || cabecalho.c_cod_categ || null,
      cabecalho.nCodCompr || cabecalho.n_cod_compr || null,
      cabecalho.cContato || cabecalho.c_contato || null,
      cabecalho.cContrato || cabecalho.c_contrato || null,
      cabecalho.nCodCC || cabecalho.n_cod_cc || null,
      cabecalho.nCodIntCC || cabecalho.n_cod_int_cc || null,
      cabecalho.nCodProj || cabecalho.n_cod_proj || null,
      cabecalho.cNumPedido || cabecalho.c_num_pedido || null,
      cabecalho.cObs || cabecalho.c_obs || null,
      cabecalho.cObsInt || cabecalho.c_obs_int || null,
      cabecalho.cEmailAprovador || cabecalho.c_email_aprovador || null,
      eventoWebhook,
      messageId
    ]);
    
    // 2. Remove produtos antigos e insere novos
    await client.query('DELETE FROM compras.pedidos_omie_produtos WHERE n_cod_ped = $1', [nCodPed]);
    
    if (Array.isArray(produtos) && produtos.length > 0) {
      for (const prod of produtos) {
        await client.query(`
          INSERT INTO compras.pedidos_omie_produtos (
            n_cod_ped, c_cod_int_item, n_cod_item,
            c_cod_int_prod, n_cod_prod, c_produto, c_descricao,
            c_ncm, c_unidade, c_ean, n_peso_liq, n_peso_bruto,
            n_qtde, n_qtde_rec, n_val_unit, n_val_merc, n_desconto, n_val_tot,
            n_valor_icms, n_valor_st, n_valor_ipi, n_valor_pis, n_valor_cofins,
            n_frete, n_seguro, n_despesas,
            c_obs, c_mkp_atu_pv, c_mkp_atu_sm, n_mkp_perc,
            codigo_local_estoque, c_cod_categ
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
            $24, $25, $26, $27, $28, $29, $30, $31, $32
          )
        `, [
          nCodPed,
          prod.cCodIntItem || prod.c_cod_int_item || null,
          prod.nCodItem || prod.n_cod_item || null,
          prod.cCodIntProd || prod.c_cod_int_prod || null,
          prod.nCodProd || prod.n_cod_prod || null,
          prod.cProduto || prod.c_produto || null,
          prod.cDescricao || prod.c_descricao || null,
          prod.cNCM || prod.c_ncm || null,
          prod.cUnidade || prod.c_unidade || null,
          prod.cEAN || prod.c_ean || null,
          prod.nPesoLiq || prod.n_peso_liq || null,
          prod.nPesoBruto || prod.n_peso_bruto || null,
          prod.nQtde || prod.n_qtde || null,
          prod.nQtdeRec || prod.n_qtde_rec || null,
          prod.nValUnit || prod.n_val_unit || null,
          prod.nValMerc || prod.n_val_merc || null,
          prod.nDesconto || prod.n_desconto || null,
          prod.nValTot || prod.n_val_tot || null,
          prod.nValorIcms || prod.n_valor_icms || null,
          prod.nValorSt || prod.n_valor_st || null,
          prod.nValorIpi || prod.n_valor_ipi || null,
          prod.nValorPis || prod.n_valor_pis || null,
          prod.nValorCofins || prod.n_valor_cofins || null,
          prod.nFrete || prod.n_frete || null,
          prod.nSeguro || prod.n_seguro || null,
          prod.nDespesas || prod.n_despesas || null,
          prod.cObs || prod.c_obs || null,
          prod.cMkpAtuPv || prod.c_mkp_atu_pv || null,
          prod.cMkpAtuSm || prod.c_mkp_atu_sm || null,
          prod.nMkpPerc || prod.n_mkp_perc || null,
          prod.codigo_local_estoque || null,
          prod.cCodCateg || prod.c_cod_categ || null
        ]);
      }
    }
    
    // 3. Upsert do frete (1:1 com pedido)
    await client.query('DELETE FROM compras.pedidos_omie_frete WHERE n_cod_ped = $1', [nCodPed]);
    
    if (frete && Object.keys(frete).length > 0) {
      await client.query(`
        INSERT INTO compras.pedidos_omie_frete (
          n_cod_ped, n_cod_transp, c_cod_int_transp, c_tp_frete,
          c_placa, c_uf, n_qtd_vol, c_esp_vol, c_mar_vol, c_num_vol,
          n_peso_liq, n_peso_bruto, n_val_frete, n_val_seguro, n_val_outras, c_lacre
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        nCodPed,
        frete.nCodTransp || frete.n_cod_transp || null,
        frete.cCodIntTransp || frete.c_cod_int_transp || null,
        frete.cTpFrete || frete.c_tp_frete || null,
        frete.cPlaca || frete.c_placa || null,
        frete.cUF || frete.c_uf || null,
        frete.nQtdVol || frete.n_qtd_vol || null,
        frete.cEspVol || frete.c_esp_vol || null,
        frete.cMarVol || frete.c_mar_vol || null,
        frete.cNumVol || frete.c_num_vol || null,
        frete.nPesoLiq || frete.n_peso_liq || null,
        frete.nPesoBruto || frete.n_peso_bruto || null,
        frete.nValFrete || frete.n_val_frete || null,
        frete.nValSeguro || frete.n_val_seguro || null,
        frete.nValOutras || frete.n_val_outras || null,
        frete.cLacre || frete.c_lacre || null
      ]);
    }
    
    // 4. Remove parcelas antigas e insere novas
    await client.query('DELETE FROM compras.pedidos_omie_parcelas WHERE n_cod_ped = $1', [nCodPed]);
    
    if (Array.isArray(parcelas) && parcelas.length > 0) {
      for (const parc of parcelas) {
        await client.query(`
          INSERT INTO compras.pedidos_omie_parcelas (
            n_cod_ped, n_parcela, d_vencto, n_valor, n_dias, n_percent, c_tipo_doc
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          nCodPed,
          parc.nParcela || parc.n_parcela || null,
          convertOmieDate(parc.dVencto || parc.d_vencto),
          parc.nValor || parc.n_valor || null,
          parc.nDias || parc.n_dias || null,
          parc.nPercent || parc.n_percent || null,
          parc.cTipoDoc || parc.c_tipo_doc || null
        ]);
      }
    }
    
    // 5. Remove departamentos antigos e insere novos
    await client.query('DELETE FROM compras.pedidos_omie_departamentos WHERE n_cod_ped = $1', [nCodPed]);
    
    if (Array.isArray(departamentos) && departamentos.length > 0) {
      for (const dept of departamentos) {
        await client.query(`
          INSERT INTO compras.pedidos_omie_departamentos (
            n_cod_ped, c_cod_depto, n_perc, n_valor
          )
          VALUES ($1, $2, $3, $4)
        `, [
          nCodPed,
          dept.cCodDepto || dept.c_cod_depto || null,
          dept.nPerc || dept.n_perc || null,
          dept.nValor || dept.n_valor || null
        ]);
      }
    }
    
    await client.query('COMMIT');
    console.log(`[PedidosCompra] ✓ Pedido ${nCodPed} sincronizado com sucesso`);
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[PedidosCompra] ✗ Erro ao fazer upsert do pedido:', e);
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================================
// Sincroniza pedido Omie com solicitacao_compras
// ============================================================================
async function sincronizarPedidoComSolicitacao(nCodPed) {
  try {
    // 1. Busca etapa e fornecedor do pedido
    const pedidoResult = await pool.query(
      'SELECT c_etapa, n_cod_for, c_numero FROM compras.pedidos_omie WHERE n_cod_ped = $1',
      [nCodPed]
    );
    
    if (pedidoResult.rows.length === 0) {
      console.warn(`[sincronizarPedido] Pedido ${nCodPed} não encontrado em pedidos_omie`);
      return;
    }
    
    const etapa = pedidoResult.rows[0].c_etapa;
    const codFornecedor = pedidoResult.rows[0].n_cod_for;
    const numeroPedido = pedidoResult.rows[0].c_numero;
    
    if (!etapa) {
      console.warn(`[sincronizarPedido] Pedido ${nCodPed} sem etapa definida`);
      return;
    }
    
    // 2. Busca descrição da etapa
    const etapaResult = await pool.query(
      'SELECT descricao_padrao FROM compras.etapas_pedido_compra WHERE codigo = $1',
      [etapa]
    );
    
    const descricaoEtapa = etapaResult.rows.length > 0 
      ? etapaResult.rows[0].descricao_padrao 
      : `Etapa ${etapa}`;
    
    // 3. Atualiza solicitacao_compras
    let updateQuery;
    let updateParams;
    
    if (etapa === '10' && codFornecedor) {
      // Etapa 10: busca dados do fornecedor na API Omie
      let fornecedorNome = null;
      let fornecedorContato = null;
      
      try {
        console.log(`[sincronizarPedido] Buscando dados do fornecedor ${codFornecedor} na API Omie...`);
        
        const fornecedorResp = await fetch('https://app.omie.com.br/api/v1/geral/clientes/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'ConsultarCliente',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
              codigo_cliente_omie: parseInt(codFornecedor)
            }]
          })
        });
        
        if (fornecedorResp.ok) {
          const fornecedorData = await fornecedorResp.json();
          fornecedorNome = fornecedorData.nome_fantasia || fornecedorData.razao_social || null;
          fornecedorContato = fornecedorData.contato || null;
          
          console.log(`[sincronizarPedido] Dados do fornecedor obtidos: nome="${fornecedorNome}", contato="${fornecedorContato}"`);
        } else {
          const errorText = await fornecedorResp.text();
          console.warn(`[sincronizarPedido] Erro ao buscar fornecedor na API Omie: ${fornecedorResp.status} - ${errorText}`);
        }
      } catch (err) {
        console.warn(`[sincronizarPedido] Falha ao consultar fornecedor na API Omie:`, err.message);
      }
      
      // Atualiza status, fornecedor_id, fornecedor_nome e contato
      updateQuery = `
        UPDATE compras.solicitacao_compras 
        SET status = $1, 
            fornecedor_id = $2,
            fornecedor_nome = $3,
            contato = $4,
            cnumero = $5,
            updated_at = NOW()
        WHERE ncodped = $6`;
      updateParams = [descricaoEtapa, codFornecedor, fornecedorNome, fornecedorContato, numeroPedido || null, nCodPed];
    } else {
      // Outras etapas: atualiza status e cnumero
      updateQuery = `
        UPDATE compras.solicitacao_compras 
        SET status = $1,
            cnumero = $2,
            updated_at = NOW()
        WHERE ncodped = $3`;
      updateParams = [descricaoEtapa, numeroPedido || null, nCodPed];
    }
    
    const result = await pool.query(updateQuery, updateParams);
    
    if (result.rowCount > 0) {
      if (etapa === '10' && codFornecedor) {
        console.log(`[sincronizarPedido] ✓ Solicitação atualizada: ncodped=${nCodPed}, etapa ${etapa} → status="${descricaoEtapa}", fornecedor_id=${codFornecedor}, fornecedor_nome="${updateParams[2]}", contato="${updateParams[3]}", cnumero="${updateParams[4]}"`);
      } else {
        console.log(`[sincronizarPedido] ✓ Solicitação atualizada: ncodped=${nCodPed}, etapa ${etapa} → status="${descricaoEtapa}", cnumero="${updateParams[1]}"`);
      }
    } else {
      console.warn(`[sincronizarPedido] ⚠ Nenhuma solicitação encontrada com ncodped=${nCodPed}`);
    }
    
  } catch (err) {
    console.error(`[sincronizarPedido] ✗ Erro ao sincronizar pedido ${nCodPed}:`, err);
  }
}

// ============================================================================
// Upsert de uma requisição de compra no banco (tabelas no schema compras)
// ============================================================================
async function upsertRequisicaoCompra(requisicao, eventoWebhook = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const req = requisicao?.requisicaoCadastro
      || requisicao?.requisicao_cadastro
      || requisicao
      || {};

    const itens = req.ItensReqCompra || req.itens_req_compra || [];
    const statusInfo = requisicao?.status || requisicao?.rcStatus || req?.rcStatus || {};

    const codReqCompra = req.codReqCompra || req.cod_req_compra || req.nCodPed || statusInfo.codReqCompra || statusInfo.cod_req_compra;
    const codIntReqCompra = req.codIntReqCompra || req.cod_int_req_compra || req.cCodIntPed || statusInfo.codIntReqCompra || statusInfo.cod_int_req_compra || null;

    if (!codReqCompra) {
      throw new Error('codReqCompra não encontrado na requisição');
    }

    await client.query(`
      INSERT INTO compras.requisicoes_omie (
        cod_req_compra, cod_int_req_compra, cod_categ, cod_proj,
        dt_sugestao, obs_req_compra, obs_int_req_compra,
        cod_status, desc_status, numero, etapa,
        evento_webhook, data_webhook, updated_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10, $11,
        $12, NOW(), NOW()
      )
      ON CONFLICT (cod_req_compra) DO UPDATE SET
        cod_int_req_compra = EXCLUDED.cod_int_req_compra,
        cod_categ = EXCLUDED.cod_categ,
        cod_proj = EXCLUDED.cod_proj,
        dt_sugestao = EXCLUDED.dt_sugestao,
        obs_req_compra = EXCLUDED.obs_req_compra,
        obs_int_req_compra = EXCLUDED.obs_int_req_compra,
        cod_status = EXCLUDED.cod_status,
        desc_status = EXCLUDED.desc_status,
        numero = EXCLUDED.numero,
        etapa = EXCLUDED.etapa,
        evento_webhook = EXCLUDED.evento_webhook,
        data_webhook = NOW(),
        updated_at = NOW()
    `, [
      codReqCompra,
      codIntReqCompra,
      req.codCateg || req.cod_categ || null,
      req.codProj || req.cod_proj || null,
      convertOmieDate(req.dtSugestao || req.dt_sugestao),
      req.obsReqCompra || req.obs_req_compra || null,
      req.obsIntReqCompra || req.obs_int_req_compra || null,
      statusInfo.cCodStatus || statusInfo.c_cod_status || null,
      statusInfo.cDesStatus || statusInfo.c_des_status || null,
      req.cNumero || req.c_numero || null,
      req.cEtapa || req.c_etapa || null,
      eventoWebhook
    ]);

    // DESABILITADO: Não vamos mais popular a tabela requisicoes_omie_itens via webhook
    // Os itens serão gerenciados através do fluxo de aprovação (Meu Carrinho / Aprovação de Requisições)
    // await client.query('DELETE FROM compras.requisicoes_omie_itens WHERE cod_req_compra = $1', [codReqCompra]);
    
    // if (Array.isArray(itens) && itens.length > 0) {
    //   console.log(`[RequisicoesCompra] 📝 Inserindo ${itens.length} itens na requisição ${codReqCompra}`);
    //   
    //   for (const item of itens) {
    //     await client.query(`
    //       INSERT INTO compras.requisicoes_omie_itens (
    //         cod_req_compra, cod_item, cod_int_item,
    //         cod_prod, cod_int_prod, qtde, preco_unit, obs_item
    //       )
    //       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    //     `, [
    //       codReqCompra,
    //       item.codItem || item.cod_item || null,
    //       item.codIntItem || item.cod_int_item || null,
    //       item.codProd || item.cod_prod || null,
    //       item.codIntProd || item.cod_int_prod || null,
    //       item.qtde || item.qtde_item || null,
    //       item.precoUnit || item.preco_unit || null,
    //       item.obsItem || item.obs_item || null
    //     ]);
    //   }
    //   console.log(`[RequisicoesCompra] ✓ ${itens.length} itens inseridos com sucesso`);
    // } else {
    //   console.log(`[RequisicoesCompra] ⚠ Nenhum item encontrado na requisição ${codReqCompra}`);
    // }
    
    console.log(`[RequisicoesCompra] ℹ️ Webhook processado - Itens não são mais salvos nesta tabela`);

    await client.query('COMMIT');
    console.log(`[RequisicoesCompra] ✓ Requisição ${codReqCompra} sincronizada com sucesso`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[RequisicoesCompra] ✗ Erro ao fazer upsert da requisição:', e);
    throw e;
  } finally {
    client.release();
  }
}

// Gera número único de pedido (formato: YYYYMMDD-HHMMSS-RANDOM)
function gerarNumeroPedido() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}-${rand}`;
}

// ============================================================================
// Sincroniza todos os pedidos de compra da Omie para o banco de dados local
// ============================================================================
async function syncPedidosCompraOmie(filtros = {}) {
  try {
    console.log('[PedidosCompra] Iniciando sincronização com Omie...');
    let pagina = 1;
    let totalSincronizados = 0;
    let continuar = true;

    const chamarOmieComRetry = async (call, param, maxTentativas = 4) => {
      let tentativa = 0;
      while (tentativa < maxTentativas) {
        tentativa += 1;
        const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call,
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [param]
          })
        });

        if (response.ok) {
          const data = await response.json();
          return { ok: true, data };
        }

        const errorText = await response.text();
        const errorLower = String(errorText || '').toLowerCase();
        const erroConsumoRedundante = response.status === 500 && errorLower.includes('consumo redundante detectado');
        const erroSemRegistrosPagina = response.status === 500 && errorLower.includes('não existem registros para a página');

        if (erroConsumoRedundante && tentativa < maxTentativas) {
          console.warn(`[PedidosCompra] API Omie informou consumo redundante (${call}). Tentativa ${tentativa}/${maxTentativas}. Aguardando 3s...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }

        if (erroSemRegistrosPagina) {
          return { ok: false, noRecordsPage: true, errorText, status: response.status };
        }

        return { ok: false, errorText, status: response.status };
      }

      return { ok: false, status: 500, errorText: 'Máximo de tentativas atingido' };
    };
    
    while (continuar) {
      // Monta os parâmetros da requisição
      const param = {
        nPagina: pagina,
        nRegsPorPagina: 50
      };
      
      // Filtros de status:
      // - Se vierem explicitamente no body, respeita.
      // - Se não vier nenhum, força todos = true para trazer o conjunto completo.
      const algumFiltroStatusExplicito =
        filtros.pendentes !== undefined ||
        filtros.faturados !== undefined ||
        filtros.recebidos !== undefined ||
        filtros.cancelados !== undefined ||
        filtros.encerrados !== undefined ||
        filtros.rec_parciais !== undefined ||
        filtros.fat_parciais !== undefined;

      if (algumFiltroStatusExplicito) {
        if (filtros.pendentes !== undefined) {
          param.lExibirPedidosPendentes = filtros.pendentes;
        }
        if (filtros.faturados !== undefined) {
          param.lExibirPedidosFaturados = filtros.faturados;
        }
        if (filtros.recebidos !== undefined) {
          param.lExibirPedidosRecebidos = filtros.recebidos;
        }
        if (filtros.cancelados !== undefined) {
          param.lExibirPedidosCancelados = filtros.cancelados;
        }
        if (filtros.encerrados !== undefined) {
          param.lExibirPedidosEncerrados = filtros.encerrados;
        }
        if (filtros.rec_parciais !== undefined) {
          param.lExibirPedidosRecParciais = filtros.rec_parciais;
        }
        if (filtros.fat_parciais !== undefined) {
          param.lExibirPedidosFatParciais = filtros.fat_parciais;
        }
      } else {
        param.lExibirPedidosPendentes = true;
        param.lExibirPedidosFaturados = true;
        param.lExibirPedidosRecebidos = true;
        param.lExibirPedidosCancelados = true;
        param.lExibirPedidosEncerrados = true;
        param.lExibirPedidosRecParciais = true;
        param.lExibirPedidosFatParciais = true;
      }
      
      // Filtros de data (sempre adiciona se definidos)
      if (filtros.data_inicial) {
        param.dDataInicial = filtros.data_inicial;
      }
      if (filtros.data_final) {
        param.dDataFinal = filtros.data_final;
      }
      
      console.log(`[PedidosCompra] Buscando página ${pagina}...`);

      const pesquisa = await chamarOmieComRetry('PesquisarPedCompra', param, 4);
      if (!pesquisa.ok) {
        if (pesquisa.noRecordsPage) {
          console.warn(`[PedidosCompra] Omie informou ausência de registros na página ${pagina}. Encerrando sincronização.`);
          break;
        }
        console.error(`[PedidosCompra] Erro na API Omie (${pesquisa.status}): ${pesquisa.errorText}`);
        throw new Error(`Omie API retornou ${pesquisa.status}`);
      }

      const data = pesquisa.data || {};
      const pedidos = data.pedidos_pesquisa || [];
      const totalPaginas = data.nTotalPaginas || 1;
      const totalRegistros = data.nTotalRegistros || 0;
      
      console.log(`[PedidosCompra] Página ${pagina}/${totalPaginas} - ${pedidos.length} pedidos (Total na Omie: ${totalRegistros})`);
      
      if (!pedidos.length) {
        continuar = false;
        break;
      }
      
      // Para cada pedido da pesquisa, busca os detalhes completos
      for (const pedidoResumo of pedidos) {
        try {
          const nCodPed = pedidoResumo.cabecalho?.nCodPed || pedidoResumo.cabecalho_consulta?.nCodPed;
          
          if (!nCodPed) {
            console.warn('[PedidosCompra] Pedido sem nCodPed, pulando:', pedidoResumo);
            continue;
          }
          
          // Consulta detalhes completos do pedido
          const detalhes = await chamarOmieComRetry('ConsultarPedCompra', { nCodPed: parseInt(nCodPed) }, 4);

          if (!detalhes.ok) {
            console.error(`[PedidosCompra] Erro ao consultar pedido ${nCodPed}: ${detalhes.status} - ${detalhes.errorText}`);
            continue;
          }

          const pedidoCompleto = detalhes.data;
          
          // Faz o upsert no banco
          await upsertPedidoCompra(pedidoCompleto, 'sync');
          totalSincronizados++;
          
          // Log a cada 10 pedidos
          if (totalSincronizados % 10 === 0) {
            console.log(`[PedidosCompra] ✓ Progresso: ${totalSincronizados} pedidos sincronizados...`);
          }
          
          // Pequeno delay para não sobrecarregar a API da Omie
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (pedidoError) {
          console.error('[PedidosCompra] Erro ao processar pedido:', pedidoError);
          // Continua com o próximo pedido
        }
      }
      
      // Verifica se tem mais páginas
      if (pagina >= totalPaginas) {
        continuar = false;
      } else {
        pagina++;
      }
    }
    
    console.log(`[PedidosCompra] ✓✓✓ Sincronização concluída: ${totalSincronizados} pedidos sincronizados com sucesso!`);
    return { ok: true, total: totalSincronizados };
  } catch (e) {
    console.error('[PedidosCompra] ✗ Erro na sincronização:', e);
    return { ok: false, error: e.message };
  }
}

// ============================================================================
// FUNÇÕES DE SINCRONIZAÇÃO DE RECEBIMENTOS DE NF-e
// ============================================================================

let _recebimentosNfeDadosAdicionaisColReady = false;
async function ensureRecebimentosNfeDadosAdicionaisColumn(client) {
  if (_recebimentosNfeDadosAdicionaisColReady) return;
  await client.query(`
    ALTER TABLE logistica.recebimentos_nfe_omie
    ADD COLUMN IF NOT EXISTS c_dados_adicionais TEXT;
  `);
  _recebimentosNfeDadosAdicionaisColReady = true;
}

let _pedidosOmieProdutosNfeVinculoReady = false;
async function ensurePedidosOmieProdutosNfeVinculo(client) {
  if (_pedidosOmieProdutosNfeVinculoReady) return;

  const { rows: tablesRows } = await client.query(`
    SELECT
      to_regclass('compras.pedidos_omie_produtos')::text AS pedidos_prod_table,
      to_regclass('compras.pedidos_omie')::text AS pedidos_table,
      to_regclass('logistica.recebimentos_nfe_omie')::text AS recebimentos_table
  `);
  const tablesInfo = tablesRows[0] || {};
  if (!tablesInfo.pedidos_prod_table || !tablesInfo.pedidos_table || !tablesInfo.recebimentos_table) {
    return;
  }

  await client.query(`
    DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_produtos
      ON logistica.recebimentos_nfe_omie;

    DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_pedido_produto
      ON logistica.recebimentos_nfe_omie;

    DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_por_pedido
      ON compras.pedidos_omie;

    DROP TRIGGER IF EXISTS trg_vincular_recebimento_nfe_por_produto_pedido
      ON compras.pedidos_omie_produtos;

    DROP FUNCTION IF EXISTS compras.fn_trg_vincular_recebimento_nfe_produtos();
    DROP FUNCTION IF EXISTS compras.fn_trg_vincular_recebimento_nfe_por_pedido();
    DROP FUNCTION IF EXISTS compras.fn_trg_vincular_recebimento_nfe_por_produto_pedido();
    DROP FUNCTION IF EXISTS compras.fn_aplicar_vinculo_nfe_por_recebimento(BIGINT);
    DROP FUNCTION IF EXISTS compras.fn_aplicar_vinculo_nfe_por_pedido(BIGINT);
  `);

  _pedidosOmieProdutosNfeVinculoReady = true;
}

(async () => {
  try {
    await ensurePedidosOmieProdutosNfeVinculo(pool);
    if (_pedidosOmieProdutosNfeVinculoReady) {
      console.log('[Compras/NFe] ✓ Automação de vínculo de recebimentos desativada');
    } else {
      console.log('[Compras/NFe] Desativação de automações pendente (tabelas ainda não disponíveis)');
    }
  } catch (err) {
    console.error('[Compras/NFe] Erro ao preparar vínculo automático de recebimentos:', err.message || err);
  }
})();

// Função para fazer upsert de um recebimento de NF-e no banco
// Aceita cChaveNfe e cDadosAdicionais vindos do webhook como fallback
async function upsertRecebimentoNFe(recebimento, eventoWebhook = '', messageId = null, cChaveNfeWebhook = null, cDadosAdicionaisWebhook = null) {
  const client = await pool.connect();
  try {
    await ensureRecebimentosNfeDadosAdicionaisColumn(client);
    await ensurePedidosOmieProdutosNfeVinculo(client);
    await client.query('BEGIN');
    
    // Extrai os dados das diferentes seções
    const cabec = recebimento.cabec || {};
    const fornecedor = recebimento.fornecedor || {};
    const infoCadastro = recebimento.infoCadastro || {};
    const impostos = recebimento.impostos || recebimento.totais || {};
    const itens = Array.isArray(recebimento.itensRecebimento) ? recebimento.itensRecebimento : [];
    const parcelas = Array.isArray(recebimento.parcelas) ? recebimento.parcelas : [];
    const frete = recebimento.transporte || recebimento.frete || {};
    
    const nIdReceb = cabec.nIdReceb;
    
    if (!nIdReceb) {
      throw new Error('nIdReceb não encontrado no recebimento');
    }
    
    // Usa cChaveNfe do webhook (se disponível) ou do cabec da API (raramente vem)
    const cChaveNfeFinal = cChaveNfeWebhook || cabec.cChaveNfe || null;
    const cDadosAdicionaisFinal = cabec.cDadosAdicionais || cabec.c_dados_adicionais || cabec.cObsNFe || cDadosAdicionaisWebhook || null;
    const cObsNFeFinal = cabec.cObsNFe || cDadosAdicionaisFinal || null;
    
    // 1. Upsert do cabeçalho do recebimento
    await client.query(`
      INSERT INTO logistica.recebimentos_nfe_omie (
        n_id_receb, c_chave_nfe, c_numero_nfe, c_serie_nfe, c_modelo_nfe,
        d_emissao_nfe, d_entrada, d_registro,
        n_valor_nfe, v_total_produtos, v_aprox_tributos, v_desconto, v_frete, v_seguro, v_outras,
        v_ipi, v_icms_st,
        n_id_fornecedor, c_nome_fornecedor, c_cnpj_cpf_fornecedor,
        c_etapa, c_desc_etapa,
        c_faturado, d_fat, h_fat, c_usuario_fat,
        c_recebido, d_rec, h_rec, c_usuario_rec,
        c_devolvido, c_devolvido_parc, d_dev, h_dev, c_usuario_dev,
        c_autorizado, c_bloqueado, c_cancelada,
        c_natureza_operacao, c_cfop_entrada,
        n_id_conta, c_categ_compra,
        c_obs_nfe, c_dados_adicionais, c_obs_rec,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17,
        $18, $19, $20,
        $21, $22,
        $23, $24, $25, $26,
        $27, $28, $29, $30,
        $31, $32, $33, $34, $35,
        $36, $37, $38,
        $39, $40,
        $41, $42,
        $43, $44, $45,
        NOW()
      )
      ON CONFLICT (n_id_receb) DO UPDATE SET
        c_chave_nfe = COALESCE(EXCLUDED.c_chave_nfe, logistica.recebimentos_nfe_omie.c_chave_nfe),  -- Preserva se já existir
        c_numero_nfe = EXCLUDED.c_numero_nfe,
        c_serie_nfe = EXCLUDED.c_serie_nfe,
        c_modelo_nfe = EXCLUDED.c_modelo_nfe,
        d_emissao_nfe = EXCLUDED.d_emissao_nfe,
        d_entrada = EXCLUDED.d_entrada,
        d_registro = EXCLUDED.d_registro,
        n_valor_nfe = EXCLUDED.n_valor_nfe,
        v_total_produtos = EXCLUDED.v_total_produtos,
        v_aprox_tributos = EXCLUDED.v_aprox_tributos,
        v_desconto = EXCLUDED.v_desconto,
        v_frete = EXCLUDED.v_frete,
        v_seguro = EXCLUDED.v_seguro,
        v_outras = EXCLUDED.v_outras,
        v_ipi = EXCLUDED.v_ipi,
        v_icms_st = EXCLUDED.v_icms_st,
        n_id_fornecedor = EXCLUDED.n_id_fornecedor,
        c_nome_fornecedor = EXCLUDED.c_nome_fornecedor,
        c_cnpj_cpf_fornecedor = EXCLUDED.c_cnpj_cpf_fornecedor,
        c_etapa = EXCLUDED.c_etapa,
        c_desc_etapa = EXCLUDED.c_desc_etapa,
        c_faturado = EXCLUDED.c_faturado,
        d_fat = EXCLUDED.d_fat,
        h_fat = EXCLUDED.h_fat,
        c_usuario_fat = EXCLUDED.c_usuario_fat,
        c_recebido = EXCLUDED.c_recebido,
        d_rec = EXCLUDED.d_rec,
        h_rec = EXCLUDED.h_rec,
        c_usuario_rec = EXCLUDED.c_usuario_rec,
        c_devolvido = EXCLUDED.c_devolvido,
        c_devolvido_parc = EXCLUDED.c_devolvido_parc,
        d_dev = EXCLUDED.d_dev,
        h_dev = EXCLUDED.h_dev,
        c_usuario_dev = EXCLUDED.c_usuario_dev,
        c_autorizado = EXCLUDED.c_autorizado,
        c_bloqueado = EXCLUDED.c_bloqueado,
        c_cancelada = EXCLUDED.c_cancelada,
        c_natureza_operacao = EXCLUDED.c_natureza_operacao,
        c_cfop_entrada = EXCLUDED.c_cfop_entrada,
        n_id_conta = EXCLUDED.n_id_conta,
        c_categ_compra = EXCLUDED.c_categ_compra,
        c_obs_nfe = EXCLUDED.c_obs_nfe,
        c_dados_adicionais = EXCLUDED.c_dados_adicionais,
        c_obs_rec = EXCLUDED.c_obs_rec,
        updated_at = NOW()
    `, [
      nIdReceb,
      cChaveNfeFinal,  // ← Usa variável que prioriza webhook
      cabec.cNumeroNFe || null,
      cabec.cSerieNFe || null,
      cabec.cModeloNFe || null,
      convertOmieDate(cabec.dEmissaoNFe),
      convertOmieDate(cabec.dEntrada),
      convertOmieDate(cabec.dRegistro),
      cabec.nValorNFe || null,
      cabec.vTotalProdutos || null,
      impostos.vApproxTributos || null,
      cabec.vDesconto || null,
      cabec.vFrete || null,
      cabec.vSeguro || null,
      cabec.vOutras || null,
      impostos.vIPI || null,
      impostos.vICMSST || null,
      fornecedor.nIdFornecedor || null,
      fornecedor.cNomeFornecedor || null,
      fornecedor.cCnpjCpfFornecedor || null,
      cabec.cEtapa || null,
      cabec.cDescEtapa || null,
      infoCadastro.cFaturado || null,
      convertOmieDate(infoCadastro.dFat),
      infoCadastro.hFat || null,
      infoCadastro.cUsuarioFat || null,
      infoCadastro.cRecebido || null,
      convertOmieDate(infoCadastro.dRec),
      infoCadastro.hRec || null,
      infoCadastro.cUsuarioRec || null,
      infoCadastro.cDevolvido || null,
      infoCadastro.cDevolvidoParc || null,
      convertOmieDate(infoCadastro.dDev),
      infoCadastro.hDev || null,
      infoCadastro.cUsuarioDev || null,
      infoCadastro.cAutorizado || null,
      infoCadastro.cBloqueado || null,
      infoCadastro.cCancelada || null,
      cabec.cNaturezaOperacao || null,
      cabec.cCfopEntrada || null,
      cabec.nIdConta || null,
      cabec.cCategCompra || null,
      cObsNFeFinal,
      cDadosAdicionaisFinal,
      infoCadastro.cObsRec || null
    ]);
    
    // 2. Remove itens antigos e insere novos
    await client.query('DELETE FROM logistica.recebimentos_nfe_itens WHERE n_id_receb = $1', [nIdReceb]);
    
    for (const item of itens) {
      const itemCabec = item.itensCabec || {};
      const itemInfoAdic = item.itensInfoAdic || {};
      
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_itens (
          n_id_receb, n_id_item, n_sequencia,
          n_id_produto, c_codigo_produto, c_descricao_produto, c_ncm,
          n_qtde_nfe, c_unidade_nfe, n_qtde_recebida, n_qtde_divergente,
          n_preco_unit, v_total_item, v_desconto, v_frete, v_seguro, v_outras,
          v_icms, v_ipi, v_pis, v_cofins, v_icms_st,
          n_num_ped_compra, n_id_pedido, n_id_it_pedido,
          c_cfop_entrada, c_categoria_item,
          codigo_local_estoque, c_local_estoque,
          c_nao_gerar_financeiro, c_nao_gerar_mov_estoque,
          c_obs_item
        )
        VALUES (
          $1, $2, $3,
          $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22,
          $23, $24, $25,
          $26, $27,
          $28, $29,
          $30, $31,
          $32
        )
      `, [
        nIdReceb,
        itemCabec.nIdItem || null,
        itemCabec.nSequencia || null,
        itemCabec.nIdProduto || null,
        itemCabec.cCodigoProduto || null,
        itemCabec.cDescricaoProduto || null,
        itemCabec.cNcm || null,
        itemCabec.nQtdeNFe || null,
        itemCabec.cUnidadeNFe || null,
        itemCabec.nQtdeRecebida || null,
        itemCabec.nQtdeDivergente || null,
        itemCabec.nPrecoUnit || null,
        itemCabec.vTotalItem || null,
        itemCabec.vDesconto || null,
        itemCabec.vFrete || null,
        itemCabec.vSeguro || null,
        itemCabec.vOutras || null,
        itemCabec.vICMS || null,
        itemCabec.vIPI || null,
        itemCabec.vPIS || null,
        itemCabec.vCOFINS || null,
        itemCabec.vICMSST || null,
        itemInfoAdic.nNumPedCompra || null,
        itemCabec.nIdPedido || null,
        itemCabec.nIdItPedido || null,
        itemInfoAdic.cCfopEntrada || null,
        itemInfoAdic.cCategoriaItem || null,
        itemInfoAdic.codigoLocalEstoque || null,
        itemInfoAdic.cLocalEstoque || null,
        itemInfoAdic.cNaoGerarFinanceiro || null,
        itemInfoAdic.cNaoGerarMovEstoque || null,
        itemInfoAdic.cObsItem || null
      ]);
    }
    
    // 3. Remove parcelas antigas e insere novas
    await client.query('DELETE FROM logistica.recebimentos_nfe_parcelas WHERE n_id_receb = $1', [nIdReceb]);
    
    for (const parcela of parcelas) {
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_parcelas (
          n_id_receb, n_id_parcela, n_numero_parcela,
          v_parcela, p_percentual,
          d_vencimento, n_dias_vencimento,
          c_forma_pagamento,
          n_id_conta, c_nome_conta,
          c_codigo_categoria, c_nome_categoria
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        nIdReceb,
        parcela.nIdParcela || null,
        parcela.nNumeroParcela || null,
        parcela.vParcela || null,
        parcela.pPercentual || null,
        convertOmieDate(parcela.dVencimento),
        parcela.nDiasVencimento || null,
        parcela.cFormaPagamento || null,
        parcela.nIdConta || null,
        parcela.cNomeConta || null,
        parcela.cCodigoCategoria || null,
        parcela.cNomeCategoria || null
      ]);
    }
    
    // 4. Remove frete antigo e insere novo (se existir)
    await client.query('DELETE FROM logistica.recebimentos_nfe_frete WHERE n_id_receb = $1', [nIdReceb]);
    
    if (frete && Object.keys(frete).length > 0) {
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_frete (
          n_id_receb, c_modalidade_frete,
          n_id_transportadora, c_nome_transportadora, c_cnpj_cpf_transportadora,
          v_frete, v_seguro,
          n_quantidade_volumes, c_especie, c_marca, n_peso_bruto, n_peso_liquido,
          c_placa_veiculo, c_uf_veiculo
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        nIdReceb,
        frete.cModalidadeFrete || null,
        frete.nIdTransportadora || null,
        frete.cNomeTransportadora || null,
        frete.cCnpjCpfTransportadora || null,
        frete.vFrete || null,
        frete.vSeguro || null,
        frete.nQuantidadeVolumes || null,
        frete.cEspecie || null,
        frete.cMarca || null,
        frete.nPesoBruto || null,
        frete.nPesoLiquido || null,
        frete.cPlacaVeiculo || null,
        frete.cUfVeiculo || null
      ]);
    }
    
    await client.query('COMMIT');
    console.log(`[RecebimentosNFe] ✓ Recebimento ${nIdReceb} sincronizado`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[RecebimentosNFe] Erro ao fazer upsert do recebimento:`, error);
    throw error;
  } finally {
    client.release();
  }
}

// Função para sincronizar todos os recebimentos de NF-e da Omie
async function syncRecebimentosNFeOmie(filtros = {}) {
  try {
    console.log('[RecebimentosNFe] Iniciando sincronização com Omie...');
    let pagina = 1;
    let totalSincronizados = 0;
    let continuar = true;
    
    while (continuar) {
      // Monta os parâmetros da requisição
      const param = {
        nPagina: pagina,
        nRegistrosPorPagina: 50
      };
      
      // Adiciona filtros se definidos
      if (filtros.data_inicial) {
        param.dDataInicial = filtros.data_inicial;
      }
      if (filtros.data_final) {
        param.dDataFinal = filtros.data_final;
      }
      
      const body = {
        call: 'ListarRecebimentos',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [param]
      };
      
      console.log(`[RecebimentosNFe] Buscando página ${pagina}...`);
      
      const response = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[RecebimentosNFe] Erro na API Omie: ${response.status} - ${errorText}`);
        throw new Error(`Omie API retornou ${response.status}`);
      }
      
      const data = await response.json();
      const recebimentos = data.recebimentos || [];
      const totalPaginas = data.nTotalPaginas || 1;
      const totalRegistros = data.nTotalRegistros || 0;
      
      console.log(`[RecebimentosNFe] Página ${pagina}/${totalPaginas} - ${recebimentos.length} recebimentos (Total na Omie: ${totalRegistros})`);
      
      if (!recebimentos.length) {
        continuar = false;
        break;
      }
      
      // Para cada recebimento, busca os detalhes completos
      for (const recebimentoResumo of recebimentos) {
        try {
          const nIdReceb = recebimentoResumo.cabec?.nIdReceb;
          
          if (!nIdReceb) {
            console.warn('[RecebimentosNFe] Recebimento sem nIdReceb, pulando:', recebimentoResumo);
            continue;
          }
          
          // Consulta detalhes completos do recebimento
          const detalhesResponse = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              call: 'ConsultarRecebimento',
              app_key: OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET,
              param: [{ nIdReceb: parseInt(nIdReceb) }]
            })
          });
          
          if (!detalhesResponse.ok) {
            console.error(`[RecebimentosNFe] Erro ao consultar recebimento ${nIdReceb}:`, detalhesResponse.status);
            continue;
          }
          
          const recebimentoCompleto = await detalhesResponse.json();
          
          // Faz o upsert no banco
          await upsertRecebimentoNFe(recebimentoCompleto, 'sync');
          totalSincronizados++;
          
          // Log a cada 10 recebimentos
          if (totalSincronizados % 10 === 0) {
            console.log(`[RecebimentosNFe] ✓ Progresso: ${totalSincronizados} recebimentos sincronizados...`);
          }
          
          // Pequeno delay para não sobrecarregar a API da Omie
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (recebimentoError) {
          console.error('[RecebimentosNFe] Erro ao processar recebimento:', recebimentoError);
          // Continua com o próximo recebimento
        }
      }
      
      // Verifica se tem mais páginas
      if (pagina >= totalPaginas) {
        continuar = false;
      } else {
        pagina++;
      }
    }
    
    console.log(`[RecebimentosNFe] ✓✓✓ Sincronização concluída: ${totalSincronizados} recebimentos sincronizados com sucesso!`);
    return { ok: true, total: totalSincronizados };
  } catch (e) {
    console.error('[RecebimentosNFe] ✗ Erro na sincronização:', e);
    return { ok: false, error: e.message };
  }
}

// ============================================================================
// ENDPOINT: POST /api/admin/sync/recebimentos-nfe
// Sincroniza recebimentos de NF-e da Omie via webhook
// Objetivo: Preencher corretamente a coluna c_chave_nfe
// ============================================================================
app.post('/api/admin/sync/recebimentos-nfe', express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('[API] Iniciando sincronização de recebimentos de NF-e...');
    
    const resultado = await syncRecebimentosNFeOmie({});
    
    const duracao = Date.now() - startTime;
    
    res.json({
      ok: resultado.ok,
      total_sincronizados: resultado.total || 0,
      erro: resultado.error || null,
      duracao_ms: duracao,
      tempo_formatado: `${Math.floor(duracao / 1000)}s`
    });
    
    // Log de conclusão
    if (resultado.ok) {
      console.log(`[API] ✓ Sincronização concluída em ${duracao}ms`);
    } else {
      console.error(`[API] ✗ Erro na sincronização:`, resultado.error);
    }
    
  } catch (err) {
    console.error('[API] Erro no endpoint /api/admin/sync/recebimentos-nfe:', err);
    res.status(500).json({
      ok: false,
      erro: err.message
    });
  }
});

// ============================================================================
// Sincroniza todas as requisições de compra da Omie para o banco de dados
// Respeita limite de ~3 requisições/segundo (Omie)
// ============================================================================
async function syncRequisicoesCompraOmie(filtros = {}) {
  try {
    console.log('[RequisicoesCompra] Iniciando sincronização com Omie...');
    let pagina = 1;
    let totalSincronizados = 0;
    let continuar = true;

    const DELAY_MS = 350; // ~3 req/s
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Se foi informado codReqCompra/codIntReqCompra, sincroniza apenas esse registro
    const filtroCodReqCompra = filtros.codReqCompra || filtros.cod_req_compra;
    const filtroCodIntReqCompra = filtros.codIntReqCompra || filtros.cod_int_req_compra;
    if (filtroCodReqCompra || filtroCodIntReqCompra) {
      const paramConsulta = filtroCodReqCompra
        ? { codReqCompra: parseInt(filtroCodReqCompra) }
        : { codIntReqCompra: String(filtroCodIntReqCompra) };

      console.log(`[RequisicoesCompra] Sincronizando requisição específica: ${filtroCodReqCompra || filtroCodIntReqCompra}`);

      const detalhesResponse = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarReq',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [paramConsulta]
        })
      });
      await sleep(DELAY_MS);
      console.log(`[RequisicoesCompra] Aguardando ${DELAY_MS}ms (limite Omie)`);

      if (!detalhesResponse.ok) {
        const errorText = await detalhesResponse.text();
        console.error(`[RequisicoesCompra] Erro ao consultar requisição ${filtroCodReqCompra || filtroCodIntReqCompra}: ${detalhesResponse.status} - ${errorText}`);
        throw new Error(`Omie API retornou ${detalhesResponse.status}`);
      }

      const requisicaoCompleta = await detalhesResponse.json();
      await upsertRequisicaoCompra(requisicaoCompleta, 'sync');

      console.log(`[RequisicoesCompra] ✓ Requisição ${filtroCodReqCompra || filtroCodIntReqCompra} sincronizada com sucesso`);
      return { ok: true, total: 1 };
    }

    while (continuar) {
      const param = {
        pagina: pagina,
        registros_por_pagina: 50,
        ...filtros
      };

      // NÃO aplicar filtro de apenas_importado_api
      // Isso permite trazer TODAS as requisições, não apenas as importadas via API

      const body = {
        call: 'PesquisarReq',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [param]
      };

      console.log(`[RequisicoesCompra] Buscando página ${pagina}...`);

      const response = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      await sleep(DELAY_MS);
      console.log(`[RequisicoesCompra] Aguardando ${DELAY_MS}ms (limite Omie)`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[RequisicoesCompra] Erro na API Omie: ${response.status} - ${errorText}`);
        throw new Error(`Omie API retornou ${response.status}`);
      }

      const data = await response.json();
      const requisicoesRaw = data.requisicaoCadastro || data.requisicao_cadastro || data.requisicoes || [];
      const requisicoes = Array.isArray(requisicoesRaw) ? requisicoesRaw : [requisicoesRaw];
      const totalPaginas = data.total_de_paginas || data.totalDePaginas || 1;
      const totalRegistros = data.total_de_registros || data.totalDeRegistros || 0;

      console.log(`[RequisicoesCompra] Página ${pagina}/${totalPaginas} - ${requisicoes.length} requisições (Total na Omie: ${totalRegistros})`);

      if (!requisicoes.length) {
        continuar = false;
        break;
      }

      for (const reqResumo of requisicoes) {
        try {
          const posAtual = totalSincronizados + 1;
          const codReqCompra = reqResumo.codReqCompra || reqResumo.cod_req_compra;
          const codIntReqCompra = reqResumo.codIntReqCompra || reqResumo.cod_int_req_compra;

          if (!codReqCompra && !codIntReqCompra) {
            console.warn('[RequisicoesCompra] Requisição sem codReqCompra/codIntReqCompra, pulando:', reqResumo);
            continue;
          }

          const paramConsulta = codReqCompra
            ? { codReqCompra: parseInt(codReqCompra) }
            : { codIntReqCompra: String(codIntReqCompra) };

          const detalhesResponse = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              call: 'ConsultarReq',
              app_key: OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET,
              param: [paramConsulta]
            })
          });
          await sleep(DELAY_MS);
          console.log(`[RequisicoesCompra] Aguardando ${DELAY_MS}ms (limite Omie)`);

          if (!detalhesResponse.ok) {
            const errorText = await detalhesResponse.text();
            console.error(`[RequisicoesCompra] Erro ao consultar requisição ${codReqCompra || codIntReqCompra}: ${detalhesResponse.status} - ${errorText}`);
            continue;
          }

          const requisicaoCompleta = await detalhesResponse.json();

          await upsertRequisicaoCompra(requisicaoCompleta, 'sync');
          totalSincronizados++;

          if (totalSincronizados % 5 === 0) {
            console.log(`[RequisicoesCompra] Progresso: ${totalSincronizados} requisições sincronizadas (página ${pagina}/${totalPaginas})`);
          }

          if (totalSincronizados % 10 === 0) {
            console.log(`[RequisicoesCompra] ✓ Progresso: ${totalSincronizados} requisições sincronizadas...`);
          }
        } catch (reqErr) {
          console.error('[RequisicoesCompra] Erro ao processar requisição:', reqErr);
        }
      }

      if (pagina >= totalPaginas) {
        continuar = false;
      } else {
        pagina++;
      }
    }

    console.log(`[RequisicoesCompra] ✓✓✓ Sincronização concluída: ${totalSincronizados} requisições sincronizadas com sucesso!`);
    return { ok: true, total: totalSincronizados };
  } catch (e) {
    console.error('[RequisicoesCompra] ✗ Erro na sincronização:', e);
    return { ok: false, error: e.message };
  }
}

// Função para cadastrar produto provisório na Omie
async function cadastrarProdutoNaOmie(codigoProduto, descricaoProduto, contexto = null) {
  try {
    const pfx = contexto ? `[${contexto}] ` : '';
    console.log(`\n${pfx}🆕 Cadastrando produto provisório na Omie...`);
    console.log(`${pfx}   Código: ${codigoProduto}`);
    console.log(`${pfx}   Descrição: ${descricaoProduto}`);
    
    const payload = {
      call: 'IncluirProduto',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{
        codigo_produto_integracao: codigoProduto,
        codigo: codigoProduto,
        descricao: descricaoProduto,
        ncm: '0000.00.00',
        unidade: 'UN'
      }]
    };
    
    console.log(`${pfx}📤 Enviando para API Omie (IncluirProduto)...`);
    const response = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    console.log(`${pfx}📥 Resposta da Omie (IncluirProduto):`);
    console.log(`${pfx}${JSON.stringify(data, null, 2)}`);
    
    if (data.codigo_status === '0' || data.descricao_status?.includes('sucesso')) {
      console.log(`${pfx}✅ Produto cadastrado com sucesso!`);
      console.log(`${pfx}   Código Produto Omie: ${data.codigo_produto}`);
      
      // Atualiza a tabela produtos_omie com o novo produto
      try {
        const { rowCount: updatedCount } = await pool.query(
          `UPDATE produtos_omie
           SET descricao = $2,
               codigo_produto = $3,
               ncm = $4,
               unidade = $5
           WHERE codigo = $1 OR codigo_produto_integracao = $1`,
          [codigoProduto, descricaoProduto, data.codigo_produto, '0000.00.00', 'UN']
        );

        if (!updatedCount) {
          await pool.query(
            `INSERT INTO produtos_omie (codigo, descricao, codigo_produto, codigo_produto_integracao, ncm, unidade)
             VALUES ($1, $2, $3, $1, $4, $5)`,
            [codigoProduto, descricaoProduto, data.codigo_produto, '0000.00.00', 'UN']
          );
        }
        console.log(`${pfx}✅ Produto salvo na tabela produtos_omie`);
      } catch (dbErr) {
        console.warn(`${pfx}⚠️ Erro ao salvar na tabela local (não crítico):`, dbErr.message);
      }
      
      return { ok: true, codigo_produto: data.codigo_produto };
    } else {
      console.error(`${pfx}❌ Erro ao cadastrar produto:`, data);
      const erroDetalhado = data.faultstring || data.descricao_status || 'Erro desconhecido';
      return { ok: false, error: erroDetalhado };
    }
  } catch (err) {
    const pfx = contexto ? `[${contexto}] ` : '';
    console.error(`${pfx}❌ Erro na função cadastrarProdutoNaOmie:`, err.message);
    return { ok: false, error: err.message };
  }
}

// Endpoint para obter o próximo código provisório
// Verifica em produtos_omie E compras.solicitacao_compras para evitar duplicatas
app.get('/api/compras/proximo-codigo-provisorio', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH codigos AS (
        SELECT SUBSTRING(p.codigo FROM 'CODPROV\\s*-\\s*([0-9]+)')::INT AS numero
        FROM public.produtos_omie p
        WHERE p.codigo ILIKE 'CODPROV%'

        UNION ALL

        SELECT SUBSTRING(sc.produto_codigo FROM 'CODPROV\\s*-\\s*([0-9]+)')::INT AS numero
        FROM compras.solicitacao_compras sc
        WHERE sc.produto_codigo ILIKE 'CODPROV%'

        UNION ALL

        SELECT SUBSTRING(csc.produto_codigo FROM 'CODPROV\\s*-\\s*([0-9]+)')::INT AS numero
        FROM compras.compras_sem_cadastro csc
        WHERE csc.produto_codigo ILIKE 'CODPROV%'
      )
      SELECT COALESCE(MAX(numero), 0) AS maior_numero
      FROM codigos
      WHERE numero IS NOT NULL
    `);

    const maiorNumero = Number(rows?.[0]?.maior_numero || 0);
    
    // Próximo número é o maior encontrado + 1
    const proximoNumero = maiorNumero + 1;
    
    // Formata com 5 dígitos (ex: 00001, 00002, etc.)
    const codigoFormatado = `CODPROV - ${String(proximoNumero).padStart(5, '0')}`;
    
    console.log(`[API] Código provisório gerado: ${codigoFormatado} (maior anterior: ${maiorNumero})`);
    
    res.json({ ok: true, codigo: codigoFormatado });
    
  } catch (err) {
    console.error('[API] Erro ao gerar código provisório:', err);
    res.status(500).json({ ok: false, erro: 'Erro ao gerar código provisório' });
  }
});

// Endpoint para validar se um código existe na Omie
app.get('/api/compras/validar-codigo-omie', async (req, res) => {
  try {
    const { codigo } = req.query;
    
    if (!codigo) {
      return res.status(400).json({ ok: false, erro: 'Código não informado' });
    }
    
    // Verifica se o código existe na tabela produtos_omie
    const query = `
      SELECT codigo, descricao, codigo_produto 
      FROM produtos_omie 
      WHERE codigo = $1 
      LIMIT 1
    `;
    
    const result = await pool.query(query, [codigo]);
    
    if (result.rows.length > 0) {
      res.json({ 
        ok: true, 
        existe: true, 
        produto: result.rows[0] 
      });
    } else {
      res.json({ 
        ok: true, 
        existe: false 
      });
    }
    
  } catch (err) {
    console.error('[API] Erro ao validar código Omie:', err);
    res.status(500).json({ ok: false, erro: 'Erro ao validar código' });
  }
});

// GET /api/compras/departamentos - Lista departamentos disponíveis
app.get('/api/compras/departamentos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nome 
      FROM configuracoes.departamento 
      WHERE ativo = true 
      ORDER BY nome
    `);
    res.json({ ok: true, departamentos: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar departamentos:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar departamentos' });
  }
});

// GET /api/compras/centros-custo - Lista centros de custo disponíveis
app.get('/api/compras/centros-custo', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nome 
      FROM configuracoes.centro_custo 
      WHERE ativo = true 
      ORDER BY nome
    `);
    res.json({ ok: true, centros: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar centros de custo:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar centros de custo' });
  }
});

// GET /api/compras/status - Lista status de compras
app.get('/api/compras/status', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, nome 
      FROM configuracoes.status_compras 
      WHERE ativo = true 
      ORDER BY ordem, nome
    `);
    res.json({ ok: true, status: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar status:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar status' });
  }
});

// GET /api/compras/usuarios - Lista usuários para responsável inspeção
app.get('/api/compras/usuarios', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT username 
      FROM public.auth_user 
      WHERE username IS NOT NULL AND username != ''
      ORDER BY username
    `);
    res.json({ ok: true, usuarios: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar usuários:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar usuários' });
  }
});

// GET /api/produtos-omie/buscar-codigo - Busca codigo_produto da tabela produtos_omie pelo codigo
app.get('/api/produtos-omie/buscar-codigo', async (req, res) => {
  try {
    const { codigo } = req.query;
    
    if (!codigo) {
      return res.status(400).json({ ok: false, error: 'Código é obrigatório' });
    }
    
    const { rows } = await pool.query(`
      SELECT codigo_produto
      FROM public.produtos_omie
      WHERE codigo = $1
      LIMIT 1
    `, [codigo]);
    
    if (rows.length === 0) {
      return res.json({ ok: true, codigo_produto: null });
    }
    
    res.json({ ok: true, codigo_produto: rows[0].codigo_produto });
  } catch (err) {
    console.error('[Produtos Omie] Erro ao buscar codigo_produto:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar codigo_produto' });
  }
});

// POST /api/compras/pedido - Cria solicitações de compra (cada item independente, sem numero_pedido)
app.post('/api/compras/pedido', async (req, res) => {
  try {
    const { itens, solicitante } = req.body || {};
    
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum item no carrinho' });
    }
    
    if (!solicitante) {
      return res.status(400).json({ ok: false, error: 'Solicitante é obrigatório' });
    }
    
    // Não gera mais numero_pedido aqui - será gerado em outra etapa
    const client = await pool.connect();
    const idsInseridos = [];
    
    try {
      await client.query('BEGIN');
      
      for (const item of itens) {
        const {
          produto_codigo,
          produto_descricao,
          quantidade,
          prazo_solicitado,
          familia_codigo,
          familia_nome,
          observacao,
          departamento,
          centro_custo,
          objetivo_compra,
          resp_inspecao_recebimento,
          responsavel_pela_compra,
          retorno_cotacao,
          codigo_produto_omie,
          categoria_compra_codigo,
          categoria_compra_nome,
          codigo_omie,
          requisicao_direta,
          status_pedido,
          anexo
        } = item;
        
        // Aceita quantidade vazia (para casos de 'Não incluir quantidade')
        if (!produto_codigo || quantidade === undefined || quantidade === null) {
          throw new Error('Cada item precisa ter produto_codigo');
        }
        
        // Define status baseado no checkbox "Requisição Direta":
        // - requisicao_direta = true (marcado) → "aguardando compra"
        // - requisicao_direta = false/undefined (desmarcado) → "aguardando aprovação da requisição"
        let statusInicial;
        if (status_pedido) {
          // Se status foi informado manualmente pelo usuário, usa ele
          statusInicial = status_pedido;
        } else {
          // Define baseado no checkbox Requisição Direta
          if (requisicao_direta === true) {
            statusInicial = 'aguardando compra';
          } else {
            statusInicial = 'aguardando aprovação da requisição';
          }
        }
        
        // Marca para criação automática na Omie se requisicao_direta estiver marcado
        const deveCriarRequisicaoAutomatica = requisicao_direta === true && !status_pedido;
        
        console.log(`[Compras] Item ${produto_codigo} - Requisição Direta: ${requisicao_direta} - Status Final: ${statusInicial}`);
        
        // Processa anexo se houver - SALVA NO SUPABASE
        let anexosArray = null;
        if (anexo && anexo.base64) {
          try {
            const { createClient } = require('@supabase/supabase-js');
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
            
            if (!supabaseUrl || !supabaseKey) {
              throw new Error('Credenciais do Supabase não configuradas');
            }
            
            const supabase = createClient(supabaseUrl, supabaseKey);
            
            // Converte base64 para buffer
            const buffer = Buffer.from(anexo.base64, 'base64');
            
            // Gera nome único para o arquivo
            const timestamp = Date.now();
            const nomeArquivoSanitizado = anexo.nome.replace(/[^a-zA-Z0-9.-]/g, '_');
            const filePath = `compras/${timestamp}_${nomeArquivoSanitizado}`;
            
            const bucketName = 'compras-anexos';
            
            // Verifica se o bucket existe, se não, cria
            try {
              const { data: buckets } = await supabase.storage.listBuckets();
              const bucketExists = buckets?.some(b => b.name === bucketName);
              
              if (!bucketExists) {
                console.log(`[Compras] Criando bucket '${bucketName}' no Supabase...`);
                await supabase.storage.createBucket(bucketName, {
                  public: true,
                  fileSizeLimit: 10485760,
                  allowedMimeTypes: ['image/*', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
                });
              }
            } catch (bucketError) {
              console.warn('[Compras] Aviso ao verificar bucket:', bucketError.message);
            }
            
            // Upload para o Supabase
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from(bucketName)
              .upload(filePath, buffer, {
                contentType: anexo.tipo,
                upsert: false
              });
            
            if (uploadError) {
              throw new Error(`Erro no upload Supabase: ${uploadError.message}`);
            }
            
            // Gera URL pública
            const { data: publicData } = supabase.storage
              .from(bucketName)
              .getPublicUrl(filePath);
            
            anexosArray = [{
              nome: anexo.nome,
              url: publicData.publicUrl,
              tipo: anexo.tipo,
              tamanho: anexo.tamanho,
              data_upload: new Date().toISOString()
            }];
            
            console.log(`[Compras] Anexo salvo no Supabase: ${anexo.nome} -> ${publicData.publicUrl}`);
          } catch (errAnexo) {
            console.error('[Compras] Erro ao processar anexo:', errAnexo);
            // Continua sem o anexo
          }
        }
        
        // Insere item sem numero_pedido (NULL) - será preenchido em etapa posterior
        const result = await client.query(`
          INSERT INTO compras.solicitacao_compras (
            produto_codigo,
            produto_descricao,
            quantidade,
            prazo_solicitado,
            familia_produto,
            status,
            observacao,
            solicitante,
            departamento,
            centro_custo,
            objetivo_compra,
            resp_inspecao_recebimento,
            responsavel_pela_compra,
            retorno_cotacao,
            codigo_produto_omie,
            categoria_compra_codigo,
            categoria_compra_nome,
            codigo_omie,
            requisicao_direta,
            anexos,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW())
          RETURNING id
        `, [
          produto_codigo,
          produto_descricao || '',
          quantidade === '' ? null : quantidade, // Converte quantidade vazia para NULL
          prazo_solicitado || null,
          familia_nome || null,
          statusInicial,
          observacao || '',
          solicitante,
          departamento || null,
          centro_custo || null,
          objetivo_compra || null,
          resp_inspecao_recebimento || solicitante,
          responsavel_pela_compra || null,
          retorno_cotacao || null,
          codigo_produto_omie || null,
          categoria_compra_codigo || null,
          categoria_compra_nome || null,
          codigo_omie || null,
          requisicao_direta || false,
          anexosArray ? JSON.stringify(anexosArray) : null
        ]);
        
        idsInseridos.push(result.rows[0].id);
        
        // Armazena informação de requisição direta para processamento posterior
        // Só marca para criação automática se requisicao_direta = true E status_pedido não foi informado manualmente
        if (deveCriarRequisicaoAutomatica) {
          // Marca que este item precisa ser processado automaticamente
          idsInseridos[idsInseridos.length - 1] = {
            id: result.rows[0].id,
            requisicao_direta: true
          };
        } else {
          idsInseridos[idsInseridos.length - 1] = {
            id: result.rows[0].id,
            requisicao_direta: false
          };
        }
      }
      
      await client.query('COMMIT');
      
      // Extrai apenas os IDs para log e resposta
      const idsSimples = idsInseridos.map(item => typeof item === 'object' ? item.id : item);
      const idsRequisicaoDireta = idsInseridos.filter(item => typeof item === 'object' && item.requisicao_direta === true).map(item => item.id);
      
      console.log(`[Compras] ${itens.length} item(ns) criado(s) por ${solicitante} - IDs: ${idsSimples.join(', ')}`);
      
      if (idsRequisicaoDireta.length > 0) {
        console.log(`[Compras] ${idsRequisicaoDireta.length} item(ns) marcado(s) para requisição direta (aguardando compra)`);
      }
      
      res.json({
        ok: true,
        total_itens: itens.length,
        ids: idsSimples,
        ids_requisicao_direta: idsRequisicaoDireta
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Compras] Erro ao criar solicitações:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao criar solicitações' });
  }
});

// POST /api/compras/solicitacao - Cria solicitações agrupadas por NP (do modal de carrinho)
app.post('/api/compras/solicitacao', express.json(), async (req, res) => {
  try {
    const { itens, compra_autorizada, compra_realizada, n_nota_fiscal } = req.body || {};
    const compraAutorizada = compra_autorizada === true;
    const compraRealizada = compra_realizada === true;
    const notaFiscalGlobal = String(n_nota_fiscal || '').trim();
    
    // Obtém usuário da sessão
    const solicitante = req.session?.user?.username || req.session?.user?.id || 'sistema';
    
    console.log('[Compras-Solicitacao] Recebido:', {
      totalItens: itens?.length,
      compraAutorizada,
      primeiroItem: itens?.[0]
    });
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum item no carrinho' });
    }

    const client = await pool.connect();
    const idsInseridos = [];
    const idsRequisicaoDireta = [];
    const itensDiretosParaProcessar = [];
    const statusPorGrupo = new Map();
    
    try {
      await client.query('BEGIN');
      
      for (const item of itens) {
        const {
          id_db,
          produto_codigo,
          produto_descricao,
          quantidade,
          prazo_solicitado,
          familia_codigo,
          familia_nome,
          observacao,
          departamento,
          centro_custo,
          objetivo_compra,
          resp_inspecao_recebimento,
          responsavel_pela_compra,
          retorno_cotacao,
          codigo_produto_omie,
          categoria_compra,
          codigo_omie,
          requisicao_direta,
          np,
          status_pedido,
          anexo,
          anexo_url
        } = item;

        const notaFiscalItem = String(item.nota_fiscal || notaFiscalGlobal || '').trim();
        if (compraRealizada && !notaFiscalItem) {
          throw new Error('N nota fiscal é obrigatório quando Compra já realizada estiver marcado');
        }
        
        // Aceita quantidade vazia (para casos de 'Não incluir quantidade')
        if (!produto_codigo || quantidade === undefined || quantidade === null) {
          throw new Error('Cada item precisa ter produto_codigo');
        }
        
        const requisicaoDiretaFinal = compraRealizada || compraAutorizada || requisicao_direta === true;

        // Regras:
        // - compra_autorizada = true (checkbox global do carrinho) → força fluxo de requisição direta
        // - requisicao_direta = true (item) → fluxo de requisição direta
        // - demais casos → aguarda aprovação da requisição
        let statusInicial;
        if (compraRealizada) {
          statusInicial = 'compra realizada';
        } else if (compraAutorizada) {
          // Regra do modal "Meu Carrinho de Compras":
          // compra já autorizada deve entrar diretamente como Requisição.
          statusInicial = 'Requisição';
        } else if (requisicaoDiretaFinal) {
          statusInicial = 'aguardando compra';
        } else {
          statusInicial = 'aguardando aprovação da requisição';
        }
        
        console.log(`[Compras-Solicitacao] Item ${produto_codigo} - NP: ${np} - Requisição Direta Item: ${requisicao_direta} - Compra Autorizada: ${compraAutorizada} - Requisição Direta Final: ${requisicaoDiretaFinal} - Status: ${statusInicial}`);
        
        // Processa anexo(s) se houver - SALVA NO SUPABASE
        let anexosArray = null;
        if (anexo) {
          try {
            const { createClient } = require('@supabase/supabase-js');
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
            
            if (!supabaseUrl || !supabaseKey) {
              throw new Error('Credenciais do Supabase não configuradas');
            }
            
            const supabase = createClient(supabaseUrl, supabaseKey);
            const bucketName = 'compras-anexos';
            
            // Verifica se o bucket existe, se não, cria
            try {
              const { data: buckets } = await supabase.storage.listBuckets();
              const bucketExists = buckets?.some(b => b.name === bucketName);
              
              if (!bucketExists) {
                console.log(`[Compras-Solicitacao] Criando bucket '${bucketName}' no Supabase...`);
                await supabase.storage.createBucket(bucketName, {
                  public: true,
                  fileSizeLimit: 10485760,
                  allowedMimeTypes: ['image/*', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
                });
              }
            } catch (bucketError) {
              console.warn('[Compras-Solicitacao] Aviso ao verificar bucket:', bucketError.message);
            }
            
            // Normaliza para array (pode vir como objeto único ou array)
            const anexosParaProcessar = Array.isArray(anexo) ? anexo : [anexo];
            anexosArray = [];
            
            // Processa cada anexo
            for (const arq of anexosParaProcessar) {
              if (!arq.base64) continue;
              
              // Converte base64 para buffer
              const buffer = Buffer.from(arq.base64, 'base64');
              
              // Gera nome único para o arquivo
              const timestamp = Date.now();
              const nomeArquivoSanitizado = arq.nome.replace(/[^a-zA-Z0-9.-]/g, '_');
              const filePath = `compras/${timestamp}_${nomeArquivoSanitizado}`;
              
              // Upload para o Supabase
              const { data: uploadData, error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, buffer, {
                  contentType: arq.tipo,
                  upsert: false
                });
              
              if (uploadError) {
                console.error(`[Compras-Solicitacao] Erro no upload de ${arq.nome}:`, uploadError.message);
                continue;
              }
              
              // Gera URL pública
              const { data: publicData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(filePath);
              
              anexosArray.push({
                nome: arq.nome,
                url: publicData.publicUrl,
                tipo: arq.tipo,
                tamanho: arq.tamanho,
                data_upload: new Date().toISOString()
              });
              
              console.log(`[Compras-Solicitacao] Anexo salvo: ${arq.nome} -> ${publicData.publicUrl}`);
            }
            
            // Se nenhum anexo foi processado com sucesso, define como null
            if (anexosArray.length === 0) {
              anexosArray = null;
            }
          } catch (errAnexo) {
            console.error('[Compras-Solicitacao] Erro ao processar anexos:', errAnexo);
            anexosArray = null;
          }
        }
        
        const categoriaCompraCodigo = item.categoria_compra_codigo || categoria_compra || null;
        const categoriaCompraNome = item.categoria_compra_nome || item.categoria_compra_label || item.categoria_compra_texto || null;
        const objetivoCompraRaw = item.objetivo_compra || item.objetivo_compra_nome || '';
        const objetivoSemPrefixo = String(objetivoCompraRaw || '').replace(/^\s*nfe\s*:\s*/i, '').trim();
        const objetivoCompraFinalBase = objetivoSemPrefixo || 'Compra via catálogo Omie';
        const objetivoCompraFinal = compraRealizada
          ? `NFe: ${notaFiscalItem}${objetivoCompraFinalBase ? ` - ${objetivoCompraFinalBase}` : ''}`
          : objetivoCompraFinalBase;
        const anexoUrlFinal = item.anexo_url || anexo_url || null;
        const respInspecaoFinal = resp_inspecao_recebimento || solicitante;
        const grupoRequisicao = item.grupo_requisicao || item.np || null;
        const idCarrinho = Number(id_db);

        if (grupoRequisicao) {
          statusPorGrupo.set(String(grupoRequisicao).trim(), statusInicial);
        }

        // Se o item veio do carrinho (status carrinho), atualiza ao invés de inserir
        if (Number.isFinite(idCarrinho) && idCarrinho > 0) {
          const updateResult = await client.query(`
            UPDATE compras.solicitacao_compras
            SET produto_codigo = $1,
                produto_descricao = $2,
                quantidade = $3,
                prazo_solicitado = $4,
                status = $5,
                observacao = $6,
                solicitante = $7,
                departamento = $8,
                centro_custo = $9,
                objetivo_compra = $10,
                categoria_compra_codigo = $11,
                retorno_cotacao = $12,
                resp_inspecao_recebimento = $13,
                codigo_produto_omie = $14,
                codigo_omie = $15,
                grupo_requisicao = $16,
                anexos = COALESCE($17, anexos),
                anexo_url = COALESCE($18, anexo_url),
                updated_at = NOW()
              WHERE id = $19
            RETURNING id
          `, [
            produto_codigo,
            produto_descricao || '',
            quantidade === '' ? null : quantidade,
            prazo_solicitado || null,
            statusInicial,
            observacao || '',
            solicitante,
            departamento || null,
            centro_custo || null,
            objetivoCompraFinal,
            categoriaCompraCodigo,
            retorno_cotacao || null,
            respInspecaoFinal,
            codigo_produto_omie || null,
            codigo_omie || null,
            grupoRequisicao,
            anexosArray ? JSON.stringify(anexosArray) : null,
            anexoUrlFinal,
            idCarrinho
          ]);

          if (updateResult.rowCount > 0) {
            const itemId = updateResult.rows[0].id;
            idsInseridos.push(itemId);
            if (requisicaoDiretaFinal) {
              idsRequisicaoDireta.push(itemId);
              itensDiretosParaProcessar.push({
                item: { ...item, requisicao_direta: true, compra_realizada: compraRealizada },
                idDb: itemId
              });
            }
            continue;
          }
        }

        // Insere item na solicitacao_compras com os campos corretos
        const result = await client.query(`
          INSERT INTO compras.solicitacao_compras (
            produto_codigo,
            produto_descricao,
            quantidade,
            prazo_solicitado,
            status,
            observacao,
            solicitante,
            departamento,
            centro_custo,
            objetivo_compra,
            categoria_compra_codigo,
            retorno_cotacao,
            resp_inspecao_recebimento,
            codigo_produto_omie,
            codigo_omie,
            grupo_requisicao,
            anexos,
            anexo_url,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())
          RETURNING id
        `, [
          produto_codigo,
          produto_descricao || '',
          quantidade === '' ? null : quantidade, // Converte quantidade vazia para NULL
          prazo_solicitado || null,
          statusInicial,
          observacao || '',
          solicitante,
          departamento || null,
          centro_custo || null,
          objetivoCompraFinal,
          categoriaCompraCodigo, // categoria_compra_codigo - usa o código recebido do frontend
          retorno_cotacao || null,
          respInspecaoFinal,
          codigo_produto_omie || null,
          codigo_omie || null,
          item.grupo_requisicao || item.np || null,
          anexosArray ? JSON.stringify(anexosArray) : null,
          anexoUrlFinal
        ]);
        
        const itemId = result.rows[0].id;
        idsInseridos.push(itemId);
        
        // Se checkbox Requisição Direta estiver marcado, marca para criar na Omie
        if (requisicaoDiretaFinal) {
          idsRequisicaoDireta.push(itemId);
          itensDiretosParaProcessar.push({
            item: { ...item, requisicao_direta: true, compra_realizada: compraRealizada },
            idDb: itemId
          });
        }
      }
      
      await client.query('COMMIT');
      
      console.log(`[Compras-Solicitacao] ${itens.length} item(ns) criado(s) por ${solicitante} - IDs: ${idsInseridos.join(', ')}`);
      console.log(`[Compras-Solicitacao] ${idsRequisicaoDireta.length} item(ns) com Requisição Direta para processar na Omie`);
      
      // APÓS inserir/atualizar no banco, processa os itens diretos na Omie (agrupados por NP)
      const gruposNP = {};
      const omieResultados = [];
      itensDiretosParaProcessar.forEach((itemGroup) => {
        const np = itemGroup.item?.np || 'A';
        if (!gruposNP[np]) gruposNP[np] = [];
        gruposNP[np].push(itemGroup);
      });
      
      // Processa cada grupo de NP
      for (const [np, itemsGroup] of Object.entries(gruposNP)) {
        try {
          const resultadoOmie = await processarRequisicaoDiretaNaOmie(client, itemsGroup, solicitante);
          if (resultadoOmie) omieResultados.push(resultadoOmie);
        } catch (errOmie) {
          console.error(`[Compras-Solicitacao] Erro ao processar requisição Omie para NP ${np}:`, errOmie);
          // Continua processando os outros grupos mesmo se um falhar
        }
      }

      const numerosCompraOmie = omieResultados
        .filter((r) => r?.tipo === 'pedido_compra' && r?.numero_pedido)
        .map((r) => String(r.numero_pedido));

      for (const [grupoRequisicao, statusGrupo] of statusPorGrupo.entries()) {
        await upsertStatusHistoricoCompras({
          grupoRequisicao,
          status: statusGrupo,
          tableSource: 'solicitacao_compras',
          client
        });
      }
      
      res.json({
        ok: true,
        total_itens: itens.length,
        ids: idsInseridos,
        ids_requisicao_direta: idsRequisicaoDireta,
        solicitante: solicitante,
        omie_resultados: omieResultados,
        numeros_compra_omie: numerosCompraOmie
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Compras-Solicitacao] Erro ao criar solicitações:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao criar solicitações' });
  }
});

// POST /api/compras/carrinho - Registra item do carrinho com status "carrinho"
app.post('/api/compras/carrinho', express.json(), async (req, res) => {
  try {
    const item = req.body || {};
    const produtoCodigo = String(item.produto_codigo || '').trim();
    if (!produtoCodigo) {
      return res.status(400).json({ ok: false, error: 'produto_codigo é obrigatório' });
    }

    const solicitante = req.session?.user?.username || req.session?.user?.id || item.solicitante || 'sistema';
    const categoriaCompraCodigo = item.categoria_compra_codigo || item.categoria_compra || null;
    const categoriaCompraNome = item.categoria_compra_nome || item.categoria_compra_label || item.categoria_compra_texto || null;
    const objetivoCompraRaw = item.objetivo_compra || item.objetivo_compra_nome || '';
    const objetivoCompraFinal = String(objetivoCompraRaw || '').trim() || 'Compra via catálogo Omie';
    const respInspecaoFinal = item.resp_inspecao_recebimento || item.responsavel || solicitante;

    const normalizarAnexos = (raw) => {
      if (!raw) return null;
      const arr = Array.isArray(raw) ? raw : [raw];
      const limpos = arr.map(a => ({
        nome: a?.nome || null,
        tipo: a?.tipo || null,
        tamanho: a?.tamanho || null,
        url: a?.url || null
      })).filter(a => a.nome || a.url);
      return limpos.length ? limpos : null;
    };

    const anexosArray = normalizarAnexos(item.anexo || item.anexos);
    const anexoUrlFinal = item.anexo_url || null;
    const grupoRequisicaoRaw = item.grupo_requisicao || item.np || null;
    
    // Comentário: Verifica se existe grupo_requisicao do mesmo dia antes de gerar novo
    let grupoRequisicao = grupoRequisicaoRaw;
    if (!grupoRequisicaoRaw || String(grupoRequisicaoRaw).toLowerCase() === 'unica') {
      // Busca grupo_requisicao mais recente (ORDER BY created_at DESC) do mesmo dia do usuário
      const dataHoje = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const buscaGrupoResult = await pool.query(`
        SELECT sc.grupo_requisicao
        FROM compras.solicitacao_compras sc
        JOIN compras.historico_compras hc
          ON LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))) = LOWER(TRIM(COALESCE(sc.grupo_requisicao, '')))
        WHERE sc.solicitante = $1
          AND LOWER(TRIM(COALESCE(hc.status, ''))) = LOWER('carrinho')
          AND sc.grupo_requisicao IS NOT NULL
          AND DATE(sc.created_at) = $2
        ORDER BY sc.created_at DESC
        LIMIT 1
      `, [solicitante, dataHoje]);
      
      if (buscaGrupoResult.rows.length > 0 && buscaGrupoResult.rows[0].grupo_requisicao) {
        grupoRequisicao = buscaGrupoResult.rows[0].grupo_requisicao;
        console.log(`[Carrinho] Reutilizando grupo_requisicao mais recente do dia: ${grupoRequisicao}`);
      } else {
        grupoRequisicao = gerarNumeroGrupoRequisicao();
        console.log(`[Carrinho] Novo grupo_requisicao gerado: ${grupoRequisicao}`);
      }
    }

    const result = await pool.query(`
      INSERT INTO compras.solicitacao_compras (
        produto_codigo,
        produto_descricao,
        quantidade,
        prazo_solicitado,
        familia_produto,
        status,
        observacao,
        solicitante,
        departamento,
        centro_custo,
        objetivo_compra,
        resp_inspecao_recebimento,
        responsavel_pela_compra,
        retorno_cotacao,
        codigo_produto_omie,
        categoria_compra_codigo,
        categoria_compra_nome,
        codigo_omie,
        requisicao_direta,
        grupo_requisicao,
        anexos,
        anexo_url,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'carrinho', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW()
      )
      RETURNING id
    `, [
      produtoCodigo,
      item.produto_descricao || '',
      item.quantidade === '' ? null : item.quantidade,
      item.prazo_solicitado || null,
      item.familia_nome || item.familia_produto || null,
      item.observacao || '',
      solicitante,
      item.departamento || null,
      item.centro_custo || null,
      objetivoCompraFinal,
      respInspecaoFinal,
      item.responsavel_pela_compra || null,
      item.retorno_cotacao || null,
      item.codigo_produto_omie || null,
      categoriaCompraCodigo,
      categoriaCompraNome,
      item.codigo_omie || null,
      item.requisicao_direta || false,
      grupoRequisicao,
      anexosArray ? JSON.stringify(anexosArray) : null,
      anexoUrlFinal
    ]);

    await upsertStatusHistoricoCompras({
      grupoRequisicao,
      status: 'carrinho',
      tableSource: 'solicitacao_compras'
    });

    res.json({ ok: true, id: result.rows[0]?.id, grupo_requisicao: grupoRequisicao });
  } catch (err) {
    console.error('[Compras] Erro ao registrar carrinho:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao registrar carrinho' });
  }
});

// PUT /api/compras/carrinho/:id - Atualiza item do carrinho (status "carrinho")
app.put('/api/compras/carrinho/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const item = req.body || {};
    const solicitante = req.session?.user?.username || req.session?.user?.id || item.solicitante || 'sistema';
    const categoriaCompraCodigo = item.categoria_compra_codigo || item.categoria_compra || null;
    const categoriaCompraNome = item.categoria_compra_nome || item.categoria_compra_label || item.categoria_compra_texto || null;
    const objetivoCompraRaw = item.objetivo_compra || item.objetivo_compra_nome || '';
    const objetivoCompraFinal = String(objetivoCompraRaw || '').trim() || 'Compra via catálogo Omie';
    const respInspecaoFinal = item.resp_inspecao_recebimento || item.responsavel || solicitante;

    const normalizarAnexos = (raw) => {
      if (!raw) return null;
      const arr = Array.isArray(raw) ? raw : [raw];
      const limpos = arr.map(a => ({
        nome: a?.nome || null,
        tipo: a?.tipo || null,
        tamanho: a?.tamanho || null,
        url: a?.url || null
      })).filter(a => a.nome || a.url);
      return limpos.length ? limpos : null;
    };

    const anexosArray = normalizarAnexos(item.anexo || item.anexos);
    const anexoUrlFinal = item.anexo_url || null;
    const grupoRequisicaoRaw = item.grupo_requisicao || item.np || null;
    const grupoRequisicao = (!grupoRequisicaoRaw || String(grupoRequisicaoRaw).toLowerCase() === 'unica')
      ? gerarNumeroGrupoRequisicao()
      : grupoRequisicaoRaw;

    const result = await pool.query(`
      UPDATE compras.solicitacao_compras
      SET produto_codigo = $1,
          produto_descricao = $2,
          quantidade = $3,
          prazo_solicitado = $4,
          familia_produto = $5,
          observacao = $6,
          solicitante = $7,
          departamento = $8,
          centro_custo = $9,
          objetivo_compra = $10,
          resp_inspecao_recebimento = $11,
          responsavel_pela_compra = $12,
          retorno_cotacao = $13,
          codigo_produto_omie = $14,
          categoria_compra_codigo = $15,
          categoria_compra_nome = $16,
          codigo_omie = $17,
          requisicao_direta = $18,
          grupo_requisicao = COALESCE($19, grupo_requisicao),
          anexos = COALESCE($20, anexos),
            anexo_url = COALESCE($21, anexo_url),
          updated_at = NOW()
          WHERE id = $22
      RETURNING id
    `, [
      String(item.produto_codigo || '').trim(),
      item.produto_descricao || '',
      item.quantidade === '' ? null : item.quantidade,
      item.prazo_solicitado || null,
      item.familia_nome || item.familia_produto || null,
      item.observacao || '',
      solicitante,
      item.departamento || null,
      item.centro_custo || null,
      objetivoCompraFinal,
      respInspecaoFinal,
      item.responsavel_pela_compra || null,
      item.retorno_cotacao || null,
      item.codigo_produto_omie || null,
      categoriaCompraCodigo,
      categoriaCompraNome,
      item.codigo_omie || null,
      item.requisicao_direta || false,
      grupoRequisicao,
      anexosArray ? JSON.stringify(anexosArray) : null,
      anexoUrlFinal,
      id
    ]);

    if (!result.rowCount) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado no carrinho' });
    }

    await upsertStatusHistoricoCompras({
      grupoRequisicao,
      status: 'carrinho',
      tableSource: 'solicitacao_compras'
    });

    res.json({ ok: true, id: result.rows[0]?.id });
  } catch (err) {
    console.error('[Compras] Erro ao atualizar carrinho:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao atualizar carrinho' });
  }
});

// DELETE /api/compras/carrinho/:id - Remove item do carrinho (status "carrinho")
app.delete('/api/compras/carrinho/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const { rows: itemRows } = await pool.query(
      `SELECT id, grupo_requisicao FROM compras.solicitacao_compras WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!itemRows.length) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado no carrinho' });
    }

    const grupoRequisicao = String(itemRows[0]?.grupo_requisicao || '').trim();

    const result = await pool.query(
      `DELETE FROM compras.solicitacao_compras WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado no carrinho' });
    }

    if (grupoRequisicao) {
      const { rows: restantes } = await pool.query(
        `SELECT id FROM compras.solicitacao_compras WHERE LOWER(TRIM(COALESCE(grupo_requisicao, ''))) = LOWER(TRIM($1)) LIMIT 1`,
        [grupoRequisicao]
      );

      if (!restantes.length) {
        await pool.query(`DELETE FROM compras.historico_compras WHERE grupo_requisicao = $1`, [grupoRequisicao]);
      }
    }

    res.json({ ok: true, id: result.rows[0]?.id });
  } catch (err) {
    console.error('[Compras] Erro ao remover item do carrinho:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao remover item do carrinho' });
  }
});

// POST /api/compras/gerar-novo-grupo - Gera um novo grupo_requisicao único
app.post('/api/compras/gerar-novo-grupo', express.json(), async (req, res) => {
  try {
    // Comentário: Gera sempre um novo número de grupo_requisicao
    const novoGrupo = gerarNumeroGrupoRequisicao();
    console.log(`[Compras] Novo grupo_requisicao gerado via API: ${novoGrupo}`);
    res.json({ ok: true, grupo_requisicao: novoGrupo });
  } catch (err) {
    console.error('[Compras] Erro ao gerar novo grupo:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao gerar novo grupo' });
  }
});

// GET /api/compras/carrinho - Lista itens do carrinho do solicitante logado
app.get('/api/compras/carrinho', async (req, res) => {
  try {
    const solicitante = req.session?.user?.username || req.session?.user?.id;
    if (!solicitante) {
      return res.status(401).json({ ok: false, error: 'Não autenticado' });
    }

    const { rows } = await pool.query(`
      SELECT
        sc.id,
        sc.produto_codigo,
        sc.produto_descricao,
        sc.quantidade,
        sc.prazo_solicitado,
        sc.familia_produto,
        sc.observacao,
        sc.observacao_reprovacao,
        sc.solicitante,
        sc.departamento,
        sc.centro_custo,
        sc.objetivo_compra,
        sc.resp_inspecao_recebimento,
        sc.responsavel_pela_compra,
        sc.retorno_cotacao,
        sc.codigo_produto_omie,
        sc.categoria_compra_codigo,
        sc.categoria_compra_nome,
        sc.codigo_omie,
        sc.requisicao_direta,
        sc.grupo_requisicao,
        sc.anexos,
        sc.anexo_url,
        sc.created_at,
        sc.updated_at
      FROM compras.solicitacao_compras sc
      JOIN compras.historico_compras hc
        ON LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))) = LOWER(TRIM(COALESCE(sc.grupo_requisicao, '')))
      WHERE LOWER(TRIM(COALESCE(hc.status, ''))) = LOWER('carrinho')
        AND sc.solicitante = $1
      ORDER BY sc.created_at DESC, sc.id DESC
    `, [solicitante]);

    res.json({ ok: true, itens: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar carrinho:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao listar carrinho' });
  }
});

// GET /api/compras/grupos-requisicao - Lista grupos disponíveis por status
app.get('/api/compras/grupos-requisicao', async (req, res) => {
  try {
    const solicitante = req.session?.user?.username || req.session?.user?.id;
    if (!solicitante) {
      return res.status(401).json({ ok: false, error: 'Não autenticado' });
    }

    const { rows } = await pool.query(`
      SELECT DISTINCT sc.grupo_requisicao
      FROM compras.solicitacao_compras sc
      JOIN compras.historico_compras hc
        ON LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))) = LOWER(TRIM(COALESCE(sc.grupo_requisicao, '')))
      WHERE sc.grupo_requisicao IS NOT NULL
        AND LOWER(TRIM(COALESCE(hc.status, ''))) IN (LOWER('aguardando aprovação da requisição'), LOWER('carrinho'))
        AND sc.solicitante = $1
      ORDER BY sc.grupo_requisicao ASC
    `, [solicitante]);

    res.json({ ok: true, grupos: rows.map(r => r.grupo_requisicao) });
  } catch (err) {
    console.error('[Compras] Erro ao listar grupos de requisição:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao listar grupos' });
  }
});

// ========== GERENCIADOR DE RATE LIMITING PARA API OMIE ==========
// Objetivo: Respeitar o limite de 3 requisições por minuto da Omie
// Mantém histórico das requisições e aguarda se necessário antes de enviar
class OmieRateLimiter {
  constructor(maxRequisicoes = 3, intervaloMinutos = 1) {
    this.maxRequisicoes = maxRequisicoes;           // 3 requisições
    this.intervaloMs = intervaloMinutos * 60 * 1000; // 60 segundos em ms
    this.requisicoes = [];                           // Array com timestamps das requisições
  }

  /**
   * Aguarda se necessário e marca uma nova requisição
   * Antes de enviar para Omie, chame este método
   */
  async aguardarDisponibilidade() {
    const agora = Date.now();
    
    // Remove requisições mais antigas que o intervalo
    this.requisicoes = this.requisicoes.filter(timestamp => {
      return agora - timestamp < this.intervaloMs;
    });

    // Se já atingiu o limite, aguarda
    if (this.requisicoes.length >= this.maxRequisicoes) {
      const tempoMaisAntigo = this.requisicoes[0];
      const tempoEspera = this.intervaloMs - (agora - tempoMaisAntigo);
      
      console.log(`[Omie-RateLimit] Limite atingido (${this.requisicoes.length}/${this.maxRequisicoes}). Aguardando ${Math.ceil(tempoEspera / 1000)}s antes de enviar...`);
      
      await new Promise(resolve => setTimeout(resolve, tempoEspera));
      
      // Após aguardar, remove requisições expiradas
      this.requisicoes = this.requisicoes.filter(timestamp => {
        return Date.now() - timestamp < this.intervaloMs;
      });
    }

    // Registra nova requisição
    this.requisicoes.push(Date.now());
    console.log(`[Omie-RateLimit] Enviando requisição (${this.requisicoes.length}/${this.maxRequisicoes}). Próxima disponível em 60s.`);
  }
}

// Instância global do gerenciador de rate limiting
const omieRateLimiter = new OmieRateLimiter(3, 1); // 3 requisições por 1 minuto

// Comentário: gera identificador no mesmo formato de numero_pedido
function gerarNumeroGrupoRequisicao() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  const hora = String(agora.getHours()).padStart(2, '0');
  const minuto = String(agora.getMinutes()).padStart(2, '0');
  const segundo = String(agora.getSeconds()).padStart(2, '0');
  const milisegundo = String(agora.getMilliseconds()).padStart(3, '0');
  return `${ano}${mes}${dia}-${hora}${minuto}${segundo}-${milisegundo}`;
}

async function upsertStatusHistoricoCompras({ grupoRequisicao, status, tableSource = null, client = null, dados = null }) {
  const grupo = String(grupoRequisicao || '').trim();
  const novoStatus = String(status || '').trim();
  if (!grupo || !novoStatus) return;
  const dadosPayload = dados && typeof dados === 'object'
    ? dados
    : {
        origem: 'upsertStatusHistoricoCompras',
        status: novoStatus,
        tabela_origem: tableSource || null,
        grupo_requisicao: grupo,
        ts: new Date().toISOString()
      };

  const executor = client || pool;
  await executor.query(`
    INSERT INTO compras.historico_compras (
      grupo_requisicao,
      status,
      tabela_origem,
      dados,
      created_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      NOW()
    )
    ON CONFLICT (grupo_requisicao)
    DO UPDATE SET
      status = EXCLUDED.status,
      tabela_origem = COALESCE(EXCLUDED.tabela_origem, compras.historico_compras.tabela_origem),
      dados = COALESCE(EXCLUDED.dados, compras.historico_compras.dados),
      created_at = NOW()
  `, [
    grupo,
    novoStatus,
    tableSource,
    JSON.stringify(dadosPayload)
  ]);
}

async function obterStatusHistoricoPorGrupo({ grupoRequisicao, client = null }) {
  const grupo = String(grupoRequisicao || '').trim();
  if (!grupo) return null;
  const executor = client || pool;
  const { rows } = await executor.query(
    `SELECT status FROM compras.historico_compras WHERE grupo_requisicao = $1 LIMIT 1`,
    [grupo]
  );
  return rows[0]?.status || null;
}

// POST /api/compras/sem-cadastro - Registra solicitação de compra para produto SEM cadastro na Omie
app.post('/api/compras/sem-cadastro', express.json(), async (req, res) => {
  try {
    const item = req.body || {};
    const reqId = `SEM-CAD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const t0 = Date.now();
    const log = (...args) => console.log(`[Compras Direta][${reqId}]`, ...args);
    const logErr = (...args) => console.error(`[Compras Direta][${reqId}]`, ...args);

    log('🚀 Início processamento');
    
    // Comentário: gera código provisório sequencial (CODPROV - 00001) considerando ambas as tabelas.
    const obterProximoCodigoProvisorio = async () => {
      const { rows: maxRows } = await pool.query(`
        SELECT COALESCE(MAX(num), 0) AS max_num
        FROM (
          SELECT CAST(NULLIF(regexp_replace(produto_codigo, '\\D', '', 'g'), '') AS INT) AS num
          FROM compras.solicitacao_compras
          WHERE produto_codigo ILIKE 'CODPROV%'
          UNION ALL
          SELECT CAST(NULLIF(regexp_replace(produto_codigo, '\\D', '', 'g'), '') AS INT) AS num
          FROM compras.compras_sem_cadastro
          WHERE produto_codigo ILIKE 'CODPROV%'
        ) AS codigos
      `);
      const atual = Number(maxRows[0]?.max_num || 0);
      const proximo = atual + 1;
      return `CODPROV - ${String(proximo).padStart(5, '0')}`;
    };

    // Validações obrigatórias
    const produtoCodigoPayload = String(item.produto_codigo || '').trim();
    const produtoDescricaoPayload = String(item.produto_descricao || '').trim();
    const quantidadePayload = parseInt(item.quantidade, 10) || 1;
    const departamento = String(item.departamento || '').trim();
    const centroCusto = String(item.centro_custo || '').trim();

    const normalizarItensSemCadastro = (rawItens, descricaoFallback, qtdFallback) => {
      const itensPayload = Array.isArray(rawItens)
        ? rawItens.map((it) => ({
            descricao: String(it?.descricao || '').trim(),
            quantidade: Number.parseInt(it?.quantidade, 10)
          }))
        : [];

      if (itensPayload.length > 0) {
        return itensPayload
          .filter((it) => it.descricao)
          .map((it) => ({
            descricao: it.descricao,
            quantidade: Number.isFinite(it.quantidade) && it.quantidade > 0 ? it.quantidade : 1
          }));
      }

      const descricao = String(descricaoFallback || '').trim();
      if (!descricao) return [];

      const tokens = descricao.split(';').map((s) => String(s || '').trim()).filter(Boolean);
      if (!tokens.length) {
        return [{ descricao, quantidade: Number.isFinite(qtdFallback) && qtdFallback > 0 ? qtdFallback : 1 }];
      }

      return tokens.map((token) => {
        return {
          descricao: token,
          quantidade: Number.isFinite(qtdFallback) && qtdFallback > 0 ? qtdFallback : 1
        };
      }).filter((it) => it.descricao);
    };

    const itensSemCadastro = normalizarItensSemCadastro(item.itens_sem_cadastro, produtoDescricaoPayload, quantidadePayload);
    log('Itens normalizados:', itensSemCadastro.map((it, idx) => ({ index: idx, descricao: it.descricao, quantidade: it.quantidade })));

    if (!itensSemCadastro.length) {
      return res.status(400).json({ ok: false, error: 'produto_descricao ou itens_sem_cadastro é obrigatório' });
    }

    if (!departamento) {
      return res.status(400).json({ ok: false, error: 'departamento é obrigatório' });
    }
    if (!centroCusto) {
      return res.status(400).json({ ok: false, error: 'centro_custo (categoria) é obrigatório' });
    }
    
    const solicitante = req.session?.user?.username || req.session?.user?.id || item.solicitante || 'sistema';
    const categoriaCompraCodigo = item.categoria_compra_codigo || item.categoria_compra || '2.14.94';
    const categoriaCompraNome = item.categoria_compra_nome || 'Outros Materiais';
    const objetivoCompra = item.objetivo_compra || null;
    const retornoCotacao = item.retorno_cotacao || null;
    const respInspecao = item.resp_inspecao_recebimento || solicitante;
    const observacaoRecebimento = item.observacao_recebimento || item.observacao || null;

    // Normaliza links (array de strings)
    const normalizarLinks = (raw) => {
      if (!raw) return null;
      const arr = Array.isArray(raw) ? raw : [raw];
      const limpos = arr.map(l => String(l || '').trim()).filter(l => l.length > 0);
      return limpos.length ? limpos : null;
    };
    const linksArray = normalizarLinks(item.link || item.links);

    // Comentário: define status inicial considerando retorno_cotacao e função do usuário logado.
    const userId = req.session?.user?.id || null;
    const username = req.session?.user?.username || null;
    let isDiretor = false;
    if (userId || username) {
      const { rows: funcaoRows } = await pool.query(`
        SELECT f.name AS funcao
        FROM public.auth_user u
        LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
        LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
        WHERE ($1::bigint IS NOT NULL AND u.id = $1)
           OR ($2::text IS NOT NULL AND u.username = $2)
        LIMIT 1
      `, [userId, username]);
      const funcaoNome = String(funcaoRows[0]?.funcao || '').trim().toLowerCase();
      isDiretor = funcaoNome === 'diretor(a)';
    }

    const retornoTexto = String(retornoCotacao || '').trim().toLowerCase();
    const retornoCompraJaRealizada = 'compra ja realizada';
    const retornoSemValores = 'apenas realizar compra sem retorno de valores ou caracteristica';
    const compraJaRealizadaSelecionada = retornoTexto === retornoCompraJaRealizada;
    let statusInicial = 'pendente';

    if (compraJaRealizadaSelecionada) {
      statusInicial = 'compra realizada';
    } else if (retornoTexto) {
      if (isDiretor) {
        statusInicial = (retornoTexto === retornoSemValores)
          ? 'Analise de cadastro'
          : 'aguardando cotação';
      } else {
        statusInicial = 'aguardando aprovação da requisição';
      }
    }
    
    // Normaliza anexos - aceita URLs (strings) do Supabase ou array de objetos legados
    const normalizarAnexos = (raw) => {
      if (!raw) return null;
      const arr = Array.isArray(raw) ? raw : [raw];
      
      // Se for array de strings (URLs do Supabase), converte para objeto {nome, url, tipo}
      if (arr.length > 0 && typeof arr[0] === 'string') {
        return arr
          .filter(url => url && typeof url === 'string' && url.trim().length > 0)
          .map(url => {
            // Extrai o nome do arquivo a partir da URL (remove timestamp prefix ex: 1234567890_arquivo.pdf)
            const segmentos = url.split('/');
            const nomeArqBruto = decodeURIComponent((segmentos[segmentos.length - 1] || '').split('?')[0]);
            const nomeLimpo = nomeArqBruto.replace(/^\d+_/, '') || 'arquivo';
            // Infere o tipo pela extensão
            const ext = nomeLimpo.split('.').pop().toLowerCase();
            const tipoMap = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel' };
            const tipo = tipoMap[ext] || null;
            return { nome: nomeLimpo, url, tipo };
          });
      }
      
      // Se for array de objetos legados (com base64), processa
      const limpos = arr.map(a => ({
        nome: a?.nome || null,
        tipo: a?.tipo || null,
        tamanho: a?.tamanho || null,
        base64: null
      })).filter(a => a.nome);
      
      return limpos.length ? limpos : null;
    };
    
    const anexosArray = normalizarAnexos(item.anexo || item.anexos);
    
    // Grupo de requisição: gera novo se for 'unica' ou não informado
    const grupoRequisicaoRaw = item.grupo_requisicao || item.np || null;
    const grupoRequisicao = (!grupoRequisicaoRaw || String(grupoRequisicaoRaw).toLowerCase() === 'unica')
      ? gerarNumeroGrupoRequisicao()
      : grupoRequisicaoRaw;
    
    const obterBaseCodprovDisponivel = async () => {
      const { rows: maxOmie } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM public.produtos_omie
         WHERE codigo LIKE 'CODPROV - %'`
      );
      const { rows: maxSolic } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(produto_codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM compras.solicitacao_compras
         WHERE produto_codigo LIKE 'CODPROV - %'`
      );
      const { rows: maxSem } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(produto_codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM compras.compras_sem_cadastro
         WHERE produto_codigo LIKE 'CODPROV - %'`
      );

      const nums = [maxOmie[0]?.max_num, maxSolic[0]?.max_num, maxSem[0]?.max_num].map((n) => Number(n) || 0);
      let baseNumero = Math.max(...nums, 0) + 1;

      const montarCodigoBase = (num) => `CODPROV - ${String(num).padStart(5, '0')}`;
      const baseExiste = async (num) => {
        const prefixo = `${montarCodigoBase(num)}%`;
        const { rows: existe } = await pool.query(
          `SELECT 1 FROM public.produtos_omie WHERE codigo LIKE $1 LIMIT 1`,
          [prefixo]
        );
        return existe.length > 0;
      };

      while (await baseExiste(baseNumero)) {
        baseNumero += 1;
      }

      return montarCodigoBase(baseNumero);
    };

    const baseCodigo = (!produtoCodigoPayload || /^codprov\s*-?/i.test(produtoCodigoPayload))
      ? await obterBaseCodprovDisponivel()
      : produtoCodigoPayload;
    log('Código base selecionado:', baseCodigo);

    const itensComCodigo = itensSemCadastro.map((it, idx) => ({
      ...it,
      produto_codigo: itensSemCadastro.length > 1 ? `${baseCodigo}.${idx + 1}` : `${baseCodigo}.1`
    }));
    log('Itens com código provisório:', itensComCodigo.map((it, idx) => ({ index: idx, codigo: it.produto_codigo, descricao: it.descricao, quantidade: it.quantidade })));

    const inserirItensNoBanco = async ({ statusParaInsercao, numeroPedido = null, ncodped = null, codReqCompra = null }) => {
      const ids = [];
      const linhas = [];

      for (const itemAtual of itensComCodigo) {
        const result = await pool.query(`
          INSERT INTO compras.compras_sem_cadastro (
            produto_codigo,
            produto_descricao,
            quantidade,
            departamento,
            centro_custo,
            categoria_compra_codigo,
            categoria_compra_nome,
            objetivo_compra,
            retorno_cotacao,
            resp_inspecao_recebimento,
            observacao_recebimento,
            link,
            anexos,
            solicitante,
            status,
            grupo_requisicao,
            numero_pedido,
            ncodped,
            cod_req_compra,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW()
          )
          RETURNING id, grupo_requisicao
        `, [
          itemAtual.produto_codigo,
          itemAtual.descricao,
          itemAtual.quantidade,
          departamento,
          centroCusto,
          categoriaCompraCodigo,
          categoriaCompraNome,
          objetivoCompra,
          retornoCotacao,
          respInspecao,
          observacaoRecebimento,
          linksArray ? JSON.stringify(linksArray) : null,
          anexosArray ? JSON.stringify(anexosArray) : null,
          solicitante,
          statusParaInsercao,
          grupoRequisicao,
          numeroPedido,
          ncodped,
          codReqCompra
        ]);

        const novoIdLinha = result.rows[0]?.id;
        if (novoIdLinha) ids.push(novoIdLinha);
        linhas.push({
          id: novoIdLinha,
          grupo_requisicao: result.rows[0]?.grupo_requisicao || grupoRequisicao,
          produto_codigo: itemAtual.produto_codigo,
          produto_descricao: itemAtual.descricao,
          quantidade: itemAtual.quantidade
        });
      }

      return {
        ids,
        linhas,
        grupoFinal: linhas[0]?.grupo_requisicao || grupoRequisicao
      };
    };

    let idsInseridos = [];
    let linhasInseridas = [];
    let grupoFinal = grupoRequisicao;
    let omieNumeroPedido = null;
    let omieCodPed = null;
    let omieCodIntPed = null;

    const obterEmailAprovador = async () => {
      const emailFallback = 'carlos.henrique@fromtherm.com.br';

      if (req.session?.user?.id) {
        const { rows } = await pool.query(
          'SELECT email FROM public.auth_user WHERE id = $1 LIMIT 1',
          [req.session.user.id]
        );
        const email = String(rows[0]?.email || '').trim();
        if (email) return email;
      }

      if (req.session?.user?.username) {
        const { rows } = await pool.query(
          'SELECT email FROM public.auth_user WHERE username = $1 LIMIT 1',
          [req.session.user.username]
        );
        const email = String(rows[0]?.email || '').trim();
        if (email) return email;
      }

      return emailFallback;
    };

    const resolverFornecedorPadrao = async () => {
      const toInt = (valor) => Number.parseInt(String(valor ?? '').trim(), 10);
      const fornecedorPadraoFixo = 10746832756;

      if (Number.isFinite(fornecedorPadraoFixo) && fornecedorPadraoFixo > 0) {
        return { codigo: fornecedorPadraoFixo, origem: 'padrao_fixo_10746832756' };
      }

      const fornecedorDoPayload = toInt(item?.fornecedor_id);
      if (Number.isFinite(fornecedorDoPayload) && fornecedorDoPayload > 0) {
        return { codigo: fornecedorDoPayload, origem: 'payload.fornecedor_id' };
      }

      const fornecedorDoEnv = toInt(process.env.OMIE_FORNECEDOR_PADRAO_ID);
      if (Number.isFinite(fornecedorDoEnv) && fornecedorDoEnv > 0) {
        return { codigo: fornecedorDoEnv, origem: 'env.OMIE_FORNECEDOR_PADRAO_ID' };
      }

      const { rows: ultimoFornecedorRows } = await pool.query(
        `SELECT fornecedor_id
         FROM compras.ped_compra
         WHERE fornecedor_id IS NOT NULL
           AND trim(fornecedor_id) <> ''
         ORDER BY updated_at DESC NULLS LAST, id DESC
         LIMIT 1`
      );
      const fornecedorUltimoPedido = toInt(ultimoFornecedorRows[0]?.fornecedor_id);
      if (Number.isFinite(fornecedorUltimoPedido) && fornecedorUltimoPedido > 0) {
        return { codigo: fornecedorUltimoPedido, origem: 'compras.ped_compra.ultimo_fornecedor' };
      }

      const { rows: fornecedorAtivoRows } = await pool.query(
        `SELECT codigo_cliente_omie
         FROM omie.fornecedores
         WHERE COALESCE(inativo, false) = false
           AND codigo_cliente_omie IS NOT NULL
         ORDER BY updated_at DESC NULLS LAST, codigo_cliente_omie DESC
         LIMIT 1`
      );
      const fornecedorAtivo = toInt(fornecedorAtivoRows[0]?.codigo_cliente_omie);
      if (Number.isFinite(fornecedorAtivo) && fornecedorAtivo > 0) {
        return { codigo: fornecedorAtivo, origem: 'omie.fornecedores.ativo_recente' };
      }

      return { codigo: NaN, origem: 'nao_encontrado' };
    };

    if (compraJaRealizadaSelecionada) {
      try {
        log('Fluxo compra direta ativado');
        const emailAprovador = await obterEmailAprovador();
        const fornecedorResolvido = await resolverFornecedorPadrao();
        const fornecedorPadrao = fornecedorResolvido.codigo;
        const codParcelaPadrao = String(process.env.OMIE_COD_PARCELA_PADRAO || 'A15').trim() || 'A15';
        log('Parâmetros compra direta:', {
          emailAprovador,
          fornecedorPadrao,
          fornecedorOrigem: fornecedorResolvido.origem,
          codParcelaPadrao,
          categoriaCompraCodigo
        });

        if (!Number.isFinite(fornecedorPadrao) || fornecedorPadrao <= 0) {
          throw new Error('Nenhum fornecedor válido encontrado para a opção "Compra ja realizada" (payload/env/histórico/base fornecedores).');
        }

        const gerarCodIntPedCurto = () => {
          const tsBase36 = Date.now().toString(36).toUpperCase();
          const randBase36 = Math.floor(Math.random() * 1679616).toString(36).toUpperCase().padStart(4, '0');
          const grupoNumerico = String(grupoRequisicao || '').replace(/\D/g, '').slice(-6);
          const cod = `SC${grupoNumerico}${tsBase36}${randBase36}`.slice(0, 20);
          return cod;
        };

        const codReqCompra = gerarCodIntPedCurto();
        log('cCodIntPed gerado para Omie:', { codReqCompra, tamanho: String(codReqCompra).length });
        const hoje = new Date();
        const dDtPrevisao = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;

        const cabecalho = {
          cCodIntPed: codReqCompra,
          dDtPrevisao,
          cCodCateg: categoriaCompraCodigo || '2.14.94',
          cCodParc: codParcelaPadrao,
          cEmailAprovador: emailAprovador,
          cObs: (objetivoCompra || observacaoRecebimento || `Solicitação sem cadastro ${reqId}`).toString().slice(0, 500)
        };

        cabecalho.nCodFor = fornecedorPadrao;

        const produtosIncluir = [];
        for (const itemLinha of itensComCodigo) {
          log('Processando item para Omie:', {
            codigo: itemLinha.produto_codigo,
            descricao: itemLinha.descricao,
            quantidade: itemLinha.quantidade
          });
          let codigoOmie = null;

          const { rows: prodRows } = await pool.query(
            `SELECT codigo_produto
             FROM public.produtos_omie
             WHERE codigo = $1 OR codigo_produto_integracao = $1
             LIMIT 1`,
            [itemLinha.produto_codigo]
          );

          if (prodRows.length > 0 && prodRows[0].codigo_produto) {
            codigoOmie = prodRows[0].codigo_produto;
            log('Produto encontrado localmente:', { codigo: itemLinha.produto_codigo, codigo_omie: codigoOmie });
          } else {
            log('Produto não encontrado localmente, cadastrando na Omie');
            let cadastro = await cadastrarProdutoNaOmie(itemLinha.produto_codigo, itemLinha.descricao, reqId);
            if (!cadastro.ok) {
              const msgErro = String(cadastro.error || '');
              const ehJaCadastrado = /já cadastrado|Client-102/i.test(msgErro);
              const ehDescricaoDuplicada = /descri.*já está sendo utilizada|Client-143/i.test(msgErro);

              if (ehJaCadastrado) {
                log('Produto já cadastrado na Omie, tentando reaproveitar cadastro existente');

                const matchId = msgErro.match(/ID:\s*(\d+)/i);
                if (matchId?.[1]) {
                  cadastro = { ok: true, codigo_produto: Number(matchId[1]) };
                } else {
                  try {
                    const consultaResp = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        call: 'ConsultarProduto',
                        app_key: OMIE_APP_KEY,
                        app_secret: OMIE_APP_SECRET,
                        param: [{ codigo_produto_integracao: itemLinha.produto_codigo }]
                      })
                    });
                    const consultaData = await consultaResp.json().catch(() => ({}));
                    if (consultaResp.ok && !consultaData?.faultstring && consultaData?.codigo_produto) {
                      cadastro = { ok: true, codigo_produto: Number(consultaData.codigo_produto) };
                    }
                  } catch (consultaErr) {
                    log('Falha ao consultar produto já cadastrado na Omie:', consultaErr?.message || consultaErr);
                  }
                }
              }

              if (ehDescricaoDuplicada) {
                const descricaoComCodigo = itemLinha.descricao.includes(itemLinha.produto_codigo)
                  ? itemLinha.descricao
                  : `${itemLinha.descricao} - ${itemLinha.produto_codigo}`;
                log('Descrição duplicada na Omie, tentando novamente com sufixo de código');
                cadastro = await cadastrarProdutoNaOmie(itemLinha.produto_codigo, descricaoComCodigo, reqId);
              }
            }

            if (!cadastro.ok) {
              throw new Error(cadastro.error || `Falha ao cadastrar produto ${itemLinha.produto_codigo} na Omie`);
            }

            codigoOmie = cadastro.codigo_produto;
            log('Produto cadastrado na Omie:', { codigo: itemLinha.produto_codigo, codigo_omie: codigoOmie });
          }

          const codigoOmieNumero = Number(codigoOmie);
          const produtoPayload = {
            cDescricao: itemLinha.descricao,
            cUnidade: 'UN',
            nQtde: Number(itemLinha.quantidade) > 0 ? Number(itemLinha.quantidade) : 1,
            nValUnit: 0.01,
            cObs: observacaoRecebimento || null,
            cCodCateg: categoriaCompraCodigo || '2.14.94'
          };

          if (Number.isFinite(codigoOmieNumero) && codigoOmieNumero > 0) {
            produtoPayload.nCodProd = codigoOmieNumero;
          } else {
            produtoPayload.cProduto = itemLinha.produto_codigo;
          }

          produtosIncluir.push(produtoPayload);
        }

        const pedidoCompra = {
          cabecalho_incluir: cabecalho,
          produtos_incluir: produtosIncluir
        };

        const omiePayload = {
          call: 'IncluirPedCompra',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [pedidoCompra]
        };

        log('Enviando IncluirPedCompra para Omie:', {
          codIntPed: cabecalho.cCodIntPed,
          quantidade_itens: produtosIncluir.length,
          codFornecedor: cabecalho.nCodFor
        });

        const omieResp = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(omiePayload)
        });

        const omieData = await omieResp.json().catch(() => ({}));
        log('Resposta IncluirPedCompra:', {
          status_http: omieResp.status,
          faultcode: omieData?.faultcode || null,
          faultstring: omieData?.faultstring || null,
          nCodPed: omieData?.nCodPed || null,
          cNumero: omieData?.cNumero || null,
          cCodIntPed: omieData?.cCodIntPed || null
        });
        if (!omieResp.ok || omieData?.faultstring) {
          throw new Error(omieData?.faultstring || `Erro HTTP ${omieResp.status} ao criar pedido na Omie`);
        }

        omieNumeroPedido = omieData?.cNumero || null;
        omieCodPed = omieData?.nCodPed ? String(omieData.nCodPed) : null;
        omieCodIntPed = omieData?.cCodIntPed || codReqCompra;

        const insertDireto = await inserirItensNoBanco({
          statusParaInsercao: 'compra realizada',
          numeroPedido: omieNumeroPedido,
          ncodped: omieCodPed,
          codReqCompra: omieCodIntPed
        });
        idsInseridos = insertDireto.ids;
        linhasInseridas = insertDireto.linhas;
        grupoFinal = insertDireto.grupoFinal;
        log('Compra direta concluída e persistida no banco:', {
          ids: idsInseridos,
          grupoFinal,
          omieNumeroPedido,
          omieCodPed,
          omieCodIntPed
        });
      } catch (omieErr) {
        logErr('Falha no fluxo compra direta. Nenhuma linha gravada em compras_sem_cadastro.', {
          erro: omieErr.message,
          stack: omieErr.stack
        });
        return res.status(502).json({
          ok: false,
          error: `Falha ao concluir compra direta na Omie. Nada foi gravado em compras_sem_cadastro: ${omieErr.message}`
        });
      }
    } else {
      const insertPadrao = await inserirItensNoBanco({
        statusParaInsercao: statusInicial
      });
      idsInseridos = insertPadrao.ids;
      linhasInseridas = insertPadrao.linhas;
      grupoFinal = insertPadrao.grupoFinal;
      log('Fluxo padrão concluído:', { ids: idsInseridos, grupoFinal, statusInicial });
    }

    const novoId = idsInseridos[0] || null;

    await upsertStatusHistoricoCompras({
      grupoRequisicao: grupoFinal,
      status: compraJaRealizadaSelecionada ? 'compra realizada' : statusInicial,
      tableSource: 'compras_sem_cadastro'
    });
    
    log(`🏁 Finalizado em ${Date.now() - t0}ms`, { idsInseridos, grupoFinal, solicitante });
    
    res.json({ 
      ok: true, 
      id: novoId,
      ids: idsInseridos,
      grupo_requisicao: grupoFinal,
      numero_pedido: omieNumeroPedido,
      ncodped: omieCodPed,
      cod_req_compra: omieCodIntPed,
      message: `Solicitação de compra registrada com sucesso (${idsInseridos.length} item(ns))`
    });
    
  } catch (err) {
    console.error('[Compras Sem Cadastro] Erro ao registrar:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao registrar solicitação' });
  }
});

// GET /api/compras/sem-cadastro - Lista itens sem cadastro
app.get('/api/compras/sem-cadastro', async (req, res) => {
  console.log('[DEBUG] GET /api/compras/sem-cadastro chamado com query:', req.query);
  try {
    const solicitante = req.query.solicitante;
    
    if (!solicitante) {
      return res.status(400).json({ ok: false, error: 'Parâmetro solicitante é obrigatório' });
    }
    
    const { rows } = await pool.query(`
      SELECT 
        id,
        produto_codigo,
        produto_descricao,
        quantidade,
        departamento,
        centro_custo,
        categoria_compra_codigo,
        categoria_compra_nome,
        objetivo_compra,
        retorno_cotacao,
        resp_inspecao_recebimento,
        observacao_recebimento,
        status,
        solicitante,
        anexos,
        link,
        created_at,
        updated_at
      FROM compras.compras_sem_cadastro
      WHERE solicitante = $1
      ORDER BY created_at DESC
      LIMIT 500
    `, [solicitante]);
    
    res.json({ ok: true, itens: rows });
  } catch (err) {
    console.error('[Compras Sem Cadastro] Erro ao listar:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar itens sem cadastro' });
  }
});

// PUT /api/compras/sem-cadastro/:id - Atualiza status de item sem cadastro
app.put('/api/compras/sem-cadastro/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    
    const { status, produto_descricao, observacao_reprovacao, usuario_comentario } = req.body || {};
    if (!status && typeof produto_descricao === 'undefined' && !observacao_reprovacao) {
      return res.status(400).json({ ok: false, error: 'Informe status, produto_descricao ou observacao_reprovacao' });
    }
    
    const sets = [];
    const values = [];
    let idx = 1;
    if (status) {
      sets.push(`status = $${idx++}`);
      values.push(status);
    }
    if (typeof produto_descricao !== 'undefined') {
      sets.push(`produto_descricao = $${idx++}`);
      values.push(produto_descricao);
    }
    if (observacao_reprovacao) {
      sets.push(`observacao_reprovacao = $${idx++}`);
      values.push(observacao_reprovacao);
    }
    if (usuario_comentario) {
      sets.push(`usuario_comentario = $${idx++}`);
      values.push(usuario_comentario);
    }
    sets.push('updated_at = NOW()');
    values.push(id);
    
    const result = await pool.query(`
      UPDATE compras.compras_sem_cadastro
      SET ${sets.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }
    
    if (status) {
      console.log(`[Compras Sem Cadastro] Status atualizado: ID ${id} -> ${status}`);
    }
    if (typeof produto_descricao !== 'undefined') {
      console.log(`[Compras Sem Cadastro] produto_descricao atualizado: ID ${id}`);
    }
    if (observacao_reprovacao) {
      console.log(`[Compras Sem Cadastro] observacao_reprovacao registrada: ID ${id}`);
    }
    
    res.json({ 
      ok: true, 
      item: result.rows[0],
      message: 'Item atualizado com sucesso'
    });
    
  } catch (err) {
    console.error('[Compras Sem Cadastro] Erro ao atualizar:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao atualizar item' });
  }
});

// POST /api/compras/sem-cadastro/:id/cadastrar-omie - Cadastra itens na Omie sem avançar status
app.post('/api/compras/sem-cadastro/:id/cadastrar-omie', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const { itens: itensRequest } = req.body || {};

    const { rows } = await pool.query(
      `SELECT id, produto_codigo, produto_descricao, quantidade
       FROM compras.compras_sem_cadastro
       WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }

    const itemDb = rows[0];
    const descricaoBase = String(itemDb.produto_descricao || '').trim();
    const quantidadeBase = Number(itemDb.quantidade) || 1;

    const processarItensDescricao = (descricao) => {
      if (!descricao || typeof descricao !== 'string') return [];
      return [{ descricao: String(descricao).trim(), quantidade: String(quantidadeBase) }].filter(i => i.descricao);
    };

    const itens = Array.isArray(itensRequest) && itensRequest.length
      ? itensRequest.map(i => ({
          descricao: String(i?.descricao || '').trim(),
          quantidade: String(i?.quantidade || '').trim()
        })).filter(i => i.descricao)
      : processarItensDescricao(descricaoBase);

    if (!itens.length) {
      return res.status(400).json({ ok: false, error: 'Nenhum item válido para cadastro' });
    }

    const codigoBaseRaw = String(itemDb.produto_codigo || '').trim();
    const matchBase = codigoBaseRaw.match(/(CODPROV\s*-\s*)(\d{1,})/i);
    const baseNumeroAtual = matchBase ? parseInt(matchBase[2], 10) : null;
    const basePadLength = matchBase ? matchBase[2].length : 5;

    const buscarMaximoCodprov = async () => {
      const { rows: maxOmie } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM public.produtos_omie
         WHERE codigo LIKE 'CODPROV - %'`
      );
      const { rows: maxSolic } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(produto_codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM compras.solicitacao_compras
         WHERE produto_codigo LIKE 'CODPROV - %'`
      );
      const { rows: maxSem } = await pool.query(
        `SELECT MAX(CAST(regexp_replace(produto_codigo, '^\\D*(\\d+).*$','\\1') AS INTEGER)) AS max_num
         FROM compras.compras_sem_cadastro
         WHERE produto_codigo LIKE 'CODPROV - %'`
      );

      const nums = [maxOmie[0]?.max_num, maxSolic[0]?.max_num, maxSem[0]?.max_num]
        .map(n => Number(n) || 0);
      return Math.max(...nums, 0);
    };

    const maxExistente = await buscarMaximoCodprov();
    let baseNumero = Number.isFinite(baseNumeroAtual) ? baseNumeroAtual : (maxExistente + 1);
    if (baseNumero <= maxExistente) baseNumero = maxExistente + 1;

    const formatarBase = (num) => String(num).padStart(basePadLength, '0');
    const montarCodigoBase = (num) => `CODPROV - ${formatarBase(num)}`;

    // Comentário: se o código base atual já existir, avança para o próximo disponível
    const baseExiste = async (num) => {
      const prefixo = `${montarCodigoBase(num)}%`;
      const { rows: existe } = await pool.query(
        `SELECT 1 FROM public.produtos_omie WHERE codigo LIKE $1 LIMIT 1`,
        [prefixo]
      );
      return existe.length > 0;
    };

    while (await baseExiste(baseNumero)) {
      baseNumero += 1;
    }

    const baseCodigo = montarCodigoBase(baseNumero);

    if (baseCodigo !== codigoBaseRaw) {
      await pool.query(
        `UPDATE compras.compras_sem_cadastro
         SET produto_codigo = $1, updated_at = NOW()
         WHERE id = $2`,
        [baseCodigo, id]
      );
    }

    const resultados = [];
    for (let i = 0; i < itens.length; i++) {
      const itemAtual = itens[i];
      const codigoIntegracao = `${baseCodigo}.${i + 1}`;
      const descricaoProduto = itemAtual.descricao || `Produto ${codigoIntegracao}`;

      // Comentário: se já houver codigo_omie informado no payload, ignora criação
      if (itemAtual?.codigo_omie) {
        resultados.push({
          index: i,
          codigo_integracao: codigoIntegracao,
          codigo_produto: itemAtual.codigo_omie,
          ja_existe: true
        });
        continue;
      }

      // Comentário: verifica se o item já existe na tabela produtos_omie
      const { rows: prodRows } = await pool.query(
        `SELECT codigo_produto
         FROM public.produtos_omie
         WHERE codigo = $1 OR codigo_produto_integracao = $1
         LIMIT 1`,
        [codigoIntegracao]
      );

      if (prodRows.length > 0) {
        resultados.push({
          index: i,
          codigo_integracao: codigoIntegracao,
          codigo_produto: prodRows[0].codigo_produto || null,
          ja_existe: true
        });
        continue;
      }

      let cadastro = await cadastrarProdutoNaOmie(codigoIntegracao, descricaoProduto);
      if (!cadastro.ok) {
        const msgErro = String(cadastro.error || '');
        const ehDescricaoDuplicada = /descri.*já está sendo utilizada|Client-143/i.test(msgErro);

        if (ehDescricaoDuplicada) {
          const descricaoComCodigo = descricaoProduto.includes(codigoIntegracao)
            ? descricaoProduto
            : `${descricaoProduto} - ${codigoIntegracao}`;
          cadastro = await cadastrarProdutoNaOmie(codigoIntegracao, descricaoComCodigo);
        }

        if (!cadastro.ok) {
          return res.status(500).json({
            ok: false,
            error: cadastro.error || 'Erro ao cadastrar produto na Omie',
            resultados
          });
        }
      }

      resultados.push({
        index: i,
        codigo_integracao: codigoIntegracao,
        codigo_produto: cadastro.codigo_produto || null,
        ja_existe: false
      });
    }

    return res.json({
      ok: true,
      base_codigo: baseCodigo,
      itens: resultados
    });
  } catch (err) {
    console.error('[Compras Sem Cadastro] Erro ao cadastrar itens na Omie:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao cadastrar itens na Omie' });
  }
});

// POST /api/compras/sem-cadastro/:id/criar-requisicao-omie - Cria requisição de compra na Omie
app.post('/api/compras/sem-cadastro/:id/criar-requisicao-omie', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
    const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

    if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
      return res.status(500).json({ ok: false, error: 'Credenciais Omie não configuradas' });
    }

    const { itens: itensRequest } = req.body || {};
    const itensPayload = Array.isArray(itensRequest) ? itensRequest : [];

    const { rows } = await pool.query(
      `SELECT id, categoria_compra_codigo, objetivo_compra, solicitante, resp_inspecao_recebimento, observacao_recebimento
       FROM compras.compras_sem_cadastro
       WHERE id = $1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }

    const itemDb = rows[0];
    if (!itemDb.categoria_compra_codigo || !String(itemDb.categoria_compra_codigo).trim()) {
      return res.status(400).json({ ok: false, error: 'Item sem categoria da compra. Por favor, edite o item e adicione a categoria antes de criar a requisição.' });
    }

    if (!itensPayload.length) {
      return res.status(400).json({ ok: false, error: 'Nenhum item informado para criar requisição' });
    }

    const itensReqCompra = [];
    for (const i of itensPayload) {
      const codigoOmie = String(i?.codigo_omie || '').trim();
      if (!codigoOmie) {
        return res.status(400).json({ ok: false, error: 'Todos os itens precisam ter código Omie antes de criar a requisição.' });
      }

      let precoUnitario = 0;
      try {
        const { rows: rowsEstoque } = await pool.query(`
          SELECT cmc
          FROM public.omie_estoque_posicao
          WHERE omie_prod_id = $1
          LIMIT 1
        `, [codigoOmie]);
        if (rowsEstoque.length > 0 && rowsEstoque[0].cmc) {
          precoUnitario = parseFloat(rowsEstoque[0].cmc) || 0;
        }
      } catch (errCmc) {
        console.error('[Sem Cadastro] Erro ao buscar CMC:', errCmc);
      }

      itensReqCompra.push({
        codProd: codigoOmie,
        obsItem: String(i?.descricao || '').trim(),
        precoUnit: precoUnitario,
        qtde: parseFloat(i?.quantidade) || 1
      });
    }

    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    const hora = String(agora.getHours()).padStart(2, '0');
    const minuto = String(agora.getMinutes()).padStart(2, '0');
    const segundo = String(agora.getSeconds()).padStart(2, '0');
    const milisegundo = String(agora.getMilliseconds()).padStart(3, '0');
    const numeroPedido = `${ano}${mes}${dia}-${hora}${minuto}${segundo}-${milisegundo}`;

    const dtSugestao = (() => {
      const dt = new Date();
      dt.setDate(dt.getDate() + 5);
      return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    })();

    const solicitante = itemDb.solicitante || '';
    const respInspecao = itemDb.resp_inspecao_recebimento || '';
    const objetivoCompra = itemDb.objetivo_compra || '';
    const codigoOmiePrincipal = itensReqCompra[0]?.codProd || '';
    const obsReqCompra = `Requisitante: ${solicitante}\nResp. por receber o produto: ${respInspecao}\nNPST: ${numeroPedido}\nNPOM: ${codigoOmiePrincipal}\nObjetivo da Compra: ${objetivoCompra}`.trim();

    const requisicaoOmie = {
      codIntReqCompra: numeroPedido,
      codCateg: itemDb.categoria_compra_codigo || '',
      codProj: 0,
      dtSugestao: dtSugestao,
      obsReqCompra: obsReqCompra,
      obsIntReqCompra: String(itemDb.observacao_recebimento || '').trim(),
      ItensReqCompra: itensReqCompra
    };

    const omieResponse = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'IncluirReq',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [requisicaoOmie]
      })
    });

    const omieResult = await omieResponse.json();
    if (!omieResponse.ok || omieResult.faultstring) {
      console.error('[Sem Cadastro] Erro Omie:', omieResult);
      return res.status(500).json({ ok: false, error: omieResult.faultstring || 'Erro ao criar requisição na Omie' });
    }

    const codReqCompraOmie = omieResult.codReqCompra || null;
    
    await pool.query(
      `UPDATE compras.compras_sem_cadastro
       SET status = 'Requisição',
           numero_pedido = $1,
           ncodped = $2,
           cod_req_compra = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [omieResult.codIntReqCompra || numeroPedido, omieResult.codReqCompra || null, codReqCompraOmie, id]
    );

    return res.json({
      ok: true,
      codReqCompra: codReqCompraOmie,
      codIntReqCompra: omieResult.codIntReqCompra || numeroPedido
    });
  } catch (err) {
    console.error('[Sem Cadastro] Erro ao criar requisição na Omie:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao criar requisição na Omie' });
  }
});


// Comentário: garante codigo_omie para itens de requisição direta (fluxo igual ao Enviar requisição)
async function garantirCodigoOmieParaItem(client, item, itemId) {
  if (item?.codigo_omie) return item.codigo_omie;

  const produtoCodigo = String(item?.produto_codigo || '').trim();
  const produtoDescricao = String(item?.produto_descricao || '').trim() || `Produto ${produtoCodigo}`;

  if (!produtoCodigo) return null;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const incrementarCodigoProvisorio = (codigo) => {
    const match = String(codigo || '').match(/(CODPROV\s*-\s*)(\d{1,})/i);
    if (!match) return null;
    const prefixo = match[1];
    const numero = parseInt(match[2], 10);
    if (!Number.isFinite(numero)) return null;
    const proximo = String(numero + 1).padStart(match[2].length, '0');
    return `${prefixo}${proximo}`;
  };

  // Comentário: se não tiver codigo_omie, cadastra produto na Omie antes de seguir
  let codigoAtual = produtoCodigo;
  let cadastroOk = null;

  for (let tent = 0; tent < 20; tent++) {
    const descricaoAtual = tent > 0 ? `${produtoDescricao} ${codigoAtual}` : produtoDescricao;
    const cadastro = await cadastrarProdutoNaOmie(codigoAtual, descricaoAtual);
    if (cadastro.ok) {
      cadastroOk = cadastro;
      if (descricaoAtual !== produtoDescricao && itemId) {
        await client.query(
          `UPDATE compras.solicitacao_compras
           SET produto_descricao = $1
           WHERE id = $2`,
          [descricaoAtual, itemId]
        );
        item.produto_descricao = descricaoAtual;
      }
      break;
    }

    const msgErro = String(cadastro.error || '');
    const ehJaCadastrado = /já cadastrado|Client-102/i.test(msgErro);
    const ehDescricaoDuplicada = /descri.*já está sendo utilizada|Client-143/i.test(msgErro);
    const proximoCodigo = incrementarCodigoProvisorio(codigoAtual);

    if ((!ehJaCadastrado && !ehDescricaoDuplicada) || !proximoCodigo) {
      throw new Error(cadastro.error || 'Erro ao cadastrar produto na Omie');
    }

    codigoAtual = proximoCodigo;
  }

  if (!cadastroOk) {
    throw new Error('Não foi possível gerar um código provisório disponível');
  }

  // Atualiza produto_codigo na solicitação se o código mudou
  if (codigoAtual !== produtoCodigo && itemId) {
    await client.query(
      `UPDATE compras.solicitacao_compras
       SET produto_codigo = $1
       WHERE id = $2`,
      [codigoAtual, itemId]
    );
    item.produto_codigo = codigoAtual;
  }

  // Aguarda o webhook popular o produto na tabela produtos_omie
  let codigoOmieEncontrado = null;
  for (let i = 0; i < 10; i++) {
    const { rows: prodRows } = await client.query(
      `SELECT codigo_produto
       FROM public.produtos_omie
       WHERE codigo = $1 OR codigo_produto_integracao = $1
       LIMIT 1`,
      [codigoAtual]
    );
    if (prodRows.length > 0) {
      codigoOmieEncontrado = prodRows[0].codigo_produto;
      break;
    }
    await sleep(2000);
  }

  if (codigoOmieEncontrado && itemId) {
    item.codigo_omie = codigoOmieEncontrado;
    await client.query(
      `UPDATE compras.solicitacao_compras
       SET codigo_omie = $1
       WHERE id = $2`,
      [codigoOmieEncontrado, itemId]
    );
  }

  // Comentário: consulta produto na Omie se ainda não houver codigo_omie
  const consultarProdutoOmie = async (param) => {
    return withRetry(() => omieCall('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: 'ConsultarProduto',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [param]
    }));
  };

  if (!item.codigo_omie) {
    let omieProduto = null;
    let encontrado = false;

    try {
      omieProduto = await consultarProdutoOmie({ codigo: produtoCodigo });
      encontrado = !(omieProduto?.faultstring || omieProduto?.faultcode);
    } catch (e) {
      console.warn('[Compras] ConsultarProduto (codigo) falhou:', e?.message || e);
    }

    if (!encontrado) {
      try {
        omieProduto = await consultarProdutoOmie({ codigo_produto_integracao: produtoCodigo });
        encontrado = !(omieProduto?.faultstring || omieProduto?.faultcode);
      } catch (e) {
        console.warn('[Compras] ConsultarProduto (codigo_produto_integracao) falhou:', e?.message || e);
      }
    }

    if (encontrado) {
      try {
        await sincronizarProdutoParaPostgres(omieProduto);
      } catch (syncErr) {
        console.warn('[Compras] Erro ao sincronizar produto Omie:', syncErr?.message || syncErr);
      }
    }
  }

  // Comentário: garante codigo_omie salvo na solicitação
  if (!item.codigo_omie) {
    try {
      const { rows: prodRows } = await client.query(
        `SELECT codigo_produto
         FROM public.produtos_omie
         WHERE codigo = $1 OR codigo_produto_integracao = $1
         LIMIT 1`,
        [produtoCodigo]
      );
      if (prodRows.length > 0) {
        item.codigo_omie = prodRows[0].codigo_produto;
        if (itemId) {
          await client.query(
            `UPDATE compras.solicitacao_compras
             SET codigo_omie = $1
             WHERE id = $2`,
            [item.codigo_omie, itemId]
          );
        }
      }
    } catch (e) {
      console.warn('[Compras] Não foi possível atualizar codigo_omie:', e?.message || e);
    }
  }

  return item.codigo_omie || null;
}

// FUNÇÃO AUXILIAR: Processa requisição direta na Omie para um grupo de itens com mesmo NP
async function processarRequisicaoDiretaNaOmie(client, itemsGroup, solicitante) {
  if (!itemsGroup || itemsGroup.length === 0) return;
  
  const np = itemsGroup[0].item.np || 'A';
  const compraRealizadaSelecionada = itemsGroup.some((group) => group?.item?.compra_realizada === true);
  console.log(`[Compras-Solicitacao-Omie] Processando ${itemsGroup.length} itens para NP: ${np}`);
  
  // Gera número de pedido único
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  const hora = String(agora.getHours()).padStart(2, '0');
  const minuto = String(agora.getMinutes()).padStart(2, '0');
  const segundo = String(agora.getSeconds()).padStart(2, '0');
  const milisegundo = String(agora.getMilliseconds()).padStart(3, '0');
  const numeroPedido = `${ano}${mes}${dia}-${hora}${minuto}${segundo}-${milisegundo}`;
  
  // Monta itens para Omie
  const itensOmie = [];
  
  for (const itemGroup of itemsGroup) {
    const item = itemGroup.item;
    const idDb = itemGroup.idDb;

    // Comentário: garante codigo_omie antes de montar os itens da Omie
    if (!item.codigo_omie) {
      try {
        await garantirCodigoOmieParaItem(client, item, idDb);
      } catch (errCod) {
        console.error(`[Compras-Solicitacao-Omie] Falha ao garantir codigo_omie (item ${idDb}):`, errCod.message || errCod);
      }
    }
    
    // Busca CMC do produto
    let precoUnitario = 0;
    if (item.codigo_omie) {
      try {
        const { rows } = await client.query(`
          SELECT cmc FROM public.omie_estoque_posicao 
          WHERE omie_prod_id = $1 LIMIT 1
        `, [item.codigo_omie]);
        
        if (rows.length > 0 && rows[0].cmc) {
          precoUnitario = parseFloat(rows[0].cmc) || 0;
          console.log(`[Compras-Solicitacao-Omie] CMC encontrado para ${item.codigo_omie}: R$ ${precoUnitario}`);
        }
      } catch (err) {
        console.warn(`[Compras-Solicitacao-Omie] Erro ao buscar CMC para ${item.codigo_omie}:`, err.message);
      }
    }
    
    // Determina data de sugestão
    let dtSugestao;
    if (item.prazo_solicitado) {
      const dt = new Date(item.prazo_solicitado);
      dtSugestao = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    } else {
      const dt = new Date();
      dt.setDate(dt.getDate() + 5);
      dtSugestao = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    }
    
    itensOmie.push({
      codProd: item.codigo_omie || null,
      obsItem: item.objetivo_compra || '',
      precoUnit: precoUnitario,
      qtde: parseFloat(item.quantidade) || 1,
      idDb: idDb,
      dtSugestao: dtSugestao,
      respInspecao: item.resp_inspecao_recebimento || solicitante,
      observacao: item.observacao || ''
    });
  }
  
  // Monta observação formatada com dados do primeiro item (mantida para compatibilidade de log/uso interno)
  const primeiroItem = itemsGroup[0].item;
  const objetivoCompraPrimeiroItem = String(primeiroItem.objetivo_compra || '').trim();
  const obsReqCompra = `Requisitante: ${solicitante}\nResp. por receber o produto: ${primeiroItem.resp_inspecao_recebimento || solicitante}\nNPST: ${numeroPedido}\nNPOM: ${primeiroItem.codigo_omie || ''}\nNP: ${np}\nObjetivo da Compra: ${primeiroItem.objetivo_compra || ''}\nObservação: ${primeiroItem.observacao || ''}`.trim();
  
  // Pega a categoria de compra do primeiro item (todos do mesmo NP devem ter a mesma categoria)
  // Fallback: alguns fluxos enviam "categoria_compra_codigo" em vez de "categoria_compra".
  const categoriaCompra = primeiroItem.categoria_compra || primeiroItem.categoria_compra_codigo || '';
  console.log(`[Compras-Solicitacao-Omie] Item recebido:`, primeiroItem);
  console.log(`[Compras-Solicitacao-Omie] Categoria da compra (NP ${np}): Código="${categoriaCompra}" | Campos testados="categoria_compra/categoria_compra_codigo"`);

  if (compraRealizadaSelecionada) {
    const obterEmailAprovadorCarrinho = async () => {
      const emailFallback = 'carlos.henrique@fromtherm.com.br';
      const { rows } = await client.query(
        `SELECT email
           FROM public.auth_user
          WHERE username = $1
          LIMIT 1`,
        [solicitante]
      );
      const email = String(rows[0]?.email || '').trim();
      return email || emailFallback;
    };

    const emailAprovador = await obterEmailAprovadorCarrinho();
    const codParcelaPadrao = String(process.env.OMIE_COD_PARCELA_PADRAO || 'A15').trim() || 'A15';
    const fornecedorPadrao = Number.parseInt(String(process.env.OMIE_FORNECEDOR_PADRAO_ID || '10746832756').trim(), 10);
    const codIntPed = `MC${Date.now().toString().slice(-10)}${String(np || '').replace(/\W/g, '').slice(0, 6)}`.slice(0, 20);

    const cabecalhoCompra = {
      cCodIntPed: codIntPed,
      dDtPrevisao: itensOmie[0].dtSugestao,
      cCodCateg: categoriaCompra || '2.14.94',
      cCodParc: codParcelaPadrao,
      cEmailAprovador: emailAprovador,
      cObs: (objetivoCompraPrimeiroItem || `Compra via carrinho (NP ${np}) - ${solicitante}`).slice(0, 500),
      nCodFor: Number.isFinite(fornecedorPadrao) && fornecedorPadrao > 0 ? fornecedorPadrao : 10746832756
    };

    const produtosCompra = itensOmie.map((it) => {
      const codigoOmieNumero = Number(it.codProd);
      const produtoPayload = {
        cDescricao: (it.obsItem || primeiroItem.produto_descricao || 'Produto catálogo').toString().slice(0, 120),
        cUnidade: 'UN',
        nQtde: Number(it.qtde) > 0 ? Number(it.qtde) : 1,
        nValUnit: Number(it.precoUnit) > 0 ? Number(it.precoUnit) : 0.01,
        cObs: it.observacao || null,
        cCodCateg: categoriaCompra || '2.14.94'
      };

      if (Number.isFinite(codigoOmieNumero) && codigoOmieNumero > 0) {
        produtoPayload.nCodProd = codigoOmieNumero;
      }
      return produtoPayload;
    });

    const pedidoCompraPayload = {
      call: 'IncluirPedCompra',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{
        cabecalho_incluir: cabecalhoCompra,
        produtos_incluir: produtosCompra
      }]
    };

    console.log(`[Compras-Solicitacao-Omie] Enviando para Omie IncluirPedCompra (NP: ${np}):`, JSON.stringify(pedidoCompraPayload.param[0], null, 2));

    await omieRateLimiter.aguardarDisponibilidade();

    const omieResponsePed = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pedidoCompraPayload)
    });

    const omieResultPed = await omieResponsePed.json().catch(() => ({}));

    if (!omieResponsePed.ok || omieResultPed.faultstring) {
      console.error(`[Compras-Solicitacao-Omie] Erro Omie IncluirPedCompra para NP ${np}:`, omieResultPed);
      throw new Error(omieResultPed.faultstring || `Erro ao criar pedido de compra Omie para NP ${np}`);
    }

    const nCodPed = omieResultPed.nCodPed || null;
    const cNumero = omieResultPed.cNumero || null;
    const cCodIntPed = omieResultPed.cCodIntPed || codIntPed;

    for (const itemGroup of itemsGroup) {
      await client.query(`
        UPDATE compras.solicitacao_compras
        SET
          status = 'compra realizada',
          numero_pedido = $1,
          ncodped = $2,
          updated_at = NOW()
        WHERE id = $3
      `, [cNumero || cCodIntPed, nCodPed, itemGroup.idDb]);

      console.log(`[Compras-Solicitacao-Omie] Item ${itemGroup.idDb} atualizado - compra realizada - numero_pedido: ${cNumero || cCodIntPed}, ncodped: ${nCodPed}`);
    }

    return {
      tipo: 'pedido_compra',
      np,
      numero_pedido: cNumero || cCodIntPed || null,
      ncodped: nCodPed || null
    };
  }
  
  // Monta payload para Omie - IncluirReq (seguindo o padrão do aprovar-item)
  const requisicaoOmie = {
    codIntReqCompra: numeroPedido,
    codCateg: categoriaCompra,
    dtSugestao: itensOmie[0].dtSugestao,
    obsReqCompra: (objetivoCompraPrimeiroItem || obsReqCompra).slice(0, 500),
    obsIntReqCompra: '',
    ItensReqCompra: itensOmie.map(it => ({
      codProd: it.codProd,
      obsItem: it.obsItem,
      precoUnit: it.precoUnit,
      qtde: it.qtde
    }))
  };
  
  console.log(`[Compras-Solicitacao-Omie] Enviando para Omie IncluirReq (NP: ${np}):`, JSON.stringify(requisicaoOmie, null, 2));
  
  // Aguarda disponibilidade respeitando rate limit da Omie (3 requisições por minuto)
  await omieRateLimiter.aguardarDisponibilidade();
  
  // Envia para Omie
  const omieResponse = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'IncluirReq',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [requisicaoOmie]
    })
  });
  
  const omieResult = await omieResponse.json();
  
  if (!omieResponse.ok || omieResult.faultstring) {
    console.error(`[Compras-Solicitacao-Omie] Erro Omie para NP ${np}:`, omieResult);
    throw new Error(omieResult.faultstring || `Erro ao criar requisição Omie para NP ${np}`);
  }
  
  console.log(`[Compras-Solicitacao-Omie] Resposta Omie para NP ${np}:`, omieResult);
  
  // Atualiza todos os itens deste grupo no banco com status 'Requisição'
  const codReqCompra = omieResult.codReqCompra || null;
  const codIntReqCompra = omieResult.codIntReqCompra || numeroPedido;
  
  for (const itemGroup of itemsGroup) {
    await client.query(`
      UPDATE compras.solicitacao_compras
      SET 
        status = 'Requisição',
        numero_pedido = $1,
        ncodped = $2,
        updated_at = NOW()
      WHERE id = $3
    `, [codIntReqCompra, codReqCompra, itemGroup.idDb]);
    
    console.log(`[Compras-Solicitacao-Omie] Item ${itemGroup.idDb} atualizado - numero_pedido: ${codIntReqCompra}, ncodped: ${codReqCompra}`);
  }

  return {
    tipo: 'requisicao',
    np,
    numero_pedido: codIntReqCompra || null,
    ncodped: codReqCompra || null
  };
}

// POST /api/compras/agrupar-itens - Agrupa itens selecionados com um numero_pedido
app.post('/api/compras/agrupar-itens', express.json(), async (req, res) => {
  try {
    const { ids, numero_pedido } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'Lista de IDs é obrigatória' });
    }
    
    if (!numero_pedido) {
      return res.status(400).json({ ok: false, error: 'Número do pedido é obrigatório' });
    }
    
    // Atualiza os itens com o numero_pedido
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rowCount } = await pool.query(`
      UPDATE compras.solicitacao_compras
      SET numero_pedido = $${ids.length + 1}
      WHERE id IN (${placeholders})
    `, [...ids, numero_pedido]);
    
    console.log(`[Compras] ${rowCount} itens agrupados no pedido ${numero_pedido}`);
    
    res.json({ ok: true, itens_atualizados: rowCount, numero_pedido });
    
  } catch (err) {
    console.error('[Compras] Erro ao agrupar itens:', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao agrupar itens' });
  }
});

// GET /api/compras/catalogo-omie - Lista produtos do catálogo Omie
app.get('/api/compras/catalogo-omie', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.codigo,
        p.descricao,
        p.descricao_familia,
        p.codigo_produto,
        TRIM(i.url_imagem) as url_imagem,
        COALESCE(e.saldo, 0) as saldo_estoque,
        COALESCE(e.estoque_minimo, 0) as estoque_minimo,
        CASE 
          WHEN e.estoque_minimo > 0 AND e.saldo < e.estoque_minimo THEN true 
          ELSE false 
        END as abaixo_minimo
      FROM public.produtos_omie p
      LEFT JOIN LATERAL (
        SELECT url_imagem
        FROM public.produtos_omie_imagens
        WHERE codigo_produto = p.codigo_produto
        ORDER BY pos
        LIMIT 1
      ) i ON true
      LEFT JOIN LATERAL (
        SELECT saldo, estoque_minimo
        FROM public.omie_estoque_posicao
        WHERE omie_prod_id = p.codigo_produto::bigint
        ORDER BY data_posicao DESC
        LIMIT 1
      ) e ON true
      WHERE p.inativo = 'N' 
        AND p.bloqueado = 'N'
      ORDER BY p.descricao
    `);
    
    res.json({ ok: true, produtos: rows });
  } catch (err) {
    console.error('[Compras] Erro ao buscar catálogo Omie:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar catálogo' });
  }
});

// GET /api/compras/imagem-fresca/:codigo_produto - Busca URL fresca da imagem direto da Omie
app.get('/api/compras/imagem-fresca/:codigo_produto', async (req, res) => {
  try {
    const codigoProduto = req.params.codigo_produto;
    
    // Consulta produto na Omie para pegar URLs frescas das imagens
    const omieBody = {
      call: 'ConsultarProduto',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{ codigo_produto: parseInt(codigoProduto) }]
    };
    
    const omieResp = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(omieBody)
    });
    
    if (!omieResp.ok) {
      console.error(`[Imagem Fresca] Erro HTTP ${omieResp.status} ao consultar produto ${codigoProduto}`);
      return res.status(500).json({ ok: false, error: 'Erro ao consultar Omie' });
    }
    
    const omieData = await omieResp.json();
    
    // Verifica se houve erro na resposta da Omie
    if (omieData.faultstring || omieData.faultcode) {
      console.warn(`[Imagem Fresca] Erro Omie para produto ${codigoProduto}:`, omieData.faultstring);
      return res.json({ ok: true, url_imagem: null }); // Produto não encontrado ou sem acesso
    }
    
    // Atualiza URLs no banco se houver imagens
    if (omieData.imagens && Array.isArray(omieData.imagens) && omieData.imagens.length > 0) {
      // Remove imagens antigas
      await pool.query('DELETE FROM public.produtos_omie_imagens WHERE codigo_produto = $1', [codigoProduto]);
      
      // Insere novas imagens com URLs frescas
      for (let pos = 0; pos < omieData.imagens.length; pos++) {
        const img = omieData.imagens[pos];
        if (img.url_imagem) {
          await pool.query(
            `INSERT INTO public.produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key)
             VALUES ($1, $2, $3, $4)`,
            [codigoProduto, pos, img.url_imagem.trim(), img.path_key || null]
          );
        }
      }
      
      // Retorna primeira imagem
      const primeiraImagem = omieData.imagens[0]?.url_imagem?.trim() || null;
      res.json({ ok: true, url_imagem: primeiraImagem });
    } else {
      // Produto sem imagens
      res.json({ ok: true, url_imagem: null });
    }
  } catch (err) {
    console.error('[Imagem Fresca] Erro ao buscar imagem:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar imagem' });
  }
});

// POST /api/admin/sync/imagens-omie - Sincroniza TODAS as imagens dos produtos ativos
app.post('/api/admin/sync/imagens-omie', express.json(), async (req, res) => {
  const startTime = Date.now();
  
  try {
    console.log('[Sync Imagens] Iniciando sincronização...');
    
    // Busca todos os produtos ativos que têm imagens na tabela atual
    const { rows: produtos } = await pool.query(`
      SELECT DISTINCT p.codigo_produto, p.codigo, p.descricao
      FROM public.produtos_omie p
      WHERE p.inativo = 'N' AND p.bloqueado = 'N'
      ORDER BY p.codigo_produto
    `);
    
    console.log(`[Sync Imagens] ${produtos.length} produtos ativos encontrados`);
    
    let sucessos = 0;
    let erros = 0;
    let semImagem = 0;
    const DELAY_MS = 350; // Rate limit Omie: 3 req/seg = ~333ms, usando 350ms para segurança
    
    for (let i = 0; i < produtos.length; i++) {
      const produto = produtos[i];
      
      try {
        // Consulta produto na Omie para pegar URLs frescas
        const omieBody = {
          call: 'ConsultarProduto',
          app_key: process.env.OMIE_APP_KEY,
          app_secret: process.env.OMIE_APP_SECRET,
          param: [{ codigo_produto: parseInt(produto.codigo_produto) }]
        };
        
        const omieResp = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(omieBody)
        });
        
        if (!omieResp.ok) {
          console.error(`[Sync Imagens] Erro HTTP ${omieResp.status} para produto ${produto.codigo}`);
          erros++;
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
          continue;
        }
        
        const omieData = await omieResp.json();
        
        // Se houver imagens, atualiza no banco
        if (omieData.imagens && Array.isArray(omieData.imagens) && omieData.imagens.length > 0) {
          // Remove imagens antigas
          await pool.query('DELETE FROM public.produtos_omie_imagens WHERE codigo_produto = $1', [produto.codigo_produto]);
          
          // Insere novas imagens com URLs frescas
          for (let pos = 0; pos < omieData.imagens.length; pos++) {
            const img = omieData.imagens[pos];
            if (img.url_imagem) {
              await pool.query(
                `INSERT INTO public.produtos_omie_imagens (codigo_produto, pos, url_imagem, path_key)
                 VALUES ($1, $2, $3, $4)`,
                [produto.codigo_produto, pos, img.url_imagem.trim(), img.path_key || null]
              );
            }
          }
          
          sucessos++;
          console.log(`[Sync Imagens] ${i + 1}/${produtos.length} - ${produto.codigo}: ${omieData.imagens.length} imagens atualizadas`);
        } else {
          semImagem++;
          console.log(`[Sync Imagens] ${i + 1}/${produtos.length} - ${produto.codigo}: sem imagens`);
        }
        
        // Aguarda para respeitar rate limit
        if (i < produtos.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
        
      } catch (err) {
        console.error(`[Sync Imagens] Erro ao processar produto ${produto.codigo}:`, err.message);
        erros++;
      }
    }
    
    const tempoDecorrido = ((Date.now() - startTime) / 1000).toFixed(1);
    const resultado = {
      ok: true,
      total: produtos.length,
      sucessos,
      erros,
      semImagem,
      tempoDecorrido: `${tempoDecorrido}s`
    };
    
    console.log('[Sync Imagens] Concluído:', resultado);
    res.json(resultado);
    
  } catch (err) {
    console.error('[Sync Imagens] Erro geral:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/compras/minhas - Lista solicitações do usuário logado
app.get('/api/compras/minhas', async (req, res) => {
  try {
    const solicitante = req.query.solicitante;
    
    if (!solicitante) {
      return res.status(400).json({ ok: false, error: 'Parâmetro solicitante é obrigatório' });
    }
    
    const { rows } = await pool.query(`
      WITH historico_recente AS (
        SELECT DISTINCT ON (
          hc.tabela_origem,
          LOWER(TRIM(COALESCE(hc.grupo_requisicao, '')))
        )
          hc.id AS historico_id,
          hc.tabela_origem AS table_source,
          hc.grupo_requisicao,
          hc.status,
          hc.created_at
        FROM compras.historico_compras hc
        WHERE hc.tabela_origem IN ('solicitacao_compras', 'compras_sem_cadastro')
          AND TRIM(COALESCE(hc.grupo_requisicao, '')) <> ''
        ORDER BY
          hc.tabela_origem,
          LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))),
          hc.created_at DESC NULLS LAST,
          hc.id DESC
      ),
      origem AS (
        SELECT
          sc.id,
          sc.numero_pedido::text AS numero_pedido,
          sc.produto_codigo,
          sc.produto_descricao,
          sc.quantidade,
          po.unidade,
          sc.prazo_solicitado,
          sc.previsao_chegada,
          sc.observacao,
          sc.observacao_reprovacao,
          sc.observacao_retificacao,
          sc.solicitante,
          sc.resp_inspecao_recebimento,
          sc.responsavel_pela_compra,
          sc.departamento,
          sc.centro_custo::text AS centro_custo,
          sc.objetivo_compra,
          sc.fornecedor_nome,
          sc.fornecedor_id::text AS fornecedor_id,
          sc.familia_produto,
          sc.grupo_requisicao,
          sc.retorno_cotacao::text AS retorno_cotacao,
          sc.categoria_compra_codigo::text AS categoria_compra_codigo,
          sc.categoria_compra_nome,
          sc.codigo_omie::text AS codigo_omie,
          sc.codigo_produto_omie::text AS codigo_produto_omie,
          sc.requisicao_direta,
          sc.anexos::text AS anexos,
          NULL::text AS link,
          sc.cnumero::text AS "cNumero",
          sc.ncodped::text AS "nCodPed",
          sc.created_at,
          sc.updated_at,
          'solicitacao_compras'::text AS table_source,
          LOWER(TRIM(COALESCE(sc.grupo_requisicao, ''))) AS grupo_key
        FROM compras.solicitacao_compras sc
        LEFT JOIN LATERAL (
          SELECT po.unidade
          FROM public.produtos_omie po
          WHERE (
            po.codigo_produto::TEXT = COALESCE(
              NULLIF(sc.codigo_produto_omie::TEXT, ''),
              NULLIF(sc.codigo_omie::TEXT, '')
            )
            OR po.codigo::TEXT = sc.produto_codigo::TEXT
          )
          ORDER BY CASE
            WHEN po.codigo_produto::TEXT = NULLIF(sc.codigo_produto_omie::TEXT, '') THEN 1
            WHEN po.codigo_produto::TEXT = NULLIF(sc.codigo_omie::TEXT, '') THEN 2
            WHEN po.codigo::TEXT = sc.produto_codigo::TEXT THEN 3
            ELSE 4
          END
          LIMIT 1
        ) po ON TRUE
        WHERE TRIM(LOWER(COALESCE(sc.solicitante, ''))) = TRIM(LOWER($1))
          AND TRIM(COALESCE(sc.grupo_requisicao, '')) <> ''

        UNION ALL

        SELECT
          csc.id,
          NULL::text AS numero_pedido,
          csc.produto_codigo,
          csc.produto_descricao,
          csc.quantidade,
          NULL::text AS unidade,
          NULL::date AS prazo_solicitado,
          NULL::date AS previsao_chegada,
          csc.observacao_recebimento AS observacao,
          csc.observacao_reprovacao,
          NULL::text AS observacao_retificacao,
          csc.solicitante,
          csc.resp_inspecao_recebimento,
          NULL::text AS responsavel_pela_compra,
          csc.departamento,
          csc.centro_custo::text AS centro_custo,
          csc.objetivo_compra,
          NULL::text AS fornecedor_nome,
          NULL::text AS fornecedor_id,
          NULL::text AS familia_produto,
          csc.grupo_requisicao,
          csc.retorno_cotacao::text AS retorno_cotacao,
          csc.categoria_compra_codigo::text AS categoria_compra_codigo,
          csc.categoria_compra_nome,
          NULL::text AS codigo_omie,
          NULL::text AS codigo_produto_omie,
          NULL::boolean AS requisicao_direta,
          csc.anexos::text AS anexos,
          csc.link::text AS link,
          NULL::text AS "cNumero",
          NULL::text AS "nCodPed",
          csc.created_at,
          csc.updated_at,
          'compras_sem_cadastro'::text AS table_source,
          LOWER(TRIM(COALESCE(csc.grupo_requisicao, ''))) AS grupo_key
        FROM compras.compras_sem_cadastro csc
        WHERE TRIM(LOWER(COALESCE(csc.solicitante, ''))) = TRIM(LOWER($1))
          AND TRIM(COALESCE(csc.grupo_requisicao, '')) <> ''
      ),
      origem_primeiro_item AS (
        SELECT DISTINCT ON (o.table_source, o.grupo_key)
          o.*
        FROM origem o
        ORDER BY o.table_source, o.grupo_key, o.created_at ASC NULLS FIRST, o.id ASC
      )
      SELECT
        COALESCE(opi.id, hr.historico_id) AS id,
        opi.numero_pedido,
        opi.produto_codigo,
        opi.produto_descricao,
        opi.quantidade,
        opi.unidade,
        opi.prazo_solicitado,
        opi.previsao_chegada,
        hr.status,
        opi.observacao,
        opi.observacao_reprovacao,
        opi.observacao_retificacao,
        opi.solicitante,
        opi.resp_inspecao_recebimento,
        opi.responsavel_pela_compra,
        opi.departamento,
        opi.centro_custo,
        opi.objetivo_compra,
        opi.fornecedor_nome,
        opi.fornecedor_id,
        opi.familia_produto,
        COALESCE(opi.grupo_requisicao, hr.grupo_requisicao) AS grupo_requisicao,
        opi.retorno_cotacao,
        opi.categoria_compra_codigo,
        opi.categoria_compra_nome,
        opi.codigo_omie,
        opi.codigo_produto_omie,
        opi.requisicao_direta,
        opi.anexos,
        opi.link,
        opi."cNumero",
        opi."nCodPed",
        COALESCE(opi.created_at, hr.created_at) AS created_at,
        COALESCE(opi.updated_at, hr.created_at) AS updated_at,
        hr.table_source,
        hr.historico_id,
        hr.historico_id::text AS id_solicitante
      FROM historico_recente hr
      LEFT JOIN origem_primeiro_item opi
        ON opi.table_source = hr.table_source
       AND opi.grupo_key = LOWER(TRIM(COALESCE(hr.grupo_requisicao, '')))
      ORDER BY COALESCE(opi.created_at, hr.created_at) DESC
      LIMIT 1000
    `, [solicitante]);
    
    res.json({ ok: true, solicitacoes: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar minhas solicitações:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar solicitações' });
  }
});

// GET /api/compras/filtro-kanbans - Retorna as preferências de filtro do usuário
app.get('/api/compras/filtro-kanbans', async (req, res) => {
  try {
    // Pega username da sessão do usuário logado
    const username = req.session?.user?.username;
    if (!username) {
      return res.status(401).json({ ok: false, error: 'Usuário não autenticado' });
    }

    // Busca as preferências do usuário
    const { rows } = await pool.query(`
      SELECT kanbans_visiveis
      FROM compras.filtro_kanbans_usuario
      WHERE username = $1
    `, [username]);

    if (rows.length === 0) {
      // Se não existe preferência, retorna todos os kanbans como visíveis
      const todosKanbans = [
        'aguardando aprovação da requisição',
        'aguardando cotação',
        'cotado aguardando escolha',
        'solicitado revisão',
        'aguardando compra',
        'compra realizada',
        'faturada pelo fornecedor',
        'recebido',
        'concluído'
      ];
      return res.json({ ok: true, kanbans_visiveis: todosKanbans });
    }

    res.json({ ok: true, kanbans_visiveis: rows[0].kanbans_visiveis || [] });
  } catch (err) {
    console.error('[Compras] Erro ao carregar filtro de kanbans:', err);
    res.status(500).json({ ok: false, error: 'Erro ao carregar preferências' });
  }
});

// POST /api/compras/filtro-kanbans - Salva as preferências de filtro do usuário
app.post('/api/compras/filtro-kanbans', async (req, res) => {
  try {
    // Pega username da sessão do usuário logado
    const username = req.session?.user?.username;
    const { kanbans_visiveis } = req.body;
    
    if (!username) {
      return res.status(401).json({ ok: false, error: 'Usuário não autenticado' });
    }
    
    if (!Array.isArray(kanbans_visiveis)) {
      return res.status(400).json({ ok: false, error: 'kanbans_visiveis deve ser um array' });
    }

    // Insere ou atualiza as preferências
    await pool.query(`
      INSERT INTO compras.filtro_kanbans_usuario (username, kanbans_visiveis, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (username)
      DO UPDATE SET 
        kanbans_visiveis = $2,
        updated_at = NOW()
    `, [username, JSON.stringify(kanbans_visiveis)]);

    res.json({ ok: true, message: 'Preferências salvas com sucesso' });
  } catch (err) {
    console.error('[Compras] Erro ao salvar filtro de kanbans:', err);
    res.status(500).json({ ok: false, error: 'Erro ao salvar preferências' });
  }
});

// POST /api/compras/aprovar-item/:id - Aprova item e cria requisição na Omie
// Comentário: helper para incluir resumo das cotações no campo observacao
async function atualizarObservacaoComCotacoes(item, itemId) {
  // Validação: categoria_compra_codigo é obrigatória para Omie
  if (!item.categoria_compra_codigo || item.categoria_compra_codigo.trim() === '') {
    const err = new Error('Item sem categoria da compra. Por favor, edite o item e adicione a categoria antes de aprovar.');
    err.status = 400;
    throw err;
  }

  // Comentário: inclui no campo observacao o resumo das cotações (formato padrão)
  try {
    // 1) Busca cotações do item (e por numero_pedido se existir)
    let numeroPedidoRef = item.numero_pedido || null;
    const { rows: cotacoesItem } = await pool.query(
      `SELECT id, fornecedor_nome, valor_cotado, anexos, numero_pedido
       FROM compras.cotacoes
       WHERE solicitacao_id = $1
         AND status_aprovacao = 'aprovado'`,
      [itemId]
    );

    if (!numeroPedidoRef && cotacoesItem.length > 0) {
      const np = cotacoesItem
        .map(r => String(r.numero_pedido || '').trim())
        .find(v => v);
      if (np) numeroPedidoRef = np;
    }

    let cotacoesPorNumero = [];
    if (numeroPedidoRef) {
      const { rows: rowsNumero } = await pool.query(
        `SELECT id, fornecedor_nome, valor_cotado, anexos
         FROM compras.cotacoes
         WHERE numero_pedido = $1
           AND status_aprovacao = 'aprovado'`,
        [numeroPedidoRef]
      );
      cotacoesPorNumero = rowsNumero || [];
    }

    const cotacoesMap = new Map();
    [...cotacoesItem, ...cotacoesPorNumero].forEach(c => {
      if (!c || typeof c.id === 'undefined' || c.id === null) return;
      const key = String(c.id);
      if (!cotacoesMap.has(key)) cotacoesMap.set(key, c);
    });
    const cotacoes = Array.from(cotacoesMap.values());

    const formatarAnexo = (anexos) => {
      if (!anexos) return '-';
      let lista = anexos;
      if (typeof lista === 'string') {
        try { lista = JSON.parse(lista); } catch { return lista; }
      }
      if (!Array.isArray(lista) || lista.length === 0) return '-';
      const primeiro = lista[0];
      if (typeof primeiro === 'string') return primeiro;
      return primeiro?.url || primeiro?.path || '-';
    };

    const linhas = cotacoes.map(c => {
      const valor = (c.valor_cotado !== null && typeof c.valor_cotado !== 'undefined') ? c.valor_cotado : '-';
      return [
        `Cotação: ${c.id}`,
        `Fornecedor: ${c.fornecedor_nome || '-'}`,
        `Valor cotado: ${valor}`,
        `Anexo: ${formatarAnexo(c.anexos)}`
      ].join('\n');
    });

    if (linhas.length > 0) {
      const novaObservacao = linhas.join('\n\n');
      const observacaoAtual = String(item.observacao || '').trim();
      if (observacaoAtual !== novaObservacao) {
        await pool.query(
          `UPDATE compras.solicitacao_compras
           SET observacao = $1
           WHERE id = $2`,
          [novaObservacao, itemId]
        );
      }
      item.observacao = novaObservacao;
    }
  } catch (e) {
    console.warn('[Compras] Falha ao incluir resumo das cotações no campo observacao:', e?.message || e);
  }
}

// Comentário: helper para criar a requisição na Omie e atualizar status/local
async function criarRequisicaoOmieParaItem(item, itemId) {
  await atualizarObservacaoComCotacoes(item, itemId);

  // Gera número de pedido único
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  const hora = String(agora.getHours()).padStart(2, '0');
  const minuto = String(agora.getMinutes()).padStart(2, '0');
  const segundo = String(agora.getSeconds()).padStart(2, '0');
  const milisegundo = String(agora.getMilliseconds()).padStart(3, '0');
  const numeroPedido = `${ano}${mes}${dia}-${hora}${minuto}${segundo}-${milisegundo}`;

  // Determina data de sugestão (dtSugestao): previsao_chegada > prazo_solicitado > data atual + 5 dias
  let dtSugestao;
  if (item.previsao_chegada) {
    const dt = new Date(item.previsao_chegada);
    dtSugestao = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  } else if (item.prazo_solicitado) {
    const dt = new Date(item.prazo_solicitado);
    dtSugestao = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  } else {
    const dt = new Date();
    dt.setDate(dt.getDate() + 5);
    dtSugestao = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  }

  // Busca o CMC (Custo Médio de Compra) da tabela omie_estoque_posicao
  let precoUnitario = 0;
  if (item.codigo_omie) {
    try {
      const { rows: rowsEstoque } = await pool.query(`
        SELECT cmc 
        FROM public.omie_estoque_posicao 
        WHERE omie_prod_id = $1
        LIMIT 1
      `, [item.codigo_omie]);
      if (rowsEstoque.length > 0 && rowsEstoque[0].cmc) {
        precoUnitario = parseFloat(rowsEstoque[0].cmc) || 0;
      }
    } catch (errCmc) {
      console.error('[Aprovar Item] Erro ao buscar CMC:', errCmc);
    }
  }

  const solicitante = item.solicitante || '';
  const respInspecao = item.resp_inspecao_recebimento || '';
  const observacao = '';
  const objetivoCompra = item.objetivo_compra || '';
  const codigoOmie = item.codigo_omie || '';
  const obsReqCompra = `Requisitante: ${solicitante}\nResp. por receber o produto: ${respInspecao}\nNPST: ${numeroPedido}\nNPOM: ${codigoOmie}\nObjetivo da Compra: ${objetivoCompra}`.trim();

  // Monta payload para Omie - IncluirReq
  const requisicaoOmie = {
    codIntReqCompra: numeroPedido,
    codCateg: item.categoria_compra_codigo || '',
    codProj: 0,
    dtSugestao: dtSugestao,
    obsReqCompra: obsReqCompra,
    obsIntReqCompra: item.observacao || '',
    ItensReqCompra: [
      {
        codProd: item.codigo_omie || item.codigo_produto_omie || null,
        obsItem: item.objetivo_compra || '',
        precoUnit: precoUnitario,
        qtde: parseFloat(item.quantidade) || 1
      }
    ]
  };

  console.log('[Aprovar Item] Enviando para Omie IncluirReq:', JSON.stringify(requisicaoOmie, null, 2));

  const omieResponse = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'IncluirReq',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [requisicaoOmie]
    })
  });

  const omieResult = await omieResponse.json();
  if (!omieResponse.ok || omieResult.faultstring) {
    console.error('[Aprovar Item] Erro Omie:', omieResult);
    throw new Error(omieResult.faultstring || 'Erro ao criar requisição na Omie');
  }

  const codReqCompra = omieResult.codReqCompra || null;
  const codIntReqCompra = omieResult.codIntReqCompra || numeroPedido;

  await pool.query(`
    UPDATE compras.solicitacao_compras
    SET 
      status = 'Requisição',
      numero_pedido = $1,
      ncodped = $2,
      updated_at = NOW()
    WHERE id = $3
  `, [codIntReqCompra, codReqCompra, itemId]);

  return { codReqCompra, codIntReqCompra, omieResult };
}

// Comentário: helper para criar requisição única na Omie com múltiplos itens
async function criarRequisicaoOmieParaItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    const err = new Error('Nenhum item para aprovar');
    err.status = 400;
    throw err;
  }

  // Garante mesma categoria em todos os itens
  const categoriaBase = (itens[0].categoria_compra_codigo || '').trim();
  if (!categoriaBase) {
    const err = new Error('Item sem categoria da compra. Por favor, edite o item e adicione a categoria antes de aprovar.');
    err.status = 400;
    throw err;
  }
  const itensCategoriaInvalida = itens.filter(i => (i.categoria_compra_codigo || '').trim() !== categoriaBase);
  if (itensCategoriaInvalida.length > 0) {
    const err = new Error('Todos os itens do grupo devem ter a mesma categoria de compra.');
    err.status = 400;
    throw err;
  }

  // Atualiza observação com resumo das cotações para cada item
  for (const item of itens) {
    await atualizarObservacaoComCotacoes(item, item.id);
  }

  // Gera número de pedido único
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  const hora = String(agora.getHours()).padStart(2, '0');
  const minuto = String(agora.getMinutes()).padStart(2, '0');
  const segundo = String(agora.getSeconds()).padStart(2, '0');
  const milisegundo = String(agora.getMilliseconds()).padStart(3, '0');
  const numeroPedido = `${ano}${mes}${dia}-${hora}${minuto}${segundo}-${milisegundo}`;

  // Determina data de sugestão mínima entre itens
  const sugestoes = itens.map(item => {
    if (item.previsao_chegada) return new Date(item.previsao_chegada);
    if (item.prazo_solicitado) return new Date(item.prazo_solicitado);
    const dt = new Date();
    dt.setDate(dt.getDate() + 5);
    return dt;
  }).filter(d => !Number.isNaN(d.getTime()));

  let dtSugestao;
  if (sugestoes.length > 0) {
    const min = new Date(Math.min(...sugestoes.map(d => d.getTime())));
    dtSugestao = `${String(min.getDate()).padStart(2, '0')}/${String(min.getMonth() + 1).padStart(2, '0')}/${min.getFullYear()}`;
  } else {
    const dt = new Date();
    dt.setDate(dt.getDate() + 5);
    dtSugestao = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  }

  const primeiroItem = itens[0];
  const solicitante = primeiroItem.solicitante || '';
  const respInspecao = primeiroItem.resp_inspecao_recebimento || '';
  const objetivoCompra = primeiroItem.objetivo_compra || '';
  const codigoOmie = primeiroItem.codigo_omie || '';
  const obsReqCompra = `Requisitante: ${solicitante}\nResp. por receber o produto: ${respInspecao}\nNPST: ${numeroPedido}\nNPOM: ${codigoOmie}\nObjetivo da Compra: ${objetivoCompra}`.trim();

  // Monta itens com CMC
  const itensReqCompra = [];
  for (const item of itens) {
    let precoUnitario = 0;
    if (item.codigo_omie) {
      try {
        const { rows: rowsEstoque } = await pool.query(`
          SELECT cmc 
          FROM public.omie_estoque_posicao 
          WHERE omie_prod_id = $1
          LIMIT 1
        `, [item.codigo_omie]);
        if (rowsEstoque.length > 0 && rowsEstoque[0].cmc) {
          precoUnitario = parseFloat(rowsEstoque[0].cmc) || 0;
        }
      } catch (errCmc) {
        console.error('[Aprovar Grupo] Erro ao buscar CMC:', errCmc);
      }
    }

    itensReqCompra.push({
      codProd: item.codigo_omie || item.codigo_produto_omie || null,
      obsItem: item.objetivo_compra || '',
      precoUnit: precoUnitario,
      qtde: parseFloat(item.quantidade) || 1
    });
  }

  const requisicaoOmie = {
    codIntReqCompra: numeroPedido,
    codCateg: categoriaBase,
    codProj: 0,
    dtSugestao: dtSugestao,
    obsReqCompra: obsReqCompra,
    obsIntReqCompra: primeiroItem.observacao || '',
    ItensReqCompra: itensReqCompra
  };

  console.log('[Aprovar Grupo] Enviando para Omie IncluirReq:', JSON.stringify(requisicaoOmie, null, 2));

  const omieResponse = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'IncluirReq',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [requisicaoOmie]
    })
  });

  const omieResult = await omieResponse.json();
  if (!omieResponse.ok || omieResult.faultstring) {
    console.error('[Aprovar Grupo] Erro Omie:', omieResult);
    throw new Error(omieResult.faultstring || 'Erro ao criar requisição na Omie');
  }

  const codReqCompra = omieResult.codReqCompra || null;
  const codIntReqCompra = omieResult.codIntReqCompra || numeroPedido;

  await pool.query(`
    UPDATE compras.solicitacao_compras
    SET 
      status = 'Requisição',
      numero_pedido = $1,
      ncodped = $2,
      updated_at = NOW()
    WHERE id = ANY($3)
  `, [codIntReqCompra, codReqCompra, itens.map(i => i.id)]);

  return { codReqCompra, codIntReqCompra, omieResult };
}

app.post('/api/compras/aprovar-item/:id', express.json(), async (req, res) => {
  try {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    // Busca dados do item
    const { rows } = await pool.query(`
      SELECT 
        id,
        produto_codigo,
        produto_descricao,
        quantidade,
        objetivo_compra,
        solicitante,
        departamento,
        categoria_compra_codigo,
        previsao_chegada,
        prazo_solicitado,
        codigo_produto_omie,
        codigo_omie,
        retorno_cotacao,
        observacao,
        resp_inspecao_recebimento
      FROM compras.solicitacao_compras
      WHERE id = $1
    `, [itemId]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }

    const item = rows[0];
    
    // Validação: categoria_compra_codigo é obrigatória para Omie
    if (!item.categoria_compra_codigo || item.categoria_compra_codigo.trim() === '') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Item sem categoria da compra. Por favor, edite o item e adicione a categoria antes de aprovar.' 
      });
    }

    // Verifica se veio uma cotação aprovada (do kanban "Cotado aguardando escolha")
    const cotacaoAprovadaId = req.body?.cotacao_aprovada_id;
    
    // REGRA 1: Se retorno_cotacao indica "sim" → Apenas muda status para "aguardando cotação" (não cria requisição Omie)
    // REGRA 2: Caso contrário, se veio com cotacao_aprovada_id → Cria requisição na Omie
    // REGRA 3: Caso contrário → Cria requisição na Omie
    const retornoCotacao = String(item.retorno_cotacao || '').trim().toLowerCase();
    const retornoCotacaoSim = ['s', 'sim', 'yes', 'true', '1'].includes(retornoCotacao);
    
    if (retornoCotacaoSim) {
      // Apenas atualiza status para "aguardando cotação" sem criar requisição na Omie
      await pool.query(`
        UPDATE compras.solicitacao_compras
        SET 
          status = 'aguardando cotação',
          updated_at = NOW()
        WHERE id = $1
      `, [itemId]);
      
      console.log(`[Aprovar Item] Item ${itemId} aprovado - aguardando cotação (sem requisição Omie)`);
      
      return res.json({ 
        ok: true, 
        message: 'Item aprovado. Status: aguardando cotação'
      });
    }

    // A partir daqui, cria requisição na Omie (retorno_cotacao = 'N' OU cotação aprovada)
    const { codReqCompra, codIntReqCompra, omieResult } = await criarRequisicaoOmieParaItem(item, itemId);

    res.json({
      ok: true,
      message: 'Item aprovado e requisição criada na Omie',
      numero_pedido: codIntReqCompra,
      ncodped: codReqCompra,
      omie_response: omieResult
    });

  } catch (err) {
    console.error('[Aprovar Item] Erro:', err);
    res.status(err.status || 500).json({ ok: false, error: err.message || 'Erro ao aprovar item' });
  }
});

// POST /api/compras/aprovar-grupo - Aprova múltiplos itens em uma única requisição Omie
app.post('/api/compras/aprovar-grupo', express.json(), async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(id => Number(id)).filter(id => Number.isInteger(id))
      : [];

    if (!ids.length) {
      return res.status(400).json({ ok: false, error: 'Lista de IDs inválida' });
    }

    const { rows } = await pool.query(`
      SELECT 
        id,
        produto_codigo,
        produto_descricao,
        quantidade,
        objetivo_compra,
        solicitante,
        departamento,
        categoria_compra_codigo,
        previsao_chegada,
        prazo_solicitado,
        codigo_produto_omie,
        codigo_omie,
        retorno_cotacao,
        observacao,
        resp_inspecao_recebimento
      FROM compras.solicitacao_compras
      WHERE id = ANY($1)
    `, [ids]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Itens não encontrados' });
    }

    const idsEncontrados = new Set(rows.map(r => r.id));
    const idsNaoEncontrados = ids.filter(id => !idsEncontrados.has(id));
    if (idsNaoEncontrados.length > 0) {
      return res.status(404).json({ ok: false, error: `Itens não encontrados: ${idsNaoEncontrados.join(', ')}` });
    }

    const retornoCotacaoSim = (valor) => {
      const v = String(valor || '').trim().toLowerCase();
      return ['s', 'sim', 'yes', 'true', '1'].includes(v);
    };

    const itensAguardarCotacao = rows.filter(item => retornoCotacaoSim(item.retorno_cotacao));
    const itensRequisicao = rows.filter(item => !retornoCotacaoSim(item.retorno_cotacao));

    if (itensAguardarCotacao.length > 0) {
      await pool.query(`
        UPDATE compras.solicitacao_compras
        SET 
          status = 'aguardando cotação',
          updated_at = NOW()
        WHERE id = ANY($1)
      `, [itensAguardarCotacao.map(i => i.id)]);
    }

    if (itensRequisicao.length === 0) {
      return res.json({
        ok: true,
        message: 'Itens encaminhados para aguardando cotação',
        itens_aguardando_cotacao: itensAguardarCotacao.map(i => i.id)
      });
    }

    const { codReqCompra, codIntReqCompra, omieResult } = await criarRequisicaoOmieParaItens(itensRequisicao);

    res.json({
      ok: true,
      message: 'Itens aprovados e requisição criada na Omie',
      numero_pedido: codIntReqCompra,
      ncodped: codReqCompra,
      omie_response: omieResult,
      itens_requisicao: itensRequisicao.map(i => i.id),
      itens_aguardando_cotacao: itensAguardarCotacao.map(i => i.id)
    });
  } catch (err) {
    console.error('[Aprovar Grupo] Erro:', err);
    res.status(err.status || 500).json({ ok: false, error: err.message || 'Erro ao aprovar itens' });
  }
});

// GET /api/compras/todas - Lista todas as solicitações (para gestores)
app.get('/api/compras/todas', async (req, res) => {
  try {
    const { rows: solicitacoesHistorico } = await pool.query(`
      WITH historico_recente AS (
        SELECT DISTINCT ON (
          hc.tabela_origem,
          LOWER(TRIM(COALESCE(hc.grupo_requisicao, '')))
        )
          hc.id AS historico_id,
          hc.tabela_origem AS table_source,
          hc.grupo_requisicao,
          hc.status,
          hc.created_at
        FROM compras.historico_compras hc
        WHERE hc.tabela_origem IN ('solicitacao_compras', 'compras_sem_cadastro')
          AND TRIM(COALESCE(hc.grupo_requisicao, '')) <> ''
        ORDER BY
          hc.tabela_origem,
          LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))),
          hc.created_at DESC NULLS LAST,
          hc.id DESC
      ),
      origem AS (
        SELECT
          sc.id,
          sc.numero_pedido::text AS numero_pedido,
          sc.produto_codigo,
          sc.produto_descricao,
          sc.quantidade,
          po.unidade,
          sc.prazo_solicitado,
          sc.previsao_chegada,
          sc.observacao,
          sc.observacao_reprovacao,
          sc.observacao_retificacao,
          sc.solicitante,
          sc.resp_inspecao_recebimento,
          sc.responsavel_pela_compra,
          sc.departamento,
          sc.centro_custo::text AS centro_custo,
          sc.objetivo_compra,
          sc.fornecedor_nome,
          sc.fornecedor_id::text AS fornecedor_id,
          sc.familia_produto,
          sc.grupo_requisicao,
          sc.retorno_cotacao::text AS retorno_cotacao,
          sc.categoria_compra_codigo::text AS categoria_compra_codigo,
          sc.categoria_compra_nome,
          sc.codigo_omie::text AS codigo_omie,
          sc.codigo_produto_omie::text AS codigo_produto_omie,
          sc.requisicao_direta,
          sc.anexos::text AS anexos,
          NULL::text AS link,
          sc.cnumero::text AS "cNumero",
          sc.ncodped::text AS "nCodPed",
          sc.created_at,
          sc.updated_at,
          'solicitacao_compras'::text AS table_source,
          LOWER(TRIM(COALESCE(sc.grupo_requisicao, ''))) AS grupo_key
        FROM compras.solicitacao_compras sc
        LEFT JOIN LATERAL (
          SELECT po.unidade
          FROM public.produtos_omie po
          WHERE (
            po.codigo_produto::TEXT = COALESCE(
              NULLIF(sc.codigo_produto_omie::TEXT, ''),
              NULLIF(sc.codigo_omie::TEXT, '')
            )
            OR po.codigo::TEXT = sc.produto_codigo::TEXT
          )
          ORDER BY CASE
            WHEN po.codigo_produto::TEXT = NULLIF(sc.codigo_produto_omie::TEXT, '') THEN 1
            WHEN po.codigo_produto::TEXT = NULLIF(sc.codigo_omie::TEXT, '') THEN 2
            WHEN po.codigo::TEXT = sc.produto_codigo::TEXT THEN 3
            ELSE 4
          END
          LIMIT 1
        ) po ON TRUE
        WHERE TRIM(COALESCE(sc.grupo_requisicao, '')) <> ''

        UNION ALL

        SELECT
          csc.id,
          NULL::text AS numero_pedido,
          csc.produto_codigo,
          csc.produto_descricao,
          csc.quantidade,
          NULL::text AS unidade,
          NULL::date AS prazo_solicitado,
          NULL::date AS previsao_chegada,
          csc.observacao_recebimento AS observacao,
          csc.observacao_reprovacao,
          NULL::text AS observacao_retificacao,
          csc.solicitante,
          csc.resp_inspecao_recebimento,
          NULL::text AS responsavel_pela_compra,
          csc.departamento,
          csc.centro_custo::text AS centro_custo,
          csc.objetivo_compra,
          NULL::text AS fornecedor_nome,
          NULL::text AS fornecedor_id,
          NULL::text AS familia_produto,
          csc.grupo_requisicao,
          csc.retorno_cotacao::text AS retorno_cotacao,
          csc.categoria_compra_codigo::text AS categoria_compra_codigo,
          csc.categoria_compra_nome,
          NULL::text AS codigo_omie,
          NULL::text AS codigo_produto_omie,
          NULL::boolean AS requisicao_direta,
          csc.anexos::text AS anexos,
          csc.link::text AS link,
          NULL::text AS "cNumero",
          NULL::text AS "nCodPed",
          csc.created_at,
          csc.updated_at,
          'compras_sem_cadastro'::text AS table_source,
          LOWER(TRIM(COALESCE(csc.grupo_requisicao, ''))) AS grupo_key
        FROM compras.compras_sem_cadastro csc
        WHERE TRIM(COALESCE(csc.grupo_requisicao, '')) <> ''
      )
      SELECT
        COALESCE(o.id, hr.historico_id) AS id,
        o.numero_pedido,
        o.produto_codigo,
        o.produto_descricao,
        o.quantidade,
        o.unidade,
        o.prazo_solicitado,
        o.previsao_chegada,
        hr.status,
        o.observacao,
        o.observacao_reprovacao,
        o.observacao_retificacao,
        o.solicitante,
        o.resp_inspecao_recebimento,
        o.responsavel_pela_compra,
        o.departamento,
        o.centro_custo,
        o.objetivo_compra,
        o.fornecedor_nome,
        o.fornecedor_id,
        o.familia_produto,
        COALESCE(o.grupo_requisicao, hr.grupo_requisicao) AS grupo_requisicao,
        o.retorno_cotacao,
        o.categoria_compra_codigo,
        o.categoria_compra_nome,
        o.codigo_omie,
        o.codigo_produto_omie,
        o.requisicao_direta,
        o.anexos,
        o.link,
        o."cNumero",
        o."nCodPed",
        COALESCE(o.created_at, hr.created_at) AS created_at,
        COALESCE(o.updated_at, hr.created_at) AS updated_at,
        hr.table_source,
        hr.historico_id,
        hr.historico_id::text AS id_solicitante
      FROM historico_recente hr
      LEFT JOIN origem o
        ON o.table_source = hr.table_source
       AND o.grupo_key = LOWER(TRIM(COALESCE(hr.grupo_requisicao, '')))
      ORDER BY COALESCE(o.created_at, hr.created_at) DESC
      LIMIT 1000
    `);

    solicitacoesHistorico.forEach((item) => {
      item.id_solicitante = String(item?.historico_id || '').trim() || '-';
    });

    const todasSolicitacoes = [...solicitacoesHistorico]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 1000);
    
    res.json({ ok: true, solicitacoes: todasSolicitacoes });
  } catch (err) {
    console.error('[Compras] Erro ao listar todas solicitações:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar solicitações' });
  }
});

// GET /api/compras/grupo-itens - Lista itens por grupo_requisicao e tabela de origem
app.get('/api/compras/grupo-itens', async (req, res) => {
  try {
    const grupoRequisicao = String(req.query?.grupo_requisicao || '').trim();
    const tableSource = String(req.query?.table_source || '').trim();

    if (!grupoRequisicao) {
      return res.status(400).json({ ok: false, error: 'Parâmetro grupo_requisicao é obrigatório' });
    }

    if (!['solicitacao_compras', 'compras_sem_cadastro'].includes(tableSource)) {
      return res.status(400).json({ ok: false, error: 'Parâmetro table_source inválido' });
    }

    if (tableSource === 'solicitacao_compras') {
      const { rows } = await pool.query(`
        SELECT
          sc.id,
          sc.numero_pedido::text AS numero_pedido,
          sc.produto_codigo,
          sc.produto_descricao,
          sc.quantidade,
          po.unidade,
          COALESCE(hc.status, sc.status) AS status,
          sc.solicitante,
          sc.departamento,
          sc.centro_custo::text AS centro_custo,
          sc.grupo_requisicao,
          sc.objetivo_compra,
          sc.retorno_cotacao::text AS retorno_cotacao,
          sc.observacao,
          sc.observacao_reprovacao,
          sc.observacao_retificacao,
          sc.anexos,
          NULL::text AS link,
          sc.created_at,
          sc.updated_at,
          'solicitacao_compras'::text AS table_source
        FROM compras.solicitacao_compras sc
        LEFT JOIN LATERAL (
          SELECT po.unidade
          FROM public.produtos_omie po
          WHERE (
            po.codigo_produto::TEXT = COALESCE(
              NULLIF(sc.codigo_produto_omie::TEXT, ''),
              NULLIF(sc.codigo_omie::TEXT, '')
            )
            OR po.codigo::TEXT = sc.produto_codigo::TEXT
          )
          ORDER BY CASE
            WHEN po.codigo_produto::TEXT = NULLIF(sc.codigo_produto_omie::TEXT, '') THEN 1
            WHEN po.codigo_produto::TEXT = NULLIF(sc.codigo_omie::TEXT, '') THEN 2
            WHEN po.codigo::TEXT = sc.produto_codigo::TEXT THEN 3
            ELSE 4
          END
          LIMIT 1
        ) po ON TRUE
        LEFT JOIN compras.historico_compras hc
          ON LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))) = LOWER(TRIM(COALESCE(sc.grupo_requisicao, '')))
        WHERE LOWER(TRIM(COALESCE(sc.grupo_requisicao, ''))) = LOWER(TRIM($1))
        ORDER BY sc.created_at ASC NULLS FIRST, sc.id ASC
      `, [grupoRequisicao]);

      return res.json({
        ok: true,
        grupo_requisicao: grupoRequisicao,
        table_source: tableSource,
        referencia_id: rows[0]?.id || null,
        itens: rows
      });
    }

    const { rows } = await pool.query(`
      SELECT
        csc.id,
        csc.numero_pedido::text AS numero_pedido,
        csc.produto_codigo,
        csc.produto_descricao,
        csc.quantidade,
        NULL::text AS unidade,
        COALESCE(hc.status, csc.status) AS status,
        csc.solicitante,
        csc.departamento,
        csc.centro_custo::text AS centro_custo,
        csc.grupo_requisicao,
        csc.objetivo_compra,
        csc.retorno_cotacao::text AS retorno_cotacao,
        csc.observacao_recebimento AS observacao,
        csc.observacao_reprovacao,
        NULL::text AS observacao_retificacao,
        csc.anexos,
        csc.link,
        csc.created_at,
        csc.updated_at,
        'compras_sem_cadastro'::text AS table_source
      FROM compras.compras_sem_cadastro csc
      LEFT JOIN compras.historico_compras hc
        ON LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))) = LOWER(TRIM(COALESCE(csc.grupo_requisicao, '')))
      WHERE LOWER(TRIM(COALESCE(csc.grupo_requisicao, ''))) = LOWER(TRIM($1))
      ORDER BY csc.created_at ASC NULLS FIRST, csc.id ASC
    `, [grupoRequisicao]);

    return res.json({
      ok: true,
      grupo_requisicao: grupoRequisicao,
      table_source: tableSource,
      referencia_id: rows[0]?.id || null,
      itens: rows
    });
  } catch (err) {
    console.error('[Compras] Erro ao listar itens do grupo:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar itens do grupo' });
  }
});

// POST /api/compras/grupo-itens - Adiciona novo item em um grupo_requisicao
app.post('/api/compras/grupo-itens', express.json(), async (req, res) => {
  try {
    const grupoRequisicao = String(req.body?.grupo_requisicao || '').trim();
    const tableSource = String(req.body?.table_source || '').trim();
    const produtoCodigo = String(req.body?.produto_codigo || '').trim();
    const produtoDescricao = String(req.body?.produto_descricao || '').trim();
    const codigoProdutoOmieBody = String(req.body?.codigo_produto_omie ?? req.body?.produto_codigo_omie ?? '').trim();
    const quantidadeRaw = req.body?.quantidade;
    const quantidade = Number(String(quantidadeRaw ?? '').replace(',', '.'));

    if (!grupoRequisicao) {
      return res.status(400).json({ ok: false, error: 'grupo_requisicao é obrigatório' });
    }
    if (!['solicitacao_compras', 'compras_sem_cadastro'].includes(tableSource)) {
      return res.status(400).json({ ok: false, error: 'table_source inválido' });
    }
    if (!produtoCodigo) {
      return res.status(400).json({ ok: false, error: 'produto_codigo é obrigatório' });
    }
    if (!produtoDescricao) {
      return res.status(400).json({ ok: false, error: 'produto_descricao é obrigatório' });
    }
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return res.status(400).json({ ok: false, error: 'quantidade inválida' });
    }

    if (tableSource === 'solicitacao_compras') {
      let codigoProdutoOmie = codigoProdutoOmieBody || null;

      if (!codigoProdutoOmie) {
        try {
          const { rows: produtoRows } = await pool.query(
            `
              SELECT codigo_produto
              FROM public.produtos_omie
              WHERE TRIM(codigo::text) = TRIM($1::text)
              ORDER BY codigo_produto ASC
              LIMIT 1
            `,
            [produtoCodigo]
          );
          codigoProdutoOmie = produtoRows[0]?.codigo_produto != null
            ? String(produtoRows[0].codigo_produto).trim()
            : null;
        } catch (lookupErr) {
          console.warn('[Compras] Aviso ao resolver codigo_produto_omie por produto_codigo:', lookupErr.message);
        }
      }

      const codigoProdutoOmieParam = (() => {
        if (codigoProdutoOmie == null) return null;
        const valor = String(codigoProdutoOmie).trim();
        if (!valor) return null;
        return /^\d+$/.test(valor) ? valor : null;
      })();

      const { rows } = await pool.query(`
        WITH ref AS (
          SELECT *
          FROM compras.solicitacao_compras
          WHERE LOWER(TRIM(COALESCE(grupo_requisicao, ''))) = LOWER(TRIM($1))
          ORDER BY created_at ASC NULLS FIRST, id ASC
          LIMIT 1
        )
        INSERT INTO compras.solicitacao_compras (
          numero_pedido,
          produto_codigo,
          produto_descricao,
          quantidade,
          prazo_solicitado,
          previsao_chegada,
          status,
          observacao,
          observacao_reprovacao,
          observacao_retificacao,
          solicitante,
          resp_inspecao_recebimento,
          responsavel_pela_compra,
          departamento,
          centro_custo,
          objetivo_compra,
          fornecedor_nome,
          fornecedor_id,
          familia_produto,
          grupo_requisicao,
          retorno_cotacao,
          categoria_compra_codigo,
          categoria_compra_nome,
          codigo_omie,
          codigo_produto_omie,
          requisicao_direta,
          anexos,
          anexo_url,
          cnumero,
          ncodped,
          created_at,
          updated_at
        )
        SELECT
          ref.numero_pedido,
          $2,
          $3,
          $4,
          ref.prazo_solicitado,
          ref.previsao_chegada,
          ref.status,
          ref.observacao,
          ref.observacao_reprovacao,
          ref.observacao_retificacao,
          ref.solicitante,
          ref.resp_inspecao_recebimento,
          ref.responsavel_pela_compra,
          ref.departamento,
          ref.centro_custo,
          ref.objetivo_compra,
          ref.fornecedor_nome,
          ref.fornecedor_id,
          ref.familia_produto,
          ref.grupo_requisicao,
          ref.retorno_cotacao,
          ref.categoria_compra_codigo,
          ref.categoria_compra_nome,
          ref.codigo_omie,
          CAST(NULLIF(TRIM($5::text), '') AS BIGINT),
          ref.requisicao_direta,
          ref.anexos,
          ref.anexo_url,
          ref.cnumero,
          ref.ncodped,
          NOW(),
          NOW()
        FROM ref
        RETURNING *
      `, [grupoRequisicao, produtoCodigo, produtoDescricao, quantidade, codigoProdutoOmieParam]);

      if (!rows.length) {
        return res.status(404).json({ ok: false, error: 'Grupo não encontrado para adicionar item' });
      }

      return res.json({ ok: true, item: rows[0], table_source: tableSource });
    }

    const { rows } = await pool.query(`
      WITH ref AS (
        SELECT *
        FROM compras.compras_sem_cadastro
        WHERE LOWER(TRIM(COALESCE(grupo_requisicao, ''))) = LOWER(TRIM($1))
        ORDER BY created_at ASC NULLS FIRST, id ASC
        LIMIT 1
      )
      INSERT INTO compras.compras_sem_cadastro (
        produto_codigo,
        produto_descricao,
        quantidade,
        departamento,
        centro_custo,
        categoria_compra_codigo,
        categoria_compra_nome,
        objetivo_compra,
        retorno_cotacao,
        resp_inspecao_recebimento,
        observacao_recebimento,
        status,
        solicitante,
        anexos,
        link,
        grupo_requisicao,
        numero_pedido,
        ncodped,
        cod_req_compra,
        cod_int_req_compra,
        created_at,
        updated_at
      )
      SELECT
        $2,
        $3,
        $4,
        ref.departamento,
        ref.centro_custo,
        ref.categoria_compra_codigo,
        ref.categoria_compra_nome,
        ref.objetivo_compra,
        ref.retorno_cotacao,
        ref.resp_inspecao_recebimento,
        ref.observacao_recebimento,
        ref.status,
        ref.solicitante,
        ref.anexos,
        ref.link,
        ref.grupo_requisicao,
        ref.numero_pedido,
        ref.ncodped,
        ref.cod_req_compra,
        ref.cod_int_req_compra,
        NOW(),
        NOW()
      FROM ref
      RETURNING *
    `, [grupoRequisicao, produtoCodigo, produtoDescricao, quantidade]);

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Grupo não encontrado para adicionar item' });
    }

    return res.json({ ok: true, item: rows[0], table_source: tableSource });
  } catch (err) {
    console.error('[Compras] Erro ao adicionar item no grupo:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao adicionar item no grupo' });
  }
});

// GET /api/compras/requisicoes/debug/:id - Debug de requisição específica
app.get('/api/compras/requisicoes/debug/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    // 1. Busca o item em compras_sem_cadastro
    const { rows: item } = await pool.query(
      'SELECT * FROM compras.compras_sem_cadastro WHERE id = $1',
      [id]
    );
    
    if (!item.length) {
      return res.json({ ok: false, error: 'Item não encontrado' });
    }
    
    const itemData = item[0];
    
    // 2. Verifica se tem cod_req_compra
    const codReqCompra = itemData.cod_req_compra;
    
    // 3. Busca em requisicoes_omie
    const { rows: requisicao } = await pool.query(
      'SELECT * FROM compras.requisicoes_omie WHERE cod_req_compra = $1',
      [codReqCompra]
    );
    
    // 4. Verifica se existe em pedidos_omie
    const { rows: pedido } = await pool.query(
      'SELECT n_cod_ped FROM compras.pedidos_omie WHERE n_cod_ped::text = $1::text',
      [codReqCompra]
    );
    
    res.json({
      ok: true,
      item: itemData,
      tem_cod_req_compra: !!codReqCompra,
      requisicao_omie: requisicao[0] || null,
      existe_em_pedidos: pedido.length > 0,
      deveria_aparecer: !!codReqCompra && itemData.status === 'Requisição' && pedido.length === 0
    });
  } catch (err) {
    console.error('[Debug] Erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/compras/requisicoes - Lista requisições válidas para o kanban "Requisições"
app.get('/api/compras/requisicoes', async (req, res) => {
  try {
    // Regras:
    // 1) Base: compras.solicitacao_compras (status Requisição)
    // 2) Só entra se existir correspondência em compras.requisicoes_omie por cod_int_req_compra = numero_pedido
    // 3) Só entra se requisicoes_omie.inativo = false
    // 4) Não entra se já existir em compras.pedidos_omie por c_cod_int_ped = numero_pedido
    console.log('[Compras/Requisições] Iniciando busca de requisições...');
    
    // Busca somente solicitações válidas da tabela solicitacao_compras
    const { rows: solicitacoes } = await pool.query(`
      SELECT 
        sc.*,
        COALESCE(hc.status, sc.status) AS status,
        po.codigo AS produto_codigo,
        po.descricao AS produto_descricao,
        ro.numero AS cnumero,
        ro.cod_req_compra AS cod_req_compra_omie,
        ro.cod_int_req_compra AS cod_int_req_compra_omie,
        'solicitacao_compras' AS table_source
      FROM compras.solicitacao_compras sc
      LEFT JOIN public.produtos_omie po ON po.codigo_produto = sc.codigo_omie
      INNER JOIN compras.requisicoes_omie ro
        ON TRIM(COALESCE(ro.cod_int_req_compra, '')) = TRIM(COALESCE(sc.numero_pedido, ''))
      LEFT JOIN compras.historico_compras hc
        ON LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))) = LOWER(TRIM(COALESCE(sc.grupo_requisicao, '')))
      WHERE TRIM(COALESCE(sc.numero_pedido, '')) <> ''
        AND TRIM(LOWER(COALESCE(hc.status, sc.status, ''))) IN (
          TRIM(LOWER('Requisição')),
          TRIM(LOWER('Requisicao'))
        )
        AND COALESCE(ro.inativo, false) = false
        AND NOT EXISTS (
          SELECT 1
          FROM compras.pedidos_omie ped
          WHERE TRIM(COALESCE(ped.c_cod_int_ped, '')) = TRIM(COALESCE(sc.numero_pedido, ''))
        )
      ORDER BY ro.numero DESC NULLS LAST, sc.created_at DESC
    `);
    
    // Busca também itens válidos da tabela compras_sem_cadastro
    const { rows: semCadastro } = await pool.query(`
      SELECT
        sc.*,
        COALESCE(hc.status, sc.status) AS status,
        sc.produto_codigo AS produto_codigo,
        sc.produto_descricao AS produto_descricao,
        ro.numero AS cnumero,
        ro.cod_req_compra AS cod_req_compra_omie,
        ro.cod_int_req_compra AS cod_int_req_compra_omie,
        'compras_sem_cadastro' AS table_source
      FROM compras.compras_sem_cadastro sc
      INNER JOIN compras.requisicoes_omie ro
        ON TRIM(COALESCE(ro.cod_int_req_compra, '')) = TRIM(COALESCE(sc.numero_pedido, ''))
      LEFT JOIN compras.historico_compras hc
        ON LOWER(TRIM(COALESCE(hc.grupo_requisicao, ''))) = LOWER(TRIM(COALESCE(sc.grupo_requisicao, '')))
      WHERE TRIM(COALESCE(sc.numero_pedido, '')) <> ''
        AND TRIM(LOWER(COALESCE(hc.status, sc.status, ''))) IN (
          TRIM(LOWER('Requisição')),
          TRIM(LOWER('Requisicao'))
        )
        AND COALESCE(ro.inativo, false) = false
        AND NOT EXISTS (
          SELECT 1
          FROM compras.pedidos_omie ped
          WHERE TRIM(COALESCE(ped.c_cod_int_ped, '')) = TRIM(COALESCE(sc.numero_pedido, ''))
        )
      ORDER BY ro.numero DESC NULLS LAST, sc.created_at DESC
    `);

    const solicitacoesTodas = [...solicitacoes, ...semCadastro];
    console.log(
      `[Compras/Requisições] Encontradas ${solicitacoesTodas.length} solicitações válidas para o kanban Requisições ` +
      `(solicitacao_compras=${solicitacoes.length}, compras_sem_cadastro=${semCadastro.length})`
    );

    // Agrupa os itens por grupo_requisicao (campo que agrupa requisições no kanban)
    const requisicoesPorGrupo = {};
    
    solicitacoesTodas.forEach(item => {
      const grupoRequisicao = item.grupo_requisicao || item.cnumero || item.numero_pedido || 'SEM_GRUPO';
      
      if (!requisicoesPorGrupo[grupoRequisicao]) {
        requisicoesPorGrupo[grupoRequisicao] = {
          numero: item.cnumero || grupoRequisicao,
          grupo_requisicao: grupoRequisicao,
          numero_requisicao_omie: item.cnumero || null,
          cod_req_compra: item.cod_req_compra_omie || item.cod_req_compra || item.ncodped,
          cod_int_req_compra: item.cod_int_req_compra_omie || item.numero_pedido,
          created_at: item.created_at,
          updated_at: item.updated_at,
          itens: []
        };
      }
      
      requisicoesPorGrupo[grupoRequisicao].itens.push({
        id: item.id,
        produto_codigo: item.produto_codigo || item.codigo_omie || '-',
        produto_descricao: item.produto_descricao || item.produto_descricao_manual || 'Sem descrição',
        quantidade: item.quantidade,
        prazo_solicitado: item.prazo_solicitado,
        observacao: item.observacao || item.observacao_recebimento,
        solicitante: item.solicitante,
        departamento: item.departamento,
        centro_custo: item.centro_custo,
        objetivo_compra: item.objetivo_compra,
        created_at: item.created_at,
        codigo_omie: item.codigo_omie,
        ncodped: item.ncodped,
        numero_pedido: item.numero_pedido,
        status: item.status,
        link: item.table_source === 'compras_sem_cadastro' ? item.link : null,
        c_unidade: item.c_unidade || '-',
        n_qtde: item.n_qtde || item.quantidade || 0,
        n_val_tot: item.n_val_tot || 0,
        table_source: item.table_source || null
      });
    });
    
    // Converte objeto em array
    const requisicoes = Object.values(requisicoesPorGrupo);
    
    console.log(`[Compras/Requisições] Retornando ${requisicoes.length} requisições agrupadas`);
    console.log('[Compras/Requisições] Primeira requisição:', JSON.stringify(requisicoes[0], null, 2));

    res.json({ ok: true, requisicoes: requisicoes });
  } catch (err) {
    console.error('[Compras/Requisições] Erro ao listar requisições:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar requisições' });
  }
});

// GET /api/compras/pedidos-compra - Lista pedidos de compra com etapa 10
app.get('/api/compras/pedidos-compra', async (req, res) => {
  try {
    // Objetivo: Retornar pedidos da tabela compras.pedidos_omie com c_etapa = '10'
    // Agrupar por c_numero e incluir fornecedor e produtos
    console.log('[Compras/PedidosCompra] Iniciando busca de pedidos de compra...');
    
    // Busca pedidos com c_etapa = '10' com produtos
    const { rows: pedidosComProdutos } = await pool.query(`
      SELECT 
        po.n_cod_ped,
        po.c_numero,
        po.c_cod_int_ped,
        po.c_obs,
        po.c_etapa,
        po.n_cod_for,
        po.d_inc_data,
        po.d_dt_previsao,
        cc.nome_fantasia AS fornecedor_nome,
        pop.c_produto,
        pop.c_descricao,
        pop.c_unidade,
        pop.n_qtde,
        pop.n_val_tot,
        pop.c_link_nfe_pdf,
        pop.c_dados_adicionais_nfe,
        po.created_at,
        po.updated_at,
        origem.solicitante,
        origem.grupo_requisicao
      FROM compras.pedidos_omie po
      LEFT JOIN omie.fornecedores cc ON cc.codigo_cliente_omie = po.n_cod_for
      LEFT JOIN compras.pedidos_omie_produtos pop ON pop.n_cod_ped = po.n_cod_ped
      LEFT JOIN LATERAL (
        SELECT src.solicitante, src.grupo_requisicao
        FROM (
          SELECT sc.solicitante, sc.grupo_requisicao, sc.created_at
          FROM compras.solicitacao_compras sc
          WHERE TRIM(COALESCE(po.c_cod_int_ped, '')) <> ''
            AND TRIM(COALESCE(sc.numero_pedido, '')) = TRIM(COALESCE(po.c_cod_int_ped, ''))
          UNION ALL
          SELECT csc.solicitante, csc.grupo_requisicao, csc.created_at
          FROM compras.compras_sem_cadastro csc
          WHERE TRIM(COALESCE(po.c_cod_int_ped, '')) <> ''
            AND TRIM(COALESCE(csc.numero_pedido, '')) = TRIM(COALESCE(po.c_cod_int_ped, ''))
        ) src
        ORDER BY src.created_at DESC NULLS LAST
        LIMIT 1
      ) origem ON TRUE
      WHERE po.c_etapa = '10'
        AND (po.inativo IS NULL OR po.inativo = false)
        AND COALESCE(BTRIM(po."Etapa_NF"), '') = ''
      ORDER BY
        CASE WHEN po.c_numero ~ '^\d+$' THEN po.c_numero::INT ELSE NULL END DESC,
        po.c_numero DESC
    `);
    
    console.log(`[Compras/PedidosCompra] Encontrados ${pedidosComProdutos.length} registros de pedidos com produtos`);

    // Agrupa os pedidos por c_numero preservando a ordem com Map
    const pedidosPorNumero = new Map();
    const pedidos = [];
    
    pedidosComProdutos.forEach(row => {
      const numero = row.c_numero || 'SEM_NUMERO';
      
      if (!pedidosPorNumero.has(numero)) {
        const novoPedido = {
          numero: numero,
          n_cod_ped: row.n_cod_ped,
          c_cod_int_ped: row.c_cod_int_ped, // Adiciona o código interno
          c_etapa: row.c_etapa,
          n_cod_for: row.n_cod_for,
          d_inc_data: row.d_inc_data,
          d_dt_previsao: row.d_dt_previsao,
          solicitante: row.solicitante,
          grupo_requisicao: row.grupo_requisicao,
          fornecedor_nome: row.fornecedor_nome || 'Sem fornecedor',
          created_at: row.created_at,
          updated_at: row.updated_at,
          itens: []
        };
        pedidosPorNumero.set(numero, novoPedido);
        pedidos.push(novoPedido);
      }
      
      // Adiciona produto se existir (evita duplicatas de pedidos sem produtos)
      if (row.c_produto) {
        pedidosPorNumero.get(numero).itens.push({
          produto_codigo: row.c_produto,
          produto_descricao: row.c_descricao || 'Sem descrição',
          c_unidade: row.c_unidade || '-',
          n_qtde: row.n_qtde || 0,
          n_val_tot: row.n_val_tot || 0,
          c_link_nfe_pdf: row.c_link_nfe_pdf || null,
          c_dados_adicionais_nfe: row.c_dados_adicionais_nfe || null
        });
      }
    });

    // Ordena array resultante do maior para o menor c_numero
    const parseNumero = valor => {
      const texto = (valor || '').toString().trim();
      return /^\d+$/.test(texto) ? parseInt(texto, 10) : null;
    };

    pedidos.sort((a, b) => {
      const numA = parseNumero(a.numero);
      const numB = parseNumero(b.numero);
      if (numA !== null && numB !== null) {
        return numB - numA;
      }
      if (numA !== null) return -1;
      if (numB !== null) return 1;
      return String(b.numero).localeCompare(String(a.numero));
    });
    
    console.log(`[Compras/PedidosCompra] Retornando ${pedidos.length} pedidos agrupados por número`);

    res.json({ ok: true, pedidos: pedidos });
  } catch (err) {
    console.error('[Compras/PedidosCompra] Erro ao listar pedidos:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar pedidos de compra' });
  }
});

// ========================================
//  Endpoint: Listar Compras Realizadas (c_etapa = '15')
// ========================================
/**
 * GET /api/compras/compras-realizadas
 * Retorna compras realizadas da tabela compras.pedidos_omie com c_etapa = '15'
 * Agrupa por c_numero (4 dígitos: 2232, 2205, etc.)
 * Inclui fornecedor e produtos
 */
app.get('/api/compras/compras-realizadas', async (req, res) => {
  try {
    console.log('[Compras/ComprasRealizadas] Listando compras realizadas (c_etapa = 15)...');

    const query = `
      SELECT 
        po.n_cod_ped,
        po.c_numero,
        po.c_cod_int_ped,
        po.c_obs,
        po.c_etapa,
        po.n_cod_for,
        po.d_inc_data,
        po.d_dt_previsao,
        cc.nome_fantasia AS fornecedor_nome,
        pop.c_produto,
        pop.c_descricao,
        pop.c_unidade,
        pop.n_qtde,
        pop.n_val_tot,
        pop.c_link_nfe_pdf,
        pop.c_dados_adicionais_nfe,
        po.created_at,
        po.updated_at,
        origem.solicitante,
        origem.grupo_requisicao
      FROM compras.pedidos_omie po
      LEFT JOIN omie.fornecedores cc
        ON cc.codigo_cliente_omie = po.n_cod_for
      LEFT JOIN compras.pedidos_omie_produtos pop
        ON pop.n_cod_ped = po.n_cod_ped
      LEFT JOIN LATERAL (
        SELECT src.solicitante, src.grupo_requisicao
        FROM (
          SELECT sc.solicitante, sc.grupo_requisicao, sc.created_at
          FROM compras.solicitacao_compras sc
          WHERE TRIM(COALESCE(po.c_cod_int_ped, '')) <> ''
            AND TRIM(COALESCE(sc.numero_pedido, '')) = TRIM(COALESCE(po.c_cod_int_ped, ''))
          UNION ALL
          SELECT csc.solicitante, csc.grupo_requisicao, csc.created_at
          FROM compras.compras_sem_cadastro csc
          WHERE TRIM(COALESCE(po.c_cod_int_ped, '')) <> ''
            AND TRIM(COALESCE(csc.numero_pedido, '')) = TRIM(COALESCE(po.c_cod_int_ped, ''))
        ) src
        ORDER BY src.created_at DESC NULLS LAST
        LIMIT 1
      ) origem ON TRUE
      WHERE po.c_etapa = '15'
        AND (po.inativo IS NULL OR po.inativo = false)
        AND COALESCE(BTRIM(po."Etapa_NF"), '') = ''
      ORDER BY
        CASE WHEN po.c_numero ~ '^\d+$' THEN po.c_numero::INT ELSE NULL END DESC,
        po.c_numero DESC
    `;

    const result = await pool.query(query);

    // Agrupa por c_numero preservando a ordem de chegada usando Map
    const pedidosPorNumero = new Map();
    const compras = [];

    for (const row of result.rows) {
      const numero = row.c_numero || 'SEM_NUMERO';

      if (!pedidosPorNumero.has(numero)) {
        const novaCompra = {
          numero: numero,
          n_cod_ped: row.n_cod_ped,
          c_cod_int_ped: row.c_cod_int_ped,
          c_obs: row.c_obs || null,
          is_nfe_obs: /^\s*nfe\s*:/i.test(String(row.c_obs || '')),
          c_etapa: row.c_etapa,
          n_cod_for: row.n_cod_for,
          d_inc_data: row.d_inc_data,
          d_dt_previsao: row.d_dt_previsao,
          solicitante: row.solicitante,
          grupo_requisicao: row.grupo_requisicao,
          fornecedor_nome: row.fornecedor_nome || 'Sem fornecedor',
          created_at: row.created_at,
          updated_at: row.updated_at,
          itens: []
        };
        pedidosPorNumero.set(numero, novaCompra);
        compras.push(novaCompra);
      }

      if (row.c_produto) {
        pedidosPorNumero.get(numero).itens.push({
          produto_codigo: row.c_produto,
          produto_descricao: row.c_descricao || 'Sem descrição',
          c_unidade: row.c_unidade || '-',
          n_qtde: row.n_qtde || 0,
          n_val_tot: row.n_val_tot || 0,
          c_link_nfe_pdf: row.c_link_nfe_pdf || null,
          c_dados_adicionais_nfe: row.c_dados_adicionais_nfe || null
        });
      }
    }

    // Reutiliza o mesmo helper para ordenar as compras
    const parseNumero = valor => {
      const texto = (valor || '').toString().trim();
      return /^\d+$/.test(texto) ? parseInt(texto, 10) : null;
    };

    compras.sort((a, b) => {
      const numA = parseNumero(a.numero);
      const numB = parseNumero(b.numero);
      if (numA !== null && numB !== null) {
        return numB - numA;
      }
      if (numA !== null) return -1;
      if (numB !== null) return 1;
      return String(b.numero).localeCompare(String(a.numero));
    });
    
    console.log(`[Compras/ComprasRealizadas] Retornando ${compras.length} compras agrupadas por número`);

    res.json({ ok: true, compras: compras });
  } catch (err) {
    console.error('[Compras/ComprasRealizadas] Erro ao listar compras:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar compras realizadas' });
  }
});

// ========================================
//  Endpoint: Listar Pedidos por Etapa_NF (40/50/60/80)
// ========================================
/**
 * GET /api/compras/pedidos-etapa-nf
 * Retorna pedidos da tabela compras.pedidos_omie com Etapa_NF preenchida:
 * - 40 -> faturada pelo fornecedor
 * - 50/60 -> recebido
 * - 80 -> concluído
 */
app.get('/api/compras/pedidos-etapa-nf', async (req, res) => {
  try {
    console.log('[Compras/PedidosEtapaNF] Listando pedidos por Etapa_NF (40/50/60/80)...');

    const query = `
      SELECT
        po.n_cod_ped,
        po.c_numero,
        po.c_cod_int_ped,
        po.c_etapa,
        po."Etapa_NF" AS etapa_nf,
        po.n_cod_for,
        po.d_inc_data,
        po.d_dt_previsao,
        cc.nome_fantasia AS fornecedor_nome,
        pop.c_produto,
        pop.c_descricao,
        pop.c_unidade,
        pop.n_qtde,
        pop.n_val_tot,
        pop.c_link_nfe_pdf,
        pop.c_dados_adicionais_nfe,
        po.created_at,
        po.updated_at,
        origem.solicitante,
        origem.grupo_requisicao
      FROM compras.pedidos_omie po
      LEFT JOIN omie.fornecedores cc
        ON cc.codigo_cliente_omie = po.n_cod_for
      LEFT JOIN compras.pedidos_omie_produtos pop
        ON pop.n_cod_ped = po.n_cod_ped
      LEFT JOIN LATERAL (
        SELECT src.solicitante, src.grupo_requisicao
        FROM (
          SELECT sc.solicitante, sc.grupo_requisicao, sc.created_at
          FROM compras.solicitacao_compras sc
          WHERE TRIM(COALESCE(po.c_cod_int_ped, '')) <> ''
            AND TRIM(COALESCE(sc.numero_pedido, '')) = TRIM(COALESCE(po.c_cod_int_ped, ''))
          UNION ALL
          SELECT csc.solicitante, csc.grupo_requisicao, csc.created_at
          FROM compras.compras_sem_cadastro csc
          WHERE TRIM(COALESCE(po.c_cod_int_ped, '')) <> ''
            AND TRIM(COALESCE(csc.numero_pedido, '')) = TRIM(COALESCE(po.c_cod_int_ped, ''))
        ) src
        ORDER BY src.created_at DESC NULLS LAST
        LIMIT 1
      ) origem ON TRUE
      WHERE (po.inativo IS NULL OR po.inativo = false)
        AND COALESCE(BTRIM(po."Etapa_NF"), '') IN ('40', '50', '60', '80')
      ORDER BY
        CASE WHEN po.c_numero ~ '^\\d+$' THEN po.c_numero::INT ELSE NULL END DESC,
        po.c_numero DESC
    `;

    const { rows } = await pool.query(query);
    const pedidosMap = new Map();
    const pedidos = [];

    const mapearStatusPorEtapaNf = (etapaNf) => {
      const etapa = String(etapaNf || '').trim();
      if (etapa === '40') return 'faturada pelo fornecedor';
      if (etapa === '50' || etapa === '60') return 'recebido';
      if (etapa === '80') return 'concluído';
      return null;
    };

    for (const row of rows) {
      const numero = row.c_numero || 'SEM_NUMERO';
      const statusNf = mapearStatusPorEtapaNf(row.etapa_nf);
      if (!statusNf) continue;

      const chavePedido = `${numero}::${statusNf}`;
      if (!pedidosMap.has(chavePedido)) {
        const novoPedido = {
          numero,
          n_cod_ped: row.n_cod_ped,
          c_cod_int_ped: row.c_cod_int_ped,
          c_etapa: row.c_etapa,
          etapa_nf: row.etapa_nf,
          status_nf: statusNf,
          n_cod_for: row.n_cod_for,
          d_inc_data: row.d_inc_data,
          d_dt_previsao: row.d_dt_previsao,
          solicitante: row.solicitante,
          grupo_requisicao: row.grupo_requisicao,
          fornecedor_nome: row.fornecedor_nome || 'Sem fornecedor',
          created_at: row.created_at,
          updated_at: row.updated_at,
          itens: []
        };
        pedidosMap.set(chavePedido, novoPedido);
        pedidos.push(novoPedido);
      }

      if (row.c_produto) {
        pedidosMap.get(chavePedido).itens.push({
          produto_codigo: row.c_produto,
          produto_descricao: row.c_descricao || 'Sem descrição',
          c_unidade: row.c_unidade || '-',
          n_qtde: row.n_qtde || 0,
          n_val_tot: row.n_val_tot || 0,
          c_link_nfe_pdf: row.c_link_nfe_pdf || null,
          c_dados_adicionais_nfe: row.c_dados_adicionais_nfe || null
        });
      }
    }

    const parseNumero = valor => {
      const texto = (valor || '').toString().trim();
      return /^\d+$/.test(texto) ? parseInt(texto, 10) : null;
    };

    pedidos.sort((a, b) => {
      const numA = parseNumero(a.numero);
      const numB = parseNumero(b.numero);
      if (numA !== null && numB !== null) return numB - numA;
      if (numA !== null) return -1;
      if (numB !== null) return 1;
      return String(b.numero).localeCompare(String(a.numero));
    });

    console.log(`[Compras/PedidosEtapaNF] Retornando ${pedidos.length} pedidos agrupados`);
    res.json({ ok: true, pedidos });
  } catch (err) {
    console.error('[Compras/PedidosEtapaNF] Erro ao listar pedidos por Etapa_NF:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar pedidos por Etapa_NF' });
  }
});

// ========================================
//  DEBUG: GET /api/compras/debug/grupo-requisicao/:valor
// ========================================
app.get('/api/compras/debug/grupo-requisicao/:valor', async (req, res) => {
  try {
    const { valor } = req.params;
    console.log('[DEBUG] Buscando grupo_requisicao:', valor);
    
    const { rows: solicitRows } = await pool.query(
      `SELECT * FROM compras.solicitacao_compras WHERE grupo_requisicao = $1 LIMIT 3`,
      [valor]
    );
    
    const { rows: semCadRows } = await pool.query(
      `SELECT * FROM compras.compras_sem_cadastro WHERE grupo_requisicao = $1 OR CAST(id AS TEXT) = $1 LIMIT 3`,
      [valor]
    );
    
    res.json({
      valor,
      solicitacao_compras: solicitRows.length,
      solicitacao_compras_data: solicitRows,
      compras_sem_cadastro: semCadRows.length,
      compras_sem_cadastro_data: semCadRows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
//  Endpoint: GET /api/compras/pedido-detalhes/:nCodPed
// ========================================
/**
 * Objetivo: Retornar detalhes de um pedido de compra com informações de solicitante, departamento, centro de custo e objetivo
 * baseado na lógica do c_cod_int_ped
 */
app.get('/api/compras/pedido-detalhes/:nCodPed', async (req, res) => {
  try {
    const { nCodPed } = req.params;
    const nCodPedInt = parseInt(nCodPed, 10);
    
    console.log('[PedidoDetalhes] Buscando n_cod_ped:', nCodPedInt);
    
    // Busca o pedido
    const { rows: pedidoRows } = await pool.query(
      'SELECT n_cod_ped, c_cod_int_ped, d_inc_data, d_dt_previsao, created_at, n_cod_for FROM compras.pedidos_omie WHERE n_cod_ped = $1',
      [nCodPedInt]
    );
    
    if (pedidoRows.length === 0) {
      console.log('[PedidoDetalhes] Pedido não encontrado:', nCodPedInt);
      return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    }
    
    const pedido = pedidoRows[0];
    const cCodIntPed = (pedido.c_cod_int_ped || '').toString().trim();
    
    console.log('[PedidoDetalhes] Pedido encontrado:', { n_cod_ped: pedido.n_cod_ped, c_cod_int_ped: cCodIntPed });
    
    // Busca o nome do fornecedor usando n_cod_for
    let fornecedorNome = 'Sem fornecedor';
    if (pedido.n_cod_for) {
      console.log('[PedidoDetalhes] Buscando fornecedor com codigo_cliente_omie:', pedido.n_cod_for);
      const { rows: fornecedorRows } = await pool.query(
        `SELECT nome_fantasia FROM omie.fornecedores WHERE codigo_cliente_omie = $1 LIMIT 1`,
        [pedido.n_cod_for]
      );
      if (fornecedorRows.length > 0) {
        fornecedorNome = fornecedorRows[0].nome_fantasia || 'Sem fornecedor';
        console.log('[PedidoDetalhes] Fornecedor encontrado:', fornecedorNome);
      } else {
        // Fallback: usa o código como referência
        console.log('[PedidoDetalhes] Fornecedor não encontrado para codigo:', pedido.n_cod_for);
        fornecedorNome = `Fornecedor ID: ${pedido.n_cod_for}`;
      }
    }
    
    // Busca os produtos/itens do pedido
    console.log('[PedidoDetalhes] Buscando itens para n_cod_ped:', nCodPedInt);
    const { rows: produtosRows } = await pool.query(
      `SELECT c_produto, c_descricao, n_qtde FROM compras.pedidos_omie_produtos 
       WHERE n_cod_ped = $1
       ORDER BY id ASC`,
      [nCodPedInt]
    );
    
    console.log('[PedidoDetalhes] Encontrados', produtosRows.length, 'produtos');
    
    const itens = produtosRows.map(row => ({
      produto_codigo: row.c_produto,
      produto_descricao: row.c_descricao,
      quantidade: row.n_qtde || '-'
    }));
    
    let solicitante = '-';
    let departamento = '-';
    let centroCusto = '-';
    let objetivoCompra = '-';
    
    if (cCodIntPed === '' || cCodIntPed === 'null') {
      // Vazio = Realizado na omie
      console.log('[PedidoDetalhes] c_cod_int_ped vazio - Realizado na omie');
      solicitante = 'Realizado na omie';
    } else if (cCodIntPed.startsWith('REQ')) {
      // Começa com REQ = Realizado em app externo
      console.log('[PedidoDetalhes] c_cod_int_ped começa com REQ - Realizado em app externo');
      solicitante = 'Realizado em app externo';
    } else {
      // Objetivo: Buscar em solicitacao_compras usando numero_pedido = c_cod_int_ped
      // O c_cod_int_ped contém o identificador único que foi armazenado como numero_pedido
      console.log('[PedidoDetalhes] Procurando em solicitacao_compras com numero_pedido:', cCodIntPed);
      const { rows: solicitRows } = await pool.query(
        `SELECT solicitante, departamento, centro_custo, objetivo_compra 
         FROM compras.solicitacao_compras 
         WHERE numero_pedido = $1 
         LIMIT 1`,
        [cCodIntPed]
      );
      
      if (solicitRows.length > 0) {
        console.log('[PedidoDetalhes] Encontrado em solicitacao_compras por numero_pedido');
        solicitante = solicitRows[0].solicitante || '-';
        departamento = solicitRows[0].departamento || '-';
        centroCusto = solicitRows[0].centro_custo || '-';
        objetivoCompra = solicitRows[0].objetivo_compra || '-';
      } else {
        // Fallback: Procurar por grupo_requisicao
        console.log('[PedidoDetalhes] Não encontrado por numero_pedido, tentando grupo_requisicao');
        const { rows: solicitRows2 } = await pool.query(
          `SELECT solicitante, departamento, centro_custo, objetivo_compra 
           FROM compras.solicitacao_compras 
           WHERE grupo_requisicao = $1 
           LIMIT 1`,
          [cCodIntPed]
        );
        
        if (solicitRows2.length > 0) {
          console.log('[PedidoDetalhes] Encontrado em solicitacao_compras por grupo_requisicao');
          solicitante = solicitRows2[0].solicitante || '-';
          departamento = solicitRows2[0].departamento || '-';
          centroCusto = solicitRows2[0].centro_custo || '-';
          objetivoCompra = solicitRows2[0].objetivo_compra || '-';
        } else {
          // Fallback: Procurar em compras_sem_cadastro
          console.log('[PedidoDetalhes] Não encontrado em solicitacao_compras, procurando em compras_sem_cadastro');
          const { rows: semCadastroRows } = await pool.query(
            `SELECT solicitante, departamento, centro_custo, objetivo_compra 
             FROM compras.compras_sem_cadastro 
             WHERE CAST(grupo_requisicao AS TEXT) = $1 OR CAST(id AS TEXT) = $1
             LIMIT 1`,
            [cCodIntPed]
          );
          
          if (semCadastroRows.length > 0) {
            console.log('[PedidoDetalhes] Encontrado em compras_sem_cadastro');
            solicitante = semCadastroRows[0].solicitante || '-';
            departamento = semCadastroRows[0].departamento || '-';
            centroCusto = semCadastroRows[0].centro_custo || '-';
            objetivoCompra = semCadastroRows[0].objetivo_compra || '-';
          } else {
            // Se nenhum match, marcar como "Realizado na Omie" (sem requisição)
            console.log('[PedidoDetalhes] Nenhuma correspondência encontrada - marcando como criado na Omie');
            solicitante = 'Criado direto na Omie (sem requisição)';
          }
        }
      }
    }
    
    res.json({
      ok: true,
      solicitante,
      departamento,
      centroCusto,
      objetivoCompra,
      fornecedorNome,
      d_inc_data: pedido.d_inc_data,
      d_dt_previsao: pedido.d_dt_previsao,
      createdAt: pedido.created_at,
      itens: itens
    });
  } catch (err) {
    console.error('[Compras/PedidoDetalhes] Erro:', err);
    res.status(500).json({ ok: false, error: 'Erro ao buscar detalhes do pedido' });
  }
});

function parseValorDecimalNfe(valor) {
  const texto = String(valor || '').trim().replace(/\u00A0/g, ' ');
  if (!texto) return NaN;
  const semMoeda = texto.replace(/[R$\s]/g, '');
  if (!semMoeda) return NaN;

  if (semMoeda.includes(',') && semMoeda.includes('.')) {
    if (semMoeda.lastIndexOf(',') > semMoeda.lastIndexOf('.')) {
      return Number(semMoeda.replace(/\./g, '').replace(',', '.'));
    }
    return Number(semMoeda.replace(/,/g, ''));
  }

  if (semMoeda.includes(',')) {
    return Number(semMoeda.replace(/\./g, '').replace(',', '.'));
  }

  return Number(semMoeda);
}

function extrairPedidoDosDadosAdicionaisNfe(texto) {
  const conteudo = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!conteudo) return null;
  const match = conteudo.match(/(^|[^a-z0-9])(n\s*)?pedido[a-z]*[^0-9]*([0-9]{2,})/i);
  return match ? String(match[3]).trim() : null;
}

async function localizarRecebimentoNfePorPedidoValor(numeroPedidoRaw, valorTotalRaw) {
  const numeroPedido = String(numeroPedidoRaw || '').trim();
  if (!numeroPedido) {
    return { ok: false, error: 'Parâmetro numero_pedido é obrigatório' };
  }

  const valorTotal = parseValorDecimalNfe(valorTotalRaw);
  if (!Number.isFinite(valorTotal) || valorTotal <= 0) {
    return { ok: false, error: 'Parâmetro valor_total inválido' };
  }

  const pedidoResult = await pool.query(
    `SELECT n_cod_ped, n_cod_for, c_numero
       FROM compras.pedidos_omie
      WHERE TRIM(COALESCE(c_numero, '')) = TRIM($1)
        AND (inativo IS NULL OR inativo = false)
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, n_cod_ped DESC
      LIMIT 1`,
    [numeroPedido]
  );

  if (pedidoResult.rows.length === 0) {
    return { ok: false, error: 'Pedido não encontrado em compras.pedidos_omie' };
  }

  const pedido = pedidoResult.rows[0];
  const codFornecedor = pedido.n_cod_for;
  if (!codFornecedor) {
    return { ok: false, error: 'Pedido encontrado sem n_cod_for' };
  }

  const recebimentosResult = await pool.query(
    `SELECT n_id_receb, c_numero_nfe, n_valor_nfe, c_dados_adicionais, d_emissao_nfe, created_at
       FROM logistica.recebimentos_nfe_omie
      WHERE n_id_fornecedor = $1
        AND c_numero_nfe IS NOT NULL
        AND TRIM(c_numero_nfe) <> ''
        AND n_valor_nfe IS NOT NULL
        AND ABS(n_valor_nfe::numeric - $2::numeric) < 0.01
      ORDER BY d_emissao_nfe DESC NULLS LAST, created_at DESC NULLS LAST, n_id_receb DESC`,
    [codFornecedor, valorTotal]
  );

  let recebimentos = recebimentosResult.rows.map((row) => ({
    ...row,
    pedido_extraido: extrairPedidoDosDadosAdicionaisNfe(row.c_dados_adicionais)
  }));

  if (recebimentos.length === 0) {
    const fallbackResult = await pool.query(
      `SELECT n_id_receb, c_numero_nfe, n_valor_nfe, c_dados_adicionais, d_emissao_nfe, created_at
         FROM logistica.recebimentos_nfe_omie
        WHERE n_id_fornecedor = $1
          AND c_numero_nfe IS NOT NULL
          AND TRIM(c_numero_nfe) <> ''
        ORDER BY d_emissao_nfe DESC NULLS LAST, created_at DESC NULLS LAST, n_id_receb DESC
        LIMIT 300`,
      [codFornecedor]
    );

    recebimentos = fallbackResult.rows
      .map((row) => ({
        ...row,
        pedido_extraido: extrairPedidoDosDadosAdicionaisNfe(row.c_dados_adicionais)
      }))
      .filter((row) => row.pedido_extraido === numeroPedido);
  }

  if (recebimentos.length === 0) {
    return {
      ok: false,
      error: 'Nenhum recebimento encontrado para este fornecedor (valor/pedido)'
    };
  }

  let recebimentoSelecionado = recebimentos[0];

  if (recebimentos.length > 1) {
    const pedidosExtraidos = [...new Set(recebimentos.map(r => r.pedido_extraido).filter(Boolean))];
    const pedidosValidos = new Set();

    if (pedidosExtraidos.length > 0) {
      const pedidosValidosResult = await pool.query(
        `SELECT DISTINCT TRIM(COALESCE(c_numero, '')) AS c_numero
           FROM compras.pedidos_omie
          WHERE TRIM(COALESCE(c_numero, '')) = ANY($1::text[])
            AND n_cod_for = $2
            AND (inativo IS NULL OR inativo = false)`,
        [pedidosExtraidos, codFornecedor]
      );

      pedidosValidosResult.rows.forEach((row) => {
        const numero = String(row.c_numero || '').trim();
        if (numero) pedidosValidos.add(numero);
      });
    }

    const candidatosMesmoPedido = recebimentos.filter((row) => (
      row.pedido_extraido
      && row.pedido_extraido === numeroPedido
      && pedidosValidos.has(row.pedido_extraido)
    ));

    if (candidatosMesmoPedido.length > 0) {
      recebimentoSelecionado = candidatosMesmoPedido[0];
    }
  }

  const numeroNfeRaw = String(recebimentoSelecionado.c_numero_nfe || '').trim();
  const numeroNfeDigitos = numeroNfeRaw.replace(/\D/g, '');
  if (!numeroNfeDigitos) {
    return { ok: false, error: 'Recebimento encontrado sem c_numero_nfe válido' };
  }

  return {
    ok: true,
    numero_pedido: numeroPedido,
    valor_total: Number(valorTotal.toFixed(2)),
    n_cod_for: codFornecedor,
    n_id_receb: recebimentoSelecionado.n_id_receb,
    c_numero_nfe: numeroNfeRaw,
    numero_nfe_digitos: numeroNfeDigitos
  };
}

async function obterPdfNfeViaOmie(numeroNfeDigitos) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    return { ok: false, error: 'Credenciais Omie não configuradas no servidor' };
  }

  const possiveisNNf = [
    numeroNfeDigitos.padStart(9, '0'),
    numeroNfeDigitos,
    String(parseInt(numeroNfeDigitos, 10))
  ].filter((v) => v && v !== 'NaN');
  const nNfUnicos = [...new Set(possiveisNNf)];

  let nIdNf = null;
  let ultimaFalhaConsulta = '';

  for (const nNf of nNfUnicos) {
    const consultaResp = await fetch('https://app.omie.com.br/api/v1/produtos/nfconsultar/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ConsultarNF',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ nNF: nNf }]
      })
    });

    const consultaData = await consultaResp.json().catch(() => ({}));
    const faultConsulta = consultaData?.faultstring || consultaData?.faultcode || '';

    if (!consultaResp.ok || faultConsulta) {
      ultimaFalhaConsulta = faultConsulta || `HTTP ${consultaResp.status}`;
      continue;
    }

    const nIdNFConsulta = consultaData?.compl?.nIdNF
      || consultaData?.compl?.nIdNf
      || consultaData?.nIdNF
      || consultaData?.nIdNfe;

    if (!nIdNFConsulta) {
      ultimaFalhaConsulta = 'Resposta da Omie sem compl.nIdNF';
      continue;
    }

    nIdNf = Number(nIdNFConsulta);
    break;
  }

  if (!Number.isFinite(nIdNf) || nIdNf <= 0) {
    return { ok: false, error: `Não foi possível localizar nIdNF. ${ultimaFalhaConsulta || ''}`.trim() };
  }

  const obterNfeResp = await fetch('https://app.omie.com.br/api/v1/produtos/dfedocs/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ObterNfe',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{ nIdNfe: nIdNf }]
    })
  });

  const obterNfeData = await obterNfeResp.json().catch(() => ({}));
  const faultObter = obterNfeData?.faultstring || obterNfeData?.faultcode || '';
  if (!obterNfeResp.ok || faultObter) {
    return {
      ok: false,
      error: faultObter || `Erro HTTP ${obterNfeResp.status} ao obter XML/PDF da NF`
    };
  }

  const cPdf = String(obterNfeData?.cPdf || '').trim();
  if (!/^https?:\/\//i.test(cPdf)) {
    return { ok: false, error: 'Link cPdf não encontrado na resposta da Omie' };
  }

  return { ok: true, cPdf, n_id_nfe: nIdNf };
}

// POST /api/compras/pedidos-omie/nfe-disponibilidade
// Objetivo: validar em lote apenas no banco se existe c_numero_nfe para cada pedido/valor (sem chamar Omie).
app.post('/api/compras/pedidos-omie/nfe-disponibilidade', express.json(), async (req, res) => {
  try {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens.slice(0, 400) : [];
    if (itens.length === 0) {
      return res.json({ ok: true, resultados: [] });
    }

    const chavesVistas = new Set();
    const itensUnicos = [];
    for (const item of itens) {
      const numeroPedido = String(item?.numero_pedido || '').trim();
      const valorTotal = parseValorDecimalNfe(item?.valor_total);
      if (!numeroPedido || !Number.isFinite(valorTotal) || valorTotal <= 0) continue;

      const chave = `${numeroPedido}|${Number(valorTotal.toFixed(2))}`;
      if (chavesVistas.has(chave)) continue;
      chavesVistas.add(chave);
      itensUnicos.push({
        chave,
        numeroPedido,
        valorTotal: Number(valorTotal.toFixed(2))
      });
    }

    const resultados = [];
    const concorrencia = 8;
    for (let i = 0; i < itensUnicos.length; i += concorrencia) {
      const lote = itensUnicos.slice(i, i + concorrencia);
      const loteResultados = await Promise.all(lote.map(async (item) => {
        const localizacao = await localizarRecebimentoNfePorPedidoValor(item.numeroPedido, item.valorTotal);
        return {
          chave: item.chave,
          numero_pedido: item.numeroPedido,
          valor_total: item.valorTotal,
          disponivel: !!localizacao?.ok,
          c_numero_nfe: localizacao?.ok ? localizacao.c_numero_nfe : null,
          erro: localizacao?.ok ? null : (localizacao?.error || 'Não encontrado')
        };
      }));
      resultados.push(...loteResultados);
    }

    res.json({ ok: true, resultados });
  } catch (err) {
    console.error('[Compras/NFeDisponibilidade] Erro:', err);
    res.status(500).json({ ok: false, error: 'Erro ao verificar disponibilidade de NF-e' });
  }
});

// GET /api/compras/pedidos-omie/nfe-pdf-link
// Objetivo: gerar cPdf da NF-e apenas no clique (chamada à Omie).
app.get('/api/compras/pedidos-omie/nfe-pdf-link', async (req, res) => {
  try {
    const numeroPedido = String(req.query.numero_pedido || '').trim();
    const valorTotalRaw = String(req.query.valor_total || '').trim();

    const localizacao = await localizarRecebimentoNfePorPedidoValor(numeroPedido, valorTotalRaw);
    if (!localizacao?.ok) {
      return res.json({ ok: false, error: localizacao?.error || 'Não foi possível localizar NF-e' });
    }

    const omieResult = await obterPdfNfeViaOmie(localizacao.numero_nfe_digitos);
    if (!omieResult?.ok) {
      return res.json({ ok: false, error: omieResult?.error || 'Falha ao consultar Omie' });
    }

    res.json({
      ok: true,
      cPdf: omieResult.cPdf,
      numero_pedido: localizacao.numero_pedido,
      c_numero_nfe: localizacao.c_numero_nfe,
      n_id_nfe: omieResult.n_id_nfe,
      n_id_receb: localizacao.n_id_receb
    });
  } catch (err) {
    console.error('[Compras/NFePdfLink] Erro:', err);
    res.status(500).json({ ok: false, error: 'Erro ao gerar link do PDF da NF-e' });
  }
});

// GET /api/compras/pedidos-omie/nfe-pdf-redirect
// Objetivo: abrir o PDF diretamente via âncora (<a>) sem janela about:blank.
app.get('/api/compras/pedidos-omie/nfe-pdf-redirect', async (req, res) => {
  try {
    const numeroPedido = String(req.query.numero_pedido || '').trim();
    const valorTotalRaw = String(req.query.valor_total || '').trim();

    const localizacao = await localizarRecebimentoNfePorPedidoValor(numeroPedido, valorTotalRaw);
    if (!localizacao?.ok) {
      return res.status(404).send(localizacao?.error || 'NF-e não encontrada');
    }

    const omieResult = await obterPdfNfeViaOmie(localizacao.numero_nfe_digitos);
    if (!omieResult?.ok) {
      return res.status(404).send(omieResult?.error || 'PDF da NF-e não encontrado');
    }

    return res.redirect(302, omieResult.cPdf);
  } catch (err) {
    console.error('[Compras/NFePdfRedirect] Erro:', err);
    return res.status(500).send('Erro ao abrir PDF da NF-e');
  }
});

// POST /api/compras/requisicoes/sincronizar - Sincroniza requisições pendentes (atualiza numero)
app.post('/api/compras/requisicoes/sincronizar', async (req, res) => {
  try {
    console.log('[Compras/Requisições/Sync] Iniciando sincronização de requisições...');
    
    // Busca requisições sem numero
    const { rows: requisicoesSemNumero } = await pool.query(`
      SELECT cod_req_compra, cod_int_req_compra
      FROM compras.requisicoes_omie
      WHERE inativo = false AND numero IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `);
    
    console.log(`[Compras/Requisições/Sync] Encontradas ${requisicoesSemNumero.length} requisições sem numero`);
    
    let sucessos = 0;
    let erros = 0;
    
    // Para cada requisição, busca dados completos da API
    for (const req of requisicoesSemNumero) {
      try {
        const param = { codReqCompra: parseInt(req.cod_req_compra) };
        
        const response = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'ConsultarReq',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [param]
          })
        });
        
        if (!response.ok) {
          console.error(`[Compras/Requisições/Sync] Erro na API para ${req.cod_req_compra}: ${response.status}`);
          erros++;
          continue;
        }
        
        const data = await response.json();
        const reqData = data?.requisicaoCadastro || {};
        
        // Atualiza apenas o campo numero se encontrado
        if (reqData.cNumero) {
          await pool.query(`
            UPDATE compras.requisicoes_omie
            SET numero = $1, updated_at = NOW()
            WHERE cod_req_compra = $2
          `, [reqData.cNumero, req.cod_req_compra]);
          
          console.log(`[Compras/Requisições/Sync] ✓ Requisição ${req.cod_req_compra} atualizada com numero: ${reqData.cNumero}`);
          sucessos++;
        } else {
          console.log(`[Compras/Requisições/Sync] ⚠ Requisição ${req.cod_req_compra} não tem cNumero na API`);
        }
        
        // Delay para não sobrecarregar API da Omie
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (err) {
        console.error(`[Compras/Requisições/Sync] Erro ao processar ${req.cod_req_compra}:`, err);
        erros++;
      }
    }
    
    console.log(`[Compras/Requisições/Sync] Sincronização concluída: ${sucessos} sucessos, ${erros} erros`);
    
    res.json({ 
      ok: true, 
      total: requisicoesSemNumero.length,
      sucessos,
      erros,
      message: `Sincronizadas ${sucessos} de ${requisicoesSemNumero.length} requisições`
    });
    
  } catch (err) {
    console.error('[Compras/Requisições/Sync] Erro na sincronização:', err);
    res.status(500).json({ ok: false, error: 'Erro ao sincronizar requisições' });
  }
});

// POST /api/compras/requisicoes/sincronizar-itens - Reprocessa requisições sem itens
app.post('/api/compras/requisicoes/sincronizar-itens', async (req, res) => {
  try {
    console.log('[Compras/Requisições/SyncItens] Iniciando sincronização de itens...');
    
    // Busca requisições sem itens
    const { rows: requisicoesSemItens } = await pool.query(`
      SELECT ro.cod_req_compra, ro.cod_int_req_compra, ro.created_at
      FROM compras.requisicoes_omie ro
      WHERE ro.inativo = false
        AND NOT EXISTS (
          SELECT 1 FROM compras.requisicoes_omie_itens roi 
          WHERE roi.cod_req_compra = ro.cod_req_compra
        )
      ORDER BY ro.created_at DESC
      LIMIT 10
    `);
    
    console.log(`[Compras/Requisições/SyncItens] Encontradas ${requisicoesSemItens.length} requisições sem itens`);
    
    let sucessos = 0;
    let erros = 0;
    let semItensNaApi = 0;
    
    // Para cada requisição, busca dados completos da API
    for (const req of requisicoesSemItens) {
      try {
        const param = { codReqCompra: parseInt(req.cod_req_compra) };
        
        console.log(`[Compras/Requisições/SyncItens] Buscando itens da requisição ${req.cod_req_compra}...`);
        
        const response = await fetch('https://app.omie.com.br/api/v1/produtos/requisicaocompra/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'ConsultarReq',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [param]
          })
        });
        
        if (!response.ok) {
          console.error(`[Compras/Requisições/SyncItens] Erro na API para ${req.cod_req_compra}: ${response.status}`);
          erros++;
          continue;
        }
        
        const data = await response.json();
        const itens = data?.requisicaoCadastro?.ItensReqCompra 
                   || data?.requisicaoCadastro?.itens_req_compra 
                   || data?.ItensReqCompra 
                   || data?.itens_req_compra 
                   || [];
        
        // Se encontrou itens, insere no banco
        if (itens && itens.length > 0) {
          console.log(`[Compras/Requisições/SyncItens] 📦 ${itens.length} itens encontrados para requisição ${req.cod_req_compra}`);
          
          // Insere cada item
          for (const item of itens) {
            await pool.query(`
              INSERT INTO compras.requisicoes_omie_itens (
                cod_req_compra, cod_item, cod_int_item,
                cod_prod, cod_int_prod, qtde, preco_unit, obs_item
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT DO NOTHING
            `, [
              req.cod_req_compra,
              item.codItem || item.cod_item || null,
              item.codIntItem || item.cod_int_item || null,
              item.codProd || item.cod_prod || null,
              item.codIntProd || item.cod_int_prod || null,
              item.qtde || item.qtde_item || null,
              item.precoUnit || item.preco_unit || null,
              item.obsItem || item.obs_item || null
            ]);
          }
          
          console.log(`[Compras/Requisições/SyncItens] ✓ Requisição ${req.cod_req_compra} atualizada com ${itens.length} itens`);
          sucessos++;
        } else {
          console.log(`[Compras/Requisições/SyncItens] ⚠ Requisição ${req.cod_req_compra} não tem itens na API da Omie`);
          semItensNaApi++;
        }
        
        // Delay para não sobrecarregar API da Omie
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (err) {
        console.error(`[Compras/Requisições/SyncItens] Erro ao processar ${req.cod_req_compra}:`, err);
        erros++;
      }
    }
    
    console.log(`[Compras/Requisições/SyncItens] Sincronização concluída: ${sucessos} com itens, ${semItensNaApi} sem itens na API, ${erros} erros`);
    
    res.json({ 
      ok: true, 
      total: requisicoesSemItens.length,
      sucessos,
      semItensNaApi,
      erros,
      message: `Processadas ${requisicoesSemItens.length} requisições: ${sucessos} atualizadas, ${semItensNaApi} sem itens na API`
    });
    
  } catch (err) {
    console.error('[Compras/Requisições/SyncItens] Erro na sincronização:', err);
    res.status(500).json({ ok: false, error: 'Erro ao sincronizar itens de requisições' });
  }
});

// PUT /api/compras/item/:id - Atualiza uma solicitação individual
app.put('/api/compras/item/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const { status, previsao_chegada, observacao, resp_inspecao_recebimento, responsavel_pela_compra, fornecedor_nome, fornecedor_id, categoria_compra, categoria_compra_codigo, anexos, cod_parc, qtde_parc, contato, contrato, obs_interna, cotacoes_aprovadas_ids } = req.body || {};
    
    const allowedStatus = [
      'pendente',
      'aguardando aprovação',
      'aguardando compra',
      'aguardando cotação',
      'cotado',
      'compra realizada',
      'faturada pelo fornecedor',
      'aguardando liberação',
      'compra cancelada',
      'recebido'
    ];

    const fields = [];
    const values = [];
    let idx = 1;
    
    // Processa anexos se houver
    let anexosUrls = null;
    if (anexos && Array.isArray(anexos) && anexos.length > 0) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
        
        if (!supabaseUrl || !supabaseKey) {
          console.error('[Supabase] Credenciais não configuradas');
          throw new Error('Supabase não configurado');
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        anexosUrls = [];
        
        for (const anexo of anexos) {
          const buffer = Buffer.from(anexo.base64, 'base64');
          const filePath = `item_${id}/${Date.now()}_${anexo.nome}`;
          
          const { data, error } = await supabase.storage
            .from('compras-anexos')
            .upload(filePath, buffer, {
              contentType: anexo.tipo,
              upsert: false
            });
          
          if (!error) {
            const { data: publicData } = supabase.storage
              .from('compras-anexos')
              .getPublicUrl(filePath);
            
            anexosUrls.push({
              nome: anexo.nome,
              url: publicData.publicUrl,
              tipo: anexo.tipo,
              tamanho: anexo.tamanho
            });
          }
        }
        
        if (anexosUrls.length > 0) {
          fields.push(`anexos = $${idx++}`);
          values.push(JSON.stringify(anexosUrls));
        }
      } catch (uploadErr) {
        console.error('[Compras] Erro ao fazer upload de anexos:', uploadErr);
      }
    }

    if (status) {
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ ok: false, error: 'Status inválido' });
      }
      fields.push(`status = $${idx++}`);
      values.push(status);
    }

    if (typeof previsao_chegada !== 'undefined') {
      fields.push(`previsao_chegada = $${idx++}`);
      values.push(previsao_chegada || null);
    }

    if (typeof observacao !== 'undefined') {
      fields.push(`observacao = $${idx++}`);
      values.push(observacao || null);
    }

    if (typeof resp_inspecao_recebimento !== 'undefined') {
      fields.push(`resp_inspecao_recebimento = $${idx++}`);
      values.push(resp_inspecao_recebimento || null);
    }
    
    if (typeof responsavel_pela_compra !== 'undefined') {
      fields.push(`responsavel_pela_compra = $${idx++}`);
      values.push(responsavel_pela_compra || null);
    }
    
    if (typeof fornecedor_nome !== 'undefined') {
      fields.push(`fornecedor_nome = $${idx++}`);
      values.push(fornecedor_nome || null);
    }
    
    if (typeof fornecedor_id !== 'undefined') {
      fields.push(`fornecedor_id = $${idx++}`);
      values.push(fornecedor_id || null);
    }
    
    if (typeof categoria_compra !== 'undefined') {
      fields.push(`categoria_compra = $${idx++}`);
      values.push(categoria_compra || null);
    }
    
    if (typeof categoria_compra_codigo !== 'undefined') {
      fields.push(`categoria_compra_codigo = $${idx++}`);
      values.push(categoria_compra_codigo || null);
    }
    
    // Novos campos do PedidoCompraJsonClient
    if (typeof cod_parc !== 'undefined') {
      fields.push(`cod_parc = $${idx++}`);
      values.push(cod_parc || null);
    }
    
    if (typeof qtde_parc !== 'undefined') {
      fields.push(`qtde_parc = $${idx++}`);
      values.push(qtde_parc || null);
    }
    
    if (typeof contato !== 'undefined') {
      fields.push(`contato = $${idx++}`);
      values.push(contato || null);
    }
    
    if (typeof contrato !== 'undefined') {
      fields.push(`contrato = $${idx++}`);
      values.push(contrato || null);
    }
    
    if (typeof obs_interna !== 'undefined') {
      fields.push(`obs_interna = $${idx++}`);
      values.push(obs_interna || null);
    }

    if (!fields.length) {
      return res.status(400).json({ ok: false, error: 'Nada para atualizar' });
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const sql = `
      UPDATE compras.solicitacao_compras
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const { rows } = await pool.query(sql, values);
    
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Solicitação não encontrada' });
    }

    // Se recebeu cotacoes_aprovadas_ids, atualiza o status_aprovacao das cotações
    if (cotacoes_aprovadas_ids && Array.isArray(cotacoes_aprovadas_ids) && cotacoes_aprovadas_ids.length > 0) {
      console.log(`[Compras] Atualizando status de aprovação das cotações do item ${id}:`, cotacoes_aprovadas_ids);
      
      try {
        // Marca as cotações aprovadas com status_aprovacao = 'aprovado'
        await pool.query(`
          UPDATE compras.cotacoes 
          SET status_aprovacao = 'aprovado', atualizado_em = NOW()
          WHERE id = ANY($1::int[]) AND solicitacao_id = $2
        `, [cotacoes_aprovadas_ids, id]);
        
        // Marca as outras cotações do mesmo item como 'reprovado'
        await pool.query(`
          UPDATE compras.cotacoes 
          SET status_aprovacao = 'reprovado', atualizado_em = NOW()
          WHERE id != ALL($1::int[]) AND solicitacao_id = $2
        `, [cotacoes_aprovadas_ids, id]);
        
        console.log(`[Compras] Status de aprovação atualizado com sucesso para item ${id}`);
      } catch (cotacaoErr) {
        console.error('[Compras] Erro ao atualizar status das cotações:', cotacaoErr);
        // Não falha a requisição se erro ao atualizar cotações
      }
    }

    res.json({ ok: true, solicitacao: rows[0] });
  } catch (err) {
    console.error('[Compras] Erro ao atualizar item:', err);
    res.status(500).json({ ok: false, error: 'Erro ao atualizar solicitação' });
  }
});

// ========== ENDPOINTS DE COTAÇÕES ==========

// POST /api/compras/cotacoes - Adiciona uma cotação de fornecedor
app.post('/api/compras/cotacoes', express.json(), async (req, res) => {
  try {
    // Objetivo: Aceitar cotações de ambas as tabelas (solicitacao_compras e compras_sem_cadastro)
    const { solicitacao_id, fornecedor_nome, fornecedor_id, valor_cotado, observacao, anexos, link, criado_por, table_source, moeda, itens_cotacao } = req.body || {};
        const normalizarLinksCotacao = (valor) => {
          if (Array.isArray(valor)) {
            return valor
              .map(v => String(v || '').trim())
              .filter(Boolean);
          }
          if (typeof valor === 'string') {
            const texto = valor.trim();
            if (!texto) return [];
            try {
              const parsed = JSON.parse(texto);
              if (Array.isArray(parsed)) {
                return parsed
                  .map(v => String(v || '').trim())
                  .filter(Boolean);
              }
            } catch (e) {
              // mantém fluxo para string simples
            }
            return [texto];
          }
          return [];
        };

        const linksCotacao = normalizarLinksCotacao(link);
        const linkParaSalvar = linksCotacao.length > 0 ? JSON.stringify(linksCotacao) : null;

    
    if (!solicitacao_id || !fornecedor_nome) {
      return res.status(400).json({ ok: false, error: 'solicitacao_id e fornecedor_nome são obrigatórios' });
    }
    
    // Processa anexos se houver - SALVA NO SUPABASE
    let anexosUrls = null;
    if (anexos && Array.isArray(anexos) && anexos.length > 0) {
      console.log(`[Cotações] Processando ${anexos.length} anexos para solicitacao_id ${solicitacao_id}`);
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;

        if (!supabaseUrl || !supabaseKey) {
          throw new Error('Credenciais do Supabase não configuradas');
        }

        const supabase = createClient(supabaseUrl, supabaseKey);
        const bucketName = 'compras-anexos';

        // Verifica se o bucket existe, se não, cria
        try {
          const { data: buckets } = await supabase.storage.listBuckets();
          const bucketExists = buckets?.some(b => b.name === bucketName);
          if (!bucketExists) {
            console.log(`[Cotações] Criando bucket '${bucketName}' no Supabase...`);
            await supabase.storage.createBucket(bucketName, {
              public: true,
              fileSizeLimit: 10485760,
              allowedMimeTypes: ['image/*', 'application/pdf', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
            });
          }
        } catch (bucketError) {
          console.warn('[Cotações] Aviso ao verificar bucket:', bucketError.message);
        }

        anexosUrls = [];
        for (const anexo of anexos) {
          if (!anexo?.base64) continue;

          const buffer = Buffer.from(anexo.base64, 'base64');
          const timestamp = Date.now();
          const nomeArquivoSanitizado = (anexo.nome || 'anexo').replace(/[^a-zA-Z0-9.-]/g, '_');
          const filePath = `cotacoes/${solicitacao_id}/${timestamp}_${nomeArquivoSanitizado}`;

          const { error: uploadError } = await supabase.storage
            .from(bucketName)
            .upload(filePath, buffer, {
              contentType: anexo.tipo || 'application/octet-stream',
              upsert: false
            });

          if (uploadError) {
            console.error(`[Cotações] Erro no upload de ${anexo.nome}:`, uploadError.message);
            continue;
          }

          const { data: publicData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(filePath);

          anexosUrls.push({
            nome: anexo.nome,
            url: publicData.publicUrl,
            tipo: anexo.tipo || 'application/octet-stream',
            tamanho: anexo.tamanho || 0,
            data_upload: new Date().toISOString()
          });
        }

        if (anexosUrls.length === 0) {
          anexosUrls = null;
        }
      } catch (errAnexo) {
        console.error('[Cotações] Erro ao processar anexos:', errAnexo);
        anexosUrls = null;
      }
    }
    
    // Busca produto_codigo da solicitação (ambas as tabelas podem ter dados)
    // Objetivo: compras_sem_cadastro não tem numero_pedido, então busca apenas produto_codigo
    let produtoCodigo = null;
    let numeroPedido = null;
    const tableToUse = table_source === 'compras_sem_cadastro' ? 'compras.compras_sem_cadastro' : 'compras.solicitacao_compras';
    
    if (table_source === 'compras_sem_cadastro') {
      // compras_sem_cadastro tem apenas produto_codigo
      const { rows: rowsSolic } = await pool.query(`
        SELECT produto_codigo
        FROM ${tableToUse}
        WHERE id = $1
        LIMIT 1
      `, [solicitacao_id]);
      
      if (rowsSolic.length > 0) {
        produtoCodigo = rowsSolic[0]?.produto_codigo || null;
      }
    } else {
      // solicitacao_compras tem produto_codigo e numero_pedido
      const { rows: rowsSolic } = await pool.query(`
        SELECT produto_codigo, numero_pedido
        FROM ${tableToUse}
        WHERE id = $1
        LIMIT 1
      `, [solicitacao_id]);
      
      if (rowsSolic.length > 0) {
        produtoCodigo = rowsSolic[0]?.produto_codigo || null;
        numeroPedido = rowsSolic[0]?.numero_pedido || null;
      }
    }

    const moedaNormalizada = String(moeda || 'BRL').toUpperCase() === 'USD' ? 'USD' : 'BRL';
    const tableSourceNormalizado = table_source === 'compras_sem_cadastro' ? 'compras_sem_cadastro' : 'solicitacao_compras';
    const itensCotacaoLista = Array.isArray(itens_cotacao) ? itens_cotacao : [];

    const client = await pool.connect();
    let cotacaoSalva = null;
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(`
        INSERT INTO compras.cotacoes 
          (solicitacao_id, produto_codigo, numero_pedido, fornecedor_nome, fornecedor_id, valor_cotado, moeda, observacao, link, anexos, criado_por, table_source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `, [
        solicitacao_id,
        produtoCodigo,
        numeroPedido,
        fornecedor_nome,
        fornecedor_id || null,
        valor_cotado || null,
        moedaNormalizada,
        observacao || null,
        linkParaSalvar,
        anexosUrls ? JSON.stringify(anexosUrls) : null,
        criado_por || null,
        tableSourceNormalizado
      ]);

      cotacaoSalva = rows[0];

      for (const itemCotacao of itensCotacaoLista) {
        const itemOrigemId = Number(itemCotacao?.id || itemCotacao?.item_origem_id);
        if (!Number.isInteger(itemOrigemId)) continue;

        await client.query(`
          INSERT INTO compras.cotacoes_itens
            (cotacao_id, item_origem_id, grupo_requisicao, table_source, produto_codigo, produto_descricao, quantidade)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (cotacao_id, item_origem_id, table_source) DO NOTHING
        `, [
          cotacaoSalva.id,
          itemOrigemId,
          itemCotacao?.grupo_requisicao || null,
          tableSourceNormalizado,
          itemCotacao?.produto_codigo || null,
          itemCotacao?.produto_descricao || null,
          (itemCotacao?.quantidade ?? null)
        ]);
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    
    console.log('[Cotações] Cotação salva:', {
      id: cotacaoSalva.id,
      fornecedor: cotacaoSalva.fornecedor_nome,
      table_source: cotacaoSalva.table_source,
      anexos_count: anexosUrls ? anexosUrls.length : 0
    });
    
    res.json({ ok: true, cotacao: cotacaoSalva });
  } catch (err) {
    console.error('[Cotações] Erro ao adicionar cotação:', err);
    res.status(500).json({ ok: false, error: 'Erro ao adicionar cotação' });
  }
});

// GET /api/compras/cotacoes/:solicitacao_id - Lista cotações de um item
app.get('/api/compras/cotacoes/:solicitacao_id', async (req, res) => {
  try {
    const solicitacao_id = Number(req.params.solicitacao_id);
    if (!Number.isInteger(solicitacao_id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    
    // Comentário: aceita table_source como query parameter para filtrar cotações
    const table_source = req.query.table_source || 'solicitacao_compras';
    
    const { rows } = await pool.query(`
      SELECT c.*,
             COALESCE((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'id', ci.item_origem_id,
                   'item_origem_id', ci.item_origem_id,
                   'grupo_requisicao', ci.grupo_requisicao,
                   'table_source', ci.table_source,
                   'produto_codigo', ci.produto_codigo,
                   'produto_descricao', ci.produto_descricao,
                   'quantidade', ci.quantidade
                 )
                 ORDER BY ci.id
               )
               FROM compras.cotacoes_itens ci
               WHERE ci.cotacao_id = c.id
             ), '[]'::jsonb) AS itens_cotacao
      FROM compras.cotacoes c
      WHERE c.solicitacao_id = $1
        AND c.table_source = $2
      ORDER BY c.criado_em DESC
    `, [solicitacao_id, table_source]);
    
    res.json({ cotacoes: rows });
  } catch (err) {
    console.error('[Cotações] Erro ao listar cotações:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar cotações' });
  }
});

// GET /api/compras/cotacoes-por-produto/:produto_codigo - Lista cotações por produto_codigo
app.get('/api/compras/cotacoes-por-produto/:produto_codigo', async (req, res) => {
  try {
    const produtoCodigo = String(req.params.produto_codigo || '').trim();
    if (!produtoCodigo) {
      return res.status(400).json({ ok: false, error: 'produto_codigo inválido' });
    }

    const { rows } = await pool.query(`
      SELECT * FROM compras.cotacoes
      WHERE produto_codigo = $1
      ORDER BY criado_em DESC
    `, [produtoCodigo]);

    res.json(rows);
  } catch (err) {
    console.error('[Cotações] Erro ao listar por produto_codigo:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar cotações por produto' });
  }
});

// PUT /api/compras/cotacoes/:id - Atualiza uma cotação
app.put('/api/compras/cotacoes/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    
    const { fornecedor_nome, fornecedor_id, valor_cotado, observacao, anexos, link, moeda, itens_cotacao } = req.body || {};
    
    const fields = [];
    const values = [];
    let idx = 1;
    
    // Processa anexos se houver
    let anexosUrls = null;
    if (anexos && Array.isArray(anexos) && anexos.length > 0) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE;
        
        if (!supabaseUrl || !supabaseKey) {
          console.error('[Supabase] Credenciais não configuradas');
          throw new Error('Supabase não configurado');
        }
        
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        // Busca cotação para pegar solicitacao_id
        const { rows: cotacaoRows } = await pool.query(`
          SELECT solicitacao_id FROM compras.cotacoes WHERE id = $1
        `, [id]);
        
        if (cotacaoRows.length > 0) {
          anexosUrls = [];
          
          for (const anexo of anexos) {
            const buffer = Buffer.from(anexo.base64, 'base64');
            const filePath = `cotacao_${cotacaoRows[0].solicitacao_id}/${Date.now()}_${anexo.nome}`;
            
            const { data, error } = await supabase.storage
              .from('compras-anexos')
              .upload(filePath, buffer, {
                contentType: anexo.tipo,
                upsert: false
              });
            
            if (!error) {
              const { data: publicData } = supabase.storage
                .from('compras-anexos')
                .getPublicUrl(filePath);
              
              anexosUrls.push({
                nome: anexo.nome,
                url: publicData.publicUrl,
                tipo: anexo.tipo,
                tamanho: anexo.tamanho
              });
            }
          }
          
          if (anexosUrls.length > 0) {
            fields.push(`anexos = $${idx++}`);
            values.push(JSON.stringify(anexosUrls));
          }
        }
      } catch (uploadErr) {
        console.error('[Cotações] Erro ao fazer upload de anexos:', uploadErr);
      }
    }
    
    if (fornecedor_nome) {
      fields.push(`fornecedor_nome = $${idx++}`);
      values.push(fornecedor_nome);
    }
    
    if (typeof fornecedor_id !== 'undefined') {
      fields.push(`fornecedor_id = $${idx++}`);
      values.push(fornecedor_id || null);
    }
    
    if (typeof valor_cotado !== 'undefined') {
      fields.push(`valor_cotado = $${idx++}`);
      values.push(valor_cotado || null);
    }
    
    if (typeof observacao !== 'undefined') {
      fields.push(`observacao = $${idx++}`);
      values.push(observacao || null);
    }

    if (typeof link !== 'undefined') {
      let linksNormalizados = [];
      if (Array.isArray(link)) {
        linksNormalizados = link
          .map(v => String(v || '').trim())
          .filter(Boolean);
      } else if (typeof link === 'string') {
        const texto = link.trim();
        if (texto) {
          try {
            const parsed = JSON.parse(texto);
            if (Array.isArray(parsed)) {
              linksNormalizados = parsed
                .map(v => String(v || '').trim())
                .filter(Boolean);
            } else {
              linksNormalizados = [texto];
            }
          } catch (e) {
            linksNormalizados = [texto];
          }
        }
      }

      fields.push(`link = $${idx++}`);
      values.push(linksNormalizados.length ? JSON.stringify(linksNormalizados) : null);
    }

    if (typeof moeda !== 'undefined') {
      const moedaNormalizada = String(moeda || 'BRL').toUpperCase() === 'USD' ? 'USD' : 'BRL';
      fields.push(`moeda = $${idx++}`);
      values.push(moedaNormalizada);
    }
    
    const deveAtualizarItens = Array.isArray(itens_cotacao);
    if (fields.length === 0 && !deveAtualizarItens) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo para atualizar' });
    }

    const client = await pool.connect();
    let rows = [];
    try {
      await client.query('BEGIN');

      if (fields.length > 0) {
        fields.push(`atualizado_em = NOW()`);
        values.push(id);

        const result = await client.query(`
          UPDATE compras.cotacoes 
          SET ${fields.join(', ')}
          WHERE id = $${idx}
          RETURNING *
        `, values);
        rows = result.rows;
      } else {
        const result = await client.query(`
          SELECT * FROM compras.cotacoes WHERE id = $1
        `, [id]);
        rows = result.rows;
      }

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
      }

      if (deveAtualizarItens) {
        const cotacaoAtual = rows[0];
        const tableSourceCotacao = cotacaoAtual.table_source === 'compras_sem_cadastro'
          ? 'compras_sem_cadastro'
          : 'solicitacao_compras';

        await client.query(`
          DELETE FROM compras.cotacoes_itens
          WHERE cotacao_id = $1
        `, [id]);

        for (const itemCotacao of itens_cotacao) {
          const itemOrigemId = Number(itemCotacao?.id || itemCotacao?.item_origem_id);
          if (!Number.isInteger(itemOrigemId)) continue;

          await client.query(`
            INSERT INTO compras.cotacoes_itens
              (cotacao_id, item_origem_id, grupo_requisicao, table_source, produto_codigo, produto_descricao, quantidade)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (cotacao_id, item_origem_id, table_source) DO NOTHING
          `, [
            id,
            itemOrigemId,
            itemCotacao?.grupo_requisicao || null,
            tableSourceCotacao,
            itemCotacao?.produto_codigo || null,
            itemCotacao?.produto_descricao || null,
            (itemCotacao?.quantidade ?? null)
          ]);
        }
      }

      const recarregado = await client.query(`
        SELECT c.*,
               COALESCE((
                 SELECT jsonb_agg(
                   jsonb_build_object(
                     'id', ci.item_origem_id,
                     'item_origem_id', ci.item_origem_id,
                     'grupo_requisicao', ci.grupo_requisicao,
                     'table_source', ci.table_source,
                     'produto_codigo', ci.produto_codigo,
                     'produto_descricao', ci.produto_descricao,
                     'quantidade', ci.quantidade
                   )
                   ORDER BY ci.id
                 )
                 FROM compras.cotacoes_itens ci
                 WHERE ci.cotacao_id = c.id
               ), '[]'::jsonb) AS itens_cotacao
        FROM compras.cotacoes c
        WHERE c.id = $1
      `, [id]);

      await client.query('COMMIT');
      rows = recarregado.rows;
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    
    res.json({ ok: true, cotacao: rows[0] });
  } catch (err) {
    console.error('[Cotações] Erro ao atualizar cotação:', err);
    res.status(500).json({ ok: false, error: 'Erro ao atualizar cotação' });
  }
});

// DELETE /api/compras/cotacoes/:id - Remove uma cotação
app.delete('/api/compras/cotacoes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    
    const { rows } = await pool.query(`
      DELETE FROM compras.cotacoes 
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
    }
    
    res.json({ ok: true, message: 'Cotação removida com sucesso' });
  } catch (err) {
    console.error('[Cotações] Erro ao remover cotação:', err);
    res.status(500).json({ ok: false, error: 'Erro ao remover cotação' });
  }
});

// Endpoint para atualizar status de aprovação de uma cotação
app.put('/api/compras/cotacoes/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Valida status
    if (!status || !['pendente', 'aprovado', 'reprovado'].includes(status)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Status inválido. Use: pendente, aprovado ou reprovado' 
      });
    }
    
    // Atualiza status da cotação
    const { rows } = await pool.query(`
      UPDATE compras.cotacoes 
      SET status_aprovacao = $1, atualizado_em = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
    }
    
    res.json({ ok: true, cotacao: rows[0] });
    
  } catch (err) {
    console.error('[Cotações] Erro ao atualizar status:', err);
    res.status(500).json({ ok: false, error: 'Erro ao atualizar status da cotação' });
  }
});

// Endpoint para realizar requisição a partir de uma cotação (desmembra grupo_requisicao dos itens da cotação)
app.post('/api/compras/cotacoes/:id/realizar-requisicao', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const cotacaoId = Number(req.params.id);
    if (!Number.isInteger(cotacaoId)) {
      return res.status(400).json({ ok: false, error: 'ID da cotação inválido' });
    }

    await client.query('BEGIN');

    const { rows: cotacaoRows } = await client.query(
      `
        SELECT id, solicitacao_id, table_source, status_aprovacao
        FROM compras.cotacoes
        WHERE id = $1
        FOR UPDATE
      `,
      [cotacaoId]
    );

    if (!cotacaoRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
    }

    const cotacao = cotacaoRows[0];
    if (String(cotacao.status_aprovacao || '').toLowerCase() === 'aprovado') {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Esta cotação já teve a requisição realizada' });
    }

    const tableSource = String(cotacao.table_source || '').trim() === 'compras_sem_cadastro'
      ? 'compras_sem_cadastro'
      : 'solicitacao_compras';
    const tableName = tableSource === 'compras_sem_cadastro'
      ? 'compras.compras_sem_cadastro'
      : 'compras.solicitacao_compras';

    const solicitacaoId = Number(cotacao.solicitacao_id);
    if (!Number.isInteger(solicitacaoId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Cotação sem solicitacao_id válido' });
    }

    const { rows: grupoPaiRows } = await client.query(
      `
        SELECT grupo_requisicao
        FROM ${tableName}
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [solicitacaoId]
    );

    if (!grupoPaiRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Item de referência da cotação não encontrado na tabela de origem' });
    }

    const grupoPaiOriginal = String(grupoPaiRows[0]?.grupo_requisicao || '').trim();
    if (!grupoPaiOriginal) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Grupo de requisição não encontrado no item de referência' });
    }

    const grupoPaiBase = grupoPaiOriginal.split('.').shift();
    if (!grupoPaiBase) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Grupo de requisição base inválido' });
    }

    const { rows: cotacaoItensRows } = await client.query(
      `
        SELECT item_origem_id
        FROM compras.cotacoes_itens
        WHERE cotacao_id = $1
          AND table_source = $2
        ORDER BY id ASC
      `,
      [cotacaoId, tableSource]
    );

    const itensOrigemIds = Array.from(new Set(
      cotacaoItensRows
        .map((row) => Number(row.item_origem_id))
        .filter((id) => Number.isInteger(id) && id > 0)
    ));

    if (!itensOrigemIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Cotação sem itens vinculados para desmembrar' });
    }

    const { rows: gruposExistentesRows } = await client.query(
      `
        SELECT grupo_requisicao
        FROM compras.solicitacao_compras
        WHERE LOWER(TRIM(COALESCE(grupo_requisicao, ''))) = LOWER(TRIM($1))
           OR LOWER(TRIM(COALESCE(grupo_requisicao, ''))) LIKE LOWER(TRIM($1)) || '.%'
        UNION
        SELECT grupo_requisicao
        FROM compras.compras_sem_cadastro
        WHERE LOWER(TRIM(COALESCE(grupo_requisicao, ''))) = LOWER(TRIM($1))
           OR LOWER(TRIM(COALESCE(grupo_requisicao, ''))) LIKE LOWER(TRIM($1)) || '.%'
      `,
      [grupoPaiBase]
    );

    let maiorSufixo = 0;
    gruposExistentesRows.forEach((row) => {
      const grupo = String(row?.grupo_requisicao || '').trim();
      if (!grupo) return;
      const match = grupo.match(/^(.+)\.(\d+)$/);
      if (!match) return;
      if (match[1] !== grupoPaiBase) return;
      const numero = Number(match[2]);
      if (Number.isInteger(numero) && numero > maiorSufixo) {
        maiorSufixo = numero;
      }
    });

    const novoGrupoRequisicao = `${grupoPaiBase}.${maiorSufixo + 1}`;

    const { rows: itensExistentesRows } = await client.query(
      `
        SELECT id
        FROM ${tableName}
        WHERE id = ANY($1::int[])
      `,
      [itensOrigemIds]
    );

    const itensExistentes = new Set(itensExistentesRows.map((row) => Number(row.id)));
    const itensParaAtualizar = itensOrigemIds.filter((id) => itensExistentes.has(id));

    if (!itensParaAtualizar.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Itens da cotação não encontrados na tabela de origem' });
    }

    const { rows: itensAtualizadosRows } = await client.query(
      `
        UPDATE ${tableName}
        SET grupo_requisicao = $1,
            status = 'Analise de cadastro',
            updated_at = NOW()
        WHERE id = ANY($2::int[])
        RETURNING id, grupo_requisicao, status
      `,
      [novoGrupoRequisicao, itensParaAtualizar]
    );

    await upsertStatusHistoricoCompras({
      grupoRequisicao: novoGrupoRequisicao,
      status: 'Analise de cadastro',
      tableSource,
      client
    });

    const { rows: cotacaoAtualizadaRows } = await client.query(
      `
        UPDATE compras.cotacoes
        SET status_aprovacao = 'aprovado', atualizado_em = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [cotacaoId]
    );

    await client.query('COMMIT');
    return res.json({
      ok: true,
      cotacao: cotacaoAtualizadaRows[0],
      grupo_pai: grupoPaiBase,
      novo_grupo_requisicao: novoGrupoRequisicao,
      itens_movidos: itensAtualizadosRows
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[COTACOES] Erro ao realizar requisição por cotação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao realizar requisição por cotação' });
  } finally {
    client.release();
  }
});

// Endpoint para editar detalhes de um item de compra
app.put('/api/compras/itens/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const {
      table_source,
      produto_codigo,
      produto_descricao,
      quantidade,
      departamento,
      retorno_cotacao,
      objetivo_compra,
      prazo_solicitado,
      link,
      anexo_url
    } = req.body || {};

    let tableSource = table_source;

    if (!tableSource) {
      const { rows: fromSolicitacao } = await pool.query(
        'SELECT id FROM compras.solicitacao_compras WHERE id = $1',
        [id]
      );

      if (fromSolicitacao.length > 0) {
        tableSource = 'solicitacao_compras';
      } else {
        const { rows: fromSemCadastro } = await pool.query(
          'SELECT id FROM compras.compras_sem_cadastro WHERE id = $1',
          [id]
        );
        if (fromSemCadastro.length > 0) {
          tableSource = 'compras_sem_cadastro';
        }
      }
    }

    if (!tableSource) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado em nenhuma tabela' });
    }

    const tableName = tableSource === 'compras_sem_cadastro'
      ? 'compras.compras_sem_cadastro'
      : 'compras.solicitacao_compras';

    const sets = [];
    const values = [];
    let idx = 1;

    if (typeof produto_codigo !== 'undefined') {
      sets.push(`produto_codigo = $${idx++}`);
      values.push(String(produto_codigo || '').trim() || null);
    }

    if (typeof produto_descricao !== 'undefined') {
      sets.push(`produto_descricao = $${idx++}`);
      values.push(String(produto_descricao || '').trim() || null);
    }

    if (typeof quantidade !== 'undefined') {
      const qtdNumber = Number(String(quantidade).replace(',', '.'));
      if (!Number.isFinite(qtdNumber) || qtdNumber <= 0) {
        return res.status(400).json({ ok: false, error: 'Quantidade inválida' });
      }
      sets.push(`quantidade = $${idx++}`);
      values.push(qtdNumber);
    }

    if (typeof departamento !== 'undefined') {
      sets.push(`departamento = $${idx++}`);
      values.push(String(departamento || '').trim() || null);
    }

    if (typeof retorno_cotacao !== 'undefined') {
      sets.push(`retorno_cotacao = $${idx++}`);
      values.push(String(retorno_cotacao || '').trim() || null);
    }

    if (typeof objetivo_compra !== 'undefined') {
      sets.push(`objetivo_compra = $${idx++}`);
      values.push(String(objetivo_compra || '').trim() || null);
    }

    if (tableSource === 'solicitacao_compras' && typeof prazo_solicitado !== 'undefined') {
      sets.push(`prazo_solicitado = $${idx++}`);
      values.push(prazo_solicitado || null);
    }

    if (tableSource === 'compras_sem_cadastro' && typeof link !== 'undefined') {
      sets.push(`link = $${idx++}`);
      values.push(String(link || '').trim() || null);
    }

    if (tableSource === 'solicitacao_compras' && typeof anexo_url !== 'undefined') {
      sets.push(`anexo_url = $${idx++}`);
      values.push(String(anexo_url || '').trim() || null);
    }

    if (sets.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo para atualizar' });
    }

    sets.push('updated_at = NOW()');
    values.push(id);

    const { rows } = await pool.query(
      `
        UPDATE ${tableName}
        SET ${sets.join(', ')}
        WHERE id = $${idx}
        RETURNING *
      `,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }

    res.json({ ok: true, item: rows[0], table_source: tableSource });
  } catch (err) {
    console.error('[Compras] Erro ao editar detalhes do item:', err);
    res.status(500).json({ ok: false, error: 'Erro ao editar detalhes do item' });
  }
});

// Endpoint para alterar status de um item de compra
app.put('/api/compras/itens/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, observacao_retificacao, observacao_reprovacao, usuario_comentario } = req.body;

    const statusValidos = ['pendente', 'aguardando cotação', 'cotada', 'aguardando compra', 'aprovado', 'recusado', 'retificar', 'aguardando aprovação da requisição', 'carrinho', 'Analise de cadastro', 'Carrinho'];
    if (!status || !statusValidos.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: `Status inválido. Use: ${statusValidos.join(', ')}`
      });
    }

    let tableSource = null;
    const { rows: fromSolicitacao } = await pool.query(
      'SELECT id FROM compras.solicitacao_compras WHERE id = $1',
      [id]
    );

    if (fromSolicitacao.length > 0) {
      tableSource = 'solicitacao_compras';
    } else {
      const { rows: fromSemCadastro } = await pool.query(
        'SELECT id FROM compras.compras_sem_cadastro WHERE id = $1',
        [id]
      );
      if (fromSemCadastro.length > 0) {
        tableSource = 'compras_sem_cadastro';
      }
    }

    if (!tableSource) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado em nenhuma tabela' });
    }

    if (tableSource === 'solicitacao_compras' && status === 'retificar' && (!observacao_retificacao || observacao_retificacao.trim() === '')) {
      return res.status(400).json({
        ok: false,
        error: 'Observação é obrigatória ao solicitar retificação'
      });
    }

    const tableName = tableSource === 'solicitacao_compras' ? 'compras.solicitacao_compras' : 'compras.compras_sem_cadastro';
    const { rows: grupoRows } = await pool.query(
      `SELECT grupo_requisicao FROM ${tableName} WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!grupoRows.length) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }

    const grupoRequisicao = String(grupoRows[0]?.grupo_requisicao || '').trim();
    if (!grupoRequisicao) {
      return res.status(400).json({ ok: false, error: 'Item sem grupo_requisicao para atualizar status no histórico' });
    }

    if (status === 'carrinho' || status === 'Carrinho') {
      const statusAtual = await obterStatusHistoricoPorGrupo({ grupoRequisicao });
      if (statusAtual === 'aguardando aprovação da requisição' && (!observacao_reprovacao || observacao_reprovacao.trim() === '')) {
        return res.status(400).json({
          ok: false,
          error: 'Motivo é obrigatório ao reprovar e voltar para o carrinho'
        });
      }
    }

    let query = null;
    let params = null;

    if (observacao_retificacao && observacao_retificacao.trim() !== '') {
      const nomeUsuario = usuario_comentario || 'Usuário';
      const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const novaLinha = `User ${nomeUsuario} - ${dataHora}\n${observacao_retificacao}\n`;

      if (tableSource === 'solicitacao_compras') {
        const { rows: existingRows } = await pool.query(
          `SELECT observacao_retificacao FROM ${tableName} WHERE id = $1`,
          [id]
        );

        const historicoExistente = existingRows[0]?.observacao_retificacao || '';
        const novoHistorico = historicoExistente ? `${historicoExistente}\n${novaLinha}` : novaLinha;

        query = `
          UPDATE ${tableName}
          SET observacao_retificacao = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING *
        `;
        params = [novoHistorico, id];
      } else {
        query = `
          UPDATE ${tableName}
          SET observacao_reprovacao = $1, usuario_comentario = $2, updated_at = NOW()
          WHERE id = $3
          RETURNING *
        `;
        params = [observacao_retificacao.trim(), nomeUsuario, id];
      }
    } else if (observacao_reprovacao && observacao_reprovacao.trim() !== '') {
      query = `
        UPDATE ${tableName}
        SET observacao_reprovacao = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;
      params = [observacao_reprovacao.trim(), id];
    }

    const rows = query
      ? (await pool.query(query, params)).rows
      : (await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id])).rows;

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }

    await upsertStatusHistoricoCompras({
      grupoRequisicao,
      status,
      tableSource,
      dados: {
        item_id: Number(id),
        observacao_retificacao: observacao_retificacao || null,
        observacao_reprovacao: observacao_reprovacao || null,
        usuario_comentario: usuario_comentario || null
      }
    });

    const itemResposta = { ...rows[0], status, grupo_requisicao: grupoRequisicao };
    res.json({ ok: true, item: itemResposta, table_source: tableSource });
  } catch (err) {
    console.error('[Compras] Erro ao atualizar status do item:', err);
    res.status(500).json({ ok: false, error: 'Erro ao atualizar status do item' });
  }
});

// Endpoint para atualizar observação de retificação
app.put('/api/compras/itens/:id/observacao-retificacao', async (req, res) => {
  try {
    const { id } = req.params;
    const { observacao_retificacao, usuario_comentario } = req.body;
    
    // Valida observação obrigatória
    if (!observacao_retificacao || observacao_retificacao.trim() === '') {
      return res.status(400).json({ 
        ok: false, 
        error: 'Observação não pode estar vazia' 
      });
    }
    
    // Busca histórico existente
    const { rows: existingRows } = await pool.query(
      'SELECT observacao_retificacao FROM compras.solicitacao_compras WHERE id = $1',
      [id]
    );
    
    const historicoExistente = existingRows[0]?.observacao_retificacao || '';
    const nomeUsuario = usuario_comentario || 'Usuário';
    const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    
    // Acrescenta novo comentário ao histórico
    const novaLinha = `User ${nomeUsuario} - ${dataHora}\n${observacao_retificacao}\n`;
    const novoHistorico = historicoExistente ? `${historicoExistente}\n${novaLinha}` : novaLinha;
    
    // Atualiza observação
    const query = `
      UPDATE compras.solicitacao_compras 
      SET observacao_retificacao = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    
    const { rows } = await pool.query(query, [novoHistorico, id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }
    
    res.json({ ok: true, item: rows[0] });
    
  } catch (err) {
    console.error('[Compras] Erro ao atualizar observação de retificação:', err);
    res.status(500).json({ ok: false, error: 'Erro ao atualizar observação' });
  }
});

// Endpoint para excluir um item de compra
app.delete('/api/compras/itens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { table_source } = req.body || {};
    
    // Objetivo: Detectar de qual tabela o item vem (solicitacao_compras ou compras_sem_cadastro)
    // e fazer a exclusão na tabela correta
    let tableSource = table_source;
    
    if (!tableSource) {
      // Tenta encontrar em solicitacao_compras primeiro
      const { rows: fromSolicitacao } = await pool.query(
        'SELECT id FROM compras.solicitacao_compras WHERE id = $1',
        [id]
      );
      
      if (fromSolicitacao.length > 0) {
        tableSource = 'solicitacao_compras';
      } else {
        // Se não encontrou, tenta compras_sem_cadastro
        const { rows: fromSemCadastro } = await pool.query(
          'SELECT id FROM compras.compras_sem_cadastro WHERE id = $1',
          [id]
        );
        if (fromSemCadastro.length > 0) {
          tableSource = 'compras_sem_cadastro';
        }
      }
    }
    
    if (!tableSource) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado em nenhuma tabela' });
    }
    
    const tableName = tableSource === 'solicitacao_compras' ? 'compras.solicitacao_compras' : 'compras.compras_sem_cadastro';
    
    // Exclui o item (as cotações serão excluídas automaticamente por CASCADE se for solicitacao_compras)
    await pool.query(`
      DELETE FROM ${tableName} WHERE id = $1
    `, [id]);
    
    res.json({ ok: true, message: 'Item excluído com sucesso', table_source: tableSource });
    
  } catch (err) {
    console.error('[Compras] Erro ao excluir item:', err);
    res.status(500).json({ ok: false, error: 'Erro ao excluir item' });
  }
});

// ========== FIM ENDPOINTS DE COTAÇÕES ==========

// Garante que a tabela compras_sem_cadastro existe
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras.compras_sem_cadastro (
        id SERIAL PRIMARY KEY,
        produto_codigo VARCHAR(255) NOT NULL,
        produto_descricao TEXT NOT NULL,
        quantidade INTEGER NOT NULL DEFAULT 1,
        departamento VARCHAR(255) NOT NULL,
        centro_custo VARCHAR(255) NOT NULL,
        categoria_compra_codigo VARCHAR(50),
        categoria_compra_nome VARCHAR(255),
        objetivo_compra TEXT,
        retorno_cotacao VARCHAR(255),
        resp_inspecao_recebimento VARCHAR(255),
        observacao_recebimento TEXT,
        anexos JSONB,
        solicitante VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pendente',
        grupo_requisicao VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_solicitante 
        ON compras.compras_sem_cadastro(solicitante);
      CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_status 
        ON compras.compras_sem_cadastro(status);
      CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_departamento 
        ON compras.compras_sem_cadastro(departamento);
      CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_grupo 
        ON compras.compras_sem_cadastro(grupo_requisicao);
      CREATE INDEX IF NOT EXISTS idx_compras_sem_cadastro_created 
        ON compras.compras_sem_cadastro(created_at DESC);
    `);

    await pool.query(`
      ALTER TABLE compras.compras_sem_cadastro
      ADD COLUMN IF NOT EXISTS numero_pedido TEXT;

      ALTER TABLE compras.compras_sem_cadastro
      ADD COLUMN IF NOT EXISTS ncodped TEXT;

      ALTER TABLE compras.compras_sem_cadastro
      ADD COLUMN IF NOT EXISTS cod_req_compra TEXT;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'compras'
            AND p.proname = 'fn_registrar_historico_solicitacao'
        ) THEN
          DROP TRIGGER IF EXISTS trg_historico_compras_sem_cadastro
          ON compras.compras_sem_cadastro;

          CREATE TRIGGER trg_historico_compras_sem_cadastro
          AFTER INSERT OR UPDATE OR DELETE
          ON compras.compras_sem_cadastro
          FOR EACH ROW
          EXECUTE FUNCTION compras.fn_registrar_historico_solicitacao();
        END IF;
      END $$;
    `);
    console.log('[Compras] ✓ Tabela compras_sem_cadastro garantida');
  } catch (err) {
    console.error('[Compras] Erro ao criar tabela compras_sem_cadastro:', err.message);
  }
})();

// ===================== AUTO-SYNC COMPRAS -> GOOGLE SHEETS =====================
const GOOGLE_SHEETS_AUTOSYNC_ENABLED = process.env.GOOGLE_SHEETS_AUTOSYNC_ENABLED !== '0';
const GOOGLE_SHEETS_SYNC_MODE = String(process.env.GOOGLE_SHEETS_SYNC_MODE || 'db-trigger').toLowerCase();
const GOOGLE_SHEETS_AUTOSYNC_INTERVAL_MS = Math.max(
  15000,
  Number(process.env.GOOGLE_SHEETS_AUTOSYNC_INTERVAL_MS || 60000)
);
const GOOGLE_SHEETS_SYNC_CHANNEL = 'compras_google_sheets_sync';
const comprasGoogleSheetsSyncState = {
  running: false,
  lastFingerprint: null,
  timer: null,
  eventDebounceTimer: null,
  listenerClient: null,
  lastSyncAt: null,
  lastSyncReason: null,
  lastSyncStatus: 'idle',
  lastSyncRows: 0,
  lastSyncError: null,
};

function formatarDataHoraPtBr(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleString('pt-BR');
}

function formatarDataPtBr(valor) {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '-';
  return data.toLocaleDateString('pt-BR');
}

function normalizarRetornoCotacao(valor, tableSource) {
  const texto = String(valor || '').trim().toLowerCase();
  if (!texto) return 'Não';
  if (String(tableSource) === 'compras_sem_cadastro') {
    const semRetorno = '🛒 apenas realizar compra sem retorno de valores ou caracteristica';
    return texto === semRetorno ? 'Não' : 'Sim';
  }
  return ['s', 'sim', 'yes', 'true', '1'].includes(texto) ? 'Sim' : 'Não';
}

async function obterFingerprintComprasParaSheets() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COALESCE(MAX(updated_at), MAX(created_at), to_timestamp(0)) FROM compras.solicitacao_compras) AS max_sol,
      (SELECT COUNT(*) FROM compras.solicitacao_compras) AS qtd_sol,
      (SELECT COALESCE(MAX(updated_at), MAX(created_at), to_timestamp(0)) FROM compras.compras_sem_cadastro) AS max_sem,
      (SELECT COUNT(*) FROM compras.compras_sem_cadastro) AS qtd_sem
  `);

  const row = rows[0] || {};
  const maxSol = row.max_sol ? new Date(row.max_sol).toISOString() : '0';
  const maxSem = row.max_sem ? new Date(row.max_sem).toISOString() : '0';
  return `${maxSol}|${row.qtd_sol || 0}|${maxSem}|${row.qtd_sem || 0}`;
}

async function montarLinhasComprasParaSheets() {
  const { rows: solicitacoesBase } = await pool.query(`
    SELECT
      id,
      numero_pedido,
      produto_codigo,
      produto_descricao,
      quantidade,
      prazo_solicitado,
      previsao_chegada,
      status,
      observacao,
      observacao_retificacao,
      solicitante,
      resp_inspecao_recebimento,
      departamento,
      centro_custo,
      objetivo_compra,
      fornecedor_nome,
      fornecedor_id,
      familia_produto,
      grupo_requisicao,
      retorno_cotacao,
      categoria_compra_codigo,
      categoria_compra_nome,
      codigo_omie,
      codigo_produto_omie,
      anexos,
      cnumero,
      ncodped,
      created_at,
      updated_at,
      'solicitacao_compras' AS table_source
    FROM compras.solicitacao_compras
  `);

  const { rows: solicitacoesSemCadastro } = await pool.query(`
    SELECT
      id,
      numero_pedido,
      produto_codigo,
      produto_descricao,
      quantidade,
      NULL::date AS prazo_solicitado,
      NULL::date AS previsao_chegada,
      status,
      objetivo_compra AS observacao,
      NULL::text AS observacao_retificacao,
      solicitante,
      resp_inspecao_recebimento,
      departamento,
      centro_custo,
      objetivo_compra,
      NULL::text AS fornecedor_nome,
      NULL::text AS fornecedor_id,
      NULL::text AS familia_produto,
      grupo_requisicao,
      retorno_cotacao,
      categoria_compra_codigo,
      categoria_compra_nome,
      NULL::text AS codigo_omie,
      NULL::text AS codigo_produto_omie,
      anexos,
      numero_pedido AS cnumero,
      ncodped,
      created_at,
      updated_at,
      'compras_sem_cadastro' AS table_source
    FROM compras.compras_sem_cadastro
  `);

  const todas = [...solicitacoesBase, ...solicitacoesSemCadastro]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

  return todas.map(item => ({
    'Origem': item.table_source || '-',
    'ID': item.id || '-',
    'Nº Pedido': item.numero_pedido || '-',
    'Código Produto': item.produto_codigo || '-',
    'Descrição Produto': item.produto_descricao || '-',
    'Quantidade': item.quantidade || 0,
    'Prazo Solicitado': formatarDataPtBr(item.prazo_solicitado),
    'Previsão Chegada': formatarDataPtBr(item.previsao_chegada),
    'Status': item.status || '-',
    'Observação': item.observacao || '-',
    'Observação Retificação': item.observacao_retificacao || '-',
    'Solicitante': item.solicitante || '-',
    'Resp. Inspeção/Recebimento': item.resp_inspecao_recebimento || '-',
    'Departamento': item.departamento || '-',
    'Centro de Custo': item.centro_custo || '-',
    'Objetivo da Compra': item.objetivo_compra || '-',
    'Fornecedor Nome': item.fornecedor_nome || '-',
    'Fornecedor ID': item.fornecedor_id || '-',
    'Família Produto': item.familia_produto || '-',
    'Grupo Requisição': item.grupo_requisicao || '-',
    'Retorno Cotação': normalizarRetornoCotacao(item.retorno_cotacao, item.table_source),
    'Categoria Compra Código': item.categoria_compra_codigo || '-',
    'Categoria Compra Nome': item.categoria_compra_nome || '-',
    'Código Omie': item.codigo_omie || '-',
    'Código Produto Omie': item.codigo_produto_omie || '-',
    'Anexos': item.anexos ? JSON.stringify(item.anexos) : '-',
    'cNumero': item.cnumero || '-',
    'nCodPed': item.ncodped || '-',
    'Criado em': formatarDataHoraPtBr(item.created_at),
    'Atualizado em': formatarDataHoraPtBr(item.updated_at || item.created_at)
  }));
}

async function enviarLinhasComprasParaGoogleSheets(linhas) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('GOOGLE_SHEETS_WEBHOOK_URL não configurada');
  }

  const fetchFn = global.safeFetch || globalThis.fetch;
  if (!fetchFn) {
    throw new Error('Fetch indisponível no servidor');
  }

  const resposta = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linhas })
  });

  const contentType = String(resposta.headers.get('content-type') || '').toLowerCase();
  const texto = await resposta.text();

  if (!resposta.ok) {
    throw new Error(`Webhook Google Sheets retornou HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  if (contentType.includes('text/html')) {
    throw new Error(`Webhook Google Sheets retornou HTML: ${texto.slice(0, 300)}`);
  }

  if (texto) {
    try {
      const payload = JSON.parse(texto);
      if (payload && payload.ok === false) {
        throw new Error(`Apps Script retornou erro: ${JSON.stringify(payload)}`);
      }
    } catch (_) {
      // resposta não-JSON é aceita desde que não seja HTML e não seja erro HTTP
    }
  }
}

async function sincronizarComprasGoogleSheets({ force = false, motivo = 'auto' } = {}) {
  if (!GOOGLE_SHEETS_AUTOSYNC_ENABLED) return;
  if (!process.env.GOOGLE_SHEETS_WEBHOOK_URL) return;
  if (comprasGoogleSheetsSyncState.running) return;

  comprasGoogleSheetsSyncState.running = true;
  try {
    const fingerprint = await obterFingerprintComprasParaSheets();
    if (!force && comprasGoogleSheetsSyncState.lastFingerprint === fingerprint) {
      return;
    }

    const linhas = await montarLinhasComprasParaSheets();
    if (!linhas.length) {
      comprasGoogleSheetsSyncState.lastFingerprint = fingerprint;
      comprasGoogleSheetsSyncState.lastSyncAt = new Date().toISOString();
      comprasGoogleSheetsSyncState.lastSyncReason = motivo;
      comprasGoogleSheetsSyncState.lastSyncStatus = 'success';
      comprasGoogleSheetsSyncState.lastSyncRows = 0;
      comprasGoogleSheetsSyncState.lastSyncError = null;
      return;
    }

    await enviarLinhasComprasParaGoogleSheets(linhas);
    comprasGoogleSheetsSyncState.lastFingerprint = fingerprint;
    comprasGoogleSheetsSyncState.lastSyncAt = new Date().toISOString();
    comprasGoogleSheetsSyncState.lastSyncReason = motivo;
    comprasGoogleSheetsSyncState.lastSyncStatus = 'success';
    comprasGoogleSheetsSyncState.lastSyncRows = linhas.length;
    comprasGoogleSheetsSyncState.lastSyncError = null;
    console.log(`[SheetsAuto] Sincronização concluída (${motivo}) com ${linhas.length} linha(s).`);
  } catch (err) {
    comprasGoogleSheetsSyncState.lastSyncAt = new Date().toISOString();
    comprasGoogleSheetsSyncState.lastSyncReason = motivo;
    comprasGoogleSheetsSyncState.lastSyncStatus = 'error';
    comprasGoogleSheetsSyncState.lastSyncError = String(err?.message || err || 'Erro desconhecido');
    console.error('[SheetsAuto] Erro ao sincronizar automaticamente:', err?.message || err);
  } finally {
    comprasGoogleSheetsSyncState.running = false;
  }
}

function agendarSyncPorEvento(motivo = 'evento-db') {
  if (comprasGoogleSheetsSyncState.eventDebounceTimer) {
    clearTimeout(comprasGoogleSheetsSyncState.eventDebounceTimer);
  }
  comprasGoogleSheetsSyncState.eventDebounceTimer = setTimeout(() => {
    sincronizarComprasGoogleSheets({ force: true, motivo });
  }, 1200);
}

async function garantirTriggersNotificacaoGoogleSheets() {
  await pool.query(`
    CREATE OR REPLACE FUNCTION compras.fn_notify_google_sheets_sync()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      PERFORM pg_notify('${GOOGLE_SHEETS_SYNC_CHANNEL}', TG_TABLE_NAME || ':' || TG_OP);
      RETURN NULL;
    END;
    $fn$;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_notify_google_sheets_sync_solicitacao
    ON compras.solicitacao_compras;

    CREATE TRIGGER trg_notify_google_sheets_sync_solicitacao
    AFTER INSERT OR UPDATE OR DELETE
    ON compras.solicitacao_compras
    FOR EACH STATEMENT
    EXECUTE FUNCTION compras.fn_notify_google_sheets_sync();
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_notify_google_sheets_sync_sem_cadastro
    ON compras.compras_sem_cadastro;

    CREATE TRIGGER trg_notify_google_sheets_sync_sem_cadastro
    AFTER INSERT OR UPDATE OR DELETE
    ON compras.compras_sem_cadastro
    FOR EACH STATEMENT
    EXECUTE FUNCTION compras.fn_notify_google_sheets_sync();
  `);
}

async function iniciarAutoSyncPorEventosPostgres() {
  if (comprasGoogleSheetsSyncState.listenerClient) return;

  await garantirTriggersNotificacaoGoogleSheets();

  const client = await pool.connect();
  comprasGoogleSheetsSyncState.listenerClient = client;

  client.on('notification', (msg) => {
    if (msg.channel !== GOOGLE_SHEETS_SYNC_CHANNEL) return;
    agendarSyncPorEvento(`evento-db:${msg.payload || 'mudanca'}`);
  });

  client.on('error', (err) => {
    console.error('[SheetsAuto] Erro no listener LISTEN/NOTIFY:', err?.message || err);
    try { client.release(); } catch (_) {}
    if (comprasGoogleSheetsSyncState.listenerClient === client) {
      comprasGoogleSheetsSyncState.listenerClient = null;
    }
    setTimeout(() => {
      iniciarAutoSyncPorEventosPostgres().catch((e) => {
        console.error('[SheetsAuto] Falha ao reconectar listener:', e?.message || e);
      });
    }, 5000);
  });

  await client.query(`LISTEN ${GOOGLE_SHEETS_SYNC_CHANNEL}`);
  console.log(`[SheetsAuto] Listener DB ativo no canal ${GOOGLE_SHEETS_SYNC_CHANNEL}.`);

  setTimeout(() => {
    sincronizarComprasGoogleSheets({ force: true, motivo: 'startup' });
  }, 10000);
}

function iniciarAutoSyncComprasGoogleSheets() {
  if (!GOOGLE_SHEETS_AUTOSYNC_ENABLED) {
    console.log('[SheetsAuto] Auto-sync desabilitado por GOOGLE_SHEETS_AUTOSYNC_ENABLED=0');
    return;
  }

  if (!process.env.GOOGLE_SHEETS_WEBHOOK_URL) {
    console.log('[SheetsAuto] Auto-sync não iniciado (GOOGLE_SHEETS_WEBHOOK_URL ausente)');
    return;
  }

  if (GOOGLE_SHEETS_SYNC_MODE === 'polling') {
    if (comprasGoogleSheetsSyncState.timer) {
      clearInterval(comprasGoogleSheetsSyncState.timer);
    }

    setTimeout(() => {
      sincronizarComprasGoogleSheets({ force: true, motivo: 'startup' });
    }, 12000);

    comprasGoogleSheetsSyncState.timer = setInterval(() => {
      sincronizarComprasGoogleSheets({ force: false, motivo: 'intervalo' });
    }, GOOGLE_SHEETS_AUTOSYNC_INTERVAL_MS);

    console.log(`[SheetsAuto] Auto-sync iniciado em polling (intervalo ${GOOGLE_SHEETS_AUTOSYNC_INTERVAL_MS}ms).`);
    return;
  }

  iniciarAutoSyncPorEventosPostgres().catch((err) => {
    console.error('[SheetsAuto] Falha ao iniciar listener do banco:', err?.message || err);
  });
}

app.get('/api/compras/google-sheets/status', async (_req, res) => {
  const planilhaUrl = process.env.GOOGLE_SHEETS_PLANILHA_URL
    || 'https://docs.google.com/spreadsheets/d/1xJT96JbXxqb2SPdCwsNAI55E8EGuEofDOiXbn5iFCDE/edit?usp=sharing';

  res.json({
    ok: true,
    enabled: GOOGLE_SHEETS_AUTOSYNC_ENABLED,
    mode: GOOGLE_SHEETS_SYNC_MODE,
    listenerActive: !!comprasGoogleSheetsSyncState.listenerClient,
    running: comprasGoogleSheetsSyncState.running,
    webhookConfigured: !!process.env.GOOGLE_SHEETS_WEBHOOK_URL,
    planilhaUrl,
    channel: GOOGLE_SHEETS_SYNC_CHANNEL,
    lastSync: {
      at: comprasGoogleSheetsSyncState.lastSyncAt,
      reason: comprasGoogleSheetsSyncState.lastSyncReason,
      status: comprasGoogleSheetsSyncState.lastSyncStatus,
      rows: comprasGoogleSheetsSyncState.lastSyncRows,
      error: comprasGoogleSheetsSyncState.lastSyncError,
    }
  });
});

const OMIE_WEBHOOK_AUTOSYNC_ENABLED = (() => {
  const raw = String(process.env.OMIE_WEBHOOK_AUTOSYNC_ENABLED || '0').trim().toLowerCase();
  return ['1', 'true', 'yes', 'sim', 'on'].includes(raw);
})();
const OMIE_WEBHOOK_AUTOSYNC_RUN_ON_STARTUP = (() => {
  const raw = String(process.env.OMIE_WEBHOOK_AUTOSYNC_RUN_ON_STARTUP || '0').trim().toLowerCase();
  return ['1', 'true', 'yes', 'sim', 'on'].includes(raw);
})();
const OMIE_WEBHOOK_AUTOSYNC_INTERVAL_MS = (() => {
  const parsed = Number(process.env.OMIE_WEBHOOK_AUTOSYNC_INTERVAL_MS || 30 * 60 * 1000);
  if (!Number.isFinite(parsed) || parsed < 60_000) return 30 * 60 * 1000;
  return parsed;
})();
const OMIE_WEBHOOK_AUTOSYNC_PRODUTOS_PAGES_PER_RUN = (() => {
  const parsed = Number(process.env.OMIE_WEBHOOK_AUTOSYNC_PRODUTOS_PAGES_PER_RUN || 1);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
})();

const OMIE_AUTOSYNC_TABELAS_DISPONIVEIS = [
  'produtos_omie',
  'fornecedores',
  'pedidos_compra',
  'requisicoes_compra',
  'recebimentos_nfe',
];

const omieWebhookAutoSyncState = {
  running: false,
  timer: null,
  lastRunAt: null,
  lastDurationMs: null,
  lastStatus: null,
  lastRunReason: null,
  lastRunTasks: [],
  history: [],
  produtosCursor: {
    pagina: 1,
    totalPaginas: 1,
  },
};

function normalizarTabelasAutoSync(tabelas) {
  if (!Array.isArray(tabelas) || tabelas.length === 0) {
    return [...OMIE_AUTOSYNC_TABELAS_DISPONIVEIS];
  }

  const normalizadas = tabelas
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .filter(t => OMIE_AUTOSYNC_TABELAS_DISPONIVEIS.includes(t));

  return normalizadas.length > 0 ? Array.from(new Set(normalizadas)) : [...OMIE_AUTOSYNC_TABELAS_DISPONIVEIS];
}

function obterTarefasAutoSyncOmie(tabelasSelecionadas) {
  const selecionadas = normalizarTabelasAutoSync(tabelasSelecionadas);

  const mapa = {
    produtos_omie: {
      nome: 'produtos_omie',
      fn: () => syncProdutosOmieIncremental(OMIE_WEBHOOK_AUTOSYNC_PRODUTOS_PAGES_PER_RUN),
    },
    fornecedores: {
      nome: 'fornecedores',
      fn: () => syncFornecedoresOmie(),
    },
    pedidos_compra: {
      nome: 'pedidos_compra',
      fn: () => syncPedidosCompraOmie({}),
    },
    requisicoes_compra: {
      nome: 'requisicoes_compra',
      fn: () => syncRequisicoesCompraOmie({}),
    },
    recebimentos_nfe: {
      nome: 'recebimentos_nfe',
      fn: () => syncRecebimentosNFeOmie({}),
    },
  };

  return selecionadas.map(chave => mapa[chave]).filter(Boolean);
}

async function syncProdutosOmieIncremental(paginasPorExecucao = 1) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    return { ok: false, error: 'Credenciais Omie ausentes' };
  }

  const pagesToRun = Math.max(1, Number(paginasPorExecucao) || 1);
  let paginaAtual = Math.max(1, Number(omieWebhookAutoSyncState.produtosCursor.pagina) || 1);
  let totalPaginasConhecidas = Math.max(1, Number(omieWebhookAutoSyncState.produtosCursor.totalPaginas) || 1);
  let processados = 0;
  let sucesso = 0;
  let erros = 0;

  const listarProdutosOmie = async (pagina, tentativa = 1) => {
    const body = {
      call: 'ListarProdutos',
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [{
        pagina,
        registros_por_pagina: 100,
        apenas_importado_api: 'N',
        filtrar_apenas_omiepdv: 'N'
      }]
    };

    const response = await fetch('https://app.omie.com.br/api/v1/geral/produtos/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      return await response.json();
    }

    const errorText = await response.text();
    const errorLower = String(errorText || '').toLowerCase();
    const consumoRedundante = response.status === 500 && errorLower.includes('consumo redundante detectado');

    if (consumoRedundante && tentativa < 3) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return listarProdutosOmie(pagina, tentativa + 1);
    }

    throw new Error(`ListarProdutos falhou (HTTP ${response.status}): ${errorText}`);
  };

  for (let rodada = 0; rodada < pagesToRun; rodada++) {
    let payload;
    try {
      payload = await listarProdutosOmie(paginaAtual);
    } catch (err) {
      console.error(`[OmieAutoSync][produtos] Erro na página ${paginaAtual}:`, err?.message || err);
      break;
    }

    totalPaginasConhecidas = Math.max(1, Number(payload?.total_de_paginas || totalPaginasConhecidas || 1));
    const produtos = Array.isArray(payload?.produto_servico_cadastro) ? payload.produto_servico_cadastro : [];

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.produtos_omie_write_source', 'omie_webhook', true)");

      for (const produto of produtos) {
        processados++;
        try {
          const obj = { ...produto };
          if (!obj.codigo_produto_integracao) {
            obj.codigo_produto_integracao = obj.codigo || String(obj.codigo_produto || '');
          }
          await client.query('SELECT omie_upsert_produto($1::jsonb)', [obj]);
          sucesso++;
        } catch (err) {
          erros++;
          console.error('[OmieAutoSync][produtos] Erro ao fazer upsert de produto:', err?.message || err);
        }
      }
    } finally {
      try { client.release(); } catch (_) {}
    }

    paginaAtual = paginaAtual >= totalPaginasConhecidas ? 1 : paginaAtual + 1;
  }

  omieWebhookAutoSyncState.produtosCursor.pagina = paginaAtual;
  omieWebhookAutoSyncState.produtosCursor.totalPaginas = totalPaginasConhecidas;

  console.log(`[OmieAutoSync][produtos] Páginas processadas: ${pagesToRun}, produtos: ${processados}, sucesso: ${sucesso}, erros: ${erros}, próxima página: ${paginaAtual}/${totalPaginasConhecidas}`);

  return { ok: true, processados, sucesso, erros, proxima_pagina: paginaAtual, total_paginas: totalPaginasConhecidas };
}

async function executarAutoSyncWebhooksOmie(motivo = 'intervalo', tabelasSelecionadas = null) {
  if (omieWebhookAutoSyncState.running) {
    console.log(`[OmieAutoSync] Execução ignorada (${motivo}) - sincronização anterior ainda em andamento.`);
    return { ok: false, error: 'sync_em_andamento' };
  }

  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    console.log('[OmieAutoSync] Credenciais Omie ausentes. Auto-sync não executado.');
    return;
  }

  const inicio = Date.now();
  omieWebhookAutoSyncState.running = true;
  omieWebhookAutoSyncState.lastStatus = 'running';
  omieWebhookAutoSyncState.lastRunReason = motivo;
  const tarefasResumo = [];

  try {
    console.log(`[OmieAutoSync] Iniciando sincronização automática (${motivo})...`);

    const tarefas = obterTarefasAutoSyncOmie(tabelasSelecionadas);

    for (const tarefa of tarefas) {
      const tarefaInicio = Date.now();
      try {
        const resultado = await tarefa.fn();
        const ok = !!resultado?.ok;
        tarefasResumo.push({
          tabela: tarefa.nome,
          ok,
          duration_ms: Date.now() - tarefaInicio,
          details: resultado || null,
          error: ok ? null : (resultado?.error || 'sem detalhe'),
        });
        if (!resultado?.ok) {
          console.warn(`[OmieAutoSync] ${tarefa.nome} finalizou com aviso: ${resultado?.error || 'sem detalhe'}`);
        }
      } catch (err) {
        tarefasResumo.push({
          tabela: tarefa.nome,
          ok: false,
          duration_ms: Date.now() - tarefaInicio,
          details: null,
          error: err?.message || String(err),
        });
        console.error(`[OmieAutoSync] Erro em ${tarefa.nome}:`, err?.message || err);
      }
    }

    const duracao = Date.now() - inicio;
    const teveErro = tarefasResumo.some(t => !t.ok);
    omieWebhookAutoSyncState.lastRunAt = new Date().toISOString();
    omieWebhookAutoSyncState.lastDurationMs = duracao;
    omieWebhookAutoSyncState.lastStatus = teveErro ? 'partial_error' : 'ok';
    omieWebhookAutoSyncState.lastRunTasks = tarefasResumo;
    omieWebhookAutoSyncState.history.unshift({
      at: omieWebhookAutoSyncState.lastRunAt,
      reason: motivo,
      duration_ms: duracao,
      status: omieWebhookAutoSyncState.lastStatus,
      tasks: tarefasResumo,
    });
    if (omieWebhookAutoSyncState.history.length > 30) {
      omieWebhookAutoSyncState.history = omieWebhookAutoSyncState.history.slice(0, 30);
    }
    console.log(`[OmieAutoSync] Sincronização automática concluída em ${duracao}ms.`);
    return {
      ok: !teveErro,
      status: omieWebhookAutoSyncState.lastStatus,
      duration_ms: duracao,
      tasks: tarefasResumo,
    };
  } catch (err) {
    const duracao = Date.now() - inicio;
    omieWebhookAutoSyncState.lastRunAt = new Date().toISOString();
    omieWebhookAutoSyncState.lastDurationMs = duracao;
    omieWebhookAutoSyncState.lastStatus = `error: ${err?.message || err}`;
    omieWebhookAutoSyncState.lastRunTasks = tarefasResumo;
    omieWebhookAutoSyncState.history.unshift({
      at: omieWebhookAutoSyncState.lastRunAt,
      reason: motivo,
      duration_ms: duracao,
      status: omieWebhookAutoSyncState.lastStatus,
      tasks: tarefasResumo,
    });
    if (omieWebhookAutoSyncState.history.length > 30) {
      omieWebhookAutoSyncState.history = omieWebhookAutoSyncState.history.slice(0, 30);
    }
    console.error('[OmieAutoSync] Falha geral na sincronização automática:', err?.message || err);
    return { ok: false, error: err?.message || String(err), tasks: tarefasResumo };
  } finally {
    omieWebhookAutoSyncState.running = false;
  }
}

function iniciarAutoSyncWebhooksOmie() {
  if (!OMIE_WEBHOOK_AUTOSYNC_ENABLED) {
    console.log('[OmieAutoSync] Auto-sync desabilitado (defina OMIE_WEBHOOK_AUTOSYNC_ENABLED=1 para habilitar).');
    return;
  }

  if (omieWebhookAutoSyncState.timer) {
    clearInterval(omieWebhookAutoSyncState.timer);
    omieWebhookAutoSyncState.timer = null;
  }

  if (OMIE_WEBHOOK_AUTOSYNC_RUN_ON_STARTUP) {
    setTimeout(() => {
      executarAutoSyncWebhooksOmie('startup');
    }, 15000);
  }

  omieWebhookAutoSyncState.timer = setInterval(() => {
    executarAutoSyncWebhooksOmie('intervalo');
  }, OMIE_WEBHOOK_AUTOSYNC_INTERVAL_MS);

  console.log(`[OmieAutoSync] Agendado para cada ${OMIE_WEBHOOK_AUTOSYNC_INTERVAL_MS}ms.`);
}

app.get('/api/omie/autosync/status', async (_req, res) => {
  res.json({
    ok: true,
    enabled: OMIE_WEBHOOK_AUTOSYNC_ENABLED,
    interval_ms: OMIE_WEBHOOK_AUTOSYNC_INTERVAL_MS,
    produtos_pages_per_run: OMIE_WEBHOOK_AUTOSYNC_PRODUTOS_PAGES_PER_RUN,
    running: omieWebhookAutoSyncState.running,
    last_run_at: omieWebhookAutoSyncState.lastRunAt,
    last_duration_ms: omieWebhookAutoSyncState.lastDurationMs,
    last_status: omieWebhookAutoSyncState.lastStatus,
    last_run_reason: omieWebhookAutoSyncState.lastRunReason,
    last_run_tasks: omieWebhookAutoSyncState.lastRunTasks,
    tabelas_disponiveis: OMIE_AUTOSYNC_TABELAS_DISPONIVEIS,
    produtos_cursor: omieWebhookAutoSyncState.produtosCursor,
  });
});

app.get('/api/omie/autosync/history', async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
  res.json({
    ok: true,
    history: omieWebhookAutoSyncState.history.slice(0, limit),
  });
});

app.post('/api/omie/autosync/run', express.json(), async (req, res) => {
  const tabelas = normalizarTabelasAutoSync(req.body?.tabelas || req.body?.tables || []);
  const motivo = req.body?.motivo ? String(req.body.motivo) : 'manual';
  const resultado = await executarAutoSyncWebhooksOmie(motivo, tabelas);
  if (!resultado?.ok && resultado?.error === 'sync_em_andamento') {
    return res.status(409).json({ ok: false, error: 'Sincronização já está em andamento' });
  }
  return res.json({
    ok: !!resultado?.ok,
    tabelas,
    resultado,
  });
});

const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
  iniciarAutoSyncComprasGoogleSheets();
  iniciarAutoSyncWebhooksOmie();
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
          cab.produto_unidade       AS pai_unidade,
          COALESCE(oe.descr_produto, po.descricao) AS pai_descr_omie,
          COALESCE(oe.id_produto, po.codigo_produto::BIGINT) AS pai_id_omie,
          COALESCE(oe.unidade, po.unidade)          AS pai_unidade_omie,
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
        LEFT JOIN public.produtos_omie po ON TRIM(UPPER(po.codigo)) = TRIM(UPPER(cab.produto_codigo))
        LEFT JOIN LATERAL (
          SELECT descr_produto, id_produto, unidade
          FROM omie_estrutura
          WHERE CAST(int_produto AS BIGINT) = cab.produto_id
          ORDER BY id_produto
          LIMIT 1
        ) oe ON TRUE
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
      pai_descr_omie : r.pai_descr_omie || '',
      pai_id_omie    : r.pai_id_omie ? Number(r.pai_id_omie) : null,
      pai_unid       : r.pai_unidade_omie || r.pai_unidade || '',
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

// [PCP] Mapa de Qtd prod por código (conta OPs abertas/ativas ligadas ao produto)
// Espera body: { codigos: ["03.PP.N.10923", "04.PP.N.51006", ...] }
// Retorna: { "03.PP.N.10923": 1, "04.PP.N.51006": 0, ... }
app.post('/api/pcp/qtd_prod', express.json(), async (req, res) => {
  const codigos = Array.isArray(req.body?.codigos) ? req.body.codigos.map(String) : [];
  if (!codigos.length) return res.json({});

  const client = await pool.connect();
  try {
    // Ajuste as colunas/etapas conforme seu schema real:
    // c_cod_int_prod: código do produto
    // c_etapa 20/40: estados de produção (ex.: "A Produzir" / "Produzindo")
    const sql = `
      WITH alvo AS (SELECT UNNEST($1::text[]) AS cod)
      SELECT a.cod,
             COALESCE((
               SELECT COUNT(*)
               FROM public.kanban_preparacao_view k
               JOIN public.op_info oi ON oi.n_cod_op = k.n_cod_op
               WHERE k.c_cod_int_prod::text = a.cod
                 AND oi.c_etapa IN ('20','40')
             ), 0) AS qtd_prod
      FROM alvo a
    `;
    const { rows } = await client.query(sql, [codigos]);
    const out = {};
    for (const r of rows) out[r.cod] = Number(r.qtd_prod) || 0;
    res.json(out);
  } catch (err) {
    console.error('[pcp/qtd_prod] erro:', err);
    res.status(500).json({ error: 'Falha ao calcular qtd_prod' });
  } finally {
    client.release();
  }
});
// [Estrutura] Meta (versao / modificador) por cod_produto ou parentId
// Uso: GET /api/estrutura/meta?cod_produto=XXX  (ou ?cod=XXX)  ou  ?parentId=123
app.get('/api/estrutura/meta', async (req, res) => {
  const { cod_produto, cod, parentId } = req.query || {};
  const client = await pool.connect();
  try {
    let row = null;

    if (parentId) {
      const r = await client.query(
        `SELECT id, cod_produto, COALESCE(versao,1) AS versao, modificador,
                "local_produção" AS local_producao
           FROM public.omie_estrutura
          WHERE id = $1
          LIMIT 1`,
        [parentId]
      );
      row = r?.rows?.[0] || null;
    } else if (cod_produto || cod) {
      const c = String(cod_produto || cod).trim();

      // 1ª tentativa: match exato com TRIM/UPPER
      const r1 = await client.query(
        `SELECT id, cod_produto, COALESCE(versao,1) AS versao, modificador,
                "local_produção" AS local_producao
           FROM public.omie_estrutura
          WHERE UPPER(TRIM(cod_produto)) = UPPER(TRIM($1))
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        [c]
      );
      row = r1?.rows?.[0] || null;

      // 2ª tentativa: prefixo (quando o código vem com sufixo)
      if (!row) {
        const r2 = await client.query(
          `SELECT id, cod_produto, COALESCE(versao,1) AS versao, modificador,
                  "local_produção" AS local_producao
             FROM public.omie_estrutura
            WHERE TRIM(cod_produto) ILIKE TRIM($1) || '%'
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 1`,
          [c]
        );
        row = r2?.rows?.[0] || null;
      }
    } else {
      return res.status(400).json({ error: 'Informe cod_produto/cod ou parentId' });
    }

    if (!row) return res.status(404).json({ error: 'Estrutura não encontrada' });

    if (!row.modificador || !String(row.modificador).trim()) row.modificador = null;

    return res.json(row);
  } catch (e) {
    console.error('[GET /api/estrutura/meta] erro:', e);
    return res.status(500).json({ error: 'Erro interno' });
  } finally {
    client.release();
  }
});


// === PCP: substituir estrutura (IMPORT CSV) usando pai_codigo ===
app.post('/api/pcp/estrutura/replace', express.json({ limit: '8mb' }), async (req, res) => {
  // defensivo: se veio HTML por engano (proxy/404), não tente parsear como JSON
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) {
    const raw = (req.rawBody || '').toString();
    const snippet = raw.slice(0, 200);
    console.error('[IMPORT][BOM] Conteúdo não-JSON recebido na rota:', { ct, snippet });
    return res.status(415).json({ ok:false, error:'Content-Type inválido. Envie application/json.' });
  }

  // helper: número com vírgula, vazio vira null
  const parseNumber = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/\./g, '').replace(',', '.');
    if (s === '' || s.toUpperCase() === 'NULL') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  // helper: normaliza linhas no formato do CSV "Listagem dos Materiais (B.O.M.)"
  function mapFromBOMRows(bomRows = []) {
    return bomRows.map(r => {
      const comp_descricao = (r['Identificação do Produto'] ?? '').toString().trim();
      const comp_codigo    = (r['Descrição do Produto'] ?? '').toString().trim();
      const comp_qtd       = parseNumber(r['Qtde Prevista']);
      const comp_unid      = (r['Unidade'] ?? '').toString().trim() || null;
      return { comp_codigo, comp_descricao, comp_qtd, comp_unid };
    }).filter(x => x.comp_codigo); // descarta linhas sem código
  }

  try {
    const { pai_codigo, itens, bom } = req.body || {};
    if (!pai_codigo || typeof pai_codigo !== 'string' || !pai_codigo.trim()) {
      return res.status(400).json({ ok:false, error:'Informe pai_codigo (string).' });
    }

    // aceita ou itens normalizados, ou linhas do CSV (bom)
    let rows = Array.isArray(itens) ? itens : Array.isArray(bom) ? mapFromBOMRows(bom) : [];
    if (!rows.length) {
      return res.status(400).json({ ok:false, error:'Nenhum item para importar. Envie "itens" ou "bom".' });
    }

    // saneamento final
    rows = rows.map(r => ({
      comp_codigo:    (r.comp_codigo ?? '').toString().trim(),
      comp_descricao: (r.comp_descricao ?? '').toString().trim() || null,
      comp_qtd:       parseNumber(r.comp_qtd) ?? 0,
      comp_unid:      (r.comp_unid ?? '').toString().trim() || null,
    })).filter(r => r.comp_codigo);

    // nome da tabela base da estrutura (ajuste aqui se seu nome é outro)
    const TABLE = process.env.PCP_ESTRUTURA_TABLE || 'pcp_estrutura';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // apaga estrutura atual desse pai
      await client.query(`DELETE FROM ${TABLE} WHERE pai_codigo = $1`, [pai_codigo]);

      // insere a nova estrutura
      const text = `
        INSERT INTO ${TABLE} (pai_codigo, comp_codigo, comp_descricao, comp_qtd, comp_unid)
        VALUES ($1, $2, $3, $4, $5)
      `;
      for (const r of rows) {
        await client.query(text, [pai_codigo, r.comp_codigo, r.comp_descricao, r.comp_qtd, r.comp_unid]);
      }

      await client.query('COMMIT');
      return res.json({ ok:true, pai_codigo, inseridos: rows.length });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[IMPORT][BOM][SQL][ERR]', e);
      return res.status(500).json({ ok:false, error: e.message || 'Falha ao gravar estrutura' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[IMPORT][BOM][FATAL]', err);
    return res.status(500).json({ ok:false, error:'Erro inesperado no import' });
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

// === DEBUG: lista as rotas que o Express enxerga ===========================
app.get('/api/_where', (req, res) => {
  try {
    const routes = [];
    app._router.stack.forEach((m) => {
      if (m.route && m.route.path) {
        const methods = Object.keys(m.route.methods).join(',').toUpperCase();
        routes.push({ path: m.route.path, methods });
      } else if (m.name === 'router' && m.handle?.stack) {
        m.handle.stack.forEach((h) => {
          if (h.route && h.route.path) {
            const methods = Object.keys(h.route.methods).join(',').toUpperCase();
            routes.push({ path: (m.regexp?.toString() || '') + h.route.path, methods });
          }
        });
      }
    });
    res.json({ file: __filename, routes });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});
// ==========================================================================
