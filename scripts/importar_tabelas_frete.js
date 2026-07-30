#!/usr/bin/env node
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');
const { normalizarTexto } = require('../utils/freteEngine');
const {
  EJL_PRACAS_OFICIAIS,
  FONTE_EJL_PRACAS,
  FONTE_EJL_PRACAS_CONSULTADA_EM
} = require('./dados/ejl_pracas_oficiais');
const { SAO_MIGUEL_CONTRATO, SAO_MIGUEL_TARIFAS } = require('./dados/sao_miguel_tarifas');

const args = process.argv.slice(2);
const valorArg = (nome) => {
  const prefixo = `${nome}=`;
  const inline = args.find((arg) => arg.startsWith(prefixo));
  if (inline) return inline.slice(prefixo.length);
  const indice = args.indexOf(nome);
  return indice >= 0 ? args[indice + 1] : null;
};
const aplicar = args.includes('--apply');
const diretorio = path.resolve(valorArg('--dir') || process.env.FRETE_TABELAS_DIR || '');

const FONTES = [
  {
    arquivo: 'EXPRESSO SAO MIGUEL BIGUACU- Localidades Atendidas e Previsão de Entrega (1).xls',
    slug: 'expresso-sao-miguel', nome: 'Expresso São Miguel',
    abas: ['Comercial - Localidades Atendid']
  },
  {
    arquivo: 'TABELA EXPRESSO SAO MIGUEL.pdf', slug: 'expresso-sao-miguel',
    nome: 'Expresso São Miguel', tipo: 'pdf', sufixo: 'tarifa', status: 'inativa',
    finalidade: 'Tarifa principal, generalidades e regras incorporadas à tabela de cobertura.'
  },
  {
    arquivo: 'EXPRESSO SAO MIGUEL 2026 TDA 07 14.xls', slug: 'expresso-sao-miguel',
    nome: 'Expresso São Miguel', abas: ['TAXAS - RELATÓRIO EXTERNO'], sufixo: 'tda', status: 'inativa',
    finalidade: 'Relação de TDA por destinatário/CNPJ preservada para consulta, sem aplicação preventiva.'
  },
  {
    arquivo: 'EXPRESSO SAO MIGUEL 2026 TDE 07 14.xls', slug: 'expresso-sao-miguel',
    nome: 'Expresso São Miguel', abas: ['TAXAS - RELATÓRIO EXTERNO'], sufixo: 'tde', status: 'inativa',
    finalidade: 'Relação de TDE por destinatário/CNPJ preservada para consulta, sem aplicação preventiva.'
  },
  {
    arquivo: 'EXPRESSO SAO MIGUEL 2026 TDC 07 14.xls', slug: 'expresso-sao-miguel',
    nome: 'Expresso São Miguel', abas: ['TAXAS - RELATÓRIO EXTERNO'], sufixo: 'tdc', status: 'inativa',
    finalidade: 'Relação de TDC por destinatário/CNPJ preservada para consulta, sem aplicação preventiva.'
  },
  {
    arquivo: 'EXPRESSO SAO MIGUEL 2026 TVD 14 07.xls', slug: 'expresso-sao-miguel',
    nome: 'Expresso São Miguel', abas: ['TAXAS - RELATÓRIO EXTERNO'], sufixo: 'tvd', status: 'inativa',
    finalidade: 'Relação de TVD por destinatário/CNPJ preservada para consulta, sem aplicação preventiva.'
  },
  { arquivo: 'EXPRESSO EJL.xlsx', slug: 'expresso-ejl', nome: 'Expresso EJL', abas: ['Planilha1'] },
  { arquivo: 'RELAÇÃO DE TDE EXPRESSO EJL.xlsx', slug: 'expresso-ejl', nome: 'Expresso EJL', abas: ['Planilha1'], sufixo: 'tde', status: 'inativa' },
  { arquivo: 'TABELA FITLOG - ATUAL.xlsx', slug: 'fitlog', nome: 'Fitlog', abas: ['DADOS', 'PADRÃO', 'GENERALIDADES', 'PRAÇA', 'TABELA', 'TARIFA POR CIDADE', 'SSW-PROVISÓRIO'] },
  {
    arquivo: 'fitlog RELAÇÃO DE PRAÇAS E PRAZOS - GERAL - 13ABR26.xlsx',
    slug: 'fitlog', nome: 'Fitlog', abas: ['FIT'], sufixo: 'prazos', status: 'inativa',
    finalidade: 'Cobertura, frequência e prazos da unidade FLN/Palhoça incorporados à tabela principal.'
  },
  { arquivo: 'TABELA FROMTHERM BRISTOT ROCHA.xlsx', slug: 'bristot-rocha', nome: 'Bristot Rocha', abas: ['Tarifas', 'Cidades Prazos x Classificação', 'Generalidades'] },
  { arquivo: 'TABELA FROMTHERM X MENGUE EXPRESS.xlsx', slug: 'mengue-express', nome: 'Mengue Express', abas: ['TABELA MENGUE SSW', 'BD CIDADE+PRAÇA+TAXAS+FREQ+PREV'] },
  { arquivo: 'TABELA RODONAVES - DESATUALIZADA.xlsm', slug: 'rodonaves', nome: 'Rodonaves', abas: ['Proposta SUL-SUD-CO-AC & RO', 'Lista de Tarifas Valor-OCULTAR', 'Tarifas Cidade Coleta-Entrega', 'CEPS Zona de Restrição - SP', 'CEPS Zona de Risco - SP', 'Planilha7'] },
  { arquivo: 'TABELA FROMTHERM ATUALIZADA.pdf', slug: 'rodonaves', nome: 'Rodonaves', tipo: 'pdf', sufixo: 'pdf-atualizado' }
];

function hashArquivo(caminho) {
  return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex');
}

function valorJson(valor) {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'number' && !Number.isFinite(valor)) return null;
  return valor ?? null;
}

function linhasDaAba(workbook, nomeAba) {
  const sheet = workbook.Sheets[nomeAba];
  if (!sheet?.['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const linhas = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const dados = {};
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null || cell.v === '') continue;
      dados[XLSX.utils.encode_col(c)] = valorJson(cell.v);
    }
    if (Object.keys(dados).length) linhas.push({ numero_linha: r + 1, dados });
  }
  return linhas;
}

async function extrairFonte(fonte, caminho) {
  if (fonte.tipo === 'pdf') {
    const parsed = await pdfParse(fs.readFileSync(caminho));
    return [{
      aba: 'PDF',
      linhas: String(parsed.text || '').split(/\r?\n/).map((texto, indice) => ({ numero_linha: indice + 1, dados: { texto: texto.trim() } })).filter((linha) => linha.dados.texto)
    }];
  }
  const workbook = XLSX.readFile(caminho, { cellDates: true, cellFormula: true, cellNF: false, cellText: false });
  return fonte.abas.filter((aba) => workbook.Sheets[aba]).map((aba) => ({ aba, linhas: linhasDaAba(workbook, aba) }));
}

function analisar(fonte, caminho, grupos) {
  const total = grupos.reduce((acc, grupo) => acc + grupo.linhas.length, 0);
  return {
    arquivo: fonte.arquivo,
    transportadora: fonte.nome,
    bytes: fs.statSync(caminho).size,
    abas: grupos.map((grupo) => ({ nome: grupo.aba, linhas: grupo.linhas.length })),
    total_linhas: total
  };
}

async function inserirLinhas(client, importacaoId, grupos) {
  const linhas = grupos.flatMap((grupo) => grupo.linhas.map((linha) => ({
    aba: grupo.aba,
    numero_linha: linha.numero_linha,
    dados: linha.dados
  })));
  const tamanhoLote = 500;
  for (let inicio = 0; inicio < linhas.length; inicio += tamanhoLote) {
    const lote = linhas.slice(inicio, inicio + tamanhoLote);
    await client.query(`
      INSERT INTO frete.importacao_linha (importacao_id, aba, numero_linha, dados)
      SELECT $1, item.aba, item.numero_linha, item.dados
      FROM jsonb_to_recordset($2::jsonb) AS item(aba TEXT, numero_linha INTEGER, dados JSONB)
      ON CONFLICT (importacao_id, aba, numero_linha) DO UPDATE SET dados = EXCLUDED.dados
    `, [importacaoId, JSON.stringify(lote)]);
  }
  return linhas.length;
}

function celula(linha, coluna) {
  return linha?.dados?.[coluna];
}

const ALIASES_CLASSIFICACAO_BRISTOT = new Map([
  ['INTERIOR 1 MS', 'INTERIOR MS 1 R'],
  ['INTERIOR 2 MS', 'INTERIOR MS 2 I'],
  ['INTERIOR 1 MT', 'INTERIOR MT 1 R'],
  ['INTERIOR 2 MT', 'INTERIOR MT 2 I'],
  ['INTERIOR 1 RO', 'INTERIOR RO 1 R'],
  ['INTERIOR 2 RO', 'INTERIOR RO 2 I']
]);

function normalizarClassificacaoBristot(valor) {
  const normalizada = normalizarTexto(valor);
  return ALIASES_CLASSIFICACAO_BRISTOT.get(normalizada) || normalizada;
}

