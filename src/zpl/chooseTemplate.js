/*  src/zpl/chooseTemplate.js  */
const { gerarZPL_FTeFH, gerarZPL_FTiBR } = require('./templates');

/**
 * Decide qual layout usar e devolve o ZPL pronto.
 * @param {string} modelo      – FT160, FTI050, FH200, FHI300…
 * @param {string} numeroSerie – ticket/OP/etc.
 */
function chooseZPL (modelo, numeroSerie) {
  if (!modelo) throw new Error('modelo vazio');
  const code = modelo.toUpperCase();

  // regra: começa com FT ou FH
  if (!/^F[TH]/.test(code)) {
    throw new Error(`Modelo "${modelo}" não começa com FT ou FH`);
  }

  // terceira letra
  const third = code[2];

  // FT? e a 3ª letra ≠ I  →  layout FTeFH
  if (third !== 'I') return gerarZPL_FTeFH(modelo, numeroSerie);

  // 3ª letra = I → layout FTiBR
  return gerarZPL_FTiBR(modelo, numeroSerie);
}

module.exports = { chooseZPL };
