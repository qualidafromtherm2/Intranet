#!/usr/bin/env node
require('dotenv').config();

const { Pool } = require('pg');

if (!globalThis.fetch) {
  globalThis.fetch = require('node-fetch');
}

let configServer = {};
try {
  configServer = require('../config.server');
} catch (_) {
  configServer = {};
}

const OMIE_APP_KEY = process.env.OMIE_APP_KEY || configServer.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || configServer.OMIE_APP_SECRET;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_INTERNAL_URL ||
  null;

const MIN_INTERVAL_MS = 350;
const MAX_RETRIES = 4;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const keep80 = !args.has('--overwrite-80');
const onlyEmpty = args.has('--only-empty');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const rowLimit = limitArg ? Number(limitArg.split('=')[1]) : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avaliarEtapaPorItens(produtos, codigoParcial, codigoTotal) {
  const itens = Array.isArray(produtos) ? produtos : [];
  const normalizados = itens
    .map((item) => ({
      qtde: toNumber(item.nQtde ?? item.n_qtde),
      qtdeRec: toNumber(item.nQtdeRec ?? item.n_qtde_rec),
    }))
    .filter((item) => item.qtde !== null && item.qtde > 0);

  if (!normalizados.length) {
    return { etapa: null, motivo: 'sem_itens_validos' };
  }

  const allFull = normalizados.every((item) => (item.qtdeRec || 0) >= item.qtde);
  if (allFull) {
    return { etapa: codigoTotal, motivo: 'recebido_total' };
  }

  const anyReceived = normalizados.some((item) => (item.qtdeRec || 0) > 0);
  if (anyReceived) {
    return { etapa: codigoParcial, motivo: 'recebido_parcial' };
  }

  return { etapa: null, motivo: 'sem_recebimento' };
}

async function callOmieConsultarPedido(nCodPed) {
  for (let tentativa = 1; tentativa <= MAX_RETRIES; tentativa++) {
    const startedAt = Date.now();
    try {
      const response = await fetch('https://app.omie.com.br/api/v1/produtos/pedidocompra/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ConsultarPedCompra',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{ nCodPed: Number(nCodPed) }],
        }),
      });

      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (_) {
        payload = { raw: text };
      }

      const faultstring = String(payload?.faultstring || '').trim();
      const isRateLimit = /consumo redundante|aguarde\s*3\s*segundos|client-8/i.test(
        `${text || ''} ${faultstring}`
      );

      if (!response.ok || faultstring) {
        if (isRateLimit && tentativa < MAX_RETRIES) {
          await sleep(3000);
          continue;
        }
        return {
          ok: false,
          error: !response.ok
            ? `HTTP ${response.status} - ${faultstring || text || 'erro'}`
            : faultstring,
        };
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_INTERVAL_MS) {
        await sleep(MIN_INTERVAL_MS - elapsed);
      }

      return { ok: true, data: payload };
    } catch (err) {
      if (tentativa >= MAX_RETRIES) {
        return { ok: false, error: String(err?.message || err) };
      }
      await sleep(1000);
    }
  }

  return { ok: false, error: 'Falha desconhecida na consulta do pedido.' };
}

async function carregarCodigosEtapa(client) {
  const { rows } = await client.query(`
    SELECT codigo, descricao, descricao_customizada
    FROM logistica.etapas_recebimento_nfe
  `);

  const findCodigo = (regex, fallback) => {
    const row = rows.find((item) =>
      regex.test(`${item.descricao || ''} ${item.descricao_customizada || ''}`)
    );
    return String(row?.codigo || fallback);
  };

  return {
    parcial: findCodigo(/recebido\s*parcial/i, '50'),
    total: findCodigo(/recebido\s*total/i, '60'),
    conferido: findCodigo(/conferid|recebido\s*e\s*conferido/i, '80'),
  };
}

