/**
 * routes/ajustes.js — Ajuste manual de estoque (ENT/SAI) no Omie
 *
 * ENT = Entrada direta em um local de estoque
 * SAI = Saída direta de um local de estoque
 *
 * Fluxo: Solicitação → "Aguardando aprovação" → Aprovação chama API Omie → "Executado"
 *         ou → Reprovação → "Reprovado"
 */
const express = require('express');
const router = express.Router();

const { dbQuery } = require('../src/db');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');

const STATUS_AGUARDANDO = 'Aguardando aprovação';
const STATUS_EXECUTADO  = 'Executado';
const STATUS_REPROVADO  = 'Reprovado';

const TIPOS_VALIDOS = new Set(['ENT', 'SAI']);
const MOTIVOS_OMIE_VALIDOS = new Set(['INV', 'OPS', 'PER', 'PDV']);
const ERROS_OMIE_NAO_RETRYAVEIS = [
  /api bloqueada por consumo indevido/i,
  /consumo redundante detectado/i,
  /valor unit.rio.+deve ser maior que zero/i,
  /preenchimento inv.lido da tag\s*\[motivo\]/i,
  /nenhum produto foi localizado/i,
  /produto.+n.o encontrado/i
];

let schemaAjustesOk = false;

async function ensureAjustesSchema() {
  if (schemaAjustesOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS mensagens`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS mensagens.ajustes_estoque (
      id                 BIGSERIAL PRIMARY KEY,
      tipo_operacao      TEXT NOT NULL CHECK (tipo_operacao IN ('ENT','SAI')),
      codigo_produto     BIGINT,
      codigo             TEXT NOT NULL,
      descricao          TEXT,
      qtd                NUMERIC(18,4) NOT NULL,
      local_estoque      TEXT NOT NULL,
      local_nome         TEXT,
      data_movimentacao  DATE,
      cmc                NUMERIC(18,4),
      motivo             TEXT DEFAULT 'AJU',
      obs                TEXT,
      solicitante        TEXT,
      status             TEXT NOT NULL DEFAULT 'Aguardando aprovação',
      aprovado_por       TEXT,
      aprovado_em        TIMESTAMPTZ,
      reprovado_por      TEXT,
      reprovado_em       TIMESTAMPTZ,
      motivo_reprovacao  TEXT,
      criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  schemaAjustesOk = true;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function normalizaNumero(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim().replace(/\s+/g, '');
  if (!raw) return null;

  let normalizado = raw;
  const temVirgula = raw.includes(',');
  const temPonto   = raw.includes('.');

  if (temVirgula && temPonto) {
    normalizado = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (temVirgula) {
    normalizado = raw.replace(/\./g, '').replace(',', '.');
  } else if (temPonto) {
    const partes = raw.split('.');
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) {
      normalizado = raw.replace(/\./g, '');
    }
  }

  const parsed = Number(normalizado);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeNumero(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function formatarDataBR(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
}

function normalizarDataMovimentacao(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date();
  const isoM = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoM) return new Date(Number(isoM[1]), Number(isoM[2]) - 1, Number(isoM[3]));
  const brM  = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brM)  return new Date(Number(brM[3]), Number(brM[2]) - 1, Number(brM[1]));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatarDataSql(data = new Date()) {
  return `${data.getFullYear()}-${String(data.getMonth()+1).padStart(2,'0')}-${String(data.getDate()).padStart(2,'0')}`;
}

async function buscarCmcAtual({ codigo, local_estoque }) {
  if (!codigo || !local_estoque) return null;
  const { rows } = await dbQuery(
    `SELECT cmc
       FROM logistica.estoque_atual
      WHERE codigo = $1
        AND local_codigo = $2
      LIMIT 1`,
    [String(codigo).trim(), String(local_estoque).trim()]
  );
  const cmc = normalizaNumero(rows?.[0]?.cmc);
  return cmc && cmc > 0 ? cmc : null;
}

async function buscarCodigoProduto(codigo) {
  const raw = String(codigo || '').trim();
  if (!raw) return null;

  // Se for numérico, tenta direto por codigo_produto
  if (/^\d+$/.test(raw)) {
    const { rows } = await dbQuery(
      `SELECT codigo_produto FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
      [Number(raw)]
    );
    if (rows.length) return Number(rows[0].codigo_produto);
  }

  // Busca por código textual
  const { rows } = await dbQuery(
    `SELECT codigo_produto FROM public.produtos_omie WHERE codigo = $1 LIMIT 1`,
    [raw]
  );
  if (!rows.length) {
    const err = new Error(`Produto "${raw}" não encontrado em public.produtos_omie.`);
    err.status = 404;
    throw err;
  }
  return Number(rows[0].codigo_produto);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isErroOmieRetryable({ httpStatus, texto }) {
  const body = String(texto || '');
  if (ERROS_OMIE_NAO_RETRYAVEIS.some((regex) => regex.test(body))) {
    return false;
  }
  return httpStatus === 425
    || httpStatus === 429
    || httpStatus >= 500
    || /too many|rate limit|consumo redundante|requisi/i.test(body);
}

