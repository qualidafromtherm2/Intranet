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

// Conexão Postgres (Render)
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
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
        ARRAY['${schemaTable}']::text[] AS fontes
      FROM (
        SELECT DISTINCT
          codigo::text   AS codigo,
          descricao::text AS descricao
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

    const { rows } = await pool.query(`
      SELECT 
        id,
        produto_codigo,
        produto_descricao,
        quantidade,
        responsavel,
        observacao,
        prazo_solicitado,
        prazo_estipulado,
        quem_recebe,
        solicitante,
        status,
        criado_em
      FROM compras.solicitacao_compras
      ORDER BY criado_em DESC, id DESC;
    `);

    res.json({ solicitacoes: rows });
  } catch (err) {
    console.error('[API] /api/compras/solicitacoes erro:', err);
    res.status(500).json({ error: 'Falha ao listar solicitações de compras' });
  }
});

// Atualiza status ou previsão de chegada de uma solicitação
app.put('/api/compras/solicitacoes/:id', express.json(), async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

    const { status, prazo_estipulado, quem_recebe } = req.body || {};
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

// ============================================================================
// WEBHOOK DE PEDIDOS DE COMPRA DA OMIE
// Eventos: CompraProduto.Incluida, CompraProduto.Alterada, CompraProduto.Cancelada
//          CompraProduto.Encerrada, CompraProduto.EtapaAlterada, CompraProduto.Excluida
// ============================================================================

app.post(['/webhooks/omie/pedidos-compra', '/api/webhooks/omie/pedidos-compra'],
  chkOmieToken,
  express.json(),
  async (req, res) => {
    try {
      const body = req.body || {};
      const event = body.event || body;
      
      // Log do webhook recebido
      console.log('[webhooks/omie/pedidos-compra] Webhook recebido:', JSON.stringify(body, null, 2));
      
      // Campos que podem vir no webhook da Omie
      const topic = body.topic || event.topic || '';  // Ex: "CompraProduto.Incluida"
      const nCodPed = event.nCodPed || 
                      event.n_cod_ped || 
                      body.nCodPed ||
                      body.n_cod_ped ||
                      event.codigo_pedido ||
                      body.codigo_pedido;
      
      if (!nCodPed) {
        console.warn('[webhooks/omie/pedidos-compra] Webhook sem nCodPed:', JSON.stringify(body));
        return res.json({ ok: true, msg: 'Sem nCodPed para processar' });
      }
      
      console.log(`[webhooks/omie/pedidos-compra] Processando evento "${topic}" para pedido ${nCodPed}`);
      
      // Se for exclusão ou cancelamento, apenas marca como inativo no banco
      if (topic.includes('Excluida') || topic.includes('Cancelada') || event.excluido || body.excluido) {
        await pool.query(`
          UPDATE compras.pedidos_omie 
          SET inativo = true, 
              evento_webhook = $1,
              data_webhook = NOW(),
              updated_at = NOW()
          WHERE n_cod_ped = $2
        `, [topic, nCodPed]);
        
        const acao = topic.includes('Excluida') ? 'excluido' : 'cancelado';
        console.log(`[webhooks/omie/pedidos-compra] Pedido ${nCodPed} marcado como inativo (${acao})`);
        
        return res.json({ 
          ok: true, 
          n_cod_ped: nCodPed,
          acao: acao,
          atualizado: true 
        });
      }
      
      // Para inclusão, alteração, encerramento ou mudança de etapa, busca dados completos na API da Omie
      const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarPedCompra',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{
            nCodPed: parseInt(nCodPed)
          }]
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[webhooks/omie/pedidos-compra] Erro na API Omie: ${response.status} - ${errorText}`);
        throw new Error(`Omie API retornou ${response.status}`);
      }
      
      const pedido = await response.json();
      
      // Atualiza no banco
      await upsertPedidoCompra(pedido, topic);
      
      const acao = topic.includes('Incluida') ? 'incluido' : 
                   topic.includes('Encerrada') ? 'encerrado' :
                   topic.includes('EtapaAlterada') ? 'etapa alterada' : 'alterado';
      console.log(`[webhooks/omie/pedidos-compra] Pedido ${nCodPed} ${acao} com sucesso`);
      
      res.json({ 
        ok: true, 
        n_cod_ped: nCodPed,
        acao: acao,
        atualizado: true 
      });
    } catch (err) {
      console.error('[webhooks/omie/pedidos-compra] erro:', err);
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

// Endpoint para buscar categorias de compra da Omie
// Objetivo: Listar categorias de despesa ativas para uso no módulo de compras
// Filtra apenas categorias que são conta de despesa (S) e não estão inativas (N)
app.get('/api/compras/categorias', async (req, res) => {
  try {
    console.log('[API /api/compras/categorias] Buscando categorias da Omie...');
    
    // Busca categorias usando a API correta da Omie
    // Endpoint: /api/v1/geral/categorias/ - ListarCategorias
    const response = await fetch('https://app.omie.com.br/api/v1/geral/categorias/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarCategorias',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina: 1,
          registros_por_pagina: 500
        }]
      })
    });
    
    const data = await response.json();
    
    // Verifica se houve erro na resposta da Omie
    if (data.faultstring) {
      throw new Error(data.faultstring);
    }
    
    console.log('[API /api/compras/categorias] Total de categorias retornadas:', data.total_de_registros);
    
    // Filtra categorias:
    // - conta_despesa: "S" (apenas contas de despesa)
    // - conta_inativa: "N" (apenas contas ativas)
    // - categoria_superior: "2.01" (categoria específica)
    const categorias = (data.categoria_cadastro || [])
      .filter(cat => {
        return cat.conta_despesa === 'S' && 
               cat.conta_inativa === 'N' && 
               cat.categoria_superior === '2.01';
      })
      .map(cat => ({
        codigo: cat.codigo,
        descricao: cat.descricao
      }));
    
    console.log('[API /api/compras/categorias] Categorias filtradas (despesa ativa):', categorias.length);
    
    res.json({ 
      ok: true, 
      total: categorias.length,
      categorias 
    });
  } catch (err) {
    console.error('[API /api/compras/categorias] Erro:', err.message);
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
    const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(omiePayload)
    });
    
    const data = await response.json();
    
    console.log('\n📥 RESPOSTA DA OMIE:');
    console.log('   Status HTTP:', response.status);
    console.log('   Dados:', JSON.stringify(data, null, 2));
    
    if (data.faultstring) {
      console.log('❌ Erro na API da Omie!');
      console.log('   Código:', data.faultcode);
      console.log('   Mensagem:', data.faultstring);
      throw new Error(data.faultstring);
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
    const supabaseUrl = process.env.SUPABASE_URL || 'https://ycmphrzqozxmzlqfxpca.supabase.co';
    const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljbXBocnpxb3p4bXpscWZ4cGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzEzNTIyOTAsImV4cCI6MjA0NjkyODI5MH0.KHCQiFVq30MBq1DPp7snlz0xqZs61aEhZl5AE42-O3E';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const filePath = req.body.path || `uploads/${Date.now()}_${req.file.originalname}`;
    
    const { data, error } = await supabase.storage
      .from('compras-anexos')
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
      .from('compras-anexos')
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
        solicitacao_id INTEGER NOT NULL REFERENCES compras.solicitacao_compras(id) ON DELETE CASCADE,
        fornecedor_nome TEXT NOT NULL,
        fornecedor_id TEXT,
        valor_cotado DECIMAL(15,2),
        observacao TEXT,
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
      tags
    } = cliente;
    
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
  } catch (e) {
    console.error('[Fornecedores] Erro ao fazer upsert:', e);
  }
}

// ============================================================================
// Upsert de um pedido de compra no banco (tabelas no schema compras)
// ============================================================================
async function upsertPedidoCompra(pedido, eventoWebhook = '') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Extrai os dados do cabeçalho
    const cabecalho = pedido.cabecalho || pedido.cabecalho_consulta || {};
    const produtos = pedido.produtos || pedido.produtos_consulta || [];
    const frete = pedido.frete || pedido.frete_consulta || {};
    const parcelas = pedido.parcelas || pedido.parcelas_consulta || [];
    const departamentos = pedido.departamentos || pedido.departamentos_consulta || [];
    
    const nCodPed = cabecalho.nCodPed || cabecalho.n_cod_ped;
    
    if (!nCodPed) {
      throw new Error('nCodPed não encontrado no pedido');
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
        evento_webhook, data_webhook, updated_at
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
        $26, NOW(), NOW()
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
        data_webhook = NOW(),
        updated_at = NOW()
    `, [
      nCodPed,
      cabecalho.cCodIntPed || cabecalho.c_cod_int_ped || null,
      cabecalho.cNumero || cabecalho.c_numero || null,
      cabecalho.dIncData || cabecalho.d_inc_data || null,
      cabecalho.cIncHora || cabecalho.c_inc_hora || null,
      cabecalho.dDtPrevisao || cabecalho.d_dt_previsao || null,
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
      eventoWebhook
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
          parc.dVencto || parc.d_vencto || null,
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
          retorno_cotacao,
          codigo_produto_omie
        } = item;
        
        if (!produto_codigo || !quantidade) {
          throw new Error('Cada item precisa ter produto_codigo e quantidade');
        }
        
        // Define status inicial baseado no retorno_cotacao
        // Se retorno_cotacao = 'N' ou 'Não' -> 'aguardando compra'
        // Se retorno_cotacao = 'S' ou 'Sim' -> 'aguardando cotação'
        const statusInicial = (retorno_cotacao === 'N' || retorno_cotacao === 'Não') ? 'aguardando compra' : 'aguardando cotação';
        
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
            retorno_cotacao,
            codigo_produto_omie,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
          RETURNING id
        `, [
          produto_codigo,
          produto_descricao || '',
          quantidade,
          prazo_solicitado || null,
          familia_nome || null,
          statusInicial,
          observacao || '',
          solicitante,
          departamento || null,
          centro_custo || null,
          objetivo_compra || null,
          resp_inspecao_recebimento || solicitante,
          retorno_cotacao || null,
          codigo_produto_omie || null
        ]);
        
        idsInseridos.push(result.rows[0].id);
      }
      
      await client.query('COMMIT');
      
      console.log(`[Compras] ${itens.length} item(ns) criado(s) por ${solicitante} - IDs: ${idsInseridos.join(', ')}`);
      
      res.json({
        ok: true,
        total_itens: itens.length,
        ids: idsInseridos
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
      return res.status(500).json({ ok: false, error: 'Erro ao consultar Omie' });
    }
    
    const omieData = await omieResp.json();
    
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
      res.json({ ok: true, url_imagem: null });
    }
  } catch (err) {
    console.error('[Compras] Erro ao buscar imagem fresca:', err);
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
        solicitante,
        resp_inspecao_recebimento,
        departamento,
        centro_custo,
        objetivo_compra,
        created_at,
        updated_at,
        cnumero AS "cNumero",
        ncodped AS "nCodPed"
      FROM compras.solicitacao_compras
      WHERE solicitante = $1
      ORDER BY created_at DESC
      LIMIT 500
    `, [solicitante]);
    
    res.json({ ok: true, solicitacoes: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar minhas solicitações:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar solicitações' });
  }
});

