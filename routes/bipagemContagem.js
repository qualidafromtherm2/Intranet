'use strict';

const express = require('express');
const { dbQuery } = require('../src/db');
const { interpretarLeitura } = require('../utils/bipagemContagem');

const router = express.Router();
let estruturaPromise = null;

function usuarioSessao(req) {
  const user = req.session?.user || {};
  return {
    id: user.id || null,
    nome: String(user.username || user.login || user.nome || user.fullName || '').trim(),
  };
}

function exigirLogin(req, res, next) {
  const usuario = usuarioSessao(req);
  if (!usuario.id) return res.status(401).json({ ok: false, error: 'Faça login para usar a contagem.' });
  req.usuarioBipagem = usuario;
  next();
}

async function garantirEstrutura() {
  if (!estruturaPromise) {
    estruturaPromise = (async () => {
      await dbQuery('CREATE SCHEMA IF NOT EXISTS logistica');
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS logistica.bipagem_contagem_sessoes (
          id BIGSERIAL PRIMARY KEY,
          nome TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'finalizada')),
          criado_por_id BIGINT,
          criado_por TEXT NOT NULL,
          iniciada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          finalizada_em TIMESTAMPTZ,
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await dbQuery(`
        CREATE TABLE IF NOT EXISTS logistica.bipagem_contagem_leituras (
          id BIGSERIAL PRIMARY KEY,
          sessao_id BIGINT NOT NULL REFERENCES logistica.bipagem_contagem_sessoes(id) ON DELETE CASCADE,
          valor_bruto TEXT NOT NULL,
          valor_normalizado TEXT NOT NULL,
          formato TEXT NOT NULL,
          modelo TEXT,
          ordem_producao TEXT,
          data_referencia DATE,
          origem TEXT NOT NULL DEFAULT 'leitor',
          lido_por_id BIGINT,
          lido_por TEXT NOT NULL,
          lido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT bipagem_contagem_leitura_unica UNIQUE (sessao_id, valor_normalizado)
        )
      `);
      await dbQuery(`CREATE INDEX IF NOT EXISTS bipagem_contagem_sessoes_status_idx
        ON logistica.bipagem_contagem_sessoes (status, iniciada_em DESC)`);
      await dbQuery(`CREATE INDEX IF NOT EXISTS bipagem_contagem_leituras_sessao_idx
        ON logistica.bipagem_contagem_leituras (sessao_id, lido_em DESC)`);
    })().catch((err) => {
      estruturaPromise = null;
      throw err;
    });
  }
  return estruturaPromise;
}

function numeroPositivo(valor, padrao, maximo) {
  const n = Number.parseInt(valor, 10);
  if (!Number.isFinite(n) || n < 1) return padrao;
  return Math.min(n, maximo);
}

async function buscarSessao(id) {
  const { rows } = await dbQuery(`
    SELECT s.*,
           COUNT(l.id)::int AS total,
           MAX(l.lido_em) AS ultima_leitura_em
      FROM logistica.bipagem_contagem_sessoes s
      LEFT JOIN logistica.bipagem_contagem_leituras l ON l.sessao_id = s.id
     WHERE s.id = $1
     GROUP BY s.id
  `, [id]);
  return rows[0] || null;
}

router.use(exigirLogin);

router.get('/sessoes', async (req, res) => {
  try {
    await garantirEstrutura();
    const limite = numeroPositivo(req.query.limite, 12, 50);
    const status = String(req.query.status || '').trim().toLowerCase();
    const params = [];
    const filtros = [];
    if (status === 'ativa' || status === 'finalizada') {
      params.push(status);
      filtros.push(`s.status = $${params.length}`);
    }
    params.push(limite);
    const { rows } = await dbQuery(`
      SELECT s.*,
             COUNT(l.id)::int AS total,
             MAX(l.lido_em) AS ultima_leitura_em
        FROM logistica.bipagem_contagem_sessoes s
        LEFT JOIN logistica.bipagem_contagem_leituras l ON l.sessao_id = s.id
        ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
       GROUP BY s.id
       ORDER BY (s.status = 'ativa') DESC, s.iniciada_em DESC
       LIMIT $${params.length}
    `, params);
    res.json({ ok: true, sessoes: rows });
  } catch (err) {
    console.error('[bipagem-contagem] listar sessões:', err);
    res.status(500).json({ ok: false, error: 'Não foi possível carregar as contagens.' });
  }
});

router.post('/sessoes', express.json(), async (req, res) => {
  try {
    await garantirEstrutura();
    const usuario = req.usuarioBipagem;
    const nomeInformado = String(req.body?.nome || '').trim().slice(0, 120);
    const nome = nomeInformado || `Contagem ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    const { rows } = await dbQuery(`
      INSERT INTO logistica.bipagem_contagem_sessoes (nome, criado_por_id, criado_por)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [nome, usuario.id, usuario.nome || `Usuário ${usuario.id}`]);
    res.status(201).json({ ok: true, sessao: { ...rows[0], total: 0 } });
  } catch (err) {
    console.error('[bipagem-contagem] criar sessão:', err);
    res.status(500).json({ ok: false, error: 'Não foi possível iniciar a contagem.' });
  }
});

