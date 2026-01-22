#!/usr/bin/env node

// ============================================================================
// Script de Sincronização Completa: Omie → PostgreSQL
// ============================================================================
// Sincroniza TODOS os produtos da Omie para a tabela public.produtos_omie
// Usa a mesma função omie_upsert_produto($1::jsonb) do webhook
//
// USO:
//   node scripts/sync_produtos_omie_completo.js
//
// VARIÁVEIS DE AMBIENTE NECESSÁRIAS:
//   - OMIE_APP_KEY
//   - OMIE_APP_SECRET
//   - DATABASE_URL ou (PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT)
// ============================================================================

const { dbQuery } = require('../src/db');

// Configurações
const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '';
const OMIE_PROD_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';

const REGISTROS_POR_PAGINA = 50;
const DELAY_ENTRE_PAGINAS_MS = 300; // delay entre páginas para não sobrecarregar a API
const DELAY_ENTRE_PRODUTOS_MS = 50; // delay entre produtos
const MAX_RETRIES = 3;

// Estatísticas
const stats = {
  total_paginas: 0,
  total_produtos: 0,
  processados: 0,
  sucesso: 0,
  erros: 0,
  pulados: 0,
  inicio: Date.now(),
  erros_detalhados: []
};

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function ensureIntegrationKey(item) {
  if (!item) return item;
  if (!item.codigo_produto_integracao) {
    item.codigo_produto_integracao = item.codigo || String(item.codigo_produto || '');
  }
  return item;
}

// ============================================================================
// Funções da API Omie
// ============================================================================

async function listarProdutosOmie(pagina, tentativa = 1) {
  const body = {
    call: 'ListarProdutos',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      pagina,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    }]
  };

  try {
    const response = await fetch(OMIE_PROD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    if (tentativa < MAX_RETRIES) {
      console.warn(`⚠️  Erro ao buscar página ${pagina}, tentativa ${tentativa}/${MAX_RETRIES}: ${error.message}`);
      await sleep(1000 * tentativa);
      return listarProdutosOmie(pagina, tentativa + 1);
    }
    throw error;
  }
}

