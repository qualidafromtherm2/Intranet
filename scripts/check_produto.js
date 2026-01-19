// Script para verificar o estado do produto no banco
const { dbQuery } = require('../src/db');

async function checkProduto() {
  try {
    console.log('Consultando produto 10437359849 no banco...\n');
    
    const result = await dbQuery(`
      SELECT 
        codigo_produto, 
        codigo, 
        descricao, 
        obs_internas,
        inativo,
        bloqueado,
        updated_at,
        created_at
      FROM public.produtos_omie 
      WHERE codigo_produto = 10437359849 
         OR codigo = '09.MC.N.10622'
      LIMIT 1
    `);
    
    if (result.rows && result.rows.length > 0) {
      const produto = result.rows[0];
      console.log('✓ Produto encontrado:\n');
      console.log('  codigo_produto:', produto.codigo_produto);
      console.log('  codigo:', produto.codigo);
      console.log('  descricao:', produto.descricao);
      console.log('  obs_internas:', produto.obs_internas);
      console.log('  inativo:', produto.inativo);
      console.log('  bloqueado:', produto.bloqueado);
      console.log('  created_at:', produto.created_at);
      console.log('  updated_at:', produto.updated_at);
      console.log('\n✓ O webhook esperado deveria atualizar a obs_internas para: #40288318');
    } else {
      console.log('✗ Produto NÃO encontrado no banco!');
      console.log('  O webhook deveria ter criado este produto.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Erro ao consultar:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

checkProduto();
