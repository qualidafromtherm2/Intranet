function doGet() {
  return HtmlService.createHtmlOutputFromFile('frontend')
    .setTitle('Enviar PÇS');
}



function enviarDados(form) {
  var ss = SpreadsheetApp.openById('1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI');
  var sheet = ss.getSheetByName('ABERTURA/PEÇA');

  var row;

  if (form.numeroSerie) {
    // Verificar se o Número de Série já existe na planilha.
    row = getRowByNumeroSerie(sheet, form.numeroSerie);
  } else {
    // Se 'numeroSerie' não está preenchido, não podemos procurar por ele.
    row = null;
  }

  if (row) {
    // Recuperar a descrição existente.
    var descricaoExistente = sheet.getRange('R' + row).getValue() || "";

    // Adicionar a nova descrição com data/hora.
    var novaDescricao = adicionarDataHora(descricaoExistente, form.descricao);

    // Atualizar a célula com a descrição final.
    sheet.getRange('R' + row).setValue(novaDescricao);
  } else {
    // Criar uma nova entrada.
    row = getFirstEmptyRowInColumn(sheet, 'A');
    var ultimoNumero = sheet.getRange('A' + (row - 1)).getValue() || 0;
    var numeroSequencial = ultimoNumero + 1;

    sheet.getRange('A' + row).setValue(numeroSequencial);
    sheet.getRange('B' + row).setValue(new Date());

    // Preencher os demais dados
    preencherDados(sheet, row, form);

    // Adicionar a nova descrição com data/hora.
    var novaDescricao = adicionarDataHora("", form.descricao);
    sheet.getRange('R' + row).setValue(novaDescricao);
  }

  Logger.log('Dados enviados para a linha: ' + row);

  // Retorna o número sequencial atualizado
  var numeroSequencialAtualizado = sheet.getRange('A' + row).getValue();

  // Definir 'numeroOS' se estiver ausente
  form.numeroOS = form.numeroOS || numeroSequencialAtualizado;

  // Verificar se o usuário optou por gerar o PDF
  if (form.gerarPDF === true || form.gerarPDF === 'true') {
    // Gerar o PDF e atualizar a outra planilha
    atualizarOutraPlanilhaEGerarPDF(numeroSequencialAtualizado, form);
  }

  return 'Dados enviados com sucesso!';
}


/**
 * Função que adiciona uma nova entrada com data e hora, sem duplicar o conteúdo anterior.
 * @param {String} descricaoExistente - Descrição anterior armazenada.
 * @param {String} novaDescricao - Novo texto adicionado pelo usuário.
 * @returns {String} - Descrição atualizada com a nova entrada e data/hora.
 */
function adicionarDataHora(descricaoExistente, novaDescricao) {
  var dataHoraAtual = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  var novaEntrada = novaDescricao ? `${novaDescricao.trim()} ${dataHoraAtual} - ` : '';
  
  // Adiciona a nova entrada à descrição existente
  return descricaoExistente + novaEntrada;
}








function getRowByNumeroSerie(sheet, numeroSerie) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][12].toString().trim().toLowerCase() === numeroSerie.toLowerCase()) {
      return i + 1;
    }
  }
  return null;
}

function getDadosDaLinha(sheet, row) {
  var data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  return {
    numeroSequencial: data[0],
    tipoAtendimento: data[2],
    telefone: data[3],
    nomeCliente: data[4],
    cpfCnpj: data[5],
    cep: data[7],
    endereco: data[8],
    cidade: data[9],
    estado: data[10],
    agendarCom: data[11],
    numeroSerie: data[12],
    descricao: data[17]
  };
}

function getFirstEmptyRowInColumn(sheet, columnLetter) {
  var column = sheet.getRange(columnLetter + "1:" + columnLetter).getValues();
  for (var row = 0; row < column.length; row++) {
    if (!column[row][0]) {
      return row + 1;
    }
  }
  return column.length + 1;
}