/**
 * Chama IncluirAjusteEstoque na Omie para ENT ou SAI.
 * Não usa codigo_local_estoque_destino (diferente de TRF).
 */
async function incluirAjusteOmie(registro, aprovadoPor) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    const err = new Error('Credenciais da Omie ausentes.');
    err.status = 500;
    throw err;
  }

  const { id, tipo_operacao, codigo_produto, codigo, qtd, local_estoque, cmc, data_movimentacao, motivo, obs } = registro;

  const localNumero     = normalizaNumero(local_estoque);
  const idProduto       = normalizaNumero(codigo_produto);
  const quantidadeNum   = normalizaNumero(qtd) ?? 0;
  const quantidadeFinal = quantidadeNum > 0 ? quantidadeNum : 0;

  // CMC: usa o informado ou busca do estoque atual
  const valorCmcInformado = normalizaNumero(cmc);
  const valorCmc = (valorCmcInformado && valorCmcInformado > 0)
    ? valorCmcInformado
    : await buscarCmcAtual({ codigo, local_estoque });

  if (!valorCmc || valorCmc <= 0) {
    const err = new Error(`CMC ausente ou inválido para o produto ${codigo || codigo_produto}. Informe o CMC antes de executar o ajuste.`);
    err.status = 400;
    throw err;
  }

  const dataObj = normalizarDataMovimentacao(data_movimentacao);
  const tipoOmie = String(tipo_operacao || '').toUpperCase();
  const motivoNormalizado = String(motivo || 'INV').toUpperCase();
  const motivoOmie = MOTIVOS_OMIE_VALIDOS.has(motivoNormalizado) ? motivoNormalizado : 'INV';
  const obsTexto = obs
    ? String(obs).slice(0, 200)
    : `Ajuste ${tipoOmie} #${id} - Produto ${codigo || ''}. Executado por ${aprovadoPor}.`;

  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [
      {
        codigo_local_estoque: localNumero ?? local_estoque ?? '',
        id_prod: idProduto ?? codigo_produto,
        data: formatarDataBR(dataObj),
        quan: String(quantidadeFinal || quantidadeNum || qtd || '0'),
        obs: obsTexto,
        origem: 'AJU',
        tipo: tipoOmie,
        motivo: motivoOmie,
        valor: valorCmc
      }
    ]
  };

  console.info('[ajustes][omie] Enviando ajuste', {
    ajusteId: id, tipo: tipoOmie, local: localNumero, produto: idProduto, qtd: quantidadeFinal, cmc: valorCmc
  });

  const delays = [3000, 6000, 12000, 24000, 45000];
  let ultimoErro = null;

  for (let tentativa = 0; tentativa <= delays.length; tentativa++) {
    let resp;
    let texto = '';
    try {
      resp = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      texto = await resp.text();
    } catch (fetchErr) {
      ultimoErro = fetchErr;
      if (tentativa < delays.length) { await sleep(delays[tentativa]); continue; }
      const err = new Error(`Falha ao comunicar com a Omie: ${fetchErr.message || fetchErr}`);
      err.status = 502;
      throw err;
    }

    let json;
    try { json = texto ? JSON.parse(texto) : {}; }
    catch (parseErr) {
      ultimoErro = parseErr;
      if (isErroOmieRetryable({ httpStatus: resp.status, texto }) && tentativa < delays.length) {
        console.warn('[ajustes][omie] retry por resposta inválida', { ajusteId: id, tentativa: tentativa + 1 });
        await sleep(delays[tentativa]);
        continue;
      }
      const err = new Error(`Resposta inválida da Omie. HTTP ${resp.status}.`);
      err.status = resp.status >= 400 ? resp.status : 502;
      throw err;
    }

    if (resp.ok && String(json?.codigo_status || '') === '0') return json;

    const retryable = isErroOmieRetryable({
      httpStatus: resp.status,
      texto: texto || json?.descricao_status || json?.faultstring
    });
    if (retryable && tentativa < delays.length) {
      console.warn('[ajustes][omie] retry por limite/erro temporário', {
        ajusteId: id, tentativa: tentativa + 1, httpStatus: resp.status,
        descricao: json?.descricao_status || json?.faultstring || texto?.slice(0, 180)
      });
      await sleep(delays[tentativa]);
      continue;
    }

    const msg = json?.descricao_status || json?.faultstring || `Falha na Omie (HTTP ${resp.status}).`;
    const err = new Error(msg);
    err.status = resp.status >= 400 ? resp.status : 502;
    throw err;
  }

  const err = new Error(`Omie não confirmou o ajuste após várias tentativas. ${ultimoErro?.message || ''}`.trim());
  err.status = 429;
  throw err;
}

