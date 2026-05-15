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
  const motivoOmie = String(motivo || 'AJU').toUpperCase();
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

// GET /api/ajustes — lista últimos 500 ajustes
router.get('/', async (_req, res) => {
  try {
    await ensureAjustesSchema();
    const { rows } = await dbQuery(
      `SELECT id, tipo_operacao, codigo_produto, codigo, descricao, qtd,
              local_estoque, local_nome, data_movimentacao, cmc, motivo, obs,
              solicitante, status, aprovado_por, aprovado_em,
              reprovado_por, reprovado_em, motivo_reprovacao, criado_em
         FROM mensagens.ajustes_estoque
        ORDER BY id DESC
        LIMIT 500`
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
    const motivo         = String(req.body?.motivo || 'AJU').trim().toUpperCase() || 'AJU';
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

      const cmc = (cmcInformado && cmcInformado > 0)
        ? cmcInformado
        : await buscarCmcAtual({ codigo, local_estoque });

      if (!cmc || cmc <= 0) {
        return res.status(400).json({
          error: `CMC ausente ou inválido para o produto ${codigo}. Informe o CMC para continuar.`
        });
      }

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