async function main() {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET não configurados.');
  }
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada.');
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  try {
    const codigos = await carregarCodigosEtapa(client);

    const filtros = [
      `COALESCE(po.inativo, false) = false`,
      `po.n_cod_ped IS NOT NULL`,
    ];

    if (keep80) {
      filtros.push(`COALESCE(BTRIM(po."Etapa_NF"), '') <> $1`);
    }

    if (onlyEmpty) {
      filtros.push(`COALESCE(BTRIM(po."Etapa_NF"), '') = ''`);
    }

    const limitSql = Number.isFinite(rowLimit) && rowLimit > 0
      ? `LIMIT ${Math.floor(rowLimit)}`
      : '';

    const paramsConsulta = keep80 ? [codigos.conferido] : [];

    const { rows: pedidos } = await client.query(`
      SELECT po.n_cod_ped, po.c_numero, po."Etapa_NF" AS etapa_nf_atual
      FROM compras.pedidos_omie po
      WHERE ${filtros.join(' AND ')}
      ORDER BY po.updated_at DESC NULLS LAST, po.n_cod_ped DESC
      ${limitSql}
    `, paramsConsulta);

    console.log(`\n[EtapaNF] Pedidos alvo: ${pedidos.length}`);
    console.log(`[EtapaNF] Códigos usados: parcial=${codigos.parcial}, total=${codigos.total}, conferido=${codigos.conferido}`);
    console.log(`[EtapaNF] Modo: dryRun=${dryRun}, keep80=${keep80}, onlyEmpty=${onlyEmpty}\n`);

    let ok = 0;
    let updated = 0;
    let unchanged = 0;
    let errors = 0;
    let skipped80 = 0;
    let to50 = 0;
    let to60 = 0;
    let nullified = 0;

    for (let index = 0; index < pedidos.length; index++) {
      const pedido = pedidos[index];
      const etapaAtual = String(pedido.etapa_nf_atual || '').trim();

      const omie = await callOmieConsultarPedido(pedido.n_cod_ped);
      if (!omie.ok) {
        errors += 1;
        console.warn(`[EtapaNF] ${index + 1}/${pedidos.length} pedido=${pedido.n_cod_ped} ERRO: ${omie.error}`);
        await sleep(MIN_INTERVAL_MS);
        continue;
      }

      ok += 1;

      const produtos = omie.data?.produtos || omie.data?.produtos_consulta || [];
      const avaliacao = avaliarEtapaPorItens(produtos, codigos.parcial, codigos.total);
      const etapaCalculada = avaliacao.etapa ? String(avaliacao.etapa).trim() : '';

      if (keep80 && etapaAtual === codigos.conferido && etapaCalculada && etapaCalculada !== codigos.conferido) {
        skipped80 += 1;
        unchanged += 1;
      } else {
        let etapaFinal = etapaAtual;

        if (etapaCalculada) {
          etapaFinal = etapaCalculada;
        } else if ([codigos.parcial, codigos.total].includes(etapaAtual)) {
          etapaFinal = '';
        }

        const mudou = etapaFinal !== etapaAtual;
        if (mudou) {
          if (!dryRun) {
            await client.query(
              `UPDATE compras.pedidos_omie
                  SET "Etapa_NF" = NULLIF($2::text, ''),
                      updated_at = NOW()
                WHERE n_cod_ped = $1`,
              [pedido.n_cod_ped, etapaFinal]
            );
          }

          updated += 1;
          if (etapaFinal === codigos.parcial) to50 += 1;
          else if (etapaFinal === codigos.total) to60 += 1;
          else if (etapaFinal === '') nullified += 1;
        } else {
          unchanged += 1;
        }
      }

      if ((index + 1) % 25 === 0 || index + 1 === pedidos.length) {
        console.log(
          `[EtapaNF] Progresso ${index + 1}/${pedidos.length} | ok=${ok} updated=${updated} unchanged=${unchanged} errors=${errors} skipped80=${skipped80}`
        );
      }
    }

    console.log('\n[EtapaNF] Finalizado');
    console.log(`[EtapaNF] ok=${ok}, updated=${updated}, unchanged=${unchanged}, errors=${errors}, skipped80=${skipped80}`);
    console.log(`[EtapaNF] alterações: para_${codigos.parcial}=${to50}, para_${codigos.total}=${to60}, limpou=${nullified}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[EtapaNF] Erro fatal:', err.message || err);
  process.exit(1);
});
