const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularRomaneio,
  escolherCobertura,
  parseCurrencyBR,
  prepararResultadosCotacao,
  simularTransportadora
} = require('../utils/freteEngine');

test('calcula peso e cubagem do romaneio em centímetros', () => {
  const resultado = calcularRomaneio([
    { codigo: 'MAQ-1', quantidade: 2, altura: 100, largura: 80, profundidade: 60, peso_bruto: 90 }
  ]);
  assert.equal(resultado.peso_real_kg, 180);
  assert.equal(resultado.volume_m3, 0.96);
  assert.equal(resultado.volumes, 2);
});

test('bloqueia dimensões ausentes e provável mistura de unidade', () => {
  assert.throws(
    () => calcularRomaneio([{ codigo: 'FH240', quantidade: 1, altura: 1000, largura: 92, profundidade: 92, peso_bruto: 200 }]),
    (erro) => erro.code === 'PRODUTOS_INVALIDOS' && erro.detalhes[0].erros.some((msg) => msg.includes('confirme a unidade'))
  );
});

test('prioriza a menor faixa de CEP sobre cobertura genérica da cidade', () => {
  const cobertura = escolherCobertura([
    { id: 1, uf: 'SC', cidade: 'Florianópolis', cidade_normalizada: 'FLORIANOPOLIS', atendida: true },
    { id: 2, uf: 'SC', cep_inicio: 88000000, cep_fim: 88099999, atendida: true }
  ], { uf: 'SC', cidade: 'Florianópolis', cep: '88010-000' });
  assert.equal(cobertura.id, 2);
});

test('simula peso cubado, excedente e adicionais com memória detalhada', () => {
  const resultado = simularTransportadora({
    tabela: { status: 'ativa', fator_cubagem_kg_m3: 300 },
    destino: { uf: 'SC', cidade: 'Florianópolis', cep: '88010-000' },
    romaneio: { peso_real_kg: 180, volume_m3: 0.96 },
    valorMercadoria: 10000,
    coberturas: [{ id: 1, uf: 'SC', cidade_normalizada: 'FLORIANOPOLIS', codigo_regiao: 'SC-CAPITAL', prazo_min_dias: 2, prazo_max_dias: 3, atendida: true }],
    tarifas: [{ id: 7, codigo_regiao: 'SC-CAPITAL', peso_de_kg: 100, peso_ate_kg: 100, valor_base: 120, valor_kg_excedente: 0.8, peso_referencia_excedente_kg: 100 }],
    regras: [
      { codigo: 'ADV', nome: 'Ad valorem', tipo_calculo: 'percentual_mercadoria', valor: 0.003, valor_minimo: 12, ativo: true },
      { codigo: 'PED', nome: 'Pedágio', tipo_calculo: 'por_100kg', valor: 10, ativo: true }
    ]
  });
  assert.equal(resultado.peso_cubado_kg, 288);
  assert.equal(resultado.peso_cobravel_kg, 288);
  assert.equal(resultado.frete_peso, 270.4);
  assert.equal(resultado.adicionais, 60);
  assert.equal(resultado.valor_total, 330.4);
  assert.equal(resultado.prazo_max_dias, 3);
});

test('aceita cobertura por cidade quando a transportadora nao informa faixa de CEP', () => {
  const cobertura = escolherCobertura([
    { id: 3, uf: 'SC', cidade: 'Sao Jose', cidade_normalizada: 'SAO JOSE', cep_inicio: null, cep_fim: null, atendida: true }
  ], { uf: 'SC', cidade: 'Sao Jose', cep: '88101-000' });
  assert.equal(cobertura.id, 3);
});

test('calcula tabela em revisão somente quando solicitada como prévia técnica', () => {
  const entrada = {
    tabela: { status: 'em_revisao', fator_cubagem_kg_m3: 300 },
    destino: { uf: 'MT', cidade: 'Cuiabá' },
    romaneio: { peso_real_kg: 51, volume_m3: 0.23808 },
    valorMercadoria: 7000,
    coberturas: [{ id: 9, uf: 'MT', cidade_normalizada: 'CUIABA', codigo_regiao: 'CUIABA VARZEA GRANDE MT', atendida: true }],
    tarifas: [{ codigo_regiao: 'CUIABA VARZEA GRANDE MT', peso_de_kg: 50, peso_ate_kg: 75, valor_base: 120.8, ad_valorem_aliquota: 0.004, taxa_despacho: 30 }],
    regras: [
      { codigo: 'GRIS', nome: 'GRIS', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.0025, valor_minimo: 6.62, ativo: true },
      { codigo: 'PEDAGIO_MS_MT', nome: 'Pedágio MS/MT', tipo_calculo: 'por_100kg', valor: 6.62, condicoes: { ufs: ['MS', 'MT'] }, ativo: true },
      { codigo: 'TSO', nome: 'TSO', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.001, valor_minimo: 3.99, ativo: true }
    ]
  };
  const bloqueada = simularTransportadora(entrada);
  assert.equal(bloqueada.ok, false);
  const previa = simularTransportadora({ ...entrada, permitirRevisao: true });
  assert.equal(previa.ok, true);
  assert.equal(previa.homologado, false);
  assert.equal(previa.tipo_resultado, 'previa_em_revisao');
  assert.equal(previa.peso_cobravel_kg, 71.424);
  assert.equal(previa.valor_total, 209.92);
});

