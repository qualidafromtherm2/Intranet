'use strict';

/**
 * Preferências de notificação por usuário (WhatsApp / e-mail).
 *
 * Tabela: usuario.notificacao_preferencias
 * Ausência de linha = desligado (opt-in estrito).
 */

const { dbQuery } = require('../src/db');

const CANAIS = Object.freeze(['whatsapp', 'email']);

/** Catálogo de tipos configuráveis na tela do usuário. */
const TIPOS_NOTIFICACAO = Object.freeze([
  {
    id: 'reuniao_nova',
    rotulo: 'Nova reunião agendada',
    grupo: 'Reuniões',
    canais: ['whatsapp', 'email'],
  },
  {
    id: 'reuniao_cancelada',
    rotulo: 'Reunião cancelada',
    grupo: 'Reuniões',
    canais: ['whatsapp'],
  },
  {
    id: 'reuniao_lembrete',
    rotulo: 'Lembrete de reunião (no dia)',
    grupo: 'Reuniões',
    canais: ['email'],
  },
  {
    id: 'pir_novo_item',
    rotulo: 'PIR — novo item na lista',
    grupo: 'Qualidade / PIR',
    canais: ['whatsapp'],
  },
  {
    id: 'ri_check',
    rotulo: 'RI Check — atualização',
    grupo: 'Qualidade / PIR',
    canais: ['whatsapp'],
  },
  {
    id: 'op_tempo_posto',
    rotulo: 'OP — registro de tempo no posto',
    grupo: 'Produção / OP',
    canais: ['whatsapp'],
  },
  {
    id: 'op_transicao_posto',
    rotulo: 'OP — mudança de posto',
    grupo: 'Produção / OP',
    canais: ['whatsapp'],
  },
  {
    id: 'ocorrencia_nova',
    rotulo: 'Ocorrência — falha detectada',
    grupo: 'Produção / OP',
    canais: ['whatsapp'],
  },
  {
    id: 'ocorrencia_corrigida',
    rotulo: 'Ocorrência — falha corrigida',
    grupo: 'Produção / OP',
    canais: ['whatsapp'],
  },
  {
    id: 'compras_requisicao',
    rotulo: 'Nova requisição de compras',
    grupo: 'Compras',
    canais: ['email'],
  },
  {
    id: 'resumo_diario',
    rotulo: 'Resumo diário (agenda)',
    grupo: 'Geral',
    canais: ['whatsapp'],
  },
]);

const TIPOS_POR_ID = Object.freeze(
  Object.fromEntries(TIPOS_NOTIFICACAO.map((t) => [t.id, t]))
);

let schemaOk = false;

async function ensureSchema() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS usuario`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS usuario.notificacao_preferencias (
      user_id     BIGINT NOT NULL,
      tipo        TEXT NOT NULL,
      canal       TEXT NOT NULL,
      habilitado  BOOLEAN NOT NULL DEFAULT false,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, tipo, canal)
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_notif_pref_user
      ON usuario.notificacao_preferencias (user_id)
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_notif_pref_tipo_canal
      ON usuario.notificacao_preferencias (tipo, canal)
      WHERE habilitado = true
  `);
  schemaOk = true;
}

function normalizarTipo(tipo) {
  return String(tipo || '').trim().toLowerCase();
}

function normalizarCanal(canal) {
  const c = String(canal || '').trim().toLowerCase();
  return CANAIS.includes(c) ? c : '';
}

function tipoValido(tipo, canal) {
  const t = TIPOS_POR_ID[tipo];
  if (!t) return false;
  if (!canal) return true;
  return t.canais.includes(canal);
}

/**
 * Opt-in estrito: ausência de linha = desligado.
 */
async function usuarioAceita(userId, tipo, canal) {
  const uid = Number(userId);
  const t = normalizarTipo(tipo);
  const c = normalizarCanal(canal);
  if (!Number.isFinite(uid) || uid <= 0 || !tipoValido(t, c)) return false;

  await ensureSchema();
  const { rows } = await dbQuery(
    `SELECT 1
       FROM usuario.notificacao_preferencias
      WHERE user_id = $1
        AND tipo = $2
        AND canal = $3
        AND habilitado = true
      LIMIT 1`,
    [uid, t, c]
  );
  return rows.length > 0;
}

/**
 * Filtra uma lista de user_ids (ou objetos com .id / .user_id) pelos que
 * aceitam o tipo+canal. Mantém a forma original dos itens.
 */
