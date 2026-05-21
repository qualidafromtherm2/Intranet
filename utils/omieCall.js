// utils/omieCall.js

// utils/omieCall.js
// Chama endpoints JSON da OMIE e SEMPRE preserva faultstring/faultcode no erro.

async function omieCall(url, body, options = {}) {
  const bodyMasked = (() => {
    const p = JSON.parse(JSON.stringify(body || {}));
    if (p?.app_key) p.app_key = String(p.app_key).slice(0,2) + '***' + String(p.app_key).slice(-2);
    if (p?.app_secret) p.app_secret = String(p.app_secret).slice(0,2) + '***' + String(p.app_secret).slice(-2);
    return p;
  })();

  const sep = '─'.repeat(60);
  console.log(`\n┌${sep}`);
  console.log(`│ [omieCall] REQUEST  →  ${url}`);
  console.log(`│ call: ${body?.call || '(sem call)'}`);
  console.log(`│ payload:\n${JSON.stringify(bodyMasked, null, 2).split('\n').map(l => '│   ' + l).join('\n')}`);
  console.log(`└${sep}`);

  const aguardar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const retryRedundant = options?.retryRedundant !== false;
  const maxTentativas = retryRedundant ? 2 : 1;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    const t0 = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    const ms = Date.now() - t0;

    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}

    if (!res.ok) {
      const faultString = String(json?.faultstring || '');
      const isRedundant = /REDUNDANT|consumo redundante/i.test(faultString || text || '');

      if (isRedundant && tentativa < maxTentativas) {
        const match = String(faultString || text || '').match(/Aguarde\s+(\d+)\s+segundos?/i);
        const segundos = match ? Number(match[1]) : 5;
        const esperaMs = Math.max(1000, Math.min((Number.isFinite(segundos) ? segundos : 5) * 1000, 60000));
        console.warn(`\n┌${sep}\n│ [omieCall] ⚠ REDUNDANT — retry em ${esperaMs}ms  (tentativa ${tentativa})\n│ url: ${url}\n└${sep}`);
        await aguardar(esperaMs);
        continue;
      }

      console.error(`\n┌${sep}\n│ [omieCall] ERRO ✗  ${url}  status=${res.status}  ${ms}ms\n│ resposta:\n${JSON.stringify(json || text, null, 2).split('\n').map(l => '│   ' + l).join('\n')}\n└${sep}`);
      const err = new Error(json ? JSON.stringify(json) : text);
      err.status = res.status;
      throw err;
    }

    console.log(`\n┌${sep}`);
    console.log(`│ [omieCall] RESPOSTA ✓  ${url}  status=${res.status}  ${ms}ms`);
    console.log(`│ body:\n${JSON.stringify(json, null, 2).split('\n').map(l => '│   ' + l).join('\n')}`);
    console.log(`└${sep}`);
    return json || {};
  }

  throw new Error('Falha inesperada ao chamar API da Omie');
}
module.exports = omieCall;