async function normalizarBristot(client, tabelaId, grupos) {
  const coberturaGrupo = grupos.find((grupo) => grupo.aba === 'Cidades Prazos x Classificação');
  const tarifaGrupo = grupos.find((grupo) => grupo.aba === 'Tarifas');
  if (!coberturaGrupo || !tarifaGrupo) return { coberturas: 0, faixas: 0, alertas: ['Abas obrigatórias da Bristot ausentes.'] };
  let ufOrigem = null;
  let cidadeOrigem = null;
  let ibgeOrigem = null;
  const coberturaDados = [];
  const classificacoesCobertura = new Set();
  const classificacoesPorCidade = new Map();
  let coberturasSemClassificacao = 0;
  for (const linha of coberturaGrupo.linhas.filter((item) => item.numero_linha >= 2)) {
    ufOrigem = celula(linha, 'A') || ufOrigem;
    cidadeOrigem = celula(linha, 'B') || cidadeOrigem;
    ibgeOrigem = celula(linha, 'C') || ibgeOrigem;
    const uf = String(celula(linha, 'D') || '').trim().toUpperCase();
    const cidade = String(celula(linha, 'E') || '').trim();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade) continue;
    const classificacaoOriginal = celula(linha, 'J');
    const codigoRegiao = normalizarClassificacaoBristot(classificacaoOriginal);
    if (!codigoRegiao) {
      coberturasSemClassificacao += 1;
      continue;
    }
    classificacoesCobertura.add(codigoRegiao);
    const chaveCidade = `${uf}|${normalizarTexto(cidade)}`;
    if (!classificacoesPorCidade.has(chaveCidade)) classificacoesPorCidade.set(chaveCidade, new Set());
    classificacoesPorCidade.get(chaveCidade).add(codigoRegiao);
    coberturaDados.push({
      codigo_regiao: codigoRegiao, uf, cidade, cidade_normalizada: normalizarTexto(cidade),
      codigo_ibge: Number(celula(linha, 'F')) || null, prazo: Number(celula(linha, 'H')) || null,
      tde: Number(celula(linha, 'I')) || null,
      metadados: { uf_origem: ufOrigem, cidade_origem: cidadeOrigem, codigo_ibge_origem: ibgeOrigem, distancia_km: celula(linha, 'G'), classificacao_original: classificacaoOriginal }
    });
  }
  if (coberturaDados.length) await client.query(`
    INSERT INTO frete.cobertura (
      tabela_preco_id, codigo_regiao, uf, cidade, cidade_normalizada, codigo_ibge,
      prazo_min_dias, prazo_max_dias, tde, metadados
    )
    SELECT $1, x.codigo_regiao, x.uf, x.cidade, x.cidade_normalizada, x.codigo_ibge,
           x.prazo, x.prazo, x.tde, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade TEXT, cidade_normalizada TEXT, codigo_ibge BIGINT,
      prazo INTEGER, tde NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(coberturaDados)]);

  const limites = [10, 20, 30, 40, 50, 75, 100];
  const colunas = ['D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const faixaDados = [];
  const classificacoesTarifa = new Set();
  for (const linha of tarifaGrupo.linhas.filter((item) => item.numero_linha >= 9)) {
    const classificacaoOriginal = celula(linha, 'C') || celula(linha, 'B');
    const codigoRegiao = normalizarClassificacaoBristot(classificacaoOriginal);
    if (!codigoRegiao) continue;
    const adValorem = Number(celula(linha, 'L')) || null;
    const despacho = Number(celula(linha, 'M')) || null;
    let anterior = 0;
    let possuiFaixa = false;
    for (let i = 0; i < colunas.length; i += 1) {
      const valor = Number(celula(linha, colunas[i]));
      if (!(valor >= 0)) continue;
      possuiFaixa = true;
      faixaDados.push({ codigo_regiao: codigoRegiao, peso_de: anterior, peso_ate: limites[i], valor_base: valor,
        valor_excedente: null, peso_referencia: null, ad_valorem: adValorem, despacho,
        metadados: { arquivo_linha: linha.numero_linha, classificacao_original: classificacaoOriginal } });
      anterior = limites[i];
    }
    const excedente = Number(celula(linha, 'K'));
    const valor100 = Number(celula(linha, 'J'));
    if (excedente > 0 && valor100 >= 0) {
      possuiFaixa = true;
      faixaDados.push({ codigo_regiao: codigoRegiao, peso_de: 100, peso_ate: null, valor_base: valor100,
        valor_excedente: excedente, peso_referencia: 100, ad_valorem: adValorem, despacho,
        metadados: { arquivo_linha: linha.numero_linha, classificacao_original: classificacaoOriginal, excedente: true } });
    }
    if (possuiFaixa) classificacoesTarifa.add(codigoRegiao);
  }
  if (faixaDados.length) await client.query(`
    INSERT INTO frete.tarifa_faixa (
      tabela_preco_id, codigo_regiao, peso_de_kg, peso_ate_kg, valor_base,
      valor_kg_excedente, peso_referencia_excedente_kg, ad_valorem_aliquota,
      taxa_despacho, prioridade, metadados
    )
    SELECT $1, x.codigo_regiao, x.peso_de, x.peso_ate, x.valor_base,
           x.valor_excedente, x.peso_referencia, x.ad_valorem, x.despacho, 100, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, peso_de NUMERIC, peso_ate NUMERIC, valor_base NUMERIC,
      valor_excedente NUMERIC, peso_referencia NUMERIC, ad_valorem NUMERIC,
      despacho NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(faixaDados)]);
  const regrasDados = [
    { codigo: 'GRIS', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.0025, minimo: 6.62, condicoes: {}, prioridade: 20, observacao: '0,25% sobre o valor mercantil, mínimo de R$ 6,62.' },
    { codigo: 'PEDAGIO_MS_MT', nome: 'Pedágio MS/MT', tipo: 'por_100kg', valor: 6.62, minimo: null, condicoes: { ufs: ['MS', 'MT'] }, prioridade: 30, observacao: 'R$ 6,62 por fração de 100 kg.' },
    { codigo: 'PEDAGIO_RO_AC', nome: 'Pedágio RO/AC', tipo: 'por_100kg', valor: 9.93, minimo: null, condicoes: { ufs: ['RO', 'AC'] }, prioridade: 30, observacao: 'R$ 9,93 por fração de 100 kg.' },
    { codigo: 'TSO', nome: 'Taxa de seguro operacional', tipo: 'maior_entre_percentual_e_minimo', valor: 0.001, minimo: 3.99, condicoes: {}, prioridade: 40, observacao: '0,10% sobre o valor mercantil, mínimo de R$ 3,99.' }
  ];
  await client.query(`
    INSERT INTO frete.regra_adicional (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, valor_minimo,
      condicoes, prioridade, ativo, observacao
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.minimo,
           x.condicoes, x.prioridade, TRUE, x.observacao
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, minimo NUMERIC,
      condicoes JSONB, prioridade INTEGER, observacao TEXT
    )
  `, [tabelaId, JSON.stringify(regrasDados)]);
  const classificacoesSemTarifa = [...classificacoesCobertura].filter((item) => !classificacoesTarifa.has(item)).sort();
  const tarifasSemCobertura = [...classificacoesTarifa].filter((item) => !classificacoesCobertura.has(item)).sort();
  const cidadesComConflito = [...classificacoesPorCidade.entries()]
    .filter(([, classificacoes]) => classificacoes.size > 1)
    .map(([cidade, classificacoes]) => ({ cidade, classificacoes: [...classificacoes].sort() }));
  const alertas = ['Tabela mantida em revisão até validar generalidades, incidência de TDA e arredondamento.'];
  if (coberturasSemClassificacao) alertas.push(`${coberturasSemClassificacao} cobertura(s) sem classificação foram ignoradas.`);
  if (classificacoesSemTarifa.length) alertas.push(`${classificacoesSemTarifa.length} classificação(ões) de cobertura não possuem tarifa.`);
  if (tarifasSemCobertura.length) alertas.push(`${tarifasSemCobertura.length} classificação(ões) tarifárias não possuem cobertura.`);
  if (cidadesComConflito.length) alertas.push(`${cidadesComConflito.length} cidade(s) possuem mais de uma classificação.`);
  return {
    coberturas: coberturaDados.length,
    faixas: faixaDados.length,
    regras: regrasDados.length,
    diagnostico_chaves: {
      classificacoes_cobertura: classificacoesCobertura.size,
      classificacoes_tarifa: classificacoesTarifa.size,
      coberturas_sem_classificacao: coberturasSemClassificacao,
      classificacoes_sem_tarifa: classificacoesSemTarifa,
      tarifas_sem_cobertura: tarifasSemCobertura,
      cidades_com_conflito: cidadesComConflito
    },
    alertas
  };
}

async function normalizarMengueCobertura(client, tabelaId, grupos) {
  const base = grupos.find((grupo) => grupo.aba === 'BD CIDADE+PRAÇA+TAXAS+FREQ+PREV');
  const tabelaGrupo = grupos.find((grupo) => grupo.aba === 'TABELA MENGUE SSW');
  if (!base || !tabelaGrupo) return { coberturas: 0, faixas: 0, alertas: ['Abas obrigatórias da Mengue ausentes.'] };
  const regioesTarifariasNormais = new Set();
  for (const linha of tabelaGrupo.linhas.filter((item) => item.numero_linha >= 5)) {
    if (String(celula(linha, 'E') || '').trim().toUpperCase() !== 'N') continue;
    if (Number(celula(linha, 'D')) !== 0) continue;
    for (const regiao of String(celula(linha, 'C') || '').split(',').map((item) => normalizarTexto(item)).filter(Boolean)) {
      regioesTarifariasNormais.add(regiao);
    }
  }
  const coberturaDados = [];
  let divergenciasSiglaComercialPraca = 0;
  let coberturasComTarifaEspecifica = 0;
  let coberturasComFallbackUf = 0;
  for (const linha of base.linhas.filter((item) => item.numero_linha >= 2)) {
    const uf = String(celula(linha, 'A') || '').trim().toUpperCase();
    const cidade = String(celula(linha, 'B') || '').trim();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade) continue;
    const siglaComercial = normalizarTexto(celula(linha, 'K'));
    const siglaPraca = normalizarTexto(celula(linha, 'L'));
    if (siglaComercial && siglaPraca && siglaComercial !== siglaPraca) divergenciasSiglaComercialPraca += 1;
    const regiaoOriginal = siglaPraca || siglaComercial;
    const regiaoEspecifica = regioesTarifariasNormais.has(siglaPraca)
      ? siglaPraca
      : (regioesTarifariasNormais.has(siglaComercial) ? siglaComercial : null);
    const possuiTarifaEspecifica = Boolean(regiaoEspecifica);
    const usaFallbackUf = !possuiTarifaEspecifica && regioesTarifariasNormais.has(uf);
    const codigoRegiao = regiaoEspecifica || (usaFallbackUf ? uf : regiaoOriginal);
    if (possuiTarifaEspecifica) coberturasComTarifaEspecifica += 1;
    if (usaFallbackUf) coberturasComFallbackUf += 1;
    coberturaDados.push({
      codigo_regiao: codigoRegiao, uf, cidade,
      cidade_normalizada: normalizarTexto(cidade), codigo_ibge: Number(celula(linha, 'E')) || null,
      cep_inicio: Number(String(celula(linha, 'C') || '').replace(/\D/g, '')) || null,
      cep_fim: Number(String(celula(linha, 'D') || '').replace(/\D/g, '')) || null,
      prazo_min: Number(celula(linha, 'F')) || null, prazo_max: Number(celula(linha, 'G')) || null,
      frequencia: celula(linha, 'H') || null, tde: null,
      trt: null, observacao: celula(linha, 'N') || null,
      metadados: {
        tde_fonte: celula(linha, 'I'), trt_fonte: celula(linha, 'J'),
        sigla_praca_comercial: celula(linha, 'K'), sigla_praca: celula(linha, 'L'),
        sigla_unidade: celula(linha, 'M'), codigo_regiao_original: regiaoOriginal,
        estrategia_tarifa: possuiTarifaEspecifica
          ? (codigoRegiao === siglaPraca ? 'sigla_praca' : 'sigla_praca_comercial')
          : (usaFallbackUf ? 'fallback_uf' : 'sem_tarifa')
      }
    });
  }
  const coberturasPorCidade = new Map();
  for (const cobertura of coberturaDados) {
    const chaveCidade = `${cobertura.uf}|${cobertura.cidade_normalizada}`;
    if (!coberturasPorCidade.has(chaveCidade)) coberturasPorCidade.set(chaveCidade, []);
    coberturasPorCidade.get(chaveCidade).push(cobertura);
  }
  let coberturasGenericasCidade = 0;
  let cidadesQueExigemCep = 0;
  for (const coberturasCidade of coberturasPorCidade.values()) {
    const regioes = new Set(coberturasCidade.map((item) => item.codigo_regiao));
    if (regioes.size !== 1) {
      cidadesQueExigemCep += 1;
      continue;
    }
    const referencia = coberturasCidade[0];
    coberturaDados.push({
      ...referencia,
      cep_inicio: null,
      cep_fim: null,
      metadados: { ...referencia.metadados, cobertura_generica_cidade: true }
    });
    coberturasGenericasCidade += 1;
  }
  if (coberturaDados.length) await client.query(`
    INSERT INTO frete.cobertura (
      tabela_preco_id, codigo_regiao, uf, cidade, cidade_normalizada, codigo_ibge,
      cep_inicio, cep_fim, prazo_min_dias, prazo_max_dias, frequencia, tde, trt, observacao, metadados
    )
    SELECT $1, x.codigo_regiao, x.uf, x.cidade, x.cidade_normalizada, x.codigo_ibge,
           x.cep_inicio, x.cep_fim, x.prazo_min, x.prazo_max, x.frequencia, x.tde, x.trt, x.observacao, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade TEXT, cidade_normalizada TEXT, codigo_ibge BIGINT,
      cep_inicio INTEGER, cep_fim INTEGER, prazo_min INTEGER, prazo_max INTEGER,
      frequencia TEXT, tde NUMERIC, trt NUMERIC, observacao TEXT, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(coberturaDados)]);

  const regioesCobertura = new Set(coberturaDados.map((item) => item.codigo_regiao).filter(Boolean));
  const paresFaixa = [['Y', 'Z'], ['AA', 'AB'], ['AC', 'AD'], ['AE', 'AF'], ['AG', 'AH']];
  const faixaDados = [];
  const regrasDados = [];
  const regioesTarifa = new Set();
  for (const linha of tabelaGrupo.linhas.filter((item) => item.numero_linha >= 5)) {
    if (String(celula(linha, 'E') || '').trim().toUpperCase() !== 'N') continue;
    if (Number(celula(linha, 'D')) !== 0) continue;
    const regioes = String(celula(linha, 'C') || '').split(',').map((item) => normalizarTexto(item)).filter(Boolean);
    if (!regioes.length) continue;
    const adValorem = Number(celula(linha, 'V')) / 100 || null;
    const adValoremMinimo = Number(celula(linha, 'W')) || null;
    const despacho = Number(celula(linha, 'P')) || null;
    const pedagio = Number(celula(linha, 'N')) || null;
    const gris = Number(celula(linha, 'Q')) / 100 || null;
    const grisMinimo = Number(celula(linha, 'R')) || null;
    const pos = Number(celula(linha, 'S')) / 100 || null;
    const posMinimo = Number(celula(linha, 'T')) || null;
    const tas = Number(celula(linha, 'U')) || null;
    for (const codigoRegiao of regioes) {
      regioesTarifa.add(codigoRegiao);
      let pesoAnterior = 0;
      let ultimoLimite = null;
      let ultimoValor = null;
      for (const [colunaLimite, colunaValor] of paresFaixa) {
        const pesoAte = Number(celula(linha, colunaLimite));
        const valorBase = Number(celula(linha, colunaValor));
        if (!(pesoAte > 0) || !(valorBase >= 0)) continue;
        faixaDados.push({
          codigo_regiao: codigoRegiao, peso_de: pesoAnterior, peso_ate: pesoAte,
          valor_base: valorBase, valor_excedente: null, peso_referencia: null,
          ad_valorem: null, despacho, pedagio,
          metadados: { arquivo_linha: linha.numero_linha, faixa_tipo: celula(linha, 'X'), aplica_se: celula(linha, 'M'), pos: celula(linha, 'S'), pos_minimo: celula(linha, 'T'), cod_mercad: celula(linha, 'D') }
        });
        pesoAnterior = pesoAte;
        ultimoLimite = pesoAte;
        ultimoValor = valorBase;
      }
      const valorToneladaExcedente = Number(celula(linha, 'AI'));
      if (ultimoLimite != null && ultimoValor != null && valorToneladaExcedente > 0 && String(celula(linha, 'AJ') || '').trim().toUpperCase() === 'E') {
        faixaDados.push({
          codigo_regiao: codigoRegiao, peso_de: ultimoLimite, peso_ate: null,
          valor_base: ultimoValor, valor_excedente: valorToneladaExcedente / 1000,
          peso_referencia: ultimoLimite, ad_valorem: null, despacho, pedagio,
          metadados: { arquivo_linha: linha.numero_linha, excedente_por_kg: true, valor_tonelada: valorToneladaExcedente, faixa_tipo: celula(linha, 'X'), aplica_se: celula(linha, 'M'), pos: celula(linha, 'S'), pos_minimo: celula(linha, 'T'), cod_mercad: celula(linha, 'D') }
        });
      }
      if (gris) regrasDados.push({ codigo: `GRIS_${codigoRegiao}`, nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: gris, minimo: grisMinimo, condicoes: { codigos_regiao: [codigoRegiao] }, prioridade: 20, observacao: `Linha ${linha.numero_linha} da TABELA MENGUE SSW.` });
      if (adValorem) regrasDados.push({ codigo: `ADV_${codigoRegiao}`, nome: 'Ad valorem', tipo: 'maior_entre_percentual_e_minimo', valor: adValorem, minimo: adValoremMinimo, condicoes: { codigos_regiao: [codigoRegiao] }, prioridade: 25, observacao: `Linha ${linha.numero_linha} da TABELA MENGUE SSW.` });
      if (pos) regrasDados.push({ codigo: `POS_${codigoRegiao}`, nome: 'POS', tipo: 'maior_entre_percentual_e_minimo', valor: pos, minimo: posMinimo, condicoes: { codigos_regiao: [codigoRegiao] }, prioridade: 30, observacao: `Linha ${linha.numero_linha} da TABELA MENGUE SSW.` });
      if (tas) regrasDados.push({ codigo: `TAS_${codigoRegiao}`, nome: 'TAS', tipo: 'fixo', valor: tas, minimo: null, condicoes: { codigos_regiao: [codigoRegiao] }, prioridade: 40, observacao: `Linha ${linha.numero_linha} da TABELA MENGUE SSW.` });
    }
  }
  if (faixaDados.length) await client.query(`
    INSERT INTO frete.tarifa_faixa (
      tabela_preco_id, codigo_regiao, peso_de_kg, peso_ate_kg, valor_base,
      valor_kg_excedente, peso_referencia_excedente_kg, ad_valorem_aliquota,
      taxa_despacho, pedagio_por_100kg, prioridade, metadados
    )
    SELECT $1, x.codigo_regiao, x.peso_de, x.peso_ate, x.valor_base,
           x.valor_excedente, x.peso_referencia, x.ad_valorem,
           x.despacho, x.pedagio, 100, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, peso_de NUMERIC, peso_ate NUMERIC, valor_base NUMERIC,
      valor_excedente NUMERIC, peso_referencia NUMERIC, ad_valorem NUMERIC,
      despacho NUMERIC, pedagio NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(faixaDados)]);
  if (regrasDados.length) await client.query(`
    INSERT INTO frete.regra_adicional (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, valor_minimo,
      condicoes, prioridade, ativo, observacao
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.minimo,
           x.condicoes, x.prioridade, TRUE, x.observacao
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, minimo NUMERIC,
      condicoes JSONB, prioridade INTEGER, observacao TEXT
    )
  `, [tabelaId, JSON.stringify(regrasDados)]);
  const regioesSemTarifa = [...regioesCobertura].filter((item) => !regioesTarifa.has(item)).sort();
  const tarifasSemCobertura = [...regioesTarifa].filter((item) => !regioesCobertura.has(item)).sort();
  return {
    coberturas: coberturaDados.length,
    faixas: faixaDados.length,
    regras: regrasDados.length,
    diagnostico_chaves: {
      regioes_cobertura: regioesCobertura.size,
      regioes_tarifa: regioesTarifa.size,
      regioes_conciliadas: [...regioesCobertura].filter((item) => regioesTarifa.has(item)).length,
      coberturas_com_tarifa_especifica: coberturasComTarifaEspecifica,
      coberturas_com_fallback_uf: coberturasComFallbackUf,
      coberturas_genericas_cidade: coberturasGenericasCidade,
      cidades_que_exigem_cep: cidadesQueExigemCep,
      divergencias_sigla_comercial_praca: divergenciasSiglaComercialPraca,
      regioes_sem_tarifa: regioesSemTarifa,
      tarifas_sem_cobertura: tarifasSemCobertura
    },
    alertas: [`Prévia parcial: TDA, TRT, TDE mínimo, TAR mínimo e APLICA-SE permanecem apenas nos metadados até validação. Linhas COD_MERCAD 115 não participam desta simulação. ${cidadesQueExigemCep} cidade(s) com mais de uma região tarifária exigem CEP.`]
  };
}

