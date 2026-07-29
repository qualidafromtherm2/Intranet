const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarSaoMiguel } = require('../scripts/importar_tabelas_frete');
const { SAO_MIGUEL_CONTRATO } = require('../scripts/dados/sao_miguel_tarifas');

test('normaliza cobertura, tarifas e regras auditadas da Expresso São Miguel', async () => {
  const chamadas = [];
  const client = {
    async query(sql, params) {
      chamadas.push({ sql, params });
      return { rows: [] };
    }
  };
  const grupos = [{
    aba: 'Comercial - Localidades Atendid',
    linhas: [
      { numero_linha: 2, dados: { A: 'BIGUACU', B: 'Agudos', C: 'SP', D: 'SP1', E: 'EK', F: 'BAU', G: 3500709, H: '17120-000', I: '17120-000', J: '17129-999', K: 'X', M: 'X', P: '2 dias', Q: 2, R: 3 } },
      { numero_linha: 3, dados: { A: 'BIGUACU', B: 'Águas de São Pedro', C: 'SP', D: 'SP2', E: 'ZZ', F: 'SAO', G: 3500600, H: '13525-000', I: '13525-000', J: '13529-999', L: 'X', Q: 4, R: 5 } }
    ]
  }];
  const fontesAuxiliares = [
    {
      fonte: { sufixo: 'tarifa' },
      sha: SAO_MIGUEL_CONTRATO.sha256,
      grupos: [{ aba: 'PDF', linhas: [{ numero_linha: 1, dados: { texto: 'Contrato 136588/2026 SP1 PR1 SC1 RS1' } }] }]
    },
    { fonte: { sufixo: 'tda' }, grupos: [{ linhas: [{}, {}, {}] }] },
    { fonte: { sufixo: 'tde' }, grupos: [{ linhas: [{}, {}] }] }
  ];

  const resumo = await normalizarSaoMiguel(client, 12, grupos, fontesAuxiliares);
  const coberturaCall = chamadas.find((item) => item.sql.includes('INSERT INTO frete.cobertura'));
  const tarifaCall = chamadas.find((item) => item.sql.includes('INSERT INTO frete.tarifa_faixa'));
  const regraCall = chamadas.find((item) => item.sql.includes('INSERT INTO frete.regra_adicional'));
  const updateCall = chamadas.find((item) => item.sql.includes('UPDATE frete.tabela_preco'));
  const coberturas = JSON.parse(coberturaCall.params[1]);
  const tarifas = JSON.parse(tarifaCall.params[1]);
  const regras = JSON.parse(regraCall.params[1]);

  assert.equal(coberturas.length, 2);
  assert.equal(coberturas[0].codigo_regiao, 'SAO_MIGUEL_SP1');
  assert.equal(coberturas[0].frequencia, 'SEG, QUA');
  assert.equal(coberturas[0].cep_inicio, 17120000);
  assert.equal(tarifas.length, 23);
  const sp1 = tarifas.find((item) => item.codigo_regiao === 'SAO_MIGUEL_SP1');
  assert.equal(sp1.frete_minimo, 65.57);
  assert.equal(sp1.valor_excedente, 1.052);
  assert.equal(sp1.pedagio, 3.47);
  assert.deepEqual(regras.map((item) => item.codigo), ['GRIS', 'TAS']);
  assert.equal(updateCall.params[6].includes('cubagem_isenta_ate_m3'), true);
  assert.deepEqual(resumo.regioes_sem_tarifa, ['SP2']);
  assert.equal(resumo.contrato_pdf_conferido, true);
  assert.deepEqual(resumo.linhas_auxiliares, { TDA: 2, TDE: 1 });
});

test('não importa preços quando o PDF não corresponde ao contrato auditado', async () => {
  const chamadas = [];
  const client = { async query(sql, params) { chamadas.push({ sql, params }); return { rows: [] }; } };
  const grupos = [{
    aba: 'Comercial - Localidades Atendid',
    linhas: [{ numero_linha: 2, dados: { A: 'BIGUACU', B: 'Agudos', C: 'SP', D: 'SP1' } }]
  }];
  const resumo = await normalizarSaoMiguel(client, 12, grupos, [{
    fonte: { sufixo: 'tarifa' }, sha: 'incorreto', grupos: [{ linhas: [{ dados: { texto: '136588/2026 SP1' } }] }]
  }]);
  assert.equal(chamadas.some((item) => item.sql.includes('INSERT INTO frete.tarifa_faixa')), false);
  assert.equal(resumo.faixas, 0);
  assert.equal(resumo.contrato_pdf_conferido, false);
});
