/**
 * Parse, normalização e correção de endereço em sac.controle_tecnicos.
 */

/** Dicas por CEP (logradouro/bairro oficiais) para registros muito inconsistentes */
const CEP_HINTS = {
  '91210060': { rua: 'Rua Franklin', bairro: 'Jardim Sabará' },
  '91770000': { rua: 'Avenida Juca Batista', bairro: 'Cavalhada' },
  '74594018': { rua: 'Rua FN20', bairro: 'Jardim Fonte Nova' },
  '25725905': { rua: 'Rodovia BR-040 Km 66', bairro: 'Araras' },
  '83327070': { rua: 'Rua Taquari', bairro: 'Alphaville Graciosa' },
  '13044260': { rua: 'Rua Synira de Arruda Valente', bairro: 'Jardim dos Oliveiras' },
  '83601000': { rua: 'Rua Centenário', bairro: 'Centro' },
  '41480110': { rua: 'Caminho 40', bairro: 'Mussurunga II' },
  '24943240': { rua: 'Rua Dois', bairro: 'Inoã' },
};

/** Correções manuais pontuais após heurísticas automáticas */
const OVERRIDES_POR_ID = {
  10: { endereco: 'SHA QUADRA 04 CONJUNTO 05 CHÁCARA 43', numero: null, bairro: null, complemento: 'CASA 09B' },
  13: { endereco: 'Rua Acre', numero: '561', bairro: 'Areias', complemento: 'Apto 102' },
  26: { endereco: 'RUA 03 CHÁCARA 81', numero: null, bairro: 'SETOR HABITACIONAL VICENTE PIRES', complemento: 'QUADRA 1 LOTE 17' },
  34: { endereco: 'Rua Francisco de Assis', numero: '226', bairro: 'Jardim Campineiro', complemento: '' },
  40: { endereco: 'Rua Synira de Arruda Valente', numero: '1703', bairro: 'Jardim dos Oliveiras', complemento: '' },
  23: { endereco: 'AV JUCA BATISTA', numero: '1458', bairro: 'Ipanema', complemento: 'CASA 23' },
  25: { endereco: 'R FN20', numero: '204', bairro: 'Jardim Fonte Nova', complemento: 'Quadra 15 Lote 17 (SALA 01)' },
  32: { endereco: 'Rua 05 Chácara 115', numero: 'Lote 01', bairro: 'Vicente Pires', complemento: '' },
  35: { endereco: 'Rodovia BR-040 Km 66', numero: 'S/N', bairro: 'Araras', complemento: 'Setor 3 casa 21' },
  41: { endereco: 'Av Hercílio Luz', numero: '474', bairro: 'Balneário Cambiju', complemento: '' },
  42: { endereco: 'R Lino Coutinho', numero: '1579', bairro: 'Ipiranga', complemento: 'LOJA TERREA' },
  49: { endereco: 'Caminho 40', numero: '07', bairro: 'Mussurunga II', complemento: 'SETOR J, RUA E, CASA' },
  52: {
    endereco: 'RUA 02',
    numero: 'LOTE 23 QD A',
    bairro: 'Inoã',
    complemento: 'CONDOMÍNIO RESIDENCIAL TAQUARA 2 (BOSQUE FUNDO - RUA DA UPA)',
  },
};

function juntarComplemento(...partes) {
  return [...new Set(partes.map((p) => String(p || '').trim()).filter(Boolean))].join('; ');
}

function extrairComplementoParenteses(texto) {
  const s = String(texto || '').trim();
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { principal: s, complemento: '' };
  return { principal: m[1].trim(), complemento: m[2].trim() };
}