function numeroCep(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return /^\d{8}$/.test(digitos) ? Number(digitos) : null;
}

function codigoSeguro(valor) {
  return normalizarTexto(valor).replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
}

async function normalizarSaoMiguel(client, tabelaId, grupos, fontesAuxiliares = []) {
  const coberturaGrupo = grupos.find((grupo) => grupo.aba === 'Comercial - Localidades Atendid');
  if (!coberturaGrupo) {
    return { coberturas: 0, faixas: 0, regras: 0, alertas: ['A planilha de localidades da Expresso São Miguel não foi encontrada.'] };
  }

  const fonteTarifa = fontesAuxiliares.find((item) => item.fonte?.sufixo === 'tarifa');
  const textoTarifa = fonteTarifa?.grupos?.flatMap((grupo) => grupo.linhas)
    .map((linha) => String(linha.dados?.texto || '')).join(' ') || '';
  const textoNormalizado = normalizarTexto(textoTarifa);
  const pdfConferido = fonteTarifa?.sha === SAO_MIGUEL_CONTRATO.sha256
    && textoNormalizado.includes('136588 2026')
    && textoNormalizado.includes('SP1');

  const coberturas = [];
  const regioesCobertura = new Set();
  const contagemPorRegiao = {};
  for (const linha of coberturaGrupo.linhas.filter((item) => item.numero_linha >= 2)) {
    const origem = normalizarTexto(celula(linha, 'A'));
    const cidade = String(celula(linha, 'B') || '').trim();
    const uf = String(celula(linha, 'C') || '').trim().toUpperCase();
    const regiao = String(celula(linha, 'D') || '').trim().toUpperCase();
    if (!origem.includes('BIGUACU') || !cidade || !/^(SP|PR|SC|RS)$/.test(uf) || !/^(SP|PR|SC|RS)\d+$/.test(regiao)) continue;
    const codigoRegiao = `SAO_MIGUEL_${codigoSeguro(regiao)}`;
    const prazoMin = Number(celula(linha, 'Q')) || null;
    const prazoMax = Number(celula(linha, 'R')) || prazoMin;
    const diasAtendimento = [
      ['K', 'SEG'], ['L', 'TER'], ['M', 'QUA'], ['N', 'QUI'], ['O', 'SEX']
    ].filter(([coluna]) => celula(linha, coluna)).map(([, dia]) => dia).join(', ');
    regioesCobertura.add(regiao);
    contagemPorRegiao[regiao] = (contagemPorRegiao[regiao] || 0) + 1;
    coberturas.push({
      codigo_regiao: codigoRegiao,
      uf,
      cidade,
      cidade_normalizada: normalizarTexto(cidade),
      codigo_ibge: Number(celula(linha, 'G')) || null,
      cep_inicio: numeroCep(celula(linha, 'I')) || numeroCep(celula(linha, 'H')),
      cep_fim: numeroCep(celula(linha, 'J')) || numeroCep(celula(linha, 'H')),
      prazo_min: prazoMin,
      prazo_max: prazoMax,
      frequencia: diasAtendimento || null,
      metadados: {
        arquivo_linha: linha.numero_linha,
        regiao_original: regiao,
        sigla: celula(linha, 'E') || null,
        unidade: celula(linha, 'F') || null,
        cep_principal: numeroCep(celula(linha, 'H')),
        previsao_entrega: celula(linha, 'P') || null
      }
    });
  }

  if (coberturas.length) await client.query(`
    INSERT INTO frete.cobertura (
      tabela_preco_id, codigo_regiao, uf, cidade, cidade_normalizada, codigo_ibge,
      cep_inicio, cep_fim, prazo_min_dias, prazo_max_dias, frequencia, metadados
    )
    SELECT $1, x.codigo_regiao, x.uf, x.cidade, x.cidade_normalizada, x.codigo_ibge,
           x.cep_inicio, x.cep_fim, x.prazo_min, x.prazo_max, x.frequencia, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade TEXT, cidade_normalizada TEXT, codigo_ibge BIGINT,
      cep_inicio BIGINT, cep_fim BIGINT, prazo_min INTEGER, prazo_max INTEGER,
      frequencia TEXT, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(coberturas)]);

  const faixas = pdfConferido ? SAO_MIGUEL_TARIFAS.map((tarifa) => ({
    codigo_regiao: `SAO_MIGUEL_${codigoSeguro(tarifa.regiao)}`,
    peso_de: 0,
    peso_ate: null,
    valor_base: 0,
    valor_excedente: tarifa.quilo,
    peso_referencia: 0,
    frete_minimo: tarifa.taxa,
    ad_valorem: tarifa.percentual_nf,
    pedagio: 3.47,
    metadados: {
      regiao: tarifa.regiao,
      siglas: tarifa.siglas,
      contrato: SAO_MIGUEL_CONTRATO.numero,
      referencia: SAO_MIGUEL_CONTRATO.referencia,
      fonte_sha256: SAO_MIGUEL_CONTRATO.sha256
    }
  })) : [];
  if (faixas.length) await client.query(`
    INSERT INTO frete.tarifa_faixa (
      tabela_preco_id, codigo_regiao, peso_de_kg, peso_ate_kg, valor_base,
      valor_kg_excedente, peso_referencia_excedente_kg, frete_minimo,
      ad_valorem_aliquota, pedagio_por_100kg, prioridade, metadados
    )
    SELECT $1, x.codigo_regiao, x.peso_de, x.peso_ate, x.valor_base,
           x.valor_excedente, x.peso_referencia, x.frete_minimo,
           x.ad_valorem, x.pedagio, 100, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, peso_de NUMERIC, peso_ate NUMERIC, valor_base NUMERIC,
      valor_excedente NUMERIC, peso_referencia NUMERIC, frete_minimo NUMERIC,
      ad_valorem NUMERIC, pedagio NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(faixas)]);

  const regras = pdfConferido ? [
    { codigo: 'GRIS', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.0017, minimo: 3.63, prioridade: 20, observacao: '0,17% do valor da NF, mínimo de R$ 3,63.' },
    { codigo: 'TAS', nome: 'Taxa administrativa', tipo: 'fixo', valor: 3, minimo: null, prioridade: 30, observacao: 'R$ 3,00 por CT-e.' }
  ] : [];
  if (regras.length) await client.query(`
    INSERT INTO frete.regra_adicional (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, valor_minimo,
      condicoes, prioridade, ativo, observacao
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.minimo,
           '{}'::jsonb, x.prioridade, TRUE, x.observacao
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, minimo NUMERIC,
      prioridade INTEGER, observacao TEXT
    )
  `, [tabelaId, JSON.stringify(regras)]);

  await client.query(`
    UPDATE frete.tabela_preco
       SET origem_cep = $2, origem_cidade = $3, origem_uf = $4,
           fator_cubagem_kg_m3 = 300, vigencia_inicio = $5, vigencia_fim = $6,
           configuracao = COALESCE(configuracao, '{}'::jsonb) || $7::jsonb,
           atualizado_em = NOW()
     WHERE id = $1
  `, [
    tabelaId,
    SAO_MIGUEL_CONTRATO.origem_cep,
    SAO_MIGUEL_CONTRATO.origem_cidade,
    SAO_MIGUEL_CONTRATO.origem_uf,
    SAO_MIGUEL_CONTRATO.vigencia_inicio,
    SAO_MIGUEL_CONTRATO.vigencia_fim,
    JSON.stringify({
      cubagem_isenta_ate_m3: 0.30,
      icms_aplicar: true,
      icms_incluso: false,
      contrato: SAO_MIGUEL_CONTRATO.numero,
      referencia: SAO_MIGUEL_CONTRATO.referencia
    })
  ]);

  const regioesTarifa = new Set(SAO_MIGUEL_TARIFAS.map((item) => item.regiao));
  const regioesSemTarifa = [...regioesCobertura].filter((regiao) => !regioesTarifa.has(regiao)).sort();
  const auxiliares = Object.fromEntries(fontesAuxiliares
    .filter((item) => ['tda', 'tde', 'tdc', 'tvd'].includes(item.fonte?.sufixo))
    .map((item) => [item.fonte.sufixo.toUpperCase(), item.grupos.reduce((total, grupo) => total + Math.max(0, grupo.linhas.length - 1), 0)]));
  const alertas = [
    ...(pdfConferido ? [] : ['O PDF tarifário não corresponde ao contrato auditado; nenhuma tarifa foi aplicada.']),
    ...(regioesSemTarifa.length ? [`${regioesSemTarifa.join(', ')} possui cobertura, mas não possui tarifa no contrato.`] : []),
    'TDA, TDE, TDC e TVD foram preservadas por destinatário/CNPJ e não são aplicadas preventivamente.',
    'SVD, T-CPF, TPC, reentrega e devolução dependem do perfil ou evento operacional e não são aplicadas automaticamente.',
    'Tabela mantida em revisão até a homologação dos cálculos com CT-es reais.'
  ];
  return {
    coberturas: coberturas.length,
    faixas: faixas.length,
    regras: regras.length,
    contrato_pdf_conferido: pdfConferido,
    regioes_cobertura: [...regioesCobertura].sort(),
    regioes_tarifa: [...regioesTarifa].sort(),
    regioes_sem_tarifa: regioesSemTarifa,
    coberturas_por_regiao: contagemPorRegiao,
    linhas_auxiliares: auxiliares,
    alertas
  };
}

