const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AI_AGENTS,
  DEFAULT_AGENT_ID,
  listarAgentesPublicos,
  resolverAgente
} = require('../utils/aiAgents');

test('lista pública expõe Auto, GPT e Cloud sem revelar o modelo interno', () => {
  const lista = listarAgentesPublicos();
  assert.deepEqual(lista.map((item) => item.id), ['auto', 'gpt', 'cloud']);
  for (const item of lista) {
    assert.equal(typeof item.label, 'string');
    assert.ok(item.label.length > 0);
    assert.equal(item.model, undefined);
    assert.equal(item.maxTokens, undefined);
  }
});

test('resolve ids conhecidos e cai em Auto quando o valor é inválido', () => {
  assert.equal(resolverAgente('gpt').id, 'gpt');
  assert.equal(resolverAgente('GPT').model, 'gpt-4o');
  assert.equal(resolverAgente('cloud').label, 'Cloud');
  assert.equal(resolverAgente('auto').model, 'gpt-4o-mini');
  assert.equal(resolverAgente('').id, DEFAULT_AGENT_ID);
  assert.equal(resolverAgente('nao-existe').id, DEFAULT_AGENT_ID);
  assert.equal(resolverAgente(null).id, DEFAULT_AGENT_ID);
});

test('catálogo interno tem modelo OpenAI em todos os agentes', () => {
  assert.equal(DEFAULT_AGENT_ID, 'auto');
  assert.ok(AI_AGENTS.length >= 3);
  for (const agente of AI_AGENTS) {
    assert.match(agente.model, /^gpt-/);
    assert.ok(agente.maxTokens >= 1024);
  }
});
