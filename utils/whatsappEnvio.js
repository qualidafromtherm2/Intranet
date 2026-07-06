'use strict';

const { dbQuery } = require('../src/db');

const WHATSAPP_CLOUD_ACCESS_TOKEN = String(
  process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
  process.env.META_WHATSAPP_ACCESS_TOKEN || ''
).trim();
const WHATSAPP_GRAPH_API_VERSION = String(
  process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0'
).trim() || 'v25.0';
const WHATSAPP_DEFAULT_PHONE_NUMBER_ID = String(
  process.env.WHATSAPP_DEFAULT_PHONE_NUMBER_ID || ''
).trim();
const WHATSAPP_TEMPLATE_NOTIF = String(
  process.env.WHATSAPP_TEMPLATE_NOTIF ||
  process.env.WHATSAPP_TEMPLATE_NOTIF_NAME || ''
).trim();
const WHATSAPP_TEMPLATE_NOTIF_LANG = String(
  process.env.WHATSAPP_TEMPLATE_NOTIF_LANG || 'pt_BR'
).trim() || 'pt_BR';
const WHATSAPP_TEMPLATE_NOTIF_PARAM = String(
  process.env.WHATSAPP_TEMPLATE_NOTIF_PARAM || 'mensagem'
).trim() || 'mensagem';

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Gera variações do número (com/sem 9º dígito) — mesmo padrão do SAC */
function buildWhatsappPhoneCandidates(value) {
  const digits = normalizePhoneDigits(value);
  const out = new Set();
  if (!digits) return [];

  out.add(digits);

  if (digits.startsWith('55')) {
    if (digits.length === 12) {
      out.add(`${digits.slice(0, 4)}9${digits.slice(4)}`);
    }
    if (digits.length === 13 && digits[4] === '9') {
      out.add(`${digits.slice(0, 4)}${digits.slice(5)}`);
    }
  } else {
    if (digits.length === 10) out.add(`55${digits}`);
    if (digits.length === 11) {
      out.add(`55${digits}`);
      if (digits[2] === '9') out.add(`55${digits.slice(0, 2)}${digits.slice(3)}`);
    }
  }

  return Array.from(out);
}

/** Converte telefone brasileiro para formato internacional WhatsApp */
function toWhatsappPhone(telefone) {
  const candidates = buildWhatsappPhoneCandidates(telefone);
  return candidates[0] || null;
}

async function getWhatsappPhoneNumberId() {
  if (WHATSAPP_DEFAULT_PHONE_NUMBER_ID) return WHATSAPP_DEFAULT_PHONE_NUMBER_ID;
  try {
    const { rows } = await dbQuery(
      `SELECT phone_number_id FROM sac.whatsapp_webhook_messages
       WHERE phone_number_id IS NOT NULL AND direction = 'outbound'
       GROUP BY phone_number_id ORDER BY count(*) DESC LIMIT 1`
    );
    return rows[0]?.phone_number_id || null;
  } catch {
    return null;
  }
}

function whatsappConfigurado() {
  return Boolean(WHATSAPP_CLOUD_ACCESS_TOKEN);
}

async function resolverWaIdCanonico(telefone) {
  const candidates = buildWhatsappPhoneCandidates(telefone);
  if (!candidates.length) return [];

  try {
    const { rows } = await dbQuery(
      `SELECT from_phone_digits
         FROM sac.whatsapp_webhook_messages
        WHERE direction = 'inbound'
          AND from_phone_digits = ANY($1::text[])
        ORDER BY received_at DESC
        LIMIT 1`,
      [candidates]
    );
    if (rows[0]?.from_phone_digits) {
      const waId = rows[0].from_phone_digits;
      return [waId, ...candidates.filter((c) => c !== waId)];
    }
  } catch {
    /* tabela pode não existir em ambiente de teste */
  }

  return candidates;
}

