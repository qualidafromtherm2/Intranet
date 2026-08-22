const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePreferredProvider,
  isFreeProviderId,
  cursorStatusFromRun,
  withCursorStatus,
  buildProviderStatusBoard,
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
