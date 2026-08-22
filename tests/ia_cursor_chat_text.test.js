const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stripPreviousAssistantPrefix,
  mergeAssistantStream,
  normalizeAssistantText,
  assistantForRun,
  previousAssistantContents,
} = require('../utils/iaCursorChatText');

const PREV =
  'Esse erro vem do PR ter sido aberto como rascunho. Vou confirmar no fluxo de ' +
  'Publicar no site e marcar o PR como pronto. O GitHub bloqueia merge de PR em rascunho.';

test('corta a resposta anterior colada no começo do follow-up', () => {
  const leaked = `${PREV} Vou conferir se o PR foi mesclado e se o deploy no Render já subiu.`;
  assert.equal(
    stripPreviousAssistantPrefix(leaked, [PREV]),
    'Vou conferir se o PR foi mesclado e se o deploy no Render já subiu.'
  );
});

test('não altera resposta nova sem vazamento', () => {
  const fresh = 'Ainda não. O PR #114 continua aberto — não foi mesclado na main.';
  assert.equal(stripPreviousAssistantPrefix(fresh, [PREV]), fresh);
});

test('resposta que é só cópia da anterior vira vazio', () => {
  assert.equal(stripPreviousAssistantPrefix(PREV, [PREV]), '');
});

test('reconhecem prefixo mesmo com quebras/espaços diferentes', () => {
  const leaked = `${PREV.replace(/\. /g, '.\n')}\n\nVou conferir o deploy.`;
  assert.equal(stripPreviousAssistantPrefix(leaked, [PREV]), 'Vou conferir o deploy.');
});

test('delta do stream preserva espaço inicial (não trim cego)', () => {
  assert.equal(stripPreviousAssistantPrefix(' devolve, para passar', [PREV]), ' devolve, para passar');
  assert.equal(stripPreviousAssistantPrefix('  ok', []), '  ok');
});

test('merge: snapshot crescente substitui; delta concatena', () => {
  assert.equal(mergeAssistantStream('Olá', 'Olá, tudo bem?'), 'Olá, tudo bem?');
  assert.equal(mergeAssistantStream('Olá, tudo', ' bem?'), 'Olá, tudo bem?');
  assert.equal(mergeAssistantStream('Olá, tudo bem?', 'Olá'), 'Olá, tudo bem?');
  assert.equal(mergeAssistantStream('abc', 'abc'), 'abc');
});

test('merge: não gruda sessão+devolve quando delta traz espaço', () => {
  assert.equal(mergeAssistantStream('API de sessão', ' devolve'), 'API de sessão devolve');
});

test('merge: pontuação + maiúscula ganha espaço', () => {
  assert.equal(mergeAssistantStream('ao vivo)', 'Vou localizar'), 'ao vivo) Vou localizar');
  assert.equal(mergeAssistantStream('elemento`userName`', 'Agora'), 'elemento`userName` Agora');
});

test('normalize separa textos já grudados', () => {
  assert.match(normalizeAssistantText('sessãodevolve'), /sessão devolve/);
  assert.match(normalizeAssistantText('vivo)Vou localizar'), /vivo\) Vou localizar/);
  assert.match(normalizeAssistantText('e, emparalelo, achar'), /em paralelo/);
  assert.match(normalizeAssistantText('códigoVou'), /código Vou/);
});

test('assistantForRun ignora turno anterior', () => {
  const msgs = [
    { role: 'assistant', content: PREV, runId: 'run-old' },
    { role: 'user', content: 'e ai? subiu?' },
    { role: 'assistant', content: 'Ainda não.', cursor_run_id: 'run-new' },
  ];
  assert.equal(assistantForRun(msgs, 'run-new').content, 'Ainda não.');
  assert.equal(assistantForRun(msgs, 'run-missing'), null);
  assert.deepEqual(previousAssistantContents(msgs, { excludeRunId: 'run-new' }), [PREV]);
});
