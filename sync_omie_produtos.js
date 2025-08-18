// sync_omie_produtos.js
// Sincroniza TODOS os produtos via ListarProdutos (paginado) e insere no Postgres
// Requisitos: Node 18+, pacote 'pg' instalado

import { Client } from 'pg';

// ======= CONFIG via variáveis de ambiente =======
// OMIE
const OMIE_APP_KEY    = process.env.OMIE_APP_KEY    || 'COLOQUE_SUA_APP_KEY_AQUI';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || 'COLOQUE_SUA_APP_SECRET_AQUI';

// POSTGRES
const PGHOST = process.env.PGHOST || 'dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com';
const PGDATABASE = process.env.PGDATABASE || 'intranet_db_yd0w';
const PGUSER = process.env.PGUSER || 'intranet_db_yd0w_user';
const PGPASSWORD = process.env.PGPASSWORD || 'COLOQUE_SUA_SENHA_AQUI';
const PGPORT = process.env.PGPORT || 5432;

// ======= AJUSTES =======
const REGISTROS_POR_PAGINA = 50; // mantenha 50 (valor seguro p/ Omie)
const BASE_URL = 'https://app.omie.com.br/api/v1/geral/produtos/';
const DELAY_MS = 250;            // pequeno intervalo entre requisições
const MAX_RETRIES = 3;           // tentativas em caso de erro/transiente

// ======= HELPERS =======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function postOmieListarProdutos(pagina) {
  const body = {
    call: 'ListarProdutos',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      pagina,
      registros_por_pagina: REGISTROS_POR_PAGINA,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    }]
  };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} - ${txt}`);
  }
  return res.json();
}

async function importarPaginaNoPostgres(pg, payload) {
  // passa o payload inteiro como jsonb p/ a função que você criou
  const q = 'SELECT omie_import_listarprodutos($1::jsonb) AS itens_processados;';
  const { rows } = await pg.query(q, [payload]);
  return rows?.[0]?.itens_processados ?? 0;
}

// ======= MAIN =======
async function main() {
  // 0) valida credenciais
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    console.error('❌ OMIE_APP_KEY / OMIE_APP_SECRET não configurados.');
    process.exit(1);
  }

  const pg = new Client({ host: PGHOST, database: PGDATABASE, user: PGUSER, password: PGPASSWORD, port: PGPORT, ssl: { rejectUnauthorized: false }});
  await pg.connect();

  try {
    // 1) pega a 1ª página para saber total
    let pagina = 1;
    let tentativa = 0;
    let payload = null;

    while (true) {
      try {
        console.log(`🔎 Buscando página ${pagina} na Omie...`);
        payload = await postOmieListarProdutos(pagina);
        break;
      } catch (err) {
        tentativa++;
        if (tentativa > MAX_RETRIES) throw err;
        console.warn(`⚠️ Erro na página ${pagina}, tentativa ${tentativa}/${MAX_RETRIES}: ${err.message}`);
        await sleep(1000 * tentativa);
      }
    }

    const totalPaginas = Number(payload?.total_de_paginas ?? 1);
    const totalRegistros = Number(payload?.total_de_registros ?? 0);
    console.log(`📄 Total de páginas: ${totalPaginas} | Registros: ${totalRegistros}`);

    // 2) importa a 1ª página
    let totalImportado = 0;
    let count = await importarPaginaNoPostgres(pg, payload);
    totalImportado += count;
    console.log(`✅ Página ${pagina} importada: ${count} itens (acumulado: ${totalImportado})`);
    await sleep(DELAY_MS);

    // 3) loop nas demais páginas
    for (pagina = 2; pagina <= totalPaginas; pagina++) {
      tentativa = 0;
      let ok = false;

      while (!ok) {
        try {
          payload = await postOmieListarProdutos(pagina);
          ok = true;
        } catch (err) {
          tentativa++;
          if (tentativa > MAX_RETRIES) throw err;
          console.warn(`⚠️ Erro na página ${pagina}, tentativa ${tentativa}/${MAX_RETRIES}: ${err.message}`);
          await sleep(1000 * tentativa);
        }
      }

      count = await importarPaginaNoPostgres(pg, payload);
      totalImportado += count;
      console.log(`✅ Página ${pagina} importada: ${count} itens (acumulado: ${totalImportado})`);

      await sleep(DELAY_MS);
    }

    console.log(`🎉 Concluído! Total importado: ${totalImportado} itens.`);
  } finally {
    await pg.end();
  }
}

main().catch(err => {
  console.error('❌ Falha geral:', err);
  process.exit(1);
});