function preencherDados(sheet, row, form) {
  sheet.getRange('C' + row).setValue(form.tipoAtendimento || '');
  sheet.getRange('D' + row).setValue(form.telefone || '');
  sheet.getRange('E' + row).setValue(form.nomeCliente || '');
  sheet.getRange('F' + row).setValue(form.cpfCnpj || '');
  sheet.getRange('H' + row).setValue(form.cep || '');
  sheet.getRange('I' + row).setValue(((form.rua || '') + ', ' + (form.bairro || '') + ', ' + (form.numeroCasa || '')).trim());
  sheet.getRange('J' + row).setValue(form.cidade || '');
  sheet.getRange('K' + row).setValue(form.estado || '');
  sheet.getRange('L' + row).setValue(form.agendarCom || '');
  sheet.getRange('M' + row).setValue(form.numeroSerie || '');
  sheet.getRange('N' + row).setValue(form.op || '');
  sheet.getRange('O' + row).setValue(form.modelo || '');
  sheet.getRange('P' + row).setValue(form.revenda || '');
  sheet.getRange('Q' + row).setValue(form.dataVenda || '');
  // Novos Campos Adicionados
  sheet.getRange('T' + row).setValue(form.problemaReal || '');
  sheet.getRange('U' + row).setValue(form.causaRaiz || '');
  sheet.getRange('V' + row).setValue(form.status || '');
  sheet.getRange('W' + row).setValue(form.acaocorretiva || '');
}

function atualizarOutraPlanilhaEGerarPDF(numeroSequencial, form) {
  try {
    // Abre a planilha do formulário
    var otherSS = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1u4dLA01u-Y7hp2F4yN0MyqkCGIpqdcxnk6M8UAnTQ7g/edit');
    var formularioSheet = otherSS.getSheetByName('FORMULÁRIO OS');

    // Data atual (dd/MM/yyyy)
    var DataAtual = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");

    // Helper para normalizar valores vindos do form
    function toCell(v) { return (v == null ? "" : String(v).trim()); }

    // 1) Limpa todos os campos que vêm do formulário (evita “valor antigo”)
    var camposForm = [
      'F9','F10','F11','F12',       // Nome, Revenda, Cidade/Estado, Endereço
      'AC14','AD10','AD11','AD12',  // CPF/CNPJ, Agendar com, Telefone, CEP
      'E16','K16','W16','AG16',     // Nº Série, OP, Modelo, Data Venda
      'AD3','B24'                   // Nº OS, Descrição+Data (ajustado após exclusão 21–25)
    ];
    formularioSheet.getRangeList(camposForm).clearContent();

    // 2) Escreve novos valores
    formularioSheet.getRange('F9').setValue(toCell(form.nomeCliente)); // Nome Cliente
    formularioSheet.getRange('F10').setValue(toCell(form.revenda));    // Revenda
    formularioSheet.getRange('F11').setValue(toCell((form.cidade||"") + " / " + (form.estado||""))); // Cidade/Estado
    formularioSheet.getRange('F12').setValue(toCell((form.rua||"") + " / " + (form.numeroCasa||"") + " / " + (form.bairro||""))); // Endereço

    // CPF/CNPJ como TEXTO e aceitando vazio
    var cpfCell = formularioSheet.getRange('AC14');
    cpfCell.setNumberFormat('@');                 // força formato texto (preserva zeros à esquerda)
    cpfCell.setValue(toCell(form.cpfCnpj));       // se vier vazio, fica vazio mesmo

    formularioSheet.getRange('AD10').setValue(toCell(form.agendarCom)); // Agendar Atendimento com
    formularioSheet.getRange('AD11').setValue(toCell(form.telefone));   // Telefone
    formularioSheet.getRange('AD12').setValue(toCell(form.cep));        // CEP

    formularioSheet.getRange('E16').setValue(toCell(form.numeroSerie)); // Número de Série
    formularioSheet.getRange('K16').setValue(toCell(form.op));          // OP
    formularioSheet.getRange('W16').setValue(toCell(form.modelo));      // Modelo
    formularioSheet.getRange('AG16').setValue(toCell(form.dataVenda));  // Data Venda

    formularioSheet.getRange('AD3').setValue(toCell(form.numeroOS));    // Nº OS

    // Descrição + Data (linha ajustada após excluir 21–25: B29 -> B24)
    var desc = toCell(form.descricao);
    formularioSheet.getRange('B24').setValue(desc ? (desc + " " + DataAtual) : "");

    // Campo de data do rodapé (ajustado: AE56 -> AE51)
    formularioSheet.getRange('AE51').setValue(DataAtual);

    SpreadsheetApp.flush();

    // 3) Gera o PDF na pasta destino (subpasta por OS)
    var nomeArquivoPDF = (toCell(form.numeroOS) || String(numeroSequencial)) + '.pdf';
    var pastaDestino = DriveApp.getFolderById('1d5Fuvie1bFR7IXsKpp0nIgjKLUb5SEux');

    // Nome da subpasta (usa numeroOS, senão o sequencial)
    var nomePasta = toCell(form.numeroOS) || String(numeroSequencial);
    var pastas = pastaDestino.getFoldersByName(nomePasta);
    var pastaSerie = pastas.hasNext() ? pastas.next() : pastaDestino.createFolder(nomePasta);

    // Remove PDF anterior (se existir)
    var arquivos = pastaSerie.getFilesByName(nomeArquivoPDF);
    while (arquivos.hasNext()) {
      arquivos.next().setTrashed(true);
    }

    // Exporta o PDF da aba atual
    var pdf = criarPDFDaAba(otherSS, formularioSheet.getSheetId(), nomeArquivoPDF);
    var arquivoPDF = pastaSerie.createFile(pdf);
    arquivoPDF.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // (Opcional) pode retornar a URL da pasta, se quiser usar em algum lugar:
    // return pastaSerie.getUrl();
  } catch (error) {
    Logger.log('Erro na função atualizarOutraPlanilhaEGerarPDF: ' + error.message);
    throw error;
  }
}

