// routes/estoque.js




const express = require('express');
const { axiosPostWithRetry, delay } = require('../utils/axiosRetry');
const { dbQuery } = require('../src/db');
const {
  OMIE_APP_KEY,
  OMIE_APP_SECRET
} = require('../config.server');
const router = express.Router();
const OMIE_URL = 'https://app.omie.com.br/api/v1/estoque/consulta/';
const OMIE_AJUSTE_URL = 'https://app.omie.com.br/api/v1/estoque/ajuste/';

/* ------------------------------------------------------------------ */
/*  /api/omie/estoque/pagina                                          */
/* ------------------------------------------------------------------ */
router.post('/pagina', async (req, res) => {
  try {
    const { call, param } = req.body;         // pega só o necessário

    const payload = {
      call,
      param,
      app_key   : OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const { data } = await axiosPostWithRetry(
      OMIE_URL,
      payload,
      {
        timeout: 15000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    return res.json(data);
  } catch (err) {
    /* log detalhado */
    const fault = err.response?.data || err.message;
    console.error('[Estoque/pagina] erro →', fault);
    return res.status(500).json({ error: 'Falha ao consultar posição de estoque (página)' });
  }
});

/* ------------------------------------------------------------------ */
/*  /api/omie/estoque/posicao                                         */
/* ------------------------------------------------------------------ */
router.post('/posicao', async (req, res) => {
  try {
    const {
      dDataPosicao         = '30/04/2025',
      nRegPorPagina        = 50,
      cExibeTodos          = 'S',
      codigo_local_estoque = 0
    } = req.body.param?.[0] || {};

    /* página 1 */
    const firstPayload = {
      call: 'ListarPosEstoque',
      param: [{
        nPagina: 1,
        nRegPorPagina,
        dDataPosicao,
        cExibeTodos,
        codigo_local_estoque
      }],
      app_key:    OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    const { data: first } = await axiosPostWithRetry(
      OMIE_URL,
      firstPayload,
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );

    const produtos = [...first.produtos];
    const totalPag = first.nTotPaginas;

    /* páginas 2..N */
    for (let pg = 2; pg <= totalPag; pg++) {
      const payload = {
        ...firstPayload,
        param: [{
          nPagina: pg,
          nRegPorPagina,
          dDataPosicao,
          cExibeTodos,
          codigo_local_estoque
        }]
      };

      const { data } = await axiosPostWithRetry(
        OMIE_URL,
        payload,
        { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
      );

      produtos.push(...data.produtos);
    }

    return res.json({
      dDataPosicao,
      nTotRegistros: produtos.length,
      produtos
    });
  } catch (err) {
    console.error('[Estoque/posicao] erro →', err.response?.data || err.message);
    return res.status(500).json({ error: 'Falha ao consultar posição de estoque' });
  }
});

// Rota de Ajuste de Estoque Mínimo
router.post('/ajuste', async (req, res) => {
  try {
    const payload = {
      call:      'AlterarEstoqueMinimo',
      app_key:   OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET,
      param:     req.body.param   // espera [{ id_prod, quan_min }] ou [{ cod_int, quan_min }]
    };

    const { data } = await axiosPostWithRetry(
      OMIE_AJUSTE_URL,
      payload,
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );
    res.json(data);

  } catch (err) {
    console.error('Erro na rota /api/omie/estoque/ajuste', err);
    res
      .status(500)
      .json({ error: 'Falha interna ao ajustar estoque mínimo' });
  }
});

// Atualiza o mínimo em todos os locais já conhecidos para o produto.
router.post('/minimo-produto', async (req, res) => {
  try {
    const idProd = Number(req.body?.id_prod);
    const codigo = String(req.body?.codigo || '').trim();
    const minimo = Number(req.body?.quan_min);

    if (!Number.isFinite(idProd) || idProd <= 0 || !codigo) {
      return res.status(400).json({ ok: false, error: 'Produto inválido.' });
    }
    if (!Number.isFinite(minimo) || minimo < 0) {
      return res.status(400).json({ ok: false, error: 'Estoque mínimo inválido.' });
    }

    const { rows } = await dbQuery(`
      SELECT DISTINCT local_codigo::text AS local_codigo
      FROM logistica.estoque_atual
      WHERE (omie_prod_id::text = $1 OR UPPER(TRIM(codigo)) = UPPER($2))
        AND NULLIF(TRIM(local_codigo::text), '') IS NOT NULL
      ORDER BY local_codigo::text
    `, [String(idProd), codigo]);

    const locais = rows
      .map(row => Number(row.local_codigo))
      .filter(local => Number.isFinite(local) && local > 0);

    // Sem posição por local, mantém a compatibilidade com o armazém padrão da Omie.
    if (!locais.length) locais.push(0);

    const atualizados = [];
    const falhas = [];
    for (const local of locais) {
      try {
        const payload = {
          call: 'AlterarEstoqueMinimo',
          app_key: OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{
            codigo_local_estoque: local,
            id_prod: idProd,
            quan_min: String(minimo)
          }]
        };
        const { data } = await axiosPostWithRetry(
          OMIE_AJUSTE_URL,
          payload,
          { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
        );
        if (data?.faultstring || data?.error) {
          throw new Error(data.faultstring || data.error);
        }
        atualizados.push(local);
        if (local > 0) {
          await dbQuery(`
            UPDATE logistica.estoque_atual
               SET estoque_minimo = $1, updated_at = NOW()
             WHERE (omie_prod_id::text = $2 OR UPPER(TRIM(codigo)) = UPPER($3))
               AND local_codigo::text = $4
          `, [minimo, String(idProd), codigo, String(local)]);
        }
        await delay(350);
      } catch (err) {
        falhas.push({ local_codigo: local, error: err.response?.data?.faultstring || err.message });
      }
    }

    if (falhas.length) {
      return res.status(502).json({
        ok: false,
        error: `Falha ao atualizar ${falhas.length} de ${locais.length} armazém(ns).`,
        atualizados,
        falhas
      });
    }

    return res.json({ ok: true, minimo, locais_atualizados: atualizados });
  } catch (err) {
    console.error('[Estoque/minimo-produto] erro →', err.response?.data || err.message);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar estoques mínimos do produto.' });
  }
});

module.exports = router;
