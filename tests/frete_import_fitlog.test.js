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

  const fontesAuxiliares = [{
    fonte: { slug: 'fitlog', sufixo: 'prazos', arquivo: 'fitlog RELAÇÃO DE PRAÇAS E PRAZOS - GERAL - 13ABR26.xlsx' },
    grupos: [{
      aba: 'FIT',
      linhas: [
        { numero_linha: 2, dados: { A: 'unidade_origem', B: 'uf_origem', C: 'cidade_origem' } },
        { numero_linha: 3, dados: { A: 'BHZ', B: 'MG', C: 'CONTAGEM', E: 'RJ', F: 'PETROPOLIS', I: 9 } },
        {
          numero_linha: 60001,
          dados: {
            A: 'FLN', B: 'SC', C: 'PALHOCA', E: 'RJ', F: 'PETROPOLIS', G: 3303906,
            H: 1169, I: 4, J: 5, K: 'STQQS.', L: 42.5, M: 'RIOI', N: 'I', O: 'RJ - INTERIOR',
            P: 25600001, Q: 25779999
          }
        }
      ]
    }]
  }];

  const resumo = await normalizarFitlogPorCidade(client, 8, grupos, fontesAuxiliares);
  assert.equal(resumo.coberturas, 1);
  assert.equal(resumo.faixas, 7);

  const cobertura = JSON.parse(chamadas.find((item) => item.sql.includes('INSERT INTO frete.cobertura')).params[1])[0];
  assert.deepEqual(
    {
      cidade: cobertura.cidade, uf: cobertura.uf, inicio: cobertura.cep_inicio, fim: cobertura.cep_fim,
      prazo: cobertura.prazo_min_dias, frequencia: cobertura.frequencia
    },
    { cidade: 'PETROPOLIS', uf: 'RJ', inicio: 25600001, fim: 25779999, prazo: 4, frequencia: 'STQQS.' }
  );
  assert.equal(cobertura.metadados.unidade_origem_prazo, 'FLN');
  assert.equal(cobertura.metadados.cidade_origem_prazo, 'PALHOCA');
  assert.equal(cobertura.metadados.prazo_dificil_entrega_dias, 5);
  assert.equal(resumo.diagnostico_chaves.cidades_com_prazo, 1);
  assert.equal(resumo.diagnostico_chaves.cidades_com_tda_automatica, 1);
  assert.equal(resumo.diagnostico_chaves.linhas_prazo_ignoradas_outras_origens, 1);

  const adicionais = JSON.parse(chamadas.find((item) => item.sql.includes('INSERT INTO frete.adicional_cep')).params[1]);
  assert.deepEqual(adicionais[0], {
    codigo: 'TDA', nome: 'Taxa de dificuldade de acesso', tipo: 'fixo', valor: 42.5,
    uf: 'RJ', cidade_normalizada: 'PETROPOLIS', cep_inicio: 25600001, cep_fim: 25779999,
    peso_maior_que: null, peso_ate: null, prioridade: 50,
    metadados: {
      fonte: 'fitlog RELAÇÃO DE PRAÇAS E PRAZOS - GERAL - 13ABR26.xlsx', linha: 60001,
      unidade_origem: 'FLN', cidade_origem: 'PALHOCA', estrategia_correspondencia: 'cidade_uf',
      classificacao_praca: 'I'
    }
  });

  const faixas = JSON.parse(chamadas.find((item) => item.sql.includes('INSERT INTO frete.tarifa_faixa')).params[1]);
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

  const regras = JSON.parse(chamadas.find((item) => item.sql.includes('INSERT INTO frete.regra_adicional')).params[1]);
  const freteValor = regras.find((item) => item.codigo === 'FRETE_VALOR_FITLOG_RJ_PETROPOLIS');
  assert.equal(freteValor.valor, 0.004);
  assert.equal(freteValor.minimo, 5.3);
});

test('concilia prazo Fitlog pelo CEP quando a tarifa usa o nome de um distrito', async () => {
  const chamadas = [];
  const client = { async query(sql, params) { chamadas.push({ sql, params }); return { rows: [] }; } };
  const grupos = [{
    aba: 'TARIFA POR CIDADE',
    linhas: [{
      numero_linha: 100,
      dados: {
        B: 'SAO MATEUS DE MINAS', C: 'MG', G: 'MG - INTERIOR',
        H: 50, I: 50, J: 60, K: 70, L: 80, M: 90, N: 1,
        AE: 37652000, AF: 37652000
      }
    }]
  }];
  const auxiliares = [{
    fonte: { slug: 'fitlog', sufixo: 'prazos', arquivo: 'prazos.xlsx' },
    grupos: [{
      aba: 'FIT',
      linhas: [{
        numero_linha: 200,
        dados: {
          A: 'FLN', B: 'SC', C: 'PALHOCA', E: 'MG', F: 'CAMANDUCAIA',
          I: 8, J: 9, P: 37650000, Q: 37652000
        }
      }]
    }]
  }];

  await normalizarFitlogPorCidade(client, 8, grupos, auxiliares);
  const cobertura = JSON.parse(chamadas[0].params[1])[0];
  assert.equal(cobertura.prazo_min_dias, 8);
  assert.equal(cobertura.metadados.estrategia_correspondencia_prazo, 'cep_contido');
  assert.equal(cobertura.metadados.cidade_origem_prazo, 'PALHOCA');
});