async function normalizarEjl(client, tabelaId, grupos, fontesAuxiliares = []) {
  const prazoPadraoHoras = 48;
  const prazoPadraoDias = 2;
  const principal = grupos.find((grupo) => grupo.aba === 'Planilha1');
  if (!principal) return { coberturas: 0, faixas: 0, regras: 0, alertas: ['A planilha principal da Expresso EJL não foi encontrada.'] };

  const ufsPorCidade = new Map([
    ['JOINVILLE', 'SC'], ['BLUMENAU', 'SC'], ['ITAJAI', 'SC'], ['JARAGUA DO SUL', 'SC'],
    ['FLORIANOPOLIS', 'SC'], ['TUBARAO', 'SC'], ['CRICIUMA', 'SC'],
    ['SAO PAULO', 'SP'], ['CURITIBA', 'PR']
  ]);
  const destinos = [];
  for (const linha of principal.linhas.filter((item) => item.numero_linha >= 15 && item.numero_linha <= 23)) {
    const cidade = String(celula(linha, 'E') || '').trim();
    const cidadeNormalizada = normalizarTexto(cidade);
    const uf = ufsPorCidade.get(cidadeNormalizada);
    const minimo = Number(celula(linha, 'G'));
    const itr = Number(celula(linha, 'I'));
    const valorKg = Number(celula(linha, 'K'));
    const adValorem = Number(celula(linha, 'M'));
    if (!uf || !cidade || !(minimo > 0) || !(valorKg > 0)) continue;
    destinos.push({
      codigo_regiao: `EJL_${uf}_${codigoSeguro(cidadeNormalizada)}`,
      uf, cidade, cidade_normalizada: cidadeNormalizada,
      minimo, itr: itr > 0 ? itr : null, valor_kg: valorKg,
      ad_valorem: adValorem > 0 ? adValorem : null,
      linha: linha.numero_linha
    });
  }

  const destinosPorRegiao = new Map(destinos.map((item) => [`${item.uf}|${item.cidade_normalizada}`, item]));
  const coberturaDados = [];
  const coberturasPorChave = new Map();
  let pracasComTarifa = 0;
  let pracasSemTarifa = 0;

  const adicionarCobertura = (cobertura) => {
    const chave = `${cobertura.uf}|${cobertura.cidade_normalizada || '*'}|${cobertura.codigo_regiao}|${cobertura.cep_inicio || '*'}|${cobertura.cep_fim || '*'}`;
    const existente = coberturasPorChave.get(chave);
    if (existente) {
      if (cobertura.tde > 0) existente.tde = cobertura.tde;
      existente.metadados = { ...existente.metadados, ...(cobertura.metadados || {}) };
      return existente;
    }
    const nova = {
      ...cobertura,
      prazo_min_dias: prazoPadraoDias,
      prazo_max_dias: prazoPadraoDias,
      metadados: {
        ...(cobertura.metadados || {}),
        prazo_padrao_horas: prazoPadraoHoras,
        prazo_fonte: 'confirmacao_operacional_ejl_2026-07-29'
      }
    };
    coberturasPorChave.set(chave, nova);
    coberturaDados.push(nova);
    return nova;
  };

  for (const grupo of EJL_PRACAS_OFICIAIS) {
    const nomeRegiao = normalizarTexto(grupo.regiaoTarifaria);
    const destinoTarifado = nomeRegiao ? destinosPorRegiao.get(`${grupo.uf}|${nomeRegiao}`) : null;
    for (const cidade of grupo.cidades) {
      const destinoDireto = destinosPorRegiao.get(`${grupo.uf}|${normalizarTexto(cidade)}`);
      const destinoDaPraca = destinoDireto || destinoTarifado;
      const codigoRegiao = destinoDaPraca?.codigo_regiao || `EJL_${grupo.uf}_SEM_TARIFA`;
      adicionarCobertura({
        codigo_regiao: codigoRegiao, uf: grupo.uf, cidade,
        cidade_normalizada: normalizarTexto(cidade), cep_inicio: null, cep_fim: null,
        tde: null, metadados: {
          fonte: FONTE_EJL_PRACAS,
          fonte_consultada_em: FONTE_EJL_PRACAS_CONSULTADA_EM,
          grupo_praca: grupo.grupo,
          regiao_tarifaria: grupo.regiaoTarifaria,
          estrategia_tarifa: destinoDireto
            ? 'tarifa_direta_planilha'
            : (destinoTarifado ? 'tarifa_regional_planilha' : 'cobertura_sem_tarifa')
        }
      });
      if (destinoDaPraca) pracasComTarifa += 1;
      else pracasSemTarifa += 1;
    }
    if (grupo.coberturaUfCompleta) {
      const codigoRegiao = destinoTarifado?.codigo_regiao || `EJL_${grupo.uf}_SEM_TARIFA`;
      adicionarCobertura({
        codigo_regiao: codigoRegiao, uf: grupo.uf, cidade: null,
        cidade_normalizada: null, cep_inicio: null, cep_fim: null, tde: null,
        metadados: {
          fonte: FONTE_EJL_PRACAS,
          fonte_consultada_em: FONTE_EJL_PRACAS_CONSULTADA_EM,
          grupo_praca: grupo.grupo,
          cobertura_uf_completa: true,
          regiao_tarifaria: grupo.regiaoTarifaria,
          estrategia_tarifa: destinoTarifado ? 'tarifa_regional_planilha' : 'cobertura_sem_tarifa'
        }
      });
    }
  }

  // Preserva destinos tarifados da planilha caso a pagina oficial seja alterada.
  for (const destino of destinos) {
    adicionarCobertura({
      codigo_regiao: destino.codigo_regiao, uf: destino.uf, cidade: destino.cidade,
      cidade_normalizada: destino.cidade_normalizada, cep_inicio: null, cep_fim: null,
      tde: null, metadados: {
        fonte: 'EXPRESSO EJL.xlsx', linha: destino.linha,
        estrategia_tarifa: 'tarifa_direta_planilha'
      }
    });
  }

  const codigosTarifados = new Set(destinos.map((item) => item.codigo_regiao));
  const cidadesTarifadas = new Set(coberturaDados
    .filter((item) => codigosTarifados.has(item.codigo_regiao) && item.cidade_normalizada)
    .map((item) => `${item.uf}|${item.cidade_normalizada}`));
  const coberturasPorCidadeUf = new Map();
  for (const cobertura of coberturaDados.filter((item) => item.cidade_normalizada)) {
    const chave = `${cobertura.uf}|${cobertura.cidade_normalizada}`;
    if (!coberturasPorCidadeUf.has(chave)) coberturasPorCidadeUf.set(chave, []);
    coberturasPorCidadeUf.get(chave).push(cobertura);
  }
  const ufPorFilialTde = { CWB: 'PR', FLP: 'SC', FLS: 'SC', FLN: 'SC', JVL: 'SC', SPO: 'SP' };
  let tdesAplicados = 0;
  let tdesCidadeTodaAplicados = 0;
  let tdesFaixaCepAplicados = 0;
  const tdesNaoVinculados = [];
  for (const auxiliar of fontesAuxiliares.filter((item) => item.fonte?.slug === 'expresso-ejl' && item.fonte?.sufixo === 'tde')) {
    const aba = auxiliar.grupos.find((grupo) => grupo.aba === 'Planilha1');
    for (const linha of (aba?.linhas || []).filter((item) => item.numero_linha >= 3)) {
      const filial = normalizarTexto(celula(linha, 'B'));
      const uf = ufPorFilialTde[filial];
      const cidade = String(celula(linha, 'C') || '').trim();
      const cidadeNormalizada = normalizarTexto(cidade);
      const candidatas = uf ? (coberturasPorCidadeUf.get(`${uf}|${cidadeNormalizada}`) || []) : [];
      const codigosRegiao = new Set(candidatas.map((item) => item.codigo_regiao));
      const coberturaDestino = codigosRegiao.size === 1 ? candidatas[0] : null;
      const tde = Number(celula(linha, 'E'));
      const faixaTexto = String(celula(linha, 'D') || '').trim();
      if (!coberturaDestino || !(tde > 0)) {
        tdesNaoVinculados.push({ linha: linha.numero_linha, filial, uf: uf || null, cidade, faixa: faixaTexto });
        continue;
      }
      const metadadosTde = {
        fonte_tde: auxiliar.fonte.arquivo,
        linha_tde: linha.numero_linha,
        filial_tde: filial,
        faixa_original_tde: faixaTexto
      };
      if (normalizarTexto(faixaTexto) === 'CIDADE TODA') {
        adicionarCobertura({ ...coberturaDestino, tde, metadados: metadadosTde });
        tdesAplicados += 1;
        tdesCidadeTodaAplicados += 1;
        continue;
      }
      const ceps = faixaTexto.match(/\d[\d.\-\s]{6,}\d/g) || [];
      const cepInicio = numeroCep(ceps[0]);
      const cepFim = numeroCep(ceps[1]);
      if (!cepInicio || !cepFim) {
        tdesNaoVinculados.push({ linha: linha.numero_linha, filial, uf, cidade, faixa: faixaTexto });
        continue;
      }
      adicionarCobertura({
        codigo_regiao: coberturaDestino.codigo_regiao, uf: coberturaDestino.uf, cidade: coberturaDestino.cidade,
        cidade_normalizada: coberturaDestino.cidade_normalizada, cep_inicio: cepInicio, cep_fim: cepFim,
        tde, metadados: metadadosTde
      });
      tdesAplicados += 1;
      tdesFaixaCepAplicados += 1;
    }
  }

  if (coberturaDados.length) await client.query(`
    INSERT INTO frete.cobertura (
      tabela_preco_id, codigo_regiao, uf, cidade, cidade_normalizada,
      cep_inicio, cep_fim, prazo_min_dias, prazo_max_dias, tde, metadados
    )
    SELECT $1, x.codigo_regiao, x.uf, x.cidade, x.cidade_normalizada,
           x.cep_inicio, x.cep_fim, x.prazo_min_dias, x.prazo_max_dias, x.tde, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade TEXT, cidade_normalizada TEXT,
      cep_inicio INTEGER, cep_fim INTEGER, prazo_min_dias INTEGER,
      prazo_max_dias INTEGER, tde NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(coberturaDados)]);

  const faixaDados = destinos.map((item) => ({
    codigo_regiao: item.codigo_regiao, peso_de: 0, peso_ate: null,
    valor_base: 0, valor_excedente: item.valor_kg, peso_referencia: 0,
    frete_minimo: item.minimo, ad_valorem: item.ad_valorem,
    metadados: { fonte: 'EXPRESSO EJL.xlsx', linha: item.linha, formula: 'max(peso_cobravel * valor_kg, taxa_minima)' }
  }));
  if (faixaDados.length) await client.query(`
    INSERT INTO frete.tarifa_faixa (
      tabela_preco_id, codigo_regiao, peso_de_kg, peso_ate_kg, valor_base,
      valor_kg_excedente, peso_referencia_excedente_kg, frete_minimo,
      ad_valorem_aliquota, prioridade, metadados
    )
    SELECT $1, x.codigo_regiao, x.peso_de, x.peso_ate, x.valor_base,
           x.valor_excedente, x.peso_referencia, x.frete_minimo,
           x.ad_valorem, 100, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, peso_de NUMERIC, peso_ate NUMERIC, valor_base NUMERIC,
      valor_excedente NUMERIC, peso_referencia NUMERIC, frete_minimo NUMERIC,
      ad_valorem NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(faixaDados)]);

  const regrasDados = [
    { codigo: 'GRIS', nome: 'GRIS', tipo: 'percentual_mercadoria', valor: 0.0015, minimo: null, condicoes: {}, prioridade: 20, observacao: '0,15% sobre o valor da mercadoria.' },
    { codigo: 'PEDAGIO', nome: 'Pedágio', tipo: 'por_100kg', valor: 3.5, minimo: null, condicoes: {}, prioridade: 30, observacao: 'R$ 3,50 por fração de 100 kg.' },
    ...destinos.filter((item) => item.itr).map((item) => ({
      codigo: `ITR_${item.codigo_regiao}`, nome: 'ITR', tipo: 'fixo', valor: item.itr,
      minimo: null, condicoes: { codigos_regiao: [item.codigo_regiao] }, prioridade: 40,
      observacao: `ITR da linha ${item.linha} da tabela EJL.`
    }))
  ];
  await client.query(`
    INSERT INTO frete.regra_adicional (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, valor_minimo,
      condicoes, prioridade, ativo, observacao
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.minimo,
           x.condicoes, x.prioridade, TRUE, x.observacao
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, minimo NUMERIC,
      condicoes JSONB, prioridade INTEGER, observacao TEXT
    )
  `, [tabelaId, JSON.stringify(regrasDados)]);

  return {
    coberturas: coberturaDados.length, faixas: faixaDados.length, regras: regrasDados.length,
    diagnostico_chaves: {
      cidades_tarifadas: cidadesTarifadas.size,
      pracas_oficiais_com_tarifa: pracasComTarifa,
      pracas_oficiais_sem_tarifa: pracasSemTarifa,
      estados_cobertos: [...new Set(EJL_PRACAS_OFICIAIS.map((item) => item.uf))].sort(),
      estados_com_cobertura_integral: EJL_PRACAS_OFICIAIS.filter((item) => item.coberturaUfCompleta).map((item) => item.uf),
      faixas_tde_aplicadas: tdesAplicados,
      tdes_cidade_toda_aplicados: tdesCidadeTodaAplicados,
      tdes_faixa_cep_aplicados: tdesFaixaCepAplicados,
      tdes_nao_vinculados: tdesNaoVinculados,
      prazo_padrao_horas: prazoPadraoHoras,
      fonte_cobertura: FONTE_EJL_PRACAS,
      fonte_cobertura_consultada_em: FONTE_EJL_PRACAS_CONSULTADA_EM
    },
    alertas: [
      'Cobertura oficial conciliada com a relação de praças da EJL; os valores continuam vindo exclusivamente da planilha comercial.',
      'Prazo operacional padrão da EJL configurado em 48 horas para todas as praças atendidas.',
      `${tdesAplicados} taxa(s) TDE vinculada(s) automaticamente pela filial, UF e cidade${tdesNaoVinculados.length ? `; ${tdesNaoVinculados.length} linha(s) permaneceram sem vínculo seguro` : ''}.`,
      'Bahia possui cobertura oficial estadual, mas permanece com preço pendente porque a planilha comercial não informa tarifa principal.',
      'Tabela mantida em revisão; devolução e reentrega são eventos operacionais e não entram automaticamente na cotação.'
    ]
  };
}

