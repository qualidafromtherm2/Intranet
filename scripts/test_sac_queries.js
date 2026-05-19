require('dotenv').config({ path: '/home/leandro/Projetos/intranet/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {

    // QUERY 2
    console.log('\n=== QUERY 2: Amostra sac.at ===');
    const q2 = await client.query(`
      SELECT id, tag_problema, LEFT(descreva_reclamacao, 60) as reclamacao
      FROM sac."at"
      ORDER BY id DESC
      LIMIT 10
    `);
    console.log('Linhas:', q2.rowCount);
    q2.rows.forEach(r => console.log(JSON.stringify(r)));

    // QUERY 3
    console.log('\n=== QUERY 3: Parse O.S ===');
    const q3 = await client.query(`
      SELECT 
        s.id as solicitacao_id,
        s.observacao,
        (REGEXP_MATCH(s.observacao, 'O\\.S\\s+(\\d+)'))[1] as os_num_raw,
        CASE 
          WHEN LENGTH((REGEXP_MATCH(s.observacao, 'O\\.S\\s+(\\d+)'))[1]) >= 6
          THEN CAST(SUBSTRING((REGEXP_MATCH(s.observacao, 'O\\.S\\s+(\\d+)'))[1], 3) AS INTEGER)
          ELSE CAST((REGEXP_MATCH(s.observacao, 'O\\.S\\s+(\\d+)'))[1] AS INTEGER)
        END as at_id_calculado
      FROM envios.solicitacoes s
      WHERE s.observacao ILIKE 'O.S%'
      LIMIT 10
    `);
    console.log('Linhas:', q3.rowCount);
    q3.rows.forEach(r => console.log(JSON.stringify(r)));

    // QUERY 4
    console.log('\n=== QUERY 4: JOIN completo ===');
    const q4 = await client.query(`
      SELECT 
        s.id,
        s.observacao,
        a.id as at_id,
        a.tag_problema,
        LEFT(a.descreva_reclamacao, 80) as reclamacao_trunc
      FROM envios.solicitacoes s
      JOIN sac."at" a ON a.id = (
        CASE 
          WHEN LENGTH((REGEXP_MATCH(s.observacao, 'O\\.S\\s+(\\d+)'))[1]) >= 6
          THEN CAST(SUBSTRING((REGEXP_MATCH(s.observacao, 'O\\.S\\s+(\\d+)'))[1], 3) AS INTEGER)
          ELSE CAST((REGEXP_MATCH(s.observacao, 'O\\.S\\s+(\\d+)'))[1] AS INTEGER)
        END
      )
      WHERE s.observacao ILIKE 'O.S%'
      LIMIT 10
    `);
    console.log('Linhas:', q4.rowCount);
    q4.rows.forEach(r => console.log(JSON.stringify(r)));

  } catch (e) {
    console.error('ERRO:', e.message);
    console.error('Detail:', e.detail || '');
  } finally {
    client.release();
    await pool.end();
  }
}
run();
