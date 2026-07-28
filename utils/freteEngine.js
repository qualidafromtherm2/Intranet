const DEFAULT_MAX_DIMENSION_CM = 500;

function numero(valor, fallback = 0) {
  const parsed = Number(valor);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arredondar(valor, casas = 2) {
  const fator = 10 ** casas;
  return Math.round((numero(valor) + Number.EPSILON) * fator) / fator;
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizarCep(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(digitos)) return null;
  return Number(digitos);
}

function validarItem(item, opts = {}) {
  const codigo = String(item?.codigo || '').trim();
  const quantidade = numero(item?.quantidade);
  const altura = numero(item?.altura_cm ?? item?.altura);
  const largura = numero(item?.largura_cm ?? item?.largura);
  const profundidade = numero(item?.profundidade_cm ?? item?.profundidade);
  const peso = numero(item?.peso_unitario_kg ?? item?.peso_bruto ?? item?.peso_liq);
  const limite = numero(opts.maxDimensionCm, DEFAULT_MAX_DIMENSION_CM);
  const erros = [];

  if (!codigo) erros.push('Produto sem código.');
  if (!(quantidade > 0)) erros.push('Quantidade deve ser maior que zero.');
  if (!(altura > 0 && largura > 0 && profundidade > 0)) erros.push('Dimensões incompletas.');
  if (altura > limite || largura > limite || profundidade > limite) {
    erros.push(`Dimensão acima de ${limite} cm; confirme a unidade cadastrada.`);
  }
  if (!(peso > 0)) erros.push('Peso não informado.');

  return {
    ok: erros.length === 0,
    erros,
    item: { ...item, codigo, quantidade, altura_cm: altura, largura_cm: largura, profundidade_cm: profundidade, peso_unitario_kg: peso }
  };
}

function calcularRomaneio(itens, opts = {}) {
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) {
    const erro = new Error('Adicione ao menos um produto para simular o frete.');
    erro.code = 'ITENS_VAZIOS';
    throw erro;
  }

  const validados = lista.map((item) => validarItem(item, opts));
  const invalidos = validados.filter((item) => !item.ok);
  if (invalidos.length) {
    const erro = new Error('Existem produtos sem peso ou dimensões confiáveis.');
    erro.code = 'PRODUTOS_INVALIDOS';
    erro.detalhes = invalidos.map(({ item, erros }) => ({ codigo: item.codigo, erros }));
    throw erro;
  }

  const itensCalculados = validados.map(({ item }) => {
    const volumeUnitarioM3 = (item.altura_cm * item.largura_cm * item.profundidade_cm) / 1_000_000;
    return {
      ...item,
      volume_unitario_m3: arredondar(volumeUnitarioM3, 6),
      volume_total_m3: arredondar(volumeUnitarioM3 * item.quantidade, 6),
      peso_total_kg: arredondar(item.peso_unitario_kg * item.quantidade, 4)
    };
  });

  return {
    itens: itensCalculados,
    volumes: itensCalculados.reduce((total, item) => total + item.quantidade, 0),
    peso_real_kg: arredondar(itensCalculados.reduce((total, item) => total + item.peso_total_kg, 0), 4),
    volume_m3: arredondar(itensCalculados.reduce((total, item) => total + item.volume_total_m3, 0), 6)
  };
}

function coberturaAtende(cobertura, destino) {
  if (cobertura?.atendida === false) return false;
  const uf = String(destino?.uf || '').trim().toUpperCase();
  if (String(cobertura?.uf || '').trim().toUpperCase() !== uf) return false;
  const cep = normalizarCep(destino?.cep);
  const temFaixaCep = cobertura?.cep_inicio != null && cobertura?.cep_fim != null;
  const inicio = temFaixaCep ? numero(cobertura.cep_inicio, NaN) : NaN;
  const fim = temFaixaCep ? numero(cobertura.cep_fim, NaN) : NaN;
  if (cep && Number.isFinite(inicio) && Number.isFinite(fim)) return cep >= inicio && cep <= fim;
  if (cobertura?.cidade_normalizada || cobertura?.cidade) {
    return normalizarTexto(cobertura.cidade_normalizada || cobertura.cidade) === normalizarTexto(destino?.cidade);
  }
  return true;
}

