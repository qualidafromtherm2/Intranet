const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { axiosPostWithRetry, delay } = require('../utils/axiosRetry');
const { flattenObject, convertToCSV } = require('../utils/csvUtils');
const Papa = require('papaparse');  // <-- Adicione esta linha
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config');


exports.generateCsv = async (req, res) => {
  try {
    const createPayload = (page) => ({
      call: "ListarProdutos",
      param: [
        {
          pagina: page,
          registros_por_pagina: 50,
          apenas_importado_api: "N",
          filtrar_apenas_omiepdv: "N",
          exibir_obs: "S", // Pode incluir descr_detalhada
          inativo: "N"
        }
      ],
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    });


    // Primeira página
    const response1 = await axiosPostWithRetry(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      createPayload(1),
      { headers: { 'Content-type': 'application/json' } }
    );

    const dados1 = response1.data;
    let totalPages = dados1.total_de_paginas;
    let produtosAll = dados1.produto_servico_cadastro || [];

    console.log(`Total de páginas: ${totalPages}`);
    console.log(`Produtos na 1ª página: ${produtosAll.length}`);

    // Cria uma lista com as páginas restantes
    const pages = [];
    for (let page = 2; page <= totalPages; page++) {
      pages.push(page);
    }

    // Processa requisições em lotes para respeitar o rate limit
    const processPagesInChunks = async (pages, chunkSize = 3) => {
      for (let i = 0; i < pages.length; i += chunkSize) {
        const chunk = pages.slice(i, i + chunkSize);
        const requests = chunk.map(page =>
          axiosPostWithRetry(
            'https://app.omie.com.br/api/v1/geral/produtos/',
            createPayload(page),
            { headers: { 'Content-type': 'application/json' } },
            3,
            1500
          )
        );
        const results = await Promise.allSettled(requests);
        results.forEach(result => {
          if (result.status === 'fulfilled') {
            const dados = result.value.data;
            if (dados.produto_servico_cadastro) {
              produtosAll = produtosAll.concat(dados.produto_servico_cadastro);
            }
          } else {
            console.error('Erro em uma requisição:', result.reason);
          }
        });
        console.log(`Lote de páginas ${chunk[0]} a ${chunk[chunk.length - 1]} processado.`);
        await delay(1000);
      }
    };

    await processPagesInChunks(pages);

    console.log('Total de produtos carregados:', produtosAll.length);

    // Converte para CSV usando cabeçalhos fixos
    const csvData = convertToCSV(produtosAll);
    const csvFilePath = path.join(__dirname, '..', 'produtos.csv');
    fs.writeFileSync(csvFilePath, csvData, 'utf8');

    console.log('CSV salvo em:', csvFilePath);
    res.json({ success: true, message: 'CSV gerado com sucesso!' });
  } catch (error) {
    console.error("Erro ao gerar CSV:", error.message);
    res.status(500).json({ success: false, error: 'Erro ao gerar CSV' });
  }
};