/**
 * Função para buscar a linha pelo número sequencial.
 * @param {Sheet} sheet - A planilha onde será feita a busca.
 * @param {Number} numeroSequencial - O número sequencial a ser encontrado.
 * @returns {Number|null} - Retorna o número da linha ou null se não encontrado.
 */
function getRowByNumeroSequencial(sheet, numeroSequencial) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { // Começar na linha 1 para pular o cabeçalho
    if (data[i][0] == numeroSequencial) { // Coluna A contém o número sequencial
      return i + 1; // Retornar a linha correta (índice +1)
    }
  }
  return null; // Não encontrado
}

function criarPDFDaAba(ss, sheetId, pdfName) {
  var url = ss.getUrl().replace(/edit$/, '');
  var exportUrl = url + 'export?exportFormat=pdf&format=pdf' +
    '&gid=' + sheetId + '&size=A4&portrait=true&fitw=true' +
    '&sheetnames=false&printtitle=false&pagenumbers=false' +
    '&gridlines=false&fzr=false';

  var response = UrlFetchApp.fetch(exportUrl, {
    headers: { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() }
  });

  return response.getBlob().setName(pdfName);
}

function buscarProdutos(termo) {
  try {
    Logger.log('Iniciando buscarProdutos');
    Logger.log('Termo de busca: ' + termo);

    var ss = SpreadsheetApp.openById('1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI');
    var sheet = ss.getSheetByName('IMPORTRANGE');

    if (!sheet) {
      throw new Error("A aba 'IMPORTRANGE' não foi encontrada na planilha.");
    }

    var data = sheet.getDataRange().getValues();
    Logger.log('Total de linhas na planilha: ' + data.length);

    var resultados = [];
    var termoBusca = termo.toString().toLowerCase();
    var maxResultados = 10;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];

      // Buscar na coluna A (índice 0)
      var valorBuscaA = row[0];
      if (valorBuscaA != null && valorBuscaA != undefined) {
        valorBuscaA = valorBuscaA.toString().toLowerCase();
        if (valorBuscaA.startsWith(termoBusca)) {
          // Adicionar aos resultados
          resultados.push(criarObjetoResultado(row, 0)); // Passar colunaCorrespondente=0
          if (resultados.length >= maxResultados) {
            break;
          }
          continue; // Pula para a próxima iteração para evitar duplicatas
        }
      }

      // Buscar na coluna I (índice 8)
      var valorBuscaI = row[8];
      if (valorBuscaI != null && valorBuscaI != undefined) {
        valorBuscaI = valorBuscaI.toString().toLowerCase();
        if (valorBuscaI.startsWith(termoBusca)) {
          // Adicionar aos resultados
          resultados.push(criarObjetoResultado(row, 8)); // Passar colunaCorrespondente=8
          if (resultados.length >= maxResultados) {
            break;
          }
        }
      }
    }

    Logger.log('Total de resultados encontrados: ' + resultados.length);
    return resultados;
  } catch (error) {
    Logger.log('Erro na função buscarProdutos: ' + error.message);
    throw error;
  }
}


