#!/usr/bin/env node
/**
 * Script para sincronizar recebimentos de NF-e da Omie
 * E preencher corretamente a coluna c_chave_nfe
 * 
 * Uso: npm run sync-recebimentos-nfe
 * Ou:  node scripts/sync_recebimentos_completo.js
 */

const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '4244634488206';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '10d9dde2e4e3bac7e62a2cc01bfba01e';

async function syncRecebimentos() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  🔄 Sincronizando Recebimentos de NF-e da Omie              ║');
  console.log('║     Com preenchimento de c_chave_nfe                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Usa a função do servidor
    const response = await fetch('http://localhost:5001/api/admin/sync-recebimentos-nfe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_inicial: null,
        data_final: null
      })
    });

    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.status}`);
    }

    const result = await response.json();
    
    console.log('✅ Sincronização iniciada!\n');
    console.log(JSON.stringify(result, null, 2));
    console.log('\n✓ Verifique os logs do servidor com:');
    console.log('  pm2 logs intranet_api\n');

  } catch (err) {
    console.error('❌ Erro ao sincronizar:', err.message);
    console.log('\n💡 Alternativa: Usar o endpoint via cURL:\n');
    console.log('curl -X POST http://localhost:5001/api/admin/sync-recebimentos-nfe \\');
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d "{}"\n');
  }
}

syncRecebimentos();
