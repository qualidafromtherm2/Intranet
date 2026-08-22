const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PRESET_AGENTS,
  isValidAgentId,
  resolveModelSelection,
  listarAgentesPublicos,
  rotuloAgente,
  montarPayloadCriacao,
  montarPayloadFollowup,
  repoPadrao
} = require('../utils/cursorChat');

const MODELOS = [
  { id: 'composer-2', displayName: 'Composer 2', aliases: ['composer'] },
  { id: 'gpt-5.2', displayName: 'GPT 5.2', aliases: [] },
  { id: 'claude-4.6-sonnet-thinking', displayName: 'Claude Thinking', aliases: [] }
];

test('catálogo público começa com Auto, GPT e Cloud', () => {
  const lista = listarAgentesPublicos(MODELOS);
  assert.deepEqual(lista.slice(0, 3).map((item) => item.id), ['auto', 'gpt', 'cloud']);
  assert.equal(PRESET_AGENTS.length, 3);
  assert.ok(lista.some((item) => item.id === 'composer-2'));
});

test('resolve Auto sem modelo, GPT e Cloud pelos ids da API', () => {
  assert.equal(resolveModelSelection('auto', MODELOS), null);
  assert.deepEqual(resolveModelSelection('gpt', MODELOS), { id: 'gpt-5.2' });
  assert.deepEqual(resolveModelSelection('cloud', MODELOS), { id: 'composer-2' });
  assert.deepEqual(resolveModelSelection('claude-4.6-sonnet-thinking', MODELOS), {
    id: 'claude-4.6-sonnet-thinking'
  });
});

test('payload de criação usa o repositório da Intranet e o modelo escolhido', () => {
  const payload = montarPayloadCriacao({
    text: 'Corrigir o botão do chat',
    agentId: 'gpt',
    models: MODELOS
  });
  assert.equal(payload.prompt.text, 'Corrigir o botão do chat');
  assert.equal(payload.model.id, 'gpt-5.2');
  assert.equal(payload.repos[0].url, repoPadrao());
  assert.equal(payload.autoCreatePR, true);
});

test('follow-up e ids de agente', () => {
  assert.deepEqual(montarPayloadFollowup({ text: 'continua' }), { prompt: { text: 'continua' } });
  assert.equal(isValidAgentId('bc-4bbd9bc4-8fc6-432d-a6aa-d9e567d4ff6e'), true);
  assert.equal(isValidAgentId('sgf-ai-agent-btn'), false);
  assert.equal(rotuloAgente('auto'), 'Auto');
});

test('mensagem vazia não vira payload', () => {
  assert.throws(() => montarPayloadCriacao({ text: '   ' }), /Mensagem vazia/);
  assert.throws(() => montarPayloadFollowup({ text: '' }), /Mensagem vazia/);
});
