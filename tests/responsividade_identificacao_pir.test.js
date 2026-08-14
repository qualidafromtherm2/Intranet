const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.css'), 'utf8');
const frontend = fs.readFileSync(path.resolve(__dirname, '..', 'menu_produto.js'), 'utf8');

test('exclusão da identificação usa ação compacta sem ocupar toda a coluna', () => {
  assert.match(frontend, /aria-label="Excluir identificação de \$\{cod\}"/);
  assert.match(frontend, /<span>Excluir<\/span>/);

  const inicio = css.indexOf(
    '#etiquetasModal.etiquetas-page .etq-btn-excluir-identificacao {',
    css.indexOf('#etiquetasModal.etiquetas-page .etq-btn-excluir-identificacao {') + 1
  );
  const fim = css.indexOf('}', inicio);
  const regra = css.slice(inicio, fim);
  assert.match(regra, /flex:\s*0 0 32px/);
  assert.match(regra, /max-width:\s*32px/);
  assert.doesNotMatch(regra, /flex:\s*1 0 100%/);
});

test('PIR permite rolagem vertical da página e não limita a altura da lista no mobile', () => {
  assert.match(css, /#qualidadeFabricaPane > \.content-wrapper[\s\S]*?overflow-y:\s*auto !important/);
  assert.match(css, /#qualidadeFabricaPane \.pir-pending-list[\s\S]*?max-height:\s*none !important/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /padding-bottom:\s*calc\(110px \+ env\(safe-area-inset-bottom\)\)/);
});

test('PIR prioriza os itens no celular ocultando apenas a legenda auxiliar', () => {
  assert.match(css, /#qualidadeFabricaPane \.pir-alert-legend\s*\{[\s\S]*?display:\s*none !important/);
  assert.match(css, /#qualidadeFabricaPane \.pir-pending-table \.qualidade-pir-pendente-row\s*\{[\s\S]*?box-sizing:\s*border-box/);
});