router.get('/sessoes/:id', async (req, res) => {
  try {
    await garantirEstrutura();
    const id = numeroPositivo(req.params.id, 0, Number.MAX_SAFE_INTEGER);
    if (!id) return res.status(400).json({ ok: false, error: 'Contagem inválida.' });
    const sessao = await buscarSessao(id);
    if (!sessao) return res.status(404).json({ ok: false, error: 'Contagem não encontrada.' });
    const limite = numeroPositivo(req.query.limite, 200, 1000);
    const { rows } = await dbQuery(`
      SELECT id, valor_bruto, formato, modelo, ordem_producao,
             data_referencia, origem, lido_por, lido_em
        FROM logistica.bipagem_contagem_leituras
       WHERE sessao_id = $1
       ORDER BY lido_em DESC, id DESC
       LIMIT $2
    `, [id, limite]);
    res.json({ ok: true, sessao, leituras: rows });
  } catch (err) {
    console.error('[bipagem-contagem] carregar sessão:', err);
    res.status(500).json({ ok: false, error: 'Não foi possível carregar a contagem.' });
  }
});

router.post('/sessoes/:id/leituras', express.json(), async (req, res) => {
  try {
    await garantirEstrutura();
    const id = numeroPositivo(req.params.id, 0, Number.MAX_SAFE_INTEGER);
    if (!id) return res.status(400).json({ ok: false, error: 'Contagem inválida.' });
    const interpretada = interpretarLeitura(req.body?.valor);
    if (!interpretada.valido) return res.status(422).json({ ok: false, error: interpretada.erro });
    const origemAceita = ['leitor', 'camera', 'manual', 'fila_offline'].includes(req.body?.origem)
      ? req.body.origem
      : 'leitor';
    const usuario = req.usuarioBipagem;
    const sessao = await buscarSessao(id);
    if (!sessao) return res.status(404).json({ ok: false, error: 'Contagem não encontrada.' });
    if (sessao.status !== 'ativa') return res.status(409).json({ ok: false, error: 'Esta contagem já foi finalizada.' });

    try {
      const { rows } = await dbQuery(`
        INSERT INTO logistica.bipagem_contagem_leituras (
          sessao_id, valor_bruto, valor_normalizado, formato, modelo,
          ordem_producao, data_referencia, origem, lido_por_id, lido_por
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id, valor_bruto, formato, modelo, ordem_producao,
                  data_referencia, origem, lido_por, lido_em
      `, [
        id,
        interpretada.valorBruto,
        interpretada.valorNormalizado,
        interpretada.formato,
        interpretada.modelo || null,
        interpretada.ordemProducao || null,
        interpretada.dataReferencia,
        origemAceita,
        usuario.id,
        usuario.nome || `Usuário ${usuario.id}`,
      ]);
      await dbQuery('UPDATE logistica.bipagem_contagem_sessoes SET atualizado_em = NOW() WHERE id = $1', [id]);
      const atualizada = await buscarSessao(id);
      return res.status(201).json({ ok: true, duplicada: false, leitura: rows[0], sessao: atualizada });
    } catch (err) {
      if (err?.code !== '23505') throw err;
      const { rows } = await dbQuery(`
        SELECT id, valor_bruto, formato, modelo, ordem_producao,
               data_referencia, origem, lido_por, lido_em
          FROM logistica.bipagem_contagem_leituras
         WHERE sessao_id = $1 AND valor_normalizado = $2
         LIMIT 1
      `, [id, interpretada.valorNormalizado]);
      return res.status(409).json({
        ok: false,
        duplicada: true,
        error: 'Este código já foi contado nesta sessão.',
        leitura: rows[0] || null,
        sessao,
      });
    }
  } catch (err) {
    console.error('[bipagem-contagem] registrar leitura:', err);
    res.status(500).json({ ok: false, error: 'Não foi possível confirmar a leitura.' });
  }
});

router.delete('/sessoes/:sessaoId/leituras/:leituraId', async (req, res) => {
  try {
    await garantirEstrutura();
    const sessaoId = numeroPositivo(req.params.sessaoId, 0, Number.MAX_SAFE_INTEGER);
    const leituraId = numeroPositivo(req.params.leituraId, 0, Number.MAX_SAFE_INTEGER);
    if (!sessaoId || !leituraId) return res.status(400).json({ ok: false, error: 'Leitura inválida.' });
    const sessao = await buscarSessao(sessaoId);
    if (!sessao) return res.status(404).json({ ok: false, error: 'Contagem não encontrada.' });
    if (sessao.status !== 'ativa') return res.status(409).json({ ok: false, error: 'Uma contagem finalizada não pode ser alterada.' });
    const { rows } = await dbQuery(`
      DELETE FROM logistica.bipagem_contagem_leituras
       WHERE id = $1 AND sessao_id = $2
       RETURNING id, valor_bruto
    `, [leituraId, sessaoId]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Leitura não encontrada.' });
    const atualizada = await buscarSessao(sessaoId);
    res.json({ ok: true, removida: rows[0], sessao: atualizada });
  } catch (err) {
    console.error('[bipagem-contagem] remover leitura:', err);
    res.status(500).json({ ok: false, error: 'Não foi possível desfazer a leitura.' });
  }
});

router.post('/sessoes/:id/finalizar', express.json(), async (req, res) => {
  try {
    await garantirEstrutura();
    const id = numeroPositivo(req.params.id, 0, Number.MAX_SAFE_INTEGER);
    if (!id) return res.status(400).json({ ok: false, error: 'Contagem inválida.' });
    const { rows } = await dbQuery(`
      UPDATE logistica.bipagem_contagem_sessoes
         SET status = 'finalizada', finalizada_em = COALESCE(finalizada_em, NOW()), atualizado_em = NOW()
       WHERE id = $1
       RETURNING *
    `, [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Contagem não encontrada.' });
    const sessao = await buscarSessao(id);
    res.json({ ok: true, sessao });
  } catch (err) {
    console.error('[bipagem-contagem] finalizar sessão:', err);
    res.status(500).json({ ok: false, error: 'Não foi possível finalizar a contagem.' });
  }
});

module.exports = router;