// ─── rotas ──────────────────────────────────────────────────────────────────

// POST /api/ajustes/check-produtos — verifica CMC de uma lista de produtos
// Body: { itens: [{ codigo, local_estoque? }] }
router.post('/check-produtos', express.json(), async (req, res) => {
  try {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
    if (!itens.length) return res.json({ ok: true, resultados: [] });

    const resultados = await Promise.all(itens.map(async item => {
      const codigo = String(item.codigo || '').trim();
      const local_estoque = String(item.local_estoque || '').trim() || null;
      if (!codigo) return { codigo, cmc: null, semCmc: true };
      const cmc = await buscarCmcAtual({ codigo, local_estoque });
      return { codigo, cmc: cmc || null, semCmc: !cmc };
    }));

    res.json({ ok: true, resultados });
  } catch (err) {
    console.error('[ajustes] check-produtos', err);
    res.status(500).json({ error: err.message || 'Falha ao verificar produtos.' });
  }
});

// POST /api/ajustes/reconciliar — compara QTD_CONTADA com estoque atual no Omie
// Body: { local_estoque: "cod", itens: [{codigo, qty_fisica}] }
// Lógica de sugestão:
//   ENT (contado > sistema) → verifica saldo no Recebimento; se suficiente → TRF Recebimento→Almox
//   SAI (contado < sistema) → TRF Almox→Produção (consumo não registrado)
//   tipoitem 0/00 (revenda) ou 4/04 (PA) fora do #MAQ → pertenceMaq=true, sem ação
router.post('/reconciliar', express.json(), async (req, res) => {
  const COD_RECEBIMENTO  = '10408201806'; // #D   — 1. RECEBIMENTO DE PRODUTOS
  const COD_PRODUCAO     = '10431538872'; // #PROD — 3. ESTOQUE PRODUÇÃO
  const COD_MAQ          = '10408747829'; // #MAQ  — 4. ESTOQUE MAQUINAS
  const TIPOS_PA_REVENDA = new Set(['0', '00', '4', '04']); // Produto Acabado e Revenda
  try {
    const local_estoque = String(req.body?.local_estoque || '').trim();
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

    if (!local_estoque) return res.status(400).json({ error: 'Informe o armazém.' });
    if (!itens.length) return res.status(400).json({ error: 'Nenhum item informado.' });

    const codigos = [...new Set(
      itens.map(i => String(i.codigo || '').trim()).filter(Boolean)
    )];
    if (!codigos.length) return res.status(400).json({ error: 'Nenhum código válido.' });

    // Data mais recente disponível para este armazém na tabela de posição
    const { rows: dateRows } = await dbQuery(
      `SELECT MAX(data_posicao) AS ultima_data
         FROM public.omie_estoque_posicao
        WHERE local_codigo = $1`,
      [local_estoque]
    );
    const ultimaData = dateRows[0]?.ultima_data;
    if (!ultimaData) {
      return res.status(404).json({
        error: `Sem dados de posição de estoque para o armazém "${local_estoque}". Sincronize o estoque primeiro.`
      });
    }

    // Busca saldo e cmc de cada produto na posição mais recente do armazém alvo
    const { rows: estoqueRows } = await dbQuery(
      `SELECT codigo, COALESCE(saldo, 0) AS saldo, COALESCE(cmc, 0) AS cmc, descricao
         FROM public.omie_estoque_posicao
        WHERE local_codigo = $1
          AND data_posicao = $2
          AND codigo = ANY($3::text[])`,
      [local_estoque, ultimaData, codigos]
    );
    const mapaEstoque = new Map(estoqueRows.map(r => [String(r.codigo), r]));

    // Identifica produtos com ENT (contado > sistema) para buscar saldo no Recebimento
    const codigosEnt = codigos.filter(cod => {
      const item = itens.find(i => String(i.codigo || '').trim() === cod);
      const qtyFisica = normalizaNumero(item?.qty_fisica) ?? 0;
      const qtySistema = normalizaNumero(mapaEstoque.get(cod)?.saldo) ?? 0;
      return qtyFisica > qtySistema;
    });

    // Saldo no Recebimento para produtos que precisam de ENT
    // (apenas quando o armazém reconciliado NÃO é o próprio Recebimento)
    let mapaRecebimento = new Map();
    if (codigosEnt.length && local_estoque !== COD_RECEBIMENTO) {
      const { rows: drRows } = await dbQuery(
        `SELECT MAX(data_posicao) AS ultima_data
           FROM public.omie_estoque_posicao
          WHERE local_codigo = $1`,
        [COD_RECEBIMENTO]
      );
      const ultimaDataReceb = drRows[0]?.ultima_data;
      if (ultimaDataReceb) {
        const { rows: recebRows } = await dbQuery(
          `SELECT codigo, COALESCE(saldo, 0) AS saldo
             FROM public.omie_estoque_posicao
            WHERE local_codigo = $1
              AND data_posicao = $2
              AND codigo = ANY($3::text[])`,
          [COD_RECEBIMENTO, ultimaDataReceb, codigosEnt]
        );
        mapaRecebimento = new Map(recebRows.map(r => [String(r.codigo), normalizaNumero(r.saldo) ?? 0]));
      }
    }

    // tipoitem de cada produto (para regra PA/Revenda → #MAQ)
    const { rows: tipoRows } = await dbQuery(
      `SELECT codigo, COALESCE(tipoitem, '') AS tipoitem
         FROM public.produtos_omie
        WHERE codigo = ANY($1::text[])`,
      [codigos]
    );
    const mapaTipoItem = new Map(tipoRows.map(r => [String(r.codigo), String(r.tipoitem || '')]));

    const resultados = itens
      .filter(item => String(item.codigo || '').trim())
      .map(item => {
        const codigo = String(item.codigo || '').trim();
        const qtyFisica = normalizaNumero(item.qty_fisica) ?? 0;
        const est = mapaEstoque.get(codigo);
        const qtySistema = normalizaNumero(est?.saldo) ?? 0;
        const cmc = normalizaNumero(est?.cmc) ?? 0;
        const descricao = est?.descricao || '';
        const delta = qtyFisica - qtySistema;
        const ajusteQty = Math.abs(delta);

        // Produtos PA/Revenda fora do #MAQ: normal ter saldo 0 no armazém contado
        const tipoitem = mapaTipoItem.get(codigo) || '';
        if (TIPOS_PA_REVENDA.has(tipoitem) && local_estoque !== COD_MAQ && delta > 0) {
          return {
            codigo, descricao, qtySistema, qtyFisica, delta, ajusteQty, cmc,
            semSistema: !est,
            tipo: null,
            pertenceMaq: true,
            tipoitem
          };
        }

        if (delta > 0) {
          // Contado > sistema → verifica cobertura no Recebimento
          const saldoReceb = mapaRecebimento.get(codigo) ?? 0;
          if (saldoReceb >= ajusteQty) {
            // Recebimento tem saldo suficiente → TRF Recebimento → Almox
            return {
              codigo, descricao, qtySistema, qtyFisica, delta, ajusteQty, cmc,
              semSistema: !est,
              tipo: 'TRF',
              origemTrf: COD_RECEBIMENTO,
              destinoTrf: local_estoque,
              origemTrfNome: 'Recebimento',
              saldoRecebimento: saldoReceb
            };
          }
          // Sem cobertura suficiente no Recebimento → ajuste ENT
          return {
            codigo, descricao, qtySistema, qtyFisica, delta, ajusteQty, cmc,
            semSistema: !est,
            tipo: 'ENT',
            saldoRecebimento: saldoReceb
          };
        }

        if (delta < 0) {
          // Contado < sistema → material foi consumido pela produção sem TRF registrada
          return {
            codigo, descricao, qtySistema, qtyFisica, delta, ajusteQty, cmc,
            semSistema: !est,
            tipo: 'TRF',
            origemTrf: local_estoque,
            destinoTrf: COD_PRODUCAO,
            destinoTrfNome: 'Produção'
          };
        }

        // Sem diferença
        return { codigo, descricao, qtySistema, qtyFisica, delta, ajusteQty: 0, cmc, semSistema: !est, tipo: null };
      });

    res.json({
      ok: true,
      local_estoque,
      ultimaData: ultimaData instanceof Date
        ? ultimaData.toISOString().slice(0, 10)
        : String(ultimaData).slice(0, 10),
      resultados
    });
  } catch (err) {
    console.error('[ajustes] reconciliar', err);
    res.status(500).json({ error: err.message || 'Falha ao reconciliar estoque.' });
  }
});