async function filtrarUsuarios(userIdsOuObjs, tipo, canal) {
  const t = normalizarTipo(tipo);
  const c = normalizarCanal(canal);
  if (!tipoValido(t, c)) return [];

  const lista = Array.isArray(userIdsOuObjs) ? userIdsOuObjs : [];
  if (!lista.length) return [];

  const ids = [];
  const mapa = new Map(); // id -> itens originais
  for (const item of lista) {
    const id = Number(
      typeof item === 'object' && item != null
        ? (item.user_id ?? item.id ?? item.userId)
        : item
    );
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!mapa.has(id)) {
      mapa.set(id, []);
      ids.push(id);
    }
    mapa.get(id).push(item);
  }
  if (!ids.length) return [];

  await ensureSchema();
  const { rows } = await dbQuery(
    `SELECT user_id
       FROM usuario.notificacao_preferencias
      WHERE user_id = ANY($1::bigint[])
        AND tipo = $2
        AND canal = $3
        AND habilitado = true`,
    [ids, t, c]
  );

  const aceitos = new Set(rows.map((r) => Number(r.user_id)));
  const out = [];
  for (const id of ids) {
    if (!aceitos.has(id)) continue;
    out.push(...mapa.get(id));
  }
  return out;
}

/**
 * Usuários ativos com a preferência ligada.
 * Destinatários de devolução NÃO usam isto — eles vêm de auth_user.email_devolucao.
 */
async function listarUsuariosHabilitados(tipo, canal, { exigirTelefone = false, exigirEmail = false } = {}) {
  const t = normalizarTipo(tipo);
  const c = normalizarCanal(canal);
  if (!tipoValido(t, c)) return [];

  await ensureSchema();
  const cond = [
    'p.habilitado = true',
    'p.tipo = $1',
    'p.canal = $2',
    'u.is_active IS DISTINCT FROM false',
  ];
  if (exigirTelefone) {
    cond.push(`u.telefone_contato IS NOT NULL AND TRIM(u.telefone_contato) <> ''`);
  }
  if (exigirEmail) {
    cond.push(`u.email IS NOT NULL AND TRIM(u.email) <> ''`);
  }

  const { rows } = await dbQuery(
    `SELECT u.id, u.username, u.nome_completo, u.email, u.telefone_contato
       FROM usuario.notificacao_preferencias p
       JOIN public.auth_user u ON u.id = p.user_id
      WHERE ${cond.join(' AND ')}`,
    [t, c]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    user_id: Number(r.id),
    username: r.username,
    nome_completo: r.nome_completo,
    email: r.email,
    telefone_contato: r.telefone_contato,
  }));
}

async function getPreferencias(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { tipos: TIPOS_NOTIFICACAO, preferencias: [] };
  }
  await ensureSchema();
  const { rows } = await dbQuery(
    `SELECT tipo, canal, habilitado
       FROM usuario.notificacao_preferencias
      WHERE user_id = $1`,
    [uid]
  );
  return {
    tipos: TIPOS_NOTIFICACAO,
    preferencias: rows.map((r) => ({
      tipo: r.tipo,
      canal: r.canal,
      habilitado: r.habilitado === true,
    })),
  };
}

/**
 * lista = [{ tipo, canal, habilitado }, ...]
 * Só persiste combinações válidas do catálogo.
 */
async function setPreferencias(userId, lista) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) {
    throw new Error('user_id inválido');
  }
  await ensureSchema();

  const itens = Array.isArray(lista) ? lista : [];
  const validos = [];
  for (const item of itens) {
    const tipo = normalizarTipo(item?.tipo);
    const canal = normalizarCanal(item?.canal);
    if (!tipoValido(tipo, canal)) continue;
    validos.push({
      tipo,
      canal,
      habilitado: item?.habilitado === true || item?.habilitado === 'true' || item?.habilitado === 1,
    });
  }

  // Upsert de todas as combinações do catálogo presentes no payload;
  // se o front enviar o catálogo completo, fica sincronizado.
  for (const v of validos) {
    await dbQuery(
      `INSERT INTO usuario.notificacao_preferencias (user_id, tipo, canal, habilitado, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, tipo, canal) DO UPDATE
         SET habilitado = EXCLUDED.habilitado,
             updated_at = NOW()`,
      [uid, v.tipo, v.canal, v.habilitado]
    );
  }

  return getPreferencias(uid);
}

module.exports = {
  CANAIS,
  TIPOS_NOTIFICACAO,
  TIPOS_POR_ID,
  ensureSchema,
  usuarioAceita,
  filtrarUsuarios,
  listarUsuariosHabilitados,
  getPreferencias,
  setPreferencias,
};
