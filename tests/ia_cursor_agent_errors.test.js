const test = require('node:test');
const assert = require('node:assert/strict');
const { isAgentArchivedError } = require('../utils/iaCursorAgentErrors');

test('detecta code agent_archived', () => {
  assert.equal(isAgentArchivedError({ message: 'agent_archived' }), true);
  assert.equal(isAgentArchivedError({ data: { error: 'agent_archived' } }), true);
  assert.equal(isAgentArchivedError({ data: { code: 'agent_archived', message: 'gone' } }), true);
});

test('detecta frase da API Cursor', () => {
  assert.equal(isAgentArchivedError(new Error('Agent is archived')), true);
  assert.equal(isAgentArchivedError({ data: { message: 'Agent has been archived' } }), true);
});

test('não marca erro comum como archived', () => {
  assert.equal(isAgentArchivedError(new Error('O agent anterior ainda está RUNNING')), false);
  assert.equal(isAgentArchivedError({ message: 'HTTP 409' }), false);
  assert.equal(isAgentArchivedError(null), false);
});