function escolherCobertura(coberturas, destino) {
  const candidatas = (Array.isArray(coberturas) ? coberturas : []).filter((item) => coberturaAtende(item, destino));
  return candidatas.sort((a, b) => {
    const aCep = a.cep_inicio != null && a.cep_fim != null;
    const bCep = b.cep_inicio != null && b.cep_fim != null;
    if (aCep !== bCep) return aCep ? -1 : 1;
    const aAmplitude = aCep ? numero(a.cep_fim) - numero(a.cep_inicio) : Number.MAX_SAFE_INTEGER;
    const bAmplitude = bCep ? numero(b.cep_fim) - numero(b.cep_inicio) : Number.MAX_SAFE_INTEGER;
    return aAmplitude - bAmplitude;
  })[0] || null;
}

function tarifaCompativel(tarifa, cobertura, destino) {
  if (tarifa?.codigo_regiao && tarifa.codigo_regiao !== cobertura?.codigo_regiao) return false;
  if (tarifa?.uf_destino && String(tarifa.uf_destino).toUpperCase() !== String(destino?.uf || '').toUpperCase()) return false;
  if (tarifa?.cidade_normalizada && normalizarTexto(tarifa.cidade_normalizada) !== normalizarTexto(destino?.cidade)) return false;
  return true;
}

function escolherTarifa(tarifas, cobertura, destino, pesoCobravelKg) {
  const peso = numero(pesoCobravelKg);
  const candidatas = (Array.isArray(tarifas) ? tarifas : [])
    .filter((item) => tarifaCompativel(item, cobertura, destino))
    .sort((a, b) => numero(a.prioridade, 100) - numero(b.prioridade, 100) || numero(a.peso_de_kg) - numero(b.peso_de_kg));

  const naFaixa = candidatas.find((item) => {
    const de = numero(item.peso_de_kg);
    const ate = item.peso_ate_kg == null ? Infinity : numero(item.peso_ate_kg);
    return peso >= de && peso <= ate;
  });
  if (naFaixa) return naFaixa;

  return candidatas
    .filter((item) => item.valor_kg_excedente != null && peso > numero(item.peso_ate_kg ?? item.peso_referencia_excedente_kg))
    .sort((a, b) => numero(b.peso_ate_kg ?? b.peso_referencia_excedente_kg) - numero(a.peso_ate_kg ?? a.peso_referencia_excedente_kg))[0] || null;
}

function calcularFretePeso(tarifa, pesoCobravelKg) {
  const peso = numero(pesoCobravelKg);
  let valor = numero(tarifa?.valor_base);
  const referencia = numero(tarifa?.peso_referencia_excedente_kg ?? tarifa?.peso_ate_kg, NaN);
  if (tarifa?.valor_kg_excedente != null && Number.isFinite(referencia) && peso > referencia) {
    valor += (peso - referencia) * numero(tarifa.valor_kg_excedente);
  }
  valor = Math.max(valor, numero(tarifa?.frete_minimo));
  return arredondar(valor, 2);
}

function condicaoAtende(condicoes, contexto) {
  const c = condicoes && typeof condicoes === 'object' ? condicoes : {};
  if (Array.isArray(c.ufs) && !c.ufs.map((uf) => String(uf).toUpperCase()).includes(String(contexto.destino?.uf || '').toUpperCase())) return false;
  if (Array.isArray(c.codigos_regiao) && !c.codigos_regiao.includes(contexto.cobertura?.codigo_regiao)) return false;
  if (c.valor_mercadoria_de != null && contexto.valorMercadoria < numero(c.valor_mercadoria_de)) return false;
  if (c.valor_mercadoria_ate != null && contexto.valorMercadoria > numero(c.valor_mercadoria_ate)) return false;
  if (c.metadado_cobertura) {
    const meta = contexto.cobertura?.metadados || {};
    if (!Object.entries(c.metadado_cobertura).every(([chave, valor]) => meta[chave] === valor)) return false;
  }
  return true;
}

function calcularRegra(regra, contexto) {
  const valor = numero(regra.valor);
  let calculado = 0;
  switch (regra.tipo_calculo) {
    case 'fixo': calculado = valor; break;
    case 'percentual_mercadoria': calculado = contexto.valorMercadoria * valor; break;
    case 'percentual_frete': calculado = contexto.fretePeso * valor; break;
    case 'por_100kg': calculado = Math.ceil(contexto.pesoCobravelKg / 100) * valor; break;
    case 'por_kg': calculado = contexto.pesoCobravelKg * valor; break;
    case 'maior_entre_percentual_e_minimo': calculado = contexto.valorMercadoria * valor; break;
    default: throw new Error(`Tipo de cálculo de adicional não suportado: ${regra.tipo_calculo}`);
  }
  calculado = Math.max(calculado, numero(regra.valor_minimo));
  if (regra.valor_maximo != null) calculado = Math.min(calculado, numero(regra.valor_maximo));
  return arredondar(calculado, 2);
}

