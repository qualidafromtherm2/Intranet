'use strict';

/**
 * Enriquecimento de notas fiscais de vendas com dados por documento (Omie dfedocs/ObterNfe).
 *
 * Objetivos principais:
 * - Preencher url_danfe (cPdf) em "Vendas".notas_fiscais_omie
 * - Resolver id_nf_omie quando ausente (via ConsultarNF)
 * - Opcionalmente preencher url_xml se a Omie devolver link HTTP explícito
 *
 * Uso:
 *   node scripts/enrich_notas_fiscais_vendas_docs.js
 *   node scripts/enrich_notas_fiscais_vendas_docs.js --limite=500
 *   node scripts/enrich_notas_fiscais_vendas_docs.js --somente-sem-url-danfe
 *   node scripts/enrich_notas_fiscais_vendas_docs.js --somente-sem-url-danfe --ano=2026
 *   node scripts/enrich_notas_fiscais_vendas_docs.js --somente-sem-url-danfe --mes=2026-04
 *   node scripts/enrich_notas_fiscais_vendas_docs.js --somente-sem-url-danfe --ano=2026 --modo-completo
 *
 * Rate limit:
 * - Mantém ~3 req/s com delay fixo de 350ms entre chamadas Omie.
 */

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const OMIE_APP_KEY = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

const OMIE_NFCONSULTAR_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const OMIE_DFEDOCS_URL = 'https://app.omie.com.br/api/v1/produtos/dfedocs/';
const OMIE_NFE_URL = 'https://app.omie.com.br/api/v1/produtos/nfe/';

const DELAY_MS = 333; // ~3 req/s

if (!DATABASE_URL || !OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('Erro: DATABASE_URL, OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórios.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const onlyMissingDanfe = argv.includes('--somente-sem-url-danfe');
  const completeMode = argv.includes('--modo-completo');
  const limiteArg = argv.find((a) => a.startsWith('--limite='));
  const anoArg = argv.find((a) => a.startsWith('--ano='));
  const mesArg = argv.find((a) => a.startsWith('--mes='));
  const limite = limiteArg ? Number.parseInt(limiteArg.split('=')[1], 10) : null;
  const ano = anoArg ? Number.parseInt(anoArg.split('=')[1], 10) : null;
  const mes = mesArg ? String(mesArg.split('=')[1] || '').trim() : '';
  const mesMatch = mes.match(/^(\d{4})-(\d{2})$/);
  const mesAno = mesMatch ? Number.parseInt(mesMatch[1], 10) : null;
  const mesNum = mesMatch ? Number.parseInt(mesMatch[2], 10) : null;
  const fastDanfeMode = onlyMissingDanfe && !completeMode;
  return {
    onlyMissingDanfe,
    completeMode,
    fastDanfeMode,
    limite: Number.isFinite(limite) && limite > 0 ? limite : null,
    ano: Number.isFinite(ano) && ano >= 2000 && ano <= 2100 ? ano : null,
    mes: mesMatch && Number.isFinite(mesAno) && Number.isFinite(mesNum) && mesNum >= 1 && mesNum <= 12 ? mes : null,
  };
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

async function omiePost(url, call, param) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call,
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param: [param],
    }),
  });

  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = null; }

  await sleep(DELAY_MS);

  if (!res.ok) {
    const msg = data?.faultstring || text || `HTTP ${res.status}`;
    throw new Error(`Omie ${call} HTTP ${res.status}: ${msg}`);
  }

  const fault = String(data?.faultstring || data?.faultcode || '').trim();
  if (fault) {
    throw new Error(`Omie ${call}: ${fault}`);
  }

  return data || {};
}

