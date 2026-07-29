#!/usr/bin/env node
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const { Pool } = require('pg');
const { normalizarTexto } = require('../utils/freteEngine');

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
  { arquivo: 'EXPRESSO EJL.xlsx', slug: 'expresso-ejl', nome: 'Expresso EJL', abas: ['Planilha1'] },
  { arquivo: 'RELAÇÃO DE TDE EXPRESSO EJL.xlsx', slug: 'expresso-ejl', nome: 'Expresso EJL', abas: ['Planilha1'], sufixo: 'tde' },
  { arquivo: 'TABELA FITLOG - ATUAL.xlsx', slug: 'fitlog', nome: 'Fitlog', abas: ['DADOS', 'PADRÃO', 'GENERALIDADES', 'PRAÇA'] },
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
  const coberturaDados = [];
  let divergenciasSiglaComercialPraca = 0;
  for (const linha of base.linhas.filter((item) => item.numero_linha >= 2)) {
    const uf = String(celula(linha, 'A') || '').trim().toUpperCase();
    const cidade = String(celula(linha, 'B') || '').trim();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade) continue;
    const siglaComercial = normalizarTexto(celula(linha, 'K'));
    const siglaPraca = normalizarTexto(celula(linha, 'L'));
    if (siglaComercial && siglaPraca && siglaComercial !== siglaPraca) divergenciasSiglaComercialPraca += 1;
    coberturaDados.push({
      // A tabela tarifaria usa a SIGLA PRACA (L). A praca comercial (K) fica
      // preservada para auditoria e serve apenas de fallback quando L estiver vazia.
      codigo_regiao: siglaPraca || siglaComercial, uf, cidade,
      cidade_normalizada: normalizarTexto(cidade), codigo_ibge: Number(celula(linha, 'E')) || null,
      cep_inicio: Number(String(celula(linha, 'C') || '').replace(/\D/g, '')) || null,
      cep_fim: Number(String(celula(linha, 'D') || '').replace(/\D/g, '')) || null,
      prazo_min: Number(celula(linha, 'F')) || null, prazo_max: Number(celula(linha, 'G')) || null,
      frequencia: celula(linha, 'H') || null, tde: null,
      trt: null, observacao: celula(linha, 'N') || null,
      metadados: { tde_fonte: celula(linha, 'I'), trt_fonte: celula(linha, 'J'), sigla_praca_comercial: celula(linha, 'K'), sigla_praca: celula(linha, 'L'), sigla_unidade: celula(linha, 'M') }
    });
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
    const regioes = String(celula(linha, 'C') || '').split(',').map((item) => normalizarTexto(item)).filter(Boolean);
    if (!regioes.length) continue;
    const adValorem = Number(celula(linha, 'V')) / 100 || null;
    const despacho = Number(celula(linha, 'P')) || null;
    const pedagio = Number(celula(linha, 'N')) || null;
    const gris = Number(celula(linha, 'Q')) / 100 || null;
    const grisMinimo = Number(celula(linha, 'R')) || null;
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
          ad_valorem: adValorem, despacho, pedagio,
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
          peso_referencia: ultimoLimite, ad_valorem: adValorem, despacho, pedagio,
          metadados: { arquivo_linha: linha.numero_linha, excedente_por_kg: true, valor_tonelada: valorToneladaExcedente, faixa_tipo: celula(linha, 'X'), aplica_se: celula(linha, 'M'), pos: celula(linha, 'S'), pos_minimo: celula(linha, 'T'), cod_mercad: celula(linha, 'D') }
        });
      }
      if (gris) regrasDados.push({ codigo: `GRIS_${codigoRegiao}`, nome: 'GRIS', tipo: 'maior_entre_percentual_e_minimo', valor: gris, minimo: grisMinimo, condicoes: { codigos_regiao: [codigoRegiao] }, prioridade: 20, observacao: `Linha ${linha.numero_linha} da TABELA MENGUE SSW.` });
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
      divergencias_sigla_comercial_praca: divergenciasSiglaComercialPraca,
      regioes_sem_tarifa: regioesSemTarifa,
      tarifas_sem_cobertura: tarifasSemCobertura
    },
    alertas: ['Prévia parcial: POS, TDE, TRT, TDE mínimo, TAR mínimo, APLICA-SE e COD_MERCAD permanecem apenas nos metadados até validação.']
  };
}

function numeroCep(valor) {
  const digitos = String(valor || '').replace(/\D/g, '');
  return /^\d{8}$/.test(digitos) ? Number(digitos) : null;
}

