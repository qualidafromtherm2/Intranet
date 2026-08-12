/**
 * Google Apps Script — registrar OPs na aba "PRODUÇÃO 2 - F/ ESCOPO"
 *
 * Colunas gravadas:
 *   C = PREVISÃO DE INICIO (hoje)
 *   E = MODELO
 *   G = CONTROLADOR ← número da OP do sistema (NÃO vai em F / ORDEM DE PRODUÇÃO)
 *   H = Nº DA ETAPA (5)
 *
 * Coluna D (PEDIDO): fica em branco (fórmula TO_TEXT/VLOOKUP gerava #NAME?).
 * Coluna F (ORDEM DE PRODUÇÃO): fica em branco.
 *
 * IMPORTANTE — após alterar este arquivo, republicar o webhook:
 *   Apps Script → Implantar → Gerenciar implantações → EDITAR (lápis)
 *   → Nova versão → Implantar
 * Sem republicar, o Google continua com a versão antiga (OP na coluna F).
 */

var SPREADSHEET_ID = '1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M';
var ABA_ESCOPO = 'PRODUÇÃO 2 - F/ ESCOPO';
var SCRIPT_VERSION = '20260812a-buscar-ordem-f';

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }

    if (body.acao === 'buscar_ordem_producao_escopo') {
      var ssBusca = SpreadsheetApp.openById(SPREADSHEET_ID);
      var abaBusca = String(body.aba || ABA_ESCOPO);
      var sheetBusca = ssBusca.getSheetByName(abaBusca);
      if (!sheetBusca) {
        return jsonOut({ ok: false, error: 'aba_nao_encontrada', aba: abaBusca });
      }
      var numeros = Array.isArray(body.numeros_op) ? body.numeros_op : [];
      if (!numeros.length && body.numero_op) numeros = [body.numero_op];
      var itens = buscarOrdensPorControladores(sheetBusca, numeros);
      return jsonOut({
        ok: true,
        itens: itens,
        script_version: SCRIPT_VERSION,
      });
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
      script_version: SCRIPT_VERSION,
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

    var rowNum = proximaLinhaLivre(sheet);

    // C — previsão de início
    sheet.getRange(rowNum, 3).setValue(hoje);
    sheet.getRange(rowNum, 3).setNumberFormat('dd/MM/yyyy');

    // D — PEDIDO: deixar em branco (evita #NAME? de TO_TEXT / fórmula quebrada)
    sheet.getRange(rowNum, 4).clearContent();

    // E — modelo
    sheet.getRange(rowNum, 5).setValue(modelo);

    // F — ORDEM DE PRODUÇÃO: não preencher (número do sistema vai no CONTROLADOR)
    sheet.getRange(rowNum, 6).clearContent();

    // G — CONTROLADOR = número da OP gerada no intranet
    sheet.getRange(rowNum, 7).setValue(numeroOp);

    // H — etapa
    sheet.getRange(rowNum, 8).setValue(Number.isFinite(etapa) && etapa > 0 ? etapa : 5);

    SpreadsheetApp.flush();

    detalhes.push({
      numero_op: numeroOp,
      linha: rowNum,
      coluna_controlador: 'G',
      pedido: '',
      script_version: SCRIPT_VERSION,
    });
    count++;
  }

  return { inseridas: count, linhas: detalhes };
}

function normalizarOpBusca(valor) {
  var digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '') || '0';
}

function buscarOrdensPorControladores(sheet, numerosOp) {
  var last = sheet.getLastRow();
  if (last < 1) return [];

  var alvos = {};
  for (var n = 0; n < (numerosOp || []).length; n++) {
    var original = String(numerosOp[n] || '').trim();
    var key = normalizarOpBusca(original);
    if (key) alvos[key] = original;
  }
  var keys = Object.keys(alvos);
  if (!keys.length) return [];

  var valores = sheet.getRange(1, 6, last, 2).getValues();
  var achados = {};
  for (var i = valores.length - 1; i >= 0; i--) {
    var colF = String(valores[i][0] || '').trim();
    var colG = String(valores[i][1] || '').trim();
    var gKey = normalizarOpBusca(colG);
    if (!gKey || !colF || !alvos[gKey] || achados[gKey]) continue;
    achados[gKey] = {
      numero_op: alvos[gKey],
      ordem_producao: colF,
      linha: i + 1,
    };
  }
  return Object.keys(achados).map(function (k) { return achados[k]; });
}

/**
 * Próxima linha livre: considera usada se F (histórico) OU G (CONTROLADOR) tiver valor.
 */
function proximaLinhaLivre(sheet) {
  var last = sheet.getLastRow();
  if (last < 1) return 1;

  // Colunas F e G (índices 6 e 7)
  var valores = sheet.getRange(1, 6, last, 7).getValues();
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

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Teste manual no editor Apps Script */
function testarInsercaoControlador() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(ABA_ESCOPO);
  var resultado = registrarLinhasOpEscopo(sheet, [{
    modelo: 'MODELO-TESTE-SGF',
    numero_op: 'TESTE-' + Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyyMMddHHmmss'),
    etapa: 5,
  }]);
  Logger.log(JSON.stringify(resultado));
}
