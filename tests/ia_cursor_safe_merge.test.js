const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeCacheBusterHunk,
  mergeJsOptionHunk,
  mergePreambleHunk,
  resolveConflictHunk,
  applyConflictMarkers,
  mergeFile3Way,
} = require('../utils/iaCursorSafeMerge');

test('cache buster: v mais novo + script novo da main', () => {
  const ours = '  <link rel="stylesheet" href="/public/css/cursor-chatbot-page.css?v=20260822d"/>';
  const theirs =
    '  <link rel="stylesheet" href="/public/css/cursor-chatbot-page.css?v=20260822c"/>\n' +
    '  <link rel="stylesheet" href="/public/css/chamado-ia-chat.css?v=20260822a"/>';
  const out = mergeCacheBusterHunk(ours, theirs);
  assert.match(out, /cursor-chatbot-page\.css\?v=20260822d/);
  assert.match(out, /chamado-ia-chat\.css\?v=20260822a/);
  assert.doesNotMatch(out, /20260822c/);
});

test('js options: une followUp e readOnlySql na assinatura', () => {
  const ours = 'function wrapPromptForCursor(prompt, { followUp = false } = {}) {';
  const theirs = 'function wrapPromptForCursor(prompt, { readOnlySql = false } = {}) {';
  const out = mergeJsOptionHunk(ours, theirs);
  assert.match(out, /followUp = false/);
  assert.match(out, /readOnlySql = false/);
});

test('js options: une followUp e readOnlySql na chamada', () => {
  const ours = '        body: { prompt: wrapPromptForCursor(prompt, { followUp: true }) },';
  const theirs = '        body: { prompt: wrapPromptForCursor(prompt, { readOnlySql: chamadoIa }) },';
  const out = mergeJsOptionHunk(ours, theirs);
  assert.match(out, /followUp: true/);
  assert.match(out, /readOnlySql: chamadoIa/);
});

test('preamble: readOnly da main + followUpHint da branch', () => {
  const ours = '    text: `${sqlAccessPreamble()}\\n---\\n${followUpHint}${text}`,';
  const theirs = '    text: `${sqlAccessPreamble({ readOnly: readOnlySql })}\\n---\\n\\n${text}`,';
  const out = mergePreambleHunk(ours, theirs);
  assert.match(out, /readOnly: readOnlySql/);
  assert.match(out, /followUpHint/);
});

test('applyConflictMarkers resolve o HTML do #115', () => {
  const marked = [
    '  <link rel="stylesheet" href="/public/css/bipagem-contagem.css?v=20260814b"/>',
    '<<<<<<< pr',
    '  <link rel="stylesheet" href="/public/css/cursor-chatbot-page.css?v=20260822d"/>',
    '=======',
    '  <link rel="stylesheet" href="/public/css/cursor-chatbot-page.css?v=20260822c"/>',
    '  <link rel="stylesheet" href="/public/css/chamado-ia-chat.css?v=20260822a"/>',
    '>>>>>>> main',
    '  <!-- Anti-flicker -->',
    '',
  ].join('\n');
  const out = applyConflictMarkers(marked);
  assert.equal(out.ok, true);
  assert.match(out.text, /cursor-chatbot-page\.css\?v=20260822d/);
  assert.match(out.text, /chamado-ia-chat\.css/);
  assert.doesNotMatch(out.text, /<<<<<<</);
});

test('hunk inseguro não é inventado', () => {
  const r = resolveConflictHunk(
    'function foo() { return 1; }',
    'function foo() { return 2; }'
  );
  assert.equal(r.ok, false);
});

test('mergeFile3Way: um lado igual à base pega o outro', () => {
  const r = mergeFile3Way('aaa\n', 'aaa\n', 'bbb\n');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'bbb\n');
});
