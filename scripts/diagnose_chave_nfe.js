#!/usr/bin/env node
/**
 * Script para diagnóstico da coluna c_chave_nfe
 * Objetivo: Identificar por que a coluna está vazia e sugerir soluções
 */

const { Pool } = require('pg');

const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '4244634488206';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '10d9dde2e4e3bac7e62a2cc01bfba01e';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    'postgresql://intranet_db_yd0w_user:amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho@dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com:5432/intranet_db_yd0w?sslmode=require'
});

async function diagnoseChaveNFe() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  🔍 DIAGNÓSTICO: Coluna c_chave_nfe no Schema Logística     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // 1. Verificar quantidade de registros
    console.log('📊 ETAPA 1: Verificando dados na tabela...\n');
    
    const countResult = await pool.query(`
      SELECT 
        COUNT(*) as total_registros,
        COUNT(c_chave_nfe) FILTER (WHERE c_chave_nfe IS NOT NULL AND c_chave_nfe != '') as com_chave,
        COUNT(c_chave_nfe) FILTER (WHERE c_chave_nfe IS NULL OR c_chave_nfe = '') as sem_chave
      FROM logistica.recebimentos_nfe_omie;
    `);

    const { total_registros, com_chave, sem_chave } = countResult.rows[0];
    
    console.log(`   • Total de registros: ${total_registros}`);
    console.log(`   • Com c_chave_nfe preenchido: ${com_chave}`);
    console.log(`   • Com c_chave_nfe vazio: ${sem_chave}\n`);

    if (total_registros === 0) {
      console.log('⚠️  PROBLEMA: Tabela está vazia!\n');
      console.log('   Possíveis causas:');
      console.log('   1️⃣  Webhook nunca foi acionado pela Omie');
      console.log('   2️⃣  Você está em modo JSON (sem banco Postgres)');
      console.log('   3️⃣  Nenhuma sincronização foi executada\n');
      console.log('   Soluções:');
      console.log('   ✓ Execute: npm run sync-recebimentos-nfe');
      console.log('   ✓ Ou configure o webhook na Omie\n');
      await pool.end();
      return;
    }

    // 2. Se há registros, verificar estrutura dos dados
    console.log('📋 ETAPA 2: Analisando estrutura dos registros...\n');
    
    const sampleResult = await pool.query(`
      SELECT 
        n_id_receb,
        c_chave_nfe,
        c_numero_nfe,
        c_nome_fornecedor,
        updated_at
      FROM logistica.recebimentos_nfe_omie
      ORDER BY updated_at DESC
      LIMIT 3;
    `);

    sampleResult.rows.forEach((row, idx) => {
      console.log(`   Registro ${idx + 1}:`);
      console.log(`   • ID: ${row.n_id_receb}`);
      console.log(`   • Chave NF-e: ${row.c_chave_nfe || '❌ VAZIO'}`);
      console.log(`   • Número NF-e: ${row.c_numero_nfe}`);
      console.log(`   • Fornecedor: ${row.c_nome_fornecedor}`);
      console.log(`   • Última atualização: ${row.updated_at}\n`);
    });

    if (sem_chave > 0) {
      console.log('❌ PROBLEMA: Há registros com c_chave_nfe vazio!\n');
      
      // 3. Testar se a Omie está retornando a chave
      console.log('🧪 ETAPA 3: Testando API da Omie...\n');
      
      const firstRec = sampleResult.rows[0];
      if (firstRec && firstRec.n_id_receb) {
        console.log(`   Consultando recebimento ${firstRec.n_id_receb} na Omie...\n`);
        
        try {
          const response = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              call: 'ConsultarRecebimento',
              app_key: OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET,
              param: [{ nIdReceb: parseInt(firstRec.n_id_receb) }]
            })
          });

          if (!response.ok) {
            console.log(`   ⚠️  Erro na API Omie: ${response.status}`);
          } else {
            const data = await response.json();
            const cabec = data.cabec || {};
            
            console.log(`   ✓ Resposta da Omie recebida!\n`);
            console.log(`   Verificando campo cChaveNfe:`);
            console.log(`   • cabec.cChaveNfe: ${cabec.cChaveNfe || '❌ NÃO ENCONTRADO'}`);
            console.log(`   • cabec.cNumeroNFe: ${cabec.cNumeroNFe || 'N/A'}`);
            console.log(`   • cabec.nIdReceb: ${cabec.nIdReceb || 'N/A'}\n`);

            if (!cabec.cChaveNfe) {
              console.log('❌ DESCOBERTA: A Omie NÃO está retornando cChaveNfe na consulta!\n');
              console.log('   Possível causa:');
              console.log('   • Versão diferente da API');
              console.log('   • Permissões insuficientes\n');
            } else {
              console.log('✅ A Omie está retornando cChaveNfe corretamente.\n');
              console.log('   Possível causa do problema:');
              console.log('   • A função upsertRecebimentoNFe() não está preenchendo corretamente');
              console.log('   • Ou o campo está sendo sobrescrito com null\n');
            }
          }
        } catch (apiErr) {
          console.log(`   ⚠️  Erro ao testar API: ${apiErr.message}\n`);
        }
      }

      // 4. Sugerir solução
      console.log('🔧 ETAPA 4: Soluções recomendadas\n');
      console.log('   1️⃣  Forçar resincronização com UPDATE:');
      console.log(`      npm run sync-recebimentos-nfe\n`);
      
      console.log('   2️⃣  Ou execute este comando SQL para preencher manualmente:\n');
      console.log(`      UPDATE logistica.recebimentos_nfe_omie`);
      console.log(`      SET c_chave_nfe = CONCAT(`);
      console.log(`        c_modelo_nfe, '24',`);
      console.log(`        LPAD(CAST(n_id_fornecedor AS TEXT), 14, '0'),`);
      console.log(`        '0001',`);
      console.log(`        LPAD(CAST(c_serie_nfe AS TEXT), 3, '0'),`);
      console.log(`        LPAD(CAST(c_numero_nfe AS TEXT), 9, '0'),`);
      console.log(`        '00000001'\);`);
      console.log(`      WHERE c_chave_nfe IS NULL OR c_chave_nfe = '';\n`);

      console.log('   3️⃣  Verificar logs do servidor:\n');
      console.log(`      pm2 logs intranet_api | grep "upsertRecebimentoNFe"\n`);
    } else {
      console.log('✅ SUCESSO: Todos os registros têm c_chave_nfe preenchido!\n');
    }

  } catch (err) {
    console.error('❌ Erro ao executar diagnóstico:', err.message);
  } finally {
    await pool.end();
  }

  console.log('════════════════════════════════════════════════════════════════\n');
}

// Executar
diagnoseChaveNFe().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
