/**
 * Persistência do Chatbot Cloud Agent (intranet + celular).
 * Schema: ia_cursor
 */
'use strict';

const { pool } = require('../src/db');
const { uploadPublicFile, removePublicFiles, buildPublicUrl } = require('../utils/storage');

let ensurePromise = null;

async function ensureIaCursorSchema() {
  if (!pool) throw new Error('DATABASE_URL não configurada.');
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ia_cursor`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ia_cursor.conversations (
        id              BIGSERIAL PRIMARY KEY,
        user_id         INTEGER,
        username        TEXT,
        title           TEXT,
        cursor_agent_id TEXT UNIQUE,
        status          TEXT NOT NULL DEFAULT 'active',
        branch          TEXT,
        pr_url          TEXT,
        pr_number       INTEGER,
        agent_url       TEXT,
        specialist_id   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ia_cursor.messages (
        id               BIGSERIAL PRIMARY KEY,
        conversation_id  BIGINT NOT NULL REFERENCES ia_cursor.conversations(id) ON DELETE CASCADE,
        role             TEXT NOT NULL,
        content          TEXT NOT NULL DEFAULT '',
        specialist_id    TEXT,
        cursor_run_id    TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ia_cursor.attachments (
        id           BIGSERIAL PRIMARY KEY,
        message_id   BIGINT NOT NULL REFERENCES ia_cursor.messages(id) ON DELETE CASCADE,
        r2_path      TEXT NOT NULL,
        public_url   TEXT NOT NULL,
        mime_type    TEXT,
        bytes        INTEGER,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ia_cursor_conv_user_idx
        ON ia_cursor.conversations (user_id, updated_at DESC)
        WHERE deleted_at IS NULL
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ia_cursor_msg_conv_idx
        ON ia_cursor.messages (conversation_id, id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ia_cursor_msg_assistant_idx
        ON ia_cursor.messages (conversation_id, created_at DESC)
        WHERE role = 'assistant'
    `);
    // colunas novas em bases já criadas
    await pool.query(`ALTER TABLE ia_cursor.conversations ADD COLUMN IF NOT EXISTS specialist_id TEXT`);
    await pool.query(`ALTER TABLE ia_cursor.messages ADD COLUMN IF NOT EXISTS specialist_id TEXT`);
    await pool.query(`ALTER TABLE ia_cursor.messages ADD COLUMN IF NOT EXISTS favorited_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE ia_cursor.conversations ADD COLUMN IF NOT EXISTS routing_meta JSONB`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS ia_cursor_msg_fav_idx
        ON ia_cursor.messages (favorited_at DESC)
        WHERE favorited_at IS NOT NULL
    `);
  })().catch((err) => {
    ensurePromise = null;
    throw err;
  });
  return ensurePromise;
}

async function listConversations({ userId, limit = 40 } = {}) {
  await ensureIaCursorSchema();
  // Posição no histórico = última resposta da IA (assistant), não o início da conversa.
  // Sem resposta ainda: cai em updated_at (ex.: run em andamento).
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.cursor_agent_id, c.status, c.branch, c.pr_url, c.pr_number, c.agent_url,
            c.specialist_id, c.routing_meta, c.created_at, c.updated_at,
            la.last_assistant_at
       FROM ia_cursor.conversations c
       LEFT JOIN LATERAL (
         SELECT MAX(m.created_at) AS last_assistant_at
           FROM ia_cursor.messages m
          WHERE m.conversation_id = c.id
            AND m.role = 'assistant'
       ) la ON TRUE
      WHERE c.deleted_at IS NULL
        AND ($1::int IS NULL OR c.user_id = $1)
      ORDER BY COALESCE(la.last_assistant_at, c.updated_at, c.created_at) DESC
      LIMIT $2`,
    [userId || null, Math.min(Number(limit) || 40, 100)]
  );
  // API usa updated_at na lista — espelha a última resposta da IA para ordenação/exibição
  return rows.map((r) => ({
    ...r,
    updated_at: r.last_assistant_at || r.updated_at,
  }));
}

async function getConversation(id) {
  await ensureIaCursorSchema();
  const { rows } = await pool.query(
    `SELECT * FROM ia_cursor.conversations WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] || null;
}

async function getConversationByAgentId(agentId) {
  await ensureIaCursorSchema();
  const { rows } = await pool.query(
    `SELECT * FROM ia_cursor.conversations
      WHERE cursor_agent_id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [agentId]
  );
  return rows[0] || null;
}

async function createConversation({ userId, username, title }) {
  await ensureIaCursorSchema();
  const { rows } = await pool.query(
    `INSERT INTO ia_cursor.conversations (user_id, username, title)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId || null, username || null, title || 'Nova conversa']
  );
  return rows[0];
}

async function touchConversation(id, patch = {}) {
  await ensureIaCursorSchema();
  const { rows } = await pool.query(
    `UPDATE ia_cursor.conversations SET
        title = COALESCE($2, title),
        cursor_agent_id = COALESCE($3, cursor_agent_id),
        status = COALESCE($4, status),
        branch = COALESCE($5, branch),
        pr_url = COALESCE($6, pr_url),
        pr_number = COALESCE($7, pr_number),
        agent_url = COALESCE($8, agent_url),
        specialist_id = COALESCE($9, specialist_id),
        routing_meta = COALESCE($10::jsonb, routing_meta),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      id,
      patch.title ?? null,
      patch.cursor_agent_id ?? null,
      patch.status ?? null,
      patch.branch ?? null,
      patch.pr_url ?? null,
      patch.pr_number ?? null,
      patch.agent_url ?? null,
      patch.specialist_id ?? null,
      patch.routing_meta != null ? JSON.stringify(patch.routing_meta) : null,
    ]
  );
  return rows[0] || null;
}

