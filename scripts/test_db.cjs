// scripts/test_db.cjs (CJS)
const { dbQuery, isDbEnabled } = require('../src/db.js');

(async () => {
  try {
    if (!isDbEnabled) {
      console.error('DB desabilitado: defina DATABASE_URL no .env');
      process.exit(1);
    }
    const { rows } = await dbQuery('SELECT 1 AS ok');
    console.log('DB OK:', rows);
    process.exit(0);
  } catch (err) {
    console.error('Erro ao testar DB:', err.message);
    process.exit(1);
  }
})();