async function normalizarFitlogPorCidade(client, tabelaId, grupos, fontesAuxiliares = []) {
  const tarifaPorCidade = grupos.find((grupo) => grupo.aba === 'TARIFA POR CIDADE');
  if (!tarifaPorCidade) {
    return {
      coberturas: 0,
      faixas: 0,
      regras: 0,
      alertas: ['A aba TARIFA POR CIDADE da Fitlog nao foi encontrada.']
    };
  }

  const prazosPorDestino = new Map();
  const prazosOrigemFln = [];
  let linhasPrazoOutraOrigem = 0;
  for (const auxiliar of fontesAuxiliares.filter((item) => item.fonte?.slug === 'fitlog' && item.fonte?.sufixo === 'prazos')) {
    const abaPrazos = auxiliar.grupos.find((grupo) => grupo.aba === 'FIT');
    for (const linha of (abaPrazos?.linhas || []).filter((item) => item.numero_linha >= 3)) {
      const unidadeOrigem = normalizarTexto(celula(linha, 'A'));
      const ufOrigem = normalizarTexto(celula(linha, 'B'));
      const cidadeOrigem = normalizarTexto(celula(linha, 'C'));
      if (!(unidadeOrigem === 'FLN' && ufOrigem === 'SC' && cidadeOrigem === 'PALHOCA')) {
        linhasPrazoOutraOrigem += 1;
        continue;
      }
      const uf = String(celula(linha, 'E') || '').trim().toUpperCase();
      const cidade = String(celula(linha, 'F') || '').trim();
      const prazo = Number(celula(linha, 'I'));
      if (!/^[A-Z]{2}$/.test(uf) || !cidade || !(prazo > 0)) continue;
      const cidadeNormalizada = normalizarTexto(cidade);
      const chave = `${uf}|${cidadeNormalizada}`;
      const registro = {
        uf,
        cidade,
        cidade_normalizada: cidadeNormalizada,
        codigo_ibge: Number(celula(linha, 'G')) || null,
        distancia_km: Number(celula(linha, 'H')) || null,
        prazo,
        prazo_dificil_entrega: Number(celula(linha, 'J')) || null,
        frequencia: String(celula(linha, 'K') || '').trim() || null,
        tda_referencia: Number(celula(linha, 'L')) || null,
        praca_comercial: celula(linha, 'M') || null,
        classificacao: celula(linha, 'N') || null,
        regiao: celula(linha, 'O') || null,
        cep_inicio: numeroCep(celula(linha, 'P')),
        cep_fim: numeroCep(celula(linha, 'Q')),
        linha: linha.numero_linha,
        arquivo: auxiliar.fonte.arquivo
      };
      if (!prazosPorDestino.has(chave)) prazosPorDestino.set(chave, []);
      prazosPorDestino.get(chave).push(registro);
      prazosOrigemFln.push(registro);
    }
  }

  const escolherPrazo = (item) => {
    const candidatas = prazosPorDestino.get(`${item.uf}|${item.cidade_normalizada}`) || [];
    if (candidatas.length === 1) return { ...candidatas[0], estrategia_correspondencia: 'cidade_uf' };
    if (item.cep_inicio && item.cep_fim) {
      const porCidadeECep = candidatas.filter((prazo) => prazo.cep_inicio && prazo.cep_fim
        && prazo.cep_inicio <= item.cep_inicio && prazo.cep_fim >= item.cep_fim);
      if (porCidadeECep.length === 1) return { ...porCidadeECep[0], estrategia_correspondencia: 'cidade_uf_cep' };
      const porCep = prazosOrigemFln.filter((prazo) => prazo.uf === item.uf
        && prazo.cep_inicio && prazo.cep_fim
        && prazo.cep_inicio <= item.cep_inicio && prazo.cep_fim >= item.cep_fim);
      if (porCep.length === 1) return { ...porCep[0], estrategia_correspondencia: 'cep_contido' };
    }
    return null;
  };

  const cidades = new Map();
  let linhasSemTarifa = 0;
  for (const linha of tarifaPorCidade.linhas.filter((item) => item.numero_linha >= 5)) {
    const cidade = String(celula(linha, 'B') || '').trim();
    const uf = String(celula(linha, 'C') || '').trim().toUpperCase();
    if (!cidade || !/^[A-Z]{2}$/.test(uf)) continue;
    const cidadeNormalizada = normalizarTexto(cidade);
    const chave = `${uf}|${cidadeNormalizada}`;
    if (cidades.has(chave)) continue;
    const valores = ['H', 'I', 'J', 'K', 'L', 'M'].map((coluna) => Number(celula(linha, coluna)));
    if (!valores.some((valor) => valor > 0)) {
      linhasSemTarifa += 1;
      continue;
    }
    const item = {
      codigo_regiao: `FITLOG_${uf}_${codigoSeguro(cidadeNormalizada)}`,
      uf,
      cidade,
      cidade_normalizada: cidadeNormalizada,
      linha: linha.numero_linha,
      limites: [10, 20, 30, 50, 70, 100],
      valores,
      excedente: Number(celula(linha, 'N')),
      frete_valor: Number(celula(linha, 'O')),
      frete_valor_minimo: Number(celula(linha, 'P')),
      pedagio: Number(celula(linha, 'U')),
      despacho: Number(celula(linha, 'Q')),
      cep_inicio: numeroCep(celula(linha, 'AE')),
      cep_fim: numeroCep(celula(linha, 'AF')),
      regiao: celula(linha, 'G') || null
    };
    item.prazo = escolherPrazo(item);
    cidades.set(chave, item);
  }

  const coberturaDados = [...cidades.values()].map((item) => ({
    codigo_regiao: item.codigo_regiao,
    uf: item.uf,
    cidade: item.cidade,
    cidade_normalizada: item.cidade_normalizada,
    codigo_ibge: item.prazo?.codigo_ibge || null,
    cep_inicio: item.cep_inicio || item.prazo?.cep_inicio || null,
    cep_fim: item.cep_fim || item.prazo?.cep_fim || null,
    prazo_min_dias: item.prazo?.prazo || null,
    prazo_max_dias: item.prazo?.prazo || null,
    frequencia: item.prazo?.frequencia || null,
    metadados: {
      fonte: 'TARIFA POR CIDADE',
      linha: item.linha,
      origem_praca: 'FLNP/FLNR',
      regiao: item.regiao,
      ...(item.prazo ? {
        fonte_prazo: item.prazo.arquivo,
        linha_prazo: item.prazo.linha,
        estrategia_correspondencia_prazo: item.prazo.estrategia_correspondencia,
        unidade_origem_prazo: 'FLN',
        cidade_origem_prazo: 'PALHOCA',
        distancia_km: item.prazo.distancia_km,
        prazo_dificil_entrega_dias: item.prazo.prazo_dificil_entrega,
        tda_referencia: item.prazo.tda_referencia,
        praca_comercial: item.prazo.praca_comercial,
        classificacao_praca: item.prazo.classificacao,
        regiao_prazo: item.prazo.regiao
      } : {})
    }
  }));
  if (coberturaDados.length) await client.query(`
    INSERT INTO frete.cobertura (
      tabela_preco_id, codigo_regiao, uf, cidade, cidade_normalizada, codigo_ibge,
      cep_inicio, cep_fim, prazo_min_dias, prazo_max_dias, frequencia, metadados
    )
    SELECT $1, x.codigo_regiao, x.uf, x.cidade, x.cidade_normalizada, x.codigo_ibge,
           x.cep_inicio, x.cep_fim, x.prazo_min_dias, x.prazo_max_dias, x.frequencia, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade TEXT, cidade_normalizada TEXT, codigo_ibge BIGINT,
      cep_inicio INTEGER, cep_fim INTEGER, prazo_min_dias INTEGER,
      prazo_max_dias INTEGER, frequencia TEXT, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(coberturaDados)]);

  const adicionaisTdaDados = [...cidades.values()]
    .filter((item) => item.prazo?.tda_referencia > 0)
    .map((item) => ({
      codigo: 'TDA',
      nome: 'Taxa de dificuldade de acesso',
      tipo: 'fixo',
      valor: item.prazo.tda_referencia,
      uf: item.uf,
      cidade_normalizada: item.cidade_normalizada,
      cep_inicio: item.cep_inicio || item.prazo.cep_inicio || null,
      cep_fim: item.cep_fim || item.prazo.cep_fim || null,
      peso_maior_que: null,
      peso_ate: null,
      prioridade: 50,
      metadados: {
        fonte: item.prazo.arquivo,
        linha: item.prazo.linha,
        unidade_origem: 'FLN',
        cidade_origem: 'PALHOCA',
        estrategia_correspondencia: item.prazo.estrategia_correspondencia,
        classificacao_praca: item.prazo.classificacao
      }
    }));
  if (adicionaisTdaDados.length) await client.query(`
    INSERT INTO frete.adicional_cep (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, uf, cidade_normalizada,
      cep_inicio, cep_fim, peso_maior_que_kg, peso_ate_kg, prioridade, metadados
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.uf, x.cidade_normalizada,
           x.cep_inicio, x.cep_fim, x.peso_maior_que, x.peso_ate, x.prioridade, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, uf CHAR(2), cidade_normalizada TEXT,
      cep_inicio INTEGER, cep_fim INTEGER, peso_maior_que NUMERIC, peso_ate NUMERIC,
      prioridade INTEGER, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(adicionaisTdaDados)]);

  const faixaDados = [];
  for (const item of cidades.values()) {
    let anterior = 0;
    let ultimoLimite = null;
    let ultimoValor = null;
    for (let indice = 0; indice < item.limites.length; indice += 1) {
      const valor = item.valores[indice];
      if (!(valor > 0)) continue;
      faixaDados.push({
        codigo_regiao: item.codigo_regiao,
        peso_de: anterior,
        peso_ate: item.limites[indice],
        valor_base: valor,
        valor_excedente: null,
        peso_referencia: null,
        despacho: item.despacho > 0 ? item.despacho : null,
        pedagio: item.pedagio > 0 ? item.pedagio : null,
        metadados: { fonte: 'TARIFA POR CIDADE', linha: item.linha }
      });
      anterior = item.limites[indice];
      ultimoLimite = item.limites[indice];
      ultimoValor = valor;
    }
    if (ultimoValor != null && ultimoLimite != null && item.excedente > 0) {
      faixaDados.push({
        codigo_regiao: item.codigo_regiao,
        peso_de: ultimoLimite,
        peso_ate: null,
        valor_base: ultimoValor,
        valor_excedente: item.excedente,
        peso_referencia: ultimoLimite,
        despacho: item.despacho > 0 ? item.despacho : null,
        pedagio: item.pedagio > 0 ? item.pedagio : null,
        metadados: { fonte: 'TARIFA POR CIDADE', linha: item.linha, excedente_por_kg: true }
      });
    }
  }
  if (faixaDados.length) await client.query(`
    INSERT INTO frete.tarifa_faixa (
      tabela_preco_id, codigo_regiao, peso_de_kg, peso_ate_kg, valor_base,
      valor_kg_excedente, peso_referencia_excedente_kg,
      taxa_despacho, pedagio_por_100kg, prioridade, metadados
    )
    SELECT $1, x.codigo_regiao, x.peso_de, x.peso_ate, x.valor_base,
           x.valor_excedente, x.peso_referencia,
           x.despacho, x.pedagio, 100, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, peso_de NUMERIC, peso_ate NUMERIC, valor_base NUMERIC,
      valor_excedente NUMERIC, peso_referencia NUMERIC,
      despacho NUMERIC, pedagio NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(faixaDados)]);

  const regrasDados = [
    { codigo: 'GRIS', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.002, minimo: 5.3, condicoes: {}, prioridade: 20, observacao: '0,20% sobre o valor da mercadoria, minimo de R$ 5,30.' },
    { codigo: 'POS', nome: 'POS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.0015, minimo: 10, condicoes: {}, prioridade: 30, observacao: '0,15% sobre o valor da mercadoria, minimo de R$ 10,00.' },
    { codigo: 'TAS', nome: 'TAS', tipo: 'fixo', valor: 5.05, minimo: null, condicoes: {}, prioridade: 40, observacao: 'Taxa administrativa fixa.' },
    ...[...cidades.values()].filter((item) => item.frete_valor > 0).map((item) => ({
      codigo: `FRETE_VALOR_${item.codigo_regiao}`,
      nome: 'Frete valor',
      tipo: 'maior_entre_percentual_e_minimo',
      valor: item.frete_valor,
      minimo: item.frete_valor_minimo > 0 ? item.frete_valor_minimo : null,
      condicoes: { codigos_regiao: [item.codigo_regiao] },
      prioridade: 10,
      observacao: `Percentual da linha ${item.linha} da TARIFA POR CIDADE.`
    }))
  ];
  await client.query(`
    INSERT INTO frete.regra_adicional (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, valor_minimo,
      condicoes, prioridade, ativo, observacao
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.minimo,
           x.condicoes, x.prioridade, TRUE, x.observacao
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, minimo NUMERIC,
      condicoes JSONB, prioridade INTEGER, observacao TEXT
    )
  `, [tabelaId, JSON.stringify(regrasDados)]);

  return {
    coberturas: coberturaDados.length,
    faixas: faixaDados.length,
    regras: regrasDados.length,
    diagnostico_chaves: {
      cidades_destino: cidades.size,
      cidades_com_cep: coberturaDados.filter((item) => item.cep_inicio && item.cep_fim).length,
      cidades_com_prazo: coberturaDados.filter((item) => item.prazo_min_dias).length,
      cidades_sem_prazo: coberturaDados.filter((item) => !item.prazo_min_dias).length,
      cidades_com_tda_automatica: adicionaisTdaDados.length,
      linhas_prazo_origem_fln_palhoca: [...prazosPorDestino.values()].reduce((total, itens) => total + itens.length, 0),
      linhas_prazo_ignoradas_outras_origens: linhasPrazoOutraOrigem,
      linhas_sem_tarifa: linhasSemTarifa,
      conflitos_tarifarios: 0
    },
    alertas: [
      'Previa Fitlog baseada nas tarifas consolidadas por municipio e CEP da aba TARIFA POR CIDADE.',
      'Prazos e frequencias conciliados exclusivamente com a unidade FLN/Palhoca-SC.',
      'TDA aplicada automaticamente somente quando a relacao de pracas da unidade FLN/Palhoca-SC informa valor positivo para o destino.',
      'TDE, TRT, EMEX, reentrega e devolucao nao sao aplicados automaticamente sem o gatilho operacional correspondente.'
    ]
  };
}

async function normalizarFitlogLegado(client, tabelaId, grupos) {
  const provisoria = grupos.find((grupo) => grupo.aba.startsWith('SSW-PROVIS'));
  if (!provisoria) return { coberturas: 0, faixas: 0, regras: 0, alertas: ['A aba SSW-PROVISÓRIO da Fitlog não foi encontrada.'] };

  const cidades = new Map();
  for (const linha of provisoria.linhas.filter((item) => item.numero_linha >= 2)) {
    const origem = String(celula(linha, 'B') || '').trim().toUpperCase();
    const destinoTexto = String(celula(linha, 'G') || '').trim();
    if (!['FLNP', 'FLNR'].includes(origem) || !destinoTexto.includes('/')) continue;
    const separador = destinoTexto.lastIndexOf('/');
    const cidade = destinoTexto.slice(0, separador).trim();
    const uf = destinoTexto.slice(separador + 1).trim().toUpperCase();
    if (!cidade || !/^[A-Z]{2}$/.test(uf)) continue;
    const cidadeNormalizada = normalizarTexto(cidade);
    const chave = `${uf}|${cidadeNormalizada}`;
    if (cidades.has(chave)) continue;
    cidades.set(chave, {
      codigo_regiao: `FITLOG_${uf}_${codigoSeguro(cidadeNormalizada)}`,
      uf, cidade, cidade_normalizada: cidadeNormalizada, linha: linha.numero_linha,
      limites: [10, 20, 30, 50, 70, 100],
      valores: ['BU', 'BW', 'BY', 'CA', 'CC', 'CE'].map((coluna) => Number(celula(linha, coluna))),
      excedente: Number(celula(linha, 'GJ')) / 1000,
      frete_valor: Number(celula(linha, 'BM')) / 100,
      frete_valor_minimo: Number(celula(linha, 'BN')),
      pedagio: Number(celula(linha, 'AV')),
      despacho: Number(celula(linha, 'AX'))
    });
  }

  const coberturaDados = [...cidades.values()].map((item) => ({
    codigo_regiao: item.codigo_regiao, uf: item.uf, cidade: item.cidade,
    cidade_normalizada: item.cidade_normalizada,
    metadados: { fonte: 'SSW-PROVISÓRIO', linha: item.linha, origem_praca: 'FLNP/FLNR' }
  }));
  if (coberturaDados.length) await client.query(`
    INSERT INTO frete.cobertura (tabela_preco_id, codigo_regiao, uf, cidade, cidade_normalizada, metadados)
    SELECT $1, x.codigo_regiao, x.uf, x.cidade, x.cidade_normalizada, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade TEXT, cidade_normalizada TEXT, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(coberturaDados)]);

  const faixaDados = [];
  for (const item of cidades.values()) {
    let anterior = 0;
    let ultimoLimite = null;
    let ultimoValor = null;
    for (let indice = 0; indice < item.limites.length; indice += 1) {
      const valor = item.valores[indice];
      if (!(valor > 0)) continue;
      faixaDados.push({
        codigo_regiao: item.codigo_regiao, peso_de: anterior, peso_ate: item.limites[indice],
        valor_base: valor, valor_excedente: null, peso_referencia: null,
        despacho: item.despacho > 0 ? item.despacho : null,
        pedagio: item.pedagio > 0 ? item.pedagio : null,
        metadados: { fonte: 'SSW-PROVISÓRIO', linha: item.linha }
      });
      anterior = item.limites[indice];
      ultimoLimite = item.limites[indice];
      ultimoValor = valor;
    }
    if (ultimoValor != null && ultimoLimite != null && item.excedente > 0) faixaDados.push({
      codigo_regiao: item.codigo_regiao, peso_de: ultimoLimite, peso_ate: null,
      valor_base: ultimoValor, valor_excedente: item.excedente, peso_referencia: ultimoLimite,
      despacho: item.despacho > 0 ? item.despacho : null,
      pedagio: item.pedagio > 0 ? item.pedagio : null,
      metadados: { fonte: 'SSW-PROVISÓRIO', linha: item.linha, excedente_por_kg: true }
    });
  }
  if (faixaDados.length) await client.query(`
    INSERT INTO frete.tarifa_faixa (
      tabela_preco_id, codigo_regiao, peso_de_kg, peso_ate_kg, valor_base,
      valor_kg_excedente, peso_referencia_excedente_kg, taxa_despacho,
      pedagio_por_100kg, prioridade, metadados
    )
    SELECT $1, x.codigo_regiao, x.peso_de, x.peso_ate, x.valor_base,
           x.valor_excedente, x.peso_referencia, x.despacho,
           x.pedagio, 100, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, peso_de NUMERIC, peso_ate NUMERIC, valor_base NUMERIC,
      valor_excedente NUMERIC, peso_referencia NUMERIC, despacho NUMERIC,
      pedagio NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(faixaDados)]);

  const regrasDados = [
    { codigo: 'GRIS', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.002, minimo: 5.3, condicoes: {}, prioridade: 20, observacao: '0,20% sobre o valor da mercadoria, mínimo de R$ 5,30.' },
    { codigo: 'POS', nome: 'POS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.0015, minimo: 10, condicoes: {}, prioridade: 30, observacao: '0,15% sobre o valor da mercadoria, mínimo de R$ 10,00.' },
    { codigo: 'TAS', nome: 'TAS', tipo: 'fixo', valor: 5.05, minimo: null, condicoes: {}, prioridade: 40, observacao: 'Taxa administrativa fixa.' },
    ...[...cidades.values()].filter((item) => item.frete_valor > 0).map((item) => ({
      codigo: `FRETE_VALOR_${item.codigo_regiao}`, nome: 'Frete valor',
      tipo: 'maior_entre_percentual_e_minimo', valor: item.frete_valor,
      minimo: item.frete_valor_minimo > 0 ? item.frete_valor_minimo : null,
      condicoes: { codigos_regiao: [item.codigo_regiao] }, prioridade: 10,
      observacao: `Percentual da linha ${item.linha} da SSW-PROVISÓRIO.`
    }))
  ];
  await client.query(`
    INSERT INTO frete.regra_adicional (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, valor_minimo,
      condicoes, prioridade, ativo, observacao
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.minimo,
           x.condicoes, x.prioridade, TRUE, x.observacao
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, minimo NUMERIC,
      condicoes JSONB, prioridade INTEGER, observacao TEXT
    )
  `, [tabelaId, JSON.stringify(regrasDados)]);

  return {
    coberturas: coberturaDados.length, faixas: faixaDados.length, regras: regrasDados.length,
    diagnostico_chaves: { cidades_destino: cidades.size, conflitos_tarifarios: 0 },
    alertas: [
      'Prévia Fitlog baseada nas tarifas consolidadas da aba SSW-PROVISÓRIO.',
      'TDE, TRT, EMEX, reentrega e devolução não são aplicados automaticamente sem o gatilho operacional correspondente.'
    ]
  };
}

function frequenciaRodonaves(linha) {
  const dias = [['J', 'seg'], ['K', 'ter'], ['L', 'qua'], ['M', 'qui'], ['N', 'sex']]
    .filter(([coluna]) => String(celula(linha, coluna) || '').trim().toUpperCase() === 'S')
    .map(([, nome]) => nome);
  const vezes = Number(celula(linha, 'I')) || dias.length || null;
  if (!vezes && !dias.length) return null;
  return `${vezes || dias.length}x/semana${dias.length ? ` (${dias.join(', ')})` : ''}`;
}

const SHA_PDF_RODONAVES_ATUAL = '015c20915c9c9bcad51ba10c3731f506259169daac42110272bbb8444aabcda6';
const CAPITAIS_RODONAVES = new Map([
  ['SC', 'FLORIANOPOLIS'],
  ['RS', 'PORTO ALEGRE'],
  ['PR', 'CURITIBA'],
  ['SP', 'SAO PAULO'],
  ['MG', 'BELO HORIZONTE'],
  ['GO', 'GOIANIA']
]);
const TARIFAS_PDF_RODONAVES = {
  'CAPITAL SC': [31.64, 40.10, 49.64, 61.12, 44.80, 48.86, 0.85],
  'SANTA CATARINA': [42.39, 53.99, 64.63, 78.14, 57.16, 62.23, 1.10],
  'CAPITAL RS': [51.93, 66.67, 81.53, 97.11, 70.77, 76.81, 1.34],
  'RIO GRANDE DO SUL': [63.52, 78.04, 94.97, 112.15, 81.60, 88.43, 1.55],
  'CAPITAL PR': [42.39, 53.99, 64.63, 78.14, 57.16, 62.23, 1.10],
  'PARANA': [63.52, 78.04, 94.97, 112.15, 81.60, 88.43, 1.55],
  'CAPITAL SP': [63.52, 78.04, 94.97, 112.15, 81.60, 88.43, 1.55],
  'SAO PAULO': [72.36, 90.64, 106.59, 126.79, 91.85, 99.17, 1.73],
  'CAPITAL MG': [105.47, 118.38, 139.17, 165.35, 118.74, 127.26, 2.23],
  'MINAS GERAIS': [114.78, 128.82, 151.44, 179.93, 129.22, 138.48, 2.43],
  'CAPITAL GO': [114.78, 128.82, 151.44, 179.93, 129.22, 138.48, 2.43],
  'GOIAS': [117.00, 130.04, 153.57, 181.52, 130.45, 139.89, 2.45],
  'DISTRITO FEDERAL': [117.00, 130.04, 153.57, 181.52, 130.45, 139.89, 2.45]
};

function regiaoTarifariaRodonaves(uf, cidadeNormalizada) {
  const nomesUf = {
    SC: 'SANTA CATARINA', RS: 'RIO GRANDE DO SUL', PR: 'PARANA',
    SP: 'SAO PAULO', MG: 'MINAS GERAIS', GO: 'GOIAS', DF: 'DISTRITO FEDERAL'
  };
  if (!nomesUf[uf]) return null;
  if (uf === 'DF') return nomesUf[uf];
  return CAPITAIS_RODONAVES.get(uf) === cidadeNormalizada ? `CAPITAL ${uf}` : nomesUf[uf];
}

async function normalizarRodonaves(client, tabelaId, grupos, fontesAuxiliares = []) {
  const prazosGrupo = grupos.find((grupo) => grupo.aba === 'Planilha7');
  const secCatGrupo = grupos.find((grupo) => grupo.aba === 'Tarifas Cidade Coleta-Entrega');
  const restricaoGrupo = grupos.find((grupo) => normalizarTexto(grupo.aba) === 'CEPS ZONA DE RESTRICAO SP');
  const riscoGrupo = grupos.find((grupo) => normalizarTexto(grupo.aba) === 'CEPS ZONA DE RISCO SP');
  if (!prazosGrupo) {
    return { coberturas: 0, faixas: 0, regras: 0, alertas: ['A aba Planilha7 da Rodonaves não foi encontrada.'] };
  }

  const secCatPorCidade = new Map();
  for (const linha of (secCatGrupo?.linhas || []).filter((item) => item.numero_linha >= 2)) {
    const uf = String(celula(linha, 'D') || '').trim().toUpperCase();
    const cidade = String(celula(linha, 'C') || '').trim();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade) continue;
    const chave = `${uf}|${normalizarTexto(cidade)}`;
    const item = {
      nome: String(celula(linha, 'A') || '').trim() || null,
      valor: Number(celula(linha, 'B')) || null,
      cep_inicio: numeroCep(celula(linha, 'E')),
      cep_fim: numeroCep(celula(linha, 'F')),
      unidade: String(celula(linha, 'G') || '').trim() || null,
      unidade_nome: String(celula(linha, 'H') || '').trim() || null,
      regional: String(celula(linha, 'I') || '').trim() || null,
      linha: linha.numero_linha
    };
    if (!secCatPorCidade.has(chave)) secCatPorCidade.set(chave, []);
    secCatPorCidade.get(chave).push(item);
  }

  const coberturaDados = [];
  const regioesPorUf = new Map();
  const chavesCobertura = new Set();
  let prazosIgnoradosOutraOrigem = 0;
  let cidadesComMultiplasSecCat = 0;
  for (const linha of prazosGrupo.linhas.filter((item) => item.numero_linha >= 2)) {
    const origemUnidade = String(celula(linha, 'A') || '').trim();
    const origemCidade = normalizarTexto(celula(linha, 'B'));
    const origemUf = String(celula(linha, 'C') || '').trim().toUpperCase();
    if (!(origemUnidade === '133' || (origemCidade === 'BIGUACU' && origemUf === 'SC'))) {
      prazosIgnoradosOutraOrigem += 1;
      continue;
    }
    const cidade = String(celula(linha, 'D') || '').trim();
    const uf = String(celula(linha, 'E') || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade) continue;
    const unidadeDestino = String(celula(linha, 'H') || '').trim() || 'SEM_UNIDADE';
    const codigoRegiao = `UNIDADE_${normalizarTexto(unidadeDestino).replace(/\s+/g, '_')}`;
    const chaveCidade = `${uf}|${normalizarTexto(cidade)}`;
    const adicionaisCidade = secCatPorCidade.get(chaveCidade) || [];
    if (adicionaisCidade.length > 1) cidadesComMultiplasSecCat += 1;
    // A cobertura genérica mantém a seleção manual por UF/cidade funcionando.
    // Quando o CEP é informado, escolherCobertura prioriza a faixa SEC-CAT mais específica.
    const faixas = [null, ...adicionaisCidade];
    for (const adicional of faixas) {
      const chaveCobertura = [chaveCidade, codigoRegiao, adicional?.cep_inicio || '', adicional?.cep_fim || ''].join('|');
      if (chavesCobertura.has(chaveCobertura)) continue;
      chavesCobertura.add(chaveCobertura);
      coberturaDados.push({
        codigo_regiao: codigoRegiao,
        uf,
        cidade,
        cidade_normalizada: normalizarTexto(cidade),
        cep_inicio: adicional?.cep_inicio || null,
        cep_fim: adicional?.cep_fim || null,
        prazo_min: Number(celula(linha, 'F')) || null,
        prazo_max: Number(celula(linha, 'F')) || null,
        frequencia: frequenciaRodonaves(linha),
        metadados: {
          origem_unidade: origemUnidade,
          origem_cidade: celula(linha, 'B'),
          origem_uf: origemUf,
          unidade_destino: unidadeDestino,
          prazo_pj_dias: Number(celula(linha, 'F')) || null,
          prazo_pf_dias: Number(celula(linha, 'G')) || null,
          sec_cat: adicional ? {
            nome: adicional.nome,
            valor: adicional.valor,
            unidade: adicional.unidade,
            unidade_nome: adicional.unidade_nome,
            regional: adicional.regional,
            linha_origem: adicional.linha,
            aplicada_automaticamente: false
          } : null,
          linha_prazo: linha.numero_linha
        }
      });
    }
    if (!regioesPorUf.has(uf)) regioesPorUf.set(uf, new Set());
    regioesPorUf.get(uf).add(codigoRegiao);
  }

  if (coberturaDados.length) await client.query(`
    INSERT INTO frete.cobertura (
      tabela_preco_id, codigo_regiao, uf, cidade, cidade_normalizada,
      cep_inicio, cep_fim, prazo_min_dias, prazo_max_dias, frequencia, metadados
    )
    SELECT $1, x.codigo_regiao, x.uf, x.cidade, x.cidade_normalizada,
           x.cep_inicio, x.cep_fim, x.prazo_min, x.prazo_max, x.frequencia, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade TEXT, cidade_normalizada TEXT,
      cep_inicio INTEGER, cep_fim INTEGER, prazo_min INTEGER, prazo_max INTEGER,
      frequencia TEXT, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(coberturaDados)]);

  const pdfAtualizado = fontesAuxiliares.find((item) => item.fonte.tipo === 'pdf' && item.fonte.sufixo === 'pdf-atualizado');
  const pdfConferido = pdfAtualizado?.sha === SHA_PDF_RODONAVES_ATUAL;
  const faixaDados = [];
  if (pdfConferido) {
    const destinosUnicos = new Map();
    for (const cobertura of coberturaDados) {
      const regiaoTarifaria = regiaoTarifariaRodonaves(cobertura.uf, cobertura.cidade_normalizada);
      if (!regiaoTarifaria) continue;
      const chave = `${cobertura.codigo_regiao}|${cobertura.uf}|${cobertura.cidade_normalizada}`;
      destinosUnicos.set(chave, { ...cobertura, regiao_tarifaria: regiaoTarifaria });
    }
    const limites = [10, 20, 40, 60, 80, 100];
    for (const destino of destinosUnicos.values()) {
      const valores = TARIFAS_PDF_RODONAVES[destino.regiao_tarifaria];
      if (!valores) continue;
      let anterior = 0;
      limites.forEach((limite, indice) => {
        faixaDados.push({
          codigo_regiao: destino.codigo_regiao,
          uf: destino.uf,
          cidade_normalizada: destino.cidade_normalizada,
          peso_de: anterior,
          peso_ate: limite,
          valor_base: valores[indice],
          valor_excedente: null,
          peso_referencia: null,
          metadados: { fonte: pdfAtualizado.fonte.arquivo, regiao_tarifaria: destino.regiao_tarifaria }
        });
        anterior = limite;
      });
      faixaDados.push({
        codigo_regiao: destino.codigo_regiao,
        uf: destino.uf,
        cidade_normalizada: destino.cidade_normalizada,
        peso_de: 100,
        peso_ate: null,
        valor_base: valores[5],
        valor_excedente: valores[6],
        peso_referencia: 100,
        metadados: { fonte: pdfAtualizado.fonte.arquivo, regiao_tarifaria: destino.regiao_tarifaria, excedente: true }
      });
    }
  }
  if (faixaDados.length) await client.query(`
    INSERT INTO frete.tarifa_faixa (
      tabela_preco_id, codigo_regiao, uf_destino, cidade_normalizada,
      peso_de_kg, peso_ate_kg, valor_base, valor_kg_excedente,
      peso_referencia_excedente_kg, prioridade, metadados
    )
    SELECT $1, x.codigo_regiao, x.uf, x.cidade_normalizada,
           x.peso_de, x.peso_ate, x.valor_base, x.valor_excedente,
           x.peso_referencia, 100, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo_regiao TEXT, uf CHAR(2), cidade_normalizada TEXT,
      peso_de NUMERIC, peso_ate NUMERIC, valor_base NUMERIC,
      valor_excedente NUMERIC, peso_referencia NUMERIC, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(faixaDados)]);

  const adicionaisCepDados = [];
  for (const linha of (secCatGrupo?.linhas || []).filter((item) => item.numero_linha >= 2)) {
    const uf = String(celula(linha, 'D') || '').trim().toUpperCase();
    const cidade = normalizarTexto(celula(linha, 'C'));
    const cepInicio = numeroCep(celula(linha, 'E'));
    const cepFim = numeroCep(celula(linha, 'F'));
    const valor = Number(celula(linha, 'B'));
    if (!/^[A-Z]{2}$/.test(uf) || !cidade || !cepInicio || !cepFim || !(valor > 0)) continue;
    adicionaisCepDados.push({
      codigo: 'SEC_CAT', nome: 'SEC-CAT', tipo: 'fixo', valor,
      uf, cidade_normalizada: cidade, cep_inicio: cepInicio, cep_fim: cepFim,
      peso_maior_que: null, peso_ate: null, prioridade: 100,
      metadados: {
        fonte: 'Tarifas Cidade Coleta-Entrega', linha: linha.numero_linha,
        nome_tarifa: celula(linha, 'A'), unidade: celula(linha, 'G'),
        unidade_nome: celula(linha, 'H'), regional: celula(linha, 'I')
      }
    });
  }

  if (pdfConferido) {
    const adicionarTarifaCidade = (uf, cidades, limite, valorAte, valorAcima, grupo) => {
      for (const cidade of cidades) {
        const comum = {
          codigo: 'SEC_CAT', nome: 'SEC-CAT', tipo: 'fixo', uf,
          cidade_normalizada: normalizarTexto(cidade), cep_inicio: null, cep_fim: null,
          prioridade: 10, metadados: { fonte: pdfAtualizado.fonte.arquivo, grupo }
        };
        adicionaisCepDados.push({ ...comum, valor: valorAte, peso_maior_que: 0, peso_ate: limite });
        adicionaisCepDados.push({ ...comum, valor: valorAcima, peso_maior_que: limite, peso_ate: null });
      }
    };
    adicionarTarifaCidade('GO', [
      'ABADIA DE GOIAS', 'APARECIDA DE GOIANIA', 'GOIANIA', 'GOIANIRA',
      'INHUMAS', 'SENADOR CANEDO', 'TRINDADE'
    ], 100, 15.79, 37.27, 'Tarifa Goiania');
    adicionarTarifaCidade('RS', ['PORTO ALEGRE'], 60, 15.79, 37.27, 'Tarifa Cidades Especificas');
    adicionarTarifaCidade('PR', ['CURITIBA'], 60, 15.79, 37.27, 'Tarifa Cidades Especificas');
    adicionarTarifaCidade('SC', ['ITAJAI', 'NAVEGANTES'], 60, 15.79, 37.27, 'Tarifa Cidades Especificas');
    adicionarTarifaCidade('SC', ['CAMBORIU', 'BALNEARIO CAMBORIU'], 60, 10.24, 25.71, 'Tarifa Camboriu');

    for (const linha of (riscoGrupo?.linhas || []).filter((item) => item.numero_linha >= 2)) {
      const uf = String(celula(linha, 'F') || '').trim().toUpperCase();
      const cidade = normalizarTexto(celula(linha, 'E'));
      const cepInicio = numeroCep(celula(linha, 'B'));
      const cepFim = numeroCep(celula(linha, 'C'));
      if (!/^[A-Z]{2}$/.test(uf) || !cidade || !cepInicio || !cepFim) continue;
      adicionaisCepDados.push({
        codigo: 'ZONA_RISCO', nome: 'Zona de risco', tipo: 'fixo', valor: 72.98,
        uf, cidade_normalizada: cidade, cep_inicio: cepInicio, cep_fim: cepFim,
        peso_maior_que: null, peso_ate: null, prioridade: 20,
        metadados: { fonte: pdfAtualizado.fonte.arquivo, lista: riscoGrupo.aba, linha: linha.numero_linha, bairro: celula(linha, 'A') }
      });
    }

    for (const linha of (restricaoGrupo?.linhas || []).filter((item) => item.numero_linha >= 2)) {
      const uf = String(celula(linha, 'F') || '').trim().toUpperCase();
      const cidade = normalizarTexto(celula(linha, 'E'));
      const cepInicio = numeroCep(celula(linha, 'B'));
      const cepFim = numeroCep(celula(linha, 'C'));
      if (!/^[A-Z]{2}$/.test(uf) || !cidade || !cepInicio || !cepFim) continue;
      const comum = {
        codigo: 'ZONA_RESTRICAO', nome: 'Zona de restrição', tipo: 'fixo',
        uf, cidade_normalizada: cidade, cep_inicio: cepInicio, cep_fim: cepFim,
        prioridade: 20,
        metadados: { fonte: pdfAtualizado.fonte.arquivo, lista: restricaoGrupo.aba, linha: linha.numero_linha, bairro: celula(linha, 'A') }
      };
      adicionaisCepDados.push({ ...comum, valor: 289.95, peso_maior_que: 500, peso_ate: 1000 });
      adicionaisCepDados.push({ ...comum, valor: 571.64, peso_maior_que: 1000, peso_ate: 1500 });
      adicionaisCepDados.push({ ...comum, valor: 795.31, peso_maior_que: 1500, peso_ate: null });
    }
  }

  if (adicionaisCepDados.length) await client.query(`
    INSERT INTO frete.adicional_cep (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, uf, cidade_normalizada,
      cep_inicio, cep_fim, peso_maior_que_kg, peso_ate_kg, prioridade, metadados
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.uf, x.cidade_normalizada,
           x.cep_inicio, x.cep_fim, x.peso_maior_que, x.peso_ate, x.prioridade, x.metadados
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, uf CHAR(2), cidade_normalizada TEXT,
      cep_inicio INTEGER, cep_fim INTEGER, peso_maior_que NUMERIC, peso_ate NUMERIC,
      prioridade INTEGER, metadados JSONB
    )
  `, [tabelaId, JSON.stringify(adicionaisCepDados)]);

  const regioes = (ufs) => [...new Set(ufs.flatMap((uf) => [...(regioesPorUf.get(uf) || [])]))];
  const goEspeciais = ['UNIDADE_203', 'UNIDADE_205'];
  const mgEspeciais = ['UNIDADE_881', 'UNIDADE_882', 'UNIDADE_883', 'UNIDADE_884', 'UNIDADE_885', 'UNIDADE_886'];
  const regioesPadrao = regioes(['RS', 'SC', 'PR', 'SP', 'GO', 'DF', 'MG'])
    .filter((codigo) => !goEspeciais.includes(codigo) && !mgEspeciais.includes(codigo));
  const regrasDados = [
    { codigo: 'FRETE_VALOR', nome: 'Frete valor', tipo: 'maior_entre_percentual_e_minimo', valor: 0.005, minimo: 12.98, condicoes: {}, prioridade: 10, observacao: '0,50% sobre o valor da mercadoria, mínimo de R$ 12,98 por CT-e.' },
    { codigo: 'PEDAGIO', nome: 'Pedágio', tipo: 'por_100kg', valor: 13.97, minimo: null, condicoes: {}, prioridade: 30, observacao: 'R$ 13,97 por fração de 100 kg.' },
    { codigo: 'TAS', nome: 'TAS', tipo: 'fixo', valor: 12.75, minimo: null, condicoes: { ufs: ['GO', 'MG', 'DF', 'MT', 'MS', 'RO', 'AC', 'PA', 'RR', 'AP', 'TO', 'AM'] }, prioridade: 40, observacao: 'Taxa administrativa por CT-e nos destinos indicados na proposta.' },
    { codigo: 'GRIS_PADRAO_ATE_10K', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.001, minimo: 1.74, condicoes: { codigos_regiao: regioesPadrao, valor_mercadoria_ate: 10000 }, prioridade: 20, observacao: 'GRIS padrão até R$ 10.000,00.' },
    { codigo: 'GRIS_PADRAO_ACIMA_10K', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.0023, minimo: 1.74, condicoes: { codigos_regiao: regioesPadrao, valor_mercadoria_de: 10000.01 }, prioridade: 20, observacao: 'GRIS padrão acima de R$ 10.000,00.' },
    { codigo: 'GRIS_GO_203_205', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.001, minimo: 1.74, condicoes: { codigos_regiao: goEspeciais }, prioridade: 20, observacao: 'GRIS para destinos atendidos pelas unidades 203 e 205.' },
    { codigo: 'GRIS_MG_881_886', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.0015, minimo: 1.74, condicoes: { codigos_regiao: mgEspeciais }, prioridade: 20, observacao: 'GRIS para destinos atendidos pelas unidades 881 a 886.' },
    { codigo: 'GRIS_OUTRAS_UFS', nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: 0.003, minimo: 1.74, condicoes: { ufs: ['RJ', 'ES', 'MT', 'MS', 'AM', 'PA', 'RO', 'RR', 'AP', 'TO', 'AC'] }, prioridade: 20, observacao: 'GRIS de 0,30% para os destinos indicados na proposta.' }
  ];
  await client.query(`
    INSERT INTO frete.regra_adicional (
      tabela_preco_id, codigo, nome, tipo_calculo, valor, valor_minimo,
      condicoes, prioridade, ativo, observacao
    )
    SELECT $1, x.codigo, x.nome, x.tipo, x.valor, x.minimo,
           x.condicoes, x.prioridade, TRUE, x.observacao
    FROM jsonb_to_recordset($2::jsonb) AS x(
      codigo TEXT, nome TEXT, tipo TEXT, valor NUMERIC, minimo NUMERIC,
      condicoes JSONB, prioridade INTEGER, observacao TEXT
    )
  `, [tabelaId, JSON.stringify(regrasDados)]);

  return {
    coberturas: coberturaDados.length,
    faixas: faixaDados.length,
    regras: regrasDados.length,
    adicionais_cep: adicionaisCepDados.length,
    diagnostico_chaves: {
      cidades_sec_cat: secCatPorCidade.size,
      cidades_com_multiplas_sec_cat: cidadesComMultiplasSecCat,
      regioes_destino: new Set(coberturaDados.map((item) => item.codigo_regiao)).size,
      cidades_com_tarifa_pdf: new Set(faixaDados.map((item) => `${item.uf}|${item.cidade_normalizada}`)).size,
      sec_cat_por_cep: adicionaisCepDados.filter((item) => item.codigo === 'SEC_CAT' && item.cep_inicio).length,
      faixas_zona_risco: adicionaisCepDados.filter((item) => item.codigo === 'ZONA_RISCO').length,
      faixas_zona_restricao: adicionaisCepDados.filter((item) => item.codigo === 'ZONA_RESTRICAO').length,
      linhas_prazo_ignoradas_por_origem: prazosIgnoradosOutraOrigem
    },
    alertas: [
      'Cobertura, CEPs, prazos e regras gerais foram normalizados para a origem 133/Biguaçu-SC.',
      ...(pdfConferido
        ? ['Tarifa principal de frete-peso reconciliada com o PDF atualizado para Sul, SP, MG, GO e DF.']
        : ['O PDF atualizado não corresponde à versão auditada; a tarifa principal não foi aplicada.']),
      'SEC-CAT e zonas de risco/restrição são aplicadas somente quando cidade, CEP e faixa de peso confirmam a incidência.',
      'TFD, reentrega e devolução permanecem fora da cotação automática porque dependem de eventos operacionais.'
    ]
  };
}

async function persistirFonte(client, fonte, caminho, grupos, sha, fontesAuxiliares = []) {
  const versao = `${new Date(fs.statSync(caminho).mtime).toISOString().slice(0, 10)}-${fonte.sufixo || 'tabela'}-${sha.slice(0, 8)}`;
  const statusTabela = fonte.status || (fonte.tipo === 'pdf' ? 'inativa' : 'em_revisao');
  const transportadora = await client.query(`
    INSERT INTO frete.transportadora (slug, nome)
    VALUES ($1,$2)
    ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = NOW()
    RETURNING id
  `, [fonte.slug, fonte.nome]);
  const finalidadeFonte = fonte.finalidade || (fonte.sufixo === 'tde'
    ? 'Faixas de TDE incorporadas à tabela principal.'
    : fonte.tipo === 'pdf'
      ? 'Tarifas atualizadas incorporadas à tabela principal.'
      : null);
  const tabela = await client.query(`
    INSERT INTO frete.tabela_preco (
      transportadora_id, nome, versao, status, fator_cubagem_kg_m3, arquivo_origem, arquivo_sha256,
      configuracao
    ) VALUES ($1,$2,$3,$4,300,$5,$6,$7::jsonb)
    ON CONFLICT (transportadora_id, versao) DO UPDATE
      SET arquivo_sha256 = EXCLUDED.arquivo_sha256,
          status = EXCLUDED.status,
          atualizado_em = NOW()
    RETURNING id
  `, [transportadora.rows[0].id, `Tabela ${fonte.nome}`, versao, statusTabela, fonte.arquivo, sha, JSON.stringify({
    abas_importadas: grupos.map((g) => g.aba),
    tipo_fonte: (fonte.sufixo || fonte.tipo === 'pdf') ? 'auxiliar' : 'principal',
    finalidade_fonte: finalidadeFonte
  })]);
  const importacao = await client.query(`
    INSERT INTO frete.importacao (tabela_preco_id, arquivo_nome, arquivo_sha256, status)
    VALUES ($1,$2,$3,'processando')
    ON CONFLICT (arquivo_sha256) DO UPDATE SET tabela_preco_id = EXCLUDED.tabela_preco_id
    RETURNING id
  `, [tabela.rows[0].id, fonte.arquivo, sha]);

  await client.query('DELETE FROM frete.importacao_linha WHERE importacao_id = $1', [importacao.rows[0].id]);
  await client.query('DELETE FROM frete.regra_adicional WHERE tabela_preco_id = $1', [tabela.rows[0].id]);
  await client.query('DELETE FROM frete.adicional_cep WHERE tabela_preco_id = $1', [tabela.rows[0].id]);
  await client.query('DELETE FROM frete.tarifa_faixa WHERE tabela_preco_id = $1', [tabela.rows[0].id]);
  await client.query(`
    UPDATE frete.cotacao_resultado
       SET cobertura_id = NULL
     WHERE cobertura_id IN (
       SELECT id FROM frete.cobertura WHERE tabela_preco_id = $1
     )
  `, [tabela.rows[0].id]);
  await client.query('DELETE FROM frete.cobertura WHERE tabela_preco_id = $1', [tabela.rows[0].id]);
  const total = await inserirLinhas(client, importacao.rows[0].id, grupos);
  let normalizacao = { alertas: ['Fonte preservada em staging; regras ainda não normalizadas.'] };
  if (fonte.slug === 'expresso-sao-miguel' && !fonte.sufixo) normalizacao = await normalizarSaoMiguel(client, tabela.rows[0].id, grupos, fontesAuxiliares);
  if (fonte.slug === 'expresso-ejl' && !fonte.sufixo) normalizacao = await normalizarEjl(client, tabela.rows[0].id, grupos, fontesAuxiliares);
  if (fonte.slug === 'fitlog' && !fonte.sufixo) normalizacao = await normalizarFitlogPorCidade(client, tabela.rows[0].id, grupos, fontesAuxiliares);
  if (fonte.slug === 'bristot-rocha') normalizacao = await normalizarBristot(client, tabela.rows[0].id, grupos);
  if (fonte.slug === 'mengue-express') normalizacao = await normalizarMengueCobertura(client, tabela.rows[0].id, grupos);
  if (fonte.slug === 'rodonaves' && fonte.tipo !== 'pdf') normalizacao = await normalizarRodonaves(client, tabela.rows[0].id, grupos, fontesAuxiliares);
  const alertas = normalizacao.alertas || [];
  await client.query(`
    UPDATE frete.importacao
       SET status = $2, total_linhas = $3, linhas_validas = $3, linhas_alerta = $4,
           resumo = $5::jsonb, concluido_em = NOW()
     WHERE id = $1
  `, [importacao.rows[0].id, alertas.length ? 'concluida_com_alertas' : 'concluida', total, alertas.length, JSON.stringify(normalizacao)]);
  return { tabela_id: tabela.rows[0].id, importacao_id: importacao.rows[0].id, total, normalizacao };
}

async function main() {
  if (!diretorio || !fs.existsSync(diretorio)) throw new Error(`Diretório não encontrado: ${diretorio || '(vazio)'}`);
  const fontesPresentes = FONTES.map((fonte) => ({ ...fonte, caminho: path.join(diretorio, fonte.arquivo) })).filter((fonte) => fs.existsSync(fonte.caminho));
  if (!fontesPresentes.length) throw new Error('Nenhuma tabela conhecida foi encontrada no diretório informado.');

  const extraidas = [];
  for (const fonte of fontesPresentes) {
    const grupos = await extrairFonte(fonte, fonte.caminho);
    const sha = hashArquivo(fonte.caminho);
    const perfil = analisar(fonte, fonte.caminho, grupos);
    extraidas.push({ fonte, grupos, sha, perfil });
    console.log(JSON.stringify(perfil));
  }
  if (!aplicar) {
    console.log('\nDRY-RUN: nenhuma escrita realizada. Use --apply para importar ao schema frete.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'sql', '20260728_create_frete_simulador.sql'), 'utf8');
    await client.query(schemaSql);
    await client.query('BEGIN');
    for (const item of extraidas) {
      const fontesAuxiliares = extraidas.filter((candidato) => candidato !== item && candidato.fonte.slug === item.fonte.slug);
      const resultado = await persistirFonte(client, item.fonte, item.fonte.caminho, item.grupos, item.sha, fontesAuxiliares);
      console.log(JSON.stringify({ arquivo: item.fonte.arquivo, ...resultado }));
    }
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(erro.stack || erro.message || erro);
    process.exitCode = 1;
  });
}

module.exports = {
  normalizarFitlogPorCidade,
  normalizarEjl,
  normalizarSaoMiguel
};
