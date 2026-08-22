const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ler = (arquivo) => fs.readFileSync(path.resolve(__dirname, '..', arquivo), 'utf8');

function trecho(fonte, inicio, fim) {
  const a = fonte.indexOf(inicio);
  const b = fonte.indexOf(fim, a + inicio.length);
  assert.notEqual(a, -1, `Inicio nao encontrado: ${inicio}`);
  assert.notEqual(b, -1, `Fim nao encontrado: ${fim}`);
  return fonte.slice(a, b);
}

test('modal Configuração do chat tem modo teste, aprovar, publicar e descartar', () => {
  const html = ler('menu_produto.html');
  const modal = trecho(html, 'id="cursorChatConfigModal"', 'id="confPerfilNovoModal"');
  assert.match(modal, /Configuração do chat/);
  assert.match(modal, /id="cursorChatCfgTest"/);
  assert.match(modal, />Modo teste</);
  assert.match(modal, /id="cursorChatCfgApprove"/);
  assert.match(modal, />Aprovar</);
  assert.match(modal, /id="cursorChatCfgPublish"/);
  assert.match(modal, />Publicar</);
  assert.match(modal, /id="cursorChatCfgDiscard"/);
  assert.match(modal, />Descartar</);
});

test('JS do chatbot liga os botões do Configuração às ações de revisão', () => {
  const js = ler('public/js/cursor-chatbot-page.js');
  assert.match(js, /function toggleTestMode/);
  assert.match(js, /function enterTestMode/);
  assert.match(js, /function exitTestMode/);
  assert.match(js, /cursorChatCfgTest/);
  assert.match(js, /cursorChatCfgApprove/);
  assert.match(js, /cursorChatCfgPublish/);
  assert.match(js, /cursorChatCfgDiscard/);
  assert.match(js, /void approve\(\)/);
  assert.match(js, /void reject\(\)/);
  assert.match(js, /cursor-chat-preview-mode/);
});
