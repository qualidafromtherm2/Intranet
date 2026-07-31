const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverProdutoOmieAtivo } = require('../utils/produtoOmieAtivo');

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
  assert.equal(consultas.length, 2);
  assert.match(consultas[0].sql, /inativo/);
  assert.match(consultas[0].sql, /bloqueado/);
  assert.deepEqual(consultas[1].params, ['01.MP.N.30100']);
});

test('falha quando não existe cadastro ativo e desbloqueado', async () => {
  const query = async () => ({ rows: [] });
  await assert.rejects(
    resolverProdutoOmieAtivo({ dbQuery: query, candidatos: [], codigo: 'SEM-ATIVO' }),
    /ativo e desbloqueado/
  );
});
