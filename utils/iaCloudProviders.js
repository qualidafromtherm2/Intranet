/**
 * Provedores de IA grátis na nuvem (OpenAI-compatible + Gemini).
 * Sem Ollama. Failover automático entre chaves configuradas.
 */
'use strict';

const PROVIDERS = [
  {
    id: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    // openrouter/free = só modelos grátis; openrouter/auto cobra o modelo escolhido
    defaultModel: 'openrouter/free',
    modelEnv: 'OPENROUTER_MODEL',
    kind: 'openai',
    lightModel: 'openrouter/free',
  },
  {
    id: 'groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    // llama-3.3-70b / llama-3.1-8b saíram do ar em 16 ago 2026 (404)
    defaultModel: 'openai/gpt-oss-120b',
    modelEnv: 'GROQ_MODEL',
    kind: 'openai',
    lightModel: 'openai/gpt-oss-20b',
  },
  {
    id: 'gemini',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    // gemini-2.0-flash saiu do ar em 1 jun 2026 (404 NOT_FOUND)
    defaultModel: 'gemini-3.5-flash',
    modelEnv: 'GEMINI_MODEL',
    kind: 'gemini',
    lightModel: 'gemini-3.5-flash',
  },
  {
    id: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    modelEnv: 'DEEPSEEK_MODEL',
    kind: 'openai',
    lightModel: 'deepseek-chat',
  },
  {
    id: 'mistral',
    envKey: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    modelEnv: 'MISTRAL_MODEL',
    kind: 'openai',
    lightModel: 'mistral-small-latest',
  },
];

function env(name) {
  return String(process.env[name] || '').trim();
}

/** Extrai usage/tokens da resposta do provedor (quando existir). */
function extractUsage(data, kind) {
  if (!data || typeof data !== 'object') return null;
  if (kind === 'gemini') {
    const u = data.usageMetadata || data.usage || null;
    if (!u) return null;
    const prompt = Number(u.promptTokenCount || u.prompt_tokens || 0) || 0;
    const completion = Number(u.candidatesTokenCount || u.completion_tokens || 0) || 0;
    const total = Number(u.totalTokenCount || u.total_tokens || prompt + completion) || 0;
    if (!prompt && !completion && !total) return null;
    return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
  }
  const u = data.usage || null;
  if (!u) return null;
  const prompt = Number(u.prompt_tokens || 0) || 0;
  const completion = Number(u.completion_tokens || 0) || 0;
  const total = Number(u.total_tokens || prompt + completion) || 0;
  if (!prompt && !completion && !total) return null;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

/** Llama 3.1/3.3 da Groq desligados em 16 ago 2026 — a API responde 404. */
function isRetiredGroqModel(model) {
  return /^(llama-3\.1-8b-instant|llama-3\.3-70b-versatile)$/i.test(String(model || '').trim());
}

function mapRetiredGroqModel(model, { light = false } = {}) {
  const m = String(model || '').trim();
  if (!isRetiredGroqModel(m)) return m;
  if (light || /8b-instant/i.test(m)) return 'openai/gpt-oss-20b';
  return 'openai/gpt-oss-120b';
}

function resolveModel(provider, { model = null, light = false } = {}) {
  let resolved;
  if (model) resolved = String(model).trim();
  else if (light) {
    const lightEnv = env(`${String(provider.modelEnv || '').replace(/_MODEL$/, '_LIGHT_MODEL')}`);
    resolved = lightEnv || provider.lightModel || env(provider.modelEnv) || provider.defaultModel;
  } else {
    resolved = env(provider.modelEnv) || provider.defaultModel;
  }
  if (provider.id === 'groq') return mapRetiredGroqModel(resolved, { light });
  return resolved;
}

/** Família 2.0 Flash desligada em 1 jun 2026 — a API responde 404. */
function isRetiredGeminiModel(model) {
  return /^gemini-2\.0-flash(?:-lite)?(?:-001)?$/i.test(String(model || '').trim());
}

function geminiModelCandidates(requested) {
  const first = String(requested || '').trim();
  const out = [];
  if (first && !isRetiredGeminiModel(first)) out.push(first);
  for (const m of ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite']) {
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

function isGeminiModelMissingError(status, data) {
  if (Number(status) === 404) return true;
  const msg = String(data?.error?.message || data?.message || '').toLowerCase();
  return /not found|no longer available|is not found/.test(msg);
}

function listConfiguredProviders() {
  return PROVIDERS.filter((p) => Boolean(env(p.envKey))).map((p) => {
    const raw = env(p.modelEnv) || p.defaultModel;
    let model = raw;
    if (p.id === 'gemini') model = geminiModelCandidates(raw)[0];
    else if (p.id === 'groq') model = mapRetiredGroqModel(raw);
    return {
      id: p.id,
      model,
      kind: p.kind,
    };
  });
}

function isFreeProviderId(id) {
  return PROVIDERS.some((p) => p.id === id);
}

/** Normaliza escolha do usuário na barra de IAs. auto/vazio → null. */
function normalizePreferredProvider(raw) {
  const id = String(raw || '')
    .toLowerCase()
    .trim();
  if (!id || id === 'auto') return null;
  if (id === 'cursor' || id === 'ops') return id;
  if (isFreeProviderId(id)) return id;
  return null;
}

function cursorStatusFromRun(runStatus) {
  const st = String(runStatus || '').toUpperCase();
  if (st === 'FINISHED') return 'ok';
  if (st === 'ERROR' || st === 'CANCELLED' || st === 'EXPIRED') return 'nok';
  if (st === 'RUNNING' || st === 'CREATING') return 'running';
  return null;
}

function cursorDetail(cursorStatus) {
  if (cursorStatus === 'ok') return 'utilizado / ok';
  if (cursorStatus === 'running') return 'utilizado / rodando';
  if (cursorStatus === 'nok') return 'não utilizado / nok';
  return 'não utilizado';
}

function hasAnyFreeProvider() {
  return listConfiguredProviders().length > 0;
}

function pickProviderOrder(preferredId) {
  const configured = PROVIDERS.filter((p) => Boolean(env(p.envKey)));
  if (!configured.length) return [];
  if (!preferredId) return configured;
  const pref = configured.find((p) => p.id === preferredId);
  if (!pref) return configured;
  return [pref, ...configured.filter((p) => p.id !== preferredId)];
}

async function chatOpenAiCompatible(provider, { messages, temperature = 0.2, maxTokens = 2048, model = null, light = false }) {
  const apiKey = env(provider.envKey);
  const resolvedModel = resolveModel(provider, { model, light });
  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider.id === 'openrouter') {
    headers['HTTP-Referer'] =
      env('INTRANET_PUBLIC_URL') || env('RENDER_EXTERNAL_URL') || 'https://intranet.fromtherm.local';
    headers['X-Title'] = 'Intranet Fromtherm Chatbot';
  }
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: resolvedModel,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });
  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const err = new Error(
      data?.error?.message || data?.message || `HTTP ${resp.status} (${provider.id})`
    );
    err.status = resp.status;
    err.provider = provider.id;
    throw err;
  }
  const content =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    '';
  return {
    content: String(content || '').trim(),
    provider: provider.id,
    model: resolvedModel,
    usage: extractUsage(data, 'openai'),
    raw: data,
  };
}