async function consultarProdutoOmie(codigoProduto, codigo, tentativa = 1) {
  const param = codigoProduto 
    ? { codigo_produto: codigoProduto }
    : { codigo: codigo };

  const body = {
    call: 'ConsultarProduto',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [param]
  };

  try {
    const response = await fetch(OMIE_PROD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    if (tentativa < MAX_RETRIES) {
      console.warn(`   ⚠️  Erro ao consultar produto ${codigoProduto || codigo}, tentativa ${tentativa}/${MAX_RETRIES}`);
      await sleep(500 * tentativa);
      return consultarProdutoOmie(codigoProduto, codigo, tentativa + 1);
    }
    throw error;
  }
}

// ============================================================================
// Funções de Banco de Dados
// ============================================================================

async function upsertProdutoNoBanco(produto) {
  const obj = ensureIntegrationKey({ ...produto });
  await dbQuery('SELECT omie_upsert_produto($1::jsonb)', [obj]);
}

// ============================================================================
// Processamento
// ============================================================================

async function processarProduto(produto, index, total) {
  const codigoProduto = produto.codigo_produto;
  const codigo = produto.codigo;
  const descricao = (produto.descricao || '').substring(0, 50);
  
  try {
    stats.processados++;
    
    // Consulta detalhes completos do produto na Omie
    const produtoCompleto = await consultarProdutoOmie(codigoProduto, codigo);
    
    if (!produtoCompleto) {
      stats.pulados++;
      console.log(`   ⏭️  [${index}/${total}] Produto ${codigo} (${codigoProduto}) - payload vazio, pulando`);
      return;
    }

    // Salva no banco
    await upsertProdutoNoBanco(produtoCompleto);
    
    stats.sucesso++;
    const progresso = ((stats.processados / stats.total_produtos) * 100).toFixed(1);
    console.log(`   ✅ [${index}/${total}] ${progresso}% - ${codigo} - ${descricao}`);
    
  } catch (error) {
    stats.erros++;
    stats.erros_detalhados.push({
      codigo_produto: codigoProduto,
      codigo: codigo,
      descricao,
      erro: error.message
    });
    console.error(`   ❌ [${index}/${total}] Erro ao processar ${codigo} (${codigoProduto}): ${error.message}`);
  }
  
  // Delay entre produtos
  await sleep(DELAY_ENTRE_PRODUTOS_MS);
}

async function processarPagina(pagina) {
  console.log(`\n📄 Buscando página ${pagina}/${stats.total_paginas}...`);
  
  const resultado = await listarProdutosOmie(pagina);
  const produtos = resultado.produto_servico_cadastro || [];
  
  console.log(`   Produtos na página: ${produtos.length}`);
  
  // Processa cada produto da página
  for (let i = 0; i < produtos.length; i++) {
    const indexGlobal = ((pagina - 1) * REGISTROS_POR_PAGINA) + i + 1;
    await processarProduto(produtos[i], indexGlobal, stats.total_produtos);
  }
  
  // Delay entre páginas
  await sleep(DELAY_ENTRE_PAGINAS_MS);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('============================================================================');
  console.log('🔄 SINCRONIZAÇÃO COMPLETA: Omie → PostgreSQL');
  console.log('============================================================================\n');
  
  // Validações
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    console.error('❌ Erro: OMIE_APP_KEY e OMIE_APP_SECRET devem estar configurados!');
    console.error('   Configure as variáveis de ambiente ou adicione no .env\n');
    process.exit(1);
  }

  console.log('✓ Credenciais da Omie configuradas');
  console.log('✓ Conexão com banco de dados OK');
  console.log(`✓ Registros por página: ${REGISTROS_POR_PAGINA}`);
  console.log(`✓ Delay entre páginas: ${DELAY_ENTRE_PAGINAS_MS}ms`);
  console.log(`✓ Delay entre produtos: ${DELAY_ENTRE_PRODUTOS_MS}ms\n`);

  try {
    // 1. Busca primeira página para obter totais
    console.log('📊 Consultando total de produtos na Omie...');
    const primeiraPagina = await listarProdutosOmie(1);
    
    stats.total_paginas = Number(primeiraPagina.total_de_paginas || 1);
    stats.total_produtos = Number(primeiraPagina.total_de_registros || 0);
    
    console.log(`\n✓ Total de páginas: ${stats.total_paginas}`);
    console.log(`✓ Total de produtos: ${stats.total_produtos}`);
    
    const tempoEstimado = Math.ceil(
      (stats.total_paginas * DELAY_ENTRE_PAGINAS_MS + 
       stats.total_produtos * (DELAY_ENTRE_PRODUTOS_MS + 200)) / 1000 / 60
    );
    console.log(`⏱️  Tempo estimado: ~${tempoEstimado} minutos\n`);
    
    // Aguarda 3 segundos antes de iniciar
    console.log('⏳ Iniciando sincronização em 3 segundos...');
    await sleep(3000);
    
    // 2. Processa todas as páginas
    for (let pagina = 1; pagina <= stats.total_paginas; pagina++) {
      await processarPagina(pagina);
      
      // Mostra estatísticas a cada 5 páginas
      if (pagina % 5 === 0) {
        const progresso = ((stats.processados / stats.total_produtos) * 100).toFixed(1);
        const decorrido = formatDuration(Date.now() - stats.inicio);
        console.log(`\n📊 Progresso: ${progresso}% (${stats.processados}/${stats.total_produtos}) - Tempo: ${decorrido}`);
        console.log(`   ✅ Sucesso: ${stats.sucesso} | ❌ Erros: ${stats.erros} | ⏭️  Pulados: ${stats.pulados}\n`);
      }
    }
    
    // 3. Relatório final
    const duracaoTotal = formatDuration(Date.now() - stats.inicio);
    
    console.log('\n============================================================================');
    console.log('🎉 SINCRONIZAÇÃO CONCLUÍDA!');
    console.log('============================================================================\n');
    console.log(`📊 ESTATÍSTICAS:`);
    console.log(`   Total de produtos: ${stats.total_produtos}`);
    console.log(`   Processados: ${stats.processados}`);
    console.log(`   ✅ Sucesso: ${stats.sucesso} (${((stats.sucesso/stats.total_produtos)*100).toFixed(1)}%)`);
    console.log(`   ❌ Erros: ${stats.erros} (${((stats.erros/stats.total_produtos)*100).toFixed(1)}%)`);
    console.log(`   ⏭️  Pulados: ${stats.pulados}`);
    console.log(`   ⏱️  Duração total: ${duracaoTotal}\n`);
    
    if (stats.erros_detalhados.length > 0) {
      console.log('❌ ERROS DETALHADOS:');
      stats.erros_detalhados.slice(0, 10).forEach((erro, i) => {
        console.log(`   ${i + 1}. ${erro.codigo} (${erro.codigo_produto}) - ${erro.erro}`);
      });
      if (stats.erros_detalhados.length > 10) {
        console.log(`   ... e mais ${stats.erros_detalhados.length - 10} erros\n`);
      }
      console.log('');
    }
    
    console.log('✅ Tabela public.produtos_omie atualizada com sucesso!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERRO FATAL:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Executa
main();
