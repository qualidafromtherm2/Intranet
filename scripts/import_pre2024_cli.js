#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { isDbEnabled } = require('../src/db');
const { PRE2024_COLUMNS, mapPre2024Rows, pre2024ToDate } = require('../src/pre2024');

// Criar pool de conexão
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
});

async function main() {
  if (!isDbEnabled) {
    throw new Error('DATABASE_URL não configurada. Configure o banco e tente novamente.');
  }

  const args = process.argv.slice(2);

  let filePath = null;
  let limit = null;
  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      return;
    } else if (arg.startsWith('--limit=')) {
      const parsed = Number(arg.slice('--limit='.length));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('O parâmetro --limit deve ser um número positivo.');
      }
      limit = parsed;
    }
  }

  if (!filePath) {
    throw new Error('Informe o caminho do arquivo com --file="caminho/arquivo.xlsx"');
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Arquivo não encontrado: ${resolvedPath}`);
  }

  console.log('-> Lendo planilha', resolvedPath);
  const workbook = XLSX.readFile(resolvedPath, { cellDates: true });
  const sheet = workbook.Sheets['PEDIDOS'];
  if (!sheet) {
    throw new Error('A planilha precisa conter a aba "PEDIDOS".');
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, { range: 1, defval: null });
  let mappedRows = mapPre2024Rows(rawRows);
  if (limit) {
    mappedRows = mappedRows.slice(0, limit);
  console.log(`-> Aplicado limite de ${limit} linhas para execução de teste.`);
  }

  if (!mappedRows.length) {
    console.warn('Nenhuma linha válida encontrada para inserir. Encerrando.');
    return;
  }

    console.log(`-> ${mappedRows.length} linhas válidas preparadas para inserção.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('-> Preparando chaves únicas para DELETE em lote...');
    
    // Coletar todas as chaves únicas para fazer DELETE em lote
    const keysToDelete = mappedRows.map(row => ({
      pedido: row.pedido,
      modelo: row.modelo,
      ano: row.ano,
      data_entrada_pedido: row.data_entrada_pedido
    }));
    
    // Montar query de DELETE em lote usando ANY
    let deletedCount = 0;
    if (keysToDelete.length > 0) {
      const deleteQuery = `
        DELETE FROM public.historico_pre2024
        WHERE (pedido, modelo, ano, COALESCE(data_entrada_pedido, '1900-01-01'::date)) IN (
          SELECT * FROM unnest($1::text[], $2::text[], $3::integer[], $4::date[])
        )
      `;
      
      const pedidos = keysToDelete.map(k => k.pedido);
      const modelos = keysToDelete.map(k => k.modelo);
      const anos = keysToDelete.map(k => k.ano);
      const datas = keysToDelete.map(k => k.data_entrada_pedido || '1900-01-01');
      
      const deleteResult = await client.query(deleteQuery, [pedidos, modelos, anos, datas]);
      deletedCount = deleteResult.rowCount;
      console.log(`-> ${deletedCount} registros existentes removidos.`);
    }

    console.log('-> Iniciando INSERT em lote...');
    
    // INSERT em batches de 100 para evitar timeout
    const BATCH_SIZE = 100;
    let insertedCount = 0;
    
    for (let batchStart = 0; batchStart < mappedRows.length; batchStart += BATCH_SIZE) {
      const batch = mappedRows.slice(batchStart, batchStart + BATCH_SIZE);
      
      // Validação final: garantir que valores de data são DATE válidos ou NULL
      const dateColumns = ['data_entrada_pedido', 'data_aprovacao_pedido', 'data_op', 'data_prevista_entrega',
                           'data_entrega', 'data_pagto', 'data_entrega_dashboard', 'data_entrada_pedido_alt'];
      for (const row of batch) {
        for (const col of dateColumns) {
          const val = row[col];
          // Se não for null e não for uma string no formato YYYY-MM-DD, limpar
          if (val !== null && val !== undefined) {
            if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
              console.log(`[AVISO] Limpando valor inválido em ${col}: "${val}" (tipo: ${typeof val})`);
              row[col] = null;
            }
          }
        }
      }
      
      // Montar INSERT com múltiplos VALUES
      const colNames = PRE2024_COLUMNS.join(', ');
      const valuesClauses = [];
      const allValues = [];
      
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const offset = i * PRE2024_COLUMNS.length;
        const placeholders = PRE2024_COLUMNS.map((_, idx) => `$${offset + idx + 1}`).join(', ');
        valuesClauses.push(`(${placeholders})`);
        
        const rowValues = PRE2024_COLUMNS.map(col => row[col]);
        allValues.push(...rowValues);
      }
      
      const insertQuery = `
        INSERT INTO public.historico_pre2024 (${colNames})
        VALUES ${valuesClauses.join(', ')}
      `;
      
      try {
        await client.query(insertQuery, allValues);
      } catch (err) {
        console.log(`\n[DEBUG] Erro no batch ${batchStart}-${batchStart+batch.length}:`);
        console.log(`Mensagem do erro: ${err.message}`);
        console.log('\nProcurando valores com "+" no batch...');
        for (let i = 0; i < batch.length; i++) {
          const row = batch[i];
          for (const [col, val] of Object.entries(row)) {
            if (val && typeof val === 'string' && val.includes('+')) {
              console.log(`  Linha ${batchStart + i} (${i} no batch), coluna ${col}: "${val}"`);
            }
          }
        }
        throw err;
      }
      
      insertedCount += batch.length;
      
      // Log de progresso a cada batch
      const progress = Math.min(batchStart + BATCH_SIZE, mappedRows.length);
      const percent = ((progress / mappedRows.length) * 100).toFixed(1);
      console.log(`   ${progress}/${mappedRows.length} (${percent}%) processados...`);
    }

    await client.query('COMMIT');
    console.log(`\n✓ Importação concluída com sucesso!`);
    console.log(`  - ${deletedCount} registros existentes removidos`);
    console.log(`  - ${insertedCount} novos registros inseridos`);
    
    await pool.end();
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✖ Erro durante a importação, transação revertida.');
    console.error(err.message);
    
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }
}

function printHelp() {
  console.log(`Uso: node scripts/import_pre2024_cli.js --file="caminho/para/planilha.xlsx" [--limit=N]

Opções:
  --file   Caminho para o arquivo XLSX que contém a aba PEDIDOS (obrigatório)
  --limit  Processa apenas N linhas (útil para testes)      
  -h, --help  Exibe esta ajuda
`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
