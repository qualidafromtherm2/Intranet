/**
 * Google Apps Script — registrar OPs na aba "PRODUÇÃO 2 - F/ ESCOPO"
 *
 * Planilha: 1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M
 *
 * Como publicar:
 * 1. Abra a planilha → Extensões → Apps Script
 * 2. Cole este arquivo (Code.gs)
 * 3. Implantar → Nova implantação → Aplicativo da Web
 *    - Executar como: Eu
 *    - Quem tem acesso: Qualquer pessoa
 * 4. Copie a URL e configure GOOGLE_SHEETS_OP_WEBHOOK_URL no Render/PM2
 */

var SPREADSHEET_ID = '1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M';
var ABA_ESCOPO = 'PRODUÇÃO 2 - F/ ESCOPO';

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    if (body.acao !== 'registrar_ops_producao_escopo') {
      return jsonOut({ ok: false, error: 'acao_invalida' });
    }

    var linhas = Array.isArray(body.linhas) ? body.linhas : [];
    if (!linhas.length) {
      return jsonOut({ ok: false, error: 'nenhuma_linha' });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var abaNome = String(body.aba || ABA_ESCOPO);
    var sheet = ss.getSheetByName(abaNome);
    if (!sheet) {
      return jsonOut({ ok: false, error: 'aba_nao_encontrada', aba: abaNome });
    }

    var inseridas = registrarLinhasOpEscopo(sheet, linhas);
    return jsonOut({ ok: true, inseridas: inseridas });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function registrarLinhasOpEscopo(sheet, linhas) {
  var tz = 'America/Sao_Paulo';
  var hoje = new Date();
  var count = 0;

  for (var i = 0; i < linhas.length; i++) {
    var item = linhas[i] || {};
    var modelo = String(item.modelo || '').trim();
    var numeroOp = String(item.numero_op || '').trim();
    var etapa = Number(item.etapa);
    if (!modelo || !numeroOp) continue;

    var rowNum = proximaLinhaVaziaColunaF(sheet);
    var formulaPedido = String(item.formula_pedido || '').trim() || formulaPedidoPadrao(rowNum);

    // C = PREVISÃO DE INICIO
    sheet.getRange(rowNum, 3).setValue(hoje);
    sheet.getRange(rowNum, 3).setNumberFormat('dd/MM/yyyy');

    // D = PEDIDO (fórmula)
    sheet.getRange(rowNum, 4).setFormula(formulaPedido);

    // E = MODELO
    sheet.getRange(rowNum, 5).setValue(modelo);

    // F = ORDEM DE PRODUÇÃO
    sheet.getRange(rowNum, 6).setValue(numeroOp);

    // H = Nº DA ETAPA
    sheet.getRange(rowNum, 8).setValue(Number.isFinite(etapa) && etapa > 0 ? etapa : 5);

    count++;
  }

  return count;
}

function proximaLinhaVaziaColunaF(sheet) {
  var last = sheet.getLastRow();
  if (last < 1) return 1;

  var valores = sheet.getRange(1, 6, last, 6).getValues();
  var ultimaComDado = 0;
  for (var i = 0; i < valores.length; i++) {
    if (String(valores[i][0] || '').trim() !== '') {
      ultimaComDado = i + 1;
    }
  }
  return ultimaComDado + 1;
}

function formulaPedidoPadrao(rowNum) {
  var r = Number(rowNum);
  return '=SEERRO(PROCV(TO_TEXT(F' + r + ');PEDIDOS!C:I;7;0);SEERRO(PROCV(F' + r + '*1;PEDIDOS!C:I;7;0);SEERRO(PROCV("*"&F' + r + '&"*";PEDIDOS!C:I;7;0);"ESTOQUE")))';
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
