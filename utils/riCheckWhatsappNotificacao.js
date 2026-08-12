'use strict';

const { dbQuery } = require('../src/db');
const {
  toWhatsappPhone,
  getWhatsappPhoneNumberId,
  whatsappConfigurado,
  enviarWhatsappNotificacao,
} = require('./whatsappEnvio');
const { filtrarUsuarios } = require('./notificacaoPreferencias');

const TAG = '[WhatsApp Notif]';

let schemaOk = false;

async function garantirSchemaWhatsConfig() {
  if (schemaOk) return;
  await dbQuery(`CREATE SCHEMA IF NOT EXISTS qualidade`);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS qualidade."RI_WhatsConfig" (
      id                BIGSERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL,
      username          TEXT,
      telefone_whatsapp TEXT,
      ativo             BOOLEAN NOT NULL DEFAULT true,
      permissao_op      BOOLEAN NOT NULL DEFAULT false,
      permissao_ri      BOOLEAN NOT NULL DEFAULT false,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id)
    )
  `);
  await dbQuery(`ALTER TABLE qualidade."RI_WhatsConfig" ADD COLUMN IF NOT EXISTS permissao_op BOOLEAN NOT NULL DEFAULT false`);
  await dbQuery(`ALTER TABLE qualidade."RI_WhatsConfig" ADD COLUMN IF NOT EXISTS permissao_ri BOOLEAN NOT NULL DEFAULT false`);
  // Telefone passou para auth_user.telefone_contato — coluna legada pode ser nula
  await dbQuery(`
    ALTER TABLE qualidade."RI_WhatsConfig"
      ALTER COLUMN telefone_whatsapp DROP NOT NULL
  `).catch(() => {});
  await dbQuery(`
    UPDATE public.auth_user u
       SET telefone_contato = c.telefone_whatsapp
      FROM qualidade."RI_WhatsConfig" c
     WHERE c.user_id = u.id
       AND c.telefone_whatsapp IS NOT NULL
       AND TRIM(c.telefone_whatsapp) <> ''
       AND (u.telefone_contato IS NULL OR TRIM(u.telefone_contato) = '')
  `).catch(() => {});
  await dbQuery(`
    UPDATE qualidade."RI_WhatsConfig"
       SET permissao_ri = true
     WHERE permissao_ri = false AND ativo = true
  `).catch(() => {});
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_whats_config_perm_op
      ON qualidade."RI_WhatsConfig" (permissao_op)
      WHERE permissao_op = true
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS idx_ri_whats_config_perm_ri
      ON qualidade."RI_WhatsConfig" (permissao_ri)
      WHERE permissao_ri = true
  `);
  schemaOk = true;
}

function formatarDataHoraBr(val) {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return String(val);
  }
}

function montarMensagemRiCheck(check) {
  return [
    '*RI Check — atualização*',
    '',
    `OP Produção: ${check?.op_producao_id ?? '—'}`,
    `Código: ${check?.codigo ?? '—'}`,
    `Status: ${check?.status ?? '—'}`,
    `Atualizado em: ${formatarDataHoraBr(check?.updated_at)}`,
  ].join('\n');
}

function montarMensagemRegistroTempo(reg) {
  return [
    '*Registro de tempo — OP*',
    '',
    `Número OP: ${reg?.numero_op ?? '—'}`,
    `Posto: ${reg?.posto_origem ?? '—'}`,
    `Tipo: ${reg?.tipo_registro ?? '—'}`,
    `Início: ${formatarDataHoraBr(reg?.inicio)}`,
    `Fim: ${formatarDataHoraBr(reg?.fim)}`,
    `Usuário fim: ${reg?.usuario_fim ?? '—'}`,
  ].join('\n');
}

function montarMensagemOcorrencia({ tipo, numeroOp, codigo, falha, usuario, dataHora }) {
  const corrigida = tipo === 'corrigida';
  return [
    corrigida ? '*Ocorrência — falha corrigida*' : '*Ocorrência — falha detectada*',
    '',
    `Número OP: ${numeroOp ?? '—'}`,
    `Código: ${codigo ?? '—'}`,
    `Falha: ${falha || '—'}`,
    corrigida
      ? `Liberada por: ${usuario ?? '—'}`
      : `Registrado por: ${usuario ?? '—'}`,
    `Data: ${formatarDataHoraBr(dataHora)}`,
  ].join('\n');
}