// GET /api/compras/todas - Lista todas as solicitações (para gestores)
app.get('/api/compras/todas', async (req, res) => {
  try {
    const { rows } = await pool.query(`
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
        solicitante,
        resp_inspecao_recebimento,
        departamento,
        centro_custo,
        objetivo_compra,
        fornecedor_nome,
        fornecedor_id,
        familia_produto,
        anexos,
        created_at,
        updated_at,
        cnumero AS "cNumero",
        ncodped AS "nCodPed"
      FROM compras.solicitacao_compras
      ORDER BY created_at DESC
      LIMIT 1000
    `);
    
    res.json({ ok: true, solicitacoes: rows });
  } catch (err) {
    console.error('[Compras] Erro ao listar todas solicitações:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar solicitações' });
  }
});

// PUT /api/compras/item/:id - Atualiza uma solicitação individual
app.put('/api/compras/item/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }

    const { status, previsao_chegada, observacao, resp_inspecao_recebimento, fornecedor_nome, fornecedor_id, categoria_compra, categoria_compra_codigo, anexos, cod_parc, qtde_parc, contato, contrato, obs_interna, cotacoes_aprovadas_ids } = req.body || {};
    
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
        const supabaseUrl = process.env.SUPABASE_URL || 'https://ycmphrzqozxmzlqfxpca.supabase.co';
        const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljbXBocnpxb3p4bXpscWZ4cGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzEzNTIyOTAsImV4cCI6MjA0NjkyODI5MH0.KHCQiFVq30MBq1DPp7snlz0xqZs61aEhZl5AE42-O3E';
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
    const { solicitacao_id, fornecedor_nome, fornecedor_id, valor_cotado, observacao, anexos, criado_por } = req.body || {};
    
    if (!solicitacao_id || !fornecedor_nome) {
      return res.status(400).json({ ok: false, error: 'solicitacao_id e fornecedor_nome são obrigatórios' });
    }
    
    // Processa anexos se houver
    let anexosUrls = null;
    if (anexos && Array.isArray(anexos) && anexos.length > 0) {
      console.log(`[Cotações] Processando ${anexos.length} anexos para solicitacao_id ${solicitacao_id}`);
      
      // Salva os anexos diretamente como base64 no JSONB (sem Supabase por enquanto)
      anexosUrls = anexos.map(anexo => ({
        nome: anexo.nome,
        tipo: anexo.tipo || 'application/octet-stream',
        tamanho: anexo.tamanho || 0,
        base64: anexo.base64
      }));
      
      console.log(`[Cotações] ${anexosUrls.length} anexos salvos como base64`);
    }
    
    const { rows } = await pool.query(`
      INSERT INTO compras.cotacoes 
        (solicitacao_id, fornecedor_nome, fornecedor_id, valor_cotado, observacao, anexos, criado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      solicitacao_id,
      fornecedor_nome,
      fornecedor_id || null,
      valor_cotado || null,
      observacao || null,
      anexosUrls ? JSON.stringify(anexosUrls) : null,
      criado_por || null
    ]);
    
    console.log('[Cotações] Cotação salva:', {
      id: rows[0].id,
      fornecedor: rows[0].fornecedor_nome,
      anexos_count: anexosUrls ? anexosUrls.length : 0
    });
    
    res.json({ ok: true, cotacao: rows[0] });
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
    
    const { rows } = await pool.query(`
      SELECT * FROM compras.cotacoes 
      WHERE solicitacao_id = $1 
      ORDER BY criado_em DESC
    `, [solicitacao_id]);
    
    res.json(rows);
  } catch (err) {
    console.error('[Cotações] Erro ao listar cotações:', err);
    res.status(500).json({ ok: false, error: 'Erro ao listar cotações' });
  }
});

// PUT /api/compras/cotacoes/:id - Atualiza uma cotação
app.put('/api/compras/cotacoes/:id', express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido' });
    }
    
    const { fornecedor_nome, fornecedor_id, valor_cotado, observacao, anexos } = req.body || {};
    
    const fields = [];
    const values = [];
    let idx = 1;
    
    // Processa anexos se houver
    let anexosUrls = null;
    if (anexos && Array.isArray(anexos) && anexos.length > 0) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL || 'https://ycmphrzqozxmzlqfxpca.supabase.co';
        const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljbXBocnpxb3p4bXpscWZ4cGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzEzNTIyOTAsImV4cCI6MjA0NjkyODI5MH0.KHCQiFVq30MBq1DPp7snlz0xqZs61aEhZl5AE42-O3E';
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
    
    if (fields.length === 0) {
      return res.status(400).json({ ok: false, error: 'Nenhum campo para atualizar' });
    }
    
    fields.push(`atualizado_em = NOW()`);
    values.push(id);
    
    const { rows } = await pool.query(`
      UPDATE compras.cotacoes 
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `, values);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Cotação não encontrada' });
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

// Endpoint para alterar status de um item de compra
app.put('/api/compras/itens/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Valida status
    const statusValidos = ['pendente', 'aguardando cotação', 'cotada', 'aguardando compra', 'aprovado', 'recusado'];
    if (!status || !statusValidos.includes(status)) {
      return res.status(400).json({ 
        ok: false, 
        error: `Status inválido. Use: ${statusValidos.join(', ')}` 
      });
    }
    
    // Atualiza status do item
    const { rows } = await pool.query(`
      UPDATE compras.solicitacao_compras 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [status, id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }
    
    res.json({ ok: true, item: rows[0] });
    
  } catch (err) {
    console.error('[Compras] Erro ao atualizar status do item:', err);
    res.status(500).json({ ok: false, error: 'Erro ao atualizar status do item' });
  }
});

// Endpoint para excluir um item de compra
app.delete('/api/compras/itens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verifica se o item existe
    const { rows: itemRows } = await pool.query(`
      SELECT * FROM compras.solicitacao_compras WHERE id = $1
    `, [id]);
    
    if (itemRows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Item não encontrado' });
    }
    
    // Exclui o item (as cotações serão excluídas automaticamente por CASCADE)
    await pool.query(`
      DELETE FROM compras.solicitacao_compras WHERE id = $1
    `, [id]);
    
    res.json({ ok: true, message: 'Item excluído com sucesso' });
    
  } catch (err) {
    console.error('[Compras] Erro ao excluir item:', err);
    res.status(500).json({ ok: false, error: 'Erro ao excluir item' });
  }
});

// ========== FIM ENDPOINTS DE COTAÇÕES ==========

const PORT = process.env.PORT || 5001;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
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
