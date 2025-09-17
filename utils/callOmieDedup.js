// utils/callOmieDedup.js
const omieCall = require('./omieCall');

// janela de dedupe (ms)
const WINDOW_MS = 30_000;

// cache em memória por chave
const pending = new Map(); // key -> Promise
const lastOk  = new Map(); // key -> { at, data }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function makeKey(url, body) {
  // chave = url + call + JSON(param)
  const call  = body?.call || '';
  const param = JSON.stringify(body?.param ?? []);
  return `${url}::${call}::${param}`;
}

/**
 * Chama omieCall com dedupe em 30s.
 * Se OMIE devolver fault SOAP-ENV:Client-6 (consumo redundante),
 * aguarda um pouco e re-tenta (1x).
 */
async function callOmieDedup(url, body, opts = {}) {
  const key = makeKey(url, body);
  const now = Date.now();

  // se temos resposta OK recente, retorna logo
  const mem = lastOk.get(key);
  if (mem && (now - mem.at) < WINDOW_MS) {
    return mem.data;
  }

  // se já tem uma chamada em andamento pra mesma chave, reusa
  if (pending.has(key)) {
    return pending.get(key);
  }

  // dispara a chamada real
  const p = (async () => {
    try {
      const data = await omieCall(url, body);
      lastOk.set(key, { at: Date.now(), data });
      return data;
    } catch (err) {
      const msg = String(err?.faultstring || err?.message || '');
      // Se for o erro de “Consumo redundante…”, espera e tenta 1x novamente
      if (/Consumo redundante detectado/i.test(msg)) {
        const wait = Math.min(opts.waitMs || 3_500, WINDOW_MS);
        await sleep(wait);
        const retry = await omieCall(url, body);
        lastOk.set(key, { at: Date.now(), data: retry });
        return retry;
      }
      throw err;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, p);
  return p;
}

module.exports = callOmieDedup;
