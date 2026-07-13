/**
 * utils/monitoramento.js
 * Auditoria de sessões e eventos (modal Movimentação + SEP).
 * Nunca lança para o caller — falha só em log.
 */
const crypto = require('crypto');
const { dbQuery, isDbEnabled } = require('../src/db');

let _schemaReady = false;
let _schemaPromise = null;

function novoId() {
  return crypto.randomUUID();
}

function usuarioDeReq(req) {
  const u = req?.session?.user || {};
  return {
    usuario_id: u.id != null ? String(u.id) : null,
    usuario_nome: String(u.username || u.nome || u.fullName || u.login || '').trim() || null
  };
}

async function ensureMonitoramentoSchema() {
  if (_schemaReady) return;
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    if (!isDbEnabled) return;
    await dbQuery(`CREATE SCHEMA IF NOT EXISTS monitoramento`);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS monitoramento.sessoes (
        id UUID PRIMARY KEY,
        tipo TEXT NOT NULL,
        codigo_produto TEXT,
        codigo_produto_omie TEXT,
        descricao_produto TEXT,
        n_solic TEXT,
        usuario_id TEXT,
        usuario_nome TEXT,
        origem TEXT,
        iniciado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finalizado_em TIMESTAMPTZ,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS monitoramento.eventos (
        id BIGSERIAL PRIMARY KEY,
        sessao_id UUID REFERENCES monitoramento.sessoes(id) ON DELETE SET NULL,
        ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        categoria TEXT NOT NULL,
        acao TEXT NOT NULL,
        codigo_produto TEXT,
        codigo_produto_omie TEXT,
        n_solic TEXT,
        usuario_id TEXT,
        usuario_nome TEXT,
        sucesso BOOLEAN,
        detalhe JSONB NOT NULL DEFAULT '{}'::jsonb,
        rota TEXT,
        metodo_http TEXT
      )
    `);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_mon_sessoes_codigo ON monitoramento.sessoes (codigo_produto, iniciado_em DESC)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_mon_sessoes_n_solic ON monitoramento.sessoes (n_solic)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_mon_eventos_codigo ON monitoramento.eventos (codigo_produto, ocorrido_em DESC)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_mon_eventos_sessao ON monitoramento.eventos (sessao_id, ocorrido_em)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_mon_eventos_n_solic ON monitoramento.eventos (n_solic, ocorrido_em DESC)`);
    await dbQuery(`CREATE INDEX IF NOT EXISTS idx_mon_eventos_usuario ON monitoramento.eventos (usuario_nome, ocorrido_em DESC)`);
    _schemaReady = true;
  })().catch((err) => {
    _schemaPromise = null;
    console.error('[monitoramento] ensureSchema:', err?.message || err);
    throw err;
  });
  return _schemaPromise;
}

async function iniciarSessao(opts = {}) {
  try {
    if (!isDbEnabled) return null;
    await ensureMonitoramentoSchema();
    const id = opts.id || novoId();
    const tipo = String(opts.tipo || 'OUTRO').toUpperCase();
    await dbQuery(
      `INSERT INTO monitoramento.sessoes
         (id, tipo, codigo_produto, codigo_produto_omie, descricao_produto, n_solic,
          usuario_id, usuario_nome, origem, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::jsonb,'{}'::jsonb))`,
      [
        id,
        tipo,
        opts.codigo_produto != null ? String(opts.codigo_produto).trim() : null,
        opts.codigo_produto_omie != null ? String(opts.codigo_produto_omie).trim() : null,
        opts.descricao_produto != null ? String(opts.descricao_produto).trim() : null,
        opts.n_solic != null ? String(opts.n_solic).trim() : null,
        opts.usuario_id != null ? String(opts.usuario_id) : null,
        opts.usuario_nome != null ? String(opts.usuario_nome).trim() : null,
        opts.origem != null ? String(opts.origem).trim() : null,
        JSON.stringify(opts.meta || {})
      ]
    );
    return id;
  } catch (err) {
    console.error('[monitoramento] iniciarSessao:', err?.message || err);
    return null;
  }
}

async function finalizarSessao(sessaoId, metaExtra = null) {
  try {
    if (!isDbEnabled || !sessaoId) return false;
    await ensureMonitoramentoSchema();
    if (metaExtra && typeof metaExtra === 'object') {
      await dbQuery(
        `UPDATE monitoramento.sessoes
            SET finalizado_em = NOW(),
                meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb
          WHERE id = $1::uuid AND finalizado_em IS NULL`,
        [sessaoId, JSON.stringify(metaExtra)]
      );
    } else {
      await dbQuery(
        `UPDATE monitoramento.sessoes
            SET finalizado_em = NOW()
          WHERE id = $1::uuid AND finalizado_em IS NULL`,
        [sessaoId]
      );
    }
    return true;
  } catch (err) {
    console.error('[monitoramento] finalizarSessao:', err?.message || err);
    return false;
  }
}

/**
 * Registra evento de auditoria. Nunca propaga erro.
 * @returns {Promise<number|null>} id do evento
 */
async function registrarEvento(opts = {}) {
  try {
    if (!isDbEnabled) return null;
    await ensureMonitoramentoSchema();
    const categoria = String(opts.categoria || 'SISTEMA').toUpperCase();
    const acao = String(opts.acao || '').trim();
    if (!acao) return null;

    const { rows } = await dbQuery(
      `INSERT INTO monitoramento.eventos
         (sessao_id, categoria, acao, codigo_produto, codigo_produto_omie, n_solic,
          usuario_id, usuario_nome, sucesso, detalhe, rota, metodo_http)
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::jsonb,'{}'::jsonb),$11,$12)
       RETURNING id`,
      [
        opts.sessao_id || null,
        categoria,
        acao,
        opts.codigo_produto != null ? String(opts.codigo_produto).trim() : null,
        opts.codigo_produto_omie != null ? String(opts.codigo_produto_omie).trim() : null,
        opts.n_solic != null ? String(opts.n_solic).trim() : null,
        opts.usuario_id != null ? String(opts.usuario_id) : null,
        opts.usuario_nome != null ? String(opts.usuario_nome).trim() : null,
        typeof opts.sucesso === 'boolean' ? opts.sucesso : null,
        JSON.stringify(opts.detalhe || {}),
        opts.rota != null ? String(opts.rota) : null,
        opts.metodo_http != null ? String(opts.metodo_http) : null
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[monitoramento] registrarEvento:', err?.message || err);
    return null;
  }
}

/** Atalho: evento API a partir de req Express */
async function registrarEventoReq(req, opts = {}) {
  const user = usuarioDeReq(req);
  return registrarEvento({
    ...opts,
    usuario_id: opts.usuario_id != null ? opts.usuario_id : user.usuario_id,
    usuario_nome: opts.usuario_nome != null ? opts.usuario_nome : user.usuario_nome,
    rota: opts.rota != null ? opts.rota : (req?.originalUrl || req?.url || null),
    metodo_http: opts.metodo_http != null ? opts.metodo_http : (req?.method || null),
    categoria: opts.categoria || 'API'
  });
}

module.exports = {
  novoId,
  usuarioDeReq,
  ensureMonitoramentoSchema,
  iniciarSessao,
  finalizarSessao,
  registrarEvento,
  registrarEventoReq
};
