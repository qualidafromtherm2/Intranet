require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

function buildDbConfig() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_INTERNAL_URL ||
    null;

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
    };
  }

  const host = process.env.DB_HOST || process.env.PGHOST;
  const port = process.env.DB_PORT || process.env.PGPORT;
  const database = process.env.DB_NAME || process.env.PGDATABASE;
  const user = process.env.DB_USER || process.env.PGUSER;
  const password = process.env.DB_PASSWORD || process.env.PGPASSWORD;
  const sslEnabled = String(process.env.DB_SSL || process.env.PGSSLMODE || '')
    .toLowerCase()
    .includes('true');

  if (!host || !port || !database || !user) {
    throw new Error(
      'Variáveis de conexão ausentes. Use DATABASE_URL ou DB_HOST/DB_PORT/DB_NAME/DB_USER.'
    );
  }

  const config = {
    host,
    port: Number(port),
    database,
    user,
    password,
  };

  if (sslEnabled) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

async function main() {
  const defaultSqlPath = path.resolve(__dirname, '..', 'atualizar.sql');
  const sqlArg = process.argv[2];
  const sqlPath = sqlArg
    ? path.resolve(process.cwd(), sqlArg)
    : defaultSqlPath;

  const sql = await fs.readFile(sqlPath, 'utf8');
  if (!sql.trim()) {
    throw new Error(`Arquivo SQL vazio: ${sqlPath}`);
  }

  const pool = new Pool(buildDbConfig());

  try {
    await pool.query(sql);
    console.log(`SQL aplicado com sucesso: ${sqlPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Falha ao aplicar SQL:', error.message);
  process.exitCode = 1;
});
