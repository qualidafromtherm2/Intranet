require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const raw = fs.readFileSync('/home/leandro/Downloads/codigos_de_erros.csv', 'utf8');
const linhas = raw.split('\n').slice(1).filter(l => l.trim());

function parseCSVLine(line) {
  const cols = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

const registros = linhas.map(l => {
  const parts = parseCSVLine(l);
  return {
    codigo:           (parts[0] || '').trim(),
    analise:          (parts[1] || '').trim() || null,
    solucao_problema: (parts[2] || '').trim() || null,
  };
}).filter(r => r.codigo);

console.log('Total de registros a importar:', registros.length);

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const r of registros) {
      await client.query(
        `INSERT INTO engenharia.codigos_erro (codigo, analise, solucao_problema, criado_por)
         VALUES ($1, $2, $3, 'importacao_csv')`,
        [r.codigo, r.analise, r.solucao_problema]
      );
      count++;
    }
    await client.query('COMMIT');
    console.log('Importados com sucesso:', count, 'registros.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Erro — rollback:', e.message);
  } finally {
    client.release();
    pool.end();
  }
})();
