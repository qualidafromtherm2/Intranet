/**
 * routes/monitoramento.js
 * API de auditoria: sessões UI + cronologia por produto/SEP/usuário.
 */
const express = require('express');
const router = express.Router();
const {
  ensureMonitoramentoSchema,
  iniciarSessao,
  finalizarSessao,
  registrarEvento,
  usuarioDeReq
} = require('../utils/monitoramento');
const { dbQuery } = require('../src/db');

function parseLimit(v, def = 200, max = 500) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(max, Math.floor(n));
}

// POST /api/monitoramento/sessao — abre sessão (modal Movimentação / SEP)
router.post('/sessao', async (req, res) => {
  try {
    await ensureMonitoramentoSchema();
    const user = usuarioDeReq(req);
    const body = req.body || {};
    const id = await iniciarSessao({
      tipo: body.tipo || 'MOVIMENTACAO',
      codigo_produto: body.codigo_produto,
      codigo_produto_omie: body.codigo_produto_omie,
      descricao_produto: body.descricao_produto,
      n_solic: body.n_solic,
      usuario_id: user.usuario_id,
      usuario_nome: body.usuario_nome || user.usuario_nome,
      origem: body.origem || 'modal_movimentacao',
      meta: body.meta || {}
    });
    if (!id) return res.status(500).json({ ok: false, error: 'Falha ao criar sessão de monitoramento.' });

    await registrarEvento({
      sessao_id: id,
      categoria: 'UI',
      acao: 'sessao_iniciada',
      codigo_produto: body.codigo_produto,
      codigo_produto_omie: body.codigo_produto_omie,
      n_solic: body.n_solic,
      usuario_id: user.usuario_id,
      usuario_nome: body.usuario_nome || user.usuario_nome,
      sucesso: true,
      detalhe: { origem: body.origem || 'modal_movimentacao', tipo: body.tipo || 'MOVIMENTACAO' }
    });

    res.json({ ok: true, sessao_id: id });
  } catch (err) {
    console.error('[monitoramento] POST /sessao', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao iniciar sessão.' });
  }
});

// PATCH /api/monitoramento/sessao/:id/finalizar
router.patch('/sessao/:id/finalizar', async (req, res) => {
  try {
    await ensureMonitoramentoSchema();
    const sessaoId = String(req.params.id || '').trim();
    if (!sessaoId) return res.status(400).json({ ok: false, error: 'sessao_id obrigatório.' });
    const user = usuarioDeReq(req);
    const body = req.body || {};

    await finalizarSessao(sessaoId, body.meta || null);
    await registrarEvento({
      sessao_id: sessaoId,
      categoria: 'UI',
      acao: 'sessao_finalizada',
      codigo_produto: body.codigo_produto,
      codigo_produto_omie: body.codigo_produto_omie,
      n_solic: body.n_solic,
      usuario_id: user.usuario_id,
      usuario_nome: body.usuario_nome || user.usuario_nome,
      sucesso: true,
      detalhe: body.detalhe || {}
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[monitoramento] PATCH finalizar', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao finalizar sessão.' });
  }
});

// POST /api/monitoramento/evento — clique UI ou resultado reportado pelo front
router.post('/evento', async (req, res) => {
  try {
    await ensureMonitoramentoSchema();
    const user = usuarioDeReq(req);
    const body = req.body || {};
    const acao = String(body.acao || '').trim();
    if (!acao) return res.status(400).json({ ok: false, error: 'acao obrigatória.' });

    const id = await registrarEvento({
      sessao_id: body.sessao_id || null,
      categoria: body.categoria || 'UI',
      acao,
      codigo_produto: body.codigo_produto,
      codigo_produto_omie: body.codigo_produto_omie,
      n_solic: body.n_solic,
      usuario_id: user.usuario_id,
      usuario_nome: body.usuario_nome || user.usuario_nome,
      sucesso: typeof body.sucesso === 'boolean' ? body.sucesso : null,
      detalhe: body.detalhe || {},
      rota: body.rota || null,
      metodo_http: body.metodo_http || null
    });

    res.json({ ok: true, id });
  } catch (err) {
    console.error('[monitoramento] POST /evento', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao registrar evento.' });
  }
});

// GET /api/monitoramento/cronologia?codigo=&n_solic=&usuario=&de=&ate=&limit=
router.get('/cronologia', async (req, res) => {
  try {
    await ensureMonitoramentoSchema();
    const codigo = String(req.query.codigo || '').trim();
    const nSolic = String(req.query.n_solic || '').trim();
    const usuario = String(req.query.usuario || '').trim();
    const de = String(req.query.de || '').trim();
    const ate = String(req.query.ate || '').trim();
    const limit = parseLimit(req.query.limit, 250, 800);

    if (!codigo && !nSolic && !usuario) {
      return res.status(400).json({
        ok: false,
        error: 'Informe ao menos codigo, n_solic ou usuario.'
      });
    }

    const wh = [];
    const p = [];
    let idx = 1;
    if (codigo) {
      wh.push(`(e.codigo_produto ILIKE $${idx} OR TRIM(COALESCE(e.codigo_produto_omie,'')) = $${idx})`);
      p.push(codigo);
      idx += 1;
    }
    if (nSolic) {
      wh.push(`e.n_solic ILIKE $${idx}`);
      p.push(nSolic);
      idx += 1;
    }
    if (usuario) {
      wh.push(`e.usuario_nome ILIKE $${idx}`);
      p.push(`%${usuario}%`);
      idx += 1;
    }
    if (de) {
      wh.push(`e.ocorrido_em >= $${idx}::timestamptz`);
      p.push(de.includes('T') ? de : `${de}T00:00:00`);
      idx += 1;
    }
    if (ate) {
      wh.push(`e.ocorrido_em <= $${idx}::timestamptz`);
      p.push(ate.includes('T') ? ate : `${ate}T23:59:59.999`);
      idx += 1;
    }

    p.push(limit);
    const { rows: eventos } = await dbQuery(
      `SELECT e.id, e.sessao_id, e.ocorrido_em, e.categoria, e.acao,
              e.codigo_produto, e.codigo_produto_omie, e.n_solic,
              e.usuario_id, e.usuario_nome, e.sucesso, e.detalhe,
              e.rota, e.metodo_http,
              s.tipo AS sessao_tipo, s.origem AS sessao_origem,
              s.iniciado_em AS sessao_iniciado_em, s.finalizado_em AS sessao_finalizado_em,
              s.descricao_produto AS sessao_descricao
         FROM monitoramento.eventos e
         LEFT JOIN monitoramento.sessoes s ON s.id = e.sessao_id
        WHERE ${wh.join(' AND ')}
        ORDER BY e.ocorrido_em DESC, e.id DESC
        LIMIT $${idx}`,
      p
    );

    // Sessões do mesmo filtro (para cabeçalho início/fim)
    const whS = [];
    const pS = [];
    let j = 1;
    if (codigo) {
      whS.push(`(codigo_produto ILIKE $${j} OR TRIM(COALESCE(codigo_produto_omie,'')) = $${j})`);
      pS.push(codigo);
      j += 1;
    }
    if (nSolic) {
      whS.push(`n_solic ILIKE $${j}`);
      pS.push(nSolic);
      j += 1;
    }
    if (usuario) {
      whS.push(`usuario_nome ILIKE $${j}`);
      pS.push(`%${usuario}%`);
      j += 1;
    }
    if (de) {
      whS.push(`iniciado_em >= $${j}::timestamptz`);
      pS.push(de.includes('T') ? de : `${de}T00:00:00`);
      j += 1;
    }
    if (ate) {
      whS.push(`iniciado_em <= $${j}::timestamptz`);
      pS.push(ate.includes('T') ? ate : `${ate}T23:59:59.999`);
      j += 1;
    }
    pS.push(Math.min(100, limit));
    const { rows: sessoes } = await dbQuery(
      `SELECT id, tipo, codigo_produto, codigo_produto_omie, descricao_produto, n_solic,
              usuario_id, usuario_nome, origem, iniciado_em, finalizado_em, meta
         FROM monitoramento.sessoes
        WHERE ${whS.length ? whS.join(' AND ') : 'TRUE'}
        ORDER BY iniciado_em DESC
        LIMIT $${j}`,
      pS
    );

    res.json({
      ok: true,
      filtros: { codigo, n_solic: nSolic, usuario, de, ate, limit },
      total_eventos: eventos.length,
      total_sessoes: sessoes.length,
      sessoes,
      eventos
    });
  } catch (err) {
    console.error('[monitoramento] GET /cronologia', err);
    res.status(500).json({ ok: false, error: err.message || 'Erro ao consultar cronologia.' });
  }
});

module.exports = router;
