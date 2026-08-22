/**
 * routes/devAgent.js
 * Cloud Agent (Cursor) + histórico SQL (ia_cursor) + fotos R2.
 * Acesso: admin autenticado OU token móvel (DEV_AGENT_MOBILE_TOKEN).
 */
'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const iaDb = require('../utils/iaCursorDb');
const { pool } = require('../src/db');
const {
  listSpecialists,
  getSpecialist,
  buildActivationPrompt,
  buildUserPromptWithSpecialist,
} = require('../utils/iaCursorSpecialists');
const {
  stripPreviousAssistantPrefix,
  mergeAssistantStream,
  previousAssistantContents,
} = require('../utils/iaCursorChatText');

const CURSOR_API = 'https://api.cursor.com/v1';
const GH_API = 'https://api.github.com';
const SQL_MAX_ROWS = Math.min(Number(process.env.DEV_AGENT_SQL_MAX_ROWS || 500), 2000);
const SQL_TIMEOUT_MS = Math.min(Number(process.env.DEV_AGENT_SQL_TIMEOUT_MS || 60000), 120000);

function listRoles(req) {
  const raw = req?.session?.user?.roles ?? [];
  if (Array.isArray(raw)) return raw.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean);
  return String(raw || '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

/** Segredo para token fixo ou ticket SQL assinado (Cloud Agent). */
function agentAuthSecret() {
  return String(
    process.env.DEV_AGENT_MOBILE_TOKEN ||
      process.env.CURSOR_API_KEY ||
      process.env.SESSION_SECRET ||
      ''
  ).trim();
}

function mintSqlTicket(ttlSec = 7 * 24 * 3600) {
  const secret = agentAuthSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', secret).update(`devsql.${exp}`).digest('hex');
  return `${exp}.${sig}`;
}

function verifySqlTicket(ticket) {
  const secret = agentAuthSecret();
  const raw = String(ticket || '').trim();
  if (!secret || !raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  const sig = parts[1];
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expect = crypto.createHmac('sha256', secret).update(`devsql.${exp}`).digest('hex');
  try {
    const a = Buffer.from(String(sig), 'utf8');
    const b = Buffer.from(expect, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function markDevAgentAuth(req, username = 'cloud-agent') {
  req.devAgentMobile = true;
  req.session = req.session || {};
  req.session.user = req.session.user || {
    id: null,
    username: String(username).slice(0, 80),
    roles: ['admin'],
  };
}

function requireAdminOrMobile(req, res, next) {
  const mobileToken = String(process.env.DEV_AGENT_MOBILE_TOKEN || '').trim();
  const hdr = String(req.headers['x-dev-agent-token'] || req.headers['x-cursor-chat-token'] || '').trim();
  const ticketHdr = String(req.headers['x-dev-agent-ticket'] || '').trim();
  if (mobileToken && hdr && hdr === mobileToken) {
    markDevAgentAuth(req, req.headers['x-dev-agent-user'] || 'mobile');
    return next();
  }
  // Ticket assinado (ou o próprio valor injetado em $DEV_AGENT_MOBILE_TOKEN na VM)
  if (verifySqlTicket(hdr) || verifySqlTicket(ticketHdr)) {
    markDevAgentAuth(req, req.headers['x-dev-agent-user'] || 'cloud-agent');
    return next();
  }
  if (!req.session?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  }
  if (!listRoles(req).includes('admin')) {
    return res.status(403).json({ ok: false, error: 'Acesso restrito a administradores.' });
  }
  return next();
}

function cursorKey() {
  return String(process.env.CURSOR_API_KEY || '').trim();
}

function githubCfg() {
  return {
    token: String(process.env.GITHUB_TOKEN || '').trim(),
    owner: String(process.env.GITHUB_OWNER || 'qualidafromtherm2').trim(),
    repo: String(process.env.GITHUB_REPO || 'Intranet').trim(),
    branch: String(process.env.GITHUB_BRANCH || 'main').trim(),
  };
}

function repoHttpsUrl() {
  const { owner, repo } = githubCfg();
  return `https://github.com/${owner}/${repo}`;
}

async function cursorFetch(path, { method = 'GET', body } = {}) {
  const key = cursorKey();
  if (!key) {
    const err = new Error('CURSOR_API_KEY não configurada no servidor.');
    err.status = 503;
    throw err;
  }
  const auth = Buffer.from(`${key}:`).toString('base64');
  const resp = await fetch(`${CURSOR_API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg = data?.message || data?.error || data?.code || text || `HTTP ${resp.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function githubFetch(path, { method = 'GET', body } = {}) {
  const { token } = githubCfg();
  if (!token) {
    const err = new Error('GITHUB_TOKEN não configurada no servidor.');
    err.status = 503;
    throw err;
  }
  const resp = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'intranet-dev-agent',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    let msg = data?.message || text || `GitHub HTTP ${resp.status}`;
    if (/Resource not accessible by personal access token/i.test(msg)) {
      msg =
        'GITHUB_TOKEN do Render sem permissão de merge. No GitHub, use um token classic com scope "repo", ' +
        'ou fine-grained com Contents + Pull requests (Read and write) no repo Intranet. ' +
        'Atualize GITHUB_TOKEN no Render e redeploy.';
    }
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

function parsePrNumber(prUrl) {
  if (!prUrl) return null;
  const m = String(prUrl).match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function summarizeAgent(agent, run) {
  const branches = run?.git?.branches || [];
  const first = branches[0] || {};
  return {
    agentId: agent?.id || null,
    name: agent?.name || null,
    agentStatus: agent?.status || null,
    agentUrl: agent?.url || null,
    runId: run?.id || agent?.latestRunId || null,
    runStatus: run?.status || null,
    result: run?.result || null,
    branch: first.branch || null,
    prUrl: first.prUrl || null,
    prNumber: parsePrNumber(first.prUrl),
    repoUrl: first.repoUrl || repoHttpsUrl(),
  };
}

function normalizePromptImages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const url = String(item.url || '').trim();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      out.push({ url });
      if (out.length >= 5) break;
      continue;
    }
    let data = String(item.data || '').trim();
    let mimeType = String(item.mimeType || item.mime || '').trim().toLowerCase();
    if (data.startsWith('data:')) {
      const m = data.match(/^data:([^;]+);base64,(.+)$/i);
      if (m) {
        if (!mimeType) mimeType = m[1].toLowerCase();
        data = m[2];
      }
    }
    data = data.replace(/\s/g, '');
    if (!data) continue;
    if (!mimeType) mimeType = 'image/png';
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(mimeType)) {
      continue;
    }
    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';
    if (data.length > 22_000_000) continue;
    out.push({ data, mimeType });
    if (out.length >= 5) break;
  }
  return out;
}

function titleFromPrompt(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'Nova conversa';
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function intranetPublicUrl() {
  return String(
    process.env.INTRANET_PUBLIC_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.PUBLIC_BASE_URL ||
      ''
  )
    .trim()
    .replace(/\/$/, '');
}

/** Env injetado na VM do Cloud Agent (acesso SQL via API da intranet). */
function cloudAgentEnvVars() {
  const out = {};
  const base = intranetPublicUrl();
  const fixed = String(process.env.DEV_AGENT_MOBILE_TOKEN || '').trim();
  const ticket = mintSqlTicket();
  if (base) out.INTRANET_PUBLIC_URL = base;
  // Prefer token fixo do Render; senão ticket assinado (válido ~7 dias)
  if (fixed) out.DEV_AGENT_MOBILE_TOKEN = fixed;
  else if (ticket) out.DEV_AGENT_MOBILE_TOKEN = ticket;
  return Object.keys(out).length ? out : null;
}

function sqlAccessPreamble() {
  const base = intranetPublicUrl() || 'https://SEU-SITE.onrender.com';
  const ticket = mintSqlTicket();
  const lines = [
    '## Acesso ao Postgres (intranet)',
    'Você pode criar schemas/tabelas, alterar colunas e consultar o banco via API (o agent NÃO usa DATABASE_URL direto no Render interno).',
    '',
    'Autenticação: use o header X-Dev-Agent-Token com $DEV_AGENT_MOBILE_TOKEN (já injetado no ambiente quando disponível).',
  ];
  if (ticket) {
    lines.push(
      `Se $DEV_AGENT_MOBILE_TOKEN estiver vazio nesta sessão, use exatamente este valor no header: ${ticket}`
    );
  }
  lines.push(
    '',
    'Executar SQL:',
    '```bash',
    `curl -sS -X POST "${base}/api/dev-agent/sql" \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "X-Dev-Agent-Token: $DEV_AGENT_MOBILE_TOKEN" \\',
    '  -d \'{"sql":"SELECT current_database(), current_user;"}\'',
    '```',
    '',
    'Catálogo:',
    '```bash',
    `curl -sS "${base}/api/dev-agent/sql/catalog" -H "X-Dev-Agent-Token: $DEV_AGENT_MOBILE_TOKEN"`,
    '```',
    '',
    'Não imprima tokens/senhas. DROP/TRUNCATE só com pedido explícito do usuário.',
    ''
  );
  return lines.join('\n');
}

function wrapPromptForCursor(prompt, { followUp = false } = {}) {
  const text = String(prompt?.text || '');
  const followUpHint = followUp
    ? [
        '',
        '[Follow-up] Responda SÓ o pedido novo abaixo.',
        'Não repita, não cole e não reescreva a resposta anterior.',
        'Se precisar de contexto, use uma frase curta — o histórico já está na conversa.',
        '',
      ].join('\n')
    : '\n';
  const wrapped = {
    ...prompt,
    text: `${sqlAccessPreamble()}\n---\n${followUpHint}${text}`,
  };
  return wrapped;
}

function cleanAssistantContent(raw, messages, runId) {
  const previous = previousAssistantContents(messages, { excludeRunId: runId });
  return stripPreviousAssistantPrefix(String(raw || '').trim(), previous);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cursor só aceita 1 run ativo. Se estiver CREATING/RUNNING, cancela e espera liberar.
 */
async function cancelActiveRunIfBusy(agentId) {
  const agent = await cursorFetch(`/agents/${encodeURIComponent(agentId)}`);
  const runId = agent?.latestRunId;
  if (!runId) return { agent, cancelled: false, runId: null, run: null };

  let run = await cursorFetch(
    `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`
  );
  const st = String(run?.status || '').toUpperCase();
  if (st !== 'RUNNING' && st !== 'CREATING') {
    return { agent, cancelled: false, runId, run };
  }

  try {
    await cursorFetch(
      `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST', body: {} }
    );
  } catch (e) {
    if (e.status !== 409) throw e;
  }

  for (let i = 0; i < 10; i++) {
    await sleep(600);
    run = await cursorFetch(
      `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`
    );
    const st2 = String(run?.status || '').toUpperCase();
    if (st2 !== 'RUNNING' && st2 !== 'CREATING') {
      return { agent, cancelled: true, runId, run };
    }
  }

  const err = new Error(
    'O agent anterior ainda está RUNNING e não liberou. Clique em Parar ou Nova conversa.'
  );
  err.status = 409;
  throw err;
}

function actorLabel(req) {
  return (
    req.session?.user?.username ||
    req.session?.user?.login ||
    (req.devAgentMobile ? 'cloud-agent' : 'admin')
  );
}

/**
 * Salva mensagem do usuário + sobe imagens no R2.
 * displayText = o que aparece no chat; cursorText = o que vai para o Cloud Agent.
 */
async function persistUserTurn({
  conversationId,
  displayText,
  cursorText,
  imagesBase64,
  specialistId = null,
}) {
  const userMsg = await iaDb.addMessage({
    conversationId,
    role: 'user',
    content: displayText || cursorText || '(imagem anexada)',
    specialistId,
  });
  let attachments = [];
  try {
    attachments = await iaDb.saveAttachmentsForMessage(
      userMsg.id,
      conversationId,
      (imagesBase64 || []).filter((i) => i.data)
    );
  } catch (e) {
    console.warn('[dev-agent] R2 upload:', e.message);
  }
  const prompt = {
    text:
      cursorText ||
      displayText ||
      'Segue a(s) imagem(ns) anexada(s). Analise e faça o que for pedido visualmente.',
  };
  const cursorImages = [];
  for (const a of attachments) {
    if (a.url) cursorImages.push({ url: a.url });
  }
  if (!cursorImages.length) {
    for (const img of imagesBase64 || []) {
      if (img.data) cursorImages.push({ data: img.data, mimeType: img.mimeType });
    }
  }
  if (cursorImages.length) prompt.images = cursorImages;
  return { userMsg, attachments, prompt };
}

function resolvePromptFromBody(req) {
  const text = String(req.body?.prompt || req.body?.text || '').trim();
  const images = normalizePromptImages(req.body?.images || req.body?.promptImages);
  const specialistId = String(req.body?.specialistId || '').trim() || null;
  const activateSpecialist = Boolean(req.body?.activateSpecialist);
  const specialist = specialistId ? getSpecialist(specialistId) : null;

  if (activateSpecialist) {
    if (!specialist) {
      const err = new Error('Especialista não encontrado.');
      err.status = 400;
      throw err;
    }
    return {
      text,
      images,
      specialist,
      specialistId: specialist.id,
      displayText: specialist.name,
      cursorText: buildActivationPrompt(specialist),
      activateSpecialist: true,
    };
  }

  if (!text && !images.length) {
    const err = new Error('Informe um comando ou anexe uma imagem.');
    err.status = 400;
    throw err;
  }

  const displayText = text || '(imagem anexada)';
  const cursorText = specialist
    ? buildUserPromptWithSpecialist(text || displayText, specialist)
    : text || displayText;

  return {
    text,
    images,
    specialist,
    specialistId: specialist?.id || null,
    displayText,
    cursorText,
    activateSpecialist: false,
  };
}

async function syncAssistantFromCursor(conversation, agentId) {
  if (!conversation?.id || !agentId) return conversation;
  try {
    const agent = await cursorFetch(`/agents/${encodeURIComponent(agentId)}`);
    let run = null;
    if (agent?.latestRunId) {
      run = await cursorFetch(
        `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(agent.latestRunId)}`
      );
    }
    const summary = summarizeAgent(agent, run);
    const patch = {
      status: summary.runStatus || conversation.status,
      branch: summary.branch,
      pr_url: summary.prUrl,
      pr_number: summary.prNumber,
      agent_url: summary.agentUrl,
    };
    await iaDb.touchConversation(conversation.id, patch);

    const st = String(summary.runStatus || '').toUpperCase();
    if (st === 'FINISHED' && summary.result) {
      const msgs = await iaDb.listMessages(conversation.id);
      const already = msgs.some(
        (m) => m.role === 'assistant' && m.cursor_run_id === summary.runId
      );
      const content = cleanAssistantContent(summary.result, msgs, summary.runId);
      if (!already && content) {
        await iaDb.addMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content,
          cursorRunId: summary.runId,
        });
      }
    }
    return { ...conversation, ...patch, ...summary };
  } catch (e) {
    console.warn('[dev-agent] sync:', e.message);
    return conversation;
  }
}

router.get('/status', requireAdminOrMobile, (req, res) => {
  const envVars = cloudAgentEnvVars();
  res.json({
    ok: true,
    cursorConfigured: Boolean(cursorKey()),
    githubConfigured: Boolean(githubCfg().token),
    sqlApiConfigured: Boolean(pool),
    sqlViaAgentConfigured: Boolean(envVars?.INTRANET_PUBLIC_URL && envVars?.DEV_AGENT_MOBILE_TOKEN),
    sqlTicketAuth: Boolean(agentAuthSecret()),
    intranetPublicUrl: intranetPublicUrl() || null,
    repo: repoHttpsUrl(),
    branch: githubCfg().branch,
    storage: 'ia_cursor + R2',
  });
});

/** Catálogo de schemas/tabelas (descoberta). */
router.get('/sql/catalog', requireAdminOrMobile, async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ ok: false, error: 'DATABASE_URL não configurada.' });
    const schemaFilter = String(req.query.schema || '').trim();
    const { rows: schemas } = await pool.query(
      `SELECT schema_name
         FROM information_schema.schemata
        WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          AND schema_name NOT LIKE 'pg_temp%'
          AND schema_name NOT LIKE 'pg_toast_temp%'
        ORDER BY schema_name`
    );
    const params = [];
    let where = `table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')`;
    if (schemaFilter) {
      params.push(schemaFilter);
      where += ` AND table_schema = $1`;
    }
    const { rows: tables } = await pool.query(
      `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
        WHERE ${where}
        ORDER BY table_schema, table_name
        LIMIT 2000`,
      params
    );
    let columns = [];
    if (schemaFilter) {
      const { rows } = await pool.query(
        `SELECT table_name, column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = $1
          ORDER BY table_name, ordinal_position
          LIMIT 5000`,
        [schemaFilter]
      );
      columns = rows;
    }
    const dbRes = await pool.query('SELECT current_database() AS db');
    return res.json({
      ok: true,
      database: dbRes.rows[0]?.db || null,
      schemas: schemas.map((s) => s.schema_name),
      tables,
      columns,
    });
  } catch (err) {
    console.error('[dev-agent] sql catalog', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Executa SQL no Postgres da intranet (DDL/DML/SELECT).
 * Cloud Agent chama com X-Dev-Agent-Token — sem DATABASE_URL na VM.
 */
router.post('/sql', requireAdminOrMobile, express.json({ limit: '2mb' }), async (req, res) => {
  const sql = String(req.body?.sql || req.body?.query || '').trim();
  if (!sql) return res.status(400).json({ ok: false, error: 'Campo sql obrigatório.' });
  if (!pool) return res.status(503).json({ ok: false, error: 'DATABASE_URL não configurada.' });

  const params = Array.isArray(req.body?.params) ? req.body.params : [];
  const who = actorLabel(req);
  console.log(`[dev-agent] SQL by ${who}:`, sql.slice(0, 400).replace(/\s+/g, ' '));

  const client = await pool.connect();
  try {
    await client.query(`SET statement_timeout = ${Number(SQL_TIMEOUT_MS)}`);
    const result = await client.query(sql, params);
    const rows = Array.isArray(result.rows) ? result.rows.slice(0, SQL_MAX_ROWS) : [];
    return res.json({
      ok: true,
      command: result.command || null,
      rowCount: result.rowCount ?? rows.length,
      truncated: Array.isArray(result.rows) && result.rows.length > rows.length,
      fields: (result.fields || []).map((f) => f.name),
      rows,
    });
  } catch (err) {
    console.error('[dev-agent] SQL error:', err.message);
    return res.status(400).json({
      ok: false,
      error: err.message,
      code: err.code || null,
      detail: err.detail || null,
      hint: err.hint || null,
    });
  } finally {
    client.release();
  }
});

/** Catálogo de especialistas (módulos + botões). */
router.get('/specialists', requireAdminOrMobile, (req, res) => {
  try {
    const items = listSpecialists();
    const groups = {};
    for (const s of items) {
      if (!groups[s.group]) groups[s.group] = [];
      groups[s.group].push({
        id: s.id,
        name: s.name,
        blurb: s.blurb,
        group: s.group,
      });
    }
    return res.json({ ok: true, items, groups });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** Lista conversas do SQL (fonte da verdade do histórico). */
router.get('/conversations', requireAdminOrMobile, async (req, res) => {
  try {
    await iaDb.ensureIaCursorSchema();
    const userId = req.devAgentMobile ? null : req.session?.user?.id;
    const items = await iaDb.listConversations({ userId, limit: 50 });
    return res.json({
      ok: true,
      items: items.map((c) => ({
        id: c.id,
        conversationId: c.id,
        agentId: c.cursor_agent_id,
        name: c.title,
        title: c.title,
        status: c.status,
        branch: c.branch,
        prUrl: c.pr_url,
        prNumber: c.pr_number,
        updatedAt: c.updated_at,
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
    console.error('[dev-agent] list conversations', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** Detalhe + mensagens (WhatsApp-style). */
router.get('/conversations/:id', requireAdminOrMobile, async (req, res) => {
  try {
    const id = Number(req.params.id);
    let conv = await iaDb.getConversation(id);
    if (!conv) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });

    if (conv.cursor_agent_id) {
      conv = await syncAssistantFromCursor(conv, conv.cursor_agent_id);
    }

    const messages = await iaDb.listMessages(id);
    return res.json({
      ok: true,
      conversationId: conv.id,
      agentId: conv.cursor_agent_id,
      title: conv.title,
      status: conv.status,
      branch: conv.branch,
      prUrl: conv.pr_url,
      prNumber: conv.pr_number,
      agentUrl: conv.agent_url,
      specialistId: conv.specialist_id || null,
      runStatus: conv.status,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        specialistId: m.specialist_id || null,
        runId: m.cursor_run_id,
        createdAt: m.created_at,
        attachments: m.attachments || [],
      })),
    });
  } catch (err) {
    console.error('[dev-agent] get conversation', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/** Nota de sistema na conversa (ex.: erro de UI que some no re-render). */
router.post('/conversations/:id/system-note', requireAdminOrMobile, express.json({ limit: '20kb' }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const content = String(req.body?.content || '').trim().slice(0, 2000);
    if (!content) return res.status(400).json({ ok: false, error: 'content obrigatório' });
    const conv = await iaDb.getConversation(id);
    if (!conv) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
    const msg = await iaDb.addMessage({
      conversationId: id,
      role: 'system',
      content,
    });
    return res.json({ ok: true, id: msg?.id || null });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** Exclui conversa + fotos no R2. */
router.delete('/conversations/:id', requireAdminOrMobile, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const conv = await iaDb.getConversation(id);
    if (!conv) return res.status(404).json({ ok: false, error: 'Conversa não encontrada.' });
    if (conv.cursor_agent_id) {
      try {
        await cursorFetch(`/agents/${encodeURIComponent(conv.cursor_agent_id)}/archive`, {
          method: 'POST',
          body: {},
        });
      } catch (e) {
        console.warn('[dev-agent] archive on delete:', e.message);
      }
    }
    await iaDb.deleteConversation(id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** Cria Cloud Agent + grava conversa no SQL. */
router.post('/agents', requireAdminOrMobile, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const resolved = resolvePromptFromBody(req);
    const user = req.session?.user || {};
    const titleSeed = resolved.activateSpecialist
      ? `Especialista: ${resolved.specialist.name}`
      : resolved.displayText;
    const conv = await iaDb.createConversation({
      userId: user.id || null,
      username: user.username || null,
      title: titleFromPrompt(titleSeed) || String(req.body?.name || '').trim() || 'Nova conversa',
    });

    const { prompt, attachments } = await persistUserTurn({
      conversationId: conv.id,
      displayText: resolved.displayText,
      cursorText: resolved.cursorText,
      imagesBase64: resolved.images,
      specialistId: resolved.specialistId,
    });

    if (resolved.specialistId) {
      await iaDb.touchConversation(conv.id, { specialist_id: resolved.specialistId });
    }

    const { branch } = githubCfg();
    const envVars = cloudAgentEnvVars();
    const body = {
      prompt: wrapPromptForCursor(prompt),
      name:
        String(req.body?.name || '').trim() ||
        (resolved.specialist ? `Esp: ${resolved.specialist.name}` : titleFromPrompt(resolved.displayText)),
      repos: [{ url: repoHttpsUrl(), startingRef: branch }],
      autoCreatePR: req.body?.autoCreatePR !== false,
      mode: req.body?.mode === 'plan' ? 'plan' : 'agent',
      ...(envVars ? { envVars } : {}),
    };

    const data = await cursorFetch('/agents', { method: 'POST', body });
    const summary = summarizeAgent(data?.agent, data?.run);
    await iaDb.touchConversation(conv.id, {
      cursor_agent_id: summary.agentId,
      status: summary.runStatus || 'CREATING',
      agent_url: summary.agentUrl,
      branch: summary.branch,
      pr_url: summary.prUrl,
      pr_number: summary.prNumber,
      specialist_id: resolved.specialistId,
    });

    return res.json({
      ok: true,
      conversationId: conv.id,
      specialistId: resolved.specialistId,
      specialistName: resolved.specialist?.name || null,
      ...summary,
      attachments,
      raw: data,
    });
  } catch (err) {
    console.error('[dev-agent] create', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/** Follow-up em agent existente (+ SQL). */
router.post('/agents/:id/runs', requireAdminOrMobile, express.json({ limit: '25mb' }), async (req, res) => {
  try {
    const agentId = req.params.id;
    const resolved = resolvePromptFromBody(req);

    // Libera run preso ANTES de gravar a mensagem (evita user órfão sem resposta)
    let cancelledBusy = false;
    try {
      const idle = await cancelActiveRunIfBusy(agentId);
      cancelledBusy = Boolean(idle.cancelled);
    } catch (busyErr) {
      return res.status(busyErr.status || 409).json({
        ok: false,
        error: busyErr.message,
        busy: true,
      });
    }

    let conv =
      (req.body?.conversationId
        ? await iaDb.getConversation(Number(req.body.conversationId))
        : null) || (await iaDb.getConversationByAgentId(agentId));

    if (!conv) {
      const user = req.session?.user || {};
      conv = await iaDb.createConversation({
        userId: user.id || null,
        username: user.username || null,
        title: titleFromPrompt(resolved.displayText),
      });
      await iaDb.touchConversation(conv.id, { cursor_agent_id: agentId });
    }

    if (cancelledBusy) {
      try {
        await iaDb.addMessage({
          conversationId: conv.id,
          role: 'system',
          content: 'Run anterior cancelado automaticamente para liberar o follow-up.',
        });
      } catch (_) {}
    }

    const { prompt, attachments } = await persistUserTurn({
      conversationId: conv.id,
      displayText: resolved.displayText,
      cursorText: resolved.cursorText,
      imagesBase64: resolved.images,
      specialistId: resolved.specialistId,
    });

    if (resolved.specialistId) {
      await iaDb.touchConversation(conv.id, { specialist_id: resolved.specialistId });
    }

    let data;
    try {
      data = await cursorFetch(`/agents/${encodeURIComponent(agentId)}/runs`, {
        method: 'POST',
        body: { prompt: wrapPromptForCursor(prompt, { followUp: true }) },
      });
    } catch (runErr) {
      // Corrida: ainda busy → tenta cancelar de novo e recria 1x
      if (runErr.status === 409) {
        await cancelActiveRunIfBusy(agentId);
        data = await cursorFetch(`/agents/${encodeURIComponent(agentId)}/runs`, {
          method: 'POST',
          body: { prompt: wrapPromptForCursor(prompt, { followUp: true }) },
        });
      } else {
        throw runErr;
      }
    }
    const run = data?.run || data;
    await iaDb.touchConversation(conv.id, {
      status: run?.status || 'RUNNING',
    });

    return res.json({
      ok: true,
      conversationId: conv.id,
      specialistId: resolved.specialistId,
      specialistName: resolved.specialist?.name || null,
      run,
      runId: run?.id || null,
      cancelledBusy,
      attachments,
    });
  } catch (err) {
    console.error('[dev-agent] follow-up', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message, busy: err.status === 409 });
  }
});

/** Detalhe + último run (poll). */
/** Arquiva Cloud Agent na Cursor (remove da lista ACTIVE). */
router.post('/agents/:id/archive', requireAdminOrMobile, async (req, res) => {
  try {
    const agentId = String(req.params.id || '').trim();
    if (!agentId) return res.status(400).json({ ok: false, error: 'agentId obrigatório.' });
    await cursorFetch(`/agents/${encodeURIComponent(agentId)}/archive`, {
      method: 'POST',
      body: {},
    });
    const conv = await iaDb.getConversationByAgentId(agentId);
    if (conv) {
      try {
        await iaDb.deleteConversation(conv.id);
      } catch (e) {
        console.warn('[dev-agent] sql delete after archive:', e.message);
      }
    }
    return res.json({ ok: true, agentId });
  } catch (err) {
    console.error('[dev-agent] archive', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.get('/agents/:id', requireAdminOrMobile, async (req, res) => {
  try {
    const agent = await cursorFetch(`/agents/${encodeURIComponent(req.params.id)}`);
    let run = null;
    if (agent?.latestRunId) {
      run = await cursorFetch(
        `/agents/${encodeURIComponent(req.params.id)}/runs/${encodeURIComponent(agent.latestRunId)}`
      );
    }
    const summary = summarizeAgent(agent, run);
    const conv = await iaDb.getConversationByAgentId(req.params.id);
    if (conv) {
      await syncAssistantFromCursor(conv, req.params.id);
    }
    return res.json({
      ok: true,
      conversationId: conv?.id || null,
      ...summary,
      agent,
      run,
    });
  } catch (err) {
    console.error('[dev-agent] get', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.get('/agents', requireAdminOrMobile, async (req, res) => {
  try {
    // Prefere SQL; se vazio, espelha Cursor uma vez
    await iaDb.ensureIaCursorSchema();
    const userId = req.devAgentMobile ? null : req.session?.user?.id;
    let items = await iaDb.listConversations({ userId, limit: 40 });
    if (!items.length) {
      try {
        const data = await cursorFetch('/agents?limit=20&includeArchived=false');
        return res.json({
          ok: true,
          items: (data?.items || []).map((a) => ({
            id: a.id,
            agentId: a.id,
            conversationId: null,
            name: a.name || a.id,
            status: a.status,
            updatedAt: a.updatedAt,
          })),
          source: 'cursor',
        });
      } catch (_) {
        /* ignore */
      }
    }
    return res.json({
      ok: true,
      source: 'sql',
      items: items.map((c) => ({
        id: c.cursor_agent_id || `c-${c.id}`,
        agentId: c.cursor_agent_id,
        conversationId: c.id,
        name: c.title,
        status: c.status,
        updatedAt: c.updated_at,
        prNumber: c.pr_number,
      })),
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/**
 * Histórico: SQL primeiro; fallback runs da Cursor.
 */
router.get('/agents/:id/conversation', requireAdminOrMobile, async (req, res) => {
  try {
    const agentId = req.params.id;
    const conv = await iaDb.getConversationByAgentId(agentId);
    if (conv) {
      const synced = await syncAssistantFromCursor(conv, agentId);
      const messages = await iaDb.listMessages(conv.id);
      return res.json({
        ok: true,
        conversationId: conv.id,
        agentId,
        name: synced.title || conv.title,
        title: synced.title || conv.title,
        branch: synced.branch || conv.branch,
        prUrl: synced.pr_url || conv.pr_url,
        prNumber: synced.pr_number || conv.pr_number,
        agentUrl: synced.agent_url || conv.agent_url,
        runId: synced.runId || null,
        runStatus: synced.runStatus || conv.status,
        result: synced.result || null,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          runId: m.cursor_run_id,
          createdAt: m.created_at,
          attachments: m.attachments || [],
          status: m.role === 'assistant' ? 'FINISHED' : undefined,
          result: m.role === 'assistant' ? m.content : null,
        })),
      });
    }

    const agent = await cursorFetch(`/agents/${encodeURIComponent(agentId)}`);
    const runsResp = await cursorFetch(`/agents/${encodeURIComponent(agentId)}/runs?limit=50`);
    const items = Array.isArray(runsResp?.items) ? runsResp.items.slice() : [];
    items.reverse();
    const messages = items.map((run) => ({
      id: run.id,
      role: 'run',
      runId: run.id,
      status: String(run.status || '').toUpperCase(),
      createdAt: run.createdAt || null,
      result: run.result || null,
    }));
    const latest = items.length ? items[items.length - 1] : null;
    return res.json({
      ok: true,
      conversationId: null,
      ...summarizeAgent(agent, latest),
      messages,
    });
  } catch (err) {
    console.error('[dev-agent] conversation', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/** Proxy SSE. */
router.get('/agents/:id/runs/:runId/stream', requireAdminOrMobile, async (req, res) => {
  const key = cursorKey();
  if (!key) {
    return res.status(503).json({ ok: false, error: 'CURSOR_API_KEY não configurada.' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const auth = Buffer.from(`${key}:`).toString('base64');
  const url =
    `${CURSOR_API}/agents/${encodeURIComponent(req.params.id)}` +
    `/runs/${encodeURIComponent(req.params.runId)}/stream`;

  let upstream = null;
  let lastErrText = '';
  // Run recém-criado pode estar CREATING — tenta algumas vezes antes de desistir
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      upstream = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'text/event-stream',
        },
      });
    } catch (err) {
      lastErrText = err.message || String(err);
      await sleep(700);
      continue;
    }
    if (upstream.ok && upstream.body) break;
    lastErrText = await upstream.text().catch(() => '') || `Upstream HTTP ${upstream.status}`;
    // 404/409/425 enquanto cria — espera e tenta de novo
    if ([404, 409, 425, 429, 502, 503].includes(upstream.status)) {
      try {
        res.write(`event: heartbeat\ndata: {}\n\n`);
      } catch (_) {}
      await sleep(800);
      continue;
    }
    break;
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    res.write(
      `event: error\ndata: ${JSON.stringify({
        message: lastErrText || 'Falha ao abrir stream do agent',
      })}\n\n`
    );
    // Não manda "done" aqui: o front confirma status via poll e reabre o stream se ainda RUNNING
    return res.end();
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let closed = false;
  let lastAssistant = '';

  const onClose = () => {
    if (closed) return;
    closed = true;
    try {
      reader.cancel().catch(() => {});
    } catch (_) {}
  };
  req.on('close', onClose);

  try {
    let buffer = '';
    while (!closed) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
      if (typeof res.flush === 'function') res.flush();

      // captura texto final do assistant/result para gravar no SQL
      buffer += chunk;
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const block of parts) {
        const lines = block.split('\n');
        let event = 'message';
        let dataLine = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('data:')) dataLine += line.slice(5).trim();
        }
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine);
          if (event === 'assistant' && data.text) {
            lastAssistant = mergeAssistantStream(lastAssistant, data.text);
          }
          if (event === 'result' && data.text) lastAssistant = data.text;
        } catch (_) {}
      }
    }

    // persiste resposta se tivermos texto
    if (lastAssistant.trim()) {
      try {
        const conv = await iaDb.getConversationByAgentId(req.params.id);
        if (conv) {
          const msgs = await iaDb.listMessages(conv.id);
          const already = msgs.some(
            (m) => m.role === 'assistant' && m.cursor_run_id === req.params.runId
          );
          const content = cleanAssistantContent(lastAssistant, msgs, req.params.runId);
          if (!already && content) {
            await iaDb.addMessage({
              conversationId: conv.id,
              role: 'assistant',
              content,
              cursorRunId: req.params.runId,
            });
          }
          await iaDb.touchConversation(conv.id, { status: 'FINISHED' });
        }
      } catch (e) {
        console.warn('[dev-agent] persist stream result:', e.message);
      }
    }
  } catch (err) {
    if (!closed) {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      } catch (_) {}
    }
  } finally {
    onClose();
    try {
      res.end();
    } catch (_) {}
  }
});

router.post('/agents/:id/runs/:runId/cancel', requireAdminOrMobile, async (req, res) => {
  try {
    await cursorFetch(
      `/agents/${encodeURIComponent(req.params.id)}/runs/${encodeURIComponent(req.params.runId)}/cancel`,
      { method: 'POST', body: {} }
    );
    const conv = await iaDb.getConversationByAgentId(req.params.id);
    if (conv) {
      await iaDb.touchConversation(conv.id, { status: 'CANCELLED' });
      try {
        await iaDb.addMessage({
          conversationId: conv.id,
          role: 'system',
          content: 'Run cancelado pelo usuário.',
        });
      } catch (_) {}
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/** Cancela o latest run do agent (atalho para UI). */
router.post('/agents/:id/cancel', requireAdminOrMobile, async (req, res) => {
  try {
    const idle = await cancelActiveRunIfBusy(req.params.id);
    const conv = await iaDb.getConversationByAgentId(req.params.id);
    if (conv) {
      await iaDb.touchConversation(conv.id, {
        status: idle.cancelled ? 'CANCELLED' : String(idle.run?.status || conv.status || ''),
      });
      if (idle.cancelled) {
        try {
          await iaDb.addMessage({
            conversationId: conv.id,
            role: 'system',
            content: 'Run cancelado pelo usuário (Parar).',
          });
        } catch (_) {}
      }
    }
    return res.json({
      ok: true,
      cancelled: Boolean(idle.cancelled),
      runId: idle.runId || null,
      status: idle.run?.status || null,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.get('/pulls/:number/files', requireAdminOrMobile, async (req, res) => {
  try {
    const { owner, repo } = githubCfg();
    const files = await githubFetch(
      `/repos/${owner}/${repo}/pulls/${encodeURIComponent(req.params.number)}/files?per_page=100`
    );
    const items = (Array.isArray(files) ? files : []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
    }));
    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.post('/approve', requireAdminOrMobile, express.json({ limit: '20kb' }), async (req, res) => {
  try {
    const prNumber = Number(req.body?.prNumber || 0);
    const agentId = String(req.body?.agentId || '').trim();
    const conversationId = Number(req.body?.conversationId || 0) || null;
    if (!prNumber) {
      return res.status(400).json({ ok: false, error: 'prNumber obrigatório.' });
    }
    const { owner, repo } = githubCfg();
    const pr = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    if (pr?.draft) {
      // Cloud Agents abrem PR em draft; GitHub recusa merge até marcar Ready.
      await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/ready_for_review`, {
        method: 'POST',
        body: {},
      });
    }
    const merged = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      method: 'PUT',
      body: {
        commit_title: `Intranet: aprovar alteração do Agente Dev (#${prNumber})`,
        commit_message: `Aprovado por ${req.session.user?.username || req.session.user?.id || 'admin'} via chatbot.`,
        merge_method: 'squash',
      },
    });

    if (agentId) {
      try {
        await cursorFetch(`/agents/${encodeURIComponent(agentId)}/archive`, {
          method: 'POST',
          body: {},
        });
      } catch (e) {
        console.warn('[dev-agent] archive após merge:', e.message);
      }
    }
    if (conversationId) {
      await iaDb.touchConversation(conversationId, { status: 'published' });
      await iaDb.addMessage({
        conversationId,
        role: 'system',
        content: `Publicado na main (PR #${prNumber}). O Render deve atualizar em breve.`,
      });
    }

    return res.json({
      ok: true,
      merged: Boolean(merged?.merged),
      sha: merged?.sha || null,
      message: merged?.message || 'PR mesclado. O Render deve publicar em breve.',
      prNumber,
    });
  } catch (err) {
    console.error('[dev-agent] approve', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message, data: err.data || null });
  }
});

router.post('/reject', requireAdminOrMobile, express.json({ limit: '20kb' }), async (req, res) => {
  try {
    const prNumber = Number(req.body?.prNumber || 0);
    const agentId = String(req.body?.agentId || '').trim();
    const conversationId = Number(req.body?.conversationId || 0) || null;
    const { owner, repo } = githubCfg();
    if (prNumber) {
      await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
        method: 'PATCH',
        body: { state: 'closed' },
      });
    }
    if (agentId) {
      try {
        await cursorFetch(`/agents/${encodeURIComponent(agentId)}/archive`, {
          method: 'POST',
          body: {},
        });
      } catch (e) {
        console.warn('[dev-agent] archive após reject:', e.message);
      }
    }
    if (conversationId) {
      await iaDb.touchConversation(conversationId, { status: 'discarded' });
      await iaDb.addMessage({
        conversationId,
        role: 'system',
        content: 'Proposta descartada (PR fechado sem publicar).',
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