function parseEnderecoTecnicoLegado(raw) {
  const s = String(raw || '').trim();
  if (!s) return { endereco: '', numero: '', bairro: '', complemento: '' };

  const commaIdx = s.indexOf(',');
  if (commaIdx >= 0) {
    const endereco = s.slice(0, commaIdx).trim();
    const rest = s.slice(commaIdx + 1).trim();

    const dashMatch = rest.match(/^(.+?)\s*-\s*(.+)$/);
    if (dashMatch) {
      const numero = dashMatch[1].trim();
      const depoisDash = dashMatch[2].trim();

      if (/^\([^)]+\)$/.test(depoisDash)) {
        return {
          endereco,
          numero,
          bairro: '',
          complemento: depoisDash.replace(/^\(|\)$/g, '').trim(),
        };
      }

      const ext = extrairComplementoParenteses(depoisDash);
      return {
        endereco,
        numero,
        bairro: ext.principal,
        complemento: ext.complemento,
      };
    }

    const tokenMatch = rest.match(/^(\S+)/);
    if (tokenMatch && /^\d|^[Ss]\/?[Nn]/i.test(tokenMatch[1])) {
      const numero = tokenMatch[1];
      const resto = rest.slice(tokenMatch[0].length).trim();
      const ext = extrairComplementoParenteses(resto);
      return {
        endereco,
        numero,
        bairro: ext.principal,
        complemento: ext.complemento,
      };
    }

    const ext = extrairComplementoParenteses(rest);
    return {
      endereco,
      numero: '',
      bairro: ext.principal,
      complemento: ext.complemento,
    };
  }

  const ext = extrairComplementoParenteses(s);
  return {
    endereco: ext.principal,
    numero: '',
    bairro: '',
    complemento: ext.complemento,
  };
}

function limparNumero(numero, complementoAtual) {
  let s = String(numero || '').trim().replace(/,+\s*$/g, '').replace(/^,+\s*/g, '').trim();
  if (!s) return { numero: '', complementoExtra: '' };

  if (/^rio\s+de\s+janeiro$/i.test(s)) {
    return { numero: '', complementoExtra: '' };
  }

  if (/^(LOTE|QUADRA|QD|COMPLEMENTO|CASA|AP|APT|APTO|SALA|LOJA|BL|BLOCO|ANDAR|SETOR|KM|COMPLEMENTO)/i.test(s)) {
    return { numero: '', complementoExtra: s };
  }

  const numCompl = s.match(/^(\d+[A-Za-z]?)\s*[–-]\s*(.+)$/);
  if (numCompl) {
    return { numero: numCompl[1], complementoExtra: numCompl[2].trim() };
  }

  if (/LOTE|QD|QUADRA/i.test(s) && !/^\d/.test(s)) {
    return { numero: '', complementoExtra: s.replace(/,+\s*$/g, '').trim() };
  }

  if (/^s\/?n$/i.test(s)) return { numero: 'S/N', complementoExtra: '' };

  const m = s.match(/^(\d+[A-Za-z]?)/);
  if (m) {
    const rest = s.slice(m[0].length).replace(/^[\s,.-]+/, '').trim();
    return { numero: m[1], complementoExtra: rest };
  }

  return { numero: '', complementoExtra: s };
}

function corrigirBairroComplemento(bairro, complemento) {
  let b = String(bairro || '').trim();
  let c = String(complemento || '').trim();
  if (!b) return { bairro: '', complemento: c, numeroExtra: '' };

  // lixo de parse: "A, INOÃ - ..."
  b = b.replace(/^[A-Z],\s*/u, '');

  const numInBairro = b.match(/^n[ºo°.]?\s*(\d+)[,\s]+(\d+|[A-Za-z0-9]+)\s*[—–-]\s*(.+)$/iu);
  if (numInBairro) {
    return {
      bairro: numInBairro[3].trim(),
      complemento: juntarComplemento(c, `Apto ${numInBairro[2].trim()}`),
      numeroExtra: numInBairro[1],
    };
  }

  const apDash = b.match(/^((?:AP|APT|APTO)\s*.+?)\s*-\s*(.+)$/iu);
  if (apDash) {
    return {
      bairro: apDash[2].trim(),
      complemento: juntarComplemento(c, apDash[1].trim()),
      numeroExtra: '',
    };
  }

  const dashSplit = b.match(/^(.+?)\s+-\s+(.+)$/u);
  if (dashSplit) {
    const left = dashSplit[1].trim();
    const right = dashSplit[2].trim();
    if (!/^(rodovia|av\.?|avenida|r\.|rua|estrada|br[\s-])/iu.test(left)) {
      return {
        bairro: left,
        complemento: juntarComplemento(c, right),
        numeroExtra: '',
      };
    }
    return { bairro: '', complemento: juntarComplemento(c, b), numeroExtra: '' };
  }

  const casaComma = b.match(/^((?:CASA|LOJA|APT|AP|APTO|SALA)\s*[^,]+),\s*(.+)$/iu);
  if (casaComma) {
    return {
      bairro: casaComma[2].trim(),
      complemento: juntarComplemento(c, casaComma[1].trim()),
      numeroExtra: '',
    };
  }

  if (/^loja\s+\d+/iu.test(b)) {
    return { bairro: '', complemento: juntarComplemento(c, b), numeroExtra: '' };
  }

  if (/^(rodovia|br[\s-])/iu.test(b)) {
    return { bairro: '', complemento: juntarComplemento(c, b), numeroExtra: '' };
  }

  if (b.includes('.') && /\bVILA\b/iu.test(b)) {
    const partes = b.split(/\.\s*/).map((p) => p.trim()).filter(Boolean);
    if (partes.length > 1) {
      return { bairro: partes[partes.length - 1], complemento: juntarComplemento(c, partes.slice(0, -1).join('. ')), numeroExtra: '' };
    }
  }

  return { bairro: b, complemento: c, numeroExtra: '' };
}

