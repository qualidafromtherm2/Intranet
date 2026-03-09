#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
if (!globalThis.fetch) {
  globalThis.fetch = require('node-fetch');
}

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/recebimentonfe/';
const OMIE_DELAY_MS = 350; // 3 req/s

function parseArgs(argv) {
  const args = { limit: 0, dryRun: false, omieApiLimit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const token = String(argv[i] || '');
    if (token === '--limit' && argv[i + 1]) {
      args.limit = Math.max(0, Number(argv[i + 1]) || 0);
      i++;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--omie-api-limit' && argv[i + 1]) {
      args.omieApiLimit = Math.max(0, Number(argv[i + 1]) || 0);
      i++;
      continue;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consultarRecebimentoOmieByChave(cChaveNfe) {
  const chave = String(cChaveNfe || '').replace(/\D/g, '');
  if (!chave) return { ok: false, error: 'cChaveNfe vazia' };

  const resp = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call: 'ConsultarRecebimento',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [{ cChaveNfe: chave }],
    }),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json?.faultstring || json?.faultcode) {
    return { ok: false, error: json?.faultstring || json?.faultcode || `HTTP ${resp.status}` };
  }

  const cab = json?.cabec || {};
  const nIdFornecedor = Number(cab?.nIdFornecedor || cab?.nCodFor || 0);
  const cNomeFornecedor = String(cab?.cRazaoSocial || cab?.cNome || '').trim() || null;
  const cCnpjCpfFornecedor = String(cab?.cCNPJ_CPF || cab?.cCNPJ || cab?.cCpfCnpj || '').trim() || null;

  if (!Number.isFinite(nIdFornecedor) || nIdFornecedor <= 0) {
    return { ok: false, error: 'nIdFornecedor ausente na resposta da Omie' };
  }

  return {
    ok: true,
    nIdFornecedor,
    cNomeFornecedor,
    cCnpjCpfFornecedor,
    resposta: json,
  };
}

