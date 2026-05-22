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
 *   POST /api/transformacao-mp/executar                  — cria ajustes SAI + ENT
 */
const express = require('express');
const router = express.Router();
const { dbQuery } = require('../src/db');

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
// Cria registros de ajuste (SAI + ENT) na tabela mensagens.ajustes_estoque.
// Eles seguem o fluxo normal de aprovação: "Aguardando aprovação" → "Executado".

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
      // SAI — saída do raw material (peça sem processamento)
      const { rows: saiRows } = await dbQuery(
        `INSERT INTO mensagens.ajustes_estoque
           (tipo_operacao, codigo_produto, codigo, descricao, qtd,
            local_estoque, local_nome, data_movimentacao,
            cmc, motivo, obs, solicitante, status, criado_em)
         VALUES ('SAI', $1, $2, $3, $4, $5, $6, $7, NULL, 'AJU', $8, $9,
                 'Aguardando aprovação', NOW())
         RETURNING id`,
        [
          it.codigo_produto,
          it.sku,
          it.descricao,
          it.qtde,
          LOCAL_ESTOQUE,
          LOCAL_NOME,
          dataHoje,
          `[Transf.MP SAI] ${obsBase}`.slice(0, 500),
          solicitante || null,
        ]
      );

      // ENT — entrada do material processado com custo rateado
      const { rows: entRows } = await dbQuery(
        `INSERT INTO mensagens.ajustes_estoque
           (tipo_operacao, codigo_produto, codigo, descricao, qtd,
            local_estoque, local_nome, data_movimentacao,
            cmc, motivo, obs, solicitante, status, criado_em)
         VALUES ('ENT', $1, $2, $3, $4, $5, $6, $7, $8, 'AJU', $9, $10,
                 'Aguardando aprovação', NOW())
         RETURNING id`,
        [
          it.codigo_produto,
          it.sku,
          it.descricao,
          it.qtde,
          LOCAL_ESTOQUE,
          LOCAL_NOME,
          dataHoje,
          it.custo_unit,
          `[Transf.MP ENT] ${obsBase} | CustoUnit: R$${it.custo_unit} | Área: ${it.area_unit_m2}m²`.slice(0, 500),
          solicitante || null,
        ]
      );

      inseridos.push({
        sku: it.sku,
        descricao: it.descricao,
        qtde: it.qtde,
        area_unit_m2: it.area_unit_m2,
        custo_unit: it.custo_unit,
        id_sai: saiRows[0]?.id,
        id_ent: entRows[0]?.id,
      });
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

    return res.json({
      ok: true,
      message: `${inseridos.length} tipo(s) de peça processado(s). ${inseridos.length * 2} ajuste(s) criados aguardando aprovação.`,
      itens: inseridos,
    });
  } catch (err) {
    console.error('[TransformacaoMP/POST executar] Erro:', err);
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || 'Erro ao executar transformação.' });
  }
});

module.exports = router;
