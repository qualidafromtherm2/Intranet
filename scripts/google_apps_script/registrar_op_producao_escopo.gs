/**
 * Google Apps Script — registrar OPs na aba "PRODUÇÃO 2 - F/ ESCOPO"
 *
 * Grava C, E, G, H. A coluna D (PEDIDO) NÃO é montada como texto.
 * O número da OP vai na coluna G (CONTROLADOR).
 * Em seguida faz autoFill da fórmula da linha de cima (igual arrastar no Sheets).
 *
 * Implantar: Gerenciar implantações → EDITAR (lápis) → Nova versão → Implantar
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

    var resultado = registrarLinhasOpEscopo(sheet, linhas);
    return jsonOut({
      ok: true,
      inseridas: resultado.inseridas,
      linhas: resultado.linhas,
      script_version: '20260703i-autofill',
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function registrarLinhasOpEscopo(sheet, linhas) {
  var hoje = new Date();
  var count = 0;
  var detalhes = [];

  for (var i = 0; i < linhas.length; i++) {
    var item = linhas[i] || {};
    var modelo = String(item.modelo || '').trim();
    var numeroOp = String(item.numero_op || '').trim();
    var etapa = Number(item.etapa);
    if (!modelo || !numeroOp) continue;

    var rowNum = proximaLinhaVaziaColunaF(sheet);

    // Só as colunas de dados — NÃO grava fórmula em D como texto
    sheet.getRange(rowNum, 3).setValue(hoje);
    sheet.getRange(rowNum, 3).setNumberFormat('dd/MM/yyyy');
    sheet.getRange(rowNum, 5).setValue(modelo);
    // G (coluna 7) = CONTROLADOR — número da OP (antes ia na F / ORDEM DE PRODUÇÃO)
    sheet.getRange(rowNum, 7).setValue(numeroOp);
    sheet.getRange(rowNum, 8).setValue(Number.isFinite(etapa) && etapa > 0 ? etapa : 5);

    // D = arrasta fórmula da linha modelo (igual você faz na tela)
    var templateRow = buscarLinhaModeloFormula(sheet, rowNum);
    sheet.getRange(templateRow, 4).autoFill(
      sheet.getRange(templateRow, 4, rowNum, 4),
      SpreadsheetApp.AutoFillSeries.DEFAULT_SERIES
    );

    SpreadsheetApp.flush();
    var formulaGravada = sheet.getRange(rowNum, 4).getFormula();
    var displayPedido = sheet.getRange(rowNum, 4).getDisplayValue();

    detalhes.push({
      numero_op: numeroOp,
      linha: rowNum,
      pedido: displayPedido,
      template_row: templateRow,
      formula: formulaGravada,
      formula_ok: displayPedido !== '#NAME?',
    });
    count++;
  }

  return { inseridas: count, linhas: detalhes };
}

function proximaLinhaVaziaColunaF(sheet) {
  var last = sheet.getLastRow();
  if (last < 1) return 1;

  // Considera a linha "usada" se F (histórico) OU G (novo — CONTROLADOR) tiver dado.
  var valores = sheet.getRange(1, 6, last, 6).getValues();
  var ultimaComDado = 0;
  for (var i = 0; i < valores.length; i++) {
    var colF = String(valores[i][0] || '').trim();
    var colG = String(valores[i][1] || '').trim();
    if (colF !== '' || colG !== '') {
      ultimaComDado = i + 1;
    }
  }
  return ultimaComDado + 1;
}

/**
 * Linha com fórmula PEDIDO que mostra valor válido (não #NAME?).
 * Preferimos linhas que já estão "ok" na tela — autoFill replica o arrastar.
 */
function buscarLinhaModeloFormula(sheet, antesDeRow) {
  var limite = Math.max(2, antesDeRow - 300);

  for (var r = antesDeRow - 1; r >= limite; r--) {
    var formula = sheet.getRange(r, 4).getFormula();
    if (!formula) continue;

    var fUp = String(formula).toUpperCase();
    if (fUp.indexOf('PROCV') < 0 && fUp.indexOf('VLOOKUP') < 0) continue;

    var display = String(sheet.getRange(r, 4).getDisplayValue() || '').trim();
    if (!display || display === '#NAME?' || display === '#N/A') continue;

    return r;
  }

  throw new Error('Nenhuma linha modelo de PEDIDO encontrada para autoFill');
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Teste manual no editor Apps Script */
function testarFormulaPedido() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(ABA_ESCOPO);
  var rowNum = proximaLinhaVaziaColunaF(sheet);

  sheet.getRange(rowNum, 3).setValue(new Date());
  sheet.getRange(rowNum, 5).setValue('MODELO-TESTE-SGF');
  sheet.getRange(rowNum, 7).setValue('TESTE-AUTOFILL');
  sheet.getRange(rowNum, 8).setValue(5);

  var tpl = buscarLinhaModeloFormula(sheet, rowNum);
  sheet.getRange(tpl, 4).autoFill(
    sheet.getRange(tpl, 4, rowNum, 4),
    SpreadsheetApp.AutoFillSeries.DEFAULT_SERIES
  );
  SpreadsheetApp.flush();

  Logger.log('Template: ' + tpl);
  Logger.log('Formula: ' + sheet.getRange(rowNum, 4).getFormula());
  Logger.log('Display: ' + sheet.getRange(rowNum, 4).getDisplayValue());
}
