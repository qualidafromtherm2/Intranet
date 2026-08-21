/**
 * routes/devAgent.js
 * Cloud Agent (Cursor) + aprovação → merge no GitHub (deploy Render).
 * Acesso: admin autenticado.
 */
'use strict';

const express = require('express');
const router = express.Router();

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

function requireAdmin(req, res, next) {
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

router.get('/status', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    cursorConfigured: Boolean(cursorKey()),
    githubConfigured: Boolean(githubCfg().token),
    repo: repoHttpsUrl(),
    branch: githubCfg().branch,
  });
});

/** Cria Cloud Agent no repositório da intranet. */
router.post('/agents', requireAdmin, express.json({ limit: '100kb' }), async (req, res) => {
  try {
    const text = String(req.body?.prompt || req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'Informe o comando.' });

    const { branch } = githubCfg();
    const body = {
      prompt: { text },
      name: String(req.body?.name || '').trim() || undefined,
      repos: [{ url: repoHttpsUrl(), startingRef: branch }],
      autoCreatePR: req.body?.autoCreatePR !== false,
      mode: req.body?.mode === 'plan' ? 'plan' : 'agent',
    };

    const data = await cursorFetch('/agents', { method: 'POST', body });
    const summary = summarizeAgent(data?.agent, data?.run);
    return res.json({ ok: true, ...summary, raw: data });
  } catch (err) {
    console.error('[dev-agent] create', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/** Follow-up em agent existente. */
router.post('/agents/:id/runs', requireAdmin, express.json({ limit: '100kb' }), async (req, res) => {
  try {
    const text = String(req.body?.prompt || req.body?.text || '').trim();
    if (!text) return res.status(400).json({ ok: false, error: 'Informe o comando.' });
    const data = await cursorFetch(`/agents/${encodeURIComponent(req.params.id)}/runs`, {
      method: 'POST',
      body: { prompt: { text } },
    });
    return res.json({ ok: true, run: data?.run || data });
  } catch (err) {
    console.error('[dev-agent] follow-up', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/** Detalhe + último run (para poll da UI). */
router.get('/agents/:id', requireAdmin, async (req, res) => {
  try {
    const agent = await cursorFetch(`/agents/${encodeURIComponent(req.params.id)}`);
    let run = null;
    if (agent?.latestRunId) {
      run = await cursorFetch(
        `/agents/${encodeURIComponent(req.params.id)}/runs/${encodeURIComponent(agent.latestRunId)}`
      );
    }
    return res.json({ ok: true, ...summarizeAgent(agent, run), agent, run });
  } catch (err) {
    console.error('[dev-agent] get', err.message);
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.get('/agents', requireAdmin, async (req, res) => {
  try {
    const data = await cursorFetch('/agents?limit=20&includeArchived=false');
    return res.json({ ok: true, items: data?.items || [] });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.post('/agents/:id/runs/:runId/cancel', requireAdmin, async (req, res) => {
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

/** Lista arquivos alterados do PR (para o card de revisão). */
router.get('/pulls/:number/files', requireAdmin, async (req, res) => {
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

/**
 * Aprovar = merge do PR na main → Render faz deploy.
 * Só chamar depois do usuário testar no "modo de edição".
 */
router.post('/approve', requireAdmin, express.json({ limit: '20kb' }), async (req, res) => {
  try {
    const prNumber = Number(req.body?.prNumber || 0);
    const agentId = String(req.body?.agentId || '').trim();
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

/** Descartar proposta (fecha PR sem merge). */
router.post('/reject', requireAdmin, express.json({ limit: '20kb' }), async (req, res) => {
  try {
    const prNumber = Number(req.body?.prNumber || 0);
    const agentId = String(req.body?.agentId || '').trim();
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
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
