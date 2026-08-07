const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolverProdutoOmieAtivo,
  resolverCodigoProdutoPreferindoAtivo,
  mensagemErroOmieProduto,
  omieErroProdutoNaoLocalizado
} = require('../utils/produtoOmieAtivo');

test('ignora candidato inativo e resolve o cadastro ativo pelo código', async () => {
  const consultas = [];
  const query = async (sql, params) => {
    consultas.push({ sql, params });
    if (sql.includes('p.codigo_produto = $1')) return { rows: [] };
    return { rows: [{ codigo_produto: '10770703208' }] };
  };

  const id = await resolverProdutoOmieAtivo({
    dbQuery: query,
    candidatos: ['10748663973'],
    codigo: '01.MP.N.30100'
  });

  assert.equal(id, 10770703208);
  assert.ok(consultas.length >= 2);
  assert.match(consultas[0].sql, /inativo/);
  assert.match(consultas[0].sql, /bloqueado/);
});

test('falha quando não existe cadastro ativo e desbloqueado', async () => {
  const query = async () => ({ rows: [] });
  await assert.rejects(
    resolverProdutoOmieAtivo({ dbQuery: query, candidatos: [], codigo: 'SEM-ATIVO' }),
    /ativo e desbloqueado/
  );
});

test('preferindo ativo: código duplicado retorna o ID ativo (não o fantasma)', async () => {
  const query = async (sql, params) => {
    if (sql.includes('AND') && sql.includes('inativo') && sql.includes('TRIM(p.codigo)')) {
      assert.deepEqual(params, ['01.MP.N.30100']);
      return { rows: [{ codigo_produto: '10770703208' }] };
    }
    if (sql.includes('ORDER BY') && sql.includes('inativo')) {
      return { rows: [{ id_omie: '10748663973' }] }; // não deve chegar aqui em strict
    }
    return { rows: [] };
  };

  const id = await resolverCodigoProdutoPreferindoAtivo(query, '01.MP.N.30100', { strictAtivo: true });
  assert.equal(id, '10770703208');
});

test('preferindo ativo: ID fantasma resolve para o ativo pelo mesmo SKU', async () => {
  const query = async (sql, params) => {
    if (sql.includes('p.codigo_produto = $1') && sql.includes('inativo')) {
      return { rows: [] }; // ID fantasma não está ativo
    }
    if (sql.includes('FROM produto.produtos_omie') && sql.includes('WHERE codigo_produto = $1') && sql.includes('integracao')) {
      assert.deepEqual(params, [10748663973]);
      return { rows: [{ codigo: '01.MP.N.30100', integracao: '01.MP.N.30100' }] };
    }
    if (sql.includes('TRIM(p.codigo) = $1') && sql.includes('inativo')) {
      return { rows: [{ codigo_produto: '10770703208' }] };
    }
    return { rows: [] };
  };

  const id = await resolverCodigoProdutoPreferindoAtivo(query, '10748663973', { strictAtivo: true });
  assert.equal(id, '10770703208');
});

test('extrai faultstring do JSON Omie e detecta produto não localizado', () => {
  const json = JSON.stringify({
    faultstring: 'ERROR: Nenhum produto foi localizado para o [Código de Integração] informado.',
    faultcode: 'SOAP-ENV:Client-1235'
  });
  assert.match(mensagemErroOmieProduto(json), /Nenhum produto foi localizado/);
  assert.equal(omieErroProdutoNaoLocalizado(json), true);
  assert.equal(omieErroProdutoNaoLocalizado('Local do Estoque não cadastrado'), false);
});