function extrairDoEndereco(endereco) {
  let e = String(endereco || '').trim().replace(/\s+/g, ' ');
  let numero = '';
  let bairro = '';
  let complemento = '';

  if (!e) return { endereco: '', numero, bairro, complemento };

  const bairroTag = e.match(/\b[Bb]airro:?\s*(.+)$/u);
  if (bairroTag) {
    bairro = bairroTag[1].trim();
    e = e.slice(0, bairroTag.index).trim();
  }

  const nDashB = e.match(/^(.+?)\s+N[ºo°.]?\s*(\d+[A-Za-z]?)\s*-\s*(.+)$/iu);
  if (nDashB) {
    return {
      endereco: nDashB[1].trim(),
      numero: nDashB[2],
      bairro: nDashB[3].trim() || bairro,
      complemento,
    };
  }

  const avBairro = e.match(/^(.+?)\s+(\d+)\s+bairro\s+(.+)$/iu);
  if (avBairro) {
    return {
      endereco: avBairro[1].trim(),
      numero: avBairro[2],
      bairro: avBairro[3].trim(),
      complemento,
    };
  }

  const numBairro = e.match(/^(.+?)\s+(\d+)\s+(JARDIM\s+.+|CENTRO|BAIRRO\s+.+)$/iu);
  if (numBairro) {
    return {
      endereco: numBairro[1].trim(),
      numero: numBairro[2],
      bairro: numBairro[3].trim(),
      complemento,
    };
  }

  const nDot = e.match(/^(.*?)\s+N\.?\s*(\d+[A-Za-z]?)(.*)$/iu);
  if (nDot) {
    const resto = nDot[3].trim();
    const ext = extrairComplementoParenteses(resto);
    return {
      endereco: nDot[1].trim(),
      numero: nDot[2],
      bairro: bairro || ext.principal,
      complemento: juntarComplemento(complemento, ext.complemento),
    };
  }

  const dashBairro = e.match(/^(.+?)\s+-\s+([^(-]{3,50})$/u);
  if (dashBairro && !/\d{3,}/u.test(dashBairro[2])) {
    return {
      endereco: dashBairro[1].trim(),
      numero,
      bairro: dashBairro[2].trim(),
      complemento,
    };
  }

  const trailNum = e.match(/^(.+?)\s+(\d+[A-Za-z]?)$/u);
  if (trailNum) {
    const maybeStreet = trailNum[1].trim();
    const prevWord = (maybeStreet.split(/\s+/u).pop() || '').replace(/[^\wÁÉÍÓÚÃÕÂÊÎÔÛÇáéíóúãõâêîôûç]/gu, '');
    const naoSeparar = /^(CHÁCARA|CHACARA|QUADRA|CONJUNTO|LOTE|KM|BLOCO|CASA|SETOR)$/iu.test(prevWord);
    if (!naoSeparar && (/^(RUA|AV|AVENIDA|R\.|ESTRADA|ALAMEDA|TRAVESSA|TV|ROD|RODOVIA|CAMINHO)/iu.test(maybeStreet) || maybeStreet.split(/\s+/u).length >= 2)) {
      return {
        endereco: maybeStreet,
        numero: trailNum[2],
        bairro,
        complemento,
      };
    }
  }

  const ext = extrairComplementoParenteses(e);
  if (ext.complemento) {
    return { endereco: ext.principal, numero, bairro, complemento: juntarComplemento(complemento, ext.complemento) };
  }

  return { endereco: e, numero, bairro, complemento };
}

function aplicarCepHint(campos, cep) {
  const clean = String(cep || '').replace(/\D/g, '');
  const hint = CEP_HINTS[clean];
  if (!hint) return campos;

  const out = { ...campos };
  if (hint.rua && (!out.endereco || out.endereco.length < 4 || /^(Petrópolis|Rio)/iu.test(out.endereco))) {
    out.endereco = hint.rua;
  }
  if (hint.bairro && (!out.bairro || /^(rodovia|loja|CASA|A,)/iu.test(out.bairro))) {
    out.bairro = hint.bairro;
  }
  return out;
}

function corrigirCamposEnderecoTecnico(row) {
  const id = Number(row?.id) || 0;
  if (OVERRIDES_POR_ID[id]) {
    return { ...OVERRIDES_POR_ID[id] };
  }

  let { endereco, numero, bairro, complemento } = {
    endereco: String(row?.endereco || '').trim(),
    numero: String(row?.numero || '').trim(),
    bairro: String(row?.bairro || '').trim(),
    complemento: String(row?.complemento || '').trim(),
  };

  const legadoNoEndereco = endereco && (endereco.includes(',') || /\s-\s/u.test(endereco) || /\([^)]+\)\s*$/u.test(endereco));
  if (legadoNoEndereco && !numero && !bairro && !complemento) {
    const parsed = parseEnderecoTecnicoLegado(endereco);
    endereco = parsed.endereco;
    numero = parsed.numero;
    bairro = parsed.bairro;
    complemento = parsed.complemento;
  } else {
    const ext = extrairDoEndereco(endereco);
    endereco = ext.endereco || endereco;
    if (!numero && ext.numero) numero = ext.numero;
    if (!bairro && ext.bairro) bairro = ext.bairro;
    complemento = juntarComplemento(complemento, ext.complemento);
  }

  const numFix = limparNumero(numero, complemento);
  numero = numFix.numero;
  complemento = juntarComplemento(complemento, numFix.complementoExtra);

  const bairroFix = corrigirBairroComplemento(bairro, complemento);
  bairro = bairroFix.bairro;
  complemento = bairroFix.complemento;
  if (!numero && bairroFix.numeroExtra) numero = bairroFix.numeroExtra;

  let result = {
    endereco: endereco.trim(),
    numero: numero.trim(),
    bairro: bairro.trim(),
    complemento: complemento.trim(),
  };

  result = aplicarCepHint(result, row?.cep);

  return {
    endereco: result.endereco || null,
    numero: result.numero || null,
    bairro: result.bairro || null,
    complemento: result.complemento || null,
  };
}