// Função auxiliar para criar o objeto resultado
function criarObjetoResultado(row, colunaCorrespondente) {
  // Formatar a data de venda
  var dataVendaFormatada = '';
  if (row[22]) { // Coluna W (Índice 22) - DATA DE VENDA
    var dataVenda = row[22];
    if (dataVenda instanceof Date) {
      dataVendaFormatada = Utilities.formatDate(dataVenda, Session.getScriptTimeZone(), "dd/MM/yyyy");
    } else {
      var dataConvertida = new Date(dataVenda);
      if (!isNaN(dataConvertida)) {
        dataVendaFormatada = Utilities.formatDate(dataConvertida, Session.getScriptTimeZone(), "dd/MM/yyyy");
      } else {
        dataVendaFormatada = dataVenda.toString();
      }
    }
  }

  // Definir 'descricao' com base na coluna correspondente
  var descricao = row[colunaCorrespondente] ? row[colunaCorrespondente].toString().toUpperCase() : '';

  return {
    descricao: descricao,                             // Descrição do produto
    numeroSerie: row[0] ? row[0].toString().toUpperCase() : '', // Número de Série (Sempre Coluna A)
    op: row[8] ? row[8].toString() : '',             // Coluna I (Índice 8): O.P.
    modelo: row[12] ? row[12].toString() : '',       // Coluna M (Índice 12): MODELO
    revenda: row[2] ? row[2].toString() : '',        // Coluna C (Índice 2): REVENDA
    dataVenda: dataVendaFormatada                    // Coluna W: DATA DE VENDA formatada
  };
}







/**
 * Função para verificar se o Número de Série já existe na aba ABERTURA/PEÇA.
 * @param {String} numeroSerie - Número de Série da Máquina.
 * @returns {Object|null} dados - Dados existentes da OS ou null se não existir.
 */
function verificarNumeroSerie(numeroSerie) {
  var ss = SpreadsheetApp.openById('1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI');
  var sheet = ss.getSheetByName('ABERTURA/PEÇA');
  
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { // Pular cabeçalho
    if (data[i][12].toString().trim().toLowerCase() === numeroSerie.toString().trim().toLowerCase()) { // Coluna M (índice 12)
      return {
        numeroOS: data[i][0], // Este deve ser A, ou seja, a primeira coluna
        numeroSequencial: data[i][0], // Coluna A
        tipoAtendimento: data[i][2],  // Coluna C
        telefone: data[i][3],         // Coluna D
        nomeCliente: data[i][4],      // Coluna E
        cpfCnpj: data[i][5],          // Coluna F
        cep: data[i][7],              // Coluna H
        endereco: data[i][8],         // Coluna I
        cidade: data[i][9],           // Coluna J
        estado: data[i][10],          // Coluna K
        agendarCom: data[i][11],      // Coluna L
        numeroSerie: data[i][12],     // Coluna M
        descricao: data[i][17],       // Coluna R: Descreva a Reclamação
        problemaReal: data[i][19],     // Coluna T
        causaRaiz: data[i][20],        // Coluna U
        status: data[i][21],            // Coluna V
        acaocorretiva: data[i][22]            // Coluna X       
      };
    }
  }
  return null; // Não encontrado
}










function getPastaURL(numeroSerie) {
  try {
    var parentFolderId = '1d5Fuvie1bFR7IXsKpp0nIgjKLUb5SEux'; // ID da pasta pai
    var parentFolder = DriveApp.getFolderById(parentFolderId);
    var folders = parentFolder.getFoldersByName(numeroSerie);
    
    if (folders.hasNext()) {
      var folder = folders.next();
      return folder.getUrl();
    } else {
      return null;
    }
  } catch (error) {
    Logger.log('Erro ao obter URL da pasta: ' + error.message);
    return null;
  }
}

