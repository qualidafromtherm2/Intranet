/**
 * Registra OPs geradas na planilha Google Sheets (aba PRODUÇÃO 2 - F/ ESCOPO)
 * via webhook do Google Apps Script.
 *
 * Mapeamento na planilha:
 *   E = MODELO
 *   G = CONTROLADOR ← numero_op do sistema
 *   F = ORDEM DE PRODUÇÃO (não preencher)
 *   D = PEDIDO (deixar em branco — fórmula antiga gerava #NAME?)
 *
 * Env: GOOGLE_SHEETS_OP_WEBHOOK_URL
 *
 * Após alterar scripts/google_apps_script/registrar_op_producao_escopo.gs,
 * é obrigatório republicar a implantação do Apps Script (nova versão).
 */

const ACAO = 'registrar_ops_producao_escopo';

/**
 * @param {{ modelo: string, numeroOp: string|number }} params
 */
function montarLinhaPlanilhaOp({ modelo, numeroOp }) {
  const modeloTxt = String(modelo || '').trim();
  const numeroOpTxt = String(numeroOp || '').trim();
  if (!modeloTxt || !numeroOpTxt) {
    throw new Error('modelo e numeroOp são obrigatórios para a planilha');
  }
  return {
    modelo: modeloTxt,
    numero_op: numeroOpTxt,
    etapa: 5,
    // PEDIDO fica em branco no Apps Script (sem formula_pedido)
  };
}

async function postWebhookOpProducao(payload) {
  const webhookUrl = process.env.GOOGLE_SHEETS_OP_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('GOOGLE_SHEETS_OP_WEBHOOK_URL não configurada');
  }

  const fetchFn = global.safeFetch || globalThis.fetch;
  if (!fetchFn) {
    throw new Error('Fetch indisponível no servidor');
  }

  const body = JSON.stringify(payload);
  const resposta = await fetchFn(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    redirect: 'manual',
  });

  if ([301, 302, 303, 307, 308].includes(Number(resposta.status || 0))) {
    return { ok: true, redirect: true };
  }

  const contentType = String(resposta.headers.get('content-type') || '').toLowerCase();
  const texto = await resposta.text();

  if (!resposta.ok) {
    throw new Error(`Webhook OP planilha HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  if (contentType.includes('text/html')) {
    throw new Error(`Webhook OP planilha retornou HTML: ${texto.slice(0, 300)}`);
  }

  if (!texto) return { ok: true };

  let json = null;
  try {
    json = JSON.parse(texto);
  } catch (_) {
    return { ok: true, raw: texto };
  }

  if (json && json.ok === false) {
    throw new Error(json.error || JSON.stringify(json));
  }

  return json || { ok: true };
}

/**
 * Envia as OPs recém-geradas para a planilha (uma linha por OP).
 * Falha na planilha não deve impedir a criação das OPs no sistema.
 *
 * @param {{ modelo: string, ops: Array<{ n_op: string|number }> }} params
 */
async function registrarOpsGeradasNaPlanilha({ modelo, ops }) {
  const lista = Array.isArray(ops) ? ops : [];
  if (!lista.length) return { ok: true, skipped: true, reason: 'sem_ops' };

  const modeloTxt = String(modelo || '').trim();
  if (!modeloTxt) {
    throw new Error('modelo do produto é obrigatório para registrar na planilha');
  }

  const linhas = lista.map((op) => montarLinhaPlanilhaOp({
    modelo: modeloTxt,
    numeroOp: op?.n_op ?? op?.numero_op ?? op,
  }));

  const retorno = await postWebhookOpProducao({
    acao: ACAO,
    aba: 'PRODUÇÃO 2 - F/ ESCOPO',
    linhas,
  });

  return {
    ok: true,
    linhas: linhas.length,
    retorno,
  };
}

module.exports = {
  ACAO,
  montarLinhaPlanilhaOp,
  registrarOpsGeradasNaPlanilha,
};
