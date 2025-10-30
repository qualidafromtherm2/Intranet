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
// ===== Ingestão inicial de OPs (Omie → Postgres) ============================
const OP_REGS_PER_PAGE = 200; // ajuste fino: 100~500 (Omie aceita até 500)

// ==== SSE (Server-Sent Events) para avisar o front ao vivo ==================
const sseClients = new Set();
// server.js — sessão/cookies (COLE ANTES DAS ROTAS!)

// 🔐 Sessão (cookies) — DEVE vir antes das rotas /api/*
const isProd = process.env.NODE_ENV === 'production';
const callOmieDedup = require('./utils/callOmieDedup');
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
app.post('/api/produtos/busca', async (req, res) => {
  try {
    const q = String(req.body?.q || '').trim();
    if (q.length < 2) return res.json({ itens: [] });

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
    console.error('[API] /api/produtos/busca erro:', err);
    res.status(500).json({ error: 'Falha na busca' });
  }
});



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

//app.use(require('express').json({ limit: '5mb' }));

app.use('/api/produtos', produtosRouter);

// adiciona o router das fotos no MESMO prefixo:
app.use('/api/produtos', produtosFotosRouter);

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

    const sql = `
      INSERT INTO "OrdemProducao".tab_op
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
          (numero_op, codigo_produto, tipo_etiqueta, local_impressao, conteudo_zpl, usuario_criacao, observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, data_criacao
      `;

      ({ personalizacaoId, sufixoCustom } = await registrarPersonalizacao(client, {
        codigoPai: codigo,
        versaoBase: versaoPai,
        usuario,
        customizacoes
      }));

      const opsGerados = [];
      for (let i = 0; i < quantidadePai; i++) {
        const { numero_op: numeroBase } = await gerarProximoNumeroOP(client, 'OP');
        const numeroCompleto = `${numeroBase}${sufixoPai}${sufixoCustom}`;
        const zplPai = await gerarEtiquetaCompactaZPL({
          numeroOP: numeroCompleto,
          codigo,
          ns,
          produtoDet
        });

        const paramsPai = [
          numeroCompleto,
          codigo,
          'Aguardando prazo',
          'Montagem',
          zplPai,
          usuario,
          obs
        ];

        const { rows: rowPai } = await client.query(insertSql, paramsPai);
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
        let descricaoPP = String(raw?.descricao || '').trim();
        if (!descricaoPP) {
          descricaoPP = await obterDescricaoProduto(client, codigoPP) || 'SEM DESCRIÇÃO';
        }
        const localImpressao = operacao || 'Montagem';
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
            'Aguardando prazo',
            localImpressao,
            zplPP,
            usuario,
            obs
          ];

          const { rows: rowPP } = await client.query(insertSql, paramsPP);
          geradosOps.push({
            numero_op: numeroOpsSeq,
            id: rowPP?.[0]?.id || null,
            data_criacao: rowPP?.[0]?.data_criacao || null
          });
        }

        ppResultados.push({
          codigo: codigoPP,
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

      const localImpressao = await obterOperacaoPorCodigo(client, codigo) || 'Montagem';
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
          (numero_op, codigo_produto, tipo_etiqueta, local_impressao, conteudo_zpl, usuario_criacao, observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, data_criacao
      `;

      const registros = [];
      for (let i = 0; i < qtdInt; i++) {
        const { numero_op: baseNumero } = await gerarProximoNumeroOP(client, 'OPS');
        const numeroCompleto = `${baseNumero}${sufixoPP}${sufixoCustom}`;
        const zpl = gerarEtiquetaPPZPL({ codMP: codigo, op: numeroCompleto, descricao });

        const params = [
          numeroCompleto,
          codigo,
          'Aguardando prazo',
          localImpressao,
          zpl,
          usuario,
          obs
        ];

        const { rows } = await client.query(insertSql, params);
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

    const sql = `
      INSERT INTO "OrdemProducao".tab_op
        (numero_op, codigo_produto, tipo_etiqueta, local_impressao,
         conteudo_zpl, impressa, usuario_criacao, observacoes)
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

  const sql = `
    INSERT INTO "OrdemProducao".tab_op
      (numero_op, codigo_produto, tipo_etiqueta, local_impressao,
       conteudo_zpl, impressa, usuario_criacao, observacoes)
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

    const { rows } = await pool.query(`
      SELECT
        v.local,
        v.produto_codigo     AS codigo,
        v.produto_descricao  AS descricao,
        v.estoque_minimo     AS min,
        v.fisico,
        v.reservado,
        v.saldo,
        v.cmc,
        pos.omie_prod_id     AS cod_omie,
        pos.local_codigo     AS origem_local
      FROM v_almoxarifado_grid v
  LEFT JOIN public.omie_estoque_posicao pos
     ON pos.codigo = v.produto_codigo
    AND pos.local_codigo::text = $1::text
      WHERE v.local = $1
      ORDER BY v.produto_codigo
    `, [local]);

    const dados = rows.map(r => ({
      codigo   : r.codigo || '',
      descricao: r.descricao || '',
      min      : Number(r.min)       || 0,
      fisico   : Number(r.fisico)    || 0,
      reservado: Number(r.reservado) || 0,
      saldo    : Number(r.saldo)     || 0,
      cmc      : Number(r.cmc)       || 0,
      codOmie  : r.cod_omie != null ? String(r.cod_omie) : '',
      origem   : local,
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
        `SELECT id, cod_produto, COALESCE(versao,1) AS versao, modificador
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
        `SELECT id, cod_produto, COALESCE(versao,1) AS versao, modificador
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
          `SELECT id, cod_produto, COALESCE(versao,1) AS versao, modificador
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
