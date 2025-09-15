// utils/omieCall.js

// utils/omieCall.js
// Chama endpoints JSON da OMIE e SEMPRE preserva faultstring/faultcode no erro.

async function omieCall(url, body) {
  const bodyMasked = (() => {
    const p = JSON.parse(JSON.stringify(body || {}));
    if (p?.app_secret) p.app_secret = String(p.app_secret).slice(0,2) + '***' + String(p.app_secret).slice(-2);
    return p;
  })();

  console.groupCollapsed('[omieCall] →', url);
  console.log('headers:', { 'Content-Type': 'application/json' });
  console.log('body (mask):', bodyMasked);
  console.groupEnd();

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
    console.error('[omieCall] ←', url, { status: res.status, ms, body: json || text });
    const err = new Error(json ? JSON.stringify(json) : text);
    err.status = res.status;
    throw err;
  }

  console.log('[omieCall] ←', url, { status: res.status, ms, body: json });
  return json || {};
}
module.exports = omieCall;