async function usuarioDentroJanela24h(telefone) {
  const candidates = buildWhatsappPhoneCandidates(telefone);
  if (!candidates.length) return false;

  try {
    const { rows } = await dbQuery(
      `SELECT 1
         FROM sac.whatsapp_webhook_messages
        WHERE direction = 'inbound'
          AND from_phone_digits = ANY($1::text[])
          AND received_at >= NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [candidates]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function postWhatsappMessage(phoneNumberId, body) {
  const resp = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_CLOUD_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  const payload = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, payload };
}

async function enviarPayloadComCandidatos(phoneNumberId, toPhone, buildPayload) {
  const candidates = await resolverWaIdCanonico(toPhone);
  let lastError = null;

  for (const candidate of candidates) {
    const { ok, payload } = await postWhatsappMessage(phoneNumberId, buildPayload(candidate));
    if (ok) {
      const waId = payload?.contacts?.[0]?.wa_id || candidate;
      const wamid = payload?.messages?.[0]?.id || null;
      return { ok: true, sent_to: candidate, wa_id: waId, wamid, payload };
    }
    lastError = payload?.error?.message
      || payload?.error?.error_user_msg
      || 'Falha ao enviar WhatsApp';
  }

  throw new Error(lastError || 'Falha ao enviar WhatsApp');
}

async function enviarWhatsappTexto(toPhone, text, phoneNumberId = null) {
  if (!WHATSAPP_CLOUD_ACCESS_TOKEN) {
    throw new Error('Token WhatsApp não configurado.');
  }
  const pid = phoneNumberId || await getWhatsappPhoneNumberId();
  if (!pid) throw new Error('Phone Number ID não encontrado.');

  const texto = String(text || '').trim();
  if (!texto) throw new Error('Mensagem vazia.');

  const result = await enviarPayloadComCandidatos(pid, toPhone, (candidate) => ({
    messaging_product: 'whatsapp',
    to: candidate,
    type: 'text',
    text: { body: texto },
  }));

  return result;
}

async function enviarWhatsappTemplate(toPhone, text, phoneNumberId = null, templateName = null) {
  if (!WHATSAPP_CLOUD_ACCESS_TOKEN) {
    throw new Error('Token WhatsApp não configurado.');
  }
  const nome = String(templateName || WHATSAPP_TEMPLATE_NOTIF || '').trim();
  if (!nome) throw new Error('Template WhatsApp não configurado (WHATSAPP_TEMPLATE_NOTIF).');

  const pid = phoneNumberId || await getWhatsappPhoneNumberId();
  if (!pid) throw new Error('Phone Number ID não encontrado.');

  const corpo = String(text || '').trim().slice(0, 1024);
  if (!corpo) throw new Error('Mensagem vazia.');

  const paramName = WHATSAPP_TEMPLATE_NOTIF_PARAM;
  const bodyParam = { type: 'text', text: corpo };
  if (paramName && !/^\d+$/.test(paramName)) {
    bodyParam.parameter_name = paramName;
  }

  return enviarPayloadComCandidatos(pid, toPhone, (candidate) => ({
    messaging_product: 'whatsapp',
    to: candidate,
    type: 'template',
    template: {
      name: nome,
      language: { code: WHATSAPP_TEMPLATE_NOTIF_LANG },
      components: [
        {
          type: 'body',
          parameters: [bodyParam],
        },
      ],
    },
  }));
}

/**
 * Envia notificação proativa (RI, OP, etc.).
 * Dentro da janela 24h → texto livre.
 * Fora da janela → template (WHATSAPP_TEMPLATE_NOTIF), se configurado.
 */
async function enviarWhatsappNotificacao(toPhone, text, phoneNumberId = null) {
  const pid = phoneNumberId || await getWhatsappPhoneNumberId();
  const dentroJanela = await usuarioDentroJanela24h(toPhone);

  if (dentroJanela) {
    const result = await enviarWhatsappTexto(toPhone, text, pid);
    return { ...result, modo: 'texto', dentro_janela_24h: true };
  }

  if (WHATSAPP_TEMPLATE_NOTIF) {
    const result = await enviarWhatsappTemplate(toPhone, text, pid);
    return { ...result, modo: 'template', dentro_janela_24h: false };
  }

  throw new Error(
    'Fora da janela de 24h do WhatsApp: o usuário precisa enviar uma mensagem ao número comercial '
    + 'nas últimas 24 horas, ou configure o template WHATSAPP_TEMPLATE_NOTIF na Meta e no servidor.'
  );
}

module.exports = {
  normalizePhoneDigits,
  buildWhatsappPhoneCandidates,
  toWhatsappPhone,
  getWhatsappPhoneNumberId,
  whatsappConfigurado,
  usuarioDentroJanela24h,
  enviarWhatsappTexto,
  enviarWhatsappTemplate,
  enviarWhatsappNotificacao,
};
