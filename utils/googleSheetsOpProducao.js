/**
 * Registra OPs geradas na planilha Google Sheets (aba PRODUÇÃO 2 - F/ ESCOPO)
 * via webhook do Google Apps Script.
 *
 * Env: GOOGLE_SHEETS_OP_WEBHOOK_URL
 */

const ACAO = 'registrar_ops_producao_escopo';

function montarFormulaPedido(rowNum) {
  const r = Number(rowNum);
  if (!Number.isFinite(r) || r < 1) {
    throw new Error('Número de linha inválido para fórmula PEDIDO');
  }
  return `=SEERRO(PROCV(TO_TEXT(F${r});PEDIDOS!C:I;7;0);SEERRO(PROCV(F${r}*1;PEDIDOS!C:I;7;0);SEERRO(PROCV("*"&F${r}&"*";PEDIDOS!C:I;7;0);"ESTOQUE")))`;
}

/**
 * @param {{ modelo: string, numeroOp: string|number, rowNum?: number }} params
 */
function montarLinhaPlanilhaOp({ modelo, numeroOp, rowNum }) {
  const modeloTxt = String(modelo || '').trim();
  const numeroOpTxt = String(numeroOp || '').trim();
  if (!modeloTxt || !numeroOpTxt) {
    throw new Error('modelo e numeroOp são obrigatórios para a planilha');
  }
  const linha = {
    modelo: modeloTxt,
    numero_op: numeroOpTxt,
    etapa: 5,
  };
  if (rowNum != null) {
    linha.formula_pedido = montarFormulaPedido(rowNum);
  }
  return linha;
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
  montarFormulaPedido,
  montarLinhaPlanilhaOp,
  registrarOpsGeradasNaPlanilha,
};
