const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularRomaneio, escolherCobertura, parseCurrencyBR, simularTransportadora } = require('../utils/freteEngine');

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
