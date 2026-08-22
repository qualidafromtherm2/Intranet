/**
 * Proxy do Cloud Agent do Cursor.
 * Não mistura com o Assistente SGF (/api/ai — OpenAI).
 */
const express = require('express');
const axios = require('axios');
const {
  cursorApiKey,
  repoPadrao,
  isValidAgentId,
  isValidRunId,
  normalizarModelos,
  listarAgentesPublicos,
  rotuloAgente,
  montarPayloadCriacao,
  montarPayloadFollowup,
  resumirAgente,
  resolveModelSelection
} = require('../utils/cursorChat');

const router = express.Router();
const CURSOR_API = 'https://api.cursor.com';

function exigirSessao(req, res) {
  if (!req.session?.user?.id) {
    res.status(401).json({ ok: false, error: 'Não autenticado' });
    return false;
  }
  return true;
}

function exigirChave(res) {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    res.status(503).json({
      ok: false,
      configured: false,
      error: 'CURSOR_API_KEY não configurada. Este chat usa a API do Cursor, não o ChatGPT.'
    });
    return null;
  }
  return apiKey;
}

function cursorClient(apiKey) {
  return axios.create({
    baseURL: CURSOR_API,
    timeout: 45000,
    auth: { username: apiKey, password: '' },
    headers: { Accept: 'application/json' },
    validateStatus: () => true
  });
}

function erroCursor(res, response, fallback) {
  const data = response?.data && typeof response.data === 'object' ? response.data : {};
  const status = Number(response?.status) || 502;
  const message = data.message || data.error || fallback;
  return res.status(status >= 400 && status < 600 ? status : 502).json({
    ok: false,
    error: message
  });
}

router.get('/status', (req, res) => {
  if (!exigirSessao(req, res)) return;
  const configured = Boolean(cursorApiKey());
  res.json({
    ok: true,
    configured,
    repo: repoPadrao(),
    source: 'cursor-cloud-agent'
  });
});

router.get('/models', async (req, res) => {
  if (!exigirSessao(req, res)) return;
  const apiKey = exigirChave(res);
  if (!apiKey) return;
  try {
    const client = cursorClient(apiKey);
    const response = await client.get('/v1/models');
    if (response.status >= 400) return erroCursor(res, response, 'Falha ao listar modelos do Cursor');
    const models = normalizarModelos(response.data);
    res.json({
      ok: true,
      agents: listarAgentesPublicos(models),
      models
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Falha ao falar com a API do Cursor' });
  }
});

router.get('/agents', async (req, res) => {
  if (!exigirSessao(req, res)) return;
  const apiKey = exigirChave(res);
  if (!apiKey) return;
  try {
    const client = cursorClient(apiKey);
    const response = await client.get('/v1/agents', { params: { limit: 20, includeArchived: false } });
    if (response.status >= 400) return erroCursor(res, response, 'Falha ao listar agentes do Cursor');
    const items = Array.isArray(response.data?.items) ? response.data.items.map(resumirAgente) : [];
    res.json({ ok: true, items });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Falha ao listar agentes do Cursor' });
  }
});

router.post('/agents', express.json({ limit: '50kb' }), async (req, res) => {
  if (!exigirSessao(req, res)) return;
  const apiKey = exigirChave(res);
  if (!apiKey) return;
  try {
    const client = cursorClient(apiKey);
    const modelsResp = await client.get('/v1/models');
    const models = modelsResp.status < 400 ? normalizarModelos(modelsResp.data) : [];
    const payload = montarPayloadCriacao({
      text: req.body?.text || req.body?.prompt?.text,
      agentId: req.body?.agent || req.body?.agentId,
      models,
      repoUrl: req.body?.repoUrl,
      autoCreatePr: req.body?.autoCreatePr !== false
    });
    const response = await client.post('/v1/agents', payload);
    if (response.status >= 400) return erroCursor(res, response, 'Falha ao criar o agente do Cursor');
    const agent = resumirAgente(response.data?.agent || response.data);
    res.status(201).json({
      ok: true,
      agent,
      run: response.data?.run || null,
      model: resolveModelSelection(req.body?.agent || req.body?.agentId, models),
      label: rotuloAgente(req.body?.agent || req.body?.agentId, models)
    });
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: err.message || 'Falha ao criar o agente do Cursor' });
  }
});

router.get('/agents/:id', async (req, res) => {
  if (!exigirSessao(req, res)) return;
  const apiKey = exigirChave(res);
  if (!apiKey) return;
  if (!isValidAgentId(req.params.id)) {
    return res.status(400).json({ ok: false, error: 'Agente inválido' });
  }
  try {
    const client = cursorClient(apiKey);
    const response = await client.get(`/v1/agents/${req.params.id}`);
    if (response.status >= 400) return erroCursor(res, response, 'Falha ao ler o agente do Cursor');
    const agent = resumirAgente(response.data);
    let run = null;
    if (isValidRunId(agent.latestRunId)) {
      const runResp = await client.get(`/v1/agents/${req.params.id}/runs/${agent.latestRunId}`);
      if (runResp.status < 400) run = runResp.data;
    }
    res.json({ ok: true, agent, run });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Falha ao ler o agente do Cursor' });
  }
});

router.get('/agents/:id/conversation', async (req, res) => {
  if (!exigirSessao(req, res)) return;
  const apiKey = exigirChave(res);
  if (!apiKey) return;
  if (!isValidAgentId(req.params.id)) {
    return res.status(400).json({ ok: false, error: 'Agente inválido' });
  }
  try {
    const client = cursorClient(apiKey);
    const response = await client.get(`/v0/agents/${req.params.id}/conversation`);
    if (response.status >= 400) return erroCursor(res, response, 'Falha ao ler a conversa do Cursor');
    res.json({
      ok: true,
      id: response.data?.id || req.params.id,
      messages: Array.isArray(response.data?.messages) ? response.data.messages : []
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message || 'Falha ao ler a conversa do Cursor' });
  }
});

router.post('/agents/:id/runs', express.json({ limit: '50kb' }), async (req, res) => {
  if (!exigirSessao(req, res)) return;
  const apiKey = exigirChave(res);
  if (!apiKey) return;
  if (!isValidAgentId(req.params.id)) {
    return res.status(400).json({ ok: false, error: 'Agente inválido' });
  }
  try {
    const payload = montarPayloadFollowup({
      text: req.body?.text || req.body?.prompt?.text
    });
    const client = cursorClient(apiKey);
    const response = await client.post(`/v1/agents/${req.params.id}/runs`, payload);
    if (response.status >= 400) return erroCursor(res, response, 'Falha ao enviar follow-up ao Cursor');
    res.status(201).json({
      ok: true,
      agent: resumirAgente({ id: req.params.id, ...(response.data?.agent || {}) }),
      run: response.data?.run || response.data || null
    });
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: err.message || 'Falha ao enviar follow-up ao Cursor' });
  }
});

module.exports = router;