test('entende formatos monetarios brasileiros usados pelo Comercial', () => {
  assert.equal(parseCurrencyBR('12.000,00'), 12000);
  assert.equal(parseCurrencyBR('12000'), 12000);
  assert.equal(parseCurrencyBR('12000,00'), 12000);
  assert.equal(parseCurrencyBR('R$ 12.000,00'), 12000);
  assert.equal(parseCurrencyBR('12000.00'), 12000);
});

test('distingue destino atendido quando falta somente a tarifa principal', () => {
  const resultado = simularTransportadora({
    tabela: { status: 'em_revisao', fator_cubagem_kg_m3: 300 },
    permitirRevisao: true,
    destino: { uf: 'SC', cidade: 'Florianópolis' },
    romaneio: { peso_real_kg: 50, volume_m3: 0.2 },
    valorMercadoria: 7000,
    coberturas: [{ uf: 'SC', cidade_normalizada: 'FLORIANOPOLIS', codigo_regiao: 'UNIDADE_133' }],
    tarifas: [],
    regras: []
  });

  assert.equal(resultado.ok, false);
  assert.equal(resultado.tipo_resultado, 'cobertura_sem_tarifa');
  assert.equal(resultado.cobertura.codigo_regiao, 'UNIDADE_133');
  assert.match(resultado.motivo, /atende o destino/i);
});

test('calcula a previa EJL com minimo, ITR, ad valorem, GRIS e pedagio', () => {
  const resultado = simularTransportadora({
    tabela: { status: 'em_revisao', fator_cubagem_kg_m3: 300 },
    permitirRevisao: true,
    destino: { uf: 'SP', cidade: 'São Paulo', cep: '01001-000' },
    romaneio: { peso_real_kg: 51, volume_m3: 0.23808 },
    valorMercadoria: 7000,
    coberturas: [{ uf: 'SP', cidade_normalizada: 'SAO PAULO', codigo_regiao: 'EJL_SP_SAO_PAULO' }],
    tarifas: [{
      codigo_regiao: 'EJL_SP_SAO_PAULO', peso_de_kg: 0, peso_ate_kg: null,
      valor_base: 0, valor_kg_excedente: 0.6, peso_referencia_excedente_kg: 0,
      frete_minimo: 85, ad_valorem_aliquota: 0.004
    }],
    regras: [
      { codigo: 'GRIS', nome: 'GRIS', tipo_calculo: 'percentual_mercadoria', valor: 0.0015 },
      { codigo: 'PEDAGIO', nome: 'Pedágio', tipo_calculo: 'por_100kg', valor: 3.5 },
      { codigo: 'ITR_EJL_SP', nome: 'ITR', tipo_calculo: 'fixo', valor: 25, condicoes: { codigos_regiao: ['EJL_SP_SAO_PAULO'] } }
    ]
  });

  assert.equal(resultado.peso_cobravel_kg, 71.424);
  assert.equal(resultado.frete_peso, 85);
  assert.equal(resultado.valor_total, 152);
});

test('aplica TDE EJL apenas quando o CEP cai na faixa especifica', () => {
  const coberturas = [
    { id: 1, uf: 'SP', cidade_normalizada: 'SAO PAULO', codigo_regiao: 'EJL_SP_SAO_PAULO' },
    { id: 2, uf: 'SP', cidade_normalizada: 'SAO PAULO', codigo_regiao: 'EJL_SP_SAO_PAULO', cep_inicio: 4700000, cep_fim: 4999999, tde: 100 }
  ];
  assert.equal(escolherCobertura(coberturas, { uf: 'SP', cidade: 'São Paulo', cep: '04710-000' }).id, 2);
  assert.equal(escolherCobertura(coberturas, { uf: 'SP', cidade: 'São Paulo', cep: '01001-000' }).id, 1);
  assert.equal(escolherCobertura(coberturas, { uf: 'SP', cidade: 'São Paulo' }).id, 1);
});