// GET /api/ajustes — lista todos os pendentes + histórico recente
router.get('/', async (_req, res) => {
  try {
    await ensureAjustesSchema();
    const { rows } = await dbQuery(
      `WITH pendentes AS (
         SELECT id, tipo_operacao, codigo_produto, codigo, descricao, qtd,
                local_estoque, local_nome, data_movimentacao, cmc, motivo, obs,
                solicitante, status, aprovado_por, aprovado_em,
                reprovado_por, reprovado_em, motivo_reprovacao, criado_em,
                0 AS ordem_status
           FROM mensagens.ajustes_estoque
          WHERE lower(coalesce(status, '')) NOT IN ('executado', 'reprovado')
       ),
       historico AS (
         SELECT id, tipo_operacao, codigo_produto, codigo, descricao, qtd,
                local_estoque, local_nome, data_movimentacao, cmc, motivo, obs,
                solicitante, status, aprovado_por, aprovado_em,
                reprovado_por, reprovado_em, motivo_reprovacao, criado_em,
                1 AS ordem_status
           FROM mensagens.ajustes_estoque
          WHERE lower(coalesce(status, '')) IN ('executado', 'reprovado')
          ORDER BY id DESC
          LIMIT 250
       )
       SELECT id, tipo_operacao, codigo_produto, codigo, descricao, qtd,
              local_estoque, local_nome, data_movimentacao, cmc, motivo, obs,
              solicitante, status, aprovado_por, aprovado_em,
              reprovado_por, reprovado_em, motivo_reprovacao, criado_em
         FROM (
           SELECT * FROM pendentes
           UNION ALL
           SELECT * FROM historico
         ) itens
        ORDER BY ordem_status, id DESC`
    );
    res.json({ ok: true, registros: rows });
  } catch (err) {
    console.error('[ajustes] listar', err);
    res.status(500).json({ error: 'Falha ao buscar ajustes de estoque.' });
  }
});

