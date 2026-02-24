#!/usr/bin/env node
/**
 * Script para sincronizar recebimentos de NF-e da Omie
 * Executa via endpoint local ou diretamente via API
 * Respeita limite de 3 requisições/segundo
 */

const http = require('http');

console.log('\n╔════════════════════════════════════════════════════════════════╗');
console.log('║  🔄 Sincronizando Recebimentos de NF-e da Omie                ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

const options = {
  hostname: 'localhost',
  port: 5001,
  path: '/api/admin/sync/recebimentos-nfe',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': 2
  },
  timeout: 300000 // 5 minutos
};

console.log('📡 Conectando ao servidor local...\n');

const req = http.request(options, (res) => {
  console.log(`✓ Servidor respondeu: ${res.statusCode}\n`);
  
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('📊 Resultado:\n');
      console.log(JSON.stringify(result, null, 2));
      console.log('\n✓ Sincronização concluída!\n');
      
      if (result.ok) {
        console.log(`   • Total sincronizado: ${result.total_sincronizados || 0}`);
        console.log(`   • Tempo: ${result.tempo_formatado || 'N/A'}`);
      }
    } catch (err) {
      console.log('Resposta:', data);
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Verifique os dados com:');
    console.log('  SELECT COUNT(*), COUNT(c_chave_nfe) FROM logistica.recebimentos_nfe_omie;');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
});

req.on('error', (err) => {
  console.error('❌ Erro ao conectar:', err.message);
  console.log('\n💡 Verifique se o servidor está rodando:');
  console.log('   pm2 list\n');
  process.exit(1);
});

req.on('timeout', () => {
  console.log('\n⏱️  Timeout - sincronização ainda está executando...');
  console.log('   Verifique os logs: pm2 logs intranet_api\n');
  req.destroy();
});

console.log('⏳ Aguardando sincronização (pode levar alguns minutos)...\n');

req.write('{}');
req.end();