function normalizarEnderecoTecnicoRow(row) {
  if (!row) return { endereco: '', numero: '', bairro: '', complemento: '' };
  const c = corrigirCamposEnderecoTecnico(row);
  return {
    endereco: c.endereco || '',
    numero: c.numero || '',
    bairro: c.bairro || '',
    complemento: c.complemento || '',
  };
}

function montarEnderecoCompletoTecnico(fields) {
  const endereco = String(fields?.endereco || '').trim();
  const numero = String(fields?.numero || '').trim();
  const bairro = String(fields?.bairro || '').trim();
  const complemento = String(fields?.complemento || '').trim();

  let out = endereco;
  if (numero) out = out ? `${out}, ${numero}` : numero;
  if (bairro) out += ` - ${bairro}`;
  if (complemento) out += ` (${complemento})`;
  return out.trim();
}

function sanitizarCamposEnderecoTecnico(body) {
  const merged = corrigirCamposEnderecoTecnico({
    endereco: body?.endereco,
    numero: body?.numero,
    bairro: body?.bairro,
    complemento: body?.complemento,
    cep: body?.cep,
  });
  return {
    endereco: merged.endereco || '',
    numero: merged.numero || '',
    bairro: merged.bairro || '',
    complemento: merged.complemento || '',
  };
}

module.exports = {
  parseEnderecoTecnicoLegado,
  corrigirCamposEnderecoTecnico,
  normalizarEnderecoTecnicoRow,
  montarEnderecoCompletoTecnico,
  sanitizarCamposEnderecoTecnico,
  CEP_HINTS,
  OVERRIDES_POR_ID,
};