function sqlBackfill(limit = 0, dryRun = false) {
  const limitSql = limit > 0 ? `LIMIT ${Math.floor(limit)}` : '';

  return `
    WITH alvo AS (
      SELECT
        n.n_id_receb,
        n.c_chave_nfe,
        regexp_replace(COALESCE(n.c_chave_nfe, ''), '[^0-9]', '', 'g') AS chave_digitos
      FROM logistica.notas_entrada_omie n
      WHERE n.n_id_fornecedor IS NULL
      ORDER BY n.updated_at DESC NULLS LAST, n.n_id_receb DESC
      ${limitSql}
    ),
    fornecedores_doc_unico AS (
      SELECT
        regexp_replace(COALESCE(f.cnpj_cpf, ''), '[^0-9]', '', 'g') AS doc,
        MIN(f.codigo_cliente_omie) AS n_id_fornecedor,
        MAX(COALESCE(NULLIF(BTRIM(f.razao_social), ''), NULLIF(BTRIM(f.nome_fantasia), ''))) AS c_nome_fornecedor,
        MAX(NULLIF(BTRIM(f.cnpj_cpf), '')) AS c_cnpj_cpf_fornecedor
      FROM omie.fornecedores f
      WHERE COALESCE(BTRIM(f.cnpj_cpf), '') <> ''
      GROUP BY 1
      HAVING COUNT(DISTINCT f.codigo_cliente_omie) = 1
    ),
    map_doc AS (
      SELECT
        a.n_id_receb,
        f.n_id_fornecedor,
        f.c_nome_fornecedor,
        f.c_cnpj_cpf_fornecedor,
        'doc_chave_nfe'::text AS origem
      FROM alvo a
      JOIN fornecedores_doc_unico f
        ON LENGTH(a.chave_digitos) = 44
       AND SUBSTRING(a.chave_digitos FROM 7 FOR 14) = f.doc
    ),
    alvo_sem_doc AS (
      SELECT a.n_id_receb
      FROM alvo a
      LEFT JOIN map_doc d ON d.n_id_receb = a.n_id_receb
      WHERE d.n_id_receb IS NULL
    ),
    cand_pedido_raw AS (
      SELECT
        a.n_id_receb,
        p.n_cod_for AS n_id_fornecedor,
        COALESCE(
          NULLIF(BTRIM(ofr.razao_social), ''),
          NULLIF(BTRIM(ofr.nome_fantasia), '')
        ) AS c_nome_fornecedor,
        COALESCE(
          NULLIF(BTRIM(ofr.cnpj_cpf), ''),
          NULLIF(BTRIM(p.c_cnpj_cpf_for), '')
        ) AS c_cnpj_cpf_fornecedor
      FROM alvo_sem_doc a
      JOIN logistica.recebimentos_nfe_itens i ON i.n_id_receb = a.n_id_receb
      JOIN compras.pedidos_omie p ON (
        (NULLIF(BTRIM(i.n_id_pedido::text), '') ~ '^[0-9]+$' AND p.n_cod_ped = i.n_id_pedido::bigint)
        OR (COALESCE(NULLIF(BTRIM(i.n_num_ped_compra), ''), '#') = COALESCE(NULLIF(BTRIM(p.c_numero), ''), '?'))
        OR (NULLIF(BTRIM(i.n_num_ped_compra), '') ~ '^[0-9]+$' AND p.n_cod_ped = i.n_num_ped_compra::bigint)
      )
      LEFT JOIN omie.fornecedores ofr ON ofr.codigo_cliente_omie = p.n_cod_for
      WHERE p.n_cod_for IS NOT NULL
    ),
    map_pedido AS (
      SELECT
        n_id_receb,
        MIN(n_id_fornecedor) AS n_id_fornecedor,
        MAX(c_nome_fornecedor) AS c_nome_fornecedor,
        MAX(c_cnpj_cpf_fornecedor) AS c_cnpj_cpf_fornecedor,
        'pedido_omie'::text AS origem
      FROM cand_pedido_raw
      GROUP BY n_id_receb
      HAVING COUNT(DISTINCT n_id_fornecedor) = 1
    ),
    conflitos_doc_pedido AS (
      SELECT COUNT(*) AS qtd
      FROM map_doc d
      JOIN map_pedido p ON p.n_id_receb = d.n_id_receb
      WHERE p.n_id_fornecedor <> d.n_id_fornecedor
    ),
    receb_sem_fornecedor_com_notas AS (
      SELECT r.n_id_receb
      FROM logistica.recebimentos_nfe_omie r
      JOIN logistica.notas_entrada_omie n ON n.n_id_receb = r.n_id_receb
      WHERE r.n_id_fornecedor IS NULL
        AND n.n_id_fornecedor IS NOT NULL
    ),
    map_final AS (
      SELECT * FROM map_doc
      UNION ALL
      SELECT p.*
      FROM map_pedido p
      WHERE NOT EXISTS (
        SELECT 1
        FROM map_doc d
        WHERE d.n_id_receb = p.n_id_receb
      )
    )
    ${dryRun ? `
    SELECT
      (SELECT COUNT(*) FROM alvo) AS total_alvo,
      (SELECT COUNT(*) FROM map_doc) AS candidatos_doc,
      (SELECT COUNT(*) FROM map_pedido) AS candidatos_pedido,
      (SELECT COUNT(*) FROM map_final) AS candidatos_totais,
      (SELECT qtd FROM conflitos_doc_pedido) AS conflitos_doc_pedido,
      (SELECT COUNT(*) FROM receb_sem_fornecedor_com_notas) AS receb_extra_via_notas;
    ` : `,
    upd_notas AS (
      UPDATE logistica.notas_entrada_omie n
      SET
        n_id_fornecedor = m.n_id_fornecedor,
        c_nome_fornecedor = COALESCE(NULLIF(BTRIM(n.c_nome_fornecedor), ''), NULLIF(BTRIM(m.c_nome_fornecedor), '')),
        c_cnpj_cpf_fornecedor = COALESCE(NULLIF(BTRIM(n.c_cnpj_cpf_fornecedor), ''), NULLIF(BTRIM(m.c_cnpj_cpf_fornecedor), '')),
        c_ultimo_topico = 'backfill.fornecedor',
        updated_at = NOW()
      FROM map_final m
      WHERE n.n_id_receb = m.n_id_receb
        AND n.n_id_fornecedor IS NULL
      RETURNING
        n.n_id_receb,
        n.c_chave_nfe,
        n.c_status,
        m.n_id_fornecedor,
        m.c_nome_fornecedor,
        m.c_cnpj_cpf_fornecedor,
        m.origem
    ),
    upd_receb AS (
      UPDATE logistica.recebimentos_nfe_omie r
      SET
        n_id_fornecedor = u.n_id_fornecedor,
        c_nome_fornecedor = COALESCE(NULLIF(BTRIM(r.c_nome_fornecedor), ''), NULLIF(BTRIM(u.c_nome_fornecedor), '')),
        c_cnpj_cpf_fornecedor = COALESCE(NULLIF(BTRIM(r.c_cnpj_cpf_fornecedor), ''), NULLIF(BTRIM(u.c_cnpj_cpf_fornecedor), '')),
        updated_at = NOW()
      FROM upd_notas u
      WHERE r.n_id_receb = u.n_id_receb
        AND r.n_id_fornecedor IS NULL
      RETURNING r.n_id_receb
    ),
    upd_receb_extra AS (
      UPDATE logistica.recebimentos_nfe_omie r
      SET
        n_id_fornecedor = n.n_id_fornecedor,
        c_nome_fornecedor = COALESCE(NULLIF(BTRIM(r.c_nome_fornecedor), ''), NULLIF(BTRIM(n.c_nome_fornecedor), '')),
        c_cnpj_cpf_fornecedor = COALESCE(NULLIF(BTRIM(r.c_cnpj_cpf_fornecedor), ''), NULLIF(BTRIM(n.c_cnpj_cpf_fornecedor), '')),
        updated_at = NOW()
      FROM logistica.notas_entrada_omie n
      WHERE r.n_id_receb = n.n_id_receb
        AND r.n_id_fornecedor IS NULL
        AND n.n_id_fornecedor IS NOT NULL
      RETURNING r.n_id_receb
    ),
    ins_eventos AS (
      INSERT INTO logistica.notas_entrada_omie_eventos (
        n_id_receb,
        c_chave_nfe,
        topic,
        c_status,
        origem_evento,
        payload,
        recebido_em,
        processado_em,
        processado_com_sucesso
      )
      SELECT
        u.n_id_receb,
        u.c_chave_nfe,
        'backfill.fornecedor',
        CASE
          WHEN u.c_status IN ('Incluida', 'Alterada', 'Concluida', 'Cancelada', 'Excluida', 'Desconhecida', 'Sincronizada')
            THEN u.c_status
          ELSE 'Alterada'
        END,
        'omie_sync',
        jsonb_build_object(
          'n_id_receb', u.n_id_receb,
          'n_id_fornecedor', u.n_id_fornecedor,
          'c_nome_fornecedor', u.c_nome_fornecedor,
          'c_cnpj_cpf_fornecedor', u.c_cnpj_cpf_fornecedor,
          'origem', u.origem
        ),
        NOW(),
        NOW(),
        TRUE
      FROM upd_notas u
      RETURNING n_id_receb
    )
    SELECT
      (SELECT COUNT(*) FROM alvo) AS total_alvo,
      (SELECT COUNT(*) FROM map_doc) AS candidatos_doc,
      (SELECT COUNT(*) FROM map_pedido) AS candidatos_pedido,
      (SELECT COUNT(*) FROM map_final) AS candidatos_totais,
      (SELECT qtd FROM conflitos_doc_pedido) AS conflitos_doc_pedido,
      (SELECT COUNT(*) FROM upd_notas) AS notas_atualizadas,
      (SELECT COUNT(*) FROM upd_receb) AS recebimentos_atualizados,
      (SELECT COUNT(*) FROM upd_receb_extra) AS recebimentos_extra_via_notas,
      (SELECT COUNT(*) FROM ins_eventos) AS eventos_inseridos;
    `}
  `;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL ausente no ambiente');
  }
  if (!args.dryRun && (!process.env.OMIE_APP_KEY || !process.env.OMIE_APP_SECRET)) {
    throw new Error('OMIE_APP_KEY/OMIE_APP_SECRET ausentes no ambiente');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(sqlBackfill(args.limit, args.dryRun));
      const resumo = rows[0] || {};

      if (args.dryRun) {
        await client.query('ROLLBACK');
        console.log('[backfill-fornecedor-notas] dry-run:', resumo);
      } else {
        await client.query('COMMIT');
        console.log('[backfill-fornecedor-notas] concluido:', resumo);
      }
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }

    const { rows: statusRows } = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE n_id_fornecedor IS NOT NULL) AS com_fornecedor,
        COUNT(*) FILTER (WHERE n_id_fornecedor IS NULL) AS sem_fornecedor
      FROM logistica.notas_entrada_omie
    `);
    console.log('[backfill-fornecedor-notas] status_final_notas:', statusRows[0] || {});

    if (!args.dryRun) {
      const limitOmieSql = args.omieApiLimit > 0 ? `LIMIT ${Math.floor(args.omieApiLimit)}` : '';
      const { rows: pendenciasOmie } = await pool.query(`
        SELECT n_id_receb, c_chave_nfe, c_status
        FROM logistica.notas_entrada_omie
        WHERE n_id_fornecedor IS NULL
          AND COALESCE(BTRIM(c_chave_nfe), '') <> ''
        ORDER BY updated_at DESC NULLS LAST, n_id_receb DESC
        ${limitOmieSql}
      `);

      let omieOk = 0;
      let omieSemFornecedor = 0;
      let omieErro = 0;

      console.log(`[backfill-fornecedor-notas] pendentes_para_omie_api: ${pendenciasOmie.length}`);
      for (let i = 0; i < pendenciasOmie.length; i++) {
        const item = pendenciasOmie[i];
        try {
          const consulta = await consultarRecebimentoOmieByChave(item.c_chave_nfe);
          if (!consulta.ok) {
            omieSemFornecedor++;
            if ((i + 1) % 10 === 0 || i + 1 === pendenciasOmie.length) {
              console.log(`[backfill-fornecedor-notas] omie_api progresso ${i + 1}/${pendenciasOmie.length} | ok=${omieOk} | sem_fornecedor=${omieSemFornecedor} | erros=${omieErro}`);
            }
            await sleep(OMIE_DELAY_MS);
            continue;
          }

          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            await client.query(`
              UPDATE logistica.notas_entrada_omie
              SET
                n_id_fornecedor = $2,
                c_nome_fornecedor = COALESCE(NULLIF(BTRIM(c_nome_fornecedor), ''), NULLIF(BTRIM($3), '')),
                c_cnpj_cpf_fornecedor = COALESCE(NULLIF(BTRIM(c_cnpj_cpf_fornecedor), ''), NULLIF(BTRIM($4), '')),
                c_ultimo_topico = 'backfill.fornecedor.omie_api',
                updated_at = NOW()
              WHERE n_id_receb = $1
                AND n_id_fornecedor IS NULL
            `, [item.n_id_receb, consulta.nIdFornecedor, consulta.cNomeFornecedor, consulta.cCnpjCpfFornecedor]);

            await client.query(`
              UPDATE logistica.recebimentos_nfe_omie
              SET
                n_id_fornecedor = $2,
                c_nome_fornecedor = COALESCE(NULLIF(BTRIM(c_nome_fornecedor), ''), NULLIF(BTRIM($3), '')),
                c_cnpj_cpf_fornecedor = COALESCE(NULLIF(BTRIM(c_cnpj_cpf_fornecedor), ''), NULLIF(BTRIM($4), '')),
                updated_at = NOW()
              WHERE n_id_receb = $1
                AND n_id_fornecedor IS NULL
            `, [item.n_id_receb, consulta.nIdFornecedor, consulta.cNomeFornecedor, consulta.cCnpjCpfFornecedor]);

            await client.query(`
              INSERT INTO logistica.notas_entrada_omie_eventos (
                n_id_receb, c_chave_nfe, topic, c_status, origem_evento,
                payload, recebido_em, processado_em, processado_com_sucesso
              )
              VALUES (
                $1, $2, 'backfill.fornecedor.omie_api',
                CASE
                  WHEN $3 IN ('Incluida', 'Alterada', 'Concluida', 'Cancelada', 'Excluida', 'Desconhecida', 'Sincronizada')
                    THEN $3
                  ELSE 'Alterada'
                END,
                'omie_sync',
                $4::jsonb,
                NOW(), NOW(), TRUE
              )
            `, [
              item.n_id_receb,
              item.c_chave_nfe,
              item.c_status || 'Alterada',
              JSON.stringify({
                origem: 'omie_api_consultar_recebimento',
                n_id_fornecedor: consulta.nIdFornecedor,
                c_nome_fornecedor: consulta.cNomeFornecedor,
                c_cnpj_cpf_fornecedor: consulta.cCnpjCpfFornecedor,
              }),
            ]);

            await client.query('COMMIT');
            omieOk++;
          } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
          } finally {
            client.release();
          }
        } catch (e) {
          omieErro++;
          console.error(`[backfill-fornecedor-notas] omie_api erro n_id_receb=${item.n_id_receb}: ${e.message || e}`);
        }

        if ((i + 1) % 10 === 0 || i + 1 === pendenciasOmie.length) {
          console.log(`[backfill-fornecedor-notas] omie_api progresso ${i + 1}/${pendenciasOmie.length} | ok=${omieOk} | sem_fornecedor=${omieSemFornecedor} | erros=${omieErro}`);
        }
        await sleep(OMIE_DELAY_MS);
      }

      console.log('[backfill-fornecedor-notas] omie_api resumo:', {
        pendentes: pendenciasOmie.length,
        atualizados: omieOk,
        sem_fornecedor: omieSemFornecedor,
        erros: omieErro,
      });
    }

    const { rows: restantesRows } = await pool.query(`
      SELECT n_id_receb, c_chave_nfe, c_numero_nfe, c_status, c_ultimo_topico, updated_at
      FROM logistica.notas_entrada_omie
      WHERE n_id_fornecedor IS NULL
      ORDER BY updated_at DESC NULLS LAST, n_id_receb DESC
      LIMIT 20
    `);
    if (restantesRows.length) {
      console.log('[backfill-fornecedor-notas] amostra_restantes_sem_fornecedor:');
      for (const row of restantesRows) {
        console.log(JSON.stringify(row));
      }
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[backfill-fornecedor-notas] falha:', err.message || err);
  process.exit(1);
});
