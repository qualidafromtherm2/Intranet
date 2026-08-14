'use strict';

function limparTexto(valor) {
  return String(valor ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

function normalizarLeitura(valor) {
  return limparTexto(valor).toUpperCase().replace(/\s+/g, '');
}

function dataIso(ano, mes, dia) {
  const y = Number(ano);
  const m = Number(mes);
  const d = Number(dia);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const data = new Date(Date.UTC(y, m - 1, d));
  if (data.getUTCFullYear() !== y || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extrairDataFinal(valor) {
  const s = limparTexto(valor);
  const padroes = [
    { regex: /(?:[-|_;\s])?(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/, ordem: 'ymd' },
    { regex: /(?:[-|_;\s])?(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/, ordem: 'dmy' },
    { regex: /(?:[-|_;\s])?(\d{4})(\d{2})(\d{2})$/, ordem: 'ymd' },
    { regex: /(?:[-|_;\s])?(\d{2})(\d{2})(\d{4})$/, ordem: 'dmy' },
  ];
  for (const item of padroes) {
    const match = s.match(item.regex);
    if (!match) continue;
    const iso = item.ordem === 'ymd'
      ? dataIso(match[1], match[2], match[3])
      : dataIso(match[3], match[2], match[1]);
    if (!iso) continue;
    return { data: iso, prefixo: s.slice(0, match.index).replace(/[-|_;\s]+$/, '') };
  }
  return { data: null, prefixo: s };
}

function separarModeloOp(prefixo) {
  const s = limparTexto(prefixo);
  if (!s) return { modelo: '', ordemProducao: '' };

  const explicito = s.match(/^(.*?)[-|;]\s*OP\s*[:#-]?\s*([A-Z0-9.]+)$/i);
  if (explicito) {
    return { modelo: limparTexto(explicito[1]), ordemProducao: limparTexto(explicito[2]) };
  }

  const partes = s.split(/[-|;]/).map(limparTexto).filter(Boolean);
  if (partes.length >= 3 && /^\d{1,4}$/.test(partes.at(-1)) && /^[A-Z0-9.]{3,}$/.test(partes.at(-2))) {
    return { modelo: partes.slice(0, -2).join('-'), ordemProducao: partes.at(-2) };
  }
  if (partes.length >= 2 && /^[A-Z0-9.]{3,}$/.test(partes.at(-1))) {
    return { modelo: partes.slice(0, -1).join('-'), ordemProducao: partes.at(-1) };
  }
  if (/^[A-Z0-9.]{3,}$/i.test(s)) return { modelo: '', ordemProducao: s };
  return { modelo: '', ordemProducao: '' };
}

function interpretarLeitura(valor) {
  const bruto = limparTexto(valor);
  const normalizado = normalizarLeitura(bruto);
  if (!normalizado) return { valido: false, erro: 'Nenhum código foi recebido.' };
  if (normalizado.length > 240) return { valido: false, erro: 'O código lido é maior que o limite aceito.' };

  const pipe = bruto.split('|').map(limparTexto);
  if (pipe.length >= 3 && pipe[0] && pipe[2]) {
    const encontrada = pipe.map(extrairDataFinal).find((item) => item.data);
    return {
      valido: true,
      valorBruto: bruto,
      valorNormalizado: normalizado,
      formato: 'etiqueta_op',
      modelo: pipe[0],
      ordemProducao: pipe[2],
      dataReferencia: encontrada?.data || null,
      rotulo: `OP ${pipe[2]}`,
    };
  }

  // Sequências numéricas longas são códigos de barras (EAN/ITF), não números de OP.
  if (/^\d{8,18}$/.test(bruto)) {
    return {
      valido: true,
      valorBruto: bruto,
      valorNormalizado: normalizado,
      formato: 'codigo_barras',
      modelo: '',
      ordemProducao: '',
      dataReferencia: null,
      rotulo: bruto,
    };
  }

  const comData = extrairDataFinal(bruto);
  const partes = separarModeloOp(comData.prefixo);
  if (partes.ordemProducao) {
    const formato = comData.data ? 'modelo_op_data' : (partes.modelo ? 'modelo_op' : 'op');
    return {
      valido: true,
      valorBruto: bruto,
      valorNormalizado: normalizado,
      formato,
      modelo: partes.modelo || '',
      ordemProducao: partes.ordemProducao,
      dataReferencia: comData.data,
      rotulo: partes.modelo
        ? `${partes.modelo} · OP ${partes.ordemProducao}`
        : `OP ${partes.ordemProducao}`,
    };
  }

  if (/^[A-Z0-9][A-Z0-9._:/-]{3,}$/i.test(bruto)) {
    return {
      valido: true,
      valorBruto: bruto,
      valorNormalizado: normalizado,
      formato: 'codigo_barras',
      modelo: '',
      ordemProducao: '',
      dataReferencia: null,
      rotulo: bruto,
    };
  }

  return { valido: false, erro: 'Código incompleto ou em formato não reconhecido.' };
}

module.exports = {
  interpretarLeitura,
  normalizarLeitura,
  extrairDataFinal,
};
