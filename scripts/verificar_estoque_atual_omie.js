#!/usr/bin/env node
/**
 * Compara logistica.estoque_atual com a posição atual da Omie (ListarPosEstoque).
 * Rate limit: 4 req/s (250 ms entre chamadas).
 *
 * Uso:
 *   node scripts/verificar_estoque_atual_omie.js
 *   node scripts/verificar_estoque_atual_omie.js --corrigir   # upsert divergências a favor da Omie
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const CORRIGIR = process.argv.includes('--corrigir');
const PER_PAGE = 200;
const DELAY_MS = 250; // 4 req/s
const EPS = 0.0001;

if (!DATABASE_URL || !OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('DATABASE_URL, OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórios.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hojeBR = () => new Date().toLocaleDateString('pt-BR');
const num = (v) => Number(v) || 0;
const eq = (a, b) => Math.abs(num(a) - num(b)) < EPS;

const UPSERT_SQL = `
  INSERT INTO logistica.estoque_atual
    (local_codigo, local_nome, omie_prod_id, codigo, cod_int, descricao,
     saldo, fisico, reservado, pendente, estoque_minimo, cmc, preco_unitario,
     updated_at, origem)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), $14)
  ON CONFLICT ON CONSTRAINT uq_estoque_atual_prod_local
  DO UPDATE SET
    local_nome     = COALESCE(EXCLUDED.local_nome, logistica.estoque_atual.local_nome),
    omie_prod_id   = COALESCE(EXCLUDED.omie_prod_id, logistica.estoque_atual.omie_prod_id),
    cod_int        = COALESCE(EXCLUDED.cod_int, logistica.estoque_atual.cod_int),
    descricao      = COALESCE(EXCLUDED.descricao, logistica.estoque_atual.descricao),
    saldo          = EXCLUDED.saldo,
    fisico         = EXCLUDED.fisico,
    reservado      = EXCLUDED.reservado,
    pendente       = EXCLUDED.pendente,
    estoque_minimo = EXCLUDED.estoque_minimo,
    cmc            = EXCLUDED.cmc,
    preco_unitario = EXCLUDED.preco_unitario,
    updated_at     = now(),
    origem         = EXCLUDED.origem
`;

async function omieListarPagina(localCodigo, pagina, dataBR) {
  const payload = {
    call: 'ListarPosEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      nPagina: pagina,
      nRegPorPagina: PER_PAGE,
      dDataPosicao: dataBR,
      cExibeTodos: 'N',
      codigo_local_estoque: Number(localCodigo),
    }],
  };
  const resp = await fetch('https://app.omie.com.br/api/v1/estoque/consulta/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (json.faultstring) {
    const msg = String(json.faultstring);
    if (/Não existem registros|nenhum registro|0019/i.test(msg)) {
      return { produtos: [], nTotPaginas: 0, nTotRegistros: 0 };
    }
    if (/redundante|8020/i.test(msg)) {
      await sleep(5000);
      return omieListarPagina(localCodigo, pagina, dataBR);
    }
    throw new Error(`Omie local ${localCodigo} p${pagina}: ${msg}`);
  }
  return json;
}

async function buscarOmieLocal(localCodigo, dataBR) {
  const mapa = new Map();
  const r0 = await omieListarPagina(localCodigo, 1, dataBR);
  await sleep(DELAY_MS);
  const paginas = Math.max(1, Number(r0.nTotPaginas || 1));
  const coletar = (arr) => {
    for (const p of (arr || [])) {
      if (Number(p.codigo_local_estoque) !== Number(localCodigo)) continue;
      const codigo = String(p.cCodigo || '').trim();
      if (!codigo) continue;
      mapa.set(codigo, {
        omie_prod_id: Number(p.nCodProd) || null,
        cod_int: p.cCodInt || null,
        descricao: p.cDescricao || null,
        saldo: num(p.nSaldo),
        fisico: num(p.fisico),
        reservado: num(p.reservado),
        pendente: num(p.nPendente),
        estoque_minimo: num(p.estoque_minimo),
        cmc: num(p.nCMC),
        preco_unitario: num(p.nPrecoUnitario),
      });
    }
  };
  coletar(r0.produtos);
  for (let pg = 2; pg <= paginas; pg++) {
    const r = await omieListarPagina(localCodigo, pg, dataBR);
    await sleep(DELAY_MS);
    coletar(r.produtos);
  }
  return mapa;
}

function temSaldo(row) {
  return num(row.fisico) !== 0 || num(row.saldo) !== 0 || num(row.reservado) !== 0 || num(row.pendente) !== 0;
}

function diffCampos(db, om) {
  const campos = [];
  if (!eq(db.saldo, om.saldo)) campos.push(`saldo ${db.saldo}→${om.saldo}`);
  if (!eq(db.fisico, om.fisico)) campos.push(`fisico ${db.fisico}→${om.fisico}`);
  if (!eq(db.reservado, om.reservado)) campos.push(`reservado ${db.reservado}→${om.reservado}`);
  if (!eq(db.pendente, om.pendente)) campos.push(`pendente ${db.pendente}→${om.pendente}`);
  return campos;
}

async function main() {
  const dataBR = hojeBR();
  console.log('='.repeat(72));
  console.log(`Verificação estoque_atual × Omie — data ${dataBR}`);
  console.log(CORRIGIR ? 'Modo: CORRIGIR divergências (Omie prevalece)' : 'Modo: somente leitura');
  console.log('='.repeat(72));

  const { rows: locais } = await pool.query(`
    SELECT local_codigo, nome
      FROM omie_locais_estoque
     WHERE ativo = TRUE
     ORDER BY local_codigo
  `);
  if (!locais.length) {
    console.error('Nenhum local ativo em omie_locais_estoque.');
    process.exit(1);
  }

  const relatorio = {
    data: dataBR,
    locais: [],
    totais: {
      omie_com_saldo: 0,
      db_com_saldo: 0,
      ok: 0,
      valor_diferente: 0,
      so_no_banco: 0,
      so_na_omie: 0,
      corrigidos: 0,
    },
    divergencias: [],
  };

  let chamadas = 0;

  for (const loc of locais) {
    const localCodigo = String(loc.local_codigo);
    const localNome = loc.nome || null;
    console.log(`\nLocal ${localCodigo} (${localNome || '—'})...`);

    const omieMap = await buscarOmieLocal(localCodigo, dataBR);
    chamadas += Math.max(1, Math.ceil(omieMap.size / PER_PAGE));

    const { rows: dbRows } = await pool.query(
      `SELECT codigo, omie_prod_id, cod_int, descricao, saldo, fisico, reservado, pendente,
              estoque_minimo, cmc, preco_unitario, updated_at, origem
         FROM logistica.estoque_atual
        WHERE local_codigo = $1`,
      [localCodigo]
    );
    const dbMap = new Map(dbRows.map((r) => [String(r.codigo).trim(), r]));

    const omieComSaldo = [...omieMap.keys()];
    const dbComSaldo = dbRows.filter(temSaldo).map((r) => String(r.codigo).trim());

    let ok = 0;
    let valorDiferente = 0;
    let soNoBanco = 0;
    let soNaOmie = 0;
    let corrigidos = 0;

    for (const codigo of omieComSaldo) {
      const om = omieMap.get(codigo);
      const db = dbMap.get(codigo);
      if (!db) {
        soNaOmie++;
        relatorio.divergencias.push({
          tipo: 'so_na_omie',
          local: localCodigo,
          codigo,
          omie: om,
        });
        if (CORRIGIR) {
          await pool.query(UPSERT_SQL, [
            localCodigo, localNome, om.omie_prod_id, codigo, om.cod_int, om.descricao,
            om.saldo, om.fisico, om.reservado, om.pendente, om.estoque_minimo, om.cmc, om.preco_unitario,
            'reconciliacao_omie',
          ]);
          corrigidos++;
        }
        continue;
      }
      const diffs = diffCampos(db, om);
      if (diffs.length) {
        valorDiferente++;
        relatorio.divergencias.push({
          tipo: 'valor_diferente',
          local: localCodigo,
          codigo,
          diffs,
          db: { saldo: db.saldo, fisico: db.fisico, reservado: db.reservado, pendente: db.pendente, origem: db.origem },
          omie: { saldo: om.saldo, fisico: om.fisico, reservado: om.reservado, pendente: om.pendente },
        });
        if (CORRIGIR) {
          await pool.query(UPSERT_SQL, [
            localCodigo, localNome, om.omie_prod_id, codigo, om.cod_int, om.descricao || db.descricao,
            om.saldo, om.fisico, om.reservado, om.pendente, om.estoque_minimo, om.cmc, om.preco_unitario,
            'reconciliacao_omie',
          ]);
          corrigidos++;
        }
      } else {
        ok++;
      }
    }

    for (const codigo of dbComSaldo) {
      if (!omieMap.has(codigo)) {
        const db = dbMap.get(codigo);
        soNoBanco++;
        relatorio.divergencias.push({
          tipo: 'so_no_banco',
          local: localCodigo,
          codigo,
          db: { saldo: db.saldo, fisico: db.fisico, reservado: db.reservado, pendente: db.pendente, origem: db.origem, updated_at: db.updated_at },
        });
        if (CORRIGIR) {
          await pool.query(UPSERT_SQL, [
            localCodigo, localNome, db.omie_prod_id, codigo, db.cod_int, db.descricao,
            0, 0, 0, 0, db.estoque_minimo || 0, db.cmc || 0, db.preco_unitario || 0,
            'reconciliacao_omie',
          ]);
          corrigidos++;
        }
      }
    }

    const resumo = {
      local: localCodigo,
      nome: localNome,
      omie_com_saldo: omieComSaldo.length,
      db_com_saldo: dbComSaldo.length,
      ok,
      valor_diferente: valorDiferente,
      so_no_banco: soNoBanco,
      so_na_omie: soNaOmie,
      corrigidos,
    };
    relatorio.locais.push(resumo);
    relatorio.totais.omie_com_saldo += omieComSaldo.length;
    relatorio.totais.db_com_saldo += dbComSaldo.length;
    relatorio.totais.ok += ok;
    relatorio.totais.valor_diferente += valorDiferente;
    relatorio.totais.so_no_banco += soNoBanco;
    relatorio.totais.so_na_omie += soNaOmie;
    relatorio.totais.corrigidos += corrigidos;

    console.log(
      `  Omie c/ saldo: ${omieComSaldo.length} | DB c/ saldo: ${dbComSaldo.length} | ` +
      `OK: ${ok} | valores: ${valorDiferente} | só banco: ${soNoBanco} | só Omie: ${soNaOmie}` +
      (CORRIGIR ? ` | corrigidos: ${corrigidos}` : '')
    );
  }

  const outPath = path.join(__dirname, 'relatorio_estoque_atual_omie.json');
  fs.writeFileSync(outPath, JSON.stringify(relatorio, null, 2));

  console.log('\n' + '='.repeat(72));
  console.log('RESUMO GERAL');
  console.log(`  Itens com saldo na Omie : ${relatorio.totais.omie_com_saldo}`);
  console.log(`  Itens com saldo no DB   : ${relatorio.totais.db_com_saldo}`);
  console.log(`  Conferidos OK           : ${relatorio.totais.ok}`);
  console.log(`  Valores diferentes      : ${relatorio.totais.valor_diferente}`);
  console.log(`  Saldo no DB, zerado Omie: ${relatorio.totais.so_no_banco}`);
  console.log(`  Saldo na Omie, ausente DB: ${relatorio.totais.so_na_omie}`);
  if (CORRIGIR) console.log(`  Registros corrigidos    : ${relatorio.totais.corrigidos}`);
  console.log(`  Relatório salvo em      : ${outPath}`);

  const sincronizado = relatorio.totais.valor_diferente === 0
    && relatorio.totais.so_no_banco === 0
    && relatorio.totais.so_na_omie === 0;
  console.log(sincronizado ? '\n✅ estoque_atual está alinhado com a Omie (itens com saldo).' : '\n⚠️  Há divergências — veja o relatório JSON.');
  console.log('='.repeat(72));

  await pool.end();
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  pool.end().finally(() => process.exit(1));
});
