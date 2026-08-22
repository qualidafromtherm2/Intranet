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
    defaultModel: 'openrouter/auto',
    modelEnv: 'OPENROUTER_MODEL',
    kind: 'openai',
  },
  {
    id: 'groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    modelEnv: 'GROQ_MODEL',
    kind: 'openai',
  },
  {
    id: 'gemini',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    modelEnv: 'GEMINI_MODEL',
    kind: 'gemini',
  },
  {
    id: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    modelEnv: 'DEEPSEEK_MODEL',
    kind: 'openai',
  },
  {
    id: 'mistral',
    envKey: 'MISTRAL_API_KEY',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    modelEnv: 'MISTRAL_MODEL',
    kind: 'openai',
  },
];

function env(name) {
  return String(process.env[name] || '').trim();
}

function listConfiguredProviders() {
  return PROVIDERS.filter((p) => Boolean(env(p.envKey))).map((p) => ({
    id: p.id,
    model: env(p.modelEnv) || p.defaultModel,
    kind: p.kind,
  }));
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

async function chatOpenAiCompatible(provider, { messages, temperature = 0.2, maxTokens = 2048 }) {
  const apiKey = env(provider.envKey);
  const model = env(provider.modelEnv) || provider.defaultModel;
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
      model,
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
    model,
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

async function chatGemini(provider, { messages, temperature = 0.2, maxTokens = 2048 }) {
  const apiKey = env(provider.envKey);
  const model = env(provider.modelEnv) || provider.defaultModel;
  const { systemParts, contents } = toGeminiContents(messages);
  if (!contents.length) {
    throw new Error('Mensagens vazias para Gemini');
  }
  const url =
    `${provider.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
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
    const err = new Error(
      data?.error?.message || data?.message || `HTTP ${resp.status} (gemini)`
    );
    err.status = resp.status;
    err.provider = provider.id;
    throw err;
  }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const content = parts.map((p) => p?.text || '').join('').trim();
  return {
    content,
    provider: provider.id,
    model,
    raw: data,
  };
}

/**
 * Chat com failover entre provedores configurados.
 * @param {{ messages: Array<{role:string,content:string}>, preferred?: string, temperature?: number, maxTokens?: number }} opts
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
  const errors = [];
  for (const provider of order) {
    try {
      if (provider.kind === 'gemini') {
        return await chatGemini(provider, opts);
      }
      return await chatOpenAiCompatible(provider, opts);
    } catch (e) {
      errors.push(`${provider.id}: ${e.message}`);
      const st = Number(e.status || 0);
      // 401/403 = chave inválida; 429 = rate limit — tenta próximo
      if (st && st !== 401 && st !== 403 && st !== 429 && st < 500) {
        // erro de cliente não recuperável neste provedor; ainda assim tenta próximo
      }
    }
  }
  const err = new Error(`Todos os provedores falharam: ${errors.join(' | ')}`);
  err.status = 502;
  err.code = 'ALL_PROVIDERS_FAILED';
  err.details = errors;
  throw err;
}

module.exports = {
  PROVIDERS,
  listConfiguredProviders,
  hasAnyFreeProvider,
  chatCompletion,
};
