const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularRomaneio, escolherCobertura, simularTransportadora } = require('../utils/freteEngine');

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