// POST /api/ajustes — cria solicitação de ajuste
// Body: { tipo_operacao, local_estoque, data_movimentacao?, solicitante?, obs?, itens:[{codigo,descricao?,qtd,cmc?,codigo_produto?,codOmie?}] }
router.post('/', express.json(), async (req, res) => {
  try {
    await ensureAjustesSchema();

    const tipo_operacao  = String(req.body?.tipo_operacao || '').trim().toUpperCase();
    const local_estoque  = String(req.body?.local_estoque || '').trim();
    const local_nome     = String(req.body?.local_nome || '').trim() || null;
    const dataMovRaw     = String(req.body?.data_movimentacao || '').trim();
    const dataMovObj     = normalizarDataMovimentacao(dataMovRaw);
    const dataMovSql     = formatarDataSql(dataMovObj);
    const solicitante    = String(req.body?.solicitante || '').trim() || null;
    const obs            = String(req.body?.obs || '').trim() || null;
    const motivoRaw      = String(req.body?.motivo || 'INV').trim().toUpperCase() || 'INV';
    const motivo         = MOTIVOS_OMIE_VALIDOS.has(motivoRaw) ? motivoRaw : 'INV';
    const itens          = Array.isArray(req.body?.itens) ? req.body.itens : [];

    if (!TIPOS_VALIDOS.has(tipo_operacao)) {
      return res.status(400).json({ error: 'tipo_operacao deve ser ENT ou SAI.' });
    }
    if (!local_estoque) {
      return res.status(400).json({ error: 'Informe o local de estoque.' });
    }
    if (!itens.length) {
      return res.status(400).json({ error: 'Nenhum item selecionado para ajuste.' });
    }

    const cache = new Map();
    const preparados = [];

    for (const item of itens) {
      if (!item) continue;
      const codigo   = String(item.codigo   || '').trim();
      const descricao = String(item.descricao || '').trim() || null;
      const qtd = sanitizeNumero(item.qtd);
      const cmcInformado = sanitizeNumero(item.cmc);

      if (!codigo) {
        return res.status(400).json({ error: 'Item sem código informado.' });
      }
      if (qtd === null || qtd <= 0) {
        return res.status(400).json({ error: `Quantidade inválida para o produto ${codigo}.` });
      }

      // CMC é opcional no registro; será validado no momento da aprovação
      const cmc = (cmcInformado && cmcInformado > 0)
        ? cmcInformado
        : await buscarCmcAtual({ codigo, local_estoque }) ?? null;

      // Resolve codigo_produto numérico
      const candidatos = [item.codigo_produto, item.codigoProduto, item.codOmie, item.codigo_omie];
      let codigoProduto = cache.get(codigo);
      if (!codigoProduto) {
        const numCandidato = candidatos
          .map(c => String(c ?? '').trim())
          .find(s => /^\d+$/.test(s));
        if (numCandidato) {
          codigoProduto = Number(numCandidato);
        } else {
          try {
            codigoProduto = await buscarCodigoProduto(codigo);
          } catch (e) {
            const err = new Error(`Produto "${codigo}" não encontrado. Verifique o código.`);
            err.status = 404;
            return res.status(404).json({ error: err.message });
          }
        }
        cache.set(codigo, codigoProduto);
      }

      preparados.push({
        tipo_operacao,
        codigo_produto: codigoProduto,
        codigo,
        descricao,
        qtd,
        local_estoque,
        local_nome,
        data_movimentacao: dataMovSql,
        cmc,
        motivo,
        obs,
        solicitante
      });
    }

    if (!preparados.length) {
      return res.status(400).json({ error: 'Nenhum item válido para registrar ajuste.' });
    }

    const params = [];
    const valuesSql = preparados.map((item, idx) => {
      const b = idx * 13;
      params.push(
        item.tipo_operacao, item.codigo_produto, item.codigo, item.descricao,
        item.qtd, item.local_estoque, item.local_nome, item.data_movimentacao,
        item.cmc, item.motivo, item.obs, item.solicitante, STATUS_AGUARDANDO
      );
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13})`;
    }).join(', ');

    const insertSql = `
      INSERT INTO mensagens.ajustes_estoque
        (tipo_operacao, codigo_produto, codigo, descricao, qtd,
         local_estoque, local_nome, data_movimentacao, cmc, motivo, obs, solicitante, status)
      VALUES ${valuesSql}
      RETURNING id, tipo_operacao, codigo_produto, codigo, descricao, qtd,
                local_estoque, local_nome, data_movimentacao, cmc, motivo, obs,
                solicitante, status, criado_em
    `;

    const resultado = await dbQuery(insertSql, params);
    res.json({ ok: true, registros: resultado.rows });
  } catch (err) {
    console.error('[ajustes] registrar', err);
    res.status(err.status || 500).json({
      error: 'Falha ao registrar ajuste de estoque.',
      detail: err.message || String(err)
    });
  }
});

// PATCH /api/ajustes/:id/aprovar — aprova e executa ajuste no Omie
router.patch('/:id/aprovar', express.json(), async (req, res) => {
  try {
    await ensureAjustesSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Identificador inválido.' });
    }

    const aprovadoPor = String(req.body?.aprovadoPor || '').trim();
    if (!aprovadoPor) {
      return res.status(400).json({ error: 'Informe o nome de quem aprovou.' });
    }

    const { rows: encontrados } = await dbQuery(
      `SELECT id, tipo_operacao, codigo_produto, codigo, descricao, qtd,
              local_estoque, local_nome, data_movimentacao, cmc, motivo, obs,
              solicitante, status, aprovado_por
         FROM mensagens.ajustes_estoque
        WHERE id = $1
        LIMIT 1`,
      [id]
    );

    if (!encontrados.length) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    const registro = encontrados[0];
    if (String(registro.status || '').toLowerCase() === STATUS_EXECUTADO.toLowerCase()) {
      return res.status(409).json({ error: 'Este ajuste já foi executado.' });
    }
    if (String(registro.status || '').toLowerCase() === STATUS_REPROVADO.toLowerCase()) {
      return res.status(409).json({ error: 'Este ajuste foi reprovado e não pode ser executado.' });
    }

    const respostaOmie = await incluirAjusteOmie(registro, aprovadoPor);

    const { rows } = await dbQuery(
      `UPDATE mensagens.ajustes_estoque
          SET status = $1,
              aprovado_por = $2,
              aprovado_em = NOW()
        WHERE id = $3
        RETURNING id, tipo_operacao, codigo, descricao, qtd,
                  local_estoque, local_nome, data_movimentacao, cmc,
                  solicitante, status, aprovado_por, aprovado_em`,
      [STATUS_EXECUTADO, aprovadoPor, id]
    );

    res.json({
      ok: true,
      registro: rows[0],
      descricao_status: respostaOmie?.descricao_status || null,
      omie: respostaOmie || null
    });
  } catch (err) {
    console.error('[ajustes] aprovar', err);
    res.status(err.status || 500).json({
      error: err.message || 'Falha ao executar ajuste de estoque.'
    });
  }
});

// PATCH /api/ajustes/:id/reprovar — reprova a solicitação
router.patch('/:id/reprovar', express.json(), async (req, res) => {
  try {
    await ensureAjustesSchema();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Identificador inválido.' });
    }

    const reprovadoPor = String(req.body?.reprovadoPor || req.body?.usuario || '').trim();
    const motivo = String(req.body?.motivo || '').trim() || null;
    if (!reprovadoPor) {
      return res.status(400).json({ error: 'Informe o nome de quem reprovou.' });
    }

    const { rows: encontrados } = await dbQuery(
      `SELECT id, status FROM mensagens.ajustes_estoque WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (!encontrados.length) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    const statusAtual = String(encontrados[0].status || '').toLowerCase();
    if (statusAtual === STATUS_EXECUTADO.toLowerCase()) {
      return res.status(409).json({ error: 'Este ajuste já foi executado e não pode ser reprovado.' });
    }

    const { rows } = await dbQuery(
      `UPDATE mensagens.ajustes_estoque
          SET status = $1,
              reprovado_por = $2,
              reprovado_em = NOW(),
              motivo_reprovacao = $3
        WHERE id = $4
        RETURNING id, tipo_operacao, codigo, descricao, qtd,
                  local_estoque, local_nome, data_movimentacao,
                  solicitante, status, reprovado_por, reprovado_em, motivo_reprovacao`,
      [STATUS_REPROVADO, reprovadoPor, motivo, id]
    );

    res.json({ ok: true, registro: rows[0] });
  } catch (err) {
    console.error('[ajustes] reprovar', err);
    res.status(err.status || 500).json({
      error: err.message || 'Falha ao reprovar ajuste de estoque.'
    });
  }
});

module.exports = router;