async function addMessage({ conversationId, role, content, cursorRunId = null, specialistId = null }) {
  await ensureIaCursorSchema();
  const { rows } = await pool.query(
    `INSERT INTO ia_cursor.messages (conversation_id, role, content, cursor_run_id, specialist_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [conversationId, role, content || '', cursorRunId, specialistId]
  );
  await pool.query(
    `UPDATE ia_cursor.conversations SET updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );
  return rows[0];
}

async function listMessages(conversationId) {
  await ensureIaCursorSchema();
  const { rows: messages } = await pool.query(
    `SELECT id, role, content, specialist_id, cursor_run_id, created_at, favorited_at
       FROM ia_cursor.messages
      WHERE conversation_id = $1
      ORDER BY id ASC`,
    [conversationId]
  );
  if (!messages.length) return [];
  const ids = messages.map((m) => m.id);
  const { rows: atts } = await pool.query(
    `SELECT id, message_id, r2_path, public_url, mime_type, bytes
       FROM ia_cursor.attachments
      WHERE message_id = ANY($1::bigint[])
      ORDER BY id ASC`,
    [ids]
  );
  const byMsg = new Map();
  for (const a of atts) {
    if (!byMsg.has(a.message_id)) byMsg.set(a.message_id, []);
    byMsg.get(a.message_id).push({
      id: a.id,
      url: a.public_url,
      mimeType: a.mime_type,
      bytes: a.bytes,
    });
  }
  return messages.map((m) => ({
    ...m,
    favorited: Boolean(m.favorited_at),
    attachments: byMsg.get(m.id) || [],
  }));
}

async function setMessageFavorite(messageId, favorite) {
  await ensureIaCursorSchema();
  const { rows } = await pool.query(
    `UPDATE ia_cursor.messages
        SET favorited_at = CASE
          WHEN $2 THEN COALESCE(favorited_at, NOW())
          ELSE NULL
        END
      WHERE id = $1
      RETURNING id, conversation_id, role, content, created_at, favorited_at`,
    [Number(messageId), Boolean(favorite)]
  );
  const row = rows[0] || null;
  if (!row) return null;
  return { ...row, favorited: Boolean(row.favorited_at) };
}

async function listFavoriteMessages({ userId, limit = 50 } = {}) {
  await ensureIaCursorSchema();
  const { rows } = await pool.query(
    `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, m.favorited_at,
            c.title AS conversation_title
       FROM ia_cursor.messages m
       JOIN ia_cursor.conversations c ON c.id = m.conversation_id
      WHERE m.favorited_at IS NOT NULL
        AND c.deleted_at IS NULL
        AND ($1::int IS NULL OR c.user_id = $1)
      ORDER BY m.favorited_at DESC
      LIMIT $2`,
    [userId || null, Math.min(Number(limit) || 50, 100)]
  );
  return rows.map((r) => ({
    ...r,
    favorited: true,
  }));
}

async function saveAttachmentsForMessage(messageId, conversationId, images = []) {
  await ensureIaCursorSchema();
  const saved = [];
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    const mime = String(img.mimeType || 'image/png').toLowerCase();
    const ext = mime.includes('jpeg') || mime.includes('jpg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : mime.includes('gif')
          ? 'gif'
          : 'png';
    const buf = Buffer.from(String(img.data || '').replace(/\s/g, ''), 'base64');
    if (!buf.length) continue;
    const filePath = `${conversationId}/${messageId}-${Date.now()}-${i}.${ext}`;
    const uploaded = await uploadPublicFile('ia-cursor', filePath, buf, {
      contentType: mime,
      upsert: true,
    });
    const { rows } = await pool.query(
      `INSERT INTO ia_cursor.attachments (message_id, r2_path, public_url, mime_type, bytes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [messageId, uploaded.path, uploaded.url, mime, buf.length]
    );
    saved.push({
      id: rows[0].id,
      url: rows[0].public_url,
      mimeType: rows[0].mime_type,
      path: rows[0].r2_path,
    });
  }
  return saved;
}

async function deleteConversation(id) {
  await ensureIaCursorSchema();
  const { rows: atts } = await pool.query(
    `SELECT a.r2_path
       FROM ia_cursor.attachments a
       JOIN ia_cursor.messages m ON m.id = a.message_id
      WHERE m.conversation_id = $1`,
    [id]
  );
  const paths = atts.map((a) => a.r2_path).filter(Boolean);
  if (paths.length) {
    try {
      await removePublicFiles('ia-cursor', paths);
    } catch (e) {
      console.warn('[ia_cursor] falha ao limpar R2:', e.message);
    }
  }
  await pool.query(
    `UPDATE ia_cursor.conversations
        SET deleted_at = NOW(), status = 'deleted', updated_at = NOW()
      WHERE id = $1`,
    [id]
  );
  // limpa mensagens/anexos de fato
  await pool.query(`DELETE FROM ia_cursor.messages WHERE conversation_id = $1`, [id]);
  return { ok: true };
}

module.exports = {
  ensureIaCursorSchema,
  listConversations,
  getConversation,
  getConversationByAgentId,
  createConversation,
  touchConversation,
  addMessage,
  listMessages,
  listFavoriteMessages,
  setMessageFavorite,
  saveAttachmentsForMessage,
  deleteConversation,
  buildPublicUrl,
};
