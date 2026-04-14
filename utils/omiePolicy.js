const MAX_OMIE_PAGE_SIZE = 100;

const PAGE_SIZE_KEYS = new Set([
  'registros_por_pagina',
  'nRegistrosPorPagina',
  'nRegPorPagina',
]);

function clampOmiePageSize(value, fallback = MAX_OMIE_PAGE_SIZE) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.min(Math.max(1, Number(fallback) || MAX_OMIE_PAGE_SIZE), MAX_OMIE_PAGE_SIZE);
  }
  return Math.min(Math.max(1, Math.floor(parsed)), MAX_OMIE_PAGE_SIZE);
}

function clampOmiePaginationValue(value) {
  if (Array.isArray(value)) {
    return value.map(clampOmiePaginationValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const clone = {};
  for (const [key, currentValue] of Object.entries(value)) {
    if (PAGE_SIZE_KEYS.has(key)) {
      clone[key] = clampOmiePageSize(currentValue);
      continue;
    }

    clone[key] = clampOmiePaginationValue(currentValue);
  }

  return clone;
}

function clampOmiePayloadPagination(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  return clampOmiePaginationValue(payload);
}

module.exports = {
  MAX_OMIE_PAGE_SIZE,
  clampOmiePageSize,
  clampOmiePayloadPagination,
};
