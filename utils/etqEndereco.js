/**
 * Endereço de porta-pallet / ETQ_rec_impresso.
 * Formato obrigatório: 01-02-19-002  →  XX-XX-XX-XXX (só dígitos)
 */

const ETQ_ENDERECO_RE = /^(\d{2})-(\d{2})-(\d{2})-(\d{3})$/;
const MSG_FORMATO = 'Inserir no formato correto.';

function normalizarEnderecoEtqRaw(valor) {
  return String(valor || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
}

function isEnderecoEtqValido(valor) {
  return ETQ_ENDERECO_RE.test(normalizarEnderecoEtqRaw(valor));
}

/** Valida e devolve endereço normalizado. Lança Error com MSG_FORMATO se inválido. */
function assertEnderecoEtq(valor) {
  const end = normalizarEnderecoEtqRaw(valor);
  if (!ETQ_ENDERECO_RE.test(end)) {
    const err = new Error(MSG_FORMATO);
    err.code = 'ETQ_ENDERECO_INVALIDO';
    throw err;
  }
  return end;
}

/**
 * Converte endereço inválido do tipo 01-02-19-B5 →
 * { endereco: '01-02-19-001', complementoExtra: 'B5' }
 * Retorna null se não for possível migrar (formato totalmente diferente).
 */
function decomporEnderecoInvalido(valor) {
  const raw = String(valor || '').trim();
  if (!raw) return null;
  if (isEnderecoEtqValido(raw)) {
    return { endereco: normalizarEnderecoEtqRaw(raw), complementoExtra: null };
  }
  const partes = raw.split('-').map((p) => p.trim()).filter(Boolean);
  if (partes.length < 4) return null;
  const [rua, nivel, edificio, ...resto] = partes;
  if (!/^\d{2}$/.test(rua) || !/^\d{2}$/.test(nivel) || !/^\d{2}$/.test(edificio)) return null;
  const restoTxt = resto.join('-');
  if (!restoTxt || /^\d{3}$/.test(restoTxt)) return null;
  return {
    endereco: `${rua}-${nivel}-${edificio}-001`,
    complementoExtra: restoTxt,
  };
}

function mesclarComplemento(atual, extra) {
  const a = String(atual || '').trim();
  const e = String(extra || '').trim();
  if (!e) return a || null;
  if (!a) return e;
  if (a.includes(e)) return a;
  return `${a} | ${e}`;
}

/** Parse data_emissao DD/MM/YYYY → timestamp (ms) ou null. */
function parseDataEmissaoEtq(valor) {
  const m = String(valor || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (!d || !mo || !y) return null;
  const t = new Date(y, mo - 1, d).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Atribui fifo: 'verde' (mais antigo), 'amarelo' (meio), 'vermelho' (mais novo).
 * Se só 1 item → null. Se 2 → verde + vermelho.
 */
function atribuirFifoCores(itens, getData = (i) => i.data_emissao) {
  const lista = Array.isArray(itens) ? [...itens] : [];
  if (lista.length <= 1) {
    return lista.map((i) => ({ ...i, fifo: null }));
  }
  const ranked = lista
    .map((i, idx) => ({
      i,
      idx,
      ts: parseDataEmissaoEtq(getData(i)) ?? Number.POSITIVE_INFINITY,
      id: Number(i.id) || 0,
    }))
    .sort((a, b) => a.ts - b.ts || a.id - b.id || a.idx - b.idx);

  const n = ranked.length;
  const fifoByIdx = new Map();
  ranked.forEach((row, pos) => {
    let fifo = 'amarelo';
    if (pos === 0) fifo = 'verde';
    else if (pos === n - 1) fifo = 'vermelho';
    fifoByIdx.set(row.idx, fifo);
  });
  return lista.map((i, idx) => ({ ...i, fifo: fifoByIdx.get(idx) || null }));
}

module.exports = {
  ETQ_ENDERECO_RE,
  MSG_FORMATO,
  normalizarEnderecoEtqRaw,
  isEnderecoEtqValido,
  assertEnderecoEtq,
  decomporEnderecoInvalido,
  mesclarComplemento,
  parseDataEmissaoEtq,
  atribuirFifoCores,
};