function toGeminiContents(messages) {
  const systemParts = [];
  const contents = [];
  for (const m of messages || []) {
    const role = String(m.role || '').toLowerCase();
    const text = String(m.content || '');
    if (!text) continue;
    if (role === 'system') {
      systemParts.push(text);
      continue;
    }
    contents.push({
      role: role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  }
  return { systemParts, contents };
}

async function chatGemini(provider, { messages, temperature = 0.2, maxTokens = 2048, model = null, light = false }) {
  const apiKey = env(provider.envKey);
  const { systemParts, contents } = toGeminiContents(messages);
  if (!contents.length) {
    throw new Error('Mensagens vazias para Gemini');
  }
  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
  }
  const candidates = geminiModelCandidates(resolveModel(provider, { model, light }));
  let lastErr = null;
  for (const resolvedModel of candidates) {
    const url =
      `${provider.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(resolvedModel)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!resp.ok) {
      lastErr = new Error(
        data?.error?.message || data?.message || `HTTP ${resp.status} (gemini)`
      );
      lastErr.status = resp.status;
      lastErr.provider = provider.id;
      if (isGeminiModelMissingError(resp.status, data) && candidates.length > 1) {
        continue;
      }
      throw lastErr;
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const content = parts.map((p) => p?.text || '').join('').trim();
    return {
      content,
      provider: provider.id,
      model: resolvedModel,
      usage: extractUsage(data, 'gemini'),
      raw: data,
    };
  }
  throw lastErr || new Error('HTTP 404 (gemini)');
}

/**
 * Chat com failover entre provedores configurados.
 * @param {{ messages: Array<{role:string,content:string}>, preferred?: string, temperature?: number, maxTokens?: number, model?: string, light?: boolean }} opts
 */
async function chatCompletion(opts = {}) {
  const order = pickProviderOrder(opts.preferred);
  if (!order.length) {
    const err = new Error(
      'Nenhuma chave de IA grátis configurada (OPENROUTER/GROQ/GEMINI/DEEPSEEK/MISTRAL).'
    );
    err.status = 503;
    err.code = 'NO_FREE_PROVIDER';
    throw err;
  }
  const attempts = [];
  for (const provider of order) {
    try {
      const result =
        provider.kind === 'gemini'
          ? await chatGemini(provider, opts)
          : await chatOpenAiCompatible(provider, opts);
      attempts.push({
        id: provider.id,
        ok: true,
        error: null,
        usage: result.usage || null,
        model: result.model || null,
      });
      return {
        ...result,
        attempts,
      };
    } catch (e) {
      attempts.push({
        id: provider.id,
        ok: false,
        error: e.message || String(e),
        status: Number(e.status || 0) || null,
      });
    }
  }
  const err = new Error(
    `Todos os provedores falharam: ${attempts.map((a) => `${a.id}: ${a.error}`).join(' | ')}`
  );
  err.status = 502;
  err.code = 'ALL_PROVIDERS_FAILED';
  err.details = attempts;
  err.attempts = attempts;
  throw err;
}

function formatUsageDetail(usage) {
  if (!usage || !usage.total_tokens) return '';
  const total = usage.total_tokens;
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  if (prompt || completion) return ` · ~${total} tok (in ${prompt}/out ${completion})`;
  return ` · ~${total} tok`;
}

/**
 * Monta status visual de todas as IAs configuradas + Cursor.
 * status: ok | nok | idle
 */
function buildProviderStatusBoard({
  configured = listConfiguredProviders(),
  attempts = [],
  engine = null,
  cursorStatus = 'idle',
  opsUsed = false,
} = {}) {
  const attemptMap = new Map((attempts || []).map((a) => [a.id, a]));
  const providers = (configured || []).map((p) => {
    const a = attemptMap.get(p.id);
    if (a?.ok) {
      return {
        id: p.id,
        label: p.id,
        status: 'ok',
        detail: `utilizado / ok${formatUsageDetail(a.usage)}`,
        usage: a.usage || null,
        model: a.model || p.model || null,
      };
    }
    if (a && a.ok === false) {
      return {
        id: p.id,
        label: p.id,
        status: 'nok',
        detail: `não utilizado / nok${a.error ? `: ${String(a.error).slice(0, 80)}` : ''}`,
      };
    }
    return { id: p.id, label: p.id, status: 'idle', detail: 'não utilizado' };
  });

  const extras = [
    {
      id: 'ops',
      label: 'ops',
      status: opsUsed ? 'ok' : 'idle',
      detail: opsUsed ? 'utilizado / ok' : 'não utilizado',
    },
    {
      id: 'cursor',
      label: 'cursor',
      status: cursorStatus === 'ok' || cursorStatus === 'running' || cursorStatus === 'nok'
        ? cursorStatus
        : 'idle',
      detail:
        cursorStatus === 'ok'
          ? 'utilizado / ok'
          : cursorStatus === 'running'
            ? 'utilizado / rodando'
            : cursorStatus === 'nok'
              ? 'não utilizado / nok'
              : 'não utilizado',
    },
  ];

  const usageTotal = (attempts || []).reduce((acc, a) => {
    if (!a?.ok || !a.usage?.total_tokens) return acc;
    return acc + Number(a.usage.total_tokens || 0);
  }, 0);

  return {
    engine: engine || null,
    providers: [...providers, ...extras],
    usageTotal: usageTotal || null,
    updatedAt: new Date().toISOString(),
  };
}

/** Atualiza só o chip do Cursor (ex.: running → ok quando o run termina). */
function withCursorStatus(board, cursorStatus) {
  if (!cursorStatus) return board || null;
  const base =
    board && Array.isArray(board.providers)
      ? board
      : buildProviderStatusBoard({ cursorStatus: 'idle' });
  return {
    ...base,
    updatedAt: new Date().toISOString(),
    providers: (base.providers || []).map((p) => {
      if (p.id !== 'cursor') return p;
      return {
        ...p,
        status: cursorStatus,
        detail: cursorDetail(cursorStatus),
      };
    }),
  };
}

function buildCursorLaunchRouting({
  source = 'cursor-direct',
  summary = 'Cursor',
} = {}) {
  return {
    ...buildProviderStatusBoard({
      configured: listConfiguredProviders(),
      attempts: [],
      engine: 'cursor',
      cursorStatus: 'running',
    }),
    source,
    summary,
  };
}

module.exports = {
  PROVIDERS,
  listConfiguredProviders,
  hasAnyFreeProvider,
  isFreeProviderId,
  normalizePreferredProvider,
  cursorStatusFromRun,
  withCursorStatus,
  buildCursorLaunchRouting,
  chatCompletion,
  buildProviderStatusBoard,
  isRetiredGeminiModel,
  isRetiredGroqModel,
  mapRetiredGroqModel,
  geminiModelCandidates,
};