function montarMensagemTransicaoPosto({ numeroOp, postoDe, postoPara, inicio, fim, usuarioFim }) {
  const de = String(postoDe || '').trim();
  const para = String(postoPara || '').trim();
  const linhaPosto = de && para && de !== para
    ? `Posto: De ${de} para: ${para}`
    : `Posto: ${para || de || '—'}`;

  return [
    '*Registro de tempo — OP*',
    '',
    `Número OP: ${numeroOp ?? '—'}`,
    linhaPosto,
    'Tipo: posto',
    `Início: ${formatarDataHoraBr(inicio)}`,
    `Fim: ${formatarDataHoraBr(fim)}`,
    `Usuário fim: ${usuarioFim ?? '—'}`,
  ].join('\n');
}

async function listarDestinatariosOpOuRi() {
  const [op, ri] = await Promise.all([
    listarDestinatariosPorPermissao('permissao_op'),
    listarDestinatariosPorPermissao('permissao_ri'),
  ]);
  const seen = new Set();
  const out = [];
  for (const dest of [...op, ...ri]) {
    const key = String(dest.user_id || dest.telefone_contato || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(dest);
  }
  return out;
}

async function listarDestinatariosPorPermissao(campoPermissao) {
  await garantirSchemaWhatsConfig();
  const campo = campoPermissao === 'permissao_op' ? 'permissao_op' : 'permissao_ri';
  const { rows } = await dbQuery(
    `SELECT c.user_id, c.username, u.telefone_contato
       FROM qualidade."RI_WhatsConfig" c
       JOIN public.auth_user u ON u.id = c.user_id
      WHERE c.${campo} = true
        AND u.telefone_contato IS NOT NULL
        AND TRIM(u.telefone_contato) <> ''`
  );
  return rows;
}

async function enviarParaDestinatarios(destinatarios, mensagem, tipoPreferencia) {
  let lista = Array.isArray(destinatarios) ? destinatarios : [];
  if (tipoPreferencia) {
    lista = await filtrarUsuarios(lista, tipoPreferencia, 'whatsapp');
  }
  if (!lista.length) return;

  const phoneNumberId = await getWhatsappPhoneNumberId();
  if (!phoneNumberId) {
    console.log(TAG, 'Phone Number ID não encontrado — notificação ignorada.');
    return;
  }

  const telefonesEnviados = new Set();
  for (const dest of lista) {
    try {
      const phone = toWhatsappPhone(dest.telefone_contato);
      if (!phone) {
        console.log(TAG, `Telefone inválido para ${dest.username || dest.user_id}`);
        continue;
      }
      if (telefonesEnviados.has(phone)) continue;

      const result = await enviarWhatsappNotificacao(dest.telefone_contato, mensagem, phoneNumberId);
      const chave = result?.wa_id || phone;
      telefonesEnviados.add(chave);
      console.log(
        TAG,
        `Notificação enviada (${result?.modo || 'texto'}) para ${dest.username || dest.user_id}`
        + ` — wa_id=${result?.wa_id || phone}`
        + (result?.dentro_janela_24h === false ? ' [fora da janela 24h, via template]' : '')
      );
    } catch (err) {
      console.error(
        TAG,
        `Erro ao enviar para ${dest.username || dest.user_id}:`,
        err?.message || err
      );
    }
  }
}

async function notificarRiCheckWhatsappPorId(checkId) {
  const id = Number(checkId) || 0;
  if (!id || !whatsappConfigurado()) return;

  await garantirSchemaWhatsConfig();

  const { rows: checks } = await dbQuery(
    `SELECT id, op_producao_id, codigo, status, updated_at
       FROM qualidade."RI_Check"
      WHERE id = $1`,
    [id]
  );
  if (!checks.length) return;

  const destinatarios = await listarDestinatariosPorPermissao('permissao_ri');
  await enviarParaDestinatarios(destinatarios, montarMensagemRiCheck(checks[0]), 'ri_check');
}

async function notificarRegistroTempoWhatsappPorId(registroId) {
  const id = Number(registroId) || 0;
  if (!id || !whatsappConfigurado()) return;

  await garantirSchemaWhatsConfig();

  const { rows } = await dbQuery(
    `SELECT id, numero_op, posto_origem, tipo_registro,
            inicio, fim, usuario_fim
       FROM producao."Registro_tempo"
      WHERE id = $1 AND tipo_registro = 'posto'`,
    [id]
  );
  if (!rows.length) return;

  const destinatarios = await listarDestinatariosPorPermissao('permissao_op');
  await enviarParaDestinatarios(destinatarios, montarMensagemRegistroTempo(rows[0]), 'op_tempo_posto');
}

async function notificarTransicaoPostoWhatsapp({
  numeroOp,
  postoDe,
  postoPara,
  inicio,
  fim,
  usuarioFim,
}) {
  if (!whatsappConfigurado()) return;

  await garantirSchemaWhatsConfig();
  const destinatarios = await listarDestinatariosPorPermissao('permissao_op');
  const mensagem = montarMensagemTransicaoPosto({
    numeroOp,
    postoDe,
    postoPara,
    inicio,
    fim,
    usuarioFim,
  });
  await enviarParaDestinatarios(destinatarios, mensagem, 'op_transicao_posto');
}

async function notificarOcorrenciaWhatsapp({
  tipo,
  numeroOp,
  opId,
  codigo,
  falha,
  usuario,
  dataHora,
}) {
  if (!whatsappConfigurado()) return;

  await garantirSchemaWhatsConfig();

  let codigoFinal = String(codigo || '').trim();
  let numeroFinal = String(numeroOp || '').trim();
  const opRef = Number(opId) || 0;
  if (opRef && (!codigoFinal || !numeroFinal)) {
    try {
      const { rows } = await dbQuery(
        `SELECT n_op AS numero_op, codigo
           FROM producao."OP_producao"
          WHERE id = $1
          LIMIT 1`,
        [opRef]
      );
      if (rows[0]) {
        if (!numeroFinal) numeroFinal = String(rows[0].numero_op || '').trim();
        if (!codigoFinal) codigoFinal = String(rows[0].codigo || '').trim();
      }
    } catch (_) { /* silencioso */ }
  }

  const destinatarios = await listarDestinatariosOpOuRi();
  const mensagem = montarMensagemOcorrencia({
    tipo,
    numeroOp: numeroFinal || numeroOp,
    codigo: codigoFinal || codigo,
    falha,
    usuario,
    dataHora: dataHora || new Date(),
  });
  const tipoPref = tipo === 'corrigida' ? 'ocorrencia_corrigida' : 'ocorrencia_nova';
  await enviarParaDestinatarios(destinatarios, mensagem, tipoPref);
}

function dispararNotificacaoOcorrencia(dados) {
  if (!dados?.falha && !dados?.numeroOp && !dados?.opId) return;
  notificarOcorrenciaWhatsapp(dados).catch((err) => {
    console.error(TAG, err?.message || err);
  });
}

const RI_DEBOUNCE_MS = 3000;
const riCheckDebounceTimers = new Map();

function dispararNotificacaoRiCheck(checkId) {
  const id = Number(checkId) || 0;
  if (!id) return;

  if (riCheckDebounceTimers.has(id)) {
    clearTimeout(riCheckDebounceTimers.get(id));
  }

  const timer = setTimeout(() => {
    riCheckDebounceTimers.delete(id);
    notificarRiCheckWhatsappPorId(id).catch((err) => {
      console.error(TAG, err?.message || err);
    });
  }, RI_DEBOUNCE_MS);

  riCheckDebounceTimers.set(id, timer);
}

function dispararNotificacaoRegistroTempo(registroId) {
  if (!registroId) return;
  notificarRegistroTempoWhatsappPorId(registroId).catch((err) => {
    console.error(TAG, err?.message || err);
  });
}

function dispararNotificacaoTransicaoPosto(dados) {
  if (!dados?.postoDe && !dados?.postoPara) return;
  notificarTransicaoPostoWhatsapp(dados).catch((err) => {
    console.error(TAG, err?.message || err);
  });
}

async function obterConfigNotificacaoUsuario(userId) {
  await garantirSchemaWhatsConfig();
  const uid = Number(userId) || 0;
  if (!uid) return null;

  const { rows } = await dbQuery(
    `SELECT u.id AS user_id,
            u.username,
            u.telefone_contato,
            COALESCE(c.permissao_op, false) AS permissao_op,
            COALESCE(c.permissao_ri, false) AS permissao_ri,
            c.created_at::text AS created_at,
            c.updated_at::text AS updated_at
       FROM public.auth_user u
       LEFT JOIN qualidade."RI_WhatsConfig" c ON c.user_id = u.id
      WHERE u.id = $1`,
    [uid]
  );
  return rows[0] || null;
}

async function salvarConfigNotificacaoUsuario({
  userId,
  username,
  telefoneContato,
  permissaoOp,
  permissaoRi,
}) {
  await garantirSchemaWhatsConfig();
  const uid = Number(userId) || 0;
  if (!uid) throw new Error('Usuário inválido.');

  if (telefoneContato !== undefined) {
    const telefone = String(telefoneContato || '').trim();
    if (!telefone) throw new Error('Informe o número do WhatsApp.');
    const phone = toWhatsappPhone(telefone);
    if (!phone) throw new Error('Número de WhatsApp inválido.');
    await dbQuery(
      `UPDATE public.auth_user SET telefone_contato = $2 WHERE id = $1`,
      [uid, telefone]
    );
  }

  const atual = await obterConfigNotificacaoUsuario(uid);
  const opVal = permissaoOp !== undefined ? permissaoOp === true : (atual?.permissao_op === true);
  const riVal = permissaoRi !== undefined ? permissaoRi === true : (atual?.permissao_ri === true);

  const configTelefone = await obterConfigNotificacaoUsuario(uid);
  const telefoneWhatsapp = String(configTelefone?.telefone_contato || '').trim() || null;

  const { rows } = await dbQuery(
    `INSERT INTO qualidade."RI_WhatsConfig"
       (user_id, username, telefone_whatsapp, permissao_op, permissao_ri, ativo, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET username = EXCLUDED.username,
           telefone_whatsapp = COALESCE(EXCLUDED.telefone_whatsapp, qualidade."RI_WhatsConfig".telefone_whatsapp),
           permissao_op = EXCLUDED.permissao_op,
           permissao_ri = EXCLUDED.permissao_ri,
           ativo = (EXCLUDED.permissao_op OR EXCLUDED.permissao_ri),
           updated_at = NOW()
     RETURNING user_id, username, permissao_op, permissao_ri,
               created_at::text AS created_at,
               updated_at::text AS updated_at`,
    [uid, username || null, telefoneWhatsapp, opVal, riVal, opVal || riVal]
  );

  const config = await obterConfigNotificacaoUsuario(uid);
  return { ...rows[0], telefone_contato: config?.telefone_contato || null };
}

/** @deprecated use obterConfigNotificacaoUsuario */
async function obterConfigRiWhatsUsuario(userId) {
  const cfg = await obterConfigNotificacaoUsuario(userId);
  if (!cfg) return null;
  return {
    ...cfg,
    telefone_whatsapp: cfg.telefone_contato,
    ativo: cfg.permissao_ri === true,
  };
}

/** @deprecated use salvarConfigNotificacaoUsuario */
async function salvarConfigRiWhatsUsuario({ userId, username, telefoneWhatsapp, ativo }) {
  return salvarConfigNotificacaoUsuario({
    userId,
    username,
    telefoneContato: telefoneWhatsapp,
    permissaoRi: ativo !== false,
  });
}

module.exports = {
  garantirSchemaWhatsConfig,
  garantirSchemaRiWhatsConfig: garantirSchemaWhatsConfig,
  dispararNotificacaoRiCheck,
  dispararNotificacaoRegistroTempo,
  dispararNotificacaoTransicaoPosto,
  dispararNotificacaoOcorrencia,
  notificarRiCheckWhatsappPorId,
  notificarRegistroTempoWhatsappPorId,
  notificarTransicaoPostoWhatsapp,
  notificarOcorrenciaWhatsapp,
  obterConfigNotificacaoUsuario,
  salvarConfigNotificacaoUsuario,
  obterConfigRiWhatsUsuario,
  salvarConfigRiWhatsUsuario,
};
