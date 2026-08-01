function normalizarNumeroDecimal(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value).trim().replace(/\s+/g, '');
  if (!raw) return null;

  let normalizado = raw;
  const temVirgula = raw.includes(',');
  const temPonto = raw.includes('.');

  if (temVirgula && temPonto) {
    normalizado = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (temVirgula) {
    normalizado = raw.replace(',', '.');
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

module.exports = { normalizarNumeroDecimal };
