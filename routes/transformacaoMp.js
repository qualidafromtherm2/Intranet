/**
 * routes/transformacaoMp.js — Transformação de Matéria-Prima
 *
 * Usado para registrar movimentações de saída + entrada quando peças são
 * enviadas para um processo externo (ex: zincagem na ZINCA RAPIDO) e retornam
 * com custo distribuído proporcionalmente à área (largura × altura).
 *
 * Endpoints:
 *   GET  /api/transformacao-mp/template?fornecedor=...   — busca template salvo
 *   POST /api/transformacao-mp/template                  — cria/atualiza template
 *   POST /api/transformacao-mp/executar                  — cria ajustes SAI + ENT e executa na Omie
 */
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');
const { OMIE_APP_KEY, OMIE_APP_SECRET } = require('../config.server');

// ─── Schema setup ─────────────────────────────────────────────────────────────

let schemaOk = false;

async function ensureSchema() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS compras`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS compras.transformacao_mp_template (
      id             SERIAL PRIMARY KEY,
      fornecedor_nome TEXT NOT NULL UNIQUE,
      itens           JSONB NOT NULL DEFAULT '[]',
      criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  schemaOk = true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatarDataBR(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${d.getFullYear()}`;
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

async function buscarCmcAtual(codigo, local_estoque) {
  if (!codigo || !local_estoque) return null;
  const { rows } = await dbQuery(
    `SELECT cmc FROM logistica.estoque_atual WHERE codigo = $1 AND local_codigo = $2 LIMIT 1`,
    [String(codigo).trim(), String(local_estoque).trim()]
  );
  const cmc = Number(rows?.[0]?.cmc);
  return cmc > 0 ? cmc : null;
}

/**
 * Chama IncluirAjusteEstoque na Omie.
 * Para SAI: usa CMC atual do estoque; se não encontrar, usa 0.01.
 * Para ENT: usa o cmc_informado (custo calculado pelo rateio).
 */
async function incluirAjusteOmie({ id, tipo_operacao, codigo_produto, codigo, qtd, local_estoque, cmc: cmc_informado, obs }) {
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
    throw Object.assign(new Error('Credenciais da Omie ausentes.'), { status: 500 });
  }

  const tipoOmie = String(tipo_operacao).toUpperCase();
  const motivoOmie = tipoOmie === 'SAI' ? 'INV' : 'OPE';

  let valorCmc = Number(cmc_informado);
  if (!valorCmc || valorCmc <= 0) {
    valorCmc = await buscarCmcAtual(codigo, local_estoque);
  }
  if (!valorCmc || valorCmc <= 0) {
    console.warn(`[TransformacaoMP] CMC não encontrado para ${codigo} (${tipoOmie}), usando 0.01`);
    valorCmc = 0.01;
  }

  const payload = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      codigo_local_estoque: String(local_estoque),
      id_prod: Number(codigo_produto),
      data: formatarDataBR(new Date()),
      quan: String(Number(qtd)),
      obs: String(obs || `Transf.MP ${tipoOmie} #${id}`).slice(0, 200),
      origem: 'AJU',
      tipo: tipoOmie,
      motivo: motivoOmie,
      valor: valorCmc,
    }],
  };

  const delays = [3000, 6000, 12000];
  let ultimoErro = null;

  for (let tentativa = 0; tentativa <= delays.length; tentativa++) {
    let resp, texto = '';
    try {
      resp = await fetch('https://app.omie.com.br/api/v1/estoque/ajuste/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      texto = await resp.text();
    } catch (fetchErr) {
      ultimoErro = fetchErr;
      if (tentativa < delays.length) { await sleep(delays[tentativa]); continue; }
      throw Object.assign(new Error(`Falha ao comunicar com a Omie: ${fetchErr.message}`), { status: 502 });
    }

    let json;
    try { json = texto ? JSON.parse(texto) : {}; }
    catch { json = {}; }

    if (resp.ok && String(json?.codigo_status || '') === '0') return json;

    const retryable = isErroOmieRetryable({ httpStatus: resp.status, texto: texto || json?.descricao_status });
    if (retryable && tentativa < delays.length) {
      await sleep(delays[tentativa]);
      continue;
    }

    const msg = json?.descricao_status || json?.faultstring || `Falha na Omie (HTTP ${resp.status}).`;
    throw Object.assign(new Error(msg), { status: resp.status >= 400 ? resp.status : 502 });
  }

  throw Object.assign(new Error(`Omie não confirmou o ajuste após várias tentativas. ${ultimoErro?.message || ''}`.trim()), { status: 429 });
}

