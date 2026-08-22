/**
 * Chat do Cloud Agent do Cursor na Intranet.
 * Independente do Assistente SGF (OpenAI / ChatGPT).
 */

const PRESET_AGENTS = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Cursor escolhe o modelo padrão da conta'
  },
  {
    id: 'gpt',
    label: 'GPT',
    description: 'Usa um modelo GPT disponível no Cloud Agent'
  },
  {
    id: 'cloud',
    label: 'Cloud',
    description: 'Agente na nuvem com o modelo mais capaz da lista'
  }
];

const PRESET_IDS = new Set(PRESET_AGENTS.map((item) => item.id));

function repoPadrao() {
  const owner = String(process.env.GITHUB_OWNER || 'qualidafromtherm2').trim();
  const repo = String(process.env.GITHUB_REPO || 'Intranet').trim();
  return `https://github.com/${owner}/${repo}`;
}

function cursorApiKey() {
  return String(process.env.CURSOR_API_KEY || process.env.CURSOR_API_TOKEN || '').trim();
}

function isValidAgentId(id) {
  return /^bc-[a-zA-Z0-9-]+$/.test(String(id || '').trim());
}

function isValidRunId(id) {
  return /^run-[a-zA-Z0-9-]+$/.test(String(id || '').trim());
}

function normalizarModelos(payload) {
  const bruto = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.models)
      ? payload.models.map((id) => (typeof id === 'string' ? { id } : id))
      : [];
  return bruto
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        return { id: item, displayName: item, aliases: [], description: '' };
      }
      const id = String(item.id || '').trim();
      if (!id) return null;
      return {
        id,
        displayName: String(item.displayName || item.label || id).trim(),
        aliases: Array.isArray(item.aliases) ? item.aliases.map((alias) => String(alias)) : [],
        description: String(item.description || '').trim()
      };
    })
    .filter(Boolean);
}

function encontrarModelo(models, pred) {
  return (Array.isArray(models) ? models : []).find(pred) || null;
}

function resolveModelSelection(agentId, models = []) {
  const chave = String(agentId || '').trim();
  const id = chave.toLowerCase();
  if (!id || id === 'auto' || id === 'default') return null;

  const lista = normalizarModelos({ items: models });

  if (id === 'gpt') {
    const gpt = encontrarModelo(lista, (item) => (
      /^gpt/i.test(item.id) || /gpt/i.test(item.displayName) || item.aliases.some((alias) => /gpt/i.test(alias))
    ));
    return gpt ? { id: gpt.id } : { id: 'gpt-5.2' };
  }

  if (id === 'cloud') {
    const preferido = encontrarModelo(lista, (item) => /composer/i.test(item.id))
      || encontrarModelo(lista, (item) => /thinking/i.test(item.id));
    return preferido ? { id: preferido.id } : null;
  }

  const direto = encontrarModelo(lista, (item) => (
    item.id === chave || item.id === id || item.aliases.includes(chave) || item.aliases.includes(id)
  ));
  if (direto) return { id: direto.id };
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(chave)) return { id: chave };
  return null;
}

function listarAgentesPublicos(models = []) {
  const lista = normalizarModelos({ items: models });
  const extras = lista
    .filter((item) => !PRESET_IDS.has(item.id.toLowerCase()))
    .map((item) => ({
      id: item.id,
      label: item.displayName,
      description: item.description || 'Modelo do Cloud Agent do Cursor'
    }));
  return PRESET_AGENTS.map((item) => ({ ...item })).concat(extras);
}

function rotuloAgente(agentId, models = []) {
  const id = String(agentId || 'auto').trim();
  const catalogo = listarAgentesPublicos(models);
  const encontrado = catalogo.find((item) => item.id === id || item.id.toLowerCase() === id.toLowerCase());
  return encontrado ? encontrado.label : (id || 'Auto');
}

function montarPayloadCriacao({ text, agentId, models, repoUrl, autoCreatePr = true }) {
  const prompt = String(text || '').trim();
  if (!prompt) {
    const erro = new Error('Mensagem vazia');
    erro.status = 400;
    throw erro;
  }
  const payload = {
    prompt: { text: prompt },
    repos: [{
      url: String(repoUrl || repoPadrao()).trim(),
      startingRef: process.env.GITHUB_BRANCH || 'main'
    }],
    autoCreatePR: autoCreatePr !== false
  };
  const model = resolveModelSelection(agentId, models);
  if (model) payload.model = model;
  return payload;
}

function montarPayloadFollowup({ text }) {
  const prompt = String(text || '').trim();
  if (!prompt) {
    const erro = new Error('Mensagem vazia');
    erro.status = 400;
    throw erro;
  }
  return { prompt: { text: prompt } };
}

function resumirAgente(agent = {}) {
  return {
    id: agent.id || null,
    name: agent.name || 'Agente Cursor',
    status: agent.status || null,
    url: agent.url || (agent.id ? `https://cursor.com/agents/${agent.id}` : null),
    latestRunId: agent.latestRunId || null,
    createdAt: agent.createdAt || null,
    updatedAt: agent.updatedAt || null
  };
}

module.exports = {
  PRESET_AGENTS,
  cursorApiKey,
  repoPadrao,
  isValidAgentId,
  isValidRunId,
  normalizarModelos,
  resolveModelSelection,
  listarAgentesPublicos,
  rotuloAgente,
  montarPayloadCriacao,
  montarPayloadFollowup,
  resumirAgente
};
