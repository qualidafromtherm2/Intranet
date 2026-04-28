require('dotenv').config();
const {Pool} = require('pg');
const p = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    // List all schemas (case-insensitive)
    const schemas = await p.query(`SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`);
    console.log('All schemas:');
    schemas.rows.forEach(s => console.log('  ' + s.schema_name));
    
    await p.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
