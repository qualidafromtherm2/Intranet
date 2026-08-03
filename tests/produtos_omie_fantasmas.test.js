const test = require('node:test');
const assert = require('node:assert/strict');
const {
  desativarDuplicatasMesmoCodigo,
  limparDuplicatasAtivasLocais
} = require('../utils/produtosOmieFantasmas');

test('desativarDuplicatasMesmoCodigo inativa irmãos ativos do mesmo SKU', async () => {
  const updates = [];
  const client = {
    query: async (sql, params) => {
      if (/BEGIN|COMMIT|ROLLBACK|set_config/i.test(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM public.produtos_omie') && sql.includes('WHERE codigo_produto = $1')) {
        return { rows: [{ codigo: '01.MP.N.30100', integracao: '01.MP.N.30100', inativo: 'N' }] };
      }
      if (sql.includes('UPDATE public.produtos_omie') && sql.includes('codigo_produto <> $1')) {
        updates.push(params);
        return {
          rows: [{ codigo_produto: '10748663973', codigo: '01.MP.N.30100', descricao: 'ANTIGO' }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  const r = await desativarDuplicatasMesmoCodigo(client, {
    codigoProduto: '10770703208',
    codigo: '01.MP.N.30100',
    integracao: '01.MP.N.30100'
  }, 'omie_sync');

  assert.equal(r.marcados, 1);
  assert.deepEqual(r.ids, ['10748663973']);
  assert.equal(updates.length, 1);
  assert.equal(String(updates[0][0]), '10770703208');
});

test('limparDuplicatasAtivasLocais mantém o maior ID e inativa o resto', async () => {
  let updateParams = null;
  const client = {
    query: async (sql, params) => {
      if (/BEGIN|COMMIT|ROLLBACK|set_config/i.test(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes('GROUP BY TRIM(codigo)')) {
        return {
          rows: [{
            codigo: '01.MP.N.30100',
            ids: ['10770703208', '10748663973']
          }]
        };
      }
      if (sql.includes('UPDATE public.produtos_omie') && sql.includes('ANY($1')) {
        updateParams = params;
        return {
          rows: [{ codigo_produto: '10748663973', codigo: '01.MP.N.30100', descricao: 'ANTIGO' }],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  const r = await limparDuplicatasAtivasLocais(client, 'omie_manual');
  assert.equal(r.marcados, 1);
  assert.equal(r.grupos, 1);
  assert.deepEqual(updateParams[0], ['10748663973']);
});
