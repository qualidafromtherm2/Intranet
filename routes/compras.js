// routes/compras.js
const express = require('express');
const omieCall = require('../utils/omieCall');
const router = express.Router();

module.exports = (pool) => {
  const normalizarNumeroNfeComparacao = (valor) => {
    const digitos = String(valor || '').replace(/\D/g, '');
    if (!digitos) return '';
    const semZeros = digitos.replace(/^0+/, '');
    return semZeros || '0';
  };

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

  const obterNomeBancoConta = (codigoBanco, descricaoConta = '') => {
    const codigo = String(codigoBanco || '').trim().toUpperCase();
    const descricao = String(descricaoConta || '').trim();
    const mapa = {
      '001': 'Banco do Brasil',
      '085': 'Transpocred',
      '136': 'Unicred',
      '260': 'Nubank',
      '323': 'Mercado Pago',
      '341': 'Itaú Unibanco',
      '450': 'Omie.CASH',
      '630': 'Omie.CASH Boletos',
      '971': 'Redecard',
      '985': 'Cartão pré-pago',
      '986': 'Cartão de crédito',
      '999': 'Conta interna',
      'ADC': 'Adiantamento de Cliente',
      'ADF': 'Adiantamento ao Fornecedor'
    };

    return mapa[codigo] || descricao || (codigo ? `Banco ${codigo}` : 'Não informado');
  };

  const obterTipoContaDescricao = (tipoConta) => {
    const tipo = String(tipoConta || '').trim().toUpperCase();
    const mapa = {
      'CC': 'Conta Corrente',
      'CA': 'Conta Aplicação',
      'CX': 'Caixa',
      'CG': 'Conta Garantida',
      'CR': 'Cartão',
      'AD': 'Adiantamento',
      'AC': 'Adquirente'
    };
    return mapa[tipo] || (tipo || 'Não informado');
  };

  const sanitizarPayloadAlteracaoContaCorrente = (contaAtual = {}, observacao = '') => {
    const payload = {
      ...contaAtual,
      nCodCC: Number(contaAtual?.nCodCC || 0) || null,
      observacao: String(observacao ?? '')
    };

    [
      'cCodStatus', 'cDesStatus', 'codigo', 'codigo_integracao',
      'banco_nome', 'tipo_descricao'
    ].forEach((campo) => delete payload[campo]);

    const tipoConta = String(payload?.tipo_conta_corrente || payload?.tipo || '').trim().toUpperCase();
    const pdvEnviar = String(payload?.pdv_enviar || 'N').trim().toUpperCase();
    const podeUsarCamposPdv = tipoConta === 'AC' && pdvEnviar === 'S';

    if (!podeUsarCamposPdv) {
      [
        'pdv_enviar', 'pdv_sincr_analitica', 'pdv_dias_venc', 'pdv_num_parcelas',
        'pdv_tipo_tef', 'pdv_cod_adm', 'pdv_limite_pacelas', 'pdv_taxa_loja',
        'pdv_taxa_adm', 'pdv_categoria', 'pdv_bandeira', 'cTipoCartao',
        'cEstabelecimento', 'cCnpjInstFinanc'
      ].forEach((campo) => delete payload[campo]);
    }

    return payload;
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

  const montarPayloadNfeViaDfeDocs = async ({ chaveNfe, numeroNfe = '' } = {}) => {
    const appKey = process.env.OMIE_APP_KEY;
    const appSecret = process.env.OMIE_APP_SECRET;
    if (!appKey || !appSecret) return null;

    const chaveLimpa = String(chaveNfe || '').replace(/\D/g, '');
    const numeroPorChaveRaw = chaveLimpa.length === 44 ? chaveLimpa.slice(25, 34) : '';
    const numeroPorChaveNorm = normalizarNumeroNfeComparacao(numeroPorChaveRaw);
    const numeroReqDigitos = String(numeroNfe || '').replace(/\D/g, '');
    const numeroReqNorm = normalizarNumeroNfeComparacao(numeroNfe);

    const candidatosNumero = Array.from(new Set([
      String(numeroNfe || '').trim(),
      numeroReqDigitos,
      numeroReqNorm,
      numeroPorChaveRaw,
      numeroPorChaveNorm,
    ].filter(Boolean)));

    let consultaData = null;
    let nIdNF = 0;

    for (const candidato of candidatosNumero) {
      let consulta;
      try {
        consulta = await omieCall('https://app.omie.com.br/api/v1/produtos/nfconsultar/', {
          call: 'ConsultarNF',
          param: [{ nNF: candidato }],
          app_key: appKey,
          app_secret: appSecret
        }, { retryRedundant: false });
      } catch (errConsulta) {
        continue;
      }

      nIdNF = Number(
        consulta?.compl?.nIdNF
        || consulta?.compl?.nIdNf
        || consulta?.nIdNF
        || consulta?.nIdNfe
        || 0
      );

      if (Number.isFinite(nIdNF) && nIdNF > 0) {
        consultaData = consulta;
        break;
      }
    }

    if (!Number.isFinite(nIdNF) || nIdNF <= 0) {
      return null;
    }

    const obterNfe = await omieCall('https://app.omie.com.br/api/v1/produtos/dfedocs/', {
      call: 'ObterNfe',
      param: [{ nIdNfe: nIdNF }],
      app_key: appKey,
      app_secret: appSecret
    }, { retryRedundant: false });

    const chaveDoc = String(obterNfe?.nChaveNfe || obterNfe?.cChaveNfe || '').replace(/\D/g, '');
    if (!/^\d{44}$/.test(chaveDoc)) {
      return null;
    }

    return {
      cabec: {
        nIdReceb: null,
        cChaveNFe: chaveDoc,
        cNumeroNFe: String(obterNfe?.cNumNfe || consultaData?.cabec?.nNF || numeroNfe || '').trim(),
        cEtapa: null,
        dEmissaoNFe: String(obterNfe?.dDataEmisNfe || '').trim() || null,
      },
      infoCadastro: {
        cOperacao: 'NF-e faturamento (Omie DFEDocs)'
      },
      itensRecebimento: [],
      dfe_docs: {
        nIdNF,
        cPdf: String(obterNfe?.cPdf || '').trim() || null,
        cLinkPortal: String(obterNfe?.cLinkPortal || '').trim() || null,
        cCodStatus: String(obterNfe?.cCodStatus || '').trim() || null,
        cDesStatus: String(obterNfe?.cDesStatus || '').trim() || null
      }
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
        WITH referencia_escolhida AS (
          -- Busca solicitante e responsável pelo grupo_requisicao vinculado ao pedido
          SELECT DISTINCT ON (rg.grupo_requisicao)
            rg.grupo_requisicao,
            rg.solicitante,
            rg.resp_inspecao_recebimento
          FROM (
            SELECT NULLIF(BTRIM(sc.grupo_requisicao), '') AS grupo_requisicao,
                   NULLIF(BTRIM(sc.solicitante), '') AS solicitante,
                   NULLIF(BTRIM(sc.resp_inspecao_recebimento), '') AS resp_inspecao_recebimento,
                   COALESCE(sc.updated_at, sc.created_at) AS ref_data, 1 AS origem_ordem
            FROM compras.solicitacao_compras sc
            WHERE NULLIF(BTRIM(sc.grupo_requisicao), '') IS NOT NULL
            UNION ALL
            SELECT NULLIF(BTRIM(csc.grupo_requisicao), ''),
                   NULLIF(BTRIM(csc.solicitante), ''),
                   NULLIF(BTRIM(csc.resp_inspecao_recebimento), ''),
                   COALESCE(csc.updated_at, csc.created_at), 2
            FROM compras.compras_sem_cadastro csc
            WHERE NULLIF(BTRIM(csc.grupo_requisicao), '') IS NOT NULL
          ) rg
          ORDER BY rg.grupo_requisicao,
            CASE WHEN rg.solicitante IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN rg.resp_inspecao_recebimento IS NOT NULL THEN 0 ELSE 1 END,
            rg.ref_data DESC NULLS LAST, rg.origem_ordem ASC
        ),
        recebimentos_base AS (
          -- NF-es recebidas para cruzar com os pedidos
          SELECT
            NULLIF(BTRIM(r.n_id_fornecedor::text), '') AS id_fornecedor_omie,
            NULLIF(BTRIM(r.c_numero_nfe), '') AS numero_nfe,
            NULLIF(BTRIM(r.c_chave_nfe), '') AS chave_nfe,
            r.d_emissao_nfe::date AS d_emissao_nfe,
            COALESCE(MAX(r.n_valor_nfe), 0)           AS valor_nfe
          FROM logistica.recebimentos_nfe_omie r
          WHERE r.n_id_fornecedor IS NOT NULL
            AND NULLIF(BTRIM(r.c_numero_nfe), '') IS NOT NULL
          GROUP BY 1, 2, 3, 4
        )
        SELECT
          po.n_cod_ped,
          po.c_numero                                    AS cnumero,
          NULLIF(BTRIM(po.c_etapa), '')                  AS etapa_nf_codigo,
          COALESCE(
            NULLIF(BTRIM(epc.descricao_padrao), ''),
            NULLIF(BTRIM(epc.descricao_customizada), ''),
            NULLIF(BTRIM(po.c_etapa), ''),
            'Sem etapa'
          )                                              AS etapa_nf,
          COALESCE(
            NULLIF(BTRIM(epc.descricao_padrao), ''),
            NULLIF(BTRIM(epc.descricao_customizada), ''),
            NULLIF(BTRIM(po.c_etapa), ''),
            'Sem etapa'
          )                                              AS etapa_nf_descricao,
          COALESCE(
            NULLIF(BTRIM(to_jsonb(epc)->>'cor'), ''),
            CASE NULLIF(BTRIM(po.c_etapa), '')
              WHEN '20' THEN '#FFA500'
              WHEN '15' THEN '#FF8C00'
              WHEN '10' THEN '#FFD700'
              ELSE '#64748b'
            END
          )                                              AS etapa_nf_cor,
          COALESCE(
            NULLIF(BTRIM(to_jsonb(epc)->>'icone'), ''),
            CASE NULLIF(BTRIM(po.c_etapa), '')
              WHEN '20' THEN 'clipboard-list'
              WHEN '15' THEN 'circle-check'
              WHEN '10' THEN 'cart-shopping'
              ELSE 'box'
            END
          )                                              AS etapa_nf_icone,
          pop.id,
          pop.n_cod_item,
          pop.c_produto                                  AS produto_codigo,
          pop.c_descricao                                AS produto_descricao,
          pop.n_qtde                                     AS quantidade,
          pop.c_unidade                                  AS unidade,
          COALESCE(pop.n_val_tot, 0)                     AS valor_item,
          SUM(COALESCE(pop.n_val_tot, 0)) OVER (PARTITION BY po.n_cod_ped) AS valor_total_pedido,
          re.solicitante,
          po.d_dt_previsao                               AS previsao_chegada,
          re.resp_inspecao_recebimento,
          f.nome_fantasia                                AS fornecedor_nome_fantasia,
          f.razao_social                                 AS fornecedor_razao_social,
          f.cnpj_cpf                                     AS fornecedor_cnpj_cpf,
          f.cidade                                       AS fornecedor_cidade,
          f.estado                                       AS fornecedor_estado,
          f.telefone1_ddd                                AS fornecedor_telefone1_ddd,
          f.telefone1_numero                             AS fornecedor_telefone1_numero,
          po."NFe vinculada"                             AS nfe_vinculada,
          rpf.lista_numeros_nfe                          AS fornecedor_lista_numeros_nfe,
          rpf.lista_nfes                                 AS fornecedor_lista_nfes,
          COALESCE(pop.c_obs, po.c_obs)                  AS observacao,
          po.d_inc_data
        FROM compras.pedidos_omie po
        -- ============================================================
        -- REGRA PRINCIPAL: inativo = false E Etapa_NF = NULL
        -- ============================================================
        INNER JOIN compras.pedidos_omie_produtos pop
          ON pop.n_cod_ped = po.n_cod_ped
        LEFT JOIN compras.etapas_pedido_compra epc
          ON BTRIM(epc.codigo::text) = BTRIM(COALESCE(NULLIF(BTRIM(po.c_etapa), ''), ''))
        LEFT JOIN omie.fornecedores f
          ON f.codigo_cliente_omie = po.n_cod_for
        LEFT JOIN LATERAL (
          -- Busca NF-es do fornecedor para exibir link clicável
          SELECT
            STRING_AGG(DISTINCT rb.numero_nfe, ', ') AS lista_numeros_nfe,
            JSONB_AGG(JSONB_BUILD_OBJECT(
              'numero_nfe', rb.numero_nfe,
              'chave_nfe', rb.chave_nfe,
              'valor_nfe', rb.valor_nfe
            )) FILTER (WHERE rb.chave_nfe IS NOT NULL) AS lista_nfes
          FROM recebimentos_base rb
          WHERE rb.id_fornecedor_omie = NULLIF(BTRIM(po.n_cod_for::text), '')
            AND (po.d_inc_data IS NULL
                 OR (rb.d_emissao_nfe IS NOT NULL AND rb.d_emissao_nfe >= po.d_inc_data::date))
        ) rpf ON TRUE
        LEFT JOIN referencia_escolhida re
          ON re.grupo_requisicao = SUBSTRING(BTRIM(COALESCE(po.c_obs_int, '')) FROM '[0-9]{8}-[0-9]{6}-[0-9]{3}')
        WHERE COALESCE(po.inativo, FALSE) = FALSE
          AND (po."Etapa_NF" IS NULL OR BTRIM(po."Etapa_NF") = '')
          -- Filtro: apenas pedidos criados a partir de 2026
          AND po.d_inc_data >= '2026-01-01'
        ORDER BY CAST(REGEXP_REPLACE(po.c_numero, '[^0-9]', '', 'g') AS BIGINT) DESC, pop.id ASC
      `);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/solicitacoes-recebimento] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  router.get('/contas-utilizadas', async (req, res) => {
    try {
      const appKey = process.env.OMIE_APP_KEY;
      const appSecret = process.env.OMIE_APP_SECRET;

      if (!appKey || !appSecret) {
        return res.status(500).json({ ok: false, error: 'Credenciais da Omie não configuradas no servidor.' });
      }

      const contas = [];
      let pagina = 1;
      let totalPaginas = 1;

      do {
        const resposta = await omieCall('https://app.omie.com.br/api/v1/geral/contacorrente/', {
          call: 'ListarContasCorrentes',
          param: [{
            pagina,
            registros_por_pagina: 100,
            apenas_importado_api: 'N'
          }],
          app_key: appKey,
          app_secret: appSecret
        });

        if (Array.isArray(resposta?.ListarContasCorrentes)) {
          contas.push(...resposta.ListarContasCorrentes);
        }

        totalPaginas = Math.max(1, Number(resposta?.total_de_paginas || 1) || 1);
        pagina += 1;
      } while (pagina <= totalPaginas);

      const contasNormalizadas = contas
        .filter((conta) => String(conta?.inativo || 'N').trim() === 'N')
        .map((conta) => ({
          ...conta,
          banco_nome: obterNomeBancoConta(conta?.codigo_banco, conta?.descricao),
          tipo_descricao: obterTipoContaDescricao(conta?.tipo_conta_corrente || conta?.tipo)
        }))
        .sort((a, b) => String(a?.descricao || '').localeCompare(String(b?.descricao || ''), 'pt-BR', { sensitivity: 'base' }));

      // Gravar/atualizar contas no banco (compras.contas_omie)
      try {
        const client = await pool.connect();
        try {
          for (const conta of contasNormalizadas) {
            const nCodCC = Number(conta?.nCodCC || 0);
            if (!nCodCC) continue;
            await client.query(`
              INSERT INTO compras.contas_omie
                (n_cod_cc, descricao, banco_nome, codigo_banco, codigo_agencia, numero_conta_corrente, tipo, tipo_descricao, saldo_inicial, valor_limite, observacao, inativo, atualizado_em)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
              ON CONFLICT (n_cod_cc) DO UPDATE SET
                descricao = EXCLUDED.descricao,
                banco_nome = EXCLUDED.banco_nome,
                codigo_banco = EXCLUDED.codigo_banco,
                codigo_agencia = EXCLUDED.codigo_agencia,
                numero_conta_corrente = EXCLUDED.numero_conta_corrente,
                tipo = EXCLUDED.tipo,
                tipo_descricao = EXCLUDED.tipo_descricao,
                saldo_inicial = EXCLUDED.saldo_inicial,
                valor_limite = EXCLUDED.valor_limite,
                observacao = EXCLUDED.observacao,
                inativo = EXCLUDED.inativo,
                atualizado_em = NOW()
            `, [
              nCodCC,
              conta.descricao || null,
              conta.banco_nome || null,
              conta.codigo_banco || null,
              conta.codigo_agencia || null,
              conta.numero_conta_corrente || null,
              conta.tipo_conta_corrente || conta.tipo || null,
              conta.tipo_descricao || null,
              Number(conta.saldo_inicial || 0),
              Number(conta.valor_limite || 0),
              conta.observacao || null,
              conta.inativo || 'N'
            ]);
          }
        } finally {
          client.release();
        }
      } catch (errDb) {
        console.warn('[GET /api/compras/contas-utilizadas] Erro ao gravar contas no banco:', errDb?.message);
      }

      // Mesclar fechamento_conta do banco nas contas retornadas
      try {
        const clientFech = await pool.connect();
        try {
          const { rows: fechRows } = await clientFech.query('SELECT n_cod_cc, fechamento_conta, melhor_data FROM compras.contas_omie WHERE fechamento_conta IS NOT NULL OR melhor_data IS NOT NULL');
          const fechMap = new Map(fechRows.map(r => [String(r.n_cod_cc), r]));
          for (const conta of contasNormalizadas) {
            const row = fechMap.get(String(conta?.nCodCC || ''));
            if (row) {
              if (row.fechamento_conta != null) conta.fechamento_conta = row.fechamento_conta;
              if (row.melhor_data != null) conta.melhor_data = row.melhor_data;
            }
          }
        } finally {
          clientFech.release();
        }
      } catch (errFech) {
        console.warn('[GET /api/compras/contas-utilizadas] Erro ao ler fechamento_conta:', errFech?.message);
      }

      return res.json({
        ok: true,
        total: contasNormalizadas.length,
        contas: contasNormalizadas
      });
    } catch (e) {
      console.error('[GET /api/compras/contas-utilizadas] erro:', e);
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post('/contas-utilizadas/fechamento', async (req, res) => {
    try {
      const nCodCC = Number(req.body?.nCodCC || 0);
      const fechamento = req.body?.fechamento_conta;

      if (!Number.isFinite(nCodCC) || nCodCC <= 0) {
        return res.status(400).json({ ok: false, error: 'nCodCC inválido.' });
      }

      const dia = fechamento === '' || fechamento == null ? null : Number(fechamento);
      if (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) {
        return res.status(400).json({ ok: false, error: 'Dia de fechamento deve ser entre 1 e 31.' });
      }

      await pool.query(
        'UPDATE compras.contas_omie SET fechamento_conta = $1, atualizado_em = NOW() WHERE n_cod_cc = $2',
        [dia, nCodCC]
      );

      return res.json({ ok: true, message: 'Fechamento atualizado.' });
    } catch (e) {
      console.error('[POST /api/compras/contas-utilizadas/fechamento] erro:', e);
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post('/contas-utilizadas/melhor-data', async (req, res) => {
    try {
      const nCodCC = Number(req.body?.nCodCC || 0);
      const melhorData = req.body?.melhor_data;

      if (!Number.isFinite(nCodCC) || nCodCC <= 0) {
        return res.status(400).json({ ok: false, error: 'nCodCC inválido.' });
      }

      const dia = melhorData === '' || melhorData == null ? null : Number(melhorData);
      if (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) {
        return res.status(400).json({ ok: false, error: 'Dia deve ser entre 1 e 31.' });
      }

      await pool.query(
        'UPDATE compras.contas_omie SET melhor_data = $1, atualizado_em = NOW() WHERE n_cod_cc = $2',
        [dia, nCodCC]
      );

      return res.json({ ok: true, message: 'Melhor data atualizada.' });
    } catch (e) {
      console.error('[POST /api/compras/contas-utilizadas/melhor-data] erro:', e);
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  router.post('/contas-utilizadas/observacao', async (req, res) => {
    try {
      const appKey = process.env.OMIE_APP_KEY;
      const appSecret = process.env.OMIE_APP_SECRET;
      const nCodCC = Number(req.body?.nCodCC || 0);
      const observacao = String(req.body?.observacao ?? '');

      if (!appKey || !appSecret) {
        return res.status(500).json({ ok: false, error: 'Credenciais da Omie não configuradas no servidor.' });
      }

      if (!Number.isFinite(nCodCC) || nCodCC <= 0) {
        return res.status(400).json({ ok: false, error: 'nCodCC inválido para alteração.' });
      }

      const endpoint = 'https://app.omie.com.br/api/v1/geral/contacorrente/';
      const contaAtual = await omieCall(endpoint, {
        call: 'ConsultarContaCorrente',
        param: [{ nCodCC }],
        app_key: appKey,
        app_secret: appSecret
      });

      if (!contaAtual || !Number(contaAtual?.nCodCC || 0)) {
        return res.status(404).json({ ok: false, error: 'Conta corrente não encontrada na Omie.' });
      }

      const payloadAlteracao = sanitizarPayloadAlteracaoContaCorrente({
        ...contaAtual,
        nCodCC
      }, observacao);

      const retorno = await omieCall(endpoint, {
        call: 'AlterarContaCorrente',
        param: [payloadAlteracao],
        app_key: appKey,
        app_secret: appSecret
      });

      return res.json({
        ok: true,
        message: retorno?.cDesStatus || 'Observação atualizada com sucesso.',
        conta: {
          ...payloadAlteracao,
          banco_nome: obterNomeBancoConta(payloadAlteracao?.codigo_banco, payloadAlteracao?.descricao),
          tipo_descricao: obterTipoContaDescricao(payloadAlteracao?.tipo_conta_corrente || payloadAlteracao?.tipo)
        }
      });
    } catch (e) {
      console.error('[POST /api/compras/contas-utilizadas/observacao] erro:', e);
      return res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  // Pedidos já recebidos (Etapa_NF = 50 ou 60, inativo = false)
  router.get('/pedidos-recebidos', async (req, res) => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`
        WITH recebimentos_base AS (
          SELECT
            NULLIF(BTRIM(r.n_id_fornecedor::text), '') AS id_fornecedor_omie,
            NULLIF(BTRIM(r.c_numero_nfe), '')           AS numero_nfe,
            NULLIF(BTRIM(r.c_chave_nfe), '')            AS chave_nfe,
            r.d_emissao_nfe::date                       AS d_emissao_nfe,
            COALESCE(MAX(r.n_valor_nfe), 0)             AS valor_nfe
          FROM logistica.recebimentos_nfe_omie r
          WHERE r.n_id_fornecedor IS NOT NULL
            AND NULLIF(BTRIM(r.c_numero_nfe), '') IS NOT NULL
          GROUP BY 1, 2, 3, 4
        )
        SELECT
          po.n_cod_ped,
          po.c_numero                                    AS cnumero,
          NULLIF(BTRIM(po."Etapa_NF"), '')               AS etapa_nf_codigo,
          COALESCE(
            NULLIF(BTRIM(ern.descricao_customizada), ''),
            NULLIF(BTRIM(ern.descricao), ''),
            NULLIF(BTRIM(po."Etapa_NF"), ''),
            'Recebido'
          )                                              AS etapa_nf,
          COALESCE(
            NULLIF(BTRIM(ern.descricao_customizada), ''),
            NULLIF(BTRIM(ern.descricao), ''),
            NULLIF(BTRIM(po."Etapa_NF"), ''),
            'Recebido'
          )                                              AS etapa_nf_descricao,
          COALESCE(NULLIF(BTRIM(ern.cor), ''), '#10b981') AS etapa_nf_cor,
          COALESCE(NULLIF(BTRIM(ern.icone), ''), 'check-circle') AS etapa_nf_icone,
          pop.id,
          pop.n_cod_item,
          pop.c_produto                                  AS produto_codigo,
          pop.c_descricao                                AS produto_descricao,
          pop.n_qtde                                     AS quantidade,
          pop.c_unidade                                  AS unidade,
          COALESCE(pop.n_val_tot, 0)                     AS valor_item,
          SUM(COALESCE(pop.n_val_tot, 0)) OVER (PARTITION BY po.n_cod_ped) AS valor_total_pedido,
          NULL::text                                     AS solicitante,
          po.d_dt_previsao                               AS previsao_chegada,
          NULL::text                                     AS resp_inspecao_recebimento,
          f.nome_fantasia                                AS fornecedor_nome_fantasia,
          f.razao_social                                 AS fornecedor_razao_social,
          f.cnpj_cpf                                     AS fornecedor_cnpj_cpf,
          f.cidade                                       AS fornecedor_cidade,
          f.estado                                       AS fornecedor_estado,
          f.telefone1_ddd                                AS fornecedor_telefone1_ddd,
          f.telefone1_numero                             AS fornecedor_telefone1_numero,
          po."NFe vinculada"                             AS nfe_vinculada,
          rpf.lista_numeros_nfe                          AS fornecedor_lista_numeros_nfe,
          rpf.lista_nfes                                 AS fornecedor_lista_nfes,
          COALESCE(pop.c_obs, po.c_obs)                  AS observacao,
          po.d_inc_data
        FROM compras.pedidos_omie po
        INNER JOIN compras.pedidos_omie_produtos pop
          ON pop.n_cod_ped = po.n_cod_ped
        LEFT JOIN logistica.etapas_recebimento_nfe ern
          ON BTRIM(ern.codigo::text) = BTRIM(po."Etapa_NF")
        LEFT JOIN omie.fornecedores f
          ON f.codigo_cliente_omie = po.n_cod_for
        LEFT JOIN LATERAL (
          -- Busca NF-e vinculada para obter a chave e exibir link clicável
          SELECT
            STRING_AGG(DISTINCT rb.numero_nfe, ', ') AS lista_numeros_nfe,
            JSONB_AGG(JSONB_BUILD_OBJECT(
              'numero_nfe', rb.numero_nfe,
              'chave_nfe', rb.chave_nfe,
              'valor_nfe', rb.valor_nfe
            )) FILTER (WHERE rb.chave_nfe IS NOT NULL) AS lista_nfes
          FROM recebimentos_base rb
          WHERE NULLIF(BTRIM(po."NFe vinculada"), '') IS NOT NULL
            AND rb.numero_nfe = NULLIF(BTRIM(po."NFe vinculada"), '')
        ) rpf ON TRUE
        WHERE COALESCE(po.inativo, FALSE) = FALSE
          AND BTRIM(COALESCE(po."Etapa_NF", '')) IN ('50', '60')
          -- Filtro: apenas pedidos criados a partir de 2026
          AND po.d_inc_data >= '2026-01-01'
        ORDER BY CAST(REGEXP_REPLACE(po.c_numero, '[^0-9]', '', 'g') AS BIGINT) DESC, pop.id ASC
      `);
      res.json(rows);
    } catch (e) {
      console.error('[GET /api/compras/pedidos-recebidos] erro:', e);
      res.status(500).json({ error: e.message || String(e) });
    } finally {
      client.release();
    }
  });

  // Busca a chave NF-e (44 dígitos) pelo número da NF-e no banco local
  router.get('/nfe-buscar-chave', async (req, res) => {
    try {
      const numeroNfe = String(req.query?.numero_nfe || '').trim();
      if (!numeroNfe) {
        return res.status(400).json({ ok: false, error: 'Parâmetro numero_nfe obrigatório.' });
      }
      const numeroNfeDigitos = String(numeroNfe || '').replace(/\D/g, '');
      const numeroNfeNorm = normalizarNumeroNfeComparacao(numeroNfe);
      const resultado = await pool.query(`
        SELECT
          REGEXP_REPLACE(COALESCE(c_chave_nfe, ''), '\\D', '', 'g') AS chave_nfe,
          c_numero_nfe AS numero_nfe
        FROM logistica.recebimentos_nfe_omie
        WHERE (
          BTRIM(c_numero_nfe) = $1
          OR REGEXP_REPLACE(COALESCE(c_numero_nfe, ''), '\\D', '', 'g') = $2
          OR LTRIM(REGEXP_REPLACE(COALESCE(c_numero_nfe, ''), '\\D', '', 'g'), '0') = $3
        )
          AND c_chave_nfe IS NOT NULL
          AND REGEXP_REPLACE(c_chave_nfe, '\\D', '', 'g') ~ '^\\d{44}$'
        ORDER BY n_id_receb DESC
        LIMIT 1
      `, [numeroNfe, numeroNfeDigitos, numeroNfeNorm]);

      if (resultado.rows.length) {
        return res.json({ ok: true, chave_nfe: resultado.rows[0].chave_nfe, numero_nfe: resultado.rows[0].numero_nfe });
      }

      const appKey = process.env.OMIE_APP_KEY;
      const appSecret = process.env.OMIE_APP_SECRET;
      if (!appKey || !appSecret) {
        return res.status(404).json({ ok: false, error: `NF-e "${numeroNfe}" não encontrada no banco de dados.` });
      }

      const candidatosNumero = Array.from(new Set([
        String(numeroNfe || '').trim(),
        String(numeroNfeNorm || '').trim(),
        String(numeroNfeDigitos || '').trim(),
      ].filter(Boolean)));

      let consultaData = null;
      for (const candidato of candidatosNumero) {
        const consulta = await omieCall('https://app.omie.com.br/api/v1/produtos/nfconsultar/', {
          call: 'ConsultarNF',
          param: [{ nNF: candidato }],
          app_key: appKey,
          app_secret: appSecret
        }, { retryRedundant: false });

        const faultConsulta = String(consulta?.faultstring || consulta?.faultcode || '').trim();
        if (!faultConsulta) {
          consultaData = consulta;
          break;
        }
      }

      const nIdNFConsulta = Number(
        consultaData?.compl?.nIdNF
        || consultaData?.compl?.nIdNf
        || consultaData?.nIdNF
        || consultaData?.nIdNfe
        || 0
      );

      if (!Number.isFinite(nIdNFConsulta) || nIdNFConsulta <= 0) {
        return res.status(404).json({ ok: false, error: `NF-e "${numeroNfe}" não encontrada no banco nem na Omie.` });
      }

      const obterNfe = await omieCall('https://app.omie.com.br/api/v1/produtos/dfedocs/', {
        call: 'ObterNfe',
        param: [{ nIdNfe: nIdNFConsulta }],
        app_key: appKey,
        app_secret: appSecret
      }, { retryRedundant: false });

      const faultObter = String(obterNfe?.faultstring || obterNfe?.faultcode || '').trim();
      if (faultObter) {
        throw new Error(faultObter);
      }

      const chaveNfe = String(obterNfe?.nChaveNfe || obterNfe?.cChaveNfe || '').replace(/\D/g, '');
      const numeroEncontrado = String(obterNfe?.cNumNfe || consultaData?.cabec?.nNF || numeroNfe || '').replace(/\D/g, '');
      if (!/^\d{44}$/.test(chaveNfe)) {
        return res.status(404).json({ ok: false, error: `NF-e "${numeroNfe}" localizada, mas sem chave válida para abrir detalhes.` });
      }

      return res.json({
        ok: true,
        chave_nfe: chaveNfe,
        numero_nfe: numeroEncontrado || numeroNfe,
        n_id_nfe: nIdNFConsulta,
        source: 'omie-nfconsultar'
      });
    } catch (e) {
      console.error('[GET /api/compras/nfe-buscar-chave] erro:', e);
      res.status(500).json({ ok: false, error: e.message || String(e) });
    }
  });

  // Consulta detalhes de recebimento da NF-e na Omie via c_chave_nfe
  router.get('/nfe-xml-detalhes', async (req, res) => {
    try {
      const chaveNfe = String(req.query?.chave_nfe || '').replace(/\D/g, '');
      const numeroNfeInformada = String(req.query?.numero_nfe || '').trim();
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

          const isRecebimentoNotFound = /SOAP-ENV:Client-5113|Nao foi possivel encontrar os dados do Recebimento|Não foi possível encontrar os dados do Recebimento/i.test(mensagem);
          if (isRecebimentoNotFound) {
            const fallbackNfe = await montarPayloadNfeViaDfeDocs({
              chaveNfe,
              numeroNfe: numeroNfeInformada
            });

            if (fallbackNfe?.cabec?.cChaveNFe) {
              retorno = fallbackNfe;
              source = 'omie-dfedocs';
            } else {
              throw erroOmie;
            }
          } else {
            throw erroOmie;
          }
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