test('calcula faixa Fitlog sem aplicar TDE ou TRT preventivamente', () => {
  const resultado = simularTransportadora({
    tabela: { status: 'em_revisao', fator_cubagem_kg_m3: 300 },
    permitirRevisao: true,
    destino: { uf: 'SP', cidade: 'São Paulo' },
    romaneio: { peso_real_kg: 51, volume_m3: 0.23808 },
    valorMercadoria: 7000,
    coberturas: [{ uf: 'SP', cidade_normalizada: 'SAO PAULO', codigo_regiao: 'FITLOG_SP_SAO_PAULO' }],
    tarifas: [{
      codigo_regiao: 'FITLOG_SP_SAO_PAULO', peso_de_kg: 70, peso_ate_kg: 100,
      valor_base: 57.63, taxa_despacho: 9.3, pedagio_por_100kg: 6.9
    }],
    regras: [
      { codigo: 'FRETE_VALOR', nome: 'Frete valor', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.003, valor_minimo: 5.3 },
      { codigo: 'GRIS', nome: 'GRIS', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.002, valor_minimo: 5.3 },
      { codigo: 'POS', nome: 'POS', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.0015, valor_minimo: 10 },
      { codigo: 'TAS', nome: 'TAS', tipo_calculo: 'fixo', valor: 5.05 }
    ]
  });

  assert.equal(resultado.frete_peso, 57.63);
  assert.equal(resultado.adicionais, 66.75);
  assert.equal(resultado.valor_total, 124.38);
  assert.equal(resultado.adicionais_detalhe.some((item) => ['TDE_COBERTURA', 'TRT_COBERTURA'].includes(item.codigo)), false);
});

test('calcula Mengue com adicionais declarados sem TDA e TRT preventivos', () => {
  const resultado = simularTransportadora({
    tabela: { status: 'em_revisao', fator_cubagem_kg_m3: 300 },
    permitirRevisao: true,
    destino: { uf: 'SC', cidade: 'Florianópolis' },
    romaneio: { peso_real_kg: 51, volume_m3: 0.23808 },
    valorMercadoria: 7000,
    coberturas: [{ uf: 'SC', cidade_normalizada: 'FLORIANOPOLIS', codigo_regiao: 'FLPP' }],
    tarifas: [{
      codigo_regiao: 'FLPP', peso_de_kg: 70, peso_ate_kg: 100,
      valor_base: 38.322, taxa_despacho: null, pedagio_por_100kg: 4.15608
    }],
    regras: [
      { codigo: 'GRIS_FLPP', nome: 'GRIS', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.0015, valor_minimo: 1.5, condicoes: { codigos_regiao: ['FLPP'] } },
      { codigo: 'ADV_FLPP', nome: 'Ad valorem', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.002, valor_minimo: 2.5, condicoes: { codigos_regiao: ['FLPP'] } },
      { codigo: 'POS_FLPP', nome: 'POS', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.0004, valor_minimo: 1.35, condicoes: { codigos_regiao: ['FLPP'] } },
      { codigo: 'TAS_FLPP', nome: 'TAS', tipo_calculo: 'fixo', valor: 3.2, condicoes: { codigos_regiao: ['FLPP'] } }
    ]
  });

  assert.equal(resultado.frete_peso, 38.32);
  assert.equal(resultado.adicionais, 34.66);
  assert.equal(resultado.valor_total, 72.98);
  assert.equal(resultado.adicionais_detalhe.some((item) => ['TDE_COBERTURA', 'TRT_COBERTURA'].includes(item.codigo)), false);
});

