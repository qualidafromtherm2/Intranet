const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarEjl } = require('../scripts/importar_tabelas_frete');

const cidadesTarifadas = [
  ['Joinville', 50, 25, 0.5, 0.003],
  ['Blumenau', 50, 25, 0.5, 0.003],
  ['Itajaí', 50, 25, 0.5, 0.003],
  ['Jaraguá do Sul', 50, 25, 0.5, 0.003],
  ['Florianópolis', 50, 25, 0.5, 0.003],
  ['Tubarão', 50, 25, 0.5, 0.003],
  ['Criciúma', 50, 25, 0.5, 0.003],
  ['São Paulo', 85, 25, 0.6, 0.004],
  ['Curitiba', 70, 25, 0.6, 0.004]
];

test('concilia todas as praças oficiais da EJL com as regiões tarifárias', async () => {
  const chamadas = [];
  const client = {
    async query(sql, params) {
      chamadas.push({ sql, params });
      return { rows: [] };
    }
  };
  const grupos = [{
    aba: 'Planilha1',
    linhas: cidadesTarifadas.map(([cidade, minimo, itr, valorKg, adValorem], indice) => ({
      numero_linha: 15 + indice,
      dados: { E: cidade, G: minimo, I: itr, K: valorKg, M: adValorem }
    }))
  }];

  const fontesAuxiliares = [{
    fonte: { slug: 'expresso-ejl', sufixo: 'tde', arquivo: 'RELAÇÃO DE TDE EXPRESSO EJL.xlsx' },
    grupos: [{
      aba: 'Planilha1',
      linhas: [
        { numero_linha: 3, dados: { B: 'SPO', C: 'COTIA', D: 'CIDADE TODA', E: 200 } },
        { numero_linha: 4, dados: { B: 'SPO', C: 'SAO PAULO', D: '04700000 / 04999999', E: 100 } },
        { numero_linha: 5, dados: { B: 'FLS', C: 'CIDADE SEM COBERTURA', D: 'CIDADE TODA', E: 150 } }
      ]
    }]
  }];
  const resumo = await normalizarEjl(client, 6, grupos, fontesAuxiliares);
  const coberturas = JSON.parse(chamadas.find((item) => item.sql.includes('INSERT INTO frete.cobertura')).params[1]);
  const tarifas = JSON.parse(chamadas.find((item) => item.sql.includes('INSERT INTO frete.tarifa_faixa')).params[1]);

  const encontrar = (uf, cidade) => coberturas.find((item) => item.uf === uf && item.cidade_normalizada === cidade);
  assert.equal(encontrar('SP', 'GUARULHOS').codigo_regiao, 'EJL_SP_SAO_PAULO');
  assert.equal(encontrar('SP', 'VALINHOS').codigo_regiao, 'EJL_SP_SAO_PAULO');
  assert.equal(encontrar('PR', 'SAO JOSE DOS PINHAIS').codigo_regiao, 'EJL_PR_CURITIBA');
  assert.equal(encontrar('SC', 'SAO JOSE').codigo_regiao, 'EJL_SC_FLORIANOPOLIS');
  assert.equal(encontrar('SC', 'CORUPA').codigo_regiao, 'EJL_SC_JOINVILLE');
  assert.equal(encontrar('SC', 'JARAGUA DO SUL').codigo_regiao, 'EJL_SC_JARAGUA_DO_SUL');
  assert.equal(encontrar('BA', 'SALVADOR').codigo_regiao, 'EJL_BA_SEM_TARIFA');
  assert.equal(encontrar('SP', 'COTIA').tde, 200);
  assert.ok(coberturas.some((item) => item.uf === 'SP' && item.cidade_normalizada === 'SAO PAULO'
    && item.cep_inicio === 4700000 && item.cep_fim === 4999999 && item.tde === 100));
  assert.ok(coberturas.every((item) => item.prazo_min_dias === 2 && item.prazo_max_dias === 2));
  assert.ok(coberturas.every((item) => item.metadados.prazo_padrao_horas === 48));
  assert.ok(coberturas.some((item) => item.uf === 'BA' && item.cidade_normalizada === null));
  assert.ok(coberturas.length > 200);
  assert.equal(tarifas.length, 9);
  assert.deepEqual(resumo.diagnostico_chaves.estados_cobertos, ['BA', 'PR', 'SC', 'SP']);
  assert.deepEqual(resumo.diagnostico_chaves.estados_com_cobertura_integral, ['BA']);
  assert.ok(resumo.diagnostico_chaves.pracas_oficiais_com_tarifa > 200);
  assert.equal(resumo.diagnostico_chaves.pracas_oficiais_sem_tarifa, 25);
  assert.equal(resumo.diagnostico_chaves.prazo_padrao_horas, 48);
  assert.equal(resumo.diagnostico_chaves.tdes_cidade_toda_aplicados, 1);
  assert.equal(resumo.diagnostico_chaves.tdes_faixa_cep_aplicados, 1);
  assert.equal(resumo.diagnostico_chaves.tdes_nao_vinculados.length, 1);
});