exports.detalhes = async (req, res) => {
  try {
    const { codigo } = req.params;
    const payload = {
      call: "ConsultarProduto",
      param: [{ codigo }],
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const omieResponse = await axios.post(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    res.json(omieResponse.data);
  } catch (error) {
    console.error("Erro ao consultar produto:", error?.message || error);
    res.status(500).json({ error: 'Falha ao consultar produto na Omie' });
  }
};

exports.alterar = async (req, res) => {
  console.log("Recebido request para alterar produto:", req.body);
  try {
    const camposEdicao = req.body;
    await salvarAlteracoesOmie(camposEdicao);
    res.json({ success: true, message: 'Produto atualizado com sucesso!' });
  } catch (error) {
    console.error("Erro ao alterar produto:", error?.message || error);
    res.status(500).json({ success: false, error: 'Erro ao alterar produto na Omie' });
  }
};



async function salvarAlteracoesOmie(camposEdicao) {
  try {
    const payload = {
      call: "AlterarProduto",
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [camposEdicao]
    };

    console.log("=== Enviando payload para Omie ===");
    console.log(JSON.stringify(payload, null, 2));

    const response = await axios.post(
      'https://app.omie.com.br/api/v1/geral/produtos/',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    console.log("=== Resposta da Omie ===");
    console.log(JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    console.error("=== Erro na chamada Omie ===");
    if (error.response && error.response.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}



exports.estoque = async (req, res) => {
  try {
    const { codigo, data } = req.body;
    const payload = {
      call: "PosicaoEstoque",
      param: [{ cod_int: codigo, data }],
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const omieResp = await axios.post(
      'https://app.omie.com.br/api/v1/estoque/consulta/',
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );
    res.json(omieResp.data);
  } catch (error) {
    console.error("Erro ao consultar PosicaoEstoque:", error.message);
    res.status(500).json({ error: 'Falha ao consultar PosicaoEstoque na Omie' });
  }
};

// NOVA FUNÇÃO: alterarNoCSV
exports.alterarNoCSV = (req, res) => {
    try {
      const { codigo, descr_detalhada, descricao } = req.body;
      // Usando process.cwd() para pegar a raiz do projeto
      const csvFilePath = path.join(process.cwd(), 'produtos.csv');
  
      // Lê o conteúdo do CSV
      const csvContent = fs.readFileSync(csvFilePath, 'utf8');
  
      // Faz o parse do CSV (com cabeçalho)
      const parsed = Papa.parse(csvContent, { header: true });
      let rows = parsed.data;
  
      // Procura a linha com o código informado e atualiza os campos
      let found = false;
      for (let row of rows) {
        if (row.codigo === codigo) {
          if (descr_detalhada !== undefined) row.descr_detalhada = descr_detalhada;
          if (descricao !== undefined) row.descricao = descricao;
          found = true;
          break;
        }
      }
  
      if (!found) {
        return res.status(400).json({ success: false, error: 'Código não encontrado no CSV.' });
      }
  
      // Converte de volta para CSV
      const newCsv = Papa.unparse(rows, { header: true });
  
      // Sobrescreve o arquivo CSV
      fs.writeFileSync(csvFilePath, newCsv, 'utf8');
  
      return res.json({ success: true });
    } catch (error) {
      console.error('Erro ao alterar CSV:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  };
  

  module.exports = {
    generateCsv: exports.generateCsv,
    detalhes: exports.detalhes,
    alterar: exports.alterar,
    estoque: exports.estoque,
    alterarNoCSV: exports.alterarNoCSV
  };
  
  
  async function enviarParaOmie(camposEdicao) {
    try {
      const payload = {
        call: "AlterarProduto",
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [camposEdicao]
      };
  
      console.log("=== Enviando payload para Omie ===");
      console.log(JSON.stringify(payload, null, 2));
  
      const response = await axios.post(
        'https://app.omie.com.br/api/v1/geral/produtos/',
        payload,
        { headers: { 'Content-Type': 'application/json' } }
      );
  
      console.log("=== Resposta da Omie ===");
      console.log(JSON.stringify(response.data, null, 2));
  
      return response.data;
    } catch (error) {
      console.error("=== Erro na chamada Omie ===");
      if (error.response && error.response.data) {
        console.error(JSON.stringify(error.response.data, null, 2));
      } else {
        console.error(error.message);
      }
      throw error;
    }
  }
  
  
  // Exporte a função ou a utilize na função 'alterar'
  exports.alterar = async (req, res) => {
    console.log("Recebido request para alterar produto (foto):", req.body);
    try {
      const camposEdicao = req.body;
      await enviarParaOmie(camposEdicao);
      res.json({ success: true, message: 'Produto atualizado com sucesso!' });
    } catch (error) {
      console.error("Erro ao alterar produto:", error?.message || error);
      res.status(500).json({ success: false, error: 'Erro ao alterar produto na Omie' });
    }
  };
  
  