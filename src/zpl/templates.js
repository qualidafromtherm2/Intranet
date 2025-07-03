// src/zpl/chooseTemplate.js
import { gerarZPL_FTeFH, gerarZPL_FTiBR } from './templates.js';

export function chooseZPL(modelo, numeroSerie) {
  const prefixo = modelo.toUpperCase().slice(0, 3);     // FT1, FTI, FH2…

  const isFT_FH  = /^(FT|FH)/.test(prefixo) && prefixo[2] !== 'I';
  const isFTI    = prefixo[2] === 'I';                  // FTI, FHI …

  if (isFT_FH) return gerarZPL_FTeFH(modelo, numeroSerie, {});   // dados vazios
  if (isFTI)   return gerarZPL_FTiBR(modelo, numeroSerie, {});
  throw new Error(`Modelo "${modelo}" não mapeado`);
}
