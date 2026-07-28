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

async function normalizarBristot(client, tabelaId, grupos) {
  const coberturaGrupo = grupos.find((grupo) => grupo.aba === 'Cidades Prazos x Classificação');
  const tarifaGrupo = grupos.find((grupo) => grupo.aba === 'Tarifas');
  if (!coberturaGrupo || !tarifaGrupo) return { coberturas: 0, faixas: 0, alertas: ['Abas obrigatórias da Bristot ausentes.'] };
  let ufOrigem = null;
  let cidadeOrigem = null;
  let ibgeOrigem = null;
  const coberturaDados = [];
  for (const linha of coberturaGrupo.linhas.filter((item) => item.numero_linha >= 2)) {
    ufOrigem = celula(linha, 'A') || ufOrigem;
    cidadeOrigem = celula(linha, 'B') || cidadeOrigem;
    ibgeOrigem = celula(linha, 'C') || ibgeOrigem;
    const uf = String(celula(linha, 'D') || '').trim().toUpperCase();
    const cidade = String(celula(linha, 'E') || '').trim();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade) continue;
    coberturaDados.push({
      codigo_regiao: normalizarTexto(celula(linha, 'J')), uf, cidade, cidade_normalizada: normalizarTexto(cidade),
      codigo_ibge: Number(celula(linha, 'F')) || null, prazo: Number(celula(linha, 'H')) || null,
      tde: Number(celula(linha, 'I')) || null,
      metadados: { uf_origem: ufOrigem, cidade_origem: cidadeOrigem, codigo_ibge_origem: ibgeOrigem, distancia_km: celula(linha, 'G') }
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
  for (const linha of tarifaGrupo.linhas.filter((item) => item.numero_linha >= 9)) {
    const codigoRegiao = normalizarTexto(celula(linha, 'C') || celula(linha, 'B'));
    if (!codigoRegiao) continue;
    const adValorem = Number(celula(linha, 'L')) || null;
    const despacho = Number(celula(linha, 'M')) || null;
    let anterior = 0;
    for (let i = 0; i < colunas.length; i += 1) {
      const valor = Number(celula(linha, colunas[i]));
      if (!(valor >= 0)) continue;
      faixaDados.push({ codigo_regiao: codigoRegiao, peso_de: anterior, peso_ate: limites[i], valor_base: valor,
        valor_excedente: null, peso_referencia: null, ad_valorem: adValorem, despacho,
        metadados: { arquivo_linha: linha.numero_linha } });
      anterior = limites[i];
    }
    const excedente = Number(celula(linha, 'K'));
    const valor100 = Number(celula(linha, 'J'));
    if (excedente > 0 && valor100 >= 0) {
      faixaDados.push({ codigo_regiao: codigoRegiao, peso_de: 100, peso_ate: null, valor_base: valor100,
        valor_excedente: excedente, peso_referencia: 100, ad_valorem: adValorem, despacho,
        metadados: { arquivo_linha: linha.numero_linha, excedente: true } });
    }
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
  return { coberturas: coberturaDados.length, faixas: faixaDados.length, alertas: ['Tabela mantida em revisão até validar generalidades, incidência de TDA e arredondamento.'] };
}

async function normalizarMengueCobertura(client, tabelaId, grupos) {
  const base = grupos.find((grupo) => grupo.aba === 'BD CIDADE+PRAÇA+TAXAS+FREQ+PREV');
  if (!base) return { coberturas: 0, alertas: ['Base de cidades Mengue ausente.'] };
  const coberturaDados = [];
  for (const linha of base.linhas.filter((item) => item.numero_linha >= 2)) {
    const uf = String(celula(linha, 'A') || '').trim().toUpperCase();
    const cidade = String(celula(linha, 'B') || '').trim();
    if (!/^[A-Z]{2}$/.test(uf) || !cidade) continue;
    coberturaDados.push({
      codigo_regiao: normalizarTexto(celula(linha, 'L') || celula(linha, 'K')), uf, cidade,
      cidade_normalizada: normalizarTexto(cidade), codigo_ibge: Number(celula(linha, 'E')) || null,
      cep_inicio: Number(String(celula(linha, 'C') || '').replace(/\D/g, '')) || null,
      cep_fim: Number(String(celula(linha, 'D') || '').replace(/\D/g, '')) || null,
      prazo_min: Number(celula(linha, 'F')) || null, prazo_max: Number(celula(linha, 'G')) || null,
      frequencia: celula(linha, 'H') || null, tde: Number(celula(linha, 'I')) || null,
      trt: Number(celula(linha, 'J')) || null, observacao: celula(linha, 'N') || null,
      metadados: { sigla_praca_comercial: celula(linha, 'K'), sigla_praca: celula(linha, 'L'), sigla_unidade: celula(linha, 'M') }
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
  return { coberturas: coberturaDados.length, alertas: ['Cobertura e prazo importados; preços permanecem em revisão até validar COD_MERCAD, SOMA e faixas da tabela SSW.'] };
}

async function persistirFonte(client, fonte, caminho, grupos, sha) {
  const versao = `${new Date(fs.statSync(caminho).mtime).toISOString().slice(0, 10)}-${fonte.sufixo || 'tabela'}-${sha.slice(0, 8)}`;
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
    ) VALUES ($1,$2,$3,'em_revisao',300,$4,$5,$6::jsonb)
    ON CONFLICT (transportadora_id, versao) DO UPDATE SET arquivo_sha256 = EXCLUDED.arquivo_sha256, atualizado_em = NOW()
    RETURNING id
  `, [transportadora.rows[0].id, `Tabela ${fonte.nome}`, versao, fonte.arquivo, sha, JSON.stringify({ abas_importadas: grupos.map((g) => g.aba) })]);
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
