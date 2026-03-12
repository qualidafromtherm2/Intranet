#!/usr/bin/env node
/**
 * ============================================================
 * CRON: Sincronização de Recebimentos NF-e — Omie → Postgres
 * ============================================================
 * Script standalone para rodar no Render Cron Job (ou crontab local).
 * Não depende do servidor Express — conecta diretamente ao banco.
 *
 * Variáveis de ambiente necessárias:
 *   DATABASE_URL    - URL de conexão do Postgres
 *   OMIE_APP_KEY    - Chave da API Omie
 *   OMIE_APP_SECRET - Secret da API Omie
 *
 * Uso manual:
 *   node cron/sync_recebimentos_nfe.js
 */

const { Pool } = require('pg');

// ─── Credenciais ──────────────────────────────────────────────────────────────
const DATABASE_URL  = process.env.DATABASE_URL  || 'postgresql://intranet_db_yd0w_user:amLpOKjWzzDRhwcR1NF0eolJzzfCY0ho@dpg-d2d4b0a4d50c7385vm50-a.oregon-postgres.render.com:5432/intranet_db_yd0w?sslmode=require';
const OMIE_APP_KEY  = process.env.OMIE_APP_KEY  || '4244634488206';
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET || '10d9dde2e4e3bac7e62a2cc01bfba01e';
const OMIE_URL      = 'https://app.omie.com.br/api/v1/produtos/recebimentonfe/';

// Delay entre chamadas Omie para não ultrapassar o limite (~400ms ≈ 2,5 req/s)
const DELAY_MS = 400;
const REGISTROS_POR_PAGINA = 100;

// ─── Pool Postgres ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Aguarda N milissegundos */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Converte data do padrão Omie "DD/MM/AAAA" para ISO "YYYY-MM-DD".
 *  Retorna null se inválido. */
function convertOmieDate(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/** Chama a API Omie e retorna o JSON parseado. Lança erro se HTTP != 2xx. */
async function omiePost(call, param) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] }),
  });
  await sleep(DELAY_MS);
  if (!res.ok) {
    const txt = await res.text();
    let msg = txt;
    try { msg = JSON.parse(txt)?.faultstring || txt; } catch (_) {}
    throw new Error(`Omie [${call}] HTTP ${res.status}: ${msg}`);
  }
  return res.json();
}

// ─── Upsert principal ─────────────────────────────────────────────────────────

/**
 * Insere ou atualiza um recebimento completo no banco.
 * Processa: cabeçalho, itens, parcelas e frete.
 */