function pickHttpUrl(...candidates) {
  for (const c of candidates) {
    const v = String(c || '').trim();
    if (/^https?:\/\//i.test(v)) return v;
  }
  return null;
}

async function ensureColumns(client) {
  await client.query(`
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS id_nf_omie BIGINT;
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS url_danfe TEXT;
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS url_xml TEXT;
    ALTER TABLE "Vendas".notas_fiscais_omie ADD COLUMN IF NOT EXISTS operacao VARCHAR(30);
  `);
}

function buildAnoWhereClause(ano) {
  if (!ano) return '';
  return `
    AND (
      COALESCE(data_emissao, '') LIKE '${ano}%'
      OR COALESCE(data_emissao, '') LIKE '%/${ano}%'
      OR EXTRACT(YEAR FROM created_at) = ${ano}
    )
  `;
}

function buildMesWhereClause(mes) {
  if (!mes) return '';
  const [ano, mm] = mes.split('-');
  return `
    AND (
      COALESCE(data_emissao, '') LIKE '${ano}-${mm}%'
      OR COALESCE(data_emissao, '') LIKE '__/${mm}/${ano}%'
      OR TO_CHAR(created_at, 'YYYY-MM') = '${ano}-${mm}'
    )
  `;
}

async function listarPendentes(client, { onlyMissingDanfe, limite, ano, mes, fastDanfeMode }) {
  const periodClause = mes ? buildMesWhereClause(mes) : buildAnoWhereClause(ano);
  let where = '';

  if (onlyMissingDanfe && fastDanfeMode) {
    // Modo rápido: mantém 1 chamada Omie por nota (ObterNfe), usando apenas linhas com id_nf_omie já resolvido.
    where = `WHERE tipo_documento = 'NFe' AND COALESCE(url_danfe, '') = '' AND id_nf_omie IS NOT NULL ${periodClause}`;
  } else if (onlyMissingDanfe) {
    where = `WHERE tipo_documento = 'NFe' AND COALESCE(url_danfe, '') = '' ${periodClause}`;
  } else {
    where = `WHERE tipo_documento = 'NFe' AND (COALESCE(url_danfe, '') = '' OR id_nf_omie IS NULL) ${periodClause}`;
  }

  const limitSql = limite ? `LIMIT ${limite}` : '';

  const { rows } = await client.query(`
    SELECT id, identidade, numero_nota, chave_nfe, id_nf_omie, url_danfe, url_xml, operacao
    FROM "Vendas".notas_fiscais_omie
    ${where}
    ORDER BY updated_at DESC
    ${limitSql}
  `);

  return rows;
}

async function resolverIdNfOmie({ numeroNota, chaveNfe }) {
  const nNF = onlyDigits(numeroNota);
  const cChaveNFe = onlyDigits(chaveNfe);
  if (!nNF && !cChaveNFe) return null;

  const param = {};
  if (nNF) param.nNF = nNF;
  if (cChaveNFe) param.cChaveNFe = cChaveNFe;

  const data = await omiePost(OMIE_NFCONSULTAR_URL, 'ConsultarNF', param);
  const nId = Number(
    data?.compl?.nIdNF
    || data?.compl?.nIdNf
    || data?.nIdNF
    || data?.nIdNfe
    || 0
  );

  return Number.isFinite(nId) && nId > 0 ? nId : null;
}

async function obterDocsPorId(nIdNfe) {
  const data = await omiePost(OMIE_DFEDOCS_URL, 'ObterNfe', { nIdNfe });
  const urlDanfe = pickHttpUrl(data?.cPdf);
  const urlXml = pickHttpUrl(data?.cUrlXml, data?.urlXml, data?.linkXml, data?.cXml, data?.cXmlNfe);
  return { urlDanfe, urlXml };
}

async function consultarOperacaoPorChave(chaveNfe) {
  const chave = onlyDigits(chaveNfe);
  if (!chave) return { operacao: null, nIdNfe: null };

  const data = await omiePost(OMIE_NFE_URL, 'ListarNFe', {
    nPagina: 1,
    nRegPorPagina: 1,
    cChaveNFe: chave,
  });

  const listagem = Array.isArray(data?.listagemNfe) ? data.listagemNfe : [];
  const item = listagem.find((it) => onlyDigits(it?.cChaveNFe) === chave) || listagem[0] || null;
  if (!item) return { operacao: null, nIdNfe: null };

  const operacao = String(item?.cOperacao || '').trim() || null;
  const nIdNfe = Number(item?.nIdNFe || 0);

  return {
    operacao,
    nIdNfe: Number.isFinite(nIdNfe) && nIdNfe > 0 ? nIdNfe : null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = await pool.connect();

  let total = 0;
  let atualizados = 0;
  let comErro = 0;
  let resolvidosId = 0;
  let resolvidosOperacao = 0;
  let semDados = 0;

  try {
    await ensureColumns(client);
    const pendentes = await listarPendentes(client, options);
    total = pendentes.length;

    console.log(
      `Iniciando enriquecimento por documento (3 req/s). Pendentes: ${total}`
      + `${options.mes ? ` | mes=${options.mes}` : (options.ano ? ` | ano=${options.ano}` : '')}`
      + `${options.fastDanfeMode ? ' | modo=rapido-danfe' : ' | modo=completo'}`
    );

    for (let i = 0; i < pendentes.length; i++) {
      const row = pendentes[i];

      try {
        let nIdNfe = row.id_nf_omie ? Number(row.id_nf_omie) : null;
        if (!options.fastDanfeMode && (!nIdNfe || !Number.isFinite(nIdNfe) || nIdNfe <= 0)) {
          nIdNfe = await resolverIdNfOmie({ numeroNota: row.numero_nota, chaveNfe: row.chave_nfe });
          if (nIdNfe) resolvidosId++;
        }

        let operacao = String(row.operacao || '').trim() || null;
        if (!options.fastDanfeMode && !operacao && row.chave_nfe) {
          const nfeDados = await consultarOperacaoPorChave(row.chave_nfe);
          if (nfeDados.operacao) {
            operacao = nfeDados.operacao;
            resolvidosOperacao++;
          }
          if ((!nIdNfe || nIdNfe <= 0) && nfeDados.nIdNfe) {
            nIdNfe = nfeDados.nIdNfe;
            resolvidosId++;
          }
        }

        if (!nIdNfe) {
          if (!operacao) semDados++;
          continue;
        }

        const docs = await obterDocsPorId(nIdNfe);
        const nextDanfe = docs.urlDanfe || row.url_danfe || null;
        const nextXml = docs.urlXml || row.url_xml || null;

        if (!nextDanfe && !nextXml && row.id_nf_omie && !operacao) {
          semDados++;
          continue;
        }

        const result = await client.query(`
          UPDATE "Vendas".notas_fiscais_omie
          SET
            id_nf_omie = COALESCE(id_nf_omie, $2),
            url_danfe = COALESCE(url_danfe, $3),
            url_xml = COALESCE(url_xml, $4),
            operacao = COALESCE(operacao, $5),
            updated_at = NOW()
          WHERE id = $1
            AND (
              id_nf_omie IS DISTINCT FROM COALESCE(id_nf_omie, $2)
              OR url_danfe IS DISTINCT FROM COALESCE(url_danfe, $3)
              OR url_xml IS DISTINCT FROM COALESCE(url_xml, $4)
              OR operacao IS DISTINCT FROM COALESCE(operacao, $5)
            )
        `, [row.id, nIdNfe, nextDanfe, nextXml, operacao]);

        if (result.rowCount > 0) atualizados++;
      } catch (err) {
        comErro++;
        console.error(`[${i + 1}/${total}] erro id=${row.id} chave=${row.chave_nfe || '-'}:`, err.message);
      }

      if ((i + 1) % 50 === 0 || i === total - 1) {
        console.log(`[${i + 1}/${total}] atualizados=${atualizados} resolvidosId=${resolvidosId} resolvidosOperacao=${resolvidosOperacao} semDados=${semDados} erros=${comErro}`);
      }
    }

    const { rows } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE tipo_documento='NFe' AND COALESCE(url_danfe, '') = '')::int AS sem_url_danfe,
        COUNT(*) FILTER (WHERE tipo_documento='NFe' AND id_nf_omie IS NULL)::int AS sem_id_nf_omie,
        COUNT(*) FILTER (WHERE tipo_documento='NFe' AND COALESCE(url_xml, '') = '')::int AS sem_url_xml,
        COUNT(*) FILTER (WHERE tipo_documento='NFe' AND operacao IS NULL)::int AS sem_operacao
      FROM "Vendas".notas_fiscais_omie
    `);

    console.log('\n=== Resumo final ===');
    console.log(`Pendentes lidos: ${total}`);
    console.log(`Atualizados: ${atualizados}`);
    console.log(`IDs resolvidos via ConsultarNF: ${resolvidosId}`);
    console.log(`Operações resolvidas via ListarNFe: ${resolvidosOperacao}`);
    console.log(`Sem dados novos no documento: ${semDados}`);
    console.log(`Erros: ${comErro}`);
    console.log('Status tabela:', rows[0]);
  } catch (err) {
    console.error('Erro fatal:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
