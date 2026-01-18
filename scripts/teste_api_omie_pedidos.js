// Script para testar o que a API da Omie retorna
const OMIE_APP_KEY = process.env.OMIE_APP_KEY || 'Consulte no server.js';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || 'Consulte no server.js';

async function testarAPIOmie() {
  console.log('=== TESTE 1: Buscar TODOS os pedidos (página 1) ===\n');
  
  const body1 = {
    call: 'PesquisarPedCompra',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      nPagina: 1,
      nRegsPorPagina: 50,
      lExibirPedidosPendentes: true,
      lExibirPedidosFaturados: true,
      lExibirPedidosRecebidos: true,
      lExibirPedidosCancelados: true,
      lExibirPedidosEncerrados: true
    }]
  };
  
  const response1 = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body1)
  });
  
  const data1 = await response1.json();
  console.log(`Total de registros na Omie: ${data1.nTotalRegistros}`);
  console.log(`Total de páginas: ${data1.nTotalPaginas}`);
  console.log(`Pedidos retornados: ${data1.pedidos_pesquisa?.length || 0}\n`);
  
  // Analisa etapas dos primeiros 50 pedidos
  const etapas = {};
  for (const pedido of (data1.pedidos_pesquisa || [])) {
    const etapa = pedido.cabecalho?.cEtapa || pedido.cabecalho_consulta?.cEtapa || 'SEM_ETAPA';
    etapas[etapa] = (etapas[etapa] || 0) + 1;
  }
  
  console.log('=== Distribuição por etapa (primeiros 50 pedidos) ===');
  for (const [etapa, count] of Object.entries(etapas).sort()) {
    console.log(`Etapa ${etapa}: ${count} pedidos`);
  }
  
  console.log('\n=== TESTE 2: Buscar apenas pedidos FATURADOS ===\n');
  
  const body2 = {
    call: 'PesquisarPedCompra',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      nPagina: 1,
      nRegsPorPagina: 50,
      lExibirPedidosPendentes: false,
      lExibirPedidosFaturados: true,
      lExibirPedidosRecebidos: false,
      lExibirPedidosCancelados: false,
      lExibirPedidosEncerrados: false
    }]
  };
  
  const response2 = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body2)
  });
  
  const data2 = await response2.json();
  console.log(`Total de pedidos FATURADOS: ${data2.nTotalRegistros}`);
  console.log(`Pedidos retornados: ${data2.pedidos_pesquisa?.length || 0}`);
  
  if (data2.pedidos_pesquisa?.length > 0) {
    console.log('\nExemplo de pedido faturado:');
    const exemplo = data2.pedidos_pesquisa[0];
    console.log(JSON.stringify(exemplo, null, 2));
  }
  
  console.log('\n=== TESTE 3: Buscar apenas pedidos RECEBIDOS ===\n');
  
  const body3 = {
    call: 'PesquisarPedCompra',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      nPagina: 1,
      nRegsPorPagina: 50,
      lExibirPedidosPendentes: false,
      lExibirPedidosFaturados: false,
      lExibirPedidosRecebidos: true,
      lExibirPedidosCancelados: false,
      lExibirPedidosEncerrados: false
    }]
  };
  
  const response3 = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body3)
  });
  
  const data3 = await response3.json();
  console.log(`Total de pedidos RECEBIDOS: ${data3.nTotalRegistros}`);
  console.log(`Pedidos retornados: ${data3.pedidos_pesquisa?.length || 0}`);
}

testarAPIOmie().catch(console.error);