async function upsertRecebimento(rec) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cabec       = rec.cabec        || {};
    const fornecedor  = rec.fornecedor   || {};
    const infoCad     = rec.infoCadastro || {};
    const itens       = Array.isArray(rec.itensRecebimento) ? rec.itensRecebimento : [];
    const parcelas    = Array.isArray(rec.parcelas)         ? rec.parcelas         : [];
    const frete       = rec.transporte   || rec.frete       || {};

    const nIdReceb = cabec.nIdReceb;
    if (!nIdReceb) throw new Error('nIdReceb ausente');

    // 1. Cabeçalho ──────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO logistica.recebimentos_nfe_omie (
        n_id_receb, c_chave_nfe, c_numero_nfe, c_serie_nfe, c_modelo_nfe,
        d_emissao_nfe, d_entrada, d_registro,
        n_valor_nfe, v_total_produtos, v_desconto, v_frete, v_seguro, v_outras, v_ipi, v_icms_st,
        n_id_fornecedor, c_nome_fornecedor, c_cnpj_cpf_fornecedor,
        c_etapa, c_desc_etapa,
        c_faturado, d_fat, h_fat, c_usuario_fat,
        c_recebido, d_rec, h_rec, c_usuario_rec,
        c_devolvido, c_devolvido_parc, d_dev, h_dev, c_usuario_dev,
        c_autorizado, c_bloqueado, c_cancelada,
        c_natureza_operacao, c_cfop_entrada,
        n_id_conta, c_categ_compra,
        c_obs_nfe, c_dados_adicionais, c_obs_rec,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,
        $20,$21,
        $22,$23,$24,$25,
        $26,$27,$28,$29,
        $30,$31,$32,$33,$34,
        $35,$36,$37,
        $38,$39,
        $40,$41,
        $42,$43,$44,
        NOW()
      )
      ON CONFLICT (n_id_receb) DO UPDATE SET
        c_chave_nfe            = COALESCE(EXCLUDED.c_chave_nfe, logistica.recebimentos_nfe_omie.c_chave_nfe),
        c_numero_nfe           = EXCLUDED.c_numero_nfe,
        c_serie_nfe            = EXCLUDED.c_serie_nfe,
        c_modelo_nfe           = EXCLUDED.c_modelo_nfe,
        d_emissao_nfe          = EXCLUDED.d_emissao_nfe,
        d_entrada              = EXCLUDED.d_entrada,
        d_registro             = EXCLUDED.d_registro,
        n_valor_nfe            = EXCLUDED.n_valor_nfe,
        v_total_produtos       = EXCLUDED.v_total_produtos,
        v_desconto             = EXCLUDED.v_desconto,
        v_frete                = EXCLUDED.v_frete,
        v_seguro               = EXCLUDED.v_seguro,
        v_outras               = EXCLUDED.v_outras,
        v_ipi                  = EXCLUDED.v_ipi,
        v_icms_st              = EXCLUDED.v_icms_st,
        n_id_fornecedor        = COALESCE(EXCLUDED.n_id_fornecedor,       logistica.recebimentos_nfe_omie.n_id_fornecedor),
        c_nome_fornecedor      = COALESCE(EXCLUDED.c_nome_fornecedor,     logistica.recebimentos_nfe_omie.c_nome_fornecedor),
        c_cnpj_cpf_fornecedor  = COALESCE(EXCLUDED.c_cnpj_cpf_fornecedor, logistica.recebimentos_nfe_omie.c_cnpj_cpf_fornecedor),
        c_etapa                = EXCLUDED.c_etapa,
        c_desc_etapa           = EXCLUDED.c_desc_etapa,
        c_faturado             = EXCLUDED.c_faturado,
        d_fat                  = EXCLUDED.d_fat,
        c_recebido             = EXCLUDED.c_recebido,
        d_rec                  = EXCLUDED.d_rec,
        c_devolvido            = EXCLUDED.c_devolvido,
        c_cancelada            = EXCLUDED.c_cancelada,
        c_autorizado           = EXCLUDED.c_autorizado,
        c_bloqueado            = EXCLUDED.c_bloqueado,
        c_natureza_operacao    = EXCLUDED.c_natureza_operacao,
        c_cfop_entrada         = EXCLUDED.c_cfop_entrada,
        n_id_conta             = EXCLUDED.n_id_conta,
        c_categ_compra         = EXCLUDED.c_categ_compra,
        c_obs_nfe              = EXCLUDED.c_obs_nfe,
        c_dados_adicionais     = EXCLUDED.c_dados_adicionais,
        c_obs_rec              = EXCLUDED.c_obs_rec,
        updated_at             = NOW()
    `, [
      nIdReceb,
      cabec.cChaveNFe   || cabec.cChaveNfe   || null,
      cabec.cNumeroNFe  || null,
      cabec.cSerieNFe   || null,
      cabec.cModeloNFe  || null,
      convertOmieDate(cabec.dEmissaoNFe),
      convertOmieDate(cabec.dEntrada),
      convertOmieDate(cabec.dRegistro),
      cabec.nValorNFe   || null,
      cabec.vTotalProdutos || null,
      cabec.vDesconto   || null,
      cabec.vFrete      || null,
      cabec.vSeguro     || null,
      cabec.vOutras     || null,
      null, // v_ipi — vem de impostos, ignorado nesta versão simplificada
      null, // v_icms_st
      fornecedor.nIdFornecedor  || cabec.nIdFornecedor  || null,
      fornecedor.cNomeFornecedor || cabec.cNome          || null,
      fornecedor.cCnpjCpfFornecedor || cabec.cCNPJ_CPF  || null,
      cabec.cEtapa      || null,
      cabec.cDescEtapa  || null,
      infoCad.cFaturado || null,
      convertOmieDate(infoCad.dFat),
      infoCad.hFat      || null,
      infoCad.cUsuarioFat || null,
      infoCad.cRecebido || null,
      convertOmieDate(infoCad.dRec),
      infoCad.hRec      || null,
      infoCad.cUsuarioRec || null,
      infoCad.cDevolvido || null,
      infoCad.cDevolvidoParc || null,
      convertOmieDate(infoCad.dDev),
      infoCad.hDev      || null,
      infoCad.cUsuarioDev || null,
      infoCad.cAutorizado || null,
      infoCad.cBloqueado  || null,
      infoCad.cCancelada  || null,
      cabec.cNaturezaOperacao || null,
      cabec.cCfopEntrada      || null,
      cabec.nIdConta          || null,
      cabec.cCategCompra      || null,
      cabec.cObsNFe           || null,
      cabec.cDadosAdicionais  || null,
      infoCad.cObsRec         || null,
    ]);

    // 2. Itens ──────────────────────────────────────────────────────────────
    await client.query('DELETE FROM logistica.recebimentos_nfe_itens WHERE n_id_receb = $1', [nIdReceb]);
    for (const item of itens) {
      const ic = item.itensCabec    || {};
      const ia = item.itensInfoAdic || {};
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_itens (
          n_id_receb, n_id_item, n_sequencia,
          n_id_produto, c_codigo_produto, c_descricao_produto, c_ncm,
          n_qtde_nfe, c_unidade_nfe, n_qtde_recebida, n_qtde_divergente,
          n_preco_unit, v_total_item, v_desconto, v_frete, v_seguro, v_outras,
          v_icms, v_ipi, v_pis, v_cofins, v_icms_st,
          n_num_ped_compra, n_id_pedido, n_id_it_pedido,
          c_cfop_entrada, c_categoria_item,
          codigo_local_estoque, c_local_estoque,
          c_nao_gerar_financeiro, c_nao_gerar_mov_estoque, c_obs_item
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,
          $23,$24,$25,$26,$27,$28,$29,$30,$31,$32
        )
      `, [
        nIdReceb,
        ic.nIdItem          || null, ic.nSequencia       || null,
        ic.nIdProduto       || null, ic.cCodigoProduto   || null,
        ic.cDescricaoProduto|| null, ic.cNcm             || null,
        ic.nQtdeNFe         || null, ic.cUnidadeNFe      || null,
        ic.nQtdeRecebida    || null, ic.nQtdeDivergente  || null,
        ic.nPrecoUnit       || null, ic.vTotalItem        || null,
        ic.vDesconto        || null, ic.vFrete            || null,
        ic.vSeguro          || null, ic.vOutras           || null,
        ic.vICMS            || null, ic.vIPI              || null,
        ic.vPIS             || null, ic.vCOFINS           || null,
        ic.vICMSST          || null,
        ia.nNumPedCompra    || null, ic.nIdPedido         || null,
        ic.nIdItPedido      || null, ia.cCfopEntrada      || null,
        ia.cCategoriaItem   || null, ia.codigoLocalEstoque|| null,
        ia.cLocalEstoque    || null, ia.cNaoGerarFinanceiro || null,
        ia.cNaoGerarMovEstoque || null, ia.cObsItem       || null,
      ]);
    }

    // 3. Parcelas ───────────────────────────────────────────────────────────
    await client.query('DELETE FROM logistica.recebimentos_nfe_parcelas WHERE n_id_receb = $1', [nIdReceb]);
    for (const p of parcelas) {
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_parcelas (
          n_id_receb, n_id_parcela, n_numero_parcela,
          v_parcela, p_percentual, d_vencimento, n_dias_vencimento,
          c_forma_pagamento, n_id_conta, c_nome_conta,
          c_codigo_categoria, c_nome_categoria
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `, [
        nIdReceb,
        p.nIdParcela || null, p.nNumeroParcela || null,
        p.vParcela   || null, p.pPercentual    || null,
        convertOmieDate(p.dVencimento),
        p.nDiasVencimento   || null, p.cFormaPagamento  || null,
        p.nIdConta          || null, p.cNomeConta        || null,
        p.cCodigoCategoria  || null, p.cNomeCategoria    || null,
      ]);
    }

    // 4. Frete ──────────────────────────────────────────────────────────────
    await client.query('DELETE FROM logistica.recebimentos_nfe_frete WHERE n_id_receb = $1', [nIdReceb]);
    if (frete && Object.keys(frete).length > 0) {
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_frete (
          n_id_receb, c_modalidade_frete,
          n_id_transportadora, c_nome_transportadora, c_cnpj_cpf_transportadora,
          v_frete, v_seguro,
          n_quantidade_volumes, c_especie, c_marca, n_peso_bruto, n_peso_liquido,
          c_placa_veiculo, c_uf_veiculo
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `, [
        nIdReceb,
        frete.cModalidadeFrete        || null,
        frete.nIdTransportadora       || null,
        frete.cNomeTransportadora     || null,
        frete.cCnpjCpfTransportadora  || null,
        frete.vFrete                  || null,
        frete.vSeguro                 || null,
        frete.nQuantidadeVolumes      || null,
        frete.cEspecie                || null,
        frete.cMarca                  || null,
        frete.nPesoBruto              || null,
        frete.nPesoLiquido            || null,
        frete.cPlacaVeiculo           || null,
        frete.cUfVeiculo              || null,
      ]);
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Loop principal de sincronização ─────────────────────────────────────────

async function main() {
  const inicio = Date.now();
  console.log('═'.repeat(65));
  console.log(`[CronSync] Iniciado em ${new Date().toISOString()}`);
  console.log('═'.repeat(65));

  let pagina = 1;
  let totalPaginas = 1;
  let sincronizados = 0;
  let erros = 0;

  try {
    while (pagina <= totalPaginas) {
      console.log(`[CronSync] Buscando página ${pagina}/${totalPaginas}...`);

      // Busca lista resumida da página
      const lista = await omiePost('ListarRecebimentos', {
        nPagina: pagina,
        nRegistrosPorPagina: REGISTROS_POR_PAGINA,
      });

      totalPaginas = lista.nTotalPaginas || 1;
      const recebimentos = lista.recebimentos || [];
      console.log(`[CronSync] Página ${pagina}/${totalPaginas} — ${recebimentos.length} registros (total Omie: ${lista.nTotalRegistros})`);

      if (!recebimentos.length) break;

      // Para cada registro, consulta detalhes completos e faz upsert
      for (let i = 0; i < recebimentos.length; i++) {
        const nIdReceb = recebimentos[i]?.cabec?.nIdReceb;
        if (!nIdReceb) continue;

        try {
          const detalhe = await omiePost('ConsultarRecebimento', { nIdReceb: parseInt(nIdReceb, 10) });
          await upsertRecebimento(detalhe);
          sincronizados++;

          if (sincronizados % 50 === 0) {
            console.log(`[CronSync] ✓ ${sincronizados} sincronizados até agora...`);
          }
        } catch (err) {
          erros++;
          console.error(`[CronSync] ✗ Erro no registro ${nIdReceb}:`, err.message);
        }
      }

      console.log(`[CronSync] Página ${pagina}/${totalPaginas} concluída — sincronizados=${sincronizados} erros=${erros}`);
      pagina++;
    }

    const duracao = Math.round((Date.now() - inicio) / 1000);
    console.log('═'.repeat(65));
    console.log(`[CronSync] ✓ Concluído: ${sincronizados} sincronizados, ${erros} erros — ${duracao}s`);
    console.log('═'.repeat(65));

  } catch (err) {
    console.error('[CronSync] ✗ Erro fatal:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