function frequenciaRodonaves(linha) {
  const dias = [['J', 'seg'], ['K', 'ter'], ['L', 'qua'], ['M', 'qui'], ['N', 'sex']]
    .filter(([coluna]) => String(celula(linha, coluna) || '').trim().toUpperCase() === 'S')
    .map(([, nome]) => nome);
  const vezes = Number(celula(linha, 'I')) || dias.length || null;
  if (!vezes && !dias.length) return null;
  return `${vezes || dias.length}x/semana${dias.length ? ` (${dias.join(', ')})` : ''}`;
}

async function normalizarRodonaves(client, tabelaId, grupos) {
  const prazosGrupo = grupos.find((grupo) => grupo.aba === 'Planilha7');
  const secCatGrupo = grupos.find((grupo) => grupo.aba === 'Tarifas Cidade Coleta-Entrega');
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
    const faixas = adicionaisCidade.length ? adicionaisCidade : [null];
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
    faixas: 0,
    regras: regrasDados.length,
    diagnostico_chaves: {
      cidades_sec_cat: secCatPorCidade.size,
      cidades_com_multiplas_sec_cat: cidadesComMultiplasSecCat,
      regioes_destino: new Set(coberturaDados.map((item) => item.codigo_regiao)).size,
      linhas_prazo_ignoradas_por_origem: prazosIgnoradosOutraOrigem
    },
    alertas: [
      'Cobertura, CEPs, prazos e regras gerais foram normalizados para a origem 133/Biguaçu-SC.',
      'A fonte não contém a tarifa principal de frete-peso; a Rodonaves permanece sem valor total até essa tabela ser fornecida.',
      'SEC-CAT, zona de risco, zona de restrição, TFD, reentrega e devolução permanecem em metadados ou staging e não são aplicados automaticamente.'
    ]
  };
}

async function persistirFonte(client, fonte, caminho, grupos, sha) {
  const versao = `${new Date(fs.statSync(caminho).mtime).toISOString().slice(0, 10)}-${fonte.sufixo || 'tabela'}-${sha.slice(0, 8)}`;
  const statusTabela = fonte.tipo === 'pdf' ? 'inativa' : 'em_revisao';
  const transportadora = await client.query(`
    INSERT INTO frete.transportadora (slug, nome)
    VALUES ($1,$2)
    ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, atualizado_em = NOW()
    RETURNING id
  `, [fonte.slug, fonte.nome]);
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
  `, [transportadora.rows[0].id, `Tabela ${fonte.nome}`, versao, statusTabela, fonte.arquivo, sha, JSON.stringify({ abas_importadas: grupos.map((g) => g.aba) })]);
  const importacao = await client.query(`
    INSERT INTO frete.importacao (tabela_preco_id, arquivo_nome, arquivo_sha256, status)
    VALUES ($1,$2,$3,'processando')
    ON CONFLICT (arquivo_sha256) DO UPDATE SET tabela_preco_id = EXCLUDED.tabela_preco_id
    RETURNING id
  `, [tabela.rows[0].id, fonte.arquivo, sha]);

  await client.query('DELETE FROM frete.importacao_linha WHERE importacao_id = $1', [importacao.rows[0].id]);
  await client.query('DELETE FROM frete.regra_adicional WHERE tabela_preco_id = $1', [tabela.rows[0].id]);
  await client.query('DELETE FROM frete.tarifa_faixa WHERE tabela_preco_id = $1', [tabela.rows[0].id]);
  await client.query('DELETE FROM frete.cobertura WHERE tabela_preco_id = $1', [tabela.rows[0].id]);
  const total = await inserirLinhas(client, importacao.rows[0].id, grupos);
  let normalizacao = { alertas: ['Fonte preservada em staging; regras ainda não normalizadas.'] };
  if (fonte.slug === 'bristot-rocha') normalizacao = await normalizarBristot(client, tabela.rows[0].id, grupos);
  if (fonte.slug === 'mengue-express') normalizacao = await normalizarMengueCobertura(client, tabela.rows[0].id, grupos);
  if (fonte.slug === 'rodonaves' && fonte.tipo !== 'pdf') normalizacao = await normalizarRodonaves(client, tabela.rows[0].id, grupos);
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
      const resultado = await persistirFonte(client, item.fonte, item.fonte.caminho, item.grupos, item.sha);
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

main().catch((erro) => {
  console.error(erro.stack || erro.message || erro);
  process.exitCode = 1;
});
