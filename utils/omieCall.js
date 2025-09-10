// utils/omieCall.js

async function omieCall(url, body) {
  const res = await safeFetch(url, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body)
  });

  const txt = await res.text();
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    // Resposta nem era JSON ⇒ lança imediatamente
    const err = new Error(txt);
    err.status = res.status;
    throw err;
  }

  /*  BG intermitente vem com status 500 + corpo:
      { error:{ faultstring:'SOAP-ERROR: Broken response…', … } }      */
  if (!res.ok) {
    let fault;
    if (json.error) {
      try {
        const inner = typeof json.error === 'string'
          ? JSON.parse(json.error)
          : json.error;
        fault = inner.faultstring;
      } catch {/* ignore */}
    }

    // Apenas avisa se for o BG genérico
    if ((fault || txt).includes('Broken response')) {
      console.warn('[Omie] BG intermitente – retorno vazio');
    }

    const err = new Error(fault || txt);
    err.status = res.status;
    throw err;
  }

  return json;
}

module.exports = omieCall;
