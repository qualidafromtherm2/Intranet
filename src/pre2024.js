const XLSX = require('xlsx');

const PRE2024_COLUMNS = [
  'pedido',
  'nome_fantasia_revende',
  'razao_social_faturamento',
  'ano',
  'mes_referencia',
  'data_entrada_pedido',
  'data_aprovacao_pedido',
  'numero_op_informacoes',
  'data_op',
  'data_prevista_entrega',
  'quantidade',
  'modelo',
  'control',
  'tipo_quadro',
  'esq_esf',
  'situacao',
  'transportadora',
  'nfe',
  'numero_ordem_coleta',
  'mes_faturamento',
  'forma_pgto',
  'data_entrega',
  'cond_pagto',
  'data_pagto',
  'valor',
  'uf',
  'representante',
  'observacoes',
  'os',
  'formula_regexextract',
  'formula_switch',
  'ft_ou_fh',
  'data_entrega_dashboard',
  'data_entrada_pedido_alt'
];

const loggedPre2024DateFailures = new Set();

function toIso(year, month, day) {
  if (!year || !month || !day) return null;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function logDateFailure(raw) {
  // Silenciar avisos de data - eles são esperados quando há texto em colunas de data
  // e não causam erro, apenas retornam null
  if (!loggedPre2024DateFailures.has(raw) && loggedPre2024DateFailures.size < 20) {
    loggedPre2024DateFailures.add(raw);
    // console.warn('[pre2024-sync] data ignorada (formato não reconhecido):', raw);
  }
}

function resetDateFailureLog() {
  loggedPre2024DateFailures.clear();
}

function pre2024ToDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return toIso(parsed.y, parsed.m, parsed.d);
  }

  if (typeof value === 'string') {
    // normaliza espaços e sinais unicode para ASCII
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const norm = trimmed
      // plus unicode → '+'
      .replace(/[\uFF0B\u2795]/g, '+')
      // vários tipos de hífen/menos unicode → '-'
      .replace(/[\u2212\u2010-\u2015\uFF0D\uFE63]/g, '-')
      // barra fullwidth → '/'
      .replace(/[\uFF0F]/g, '/')
      // remove espaços internos
      .replace(/\s+/g, '');
    // a partir daqui, use a string normalizada
    const s = norm;

    // ISO completo ou parcial (yyyy-mm-dd...)
    const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const iso = toIso(isoMatch[1], isoMatch[2], isoMatch[3]);
      if (iso) return iso;
    }

    // dd/mm/aaaa
    const brFull = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brFull) {
      const iso = toIso(brFull[3], brFull[2], brFull[1]);
      if (iso) return iso;
    }

    // dd/mm/aa → assume >=50 => 1900, senão 2000
    const brShort = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
    if (brShort) {
      let year = Number(brShort[3]);
      year += year >= 50 ? 1900 : 2000;
      const iso = toIso(year, brShort[2], brShort[1]);
      if (iso) return iso;
    }

    // Formatos compactos com prefixos/sufixos estranhos
    // Ex: "+021019-10" → captura "21019" (5 dígitos) → interpreta como "02 10 19"
    // Ex: "+020021-02" → captura "20021" (5 dígitos) + sufixo "02"
    const weirdCompact = s.match(/^[+\-]?0*(\d+)(?:[+\-](\d+))?$/);
    if (weirdCompact) {
      let digitsOnly = weirdCompact[1];
      const suffix = weirdCompact[2];
      
      // Se tem 5 dígitos: adiciona zero à esquerda para virar ddmmyy
      if (digitsOnly.length === 5) {
        digitsOnly = '0' + digitsOnly;
      }
      
      // Se tem exatamente 6 dígitos: ddmmyy
      if (digitsOnly.length === 6) {
        const day = digitsOnly.slice(0, 2);
        const month = digitsOnly.slice(2, 4);
        let year = Number(digitsOnly.slice(4, 6));
        year += year >= 50 ? 1900 : 2000;
        const iso = toIso(year, month, day);
        if (iso) return iso;
      }
    }

    // Formatos compactos padrão sem extras
    const compact = s.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (compact) {
      let year = Number(compact[3]);
      year += year >= 50 ? 1900 : 2000;
      const iso = toIso(year, compact[2], compact[1]);
      if (iso) return iso;
    }

    // Detectar anomalias com zeros leading genéricos:
    // "+020021-02" → remover zeros → "20021-02" (tentar reprocessar)
    const leadingZeros = s.match(/^[+\-]?0+(.+)$/);
    if (leadingZeros && leadingZeros[1].length >= 4) {
      const cleaned = leadingZeros[1];
      // Evitar recursão infinita: só reprocessa se cleanup mudou algo substancial
      if (cleaned !== s && !cleaned.startsWith('0')) {
        const reprocess = pre2024ToDate(cleaned);
        if (reprocess) return reprocess;
      }
    }

    // Detectar anomalias: ano-mes com 4 dígitos (YYYY-MM)
    const anomaly = s.match(/^[+\-]?(\d{4})-(\d{2})$/);
    if (anomaly) {
      const iso = toIso(anomaly[1], anomaly[2], '01');
      if (iso) return iso;
    }

    const digits = s.replace(/\D/g, '');
    if (digits.length === 8) {
      const yearFirst = Number(digits.slice(0, 4));
      const monthFirst = digits.slice(4, 6);
      const dayFirst = digits.slice(6, 8);
      if (yearFirst >= 1900) {
        const iso = toIso(yearFirst, monthFirst, dayFirst);
        if (iso) return iso;
      }
      const iso = toIso(digits.slice(4, 8), digits.slice(2, 4), digits.slice(0, 2));
      if (iso) return iso;
    }

    if (digits.length === 6) {
      const day = digits.slice(0, 2);
      const month = digits.slice(2, 4);
      let year = Number(digits.slice(4, 6));
      year += year >= 50 ? 1900 : 2000;
      const iso = toIso(year, month, day);
      if (iso) return iso;
    }

    const fallback = new Date(s);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback.toISOString().slice(0, 10);
    }

    logDateFailure(s);
    return null;
  }

  logDateFailure(String(value));
  return null;
}

