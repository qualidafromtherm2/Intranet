const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '';

async function testar() {
  console.log('Testando API Omie - Pedidos com todos os filtros...\n');
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('Defina OMIE_APP_KEY e OMIE_APP_SECRET antes de executar teste_simples.js');
  }
  
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