function calcularRateioArea(itens, valorTotal) {
  // area_unit_m2 = (largura_cm / 100) × (altura_cm / 100)
  // custo_unit  = area_unit_m2 × (valorTotal / totalArea)
  // totalArea   = Σ (qtde × area_unit_m2)
  const parsed = itens.map(it => ({
    ...it,
    _qtde: Number(it.qtde) || 0,
    _largura: Number(it.largura_cm) || 0,
    _altura: Number(it.altura_cm) || 0,
  }));

  const totalArea = parsed.reduce((acc, it) => {
    const areaUnit = (it._largura / 100) * (it._altura / 100);
    return acc + it._qtde * areaUnit;
  }, 0);

  if (totalArea <= 0) {
    throw new Error('Área total calculada é zero. Verifique as dimensões informadas.');
  }

  const custoPorM2 = valorTotal / totalArea;

  return parsed.map(it => {
    const areaUnit = (it._largura / 100) * (it._altura / 100);
    return {
      ...it,
      area_unit_m2: +areaUnit.toFixed(6),
      custo_unit: +(areaUnit * custoPorM2).toFixed(4),
    };
  });
}

// ─── GET /api/transformacao-mp/template ───────────────────────────────────────

router.get('/template', async (req, res) => {
  try {
    await ensureSchema();
    const fornecedor = String(req.query.fornecedor || '').trim();
    if (!fornecedor) {
      return res.status(400).json({ ok: false, error: 'Parâmetro "fornecedor" é obrigatório.' });
    }

    const { rows } = await dbQuery(
      `SELECT id, fornecedor_nome, itens, criado_em, atualizado_em
         FROM compras.transformacao_mp_template
        WHERE LOWER(TRIM(fornecedor_nome)) = LOWER(TRIM($1))
        LIMIT 1`,
      [fornecedor]
    );

    if (!rows.length) {
      return res.json({ ok: true, template: null });
    }

    return res.json({ ok: true, template: rows[0] });
  } catch (err) {
    console.error('[TransformacaoMP/GET template] Erro:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao buscar template.' });
  }
});

// ─── POST /api/transformacao-mp/template ──────────────────────────────────────

router.post('/template', express.json(), async (req, res) => {
  try {
    await ensureSchema();
    const fornecedor = String(req.body?.fornecedor_nome || '').trim();
    const itens = req.body?.itens;

    if (!fornecedor) {
      return res.status(400).json({ ok: false, error: 'Campo "fornecedor_nome" é obrigatório.' });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ ok: false, error: 'Campo "itens" deve ser um array não vazio.' });
    }

    // Valida cada item minimamente
    for (const it of itens) {
      if (!String(it?.sku || '').trim()) {
        return res.status(400).json({ ok: false, error: 'Cada item do template deve ter um "sku".' });
      }
      if (!(Number(it?.largura_cm) > 0)) {
        return res.status(400).json({ ok: false, error: `Item ${it.sku}: "largura_cm" inválida.` });
      }
      if (!(Number(it?.altura_cm) > 0)) {
        return res.status(400).json({ ok: false, error: `Item ${it.sku}: "altura_cm" inválida.` });
      }
    }

    const { rows } = await dbQuery(
      `INSERT INTO compras.transformacao_mp_template (fornecedor_nome, itens, atualizado_em)
            VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (fornecedor_nome)
         DO UPDATE SET itens = EXCLUDED.itens, atualizado_em = NOW()
       RETURNING id, fornecedor_nome, itens, atualizado_em`,
      [fornecedor, JSON.stringify(itens)]
    );

    return res.json({ ok: true, template: rows[0] });
  } catch (err) {
    console.error('[TransformacaoMP/POST template] Erro:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao salvar template.' });
  }
});