test('calcula a previa Rodonaves com a faixa do PDF atualizado', () => {
  const resultado = simularTransportadora({
    tabela: { status: 'em_revisao', fator_cubagem_kg_m3: 300 },
    permitirRevisao: true,
    destino: { uf: 'SC', cidade: 'Florianópolis' },
    romaneio: { peso_real_kg: 51, volume_m3: 0.23808 },
    valorMercadoria: 7000,
    coberturas: [{ uf: 'SC', cidade_normalizada: 'FLORIANOPOLIS', codigo_regiao: 'UNIDADE_133' }],
    tarifas: [{
      codigo_regiao: 'UNIDADE_133', uf_destino: 'SC', cidade_normalizada: 'FLORIANOPOLIS',
      peso_de_kg: 60, peso_ate_kg: 80, valor_base: 44.80
    }],
    regras: [
      { codigo: 'FRETE_VALOR', nome: 'Frete valor', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.005, valor_minimo: 12.98 },
      { codigo: 'GRIS_PADRAO_ATE_10K', nome: 'GRIS', tipo_calculo: 'maior_entre_percentual_e_minimo', valor: 0.001, valor_minimo: 1.74, condicoes: { codigos_regiao: ['UNIDADE_133'], valor_mercadoria_ate: 10000 } },
      { codigo: 'PEDAGIO', nome: 'Pedágio', tipo_calculo: 'por_100kg', valor: 13.97 }
    ]
  });

  assert.equal(resultado.peso_cobravel_kg, 71.424);
  assert.equal(resultado.frete_peso, 44.8);
  assert.equal(resultado.adicionais, 55.97);
  assert.equal(resultado.valor_total, 100.77);
});

test('prioriza SEC-CAT atual e acumula zona de risco sem duplicar o adicional', () => {
  const resultado = simularTransportadora({
    tabela: { status: 'em_revisao', fator_cubagem_kg_m3: 300 },
    permitirRevisao: true,
    destino: { uf: 'SC', cidade: 'Camboriú', cep: '88340-000' },
    romaneio: { peso_real_kg: 71, volume_m3: 0.1 },
    valorMercadoria: 1000,
    coberturas: [{ uf: 'SC', cidade_normalizada: 'CAMBORIU', codigo_regiao: 'UNIDADE_133' }],
    tarifas: [{ codigo_regiao: 'UNIDADE_133', peso_de_kg: 60, peso_ate_kg: 80, valor_base: 44.8 }],
    regras: [
      { codigo: 'SEC_CAT', nome: 'SEC-CAT', tipo_calculo: 'fixo', valor: 99, prioridade: 100 },
      { codigo: 'SEC_CAT', nome: 'SEC-CAT', tipo_calculo: 'fixo', valor: 25.71, prioridade: 10, condicoes: { peso_cobravel_maior_que: 60 } },
      { codigo: 'ZONA_RISCO', nome: 'Zona de risco', tipo_calculo: 'fixo', valor: 72.98, prioridade: 20 }
    ]
  });

  assert.deepEqual(resultado.adicionais_detalhe.map((item) => item.codigo), ['SEC_CAT', 'ZONA_RISCO']);
  assert.equal(resultado.adicionais, 98.69);
  assert.equal(resultado.valor_total, 143.49);
});

test('seleciona uma unica faixa de zona de restricao pelo peso cobravel', () => {
  const criar = (peso) => simularTransportadora({
    tabela: { status: 'ativa', fator_cubagem_kg_m3: 300 },
    destino: { uf: 'SP', cidade: 'São Paulo', cep: '01526-000' },
    romaneio: { peso_real_kg: peso, volume_m3: 0 },
    coberturas: [{ uf: 'SP', cidade_normalizada: 'SAO PAULO', codigo_regiao: 'CAPITAL_SP' }],
    tarifas: [{ codigo_regiao: 'CAPITAL_SP', peso_de_kg: 0, peso_ate_kg: null, valor_base: 100 }],
    regras: [
      { codigo: 'ZONA_RESTRICAO', nome: 'Zona de restrição', tipo_calculo: 'fixo', valor: 289.95, prioridade: 20, condicoes: { peso_cobravel_maior_que: 500, peso_cobravel_ate: 1000 } },
      { codigo: 'ZONA_RESTRICAO', nome: 'Zona de restrição', tipo_calculo: 'fixo', valor: 571.64, prioridade: 20, condicoes: { peso_cobravel_maior_que: 1000, peso_cobravel_ate: 1500 } }
    ]
  });

  assert.equal(criar(1000).adicionais, 289.95);
  assert.equal(criar(1000.5).adicionais, 571.64);
});

test('preserva o id da tabela ao preparar a cotacao para o historico', () => {
  const [resultado] = prepararResultadosCotacao([
    {
      ok: true,
      tabela_id: '78407',
      cobertura: { id: '94' },
      transportadora: 'Fitlog',
      valor_total: 130.81
    },
    { ok: false, tabela_id: '99999', motivo: 'Destino nÃ£o atendido.' }
  ]);

  assert.equal(resultado.tabela_preco_id, '78407');
  assert.equal(resultado.cobertura_id, '94');
  assert.equal(resultado.memoria_calculo.tabela_id, '78407');
});
