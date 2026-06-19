#!/usr/bin/env node
/**
 * Importa dados do CSV para qualidade.lista_mestra
 * Uso: node scripts/importar_lista_mestra.js [caminho-csv]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { dbQuery, pool } = require('../src/db');

const CSV_DEFAULT = '/home/leandro/Downloads/lista mestra.csv';

async function ensureSchema() {
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS qualidade`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade.lista_mestra (
      id SERIAL PRIMARY KEY,
      numero_formulario TEXT NOT NULL,
      descricao TEXT,
      tipo_documento TEXT,
      formato TEXT,
      classificacao TEXT,
      autor TEXT,
      numero_revisao TEXT,
      data_criacao TEXT,
      revisado TEXT,
      revisado_por TEXT,
      proxima_revisao TEXT,
      responsavel_arquivar_eliminar TEXT,
      tempo_retencao TEXT,
      status TEXT,
      data_arquivamento TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbQuery(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_qualidade_lista_mestra_numero
      ON qualidade.lista_mestra (numero_formulario)
  `);
}

function limpar(val) {
  const s = String(val ?? '').trim();
  return s || null;
}

function mapearLinha(row) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return limpar(row[k]);
      }
    }
    return null;
  };

  const numero = get('Numero do formulario', 'Número do formulario', 'numero_formulario');
  if (!numero) return null;

  return {
    numero_formulario: numero,
    descricao: get('Descrição', 'Descricao'),
    tipo_documento: get('Tipo de documento'),
    formato: get('Formato'),
    classificacao: get('Classificação', 'Classificacao'),
    autor: get('Autor'),
    numero_revisao: get('N° da Rev.', 'Nº da Rev.'),
    data_criacao: get('Data de criação', 'Data de criacao'),
    revisado: get('Revisado'),
    revisado_por: get('Revisado por'),
    proxima_revisao: get('Próxima Revisão', 'Proxima Revisao'),
    responsavel_arquivar_eliminar: get('Responsável por arquivar e eliminar', 'Responsavel por arquivar e eliminar'),
    tempo_retencao: get('Tempo de Retenção', 'Tempo de \nRetenção', 'Tempo de Retencao'),
    status: get('Status'),
    data_arquivamento: get('Data de arquivamento')
  };
}

async function main() {
  const csvPath = process.argv[2] || CSV_DEFAULT;
  if (!fs.existsSync(csvPath)) {
    console.error('Arquivo não encontrado:', csvPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true
  });

  await ensureSchema();

  let inseridos = 0;
  let atualizados = 0;
  let ignorados = 0;

  for (const row of rows) {
    const item = mapearLinha(row);
    if (!item) {
      ignorados++;
      continue;
    }

    const existing = await dbQuery(
      'SELECT id FROM qualidade.lista_mestra WHERE numero_formulario = $1',
      [item.numero_formulario]
    );

    if (existing.rows.length) {
      await dbQuery(
        `UPDATE qualidade.lista_mestra SET
          descricao = $1, tipo_documento = $2, formato = $3, classificacao = $4,
          autor = $5, numero_revisao = $6, data_criacao = $7, revisado = $8,
          revisado_por = $9, proxima_revisao = $10, responsavel_arquivar_eliminar = $11,
          tempo_retencao = $12, status = $13, data_arquivamento = $14, atualizado_em = NOW()
         WHERE numero_formulario = $15`,
        [
          item.descricao, item.tipo_documento, item.formato, item.classificacao,
          item.autor, item.numero_revisao, item.data_criacao, item.revisado,
          item.revisado_por, item.proxima_revisao, item.responsavel_arquivar_eliminar,
          item.tempo_retencao, item.status, item.data_arquivamento,
          item.numero_formulario
        ]
      );
      atualizados++;
    } else {
      await dbQuery(
        `INSERT INTO qualidade.lista_mestra (
          numero_formulario, descricao, tipo_documento, formato, classificacao,
          autor, numero_revisao, data_criacao, revisado, revisado_por, proxima_revisao,
          responsavel_arquivar_eliminar, tempo_retencao, status, data_arquivamento
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          item.numero_formulario, item.descricao, item.tipo_documento, item.formato,
          item.classificacao, item.autor, item.numero_revisao, item.data_criacao,
          item.revisado, item.revisado_por, item.proxima_revisao,
          item.responsavel_arquivar_eliminar, item.tempo_retencao, item.status,
          item.data_arquivamento
        ]
      );
      inseridos++;
    }
  }

  const total = await dbQuery('SELECT COUNT(*)::int AS n FROM qualidade.lista_mestra');
  console.log(JSON.stringify({
    csv: csvPath,
    linhas_csv: rows.length,
    inseridos,
    atualizados,
    ignorados,
    total_tabela: total.rows[0]?.n || 0
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool?.end?.());
