/**
 * routes/devAgent.js
 * Cloud Agent (Cursor) + histórico SQL (ia_cursor) + fotos R2.
 * Acesso: admin autenticado OU token móvel (DEV_AGENT_MOBILE_TOKEN).
 */
'use strict';

const express = require('express');
const router = express.Router();
const iaDb = require('../utils/iaCursorDb');
const {
  listSpecialists,
  getSpecialist,
  buildActivationPrompt,
  buildUserPromptWithSpecialist,
} = require('../utils/iaCursorSpecialists');

const CURSOR_API = 'https://api.cursor.com/v1';
const GH_API = 'https://api.github.com';

function listRoles(req) {
  const raw = req?.session?.user?.roles ?? [];
  if (Array.isArray(raw)) return raw.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean);
  return String(raw || '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

function requireAdminOrMobile(req, res, next) {
  const mobileToken = String(process.env.DEV_AGENT_MOBILE_TOKEN || '').trim();
  const hdr = String(req.headers['x-dev-agent-token'] || req.headers['x-cursor-chat-token'] || '').trim();
  if (mobileToken && hdr && hdr === mobileToken) {
    req.devAgentMobile = true;
    req.session = req.session || {};
    req.session.user = req.session.user || {
      id: null,
      username: String(req.headers['x-dev-agent-user'] || 'mobile').slice(0, 80),
      roles: ['admin'],
    };
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
    const msg = data?.message || text || `GitHub HTTP ${resp.status}`;
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
      if (!already) {
        await iaDb.addMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content: summary.result,
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
  res.json({
    ok: true,
    cursorConfigured: Boolean(cursorKey()),
    githubConfigured: Boolean(githubCfg().token),
    repo: repoHttpsUrl(),
    branch: githubCfg().branch,
    storage: 'ia_cursor + R2',
  });
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
    const body = {
      prompt,
      name:
        String(req.body?.name || '').trim() ||
        (resolved.specialist ? `Esp: ${resolved.specialist.name}` : titleFromPrompt(resolved.displayText)),
      repos: [{ url: repoHttpsUrl(), startingRef: branch }],
      autoCreatePR: req.body?.autoCreatePR !== false,
      mode: req.body?.mode === 'plan' ? 'plan' : 'agent',
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

    const data = await cursorFetch(`/agents/${encodeURIComponent(agentId)}/runs`, {
      method: 'POST',
      body: { prompt },
    });
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
      attachments,
    });
  } catch (err) {
    console.error('[dev-agent] follow-up', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
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

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'text/event-stream',
      },
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    return res.end();
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    res.write(
      `event: error\ndata: ${JSON.stringify({
        message: text || `Upstream HTTP ${upstream.status}`,
      })}\n\n`
    );
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
          if (event === 'assistant' && data.text) lastAssistant += data.text;
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
          if (!already) {
            await iaDb.addMessage({
              conversationId: conv.id,
              role: 'assistant',
              content: lastAssistant.trim(),
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
    return res.json({ ok: true });
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
