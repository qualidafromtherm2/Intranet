#!/usr/bin/env node
/**
 * ============================================================================
 * Backfill histórico de posição de estoque 2026
 * ============================================================================
 * Busca na API Omie (ListarPosEstoque) a posição de estoque para cada
 * combinação (data, local) do período 01/01/2026 até ontem que ainda
 * NÃO existe em public.omie_estoque_posicao.
 *
 * Pode ser interrompido e retomado — skipa automaticamente pares já gravados.
 *
 * USO:
 *   node scripts/backfill_estoque_posicao_2026.js
 *
 *   # Limitar datas (útil para testar):
 *   DATA_INICIO=2026-04-01 DATA_FIM=2026-04-30 node scripts/backfill_estoque_posicao_2026.js
 *
 * Variáveis de ambiente obrigatórias:
 *   DATABASE_URL, OMIE_APP_KEY, OMIE_APP_SECRET
 * ============================================================================
 */

const { Pool }          = require('pg');
const { spawn }         = require('child_process');

const DATABASE_URL    = process.env.DATABASE_URL;
const OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

if (!DATABASE_URL || !OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('ERRO: DATABASE_URL, OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórios.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ─── Configurações ────────────────────────────────────────────────────────────
// Padrão: apenas abril e maio de 2026
const DATA_INICIO = process.env.DATA_INICIO || '2026-04-01';
const DATA_FIM    = process.env.DATA_FIM    || (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1); // ontem
  return d.toISOString().slice(0, 10);
})();

// Omie rate limit: 240 req/min por método, ListarPosEstoque = 1 req por vez
// → processamento estritamente sequencial (sem delay artificial — cada req leva ~700ms)
const DELAY_ERRO_MS   = 35000; // 35s após erro de concorrência ou cache
const MAX_RETRIES     = 3;

const FETCH_TIMEOUT_S = 25;


const sleep = ms => new Promise(r => setTimeout(r, ms));

function isoToBR(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function gerarDatas(inicio, fim) {
  const datas = [];
  const cur = new Date(inicio + 'T00:00:00Z');
  const end = new Date(fim   + 'T00:00:00Z');
  while (cur <= end) {
    datas.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return datas;
}

// ─── Curl assíncrono (não bloqueia event loop) ────────────────────────────────
function omieFetchAsync(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const args = [
      '-s', '--max-time', String(FETCH_TIMEOUT_S),
      '-X', 'POST',
      'https://app.omie.com.br/api/v1/estoque/consulta/',
      '-H', 'Content-Type: application/json',
      '-d', body,
    ];
    const child = spawn('curl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`curl exit ${code}: ${err.slice(0, 100)}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error(`JSON inválido: ${out.slice(0, 200)}`)); }
    });
    child.on('error', e => reject(new Error(`spawn error: ${e.message}`)));
  });
}

async function omieFetch(payload) {
  return omieFetchAsync(payload);
}

async function omieListarPosEstoque(localCodigo, dataISO) {
  const dataBR = isoToBR(dataISO);
  const basePayload = {
    call: 'ListarPosEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      nPagina        : 1,
      nRegPorPagina  : 100,
      dDataPosicao   : dataBR,
      cExibeTodos    : 'N',
      codigo_local_estoque: Number(localCodigo),
    }],
  };

  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    let r0;
    try {
      r0 = await omieFetch(basePayload);
    } catch (e) {
      throw new Error(`Curl error: ${e.message}`);
    }

    // Verifica erro Omie
    if (r0.faultstring || r0.faultCode) {
      const msg = String(r0.faultstring || r0.faultCode || '');
      if (msg.includes('Consumo redundante') || msg.includes('Client-8020') || msg.includes('requisição desse método')) {
        if (tentativa < MAX_RETRIES) {
          await sleep(2000 * tentativa);
          continue;
        }
      }
      if (msg.includes('Nenhum') || msg.includes('nenhum') || msg.includes('0019') || msg.includes('registros para a página')) {
        return [];
      }
      throw new Error(`Omie: ${msg}`);
    }

    const paginas = Number(r0.nTotPaginas || 1);
    const itens   = Array.isArray(r0.produtos) ? [...r0.produtos] : [];

    // Busca páginas adicionais sequencialmente (Omie não permite concorrência)
    for (let pg = 2; pg <= paginas; pg++) {
      const payloadPg = { ...basePayload, param: [{ ...basePayload.param[0], nPagina: pg }] };
      const rPg = await omieFetch(payloadPg);
      if (rPg.faultstring || rPg.faultCode) break; // stop on error
      if (Array.isArray(rPg.produtos)) itens.push(...rPg.produtos);
    }

    return itens.filter(it => Number(it?.codigo_local_estoque) === Number(localCodigo));
  }
  throw new Error(`Máximo de tentativas atingido para local=${localCodigo} data=${dataISO}`);
}

