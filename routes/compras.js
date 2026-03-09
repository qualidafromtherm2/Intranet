// routes/compras.js
const express = require('express');
const omieCall = require('../utils/omieCall');
const router = express.Router();

module.exports = (pool) => {
  const formatarDataBr = (valor) => {
    if (!valor) return null;
    const data = valor instanceof Date ? valor : new Date(valor);
    if (!(data instanceof Date) || Number.isNaN(data.getTime())) return null;
    const dd = String(data.getDate()).padStart(2, '0');
    const mm = String(data.getMonth() + 1).padStart(2, '0');
    const yyyy = String(data.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  };

  const formatarHoraBr = (valor) => {
    if (!valor) return null;
    const texto = String(valor).trim();
    if (!texto) return null;
    return texto.slice(0, 8);
  };

  const montarPayloadRecebimentoLocal = async (client, chaveNfe) => {
    const recebResult = await client.query(
      `SELECT
         r.n_id_receb,
         r.n_id_fornecedor,
         r.c_chave_nfe,
         r.c_numero_nfe,
         r.c_serie_nfe,
         r.c_modelo_nfe,
         r.d_emissao_nfe,
         r.n_valor_nfe,
         r.v_total_produtos,
         r.c_nome_fornecedor,
         r.c_cnpj_cpf_fornecedor,
         r.c_etapa,
         r.c_natureza_operacao,
         r.c_faturado,
         r.c_recebido,
         r.updated_at
       FROM logistica.recebimentos_nfe_omie r
       WHERE REGEXP_REPLACE(COALESCE(r.c_chave_nfe, ''), '\\D', '', 'g') = $1
       ORDER BY r.updated_at DESC NULLS LAST, r.n_id_receb DESC
       LIMIT 1`,
      [chaveNfe]
    );

    if (!recebResult.rows.length) return null;
    const receb = recebResult.rows[0];

    const itensResult = await client.query(
      `SELECT
         i.n_sequencia,
         i.c_codigo_produto,
         i.c_descricao_produto,
         i.n_qtde_nfe,
         i.c_unidade_nfe,
         i.n_preco_unit,
         i.v_total_item,
         i.n_id_produto,
         i.n_qtde_recebida,
         i.c_cfop_entrada,
         i.codigo_local_estoque
       FROM logistica.recebimentos_nfe_itens i
       WHERE i.n_id_receb = $1
       ORDER BY i.n_sequencia ASC NULLS LAST, i.id ASC`,
      [receb.n_id_receb]
    );

    const freteResult = await client.query(
      `SELECT
         f.c_modalidade_frete,
         f.c_nome_transportadora,
         f.c_cnpj_cpf_transportadora,
         f.n_quantidade_volumes,
         f.n_peso_bruto
       FROM logistica.recebimentos_nfe_frete f
       WHERE f.n_id_receb = $1
       ORDER BY f.id DESC
       LIMIT 1`,
      [receb.n_id_receb]
    ).catch(() => ({ rows: [] }));

    const frete = freteResult.rows[0] || {};
    const itens = Array.isArray(itensResult.rows) ? itensResult.rows : [];
    if (!itens.length) return null;

    return {
      cabec: {
        nIdReceb: receb.n_id_receb,
        nIdFornecedor: receb.n_id_fornecedor,
        cCNPJ_CPF: receb.c_cnpj_cpf_fornecedor,
        cNome: receb.c_nome_fornecedor,
        cRazaoSocial: receb.c_nome_fornecedor,
        cChaveNFe: receb.c_chave_nfe,
        cEtapa: receb.c_etapa,
        cNumeroNFe: receb.c_numero_nfe,
        cSerieNFe: receb.c_serie_nfe,
        cModeloNFe: receb.c_modelo_nfe,
        dEmissaoNFe: formatarDataBr(receb.d_emissao_nfe),
        nValorNFe: receb.n_valor_nfe,
        cNaturezaOperacao: receb.c_natureza_operacao
      },
      totais: {
        vTotalNFe: receb.n_valor_nfe,
        vTotalProdutos: receb.v_total_produtos
      },
      transporte: {
        cTipoFrete: frete.c_modalidade_frete || null,
        cNomeTransp: frete.c_nome_transportadora || null,
        cRazaoTransp: frete.c_nome_transportadora || null,
        cCnpjCpfTransp: frete.c_cnpj_cpf_transportadora || null,
        nQtdeVolume: frete.n_quantidade_volumes ?? null,
        nPesoBruto: frete.n_peso_bruto ?? null
      },
      infoCadastro: {
        cFaturado: receb.c_faturado || null,
        cRecebido: receb.c_recebido || null,
        dAlt: formatarDataBr(receb.updated_at),
        hAlt: formatarHoraBr(receb.updated_at),
        cOperacao: receb.c_natureza_operacao || null
      },
      itensRecebimento: itens.map((item, idx) => ({
        itensCabec: {
          nSequencia: Number(item.n_sequencia || idx + 1),
          cCodigoProduto: item.c_codigo_produto || null,
          cDescricaoProduto: item.c_descricao_produto || null,
          nQtdeNFe: item.n_qtde_nfe,
          cUnidadeNfe: item.c_unidade_nfe || null,
          nPrecoUnit: item.n_preco_unit,
          vTotalItem: item.v_total_item,
          nIdProduto: item.n_id_produto
        },
        itensAjustes: {
          cUnidade: item.c_unidade_nfe || null,
          cCFOPEntrada: item.c_cfop_entrada || null,
          nQtdeRecebida: item.n_qtde_recebida,
          codigo_local_estoque: item.codigo_local_estoque
        }
      }))
    };
  };

  // Lista atividades de compras por família
  router.get('/atividades/:familiaCodigo', async (req, res) => {
    const client = await pool.connect();
    try {
      const { familiaCodigo } = req.params;
      const { rows } = await client.query(`
        SELECT id, familia_codigo, nome_atividade, descricao_atividade, ordem, ativo, created_at
        FROM compras.atividades_familia
        WHERE familia_codigo = $1 AND ativo = true
        ORDER BY ordem ASC, created_at ASC
      `, [familiaCodigo]);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Cria nova atividade de compras
  router.post('/atividades', async (req, res) => {
    const client = await pool.connect();
    try {
      const { familiaCodigo, nomeAtividade, descricaoAtividade, ordem } = req.body || {};
      if (!familiaCodigo || !nomeAtividade) {
        return res.status(400).json({ error: 'familiaCodigo e nomeAtividade são obrigatórios' });
      }
      const { rows } = await client.query(`
        INSERT INTO compras.atividades_familia (familia_codigo, nome_atividade, descricao_atividade, ordem)
        VALUES ($1,$2,$3,$4) RETURNING *
      `,[familiaCodigo, nomeAtividade, descricaoAtividade || '', ordem || 0]);
      res.json({ ok: true, atividade: rows[0] });
    } catch (e) {
      console.error('[POST /api/compras/atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Soft delete
  router.delete('/atividades/:id', async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      await client.query(`UPDATE compras.atividades_familia SET ativo=false WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/compras/atividades/:id] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Lista atividades do produto com status
  router.get('/produto-atividades', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo, familia } = req.query || {};
      if (!codigo || !familia) return res.status(400).json({ error: 'codigo e familia são obrigatórios' });
      const { rows } = await client.query(`
         SELECT af.id, af.nome_atividade, af.descricao_atividade,
           s.concluido, s.nao_aplicavel, s.observacao, s.data_conclusao,
           s.responsavel_username AS responsavel,
           s.autor_username AS autor,
           s.prazo
        FROM compras.atividades_familia af
        LEFT JOIN compras.atividades_produto_status s
          ON s.atividade_id = af.id AND s.produto_codigo = $1
        WHERE af.familia_codigo = $2 AND af.ativo = true
        ORDER BY af.ordem ASC, af.created_at ASC
      `, [codigo, familia]);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/produto-atividades] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Salvar status em bulk
  router.post('/produto-status/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
      const { produto_codigo, produto_id_omie, itens } = req.body || {};
      if (!produto_codigo || !Array.isArray(itens)) return res.status(400).json({ error: 'produto_codigo e itens são obrigatórios' });
      await client.query('BEGIN');
      for (const it of itens) {
        const { atividade_id, concluido, nao_aplicavel, observacao, responsavel, autor, prazo } = it;
        const data_conclusao = concluido ? new Date() : null;
        const prazoDate = prazo ? new Date(prazo) : null;
        await client.query(`
          INSERT INTO compras.atividades_produto_status
            (produto_codigo, produto_id_omie, atividade_id, concluido, nao_aplicavel, observacao, data_conclusao, responsavel_username, autor_username, prazo)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (produto_codigo, atividade_id)
          DO UPDATE SET concluido=EXCLUDED.concluido, nao_aplicavel=EXCLUDED.nao_aplicavel,
                        observacao=EXCLUDED.observacao, data_conclusao=EXCLUDED.data_conclusao,
                        responsavel_username = EXCLUDED.responsavel_username,
                        autor_username = EXCLUDED.autor_username,
                        prazo = EXCLUDED.prazo,
                        updated_at=NOW();
        `, [
          produto_codigo,
          produto_id_omie || null,
          atividade_id,
          !!concluido,
          !!nao_aplicavel,
          observacao || '',
          data_conclusao,
          responsavel || null,
          autor || null,
          prazoDate
        ]);
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await (async ()=>{ try{ await client.query('ROLLBACK'); }catch(_){} })();
      console.error('[POST /api/compras/produto-status/bulk] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Criar atividade específica de um produto
  router.post('/atividade-produto', async (req, res) => {
    const client = await pool.connect();
    try {
      const { produto_codigo, descricao, observacoes } = req.body;
      
      if (!produto_codigo || !descricao) {
        return res.status(400).json({ error: 'produto_codigo e descricao são obrigatórios' });
      }
      
      const { rows } = await client.query(`
        INSERT INTO compras.atividades_produto 
          (produto_codigo, descricao, observacoes, ativo, criado_em)
        VALUES ($1, $2, $3, true, NOW())
        RETURNING id, produto_codigo, descricao, observacoes, ativo, criado_em
      `, [produto_codigo, descricao, observacoes || null]);
      
      console.log(`[Compras] Nova atividade criada para produto ${produto_codigo}: ${descricao}`);
      res.json({ success: true, atividade: rows[0] });
    } catch (e) {
      console.error('[POST /api/compras/atividade-produto] erro:', e);
      res.status(500).json({ error: 'Falha ao criar atividade do produto' });
    } finally {
      client.release();
    }
  });

  // Listar atividades específicas de um produto
  router.get('/atividades-produto/:codigo', async (req, res) => {
    const client = await pool.connect();
    try {
      const { codigo } = req.params;
      
      const { rows } = await client.query(`
        SELECT 
          ap.id,
          ap.produto_codigo,
          ap.descricao AS nome,
          ap.observacoes,
          ap.ativo,
          ap.criado_em,
          COALESCE(aps.concluido, false) AS concluido,
          COALESCE(aps.nao_aplicavel, false) AS nao_aplicavel,
          COALESCE(aps.observacao_status, '') AS observacao_status,
          aps.responsavel_username AS responsavel,
          aps.autor_username AS autor,
          aps.prazo,
          aps.atualizado_em
        FROM compras.atividades_produto ap
        LEFT JOIN compras.atividades_produto_status_especificas aps
          ON aps.atividade_produto_id = ap.id AND aps.produto_codigo = ap.produto_codigo
        WHERE ap.produto_codigo = $1 AND ap.ativo = true
        ORDER BY ap.criado_em DESC
      `, [codigo]);
      
      res.json({ atividades: rows });
    } catch (e) {
      console.error('[GET /api/compras/atividades-produto] erro:', e);
      res.status(500).json({ error: 'Falha ao buscar atividades do produto' });
    } finally {
      client.release();
    }
  });

  // Salvar status das atividades específicas do produto em bulk
  router.post('/atividade-produto-status/bulk', async (req, res) => {
    const client = await pool.connect();
    try {
      const { produto_codigo, itens } = req.body || {};
      if (!produto_codigo || !Array.isArray(itens)) {
        return res.status(400).json({ error: 'produto_codigo e itens são obrigatórios' });
      }
      
      await client.query('BEGIN');
      
      for (const it of itens) {
        const { atividade_produto_id, concluido, nao_aplicavel, observacao, responsavel, autor, prazo } = it;
        const data_conclusao = concluido ? new Date() : null;
        const prazoDate = prazo ? new Date(prazo) : null;
        
        await client.query(`
          INSERT INTO compras.atividades_produto_status_especificas
            (produto_codigo, atividade_produto_id, concluido, nao_aplicavel, observacao_status, data_conclusao, responsavel_username, autor_username, prazo)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (produto_codigo, atividade_produto_id)
          DO UPDATE SET
            concluido = EXCLUDED.concluido,
            nao_aplicavel = EXCLUDED.nao_aplicavel,
            observacao_status = EXCLUDED.observacao_status,
            data_conclusao = EXCLUDED.data_conclusao,
            responsavel_username = EXCLUDED.responsavel_username,
            autor_username = EXCLUDED.autor_username,
            prazo = EXCLUDED.prazo,
            atualizado_em = NOW()
        `, [
          produto_codigo,
          atividade_produto_id,
          !!concluido,
          !!nao_aplicavel,
          observacao || '',
          data_conclusao,
          responsavel || null,
          autor || null,
          prazoDate
        ]);
      }
      
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await (async () => { try { await client.query('ROLLBACK'); } catch(_){} })();
      console.error('[POST /api/compras/atividade-produto-status/bulk] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Busca solicitações de compras para recebimento
  router.get('/solicitacoes-recebimento', async (req, res) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`
        WITH referencias_grupo AS (
          SELECT
            NULLIF(BTRIM(sc.grupo_requisicao), '') AS grupo_requisicao,
            NULLIF(BTRIM(sc.solicitante), '') AS solicitante,
            NULLIF(BTRIM(sc.resp_inspecao_recebimento), '') AS resp_inspecao_recebimento,
            COALESCE(sc.updated_at, sc.created_at) AS ref_data,
            1 AS origem_ordem
          FROM compras.solicitacao_compras sc
          WHERE NULLIF(BTRIM(sc.grupo_requisicao), '') IS NOT NULL

          UNION ALL

          SELECT
            NULLIF(BTRIM(csc.grupo_requisicao), '') AS grupo_requisicao,
            NULLIF(BTRIM(csc.solicitante), '') AS solicitante,
            NULLIF(BTRIM(csc.resp_inspecao_recebimento), '') AS resp_inspecao_recebimento,
            COALESCE(csc.updated_at, csc.created_at) AS ref_data,
            2 AS origem_ordem
          FROM compras.compras_sem_cadastro csc
          WHERE NULLIF(BTRIM(csc.grupo_requisicao), '') IS NOT NULL
        ),
        referencia_escolhida AS (
          SELECT DISTINCT ON (rg.grupo_requisicao)
            rg.grupo_requisicao,
            rg.solicitante,
            rg.resp_inspecao_recebimento
          FROM referencias_grupo rg
          ORDER BY
            rg.grupo_requisicao,
            CASE WHEN rg.solicitante IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN rg.resp_inspecao_recebimento IS NOT NULL THEN 0 ELSE 1 END,
            rg.ref_data DESC NULLS LAST,
            rg.origem_ordem ASC
        ),
        recebimentos_base AS (
          SELECT DISTINCT
            NULLIF(BTRIM(r.n_id_fornecedor::text), '') AS id_fornecedor_omie,
            NULLIF(BTRIM(r.c_numero_nfe), '') AS numero_nfe,
            NULLIF(BTRIM(r.c_chave_nfe), '') AS chave_nfe,
            r.d_emissao_nfe::date AS d_emissao_nfe
          FROM logistica.recebimentos_nfe_omie r
          WHERE r.n_id_fornecedor IS NOT NULL
            AND NULLIF(BTRIM(r.c_numero_nfe), '') IS NOT NULL
        )
        SELECT 
          po.n_cod_ped,
          po.c_numero AS cnumero,
          COALESCE(
            NULLIF(BTRIM(po."Etapa_NF"), ''),
            NULLIF(BTRIM(po.c_etapa), '')
          ) AS etapa_nf_codigo,
          COALESCE(
            CASE
              WHEN NULLIF(BTRIM(po."Etapa_NF"), '') IS NOT NULL THEN
                COALESCE(
                  NULLIF(BTRIM(ern.descricao_customizada), ''),
                  NULLIF(BTRIM(ern.descricao), ''),
                  NULLIF(BTRIM(po."Etapa_NF"), '')
                )
              ELSE
                COALESCE(
                  NULLIF(BTRIM(epc.descricao_padrao), ''),
                  NULLIF(BTRIM(epc.descricao_customizada), ''),
                  NULLIF(BTRIM(po.c_etapa), '')
                )
            END,
            'Sem etapa'
          ) AS etapa_nf,
          COALESCE(
            CASE
              WHEN NULLIF(BTRIM(po."Etapa_NF"), '') IS NOT NULL THEN
                COALESCE(
                  NULLIF(BTRIM(ern.descricao_customizada), ''),
                  NULLIF(BTRIM(ern.descricao), ''),
                  NULLIF(BTRIM(po."Etapa_NF"), '')
                )
              ELSE
                COALESCE(
                  NULLIF(BTRIM(epc.descricao_padrao), ''),
                  NULLIF(BTRIM(epc.descricao_customizada), ''),
                  NULLIF(BTRIM(po.c_etapa), '')
                )
            END,
            'Sem etapa'
          ) AS etapa_nf_descricao,
          CASE
            WHEN NULLIF(BTRIM(po."Etapa_NF"), '') IS NOT NULL THEN NULLIF(BTRIM(ern.cor), '')
            ELSE COALESCE(
              NULLIF(BTRIM(to_jsonb(epc)->>'cor'), ''),
              CASE NULLIF(BTRIM(po.c_etapa), '')
                WHEN '20' THEN '#FFA500'
                WHEN '15' THEN '#FF8C00'
                WHEN '10' THEN '#FFD700'
                ELSE NULL
              END
            )
          END AS etapa_nf_cor,
          CASE
            WHEN NULLIF(BTRIM(po."Etapa_NF"), '') IS NOT NULL THEN NULLIF(BTRIM(ern.icone), '')
            ELSE COALESCE(
              NULLIF(BTRIM(to_jsonb(epc)->>'icone'), ''),
              CASE NULLIF(BTRIM(po.c_etapa), '')
                WHEN '20' THEN 'clipboard-list'
                WHEN '15' THEN 'circle-check'
                WHEN '10' THEN 'cart-shopping'
                ELSE NULL
              END
            )
          END AS etapa_nf_icone,
          pop.id,
          pop.n_cod_item,
          pop.c_produto AS produto_codigo,
          pop.c_descricao AS produto_descricao,
          pop.n_qtde AS quantidade,
          pop.c_unidade AS unidade,
          COALESCE(pop.n_val_tot, 0) AS valor_item,
          SUM(COALESCE(pop.n_val_tot, 0)) OVER (PARTITION BY po.n_cod_ped) AS valor_total_pedido,
          re.solicitante,
          po.d_dt_previsao AS previsao_chegada,
          re.resp_inspecao_recebimento,
          f.nome_fantasia AS fornecedor_nome_fantasia,
          f.razao_social AS fornecedor_razao_social,
          f.cnpj_cpf AS fornecedor_cnpj_cpf,
          f.cidade AS fornecedor_cidade,
          f.estado AS fornecedor_estado,
          f.telefone1_ddd AS fornecedor_telefone1_ddd,
          f.telefone1_numero AS fornecedor_telefone1_numero,
          po."NFe vinculada" AS nfe_vinculada,
          rpf.lista_numeros_nfe AS fornecedor_lista_numeros_nfe,
          rpf.lista_nfes AS fornecedor_lista_nfes,
          COALESCE(pop.c_obs, po.c_obs) AS observacao,
          po.created_at
        FROM compras.pedidos_omie po
        INNER JOIN compras.pedidos_omie_produtos pop
          ON pop.n_cod_ped = po.n_cod_ped
        LEFT JOIN logistica.etapas_recebimento_nfe ern
          ON BTRIM(ern.codigo::text) = BTRIM(COALESCE(NULLIF(BTRIM(po."Etapa_NF"), ''), ''))
         AND BTRIM(ern.codigo::text) IN ('40', '50', '60')
        LEFT JOIN compras.etapas_pedido_compra epc
          ON BTRIM(epc.codigo::text) = BTRIM(COALESCE(NULLIF(BTRIM(po.c_etapa), ''), ''))
        LEFT JOIN omie.fornecedores f
          ON f.codigo_cliente_omie = po.n_cod_for
        LEFT JOIN LATERAL (
          SELECT
            STRING_AGG(rb.numero_nfe, ', ' ORDER BY rb.numero_nfe) AS lista_numeros_nfe,
            JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'numero_nfe', rb.numero_nfe,
                'chave_nfe', rb.chave_nfe
              )
              ORDER BY rb.numero_nfe, rb.chave_nfe
            ) FILTER (WHERE rb.chave_nfe IS NOT NULL) AS lista_nfes
          FROM recebimentos_base rb
          WHERE rb.id_fornecedor_omie = NULLIF(BTRIM(po.n_cod_for::text), '')
            AND (
              po.d_inc_data IS NULL
              OR (rb.d_emissao_nfe IS NOT NULL AND rb.d_emissao_nfe >= po.d_inc_data::date)
            )
            AND NOT EXISTS (
              SELECT 1
              FROM compras.pedidos_omie po_v
              WHERE NULLIF(BTRIM(po_v."NFe vinculada"), '') = rb.numero_nfe
                AND po_v.n_cod_ped IS DISTINCT FROM po.n_cod_ped
            )
        ) rpf ON TRUE
        LEFT JOIN referencia_escolhida re
          ON re.grupo_requisicao = NULLIF(BTRIM(po.c_obs_int), '')
        WHERE po.c_numero IS NOT NULL
          AND COALESCE(po.inativo, FALSE) = FALSE
          AND NULLIF(BTRIM(po.c_obs_int), '') IS NOT NULL
          AND BTRIM(po.c_obs_int) ~ '^[0-9]{8}-[0-9]{6}-[0-9]{3}$'
          AND (
            COALESCE(BTRIM(po."Etapa_NF"), '') = ''
            OR BTRIM(po."Etapa_NF") IN ('50', '60')
          )
        ORDER BY po.c_numero DESC, pop.id ASC
      `);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/solicitacoes-recebimento] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Consulta detalhes de recebimento da NF-e na Omie via c_chave_nfe
  router.get('/nfe-xml-detalhes', async (req, res) => {
    try {
      const chaveNfe = String(req.query?.chave_nfe || '').replace(/\D/g, '');
      if (!/^\d{44}$/.test(chaveNfe)) {
        return res.status(400).json({
          ok: false,
          error: 'Parâmetro chave_nfe inválido. Informe os 44 dígitos da chave da NF-e.'
        });
      }

      const extrairSegundosRedundant = (mensagem) => {
        const texto = String(mensagem || '');
        const match = texto.match(/Aguarde\s+(\d+)\s+segundos?/i);
        if (!match) return null;
        const segundos = Number(match[1]);
        return Number.isFinite(segundos) && segundos >= 0 ? segundos : null;
      };

      const etapasLegendaQuery = await pool.query(`
        SELECT
          BTRIM(codigo::text) AS codigo,
          NULLIF(BTRIM(descricao), '') AS descricao,
          NULLIF(BTRIM(descricao_customizada), '') AS descricao_customizada,
          ordem,
          NULLIF(BTRIM(cor), '') AS cor,
          NULLIF(BTRIM(icone), '') AS icone
        FROM logistica.etapas_recebimento_nfe
        WHERE ordem >= 4
        ORDER BY
          ordem ASC NULLS LAST,
          CASE WHEN BTRIM(codigo::text) ~ '^\\d+$' THEN BTRIM(codigo::text)::int END ASC NULLS LAST,
          BTRIM(codigo::text) ASC
      `);

      const etapasLegenda = Array.isArray(etapasLegendaQuery.rows) ? etapasLegendaQuery.rows : [];
      const client = await pool.connect();
      let retorno = null;
      let source = 'omie';
      try {
        retorno = await montarPayloadRecebimentoLocal(client, chaveNfe);
        if (retorno?.cabec?.nIdReceb) {
          source = 'sql-cache';
        }
      } finally {
        client.release();
      }

      if (!retorno?.cabec?.nIdReceb) {
        const appKey = process.env.OMIE_APP_KEY;
        const appSecret = process.env.OMIE_APP_SECRET;
        if (!appKey || !appSecret) {
          return res.status(500).json({
            ok: false,
            error: 'Credenciais Omie não configuradas no servidor'
          });
        }

        try {
          retorno = await omieCall('https://app.omie.com.br/api/v1/produtos/recebimentonfe/', {
            call: 'ConsultarRecebimento',
            param: [{
              cChaveNfe: chaveNfe
            }],
            app_key: appKey,
            app_secret: appSecret
          }, {
            retryRedundant: false
          });
        } catch (erroOmie) {
          const mensagem = String(erroOmie?.message || erroOmie || '');
          const isRedundant = /REDUNDANT|consumo redundante/i.test(mensagem);
          if (isRedundant) {
            const segundosOmie = extrairSegundosRedundant(mensagem);
            const retryAfterSeconds = Math.max(5, (Number.isFinite(segundosOmie) ? segundosOmie : 0) + 5);
            return res.status(429).json({
              ok: false,
              redundant: true,
              retry_after_seconds: retryAfterSeconds,
              error: mensagem
            });
          }
          throw erroOmie;
        }

        const fault = retorno?.faultstring || retorno?.faultcode || '';
        if (fault) {
          return res.status(502).json({
            ok: false,
            error: String(fault)
          });
        }
      }

      try {
        const clientItens = await pool.connect();
        try {
          let nIdRecebItens = Number(retorno?.cabec?.nIdReceb || 0);
          if (!Number.isFinite(nIdRecebItens) || nIdRecebItens <= 0) {
            const recebLocal = await clientItens.query(
              `SELECT r.n_id_receb
                 FROM logistica.recebimentos_nfe_omie r
                WHERE REGEXP_REPLACE(COALESCE(r.c_chave_nfe, ''), '\\D', '', 'g') = $1
                ORDER BY r.updated_at DESC NULLS LAST, r.n_id_receb DESC
                LIMIT 1`,
              [chaveNfe]
            );
            nIdRecebItens = Number(recebLocal.rows?.[0]?.n_id_receb || 0);
          }

          if (Number.isFinite(nIdRecebItens) && nIdRecebItens > 0) {
            const itensLocalQuery = await clientItens.query(
              `SELECT
                 i.n_sequencia,
                 NULLIF(BTRIM(i.c_codigo_produto), '') AS c_codigo_produto,
                 NULLIF(BTRIM(i.c_descricao_produto), '') AS c_descricao_produto
               FROM logistica.recebimentos_nfe_itens i
               WHERE i.n_id_receb = $1
               ORDER BY i.n_sequencia ASC NULLS LAST, i.id ASC`,
              [nIdRecebItens]
            );

            const itensLocais = Array.isArray(itensLocalQuery.rows) ? itensLocalQuery.rows : [];
            const itensRecebimento = Array.isArray(retorno?.itensRecebimento) ? retorno.itensRecebimento : [];

            if (itensLocais.length && itensRecebimento.length) {
              const mapaPorSequencia = new Map();
              itensLocais.forEach((item, idx) => {
                const seq = Number(item?.n_sequencia || idx + 1);
                if (Number.isFinite(seq) && seq > 0 && !mapaPorSequencia.has(seq)) {
                  mapaPorSequencia.set(seq, item);
                }
              });

              retorno.itensRecebimento = itensRecebimento.map((item, idx) => {
                const cabec = item?.itensCabec || {};
                const seqAtual = Number(cabec?.nSequencia || idx + 1);
                const itemLocal = mapaPorSequencia.get(seqAtual) || itensLocais[idx] || null;
                if (!itemLocal) return item;

                return {
                  ...item,
                  itensCabec: {
                    ...cabec,
                    cCodigoProduto: itemLocal.c_codigo_produto || cabec.cCodigoProduto || null,
                    cDescricaoProduto: itemLocal.c_descricao_produto || cabec.cDescricaoProduto || null
                  }
                };
              });
            }
          }
        } finally {
          clientItens.release();
        }
      } catch (erroItensLocal) {
        console.warn('[GET /api/compras/nfe-xml-detalhes] aviso ao aplicar itens locais:', erroItensLocal?.message || erroItensLocal);
      }

      const etapaCodigo = String(retorno?.cabec?.cEtapa || '').trim();
      const etapaInfo = etapaCodigo
        ? (etapasLegenda.find((etapa) => String(etapa?.codigo || '').trim() === etapaCodigo) || null)
        : null;

      return res.json({
        ok: true,
        chave_nfe: chaveNfe,
        call: 'ConsultarRecebimento',
        data: retorno,
        source,
        etapa_info: etapaInfo,
        etapas_legenda: etapasLegenda
      });
    } catch (e) {
      console.error('[GET /api/compras/nfe-xml-detalhes] erro:', e);
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  // Envia dados exportados para um webhook do Google Apps Script (Google Sheets)
  router.post('/exportar-google-sheets', async (req, res) => {
    try {
      const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
      if (!webhookUrl) {
        return res.status(500).json({
          ok: false,
          error: 'GOOGLE_SHEETS_WEBHOOK_URL não configurada no ambiente'
        });
      }

      const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
      const historicoLinhas = Array.isArray(req.body?.historicoLinhas) ? req.body.historicoLinhas : [];
      if (!linhas.length && !historicoLinhas.length) {
        return res.status(400).json({
          ok: false,
          error: 'Nenhuma linha enviada para atualização da planilha'
        });
      }

      const fetchFn = global.safeFetch || globalThis.fetch;
      if (!fetchFn) {
        return res.status(500).json({
          ok: false,
          error: 'Fetch indisponível no servidor para integrar com Google Sheets'
        });
      }

      const respostaWebhook = await fetchFn(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linhas,
          historicoLinhas,
          abas: {
            KANBAN: linhas,
            historico: historicoLinhas
          }
        })
      });

      const contentType = String(respostaWebhook.headers.get('content-type') || '').toLowerCase();
      const payloadTexto = await respostaWebhook.text();
      let payloadJson = null;
      try {
        payloadJson = payloadTexto ? JSON.parse(payloadTexto) : null;
      } catch (_) {
        payloadJson = null;
      }

      if (!respostaWebhook.ok) {
        return res.status(502).json({
          ok: false,
          error: `Webhook Google Sheets retornou HTTP ${respostaWebhook.status}`,
          detalhe: payloadJson || payloadTexto || null
        });
      }

      // Alguns erros do Apps Script retornam HTTP 200 com HTML de página de erro.
      // Nesses casos, força falha para o front não exibir falso sucesso.
      if (contentType.includes('text/html')) {
        return res.status(502).json({
          ok: false,
          error: 'Webhook Google Sheets retornou HTML (provável erro de publicação/permissão no Apps Script)',
          detalhe: payloadTexto ? payloadTexto.slice(0, 500) : null
        });
      }

      if (payloadJson && payloadJson.ok === false) {
        return res.status(502).json({
          ok: false,
          error: 'Apps Script retornou erro lógico',
          detalhe: payloadJson
        });
      }

      return res.json({
        ok: true,
        webhookStatus: respostaWebhook.status,
        webhookRetorno: payloadJson || payloadTexto || { ok: true }
      });
    } catch (e) {
      console.error('[POST /api/compras/exportar-google-sheets] erro:', e);
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  return router;
};