function pre2024ToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function pre2024ToText(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function mapPre2024Row(row) {
  if (!row || (row['PEDIDO'] === null || row['PEDIDO'] === undefined)) return null;
  return {
    pedido: pre2024ToText(row['PEDIDO']),
    nome_fantasia_revende: pre2024ToText(row['NOME FANTASIA\nDA REVENDA']),
    razao_social_faturamento: pre2024ToText(row['RAZÃO SOCIAL DO FATURAMENTO']),
    ano: pre2024ToNumber(row['ANO']) ? Number(row['ANO']) : null,
    mes_referencia: pre2024ToText(row['MÊS_REF']),
    data_entrada_pedido: pre2024ToDate(row['DATA ENTR. \nDO PEDIDO']),
    data_aprovacao_pedido: pre2024ToDate(row['DATA APROVAÇÃO DO PEDIDO']),
    numero_op_informacoes: pre2024ToText(row['N.OP /\nINFORMAÇÕES']),
    data_op: pre2024ToDate(row['DATA OP']),
    data_prevista_entrega: pre2024ToDate(row['DATA PREV DE ENTREGA']),
    quantidade: pre2024ToNumber(row['QTD.']),
    modelo: pre2024ToText(row['MODELO']),
    control: pre2024ToText(row['CONTROL']),
    tipo_quadro: pre2024ToText(row['TIPO DE \nQUADRO']),
    esq_esf: pre2024ToText(row['ESQ\n ESF']),
    situacao: pre2024ToText(row['SITUAÇÃO']),
    transportadora: pre2024ToText(row['TRANSPORTADORA']),
    nfe: pre2024ToText(row['NFe']),
    numero_ordem_coleta: pre2024ToText(row['Nº \nORDEM\nDE\nCOLETA']),
    mes_faturamento: pre2024ToText(row['MES DE \nFATURAMENTO']),
    forma_pgto: pre2024ToText(row['FORMA PGTO']),
    data_entrega: pre2024ToDate(row['DATA DE\nENTREGA']),
    cond_pagto: pre2024ToText(row['COND PAGTO']),
    data_pagto: pre2024ToDate(row['DATA_PAGTO']),
    valor: pre2024ToNumber(row['VALOR']),
    uf: pre2024ToText(row['UF']),
    representante: pre2024ToText(row['REP']),
    observacoes: pre2024ToText(row['OBS GERAIS']),
    os: pre2024ToText(row['OS']),
    formula_regexextract: pre2024ToText(row['FORMULA REGEXEXTRACT']),
    formula_switch: pre2024ToText(row['FORMULA SWITCH']),
    ft_ou_fh: pre2024ToText(row['FT OU FH']),
    data_entrega_dashboard: pre2024ToDate(row['DATA DE ENTREGA DASHBOARD']),
    data_entrada_pedido_alt: pre2024ToDate(row['DATA DE ENTRADA DO PEDIDO'])
  };
}

function mapPre2024Rows(rawRows) {
  resetDateFailureLog();
  return rawRows
    .map(mapPre2024Row)
    .filter((row) => row && row.pedido);
}

module.exports = {
  PRE2024_COLUMNS,
  pre2024ToDate,
  pre2024ToNumber,
  pre2024ToText,
  mapPre2024Row,
  mapPre2024Rows,
};
