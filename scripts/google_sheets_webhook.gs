/**
 * Webhook para atualizar a aba KANBAN no Google Sheets.
 *
 * Como usar:
 * 1) Abra a planilha e entre em Extensões > Apps Script.
 * 2) Cole este conteúdo.
 * 3) Troque o valor de PLANILHA_ID pelo ID da sua planilha.
 * 4) Faça deploy como Aplicativo da Web (acesso: qualquer pessoa com o link).
 * 5) Configure a URL gerada na variável GOOGLE_SHEETS_WEBHOOK_URL do backend.
 */
const PLANILHA_ID = '1xJT96JbXxqb2SPdCwsNAI55E8EGuEofDOiXbn5iFCDE';
const NOME_ABA = 'KANBAN';

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const linhas = Array.isArray(payload.linhas) ? payload.linhas : [];

    if (!linhas.length) {
      return jsonResponse({ ok: false, error: 'Sem linhas para atualizar' });
    }

    const ss = SpreadsheetApp.openById(PLANILHA_ID);
    const aba = ss.getSheetByName(NOME_ABA) || ss.insertSheet(NOME_ABA);

    const headers = Object.keys(linhas[0]);
    const valores = linhas.map((obj) => headers.map((header) => obj[header] ?? ''));

    aba.clearContents();
    aba.getRange(1, 1, 1, headers.length).setValues([headers]);
    aba.getRange(2, 1, valores.length, headers.length).setValues(valores);

    return jsonResponse({ ok: true, linhasAtualizadas: valores.length });
  } catch (erro) {
    return jsonResponse({ ok: false, error: String(erro && erro.message ? erro.message : erro) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