// ─── POST /api/transformacao-mp/executar ──────────────────────────────────────
// Cria registros de ajuste (SAI + ENT) e executa imediatamente na Omie.

router.post('/executar', express.json(), async (req, res) => {
  try {
    await ensureSchema();

    const {
      n_id_receb,
      numero_nfe,
      fornecedor_nome,
      valor_total,
      itens,
      solicitante,
      salvar_template,
    } = req.body;

    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ ok: false, error: 'Campo "itens" é obrigatório.' });
    }
    const valorTotalNum = Number(valor_total);
    if (!Number.isFinite(valorTotalNum) || valorTotalNum <= 0) {
      return res.status(400).json({ ok: false, error: 'Campo "valor_total" deve ser um número positivo.' });
    }

    // Valida itens e busca codigo_produto
    const itensParsed = itens.map((it, i) => {
      const sku = String(it?.sku || '').trim();
      const descricao = String(it?.descricao || '').trim();
      const qtde = Number(it?.qtde);
      const largura = Number(it?.largura_cm);
      const altura = Number(it?.altura_cm);
      if (!sku) throw Object.assign(new Error(`Item ${i + 1}: "sku" é obrigatório.`), { status: 400 });
      if (!(qtde > 0)) throw Object.assign(new Error(`Item ${i + 1} (${sku}): "qtde" deve ser positivo.`), { status: 400 });
      if (!(largura > 0)) throw Object.assign(new Error(`Item ${i + 1} (${sku}): "largura_cm" deve ser positivo.`), { status: 400 });
      if (!(altura > 0)) throw Object.assign(new Error(`Item ${i + 1} (${sku}): "altura_cm" deve ser positivo.`), { status: 400 });
      return { sku, descricao, qtde, largura_cm: largura, altura_cm: altura };
    });

    // Busca codigo_produto no banco para todos os SKUs
    const skus = [...new Set(itensParsed.map(it => it.sku))];
    const { rows: prodRows } = await dbQuery(
      `SELECT codigo, codigo_produto, descricao
         FROM public.produtos_omie
        WHERE codigo = ANY($1::text[])`,
      [skus]
    );
    const mapProd = new Map(prodRows.map(r => [r.codigo, r]));

    for (const it of itensParsed) {
      const prod = mapProd.get(it.sku);
      if (!prod) throw Object.assign(new Error(`SKU "${it.sku}" não encontrado em produtos_omie.`), { status: 404 });
      it.codigo_produto = Number(prod.codigo_produto);
      if (!it.descricao) it.descricao = String(prod.descricao || '').trim();
    }

    // Calcula rateio de custo por área
    const itensComCusto = calcularRateioArea(itensParsed, valorTotalNum);

    // Warehouse #D (RECEBIMENTO)
    const LOCAL_ESTOQUE = '10408201806';
    const LOCAL_NOME    = '#D - RECEBIMENTO';
    const dataHoje      = new Date().toISOString().slice(0, 10);
    const obsBase       = [
      fornecedor_nome ? `Fornecedor: ${fornecedor_nome}` : null,
      numero_nfe ? `NF-e: ${numero_nfe}` : null,
      n_id_receb ? `ID Receb: ${n_id_receb}` : null,
    ].filter(Boolean).join(' | ');

    const inseridos = [];

    for (const it of itensComCusto) {
      // SAI — saída do material (remove estoque ao custo atual)
      const { rows: saiRows } = await dbQuery(
        `INSERT INTO mensagens.ajustes_estoque
           (tipo_operacao, codigo_produto, codigo, descricao, qtd,
            local_estoque, local_nome, data_movimentacao,
            cmc, motivo, obs, solicitante, status, criado_em)
         VALUES ('SAI', $1, $2, $3, $4, $5, $6, $7, NULL, 'AJU', $8, $9,
                 'Aguardando aprovação', NOW())
         RETURNING id`,
        [
          it.codigo_produto, it.sku, it.descricao, it.qtde,
          LOCAL_ESTOQUE, LOCAL_NOME, dataHoje,
          `[Transf.MP SAI] ${obsBase}`.slice(0, 500),
          solicitante || null,
        ]
      );

      // ENT — entrada com custo rateado pela área
      const { rows: entRows } = await dbQuery(
        `INSERT INTO mensagens.ajustes_estoque
           (tipo_operacao, codigo_produto, codigo, descricao, qtd,
            local_estoque, local_nome, data_movimentacao,
            cmc, motivo, obs, solicitante, status, criado_em)
         VALUES ('ENT', $1, $2, $3, $4, $5, $6, $7, $8, 'AJU', $9, $10,
                 'Aguardando aprovação', NOW())
         RETURNING id`,
        [
          it.codigo_produto, it.sku, it.descricao, it.qtde,
          LOCAL_ESTOQUE, LOCAL_NOME, dataHoje, it.custo_unit,
          `[Transf.MP ENT] ${obsBase} | CustoUnit: R$${it.custo_unit} | Área: ${it.area_unit_m2}m²`.slice(0, 500),
          solicitante || null,
        ]
      );

      const idSai = saiRows[0]?.id;
      const idEnt = entRows[0]?.id;

      // Executa na Omie imediatamente
      try {
        await incluirAjusteOmie({
          id: idSai, tipo_operacao: 'SAI', codigo_produto: it.codigo_produto,
          codigo: it.sku, qtd: it.qtde, local_estoque: LOCAL_ESTOQUE,
          cmc: null,
          obs: `[Transf.MP SAI] ${obsBase}`.slice(0, 200),
        });
        await dbQuery(
          `UPDATE mensagens.ajustes_estoque SET status='Executado', aprovado_por=$2, aprovado_em=NOW() WHERE id=$1`,
          [idSai, solicitante || 'Sistema']
        );

        await incluirAjusteOmie({
          id: idEnt, tipo_operacao: 'ENT', codigo_produto: it.codigo_produto,
          codigo: it.sku, qtd: it.qtde, local_estoque: LOCAL_ESTOQUE,
          cmc: it.custo_unit,
          obs: `[Transf.MP ENT] ${obsBase}`.slice(0, 200),
        });
        await dbQuery(
          `UPDATE mensagens.ajustes_estoque SET status='Executado', aprovado_por=$2, aprovado_em=NOW() WHERE id=$1`,
          [idEnt, solicitante || 'Sistema']
        );

        inseridos.push({
          sku: it.sku, descricao: it.descricao, qtde: it.qtde,
          area_unit_m2: it.area_unit_m2, custo_unit: it.custo_unit,
          id_sai: idSai, id_ent: idEnt, executado: true,
        });
      } catch (omieErr) {
        console.error(`[TransformacaoMP] Erro ao executar ajuste ${it.sku}:`, omieErr?.message);
        inseridos.push({
          sku: it.sku, descricao: it.descricao, qtde: it.qtde,
          area_unit_m2: it.area_unit_m2, custo_unit: it.custo_unit,
          id_sai: idSai, id_ent: idEnt, executado: false,
          erro: omieErr?.message,
        });
      }
    }

    // Salva/atualiza template se solicitado
    if (salvar_template && fornecedor_nome) {
      try {
        const templateItens = itensParsed.map(({ sku, descricao, largura_cm, altura_cm, qtde }) => ({
          sku, descricao, largura_cm, altura_cm, qtde
        }));
        await dbQuery(
          `INSERT INTO compras.transformacao_mp_template (fornecedor_nome, itens, atualizado_em)
                VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (fornecedor_nome)
             DO UPDATE SET itens = EXCLUDED.itens, atualizado_em = NOW()`,
          [fornecedor_nome, JSON.stringify(templateItens)]
        );
      } catch (errTemplate) {
        console.warn('[TransformacaoMP/executar] Falha ao salvar template:', errTemplate?.message);
      }
    }

    const totalExecutados = inseridos.filter(i => i.executado).length;
    const totalErros = inseridos.filter(i => !i.executado).length;

    return res.json({
      ok: totalErros === 0,
      message: totalErros === 0
        ? `${inseridos.length} tipo(s) de peça transformado(s) com sucesso.`
        : `${totalExecutados} executado(s), ${totalErros} com erro. Verifique os detalhes.`,
      itens: inseridos,
    });
  } catch (err) {
    console.error('[TransformacaoMP/POST executar] Erro:', err);
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Erro ao executar transformação.' });
  }
});

module.exports = router;
