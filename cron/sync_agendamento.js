#!/usr/bin/env node
/**
 * ============================================================
 * CRON RENDER — Sincronização Automática via Agendamento
 * ============================================================
 * Lê a configuração da tabela configuracoes.agendamento_sincronizacao
 * (configurada pela UI na página "Agendamento Automático") e
 * executa as sincronizações das tabelas marcadas.
 *
 * O Render roda este script a cada 5 minutos.
 * O script decide sozinho se é hora de executar com base em
 * "proxima_execucao" gravada no banco — evitando execuções duplas.
 *
 * Variáveis de ambiente necessárias:
 *   DATABASE_URL    - URL de conexão do Postgres
 *   OMIE_APP_KEY    - Chave da API Omie
 *   OMIE_APP_SECRET - Secret da API Omie
 */

const { Pool } = require('pg');
const {
  fecharSolicitacoesDePedidosFechados,
  sincronizarSolicitacaoPorPedido,
  refrescarPedidoFechadoDaOmie,
  substituirItensPedido,
  atualizarFlagsRecebimentoPedido,
  aplicarPendenciaOmieLote
} = require('../utils/syncPedidosCompraOmie');

// ─── Credenciais ──────────────────────────────────────────────────────────────
const DATABASE_URL    = process.env.DATABASE_URL;
const OMIE_APP_KEY    = process.env.OMIE_APP_KEY;
const OMIE_APP_SECRET = process.env.OMIE_APP_SECRET;

if (!DATABASE_URL || !OMIE_APP_KEY || !OMIE_APP_SECRET) {
  console.error('[CronSync] ERRO: variáveis de ambiente DATABASE_URL, OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórias.');
  process.exit(1);
}

// Delay entre chamadas Omie — máx. 4 req/s (250 ms)
const { OMIE_MIN_INTERVAL_MS } = require('../utils/omieRateLimit');
const DELAY_MS = OMIE_MIN_INTERVAL_MS;
// Janela de tolerância: executa se proxima_execucao for até 10 min atrás
const TOLERANCIA_MS = 10 * 60 * 1000;
// Janela de dias para syncs incrementais (busca apenas registros dos últimos N dias)
const JANELA_DIAS = 3;

/** Retorna data N dias atrás no formato DD/MM/YYYY (usado nos filtros da Omie) */
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// ─── Pool Postgres ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function convertOmieDate(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

