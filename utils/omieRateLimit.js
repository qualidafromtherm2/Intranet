'use strict';

/**
 * Rate limit global da API Omie.
 * Regra do projeto: no máximo 4 requisições por segundo (intervalo ≥ 250 ms).
 */

const OMIE_MAX_REQ_PER_SEC = 4;
const OMIE_MIN_INTERVAL_MS = Math.ceil(1000 / OMIE_MAX_REQ_PER_SEC); // 250

let _lastStartedAt = 0;
let _chain = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializa e espaça chamadas Omie no processo (todas as rotas/scripts que usarem).
 * Uso: `await omieThrottle()` imediatamente antes do `fetch`/`omieCall`.
 */
function omieThrottle() {
  const run = async () => {
    const now = Date.now();
    const wait = Math.max(0, _lastStartedAt + OMIE_MIN_INTERVAL_MS - now);
    if (wait > 0) await sleep(wait);
    _lastStartedAt = Date.now();
  };
  // Encadeia mesmo após erro anterior, para não “furar” o espaçamento
  _chain = _chain.then(run, run);
  return _chain;
}

module.exports = {
  OMIE_MAX_REQ_PER_SEC,
  OMIE_MIN_INTERVAL_MS,
  omieThrottle,
};
