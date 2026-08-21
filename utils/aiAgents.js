/**
 * Agentes disponíveis no Assistente SGF.
 * O seletor da conversa envia o `id`; o backend resolve o modelo OpenAI.
 */
const DEFAULT_AGENT_ID = 'auto';

const AI_AGENTS = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Escolhe o melhor caminho: FAQ, manuais, consultas e GPT rápido',
    icon: 'fa-wand-magic-sparkles',
    model: 'gpt-4o-mini',
    maxTokens: 1024,
    temperature: 0.4
  },
  {
    id: 'gpt',
    label: 'GPT',
    description: 'GPT-4o — respostas mais completas na conversa',
    icon: 'fa-comments',
    model: 'gpt-4o',
    maxTokens: 1400,
    temperature: 0.4
  },
  {
    id: 'cloud',
    label: 'Cloud',
    description: 'Agente mais capaz, com GPT-4o e ferramentas do sistema',
    icon: 'fa-cloud',
    model: 'gpt-4o',
    maxTokens: 1800,
    temperature: 0.3
  }
];

const AGENTES_POR_ID = new Map(AI_AGENTS.map((agente) => [agente.id, agente]));

function listarAgentesPublicos() {
  return AI_AGENTS.map(({ id, label, description, icon }) => ({
    id,
    label,
    description,
    icon
  }));
}

function resolverAgente(id) {
  const chave = String(id || '').trim().toLowerCase();
  return AGENTES_POR_ID.get(chave) || AGENTES_POR_ID.get(DEFAULT_AGENT_ID);
}

module.exports = {
  AI_AGENTS,
  DEFAULT_AGENT_ID,
  listarAgentesPublicos,
  resolverAgente
};