async function omiePost(apiPath, call, param) {
  const url = `https://app.omie.com.br/api/v1/${apiPath}/`;
  const res = await fetch(url, {
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

// ─── Calcular próxima execução (mesma lógica do routes/agendamento.js) ────────
function calcularProximaExecucao(diasSemana, horario, ativo) {
  if (!ativo || !diasSemana || diasSemana.length === 0) return null;
  const agora = new Date();
  const [hora, minuto] = String(horario).split(':').map(Number);
  let proxima = new Date(agora);
  proxima.setHours(hora, minuto, 0, 0);
  if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);
  for (let i = 0; i < 7; i++) {
    if (diasSemana.includes(proxima.getDay())) return proxima;
    proxima.setDate(proxima.getDate() + 1);
  }
  return null;
}

// ─── Ler e travar agendamento no banco ────────────────────────────────────────
async function lerETravarAgendamento() {
  const client = await pool.connect();
  try {
    // Busca o agendamento
    const res = await client.query(`
      SELECT id, ativo, dias_semana, horario::text AS horario,
             tabelas, data_inicial, recebimentos_ignorar_etapa_80,
             proxima_execucao, ultima_execucao
      FROM configuracoes.agendamento_sincronizacao
      ORDER BY id DESC LIMIT 1
    `);

    if (res.rows.length === 0) {
      log('Nenhuma configuração de agendamento encontrada. Encerrando.');
      return null;
    }

    const cfg = res.rows[0];

    if (!cfg.ativo) {
      log('Agendamento está DESATIVADO na página. Encerrando sem executar.');
      return null;
    }

    const agora = new Date();
    const proximaExec = cfg.proxima_execucao ? new Date(cfg.proxima_execucao) : null;

    // Verifica se está dentro da janela de execução
    if (!proximaExec) {
      log('proxima_execucao não definida. Encerrando.');
      return null;
    }

    const diffMs = agora - proximaExec;
    if (diffMs < 0) {
      log(`Ainda não chegou a hora. Próxima execução: ${proximaExec.toISOString()} (faltam ${Math.round(-diffMs / 60000)} min)`);
      return null;
    }

    if (diffMs > TOLERANCIA_MS) {
      log(`Janela de execução expirou (${Math.round(diffMs / 60000)} min atrás). Recalculando próxima execução...`);
      const novaProxima = calcularProximaExecucao(cfg.dias_semana, cfg.horario, cfg.ativo);
      await client.query(`
        UPDATE configuracoes.agendamento_sincronizacao
        SET proxima_execucao = $1 WHERE id = $2
      `, [novaProxima, cfg.id]);
      log(`Nova proxima_execucao: ${novaProxima?.toISOString() || 'null'}`);
      return null;
    }

    // Trava a execução atualizando proxima_execucao imediatamente
    // (evita execução dupla se dois workers rodarem juntos)
    const novaProxima = calcularProximaExecucao(cfg.dias_semana, cfg.horario, cfg.ativo);
    const updateRes = await client.query(`
      UPDATE configuracoes.agendamento_sincronizacao
      SET proxima_execucao = $1,
          ultima_execucao  = NOW()
      WHERE id = $2
        AND (proxima_execucao = $3 OR proxima_execucao IS NOT DISTINCT FROM $3)
      RETURNING id
    `, [novaProxima, cfg.id, cfg.proxima_execucao]);

    if (updateRes.rowCount === 0) {
      log('Outra instância já executou este agendamento. Encerrando.');
      return null;
    }

    log(`✓ Agendamento TRAVADO. Próxima execução: ${novaProxima?.toISOString() || 'null'}`);
    return cfg;

  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SYNC: Recebimentos NF-e
// ════════════════════════════════════════════════════════════════════════════
async function syncRecebimentosNFe(cfg) {
  log('── [recebimentos_nfe] Iniciando...');
  let pagina = 1, totalPaginas = 1, sincronizados = 0, erros = 0;

  // Busca apenas registros alterados nos últimos JANELA_DIAS dias
  const dataFiltro = diasAtras(JANELA_DIAS);
  const param = { nPagina: pagina, nRegistrosPorPagina: 100, dtAltDe: dataFiltro };
  log(`  Filtrando alterações a partir de ${dataFiltro} (últimos ${JANELA_DIAS} dias)`);

  while (pagina <= totalPaginas) {
    param.nPagina = pagina;
    const lista = await omiePost('produtos/recebimentonfe', 'ListarRecebimentos', param);
    totalPaginas = lista.nTotalPaginas || 1;
    const recs = lista.recebimentos || [];
    log(`  Página ${pagina}/${totalPaginas} — ${recs.length} registros`);
    if (!recs.length) break;

    for (const r of recs) {
      const nIdReceb = r?.cabec?.nIdReceb;
      if (!nIdReceb) continue;

      // Ignorar etapa 80 se configurado
      if (cfg.recebimentos_ignorar_etapa_80 && r?.cabec?.cEtapa === '80') continue;

      try {
        const det = await omiePost('produtos/recebimentonfe', 'ConsultarRecebimento', { nIdReceb: parseInt(nIdReceb, 10) });
        await upsertRecebimentoNFe(det);
        sincronizados++;
        if (sincronizados % 50 === 0) log(`  ✓ ${sincronizados} recebimentos sincronizados...`);
      } catch (e) {
        erros++;
        log(`  ✗ Erro recebimento ${nIdReceb}: ${e.message}`);
      }
    }
    pagina++;
  }
  log(`── [recebimentos_nfe] Concluído: ${sincronizados} sincronizados, ${erros} erros`);

  // Reconcilia coluna Faturada (leve): lista Omie etapa 40 com detalhes + trata órfãos locais
  const recon = await reconciliarFaturadasAbertas();
  // Reconcilia coluna Compra realizada: inativa pedidos excluídos na Omie e corrige etapa
  const reconPed = await reconciliarPedidosCompraAbertos();
  return { sincronizados, erros, ...recon, ...reconPed };
}

/**
 * Mantém a coluna "Compra realizada" (compras.pedidos_omie) alinhada à Omie.
 * PesquisarPedCompra paginado (todos os status, >= 01/01/2026) → pedido local aberto
 * que não aparece foi excluído na Omie → inativo=true; etapa diferente → atualiza.
 */
async function reconciliarPedidosCompraAbertos() {
  log('── [pedidos_omie] Reconciliando pedidos abertos...');
  let inativados = 0;
  let etapaAjustada = 0;
  let faturadosMarcados = 0;

  const pesquisar = async (filtrosStatus) => {
    const mapa = new Map();
    let pagina = 1;
    let totalPaginas = 1;
    while (pagina <= totalPaginas) {
      let data;
      try {
        data = await omiePost('produtos/pedidocompra', 'PesquisarPedCompra', {
          nPagina: pagina,
          nRegsPorPagina: 50,
          dDataInicial: '01/01/2026',
          ...filtrosStatus
        });
      } catch (e) {
        // "Não existem registros" não é erro — lista vazia para esse status
        if (/n[aã]o existem registros/i.test(String(e.message || ''))) break;
        throw e;
      }
      if (data?.faultstring) {
        if (/n[aã]o existem registros/i.test(data.faultstring)) break;
        throw new Error(data.faultstring);
      }
      totalPaginas = data.nTotalPaginas || 1;
      for (const item of (data.pedidos_pesquisa || [])) {
        const cab = item?.cabecalho_consulta || {};
        if (cab.nCodPed) mapa.set(String(cab.nCodPed), String(cab.cEtapa || '').trim());
      }
      pagina++;
    }
    return mapa;
  };

  // Todos os status → detectar excluídos | só pendentes → detectar faturados
  const etapasOmie = await pesquisar({
    lExibirPedidosPendentes: true,
    lExibirPedidosFaturados: true,
    lExibirPedidosRecebidos: true,
    lExibirPedidosCancelados: true,
    lExibirPedidosEncerrados: true,
    lExibirPedidosRecParciais: true,
    lExibirPedidosFatParciais: true
  });
  // "Abertos" = mesma regra da tela da Omie: pendentes + faturados sem recebimento +
  // parcialmente faturados/recebidos. Só sai quando recebido total/cancelado/encerrado.
  const pendentesOmie = await pesquisar({
    lExibirPedidosPendentes: true,
    lExibirPedidosFaturados: true,
    lExibirPedidosFatParciais: true,
    lExibirPedidosRecParciais: true
  });
  log(`  [pedidos_omie] ${etapasOmie.size} pedidos mapeados na Omie (${pendentesOmie.size} abertos)`);

  await pool.query(`
    ALTER TABLE compras.pedidos_omie
    ADD COLUMN IF NOT EXISTS pendente_omie BOOLEAN
  `);

  const { rows: abertos } = await pool.query(`
    SELECT DISTINCT po.n_cod_ped, po.c_numero, po.c_etapa, po.pendente_omie
    FROM compras.pedidos_omie po
    WHERE COALESCE(po.inativo, FALSE) = FALSE
      AND po.d_inc_data >= '2026-01-01'
  `);

  for (const ped of abertos) {
    const idPed = String(ped.n_cod_ped);
    const etapaOmie = etapasOmie.get(idPed);
    if (etapaOmie === undefined) {
      await pool.query(
        `UPDATE compras.pedidos_omie
            SET inativo = TRUE, pendente_omie = FALSE, updated_at = NOW()
          WHERE n_cod_ped = $1`,
        [ped.n_cod_ped]
      );
      inativados++;
      log(`  ✓ [pedidos_omie] Pedido ${ped.c_numero} inativado (excluído na Omie)`);
      await sincronizarSolicitacaoPorPedido(pool, ped.n_cod_ped, {
        statusFinalForcado: 'excluido',
        log
      });
      continue;
    }

    if (etapaOmie && etapaOmie !== String(ped.c_etapa || '').trim()) {
      await pool.query(
        `UPDATE compras.pedidos_omie SET c_etapa = $2, updated_at = NOW() WHERE n_cod_ped = $1`,
        [ped.n_cod_ped, etapaOmie]
      );
      etapaAjustada++;
      log(`  ✓ [pedidos_omie] Pedido ${ped.c_numero}: etapa ${ped.c_etapa} → ${etapaOmie}`);
    }
  }

  // Fecha/reabre em lote (sem ConsultarPedCompra 1 a 1 — evita timeout do cron).
  const lotePendencia = await aplicarPendenciaOmieLote(pool, pendentesOmie.keys(), log);
  faturadosMarcados = lotePendencia.fechados.length;

  // Refresh leve só dos primeiros fechados (itens/solicitações), sem bloquear o job.
  const MAX_REFRESH_FECHADOS = 8;
  for (const ped of lotePendencia.fechados.slice(0, MAX_REFRESH_FECHADOS)) {
    await refrescarPedidoFechadoDaOmie({
      pool,
      nCodPed: ped.n_cod_ped,
      cNumero: ped.c_numero,
      delayMs: DELAY_MS,
      log,
      omieConsultarPedCompra: async (nCod) =>
        omiePost('produtos/pedidocompra', 'ConsultarPedCompra', { nCodPed: Number(nCod) })
    });
  }
  for (const ped of lotePendencia.reabertos) {
    await sincronizarSolicitacaoPorPedido(pool, ped.n_cod_ped, { log });
  }

  // Pedidos abertos na Omie que ainda não existem localmente → importa
  // (cobre webhook atrasado/perdido: sem isso o pedido novo some do kanban).
  let importados = 0;
  const { rows: idsLocais } = await pool.query(`SELECT n_cod_ped FROM compras.pedidos_omie`);
  const setIdsLocais = new Set(idsLocais.map(r => String(r.n_cod_ped)));
  for (const idPed of pendentesOmie.keys()) {
    if (setIdsLocais.has(idPed)) continue;
    try {
      const det = await omiePost('produtos/pedidocompra', 'ConsultarPedCompra', { nCodPed: Number(idPed) });
      const ped = det?.pedido_compra_produto || det || {};
      const cab = ped.cabecalho_consulta || ped.cabecalho || {};
      const produtos = ped.produtos_consulta || ped.produtos || [];
      if (!cab.nCodPed) throw new Error('resposta sem cabeçalho');

      const dataInc = String(cab.dIncData || '').split('/').reverse().join('-') || null;
      const dataPrev = String(cab.dDtPrevisao || '').split('/').reverse().join('-') || null;
      await pool.query(`
        INSERT INTO compras.pedidos_omie (
          n_cod_ped, c_cod_int_ped, c_numero, d_inc_data, c_inc_hora, d_dt_previsao,
          c_etapa, n_cod_for, c_cod_parc, n_qtde_parc, c_obs, c_obs_int,
          pendente_omie, inativo, evento_webhook, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,FALSE,'cron-import',NOW())
        ON CONFLICT (n_cod_ped) DO UPDATE SET
          c_etapa = EXCLUDED.c_etapa, pendente_omie = TRUE, updated_at = NOW()
      `, [
        cab.nCodPed, cab.cCodIntPed || null, cab.cNumero || null,
        dataInc, cab.cIncHora || null, dataPrev,
        String(cab.cEtapa || '').trim() || null, cab.nCodFor || null,
        cab.cCodParc || null, cab.nQtdeParc || null,
        cab.cObs || null, cab.cObsInt || null
      ]);

      await substituirItensPedido(pool, cab.nCodPed, produtos.map(p => ({
        ...p,
        nQtdeRec: p.nQtdeRec || p.n_qtde_rec || null
      })));
      await atualizarFlagsRecebimentoPedido(pool, cab.nCodPed);
      await sincronizarSolicitacaoPorPedido(pool, cab.nCodPed, { log });
      importados++;
      log(`  ✓ [pedidos_omie] Pedido ${cab.cNumero || idPed} importado da Omie (não existia localmente)`);
    } catch (e) {
      log(`  ✗ [pedidos_omie] Falha ao importar pedido ${idPed}: ${e.message}`);
    }
  }

  const solFechadas = await fecharSolicitacoesDePedidosFechados(pool, log);

  log(`── [pedidos_omie] Concluído: inativados=${inativados} etapaAjustada=${etapaAjustada} faturados=${faturadosMarcados} importados=${importados} solFechadas=${(solFechadas.fechadas_pedido || 0) + (solFechadas.fechadas_item_sumiu || 0)}`);
  return {
    pedidos_inativados: inativados,
    pedidos_etapa_ajustada: etapaAjustada,
    pedidos_faturados: faturadosMarcados,
    pedidos_importados: importados,
    solicitacoes_fechadas: solFechadas
  };
}

/**
 * Mantém a coluna "Faturada pelo fornecedor" alinhada à Omie sem varrer o histórico inteiro.
 * - ListarRecebimentos cEtapa=40 + cExibirDetalhes=S (~4 páginas)
 * - Upsert status real (cancelada/recebida/etc.)
 * - Locais abertos fora da lista: Consultar; se sumiu na Omie, DELETE
 */
async function reconciliarFaturadasAbertas() {
  log('── [recebimentos_nfe] Reconciliando Faturadas abertas...');
  const idsOmie = new Set();
  let upsertados = 0;
  let removidos = 0;
  let orfaos = 0;
  let errosRec = 0;
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas) {
    const lista = await omiePost('produtos/recebimentonfe', 'ListarRecebimentos', {
      nPagina: pagina,
      nRegistrosPorPagina: 100,
      cEtapa: '40',
      cExibirDetalhes: 'S'
    });
    if (lista?.faultstring) throw new Error(lista.faultstring);
    totalPaginas = lista.nTotalPaginas || 1;
    const recs = lista.recebimentos || [];
    log(`  [faturadas] Página ${pagina}/${totalPaginas} — ${recs.length} registros`);

    for (const rec of recs) {
      const nIdReceb = rec?.cabec?.nIdReceb;
      if (!nIdReceb) continue;
      idsOmie.add(String(nIdReceb));
      try {
        await upsertRecebimentoNFe(rec);
        upsertados++;
      } catch (e) {
        errosRec++;
        log(`  ✗ [faturadas] upsert ${nIdReceb}: ${e.message}`);
      }
    }
    pagina++;
  }

  const { rows: locais } = await pool.query(`
    SELECT r.n_id_receb
    FROM logistica.recebimentos_nfe_omie r
    WHERE UPPER(BTRIM(COALESCE(r.c_cancelada, 'N'))) NOT IN ('S', 'SIM')
      AND UPPER(BTRIM(COALESCE(r.c_bloqueado, 'N'))) NOT IN ('S', 'SIM')
      AND UPPER(BTRIM(COALESCE(r.c_recebido, 'N'))) NOT IN ('S', 'SIM')
      AND BTRIM(COALESCE(r.c_modelo_nfe, '55')) <> '57'
  `);

  for (const row of locais) {
    const idStr = String(row.n_id_receb);
    if (idsOmie.has(idStr)) continue;
    try {
      const det = await omiePost('produtos/recebimentonfe', 'ConsultarRecebimento', {
        nIdReceb: parseInt(idStr, 10)
      });
      if (det?.faultstring) throw new Error(det.faultstring);
      await upsertRecebimentoNFe(det);
      orfaos++;
    } catch (e) {
      const msg = String(e.message || e || '');
      if (/n[aã]o foi poss[ií]vel encontrar|n[aã]o existe|not found/i.test(msg)) {
        await pool.query('DELETE FROM logistica.recebimentos_nfe_omie WHERE n_id_receb = $1', [row.n_id_receb]);
        removidos++;
        log(`  ✓ [faturadas] removido órfão ${idStr}`);
      } else {
        errosRec++;
        log(`  ✗ [faturadas] órfão ${idStr}: ${msg}`);
      }
    }
  }

  log(`── [recebimentos_nfe] Faturadas: upsert=${upsertados} orfaos=${orfaos} removidos=${removidos} erros=${errosRec}`);
  return {
    faturadas_upsertados: upsertados,
    faturadas_orfaos: orfaos,
    faturadas_removidos: removidos,
    faturadas_erros: errosRec
  };
}

async function upsertRecebimentoNFe(rec) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cabec = rec.cabec || {}, forn = rec.fornecedor || {}, info = rec.infoCadastro || {};
    const itens = Array.isArray(rec.itensRecebimento) ? rec.itensRecebimento : [];
    const parcelas = Array.isArray(rec.parcelas) ? rec.parcelas : [];
    const frete = rec.transporte || rec.frete || {};
    const nIdReceb = cabec.nIdReceb;
    if (!nIdReceb) throw new Error('nIdReceb ausente');

    await client.query(`
      INSERT INTO logistica.recebimentos_nfe_omie (
        n_id_receb,c_chave_nfe,c_numero_nfe,c_serie_nfe,c_modelo_nfe,
        d_emissao_nfe,d_entrada,d_registro,n_valor_nfe,v_total_produtos,
        v_desconto,v_frete,v_seguro,v_outras,
        n_id_fornecedor,c_nome_fornecedor,c_cnpj_cpf_fornecedor,
        c_etapa,c_desc_etapa,c_faturado,d_fat,c_recebido,d_rec,
        c_devolvido,c_cancelada,c_autorizado,c_bloqueado,
        c_natureza_operacao,c_cfop_entrada,n_id_conta,c_categ_compra,
        c_obs_nfe,c_dados_adicionais,c_obs_rec,updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
        $28,$29,$30,$31,$32,$33,$34,NOW()
      )
      ON CONFLICT (n_id_receb) DO UPDATE SET
        c_chave_nfe=COALESCE(EXCLUDED.c_chave_nfe,logistica.recebimentos_nfe_omie.c_chave_nfe),
        c_numero_nfe=EXCLUDED.c_numero_nfe,c_serie_nfe=EXCLUDED.c_serie_nfe,
        c_modelo_nfe=EXCLUDED.c_modelo_nfe,d_emissao_nfe=EXCLUDED.d_emissao_nfe,
        d_entrada=EXCLUDED.d_entrada,d_registro=EXCLUDED.d_registro,
        n_valor_nfe=EXCLUDED.n_valor_nfe,v_total_produtos=EXCLUDED.v_total_produtos,
        v_desconto=EXCLUDED.v_desconto,v_frete=EXCLUDED.v_frete,
        v_seguro=EXCLUDED.v_seguro,v_outras=EXCLUDED.v_outras,
        n_id_fornecedor=COALESCE(EXCLUDED.n_id_fornecedor,logistica.recebimentos_nfe_omie.n_id_fornecedor),
        c_nome_fornecedor=COALESCE(EXCLUDED.c_nome_fornecedor,logistica.recebimentos_nfe_omie.c_nome_fornecedor),
        c_cnpj_cpf_fornecedor=COALESCE(EXCLUDED.c_cnpj_cpf_fornecedor,logistica.recebimentos_nfe_omie.c_cnpj_cpf_fornecedor),
        c_etapa=EXCLUDED.c_etapa,c_desc_etapa=EXCLUDED.c_desc_etapa,
        c_faturado=EXCLUDED.c_faturado,d_fat=EXCLUDED.d_fat,
        c_recebido=EXCLUDED.c_recebido,d_rec=EXCLUDED.d_rec,
        c_devolvido=EXCLUDED.c_devolvido,c_cancelada=EXCLUDED.c_cancelada,
        c_autorizado=EXCLUDED.c_autorizado,c_bloqueado=EXCLUDED.c_bloqueado,
        c_natureza_operacao=EXCLUDED.c_natureza_operacao,
        c_cfop_entrada=EXCLUDED.c_cfop_entrada,n_id_conta=EXCLUDED.n_id_conta,
        c_categ_compra=EXCLUDED.c_categ_compra,c_obs_nfe=EXCLUDED.c_obs_nfe,
        c_dados_adicionais=EXCLUDED.c_dados_adicionais,c_obs_rec=EXCLUDED.c_obs_rec,
        updated_at=NOW()
    `, [
      nIdReceb, cabec.cChaveNFe||cabec.cChaveNfe||null,
      cabec.cNumeroNFe||null,cabec.cSerieNFe||null,cabec.cModeloNFe||null,
      convertOmieDate(cabec.dEmissaoNFe),convertOmieDate(cabec.dEntrada),convertOmieDate(cabec.dRegistro),
      cabec.nValorNFe||null,cabec.vTotalProdutos||null,
      cabec.vDesconto||null,cabec.vFrete||null,cabec.vSeguro||null,cabec.vOutras||null,
      forn.nIdFornecedor||cabec.nIdFornecedor||null,
      forn.cNomeFornecedor||cabec.cNome||null,
      forn.cCnpjCpfFornecedor||cabec.cCNPJ_CPF||null,
      cabec.cEtapa||null,cabec.cDescEtapa||null,
      info.cFaturado||null,convertOmieDate(info.dFat),
      info.cRecebido||null,convertOmieDate(info.dRec),
      info.cDevolvido||null,info.cCancelada||null,
      info.cAutorizado||null,info.cBloqueado||null,
      cabec.cNaturezaOperacao||null,cabec.cCfopEntrada||null,
      cabec.nIdConta||null,cabec.cCategCompra||null,
      cabec.cObsNFe||null,cabec.cDadosAdicionais||null,info.cObsRec||null,
    ]);

    // Itens
    await client.query('DELETE FROM logistica.recebimentos_nfe_itens WHERE n_id_receb=$1',[nIdReceb]);
    for (const item of itens) {
      const ic = item.itensCabec||{}, ia = item.itensInfoAdic||{};
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_itens (
          n_id_receb,n_id_item,n_sequencia,n_id_produto,c_codigo_produto,
          c_descricao_produto,c_ncm,n_qtde_nfe,c_unidade_nfe,n_qtde_recebida,
          n_preco_unit,v_total_item,v_desconto,n_num_ped_compra,
          c_cfop_entrada,c_categoria_item,codigo_local_estoque,c_local_estoque
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `,[
        nIdReceb,ic.nIdItem||null,ic.nSequencia||null,ic.nIdProduto||null,
        ic.cCodigoProduto||null,ic.cDescricaoProduto||null,ic.cNcm||null,
        ic.nQtdeNFe||null,ic.cUnidadeNFe||null,ic.nQtdeRecebida||null,
        ic.nPrecoUnit||null,ic.vTotalItem||null,ic.vDesconto||null,
        ia.nNumPedCompra||null,ia.cCfopEntrada||null,ia.cCategoriaItem||null,
        ia.codigoLocalEstoque||null,ia.cLocalEstoque||null,
      ]);
    }

    // Parcelas
    await client.query('DELETE FROM logistica.recebimentos_nfe_parcelas WHERE n_id_receb=$1',[nIdReceb]);
    for (const p of parcelas) {
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_parcelas
          (n_id_receb,n_id_parcela,n_numero_parcela,v_parcela,p_percentual,
           d_vencimento,c_forma_pagamento,n_id_conta,c_nome_conta)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,[nIdReceb,p.nIdParcela||null,p.nNumeroParcela||null,p.vParcela||null,
         p.pPercentual||null,convertOmieDate(p.dVencimento),
         p.cFormaPagamento||null,p.nIdConta||null,p.cNomeConta||null]);
    }

    // Frete
    await client.query('DELETE FROM logistica.recebimentos_nfe_frete WHERE n_id_receb=$1',[nIdReceb]);
    if (frete && Object.keys(frete).length > 0) {
      await client.query(`
        INSERT INTO logistica.recebimentos_nfe_frete
          (n_id_receb,c_modalidade_frete,n_id_transportadora,c_nome_transportadora,
           c_cnpj_cpf_transportadora,v_frete,v_seguro)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,[nIdReceb,frete.cModalidadeFrete||null,frete.nIdTransportadora||null,
         frete.cNomeTransportadora||null,frete.cCnpjCpfTransportadora||null,
         frete.vFrete||null,frete.vSeguro||null]);
    }

    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SYNC: Fornecedores
// ════════════════════════════════════════════════════════════════════════════
async function syncFornecedores() {
  log('── [fornecedores] Iniciando...');
  let pagina = 1, totalPaginas = 1, sincronizados = 0, erros = 0;

  while (pagina <= totalPaginas) {
    const data = await omiePost('geral/clientes', 'ListarClientes', {
      pagina, registros_por_pagina: 50, apenas_importado_api: 'N',
      clientesFiltro: { tags: [{ tag: 'fornecedor' }] }
    });
    totalPaginas = data.nTotalPaginas || 1;
    const lista = data.clientes_cadastro || [];
    log(`  Página ${pagina}/${totalPaginas} — ${lista.length} fornecedores`);
    if (!lista.length) break;

    const client = await pool.connect();
    try {
      for (const f of lista) {
        try {
          await client.query(`
            INSERT INTO omie.fornecedores (
              codigo_cliente_omie, codigo_cliente_integracao,
              razao_social, nome_fantasia, cnpj_cpf,
              telefone1_ddd, telefone1_numero, email,
              endereco, endereco_numero, complemento, bairro,
              cidade, estado, cep, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
            ON CONFLICT (codigo_cliente_omie) DO UPDATE SET
              razao_social=EXCLUDED.razao_social,
              nome_fantasia=EXCLUDED.nome_fantasia,
              cnpj_cpf=EXCLUDED.cnpj_cpf,
              email=EXCLUDED.email,
              cidade=EXCLUDED.cidade,
              estado=EXCLUDED.estado,
              updated_at=NOW()
          `,[
            f.codigo_cliente_omie||null, f.codigo_cliente_integracao||null,
            f.razao_social||null, f.nome_fantasia||null, f.cnpj_cpf||null,
            f.telefone1_ddd||null, f.telefone1_numero||null, f.email||null,
            f.endereco||null, f.endereco_numero||null, f.complemento||null,
            f.bairro||null, f.cidade||null, f.estado||null, f.cep_str||null,
          ]);
          sincronizados++;
        } catch(e) { erros++; }
      }
    } finally { client.release(); }
    pagina++;
  }
  log(`── [fornecedores] Concluído: ${sincronizados} sincronizados, ${erros} erros`);
  return { sincronizados, erros };
}

// ════════════════════════════════════════════════════════════════════════════
// SYNC: Pedidos de Compra
// ════════════════════════════════════════════════════════════════════════════
async function syncPedidosCompra(cfg) {
  log('── [pedidos_compra] Iniciando...');
  let pagina = 1, totalPaginas = 1, sincronizados = 0, erros = 0;

  // Busca apenas registros alterados nos últimos JANELA_DIAS dias
  const dataFiltro = diasAtras(JANELA_DIAS);
  const filtro = { dtAltDe: dataFiltro };
  log(`  Filtrando alterações a partir de ${dataFiltro} (últimos ${JANELA_DIAS} dias)`);

  while (pagina <= totalPaginas) {
    const data = await omiePost('produtos/pedido-compra', 'ListarPedidos', {
      nPagina: pagina, nRegistrosPorPagina: 50, ...filtro
    });
    totalPaginas = data.nTotalPaginas || 1;
    const lista = data.pedidos || [];
    log(`  Página ${pagina}/${totalPaginas} — ${lista.length} pedidos`);
    if (!lista.length) break;

    const client = await pool.connect();
    try {
      for (const p of lista) {
        const cab = p.cabec || p.pedido_venda_produto?.cabec || {};
        const nIdPedido = cab.nIdPedido || cab.codigo_pedido;
        if (!nIdPedido) continue;
        try {
          await client.query(`
            INSERT INTO logistica.pedidos_compra_omie (
              n_id_pedido, c_num_pedido, d_pedido, c_etapa, c_desc_etapa,
              n_id_fornecedor, c_nome_fornecedor, n_valor_total, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
            ON CONFLICT (n_id_pedido) DO UPDATE SET
              c_num_pedido=EXCLUDED.c_num_pedido, d_pedido=EXCLUDED.d_pedido,
              c_etapa=EXCLUDED.c_etapa, c_desc_etapa=EXCLUDED.c_desc_etapa,
              n_id_fornecedor=EXCLUDED.n_id_fornecedor,
              c_nome_fornecedor=EXCLUDED.c_nome_fornecedor,
              n_valor_total=EXCLUDED.n_valor_total, updated_at=NOW()
          `,[
            nIdPedido, cab.cNumPedido||null, convertOmieDate(cab.dPedido),
            cab.cEtapa||null, cab.cDescEtapa||null,
            cab.nIdFornecedor||null, cab.cNomeFornecedor||null,
            cab.nValorTotal||null,
          ]);
          sincronizados++;
        } catch(e) { erros++; }
      }
    } finally { client.release(); }
    pagina++;
  }
  log(`── [pedidos_compra] Concluído: ${sincronizados} sincronizados, ${erros} erros`);
  return { sincronizados, erros };
}

// ════════════════════════════════════════════════════════════════════════════
// SYNC: Requisições de Compra
// ════════════════════════════════════════════════════════════════════════════
async function syncRequisicoesCompra(cfg) {
  log('── [requisicoes_compra] Iniciando...');
  let pagina = 1, totalPaginas = 1, sincronizados = 0, erros = 0;

  while (pagina <= totalPaginas) {
    const data = await omiePost('produtos/requisicaocompra', 'PesquisarReq', {
      pagina, registros_por_pagina: 50
    });
    totalPaginas = data.nTotalPaginas || 1;
    const lista = data.req || [];
    log(`  Página ${pagina}/${totalPaginas} — ${lista.length} requisições`);
    if (!lista.length) break;

    const client = await pool.connect();
    try {
      for (const r of lista) {
        const codReq = r.codReqCompra || r.cod_req_compra;
        if (!codReq) continue;
        try {
          await client.query(`
            INSERT INTO public.requisicoes_compra (
              cod_req_compra, cod_int_req_compra, data_previsao,
              cod_departamento, status_req, observacao, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
            ON CONFLICT (cod_req_compra) DO UPDATE SET
              data_previsao=EXCLUDED.data_previsao,
              cod_departamento=EXCLUDED.cod_departamento,
              status_req=EXCLUDED.status_req,
              observacao=EXCLUDED.observacao,
              updated_at=NOW()
          `,[
            codReq, r.codIntReqCompra||null,
            convertOmieDate(r.dataPrevisao||r.data_previsao),
            r.codDepartamento||null, r.statusReq||r.status_req||null,
            r.observacao||null,
          ]);
          sincronizados++;
        } catch(e) { erros++; }
      }
    } finally { client.release(); }
    pagina++;
  }
  log(`── [requisicoes_compra] Concluído: ${sincronizados} sincronizados, ${erros} erros`);
  return { sincronizados, erros };
}

// ════════════════════════════════════════════════════════════════════════════
// SYNC: Produtos Omie
// Usa omie_upsert_produto (mesma função do webhook) — PK = codigo_produto.
// O INSERT antigo falhava em silêncio (colunas erradas + sem codigo_produto).
// ════════════════════════════════════════════════════════════════════════════
async function garantirGuardProdutosOmie() {
  // Permite escrita via webhook, cron agendado e sync manual/scripts.
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.trg_guard_produtos_omie_webhook_only()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_source text;
    BEGIN
      v_source := lower(trim(coalesce(current_setting('app.produtos_omie_write_source', true), '')));
      IF v_source NOT IN ('omie_webhook', 'omie_cron', 'omie_manual', 'omie_sync') THEN
        RAISE EXCEPTION 'Escrita em produto.produtos_omie permitida apenas via Omie (webhook/cron/sync). source=%', v_source
          USING ERRCODE = '42501';
      END IF;
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
}

async function syncProdutosOmie() {
  log('── [produtos_omie] Iniciando...');
  await garantirGuardProdutosOmie();

  let pagina = 1, totalPaginas = 1, sincronizados = 0, erros = 0, fantasmas = 0;
  const idsVistosNaOmie = new Set();

  while (pagina <= totalPaginas) {
    const data = await omiePost('geral/produtos', 'ListarProdutos', {
      pagina, registros_por_pagina: 50, apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N', exibir_caracteristicas: 'N'
    });
    totalPaginas = Number(data.nTotalPaginas || data.total_de_paginas || 1);
    const lista = data.produto_servico_cadastro || [];
    log(`  Página ${pagina}/${totalPaginas} — ${lista.length} produtos`);
    if (!lista.length) break;

    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.produtos_omie_write_source', 'omie_cron', false)");
      for (const p of lista) {
        if (!p?.codigo_produto && !p?.codigo) continue;
        try {
          const obj = { ...p };
          if (!obj.codigo_produto_integracao) {
            obj.codigo_produto_integracao = obj.codigo || String(obj.codigo_produto || '');
          }
          await client.query('SELECT omie_upsert_produto($1::jsonb)', [obj]);
          if (p.codigo_produto) idsVistosNaOmie.add(String(p.codigo_produto));
          sincronizados++;
        } catch (e) {
          erros++;
          if (erros <= 5) log(`  erro produto ${p.codigo || p.codigo_produto}: ${e.message}`);
        }
      }
    } finally { client.release(); }
    pagina++;
  }

  if (idsVistosNaOmie.size > 0) {
    const { reconciliarProdutosOmieAusentes, limparDuplicatasAtivasLocais } = require('../utils/produtosOmieFantasmas');
    const client = await pool.connect();
    try {
      const rec = await reconciliarProdutosOmieAusentes(client, idsVistosNaOmie, 'omie_cron');
      fantasmas = rec.marcados;
      if (fantasmas > 0) {
        log(`  Fantasmas inativados: ${fantasmas}`);
        rec.detalhes.slice(0, 10).forEach((d) => {
          log(`    - ${d.codigo} (${d.codigo_produto}) ${d.descricao || ''}`);
        });
      }
      const dedup = await limparDuplicatasAtivasLocais(client, 'omie_cron');
      if (dedup.marcados > 0) {
        log(`  Duplicatas de SKU inativadas: ${dedup.marcados} (grupos=${dedup.grupos})`);
      }
    } finally { client.release(); }
  } else {
    // Mesmo sem lista Omie, limpa SKUs com 2+ ativos locais (defesa extra).
    const { limparDuplicatasAtivasLocais } = require('../utils/produtosOmieFantasmas');
    const client = await pool.connect();
    try {
      const dedup = await limparDuplicatasAtivasLocais(client, 'omie_cron');
      if (dedup.marcados > 0) {
        log(`  Duplicatas de SKU inativadas: ${dedup.marcados}`);
      }
    } finally { client.release(); }
  }

  log(`── [produtos_omie] Concluído: ${sincronizados} sincronizados, ${erros} erros, ${fantasmas} fantasmas inativos`);
  return { sincronizados, erros, fantasmas };
}

// ════════════════════════════════════════════════════════════════════════════
// SYNC: Pedidos de Venda (pedidos_venda + pedidos_venda_itens)
// ════════════════════════════════════════════════════════════════════════════
async function syncPedidosVenda(cfg) {
  log('── [pedidos_venda] Iniciando...');
  try {
    const {
      ensurePedidoVendaUpsert,
      reconciliarPedidosFaturadosEtapa,
    } = require('../utils/ensurePedidoVendaUpsert');
    await ensurePedidoVendaUpsert(pool);
    const nRec = await reconciliarPedidosFaturadosEtapa(pool);
    if (nRec > 0) log(`  [pedidos_venda] reconciliados faturados/etapa: ${nRec}`);
  } catch (eEns) {
    log(`  [pedidos_venda] aviso ensure upsert: ${eEns.message}`);
  }
  let pagina = 1, totalPaginas = 1, sincronizados = 0, erros = 0;

  // Usa janela de 7 dias para pedidos_venda (data_previsao pode ser futura;
  // 7 dias garante capturar pedidos recentes + todos os futuros já cadastrados)
  const JANELA_VENDA = 7;
  const dataFiltro = diasAtras(JANELA_VENDA);
  const filtro = { data_previsao_de: dataFiltro };
  log(`  Filtrando pedidos com data_previsao >= ${dataFiltro} (últimos ${JANELA_VENDA} dias)`);

  while (pagina <= totalPaginas) {
    let data;
    try {
      data = await omiePost('produtos/pedido', 'ListarPedidos', {
        pagina,
        registros_por_pagina: 50,
        ...filtro,
      });
    } catch (e) {
      log(`  [pedidos_venda] Erro na página ${pagina}: ${e.message}`);
      erros++;
      break;
    }

    totalPaginas = Number(data.total_de_paginas || 1);
    const lista = Array.isArray(data.pedido_venda_produto) ? data.pedido_venda_produto : [];
    log(`  Página ${pagina}/${totalPaginas} — ${lista.length} pedidos`);

    for (const pedido of lista) {
      try {
        await pool.query(
          'SELECT vendas.pedido_upsert_from_payload($1::jsonb)',
          [pedido]
        );
        sincronizados++;
      } catch (e) {
        log(`  [pedidos_venda] Erro no upsert: ${e.message}`);
        erros++;
      }
    }

    pagina++;
  }

  log(`── [pedidos_venda] Concluído: ${sincronizados} sincronizados, ${erros} erros`);

  // Complemento: NFs com id_pedido sem linha em pedidos_venda (janela ListarPedidos não cobre tudo)
  let faltantes = { sincronizados: 0, erros: 0, pendentes: 0 };
  try {
    faltantes = await reconciliarPedidosFaltantesDasNfs({ limite: 25 });
  } catch (eFat) {
    log(`  [pedidos_venda] aviso reconciliar faltantes: ${eFat.message}`);
    faltantes.erros += 1;
  }

  return {
    sincronizados: sincronizados + (faltantes.sincronizados || 0),
    erros: erros + (faltantes.erros || 0),
    pedidos_faltantes: faltantes,
  };
}

/**
 * Busca na Omie os pedidos apontados por NFs que ainda não existem em vendas.pedidos_venda.
 * Prioriza NFs sem vendedor (títulos vazios — caso típico PIX/à vista).
 * Propaga codVend do pedido para a coluna codigo_vendedor da NF.
 * Para na hora se a Omie bloquear por rate-limit.
 */
async function reconciliarPedidosFaltantesDasNfs({ limite = 25 } = {}) {
  log('── [nf→pedido] Reconciliando pedidos faltantes das NFs...');
  try {
    const {
      BACKFILL_CODIGO_VENDEDOR_SQL,
      PROPAGA_VENDEDOR_PEDIDO_PARA_NF_SQL,
    } = require('../utils/nfCodigoVendedor');
    await pool.query(`ALTER TABLE vendas.notas_fiscais_omie ADD COLUMN IF NOT EXISTS codigo_vendedor TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendas.pedidos_omie_inexistentes (
        codigo_pedido BIGINT PRIMARY KEY,
        motivo TEXT,
        marcado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const bf = await pool.query(BACKFILL_CODIGO_VENDEDOR_SQL);
    if (bf.rowCount > 0) log(`  [nf→pedido] backfill codigo_vendedor (titulos): ${bf.rowCount} NFs`);
    const prop = await pool.query(PROPAGA_VENDEDOR_PEDIDO_PARA_NF_SQL);
    if (prop.rowCount > 0) log(`  [nf→pedido] propagado do pedido: ${prop.rowCount} NFs`);
  } catch (eBf) {
    log(`  [nf→pedido] aviso backfill vendedor: ${eBf.message}`);
  }

  // Prioriza NF sem vendedor (são as que aparecem "(sem vendedor)" no relatório)
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (nf.id_pedido_omie)
           nf.id_pedido_omie::bigint AS codigo_pedido,
           CASE
             WHEN COALESCE(TRIM(nf.codigo_vendedor), '') = '' THEN 0
             ELSE 1
           END AS prioridade
      FROM vendas.notas_fiscais_omie nf
     WHERE nf.ativa IS DISTINCT FROM FALSE
       AND nf.id_pedido_omie IS NOT NULL
       AND nf.id_pedido_omie::text NOT IN ('0', '')
       AND NOT EXISTS (
         SELECT 1 FROM vendas.pedidos_venda p
          WHERE p.codigo_pedido = nf.id_pedido_omie
       )
       AND NOT EXISTS (
         SELECT 1 FROM vendas.pedidos_omie_inexistentes x
          WHERE x.codigo_pedido = nf.id_pedido_omie
       )
     ORDER BY nf.id_pedido_omie, prioridade ASC, nf.data_emissao_dt DESC NULLS LAST
     LIMIT $1
  `, [limite]);

  // Reordena: sem vendedor primeiro
  rows.sort((a, b) => (a.prioridade - b.prioridade) || (Number(b.codigo_pedido) - Number(a.codigo_pedido)));

  if (!rows.length) {
    log('── [nf→pedido] Nenhum pedido faltante');
    return { sincronizados: 0, erros: 0, pendentes: 0, bloqueado: false };
  }

  const { rows: rest } = await pool.query(`
    SELECT COUNT(DISTINCT nf.id_pedido_omie)::int AS n
      FROM vendas.notas_fiscais_omie nf
     WHERE nf.ativa IS DISTINCT FROM FALSE
       AND nf.id_pedido_omie IS NOT NULL
       AND nf.id_pedido_omie::text NOT IN ('0', '')
       AND NOT EXISTS (
         SELECT 1 FROM vendas.pedidos_venda p
          WHERE p.codigo_pedido = nf.id_pedido_omie
       )
  `);
  const pendentes = Math.max(0, (rest[0]?.n || 0) - rows.length);

  let sincronizados = 0;
  let erros = 0;
  let bloqueado = false;
  const { PROPAGA_VENDEDOR_PEDIDO_PARA_NF_SQL } = require('../utils/nfCodigoVendedor');

  for (const row of rows) {
    const codigo = Number(row.codigo_pedido);
    if (!codigo) continue;
    try {
      const data = await omiePost('produtos/pedido', 'ConsultarPedido', {
        codigo_pedido: codigo,
      });
      const ped = Array.isArray(data?.pedido_venda_produto)
        ? data.pedido_venda_produto
        : (data?.pedido_venda_produto ? [data.pedido_venda_produto] : []);
      if (!ped.length) {
        log(`  [nf→pedido] ConsultarPedido ${codigo} sem payload`);
        erros++;
        continue;
      }
      for (const pedido of ped) {
        await pool.query(
          'SELECT vendas.pedido_upsert_from_payload($1::jsonb)',
          [pedido]
        );
      }
      await pool.query(PROPAGA_VENDEDOR_PEDIDO_PARA_NF_SQL);
      sincronizados++;
    } catch (e) {
      const msg = String(e.message || e);
      log(`  [nf→pedido] erro pedido ${codigo}: ${msg}`);
      erros++;
      if (/bloquead|Aguarde\s+\d+|consumo indevido|rate.?limit/i.test(msg)) {
        bloqueado = true;
        log('  [nf→pedido] Omie bloqueou — interrompendo lote (tenta de novo no próximo cron)');
        break;
      }
      // Pedido inexistente na Omie: marca para não gastar cota de novo
      if (/não cadastrado|nao cadastrado/i.test(msg)) {
        try {
          await pool.query(
            `INSERT INTO vendas.pedidos_omie_inexistentes (codigo_pedido, motivo)
             VALUES ($1, $2)
             ON CONFLICT (codigo_pedido) DO UPDATE SET motivo = EXCLUDED.motivo, marcado_em = NOW()`,
            [codigo, msg.slice(0, 240)]
          );
        } catch (_) { /* ignore */ }
        continue;
      }
    }
  }

  log(`── [nf→pedido] Concluído: sync=${sincronizados} erros=${erros} restantes≈${pendentes}${bloqueado ? ' (bloqueado)' : ''}`);
  return { sincronizados, erros, pendentes, bloqueado };
}

// ─── Dispatcher de tabelas ────────────────────────────────────────────────────
async function executarTabela(tabela, cfg) {
  switch (tabela) {
    case 'recebimentos_nfe':    return syncRecebimentosNFe(cfg);
    case 'fornecedores':        return syncFornecedores();
    case 'pedidos_compra':      return syncPedidosCompra(cfg);
    case 'requisicoes_compra':  return syncRequisicoesCompra(cfg);
    case 'produtos_omie':       return syncProdutosOmie();
    case 'pedidos_venda':       return syncPedidosVenda(cfg);
    default:
      log(`  Tabela desconhecida: ${tabela} — pulando`);
      return { sincronizados: 0, erros: 0 };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log('═'.repeat(65));
  log('CronSync iniciado');
  log('═'.repeat(65));

  let cfg;
  try {
    cfg = await lerETravarAgendamento();
  } catch(e) {
    log(`✗ Erro ao ler agendamento: ${e.message}`);
    await pool.end();
    process.exit(1);
  }

  if (!cfg) {
    // Não era hora de executar — sai normalmente (sem erro)
    await pool.end();
    return;
  }

  const tabelas = Array.isArray(cfg.tabelas) && cfg.tabelas.length > 0
    ? cfg.tabelas
    : ['recebimentos_nfe'];

  log(`Tabelas configuradas: ${tabelas.join(', ')}`);
  log(`Ignorar etapa 80: ${!!cfg.recebimentos_ignorar_etapa_80}`);
  log(`Data inicial: ${cfg.data_inicial || '(todas)'}`);
  log('─'.repeat(65));

  const resumo = {};
  for (const tabela of tabelas) {
    try {
      resumo[tabela] = await executarTabela(tabela, cfg);
    } catch(e) {
      log(`✗ Erro fatal na tabela [${tabela}]: ${e.message}`);
      resumo[tabela] = { sincronizados: 0, erros: 1, erro: e.message };
    }
  }

  // Sempre reconcilia Compra realizada no final (rápido, em lote).
  // Cobre o caso em que recebimentos_nfe não está nas tabelas ou falhou,
  // e garante o alinhamento mesmo após outros syncs no mesmo job.
  try {
    resumo.pedidos_omie_reconcile = await reconciliarPedidosCompraAbertos();
  } catch (e) {
    log(`✗ Erro na reconciliação final de pedidos_omie: ${e.message}`);
    resumo.pedidos_omie_reconcile = { erros: 1, erro: e.message };
  }

  // Sempre: vendedor nas NFs + pedidos apontados por NF que faltam na base local
  try {
    resumo.nf_pedidos_faltantes = await reconciliarPedidosFaltantesDasNfs({ limite: 20 });
  } catch (e) {
    log(`✗ Erro na reconciliação nf→pedido: ${e.message}`);
    resumo.nf_pedidos_faltantes = { erros: 1, erro: e.message };
  }

  log('═'.repeat(65));
  log('RESUMO FINAL:');
  for (const [t, r] of Object.entries(resumo)) {
    log(`  ${t}: ${r.sincronizados ?? r.pedidos_faturados ?? 0} sincronizados, ${r.erros || 0} erros`);
  }
  log('═'.repeat(65));

  await pool.end();
}

main().catch(e => {
  console.error('Erro não tratado:', e);
  process.exit(1);
});