function simularTransportadora({ tabela, coberturas, tarifas, regras, destino, romaneio, valorMercadoria = 0 }) {
  if (tabela?.status !== 'ativa') return { ok: false, motivo: 'Tabela ainda não está ativa para cotação.' };
  const cobertura = escolherCobertura(coberturas, destino);
  if (!cobertura) return { ok: false, motivo: 'Destino não atendido pela tabela.' };

  const fatorCubagem = numero(tabela.fator_cubagem_kg_m3, 300);
  const pesoCubadoKg = arredondar(romaneio.volume_m3 * fatorCubagem, 4);
  const pesoCobravelKg = Math.max(numero(romaneio.peso_real_kg), pesoCubadoKg);
  const tarifa = escolherTarifa(tarifas, cobertura, destino, pesoCobravelKg);
  if (!tarifa) return { ok: false, motivo: 'Não existe faixa de tarifa validada para este peso e destino.' };

  const fretePeso = calcularFretePeso(tarifa, pesoCobravelKg);
  const contexto = { destino, cobertura, fretePeso, pesoCobravelKg, valorMercadoria: numero(valorMercadoria) };
  const adicionaisDetalhe = (Array.isArray(regras) ? regras : [])
    .filter((regra) => regra.ativo !== false && condicaoAtende(regra.condicoes, contexto))
    .sort((a, b) => numero(a.prioridade, 100) - numero(b.prioridade, 100))
    .map((regra) => ({ codigo: regra.codigo, nome: regra.nome, valor: calcularRegra(regra, contexto) }));

  if (numero(tarifa.ad_valorem_aliquota) > 0 && !adicionaisDetalhe.some((item) => item.codigo === 'ADV')) {
    adicionaisDetalhe.push({
      codigo: 'ADV_TARIFA',
      nome: 'Ad valorem',
      valor: arredondar(contexto.valorMercadoria * numero(tarifa.ad_valorem_aliquota), 2)
    });
  }
  if (numero(tarifa.taxa_despacho) > 0 && !adicionaisDetalhe.some((item) => item.codigo === 'DESPACHO')) {
    adicionaisDetalhe.push({ codigo: 'DESPACHO_TARIFA', nome: 'Taxa de despacho/CT-e', valor: arredondar(tarifa.taxa_despacho, 2) });
  }
  if (numero(tarifa.pedagio_por_100kg) > 0 && !adicionaisDetalhe.some((item) => item.codigo === 'PEDAGIO')) {
    adicionaisDetalhe.push({
      codigo: 'PEDAGIO_TARIFA',
      nome: 'Pedágio',
      valor: arredondar(Math.ceil(contexto.pesoCobravelKg / 100) * numero(tarifa.pedagio_por_100kg), 2)
    });
  }

  if (numero(cobertura.tde) > 0) adicionaisDetalhe.push({ codigo: 'TDE_COBERTURA', nome: 'Taxa de dificuldade de entrega', valor: arredondar(cobertura.tde, 2) });
  if (numero(cobertura.trt) > 0) adicionaisDetalhe.push({ codigo: 'TRT_COBERTURA', nome: 'Taxa de restrição de trânsito', valor: arredondar(cobertura.trt, 2) });
  const adicionais = arredondar(adicionaisDetalhe.reduce((total, item) => total + item.valor, 0), 2);

  return {
    ok: true,
    cobertura,
    tarifa,
    peso_cubado_kg: pesoCubadoKg,
    peso_cobravel_kg: arredondar(pesoCobravelKg, 4),
    frete_peso: fretePeso,
    adicionais,
    adicionais_detalhe: adicionaisDetalhe,
    valor_total: arredondar(fretePeso + adicionais, 2),
    prazo_min_dias: cobertura.prazo_min_dias ?? null,
    prazo_max_dias: cobertura.prazo_max_dias ?? cobertura.prazo_min_dias ?? null
  };
}

module.exports = {
  arredondar,
  normalizarTexto,
  normalizarCep,
  validarItem,
  calcularRomaneio,
  escolherCobertura,
  escolherTarifa,
  calcularFretePeso,
  simularTransportadora
};
