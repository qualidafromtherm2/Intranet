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
const NOME_ABA_HISTORICO = 'historico';

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const abasPayload = payload && typeof payload.abas === 'object' && payload.abas ? payload.abas : null;
    const linhas = Array.isArray(payload.linhas) ? payload.linhas : [];
    const historicoLinhas = Array.isArray(payload.historicoLinhas) ? payload.historicoLinhas : [];

    const ss = SpreadsheetApp.openById(PLANILHA_ID);

    const abas = abasPayload || {
      [NOME_ABA]: linhas,
      [NOME_ABA_HISTORICO]: historicoLinhas
    };

    const nomesAbas = Object.keys(abas).filter((nome) => Array.isArray(abas[nome]));
    if (!nomesAbas.length) {
      return jsonResponse({ ok: false, error: 'Sem linhas para atualizar' });
    }

    const resumo = {};
    nomesAbas.forEach((nomeAba) => {
      const linhasAba = Array.isArray(abas[nomeAba]) ? abas[nomeAba] : [];
      const aba = ss.getSheetByName(nomeAba) || ss.insertSheet(nomeAba);
      aba.clearContents();

      if (!linhasAba.length) {
        resumo[nomeAba] = 0;
        return;
      }

      const headers = Object.keys(linhasAba[0]);
      const valores = linhasAba.map((obj) => headers.map((header) => obj[header] ?? ''));
      aba.getRange(1, 1, 1, headers.length).setValues([headers]);
      aba.getRange(2, 1, valores.length, headers.length).setValues(valores);
      resumo[nomeAba] = valores.length;
    });

    return jsonResponse({ ok: true, abasAtualizadas: resumo });
  } catch (erro) {
    return jsonResponse({ ok: false, error: String(erro && erro.message ? erro.message : erro) });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
