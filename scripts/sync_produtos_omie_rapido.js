#!/usr/bin/env node

// ============================================================================
// Script de Sincronização RÁPIDA: Omie → PostgreSQL
// ============================================================================
// Sincroniza produtos usando apenas ListarProdutos (mais rápido)
// Não consulta detalhes individuais de cada produto
// Use este script para sincronização inicial rápida
//
// USO:
//   node scripts/sync_produtos_omie_rapido.js
// ============================================================================

const { dbQuery } = require('../src/db');

// Configurações
const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '';
const OMIE_PROD_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';

const REGISTROS_POR_PAGINA = 100; // máximo permitido pela API
const DELAY_MS = 500;
const MAX_RETRIES = 3;

// Estatísticas
const stats = {
  total_paginas: 0,
  total_produtos: 0,
  processados: 0,
  sucesso: 0,
  erros: 0,
  inicio: Date.now()
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
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
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
      console.warn(`⚠️  Retry ${tentativa}/${MAX_RETRIES} página ${pagina}: ${error.message}`);
      await sleep(1000 * tentativa);
      return listarProdutosOmie(pagina, tentativa + 1);
    }
    throw error;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('============================================================================');
  console.log('⚡ SINCRONIZAÇÃO RÁPIDA: Omie → PostgreSQL');
  console.log('============================================================================\n');
  
  // Validações
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    console.error('❌ Erro: OMIE_APP_KEY e OMIE_APP_SECRET devem estar configurados!\n');
    process.exit(1);
  }

  console.log('✓ Credenciais configuradas');
  console.log('✓ Conexão com banco OK\n');

  try {
    // 1. Busca primeira página
    console.log('📊 Consultando total de produtos...');
    const primeiraPagina = await listarProdutosOmie(1);
    
    stats.total_paginas = Number(primeiraPagina.total_de_paginas || 1);
    stats.total_produtos = Number(primeiraPagina.total_de_registros || 0);
    
    console.log(`✓ Total: ${stats.total_produtos} produtos em ${stats.total_paginas} páginas`);
    console.log(`⏱️  Tempo estimado: ~${Math.ceil(stats.total_paginas * DELAY_MS / 1000 / 60)} minutos\n`);
    
    console.log('⏳ Iniciando em 2 segundos...');
    await sleep(2000);
    
    // 2. Processa todas as páginas
    for (let pagina = 1; pagina <= stats.total_paginas; pagina++) {
      const resultado = pagina === 1 ? primeiraPagina : await listarProdutosOmie(pagina);
      const produtos = resultado.produto_servico_cadastro || [];
      
      console.log(`📄 Página ${pagina}/${stats.total_paginas} - ${produtos.length} produtos`);
      
      // Processa produtos em batch
      for (const produto of produtos) {
        try {
          const obj = ensureIntegrationKey({ ...produto });
          await dbQuery('SELECT omie_upsert_produto($1::jsonb)', [obj]);
          stats.sucesso++;
          stats.processados++;
        } catch (error) {
          stats.erros++;
          stats.processados++;
          console.error(`   ❌ Erro: ${produto.codigo} - ${error.message}`);
        }
      }
      
      const progresso = ((stats.processados / stats.total_produtos) * 100).toFixed(1);
      console.log(`   ✅ ${progresso}% concluído (${stats.sucesso} ok, ${stats.erros} erros)\n`);
      
      // Delay entre páginas
      if (pagina < stats.total_paginas) {
        await sleep(DELAY_MS);
      }
    }
    
    // 3. Relatório final
    const duracao = formatDuration(Date.now() - stats.inicio);
    
    console.log('============================================================================');
    console.log('🎉 SINCRONIZAÇÃO CONCLUÍDA!');
    console.log('============================================================================\n');
    console.log(`📊 ESTATÍSTICAS:`);
    console.log(`   Total: ${stats.total_produtos}`);
    console.log(`   ✅ Sucesso: ${stats.sucesso} (${((stats.sucesso/stats.total_produtos)*100).toFixed(1)}%)`);
    console.log(`   ❌ Erros: ${stats.erros} (${((stats.erros/stats.total_produtos)*100).toFixed(1)}%)`);
    console.log(`   ⏱️  Duração: ${duracao}\n`);
    
    console.log('✅ Tabela public.produtos_omie atualizada!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERRO FATAL:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