async function gravarItens(localCodigo, dataISO, itens) {
  const clamp = n => Math.max(0, Number(n) || 0);
  const sql = `
    INSERT INTO public.omie_estoque_posicao (
      data_posicao, ingested_at, local_codigo,
      omie_prod_id, cod_int, codigo, descricao,
      preco_unitario, saldo, cmc, pendente, estoque_minimo, reservado, fisico
    ) VALUES (
      $1::date, now(), $2,
      $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13
    )
    ON CONFLICT ON CONSTRAINT uq_posicao_uni
    DO UPDATE SET
      descricao      = EXCLUDED.descricao,
      preco_unitario = EXCLUDED.preco_unitario,
      saldo          = EXCLUDED.saldo,
      cmc            = EXCLUDED.cmc,
      pendente       = EXCLUDED.pendente,
      estoque_minimo = EXCLUDED.estoque_minimo,
      reservado      = EXCLUDED.reservado,
      fisico         = EXCLUDED.fisico,
      ingested_at    = now()
  `;
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    for (const p of itens) {
      await cli.query(sql, [
        dataISO, localCodigo,
        Number(p.nCodProd) || 0,
        p.cCodInt   || null,
        p.cCodigo   || '',
        p.cDescricao || '',
        clamp(p.nPrecoUnitario),
        clamp(p.nSaldo),
        clamp(p.nCMC),
        clamp(p.nPendente),
        clamp(p.estoque_minimo),
        clamp(p.reservado),
        clamp(p.fisico),
      ]);
    }
    await cli.query('COMMIT');
  } catch (e) {
    await cli.query('ROLLBACK');
    throw e;
  } finally {
    cli.release();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('='.repeat(70));
  console.log(' Backfill omie_estoque_posicao 2026');
  console.log(`  Período : ${DATA_INICIO} → ${DATA_FIM}`);
  console.log('='.repeat(70));

  // 1) Locais ativos
  const { rows: locaisRows } = await pool.query(
    'SELECT local_codigo FROM public.omie_locais_estoque WHERE ativo = TRUE ORDER BY local_codigo'
  );
  if (!locaisRows.length) {
    console.error('Nenhum local ativo encontrado em omie_locais_estoque. Abortando.');
    process.exit(1);
  }
  const locais = locaisRows.map(r => String(r.local_codigo));
  console.log(`Locais ativos (${locais.length}): ${locais.join(', ')}`);

  // 2) Datas a processar
  const todasDatas = gerarDatas(DATA_INICIO, DATA_FIM);
  console.log(`Total de datas: ${todasDatas.length}`);

  // 3) Pares já existentes no banco (para skip)
  const { rows: existentes } = await pool.query(`
    SELECT DISTINCT local_codigo, data_posicao::text AS data_posicao
    FROM public.omie_estoque_posicao
    WHERE data_posicao BETWEEN $1 AND $2
  `, [DATA_INICIO, DATA_FIM]);
  const jaExistem = new Set(existentes.map(r => `${r.data_posicao}|${r.local_codigo}`));
  console.log(`Pares já existentes no banco: ${jaExistem.size}`);

  // 4) Construir fila de trabalho (skipa existentes)
  const fila = [];
  for (const data of todasDatas) {
    for (const local of locais) {
      const key = `${data}|${local}`;
      if (!jaExistem.has(key)) fila.push({ data, local });
    }
  }

  const total = locais.length * todasDatas.length;
  console.log(`Pares a processar: ${fila.length} de ${total} (${total - fila.length} já existiam)\n`);

  if (!fila.length) {
    console.log('Nada a fazer — todos os pares já existem. Encerrando.');
    await pool.end();
    return;
  }

  // Estimativa (sequencial, ~700ms/req, ~1.5 pages em média)
  const estimSeg = Math.round(fila.length * 1.5 * 0.7);
  console.log(`Estimativa: ~${Math.ceil(estimSeg / 60)} min`);
  console.log('─'.repeat(70));

  let ok = 0, skip = 0, erros = 0;

  for (let i = 0; i < fila.length; i++) {
    const { data, local } = fila[i];
    const pct = (((i + 1) / fila.length) * 100).toFixed(1);
    try {
      const itens = await omieListarPosEstoque(local, data);
      if (itens.length === 0) {
        console.log(`[${i + 1}/${fila.length}] ${pct}% | ${data} | local=${local} → sem saldo`);
        skip++;
      } else {
        await gravarItens(local, data, itens);
        console.log(`[${i + 1}/${fila.length}] ${pct}% | ${data} | local=${local} → ✓ ${itens.length} itens`);
        ok++;
      }
    } catch (err) {
      console.log(`[${i + 1}/${fila.length}] ${pct}% | ${data} | local=${local} → ✗ ${err.message}`);
      erros++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(` CONCLUÍDO: ${ok} gravados | ${skip} sem saldo | ${erros} erros`);
  console.log('='.repeat(70));

  await pool.end();
})().catch(err => {
  console.error('Erro fatal:', err);
  pool.end().finally(() => process.exit(1));
});
