// Script para testar a API de Recebimentos e encontrar vinculação com pedidos
const OMIE_APP_KEY = process.env.OMIE_APP_KEY || '4244634488206';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '10d9dde2e4e3bac7e62a2cc01bfba01e';

async function buscarRecebimentoPorNFe(numeroNFe) {
  console.log(`\n🔍 Buscando recebimentos da NF-e: ${numeroNFe}\n`);
  
  try {
    // Lista todos os recebimentos
    const response = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'ListarRecebimentos',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          nPagina: 1,
          nRegsPorPagina: 100
        }]
      })
    });
    
    if (!response.ok) {
      throw new Error(`API retornou ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`📊 Total de recebimentos na Omie: ${data.nTotalRegistros || 0}`);
    console.log(`📄 Recebimentos retornados nesta página: ${data.recebimentos?.length || 0}\n`);
    
    // Procura pela NF-e específica
    const recebimentos = data.recebimentos || [];
    const encontrado = recebimentos.find(r => 
      r.cabec?.cNumeroNFe === numeroNFe || 
      r.cabec?.cNumeroNFe === numeroNFe.replace(/^0+/, '') // Remove zeros à esquerda
    );
    
    if (encontrado) {
      console.log('✅ NF-e ENCONTRADA!\n');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📋 DADOS DO RECEBIMENTO:');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`ID do Recebimento: ${encontrado.cabec?.nIdReceb || 'N/A'}`);
      console.log(`Número da NF-e: ${encontrado.cabec?.cNumeroNFe || 'N/A'}`);
      console.log(`Série: ${encontrado.cabec?.cSerieNFe || 'N/A'}`);
      console.log(`Chave NF-e: ${encontrado.cabec?.cChaveNfe || 'N/A'}`);
      console.log(`Etapa: ${encontrado.cabec?.cEtapa || 'N/A'}`);
      console.log(`Valor NF-e: R$ ${encontrado.cabec?.nValorNFe || 0}`);
      console.log(`Data Emissão: ${encontrado.cabec?.dEmissaoNFe || 'N/A'}`);
      console.log(`Fornecedor: ${encontrado.cabec?.cNome || encontrado.cabec?.cRazaoSocial || 'N/A'}`);
      console.log(`CNPJ: ${encontrado.cabec?.cCNPJ_CPF || 'N/A'}`);
      console.log('');
      console.log('📦 STATUS:');
      console.log(`Faturado: ${encontrado.infoCadastro?.cFaturado || 'N/A'}`);
      console.log(`Data Faturamento: ${encontrado.infoCadastro?.dFat || 'N/A'}`);
      console.log(`Recebido: ${encontrado.infoCadastro?.cRecebido || 'N/A'}`);
      console.log(`Data Recebimento: ${encontrado.infoCadastro?.dRec || 'N/A'}`);
      console.log(`Autorizado: ${encontrado.infoCadastro?.cAutorizado || 'N/A'}`);
      console.log('');
      
      // Verifica se tem itens vinculados a pedidos
      if (encontrado.itens && encontrado.itens.length > 0) {
        console.log('🔗 VINCULAÇÃO COM PEDIDOS DE COMPRA:');
        console.log('═══════════════════════════════════════════════════════════');
        
        const pedidosUnicos = new Set();
        encontrado.itens.forEach(item => {
          if (item.itensCabec?.nIdPedido) {
            pedidosUnicos.add(item.itensCabec.nIdPedido);
          }
        });
        
        if (pedidosUnicos.size > 0) {
          console.log(`\n✅ Esta NF-e está vinculada a ${pedidosUnicos.size} pedido(s):\n`);
          for (const pedidoId of pedidosUnicos) {
            console.log(`   🔸 ID do Pedido na Omie: ${pedidoId}`);
          }
          
          // Mostra detalhes dos itens
          console.log('\n📋 ITENS DA NF-e:');
          encontrado.itens.forEach((item, idx) => {
            console.log(`\n   Item ${idx + 1}:`);
            console.log(`   - Produto: ${item.itensCabec?.cDescricaoProduto || 'N/A'}`);
            console.log(`   - Código: ${item.itensCabec?.cCodigoProduto || 'N/A'}`);
            console.log(`   - Quantidade: ${item.itensCabec?.nQtdeNFe || 0}`);
            console.log(`   - Valor: R$ ${item.itensCabec?.vTotalItem || 0}`);
            console.log(`   - ID Pedido Vinculado: ${item.itensCabec?.nIdPedido || 'Não vinculado'}`);
            console.log(`   - ID Item Pedido: ${item.itensCabec?.nIdItPedido || 'N/A'}`);
          });
        } else {
          console.log('⚠️  Esta NF-e NÃO está vinculada a nenhum pedido de compra');
        }
      } else {
        console.log('⚠️  Nenhum item encontrado neste recebimento');
      }
      
      console.log('\n═══════════════════════════════════════════════════════════\n');
      
    } else {
      console.log(`❌ NF-e ${numeroNFe} não encontrada nos primeiros ${recebimentos.length} recebimentos`);
      console.log('\n💡 Dica: A NF-e pode estar em outra página. Vou buscar em mais páginas...\n');
      
      // Busca em mais páginas
      for (let pagina = 2; pagina <= 3; pagina++) {
        console.log(`🔍 Buscando página ${pagina}...`);
        const resp = await fetch('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'ListarRecebimentos',
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{ nPagina: pagina, nRegsPorPagina: 100 }]
          })
        });
        
        const dataPag = await resp.json();
        const recebPag = dataPag.recebimentos || [];
        
        const encontradoPag = recebPag.find(r => 
          r.cabec?.cNumeroNFe === numeroNFe || 
          r.cabec?.cNumeroNFe === numeroNFe.replace(/^0+/, '')
        );
        
        if (encontradoPag) {
          console.log(`\n✅ Encontrado na página ${pagina}!`);
          // Processa resultado...
          return;
        }
      }
      
      console.log('\n❌ NF-e não encontrada nas primeiras 3 páginas');
    }
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

// Executa a busca
const numeroNFe = process.argv[2] || '000003542';
buscarRecebimentoPorNFe(numeroNFe).catch(console.error);
