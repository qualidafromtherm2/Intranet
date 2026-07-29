const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarFitlogPorCidade } = require('../scripts/importar_tabelas_frete');

test('importa Petrópolis e sua tarifa pela aba consolidada da Fitlog', async () => {
  const chamadas = [];
  const client = {
    async query(sql, params) {
      chamadas.push({ sql, params });
      return { rows: [] };
    }
  };
  const grupos = [{
    aba: 'TARIFA POR CIDADE',
    linhas: [{
      numero_linha: 3818,
      dados: {
        B: 'PETROPOLIS', C: 'RJ', G: 'RJ - INTERIOR',
        H: 61.3, I: 61.3, J: 73.56, K: 82.76, L: 96.34, M: 105.97,
        N: 0.976, O: 0.004, P: 5.3, Q: 9.3, U: 6.9,
        AE: 25600001, AF: 25779999
      }
    }]
  }];

  const resumo = await normalizarFitlogPorCidade(client, 8, grupos);
  assert.equal(resumo.coberturas, 1);
  assert.equal(resumo.faixas, 7);

  const cobertura = JSON.parse(chamadas[0].params[1])[0];
  assert.deepEqual(
    { cidade: cobertura.cidade, uf: cobertura.uf, inicio: cobertura.cep_inicio, fim: cobertura.cep_fim },
    { cidade: 'PETROPOLIS', uf: 'RJ', inicio: 25600001, fim: 25779999 }
  );

  const faixas = JSON.parse(chamadas[1].params[1]);
  assert.deepEqual(
    faixas.find((item) => item.peso_de === 70 && item.peso_ate === 100),
    {
      codigo_regiao: 'FITLOG_RJ_PETROPOLIS',
      peso_de: 70,
      peso_ate: 100,
      valor_base: 105.97,
      valor_excedente: null,
      peso_referencia: null,
      despacho: 9.3,
      pedagio: 6.9,
      metadados: { fonte: 'TARIFA POR CIDADE', linha: 3818 }
    }
  );

  const regras = JSON.parse(chamadas[2].params[1]);
  const freteValor = regras.find((item) => item.codigo === 'FRETE_VALOR_FITLOG_RJ_PETROPOLIS');
  assert.equal(freteValor.valor, 0.004);
  assert.equal(freteValor.minimo, 5.3);
});
