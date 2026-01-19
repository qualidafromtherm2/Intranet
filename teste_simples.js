const OMIE_APP_KEY = '4244634488206';
const OMIE_APP_SECRET = '10d9dde2e4e3bac7e62a2cc01bfba01e';

async function testar() {
  console.log('Testando API Omie - Pedidos com todos os filtros...\n');
  
  const body = {
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
  
  const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  const data = await response.json();
  
  console.log(`Total na Omie: ${data.nTotalRegistros}`);
  console.log(`Retornados: ${data.pedidos_pesquisa?.length || 0}\n`);
  
  const etapas = {};
  for (const p of (data.pedidos_pesquisa || [])) {
    const etapa = p.cabecalho?.cEtapa || 'SEM';
    etapas[etapa] = (etapas[etapa] || 0) + 1;
  }
  
  console.log('Etapas:');
  for (const [e, c] of Object.entries(etapas).sort()) {
    console.log(`  ${e}: ${c}`);
  }
}

testar().catch(console.error);
