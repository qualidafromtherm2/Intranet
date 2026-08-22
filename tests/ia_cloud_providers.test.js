const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePreferredProvider,
  isFreeProviderId,
  cursorStatusFromRun,
  withCursorStatus,
  buildProviderStatusBoard,
  isRetiredGeminiModel,
  isRetiredGroqModel,
  mapRetiredGroqModel,
  geminiModelCandidates,
} = require('../utils/iaCloudProviders');

test('normalizePreferredProvider', () => {
  assert.equal(normalizePreferredProvider(''), null);
  assert.equal(normalizePreferredProvider('auto'), null);
  assert.equal(normalizePreferredProvider('Gemini'), 'gemini');
  assert.equal(normalizePreferredProvider('cursor'), 'cursor');
  assert.equal(normalizePreferredProvider('ops'), 'ops');
  assert.equal(normalizePreferredProvider('foobar'), null);
});

test('isFreeProviderId', () => {
  assert.equal(isFreeProviderId('groq'), true);
  assert.equal(isFreeProviderId('cursor'), false);
  assert.equal(isFreeProviderId('ops'), false);
});

test('cursorStatusFromRun', () => {
  assert.equal(cursorStatusFromRun('FINISHED'), 'ok');
  assert.equal(cursorStatusFromRun('CANCELLED'), 'nok');
  assert.equal(cursorStatusFromRun('ERROR'), 'nok');
  assert.equal(cursorStatusFromRun('RUNNING'), 'running');
  assert.equal(cursorStatusFromRun('CREATING'), 'running');
  assert.equal(cursorStatusFromRun(''), null);
});

test('gemini 2.0 flash aposentado vira 3.5', () => {
  assert.equal(isRetiredGeminiModel('gemini-2.0-flash'), true);
  assert.equal(isRetiredGeminiModel('gemini-2.0-flash-lite'), true);
  assert.equal(isRetiredGeminiModel('gemini-3.5-flash'), false);
  assert.deepEqual(geminiModelCandidates('gemini-2.0-flash')[0], 'gemini-3.5-flash');
  assert.deepEqual(geminiModelCandidates('gemini-3.6-flash')[0], 'gemini-3.6-flash');
});

test('groq llama aposentado vira gpt-oss', () => {
  assert.equal(isRetiredGroqModel('llama-3.1-8b-instant'), true);
  assert.equal(isRetiredGroqModel('llama-3.3-70b-versatile'), true);
  assert.equal(isRetiredGroqModel('openai/gpt-oss-20b'), false);
  assert.equal(mapRetiredGroqModel('llama-3.1-8b-instant'), 'openai/gpt-oss-20b');
  assert.equal(mapRetiredGroqModel('llama-3.3-70b-versatile'), 'openai/gpt-oss-120b');
  assert.equal(mapRetiredGroqModel('llama-3.3-70b-versatile', { light: true }), 'openai/gpt-oss-20b');
  assert.equal(mapRetiredGroqModel('openai/gpt-oss-120b'), 'openai/gpt-oss-120b');
});

test('withCursorStatus atualiza só o Cursor e cria board se faltar', () => {
  const idle = buildProviderStatusBoard({
    configured: [{ id: 'groq', model: 'x', kind: 'openai' }],
    attempts: [],
    cursorStatus: 'running',
  });
  assert.equal(idle.providers.find((p) => p.id === 'cursor').status, 'running');
  const done = withCursorStatus(idle, 'ok');
  assert.equal(done.providers.find((p) => p.id === 'cursor').status, 'ok');
  assert.equal(done.providers.find((p) => p.id === 'groq').status, 'idle');
  const created = withCursorStatus(null, 'nok');
  assert.equal(created.providers.find((p) => p.id === 'cursor').status, 'nok');
});
