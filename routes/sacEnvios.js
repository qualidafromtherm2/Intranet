const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const pdfParse = require('pdf-parse');
const fetch = require('node-fetch');
const { parse: csvParse } = require('csv-parse/sync');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const supabase = require('../utils/supabase');
const { uploadPublicFile, removePublicFiles } = require('../utils/storage');
const {
  parseEnderecoTecnicoLegado,
  corrigirCamposEnderecoTecnico,
  normalizarEnderecoTecnicoRow,
  sanitizarCamposEnderecoTecnico,
} = require('../utils/tecnicoEndereco');
const { syncCustoPecasEnvio } = require('../utils/enviosCustoPecas');
const { smtpConfigurado, parseListaEmails, enviarEmail } = require('../utils/mailer');

const router = express.Router();

const STATUS_LIST = ['Pendente', 'Enviado', 'Excluído'];

const TRACK_USER = String(process.env.TRACK_USER || '').trim();
const TRACK_TOKEN = String(process.env.TRACK_TOKEN || '').trim();
const TRACK_BASES = [
  ...(process.env.TRACK_BASE_URL ? [process.env.TRACK_BASE_URL] : []),
  'https://api.linketrack.com',
  'https://api.linketrack.com.br'
];

// Wonca: chave e endpoint configuráveis
const WONCA_API_KEY = process.env.WONCA_API_KEY || process.env.WONCA_TOKEN || '';
const WONCA_TRACK_URL = (process.env.WONCA_TRACK_URL || 'https://api-labs.wonca.com.br/wonca.labs.v1.LabsService/Track').replace(/\/$/, '');

// TrackingMore: fallback com carrier dos Correios
const TRACKINGMORE_API_KEY = process.env.TRACKINGMORE_API_KEY || process.env.TRACKINGMORE_TOKEN || '';
const TRACKINGMORE_URL = (process.env.TRACKINGMORE_URL || 'https://api.trackingmore.com/v2/trackings/realtime').replace(/\/$/, '');
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.META_WHATSAPP_VERIFY_TOKEN || '').trim();
const WHATSAPP_CLOUD_ACCESS_TOKEN = String(process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || process.env.META_WHATSAPP_ACCESS_TOKEN || '').trim();
const WHATSAPP_GRAPH_API_VERSION = String(process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0').trim() || 'v25.0';
const WHATSAPP_CHATBOT_AUTOREPLY_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.WHATSAPP_CHATBOT_AUTOREPLY_ENABLED || '1').trim());
const WHATSAPP_CHATBOT_MODEL = String(process.env.WHATSAPP_CHATBOT_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
const AT_SERIE_SHEETS_PUB_KEY = '2PACX-1vTBZcTPkowyN_dViQlzWd4noEgssByJR3f6YPtnR234sYIT5gTFI5PZXw3ZdPUOWAlxp_RDMo_I8JFm';
const AT_SERIE_SHEETS = ['PRODUÇÃO 1 - ESCOPO', 'PRODUÇÃO 2 - F/ ESCOPO'];
const AT_SERIE_PUBHTML_URL = `https://docs.google.com/spreadsheets/d/e/${AT_SERIE_SHEETS_PUB_KEY}/pubhtml`;
const AT_SERIE_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${AT_SERIE_SHEETS_PUB_KEY}/pub`;
const LEGACY_SERIE_SHEET_ID = '1pYlgEpyF10xprNlI7kcnLQZJPwV15sAMtJaCKCBNySI';
const LEGACY_SERIE_SHEET_NAME = 'IMPORTRANGE';
const PEDIDOS_SERIE_SHEET_ID = '14cmU3eOVH8ZscU-nZqxPb1Do5wTnl0SdQCU1caee6qk';
const PEDIDOS_SERIE_GID = '1642140396';
const TESTE_GAS_SHEET_ID = '1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M';
const TESTE_GAS_SHEET_GID = '1333359070';
const SPEC_SHEET_ID  = '1Kzg7LngaUig6t2CLabS1fhZ-iD5idrmv1ZesIUVOy1M';
const SPEC_SHEET_GID = '2061903610';
let atSerieSheetGidCache = null;
let atSerieSheetGidCacheAt = 0;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function extractGvizJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Resposta gviz invalida.');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function parseGvizRows(gvizObj) {
  const table = gvizObj?.table;
  const cols = Array.isArray(table?.cols) ? table.cols : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const headers = cols.map((c, idx) => String(c?.label || c?.id || `col_${idx}`).trim());

  return rows.map((row) => {
    const cells = Array.isArray(row?.c) ? row.c : [];
    const out = {};
    headers.forEach((h, idx) => {
      const cell = cells[idx];
      const val = cell && typeof cell === 'object' ? (cell.f ?? cell.v ?? '') : '';
      out[h] = String(val ?? '').trim();
    });
    return out;
  });
}

function getValueByHeaderMatch(rowObj, matcher) {
  const keys = Object.keys(rowObj || {});
  const found = keys.find((key) => matcher(normalizeText(key)));
  return found ? String(rowObj[found] || '').trim() : '';
}

async function getAtSerieSheetGids() {
  const now = Date.now();
  if (atSerieSheetGidCache && (now - atSerieSheetGidCacheAt) < 10 * 60 * 1000) {
    return atSerieSheetGidCache;
  }

  const resp = await fetchWithTimeout(AT_SERIE_PUBHTML_URL, { headers: { Accept: 'text/html' } }, 15000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar pubhtml da planilha (${resp.status})`);
  }

  const html = await resp.text();
  const map = {};

  // Formato atual do pubhtml: items.push({name: "...", ..., gid: "..."})
  const scriptRegex = /items\.push\(\{name:\s*"([^"]+)",[\s\S]*?gid:\s*"(-?\d+)"/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const rawTitle = String(match[1] || '').trim();
    const gid = String(match[2] || '').trim();
    const title = rawTitle
      .replace(/\\\//g, '/')
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .trim();
    if (!gid || !title) continue;
    map[normalizeText(title)] = gid;
  }

  // Fallback para versões antigas do pubhtml com links no menu
  if (!Object.keys(map).length) {
    const anchorRegex = /<a[^>]*href="\?gid=(\d+)[^"]*"[^>]*>(.*?)<\/a>/gi;
    while ((match = anchorRegex.exec(html)) !== null) {
      const gid = String(match[1] || '').trim();
      const titleHtml = String(match[2] || '').trim();
      const title = titleHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
      if (!gid || !title) continue;
      map[normalizeText(title)] = gid;
    }
  }

  atSerieSheetGidCache = map;
  atSerieSheetGidCacheAt = now;
  return map;
}

async function fetchAtSerieSheetRows(sheetName) {
  const gidMap = await getAtSerieSheetGids();
  const gid = gidMap[normalizeText(sheetName)];
  if (!gid) {
    throw new Error(`Aba não encontrada na publicação: ${sheetName}`);
  }

  const csvUrl = `${AT_SERIE_CSV_URL}?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar CSV da aba ${sheetName} (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

async function fetchLegacySerieRows() {
  const csvUrl = `https://docs.google.com/spreadsheets/d/${LEGACY_SERIE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(LEGACY_SERIE_SHEET_NAME)}`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar CSV da planilha legacy (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: false,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

async function fetchPedidosSerieRows() {
  // Usar /export?format=csv em vez de gviz/tq para ignorar filtros ativos na planilha
  // (gviz/tq respeita filtros do Sheets e omite linhas ocultas no CSV exportado)
  const csvUrl = `https://docs.google.com/spreadsheets/d/${PEDIDOS_SERIE_SHEET_ID}/export?format=csv&gid=${encodeURIComponent(PEDIDOS_SERIE_GID)}`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar planilha PEDIDOS (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

async function fetchTesteGasRows() {
  // /export?format=csv ignora filtros ativos no Google Sheets
  const csvUrl = `https://docs.google.com/spreadsheets/d/${TESTE_GAS_SHEET_ID}/export?format=csv&gid=${encodeURIComponent(TESTE_GAS_SHEET_GID)}`;
  const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 30000);
  if (!resp.ok) {
    throw new Error(`Falha ao consultar planilha TESTE/GAS (${resp.status})`);
  }
  const csvText = await resp.text();
  return csvParse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
}

function isAbortError(err) {
  return err?.name === 'AbortError' || err?.type === 'aborted';
}

function sanitizeIdentificacao(codigo) {
  return String(codigo || '').replace(/\s+/g, '').toUpperCase() || null;
}

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

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

/** Candidatos para match flexível (com/sem +55, DDD, 9º dígito, fixo 10 dígitos). */
function buildPhoneMatchCandidates(value) {
  const out = new Set(buildWhatsappPhoneCandidates(value));
  const digits = normalizePhoneDigits(value);
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.startsWith('55') && digits.length > 11) variants.add(digits.slice(2));
  if (digits.length >= 11) variants.add(digits.slice(-11));
  if (digits.length >= 10) variants.add(digits.slice(-10));

  for (const v of variants) {
    if (!v || v.length < 8) continue;
    out.add(v);
    if (v.length === 10) out.add(`55${v}`);
    if (v.length === 11) {
      out.add(`55${v}`);
      if (v[2] === '9') out.add(`55${v.slice(0, 2)}${v.slice(3)}`);
    }
  }

  return Array.from(out).filter((v) => v.length >= 8);
}

function sanitizeWhatsappMediaFileName(label, fallbackExt = 'pdf') {
  const base = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const normalized = base || `manual_fromtherm.${fallbackExt}`;
  if (/\.[a-z0-9]{2,5}$/i.test(normalized)) return normalized;
  return `${normalized}.${fallbackExt}`;
}

function whatsappUserRequestedImage(text) {
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;
  return t.includes('foto') || t.includes('imagem') || t.includes('print');
}

function whatsappUserRequestedMedia(text) {
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;
  const verboEnvio = /(manda|mande|envia|envie|mostrar|mostra|abrir|abre|ver)/.test(t);
  return (
    whatsappUserRequestedImage(text) ||
    t.includes('pagina') ||
    t.includes('pdf') ||
    ((t.includes('manual') || t.includes('link') || t.includes('pdf')) && verboEnvio) ||
    (verboEnvio &&
      (t.includes('manual') || t.includes('foto') || t.includes('imagem') || t.includes('pagina')))
  );
}

async function enviarMensagemWhatsappPayload({ phoneNumberId, toPhone, payloadBuilder }) {
  if (!WHATSAPP_CLOUD_ACCESS_TOKEN) {
    throw new Error('WHATSAPP_CLOUD_ACCESS_TOKEN não configurado.');
  }
  if (!phoneNumberId) {
    throw new Error('Phone Number ID não encontrado para esta conversa.');
  }

  const candidates = buildWhatsappPhoneCandidates(toPhone);
  let lastError = null;

  for (const candidate of candidates) {
    const body = payloadBuilder(candidate);
    const resp = await fetchWithTimeout(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(String(phoneNumberId))}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_CLOUD_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      },
      15000
    );

    const payload = await resp.json().catch(() => ({}));
    if (resp.ok) {
      if (!payload.__meta) payload.__meta = {};
      payload.__meta.sent_to = candidate;
      payload.__meta.request_body = body;
      return payload;
    }

    lastError = payload?.error?.message || payload?.error?.error_user_msg || `Falha ao enviar WhatsApp (${resp.status})`;
  }

  throw new Error(lastError || 'Falha ao enviar mensagem do WhatsApp.');
}

async function insertWhatsappMessageRecord({
  waMessageId = null,
  phone = null,
  profileName = null,
  messageType = 'text',
  messageText = null,
  phoneNumberId = null,
  displayPhoneNumber = null,
  payload = {},
  direction = 'inbound'
}) {
  const phoneDigits = normalizePhoneDigits(phone);
  await pool.query(
    `INSERT INTO sac.whatsapp_webhook_messages (
       wa_message_id,
       from_phone,
       from_phone_digits,
       profile_name,
       message_type,
       message_text,
       phone_number_id,
       display_phone_number,
       payload_json,
       direction
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (wa_message_id) DO UPDATE
       SET message_text = EXCLUDED.message_text,
           profile_name = COALESCE(EXCLUDED.profile_name, sac.whatsapp_webhook_messages.profile_name),
           payload_json = EXCLUDED.payload_json,
           direction = EXCLUDED.direction`,
    [
      waMessageId,
      phone || null,
      phoneDigits || null,
      profileName || null,
      messageType || null,
      messageText || null,
      phoneNumberId || null,
      displayPhoneNumber || null,
      payload || {},
      direction === 'outbound' ? 'outbound' : 'inbound'
    ]
  );
}

async function obterContextoWhatsappPorTelefone(phone) {
  const phoneDigits = normalizePhoneDigits(phone);
  const candidates = Array.from(new Set([
    phoneDigits,
    phoneDigits.startsWith('55') ? phoneDigits.slice(2) : `55${phoneDigits}`
  ].filter(Boolean)));

  if (!candidates.length) return null;

  const { rows } = await pool.query(
    `SELECT from_phone, from_phone_digits, profile_name, phone_number_id, display_phone_number
       FROM sac.whatsapp_webhook_messages
      WHERE from_phone_digits = ANY($1::text[])
        AND COALESCE(phone_number_id, '') <> ''
      ORDER BY received_at DESC, id DESC
      LIMIT 1`,
    [candidates]
  );
  return rows[0] || null;
}

async function listarHistoricoWhatsapp(phone, limit = 12) {
  const phoneDigits = normalizePhoneDigits(phone);
  const candidates = Array.from(new Set([
    phoneDigits,
    phoneDigits.startsWith('55') ? phoneDigits.slice(2) : `55${phoneDigits}`
  ].filter(Boolean)));

  if (!candidates.length) return [];

  const { rows } = await pool.query(
    `SELECT profile_name, message_text, direction, received_at
       FROM sac.whatsapp_webhook_messages
      WHERE from_phone_digits = ANY($1::text[])
      ORDER BY received_at DESC, id DESC
      LIMIT $2`,
    [candidates, Math.max(1, Math.min(Number(limit) || 12, 30))]
  );
  return rows.reverse();
}

async function enviarMensagemWhatsappTexto({ phoneNumberId, toPhone, text }) {
  const texto = String(text || '').trim();
  if (!texto) {
    throw new Error('Mensagem vazia.');
  }

  return enviarMensagemWhatsappPayload({
    phoneNumberId,
    toPhone,
    payloadBuilder: (candidate) => ({
      messaging_product: 'whatsapp',
      to: candidate,
      type: 'text',
      text: { body: texto }
    })
  });
}

async function enviarMensagemWhatsappImagem({ phoneNumberId, toPhone, imageUrl, caption = '' }) {
  const link = String(imageUrl || '').trim();
  if (!link) throw new Error('URL da imagem não informada.');

  return enviarMensagemWhatsappPayload({
    phoneNumberId,
    toPhone,
    payloadBuilder: (candidate) => ({
      messaging_product: 'whatsapp',
      to: candidate,
      type: 'image',
      image: {
        link,
        ...(String(caption || '').trim() ? { caption: String(caption || '').trim().slice(0, 1024) } : {})
      }
    })
  });
}

/**
 * Envia indicador de digitação ("digitando...") + marca mensagem como lida.
 * Requer o message_id da mensagem recebida do webhook.
 */
async function enviarTypingIndicator({ phoneNumberId, messageId }) {
  if (!WHATSAPP_CLOUD_ACCESS_TOKEN || !phoneNumberId || !messageId) return;
  try {
    await fetchWithTimeout(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(String(phoneNumberId))}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${WHATSAPP_CLOUD_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
          typing_indicator: { type: 'text' }
        })
      },
      10000
    );
  } catch (err) {
    console.warn('[WhatsApp] falha ao enviar typing indicator:', err?.message);
  }
}

async function enviarMensagemWhatsappDocumento({ phoneNumberId, toPhone, documentUrl, caption = '', filename = '' }) {
  const link = String(documentUrl || '').trim();
  if (!link) throw new Error('URL do documento não informada.');

  return enviarMensagemWhatsappPayload({
    phoneNumberId,
    toPhone,
    payloadBuilder: (candidate) => ({
      messaging_product: 'whatsapp',
      to: candidate,
      type: 'document',
      document: {
        link,
        ...(String(caption || '').trim() ? { caption: String(caption || '').trim().slice(0, 1024) } : {}),
        ...(String(filename || '').trim() ? { filename: String(filename || '').trim().slice(0, 240) } : {})
      }
    })
  });
}

/**
 * Envia mensagem interativa com botões de resposta rápida (máx. 3).
 * buttons: [{ id: 'btn_1', title: 'Texto do botão' }, ...]
 */
async function enviarMensagemWhatsappComBotoes({ phoneNumberId, toPhone, bodyText, buttons = [] }) {
  const texto = String(bodyText || '').trim();
  if (!texto) throw new Error('Texto do corpo vazio.');
  const btns = (Array.isArray(buttons) ? buttons : [])
    .slice(0, 3)
    .map((b, i) => ({
      type: 'reply',
      reply: {
        id: String(b.id || `btn_${i}`).slice(0, 256),
        title: String(b.title || '').trim().slice(0, 20)
      }
    }))
    .filter(b => b.reply.title);
  if (!btns.length) {
    return enviarMensagemWhatsappTexto({ phoneNumberId, toPhone, text: texto });
  }
  return enviarMensagemWhatsappPayload({
    phoneNumberId,
    toPhone,
    payloadBuilder: (candidate) => ({
      messaging_product: 'whatsapp',
      to: candidate,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: texto },
        action: { buttons: btns }
      }
    })
  });
}

/**
 * Envia mensagem interativa com lista de opções (ideal para 4+ opções).
 * sections: [{ title: 'Seção', rows: [{ id: 'opt_1', title: 'Opção', description: '...' }] }]
 * buttonText: texto do botão que abre a lista (máx 20 chars)
 */
async function enviarMensagemWhatsappLista({ phoneNumberId, toPhone, headerText, bodyText, footerText, buttonText, sections = [] }) {
  const body = String(bodyText || '').trim();
  if (!body) throw new Error('Texto do corpo vazio.');
  const secs = (Array.isArray(sections) ? sections : [])
    .map(s => ({
      title: String(s.title || '').trim().slice(0, 24),
      rows: (Array.isArray(s.rows) ? s.rows : [])
        .slice(0, 10)
        .map(r => ({
          id: String(r.id || '').slice(0, 200),
          title: String(r.title || '').trim().slice(0, 24),
          ...(r.description ? { description: String(r.description).trim().slice(0, 72) } : {})
        }))
        .filter(r => r.id && r.title)
    }))
    .filter(s => s.rows.length);
  if (!secs.length) {
    return enviarMensagemWhatsappTexto({ phoneNumberId, toPhone, text: body });
  }
  return enviarMensagemWhatsappPayload({
    phoneNumberId,
    toPhone,
    payloadBuilder: (candidate) => ({
      messaging_product: 'whatsapp',
      to: candidate,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(headerText ? { header: { type: 'text', text: String(headerText).trim().slice(0, 60) } } : {}),
        body: { text: body },
        ...(footerText ? { footer: { text: String(footerText).trim().slice(0, 60) } } : {}),
        action: {
          button: String(buttonText || 'Menu de opções').trim().slice(0, 20),
          sections: secs
        }
      }
    })
  });
}

/**
 * Verifica se o telefone pertence a um colaborador interno (cadastrado em auth_user.telefone_contato).
 * Se sim, o chatbot WhatsApp usa o assistente completo (/api/ai/chat) em vez do manual-only.
 */
async function verificarContatoInterno(phoneDigits) {
  if (!phoneDigits) return { isInternal: false, userId: null, username: null };
  try {
    const candidates = buildWhatsappPhoneCandidates(phoneDigits);
    // Adiciona variantes sem código de país (55) pois auth_user pode armazenar sem o prefixo
    const extras = new Set(candidates);
    for (const c of candidates) {
      if (c.startsWith('55') && c.length >= 12) {
        extras.add(c.slice(2)); // sem o 55
      }
    }
    const allCandidates = Array.from(extras);
    if (!allCandidates.length) return { isInternal: false, userId: null, username: null };
    const { rows } = await pool.query(
      `SELECT id, username
         FROM public.auth_user
        WHERE REGEXP_REPLACE(COALESCE(telefone_contato, ''), '\\D', '', 'g') = ANY($1::text[])
          AND is_active = true
        LIMIT 1`,
      [allCandidates]
    );
    if (rows.length) {
      return { isInternal: true, userId: rows[0].id, username: rows[0].username };
    }
  } catch (err) {
    console.warn('[WhatsApp] falha ao verificar contato interno:', err?.message || err);
  }
  return { isInternal: false, userId: null, username: null };
}

/* ========================================================================
 *  MENU PRINCIPAL DO CHATBOT WHATSAPP (contatos internos)
 * ======================================================================== */

// Estado do menu por telefone — controla qual fluxo está ativo
const menuInternoState = new Map(); // key: phoneDigits, value: { fluxo, updatedAt }
// fluxo: null (menu), 'CONSULTA_PRODUTO', 'COMPRAS', 'AGENDA'
const MENU_STATE_TTL_MS = 30 * 60 * 1000; // 30 min

// Processamento sequencial por telefone para evitar corrida entre webhooks simultâneos.
const whatsappPhoneProcessingQueue = new Map();

function enqueueWhatsappByPhone(phoneDigits, taskFn) {
  const key = String(phoneDigits || '').trim();
  if (!key) return Promise.resolve().then(taskFn);

  const prev = whatsappPhoneProcessingQueue.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(taskFn)
    .catch((err) => {
      console.error('[WhatsApp][queue] erro no processamento:', err?.message || err);
    })
    .finally(() => {
      if (whatsappPhoneProcessingQueue.get(key) === next) {
        whatsappPhoneProcessingQueue.delete(key);
      }
    });

  whatsappPhoneProcessingQueue.set(key, next);
  return next;
}

function limparMenusExpirados() {
  const agora = Date.now();
  for (const [phone, state] of menuInternoState) {
    if (agora - state.updatedAt > MENU_STATE_TTL_MS) menuInternoState.delete(phone);
  }
}
setInterval(limparMenusExpirados, 5 * 60 * 1000);

const MENU_PRINCIPAL_TEXTO =
  '📋 *Menu Principal — Chatbot Fromtherm*\n\n' +
  'Escolha uma opção:\n\n' +
  '1️⃣ Consultar produto\n' +
  '2️⃣ Realizar compra\n' +
  '3️⃣ Consultar venda\n' +
  '4️⃣ Verificar agenda\n' +
  '5️⃣ Verificar mensagens\n' +
  '6️⃣ Manual de instrução\n\n' +
  '_Digite o número da opção desejada._';

const MENU_FINALIZAR_TEXTO =
  '✅ Assunto finalizado!\n\n' +
  'Posso ajudar com mais alguma coisa?\n\n' +
  '1️⃣ Consultar produto\n' +
  '2️⃣ Realizar compra\n' +
  '3️⃣ Consultar venda\n' +
  '4️⃣ Verificar agenda\n' +
  '5️⃣ Verificar mensagens\n' +
  '6️⃣ Manual de instrução\n\n' +
  '_Digite o número da opção ou envie sua dúvida._';

/**
 * Consulta a agenda (reuniões) do usuário para hoje e próximos 7 dias.
 * Suporta reuniões recorrentes (repetir, dias_semana, repetir_todos_meses, datas_excecao).
 */
async function consultarAgendaUsuario(username) {
  try {
    // Busca TODAS as reservas do usuário (inclusive recorrentes com data_reserva no passado)
    const { rows } = await pool.query(
      `SELECT ra.id, ra.tema_reuniao, ra.data_reserva, ra.hora_inicio, ra.hora_fim,
              ra.tipo_espaco, ra.cafe, ra.criado_por, ra.descricao,
              ra.link_reuniao, ra.visitantes,
              ra.repetir, ra.dias_semana, ra.repetir_todos_meses, ra.datas_excecao
       FROM rh.reservas_participantes rp
       JOIN rh.reservas_ambientes ra ON ra.id = rp.reserva_id
       WHERE rp.username = $1
       ORDER BY ra.data_reserva, ra.hora_inicio`,
      [username]
    );
    if (!rows.length) {
      return '📅 *Sua Agenda*\n\nVocê não tem reuniões agendadas. ✅';
    }

    // Mapeia dias_semana para JS getDay() — dom=0, seg=1, ..., sab=6
    const DIA_MAP = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const limite = new Date(hoje);
    limite.setDate(limite.getDate() + 7); // próximos 7 dias

    // Gera lista de ocorrências futuras
    const ocorrencias = [];

    for (const r of rows) {
      const dataBase = new Date(r.data_reserva);
      dataBase.setHours(0, 0, 0, 0);

      // Set de datas de exceção (normalizadas para YYYY-MM-DD)
      const excecoes = new Set();
      if (Array.isArray(r.datas_excecao)) {
        for (const d of r.datas_excecao) {
          const dt = new Date(d);
          excecoes.add(dt.toISOString().slice(0, 10));
        }
      }

      if (r.repetir && Array.isArray(r.dias_semana) && r.dias_semana.length > 0) {
        // Reunião recorrente — gera ocorrências nos próximos 7 dias
        const diasAlvo = r.dias_semana.map(d => DIA_MAP[d]).filter(d => d !== undefined);
        if (!diasAlvo.length) continue;

        const cursor = new Date(hoje);
        while (cursor < limite) {
          if (diasAlvo.includes(cursor.getDay()) && cursor >= dataBase) {
            const dataStr = cursor.toISOString().slice(0, 10);
            if (!excecoes.has(dataStr)) {
              ocorrencias.push({ ...r, _dataOcorrencia: new Date(cursor) });
            }
          }
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        // Reunião única — só mostra se data >= hoje
        if (dataBase >= hoje && dataBase < limite) {
          const dataStr = dataBase.toISOString().slice(0, 10);
          if (!excecoes.has(dataStr)) {
            ocorrencias.push({ ...r, _dataOcorrencia: new Date(dataBase) });
          }
        }
      }
    }

    if (!ocorrencias.length) {
      return '📅 *Sua Agenda*\n\nVocê não tem reuniões nos próximos 7 dias. ✅';
    }

    // Deduplica: para o mesmo tema na mesma data, mantém apenas a reunião com maior ID (mais recente)
    // Isso evita exibir múltiplas versões de uma reunião recorrente que foi recriada sem encerrar a anterior
    const deduplicado = new Map();
    for (const oc of ocorrencias) {
      const chave = `${(oc.tema_reuniao || '').toLowerCase().trim()}__${oc._dataOcorrencia.toISOString().slice(0, 10)}`;
      const existente = deduplicado.get(chave);
      if (!existente || Number(oc.id || 0) > Number(existente.id || 0)) {
        deduplicado.set(chave, oc);
      }
    }
    const ocorrenciasFinais = Array.from(deduplicado.values());

    // Ordena por data e hora
    ocorrenciasFinais.sort((a, b) => {
      const diff = a._dataOcorrencia - b._dataOcorrencia;
      if (diff !== 0) return diff;
      return (a.hora_inicio || '').localeCompare(b.hora_inicio || '');
    });

    let texto = `📅 *Sua Agenda* — ${ocorrenciasFinais.length} reunião(ões) nos próximos 7 dias:\n`;
    let dataAtual = null;
    for (const r of ocorrenciasFinais) {
      const dataStr = r._dataOcorrencia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
      if (dataStr !== dataAtual) {
        dataAtual = dataStr;
        texto += `\n📆 *${dataStr}*\n`;
      }
      texto += `\n  ⏰ ${r.hora_inicio.slice(0,5)} — ${r.hora_fim.slice(0,5)}`;
      texto += ` | 📍 ${r.tipo_espaco || 'Local não definido'}\n`;
      texto += `  📌 *${r.tema_reuniao || 'Sem tema'}*\n`;
      if (r.descricao) texto += `  📝 ${r.descricao}\n`;
      if (r.criado_por) texto += `  👤 Organizado por: ${r.criado_por}\n`;
      if (r.visitantes) texto += `  🧑‍💼 Visitantes: ${r.visitantes}\n`;
      if (r.link_reuniao) texto += `  🔗 Link: ${r.link_reuniao}\n`;
    }
    return texto;
  } catch (err) {
    console.error('[WhatsApp/Agenda] erro ao consultar agenda:', err?.message || err);
    return '⚠️ Erro ao consultar sua agenda. Tente novamente mais tarde.';
  }
}

/**
 * Consulta mensagens não lidas do chat interno para o usuário.
 */
async function consultarMensagensNaoLidas(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT cm.id, au.username AS remetente, LEFT(cm.message_text, 100) AS msg,
              cm.created_at
       FROM public.chat_messages cm
       JOIN public.auth_user au ON au.id = cm.from_user_id
       WHERE cm.to_user_id = $1
         AND cm.is_read = false
       ORDER BY cm.created_at DESC
       LIMIT 20`,
      [userId]
    );
    if (!rows.length) {
      return '💬 *Suas Mensagens*\n\nVocê não tem mensagens não lidas. ✅';
    }
    let texto = `💬 *Suas Mensagens* — ${rows.length} não lida(s):\n\n`;
    for (const m of rows) {
      const data = new Date(m.created_at);
      const dataStr = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const horaStr = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const msgResumo = m.msg.length >= 100 ? m.msg + '...' : m.msg;
      texto += `👤 *${m.remetente}* — ${dataStr} ${horaStr}\n`;
      texto += `   ${msgResumo}\n\n`;
    }
    texto += '_Acesse o chat na intranet para responder._';
    return texto;
  } catch (err) {
    console.error('[WhatsApp/Mensagens] erro ao consultar mensagens:', err?.message || err);
    return '⚠️ Erro ao consultar suas mensagens. Tente novamente mais tarde.';
  }
}

/* ========================================================================
 *  FLUXO DE COMPRAS VIA WHATSAPP (menu numerado interativo)
 * ======================================================================== */

// Estado do fluxo de compras por telefone (in-memory, expira em 15 min)
const comprasFlowState = new Map(); // key: phoneDigits, value: { step, data, updatedAt }
const COMPRAS_FLOW_TTL_MS = 15 * 60 * 1000; // 15 minutos

function limparFluxosExpirados() {
  const agora = Date.now();
  for (const [phone, state] of comprasFlowState) {
    if (agora - state.updatedAt > COMPRAS_FLOW_TTL_MS) {
      comprasFlowState.delete(phone);
    }
  }
}
// Limpeza a cada 5 min
setInterval(limparFluxosExpirados, 5 * 60 * 1000);

function detectarIntencaoCompra(texto) {
  if (!texto) return false;
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  // Padrão 1: verbo + "compra(r)" — cobre "realizar compra", "fazer compra", "quero comprar", etc.
  if (/\b(quero|preciso|vou|gostaria\s+de|necessito|posso)\s+(comprar|fazer\s+(uma\s+)?compra|realizar\s+(uma\s+)?compra)/i.test(t)) return true;
  // Padrão 2: ação + "compra/requisição/solicitação"
  if (/\b(solicitar|fazer|realizar|iniciar|abrir|pedir|criar|registrar|lancar)\s+(uma\s+)?(compra|requisicao|solicitacao)\b/i.test(t)) return true;
  // Padrão 3: imperativo — "realize/faça/abra uma compra"
  if (/\b(realize|faca|abra|inicie|peca|crie)\s+(uma\s+)?(compra|requisicao|solicitacao)\b/i.test(t)) return true;
  // Padrão 4: "nova compra", "compra de material", "comprar material"
  if (/\b(nova\s+compra|compra\s+de\s+material|comprar\s+material|comprar\s+produto)\b/i.test(t)) return true;
  // Padrão 5: frases diretas — "então realize/faça uma compra"
  if (/\bentao\b.*\b(compra|comprar)\b/i.test(t)) return true;
  return false;
}

/**
 * Busca categorias de compra via API e apresenta menu numerado,
 * ou redireciona para digitação livre em caso de falha.
 */
async function buscarEApresentarCategorias(state) {
  try {
    const resp = await fetchWithTimeout(
      `http://localhost:${process.env.PORT || 5001}/api/compras/departamentos-categorias`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
      10000
    );
    const data = await resp.json().catch(() => ({}));
    const departamentos = Array.isArray(data?.departamentos) ? data.departamentos : [];
    // Filtra pelo departamento escolhido (por id ou nome)
    const deptId = state.data.departamentoId;
    const deptNome = state.data.departamento;
    const dept = departamentos.find(d => d.id === deptId) || departamentos.find(d => d.nome === deptNome);
    const cats = dept?.categorias || [];
    if (cats.length) {
      state.data.categoriasLista = cats.map(c => ({ id: c.id, nome: c.nome }));
      state.step = 'CATEGORIA';
      let lista = '📂 *Categoria da compra:*\n\n';
      cats.forEach((c, i) => {
        lista += `*${i + 1}* - ${c.nome}\n`;
      });
      lista += '\nDigite o *número* da categoria:';
      return { content: lista };
    }
  } catch (err) {
    console.warn('[WhatsApp/Compras] erro ao buscar categorias:', err?.message);
  }
  // Fallback: digitação livre
  state.step = 'CATEGORIA_LIVRE';
  return { content: '📂 Digite o nome da *categoria* da compra:' };
}

/**
 * Processa o fluxo de compras passo-a-passo.
 * Retorna { content } se o fluxo gerou resposta, ou null se não está em fluxo.
 */
async function processarFluxoCompras({ phoneDigits, userMessage, contatoInfo, buttonReplyId }) {
  const msg = String(userMessage || '').trim();
  const msgLower = msg.toLowerCase();
  let state = comprasFlowState.get(phoneDigits);

  // Cancelamento a qualquer momento
  if (state && /^(cancelar|parar|cancel)$/i.test(msg)) {
    comprasFlowState.delete(phoneDigits);
    return { content: '❌ Fluxo de compras cancelado.' };
  }

  // Se não está em fluxo, verifica se é intenção de compra
  if (!state) {
    if (!detectarIntencaoCompra(msg)) return null;
    // Inicia fluxo
    state = {
      step: 'CADASTRO_OMIE',
      data: {
        solicitante: contatoInfo.username || '',
        userId: contatoInfo.userId || null
      },
      updatedAt: Date.now()
    };
    comprasFlowState.set(phoneDigits, state);
    return {
      content:
        '🛒 *Solicitação de Compra*\n\n' +
        'O produto já está cadastrado na Omie?\n\n' +
        '1️⃣ Sim\n' +
        '2️⃣ Não\n' +
        '3️⃣ Não sei\n\n' +
        '_(Digite o número ou "cancelar" para sair)_'
    };
  }

  // Atualiza timestamp
  state.updatedAt = Date.now();

  switch (state.step) {
    /* ---- Passo 1: Produto na Omie? ---- */
    case 'CADASTRO_OMIE': {
      if (msg === '1' || buttonReplyId === 'compra_omie_sim') {
        state.step = 'BUSCAR_PRODUTO';
        state.data.tipoCompra = 'omie';
        return { content: '🔍 Digite o *código ou nome* do produto para buscar no catálogo Omie:' };
      }
      if (msg === '2' || msg === '3' || buttonReplyId === 'compra_omie_nao' || buttonReplyId === 'compra_omie_naosei') {
        state.data.tipoCompra = 'sem_cadastro';
        state.step = 'MODELO_COMPRA';
        return {
          content:
            '📦 *Modelo de compra:*\n\n' +
            '1️⃣ Apenas realizar compra sem retorno de valores ou característica\n' +
            '2️⃣ Compra com retorno de valores e característica técnica\n' +
            '3️⃣ Compra já realizada\n' +
            '4️⃣ Registro rápido de compra\n\n' +
            'Digite o *número* do modelo:'
        };
      }
      return { content: 'Por favor, escolha uma das opções:\n\n*Sim* — cadastrado na Omie\n*Não*\n*Não sei*' };
    }

    /* ---- Passo 1b: Modelo de compra (apenas sem cadastro) ---- */
    case 'MODELO_COMPRA': {
      const modelos = {
        '1': 'Apenas realizar compra sem retorno de valores ou caracteristica',
        '2': 'Compra com retorno de valores e caracteristica tecnica',
        '3': 'Compra ja realizada',
        '4': 'Registro rapido de compra'
      };
      if (!modelos[msg]) {
        return { content: 'Digite *1*, *2*, *3* ou *4*:' };
      }
      state.data.modeloCompra = modelos[msg];
      state.step = 'DESCRICAO_PRODUTO';
      return { content: '📝 Descreva o produto que precisa comprar:' };
    }

    /* ---- Passo 2a: Buscar produto Omie ---- */
    case 'BUSCAR_PRODUTO': {
      if (msg.length < 2) {
        return { content: 'Digite pelo menos *2 caracteres* para buscar o produto:' };
      }
      try {
        const resp = await fetchWithTimeout(
          `http://localhost:${process.env.PORT || 5001}/api/produtos/search?q=${encodeURIComponent(msg)}&limit=5`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
          10000
        );
        const data = await resp.json().catch(() => ({}));
        const produtos = Array.isArray(data?.produtos) ? data.produtos : [];
        if (!produtos.length) {
          return {
            content:
              `Nenhum produto encontrado para "${msg}".\n\n` +
              'Tente outro termo, ou digite:\n' +
              '*0* - Cadastrar como produto sem código Omie\n' +
              '*cancelar* - Sair do fluxo'
          };
        }
        state.data.resultadosBusca = produtos;
        state.step = 'SELECIONAR_PRODUTO';
        let lista = '📋 *Produtos encontrados:*\n\n';
        produtos.forEach((p, i) => {
          lista += `*${i + 1}* - ${p.codigo} — ${p.descricao}\n`;
        });
        lista += '\n*0* - Nenhum destes (cadastrar sem código Omie)\n';
        lista += '\nDigite o *número* do produto desejado:';
        return { content: lista };
      } catch (err) {
        console.warn('[WhatsApp/Compras] erro ao buscar produtos:', err?.message);
        return { content: 'Erro ao buscar produtos. Tente novamente ou digite *cancelar*.' };
      }
    }

    /* ---- Passo 2b: Selecionar produto da lista ---- */
    case 'SELECIONAR_PRODUTO': {
      const escolha = parseInt(msg, 10);
      const resultados = state.data.resultadosBusca || [];
      if (msg === '0') {
        state.step = 'DESCRICAO_PRODUTO';
        state.data.tipoCompra = 'sem_cadastro';
        delete state.data.resultadosBusca;
        return { content: '📝 Descreva o produto que precisa comprar:' };
      }
      if (isNaN(escolha) || escolha < 1 || escolha > resultados.length) {
        return { content: `Digite um número de *1* a *${resultados.length}*, ou *0* para outro produto:` };
      }
      const prod = resultados[escolha - 1];
      state.data.produto_codigo = prod.codigo;
      state.data.produto_descricao = prod.descricao;
      state.data.descricao_familia = prod.descricao_familia || '';
      state.data.codigo_produto_omie = prod.codigo_produto || '';
      delete state.data.resultadosBusca;
      state.step = 'QUANTIDADE';
      return {
        content:
          `✅ Produto selecionado: *${prod.codigo}* — ${prod.descricao}\n\n` +
          'Qual a *quantidade* desejada?'
      };
    }

    /* ---- Passo 2c: Descrição produto sem cadastro ---- */
    case 'DESCRICAO_PRODUTO': {
      if (msg.length < 3) {
        return { content: 'Descrição muito curta. Descreva o produto com mais detalhes:' };
      }
      state.data.produto_descricao = msg;
      state.step = 'QUANTIDADE';
      return { content: 'Qual a *quantidade* desejada?' };
    }

    /* ---- Passo 3: Quantidade ---- */
    case 'QUANTIDADE': {
      const qtd = parseInt(msg, 10);
      if (isNaN(qtd) || qtd < 1) {
        return { content: 'Digite uma quantidade válida (número inteiro maior que 0):' };
      }
      state.data.quantidade = qtd;
      // Buscar departamentos
      try {
        const resp = await fetchWithTimeout(
          `http://localhost:${process.env.PORT || 5001}/api/compras/departamentos`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
          10000
        );
        const data = await resp.json().catch(() => ({}));
        const depts = Array.isArray(data?.departamentos) ? data.departamentos : [];
        if (depts.length) {
          state.data.departamentosLista = depts.map(d => ({ id: d.id, nome: d.nome }));
          state.step = 'DEPARTAMENTO';
          let lista = '🏢 *Departamento solicitante:*\n\n';
          depts.forEach((d, i) => {
            lista += `*${i + 1}* - ${d.nome}\n`;
          });
          lista += '\nDigite o *número* do departamento:';
          return { content: lista };
        }
      } catch (err) {
        console.warn('[WhatsApp/Compras] erro ao buscar departamentos:', err?.message);
      }
      // Fallback: pedir digitação livre
      state.step = 'DEPARTAMENTO_LIVRE';
      return { content: '🏢 Digite o nome do *departamento* solicitante:' };
    }

    /* ---- Passo 4: Departamento (lista) ---- */
    case 'DEPARTAMENTO': {
      const depts = state.data.departamentosLista || [];
      const escolha = parseInt(msg, 10);
      if (isNaN(escolha) || escolha < 1 || escolha > depts.length) {
        return { content: `Digite um número de *1* a *${depts.length}*:` };
      }
      const deptEscolhido = depts[escolha - 1];
      state.data.departamento = deptEscolhido.nome;
      state.data.departamentoId = deptEscolhido.id;
      delete state.data.departamentosLista;
      // Avança para categoria
      return await buscarEApresentarCategorias(state);
    }

    /* ---- Passo 4b: Departamento livre ---- */
    case 'DEPARTAMENTO_LIVRE': {
      if (msg.length < 2) return { content: 'Digite o nome do departamento:' };
      state.data.departamento = msg;
      // Avança para categoria
      return await buscarEApresentarCategorias(state);
    }

    /* ---- Passo 5: Categoria (lista) ---- */
    case 'CATEGORIA': {
      const cats = state.data.categoriasLista || [];
      const escolha = parseInt(msg, 10);
      if (isNaN(escolha) || escolha < 1 || escolha > cats.length) {
        return { content: `Digite um número de *1* a *${cats.length}*:` };
      }
      const catEscolhida = cats[escolha - 1];
      state.data.categoria_compra_nome = catEscolhida.nome;
      delete state.data.categoriasLista;
      state.step = 'ANEXO';
      return {
        content:
          '📎 Deseja anexar um *link* de referência (URL de produto, orçamento, etc.)?\n\n' +
          'Envie o link ou digite *pular* para continuar sem anexo.'
      };
    }

    /* ---- Passo 5b: Categoria livre (fallback) ---- */
    case 'CATEGORIA_LIVRE': {
      if (msg.length < 2) return { content: 'Digite o nome da categoria:' };
      state.data.categoria_compra_nome = msg;
      state.step = 'ANEXO';
      return {
        content:
          '📎 Deseja anexar um *link* de referência (URL de produto, orçamento, etc.)?\n\n' +
          'Envie o link ou digite *pular* para continuar sem anexo.'
      };
    }

    /* ---- Passo 6: Anexo (link/URL) ---- */
    case 'ANEXO': {
      if (!/^pular$/i.test(msg)) {
        // Aceita URL ou texto livre como link de referência
        state.data.link = msg;
      }
      state.step = 'OBSERVACAO';
      return { content: '📝 Alguma *observação*? (ou digite *pular*)' };
    }

    /* ---- Passo 7: Observação ---- */
    case 'OBSERVACAO': {
      if (!/^pular$/i.test(msg)) {
        state.data.observacao = msg;
      }
      state.step = 'CONFIRMACAO';
      // Monta resumo
      const d = state.data;
      let resumo = '📋 *Resumo da solicitação:*\n\n';
      if (d.modeloCompra) resumo += `• *Modelo:* ${d.modeloCompra}\n`;
      if (d.produto_codigo) resumo += `• *Código:* ${d.produto_codigo}\n`;
      resumo += `• *Produto:* ${d.produto_descricao}\n`;
      resumo += `• *Quantidade:* ${d.quantidade}\n`;
      resumo += `• *Departamento:* ${d.departamento}\n`;
      if (d.categoria_compra_nome) resumo += `• *Categoria:* ${d.categoria_compra_nome}\n`;
      if (d.link) resumo += `• *Link/Anexo:* ${d.link}\n`;
      if (d.observacao) resumo += `• *Obs:* ${d.observacao}\n`;
      resumo += `• *Solicitante:* ${d.solicitante}\n`;
      resumo += '\n*Confirmar solicitação?*\n\n✅ Confirmar\n❌ Cancelar';
      return { content: resumo };
    }

    /* ---- Passo 6: Confirmação ---- */
    case 'CONFIRMACAO': {
      if (msg === '2' || /^(n[aã]o|cancelar)$/i.test(msg) || buttonReplyId === 'compra_cancelar') {
        comprasFlowState.delete(phoneDigits);
        return { content: '❌ Solicitação cancelada.' };
      }
      if (msg !== '1' && !/^(sim|confirmar|ok)$/i.test(msg) && buttonReplyId !== 'compra_confirmar') {
        return { content: 'Digite *confirmar* ou *cancelar*:' };
      }
      // Criar solicitação via API
      const d = state.data;
      try {
        let resultado;
        if (d.tipoCompra === 'sem_cadastro') {
          // Produto sem cadastro Omie
          const resp = await fetchWithTimeout(
            `http://localhost:${process.env.PORT || 5001}/api/compras/sem-cadastro`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                produto_descricao: d.produto_descricao,
                quantidade: d.quantidade,
                departamento: d.departamento,
                centro_custo: d.departamento,
                categoria_compra_codigo: d.categoria_compra_codigo || '2.14.94',
                categoria_compra_nome: d.categoria_compra_nome || 'Outros Materiais',
                objetivo_compra: d.observacao || 'Solicitação via WhatsApp',
                retorno_cotacao: d.modeloCompra || 'Sim',
                link: d.link || null,
                solicitante: d.solicitante
              })
            },
            15000
          );
          resultado = await resp.json().catch(() => ({}));
        } else {
          // Produto Omie
          const resp = await fetchWithTimeout(
            `http://localhost:${process.env.PORT || 5001}/api/compras/solicitacao`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                itens: [{
                  produto_codigo: d.produto_codigo,
                  produto_descricao: d.produto_descricao,
                  quantidade: d.quantidade,
                  departamento: d.departamento,
                  centro_custo: d.departamento,
                  codigo_produto_omie: d.codigo_produto_omie || '',
                  categoria_compra: d.categoria_compra_codigo || '',
                  observacao: d.observacao || 'Solicitação via WhatsApp'
                }],
                link: d.link || null,
                solicitante: d.solicitante
              })
            },
            15000
          );
          resultado = await resp.json().catch(() => ({}));
        }
        comprasFlowState.delete(phoneDigits);
        if (resultado?.ok) {
          const idCriado = resultado.id || (resultado.ids && resultado.ids[0]) || '';
          return {
            content:
              '✅ *Solicitação criada com sucesso!*\n\n' +
              (idCriado ? `📌 ID: *${idCriado}*\n` : '') +
              `Status: *aguardando aprovação*\n\n` +
              'Você pode acompanhar pelo sistema de compras na intranet.'
          };
        } else {
          return {
            content: `⚠️ Não foi possível criar a solicitação: ${resultado?.error || 'erro desconhecido'}.\nTente novamente pelo sistema ou digite *iniciar compra*.`
          };
        }
      } catch (err) {
        console.error('[WhatsApp/Compras] erro ao criar solicitação:', err);
        comprasFlowState.delete(phoneDigits);
        return { content: '⚠️ Erro ao processar a solicitação. Tente novamente mais tarde.' };
      }
    }

    default: {
      comprasFlowState.delete(phoneDigits);
      return null;
    }
  }
}

async function gerarRespostaAutomaticaWhatsapp({ phone = '', profileName = '', userMessage = '', historyRows = [] }) {
  const phoneDigits = normalizePhoneDigits(phone);
  const userLabel = String(profileName || '').trim() || phoneDigits || 'Tecnico WhatsApp';
  const sanitizedMessages = (Array.isArray(historyRows) ? historyRows : [])
    .slice(-25)
    .map((row) => ({
      role: row?.direction === 'outbound' ? 'assistant' : 'user',
      content: String(row?.message_text || '').trim().slice(0, 2000)
    }))
    .filter((row) => row.content);

  if (!sanitizedMessages.length && String(userMessage || '').trim()) {
    sanitizedMessages.push({
      role: 'user',
      content: String(userMessage || '').trim().slice(0, 2000)
    });
  }

  // Roteamento interno/externo: se o telefone está cadastrado em auth_user, usa assistente completo
  const contatoInfo = await verificarContatoInterno(phoneDigits);
  const modo = contatoInfo.isInternal ? 'interno' : 'externo';
  const endpoint = contatoInfo.isInternal
    ? `http://localhost:${process.env.PORT || 5001}/api/ai/chat`
    : `http://localhost:${process.env.PORT || 5001}/api/ai/manual-chat`;
  const source = contatoInfo.isInternal ? 'whatsapp_interno' : 'manual_tecnico_portal_at';
  const chatbotUser = contatoInfo.isInternal && contatoInfo.username
    ? contatoInfo.username
    : userLabel;

  console.log(`[WhatsApp] roteamento: modo=${modo}, phone=${phoneDigits}, user=${chatbotUser}, endpoint=${contatoInfo.isInternal ? '/api/ai/chat' : '/api/ai/manual-chat'}`);

  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: phoneDigits ? `whatsapp_${phoneDigits}` : undefined,
        source,
        chatbotUser,
        chatbotToken: phoneDigits || userLabel,
        messages: sanitizedMessages
      })
    },
    30000
  );

  const payload = await resp.json().catch(() => ({}));
  const content = String(payload?.content || payload?.error || '').trim();
  const manualPreviews = Array.isArray(payload?.manualPreviews) ? payload.manualPreviews : [];

  if (!resp.ok) {
    throw new Error(content || `Falha ao consultar ${contatoInfo.isInternal ? 'chat' : 'manual-chat'} (${resp.status})`);
  }
  if (!content) {
    throw new Error(`O ${contatoInfo.isInternal ? 'chat' : 'manual-chat'} não retornou conteúdo.`);
  }
  return {
    content,
    manualPreviews,
    modo
  };
}

/**
 * Decide quais botões de follow-up enviar ao usuário no WhatsApp.
 * Retorna array de { id, title } (máx. 3, títulos <= 20 chars).
 * Retorna [] se não for necessário enviar botões.
 */
function gerarBotoesFollowUpWhatsapp(resposta, pergunta, manualPreviews = []) {
  const respostaNorm = String(resposta || '').toLowerCase();
  const perguntaNorm = String(pergunta || '').toLowerCase();

  // Não envia botões se a resposta é de erro ou muito curta
  if (respostaNorm.length < 60) return [];
  if (/não encontrei|não consegui|erro|falha|não configurado/i.test(respostaNorm) && respostaNorm.length < 200) return [];

  // Não envia botões se o usuário já pediu mídia (manual/imagem/documento)
  if (/me envie|envie o manual|envie a imagem|envie uma imagem|envie o documento/i.test(perguntaNorm)) return [];

  const botoes = [];

  // Botão de imagem se tiver fonte/página referenciada
  if (/fonte:|página|pagina/i.test(respostaNorm) && manualPreviews.length) {
    botoes.push({ id: 'btn_imagem', title: 'Enviar imagem' });
  }

  // Botão do manual se tiver previews disponíveis
  if (manualPreviews.length && botoes.length < 3) {
    botoes.push({ id: 'btn_manual', title: 'Enviar o manual' });
  }

  // Botão para dúvida sobre outro modelo (se já respondeu sobre um)
  if (botoes.length < 3) {
    botoes.push({ id: 'btn_outro', title: 'Outro modelo' });
  }

  return botoes.slice(0, 3);
}

async function enviarRespostaWhatsappComMidia({
  phoneDigits,
  profileName = 'Chatbot Fromtherm',
  phoneNumberId,
  displayPhoneNumber,
  requestText = '',
  replyData
}) {
  const content = String(
    typeof replyData === 'string'
      ? replyData
      : replyData?.content
  ).trim();
  const manualPreviews = Array.isArray(replyData?.manualPreviews) ? replyData.manualPreviews : [];

  if (!content) {
    throw new Error('Resposta do chatbot vazia.');
  }

  const sendPayload = await enviarMensagemWhatsappTexto({
    phoneNumberId,
    toPhone: phoneDigits,
    text: content
  });

  const outboundMessageId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
  await insertWhatsappMessageRecord({
    waMessageId: outboundMessageId,
    phone: phoneDigits,
    profileName,
    messageType: 'text',
    messageText: content,
    phoneNumberId,
    displayPhoneNumber,
    payload: {
      ...sendPayload,
      manualPreviews
    },
    direction: 'outbound'
  });

  const requestedMedia = whatsappUserRequestedMedia(requestText);
  if (!requestedMedia || !manualPreviews.length) {
    // Envia botões de follow-up se for uma resposta de manual
    try {
      const botoes = gerarBotoesFollowUpWhatsapp(content, requestText, manualPreviews);
      if (botoes.length) {
        await enviarMensagemWhatsappComBotoes({
          phoneNumberId,
          toPhone: phoneDigits,
          bodyText: 'Posso ajudar com mais alguma coisa?',
          buttons: botoes
        });
      }
    } catch (btnErr) {
      console.warn('[SAC/WhatsApp] falha ao enviar botões follow-up:', btnErr?.message || btnErr);
    }

    return {
      outboundMessageId,
      sendPayload,
      mediaPayloads: []
    };
  }

  const selectedPreview = manualPreviews[0] || null;
  const mediaPayloads = [];
  const requestedImage = whatsappUserRequestedImage(requestText);

  if (requestedImage && selectedPreview?.imageUrl) {
    const imagePayload = await enviarMensagemWhatsappImagem({
      phoneNumberId,
      toPhone: phoneDigits,
      imageUrl: selectedPreview.imageUrl,
      caption: `${selectedPreview.manual || 'Manual'}${selectedPreview.page ? ` - página ${selectedPreview.page}` : ''}`
    });
    const imageMessageId = String(imagePayload?.messages?.[0]?.id || '').trim() || null;
    await insertWhatsappMessageRecord({
      waMessageId: imageMessageId,
      phone: phoneDigits,
      profileName,
      messageType: 'image',
      messageText: `${selectedPreview.manual || 'Imagem do manual'}${selectedPreview.page ? ` - página ${selectedPreview.page}` : ''}`,
      phoneNumberId,
      displayPhoneNumber,
      payload: imagePayload,
      direction: 'outbound'
    });
    mediaPayloads.push(imagePayload);
    return { outboundMessageId, sendPayload, mediaPayloads };
  }

  const documentUrl = String(selectedPreview?.openUrl || selectedPreview?.sourceUrl || '').trim();
  if (documentUrl) {
    try {
      const documentPayload = await enviarMensagemWhatsappDocumento({
        phoneNumberId,
        toPhone: phoneDigits,
        documentUrl,
        caption: `${selectedPreview.manual || 'Manual Fromtherm'}${selectedPreview.page ? ` - página ${selectedPreview.page}` : ''}`,
        filename: sanitizeWhatsappMediaFileName(selectedPreview.manual || 'manual_fromtherm', 'pdf')
      });
      const documentMessageId = String(documentPayload?.messages?.[0]?.id || '').trim() || null;
      await insertWhatsappMessageRecord({
        waMessageId: documentMessageId,
        phone: phoneDigits,
        profileName,
        messageType: 'document',
        messageText: `${selectedPreview.manual || 'Manual Fromtherm'}${selectedPreview.page ? ` - página ${selectedPreview.page}` : ''}`,
        phoneNumberId,
        displayPhoneNumber,
        payload: documentPayload,
        direction: 'outbound'
      });
      mediaPayloads.push(documentPayload);
      return { outboundMessageId, sendPayload, mediaPayloads };
    } catch (documentErr) {
      const fallbackLinkPayload = await enviarMensagemWhatsappTexto({
        phoneNumberId,
        toPhone: phoneDigits,
        text: `Link do manual: ${documentUrl}`
      });
      const fallbackMessageId = String(fallbackLinkPayload?.messages?.[0]?.id || '').trim() || null;
      await insertWhatsappMessageRecord({
        waMessageId: fallbackMessageId,
        phone: phoneDigits,
        profileName,
        messageType: 'text',
        messageText: `Link do manual: ${documentUrl}`,
        phoneNumberId,
        displayPhoneNumber,
        payload: fallbackLinkPayload,
        direction: 'outbound'
      });
      mediaPayloads.push(fallbackLinkPayload);
      return { outboundMessageId, sendPayload, mediaPayloads, mediaFallback: documentErr?.message || null };
    }
  }

  return {
    outboundMessageId,
    sendPayload,
    mediaPayloads
  };
}

/* ========================================================================
 *  CONSULTA DE PRODUTO VIA WHATSAPP (info, estoque, imagem)
 * ======================================================================== */

/**
 * Busca produto por código ou termo, com estoque e imagem.
 * Retorna { texto, imageUrl, produto } (detalhe único) ou
 * { tipo: 'lista', texto, produtos, total } (múltiplos resultados) ou null.
 */
async function consultarProdutoDB(termoBusca) {
  const termo = String(termoBusca || '').trim();
  if (termo.length < 2) return null;

  try {
    // 1. Buscar produto — prioriza código exato
    const { rows: exato } = await pool.query(
      `SELECT codigo_produto, codigo, descricao, descr_detalhada, unidade, marca, modelo,
              ncm, ean, descricao_familia, estoque_minimo, quantidade_estoque,
              valor_unitario, peso_bruto, peso_liq, altura, largura, profundidade,
              obs_internas, tipo_compra
       FROM public.produtos_omie
       WHERE UPPER(codigo) = UPPER($1)
       LIMIT 1`,
      [termo]
    );

    // Código exato encontrado → retorna detalhe completo
    if (exato.length) {
      return await montarDetalheProduto(exato[0]);
    }

    // 2. Busca parcial por código ou descrição — pega até 50 para contar total
    const { rows: parcial } = await pool.query(
      `SELECT codigo_produto, codigo, descricao
       FROM public.produtos_omie
       WHERE codigo ILIKE $1 OR descricao ILIKE $1
       ORDER BY CASE WHEN codigo ILIKE $1 THEN 0 ELSE 1 END, descricao ASC
       LIMIT 50`,
      [`%${termo}%`]
    );

    if (!parcial.length) return null;

    // Se apenas 1 resultado, retorna detalhe completo
    if (parcial.length === 1) {
      // Busca dados completos do produto
      const { rows: full } = await pool.query(
        `SELECT codigo_produto, codigo, descricao, descr_detalhada, unidade, marca, modelo,
                ncm, ean, descricao_familia, estoque_minimo, quantidade_estoque,
                valor_unitario, peso_bruto, peso_liq, altura, largura, profundidade,
                obs_internas, tipo_compra
         FROM public.produtos_omie
         WHERE codigo_produto = $1
         LIMIT 1`,
        [parcial[0].codigo_produto]
      );
      if (full.length) return await montarDetalheProduto(full[0]);
      return null;
    }

    // Múltiplos resultados → retorna lista paginável
    return {
      tipo: 'lista',
      produtos: parcial,
      total: parcial.length
    };
  } catch (err) {
    console.error('[WhatsApp/Produto] erro ao consultar produto:', err?.message || err);
    return null;
  }
}

/**
 * Monta o texto formatado com detalhes completos de um produto único (estoque + imagem).
 */
async function montarDetalheProduto(produto) {
  try {
    // Buscar estoque por local
    const { rows: estoqueRows } = await pool.query(
      `SELECT e.local_codigo, e.saldo, e.fisico, e.reservado, e.pendente,
              COALESCE(l.nome, e.local_nome, e.local_codigo) AS local_nome
       FROM logistica.estoque_atual e
       LEFT JOIN public.omie_locais_estoque l ON l.local_codigo = e.local_codigo
       WHERE e.omie_prod_id = $1 AND e.saldo > 0
       ORDER BY l.nome ASC`,
      [produto.codigo_produto]
    );

    // Buscar imagem
    const { rows: imgRows } = await pool.query(
      `SELECT url_imagem FROM public.produtos_omie_imagens
       WHERE codigo_produto = $1 AND ativo = true AND url_imagem IS NOT NULL AND url_imagem != ''
       ORDER BY pos ASC LIMIT 1`,
      [String(produto.codigo_produto)]
    );
    const imageUrl = imgRows.length ? imgRows[0].url_imagem : null;

    // Montar texto formatado
    let texto = `📦 *${produto.codigo}* — ${produto.descricao}\n\n`;

    // Características
    const detalhes = [];
    if (produto.descr_detalhada) detalhes.push(`📝 ${produto.descr_detalhada}`);
    if (produto.unidade) detalhes.push(`📏 Unidade: ${produto.unidade}`);
    if (produto.marca) detalhes.push(`🏷️ Marca: ${produto.marca}`);
    if (produto.modelo) detalhes.push(`🔧 Modelo: ${produto.modelo}`);
    if (produto.descricao_familia) detalhes.push(`📂 Família: ${produto.descricao_familia}`);
    if (produto.ncm && produto.ncm !== '0000.00.00') detalhes.push(`📋 NCM: ${produto.ncm}`);
    if (produto.ean) detalhes.push(`🔢 EAN: ${produto.ean}`);
    const pesoB = parseFloat(produto.peso_bruto || 0);
    const pesoL = parseFloat(produto.peso_liq || 0);
    if (pesoB > 0 || pesoL > 0) {
      const pesos = [];
      if (pesoB > 0) pesos.push(`Bruto: ${pesoB} kg`);
      if (pesoL > 0) pesos.push(`Líquido: ${pesoL} kg`);
      detalhes.push(`⚖️ Peso: ${pesos.join(' | ')}`);
    }
    const alt = parseFloat(produto.altura || 0);
    const larg = parseFloat(produto.largura || 0);
    const prof = parseFloat(produto.profundidade || 0);
    if (alt > 0 || larg > 0 || prof > 0) {
      detalhes.push(`📐 Dimensões: ${alt} x ${larg} x ${prof} (A×L×P)`);
    }
    if (detalhes.length) texto += detalhes.join('\n') + '\n\n';

    // Estoque
    if (estoqueRows.length) {
      texto += '📊 *Estoque atual:*\n';
      let totalGeral = 0;
      for (const e of estoqueRows) {
        const saldo = parseFloat(e.saldo || 0);
        totalGeral += saldo;
        const reservado = parseFloat(e.reservado || 0);
        texto += `  • ${e.local_nome}: *${saldo}* un.`;
        if (reservado > 0) texto += ` (${reservado} reserv.)`;
        texto += '\n';
      }
      if (estoqueRows.length > 1) {
        texto += `  📍 *Total geral: ${totalGeral} un.*\n`;
      }
    } else {
      texto += '📊 Estoque: _sem saldo em estoque_\n';
    }

    // Imagem disponível?
    if (imageUrl) {
      texto += '\n📷 _Imagem disponível. Clique em *"ver foto"* para recebê-la._';
    }

    return { texto, imageUrl, produto };
  } catch (err) {
    console.error('[WhatsApp/Produto] erro ao montar detalhe:', err?.message || err);
    return null;
  }
}

/**
 * Formata uma página de resultados da lista de produtos.
 */
function formatarListaProdutos(produtos, offset, total) {
  const PAGE_SIZE = 5;
  const pagina = produtos.slice(offset, offset + PAGE_SIZE);
  const fim = Math.min(offset + PAGE_SIZE, total);

  let texto = `🔍 Encontrei *${total}* produto(s). Mostrando *${offset + 1}-${fim}*:\n\n`;
  pagina.forEach((p, i) => {
    texto += `*${offset + i + 1}.* \`${p.codigo}\` — ${p.descricao}\n`;
  });
  texto += '\n📌 Responda com o *número* do produto para ver detalhes completos.';
  if (fim < total) {
    texto += '\n➡️ Responda *"ver mais"* para ver os próximos.';
  }
  return texto;
}

/**
 * Envia lista de produtos como Interactive List Message do WhatsApp.
 * Rows: até 5 produtos + seção "Navegação" com Ver mais / Voltar ao menu.
 */
async function enviarListaProdutosInterativa({ phoneNumberId, toPhone, displayPhoneNumber, produtos, offset }) {
  const PAGE_SIZE = 5;
  const pagina = produtos.slice(offset, offset + PAGE_SIZE);
  const total = produtos.length;
  const fim = Math.min(offset + PAGE_SIZE, total);
  const temMais = fim < total;

  // Rows dos produtos
  const rowsProdutos = pagina.map((p, i) => {
    const idx = offset + i + 1;
    const titulo = String(p.codigo || '').slice(0, 24);
    const descricao = String(p.descricao || '').slice(0, 72);
    return { id: `produto_sel_${idx}`, title: titulo || `Produto ${idx}`, description: descricao };
  });

  // Seção de navegação
  const rowsNav = [];
  if (temMais) {
    rowsNav.push({ id: 'produto_ver_mais', title: 'Ver mais ➡️', description: `Próximos resultados (${fim + 1}–${Math.min(fim + PAGE_SIZE, total)})` });
  }
  rowsNav.push({ id: 'menu_voltar', title: '🏠 Voltar ao menu', description: 'Encerrar consulta de produtos' });

  const sections = [
    { title: `Produtos (${offset + 1}–${fim} de ${total})`, rows: rowsProdutos },
    { title: 'Navegação', rows: rowsNav }
  ];

  const sendPayload = await enviarMensagemWhatsappLista({
    phoneNumberId, toPhone,
    headerText: 'Consulta de Produto',
    bodyText: `🔍 Encontrei *${total}* produto(s). Selecione para ver detalhes:`,
    footerText: `Mostrando ${offset + 1}–${fim}`,
    buttonText: 'Ver produtos',
    sections
  });
  const outMsgId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
  await insertWhatsappMessageRecord({
    waMessageId: outMsgId, phone: toPhone, profileName: 'Chatbot Fromtherm',
    messageType: 'interactive', messageText: `Lista produtos ${offset + 1}-${fim} de ${total}`,
    phoneNumberId, displayPhoneNumber, payload: sendPayload, direction: 'outbound'
  });
  return { sendPayload, outMsgId };
}

// Cache temporário para último produto consultado por telefone (para "ver foto")
const ultimoProdutoConsultado = new Map(); // key: phoneDigits, value: { imageUrl, codigo, updatedAt }
const PRODUTO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

// Cache de busca de produtos para paginação (para "ver mais" e seleção por número)
const ultimaBuscaProdutos = new Map(); // key: phoneDigits, value: { termo, produtos, offset, updatedAt }

function limparCacheProdutos() {
  const agora = Date.now();
  for (const [phone, info] of ultimoProdutoConsultado) {
    if (agora - info.updatedAt > PRODUTO_CACHE_TTL_MS) ultimoProdutoConsultado.delete(phone);
  }
  for (const [phone, info] of ultimaBuscaProdutos) {
    if (agora - info.updatedAt > PRODUTO_CACHE_TTL_MS) ultimaBuscaProdutos.delete(phone);
  }
}
setInterval(limparCacheProdutos, 5 * 60 * 1000);

/**
 * Detecta se o user quer ver a foto do último produto consultado.
 */
function detectarPedidoFotoProduto(texto) {
  if (!texto) return false;
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return /\b(ver foto|enviar? foto|mostrar? foto|enviar? imagem|ver imagem|mostrar? imagem|foto do produto|imagem do produto)\b/i.test(t);
}

/**
 * Detecta se o user quer ver mais resultados da busca de produtos.
 */
function detectarPedidoVerMais(texto) {
  if (!texto) return false;
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return /\b(ver mais|mostrar mais|mais produtos|proxim[oa]s?|proxima lista|listar mais|continuar lista)\b/i.test(t);
}

/**
 * Detecta seleção de produto por número (ex: "1", "3", "produto 2", "#5").
 * Retorna o número ou null.
 */
function detectarSelecaoProdutoLista(texto) {
  if (!texto) return null;
  const t = texto.trim();
  const m = t.match(/^(?:#|produto\s*)?(\d{1,2})$/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 50) return n;
  }
  return null;
}

/**
 * Detecta intenção de consulta de produto e extrai o termo de busca.
 * Retorna o termo ou null.
 */
function detectarConsultaProduto(texto) {
  if (!texto) return null;
  const t = texto.trim();

  // Padrão 1: "consultar produto X", "buscar produto X", "verificar produto X"
  // Aceita artigos, typos comuns (ptoduto/priduto/produtoo) e "um/o/esse"
  const m1 = t.match(/\b(?:consultar?|buscar?|pesquisar?|verificar?)\s+(?:um\s+|o\s+|esse\s+)?p\w{3,7}t[oa]?\s*[,:]?\s*(?:se\s+chama\s*|chamad[oa]\s*|que\s+[eé]\s*|nome\s*[:\-]?\s*)?(.+)/i);
  if (m1) return m1[1].trim().replace(/\?$/, '');

  // Padrão 2: "quero saber do/sobre produto X", "me fala do produto X", "preciso do produto X"
  const m2 = t.match(/\b(?:quero\s+saber|me\s+fal[ae]|preciso|gostaria\s+de\s+saber)\s+(?:d[oe]|sobre)\s+(?:um\s+|o\s+)?p[ro]+d[uo]t[oa]?\s*[:\-]?\s*(.+)/i);
  if (m2) return m2[1].trim().replace(/\?$/, '');

  // Padrão 3: "informação/info/dados do produto X", "estoque do produto X"
  const m3 = t.match(/\b(?:info(?:rma[çc][aã]o)?|dados?|estoque|detalh[ei]s?)\s+(?:do|de|sobre)\s+(?:o\s+)?p[ro]+d[uo]t[oa]?\s*[:\-]?\s*(.+)/i);
  if (m3) return m3[1].trim().replace(/\?$/, '');

  // Padrão 4: "produto X" ou "código X" no início (flexível com typos)
  const m4 = t.match(/^(?:p[ro]+d[uo]t[oa]?|c[oó]digo|cod\.?)\s+[:\-]?\s*(.{2,})/i);
  if (m4) return m4[1].trim().replace(/\?$/, '');

  // Padrão 5: "qual o estoque de X", "estoque de X", "estoque do X"
  const m5 = t.match(/\b(?:qual\s+(?:o\s+)?)?estoque\s+(?:de|do|d[oa])\s+(.+)/i);
  if (m5) return m5[1].trim().replace(/\?$/, '');

  // Padrão 6: "tem X em estoque", "tem X no estoque"
  const m6 = t.match(/\btem\s+(.+?)\s+(?:em|no)\s+estoque/i);
  if (m6) return m6[1].trim().replace(/\?$/, '');

  // Padrão 7: "produto" + "se chama/chamado/é" + nome (ex: "o produto se chama contatora")
  const m7 = t.match(/\bp[ro]+d[uo]t[oa]?\s*[,:]?\s*(?:se\s+chama|chamad[oa]|que\s+[eé]|nome\s*[:\-]?)\s+(.+)/i);
  if (m7) return m7[1].trim().replace(/\?$/, '');

  // Padrão 8: Variações soltas "quero saber sobre X", "me fala sobre X" (sem "produto")
  const m8 = t.match(/\b(?:quero\s+saber|me\s+fal[ae])\s+(?:d[oe]|sobre)\s+(?:um\s+|o\s+|a\s+)?(.{3,})/i);
  if (m8) {
    const candidato = m8[1].trim().replace(/\?$/, '');
    // Só aceita se parece nome de produto (não é frase longa de conversa)
    if (candidato.split(/\s+/).length <= 8) return candidato;
  }

  return null;
}

/**
 * Detecta se o texto é um código de produto solto (ex: "07.MP.N.62031").
 * Padrão: XX.XX.X.XXXXX ou similar com pontos e letras/números.
 */
function detectarCodigoProdutoSolto(texto) {
  if (!texto) return null;
  const t = texto.trim();
  // Código com formato típico: segmentos alfanuméricos separados por ponto ou hífen
  // Ex: 07.MP.N.62031, 04.MP.I.60604, 01.MP.N.30071
  if (/^[\w]{1,5}[.\-][\w]{1,5}[.\-][\w]{1,5}(?:[.\-][\w]{1,10})?$/i.test(t)) {
    return t;
  }
  return null;
}

async function processarRespostaAutomaticaWhatsapp({ phone, profileName, messageText, waMessageId, phoneNumberId, displayPhoneNumber, buttonReplyId, listReplyId }) {
  if (!WHATSAPP_CHATBOT_AUTOREPLY_ENABLED) return;
  const phoneDigits = normalizePhoneDigits(phone);
  const userText = String(messageText || '').trim();
  if (!phoneDigits || !userText) return;

  // Envia indicador de "digitando..." + marca como lida
  if (waMessageId && phoneNumberId) {
    enviarTypingIndicator({ phoneNumberId, messageId: waMessageId }).catch(() => {});
  }

  // Verificar contato interno
  const contatoInfo = await verificarContatoInterno(phoneDigits);

  // Helper para enviar texto e registrar no banco
  async function enviarTextoERegistrar(texto, logMode) {
    const sendPayload = await enviarMensagemWhatsappTexto({ phoneNumberId, toPhone: phoneDigits, text: texto });
    const outMsgId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
    await insertWhatsappMessageRecord({
      waMessageId: outMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm',
      messageType: 'text', messageText: texto,
      phoneNumberId, displayPhoneNumber, payload: sendPayload, direction: 'outbound'
    });
    if (logMode) console.log(`[WhatsApp] ${logMode}:`, JSON.stringify({ to_phone: phoneDigits, outbound_message_id: outMsgId }));
    return { sendPayload, outMsgId };
  }

  // ─── Helpers de Manual de Instrução ────────────────────────────────────────

  /** Busca e envia a lista de TODOS os manuais disponíveis como Interactive List */
  async function enviarListaTodosManuais() {
    const { rows: manuais } = await pool.query(`
      SELECT id, nome_arquivo, nome_arquivo_normalizado, paginas
      FROM "Chatbot".manuais_instrucao
      ORDER BY nome_arquivo ASC
    `);
    if (manuais.length === 0) {
      await enviarTextoERegistrar('⚠️ Nenhum manual disponível no momento.', 'manual lista vazia');
      return null;
    }
    // Monta rows: title limitado a 24 chars (restrição WhatsApp), nome completo em description
    const allRows = manuais.map(m => {
      const fullName = m.nome_arquivo_normalizado || m.nome_arquivo;
      return {
        id: 'msel_' + m.id,
        title: fullName.slice(0, 24),
        description: `${fullName} · ${m.paginas || '?'}p`.slice(0, 72)
      };
    });
    allRows.push({ id: 'menu_voltar', title: 'Menu principal', description: 'Voltar ao menu' });
    // Divide em seções de 10 (restrição WhatsApp)
    const sections = [];
    for (let i = 0; i < allRows.length; i += 10) {
      sections.push({
        title: sections.length === 0 ? 'Manuais disponíveis' : 'Mais manuais',
        rows: allRows.slice(i, i + 10)
      });
    }
    const mpSend = await enviarMensagemWhatsappLista({
      phoneNumberId, toPhone: phoneDigits,
      headerText: '📖 Manual de Instrução',
      bodyText: 'Selecione o equipamento para ver o manual:',
      footerText: 'Toque no botão para ver os manuais',
      buttonText: 'Ver manuais',
      sections
    });
    const mpId = String(mpSend?.messages?.[0]?.id || '').trim() || null;
    await insertWhatsappMessageRecord({ waMessageId: mpId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Lista todos manuais', phoneNumberId, displayPhoneNumber, payload: mpSend, direction: 'outbound' });
    return manuais;
  }

  /** Busca manuais pelo modelo digitado (match normalizado sem especiais) */
  async function buscarManuaisPorModelo(modeloDigitado) {
    const term = modeloDigitado.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!term || term.length < 2) return [];

    // Estratégia 1: busca direta pelo nome normalizado do manual (match exato)
    const queryNome = `
      SELECT id, nome_arquivo, caminho_manual, paginas
      FROM "Chatbot".manuais_instrucao
      WHERE regexp_replace(lower(nome_arquivo), '[^a-z0-9]', '', 'g') ILIKE $1
         OR regexp_replace(lower(nome_arquivo_normalizado), '[^a-z0-9]', '', 'g') ILIKE $1
      ORDER BY length(nome_arquivo) ASC LIMIT 8
    `;
    const { rows: byName } = await pool.query(queryNome, [`%${term}%`]);
    if (byName.length > 0) return byName;

    // Estratégia 2: busca progressiva por prefixo (encurta 1 char por vez até 4)
    // Ex: "ft180f40t" → "ft180f40" → ... → "ft180" → match!
    for (let len = term.length - 1; len >= 4; len--) {
      const subTerm = term.slice(0, len);
      const { rows } = await pool.query(queryNome, [`%${subTerm}%`]);
      if (rows.length > 0) return rows;
    }

    // Estratégia 3: busca via public.produtos_omie por código/descrição
    // → encontra o codigo_produto → encontra manuais que têm aquele produto no JSONB
    const { rows: produtos } = await pool.query(`
      SELECT DISTINCT codigo_produto FROM public.produtos_omie
      WHERE codigo ILIKE $1 OR descricao ILIKE $1
      LIMIT 30
    `, [`%${modeloDigitado}%`]);
    if (produtos.length > 0) {
      const cpIds = produtos.map(p => String(p.codigo_produto));
      const { rows: byProduto } = await pool.query(`
        SELECT id, nome_arquivo, caminho_manual, paginas
        FROM "Chatbot".manuais_instrucao
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(produtos) AS cp
          WHERE cp = ANY($1::text[])
        )
        ORDER BY length(nome_arquivo) ASC LIMIT 8
      `, [cpIds]);
      if (byProduto.length > 0) return byProduto;
    }

    return [];
  }

  /** Parseia o sumário de um manual a partir dos chunks de texto */
  async function parsearSumarioManual(manualId) {
    const { rows } = await pool.query(`
      SELECT texto FROM "Chatbot".manuais_instrucao_chunks
      WHERE manual_id = $1 ORDER BY chunk_ordem
    `, [manualId]);
    const fullText = rows.map(r => r.texto).join('\n');
    const sumIdx = fullText.search(/SUMÁRIO|SUMARIO/i);
    if (sumIdx === -1) return [];
    const sumText = fullText.slice(sumIdx, sumIdx + 10000);
    const entriesMap = new Map();
    // Padrão 1: separador longo de pontos/espaços ("TÍTULO ......... 04")
    const p1 = /^\s*(\d+(?:\.\d+)*)\.?\s+([^\n]{3,80}?)[\s.]{8,}(\d+)\s*$/gm;
    // Padrão 2: sem separador de pontos, só espaço antes do número ("TÍTULO 23")
    const p2 = /^\s*(\d+(?:\.\d+)*)\.?\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇÜ][^\n]{5,80})\s(\d{2,3})\s*$/gm;
    for (const pattern of [p1, p2]) {
      let m;
      while ((m = pattern.exec(sumText)) !== null) {
        const [, num, title, page] = m;
        const cleaned = title.trim().replace(/\s+/g, ' ');
        if (cleaned.length < 3) continue;
        const key = num.trim();
        if (!entriesMap.has(key)) {
          entriesMap.set(key, { num: key, title: cleaned, page: parseInt(page, 10), depth: key.split('.').length });
        }
        if (entriesMap.size > 150) break;
      }
    }
    // Ordena pela hierarquia numérica
    return [...entriesMap.values()].sort((a, b) => {
      const aParts = a.num.split('.').map(Number);
      const bParts = b.num.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const diff = (aParts[i] || 0) - (bParts[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
  }

  /** Busca o texto dos chunks de um manual para um intervalo de páginas */
  async function buscarConteudoSecao(manualId, paginaInicio, paginaFim) {
    let rows;
    if (paginaInicio < paginaFim) {
      const res = await pool.query(`
        SELECT texto FROM "Chatbot".manuais_instrucao_chunks
        WHERE manual_id = $1 AND pagina_inicial >= $2 AND pagina_inicial <= $3
        ORDER BY chunk_ordem LIMIT 12
      `, [manualId, paginaInicio, paginaFim]);
      rows = res.rows;
    } else {
      // Mesma página: só os 2 primeiros chunks para não misturar seções
      const res = await pool.query(`
        SELECT texto FROM "Chatbot".manuais_instrucao_chunks
        WHERE manual_id = $1 AND pagina_inicial = $2
        ORDER BY chunk_ordem LIMIT 2
      `, [manualId, paginaInicio]);
      rows = res.rows;
    }
    if (!rows.length) return null;
    let conteudo = rows.map(r => r.texto.trim()).join('\n\n');
    if (conteudo.length > 3000) conteudo = conteudo.slice(0, 3000) + '\n\n_[...continua no manual]_';
    return conteudo;
  }

  /** Busca resposta para uma dúvida textual nos chunks de um manual */
  async function buscarRespostaManualPorDuvida(manualId, duvida) {
    const stopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'e', 'em', 'para', 'por', 'com', 'sem', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'que']);
    const normalizar = (txt) => String(txt || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const duvidaNorm = normalizar(duvida).trim();
    if (!duvidaNorm) return [];

    const tokens = [...new Set(
      duvidaNorm
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3 && !stopwords.has(t))
    )].slice(0, 8);

    const { rows } = await pool.query(`
      SELECT texto, pagina_inicial, chunk_ordem
      FROM "Chatbot".manuais_instrucao_chunks
      WHERE manual_id = $1
      ORDER BY chunk_ordem
      LIMIT 800
    `, [manualId]);

    const scored = rows.map(r => {
      const txt = String(r.texto || '');
      const txtNorm = normalizar(txt);
      let score = 0;

      if (txtNorm.includes(duvidaNorm)) score += 10;
      for (const tk of tokens) {
        if (txtNorm.includes(tk)) score += 2;
      }
      // Bônus para chunks que têm dois ou mais termos da dúvida
      const termosBatidos = tokens.filter(tk => txtNorm.includes(tk)).length;
      if (termosBatidos >= 2) score += 3;

      return {
        pagina: r.pagina_inicial,
        texto: txt.replace(/\s+/g, ' ').trim(),
        score
      };
    })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(r => ({
        pagina: r.pagina,
        texto: r.texto.length > 900 ? r.texto.slice(0, 900) + ' ...' : r.texto
      }));

    return scored;
  }

  /** Envia o sumário (ou sub-nível) como Interactive List Message */
  async function enviarSumarioComoLista(sumario, parentNum, nomeManual) {
    // Sanitiza texto do PDF (remove chars de controle, normaliza espaços)
    const sanitizeWA = (text) => String(text || '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    let filteredItems;
    if (parentNum === null) {
      filteredItems = sumario.filter(e => e.depth === 1);
    } else {
      const parentDepth = parentNum.split('.').length;
      filteredItems = sumario.filter(e => e.depth === parentDepth + 1 && e.num.startsWith(parentNum + '.'));
    }

    // Limita a 8 itens de conteúdo (WhatsApp: max 10 rows por lista; nav ocupa 1-2 slots)
    const MAX_CONTENT = 8;
    const contentItems = filteredItems.slice(0, MAX_CONTENT);
    const hasMore = filteredItems.length > MAX_CONTENT;

    const rowsData = contentItems.map(e => {
      const label = sanitizeWA(`${e.num}. ${e.title}`);
      return {
        id: 'msec_' + e.num.replace(/\./g, '_'),
        title: label.length > 24 ? label.slice(0, 21) + '...' : label,
        description: `Pagina ${e.page}`
      };
    });

    // Nav buttons (sem emoji para evitar contagem de bytes pelo WhatsApp)
    if (parentNum !== null) {
      rowsData.unshift({ id: 'msec_voltar', title: '< Voltar', description: 'Nivel anterior' });
    } else {
      rowsData.push({ id: 'msel_voltar_lista', title: 'Outros manuais', description: 'Ver lista completa' });
      rowsData.push({ id: 'menu_voltar', title: 'Menu principal', description: 'Voltar ao menu' });
    }

    // Seção única (mais seguro e dentro do limite de 10 rows do WhatsApp)
    const sectionTitle = parentNum ? `Secao ${parentNum}` : 'Capitulos';
    const sections = [{ title: sectionTitle, rows: rowsData.slice(0, 10) }];

    const parentEntry = parentNum ? sumario.find(e => e.num === parentNum) : null;
    const nomeClean = sanitizeWA(nomeManual).slice(0, 60);
    const parentTitleClean = parentEntry ? sanitizeWA(parentEntry.title) : '';
    const bodyText = parentEntry
      ? `*${parentNum}. ${parentTitleClean}*\n\nEscolha um subcapitulo:`
      : `*${nomeClean}*\n\nEscolha um capitulo para ler:${hasMore ? ` (${filteredItems.length} no total)` : ''}`;

    console.log(`[Manual] sumario parseado: ${sumario.length} entries, depth-1: ${filteredItems.length}, exibindo: ${contentItems.length}`);

    const sendPayload = await enviarMensagemWhatsappLista({
      phoneNumberId, toPhone: phoneDigits,
      headerText: 'Manual de Instrucao',
      bodyText,
      footerText: hasMore ? `Exibindo ${contentItems.length} de ${filteredItems.length} capitulos` : 'Toque para ver o sumario',
      buttonText: 'Ver sumario',
      sections
    });
    const outMsgId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
    await insertWhatsappMessageRecord({
      waMessageId: outMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm',
      messageType: 'interactive', messageText: `Sumario manual ${parentNum || 'principal'}`,
      phoneNumberId, displayPhoneNumber, payload: sendPayload, direction: 'outbound'
    });
    return { sendPayload, outMsgId };
  }

  /** Consulta pedido de venda por numero_pedido em "Vendas".pedidos_venda + itens */
  async function consultarVendaPorNumeroPedido(numeroPedido) {
    const numero = String(numeroPedido || '').trim();
    if (!numero) return { ok: false, error: 'Número do pedido não informado.' };

    const { rows: pedRows } = await pool.query(`
      SELECT
        codigo_pedido,
        numero_pedido,
        etapa,
        data_previsao,
        valor_total_pedido,
        codigo_cliente,
        numero_pedido_cliente,
        updated_at
      FROM "Vendas".pedidos_venda
      WHERE numero_pedido = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `, [numero]);

    if (!pedRows.length) {
      return { ok: false, error: `Pedido ${numero} não encontrado em vendas.` };
    }

    const pedido = pedRows[0];
    const { rows: itemRows } = await pool.query(`
      SELECT
        seq, codigo, descricao, unidade, quantidade, valor_unitario, valor_total
      FROM "Vendas".pedidos_venda_itens
      WHERE codigo_pedido = $1
      ORDER BY seq ASC
    `, [pedido.codigo_pedido]);

    return { ok: true, pedido, itens: itemRows };
  }

  /** Consulta NFe/NFSe já recebida por webhook no schema "Vendas" */
  async function consultarNfeVendaPorNumero(numeroNfe) {
    const numeroNorm = String(numeroNfe || '').replace(/\D/g, '').replace(/^0+/, '') || '0';
    const { rows } = await pool.query(`
      SELECT
        id,
        tipo_documento,
        topic_ultimo,
        status_ultimo,
        numero_nota,
        chave_nfe,
        numero_pedido,
        valor_total,
        cnpj_emitente,
        razao_emitente,
        data_emissao,
        updated_at
      FROM "Vendas".notas_fiscais_omie
      WHERE regexp_replace(COALESCE(numero_nota, ''), '[^0-9]', '', 'g') <> ''
        AND LTRIM(regexp_replace(COALESCE(numero_nota, ''), '[^0-9]', '', 'g'), '0') = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `, [numeroNorm]);

    if (!rows.length) return { ok: false, error: `NFe/NFSe ${numeroNfe} não encontrada na base de vendas.` };
    return { ok: true, nota: rows[0] };
  }

  async function consultarNfeVendaPorPedido(codigoPedido, numeroPedido) {
    const codigo = String(codigoPedido || '').trim();
    const numero = String(numeroPedido || '').trim();
    if (!codigo && !numero) return { ok: false, error: 'Pedido sem código/numero para localizar NFe.' };

    const candidatos = [codigo, numero].filter(Boolean);
    const { rows } = await pool.query(`
      SELECT
        id,
        tipo_documento,
        topic_ultimo,
        status_ultimo,
        numero_nota,
        chave_nfe,
        numero_pedido,
        valor_total,
        cnpj_emitente,
        razao_emitente,
        data_emissao,
        updated_at
      FROM "Vendas".notas_fiscais_omie
      WHERE COALESCE(numero_pedido, '') = ANY($1::text[])
        AND COALESCE(chave_nfe, '') <> ''
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `, [candidatos]);

    if (!rows.length) {
      return { ok: false, error: `NFe não encontrada para o pedido ${numero || codigo}.` };
    }
    return { ok: true, nota: rows[0] };
  }

  let omieConsultaVendaNextAtMs = 0;
  const OMIE_CONSULTA_INTERVALO_MS = 1200;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function extrairCooldownRedundant(msg) {
    const m = String(msg || '').match(/aguarde\s*(\d+)\s*segundos?/i);
    const seg = m ? Number(m[1]) : 0;
    return Number.isFinite(seg) && seg > 0 ? seg : 1;
  }

  async function aguardarSlotOmieConsultaVenda() {
    const agora = Date.now();
    if (agora < omieConsultaVendaNextAtMs) {
      await sleep(omieConsultaVendaNextAtMs - agora);
    }
    omieConsultaVendaNextAtMs = Date.now() + OMIE_CONSULTA_INTERVALO_MS;
  }

  async function omieCallJson(url, call, param = []) {
    const appKey = String(process.env.OMIE_APP_KEY || '').trim();
    const appSecret = String(process.env.OMIE_APP_SECRET || '').trim();
    if (!appKey || !appSecret) {
      throw new Error('Credenciais OMIE_APP_KEY/OMIE_APP_SECRET não configuradas.');
    }

    const payload = {
      call,
      app_key: appKey,
      app_secret: appSecret,
      param: Array.isArray(param) ? param : [param]
    };

    let lastError = null;
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      await aguardarSlotOmieConsultaVenda();

      const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }, 30000);

      const data = await resp.json().catch(() => ({}));
      const fault = data?.faultstring || data?.faultcode;
      if (resp.ok && !fault) return data;

      const errMsg = String(fault || `Erro HTTP ${resp.status} em ${call}`);
      lastError = new Error(errMsg);
      const ehRedundant = /redundant|consumo redundante/i.test(errMsg);
      if (!ehRedundant || tentativa >= 3) break;

      const esperaSegundos = extrairCooldownRedundant(errMsg) + 1;
      await sleep(esperaSegundos * 1000);
    }

    throw lastError || new Error(`Falha ao chamar Omie em ${call}`);
  }

  async function obterPdfPedidoVendaOmie(codigoPedido) {
    const nIdPed = Number(codigoPedido);
    if (!Number.isFinite(nIdPed) || nIdPed <= 0) {
      return { ok: false, error: `codigo_pedido inválido: ${codigoPedido}` };
    }
    try {
      const data = await omieCallJson(
        'https://app.omie.com.br/api/v1/produtos/dfedocs/',
        'ObterPedVenda',
        [{ nIdPed }]
      );
      const cPdfPed = String(data?.cPdfPed || '').trim();
      if (!/^https?:\/\//i.test(cPdfPed)) {
        return { ok: false, error: 'Campo cPdfPed não retornado pela Omie.' };
      }
      return { ok: true, cPdfPed };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async function obterPdfNfePorChaveOmie(chaveNfe) {
    const chave = String(chaveNfe || '').trim();
    if (!chave) return { ok: false, error: 'Chave NFe não informada.' };

    try {
      const consulta = await omieCallJson(
        'https://app.omie.com.br/api/v1/produtos/nfconsultar/',
        'ConsultarNF',
        [{ cChaveNFe: chave }]
      );

      const nIdNF = Number(
        consulta?.compl?.nIdNF
        || consulta?.compl?.nIdNf
        || consulta?.nIdNF
        || consulta?.nIdNfe
        || 0
      );

      if (!Number.isFinite(nIdNF) || nIdNF <= 0) {
        return { ok: false, error: 'Não foi possível obter nIdNF no ConsultarNF.' };
      }

      const obterNfe = await omieCallJson(
        'https://app.omie.com.br/api/v1/produtos/dfedocs/',
        'ObterNfe',
        [{ nIdNfe: nIdNF }]
      );

      const cPdf = String(obterNfe?.cPdf || '').trim();
      if (!/^https?:\/\//i.test(cPdf)) {
        return { ok: false, error: 'Campo cPdf não retornado pela Omie.' };
      }

      return { ok: true, cPdf, nIdNF };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  // Helper para enviar menu principal como lista interativa
  async function enviarMenuPrincipal(textoIntro, logMode) {
    const sendPayload = await enviarMensagemWhatsappLista({
      phoneNumberId, toPhone: phoneDigits,
      headerText: 'Chatbot Fromtherm',
      bodyText: textoIntro || 'Como posso ajudar?',
      footerText: 'Selecione uma opção da lista',
      buttonText: 'Menu de opções',
      sections: [{
        title: 'Opções disponíveis',
        rows: [
          { id: 'menu_consultar_produto', title: 'Consultar produto', description: 'Buscar produto por código ou nome' },
          { id: 'menu_realizar_compra', title: 'Realizar compra', description: 'Solicitar compra de material' },
          { id: 'menu_consultar_venda', title: 'Consultar venda', description: 'Consultar pedido e NFe de venda' },
          { id: 'menu_verificar_agenda', title: 'Verificar agenda', description: 'Ver reuniões agendadas' },
          { id: 'menu_verificar_mensagens', title: 'Verificar mensagens', description: 'Ver mensagens não lidas' },
          { id: 'menu_manual_instrucao', title: 'Manual de instrução', description: 'Buscar manual do seu equipamento' }
        ]
      }]
    });
    const outMsgId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
    await insertWhatsappMessageRecord({
      waMessageId: outMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm',
      messageType: 'interactive', messageText: textoIntro || 'Menu principal',
      phoneNumberId, displayPhoneNumber, payload: sendPayload, direction: 'outbound'
    });
    if (logMode) console.log(`[WhatsApp] ${logMode}:`, JSON.stringify({ to_phone: phoneDigits }));
    return { sendPayload, outMsgId };
  }

  // Helper para enviar menu de finalização (texto + lista)
  async function enviarMenuFinalizar(textoResultado, logMode) {
    // Primeiro envia o resultado como texto
    if (textoResultado) {
      await enviarTextoERegistrar(textoResultado, logMode);
    }
    // Depois envia a lista interativa para próxima ação
    await enviarMenuPrincipal('✅ Posso ajudar com mais alguma coisa?', logMode ? logMode + ' → menu' : 'finalizar → menu');
  }

  // Helper para enviar menu externo (somente Manual de instrução)
  async function enviarMenuExterno(textoIntro, logMode) {
    const sendPayload = await enviarMensagemWhatsappLista({
      phoneNumberId, toPhone: phoneDigits,
      headerText: 'Atendimento Fromtherm',
      bodyText: textoIntro || 'Como posso ajudar?',
      footerText: 'Selecione uma opção',
      buttonText: 'Menu de opções',
      sections: [{
        title: 'Opções disponíveis',
        rows: [
          { id: 'menu_manual_instrucao', title: 'Manual de instrução', description: 'Buscar manual do seu equipamento' }
        ]
      }]
    });
    const outMsgId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
    await insertWhatsappMessageRecord({
      waMessageId: outMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm',
      messageType: 'interactive', messageText: textoIntro || 'Menu externo',
      phoneNumberId, displayPhoneNumber, payload: sendPayload, direction: 'outbound'
    });
    if (logMode) console.log(`[WhatsApp] ${logMode}:`, JSON.stringify({ to_phone: phoneDigits }));
    return { sendPayload, outMsgId };
  }

  async function enviarBotoesConsultaPedidoVenda(bodyText) {
    const bPayload = await enviarMensagemWhatsappComBotoes({
      phoneNumberId,
      toPhone: phoneDigits,
      bodyText: bodyText || 'Escolha uma ação para este pedido:',
      buttons: [
        { id: 'venda_btn_abrir_pedido', title: 'Abrir pedido' },
        { id: 'venda_btn_visualizar_nfe', title: 'Visualizar NFe' },
        { id: 'menu_voltar', title: 'Menu principal' }
      ]
    });
    const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
    await insertWhatsappMessageRecord({
      waMessageId: bMsgId,
      phone: phoneDigits,
      profileName: 'Chatbot Fromtherm',
      messageType: 'interactive',
      messageText: 'Ações consulta pedido venda',
      phoneNumberId,
      displayPhoneNumber,
      payload: bPayload,
      direction: 'outbound'
    });
  }

  // Resolve o ID da opção interativa (list ou button) ou texto digitado
  const interactiveId = listReplyId || buttonReplyId || null;

  /* ====================================================================
   *  CONTATOS INTERNOS — SISTEMA DE MENU NUMERADO
   * ==================================================================== */
  if (contatoInfo.isInternal) {
    let menuState = menuInternoState.get(phoneDigits);

    // "0" ou "finalizar" ou "sair do menu" em qualquer fluxo → finaliza e mostra menu
    if (menuState?.fluxo && (/^(0|finalizar|encerrar|voltar|menu|sair)$/i.test(userText) || interactiveId === 'menu_voltar')) {
      // Limpa fluxos ativos
      comprasFlowState.delete(phoneDigits);
      ultimaBuscaProdutos.delete(phoneDigits);
      ultimoProdutoConsultado.delete(phoneDigits);
      menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
      await enviarMenuPrincipal('✅ Assunto finalizado!\n\nPosso ajudar com mais alguma coisa?', 'menu finalizar');
      return;
    }

    // Se está em fluxo de COMPRAS ativo, roteia para o processador de compras
    if (menuState?.fluxo === 'COMPRAS') {
      const comprasReply = await processarFluxoCompras({ phoneDigits, userMessage: userText, contatoInfo, buttonReplyId });
      if (comprasReply) {
        // Verifica se o fluxo terminou (cancelado ou confirmado → comprasFlowState foi deletado)
        const fluxoAinda = comprasFlowState.has(phoneDigits);
        if (!fluxoAinda) {
          // Fluxo terminou — envia resultado + menu
          menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
          await enviarMenuFinalizar(comprasReply.content, 'fluxo compras');
        } else {
          await enviarTextoERegistrar(comprasReply.content, 'fluxo compras');
        }
        return;
      }
      // Se processarFluxoCompras retornou null (não é intenção de compra), volta ao menu
      menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
    }

    // Se está em fluxo de CONSULTA_PRODUTO, processa comandos de produto
    if (menuState?.fluxo === 'CONSULTA_PRODUTO') {
      // Pedido de foto (texto ou botão interativo)
      if (buttonReplyId === 'produto_ver_foto' || detectarPedidoFotoProduto(userText)) {
        const cache = ultimoProdutoConsultado.get(phoneDigits);
        if (cache?.imageUrl) {
          try {
            const imgPayload = await enviarMensagemWhatsappImagem({
              phoneNumberId, toPhone: phoneDigits,
              imageUrl: cache.imageUrl, caption: `📷 Foto: ${cache.codigo}`
            });
            const imgMsgId = String(imgPayload?.messages?.[0]?.id || '').trim() || null;
            await insertWhatsappMessageRecord({
              waMessageId: imgMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm',
              messageType: 'image', messageText: `Foto do produto ${cache.codigo}`,
              phoneNumberId, displayPhoneNumber, payload: imgPayload, direction: 'outbound'
            });
            console.log('[WhatsApp] foto produto enviada:', cache.codigo);
            // Botão de voltar após foto
            const bFotoPayload = await enviarMensagemWhatsappComBotoes({ phoneNumberId, toPhone: phoneDigits, bodyText: 'O que deseja fazer?', buttons: [{ id: 'menu_voltar', title: '🏠 Voltar ao menu' }] });
            const bFotoMsgId = String(bFotoPayload?.messages?.[0]?.id || '').trim() || null;
            await insertWhatsappMessageRecord({ waMessageId: bFotoMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Botão voltar foto', phoneNumberId, displayPhoneNumber, payload: bFotoPayload, direction: 'outbound' });
            return;
          } catch (imgErr) {
            console.warn('[WhatsApp] falha ao enviar foto:', imgErr?.message);
            await enviarTextoERegistrar(`⚠️ Não consegui enviar a foto. Acesse o link:\n${cache.imageUrl}`, 'foto fallback');
            return;
          }
        } else {
          await enviarTextoERegistrar('📷 Nenhum produto consultado recentemente ou sem imagem.\nDigite o *código ou nome* do produto para consultar.', 'foto sem cache');
          return;
        }
      }

      // "Ver mais" — paginação (texto ou botão interativo)
      if (interactiveId === 'produto_ver_mais' || detectarPedidoVerMais(userText)) {
        const buscaCache = ultimaBuscaProdutos.get(phoneDigits);
        if (buscaCache?.produtos?.length) {
          const PAGE_SIZE = 5;
          const novoOffset = buscaCache.offset + PAGE_SIZE;
          if (novoOffset >= buscaCache.produtos.length) {
            await enviarTextoERegistrar('📋 Não há mais produtos para mostrar.', 'fim lista');
            await enviarMenuPrincipal('Posso ajudar com mais alguma coisa?', 'fim lista → menu');
            return;
          }
          buscaCache.offset = novoOffset;
          buscaCache.updatedAt = Date.now();
          await enviarListaProdutosInterativa({
            phoneNumberId, toPhone: phoneDigits, displayPhoneNumber,
            produtos: buscaCache.produtos, offset: novoOffset
          });
          return;
        }
      }

      // Seleção por ID interativo da lista (produto_sel_X) ou número digitado
      const selPorId = interactiveId?.startsWith('produto_sel_') ? parseInt(interactiveId.replace('produto_sel_', ''), 10) : null;
      const numSelecionado = selPorId || detectarSelecaoProdutoLista(userText);
      if (numSelecionado !== null) {
        const buscaCache = ultimaBuscaProdutos.get(phoneDigits);
        if (buscaCache?.produtos?.length && numSelecionado <= buscaCache.produtos.length) {
          const prodSelecionado = buscaCache.produtos[numSelecionado - 1];
          const { rows: full } = await pool.query(
            `SELECT codigo_produto, codigo, descricao, descr_detalhada, unidade, marca, modelo,
                    ncm, ean, descricao_familia, estoque_minimo, quantidade_estoque,
                    valor_unitario, peso_bruto, peso_liq, altura, largura, profundidade,
                    obs_internas, tipo_compra
             FROM public.produtos_omie WHERE codigo_produto = $1 LIMIT 1`,
            [prodSelecionado.codigo_produto]
          );
          if (full.length) {
            const detalhe = await montarDetalheProduto(full[0]);
            if (detalhe) {
              if (detalhe.imageUrl) {
                ultimoProdutoConsultado.set(phoneDigits, { imageUrl: detalhe.imageUrl, codigo: detalhe.produto.codigo, updatedAt: Date.now() });
              }
              // Envia texto do detalhe
              await enviarTextoERegistrar(detalhe.texto, 'detalhe produto selecionado');
              // Envia botões de ação
              const botoes = [];
              if (detalhe.imageUrl) botoes.push({ id: 'produto_ver_foto', title: 'Ver foto' });
              botoes.push({ id: 'menu_voltar', title: 'Voltar ao menu' });
              const bPayload = await enviarMensagemWhatsappComBotoes({ phoneNumberId, toPhone: phoneDigits, bodyText: 'O que deseja fazer?', buttons: botoes });
              const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
              await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações produto', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
              return;
            }
          }
        }
      }

      // Qualquer outro texto → trata como busca de produto (código ou nome direto)
      const termoBusca = userText;
      const resultado = await consultarProdutoDB(termoBusca);
      if (resultado) {
        if (resultado.tipo === 'lista') {
          ultimaBuscaProdutos.set(phoneDigits, { termo: termoBusca, produtos: resultado.produtos, offset: 0, updatedAt: Date.now() });
          await enviarListaProdutosInterativa({
            phoneNumberId, toPhone: phoneDigits, displayPhoneNumber,
            produtos: resultado.produtos, offset: 0
          });
          return;
        }
        // Produto único — envia detalhe + botões
        if (resultado.imageUrl) {
          ultimoProdutoConsultado.set(phoneDigits, { imageUrl: resultado.imageUrl, codigo: resultado.produto.codigo, updatedAt: Date.now() });
        }
        await enviarTextoERegistrar(resultado.texto, 'consulta produto único');
        const botoes = [];
        if (resultado.imageUrl) botoes.push({ id: 'produto_ver_foto', title: 'Ver foto' });
        botoes.push({ id: 'menu_voltar', title: 'Voltar ao menu' });
        const bPayload = await enviarMensagemWhatsappComBotoes({ phoneNumberId, toPhone: phoneDigits, bodyText: 'O que deseja fazer?', buttons: botoes });
        const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
        await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações produto único', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
        return;
      }
      // Não encontrou
      await enviarTextoERegistrar(`❌ Nenhum produto encontrado para *"${termoBusca}"*.\n\nDigite outro *código ou nome* para buscar.`, 'produto não encontrado');
      return;
    }

    // Se está em fluxo de MANUAL_INSTRUCAO
    if (menuState?.fluxo === 'MANUAL_INSTRUCAO') {
      const step = menuState.step || 'ESCOLHENDO_MANUAL';

      // === ESCOLHENDO_MANUAL: usuário vê e seleciona da lista de manuais ===
      if (step === 'ESCOLHENDO_MANUAL') {
        if (interactiveId?.startsWith('msel_')) {
          const manualId = parseInt(interactiveId.slice(5), 10);
          const { rows: manualRows } = await pool.query(
            `SELECT id, nome_arquivo, caminho_manual, paginas FROM "Chatbot".manuais_instrucao WHERE id = $1`,
            [manualId]
          );
          const manual = manualRows[0];
          if (!manual) { await enviarTextoERegistrar('❓ Manual não encontrado.', 'manual sel inválida'); return; }
          menuInternoState.set(phoneDigits, {
            fluxo: 'MANUAL_INSTRUCAO', step: 'AGUARDANDO_DUVIDA_MANUAL',
            manualId: manual.id, nomeManual: manual.nome_arquivo,
            caminho: manual.caminho_manual, updatedAt: Date.now()
          });

          await enviarTextoERegistrar(
            `📘 *Manual selecionado:* ${manual.nome_arquivo}\n\nAgora me envie sua dúvida sobre este manual.\n\nExemplo: _como configurar a temperatura?_`,
            'manual aguardando dúvida'
          );

          const bPayload = await enviarMensagemWhatsappComBotoes({
            phoneNumberId, toPhone: phoneDigits,
            bodyText: 'Você pode perguntar em texto ou usar uma ação abaixo:',
            buttons: [
              { id: 'manual_perguntar_mais', title: 'Enviar duvida' },
              { id: 'msel_voltar_lista', title: 'Trocar manual' },
              { id: 'menu_voltar', title: 'Menu principal' }
            ]
          });
          const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
          await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações manual instrução', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
          return;
        }
        // Texto livre ou qualquer outra coisa → reapresenta a lista
        await enviarListaTodosManuais();
        return;
      }

      // === AGUARDANDO_DUVIDA_MANUAL: usuário envia dúvida em texto ===
      if (step === 'AGUARDANDO_DUVIDA_MANUAL') {
        const { manualId, nomeManual, caminho } = menuState;

        // Voltar à lista de manuais
        if (interactiveId === 'msel_voltar_lista') {
          menuInternoState.set(phoneDigits, { fluxo: 'MANUAL_INSTRUCAO', step: 'ESCOLHENDO_MANUAL', updatedAt: Date.now() });
          await enviarListaTodosManuais();
          return;
        }

        if (interactiveId === 'manual_perguntar_mais') {
          await enviarTextoERegistrar(
            `✍️ Envie sua dúvida sobre o manual *${nomeManual}* em uma única mensagem.`,
            'manual pedir dúvida novamente'
          );
          return;
        }

        const duvida = String(userText || '').trim();
        if (!duvida) {
          await enviarTextoERegistrar(
            `✍️ Escreva sua dúvida sobre o manual *${nomeManual}* para eu procurar nos capítulos.`,
            'manual aguardando texto dúvida'
          );
          return;
        }
        if (duvida.length < 4) {
          await enviarTextoERegistrar('❗ Escreva uma dúvida mais completa (pelo menos 4 caracteres).', 'manual dúvida curta');
          return;
        }

        const trechos = await buscarRespostaManualPorDuvida(manualId, duvida);
        if (trechos.length === 0) {
          await enviarTextoERegistrar(
            `Não encontrei um trecho exato no manual para: *${duvida}*\n\nTente com outras palavras (ex: "instalacao", "temperatura", "erro").\n\n🔗 ${caminho}`,
            'manual sem resposta por dúvida'
          );
        } else {
          const blocos = trechos.map((t, idx) =>
            `*Trecho ${idx + 1} (pag. ${t.pagina ?? '?'})*\n${t.texto}`
          ).join('\n\n');
          await enviarTextoERegistrar(
            `📘 *${nomeManual}*\n\n🔎 *Sua dúvida:* ${duvida}\n\n${blocos}\n\n🔗 ${caminho}`,
            'manual resposta por dúvida'
          );
        }

        const bPayload = await enviarMensagemWhatsappComBotoes({
          phoneNumberId, toPhone: phoneDigits,
          bodyText: 'Deseja fazer mais alguma ação neste manual?',
          buttons: [
            { id: 'manual_perguntar_mais', title: 'Outra duvida' },
            { id: 'msel_voltar_lista', title: 'Trocar manual' },
            { id: 'menu_voltar', title: 'Menu principal' }
          ]
        });
        const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
        await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações pós-resposta manual', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
        return;
      }
    }

    // Se está em fluxo de CONSULTA_VENDA
    if (menuState?.fluxo === 'CONSULTA_VENDA') {
      const step = menuState.step || 'ESCOLHENDO_TIPO';

      if (interactiveId === 'venda_btn_abrir_pedido') {
        console.log('[WhatsApp][CONSULTA_VENDA] clique Abrir pedido:', JSON.stringify({
          phone: phoneDigits,
          codigoPedido: menuState?.codigoPedido || null,
          numeroPedido: menuState?.numeroPedido || null,
          temPdfPedidoEmMemoria: Boolean(menuState?.pdfPedidoUrl)
        }));
        let urlPedido = String(menuState?.pdfPedidoUrl || '').trim();
        if (!urlPedido) {
          const retryPedido = await obterPdfPedidoVendaOmie(menuState?.codigoPedido);
          if (!retryPedido.ok) {
            console.log('[WhatsApp][CONSULTA_VENDA] retry ObterPedVenda falhou:', retryPedido.error || 'sem erro');
          }
          if (retryPedido.ok && retryPedido.cPdfPed) {
            urlPedido = retryPedido.cPdfPed;
            menuInternoState.set(phoneDigits, {
              ...menuState,
              pdfPedidoUrl: urlPedido,
              updatedAt: Date.now()
            });
          }
        }
        if (!urlPedido) {
          await enviarTextoERegistrar('⚠️ Link do pedido indisponível no momento. Tente novamente em instantes.', 'vendas abrir pedido sem link');
        } else {
          await enviarTextoERegistrar(`📄 *Abrir pedido*\nClique aqui para abrir:\n${urlPedido}`, 'vendas abrir pedido link');
        }
        await enviarBotoesConsultaPedidoVenda('Deseja abrir outro documento deste pedido?');
        return;
      }

      if (interactiveId === 'venda_btn_visualizar_nfe') {
        console.log('[WhatsApp][CONSULTA_VENDA] clique Visualizar NFe:', JSON.stringify({
          phone: phoneDigits,
          codigoPedido: menuState?.codigoPedido || null,
          numeroPedido: menuState?.numeroPedido || null,
          chaveNfe: menuState?.chaveNfe || null,
          temPdfNfeEmMemoria: Boolean(menuState?.pdfNfeUrl)
        }));
        let urlNfe = String(menuState?.pdfNfeUrl || '').trim();
        if (!urlNfe) {
          let chave = String(menuState?.chaveNfe || '').trim();
          if (!chave) {
            const notaPedido = await consultarNfeVendaPorPedido(menuState?.codigoPedido, menuState?.numeroPedido);
            chave = String(notaPedido?.nota?.chave_nfe || '').trim();
          }
          if (chave) {
            const retryNfe = await obterPdfNfePorChaveOmie(chave);
            if (!retryNfe.ok) {
              console.log('[WhatsApp][CONSULTA_VENDA] retry ObterNfe falhou:', retryNfe.error || 'sem erro');
            }
            if (retryNfe.ok && retryNfe.cPdf) {
              urlNfe = retryNfe.cPdf;
              menuInternoState.set(phoneDigits, {
                ...menuState,
                chaveNfe: chave,
                pdfNfeUrl: urlNfe,
                updatedAt: Date.now()
              });
            }
          }
        }
        if (!urlNfe) {
          await enviarTextoERegistrar('⚠️ PDF da NFe indisponível no momento para este pedido. Tente novamente em instantes.', 'vendas visualizar nfe sem link');
        } else {
          await enviarTextoERegistrar(`🧾 *Visualizar NFe*\nClique aqui para abrir:\n${urlNfe}`, 'vendas visualizar nfe link');
        }
        await enviarBotoesConsultaPedidoVenda('Deseja abrir outro documento deste pedido?');
        return;
      }

      if (step === 'ESCOLHENDO_TIPO') {
        if (interactiveId === 'venda_op_pedido' || userText.trim() === '1') {
          menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_VENDA', step: 'AGUARDANDO_NUMERO_PEDIDO', updatedAt: Date.now() });
          await enviarTextoERegistrar(
            '🧾 *Consultar pedido de venda*\n\nEnvie o *número do pedido* (campo numero_pedido).',
            'vendas pedir número pedido'
          );
          return;
        }

        if (interactiveId === 'venda_op_nfe' || userText.trim() === '2') {
          menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_VENDA', step: 'AGUARDANDO_NUMERO_NFE', updatedAt: Date.now() });
          await enviarTextoERegistrar(
            '🧾 *Consultar NFe/NFSe de venda*\n\nEnvie o *número da nota*.',
            'vendas pedir número nfe'
          );
          return;
        }

        const bPayload = await enviarMensagemWhatsappComBotoes({
          phoneNumberId, toPhone: phoneDigits,
          bodyText: 'Escolha a consulta de vendas:',
          buttons: [
            { id: 'venda_op_pedido', title: 'Consultar pedido' },
            { id: 'menu_voltar', title: 'Menu principal' }
          ]
        });
        const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
        await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Submenu consultar venda', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
        return;
      }

      if (step === 'AGUARDANDO_NUMERO_PEDIDO') {
        if (interactiveId === 'venda_op_nfe') {
          menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_VENDA', step: 'AGUARDANDO_NUMERO_NFE', updatedAt: Date.now() });
          await enviarTextoERegistrar('Envie o *número da NFe/NFSe* para consulta.', 'vendas troca para nfe');
          return;
        }

        const numero = String(userText || '').trim();
        if (!numero) {
          await enviarTextoERegistrar('Informe o número do pedido para consultar.', 'vendas pedido vazio');
          return;
        }

        try {
          const consulta = await consultarVendaPorNumeroPedido(numero);
          if (!consulta.ok) {
            await enviarTextoERegistrar(`❌ ${consulta.error}`, 'vendas pedido não encontrado');
          } else {
            const p = consulta.pedido;

            const pedidoPdf = await obterPdfPedidoVendaOmie(p.codigo_pedido);
            const notaPedido = await consultarNfeVendaPorPedido(p.codigo_pedido, p.numero_pedido);
            const nfePdf = notaPedido.ok
              ? await obterPdfNfePorChaveOmie(notaPedido.nota?.chave_nfe)
              : { ok: false, error: notaPedido.error };

            console.log('[WhatsApp][CONSULTA_VENDA] links consulta pedido:', JSON.stringify({
              phone: phoneDigits,
              numeroPedido: p.numero_pedido || numero,
              codigoPedido: p.codigo_pedido || null,
              pedidoPdfOk: pedidoPdf.ok,
              pedidoPdfErro: pedidoPdf.ok ? null : (pedidoPdf.error || null),
              notaPedidoOk: notaPedido.ok,
              notaPedidoErro: notaPedido.ok ? null : (notaPedido.error || null),
              nfePdfOk: nfePdf.ok,
              nfePdfErro: nfePdf.ok ? null : (nfePdf.error || null)
            }));

            const resumo =
              `✅ *Pedido de venda ${p.numero_pedido || numero} localizado.*\n` +
              `Escolha a ação abaixo.`;

            await enviarTextoERegistrar(resumo, 'vendas pedido consultado com links');

            menuInternoState.set(phoneDigits, {
              fluxo: 'CONSULTA_VENDA',
              step: 'ESCOLHENDO_TIPO',
              numeroPedido: String(p.numero_pedido || numero),
              codigoPedido: String(p.codigo_pedido || ''),
              chaveNfe: String(notaPedido?.nota?.chave_nfe || ''),
              pdfPedidoUrl: pedidoPdf.ok ? pedidoPdf.cPdfPed : null,
              pdfNfeUrl: nfePdf.ok ? nfePdf.cPdf : null,
              updatedAt: Date.now()
            });

            await enviarBotoesConsultaPedidoVenda('Escolha uma ação para este pedido:');
            return;
          }
        } catch (err) {
          await enviarTextoERegistrar(`⚠️ Erro ao consultar pedido: ${err.message || err}`, 'vendas erro consulta pedido');
        }

        const bPayload = await enviarMensagemWhatsappComBotoes({
          phoneNumberId, toPhone: phoneDigits,
          bodyText: 'Deseja fazer outra consulta de vendas?',
          buttons: [
            { id: 'venda_op_pedido', title: 'Consultar pedido' },
            { id: 'menu_voltar', title: 'Menu principal' }
          ]
        });
        const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
        await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações pós consulta pedido venda', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
        menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_VENDA', step: 'ESCOLHENDO_TIPO', updatedAt: Date.now() });
        return;
      }

      if (step === 'AGUARDANDO_NUMERO_NFE') {
        if (interactiveId === 'venda_op_pedido') {
          menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_VENDA', step: 'AGUARDANDO_NUMERO_PEDIDO', updatedAt: Date.now() });
          await enviarTextoERegistrar('Envie o *número do pedido* para consulta.', 'vendas troca para pedido');
          return;
        }

        const numeroNfe = String(userText || '').trim();
        if (!numeroNfe) {
          await enviarTextoERegistrar('Informe o número da NFe/NFSe para consultar.', 'vendas nfe vazio');
          return;
        }

        try {
          const consulta = await consultarNfeVendaPorNumero(numeroNfe);
          if (!consulta.ok) {
            await enviarTextoERegistrar(`❌ ${consulta.error}\n\nSe o webhook ainda não recebeu essa nota, ela pode não estar na base.`, 'vendas nfe não encontrada');
          } else {
            const n = consulta.nota;
            const valor = n.valor_total != null ? Number(n.valor_total).toFixed(2) : '0.00';
            const dataEmissao = n.data_emissao ? new Date(n.data_emissao).toLocaleDateString('pt-BR') : '-';
            await enviarTextoERegistrar(
              `✅ *${n.tipo_documento || 'NF'} ${n.numero_nota || numeroNfe}*\n` +
              `Status: ${n.status_ultimo || '-'}\n` +
              `Evento: ${n.topic_ultimo || '-'}\n` +
              `Pedido vinculado: ${n.numero_pedido || '-'}\n` +
              `Emitente: ${n.razao_emitente || '-'}\n` +
              `CNPJ: ${n.cnpj_emitente || '-'}\n` +
              `Emissão: ${dataEmissao}\n` +
              `Valor: R$ ${valor}\n` +
              `Chave: ${n.chave_nfe || '-'}`,
              'vendas nfe consultada'
            );
          }
        } catch (err) {
          await enviarTextoERegistrar(`⚠️ Erro ao consultar NFe: ${err.message || err}`, 'vendas erro consulta nfe');
        }

        const bPayload = await enviarMensagemWhatsappComBotoes({
          phoneNumberId, toPhone: phoneDigits,
          bodyText: 'Deseja fazer outra consulta de vendas?',
          buttons: [
            { id: 'venda_op_pedido', title: 'Consultar pedido' },
            { id: 'menu_voltar', title: 'Menu principal' }
          ]
        });
        const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
        await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações pós consulta nfe venda', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
        menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_VENDA', step: 'ESCOLHENDO_TIPO', updatedAt: Date.now() });
        return;
      }
    }

    // Se está em fluxo de AGENDA (one-shot: consulta e volta ao menu)
    if (menuState?.fluxo === 'AGENDA') {
      menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
      // Não deveria entrar aqui pois agenda é one-shot, mas por segurança volta ao menu
      await enviarMenuPrincipal('Como posso ajudar?', 'agenda → menu');
      return;
    }

    // Se está em fluxo de MENSAGENS (one-shot: consulta e volta ao menu)
    if (menuState?.fluxo === 'MENSAGENS') {
      menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
      await enviarMenuPrincipal('Como posso ajudar?', 'mensagens → menu');
      return;
    }

    // === SEM FLUXO ATIVO — processa escolha do menu interativo ou texto ===
    const escolha = interactiveId || userText.trim();

    // Opção 1 — Consultar produto (por lista interativa ou texto "1")
    if (escolha === 'menu_consultar_produto' || escolha === '1') {
      menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_PRODUTO', updatedAt: Date.now() });
      await enviarTextoERegistrar(
        '🔍 *Consulta de Produto*\n\n' +
        'Digite o *código* ou *nome* do produto que deseja consultar.\n\n' +
        '_Exemplo: "07.MP.N.62031" ou "compressor"_',
        'menu → consulta produto'
      );
      // Botão para voltar ao menu
      const bVoltarPayload = await enviarMensagemWhatsappComBotoes({ phoneNumberId, toPhone: phoneDigits, bodyText: 'ou clique abaixo para voltar:', buttons: [{ id: 'menu_voltar', title: '🏠 Voltar ao menu' }] });
      const bVoltarMsgId = String(bVoltarPayload?.messages?.[0]?.id || '').trim() || null;
      await insertWhatsappMessageRecord({ waMessageId: bVoltarMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Botão voltar consulta', phoneNumberId, displayPhoneNumber, payload: bVoltarPayload, direction: 'outbound' });
      return;
    }

    // Opção 2 — Realizar compra
    if (escolha === 'menu_realizar_compra' || escolha === '2') {
      menuInternoState.set(phoneDigits, { fluxo: 'COMPRAS', updatedAt: Date.now() });
      // Inicia o fluxo de compras diretamente no primeiro passo
      const state = {
        step: 'CADASTRO_OMIE',
        data: { solicitante: contatoInfo.username || '', userId: contatoInfo.userId || null },
        updatedAt: Date.now()
      };
      comprasFlowState.set(phoneDigits, state);
      // Envia com botões interativos (3 opções = ideal para botões)
      const sendPayload = await enviarMensagemWhatsappComBotoes({
        phoneNumberId, toPhone: phoneDigits,
        bodyText: '🛒 *Solicitação de Compra*\n\nO produto já está cadastrado na Omie?',
        buttons: [
          { id: 'compra_omie_sim', title: 'Sim' },
          { id: 'compra_omie_nao', title: 'Não' },
          { id: 'compra_omie_naosei', title: 'Não sei' }
        ]
      });
      const outMsgId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
      await insertWhatsappMessageRecord({
        waMessageId: outMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm',
        messageType: 'interactive', messageText: 'Início fluxo compras',
        phoneNumberId, displayPhoneNumber, payload: sendPayload, direction: 'outbound'
      });
      console.log('[WhatsApp] menu → compras:', JSON.stringify({ to_phone: phoneDigits }));
      return;
    }

    // Opção 3 — Consultar venda (pedido ou NFe)
    if (escolha === 'menu_consultar_venda' || escolha === '3') {
      menuInternoState.set(phoneDigits, { fluxo: 'CONSULTA_VENDA', step: 'ESCOLHENDO_TIPO', updatedAt: Date.now() });
      const bPayload = await enviarMensagemWhatsappComBotoes({
        phoneNumberId, toPhone: phoneDigits,
        bodyText: '🧾 *Consultar venda*\n\nEscolha uma opção:',
        buttons: [
          { id: 'venda_op_pedido', title: 'Consultar pedido' },
          { id: 'menu_voltar', title: 'Menu principal' }
        ]
      });
      const outMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
      await insertWhatsappMessageRecord({ waMessageId: outMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Submenu consultar venda', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
      return;
    }

    // Opção 4 — Verificar agenda
    if (escolha === 'menu_verificar_agenda' || escolha === '4' || escolha === '3') {
      const textoAgenda = await consultarAgendaUsuario(contatoInfo.username);
      menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
      await enviarMenuFinalizar(textoAgenda, 'menu → agenda');
      return;
    }

    // Opção 5 — Verificar mensagens
    if (escolha === 'menu_verificar_mensagens' || escolha === '5' || escolha === '4') {
      const textoMensagens = await consultarMensagensNaoLidas(contatoInfo.userId);
      menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
      await enviarMenuFinalizar(textoMensagens, 'menu → mensagens');
      return;
    }

    // Opção 6 — Manual de instrução → mostra lista de todos os manuais imediatamente
    if (escolha === 'menu_manual_instrucao' || escolha === '6' || escolha === '5') {
      menuInternoState.set(phoneDigits, { fluxo: 'MANUAL_INSTRUCAO', step: 'ESCOLHENDO_MANUAL', updatedAt: Date.now() });
      await enviarListaTodosManuais();
      return;
    }

    // Qualquer outra mensagem sem fluxo ativo → mostra menu principal
    const saudacao = contatoInfo.username ? `Olá, *${contatoInfo.username}*! 👋` : 'Olá! 👋';
    menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
    await enviarMenuPrincipal(saudacao + '\n\nPara iniciar o seu atendimento, escolha uma das opções da lista 👇', 'menu principal');
    return;
  }

  /* ====================================================================
   *  CONTATOS EXTERNOS — Menu com Manual de instrução
   * ==================================================================== */
  {
    let menuState = menuInternoState.get(phoneDigits);

    // "voltar" / "menu" → reseta e mostra menu externo
    if (menuState?.fluxo && (/^(0|finalizar|encerrar|voltar|menu|sair)$/i.test(userText) || interactiveId === 'menu_voltar')) {
      menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
      await enviarMenuExterno('✅ Assunto finalizado!\n\nPosso ajudar com mais alguma coisa?', 'externo menu finalizar');
      return;
    }

    // Se está em fluxo de MANUAL_INSTRUCAO
    if (menuState?.fluxo === 'MANUAL_INSTRUCAO') {
      const step = menuState.step || 'ESCOLHENDO_MANUAL';

      if (step === 'ESCOLHENDO_MANUAL') {
        if (interactiveId?.startsWith('msel_')) {
          const manualId = parseInt(interactiveId.slice(5), 10);
          const { rows: manualRows } = await pool.query(
            `SELECT id, nome_arquivo, caminho_manual, paginas FROM "Chatbot".manuais_instrucao WHERE id = $1`,
            [manualId]
          );
          const manual = manualRows[0];
          if (!manual) { await enviarTextoERegistrar('❓ Manual não encontrado.', 'externo manual sel inválida'); return; }
          menuInternoState.set(phoneDigits, {
            fluxo: 'MANUAL_INSTRUCAO', step: 'AGUARDANDO_DUVIDA_MANUAL',
            manualId: manual.id, nomeManual: manual.nome_arquivo,
            caminho: manual.caminho_manual, updatedAt: Date.now()
          });
          await enviarTextoERegistrar(
            `📘 *Manual selecionado:* ${manual.nome_arquivo}\n\nAgora me envie sua dúvida sobre este manual.\n\nExemplo: _como configurar a temperatura?_`,
            'externo manual aguardando dúvida'
          );
          const bPayload = await enviarMensagemWhatsappComBotoes({
            phoneNumberId, toPhone: phoneDigits,
            bodyText: 'Você pode perguntar em texto ou usar uma ação abaixo:',
            buttons: [
              { id: 'manual_perguntar_mais', title: 'Enviar duvida' },
              { id: 'msel_voltar_lista', title: 'Trocar manual' },
              { id: 'menu_voltar', title: 'Menu principal' }
            ]
          });
          const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
          await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações manual instrução externo', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
          return;
        }
        // Texto livre ou qualquer outra coisa → reapresenta a lista
        await enviarListaTodosManuais();
        return;
      }

      if (step === 'AGUARDANDO_DUVIDA_MANUAL') {
        const { manualId, nomeManual, caminho } = menuState;

        if (interactiveId === 'msel_voltar_lista') {
          menuInternoState.set(phoneDigits, { fluxo: 'MANUAL_INSTRUCAO', step: 'ESCOLHENDO_MANUAL', updatedAt: Date.now() });
          await enviarListaTodosManuais();
          return;
        }

        if (interactiveId === 'manual_perguntar_mais') {
          await enviarTextoERegistrar(
            `✍️ Envie sua dúvida sobre o manual *${nomeManual}* em uma única mensagem.`,
            'externo manual pedir dúvida novamente'
          );
          return;
        }

        const duvida = String(userText || '').trim();
        if (!duvida) {
          await enviarTextoERegistrar(
            `✍️ Escreva sua dúvida sobre o manual *${nomeManual}* para eu procurar nos capítulos.`,
            'externo manual aguardando texto dúvida'
          );
          return;
        }
        if (duvida.length < 4) {
          await enviarTextoERegistrar('❗ Escreva uma dúvida mais completa (pelo menos 4 caracteres).', 'externo manual dúvida curta');
          return;
        }

        const trechos = await buscarRespostaManualPorDuvida(manualId, duvida);
        if (trechos.length === 0) {
          await enviarTextoERegistrar(
            `Não encontrei um trecho exato no manual para: *${duvida}*\n\nTente com outras palavras (ex: "instalacao", "temperatura", "erro").\n\n🔗 ${caminho}`,
            'externo manual sem resposta por dúvida'
          );
        } else {
          const blocos = trechos.map((t, idx) =>
            `*Trecho ${idx + 1} (pag. ${t.pagina ?? '?'})*\n${t.texto}`
          ).join('\n\n');
          await enviarTextoERegistrar(
            `📘 *${nomeManual}*\n\n🔎 *Sua dúvida:* ${duvida}\n\n${blocos}\n\n🔗 ${caminho}`,
            'externo manual resposta por dúvida'
          );
        }

        const bPayload = await enviarMensagemWhatsappComBotoes({
          phoneNumberId, toPhone: phoneDigits,
          bodyText: 'Deseja fazer mais alguma ação neste manual?',
          buttons: [
            { id: 'manual_perguntar_mais', title: 'Outra duvida' },
            { id: 'msel_voltar_lista', title: 'Trocar manual' },
            { id: 'menu_voltar', title: 'Menu principal' }
          ]
        });
        const bMsgId = String(bPayload?.messages?.[0]?.id || '').trim() || null;
        await insertWhatsappMessageRecord({ waMessageId: bMsgId, phone: phoneDigits, profileName: 'Chatbot Fromtherm', messageType: 'interactive', messageText: 'Ações pós-resposta manual externo', phoneNumberId, displayPhoneNumber, payload: bPayload, direction: 'outbound' });
        return;
      }
    }

    // Selecionou "Manual de instrução" do menu externo
    if (interactiveId === 'menu_manual_instrucao') {
      menuInternoState.set(phoneDigits, { fluxo: 'MANUAL_INSTRUCAO', step: 'ESCOLHENDO_MANUAL', updatedAt: Date.now() });
      await enviarListaTodosManuais();
      return;
    }

    // Qualquer outra mensagem → mostra menu externo
    menuInternoState.set(phoneDigits, { fluxo: null, updatedAt: Date.now() });
    await enviarMenuExterno('Olá! 👋\n\nPara iniciar o seu atendimento, escolha uma das opções 👇', 'externo menu principal');
    return;
  }
}

async function getStoredStatus(codigo) {
  if (!codigo) return null;
  try {
    const r = await pool.query(
      `SELECT identificacao, rastreio_status, rastreio_quando, finalizado_em
         FROM envios.solicitacoes
        WHERE upper(regexp_replace(COALESCE(identificacao, ''), '\\s+', '', 'g')) = $1
           OR upper(identificacao) = $1
        LIMIT 1`,
      [codigo]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      codigo,
      status: row.rastreio_status,
      detalhe: null,
      local: null,
      cidade: null,
      uf: null,
      quando: row.finalizado_em || row.rastreio_quando
    };
  } catch (err) {
    console.warn('[SAC] falha ao buscar status armazenado:', err?.message || err);
    return null;
  }
}

async function persistStatus() {
  // Rastreio automático (Correios/VIPP) desativado — fluxo encerra em Enviado.
}

const trackCache = new Map();
const CACHE_HIT_TTL_MS = 10 * 60 * 1000; // 10min
const CACHE_FAIL_TTL_MS = 5 * 60 * 1000;  // 5min

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

// Geocoding via BrasilAPI CEP (sem rate limit, usa coordenadas do CEP)
async function geocodeByCep(cep) {
  const clean = String(cep || '').replace(/\D/g, '');
  if (clean.length !== 8) return null;
  try {
    const r = await fetchWithTimeout(`https://brasilapi.com.br/api/cep/v2/${clean}`, {}, 6000);
    if (!r.ok) return null;
    const d = await r.json();
    const c = d && d.location && d.location.coordinates;
    if (c && c.latitude && c.longitude) {
      return { lat: parseFloat(c.latitude), lng: parseFloat(c.longitude) };
    }
  } catch {}
  return null;
}

// Geocoding via Open-Meteo (OSM, gratuito, sem rate limit, acessível do servidor)
async function geocodeByNominatimBackend(municipio, uf) {
  if (!municipio) return null;
  try {
    // Remove acentos para melhor busca
    const nome = municipio.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nome)}&count=5&language=pt&format=json&countryCode=BR`;
    const r = await fetchWithTimeout(url, {}, 8000);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.results || !d.results.length) return null;
    // Prefere resultado que bate com o estado (UF)
    const ufUpper = String(uf || '').toUpperCase();
    const match = ufUpper
      ? d.results.find(x => x.admin1 && x.admin1.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes(ufUpper === 'SC' ? 'SANTA CATARINA' : ufUpper === 'SP' ? 'SAO PAULO' : ufUpper))
        || d.results[0]
      : d.results[0];
    return { lat: parseFloat(match.latitude), lng: parseFloat(match.longitude) };
  } catch {}
  return null;
}

function normalizeStatus(statusRaw) {
  const val = String(statusRaw || '').trim();
  if (!val) return STATUS_LIST[0];
  const normalized = STATUS_LIST.find(s => s.toLowerCase() === val.toLowerCase());
  return normalized || STATUS_LIST[0];
}

function normalizePdfTextForMatch(textRaw) {
  return String(textRaw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isDaceDeclaracaoPdf(textRaw) {
  const normalized = normalizePdfTextForMatch(textRaw);
  if (!normalized) return false;
  return normalized.includes('DACE - DECLARACAO AUXILIAR DE CONTEUDO ELETRONICA')
    || normalized.includes('DACE DECLARACAO AUXILIAR DE CONTEUDO ELETRONICA');
}

// Extrai chave fiscal DCE do PDF para validação e consulta SEFAZ
function extractDceChaveFromPdf(textRaw) {
  const text = String(textRaw || '');

  // Formato no PDF: espaçado em grupos de 4 ou com quebras
  // Ex: 5326 0434 0283 1600 0103 9900 1004 3348 3614 0314 7332
  const matches = [
    text.match(/(?:\d{4}[\s\r\n]+){10}\d{4}/),  // Formato com espaços/quebras (grupo não-capturante p/ match[0] valer a chave inteira)
    text.match(/chDCe=(\d{44})/i),               // Se houver URL do QR
    text.match(/CH\s*DCe?[:\s=]+(\d{44})/i),    // Variações
    text.match(/(?<!\d)(\d{44})(?!\d)/),        // 44 dígitos sequenciais (com ou sem quebras vizinhas)
  ];

  for (const match of matches) {
    if (match) {
      const candidate = (match[1] || match[0]).replace(/\s+/g, '');
      if (/^\d{44}$/.test(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

// Decodifica entidades HTML básicas vindas do portal SEFAZ
function decodeHtmlEntitiesBasic(s) {
  return String(s || '')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&atilde;/gi, 'ã')
    .replace(/&otilde;/gi, 'õ').replace(/&acirc;/gi, 'â').replace(/&ecirc;/gi, 'ê')
    .replace(/&ocirc;/gi, 'ô').replace(/&ccedil;/gi, 'ç').replace(/&Aacute;/g, 'Á')
    .replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í').replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú').replace(/&Atilde;/g, 'Ã').replace(/&Otilde;/g, 'Õ')
    .replace(/&Acirc;/g, 'Â').replace(/&Ecirc;/g, 'Ê').replace(/&Ocirc;/g, 'Ô')
    .replace(/&Ccedil;/g, 'Ç').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// Formata quantidade vinda da SEFAZ ("50,0000" -> "50"; "2,5000" -> "2,5")
function formatSefazQuantidade(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // troca vírgula por ponto para parsear, e depois remove zeros à direita
  const num = Number(s.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return '';
  // Se inteiro, retorna sem decimais; caso contrário, mantém vírgula com até 4 casas e remove zeros finais
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

// Consulta a SEFAZ Paraná pela chave da DCe e devolve os itens estruturados como JSON string,
// no mesmo formato que extractConteudo, ou null em caso de falha/timeout/sem itens.
async function fetchSefazProdutos(chaveDce, { timeoutMs = 6000 } = {}) {
  if (!/^\d{44}$/.test(String(chaveDce || ''))) return null;
  const url = `https://www.fazenda.pr.gov.br/dce/qrcode?chDCe=${chaveDce}&tpAmb=1`;

  let html = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; IntranetSAC/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!resp || !resp.ok) return null;
      html = await resp.text();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[SAC][SEFAZ] falha ao consultar', chaveDce, '-', err?.message || err);
    return null;
  }

  if (!html || !/Detalhamento de Produtos/i.test(html)) return null;

  // Cada item é uma <tr> contendo as 6 células fixo-prod-serv-*
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*class="fixo-prod-serv-([a-z]+)"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/gi;

  const items = [];
  const seen = new Set();
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    if (!/fixo-prod-serv-descricao/i.test(rowHtml)) continue;
    if (/<label\b/i.test(rowHtml)) continue; // pula linha de cabeçalho (tem <label>)

    const cells = {};
    let cellMatch;
    cellRegex.lastIndex = 0;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells[cellMatch[1].toLowerCase()] = decodeHtmlEntitiesBasic(cellMatch[2])
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const conteudo = cells.descricao || '';
    const quantidade = formatSefazQuantidade(cells.qtd || '');
    if (!conteudo || !quantidade) continue;

    const key = `${conteudo.toUpperCase()}::${quantidade}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const item = { conteudo, quantidade };
    if (cells.vu) item.valor_unitario = cells.vu;
    if (cells.vb) item.valor_total = cells.vb;
    if (cells.ncm) item.ncm = cells.ncm;
    items.push(item);
  }

  if (!items.length) return null;
  return JSON.stringify(items);
}

// Extrai e formata o conteúdo da declaração de conteúdo (PDF) no layout DESCRIÇÃO/QTDE
function extractConteudo(textRaw) {
  const text = String(textRaw || '');
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const items = [];
  const seen = new Set();

  const pushItem = (conteudoRaw, quantidadeRaw) => {
    const conteudo = String(conteudoRaw || '').replace(/\s+/g, ' ').trim();
    const quantidade = String(quantidadeRaw || '').trim();
    if (!conteudo || !/^\d{1,4}$/.test(quantidade)) return;

    const key = `${conteudo.toUpperCase()}::${quantidade}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ conteudo, quantidade });
  };

  const parseCompactLine = (lineRaw) => {
    const line = String(lineRaw || '').replace(/\s+/g, ' ').trim();
    if (!line) return null;

    let workLine = line;

    // Remove índice de item de 1 dígito quando colado no início (ex.: 103MPI... -> 03MPI...)
    const itemPrefixMatch = workLine.match(/^(\d)(\d{2}[A-Za-z].*)$/);
    if (itemPrefixMatch) {
      workLine = itemPrefixMatch[2].trim();
    }

    // Variação comum no DACE: índice com ponto no começo (ex.: 107.MP... -> 07.MP...)
    const dottedItemPrefixMatch = workLine.match(/^(\d)(\d{2}\.[A-Za-z].*)$/);
    if (dottedItemPrefixMatch) {
      workLine = dottedItemPrefixMatch[2].trim();
    }

    // Formato com separação explícita: DESCRIÇÃO QTDE VALOR
    const spacedWithValue = workLine.match(/^(.+?)\s+(\d{1,4})\s+(\d{1,3},\d{2})$/);
    if (spacedWithValue) {
      return { conteudo: spacedWithValue[1], quantidade: spacedWithValue[2] };
    }

    // Se houver separação por espaço apenas entre descrição e quantidade, usa esse formato.
    const spaced = workLine.match(/^(.+?)\s+(\d{1,4})$/);
    if (spaced) {
      return { conteudo: spaced[1], quantidade: spaced[2] };
    }

    // Formato compactado no final: "... 32211,00" (descrição termina em 322, qtde=1, valor=1,00)
    const lastSpace = workLine.lastIndexOf(' ');
    if (lastSpace > 0) {
      const descBase = workLine.slice(0, lastSpace).trim();
      const compactToken = workLine.slice(lastSpace + 1).trim();
      const compactMatch = compactToken.match(/^(\d+),(\d{2})$/);
      if (compactMatch && /[A-Za-zÀ-ÿ]/.test(descBase)) {
        const digits = compactMatch[1];
        if (digits.length >= 2) {
          // Heurística do layout DACE: penúltimo dígito é a QTDE e último dígito é parte do valor inteiro.
          const quantidade = digits.slice(-2, -1);
          const descTail = digits.slice(0, -2);
          if (/^\d{1,4}$/.test(quantidade) && Number(quantidade) > 0) {
            const conteudo = descTail ? `${descBase} ${descTail}` : descBase;
            return { conteudo, quantidade };
          }
        }
      }
    }

    // Formato sem espaço entre descrição e bloco final (ex.: ...DRENAGEM11,00)
    const gluedMatch = workLine.match(/^(.+?)(\d+),(\d{2})$/);
    if (gluedMatch && /[A-Za-zÀ-ÿ]/.test(gluedMatch[1])) {
      const descBase = gluedMatch[1].trim();
      const digits = gluedMatch[2];
      if (digits.length >= 1) {
        // Para 1 dígito, usa o próprio dígito; para >=2, mantém heurística existente.
        const quantidade = digits.length === 1 ? digits : digits.slice(-2, -1);
        const descTail = digits.length === 1 ? '' : digits.slice(0, -2);
        if (/^\d{1,4}$/.test(quantidade) && Number(quantidade) > 0) {
          const conteudo = descTail ? `${descBase} ${descTail}` : descBase;
          return { conteudo, quantidade };
        }
      }
    }

    return null;
  };

  let inTable = false;
  let pendingDescription = null;

  for (const rawLine of lines) {
    const normalizedLine = rawLine.replace(/\s+/g, ' ').trim();
    const normalizedHeader = normalizePdfTextForMatch(normalizedLine);

    if (!inTable) {
      if (normalizedHeader.includes('DESCRICAO')) {
        inTable = true;
      }
      continue;
    }

    if (
      /^TOTAL\b/i.test(normalizedHeader)
      || /^TOTAIS\b/i.test(normalizedHeader)
      || normalizedHeader.includes('PESO TOTAL')
      || normalizedHeader.includes('VALOR TOTAL')
      || normalizedHeader.includes('DADOS ADICIONAIS')
      || normalizedHeader.includes('DECLARACAO AUXILIAR')
      || normalizedHeader.includes('ASSINATURA')
    ) {
      break;
    }

    if (normalizedHeader === 'DESCRICAO') continue;

    if (/^(QTDE|QUANTIDADE)\b/i.test(normalizedHeader)) {
      // A quantidade costuma vir na próxima linha no novo modelo DACE.
      continue;
    }

    if (/^\d{1,4}$/.test(normalizedLine)) {
      if (pendingDescription) {
        pushItem(pendingDescription, normalizedLine);
        pendingDescription = null;
      }
      continue;
    }

    const line = normalizedLine.replace(/^\d+\s+/, '');

    const compactParsed = parseCompactLine(line);
    if (compactParsed) {
      pushItem(compactParsed.conteudo, compactParsed.quantidade);
      pendingDescription = null;
      continue;
    }

    const match = line.match(/^(.+?)\s+(\d{1,4})\s*$/);
    if (match) {
      pushItem(match[1], match[2]);
      pendingDescription = null;
      continue;
    }

    // Guarda/concatena descrição até encontrar a quantidade em linha separada.
    if (pendingDescription) {
      pendingDescription = `${pendingDescription} ${line}`.replace(/\s+/g, ' ').trim();
    } else {
      pendingDescription = line;
    }
  }

  if (!items.length) return null;

  // Retorna em formato JSON para melhor estruturação no frontend
  return JSON.stringify(items);
}

const { pool } = require('../src/db');
const { VENDAS_NF_POR_PEDIDO_CTE, vendasNfJoinPedidoSql } = require('../utils/vendasNfJoin');

const BUCKET = process.env.STORAGE_BUCKET_SAC || process.env.STORAGE_BUCKET || process.env.SUPABASE_BUCKET || 'produtos';

// Upload em memória, máximo 12MB por arquivo, até 2 arquivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 2 }
});

let _ensureSchemaPromise = null;

async function ensureSchema() {
  if (_ensureSchemaPromise) {
    await _ensureSchemaPromise;
    try { await backfillEnviosSolicitacoesIdAt(); } catch (_) {}
    return;
  }
  _ensureSchemaPromise = pool.query(`
    CREATE SCHEMA IF NOT EXISTS envios;
    CREATE TABLE IF NOT EXISTS envios.solicitacoes (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      usuario TEXT NOT NULL,
      observacao TEXT,
      anexos TEXT[] NOT NULL DEFAULT '{}',
      conferido BOOLEAN NOT NULL DEFAULT false,
      etiqueta_url TEXT,
      declaracao_url TEXT,
      identificacao TEXT,
      finalizado_em TIMESTAMPTZ
    );

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS anexos TEXT[] NOT NULL DEFAULT '{}'::text[];

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS conferido BOOLEAN NOT NULL DEFAULT false;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS etiqueta_url TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS declaracao_url TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS identificacao TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS numero_sep TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS conteudo TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS chave_dce TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS rastreio_status TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS rastreio_quando TIMESTAMPTZ;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS id_vipp TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS finalizado_em TIMESTAMPTZ;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS metodo_envio TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS id_at BIGINT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS valor_envio NUMERIC(12,2);

    CREATE INDEX IF NOT EXISTS idx_envios_solicitacoes_id_at
      ON envios.solicitacoes (id_at)
      WHERE id_at IS NOT NULL;

    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'envios'
           AND table_name = 'solicitacoes'
           AND column_name = 'status'
      ) THEN
        EXECUTE $migrate$
          UPDATE envios.solicitacoes
             SET rastreio_status = COALESCE(NULLIF(TRIM(rastreio_status), ''), status, 'Pendente')
           WHERE rastreio_status IS NULL OR TRIM(rastreio_status) = ''
        $migrate$;
        EXECUTE 'ALTER TABLE envios.solicitacoes DROP COLUMN status';
      END IF;
    END $$;

    UPDATE envios.solicitacoes
       SET rastreio_status = 'Pendente'
     WHERE rastreio_status IS NULL OR TRIM(rastreio_status) = '';

    ALTER TABLE envios.solicitacoes
      ALTER COLUMN rastreio_status SET DEFAULT 'Pendente';

    CREATE SCHEMA IF NOT EXISTS sac;

    CREATE TABLE IF NOT EXISTS sac.at (
      id BIGSERIAL PRIMARY KEY,
      data TIMESTAMP NOT NULL DEFAULT NOW(),
      tipo TEXT,
      nome_revenda_cliente TEXT,
      numero_telefone TEXT,
      cpf_cnpj TEXT,
      cep TEXT,
      bairro TEXT,
      cidade TEXT,
      estado TEXT,
      numero TEXT,
      rua TEXT,
      agendar_atendimento_com TEXT,
      descreva_reclamacao TEXT
    );

    CREATE TABLE IF NOT EXISTS sac.at_busca_selecionada (
      id BIGSERIAL PRIMARY KEY,
      id_at BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
      pedido TEXT,
      ordem_producao TEXT,
      modelo TEXT,
      cliente TEXT,
      nota_fiscal TEXT,
      data_entrega TEXT,
      teste_tipo_gas TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS modelo TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS tag_problema TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS plataforma_atendimento TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS editado_por TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS editado_em TIMESTAMP;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS motivo_solicitacao TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS atendimento_inicial TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS acao_tomada TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS subtag TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS status TEXT;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS devolucao_enviada_em TIMESTAMP;
    ALTER TABLE sac.at ADD COLUMN IF NOT EXISTS devolucao_enviada_para TEXT;

    -- Destinatários de e-mail de devolução AT (NULL=fora da lista, false=pendente, true=ativo)
    ALTER TABLE public.auth_user ADD COLUMN IF NOT EXISTS email_devolucao BOOLEAN;

    -- Atendimento rápido deve permanecer Fechado (não fica aberto na guia)
    UPDATE sac.at
       SET status = 'Fechado'
     WHERE LOWER(TRIM(tipo)) IN ('atendimento rápido', 'atendimento rapido')
       AND COALESCE(NULLIF(TRIM(status), ''), '') NOT IN ('Fechado', 'Excluido');

    CREATE TABLE IF NOT EXISTS sac.alimentacao (
      id            BIGSERIAL PRIMARY KEY,
      letra_codigo  TEXT NOT NULL UNIQUE,
      degelo        TEXT,
      alimentacao   TEXT NOT NULL,
      criado_em     TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sac.sac_atalhos (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      url         TEXT NOT NULL,
      icon_class  TEXT NOT NULL DEFAULT 'fa-solid fa-link',
      icon_color  TEXT NOT NULL DEFAULT '#38bdf8',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_sac_atalhos_user_id ON sac.sac_atalhos (user_id);

    CREATE TABLE IF NOT EXISTS sac.material_apoio (
      id              BIGSERIAL PRIMARY KEY,
      nome            TEXT NOT NULL,
      tipo            TEXT NOT NULL,
      formato         TEXT NOT NULL,
      nome_arquivo    TEXT NOT NULL,
      path_key        TEXT NOT NULL,
      url_publica     TEXT,
      content_type    TEXT,
      tamanho_bytes   BIGINT,
      status_upload   TEXT NOT NULL DEFAULT 'enviando',
      upload_erro     TEXT,
      publico         BOOLEAN NOT NULL DEFAULT false,
      criado_por      TEXT,
      criado_em       TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em   TIMESTAMP
    );

    ALTER TABLE sac.material_apoio ADD COLUMN IF NOT EXISTS status_upload TEXT NOT NULL DEFAULT 'concluido';
    ALTER TABLE sac.material_apoio ADD COLUMN IF NOT EXISTS upload_erro TEXT;
    ALTER TABLE sac.material_apoio ADD COLUMN IF NOT EXISTS url_publica TEXT;
    DO $matApoioUrlPub$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'sac' AND table_name = 'material_apoio' AND column_name = 'url_publica'
      ) THEN
        ALTER TABLE sac.material_apoio ALTER COLUMN url_publica DROP NOT NULL;
      END IF;
    END $matApoioUrlPub$;
    ALTER TABLE sac.material_apoio ADD COLUMN IF NOT EXISTS publico BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS sac.material_apoio_anexo (
      id              BIGSERIAL PRIMARY KEY,
      material_id     BIGINT NOT NULL REFERENCES sac.material_apoio(id) ON DELETE CASCADE,
      nome_arquivo    TEXT NOT NULL,
      path_key        TEXT NOT NULL,
      url_publica     TEXT,
      content_type    TEXT,
      tamanho_bytes   BIGINT,
      status_upload   TEXT NOT NULL DEFAULT 'enviando',
      upload_erro     TEXT,
      criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_material_apoio_anexo_mid ON sac.material_apoio_anexo (material_id);

    DO $matApoioMigr$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'sac' AND table_name = 'material_apoio' AND column_name = 'path_key'
      ) THEN
        INSERT INTO sac.material_apoio_anexo
          (material_id, nome_arquivo, path_key, url_publica, content_type, tamanho_bytes, status_upload, upload_erro)
        SELECT m.id, m.nome_arquivo, m.path_key, m.url_publica, m.content_type, m.tamanho_bytes,
               COALESCE(NULLIF(TRIM(m.status_upload), ''), 'concluido'), m.upload_erro
          FROM sac.material_apoio m
         WHERE m.path_key IS NOT NULL AND TRIM(m.path_key) != ''
           AND NOT EXISTS (SELECT 1 FROM sac.material_apoio_anexo a WHERE a.material_id = m.id LIMIT 1);

        ALTER TABLE sac.material_apoio DROP COLUMN IF EXISTS nome_arquivo;
        ALTER TABLE sac.material_apoio DROP COLUMN IF EXISTS path_key;
        ALTER TABLE sac.material_apoio DROP COLUMN IF EXISTS url_publica;
        ALTER TABLE sac.material_apoio DROP COLUMN IF EXISTS content_type;
        ALTER TABLE sac.material_apoio DROP COLUMN IF EXISTS tamanho_bytes;
        ALTER TABLE sac.material_apoio DROP COLUMN IF EXISTS status_upload;
        ALTER TABLE sac.material_apoio DROP COLUMN IF EXISTS upload_erro;
      END IF;
    END $matApoioMigr$;

    CREATE TABLE IF NOT EXISTS sac.tag (
      id         BIGSERIAL PRIMARY KEY,
      nome       TEXT NOT NULL UNIQUE,
      criado_em  TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sac.fechamento (
      id BIGSERIAL PRIMARY KEY,
      id_at BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
      tag_problema TEXT,
      plataforma_atendimento TEXT,
      descricao_servico_realizado TEXT,
      valor_total_mao_obra NUMERIC(15,2),
      valor_gasto_pecas NUMERIC(15,2),
      pecas_reposicao TEXT,
      data_conclusao_servico DATE,
      observacoes TEXT,
      midias_servico TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sac.at_anexos (
      id         BIGSERIAL PRIMARY KEY,
      id_at      BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
      nome_arquivo TEXT NOT NULL,
      path_key   TEXT NOT NULL,
      url_publica TEXT NOT NULL,
      content_type TEXT,
      tamanho_bytes BIGINT,
      enviado_por TEXT,
      criado_em  TIMESTAMP NOT NULL DEFAULT NOW()
    );

    DO $controle$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'controle_tecnicos'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'sac' AND table_name = 'controle_tecnicos'
      ) THEN
        ALTER TABLE public.controle_tecnicos SET SCHEMA sac;
      END IF;
    END $controle$;

    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS lat NUMERIC(10,7);
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS lng NUMERIC(10,7);
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS senha TEXT;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS token TEXT;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS qtd_atend_ult_1_ano INTEGER DEFAULT 0;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS numero TEXT;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS bairro TEXT;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS complemento TEXT;
    ALTER TABLE sac.controle_tecnicos ADD COLUMN IF NOT EXISTS id BIGSERIAL;
    CREATE UNIQUE INDEX IF NOT EXISTS controle_tecnicos_token_idx ON sac.controle_tecnicos(token) WHERE token IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS controle_tecnicos_id_idx    ON sac.controle_tecnicos(id);
    -- coluna que vincula técnico ao atendimento em fechamento
    ALTER TABLE sac.fechamento ADD COLUMN IF NOT EXISTS id_tecnico BIGINT;
    CREATE UNIQUE INDEX IF NOT EXISTS fechamento_at_tec_uidx ON sac.fechamento(id_at, id_tecnico) WHERE id_tecnico IS NOT NULL;
    -- colunas para fechamento pelo portal AT
    ALTER TABLE sac.fechamento ADD COLUMN IF NOT EXISTS status_os TEXT DEFAULT 'aberta';
    ALTER TABLE sac.fechamento ADD COLUMN IF NOT EXISTS nfe_url TEXT;
    ALTER TABLE sac.fechamento ADD COLUMN IF NOT EXISTS nfe_path_key TEXT;
    ALTER TABLE sac.fechamento ADD COLUMN IF NOT EXISTS observacao_tecnico TEXT;
    ALTER TABLE sac.fechamento ADD COLUMN IF NOT EXISTS data_envio_nfe TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS sac.mencoes (
      id                   BIGSERIAL PRIMARY KEY,
      id_at                BIGINT NOT NULL REFERENCES sac.at(id) ON DELETE CASCADE,
      telefone             TEXT,
      nome_revenda_cliente TEXT,
      plataforma           TEXT,
      motivo_solicitacao   TEXT,
      acao_tomada          TEXT,
      criado_por           TEXT,
      criado_em            TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sac.whatsapp_webhook_messages (
      id                   BIGSERIAL PRIMARY KEY,
      wa_message_id        TEXT UNIQUE,
      from_phone           TEXT,
      from_phone_digits    TEXT,
      profile_name         TEXT,
      direction            TEXT NOT NULL DEFAULT 'inbound',
      message_type         TEXT,
      message_text         TEXT,
      phone_number_id      TEXT,
      display_phone_number TEXT,
      payload_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
      received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE sac.whatsapp_webhook_messages
      ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'inbound';

    CREATE INDEX IF NOT EXISTS whatsapp_webhook_messages_phone_idx
      ON sac.whatsapp_webhook_messages(from_phone_digits, received_at DESC);
    CREATE INDEX IF NOT EXISTS whatsapp_webhook_messages_received_idx
      ON sac.whatsapp_webhook_messages(received_at DESC);

    CREATE TABLE IF NOT EXISTS sac.whatsapp_conversation_read_status (
      id                BIGSERIAL PRIMARY KEY,
      from_phone_digits TEXT NOT NULL UNIQUE,
      last_read_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS whatsapp_read_status_phone_idx
      ON sac.whatsapp_conversation_read_status(from_phone_digits);

    -- Cache local das planilhas de série/pedidos (AT)
    -- Alimentado via POST /api/sac/at/sync-cache; busca ignora filtros ativos no Sheets
    CREATE TABLE IF NOT EXISTS sac.at_serie_cache (
      id             BIGSERIAL PRIMARY KEY,
      fonte          TEXT NOT NULL,
      pedido         TEXT,
      ordem_producao TEXT,
      modelo         TEXT,
      cliente        TEXT,
      data_venda     TEXT,
      nota_fiscal    TEXT,
      chave_nfe      TEXT,
      data_entrega   TEXT,
      teste_tipo_gas TEXT,
      chave_dedup    TEXT NOT NULL,
      synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS at_serie_cache_dedup_idx
      ON sac.at_serie_cache (chave_dedup);
    CREATE INDEX IF NOT EXISTS at_serie_cache_pedido_idx
      ON sac.at_serie_cache (pedido);
    CREATE INDEX IF NOT EXISTS at_serie_cache_op_idx
      ON sac.at_serie_cache (ordem_producao);

    CREATE TABLE IF NOT EXISTS sac.at_relatorio_gerencial (
      id BIGSERIAL PRIMARY KEY,
      mes CHAR(7) NOT NULL UNIQUE,
      plano_acao JSONB NOT NULL DEFAULT '[]'::jsonb,
      conclusao_resumo TEXT,
      conclusao_pontos_criticos TEXT,
      conclusao_oportunidades TEXT,
      editado_por TEXT,
      editado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS at_relatorio_gerencial_mes_idx
      ON sac.at_relatorio_gerencial (mes);
  `).then(async () => {
    try {
      const { ensureCustoPecasTable, backfillCustoPecas } = require('../utils/enviosCustoPecas');
      await ensureCustoPecasTable(pool);
      await backfillCustoPecas(pool, { onlyMissing: true, limit: 5000 });
    } catch (e) {
      console.warn('[SAC] custo_pecas schema/backfill:', e?.message || e);
    }
    try {
      await backfillEnviosSolicitacoesIdAt();
    } catch (_) { /* backfill não deve impedir o schema */ }
  }).catch((err) => {
    _ensureSchemaPromise = null;
    throw err;
  });
  return _ensureSchemaPromise;
}

/** Resolve id_at a partir do texto legado em observacao (O.S 267054, 7534, OS7534…). */
function resolveIdAtFromObservacao(observacao, maps) {
  const obs = String(observacao || '').trim();
  if (!obs) return null;
  const { byId, byYyId, byYyDash, byAi } = maps;
  const tryTok = (tok) => {
    const t = String(tok || '').trim();
    if (!t) return null;
    if (byId.has(t)) return byId.get(t);
    if (byYyDash.has(t)) return byYyDash.get(t);
    const nd = t.replace(/-/g, '');
    if (byYyId.has(nd)) return byYyId.get(nd);
    if (byId.has(nd)) return byId.get(nd);
    if (byAi.has(t)) return byAi.get(t);
    if (byAi.has(nd)) return byAi.get(nd);
    return null;
  };
  let idAt = tryTok(obs);
  if (idAt) return idAt;
  const m =
    obs.match(/^OS\s*([0-9]{2}-?[0-9]{3,6})\b/i) ||
    obs.match(/O\.?\s*S\s*([0-9]{2}-?[0-9]{3,6})\b/i) ||
    obs.match(/O\.?\s*S\s*([0-9]{3,6})\b/i);
  if (m) idAt = tryTok(m[1]);
  return idAt || null;
}

function pareceRefOsNumero(s) {
  const t = String(s || '').trim();
  return /^[0-9]{3,8}$/.test(t) || /^[0-9]{2}-[0-9]+$/.test(t);
}

function parseIdAtParam(raw) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

let _enviosIdAtBackfillPromise = null;
async function backfillEnviosSolicitacoesIdAt() {
  if (_enviosIdAtBackfillPromise) return _enviosIdAtBackfillPromise;
  _enviosIdAtBackfillPromise = (async () => {
    const { rows: pending } = await pool.query(`
      SELECT id, observacao
      FROM envios.solicitacoes
      WHERE id_at IS NULL
        AND observacao IS NOT NULL
        AND TRIM(observacao) <> ''
    `);
    if (!pending.length) return { updated: 0, pending: 0 };

    const { rows: ats } = await pool.query(`
      SELECT id, data, atendimento_inicial FROM sac.at
    `);
    const byId = new Map();
    const byYyId = new Map();
    const byYyDash = new Map();
    const byAi = new Map();
    for (const a of ats) {
      const idStr = String(a.id);
      byId.set(idStr, a.id);
      const yr = a.data ? String(new Date(a.data).getFullYear()).slice(-2) : '';
      if (yr) {
        byYyId.set(`${yr}${a.id}`, a.id);
        byYyDash.set(`${yr}-${a.id}`, a.id);
      }
      if (pareceRefOsNumero(a.atendimento_inicial)) {
        byAi.set(String(a.atendimento_inicial).trim(), a.id);
      }
    }
    const maps = { byId, byYyId, byYyDash, byAi };

    let updated = 0;
    const BATCH = 200;
    const pairs = [];
    for (const e of pending) {
      const idAt = resolveIdAtFromObservacao(e.observacao, maps);
      if (idAt) pairs.push({ envioId: e.id, idAt });
    }
    for (let i = 0; i < pairs.length; i += BATCH) {
      const chunk = pairs.slice(i, i + BATCH);
      const vals = [];
      const params = [];
      let p = 1;
      for (const row of chunk) {
        vals.push(`($${p++}::bigint, $${p++}::bigint)`);
        params.push(row.envioId, row.idAt);
      }
      const r = await pool.query(
        `UPDATE envios.solicitacoes e
            SET id_at = v.id_at
           FROM (VALUES ${vals.join(',')}) AS v(id, id_at)
          WHERE e.id = v.id
            AND e.id_at IS NULL`,
        params
      );
      updated += r.rowCount || 0;
    }
    console.log(`[SAC] backfill envios.solicitacoes.id_at: ${updated}/${pending.length} preenchidos`);
    return { updated, pending: pending.length };
  })().catch((err) => {
    _enviosIdAtBackfillPromise = null;
    console.warn('[SAC] backfill id_at falhou:', err?.message || err);
  });
  return _enviosIdAtBackfillPromise;
}

let _sacAtalhosSchemaReady = false;
async function ensureSacAtalhosSchema() {
  if (_sacAtalhosSchemaReady) return;
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS sac;
    CREATE TABLE IF NOT EXISTS sac.sac_atalhos (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES public.auth_user(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      url         TEXT NOT NULL,
      icon_class  TEXT NOT NULL DEFAULT 'fa-solid fa-link',
      icon_color  TEXT NOT NULL DEFAULT '#38bdf8',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sac_atalhos_user_id ON sac.sac_atalhos (user_id);
  `);
  _sacAtalhosSchemaReady = true;
}

async function migrarEnderecosControleTecnicos() {
  const { rows } = await pool.query(
    `SELECT id, endereco, numero, bairro, complemento
       FROM sac.controle_tecnicos
      WHERE endereco IS NOT NULL
        AND BTRIM(endereco) <> ''
        AND (
          BTRIM(COALESCE(numero, '')) = ''
          AND BTRIM(COALESCE(bairro, '')) = ''
          AND BTRIM(COALESCE(complemento, '')) = ''
        )
        AND (
          endereco LIKE '%,%'
          OR endereco LIKE '% - %'
          OR endereco ~ '\\([^)]+\\)\\s*$'
        )`
  );

  if (!rows.length) return { migrated: 0 };

  let migrated = 0;
  for (const row of rows) {
    const parsed = corrigirCamposEnderecoTecnico(row);
    if (!parsed.endereco && !parsed.numero && !parsed.bairro && !parsed.complemento) continue;
    await pool.query(
      `UPDATE sac.controle_tecnicos
          SET endereco = $1, numero = $2, bairro = $3, complemento = $4
        WHERE id = $5`,
      [
        parsed.endereco || row.endereco,
        parsed.numero || null,
        parsed.bairro || null,
        parsed.complemento || null,
        row.id,
      ]
    );
    migrated += 1;
  }

  if (migrated > 0) {
    console.log(`[SAC/AT] endereços de técnicos migrados: ${migrated}`);
  }
  return { migrated };
}

ensureSchema()
  .then(() => migrarEnderecosControleTecnicos())
  .catch(err => {
    console.error('[SAC] falha ao garantir schema/tabela envios:', err);
  });

// ── Sync automático do cache de série ────────────────────────────────────────
// Executa ao iniciar o servidor e depois a cada 2 horas automaticamente.
// Também é disparado em background quando uma busca não encontra resultado no cache.
let _atSyncEmAndamento = false;

async function _autoSyncAtSerieCache(motivo) {
  if (_atSyncEmAndamento) return; // não inicia dois syncs ao mesmo tempo
  _atSyncEmAndamento = true;
  try {
    const t0 = Date.now();
    const resultado = await syncAtSerieCacheFromSheets();
    console.log(`[SAC/AT] sync cache (${motivo || 'auto'}): +${resultado.inserted} novos | total ${resultado.total_cache} | ${Date.now() - t0}ms`);
  } catch (err) {
    console.error('[SAC/AT] erro no sync do cache de série:', err.message);
  } finally {
    _atSyncEmAndamento = false;
  }
}
// Aguarda 30s após o boot para não concorrer com outras inicializações
setTimeout(() => {
  _autoSyncAtSerieCache('boot');
  setInterval(() => _autoSyncAtSerieCache('agendado'), 2 * 60 * 60 * 1000); // a cada 2 horas
}, 30 * 1000);
// ─────────────────────────────────────────────────────────────────────────────

router.post('/at', async (req, res) => {
  const body = req.body || {};

  const payload = {
    tipo: String(body.tipo || '').trim() || null,
    data: body.data ? (() => { const d = new Date(body.data); return isNaN(d.getTime()) ? new Date() : d; })() : new Date(),
    nomeRevendaCliente: String(body.nome_revenda_cliente || '').trim() || null,
    numeroTelefone: String(body.numero_telefone || '').trim() || null,
    cpfCnpj: String(body.cpf_cnpj || '').trim() || null,
    cep: String(body.cep || '').trim() || null,
    bairro: String(body.bairro || '').trim() || null,
    cidade: String(body.cidade || '').trim() || null,
    estado: String(body.estado || '').trim() || null,
    numero: String(body.numero || '').trim() || null,
    rua: String(body.rua || '').trim() || null,
    agendarAtendimentoCom: String(body.agendar_atendimento_com || '').trim() || null,
    descrevaReclamacao: String(body.descreva_reclamacao || '').trim() || null,
    motivoSolicitacao: String(body.motivo_solicitacao || '').trim() || null,
    acaoTomada: String(body.acao_tomada || '').trim() || null,
    atendimentoInicial: String(body.atendimento_inicial || '').trim() || null,
    modelo: String(body.modelo || '').trim() || null,
    tagProblema: String(body.tag_problema || '').trim() || null,
    subtag: String(body.subtag || '').trim() || null,
    plataformaAtendimento: String(body.plataforma_atendimento || '').trim() || null,
  };

  // Atendimento Rápido → sempre fechado automaticamente (ignora acento)
  const tipoNorm = (payload.tipo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const statusInicial = tipoNorm === 'atendimento rapido' ? 'Fechado' : null;

  // Se vier id_at_existente significa que é um novo registro de reclamação sobre um AT já existente
  const idAtExistente = body.id_at_existente && Number.isInteger(Number(body.id_at_existente))
    ? Number(body.id_at_existente)
    : null;

  const selectedItemRaw = body.selected_item && typeof body.selected_item === 'object'
    ? body.selected_item
    : null;
  const selectedItem = selectedItemRaw ? {
    pedido: String(selectedItemRaw.pedido || '').trim() || null,
    ordemProducao: String(selectedItemRaw.ordem_producao || '').trim() || null,
    modelo: String(selectedItemRaw.modelo || '').trim() || null,
    cliente: String(selectedItemRaw.cliente || '').trim() || null,
    notaFiscal: String(selectedItemRaw.nota_fiscal || '').trim() || null,
    dataEntrega: String(selectedItemRaw.data_entrega || '').trim() || null,
    testeTipoGas: String(selectedItemRaw.teste_tipo_gas || '').trim() || null,
  } : null;

  const hasSelectedItem = !!selectedItem && [
    selectedItem.pedido,
    selectedItem.ordemProducao,
    selectedItem.modelo,
    selectedItem.cliente,
    selectedItem.notaFiscal,
    selectedItem.dataEntrega,
    selectedItem.testeTipoGas,
  ].some(Boolean);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let atRow;

    if (idAtExistente) {
      // AT já existe — apenas inserir nova linha de reclamação (nova entrada na tabela sac.at)
      // referenciando o mesmo item selecionado, sem duplicar sac.at_busca_selecionada
      const result = await client.query(
        `INSERT INTO sac.at (
           tipo,
           data,
           nome_revenda_cliente,
           numero_telefone,
           cpf_cnpj,
           cep,
           bairro,
           cidade,
           estado,
           numero,
           rua,
           agendar_atendimento_com,
           descreva_reclamacao,
           motivo_solicitacao,
           acao_tomada,
           atendimento_inicial,
           modelo,
           tag_problema,
           subtag,
           plataforma_atendimento,
           status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING id, data`,
        [
          payload.tipo,
          payload.data,
          payload.nomeRevendaCliente,
          payload.numeroTelefone,
          payload.cpfCnpj,
          payload.cep,
          payload.bairro,
          payload.cidade,
          payload.estado,
          payload.numero,
          payload.rua,
          payload.agendarAtendimentoCom,
          payload.descrevaReclamacao,
          payload.motivoSolicitacao,
          payload.acaoTomada,
          payload.atendimentoInicial,
          payload.modelo,
          payload.tagProblema,
          payload.subtag,
          payload.plataformaAtendimento,
          statusInicial,
        ]
      );
      atRow = result.rows[0];

      // Copia o vínculo do item selecionado do AT original para este novo AT
      await client.query(
        `INSERT INTO sac.at_busca_selecionada (id_at, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas)
         SELECT $1, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas
           FROM sac.at_busca_selecionada WHERE id_at = $2 LIMIT 1`,
        [atRow.id, idAtExistente]
      );
    } else {
      const result = await client.query(
        `INSERT INTO sac.at (
           tipo,
           data,
           nome_revenda_cliente,
           numero_telefone,
           cpf_cnpj,
           cep,
           bairro,
           cidade,
           estado,
           numero,
           rua,
           agendar_atendimento_com,
           descreva_reclamacao,
           motivo_solicitacao,
           acao_tomada,
           atendimento_inicial,
           modelo,
           tag_problema,
           subtag,
           plataforma_atendimento,
           status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING id, data`,
        [
          payload.tipo,
          payload.data,
          payload.nomeRevendaCliente,
          payload.numeroTelefone,
          payload.cpfCnpj,
          payload.cep,
          payload.bairro,
          payload.cidade,
          payload.estado,
          payload.numero,
          payload.rua,
          payload.agendarAtendimentoCom,
          payload.descrevaReclamacao,
          payload.motivoSolicitacao,
          payload.acaoTomada,
          payload.atendimentoInicial,
          payload.modelo,
          payload.tagProblema,
          payload.subtag,
          payload.plataformaAtendimento,
          statusInicial,
        ]
      );
      atRow = result.rows[0];

      if (hasSelectedItem) {
        await client.query(
          `INSERT INTO sac.at_busca_selecionada (
              id_at, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            atRow.id,
            selectedItem.pedido,
            selectedItem.ordemProducao,
            selectedItem.modelo,
            selectedItem.cliente,
            selectedItem.notaFiscal,
            selectedItem.dataEntrega,
            selectedItem.testeTipoGas,
          ]
        );
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({ ok: true, row: atRow });
  } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[SAC/AT] erro ao salvar atendimento:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao salvar atendimento AT.' });
    } finally {
      client.release();
  }
});

// GET /at/nfe-pendentes-count — NFes com URL preenchida em ATs ainda abertos
router.get('/at/nfe-pendentes-count', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) AS total
      FROM sac.fechamento f
      JOIN sac.at a ON a.id = f.id_at
      WHERE f.nfe_url IS NOT NULL
        AND f.nfe_url <> ''
        AND (a.status IS NULL OR a.status <> 'Fechado')
    `);
    res.json({ total: parseInt(rows[0].total, 10) });
  } catch (err) {
    console.error('[AT] nfe-pendentes-count:', err.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.get('/at/atendimentos', async (_req, res) => {
  try {
    await ensureSchema();
    const t0 = Date.now();

    // 1) Query principal (sem has_pecas_enviadas — evita EXISTS com regex lento)
    const [mainResult, solResult] = await Promise.all([
      pool.query(
        `WITH anexos_cnt AS (
           SELECT id_at, COUNT(*) AS qtd
           FROM sac.at_anexos
           GROUP BY id_at
         )
         SELECT DISTINCT ON (a.id)
           a.id,
           a.data,
           a.tipo,
           a.nome_revenda_cliente,
           a.numero_telefone          AS telefone,
           a.cpf_cnpj,
           a.cep,
           a.rua,
           a.bairro,
           a.numero,
           a.estado,
           a.cidade,
           a.descreva_reclamacao,
           a.atendimento_inicial,
           a.motivo_solicitacao,
           a.acao_tomada,
           COALESCE(a.modelo, s.modelo) AS modelo,
           a.tag_problema,
           a.subtag,
           a.plataforma_atendimento,
           a.editado_por,
           a.editado_em,
           s.pedido,
           s.ordem_producao,
           s.cliente,
           s.nota_fiscal,
           s.data_entrega,
           s.teste_tipo_gas,
           f.id                        AS fech_id,
           f.tag_problema             AS fech_tag,
           f.plataforma_atendimento   AS fech_plataforma,
           f.descricao_servico_realizado AS fech_descricao,
           f.valor_total_mao_obra     AS fech_valor_mo,
           f.valor_gasto_pecas        AS fech_valor_pecas,
           f.pecas_reposicao          AS fech_pecas,
           f.data_conclusao_servico   AS fech_data_conclusao,
           f.observacoes              AS fech_obs,
           f.midias_servico           AS fech_midias,
           f.nfe_url                  AS fech_nfe_url,
           f.data_envio_nfe           AS fech_data_envio_nfe,
           f.observacao_tecnico       AS fech_observacao_tecnico,
           f.status_os                AS status_os,
           CASE
             WHEN LOWER(TRIM(a.tipo)) IN ('atendimento rápido', 'atendimento rapido')
               THEN 'Fechado'
             ELSE a.status
           END                        AS status,
           ct.nome                    AS tecnico_nome,
           COALESCE(anx.qtd, 0)       AS qtd_anexos
         FROM sac.at a
         LEFT JOIN sac.at_busca_selecionada s  ON s.id_at = a.id
         LEFT JOIN sac.fechamento           f  ON f.id_at = a.id
         LEFT JOIN sac.controle_tecnicos    ct ON ct.id = f.id_tecnico
         LEFT JOIN anexos_cnt              anx ON anx.id_at = a.id
         ORDER BY a.id DESC, f.id DESC`
      ),
      // 2) Vínculo OS → envio via coluna id_at
      pool.query(`
        SELECT id_at, rastreio_status
        FROM envios.solicitacoes
        WHERE id_at IS NOT NULL
        ORDER BY id DESC
      `)
    ]);

    const tQuery = Date.now() - t0;

    // Mapa atId → status mais recente (ORDER BY id DESC)
    const atStatusMap = new Map();
    for (const row of solResult.rows) {
      const atId = Number(row.id_at);
      if (!Number.isFinite(atId) || atId < 1) continue;
      if (!atStatusMap.has(atId)) {
        atStatusMap.set(atId, row.rastreio_status || null);
      }
    }

    const rows = mainResult.rows;
    for (const at of rows) {
      const statusDireto = atStatusMap.get(Number(at.id)) || null;
      at.has_pecas_enviadas = atStatusMap.has(Number(at.id));
      at.envios_status = statusDireto;
    }

    console.log(`[SAC/AT] /at/atendimentos ${rows.length} rows em ${Date.now() - t0}ms (query: ${tQuery}ms)`);

    return res.json({ ok: true, rows: rows || [] });
  } catch (err) {
    console.error('[SAC/AT] erro ao listar atendimentos:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao listar atendimentos AT.' });
  }
});

router.patch('/at/atendimentos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id <= 0) return res.status(400).json({ ok: false, error: 'ID inválido.' });

  // mapeamento campo_frontend -> coluna_db
  const FIELD_MAP = {
    nome_revenda_cliente:   'nome_revenda_cliente',
    telefone:               'numero_telefone',
    cpf_cnpj:               'cpf_cnpj',
    estado:                 'estado',
    cidade:                 'cidade',
    descreva_reclamacao:    'descreva_reclamacao',
    motivo_solicitacao:     'motivo_solicitacao',
    acao_tomada:            'acao_tomada',
    modelo:                 'modelo',
    tag_problema:           'tag_problema',
    subtag:                 'subtag',
    plataforma_atendimento: 'plataforma_atendimento',
    atendimento_inicial:    'atendimento_inicial',
    tipo:                   'tipo',
  };

  const setClauses = [];
  const colValues  = [];

  // Campo data tratado separadamente (TIMESTAMP, não TEXT)
  if (Object.prototype.hasOwnProperty.call(req.body, 'data') && req.body.data) {
    const d = new Date(req.body.data);
    if (!isNaN(d.getTime())) {
      setClauses.push(`data = $${setClauses.length + 1}`);
      colValues.push(d);
    }
  }

  for (const [campo, coluna] of Object.entries(FIELD_MAP)) {
    if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
      setClauses.push(`${coluna} = $${setClauses.length + 1}`);
      colValues.push(String(req.body[campo] ?? '').trim() || null);
    }
  }

  // Verifica se veio selected_item para upsert em sac.at_busca_selecionada
  const selectedItemRaw = req.body.selected_item && typeof req.body.selected_item === 'object'
    ? req.body.selected_item : null;

  if (!setClauses.length && !selectedItemRaw)
    return res.status(400).json({ ok: false, error: 'Nenhum campo válido enviado.' });

  const usuarioLogado = req.session?.user?.fullName
                     || req.session?.user?.username
                     || req.session?.user?.login
                     || 'desconhecido';

  try {
    // Atualiza campos do AT principal (se houver)
    if (setClauses.length) {
      setClauses.push(`editado_por = $${setClauses.length + 1}`);
      colValues.push(usuarioLogado);
      setClauses.push(`editado_em = NOW()`);
      const values = [...colValues, id];
      await pool.query(
        `UPDATE sac.at SET ${setClauses.join(', ')} WHERE id = $${values.length}`,
        values
      );
    }

    // Grava/atualiza sac.at_busca_selecionada se veio selected_item
    if (selectedItemRaw) {
      const si = {
        pedido:         String(selectedItemRaw.pedido         || '').trim() || null,
        ordemProducao:  String(selectedItemRaw.ordem_producao || '').trim() || null,
        modelo:         String(selectedItemRaw.modelo         || '').trim() || null,
        cliente:        String(selectedItemRaw.cliente        || '').trim() || null,
        notaFiscal:     String(selectedItemRaw.nota_fiscal    || '').trim() || null,
        dataEntrega:    String(selectedItemRaw.data_entrega   || '').trim() || null,
        testeTipoGas:   String(selectedItemRaw.teste_tipo_gas || '').trim() || null,
      };
      const _buscaExist = await pool.query(
        `SELECT id FROM sac.at_busca_selecionada WHERE id_at = $1 LIMIT 1`, [id]
      );
      if (_buscaExist.rowCount > 0) {
        await pool.query(
          `UPDATE sac.at_busca_selecionada SET
             pedido         = $2,
             ordem_producao = $3,
             modelo         = $4,
             cliente        = $5,
             nota_fiscal    = $6,
             data_entrega   = $7,
             teste_tipo_gas = $8
           WHERE id_at = $1`,
          [id, si.pedido, si.ordemProducao, si.modelo, si.cliente, si.notaFiscal, si.dataEntrega, si.testeTipoGas]
        );
      } else {
        await pool.query(
          `INSERT INTO sac.at_busca_selecionada
             (id_at, pedido, ordem_producao, modelo, cliente, nota_fiscal, data_entrega, teste_tipo_gas)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, si.pedido, si.ordemProducao, si.modelo, si.cliente, si.notaFiscal, si.dataEntrega, si.testeTipoGas]
        );
      }
    }

    return res.json({ ok: true, editado_por: usuarioLogado, editado_em: new Date().toISOString() });
  } catch (err) {
    console.error('[SAC/AT] erro ao atualizar atendimento:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar atendimento.' });
  }
});

// ─── PATCH /at/status/:id — altera apenas o campo status de sac.at ───────────
router.patch('/at/status/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id <= 0) return res.status(400).json({ ok: false, error: 'ID inválido.' });

  const VALORES_VALIDOS = ['Aberto', 'Fechado', 'Aguardando NF AT', 'Excluido'];
  const { status } = req.body || {};
  if (!status || !VALORES_VALIDOS.includes(status)) {
    return res.status(400).json({ ok: false, error: `Status inválido. Use: ${VALORES_VALIDOS.join(', ')}.` });
  }

  try {
    const r = await pool.query(
      `UPDATE sac.at SET status = $1 WHERE id = $2 RETURNING id, status`,
      [status, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: 'OS não encontrada.' });
    return res.json({ ok: true, id, status: r.rows[0].status });
  } catch (err) {
    console.error('[SAC/AT] erro ao atualizar status:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao atualizar status.' });
  }
});

router.patch('/at/fechamento/:id_at', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!idAt || idAt <= 0) return res.status(400).json({ ok: false, error: 'ID inválido.' });

  const FECH_FIELDS = [
    'tag_problema', 'plataforma_atendimento', 'descricao_servico_realizado',
    'valor_total_mao_obra', 'valor_gasto_pecas', 'pecas_reposicao',
    'data_conclusao_servico', 'observacoes', 'midias_servico', 'observacao_tecnico'
  ];
  const cols = [];
  const vals = [];
  for (const field of FECH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      let v = String(req.body[field] ?? '').trim() || null;
      cols.push(field);
      vals.push(v);
    }
  }
  if (!cols.length) return res.status(400).json({ ok: false, error: 'Nenhum campo válido.' });

  try {
    const existing = await pool.query('SELECT id FROM sac.fechamento WHERE id_at = $1', [idAt]);
    if (existing.rows.length) {
      const setList = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await pool.query(
        `UPDATE sac.fechamento SET ${setList} WHERE id_at = $1`,
        [idAt, ...vals]
      );
    } else {
      await pool.query(
        `INSERT INTO sac.fechamento (id_at, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [idAt, ...vals]
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/AT] erro ao salvar fechamento:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao salvar fechamento.' });
  }
});

// POST /solicitacoes/vipp — cria entrada de envio SAC a partir de postagem VIPP (sem upload de arquivo)
router.post('/solicitacoes/vipp', async (req, res) => {
  await ensureSchema();
  const usuario   = String(req.body?.usuario || '').trim()
    || String(req.session?.user?.username || req.session?.user?.fullName || req.session?.user?.nome || req.session?.user?.login || '').trim();
  const observacao = String(req.body?.observacao || '').trim();
  const idVipp    = String(req.body?.id_vipp    || '').trim() || null;
  const conteudo  = req.body?.conteudo || null; // JSON string de itens [{ conteudo, quantidade }]
  const numeroSep = String(req.body?.numero_sep || '').trim() || null;
  const metodoEnvio = String(req.body?.metodo_envio || '').trim() || null;
  const idAt = parseIdAtParam(req.body?.id_at);

  if (!usuario) return res.status(400).json({ ok: false, error: 'Usuário é obrigatório.' });
  if (!idVipp && !observacao && !metodoEnvio) {
    return res.status(400).json({ ok: false, error: 'id_vipp, observação ou método de envio obrigatório.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO envios.solicitacoes
         (usuario, observacao, numero_sep, rastreio_status, anexos, conferido, id_vipp, conteudo, metodo_envio, id_at)
       VALUES ($1, $2, $3, 'Pendente', '{}', false, $4, $5, $6, $7)
       RETURNING id, created_at, rastreio_status, id_vipp, conteudo, observacao, metodo_envio, id_at`,
      [usuario, observacao || null, numeroSep, idVipp, conteudo ? String(conteudo) : null, metodoEnvio, idAt]
    );
    const row = result.rows[0];
    try { await syncCustoPecasEnvio(pool, row.id); } catch (e) {
      console.warn('[SAC] sync custo_pecas VIPP:', e?.message || e);
    }
    return res.json({ ok: true, id: row.id, created_at: row.created_at, rastreio_status: row.rastreio_status, id_vipp: row.id_vipp, id_at: row.id_at });
  } catch (err) {
    console.error('[SAC] erro ao criar entrada via VIPP:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao registrar solicitação VIPP.' });
  }
});

router.post('/solicitacoes', upload.array('anexos', 2), async (req, res) => {
  await ensureSchema();
  const usuario = String(req.body?.usuario || '').trim();
  const observacao = String(req.body?.observacao || '').trim();
  const numeroSep = String(req.body?.numero_sep || req.body?.numeroSep || '').trim() || null;
  const idAt = parseIdAtParam(req.body?.id_at);
  const rastreioStatus = 'Pendente';

  if (!usuario) {
    return res.status(400).json({ ok: false, error: 'Usuário é obrigatório.' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length !== 2) {
    return res.status(400).json({ ok: false, error: 'Selecione exatamente 2 arquivos: Etiqueta e Declaração de conteúdo.' });
  }

  const declaracaoFile = files[1];
  if (!declaracaoFile || declaracaoFile.mimetype !== 'application/pdf') {
    return res.status(400).json({ ok: false, error: 'O arquivo de Declaração deve ser um PDF válido.' });
  }

  let declaracaoParsedText = '';
  try {
    const parsed = await pdfParse(declaracaoFile.buffer);
    declaracaoParsedText = String(parsed?.text || '');
  } catch (err) {
    return res.status(400).json({ ok: false, error: 'Não foi possível ler o PDF da Declaração.' });
  }

  if (!isDaceDeclaracaoPdf(declaracaoParsedText)) {
    return res.status(400).json({ ok: false, error: 'Arquivo inválido para Declaração. O cabeçalho deve conter "DACE - DECLARAÇÃO AUXILIAR DE CONTEÚDO ELETRONICA".' });
  }

  const urls = [];
  let identificacao = null;
  let chaveDce = null;
  let conteudo = extractConteudo(declaracaoParsedText);
  let conteudoOrigem = conteudo ? 'pdf' : null;

  // Extrai chave fiscal DCE para validação e consulta SEFAZ
  chaveDce = extractDceChaveFromPdf(declaracaoParsedText);

  // Prioriza dados estruturados da SEFAZ quando a chave estiver disponível
  if (chaveDce) {
    try {
      const sefazConteudo = await fetchSefazProdutos(chaveDce);
      if (sefazConteudo) {
        conteudo = sefazConteudo;
        conteudoOrigem = 'sefaz';
        console.log('[SAC] conteudo obtido via SEFAZ para chave', chaveDce);
      } else if (!conteudo) {
        console.warn('[SAC] SEFAZ não retornou itens e parser do PDF também falhou para chave', chaveDce);
      }
    } catch (err) {
      console.warn('[SAC] erro ao consultar SEFAZ:', err?.message || err);
    }
  }
  if (conteudoOrigem) {
    console.log(`[SAC] origem do conteudo: ${conteudoOrigem}`);
  }

  try {
    // Faz upload opcional dos arquivos selecionados
    for (const [index, file] of files.entries()) {
      const ext = mime.extension(file.mimetype) || 'bin';
      const fileName = `${uuidv4()}.${ext}`;
      const pathKey = `sac/${fileName}`;

      const { error: upErr } = await supabase
        .storage
        .from(BUCKET)
        .upload(pathKey, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(pathKey);
      urls.push(data.publicUrl);

      // Extrai código de barras somente do primeiro arquivo (Etiqueta)
      if (index === 0 && !identificacao && file.mimetype === 'application/pdf') {
        try {
          const parsed = await pdfParse(file.buffer);
          const text = String(parsed?.text || '');
          const match = text.match(/[A-Z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\s?[A-Z]{2}/);
          if (match) {
            identificacao = match[0].replace(/\s+/g, ' ').trim();
          }
        } catch (err) {
          console.warn('[SAC] não foi possível extrair identificação da etiqueta:', err?.message || err);
        }
      }

    }

    const etiquetaUrl = urls[0] || null;
    const declaracaoUrl = urls[1] || null;

    const result = await pool.query(
      `INSERT INTO envios.solicitacoes (usuario, observacao, numero_sep, rastreio_status, anexos, conferido, etiqueta_url, declaracao_url, identificacao, conteudo, chave_dce, id_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, created_at, rastreio_status, anexos, conferido, etiqueta_url, declaracao_url, identificacao, numero_sep, conteudo, chave_dce, id_at`,
      [usuario, observacao, numeroSep, rastreioStatus, urls, false, etiquetaUrl, declaracaoUrl, identificacao, conteudo, chaveDce, idAt]
    );

    const row = result.rows[0];
    try { await syncCustoPecasEnvio(pool, row.id); } catch (e) {
      console.warn('[SAC] sync custo_pecas:', e?.message || e);
    }
    return res.json({ ok: true, id: row.id, created_at: row.created_at, rastreio_status: row.rastreio_status, anexos: row.anexos, conferido: row.conferido, etiqueta_url: row.etiqueta_url, declaracao_url: row.declaracao_url, identificacao: row.identificacao, numero_sep: row.numero_sep, conteudo: row.conteudo, chave_dce: row.chave_dce, id_at: row.id_at });
  } catch (err) {
    console.error('[SAC] erro ao inserir solicitação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao registrar solicitação.' });
  }
});

// Lista solicitações de envio (com opção de filtrar por usuário logado)
router.get('/solicitacoes', async (req, res) => {
  try {
    const hideDone = String(req.query?.hideDone || '').toLowerCase() === 'true' || req.query?.hideDone === '1';
    const filaLogistica = String(req.query?.filaLogistica || '').toLowerCase() === 'true' || req.query?.filaLogistica === '1';
    // Novo parâmetro: filterByUser=1 indica que deve filtrar apenas registros do usuário logado
    const filterByUser = String(req.query?.filterByUser || '').toLowerCase() === 'true' || req.query?.filterByUser === '1';

    const conditions = [];
    const params = [];

    // Fila Envio de mercadoria: tudo que ainda não foi marcado Enviado/Excluído (inclui legado Valida, ok, etc.)
    if (filaLogistica) {
      conditions.push("COALESCE(rastreio_status, '') NOT IN ('Excluído', 'Enviado', 'Entregue', 'Finalizado')");
    } else if (hideDone) {
      conditions.push("COALESCE(rastreio_status, '') NOT IN ('Enviado', 'Excluído')");
    }

    // Filtro por usuário logado (apenas se filterByUser=true)
    if (filterByUser) {
      const usuarioLogado = req.session?.user?.fullName 
                         || req.session?.user?.username 
                         || req.session?.user?.login
                         || null;

      if (!usuarioLogado) {
        return res.status(401).json({ ok: false, error: 'Usuário não autenticado.' });
      }

      params.push(usuarioLogado);
      conditions.push(`usuario = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const r = await pool.query(
      `SELECT id, created_at, usuario, observacao, numero_sep, conferido, etiqueta_url, declaracao_url, identificacao, conteudo, rastreio_status, rastreio_quando, finalizado_em, id_vipp, metodo_envio, id_at, valor_envio
         FROM envios.solicitacoes
        ${whereClause}
        ORDER BY id DESC
        LIMIT 200`,
      params
    );
    return res.json({ ok: true, rows: r.rows });
  } catch (err) {
    console.error('[SAC] erro ao listar solicitacoes:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar solicitacoes.' });
  }
});

// Rastreio: tenta Correios e depois LinkeTrack, com cache simples em memória
router.get('/rastreio/:codigo', async (req, res) => {
  const codigo = sanitizeIdentificacao(req.params.codigo);
  if (!codigo) {
    return res.status(400).json({ ok: false, error: 'Código inválido.' });
  }

  try {
    const now = Date.now();
    const cached = trackCache.get(codigo);
    if (cached && (now - cached.at) < (cached.ok ? CACHE_HIT_TTL_MS : CACHE_FAIL_TTL_MS)) {
      const payload = cached.payload || {};
      // Garante persistência mesmo em cache, útil para marcar Finalizado após ajuste de lógica
      await persistStatus(codigo, {
        status: payload.status || payload.detalhe || 'ok',
        detalhe: payload.detalhe,
        local: payload.local,
        cidade: payload.cidade,
        uf: payload.uf,
        quando: payload.quando
      });
      return res.json(cached.payload);
    }

    let lastErr = null;

    // Tentativa 1: Correios
    try {
      const urlCorreios = `https://proxyapp.correios.com.br/v1/sro-rastro/${codigo}`;
      const r1 = await fetchWithTimeout(urlCorreios, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://rastreamento.correios.com.br/app/index.php'
        }
      });

      if (r1.ok) {
        const data = await r1.json();
        const eventos = data?.objetos?.[0]?.eventos || [];
        const ultimo = eventos[0] || null;
        const status = ultimo?.descricao || null;
        const detalhe = ultimo?.detalhe || null;
        const local = ultimo?.unidade?.local || null;
        const cidade = ultimo?.unidade?.endereco?.cidade || null;
        const uf = ultimo?.unidade?.endereco?.uf || null;
        const quando = ultimo?.dtHrCriado || null;
        const payload = { ok: true, codigo, status, detalhe, local, cidade, uf, quando };
        await persistStatus(codigo, { status: status || detalhe || 'ok', detalhe, local, cidade, uf, quando });
        trackCache.set(codigo, { ok: true, payload, at: now });
        return res.json(payload);
      }
    } catch (err) {
      lastErr = err;
    }

    // Tentativa 2: Wonca API (requer WONCA_API_KEY)
    if (WONCA_API_KEY) {
      try {
        const r2 = await fetchWithTimeout(WONCA_TRACK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Apikey ${WONCA_API_KEY}`
          },
          body: JSON.stringify({ code: codigo })
        });

        if (r2.ok) {
          const data2 = await r2.json();

          const eventos2 = data2?.events
            || data2?.eventos
            || data2?.data?.events
            || data2?.data?.eventos
            || [];

          const ultimo2 = Array.isArray(eventos2) ? eventos2[0] || null : null;
          const status2 = ultimo2?.description || ultimo2?.descricao || ultimo2?.status || data2?.status || null;
          const detalhe2 = ultimo2?.detail || ultimo2?.detalhe || ultimo2?.message || null;
          const local2 = ultimo2?.local || ultimo2?.location || null;
          const cidade2 = ultimo2?.cidade || ultimo2?.city || null;
          const uf2 = ultimo2?.uf || ultimo2?.state || null;
          const quando2 = ultimo2?.datetime
            || ultimo2?.dataHora
            || (ultimo2?.date && ultimo2?.time ? `${ultimo2.date} ${ultimo2.time}` : null);

          const payload = { ok: true, codigo, status: status2, detalhe: detalhe2, local: local2, cidade: cidade2, uf: uf2, quando: quando2 };
          await persistStatus(codigo, { status: status2 || detalhe2 || 'ok', detalhe: detalhe2, local: local2, cidade: cidade2, uf: uf2, quando: quando2 });
          trackCache.set(codigo, { ok: true, payload, at: now });
          return res.json(payload);
        }

        lastErr = new Error(`Wonca HTTP ${r2.status}`);
      } catch (err) {
        lastErr = err;
      }
    }

    // Tentativa 3: TrackingMore (carrier Correios)
    if (TRACKINGMORE_API_KEY) {
      try {
        const r3 = await fetchWithTimeout(TRACKINGMORE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Trackingmore-Api-Key': TRACKINGMORE_API_KEY
          },
          body: JSON.stringify({ tracking_number: codigo, carrier_code: 'brazil-correios' })
        });

        if (r3.ok) {
          const data3 = await r3.json();
          const item = data3?.data?.items?.[0] || null;

          if (item && item.status && item.status !== 'notfound') {
            const trackInfos = item?.origin_info?.trackinfo || item?.destination_info?.trackinfo || [];
            const ultimo3 = Array.isArray(trackInfos) ? trackInfos[0] || null : null;

            const status3 = ultimo3?.StatusDescription
              || ultimo3?.statusDescription
              || ultimo3?.Status
              || ultimo3?.status
              || item?.status
              || null;

            const detalhe3 = ultimo3?.Details
              || ultimo3?.details
              || ultimo3?.checkpoint_delivery_status
              || ultimo3?.substatus
              || null;

            const local3 = ultimo3?.Location
              || ultimo3?.location
              || ultimo3?.checkpoint_city
              || null;

            const cidade3 = ultimo3?.city || ultimo3?.checkpoint_city || null;
            const uf3 = ultimo3?.state || ultimo3?.checkpoint_state || null;
            const quando3 = ultimo3?.Date
              || ultimo3?.date
              || ultimo3?.EventTime
              || ultimo3?.checkpoint_time
              || null;

            const payload = { ok: true, codigo, status: status3, detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 };
            await persistStatus(codigo, { status: status3 || detalhe3 || item?.status || 'ok', detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 });
            trackCache.set(codigo, { ok: true, payload, at: now });
            return res.json(payload);
          }

          if (item?.status === 'notfound') {
            lastErr = new Error('TrackingMore: código não encontrado');
          } else {
            lastErr = new Error('TrackingMore: resposta sem eventos');
          }
        } else {
          lastErr = new Error(`TrackingMore HTTP ${r3.status}`);
        }
      } catch (err) {
        lastErr = err;
      }
    }

    // Tentativa 4: LinkeTrack (com fallback para múltiplas bases)
    if (TRACK_USER && TRACK_TOKEN) {
      for (const baseUrl of TRACK_BASES) {
        try {
          const cleanBase = baseUrl.replace(/\/$/, '');
          const urlLinke = `${cleanBase}/track/json?user=${encodeURIComponent(TRACK_USER)}&token=${encodeURIComponent(TRACK_TOKEN)}&codigo=${encodeURIComponent(codigo)}`;
          const r3 = await fetchWithTimeout(urlLinke, { method: 'GET' });

          if (!r3.ok) {
            lastErr = new Error(`HTTP ${r3.status} em ${cleanBase}`);
            continue;
          }

          const data3 = await r3.json();
          const eventos3 = data3?.eventos || [];
          const ultimo3 = eventos3[0] || null;
          const status3 = ultimo3?.status || ultimo3?.descricao || null;
          const detalhe3 = ultimo3?.subStatus?.join(' | ') || null;
          const local3 = ultimo3?.local || null;
          const cidade3 = ultimo3?.cidade || null;
          const uf3 = ultimo3?.uf || null;
          const quando3 = ultimo3?.data && ultimo3?.hora ? `${ultimo3.data} ${ultimo3.hora}` : null;

          const payload = { ok: true, codigo, status: status3, detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 };
          await persistStatus(codigo, { status: status3 || detalhe3 || 'ok', detalhe: detalhe3, local: local3, cidade: cidade3, uf: uf3, quando: quando3 });
          trackCache.set(codigo, { ok: true, payload, at: now });
          return res.json(payload);
        } catch (err) {
          lastErr = err;
          if (err?.code === 'ENOTFOUND') continue;
        }
      }
    }

    const stored = await getStoredStatus(codigo);
    if (stored?.status) {
      const payloadStored = { ok: true, codigo, status: stored.status, detalhe: stored.detalhe, local: stored.local, cidade: stored.cidade, uf: stored.uf, quando: stored.quando };
      trackCache.set(codigo, { ok: true, payload: payloadStored, at: now });
      return res.json(payloadStored);
    }

    const payload = { ok: false, error: 'Rastreamento indisponível no momento.' };
    if (lastErr?.message) payload.detail = lastErr.message;
    trackCache.set(codigo, { ok: false, payload, at: now });
    return res.status(200).json(payload);
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    const stored = await getStoredStatus(codigo);
    if (stored?.status) {
      const payloadStored = { ok: true, codigo, status: stored.status, detalhe: stored.detalhe, local: stored.local, cidade: stored.cidade, uf: stored.uf, quando: stored.quando };
      trackCache.set(codigo, { ok: true, payload: payloadStored, at: Date.now() });
      return res.json(payloadStored);
    }

    const payload = { ok: false, error: aborted ? 'Timeout ao consultar rastreio.' : 'Rastreamento indisponível no momento.' };
    trackCache.set(codigo, { ok: false, payload, at: Date.now() });
    return res.status(200).json(payload);
  }
});

router.patch('/solicitacoes/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const status = normalizeStatus(req.body?.status);
  if (!STATUS_LIST.includes(status)) {
    return res.status(400).json({ ok: false, error: 'Status inválido.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET rastreio_status = $1,
              rastreio_quando = CASE WHEN $1 = 'Enviado' THEN NOW() ELSE rastreio_quando END
        WHERE id = $2
      RETURNING id, rastreio_status`,
      [status, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, rastreio_status: r.rows[0].rastreio_status });
  } catch (err) {
    console.error('[SAC] erro ao atualizar status:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar status.' });
  }
});

// Endpoint para editar identificação (rastreabilidade)
router.patch('/solicitacoes/:id/identificacao', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const identificacao = String(req.body?.identificacao || '').trim();
  if (!identificacao) {
    return res.status(400).json({ ok: false, error: 'Identificação é obrigatória.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET identificacao = $1
        WHERE id = $2
      RETURNING id, identificacao`,
      [identificacao, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, identificacao: r.rows[0].identificacao });
  } catch (err) {
    console.error('[SAC] erro ao atualizar identificação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar identificação.' });
  }
});

// Endpoint para editar observação
router.patch('/solicitacoes/:id/observacao', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const observacao = String(req.body?.observacao || '').trim();

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET observacao = $1
        WHERE id = $2
      RETURNING id, observacao`,
      [observacao, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, observacao: r.rows[0].observacao });
  } catch (err) {
    console.error('[SAC] erro ao atualizar observação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar observação.' });
  }
});

// Endpoint para editar status livre (qualquer valor)
router.patch('/solicitacoes/:id/status-livre', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const status = String(req.body?.status || '').trim();
  if (!status) {
    return res.status(400).json({ ok: false, error: 'Status não pode ser vazio.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET rastreio_status = $1
        WHERE id = $2
      RETURNING id, rastreio_status`,
      [status, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, rastreio_status: r.rows[0].rastreio_status });
  } catch (err) {
    console.error('[SAC] erro ao atualizar status livre:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar status.' });
  }
});

// Endpoint para editar quantidade dentro do campo conteudo (JSON)
router.patch('/solicitacoes/:id/quantidade', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  const conteudoNovo = req.body?.conteudo;
  if (!conteudoNovo) {
    return res.status(400).json({ ok: false, error: 'Conteúdo não fornecido.' });
  }

  try {
    // Validar se é um JSON válido
    const conteudoStr = typeof conteudoNovo === 'string' ? conteudoNovo : JSON.stringify(conteudoNovo);
    JSON.parse(conteudoStr); // Valida o JSON

    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET conteudo = $1
        WHERE id = $2
      RETURNING id, conteudo`,
      [conteudoStr, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, conteudo: r.rows[0].conteudo });
  } catch (err) {
    console.error('[SAC] erro ao atualizar quantidade:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar quantidade.' });
  }
});

// Endpoint para excluir (marcar rastreio_status como "Excluído")
router.delete('/solicitacoes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET rastreio_status = 'Excluído'
        WHERE id = $1
      RETURNING id, rastreio_status`,
      [id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, rastreio_status: r.rows[0].rastreio_status });
  } catch (err) {
    console.error('[SAC] erro ao excluir solicitação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir solicitação.' });
  }
});

// ── Cache SQL: sync das planilhas de série para sac.at_serie_cache ────────────
// Estratégia: INSERT ... ON CONFLICT DO NOTHING → só insere registros novos.
// Rodar manualmente via POST /api/sac/at/sync-cache sempre que a planilha
// receber novos pedidos (ou agendar via cron).
async function syncAtSerieCacheFromSheets() {
  const registros = [];
  const erros = [];

  // ── Helper: extrai campos comuns de um rowObj (objeto com headers como chaves)
  const extrairComHeaders = (rowObj, fonte) => {
    const pedido          = getValueByHeaderMatch(rowObj, k => k.includes('PEDIDO'));
    const ordemProducao   = getValueByHeaderMatch(rowObj, k => k.includes('ORDEM') && k.includes('PRODUCAO'));
    const modelo          = getValueByHeaderMatch(rowObj, k => k.includes('MODELO'));
    const cliente         = getValueByHeaderMatch(rowObj, k => k.includes('CLIENTE') || k.includes('REVENDA'));
    const dataVenda       = getValueByHeaderMatch(rowObj, k => k.includes('DATA') && k.includes('VENDA'));
    const notaFiscal      = getValueByHeaderMatch(rowObj, k => k.includes('NOTA') && k.includes('FISCAL'));
    const chaveNfe        = getValueByHeaderMatch(rowObj, k => k.includes('CHAVE') && k.includes('NFE'));
    const dataEntrega     = getValueByHeaderMatch(rowObj, k => k.includes('DATA') && k.includes('ENTREGA'));
    const testeTipoGas    = getValueByHeaderMatch(rowObj, k => k.includes('TESTE') && k.includes('TIPO') && k.includes('GAS'))
                         || getValueByHeaderMatch(rowObj, k => k.includes('1REF') && k.includes('FLUIDO'));
    const pNorm  = normalizeText(pedido);
    const opNorm = normalizeText(ordemProducao);
    if (!pNorm && !opNorm) return null;
    return {
      fonte, pedido, ordem_producao: ordemProducao, modelo, cliente,
      data_venda: dataVenda, nota_fiscal: notaFiscal, chave_nfe: chaveNfe,
      data_entrega: dataEntrega, teste_tipo_gas: testeTipoGas,
      chave_dedup: `${pNorm}|${opNorm}|${fonte}`,
    };
  };

  // ── Fonte 1 & 2: PRODUÇÃO 1 e 2 (pub URL — sheets sem ID direto)
  for (const sheetName of AT_SERIE_SHEETS) {
    try {
      const rows = await fetchAtSerieSheetRows(sheetName);
      for (const r of rows) {
        const reg = extrairComHeaders(r, sheetName);
        if (reg) registros.push(reg);
      }
    } catch (e) {
      erros.push(`${sheetName}: ${e.message}`);
    }
  }

  // ── Fonte 3: PEDIDOS (já usa /export — ignora filtros)
  try {
    const rows = await fetchPedidosSerieRows();
    for (const r of rows) {
      const reg = extrairComHeaders(r, 'PEDIDOS');
      if (reg) registros.push(reg);
    }
  } catch (e) { erros.push(`PEDIDOS: ${e.message}`); }

  // ── Fonte 4: TESTE/GAS (já usa /export)
  try {
    const rows = await fetchTesteGasRows();
    for (const r of rows) {
      const reg = extrairComHeaders(r, 'TESTE_GAS');
      if (reg) registros.push(reg);
    }
  } catch (e) { erros.push(`TESTE_GAS: ${e.message}`); }

  if (!registros.length) {
    return { inserted: 0, skipped: 0, total_cache: 0, erros };
  }

  // ── INSERT em lotes de 500, ignorando conflito (chave_dedup única)
  const BATCH = 500;
  let inserted = 0;
  const client = await pool.connect();
  try {
    for (let i = 0; i < registros.length; i += BATCH) {
      const lote = registros.slice(i, i + BATCH);
      const values = [];
      const params = [];
      lote.forEach((r, idx) => {
        const b = idx * 11;
        values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`);
        params.push(
          r.fonte, r.pedido || null, r.ordem_producao || null, r.modelo || null,
          r.cliente || null, r.data_venda || null, r.nota_fiscal || null,
          r.chave_nfe || null, r.data_entrega || null, r.teste_tipo_gas || null,
          r.chave_dedup
        );
      });
      const sql = `
        INSERT INTO sac.at_serie_cache
          (fonte, pedido, ordem_producao, modelo, cliente, data_venda,
           nota_fiscal, chave_nfe, data_entrega, teste_tipo_gas, chave_dedup)
        VALUES ${values.join(',')}
        ON CONFLICT (chave_dedup) DO NOTHING`;
      const res = await client.query(sql, params);
      inserted += res.rowCount || 0;
    }
  } finally {
    client.release();
  }

  const skipped = registros.length - inserted;
  let cache_enriquecido_vendas = 0;
  try {
    cache_enriquecido_vendas = await enriquecerAtSerieCacheComVendasLote();
  } catch (enrichErr) {
    erros.push(`enriquecimento_vendas: ${enrichErr.message}`);
  }
  const { rows: [{ total_cache }] } = await pool.query('SELECT COUNT(*) AS total_cache FROM sac.at_serie_cache');
  return {
    inserted,
    skipped,
    total_fontes: registros.length,
    total_cache: Number(total_cache),
    cache_enriquecido_vendas,
    erros,
  };
}

router.post('/at/sync-cache', async (req, res) => {
  try {
    const t0 = Date.now();
    const resultado = await syncAtSerieCacheFromSheets();
    return res.json({ ok: true, ...resultado, duration_ms: Date.now() - t0 });
  } catch (err) {
    console.error('[SAC/AT] erro ao sincronizar cache de série:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
// ── Fim: sync cache ───────────────────────────────────────────────────────────

function _serieCampoVazio(val) {
  return !String(val || '').trim();
}

/** Variantes do pedido da planilha (ex.: 17164-B → 17164-B, 17164). */
function _candidatosPedidoVendas(pedido) {
  const p = String(pedido || '').trim();
  if (!p) return [];
  const out = new Set([p]);
  const semSufixo = p.replace(/-[A-Za-z]+$/, '').trim();
  if (semSufixo) out.add(semSufixo);
  const soNumeros = p.match(/^(\d+)/);
  if (soNumeros?.[1]) out.add(soNumeros[1]);
  return [...out];
}

/** Busca Cliente/NF/Data em "Vendas" a partir do numero_pedido (coluna Pedido da busca). */
async function buscarDadosVendaPorPedidos(pedidos) {
  const originais = [...new Set(
    (pedidos || []).map((p) => String(p || '').trim()).filter(Boolean)
  )];
  if (!originais.length) return new Map();

  const candidatoParaOriginais = new Map();
  const todosCandidatos = new Set();
  for (const orig of originais) {
    for (const cand of _candidatosPedidoVendas(orig)) {
      todosCandidatos.add(cand);
      if (!candidatoParaOriginais.has(cand)) candidatoParaOriginais.set(cand, []);
      candidatoParaOriginais.get(cand).push(orig);
    }
  }

  const lista = [...todosCandidatos];
  const { rows } = await pool.query(`
    WITH pv AS (
      SELECT DISTINCT ON (TRIM(p.numero_pedido))
        TRIM(p.numero_pedido) AS numero_pedido,
        p.codigo_pedido
      FROM "Vendas".pedidos_venda p
      WHERE TRIM(COALESCE(p.numero_pedido, '')) = ANY($1::text[])
      ORDER BY TRIM(p.numero_pedido), p.updated_at DESC NULLS LAST
    )
    SELECT DISTINCT ON (pv.numero_pedido)
      pv.numero_pedido,
      nf.razao_emitente,
      nf.numero_nota,
      nf.chave_nfe,
      nf.data_emissao
    FROM pv
    JOIN "Vendas".notas_fiscais_omie nf
      ON TRIM(COALESCE(nf.numero_pedido, '')) = TRIM(COALESCE(pv.codigo_pedido::text, ''))
    WHERE COALESCE(nf.chave_nfe, '') <> ''
    ORDER BY pv.numero_pedido, nf.updated_at DESC NULLS LAST
  `, [lista]);

  const map = new Map();
  for (const r of rows) {
    const dados = {
      cliente: r.razao_emitente || '',
      nota_fiscal: r.numero_nota || '',
      chave_nfe: r.chave_nfe || '',
      data_entrega: r.data_emissao || '',
    };
    const matched = candidatoParaOriginais.get(String(r.numero_pedido).trim()) || [];
    for (const orig of matched) {
      if (!map.has(orig)) map.set(orig, dados);
    }
  }
  return map;
}

async function persistirEnriquecimentoVendasNoCache(updates) {
  for (const u of updates) {
    await pool.query(`
      UPDATE sac.at_serie_cache
      SET
        cliente = CASE
          WHEN COALESCE(TRIM(cliente), '') = '' THEN COALESCE($2, cliente)
          ELSE cliente
        END,
        nota_fiscal = CASE
          WHEN COALESCE(TRIM(nota_fiscal), '') = '' THEN COALESCE($3, nota_fiscal)
          ELSE nota_fiscal
        END,
        chave_nfe = CASE
          WHEN COALESCE(TRIM(chave_nfe), '') = '' THEN COALESCE($4, chave_nfe)
          ELSE chave_nfe
        END,
        data_entrega = CASE
          WHEN COALESCE(TRIM(data_entrega), '') = '' THEN COALESCE($5, data_entrega)
          ELSE data_entrega
        END
      WHERE TRIM(COALESCE(pedido, '')) = TRIM($1)
    `, [
      u.pedido,
      u.cliente || null,
      u.nota_fiscal || null,
      u.chave_nfe || null,
      u.data_entrega || null,
    ]);
  }
}

async function enriquecerAtSerieCacheComVendasLote() {
  const { rowCount } = await pool.query(`
    UPDATE sac.at_serie_cache c
    SET
      cliente = COALESCE(NULLIF(TRIM(c.cliente), ''), dados.razao_emitente),
      nota_fiscal = COALESCE(NULLIF(TRIM(c.nota_fiscal), ''), dados.numero_nota),
      chave_nfe = COALESCE(NULLIF(TRIM(c.chave_nfe), ''), dados.chave_nfe),
      data_entrega = COALESCE(NULLIF(TRIM(c.data_entrega), ''), dados.data_emissao)
    FROM (
      SELECT DISTINCT ON (TRIM(p.numero_pedido))
        TRIM(p.numero_pedido) AS numero_pedido,
        nf.razao_emitente,
        nf.numero_nota,
        nf.chave_nfe,
        nf.data_emissao
      FROM "Vendas".pedidos_venda p
      JOIN "Vendas".notas_fiscais_omie nf
        ON TRIM(COALESCE(nf.numero_pedido, '')) = TRIM(COALESCE(p.codigo_pedido::text, ''))
      WHERE COALESCE(nf.chave_nfe, '') <> ''
      ORDER BY TRIM(p.numero_pedido), nf.updated_at DESC NULLS LAST
    ) dados
    WHERE (
      TRIM(COALESCE(c.pedido, '')) = dados.numero_pedido
      OR REGEXP_REPLACE(TRIM(COALESCE(c.pedido, '')), '-[A-Za-z]+$', '') = dados.numero_pedido
    )
      AND (
        COALESCE(TRIM(c.cliente), '') = ''
        OR COALESCE(TRIM(c.nota_fiscal), '') = ''
        OR COALESCE(TRIM(c.data_entrega), '') = ''
      )
  `);
  return rowCount || 0;
}

async function enriquecerResultadosSerieComVendas(resultados) {
  if (!Array.isArray(resultados) || !resultados.length) return resultados;

  const pedidosParaBuscar = resultados
    .filter((r) => (
      _serieCampoVazio(r.cliente)
      || _serieCampoVazio(r.nota_fiscal)
      || _serieCampoVazio(r.data_entrega)
    ))
    .map((r) => r.pedido || r.numero_serie)
    .filter(Boolean);

  if (!pedidosParaBuscar.length) return resultados;

  let vendasMap;
  try {
    vendasMap = await buscarDadosVendaPorPedidos(pedidosParaBuscar);
  } catch (err) {
    console.warn('[SAC/AT] falha ao enriquecer busca de série com vendas:', err?.message || err);
    return resultados;
  }

  if (!vendasMap.size) return resultados;

  const cacheUpdates = [];
  for (const r of resultados) {
    const pedidoKey = String(r.pedido || r.numero_serie || '').trim();
    const dados = vendasMap.get(pedidoKey);
    if (!dados) continue;

    if (_serieCampoVazio(r.cliente) && dados.cliente) r.cliente = dados.cliente;
    if (_serieCampoVazio(r.nota_fiscal) && dados.nota_fiscal) r.nota_fiscal = dados.nota_fiscal;
    if (_serieCampoVazio(r.chave_nfe) && dados.chave_nfe) r.chave_nfe = dados.chave_nfe;
    if (_serieCampoVazio(r.data_entrega) && dados.data_entrega) r.data_entrega = dados.data_entrega;

    if (pedidoKey && (dados.cliente || dados.nota_fiscal || dados.data_entrega)) {
      cacheUpdates.push({ pedido: pedidoKey, ...dados });
    }
  }

  if (cacheUpdates.length) {
    persistirEnriquecimentoVendasNoCache(cacheUpdates).catch((err) => {
      console.warn('[SAC/AT] falha ao atualizar at_serie_cache com vendas:', err?.message || err);
    });
  }

  return resultados;
}

router.get('/at/busca-serie', async (req, res) => {
  const termo = String(req.query?.termo || '').trim();
  if (termo.length < 2) {
    return res.status(400).json({ ok: false, error: 'Informe ao menos 2 caracteres para a busca.' });
  }

  const termoNorm = normalizeText(termo);
  const maxResultados = 10;

  try {
    // ── Tenta busca no cache SQL primeiro (mais rápido e não afetado por filtros do Sheets)
    try {
      const { rows: [{ cnt }] } = await pool.query('SELECT COUNT(*) AS cnt FROM sac.at_serie_cache');
      if (Number(cnt) > 0) {
        const { rows: cacheRows } = await pool.query(`
          SELECT fonte, pedido, ordem_producao, modelo, cliente,
                 data_venda, nota_fiscal, chave_nfe, data_entrega, teste_tipo_gas
          FROM   sac.at_serie_cache
          WHERE  UPPER(TRIM(COALESCE(pedido, '')))          LIKE $1
              OR UPPER(TRIM(COALESCE(ordem_producao, '')))  LIKE $1
          ORDER BY
            CASE WHEN UPPER(TRIM(COALESCE(ordem_producao, ''))) LIKE $1 THEN 0 ELSE 1 END
          LIMIT $2
        `, [termoNorm + '%', maxResultados]);

        if (cacheRows.length > 0) {
          const resultados = cacheRows.map(r => ({            descricao: (r.ordem_producao || r.pedido || '').toUpperCase(),
            numero_serie: r.pedido,
            op: r.ordem_producao,
            modelo: r.modelo,
            revenda: r.cliente,
            data_venda: r.data_venda,
            cliente: r.cliente,
            nota_fiscal: r.nota_fiscal,
            chave_nfe: r.chave_nfe,
            data_entrega: r.data_entrega,
            teste_tipo_gas: r.teste_tipo_gas,
            pedido: r.pedido,
            ordem_producao: r.ordem_producao,
            fonte_cache: r.fonte,
          }));

          // Enriquece com flag ja_existe (mesmo código do bloco original)
          try {
            const pairs = resultados.filter(r => r.ordem_producao || r.modelo);
            if (pairs.length > 0) {
              const conditions = pairs.map((_, i) => `(s.ordem_producao = $${i*2+1} AND s.modelo = $${i*2+2})`).join(' OR ');
              const params = pairs.flatMap(p => [String(p.ordem_producao||'').trim()||null, String(p.modelo||'').trim()||null]);
              const dbResult = await pool.query(
                `SELECT DISTINCT ON (s.ordem_producao, s.modelo)
                   s.ordem_producao, s.modelo, s.id_at,
                   a.tipo, a.nome_revenda_cliente, a.numero_telefone, a.cpf_cnpj,
                   a.cep, a.bairro, a.cidade, a.estado, a.numero, a.rua,
                   a.agendar_atendimento_com, a.modelo AS at_modelo,
                   a.tag_problema, a.plataforma_atendimento
                 FROM sac.at_busca_selecionada s
                 JOIN sac.at a ON a.id = s.id_at
                 WHERE ${conditions}
                 ORDER BY s.ordem_producao, s.modelo, s.id_at DESC`,
                params
              );
              const existMap = new Map();
              for (const row of dbResult.rows) {
                existMap.set(`${row.ordem_producao||''}|${row.modelo||''}`, { id_at: row.id_at, at_data: row });
              }
              for (const r of resultados) {
                const key = `${r.ordem_producao||''}|${r.modelo||''}`;
                if (existMap.has(key)) { r.ja_existe = true; r.id_at = existMap.get(key).id_at; r.at_data = existMap.get(key).at_data; }
                else { r.ja_existe = false; }
              }
            }
          } catch (_) { /* enriquecimento opcional */ }

          await enriquecerResultadosSerieComVendas(resultados);
          return res.json({ ok: true, rows: resultados, source: 'cache' });
        }

        // Cache existe mas não encontrou o termo → sincroniza em background
        // para que a próxima busca já encontre no SQL
        if (!_atSyncEmAndamento) {
          console.log(`[SAC/AT] busca "${termoNorm}" não encontrada no cache — sync disparado em background`);
          _autoSyncAtSerieCache('busca-miss');
        }
      }
    } catch (cacheErr) {
      console.warn('[SAC/AT] cache SQL indisponível, usando planilhas:', cacheErr?.message);
    }
    // ── Fim busca SQL — continua com lógica original (planilhas) como fallback ──

    const resultados = [];
    const seen = new Set();
    const fontesComTimeout = [];

    const upsertResultado = (row) => {
      const dedupKey = `${row.numero_serie}|${row.op}|${row.modelo}`;
      const jaExiste = seen.has(dedupKey);

      if (jaExiste) {
        const existente = resultados.find((item) => `${item.numero_serie}|${item.op}|${item.modelo}` === dedupKey);
        if (!existente) return false;
        if (!existente.cliente && row.cliente) existente.cliente = row.cliente;
        if (!existente.nota_fiscal && row.nota_fiscal) existente.nota_fiscal = row.nota_fiscal;
        if (!existente.chave_nfe && row.chave_nfe) existente.chave_nfe = row.chave_nfe;
        if (!existente.data_entrega && row.data_entrega) existente.data_entrega = row.data_entrega;
        if (!existente.teste_tipo_gas && row.teste_tipo_gas) existente.teste_tipo_gas = row.teste_tipo_gas;
        return false;
      }

      if (resultados.length >= maxResultados) return false;
      seen.add(dedupKey);
      resultados.push(row);
      return true;
    };

    for (const sheetName of AT_SERIE_SHEETS) {
      const sheetNameNorm = normalizeText(sheetName);
      let rows = [];
      try {
        rows = await fetchAtSerieSheetRows(sheetName);
      } catch (sheetErr) {
        if (isAbortError(sheetErr)) {
          fontesComTimeout.push(sheetName);
          console.warn(`[SAC/AT] timeout ao consultar aba ${sheetName}; seguindo com próximas fontes.`);
          continue;
        }
        console.warn(`[SAC/AT] falha na aba ${sheetName}; seguindo com próximas fontes:`, sheetErr?.message || sheetErr);
        continue;
      }

      for (const rowObj of rows) {
        const pedido = getValueByHeaderMatch(rowObj, (key) => key.includes('PEDIDO'));
        const ordemProducao = getValueByHeaderMatch(rowObj, (key) => key.includes('ORDEM') && key.includes('PRODUCAO'));
        const modelo = getValueByHeaderMatch(rowObj, (key) => key.includes('MODELO'));
        const revenda = getValueByHeaderMatch(rowObj, (key) => key.includes('REVENDA') || key.includes('CLIENTE'));
        const dataVenda = getValueByHeaderMatch(rowObj, (key) => key.includes('DATA') && key.includes('VENDA'));
        let testeTipoGas = '';

        if (sheetNameNorm.includes('PRODUCAO 2')) {
          testeTipoGas = getValueByHeaderMatch(
            rowObj,
            (key) => key.includes('1REF') && key.includes('FLUIDO') && key.includes('REFRIGERANTE')
          );
        } else if (sheetNameNorm.includes('PRODUCAO 1')) {
          testeTipoGas = getValueByHeaderMatch(
            rowObj,
            (key) => key.includes('REF') && key.includes('FLUIDO') && key.includes('REFRIGERANTE')
          );
        }

        const pedidoNorm = normalizeText(pedido);
        const ordemNorm = normalizeText(ordemProducao);
        if (!pedidoNorm && !ordemNorm) continue;

        let descricao = '';
        if (pedidoNorm.startsWith(termoNorm)) {
          descricao = String(pedido || '').toUpperCase();
        } else if (ordemNorm.startsWith(termoNorm)) {
          descricao = String(ordemProducao || '').toUpperCase();
        } else {
          continue;
        }

        const row = {
          descricao,
          numero_serie: pedido,
          op: ordemProducao,
          modelo,
          revenda,
          data_venda: dataVenda,
          cliente: '',
          nota_fiscal: '',
          chave_nfe: '',
          data_entrega: dataVenda,
          teste_tipo_gas: testeTipoGas,
          pedido,
          ordem_producao: ordemProducao,
        };

        upsertResultado(row);
        if (resultados.length >= maxResultados) break;
      }

      if (resultados.length >= maxResultados) break;
    }

    if (resultados.length < maxResultados) {
      try {
        const legacyRows = await fetchLegacySerieRows();
        for (let i = 1; i < legacyRows.length; i++) {
          const row = Array.isArray(legacyRows[i]) ? legacyRows[i] : [];
          const serie = String(row[0] || '').trim();
          const op = String(row[8] || '').trim();
          const modelo = String(row[12] || '').trim();
          const revenda = String(row[2] || '').trim();
          const dataVenda = String(row[22] || '').trim();

          const serieNorm = normalizeText(serie);
          const opNorm = normalizeText(op);
          if (!serieNorm && !opNorm) continue;

          let descricao = '';
          if (serieNorm.startsWith(termoNorm)) {
            descricao = String(serie || '').toUpperCase();
          } else if (opNorm.startsWith(termoNorm)) {
            descricao = String(op || '').toUpperCase();
          } else {
            continue;
          }

          const out = {
            descricao,
            numero_serie: serie,
            op,
            modelo,
            revenda,
            data_venda: dataVenda,
            cliente: '',
            nota_fiscal: '',
            chave_nfe: '',
            data_entrega: dataVenda,
            teste_tipo_gas: '',
            pedido: serie,
            ordem_producao: op,
          };

          upsertResultado(out);
          if (resultados.length >= maxResultados) break;
        }
      } catch (legacyErr) {
        if (isAbortError(legacyErr)) {
          fontesComTimeout.push('IMPORTRANGE (legacy)');
          console.warn('[SAC/AT] timeout na planilha legacy; retornando resultados parciais.');
        } else {
          console.warn('[SAC/AT] planilha legacy indisponível para busca de série:', legacyErr?.message || legacyErr);
        }
      }
    }

      if (resultados.length < maxResultados) {
        try {
          const pedidosRows = await fetchPedidosSerieRows();
          for (const rowObj of pedidosRows) {
            const pedido = getValueByHeaderMatch(rowObj, (key) => key.includes('PEDIDO'));
            const ordemProducao = getValueByHeaderMatch(rowObj, (key) => key.includes('ORDEM') && key.includes('PRODUCAO'));
            const modelo = getValueByHeaderMatch(rowObj, (key) => key.includes('MODELO'));
            const revenda = getValueByHeaderMatch(rowObj, (key) => key.includes('REVENDA') || key.includes('CLIENTE'));
            const dataVenda = getValueByHeaderMatch(rowObj, (key) => key.includes('DATA') && key.includes('VENDA'));
            const cliente = getValueByHeaderMatch(rowObj, (key) => key.includes('CLIENTE'));
            const notaFiscal = getValueByHeaderMatch(rowObj, (key) => key.includes('NOTA') && key.includes('FISCAL'));
            const chaveNfe = getValueByHeaderMatch(rowObj, (key) => key.includes('CHAVE') && key.includes('NFE'));
            const dataEntrega = getValueByHeaderMatch(rowObj, (key) => key.includes('DATA') && key.includes('ENTREGA'));

            const pedidoNorm = normalizeText(pedido);
            const ordemNorm = normalizeText(ordemProducao);
            if (!pedidoNorm && !ordemNorm) continue;

            let descricao = '';
            if (pedidoNorm.startsWith(termoNorm)) {
              descricao = String(pedido || '').toUpperCase();
            } else if (ordemNorm.startsWith(termoNorm)) {
              descricao = String(ordemProducao || '').toUpperCase();
            } else {
              continue;
            }

            const out = {
              descricao,
              numero_serie: pedido,
              op: ordemProducao,
              modelo,
              revenda,
              data_venda: dataVenda,
              cliente,
              nota_fiscal: notaFiscal,
              chave_nfe: chaveNfe,
              data_entrega: dataEntrega,
              teste_tipo_gas: '',
              pedido,
              ordem_producao: ordemProducao,
            };

            upsertResultado(out);
            if (resultados.length >= maxResultados) break;
          }
        } catch (pedidosErr) {
          if (isAbortError(pedidosErr)) {
            fontesComTimeout.push('PEDIDOS (gid 1642140396)');
            console.warn('[SAC/AT] timeout na planilha PEDIDOS; retornando resultados parciais.');
          } else {
            console.warn('[SAC/AT] planilha PEDIDOS indisponível para busca de série:', pedidosErr?.message || pedidosErr);
          }
        }
      }

      try {
        const testeGasRows = await fetchTesteGasRows();
        for (const rowObj of testeGasRows) {
          const pedido = getValueByHeaderMatch(rowObj, (key) => key.includes('PEDIDO'));
          const ordemProducao = getValueByHeaderMatch(rowObj, (key) => key.includes('ORDEM') && key.includes('PRODUCAO'));
          const modelo = getValueByHeaderMatch(rowObj, (key) => key.includes('MODELO'));
          const cliente = getValueByHeaderMatch(rowObj, (key) => key.includes('CLIENTE') || key.includes('REVENDA'));
          const testeTipoGas = getValueByHeaderMatch(rowObj, (key) => key.includes('TESTE') && key.includes('TIPO') && key.includes('GAS'));

          const pedidoNorm = normalizeText(pedido);
          const ordemNorm = normalizeText(ordemProducao);
          if (!pedidoNorm && !ordemNorm) continue;

          let descricao = '';
          if (pedidoNorm.startsWith(termoNorm)) {
            descricao = String(pedido || '').toUpperCase();
          } else if (ordemNorm.startsWith(termoNorm)) {
            descricao = String(ordemProducao || '').toUpperCase();
          } else {
            continue;
          }

          const out = {
            descricao,
            numero_serie: pedido,
            op: ordemProducao,
            modelo,
            revenda: cliente,
            data_venda: '',
            cliente,
            nota_fiscal: '',
            chave_nfe: '',
            data_entrega: '',
            teste_tipo_gas: testeTipoGas,
            pedido,
            ordem_producao: ordemProducao,
          };

          upsertResultado(out);
          if (resultados.length >= maxResultados) break;
        }
      } catch (testeGasErr) {
        if (isAbortError(testeGasErr)) {
          fontesComTimeout.push('TESTE/GAS (gid 1333359070)');
          console.warn('[SAC/AT] timeout na planilha TESTE/GAS; retornando resultados parciais.');
        } else {
          console.warn('[SAC/AT] planilha TESTE/GAS indisponível para busca de série:', testeGasErr?.message || testeGasErr);
        }
      }

    // Enriquece resultados com flag ja_existe (registro em sac.at_busca_selecionada)
    if (resultados.length > 0) {
      try {
        const pairs = resultados.filter(r => r.ordem_producao || r.modelo);
        if (pairs.length > 0) {
          const conditions = pairs.map((_, i) => `(s.ordem_producao = $${i * 2 + 1} AND s.modelo = $${i * 2 + 2})`).join(' OR ');
          const params = pairs.flatMap(p => [String(p.ordem_producao || '').trim() || null, String(p.modelo || '').trim() || null]);
          const dbResult = await pool.query(
            `SELECT DISTINCT ON (s.ordem_producao, s.modelo)
               s.ordem_producao, s.modelo, s.id_at,
               a.tipo, a.nome_revenda_cliente, a.numero_telefone, a.cpf_cnpj,
               a.cep, a.bairro, a.cidade, a.estado, a.numero, a.rua,
               a.agendar_atendimento_com,
               a.modelo AS at_modelo,
               a.tag_problema, a.plataforma_atendimento
             FROM sac.at_busca_selecionada s
             JOIN sac.at a ON a.id = s.id_at
             WHERE ${conditions}
             ORDER BY s.ordem_producao, s.modelo, s.id_at DESC`,
            params
          );
          const existMap = new Map();
          for (const row of dbResult.rows) {
            const key = `${row.ordem_producao || ''}|${row.modelo || ''}`;
            existMap.set(key, { id_at: row.id_at, at_data: row });
          }
          for (const r of resultados) {
            const key = `${r.ordem_producao || ''}|${r.modelo || ''}`;
            if (existMap.has(key)) {
              r.ja_existe = true;
              r.id_at = existMap.get(key).id_at;
              r.at_data = existMap.get(key).at_data;
            } else {
              r.ja_existe = false;
            }
          }
        }
      } catch (enrichErr) {
        console.warn('[SAC/AT] falha ao enriquecer resultados com at_busca_selecionada:', enrichErr?.message || enrichErr);
      }
    }

    await enriquecerResultadosSerieComVendas(resultados);

    const payload = { ok: true, rows: resultados };
    if (fontesComTimeout.length) {
      payload.partial = true;
      payload.warning = `Algumas fontes excederam o tempo: ${fontesComTimeout.join(', ')}`;
    }

    return res.json(payload);
  } catch (err) {
    if (isAbortError(err)) {
      return res.status(200).json({ ok: true, rows: [], partial: true, warning: 'Busca parcial por timeout externo.' });
    }
    console.error('[SAC/AT] erro na busca por numero de serie:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao consultar planilha para busca de serie.' });
  }
});

router.get('/at/historico-reclamacao', async (req, res) => {
  const op = String(req.query?.ordem_producao || '').trim();
  const modelo = String(req.query?.modelo || '').trim();

  if (!op && !modelo) {
    return res.json({ ok: true, rows: [] });
  }

  try {
    const result = await pool.query(
      `SELECT a.id, a.data, a.tipo, a.descreva_reclamacao
       FROM sac.at a
       JOIN sac.at_busca_selecionada s ON s.id_at = a.id
       WHERE ($1::text IS NULL OR s.ordem_producao = $1)
         AND ($2::text IS NULL OR s.modelo = $2)
         AND a.descreva_reclamacao IS NOT NULL
         AND trim(a.descreva_reclamacao) != ''
       ORDER BY a.id ASC`,
      [op || null, modelo || null]
    );
    return res.json({ ok: true, rows: result.rows });
  } catch (err) {
    console.error('[SAC/AT] erro ao buscar historico de reclamacao:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao buscar histrico de reclamao.' });
  }
});

// Retorna valores distintos de uma coluna para alimentar combobox no front
router.get('/at/opcoes-campo', async (req, res) => {
  const CAMPOS_PERMITIDOS = ['tag_problema', 'plataforma_atendimento'];
  const campo = String(req.query?.campo || '').trim();
  if (!CAMPOS_PERMITIDOS.includes(campo)) {
    return res.status(400).json({ ok: false, error: 'Campo inválido.' });
  }
  try {
    let result;
    if (campo === 'tag_problema') {
      // Retorna somente as tags cadastradas no catálogo sac.tag
      result = await pool.query(`
        SELECT nome AS valor FROM sac.tag
        ORDER BY nome
      `);
    } else {
      result = await pool.query(
        `SELECT DISTINCT "${campo}" AS valor
           FROM sac.at
          WHERE "${campo}" IS NOT NULL AND "${campo}" <> ''
          ORDER BY "${campo}"`
      );
    }
    return res.json({ ok: true, opcoes: result.rows.map(r => r.valor) });
  } catch (err) {
    console.error(`[SAC/AT] erro ao buscar opcoes de ${campo}:`, err);
    return res.status(500).json({ ok: false, error: 'Falha ao buscar opções.' });
  }
});

// POST /at/tags — registra uma nova tag no catálogo sac.tag
router.post('/at/tags', async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  if (!nome) return res.status(400).json({ ok: false, error: 'Nome obrigatório.' });
  try {
    await pool.query(
      `INSERT INTO sac.tag (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING`,
      [nome]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/AT] erro ao salvar tag:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/at/cep/:cep', async (req, res) => {
  const cep = String(req.params?.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) {
    return res.status(400).json({ ok: false, error: 'CEP inválido. Informe 8 dígitos.' });
  }

  try {
    // BrasilAPI v2 — retorna endereço + coordenadas GPS
    const resp = await fetchWithTimeout(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { Accept: 'application/json' }
    }, 10000);

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data || !data.city) {
      // Fallback: ViaCEP (sem coordenadas)
      const r2 = await fetchWithTimeout(`https://viacep.com.br/ws/${cep}/json/`, {
        headers: { Accept: 'application/json' }
      }, 8000);
      const d2 = await r2.json().catch(() => ({}));
      if (!r2.ok || d2?.erro) {
        return res.status(404).json({ ok: false, error: 'CEP não encontrado.' });
      }
      return res.json({
        ok: true,
        cep:       String(d2.cep  || '').replace(/\D/g,''),
        municipio: String(d2.localidade || '').trim(),
        uf:        String(d2.uf   || '').trim(),
        bairro:    String(d2.bairro     || '').trim(),
        rua:       String(d2.logradouro || '').trim(),
        lat: null,
        lng: null,
      });
    }

    const coords = data.location && data.location.coordinates;
    return res.json({
      ok: true,
      cep:       cep,
      municipio: String(data.city         || '').trim(),
      uf:        String(data.state        || '').trim(),
      bairro:    String(data.neighborhood || '').trim(),
      rua:       String(data.street       || '').trim(),
      lat: coords && coords.latitude  ? parseFloat(coords.latitude)  : null,
      lng: coords && coords.longitude ? parseFloat(coords.longitude) : null,
    });
  } catch (err) {
    console.error('[SAC/AT] erro ao consultar CEP:', err);
    return res.status(502).json({ ok: false, error: 'Falha ao consultar CEP.' });
  }
});

// ─── AT ANEXOS ───────────────────────────────────────────────────────────────
const AT_BUCKET = BUCKET; // usa o mesmo bucket já existente; arquivos ficam na pasta "at/"
const atUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

function atSanitizeFileName(rawName, ext) {
  const base = String(rawName || '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const safe = base || `arquivo.${ext}`;
  return safe.includes('.') ? safe : `${safe}.${ext}`;
}

function _brMoneyToNumber(s) {
  const t = String(s || '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function _brDateToIso(s) {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function _cleanPdfText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** Extrai campos de fechamento do PDF padrão PJ Refrigeração (OS). */
function parseFechamentoPjPdf(rawText) {
  const norm = String(rawText || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');

  let valorMo = null;
  const moBlock = norm.match(/TOTAL\s+OR[CÇ]AMENTO\s*:?\s*([\s\S]{0,100}?)(?:VALIDADE|FORMA\s+DE\s+PAGAMENTO|OBSERVA)/i);
  if (moBlock) {
    const nums = [...moBlock[1].matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g)].map((m) => m[1]);
    if (nums.length) valorMo = _brMoneyToNumber(nums[nums.length - 1]);
  }
  if (valorMo == null) {
    const m = norm.match(/TOTAL\s+OR[CÇ]AMENTO\s*:?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i);
    if (m) valorMo = _brMoneyToNumber(m[1]);
  }

  // Preferir "DATA DE CONCLUSÃO"; fallback no "Data:" do cabeçalho da OS
  let dataConclusao = null;
  const mDc = norm.match(/DATA\s+DE\s+CONCLUS[AÃ]O\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (mDc) dataConclusao = _brDateToIso(mDc[1]);
  else {
    const mD = norm.match(/Data\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (mD) dataConclusao = _brDateToIso(mD[1]);
  }

  const extractAfter = (label, stops) => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stopRe = stops.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const re = new RegExp(`${esc}\\s*([\\s\\S]*?)(?=(?:${stopRe})|$)`, 'i');
    const m = norm.match(re);
    return m ? _cleanPdfText(m[1]) : '';
  };

  // pdf-parse às vezes joga o texto antes do rótulo — tratar os dois casos
  let observacoes = extractAfter('MOTIVO DA SOLICITAÇÃO', [
    'DESCRIÇÃO', 'RESOLUÇÃO', 'Quantidade', 'PEÇAS', 'ORÇAMENTO', 'HISTÓRICO', 'LOCALIZAÇÃO',
  ]);
  if (!observacoes || observacoes.length < 5 || /Quantidade|PEÇAS|ORÇAMENTO|V\.\s*Unit/i.test(observacoes)) {
    const m = norm.match(/([^\n]{8,400})\s*\n\s*MOTIVO\s+DA\s+SOLICITA[CÇ][AÃ]O/i);
    if (m) observacoes = _cleanPdfText(m[1]);
  }

  let servico = extractAfter('RESOLUÇÃO DO PROBLEMA', [
    'DESCRIÇÃO', 'HISTÓRICO', 'LOCALIZAÇÃO', 'ASSINATURA', 'PROTOCOLO',
  ]);
  if (!servico || servico.length < 15) {
    const m = norm.match(/HIST[OÓ]RICO\s+ATENDIMENTO\s*([\s\S]*?)RESOLU[CÇ][AÃ]O\s+DO\s+PROBLEMA/i);
    if (m) servico = _cleanPdfText(m[1]);
  }

  let obsTecnico = extractAfter('DESCRIÇÃO DO PROBLEMA', [
    'LOCALIZAÇÃO', 'RESOLUÇÃO', 'ASSINATURA', 'PROTOCOLO', 'HISTÓRICO', 'MOTIVO',
  ]);
  if (!obsTecnico || obsTecnico.length < 8) {
    const m = norm.match(/([^\n]{8,500})\s*\n\s*DESCRI[CÇ][AÃ]O\s+DO\s+PROBLEMA/i);
    if (m) obsTecnico = _cleanPdfText(m[1]);
  }

  return {
    valor_total_mao_obra: valorMo,
    data_conclusao_servico: dataConclusao,
    descricao_servico_realizado: servico || null,
    observacoes: observacoes || null,
    observacao_tecnico: obsTecnico || null,
  };
}

// GET /at/anexos/:id_at
router.get('/at/anexos/:id_at', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!Number.isFinite(idAt) || idAt <= 0) return res.status(400).json({ error: 'id_at inválido.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, nome_arquivo, url_publica, content_type, tamanho_bytes, enviado_por, criado_em
         FROM sac.at_anexos WHERE id_at = $1 ORDER BY criado_em ASC`,
      [idAt]
    );
    res.json({ ok: true, anexos: rows });
  } catch (err) {
    console.error('[SAC/AT] erro ao listar anexos:', err);
    res.status(500).json({ error: 'Falha ao listar anexos.' });
  }
});

/**
 * Lista peças da máquina via historico IAPP (data_final mais próxima) + ficha técnica.
 * Query: modelo?, ordem_producao?, data_ref? (YYYY-MM-DD), id_at?
 */
router.get('/at/lista-pecas-iapp', async (req, res) => {
  const https = require('https');
  const modelo = String(req.query.modelo || '').trim();
  const ordemProducao = String(req.query.ordem_producao || '').trim();
  let dataRef = String(req.query.data_ref || '').trim().slice(0, 10);
  const idAt = parseInt(req.query.id_at, 10);

  const iappGetLocal = (path, params = {}) => new Promise((resolve, reject) => {
    const token = process.env.IAPP_TOKEN;
    const secret = process.env.IAPP_SECRET;
    if (!token || !secret) return reject(new Error('IAPP_TOKEN e IAPP_SECRET não configurados.'));
    const qs = new URLSearchParams(params).toString();
    const url = new URL(`https://api.iniciativaaplicativos.com.br/api${path}${qs ? '?' + qs : ''}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { token, secret, 'Content-Type': 'application/json' },
    };
    const r = https.request(options, (resp) => {
      let body = '';
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => {
        try { resolve(JSON.parse(body || '{}')); }
        catch (e) { reject(new Error(`Resposta inválida IAPP: ${body.slice(0, 160)}`)); }
      });
    });
    r.on('error', reject);
    r.setTimeout(25000, () => { r.destroy(new Error('Timeout IAPP')); });
    r.end();
  });

  const normalizarOp = (v) => String(v || '').trim().replace(/^0+/, '') || '';

  try {
    // Se faltarem dados, tenta puxar da AT
    let modeloFinal = modelo;
    let opFinal = ordemProducao;
    if ((!modeloFinal || !dataRef || !opFinal) && Number.isFinite(idAt) && idAt > 0) {
      const { rows: atRows } = await pool.query(
        `SELECT a.modelo, a.data,
                b.modelo AS busca_modelo, b.ordem_producao, b.data_entrega
           FROM sac.at a
           LEFT JOIN sac.at_busca_selecionada b ON b.id_at = a.id
          WHERE a.id = $1
          LIMIT 1`,
        [idAt]
      );
      const at = atRows[0] || {};
      if (!modeloFinal) modeloFinal = String(at.busca_modelo || at.modelo || '').trim();
      if (!opFinal) opFinal = String(at.ordem_producao || '').trim();
      if (!dataRef) {
        const rawDt = at.data_entrega || at.data;
        if (rawDt) {
          const d = rawDt instanceof Date ? rawDt : new Date(rawDt);
          if (!Number.isNaN(d.getTime())) dataRef = d.toISOString().slice(0, 10);
        }
      }
    }

    if (!modeloFinal && !opFinal) {
      return res.status(400).json({ ok: false, error: 'Informe modelo ou ordem de produção.' });
    }
    if (!dataRef) dataRef = new Date().toISOString().slice(0, 10);

    let historico = null;

    // 1) Preferência: casar OP
    if (opFinal) {
      const opNorm = normalizarOp(opFinal);
      const { rows } = await pool.query(
        `SELECT h.identificacao, h.produto_identificacao, h.produto_descricao,
                h.data_final, h.data_abertura, h.status,
                NULLIF(BTRIM(h.raw->>'ficha_tecnica'), '') AS ficha_tecnica
           FROM iapp.historico_op_iapp h
          WHERE UPPER(BTRIM(h.identificacao)) = UPPER(BTRIM($1))
             OR regexp_replace(BTRIM(h.identificacao), '^0+', '') = $2
          ORDER BY h.data_final DESC NULLS LAST
          LIMIT 1`,
        [opFinal, opNorm]
      );
      historico = rows[0] || null;
    }

    // 2) Modelo + data_final mais próxima da data de produção/entrega
    if (!historico && modeloFinal) {
      const { rows } = await pool.query(
        `SELECT h.identificacao, h.produto_identificacao, h.produto_descricao,
                h.data_final, h.data_abertura, h.status,
                NULLIF(BTRIM(h.raw->>'ficha_tecnica'), '') AS ficha_tecnica,
                ABS(h.data_final::date - $2::date) AS dias_diff
           FROM iapp.historico_op_iapp h
          WHERE UPPER(BTRIM(h.produto_identificacao)) = UPPER(BTRIM($1))
            AND h.data_final IS NOT NULL
          ORDER BY ABS(h.data_final::date - $2::date) ASC, h.data_final DESC
          LIMIT 1`,
        [modeloFinal, dataRef]
      );
      historico = rows[0] || null;
    }

    let fichaId = Number(historico?.ficha_tecnica) || 0;
    let fichaLocal = null;

    if (!fichaId && modeloFinal) {
      const { rows: fRows } = await pool.query(
        `SELECT id, identificacao, descricao, produto, status
           FROM engenharia.iapp_fichas
          WHERE UPPER(BTRIM(COALESCE(produto, ''))) = UPPER(BTRIM($1))
             OR UPPER(BTRIM(COALESCE(descricao, ''))) = UPPER(BTRIM($1))
          ORDER BY data_ultima_atualizacao DESC NULLS LAST
          LIMIT 1`,
        [modeloFinal]
      );
      fichaLocal = fRows[0] || null;
      fichaId = Number(fichaLocal?.id) || 0;
    } else if (fichaId) {
      const { rows: fRows } = await pool.query(
        `SELECT id, identificacao, descricao, produto, status
           FROM engenharia.iapp_fichas WHERE id = $1 LIMIT 1`,
        [fichaId]
      );
      fichaLocal = fRows[0] || null;
    }

    const mapItem = (row) => ({
      codigo: row.codigo || row.identificacao || '—',
      descricao: row.descricao || row.codigo || '—',
      qtde: row.qtde ?? 0,
      tipo: row.tipo || row.status || 'Material',
      etapa: row.etapa || '',
    });

    let itens = [];
    let fonte = 'nenhuma';

    // Materiais locais (cache engenharia)
    if (fichaId > 0) {
      try {
        const { rows: matRows } = await pool.query(
          `SELECT
              COALESCE(
                NULLIF(BTRIM(m.raw_payload #>> '{produto,identificacao}'), ''),
                NULLIF(BTRIM(m.raw_payload ->> 'identificacao'), ''),
                NULLIF(BTRIM(po.codigo), ''),
                m.produto_id::text
              ) AS codigo,
              COALESCE(
                NULLIF(BTRIM(m.raw_payload #>> '{produto,descricao}'), ''),
                NULLIF(BTRIM(m.raw_payload ->> 'descricao'), ''),
                NULLIF(BTRIM(po.descricao), ''),
                m.produto_id::text
              ) AS descricao,
              m.qtde,
              'Material' AS tipo
             FROM engenharia.iapp_fichas_operacao_materiais m
             LEFT JOIN LATERAL (
               SELECT p.codigo, p.descricao
                 FROM public.produtos_omie p
                WHERE p.codigo_produto::text = m.produto_id::text
                   OR UPPER(BTRIM(p.codigo)) = UPPER(BTRIM(COALESCE(
                        m.raw_payload #>> '{produto,identificacao}',
                        m.raw_payload ->> 'identificacao', ''
                      )))
                LIMIT 1
             ) po ON TRUE
            WHERE m.ficha_id = $1
            ORDER BY m.operacao_item_index, m.item_index`,
          [fichaId]
        );
        if (matRows.length) {
          itens = matRows.map(mapItem);
          fonte = 'engenharia.iapp_fichas';
        }
      } catch (e) {
        console.warn('[SAC/AT] lista-pecas locais:', e.message);
      }
    }

    // IAPP ao vivo (ficha histórica ou atual pelo código)
    if (!itens.length) {
      try {
        let fichaIapp = null;
        if (fichaId > 0) {
          const data = await iappGetLocal(`/engenharia/fichas/busca/${fichaId}`);
          if (data?.success !== false) fichaIapp = data.response || null;
        }
        if (!fichaIapp && modeloFinal) {
          // reusa endpoint de produção já consolidado
          const base = `http://127.0.0.1:${process.env.PORT || 3001}`;
          const qs = new URLSearchParams({
            codigo: modeloFinal,
            ...(fichaId ? { ficha_id: String(fichaId) } : {}),
          });
          const cookie = req.headers.cookie || '';
          const pr = await fetch(`${base}/api/producao/estrutura-ficha?${qs}`, {
            headers: cookie ? { Cookie: cookie } : {},
          });
          const pdata = await pr.json().catch(() => ({}));
          if (pr.ok && Array.isArray(pdata.response) && pdata.response.length) {
            itens = pdata.response.map((it) => mapItem({
              codigo: it.identificacao,
              descricao: it.descricao,
              qtde: it.qtde,
              tipo: it.status,
              etapa: it.etapa,
            }));
            fonte = pdata.fonte || 'iapp';
            if (!fichaLocal && pdata.ficha) fichaLocal = pdata.ficha;
          }
        } else if (fichaIapp) {
          const flat = [];
          for (const op of (fichaIapp.operacoes || [])) {
            for (const item of (op.materiais || [])) {
              flat.push({
                codigo: String(item?.produto ?? ''),
                descricao: String(item?.produto ?? ''),
                qtde: item?.qtde ?? 0,
                tipo: 'Material',
                etapa: op?.operacao ?? '',
              });
            }
            for (const item of (op.subprodutos || [])) {
              flat.push({
                codigo: String(item?.produto ?? ''),
                descricao: String(item?.produto ?? ''),
                qtde: item?.qtde ?? 0,
                tipo: 'Subproduto',
                etapa: op?.operacao ?? '',
              });
            }
          }
          // Resolve códigos Omie quando possível
          const refs = [...new Set(flat.map((x) => x.codigo).filter((c) => c && /^\d+$/.test(c)))];
          const nomePorRef = {};
          for (const ref of refs.slice(0, 40)) {
            try {
              const pd = await iappGetLocal(`/engenharia/produtos/busca/${ref}`);
              if (pd?.response) {
                nomePorRef[ref] = {
                  codigo: pd.response.identificacao || ref,
                  descricao: pd.response.descricao || pd.response.identificacao || ref,
                };
              }
            } catch (_) { /* ignora */ }
          }
          itens = flat.map((it) => {
            const hit = nomePorRef[it.codigo];
            return mapItem({
              codigo: hit?.codigo || it.codigo,
              descricao: hit?.descricao || it.descricao,
              qtde: it.qtde,
              tipo: it.tipo,
              etapa: it.etapa,
            });
          });
          fonte = 'iapp';
          if (!fichaLocal) {
            fichaLocal = {
              id: fichaIapp.id,
              identificacao: fichaIapp.identificacao,
              descricao: fichaIapp.descricao,
              produto: fichaIapp.produto,
              status: fichaIapp.status,
            };
          }
        }
      } catch (e) {
        console.warn('[SAC/AT] lista-pecas IAPP:', e.message);
      }
    }

    const fmtData = (v) => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
      return d.toISOString().slice(0, 10);
    };

    return res.json({
      ok: true,
      modelo: modeloFinal || historico?.produto_identificacao || null,
      data_ref: dataRef,
      historico: historico ? {
        ordem_producao: historico.identificacao,
        modelo: historico.produto_identificacao,
        descricao: historico.produto_descricao,
        data_final: fmtData(historico.data_final),
        status: historico.status,
        ficha_tecnica: fichaId || null,
        dias_diff: historico.dias_diff != null ? Number(historico.dias_diff) : null,
      } : null,
      ficha: fichaLocal || (fichaId ? { id: fichaId } : null),
      fonte,
      total: itens.length,
      pecas: itens,
    });
  } catch (err) {
    console.error('[SAC/AT] lista-pecas-iapp:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao listar peças IAPP.' });
  }
});

// POST /at/anexos/:id_at  (multipart: campo "arquivo", múltiplos)
router.post('/at/anexos/:id_at', atUpload.array('arquivo', 20), async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!Number.isFinite(idAt) || idAt <= 0) return res.status(400).json({ error: 'id_at inválido.' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const usuario = req.session?.user?.fullName || req.session?.user?.username || 'sistema';
  const inseridos = [];

  try {
    for (const file of req.files) {
      const mimeExt = mime.extension(file.mimetype);
      const originalExt = (file.originalname || '').split('.').pop();
      const ext = (mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
      const safeName = atSanitizeFileName(file.originalname, ext);
      const pathKey = `at/${idAt}/${uuidv4()}_${safeName}`;

      const { error: upErr } = await supabase.storage.from(AT_BUCKET).upload(pathKey, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: false
      });
      if (upErr) throw new Error(`Supabase upload: ${upErr.message}`);

      const { data: pubData } = supabase.storage.from(AT_BUCKET).getPublicUrl(pathKey);
      const urlPublica = pubData?.publicUrl || '';

      const ins = await pool.query(
        `INSERT INTO sac.at_anexos (id_at, nome_arquivo, path_key, url_publica, content_type, tamanho_bytes, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nome_arquivo, url_publica, content_type, tamanho_bytes, criado_em`,
        [idAt, safeName, pathKey, urlPublica, file.mimetype || null, file.size || null, usuario]
      );
      inseridos.push(ins.rows[0]);
    }
    res.json({ ok: true, anexos: inseridos });
  } catch (err) {
    console.error('[SAC/AT] erro ao fazer upload de anexo:', err);
    res.status(500).json({ error: 'Falha no upload.', detail: String(err.message || err) });
  }
});

// POST /at/fechamento-pj/:id_at — anexa PDF OS PJ e preenche campos de fechamento
router.post('/at/fechamento-pj/:id_at', atUpload.single('arquivo'), async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!Number.isFinite(idAt) || idAt <= 0) {
    return res.status(400).json({ ok: false, error: 'id_at inválido.' });
  }
  const file = req.file;
  if (!file || !file.buffer) {
    return res.status(400).json({ ok: false, error: 'Selecione o PDF da OS PJ.' });
  }
  const mimeOk = String(file.mimetype || '').toLowerCase().includes('pdf')
    || /\.pdf$/i.test(String(file.originalname || ''));
  if (!mimeOk) {
    return res.status(400).json({ ok: false, error: 'O arquivo precisa ser um PDF.' });
  }

  const usuario = req.session?.user?.fullName || req.session?.user?.username || 'sistema';

  try {
    let parsedText = '';
    try {
      const parsed = await pdfParse(file.buffer);
      parsedText = String(parsed?.text || '');
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'Não foi possível ler o PDF.' });
    }

    const campos = parseFechamentoPjPdf(parsedText);
    if (
      campos.valor_total_mao_obra == null
      && !campos.data_conclusao_servico
      && !campos.descricao_servico_realizado
      && !campos.observacoes
      && !campos.observacao_tecnico
    ) {
      return res.status(400).json({
        ok: false,
        error: 'PDF não parece ser uma OS PJ válida (não achei TOTAL ORÇAMENTO / campos de fechamento).',
      });
    }

    const ext = 'pdf';
    const safeName = atSanitizeFileName(file.originalname || `fechamento_pj_${idAt}.pdf`, ext);
    const pathKey = `at/${idAt}/${uuidv4()}_${safeName}`;

    const { error: upErr } = await supabase.storage.from(AT_BUCKET).upload(pathKey, file.buffer, {
      contentType: file.mimetype || 'application/pdf',
      upsert: false,
    });
    if (upErr) throw new Error(`Supabase upload: ${upErr.message}`);

    const { data: pubData } = supabase.storage.from(AT_BUCKET).getPublicUrl(pathKey);
    const urlPublica = pubData?.publicUrl || '';

    const insAnexo = await pool.query(
      `INSERT INTO sac.at_anexos (id_at, nome_arquivo, path_key, url_publica, content_type, tamanho_bytes, enviado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, nome_arquivo, url_publica, content_type, tamanho_bytes, criado_em`,
      [idAt, safeName, pathKey, urlPublica, file.mimetype || 'application/pdf', file.size || null, usuario]
    );

    const cols = [];
    const vals = [];
    const put = (col, val) => {
      if (val === null || val === undefined || val === '') return;
      cols.push(col);
      vals.push(val);
    };
    put('valor_total_mao_obra', campos.valor_total_mao_obra);
    put('data_conclusao_servico', campos.data_conclusao_servico);
    put('descricao_servico_realizado', campos.descricao_servico_realizado);
    put('observacoes', campos.observacoes);
    put('observacao_tecnico', campos.observacao_tecnico);

    if (cols.length) {
      const existing = await pool.query('SELECT id FROM sac.fechamento WHERE id_at = $1', [idAt]);
      if (existing.rows.length) {
        const setList = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
        await pool.query(
          `UPDATE sac.fechamento SET ${setList} WHERE id_at = $1`,
          [idAt, ...vals]
        );
      } else {
        await pool.query(
          `INSERT INTO sac.fechamento (id_at, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
          [idAt, ...vals]
        );
      }
    }

    return res.json({
      ok: true,
      anexo: insAnexo.rows[0],
      fechamento: {
        valor_total_mao_obra: campos.valor_total_mao_obra,
        data_conclusao_servico: campos.data_conclusao_servico,
        descricao_servico_realizado: campos.descricao_servico_realizado,
        observacoes: campos.observacoes,
        observacao_tecnico: campos.observacao_tecnico,
      },
    });
  } catch (err) {
    console.error('[SAC/AT] erro fechamento-pj:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao processar PDF PJ.' });
  }
});

// DELETE /at/anexos/:id_at/:id_anexo
router.delete('/at/anexos/:id_at/:id_anexo', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  const idAnexo = parseInt(req.params.id_anexo, 10);
  if (!Number.isFinite(idAt) || idAt <= 0 || !Number.isFinite(idAnexo) || idAnexo <= 0)
    return res.status(400).json({ error: 'Parâmetros inválidos.' });
  try {
    const { rows } = await pool.query(
      `DELETE FROM sac.at_anexos WHERE id = $1 AND id_at = $2 RETURNING path_key`,
      [idAnexo, idAt]
    );
    if (!rows.length) return res.status(404).json({ error: 'Anexo não encontrado.' });
    // tenta remover do storage (não bloqueia em caso de falha)
    supabase.storage.from(AT_BUCKET).remove([rows[0].path_key]).catch(e =>
      console.warn('[SAC/AT] falha ao remover do storage:', e?.message)
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/AT] erro ao deletar anexo:', err);
    res.status(500).json({ error: 'Falha ao deletar anexo.' });
  }
});

// ── MENÇÕES ──────────────────────────────────────────────────────────────────
// POST /at/mencoes — registra uma menção vinculada a um AT
router.post('/at/mencoes', async (req, res) => {
  const body = req.body || {};
  const idAt = parseInt(body.id_at, 10);
  if (!idAt || idAt < 1) return res.status(400).json({ error: 'id_at inválido.' });

  const criado_por = req.session?.user?.fullName
                  || req.session?.user?.username
                  || req.session?.user?.login
                  || null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO sac.mencoes (id_at, telefone, nome_revenda_cliente, plataforma, motivo_solicitacao, acao_tomada, criado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, criado_em`,
      [
        idAt,
        String(body.telefone || '').trim() || null,
        String(body.nome_revenda_cliente || '').trim() || null,
        String(body.plataforma || '').trim() || null,
        String(body.motivo_solicitacao || '').trim() || null,
        String(body.acao_tomada || '').trim() || null,
        criado_por,
      ]
    );
    return res.json({ ok: true, id: rows[0].id, criado_em: rows[0].criado_em });
  } catch (err) {
    console.error('[SAC/AT] erro ao salvar menção:', err);
    return res.status(500).json({ error: 'Falha ao salvar menção.' });
  }
});

// GET /at/mencoes/:id_at — lista menções de um AT
router.get('/at/mencoes/:id_at', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!idAt || idAt < 1) return res.status(400).json({ error: 'id_at inválido.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, telefone, nome_revenda_cliente, plataforma, motivo_solicitacao, acao_tomada, criado_por, criado_em
       FROM sac.mencoes WHERE id_at = $1 ORDER BY criado_em DESC`,
      [idAt]
    );
    return res.json({ ok: true, mencoes: rows });
  } catch (err) {
    console.error('[SAC/AT] erro ao listar menções:', err);
    return res.status(500).json({ error: 'Falha ao listar menções.' });
  }
});

// GET /at/os-data/:id — dados completos para o formulário PDF de AT
router.get('/at/os-data/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID inválido.' });
  try {
    const { rows } = await pool.query(
      `SELECT
         a.nome_revenda_cliente,
         a.data                   AS data_abertura,
         a.numero_telefone          AS at_celular,
         a.cpf_cnpj,
         a.estado,
         a.cidade,
         a.rua,
         a.numero                 AS num_endereco,
         a.bairro,
         a.cep,
         a.agendar_atendimento_com,
         a.modelo                 AS at_modelo,
         a.tipo,
         a.descreva_reclamacao,
         a.motivo_solicitacao,
         a.acao_tomada,
         a.atendimento_inicial,
         s.cliente                AS revenda_cliente,
         s.ordem_producao,
         s.modelo                 AS serie_modelo,
         s.nota_fiscal,
         s.data_entrega,
         s.teste_tipo_gas,
         f.telefone1_ddd          AS rev_ddd,
         f.telefone1_numero       AS rev_tel,
         COALESCE(NULLIF(TRIM(f.nome_fantasia),''), NULLIF(TRIM(f.razao_social),'')) AS revenda_nome
       FROM sac.at a
       LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
       LEFT JOIN LATERAL (
         SELECT telefone1_ddd, telefone1_numero, nome_fantasia, razao_social
         FROM omie.fornecedores
         WHERE nome_fantasia ILIKE s.cliente OR razao_social ILIKE s.cliente
         ORDER BY CASE WHEN nome_fantasia ILIKE s.cliente THEN 0 ELSE 1 END
         LIMIT 1
       ) f ON true
       WHERE a.id = COALESCE(
         (SELECT a2.id FROM sac.at a2
          JOIN sac.at_busca_selecionada s2 ON s2.id_at = a2.id
          WHERE s2.ordem_producao = (
            SELECT s3.ordem_producao FROM sac.at_busca_selecionada s3 WHERE s3.id_at = $1
          )
          ORDER BY a2.id DESC LIMIT 1),
         $1
       )
       LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'AT não encontrado.' });
    const r = rows[0];

    // Formata data (pode vir como string DD/MM/YYYY ou ISO ou outro)
    let dataVenda = '';
    if (r.data_entrega) {
      const raw = String(r.data_entrega).trim();
      // Aceita DD/MM/YYYY com ou sem hora: "26/06/2025" ou "26/06/2025 14:08:14"
      const dmyMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (dmyMatch) {
        dataVenda = `${dmyMatch[1].padStart(2,'0')}/${dmyMatch[2].padStart(2,'0')}/${dmyMatch[3]}`;
      } else {
        const d = new Date(raw);
        if (!isNaN(d)) dataVenda = d.toLocaleDateString('pt-BR');
      }
    }

    // Modelo: pode vir da planilha ou do campo at.modelo
    const modelo = r.serie_modelo || r.at_modelo || '';

    // Extrai a primeira letra após a 1ª sequência de dígitos no modelo
    // ex: FTI185LPTBR → 185 → próxima letra = L
    let letraModelo = '';
    const letraMatch = modelo.match(/[A-Za-z]+\d+([A-Za-z])/);
    if (letraMatch) letraModelo = letraMatch[1].toUpperCase();

    // Busca alimentação no banco
    let alimentacao = '';
    let degelo = '';
    if (letraModelo) {
      const { rows: alRows } = await pool.query(
        `SELECT alimentacao, degelo FROM sac.alimentacao WHERE UPPER(letra_codigo)=$1 LIMIT 1`,
        [letraModelo]
      );
      if (alRows.length) { alimentacao = alRows[0].alimentacao; degelo = alRows[0].degelo || ''; }
    }

    // Busca specs técnicas na planilha (ORDEM DE PRODUÇÃO) — apenas CONTROLADOR
    // FLUIDO REFRIG vem do campo teste_tipo_gas já gravado em at_busca_selecionada
    let quadroExt = '';
    const fluidoRefrig = r.teste_tipo_gas || '';
    const ordemProd = r.ordem_producao || '';
    if (ordemProd) {
      try {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${SPEC_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SPEC_SHEET_GID}`;
        const resp = await fetchWithTimeout(csvUrl, { headers: { Accept: 'text/csv' } }, 15000);
        if (resp.ok) {
          const csvText = await resp.text();
          const specRows = csvParse(csvText, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true });
          if (specRows.length > 0) {
            const headers = Object.keys(specRows[0]);
            const colOrdem       = headers.find(h => normalizeText(h).includes('ORDEM') && normalizeText(h).includes('PROD'));
            const colControlador = headers.find(h => normalizeText(h).includes('CONTROLADOR'));
            if (colOrdem) {
              const found = specRows.find(row => normalizeText(row[colOrdem]) === normalizeText(ordemProd));
              if (found && colControlador) quadroExt = found[colControlador] || '';
            }
          }
        }
      } catch (sheetErr) {
        console.warn('[SAC/AT] spec-sheet lookup falhou:', sheetErr.message);
      }
    }

    // Histórico de reclamações para o mesmo orden_producao
    let historico = [];
    if (ordemProd) {
      try {
        const hRes = await pool.query(
          `SELECT a.id, a.data, a.descreva_reclamacao
           FROM sac.at a
           JOIN sac.at_busca_selecionada s ON s.id_at = a.id
           WHERE s.ordem_producao = $1
             AND a.descreva_reclamacao IS NOT NULL
             AND trim(a.descreva_reclamacao) != ''
           ORDER BY a.id DESC`,
          [ordemProd]
        );
        historico = hRes.rows.map(h => {
          const dt = h.data ? new Date(h.data) : null;
          const yy = dt && !isNaN(dt) ? String(dt.getFullYear()).slice(-2) : '';
          return `${yy}-${h.id} ${h.descreva_reclamacao}`;
        });
      } catch (hErr) {
        console.warn('[SAC/AT] falha ao buscar histórico:', hErr.message);
      }
    }

    // Busca dados de fechamento (registro mais recente com técnico vinculado, ou qualquer um)
    let fechamento = null;
    try {
      const fRes = await pool.query(
        `SELECT f.descricao_servico_realizado, f.valor_total_mao_obra, f.valor_gasto_pecas,
                f.data_conclusao_servico, f.observacao_tecnico, f.status_os,
                ct.nome AS tecnico_nome
         FROM sac.fechamento f
         LEFT JOIN sac.controle_tecnicos ct ON ct.id = f.id_tecnico
         WHERE f.id_at = $1
         ORDER BY f.id_tecnico DESC NULLS LAST, f.id DESC
         LIMIT 1`,
        [id]
      );
      if (fRes.rows.length) {
        const fc = fRes.rows[0];
        const fmt2 = v => v != null && v !== '' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
        fechamento = {
          tecnico_nome:                 fc.tecnico_nome || '',
          descricao_servico_realizado:  fc.descricao_servico_realizado || '',
          valor_total_mao_obra:         fmt2(fc.valor_total_mao_obra),
          valor_gasto_pecas:            fmt2(fc.valor_gasto_pecas),
          data_conclusao: (() => {
            if (!fc.data_conclusao_servico) return '';
            // pg retorna DATE como Date JS — não usar String(...).split('-')
            if (fc.data_conclusao_servico instanceof Date) {
              const dt = fc.data_conclusao_servico;
              const y = dt.getUTCFullYear();
              const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
              const d = String(dt.getUTCDate()).padStart(2, '0');
              return `${d}/${m}/${y}`;
            }
            const s = String(fc.data_conclusao_servico);
            const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
            const dt = new Date(s);
            if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString('pt-BR');
            return '';
          })(),
          observacao_tecnico:           fc.observacao_tecnico || '',
          status_os:                    fc.status_os || '',
        };
      }
    } catch (fErr) {
      console.warn('[SAC/AT] falha ao buscar fechamento:', fErr.message);
    }

    res.json({
      revenda:        r.revenda_nome    || r.revenda_cliente || '',
      revenda_cel:    r.rev_ddd && r.rev_tel ? `${r.rev_ddd} ${r.rev_tel}` : '',
      cliente:        r.nome_revenda_cliente || '',
      cidade_uf:      [r.cidade, r.estado].filter(Boolean).join(' / '),
      endereco:       [r.rua, r.num_endereco].filter(Boolean).join(', '),
      cep:            r.cep            || '',
      contato:        r.agendar_atendimento_com || '',
      celular:        r.at_celular     || '',
      cpf_cnpj:       r.cpf_cnpj       || '',
      num_serie:      ordemProd,
      nota_fiscal:    r.nota_fiscal    || '',
      modelo,
      data_venda:     dataVenda,
      quadro_ext:     quadroExt,
      fluido_refrig:  fluidoRefrig,
      alimentacao,
      degelo,
      descricao_problema:  r.descreva_reclamacao || '',
      motivo_solicitacao:  r.motivo_solicitacao  || '',
      acao_tomada:         r.acao_tomada         || '',
      atendimento_inicial: r.atendimento_inicial || '',
      tipo:                r.tipo || '',
      data_abertura: (() => {
        if (!r.data_abertura) return '';
        const dt = new Date(r.data_abertura);
        if (isNaN(dt)) return String(r.data_abertura);
        return dt.toLocaleDateString('pt-BR');
      })(),
      historico,
      fechamento,
    });
  } catch (err) {
    console.error('[SAC/AT] erro ao buscar dados OS:', err);
    res.status(500).json({ error: 'Falha ao buscar dados.' });
  }
});

function mapVippDestinoTecnico(row) {
  if (!row) return null;
  const addr = normalizarEnderecoTecnicoRow(row);
  return {
    nome: row.nome || '',
    cnpj_cpf: row.cnpj_cpf || '',
    telefone: row.celular || '',
    email: '',
    cep: row.cep || '',
    endereco: addr.endereco || '',
    numero: addr.numero || '',
    bairro: addr.bairro || '',
    complemento: addr.complemento || '',
    cidade: row.municipio || '',
    estado: row.uf || '',
  };
}

function mapVippDestinoFornecedor(row) {
  if (!row) return null;

  let cidade = String(row.cidade || '').trim();
  const cidadeUf = cidade.match(/^(.+?)\s*\([A-Z]{2}\)\s*$/i);
  if (cidadeUf) cidade = cidadeUf[1].trim();

  const ddd = String(row.telefone1_ddd || '').replace(/\D/g, '');
  const tel = String(row.telefone1_numero || '').replace(/\D/g, '');
  let telefone = '';
  if (ddd && tel) {
    telefone = tel.length >= 8
      ? `(${ddd}) ${tel.replace(/(\d{4,5})(\d{4})$/, '$1-$2')}`
      : `(${ddd}) ${tel}`;
  } else {
    telefone = tel || ddd;
  }

  let numero = String(row.endereco_numero || '').trim();
  if (!numero || numero === '0' || numero === '00') numero = '';

  const emailRaw = String(row.email || '').trim();
  const email = emailRaw ? emailRaw.split(/[,;]/)[0].trim() : '';

  return {
    nome: String(row.razao_social || row.nome_fantasia || '').trim(),
    cnpj_cpf: row.cnpj_cpf || '',
    telefone,
    email,
    cep: row.cep || '',
    endereco: row.endereco || '',
    numero,
    bairro: row.bairro || '',
    complemento: row.complemento || '',
    cidade,
    estado: String(row.estado || '').trim().toUpperCase(),
  };
}

function mapVippDestinoAt(row) {
  if (!row) return null;
  return {
    nome: row.nome_revenda_cliente || '',
    cnpj_cpf: row.cpf_cnpj || '',
    telefone: row.numero_telefone || '',
    cep: row.cep || '',
    endereco: row.rua || '',
    numero: row.numero || '',
    bairro: row.bairro || '',
    cidade: row.cidade || '',
    estado: row.estado || '',
    id_at: row.id || null,
  };
}

async function buscarTecnicoControlePorOs(idAt, nomeFallback) {
  const id = Number(idAt) || 0;
  if (!id) return null;

  const porId = await pool.query(
    `SELECT ct.id, ct.nome, ct.cnpj_cpf, ct.endereco, ct.numero, ct.bairro, ct.complemento,
            ct.municipio, ct.uf, ct.cep, ct.celular
       FROM sac.fechamento f
       JOIN sac.controle_tecnicos ct ON ct.id = f.id_tecnico
      WHERE f.id_at = $1
        AND f.id_tecnico IS NOT NULL
      ORDER BY f.id DESC
      LIMIT 1`,
    [id]
  );
  if (porId.rows[0]) return porId.rows[0];

  const nome = String(nomeFallback || '').trim();
  if (!nome) return null;

  const { rows } = await pool.query(
    `SELECT id, nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular
       FROM sac.controle_tecnicos
      WHERE UPPER(BTRIM(nome)) = UPPER(BTRIM($1))
      LIMIT 1`,
    [nome]
  );
  return rows[0] || null;
}

async function buscarVippDestinoPorTelefone(telefone) {
  const candidates = buildPhoneMatchCandidates(telefone);
  if (!candidates.length) return { encontrado: false };

  const suffix10 = [...new Set(candidates.filter((c) => c.length >= 10).map((c) => c.slice(-10)))];
  const suffix11 = [...new Set(candidates.filter((c) => c.length >= 11).map((c) => c.slice(-11)))];

  const phoneWhereParts = [`regexp_replace(celular, '\\D', '', 'g') = ANY($1::text[])`];
  const phoneParams = [candidates];
  if (suffix10.length) {
    phoneParams.push(suffix10);
    phoneWhereParts.push(`RIGHT(regexp_replace(celular, '\\D', '', 'g'), 10) = ANY($${phoneParams.length}::text[])`);
  }
  if (suffix11.length) {
    phoneParams.push(suffix11);
    phoneWhereParts.push(`RIGHT(regexp_replace(celular, '\\D', '', 'g'), 11) = ANY($${phoneParams.length}::text[])`);
  }

  const { rows: tecRows } = await pool.query(
    `SELECT id, nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular
       FROM sac.controle_tecnicos
      WHERE COALESCE(BTRIM(celular), '') <> ''
        AND (${phoneWhereParts.join(' OR ')})
      LIMIT 1`,
    phoneParams
  );
  if (tecRows[0]) {
    return {
      encontrado: true,
      fonte: 'tecnico',
      label: `Técnico: ${tecRows[0].nome || 'cadastrado'}`,
      dados: mapVippDestinoTecnico(tecRows[0]),
    };
  }

  const atWhereParts = [`regexp_replace(numero_telefone, '\\D', '', 'g') = ANY($1::text[])`];
  const atParams = [candidates];
  if (suffix10.length) {
    atParams.push(suffix10);
    atWhereParts.push(`RIGHT(regexp_replace(numero_telefone, '\\D', '', 'g'), 10) = ANY($${atParams.length}::text[])`);
  }
  if (suffix11.length) {
    atParams.push(suffix11);
    atWhereParts.push(`RIGHT(regexp_replace(numero_telefone, '\\D', '', 'g'), 11) = ANY($${atParams.length}::text[])`);
  }

  const { rows: atRows } = await pool.query(
    `SELECT id, nome_revenda_cliente, numero_telefone, cpf_cnpj, cep, rua, numero, bairro, cidade, estado
       FROM sac.at
      WHERE COALESCE(BTRIM(numero_telefone), '') <> ''
        AND (${atWhereParts.join(' OR ')})
      ORDER BY id DESC
      LIMIT 1`,
    atParams
  );
  if (atRows[0]) {
    return {
      encontrado: true,
      fonte: 'at',
      label: `OS #${atRows[0].id}: ${atRows[0].nome_revenda_cliente || 'cliente'}`,
      dados: mapVippDestinoAt(atRows[0]),
    };
  }

  return { encontrado: false };
}

// GET /at/vipp-preencher-tecnico/:id_at — destinatário VIPP a partir do técnico da OS
router.get('/at/vipp-preencher-tecnico/:id_at', async (req, res) => {
  const idAt = parseInt(req.params.id_at, 10);
  if (!idAt || idAt < 1) return res.status(400).json({ error: 'id_at inválido.' });
  try {
    const nomeFallback = String(req.query?.nome || '').trim();
    const tecnico = await buscarTecnicoControlePorOs(idAt, nomeFallback);
    if (!tecnico) {
      return res.status(404).json({ error: 'Nenhum técnico vinculado a esta OS.' });
    }
    return res.json({
      ok: true,
      tecnico_nome: tecnico.nome || '',
      dados: mapVippDestinoTecnico(tecnico),
    });
  } catch (err) {
    console.error('[SAC/AT] erro vipp-preencher-tecnico:', err);
    return res.status(500).json({ error: err.message || 'Falha ao buscar técnico.' });
  }
});

// GET /at/vipp-buscar-por-telefone?telefone= — técnico ou OS pelo celular informado
router.get('/at/vipp-buscar-por-telefone', async (req, res) => {
  try {
    const resultado = await buscarVippDestinoPorTelefone(req.query?.telefone);
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error('[SAC/AT] erro vipp-buscar-por-telefone:', err);
    return res.status(500).json({ error: err.message || 'Falha ao buscar telefone.' });
  }
});

// GET /at/vipp-buscar-nome?q= — autocomplete de técnicos e fornecedores (mín. 5 caracteres)
router.get('/at/vipp-buscar-nome', async (req, res) => {
  const q = String(req.query?.q || '').trim();
  if (q.length < 5) {
    return res.json({ ok: true, itens: [] });
  }
  const like = `%${q}%`;
  try {
    const [tecRes, fornRes] = await Promise.all([
      pool.query(
        `SELECT id, nome, municipio, uf
           FROM sac.controle_tecnicos
          WHERE nome ILIKE $1
          ORDER BY nome
          LIMIT 12`,
        [like]
      ),
      pool.query(
        `SELECT id, razao_social, nome_fantasia, cidade, estado
           FROM omie.fornecedores
          WHERE COALESCE(inativo, false) = false
            AND (razao_social ILIKE $1 OR nome_fantasia ILIKE $1)
          ORDER BY razao_social
          LIMIT 12`,
        [like]
      ),
    ]);

    const itens = [
      ...tecRes.rows.map((r) => ({
        fonte: 'tecnico',
        id: r.id,
        label: r.nome,
        sub: ['Técnico', r.municipio, r.uf].filter(Boolean).join(' · '),
      })),
      ...fornRes.rows.map((r) => ({
        fonte: 'fornecedor',
        id: r.id,
        label: r.razao_social || r.nome_fantasia,
        sub: ['Fornecedor', r.cidade, r.estado].filter(Boolean).join(' · '),
      })),
    ].slice(0, 20);

    return res.json({ ok: true, itens });
  } catch (err) {
    console.error('[SAC/AT] erro vipp-buscar-nome:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao buscar nome.' });
  }
});

// GET /at/vipp-destino-detalhe?fonte=tecnico|fornecedor&id= — dados completos para preencher VIPP
router.get('/at/vipp-destino-detalhe', async (req, res) => {
  const fonte = String(req.query?.fonte || '').trim().toLowerCase();
  const id = parseInt(req.query?.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'id inválido.' });
  if (!['tecnico', 'fornecedor'].includes(fonte)) {
    return res.status(400).json({ error: 'fonte inválida.' });
  }

  try {
    if (fonte === 'tecnico') {
      const { rows } = await pool.query(
        `SELECT id, nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular
           FROM sac.controle_tecnicos
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Técnico não encontrado.' });
      return res.json({
        ok: true,
        fonte,
        label: rows[0].nome,
        dados: mapVippDestinoTecnico(rows[0]),
      });
    }

    const { rows } = await pool.query(
      `SELECT id, razao_social, nome_fantasia, cnpj_cpf, telefone1_ddd, telefone1_numero, email,
              endereco, endereco_numero, complemento, bairro, cidade, estado, cep
         FROM omie.fornecedores
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    const dados = mapVippDestinoFornecedor(rows[0]);
    return res.json({
      ok: true,
      fonte,
      label: dados.nome,
      dados,
    });
  } catch (err) {
    console.error('[SAC/AT] erro vipp-destino-detalhe:', err);
    return res.status(500).json({ error: err.message || 'Falha ao buscar destinatário.' });
  }
});

// ── Nova OS: autocomplete telefone / nome (fornecedores Omie + sac.at) ───────

function _formatTelNovaOs(dddRaw, numRaw) {
  const ddd = String(dddRaw || '').replace(/\D/g, '');
  const tel = String(numRaw || '').replace(/\D/g, '');
  if (ddd && tel) {
    return tel.length >= 8
      ? `(${ddd}) ${tel.replace(/(\d{4,5})(\d{4})$/, '$1-$2')}`
      : `(${ddd}) ${tel}`;
  }
  if (tel.length === 11) return `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`;
  if (tel.length === 10) return `(${tel.slice(0, 2)}) ${tel.slice(2, 6)}-${tel.slice(6)}`;
  return tel || ddd || '';
}

function mapNovaOsFormAt(row) {
  if (!row) return null;
  return {
    nome_revenda_cliente: String(row.nome_revenda_cliente || '').trim(),
    numero_telefone: String(row.numero_telefone || '').trim(),
    cpf_cnpj: String(row.cpf_cnpj || '').trim(),
    cep: String(row.cep || '').trim(),
    rua: String(row.rua || '').trim(),
    numero: String(row.numero || '').trim(),
    bairro: String(row.bairro || '').trim(),
    cidade: String(row.cidade || '').trim(),
    estado: String(row.estado || '').trim().toUpperCase(),
    agendar_atendimento_com: String(row.agendar_atendimento_com || '').trim(),
  };
}

function mapNovaOsFormFornecedor(row) {
  if (!row) return null;
  let cidade = String(row.cidade || '').trim();
  const cidadeUf = cidade.match(/^(.+?)\s*\([A-Z]{2}\)\s*$/i);
  if (cidadeUf) cidade = cidadeUf[1].trim();

  let numero = String(row.endereco_numero || '').trim();
  if (!numero || numero === '0' || numero === '00') numero = '';

  const nome = String(row.nome_fantasia || row.razao_social || '').trim()
    || String(row.razao_social || '').trim();

  return {
    nome_revenda_cliente: nome,
    numero_telefone: _formatTelNovaOs(row.telefone1_ddd, row.telefone1_numero),
    cpf_cnpj: String(row.cnpj_cpf || '').trim(),
    cep: String(row.cep || '').trim(),
    rua: String(row.endereco || '').trim(),
    numero,
    bairro: String(row.bairro || '').trim(),
    cidade,
    estado: String(row.estado || '').trim().toUpperCase(),
    agendar_atendimento_com: '',
  };
}

// GET /at/nova-os-sugerir-telefone?q= — mín. 4 dígitos (omie.fornecedores + sac.at)
router.get('/at/nova-os-sugerir-telefone', async (req, res) => {
  const digits = String(req.query?.q || '').replace(/\D/g, '');
  if (digits.length < 4) return res.json({ ok: true, itens: [] });

  try {
    const like = `%${digits}%`;
    const [fornRes, atRes] = await Promise.all([
      pool.query(
        `SELECT id, razao_social, nome_fantasia, cnpj_cpf, telefone1_ddd, telefone1_numero,
                endereco, endereco_numero, bairro, cidade, estado, cep
           FROM omie.fornecedores
          WHERE COALESCE(inativo, false) = false
            AND COALESCE(BTRIM(telefone1_numero), '') <> ''
            AND (
              regexp_replace(telefone1_numero, '\\D', '', 'g') LIKE $1
              OR regexp_replace(
                   COALESCE(telefone1_ddd, '') || COALESCE(telefone1_numero, ''),
                   '\\D', '', 'g'
                 ) LIKE $1
            )
          ORDER BY razao_social NULLS LAST
          LIMIT 12`,
        [like]
      ),
      pool.query(
        `SELECT DISTINCT ON (regexp_replace(numero_telefone, '\\D', '', 'g'))
                id, nome_revenda_cliente, numero_telefone, cpf_cnpj, cep, rua, numero,
                bairro, cidade, estado, agendar_atendimento_com
           FROM sac.at
          WHERE COALESCE(BTRIM(numero_telefone), '') <> ''
            AND regexp_replace(numero_telefone, '\\D', '', 'g') LIKE $1
          ORDER BY regexp_replace(numero_telefone, '\\D', '', 'g'), id DESC
          LIMIT 12`,
        [like]
      ),
    ]);

    const itens = [
      ...fornRes.rows.map((r) => {
        const dados = mapNovaOsFormFornecedor(r);
        const tel = dados.numero_telefone || _formatTelNovaOs(r.telefone1_ddd, r.telefone1_numero);
        const nome = r.nome_fantasia || r.razao_social || 'Fornecedor';
        return {
          fonte: 'fornecedor',
          id: r.id,
          label: tel,
          sub: ['Omie', nome, r.cidade, r.estado].filter(Boolean).join(' · '),
          dados,
        };
      }),
      ...atRes.rows.map((r) => {
        const dados = mapNovaOsFormAt(r);
        return {
          fonte: 'at',
          id: r.id,
          label: dados.numero_telefone || r.numero_telefone,
          sub: ['OS AT', r.nome_revenda_cliente, `#${r.id}`].filter(Boolean).join(' · '),
          dados,
        };
      }),
    ].slice(0, 20);

    return res.json({ ok: true, itens });
  } catch (err) {
    console.error('[SAC/AT] erro nova-os-sugerir-telefone:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao buscar telefone.' });
  }
});

// GET /at/nova-os-sugerir-nome?q= — mín. 4 caracteres (AT + Omie)
router.get('/at/nova-os-sugerir-nome', async (req, res) => {
  const q = String(req.query?.q || '').trim();
  if (q.length < 4) return res.json({ ok: true, itens: [] });

  const like = `%${q}%`;
  try {
    const [fornRes, atRes] = await Promise.all([
      pool.query(
        `SELECT id, razao_social, nome_fantasia, cnpj_cpf, telefone1_ddd, telefone1_numero,
                endereco, endereco_numero, bairro, cidade, estado, cep
           FROM omie.fornecedores
          WHERE COALESCE(inativo, false) = false
            AND (razao_social ILIKE $1 OR nome_fantasia ILIKE $1)
          ORDER BY
            CASE
              WHEN nome_fantasia ILIKE $1 THEN 0
              WHEN razao_social ILIKE $1 THEN 1
              ELSE 2
            END,
            razao_social NULLS LAST
          LIMIT 12`,
        [like]
      ),
      pool.query(
        `SELECT id, nome_revenda_cliente, numero_telefone, cpf_cnpj, cep, rua, numero,
                bairro, cidade, estado, agendar_atendimento_com
           FROM sac.at
          WHERE nome_revenda_cliente ILIKE $1
             OR agendar_atendimento_com ILIKE $1
          ORDER BY id DESC
          LIMIT 12`,
        [like]
      ),
    ]);

    const itens = [
      ...fornRes.rows.map((r) => {
        const dados = mapNovaOsFormFornecedor(r);
        const label = String(r.nome_fantasia || r.razao_social || '').trim()
          || String(r.razao_social || '').trim();
        return {
          fonte: 'fornecedor',
          id: r.id,
          label,
          sub: ['Omie', dados.numero_telefone, r.cidade, r.estado].filter(Boolean).join(' · '),
          dados,
        };
      }),
      ...atRes.rows.map((r) => {
        const dados = mapNovaOsFormAt(r);
        const matchAgendar = r.agendar_atendimento_com
          && String(r.agendar_atendimento_com).toLowerCase().includes(q.toLowerCase())
          && !(r.nome_revenda_cliente || '').toLowerCase().includes(q.toLowerCase());
        const label = matchAgendar
          ? String(r.agendar_atendimento_com).trim()
          : String(r.nome_revenda_cliente || r.agendar_atendimento_com || '').trim();
        return {
          fonte: 'at',
          id: r.id,
          label,
          sub: [
            'OS AT',
            `#${r.id}`,
            matchAgendar ? (r.nome_revenda_cliente || null) : (r.agendar_atendimento_com || null),
            r.numero_telefone,
          ].filter(Boolean).join(' · '),
          dados,
        };
      }),
    ].slice(0, 20);

    return res.json({ ok: true, itens });
  } catch (err) {
    console.error('[SAC/AT] erro nova-os-sugerir-nome:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao buscar nome.' });
  }
});

// ── GRÁFICOS AT ──────────────────────────────────────────────────────────────
// GET /at/graficos/mencoes-por-mes — menções agrupadas por mês, excluindo AT tipo Atendimento rápido
router.get('/at/graficos/mencoes-por-mes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', m.criado_em), 'YYYY-MM') AS mes,
        COUNT(*)::int                                         AS total
      FROM sac.mencoes m
      JOIN sac.at a ON a.id = m.id_at
      WHERE m.criado_em IS NOT NULL
        AND LOWER(TRIM(a.tipo)) <> 'atendimento rápido'
        AND LOWER(TRIM(a.tipo)) <> 'atendimento rapido'
      GROUP BY 1
      ORDER BY 1
    `);
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[SAC/AT] erro graficos mencoes-por-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/graficos/detalhe-mes — registros de sac.at de um mês/tipo específico
router.get('/at/graficos/detalhe-mes', async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').trim();
    const mes  = String(req.query.mes  || '').trim(); // YYYY-MM
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: 'Parâmetro mes (YYYY-MM) obrigatório.' });

    const params = [mes];
    let whereExtra = '';
    if (tipo) { whereExtra = ' AND LOWER(tipo) = LOWER($2)'; params.push(tipo); }

    const { rows } = await pool.query(`
      SELECT id, data, descreva_reclamacao
      FROM sac.at
      WHERE TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM') = $1
        ${whereExtra}
      ORDER BY data, id
    `, params);
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[SAC/AT] erro graficos detalhe-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/graficos/mencoes-detalhe-mes — registros de sac.at vinculados a menções de um mês específico
router.get('/at/graficos/mencoes-detalhe-mes', async (req, res) => {
  try {
    const mes = String(req.query.mes || '').trim();
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, error: 'Parâmetro mes (YYYY-MM) obrigatório.' });

    const { rows } = await pool.query(`
      SELECT DISTINCT a.id, a.data, a.descreva_reclamacao
      FROM sac.mencoes m
      JOIN sac.at a ON a.id = m.id_at
      WHERE TO_CHAR(DATE_TRUNC('month', m.criado_em), 'YYYY-MM') = $1
        AND LOWER(TRIM(a.tipo)) <> 'atendimento rápido'
        AND LOWER(TRIM(a.tipo)) <> 'atendimento rapido'
      ORDER BY a.data, a.id
    `, [mes]);
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[SAC/AT] erro graficos mencoes-detalhe-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/graficos/por-mes — quantidade total de atendimentos agrupado por mês/ano
router.get('/at/graficos/por-mes', async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').trim();
    const params = [];
    const whereExtra = tipo ? ` AND LOWER(tipo) = LOWER($1)` : '';
    if (tipo) params.push(tipo);

    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM') AS mes,
        COUNT(*)::int                                  AS total
      FROM sac.at
      WHERE data IS NOT NULL${whereExtra}
      GROUP BY 1
      ORDER BY 1
    `, params);
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[SAC/AT] erro graficos por-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/graficos/relatorio — dados para relatório PDF, breakdown por tag × mês
// ?meses=N  (0 = tudo sem filtro; 3/6/12 = últimos N meses completos)
router.get('/at/graficos/relatorio', async (req, res) => {
  try {
    const mesesN = parseInt(req.query.meses || '3', 10);
    const filtroData = mesesN > 0
      ? `AND data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '${mesesN} months'
           AND data <  DATE_TRUNC('month', CURRENT_DATE)`
      : '';
    const filtroMencoes = mesesN > 0
      ? `AND m.criado_em >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '${mesesN} months'
           AND m.criado_em <  DATE_TRUNC('month', CURRENT_DATE)`
      : '';

    const [rQ, rR, rM, rMod] = await Promise.all([
      // OS aberta (Qualidade) — por tag × mês
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(tag_problema),''), '(sem tag)') AS tag,
          TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM')        AS mes,
          COUNT(*)::int                                         AS total
        FROM sac.at
        WHERE LOWER(TRIM(tipo)) = 'qualidade'
          ${filtroData}
        GROUP BY 1, 2
        ORDER BY tag, mes
      `),
      // Atendimento Rápido — por tag × mês
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(tag_problema),''), '(sem tag)') AS tag,
          TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM')        AS mes,
          COUNT(*)::int                                         AS total
        FROM sac.at
        WHERE LOWER(TRIM(tipo)) IN ('atendimento rapido','atendimento rápido')
          ${filtroData}
        GROUP BY 1, 2
        ORDER BY tag, mes
      `),
      // Menções (Pós abertura de OS) — somente AT != Atend. Rápido — por tag × mês
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(a.tag_problema),''), '(sem tag)') AS tag,
          TO_CHAR(DATE_TRUNC('month', m.criado_em), 'YYYY-MM')   AS mes,
          COUNT(*)::int                                           AS total
        FROM sac.mencoes m
        JOIN sac.at a ON a.id = m.id_at
        WHERE LOWER(TRIM(a.tipo)) NOT IN ('atendimento rapido','atendimento rápido')
          ${filtroMencoes}
        GROUP BY 1, 2
        ORDER BY tag, mes
      `),
      // Top Modelos — somente tipo Qualidade, por modelo × mês
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(modelo),''), '(sem modelo)') AS tag,
          TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM')     AS mes,
          COUNT(*)::int                                      AS total
        FROM sac.at
        WHERE LOWER(TRIM(tipo)) = 'qualidade'
          ${filtroData}
        GROUP BY 1, 2
        ORDER BY tag, mes
      `),
    ]);

    // Meses do eixo X (YYYY-MM e label legível)
    const nomesMes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    let meses = [];

    if (mesesN > 0) {
      // Meses fixos baseados no período solicitado
      for (let i = mesesN; i >= 1; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        const yyyymm = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        meses.push({ yyyymm, label: `${nomesMes[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}` });
      }
    } else {
      // Tudo: derivar meses únicos dos dados retornados
      const allRows = [...rQ.rows, ...rR.rows, ...rM.rows, ...rMod.rows];
      const unique = [...new Set(allRows.map(r => r.mes))].sort();
      meses = unique.map(yyyymm => {
        const [y, mo] = yyyymm.split('-').map(Number);
        return { yyyymm, label: `${nomesMes[mo-1]}/${String(y).slice(-2)}` };
      });
    }

    res.json({
      ok:      true,
      periodo: meses.map(m => m.label).join(' – '),
      meses,
      qualidade: rQ.rows,
      rapido:    rR.rows,
      mencoes:   rM.rows,
      modelos:   rMod.rows,
    });
  } catch (err) {
    console.error('[SAC/AT] erro relatorio:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function mesAtualReferencia(refDate = new Date()) {
  const ano = refDate.getFullYear();
  const mesNum = refDate.getMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  return {
    ano,
    mesNum,
    mesRaw: `${ano}-${pad(mesNum)}`,
  };
}

function calcAtRelatorioGerencialPeriodo(modoRaw, refDate = new Date()) {
  const modosValidos = new Set(['mes', '3m', '6m', 'anual']);
  const modo = modosValidos.has(modoRaw) ? modoRaw : 'mes';
  const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const { ano, mesNum, mesRaw } = mesAtualReferencia(refDate);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtYmd = (y, m, d = 1) => `${y}-${pad(m)}-${pad(d)}`;
  const mesLabel = (y, m) => (m >= 1 && m <= 12 ? `${nomesMes[m - 1]}/${y}` : `${y}-${pad(m)}`);

  if (modo === 'mes') {
    const nextM = mesNum === 12 ? 1 : mesNum + 1;
    const nextY = mesNum === 12 ? ano + 1 : ano;
    return {
      modo,
      mesRef: mesRaw,
      inicio: fmtYmd(ano, mesNum),
      fimExclusive: fmtYmd(nextY, nextM),
      label: mesLabel(ano, mesNum),
      meses: [mesRaw],
      evolucaoTipo: 'semana',
    };
  }

  const qtd = modo === '3m' ? 3 : (modo === '6m' ? 6 : 12);
  const inicioDate = new Date(ano, mesNum - 1 - qtd, 1);
  const meses = [];
  for (let i = 0; i < qtd; i += 1) {
    const d = new Date(inicioDate.getFullYear(), inicioDate.getMonth() + i, 1);
    meses.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  const fimY = mesNum === 1 ? ano - 1 : ano;
  const fimM = mesNum === 1 ? 12 : mesNum - 1;

  return {
    modo,
    mesRef: mesRaw,
    inicio: fmtYmd(inicioDate.getFullYear(), inicioDate.getMonth() + 1),
    fimExclusive: fmtYmd(ano, mesNum),
    label: `${mesLabel(inicioDate.getFullYear(), inicioDate.getMonth() + 1)} a ${mesLabel(fimY, fimM)}`,
    meses,
    evolucaoTipo: 'mes',
  };
}

function buildAtRelatorioGerencialTipoFilter(tipoRaw) {
  const tipo = String(tipoRaw || '').trim();
  if (!tipo) return '';
  const safe = tipo.replace(/'/g, "''");
  // Unifica aliases (Qualidade/QUALIDADE, Extensão de garantia/EXTENSÃO_GARANTIA, etc.)
  return ` AND (${sqlNormalizaTipoAt('a.tipo')}) = (${sqlNormalizaTipoAt(`'${safe}'`)})`;
}

/** Normaliza tipo de AT para agrupar/filtrar aliases (maiúsculas, underscore, sinônimos). */
function sqlNormalizaTipoAt(expr) {
  return `
    CASE
      WHEN NULLIF(TRIM(${expr}), '') IS NULL THEN '(sem tipo)'
      WHEN LOWER(TRIM(REGEXP_REPLACE(${expr}, '[_]+', ' ', 'g')))
           ~ 'extens[aã]o[[:space:]]*(de[[:space:]]*)?garantia'
        THEN 'Extensão de garantia'
      WHEN LOWER(TRIM(REGEXP_REPLACE(${expr}, '[_]+', ' ', 'g')))
           ~ 'instala[cç][aã]o[[:space:]]*equipamento'
        THEN 'Instalação equipamento'
      WHEN LOWER(TRIM(${expr})) IN ('qualidade') THEN 'Qualidade'
      WHEN LOWER(TRIM(${expr})) IN ('atendimento rápido', 'atendimento rapido') THEN 'Atendimento rápido'
      WHEN LOWER(TRIM(${expr})) = 'comercial' THEN 'Comercial'
      WHEN LOWER(TRIM(${expr})) IN ('logistica', 'logística') THEN 'Logística'
      WHEN LOWER(TRIM(${expr})) = 'engenharia' THEN 'Engenharia'
      WHEN LOWER(TRIM(${expr})) IN ('devolução', 'devolucao') THEN 'Devolução'
      ELSE INITCAP(LOWER(TRIM(REGEXP_REPLACE(${expr}, '[_]+', ' ', 'g'))))
    END
  `;
}

/**
 * Família de modelo para gráficos/ranking.
 * - UPPER no prefixo (fti/FTi → FTI)
 * - typos só-letras (DTI/FTIO/FTIW → FTI)
 * - texto inválido (ALEXANDRE/MODELO/SEM MODELO → sem modelo)
 * - sufixo BR/W sem duplicar (FTIBR, FH160W → FHW)
 */
function sqlFamiliaModeloAt(modeloExpr) {
  const m = `TRIM(COALESCE(${modeloExpr}, ''))`;
  return `
    COALESCE(
      NULLIF(
        (
          CASE
            WHEN ${m} = '' THEN NULL
            WHEN UPPER(REGEXP_REPLACE(${m}, '[[:space:]_-]+', '', 'g'))
                 ~ '^(ALEXANDRE|MODELO|SEMMODELO|NA|N/?A)$'
              THEN NULL
            WHEN UPPER(${m}) IN ('DTI', 'FTIO', 'FTIW', 'FTO', 'FIT', 'FT1') THEN 'FTI'
            WHEN UPPER(${m}) IN ('FTWW') THEN 'FTW'
            WHEN UPPER(${m}) IN ('FHWW') THEN 'FHW'
            ELSE
              CONCAT(
                UPPER(COALESCE(SUBSTRING(${m} FROM '^[A-Za-z]+'), '')),
                CASE
                  WHEN UPPER(${m}) ~ 'BR$'
                    AND UPPER(COALESCE(SUBSTRING(${m} FROM '^[A-Za-z]+'), '')) !~ 'BR$'
                  THEN 'BR'
                  WHEN UPPER(${m}) ~ 'W$'
                    AND UPPER(COALESCE(SUBSTRING(${m} FROM '^[A-Za-z]+'), '')) !~ 'W$'
                  THEN 'W'
                  ELSE ''
                END
              )
          END
        ),
        ''
      ),
      '(sem modelo)'
    )
  `;
}

// GET /at/relatorio-gerencial — dashboard executivo AT (período + tipo)
router.get('/at/relatorio-gerencial', async (req, res) => {
  try {
    await ensureSchema();
    const modoRaw = String(req.query.modo || 'mes').trim().toLowerCase();
    const tipoParam = req.query.tipo;
    const tipoFiltro = tipoParam === undefined || tipoParam === null
      ? 'Qualidade'
      : String(tipoParam).trim();
    const refAtual = mesAtualReferencia();
    const tipoSql = buildAtRelatorioGerencialTipoFilter(tipoFiltro);
    const periodoCfg = calcAtRelatorioGerencialPeriodo(modoRaw);
    const {
      inicio: mesInicio,
      fimExclusive: mesFimExclusive,
      label: periodoLabel,
      modo,
      meses: mesesPeriodo,
      evolucaoTipo,
      mesRef: mesRaw,
    } = periodoCfg;
    const rangeParams = [mesInicio, mesFimExclusive];

    const nomesMes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const anoStr = String(refAtual.ano);
    const mesNum = refAtual.mesNum;

    const baseCte = `
      WITH base AS (
        SELECT DISTINCT ON (a.id)
          a.id,
          a.data,
          COALESCE(NULLIF(TRIM(a.estado), ''), 'N/D') AS estado,
          COALESCE(NULLIF(TRIM(a.tag_problema), ''), '(sem tag)') AS tag,
          ${sqlFamiliaModeloAt("COALESCE(s.modelo, a.modelo, '')")} AS modelo,
          TRIM(COALESCE(a.status, '')) AS status_os,
          f.valor_total_mao_obra,
          CASE
            WHEN LOWER(COALESCE(f.status_os, '')) IN ('finalizado', 'fechado')
              OR f.data_conclusao_servico IS NOT NULL
            THEN 'concluida'
            ELSE 'em_andamento'
          END AS status_grupo
        FROM sac.at a
        LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
        LEFT JOIN sac.fechamento f ON f.id_at = a.id
        WHERE a.data >= $1::date
          AND a.data < $2::date${tipoSql}
        ORDER BY a.id, f.id DESC NULLS LAST
      )
    `;

    // Data de produção (não venda/entrega):
    // 1) família FTI Inverter Piscina (10457646996): OP 8F00YYMMDD… → ano/mês/dia
    // 2) historico_pedido_originalis.data_integracao pelo pedido
    //    (pedido em at_busca_selecionada pode vir "ENTREGUE / 17693" — usa trecho após " / ")
    // 3) fallback: at_busca_selecionada.ordem_producao = historico.ordem_de_producao
    //    OU at_busca_selecionada.ordem_producao = historico.nota_fiscal
    const loteBaseCte = `
      WITH lote_base AS (
        SELECT DISTINCT ON (a.id)
          a.id,
          COALESCE(NULLIF(TRIM(a.tag_problema), ''), '(sem tag)') AS tag,
          ${sqlFamiliaModeloAt("COALESCE(s.modelo, a.modelo, '')")} AS modelo,
          CASE
            WHEN po.codigo_familia = '10457646996'
              AND TRIM(COALESCE(s.ordem_producao, '')) ~ '^[A-Za-z0-9]{4}[0-9]{6}'
              AND SUBSTRING(TRIM(s.ordem_producao) FROM 7 FOR 2) BETWEEN '01' AND '12'
              AND SUBSTRING(TRIM(s.ordem_producao) FROM 9 FOR 2) BETWEEN '01' AND '31'
            THEN to_date(
              '20' || SUBSTRING(TRIM(s.ordem_producao) FROM 5 FOR 6),
              'YYYYMMDD'
            )
            WHEN h.data_integracao IS NOT NULL
              AND TRIM(h.data_integracao) <> ''
              AND TRIM(h.data_integracao) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN SUBSTRING(TRIM(h.data_integracao) FROM 1 FOR 10)::date
            WHEN hop.data_integracao IS NOT NULL
              AND TRIM(hop.data_integracao) <> ''
              AND TRIM(hop.data_integracao) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN SUBSTRING(TRIM(hop.data_integracao) FROM 1 FOR 10)::date
            ELSE NULL
          END AS data_producao_dt
        FROM sac.at a
        INNER JOIN sac.at_busca_selecionada s ON s.id_at = a.id
        LEFT JOIN LATERAL (
          SELECT po0.codigo_familia::text AS codigo_familia
          FROM public.produtos_omie po0
          WHERE UPPER(REPLACE(TRIM(po0.codigo), '-', ''))
              = UPPER(REPLACE(TRIM(COALESCE(s.modelo, a.modelo, '')), '-', ''))
          LIMIT 1
        ) po ON TRUE
        LEFT JOIN LATERAL (
          SELECT h0.data_integracao
          FROM public.historico_pedido_originalis h0
          WHERE TRIM(h0.pedido) = TRIM(regexp_replace(TRIM(COALESCE(s.pedido, '')), '^.* /\\s*', ''))
            AND h0.data_integracao IS NOT NULL
            AND TRIM(h0.data_integracao) <> ''
          ORDER BY h0.data_integracao ASC
          LIMIT 1
        ) h ON TRUE
        LEFT JOIN LATERAL (
          SELECT h0.data_integracao
          FROM public.historico_pedido_originalis h0
          WHERE TRIM(COALESCE(s.ordem_producao, '')) <> ''
            AND (
              TRIM(h0.ordem_de_producao) = TRIM(s.ordem_producao)
              OR TRIM(h0.nota_fiscal) = TRIM(s.ordem_producao)
            )
            AND h0.data_integracao IS NOT NULL
            AND TRIM(h0.data_integracao) <> ''
          ORDER BY
            CASE WHEN TRIM(h0.ordem_de_producao) = TRIM(s.ordem_producao) THEN 0 ELSE 1 END,
            h0.data_integracao ASC
          LIMIT 1
        ) hop ON TRUE
        WHERE a.data >= $1::date
          AND a.data < $2::date${tipoSql}
        ORDER BY a.id, s.id DESC
      )
    `;

    const evolucaoSql = evolucaoTipo === 'mes'
      ? `${baseCte}
        SELECT
          TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM') AS mes_key,
          COUNT(*)::int AS total
        FROM base
        GROUP BY 1
        ORDER BY 1`
      : `${baseCte}
        SELECT
          LEAST(5, GREATEST(1, CEIL(EXTRACT(DAY FROM data) / 7.0)::int)) AS semana,
          COUNT(*)::int AS total
        FROM base
        GROUP BY 1
        ORDER BY 1`;

    const ppmIdadeCte = `
      WITH ppm_idade AS (
        SELECT DISTINCT ON (a.id)
          a.id,
          a.data::date AS data_os,
          ${sqlFamiliaModeloAt("COALESCE(s.modelo, a.modelo, '')")} AS modelo,
          CASE
            WHEN po.codigo_familia = '10457646996'
              AND TRIM(COALESCE(s.ordem_producao, '')) ~ '^[A-Za-z0-9]{4}[0-9]{6}'
              AND SUBSTRING(TRIM(s.ordem_producao) FROM 7 FOR 2) BETWEEN '01' AND '12'
              AND SUBSTRING(TRIM(s.ordem_producao) FROM 9 FOR 2) BETWEEN '01' AND '31'
            THEN to_date(
              '20' || SUBSTRING(TRIM(s.ordem_producao) FROM 5 FOR 6),
              'YYYYMMDD'
            )
            WHEN h.data_integracao IS NOT NULL
              AND TRIM(h.data_integracao) <> ''
              AND TRIM(h.data_integracao) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN SUBSTRING(TRIM(h.data_integracao) FROM 1 FOR 10)::date
            WHEN hop.data_integracao IS NOT NULL
              AND TRIM(hop.data_integracao) <> ''
              AND TRIM(hop.data_integracao) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN SUBSTRING(TRIM(hop.data_integracao) FROM 1 FOR 10)::date
            ELSE NULL
          END AS data_producao_dt,
          CASE
            WHEN TRIM(COALESCE(s.data_entrega, '')) ~ '^[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}'
            THEN to_date(
              lpad((regexp_match(TRIM(s.data_entrega), '^([0-9]{1,2})'))[1], 2, '0')
              || '/' ||
              lpad((regexp_match(TRIM(s.data_entrega), '^[0-9]{1,2}[/-]([0-9]{1,2})'))[1], 2, '0')
              || '/' ||
              CASE
                WHEN length((regexp_match(TRIM(s.data_entrega), '^[0-9]{1,2}[/-][0-9]{1,2}[/-]([0-9]{2,4})'))[1]) = 2
                THEN '20' || (regexp_match(TRIM(s.data_entrega), '^[0-9]{1,2}[/-][0-9]{1,2}[/-]([0-9]{2,4})'))[1]
                ELSE (regexp_match(TRIM(s.data_entrega), '^[0-9]{1,2}[/-][0-9]{1,2}[/-]([0-9]{2,4})'))[1]
              END,
              'DD/MM/YYYY'
            )
            WHEN TRIM(COALESCE(s.data_entrega, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN LEFT(TRIM(s.data_entrega), 10)::date
            ELSE NULL
          END AS data_venda_dt
        FROM sac.at a
        INNER JOIN sac.at_busca_selecionada s ON s.id_at = a.id
        LEFT JOIN LATERAL (
          SELECT po0.codigo_familia::text AS codigo_familia
          FROM public.produtos_omie po0
          WHERE UPPER(REPLACE(TRIM(po0.codigo), '-', ''))
              = UPPER(REPLACE(TRIM(COALESCE(s.modelo, a.modelo, '')), '-', ''))
          LIMIT 1
        ) po ON TRUE
        LEFT JOIN LATERAL (
          SELECT h0.data_integracao
          FROM public.historico_pedido_originalis h0
          WHERE TRIM(h0.pedido) = TRIM(regexp_replace(TRIM(COALESCE(s.pedido, '')), '^.* /\\s*', ''))
            AND h0.data_integracao IS NOT NULL
            AND TRIM(h0.data_integracao) <> ''
          ORDER BY h0.data_integracao ASC
          LIMIT 1
        ) h ON TRUE
        LEFT JOIN LATERAL (
          SELECT h0.data_integracao
          FROM public.historico_pedido_originalis h0
          WHERE TRIM(COALESCE(s.ordem_producao, '')) <> ''
            AND (
              TRIM(h0.ordem_de_producao) = TRIM(s.ordem_producao)
              OR TRIM(h0.nota_fiscal) = TRIM(s.ordem_producao)
            )
            AND h0.data_integracao IS NOT NULL
            AND TRIM(h0.data_integracao) <> ''
          ORDER BY
            CASE WHEN TRIM(h0.ordem_de_producao) = TRIM(s.ordem_producao) THEN 0 ELSE 1 END,
            h0.data_integracao ASC
          LIMIT 1
        ) hop ON TRUE
        WHERE a.data >= $1::date
          AND a.data < $2::date${tipoSql}
        ORDER BY a.id, s.id DESC
      )
    `;

    const [
      rKpi,
      rEstado,
      rModelo,
      rTag,
      rTagModelo,
      rStatus,
      rEvolucao,
    ] = await Promise.all([
      pool.query(`${baseCte}
        SELECT
          COUNT(*)::int AS total_os,
          COUNT(*) FILTER (WHERE status_grupo = 'concluida')::int AS concluidas,
          COUNT(*) FILTER (WHERE status_grupo = 'em_andamento')::int AS em_andamento,
          COUNT(DISTINCT estado) FILTER (WHERE estado <> 'N/D')::int AS estados_atendidos,
          COUNT(DISTINCT modelo) FILTER (WHERE modelo <> '(sem modelo)')::int AS modelos_atendidos,
          COUNT(*) FILTER (WHERE status_os = 'Aguardando NF AT')::int AS pendente_fechamento_tecnico,
          COALESCE(SUM(valor_total_mao_obra) FILTER (WHERE status_grupo = 'concluida'), 0)::float AS total_mo,
          COALESCE(AVG(valor_total_mao_obra) FILTER (
            WHERE status_grupo = 'concluida' AND valor_total_mao_obra IS NOT NULL AND valor_total_mao_obra > 0
          ), 0)::float AS custo_medio
        FROM base
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT estado, COUNT(*)::int AS total
        FROM base
        GROUP BY estado
        ORDER BY total DESC, estado
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT modelo, COUNT(*)::int AS total
        FROM base
        GROUP BY modelo
        ORDER BY total DESC, modelo
        LIMIT 10
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT tag, COUNT(*)::int AS total
        FROM base
        GROUP BY tag
        ORDER BY total DESC, tag
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT tag, modelo, COUNT(*)::int AS total
        FROM base
        GROUP BY tag, modelo
        ORDER BY tag, total DESC, modelo
      `, rangeParams),
      pool.query(`${baseCte}
        SELECT status_grupo, COUNT(*)::int AS total
        FROM base
        GROUP BY status_grupo
        ORDER BY status_grupo
      `, rangeParams),
      pool.query(evolucaoSql, rangeParams),
    ]);

    // Lotes em paralelo limitados (pool max ~10) — evita "timeout exceeded when trying to connect"
    const [
      rFinanceiro,
      rTopPecas,
      rLoteMes,
      rLoteMesModelo,
      rLoteModeloJanela,
      rLoteTagJanela,
      rLoteTagModeloJanela,
    ] = await Promise.all([
      pool.query(`${baseCte}
        SELECT
          b.id,
          b.estado,
          b.data,
          b.valor_total_mao_obra,
          b.status_grupo,
          COALESCE(env.total_envio, 0)::float AS valor_envio,
          COALESCE(env.qtd_envios, 0)::int AS qtd_envios,
          COALESCE(cp.total_pecas, 0)::float AS valor_pecas,
          COALESCE(cp.qtd_itens, 0)::int AS qtd_itens_pecas
        FROM base b
        LEFT JOIN (
          SELECT id_at,
                 SUM(COALESCE(valor_envio, 0))::float AS total_envio,
                 COUNT(*)::int AS qtd_envios
            FROM envios.solicitacoes
           WHERE id_at IS NOT NULL
           GROUP BY id_at
        ) env ON env.id_at = b.id
        LEFT JOIN (
          SELECT id_at,
                 SUM(COALESCE(valor_total, 0))::float AS total_pecas,
                 COUNT(*)::int AS qtd_itens
            FROM envios.custo_pecas
           WHERE id_at IS NOT NULL
           GROUP BY id_at
        ) cp ON cp.id_at = b.id
        WHERE COALESCE(b.valor_total_mao_obra, 0) > 0
           OR COALESCE(env.total_envio, 0) > 0
           OR COALESCE(cp.total_pecas, 0) > 0
        ORDER BY b.data ASC, b.id ASC
      `, rangeParams),
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(cp.codigo_produto), ''), '(sem código)') AS codigo,
          COALESCE(NULLIF(TRIM(cp.descricao), ''), '(sem descrição)') AS descricao,
          SUM(COALESCE(cp.quantidade, 0))::float AS quantidade,
          SUM(COALESCE(cp.valor_total, 0))::float AS valor_total,
          COUNT(DISTINCT cp.id_at)::int AS qtd_os
        FROM envios.custo_pecas cp
        INNER JOIN sac.at a ON a.id = cp.id_at
        WHERE a.data >= $1::date
          AND a.data < $2::date${tipoSql}
          AND COALESCE(cp.valor_total, 0) > 0
        GROUP BY 1, 2
        ORDER BY valor_total DESC, quantidade DESC
        LIMIT 15
      `, rangeParams),
      pool.query(`${loteBaseCte}
        SELECT
          COALESCE(to_char(data_producao_dt, 'YYYY-MM'), '__sem_dt__') AS mes,
          COUNT(*)::int AS total
        FROM lote_base
        GROUP BY 1
        ORDER BY 1
      `, rangeParams),
      pool.query(`${loteBaseCte}
        SELECT
          COALESCE(to_char(data_producao_dt, 'YYYY-MM'), '__sem_dt__') AS mes,
          modelo,
          COUNT(*)::int AS total
        FROM lote_base
        GROUP BY 1, 2
        ORDER BY 1, 3 DESC, 2
      `, rangeParams),
      pool.query(`${loteBaseCte}
        SELECT modelo, COUNT(*)::int AS total
        FROM lote_base
        GROUP BY modelo
        ORDER BY total DESC, modelo
      `, rangeParams),
      pool.query(`${loteBaseCte}
        SELECT tag, COUNT(*)::int AS total
        FROM lote_base
        GROUP BY tag
        ORDER BY total DESC, tag
      `, rangeParams),
      pool.query(`${loteBaseCte}
        SELECT tag, modelo, COUNT(*)::int AS total
        FROM lote_base
        GROUP BY tag, modelo
        ORDER BY tag, total DESC, modelo
      `, rangeParams),
    ]);

    const [
      rLoteMesModeloTag,
      rLoteTotalJanela,
      rPpmProducao,
      rPpmVenda,
      rPpmIdade,
    ] = await Promise.all([
      pool.query(`${loteBaseCte}
        SELECT
          COALESCE(to_char(data_producao_dt, 'YYYY-MM'), '__sem_dt__') AS mes,
          modelo,
          tag,
          COUNT(*)::int AS total
        FROM lote_base
        GROUP BY 1, 2, 3
        ORDER BY 1, 4 DESC, 2
      `, rangeParams),
      pool.query(`${loteBaseCte}
        SELECT COUNT(*)::int AS total
        FROM lote_base
      `, rangeParams),
      pool.query(`
        SELECT
          ${sqlFamiliaModeloAt('h.modelo')} AS modelo,
          COUNT(*)::int AS quantidade
        FROM public.historico_pedido_originalis h
        WHERE TRIM(COALESCE(h.data_integracao, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND LEFT(TRIM(h.data_integracao), 10)::date >= $1::date
          AND LEFT(TRIM(h.data_integracao), 10)::date < $2::date
        GROUP BY 1
        ORDER BY quantidade DESC, modelo
      `, rangeParams),
      pool.query(`
        WITH ${VENDAS_NF_POR_PEDIDO_CTE},
        pedidos_cfop_ignorado AS (
          SELECT DISTINCT codigo_pedido
          FROM "Vendas".pedidos_venda_itens
          WHERE REGEXP_REPLACE(TRIM(COALESCE(cfop, '')), '\\D', '', 'g') = '6905'
        ),
        base_vendas AS (
          SELECT DISTINCT ON (p.codigo_pedido)
            p.codigo_pedido
          FROM "Vendas".pedidos_venda p
          LEFT JOIN nf_por_pedido nf
            ON ${vendasNfJoinPedidoSql('nf', 'p')}
          WHERE p.codigo_pedido NOT IN (SELECT codigo_pedido FROM pedidos_cfop_ignorado)
            AND TRIM(COALESCE(p.etapa::text, '')) = '70'
            AND nf.data_emissao_dt IS NOT NULL
            AND nf.data_emissao_dt >= $1::date
            AND nf.data_emissao_dt < $2::date
          ORDER BY p.codigo_pedido
        )
        SELECT
          ${sqlFamiliaModeloAt('i.codigo')} AS modelo,
          COALESCE(SUM(COALESCE(i.quantidade, 0)), 0)::float AS quantidade
        FROM base_vendas b
        JOIN "Vendas".pedidos_venda_itens i ON i.codigo_pedido = b.codigo_pedido
        WHERE REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') <> '6905'
        GROUP BY 1
        ORDER BY quantidade DESC, modelo
      `, rangeParams),
      pool.query(`${ppmIdadeCte}
        SELECT
          modelo,
          ROUND(AVG((data_os - data_producao_dt)) FILTER (
            WHERE data_os IS NOT NULL AND data_os >= data_producao_dt
              AND data_producao_dt IS NOT NULL
          ))::float AS idade_media_prod_dias,
          ROUND(AVG((data_os - data_venda_dt)) FILTER (
            WHERE data_venda_dt IS NOT NULL AND data_os IS NOT NULL AND data_os >= data_venda_dt
          ))::float AS idade_media_venda_dias
        FROM ppm_idade
        GROUP BY modelo
        ORDER BY modelo
      `, rangeParams),
    ]);

    const kpi = rKpi.rows[0] || {};
    const tags = rTag.rows || [];
    const tagTotal = tags.reduce((s, r) => s + (r.total || 0), 0);
    let acum = 0;
    const pareto = tags.map((r) => {
      acum += r.total || 0;
      return {
        tag: r.tag,
        total: r.total,
        pct: tagTotal ? Math.round((r.total / tagTotal) * 1000) / 10 : 0,
        pct_acum: tagTotal ? Math.round((acum / tagTotal) * 1000) / 10 : 0,
      };
    });

    const janelaLoteFimLabel = (() => {
      const d = new Date(mesFimExclusive);
      d.setDate(d.getDate() - 1);
      return d.toLocaleDateString('pt-BR');
    })();
    const janelaLoteInicioLabel = new Date(mesInicio).toLocaleDateString('pt-BR');
    const janelaLoteMeses = mesesPeriodo;
    const lotePorMes = (rLoteMes.rows || []).map((r) => {
      if (r.mes === '__sem_dt__') {
        return { mes: r.mes, label: 'S/ Dt produção', total: r.total };
      }
      const [y, m] = String(r.mes || '').split('-');
      const mi = parseInt(m, 10);
      return {
        mes: r.mes,
        label: mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : r.mes,
        total: r.total,
      };
    });
    const lotePorMesModelo = (rLoteMesModelo.rows || []).map((r) => {
      if (r.mes === '__sem_dt__') {
        return { mes: r.mes, label: 'S/ Dt produção', modelo: r.modelo, total: r.total };
      }
      const [y, m] = String(r.mes || '').split('-');
      const mi = parseInt(m, 10);
      return {
        mes: r.mes,
        label: mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : r.mes,
        modelo: r.modelo,
        total: r.total,
      };
    });
    const lotePorMesModeloTag = (rLoteMesModeloTag.rows || []).map((r) => {
      if (r.mes === '__sem_dt__') {
        return { mes: r.mes, label: 'S/ Dt produção', modelo: r.modelo, tag: r.tag, total: r.total };
      }
      const [y, m] = String(r.mes || '').split('-');
      const mi = parseInt(m, 10);
      return {
        mes: r.mes,
        label: mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : r.mes,
        modelo: r.modelo,
        tag: r.tag,
        total: r.total,
      };
    });
    const loteModelosJanela = rLoteModeloJanela.rows || [];
    const loteTagsJanela = rLoteTagJanela.rows || [];
    const loteTagTotal = loteTagsJanela.reduce((s, r) => s + (r.total || 0), 0);

    const { rows: rTextos } = await pool.query(
      `SELECT plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades,
              editado_por, editado_em
         FROM sac.at_relatorio_gerencial
        WHERE mes = $1`,
      [mesRaw]
    );
    const txtRow = rTextos[0];
    const textos = txtRow ? {
      plano_acao: Array.isArray(txtRow.plano_acao) ? txtRow.plano_acao : [],
      conclusao_resumo: txtRow.conclusao_resumo || '',
      conclusao_pontos_criticos: txtRow.conclusao_pontos_criticos || '',
      conclusao_oportunidades: txtRow.conclusao_oportunidades || '',
      editado_por: txtRow.editado_por || null,
      editado_em: txtRow.editado_em || null,
      salvo: true,
    } : {
      plano_acao: [],
      conclusao_resumo: '',
      conclusao_pontos_criticos: '',
      conclusao_oportunidades: '',
      editado_por: null,
      editado_em: null,
      salvo: false,
    };

    const financeiroRows = (rFinanceiro.rows || []).map((r) => {
      const valorMo = Math.round(Number(r.valor_total_mao_obra || 0) * 100) / 100;
      const valorEnvio = Math.round(Number(r.valor_envio || 0) * 100) / 100;
      const valorPecas = Math.round(Number(r.valor_pecas || 0) * 100) / 100;
      return {
        id: r.id,
        os: `${String(new Date(r.data).getFullYear()).slice(-2)} - ${r.id}`,
        estado: r.estado,
        data: r.data,
        status_grupo: r.status_grupo,
        valor_mo: valorMo,
        valor_envio: valorEnvio,
        qtd_envios: r.qtd_envios || 0,
        valor_pecas: valorPecas,
        qtd_itens_pecas: r.qtd_itens_pecas || 0,
        valor_total: Math.round((valorMo + valorEnvio + valorPecas) * 100) / 100,
      };
    });
    const totalEnvioPeriodo = financeiroRows.reduce((s, r) => s + (r.valor_envio || 0), 0);
    const totalPecasPeriodo = financeiroRows.reduce((s, r) => s + (r.valor_pecas || 0), 0);
    const totalMoPeriodo = Math.round(Number(kpi.total_mo || 0) * 100) / 100;
    const totalGeralPeriodo = Math.round((totalMoPeriodo + totalEnvioPeriodo + totalPecasPeriodo) * 100) / 100;
    const osComCusto = financeiroRows.filter((r) => (r.valor_total || 0) > 0).length;
    const topPecasCusto = (rTopPecas.rows || []).map((r) => ({
      codigo: r.codigo,
      descricao: r.descricao,
      quantidade: Math.round(Number(r.quantidade || 0) * 1000) / 1000,
      valor_total: Math.round(Number(r.valor_total || 0) * 100) / 100,
      qtd_os: r.qtd_os || 0,
    }));

    const prodMap = new Map(
      (rPpmProducao.rows || []).map((r) => [r.modelo, Number(r.quantidade) || 0])
    );
    const vendMap = new Map(
      (rPpmVenda.rows || []).map((r) => [r.modelo, Number(r.quantidade) || 0])
    );
    const idadeMap = new Map(
      (rPpmIdade.rows || []).map((r) => [r.modelo, {
        idade_media_prod_dias: r.idade_media_prod_dias != null ? Number(r.idade_media_prod_dias) : null,
        idade_media_venda_dias: r.idade_media_venda_dias != null ? Number(r.idade_media_venda_dias) : null,
      }])
    );
    const ppm_modelos = (rModelo.rows || []).map((r) => {
      const os = r.total || 0;
      const qtd_producao = prodMap.get(r.modelo) || 0;
      const qtd_venda = vendMap.get(r.modelo) || 0;
      const idade = idadeMap.get(r.modelo) || {};
      return {
        modelo: r.modelo,
        os,
        qtd_producao,
        ppm_producao: qtd_producao > 0 ? Math.round((os / qtd_producao) * 1e6) : 0,
        sem_denominador_producao: qtd_producao <= 0,
        qtd_venda: Math.round(qtd_venda * 100) / 100,
        ppm_venda: qtd_venda > 0 ? Math.round((os / qtd_venda) * 1e6) : 0,
        sem_denominador_venda: qtd_venda <= 0,
        idade_media_prod_dias: idade.idade_media_prod_dias ?? null,
        idade_media_venda_dias: idade.idade_media_venda_dias ?? null,
      };
    });

    const labelMesProd = (mesKey) => {
      if (mesKey === '__sem_dt__') return 'S/ Dt produção';
      const [y, m] = String(mesKey || '').split('-');
      const mi = parseInt(m, 10);
      return mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : mesKey;
    };

    // Produção por mês×modelo — query leve e sequencial (fora do Promise.all para não saturar o pool).
    // Só nos YYYY-MM que aparecem no gráfico de lote.
    const mesesProdLote = [...new Set(
      lotePorMesModelo
        .map((r) => r.mes)
        .filter((m) => m && m !== '__sem_dt__' && /^\d{4}-\d{2}$/.test(String(m)))
    )].sort();
    let producaoPorMesModelo = [];
    if (mesesProdLote.length) {
      try {
        const mesIni = `${mesesProdLote[0]}-01`;
        const [yMax, mMax] = mesesProdLote[mesesProdLote.length - 1].split('-').map(Number);
        const mesFimExcl = new Date(Date.UTC(yMax, mMax, 1)); // mês seguinte ao último
        const mesFimExclStr = mesFimExcl.toISOString().slice(0, 10);
        const rLoteProducaoMes = await pool.query(`
          SELECT
            LEFT(TRIM(h.data_integracao), 7) AS mes,
            ${sqlFamiliaModeloAt('h.modelo')} AS modelo,
            COUNT(*)::int AS quantidade
          FROM public.historico_pedido_originalis h
          WHERE TRIM(COALESCE(h.data_integracao, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND LEFT(TRIM(h.data_integracao), 10) >= $1
            AND LEFT(TRIM(h.data_integracao), 10) < $2
            AND LEFT(TRIM(h.data_integracao), 7) = ANY($3::text[])
          GROUP BY 1, 2
          ORDER BY 1, quantidade DESC, modelo
        `, [mesIni, mesFimExclStr, mesesProdLote]);
        producaoPorMesModelo = (rLoteProducaoMes.rows || []).map((r) => ({
          mes: r.mes,
          label: labelMesProd(r.mes),
          modelo: r.modelo,
          quantidade: Number(r.quantidade) || 0,
        }));
      } catch (eProd) {
        console.warn('[SAC/AT] ppm lote produção (coorte):', eProd.message || eProd);
        producaoPorMesModelo = [];
      }
    }
    const prodMesModeloMap = new Map(
      producaoPorMesModelo.map((r) => [`${r.mes}||${r.modelo}`, r.quantidade])
    );
    const ppmPorMesModelo = lotePorMesModelo
      .filter((r) => r.mes && r.mes !== '__sem_dt__')
      .map((r) => {
        const qtd_producao = prodMesModeloMap.get(`${r.mes}||${r.modelo}`) || 0;
        const os = r.total || 0;
        return {
          mes: r.mes,
          label: r.label,
          modelo: r.modelo,
          os,
          qtd_producao,
          ppm_producao: qtd_producao > 0 ? Math.round((os / qtd_producao) * 1e6) : 0,
          sem_denominador: qtd_producao <= 0,
        };
      })
      .sort((a, b) => String(a.mes).localeCompare(String(b.mes)) || (b.os - a.os));

    // Alterações de engenharia × mês (referência Data ou data do registro) × família do modelo
    let alteracoesPorMesModelo = [];
    try {
      const mesesParaAlt = [...new Set([
        ...mesesProdLote,
        ...lotePorMesModelo
          .map((r) => r.mes)
          .filter((m) => m && m !== '__sem_dt__' && /^\d{4}-\d{2}$/.test(String(m))),
      ])].sort();

      if (mesesParaAlt.length) {
        const rAlt = await pool.query(`
          WITH base AS (
            SELECT
              a.id,
              a.data,
              a.codigo_omie,
              a.antes,
              a.depois,
              a.referencia,
              a.criado_por,
              COALESCE(p.codigo, p2.codigo) AS codigo_interno,
              ${sqlFamiliaModeloAt("COALESCE(p.codigo, p2.codigo, '')")} AS modelo,
              CASE
                WHEN a.referencia ~* '^Data:\\s*\\d{4}-\\d{2}-\\d{2}'
                  THEN SUBSTRING(a.referencia FROM '(\\d{4}-\\d{2})')
                WHEN a.referencia ~* '^Data:\\s*\\d{2}/\\d{2}/\\d{4}'
                  THEN (
                    SUBSTRING(a.referencia FROM '(\\d{4})$')
                    || '-'
                    || SUBSTRING(a.referencia FROM '/(\\d{2})/')
                  )
                ELSE to_char((a.data AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM')
              END AS mes
            FROM engenharia.alteracoes_produto a
            LEFT JOIN public.produtos_omie p
              ON p.codigo_produto::text = a.codigo_omie
            LEFT JOIN public.produtos_omie p2
              ON p2.codigo = a.codigo_omie
            WHERE a.codigo_omie IS NOT NULL
              AND TRIM(a.codigo_omie) <> ''
              AND a.codigo_omie !~* '^c[oó]digo(\\s+do)?\\s+produto$'
              AND a.codigo_omie !~* '^c[oó]digo\\s+omie$'
              AND COALESCE(p.codigo, p2.codigo) IS NOT NULL
          )
          SELECT
            id,
            data::text AS data,
            codigo_omie,
            codigo_interno,
            modelo,
            mes,
            antes,
            depois,
            referencia,
            criado_por
          FROM base
          WHERE mes = ANY($1::text[])
            AND modelo IS NOT NULL
            AND modelo <> '(sem modelo)'
          ORDER BY mes, modelo, data DESC, id DESC
        `, [mesesParaAlt]);

        alteracoesPorMesModelo = (rAlt.rows || []).map((r) => ({
          id: r.id,
          mes: r.mes,
          label: labelMesProd(r.mes),
          modelo: r.modelo,
          codigo_omie: r.codigo_omie,
          codigo_interno: r.codigo_interno || null,
          antes: r.antes || '',
          depois: r.depois || '',
          referencia: r.referencia || null,
          criado_por: r.criado_por || null,
          data: r.data,
        }));
      }
    } catch (eAlt) {
      console.warn('[SAC/AT] alteracoes produto no lote:', eAlt.message || eAlt);
      alteracoesPorMesModelo = [];
    }

    return res.json({
      ok: true,
      mes: mesRaw,
      modo,
      tipo: tipoFiltro || 'Todos',
      periodo: periodoLabel,
      evolucao_tipo: evolucaoTipo,
      kpis: {
        total_os: kpi.total_os || 0,
        concluidas: kpi.concluidas || 0,
        em_andamento: kpi.em_andamento || 0,
        estados_atendidos: kpi.estados_atendidos || 0,
        modelos_atendidos: kpi.modelos_atendidos || 0,
        total_mo: Math.round((kpi.total_mo || 0) * 100) / 100,
        custo_medio: Math.round((kpi.custo_medio || 0) * 100) / 100,
        abertas_mes: kpi.total_os || 0,
        pendente_fechamento_tecnico: kpi.pendente_fechamento_tecnico || 0,
        total_envio: Math.round(totalEnvioPeriodo * 100) / 100,
        total_pecas: Math.round(totalPecasPeriodo * 100) / 100,
        total_custo_geral: totalGeralPeriodo,
        os_com_custo: osComCusto,
        custo_medio_geral: osComCusto
          ? Math.round((totalGeralPeriodo / osComCusto) * 100) / 100
          : 0,
      },
      por_estado: rEstado.rows,
      por_modelo: rModelo.rows,
      ppm_modelos,
      por_tag: tags,
      tag_por_modelo: rTagModelo.rows || [],
      por_status: (rStatus.rows || []).map((r) => ({
        status: r.status_grupo === 'concluida' ? 'Concluídas' : 'Em andamento',
        total: r.total,
      })),
      evolucao_semanal: evolucaoTipo === 'semana'
        ? (rEvolucao.rows || []).map((r) => ({
          semana: `Sem ${r.semana}`,
          total: r.total,
        }))
        : [],
      evolucao_mensal: evolucaoTipo === 'mes'
        ? (rEvolucao.rows || []).map((r) => {
          const [y, m] = String(r.mes_key || '').split('-');
          const mi = parseInt(m, 10);
          return {
            mes: r.mes_key,
            label: mi >= 1 && mi <= 12 ? `${nomesMes[mi - 1]}/${y}` : r.mes_key,
            total: r.total,
          };
        })
        : [],
      pareto,
      financeiro: financeiroRows,
      top_pecas_custo: topPecasCusto,
      analise_lote: {
        por_mes_entrega: lotePorMes,
        por_mes_modelo: lotePorMesModelo,
        por_mes_modelo_tag: lotePorMesModeloTag,
        por_modelo_janela_3m: loteModelosJanela,
        producao_por_mes_modelo: producaoPorMesModelo,
        ppm_por_mes_modelo: ppmPorMesModelo,
        alteracoes_por_mes_modelo: alteracoesPorMesModelo,
        janela_3m: {
          inicio: janelaLoteInicioLabel,
          fim: janelaLoteFimLabel,
          meses: janelaLoteMeses,
          total_maquinas: rLoteTotalJanela.rows[0]?.total || 0,
        },
        defeitos_janela_3m: loteTagsJanela.map((r) => ({
          tag: r.tag,
          total: r.total,
          pct: loteTagTotal ? Math.round((r.total / loteTagTotal) * 1000) / 10 : 0,
        })),
        tag_por_modelo_janela: rLoteTagModeloJanela.rows || [],
      },
      textos,
    });
  } catch (err) {
    console.error('[SAC/AT] erro relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/relatorio-gerencial/lote-detalhe — O.S. + máquina ao clicar no gráfico de lote
router.get('/at/relatorio-gerencial/lote-detalhe', async (req, res) => {
  try {
    await ensureSchema();
    const modoRaw = String(req.query.modo || 'mes').trim().toLowerCase();
    const tipoParam = req.query.tipo;
    const tipoFiltro = tipoParam === undefined || tipoParam === null
      ? 'Qualidade'
      : String(tipoParam).trim();
    const mesProducao = String(req.query.mes_producao || '').trim();
    const mesesProducaoRaw = String(req.query.meses_producao || '').trim();
    const mesesProducaoLista = mesesProducaoRaw
      ? [...new Set(mesesProducaoRaw.split(',').map((s) => s.trim()).filter(Boolean))]
      : [];
    const modeloFiltro = String(req.query.modelo || '').trim();
    const tagFiltro = String(req.query.tag || '').trim();

    if (mesProducao && mesProducao !== '__sem_dt__' && !/^\d{4}-\d{2}$/.test(mesProducao)) {
      return res.status(400).json({ ok: false, error: 'Parâmetro mes_producao inválido (use YYYY-MM ou __sem_dt__).' });
    }
    if (mesesProducaoLista.some((m) => m !== '__sem_dt__' && !/^\d{4}-\d{2}$/.test(m))) {
      return res.status(400).json({ ok: false, error: 'Parâmetro meses_producao inválido (use YYYY-MM separados por vírgula).' });
    }
    if (!mesProducao && !mesesProducaoLista.length && !tagFiltro && !modeloFiltro) {
      return res.status(400).json({ ok: false, error: 'Informe mes_producao, meses_producao, tag ou modelo para filtrar.' });
    }

    const tipoSql = buildAtRelatorioGerencialTipoFilter(tipoFiltro);
    const periodoCfg = calcAtRelatorioGerencialPeriodo(modoRaw);
    const params = [periodoCfg.inicio, periodoCfg.fimExclusive];
    const filtros = [];

    if (mesesProducaoLista.length) {
      const comDt = mesesProducaoLista.filter((m) => m !== '__sem_dt__');
      const partes = [];
      if (comDt.length) {
        params.push(comDt);
        partes.push(`to_char(lb.data_producao_dt, 'YYYY-MM') = ANY($${params.length}::text[])`);
      }
      if (mesesProducaoLista.includes('__sem_dt__')) {
        partes.push('lb.data_producao_dt IS NULL');
      }
      if (partes.length) filtros.push(`(${partes.join(' OR ')})`);
    } else if (mesProducao === '__sem_dt__') {
      filtros.push('lb.data_producao_dt IS NULL');
    } else if (mesProducao) {
      params.push(mesProducao);
      filtros.push(`to_char(lb.data_producao_dt, 'YYYY-MM') = $${params.length}`);
    }
    if (modeloFiltro) {
      params.push(modeloFiltro);
      filtros.push(`lb.modelo = $${params.length}`);
    }
    if (tagFiltro) {
      params.push(tagFiltro);
      filtros.push(`lb.tag = $${params.length}`);
    }

    const { rows } = await pool.query(`
      WITH lote_base AS (
        SELECT DISTINCT ON (a.id)
          a.id,
          a.data AS data_os,
          COALESCE(NULLIF(TRIM(a.estado), ''), 'N/D') AS estado,
          COALESCE(NULLIF(TRIM(a.cidade), ''), '') AS cidade,
          COALESCE(NULLIF(TRIM(a.status), ''), '') AS status_os,
          COALESCE(NULLIF(TRIM(a.tag_problema), ''), '(sem tag)') AS tag,
          COALESCE(NULLIF(TRIM(a.descreva_reclamacao), ''), '') AS reclamacao,
          COALESCE(NULLIF(TRIM(a.nome_revenda_cliente), ''), '') AS revenda_cliente,
          ${sqlFamiliaModeloAt("COALESCE(s.modelo, a.modelo, '')")} AS modelo,
          TRIM(COALESCE(s.modelo, a.modelo, '')) AS modelo_completo,
          TRIM(regexp_replace(TRIM(COALESCE(s.pedido, '')), '^.* /\\s*', '')) AS pedido,
          TRIM(COALESCE(s.ordem_producao, '')) AS ordem_producao,
          TRIM(COALESCE(s.cliente, '')) AS cliente,
          TRIM(COALESCE(s.nota_fiscal, '')) AS nota_fiscal,
          TRIM(COALESCE(s.data_entrega, '')) AS data_entrega,
          CASE
            WHEN po.codigo_familia = '10457646996'
              AND TRIM(COALESCE(s.ordem_producao, '')) ~ '^[A-Za-z0-9]{4}[0-9]{6}'
              AND SUBSTRING(TRIM(s.ordem_producao) FROM 7 FOR 2) BETWEEN '01' AND '12'
              AND SUBSTRING(TRIM(s.ordem_producao) FROM 9 FOR 2) BETWEEN '01' AND '31'
            THEN to_date(
              '20' || SUBSTRING(TRIM(s.ordem_producao) FROM 5 FOR 6),
              'YYYYMMDD'
            )
            WHEN h.data_integracao IS NOT NULL
              AND TRIM(h.data_integracao) <> ''
              AND TRIM(h.data_integracao) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN SUBSTRING(TRIM(h.data_integracao) FROM 1 FOR 10)::date
            WHEN hop.data_integracao IS NOT NULL
              AND TRIM(hop.data_integracao) <> ''
              AND TRIM(hop.data_integracao) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN SUBSTRING(TRIM(hop.data_integracao) FROM 1 FOR 10)::date
            ELSE NULL
          END AS data_producao_dt
        FROM sac.at a
        INNER JOIN sac.at_busca_selecionada s ON s.id_at = a.id
        LEFT JOIN LATERAL (
          SELECT po0.codigo_familia::text AS codigo_familia
          FROM public.produtos_omie po0
          WHERE UPPER(REPLACE(TRIM(po0.codigo), '-', ''))
              = UPPER(REPLACE(TRIM(COALESCE(s.modelo, a.modelo, '')), '-', ''))
          LIMIT 1
        ) po ON TRUE
        LEFT JOIN LATERAL (
          SELECT h0.data_integracao
          FROM public.historico_pedido_originalis h0
          WHERE TRIM(h0.pedido) = TRIM(regexp_replace(TRIM(COALESCE(s.pedido, '')), '^.* /\\s*', ''))
            AND h0.data_integracao IS NOT NULL
            AND TRIM(h0.data_integracao) <> ''
          ORDER BY h0.data_integracao ASC
          LIMIT 1
        ) h ON TRUE
        LEFT JOIN LATERAL (
          SELECT h0.data_integracao
          FROM public.historico_pedido_originalis h0
          WHERE TRIM(COALESCE(s.ordem_producao, '')) <> ''
            AND (
              TRIM(h0.ordem_de_producao) = TRIM(s.ordem_producao)
              OR TRIM(h0.nota_fiscal) = TRIM(s.ordem_producao)
            )
            AND h0.data_integracao IS NOT NULL
            AND TRIM(h0.data_integracao) <> ''
          ORDER BY
            CASE WHEN TRIM(h0.ordem_de_producao) = TRIM(s.ordem_producao) THEN 0 ELSE 1 END,
            h0.data_integracao ASC
          LIMIT 1
        ) hop ON TRUE
        WHERE a.data >= $1::date
          AND a.data < $2::date${tipoSql}
        ORDER BY a.id, s.id DESC
      )
      SELECT
        lb.id,
        lb.data_os,
        lb.estado,
        lb.cidade,
        lb.status_os,
        lb.tag,
        lb.reclamacao,
        lb.revenda_cliente,
        lb.modelo,
        lb.modelo_completo,
        lb.pedido,
        lb.ordem_producao,
        lb.cliente,
        lb.nota_fiscal,
        lb.data_entrega,
        lb.data_producao_dt AS data_producao
      FROM lote_base lb
      ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
      ORDER BY lb.data_producao_dt ASC NULLS LAST, lb.data_os ASC, lb.id ASC
    `, params);

    return res.json({
      ok: true,
      periodo: periodoCfg.label,
      filtros: {
        mes_producao: mesProducao || null,
        meses_producao: mesesProducaoLista.length ? mesesProducaoLista : null,
        modelo: modeloFiltro || null,
        tag: tagFiltro || null,
        tipo: tipoFiltro || 'Todos',
      },
      total: rows.length,
      rows,
    });
  } catch (err) {
    console.error('[SAC/AT] erro relatorio-gerencial lote-detalhe:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /at/relatorio-gerencial/textos — salva plano de ação e conclusão executiva do mês
router.put('/at/relatorio-gerencial/textos', async (req, res) => {
  try {
    await ensureSchema();
    const mesRaw = String(req.body?.mes || '').trim();
    if (!/^\d{4}-\d{2}$/.test(mesRaw)) {
      return res.status(400).json({ ok: false, error: 'Parâmetro mes inválido (use YYYY-MM).' });
    }

    const planoRaw = req.body?.plano_acao;
    if (!Array.isArray(planoRaw)) {
      return res.status(400).json({ ok: false, error: 'plano_acao deve ser uma lista.' });
    }

    const prioridadesValidas = new Set(['alta', 'media', 'baixa']);
    const plano_acao = planoRaw.map((item) => {
      const prioridade = String(item?.prioridade || 'media').toLowerCase().trim();
      return {
        acao: String(item?.acao || '').trim().slice(0, 200),
        descricao: String(item?.descricao || '').trim().slice(0, 500),
        responsavel: String(item?.responsavel || '').trim().slice(0, 120),
        prazo: String(item?.prazo || '').trim().slice(0, 40),
        prioridade: prioridadesValidas.has(prioridade) ? prioridade : 'media',
      };
    }).filter((item) => item.acao || item.descricao || item.responsavel || item.prazo);

    const conclusao_resumo = String(req.body?.conclusao_resumo || '').trim().slice(0, 4000);
    const conclusao_pontos_criticos = String(req.body?.conclusao_pontos_criticos || '').trim().slice(0, 4000);
    const conclusao_oportunidades = String(req.body?.conclusao_oportunidades || '').trim().slice(0, 4000);

    const usuarioLogado = req.session?.user?.fullName
      || req.session?.user?.username
      || req.session?.user?.login
      || 'sistema';

    const { rows } = await pool.query(
      `INSERT INTO sac.at_relatorio_gerencial (
         mes, plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades, editado_por, editado_em
       ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, NOW())
       ON CONFLICT (mes) DO UPDATE SET
         plano_acao = EXCLUDED.plano_acao,
         conclusao_resumo = EXCLUDED.conclusao_resumo,
         conclusao_pontos_criticos = EXCLUDED.conclusao_pontos_criticos,
         conclusao_oportunidades = EXCLUDED.conclusao_oportunidades,
         editado_por = EXCLUDED.editado_por,
         editado_em = NOW()
       RETURNING mes, plano_acao, conclusao_resumo, conclusao_pontos_criticos, conclusao_oportunidades, editado_por, editado_em`,
      [
        mesRaw,
        JSON.stringify(plano_acao),
        conclusao_resumo || null,
        conclusao_pontos_criticos || null,
        conclusao_oportunidades || null,
        usuarioLogado,
      ]
    );

    const row = rows[0];
    return res.json({
      ok: true,
      textos: {
        plano_acao: row.plano_acao || [],
        conclusao_resumo: row.conclusao_resumo || '',
        conclusao_pontos_criticos: row.conclusao_pontos_criticos || '',
        conclusao_oportunidades: row.conclusao_oportunidades || '',
        editado_por: row.editado_por,
        editado_em: row.editado_em,
        salvo: true,
      },
    });
  } catch (err) {
    console.error('[SAC/AT] erro salvar textos relatorio-gerencial:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/graficos/por-estado-mes — quantidade de atendimentos por estado agrupado por mês/ano
router.get('/at/graficos/por-estado-mes', async (req, res) => {  try {
    const tipo = String(req.query.tipo || '').trim();
    const params = [];
    const whereExtra = tipo ? ` AND LOWER(tipo) = LOWER($1)` : '';
    if (tipo) params.push(tipo);

    const { rows } = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(estado), ''), 'N/D')      AS estado,
        TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM')  AS mes,
        COUNT(*)::int                                   AS total
      FROM sac.at
      WHERE data IS NOT NULL${whereExtra}
      GROUP BY 1, 2
      ORDER BY 2, 1
    `, params);
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[SAC/AT] erro graficos por-estado-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/graficos/por-modelo-mes — quantidade de atendimentos por modelo agrupado por mês/ano
router.get('/at/graficos/por-modelo-mes', async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').trim();
    const params = [];
    const whereExtra = tipo ? ` AND LOWER(tipo) = LOWER($1)` : '';
    if (tipo) params.push(tipo);

    const { rows } = await pool.query(`
      SELECT
        ${sqlFamiliaModeloAt('s.modelo')}                                                  AS modelo,
        TO_CHAR(DATE_TRUNC('month', a.data), 'YYYY-MM')    AS mes,
        COUNT(*)::int                                      AS total
      FROM sac.at a
      LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
      WHERE a.data IS NOT NULL${whereExtra}
      GROUP BY 1, 2
      ORDER BY 2, 1
    `, params);

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[SAC/AT] erro graficos por-modelo-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/graficos/por-tag-problema-mes — quantidade de atendimentos por tag_problema agrupada por mês/ano
router.get('/at/graficos/por-tag-problema-mes', async (req, res) => {
  try {
    const tipo = String(req.query.tipo || '').trim();
    const params = [];
    const whereExtra = tipo ? ` AND LOWER(TRIM(tipo)) = LOWER($1)` : `\n        AND LOWER(TRIM(COALESCE(tipo, ''))) != 'atendimento rápido'`;
    if (tipo) params.push(tipo);

    const { rows } = await pool.query(`
      SELECT
        COALESCE(NULLIF(TRIM(tag_problema), ''), '(sem tag)') AS tag_problema,
        TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM')         AS mes,
        COUNT(*)::int                                         AS total
      FROM sac.at
      WHERE data IS NOT NULL${whereExtra}
      GROUP BY 1, 2
      ORDER BY 2, 1
    `, params);

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[SAC/AT] erro graficos por-tag-problema-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/graficos/valor-estado-mes — soma do valor_total_pedido por estado agrupada por mês/ano (ignora CFOP 6905)
router.get('/vendas/graficos/valor-estado-mes', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH ${VENDAS_NF_POR_PEDIDO_CTE},
      pedidos_cfop_ignorado AS (
        SELECT DISTINCT codigo_pedido
        FROM "Vendas".pedidos_venda_itens
        WHERE REGEXP_REPLACE(TRIM(COALESCE(cfop, '')), '\\D', '', 'g') = '6905'
      )
      SELECT
        COALESCE(NULLIF(TRIM(f.estado), ''), 'N/D')                        AS estado,
        TO_CHAR(DATE_TRUNC('month', nf.data_emissao_dt), 'YYYY-MM')        AS mes,
        SUM(COALESCE(p.valor_total_pedido, 0))::numeric(14,2)              AS valor_total,
        COALESCE(NULLIF(TRIM(p.etapa::text), ''), 'N/D')                   AS etapa,
        CASE COALESCE(NULLIF(TRIM(p.etapa::text), ''), 'N/D')
          WHEN '50' THEN 'Em processamento'
          WHEN '60' THEN 'Em separação'
          WHEN '70' THEN 'Faturado/Entregue'
          WHEN '80' THEN 'Concluído'
          ELSE 'Etapa ' || COALESCE(NULLIF(TRIM(p.etapa::text), ''), 'N/D')
        END                                                                 AS etapa_descricao
      FROM "Vendas".pedidos_venda p
      JOIN nf_por_pedido nf
        ON ${vendasNfJoinPedidoSql('nf', 'p')}
      LEFT JOIN omie.fornecedores f
        ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
      WHERE TRIM(COALESCE(p.etapa::text, '')) = '70'
        AND nf.data_emissao_dt IS NOT NULL
        AND p.codigo_pedido NOT IN (SELECT codigo_pedido FROM pedidos_cfop_ignorado)
      GROUP BY 1, 2, 4, 5
      ORDER BY 2, 1
    `);

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[VENDAS] erro graficos valor-estado-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/graficos/mapa-brasil — mapa por estado (valor_total_pedido), com cliente destaque por UF
router.get('/vendas/graficos/mapa-brasil', async (req, res) => {
  try {
    const periodo = Number.parseInt(String(req.query?.periodo ?? '3'), 10);
    const periodoMeses = Number.isFinite(periodo) ? Math.max(0, periodo) : 3;
    const etapaFiltro = String(req.query?.etapa ?? '').trim();
    const timeline = ['1', 'true', 'yes', 'on'].includes(String(req.query?.timeline ?? '').trim().toLowerCase());

    const params = [periodoMeses, etapaFiltro];
    const { rows } = await pool.query(`
      WITH base AS (
        SELECT
          COALESCE(NULLIF(TRIM(f.estado), ''), 'N/D') AS estado_raw,
          COALESCE(
            NULLIF(TRIM(f.nome_fantasia), ''),
            NULLIF(TRIM(f.razao_social), ''),
            'Cliente não identificado'
          ) AS cliente_nome,
          CASE TRIM(COALESCE(p.etapa::text, ''))
            WHEN '00' THEN 'Proposta'
            WHEN '10' THEN 'PDV (Em Aprovação)'
            WHEN '20' THEN 'Entrega Futura'
            WHEN '50' THEN 'Faturar'
            WHEN '60' THEN 'Faturado'
            WHEN '70' THEN 'Entregue'
            WHEN '80' THEN 'Aprovado'
            ELSE 'Sem descrição'
          END AS etapa_descricao,
          COALESCE(p.valor_total_pedido, 0)::numeric(14,2) AS valor_total,
          p.updated_at AS created_at
        FROM "Vendas".pedidos_venda p
        LEFT JOIN omie.fornecedores f
          ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
        WHERE p.updated_at IS NOT NULL
          AND TRIM(COALESCE(p.codigo_pedido::text, '')) NOT IN (
            SELECT DISTINCT TRIM(COALESCE(i.codigo_pedido::text, ''))
            FROM "Vendas".pedidos_venda_itens i
            WHERE REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') = '6905'
          )
      ),
      filtrada AS (
        SELECT
          CASE
            WHEN UPPER(TRIM(estado_raw)) IN ('RO', 'RONDONIA', 'RONDÔNIA') THEN 'RO'
            WHEN UPPER(TRIM(estado_raw)) IN ('AC', 'ACRE') THEN 'AC'
            WHEN UPPER(TRIM(estado_raw)) IN ('AM', 'AMAZONAS') THEN 'AM'
            WHEN UPPER(TRIM(estado_raw)) IN ('RR', 'RORAIMA') THEN 'RR'
            WHEN UPPER(TRIM(estado_raw)) IN ('PA', 'PARA', 'PARÁ') THEN 'PA'
            WHEN UPPER(TRIM(estado_raw)) IN ('AP', 'AMAPA', 'AMAPÁ') THEN 'AP'
            WHEN UPPER(TRIM(estado_raw)) IN ('TO', 'TOCANTINS') THEN 'TO'
            WHEN UPPER(TRIM(estado_raw)) IN ('MA', 'MARANHAO', 'MARANHÃO') THEN 'MA'
            WHEN UPPER(TRIM(estado_raw)) IN ('PI', 'PIAUI', 'PIAUÍ') THEN 'PI'
            WHEN UPPER(TRIM(estado_raw)) IN ('CE', 'CEARA', 'CEARÁ') THEN 'CE'
            WHEN UPPER(TRIM(estado_raw)) IN ('RN', 'RIO GRANDE DO NORTE') THEN 'RN'
            WHEN UPPER(TRIM(estado_raw)) IN ('PB', 'PARAIBA', 'PARAÍBA') THEN 'PB'
            WHEN UPPER(TRIM(estado_raw)) IN ('PE', 'PERNAMBUCO') THEN 'PE'
            WHEN UPPER(TRIM(estado_raw)) IN ('AL', 'ALAGOAS') THEN 'AL'
            WHEN UPPER(TRIM(estado_raw)) IN ('SE', 'SERGIPE') THEN 'SE'
            WHEN UPPER(TRIM(estado_raw)) IN ('BA', 'BAHIA') THEN 'BA'
            WHEN UPPER(TRIM(estado_raw)) IN ('MG', 'MINAS GERAIS') THEN 'MG'
            WHEN UPPER(TRIM(estado_raw)) IN ('ES', 'ESPIRITO SANTO', 'ESPÍRITO SANTO') THEN 'ES'
            WHEN UPPER(TRIM(estado_raw)) IN ('RJ', 'RIO DE JANEIRO') THEN 'RJ'
            WHEN UPPER(TRIM(estado_raw)) IN ('SP', 'SAO PAULO', 'SÃO PAULO') THEN 'SP'
            WHEN UPPER(TRIM(estado_raw)) IN ('PR', 'PARANA', 'PARANÁ') THEN 'PR'
            WHEN UPPER(TRIM(estado_raw)) IN ('SC', 'SANTA CATARINA') THEN 'SC'
            WHEN UPPER(TRIM(estado_raw)) IN ('RS', 'RIO GRANDE DO SUL') THEN 'RS'
            WHEN UPPER(TRIM(estado_raw)) IN ('MS', 'MATO GROSSO DO SUL') THEN 'MS'
            WHEN UPPER(TRIM(estado_raw)) IN ('MT', 'MATO GROSSO') THEN 'MT'
            WHEN UPPER(TRIM(estado_raw)) IN ('GO', 'GOIAS', 'GOIÁS') THEN 'GO'
            WHEN UPPER(TRIM(estado_raw)) IN ('DF', 'DISTRITO FEDERAL') THEN 'DF'
            ELSE 'N/D'
          END AS uf,
          cliente_nome,
          etapa_descricao,
          valor_total,
          created_at
        FROM base
        WHERE etapa_descricao IN ('PDV (Em Aprovação)', 'Entrega Futura', 'Faturar', 'Faturado', 'Entregue', 'Aprovado')
          AND ($1::int <= 0 OR (created_at >= (DATE_TRUNC('month', CURRENT_DATE) - make_interval(months => $1::int)) AND created_at < DATE_TRUNC('month', CURRENT_DATE)))
          AND ($2::text = '' OR etapa_descricao = $2::text)
      ),
      agregado_uf AS (
        SELECT uf, SUM(valor_total)::numeric(14,2) AS valor_total
        FROM filtrada
        WHERE uf <> 'N/D'
        GROUP BY uf
      ),
      cliente_uf AS (
        SELECT
          uf,
          cliente_nome,
          SUM(valor_total)::numeric(14,2) AS valor_total,
          ROW_NUMBER() OVER (PARTITION BY uf ORDER BY SUM(valor_total) DESC, cliente_nome) AS rn
        FROM filtrada
        WHERE uf <> 'N/D'
        GROUP BY uf, cliente_nome
      )
      SELECT
        a.uf,
        a.valor_total,
        c.cliente_nome AS cliente_destaque,
        c.valor_total AS cliente_valor
      FROM agregado_uf a
      LEFT JOIN cliente_uf c
        ON c.uf = a.uf AND c.rn = 1
      ORDER BY a.valor_total DESC, a.uf
    `, params);

    let timelineRows = [];
    if (timeline) {
      const { rows: tRows } = await pool.query(`
        WITH base AS (
          SELECT
            COALESCE(NULLIF(TRIM(f.estado), ''), 'N/D') AS estado_raw,
            COALESCE(
              NULLIF(TRIM(f.nome_fantasia), ''),
              NULLIF(TRIM(f.razao_social), ''),
              'Cliente não identificado'
            ) AS cliente_nome,
            CASE TRIM(COALESCE(p.etapa::text, ''))
              WHEN '00' THEN 'Proposta'
              WHEN '10' THEN 'PDV (Em Aprovação)'
              WHEN '20' THEN 'Entrega Futura'
              WHEN '50' THEN 'Faturar'
              WHEN '60' THEN 'Faturado'
              WHEN '70' THEN 'Entregue'
              WHEN '80' THEN 'Aprovado'
              ELSE 'Sem descrição'
            END AS etapa_descricao,
            COALESCE(p.valor_total_pedido, 0)::numeric(14,2) AS valor_total,
            p.updated_at AS created_at
          FROM "Vendas".pedidos_venda p
          LEFT JOIN omie.fornecedores f
            ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
          WHERE p.updated_at IS NOT NULL
            AND TRIM(COALESCE(p.codigo_pedido::text, '')) NOT IN (
              SELECT DISTINCT TRIM(COALESCE(i.codigo_pedido::text, ''))
              FROM "Vendas".pedidos_venda_itens i
              WHERE REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') = '6905'
            )
        ),
        filtrada AS (
          SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS mes,
            CASE
              WHEN UPPER(TRIM(estado_raw)) IN ('RO', 'RONDONIA', 'RONDÔNIA') THEN 'RO'
              WHEN UPPER(TRIM(estado_raw)) IN ('AC', 'ACRE') THEN 'AC'
              WHEN UPPER(TRIM(estado_raw)) IN ('AM', 'AMAZONAS') THEN 'AM'
              WHEN UPPER(TRIM(estado_raw)) IN ('RR', 'RORAIMA') THEN 'RR'
              WHEN UPPER(TRIM(estado_raw)) IN ('PA', 'PARA', 'PARÁ') THEN 'PA'
              WHEN UPPER(TRIM(estado_raw)) IN ('AP', 'AMAPA', 'AMAPÁ') THEN 'AP'
              WHEN UPPER(TRIM(estado_raw)) IN ('TO', 'TOCANTINS') THEN 'TO'
              WHEN UPPER(TRIM(estado_raw)) IN ('MA', 'MARANHAO', 'MARANHÃO') THEN 'MA'
              WHEN UPPER(TRIM(estado_raw)) IN ('PI', 'PIAUI', 'PIAUÍ') THEN 'PI'
              WHEN UPPER(TRIM(estado_raw)) IN ('CE', 'CEARA', 'CEARÁ') THEN 'CE'
              WHEN UPPER(TRIM(estado_raw)) IN ('RN', 'RIO GRANDE DO NORTE') THEN 'RN'
              WHEN UPPER(TRIM(estado_raw)) IN ('PB', 'PARAIBA', 'PARAÍBA') THEN 'PB'
              WHEN UPPER(TRIM(estado_raw)) IN ('PE', 'PERNAMBUCO') THEN 'PE'
              WHEN UPPER(TRIM(estado_raw)) IN ('AL', 'ALAGOAS') THEN 'AL'
              WHEN UPPER(TRIM(estado_raw)) IN ('SE', 'SERGIPE') THEN 'SE'
              WHEN UPPER(TRIM(estado_raw)) IN ('BA', 'BAHIA') THEN 'BA'
              WHEN UPPER(TRIM(estado_raw)) IN ('MG', 'MINAS GERAIS') THEN 'MG'
              WHEN UPPER(TRIM(estado_raw)) IN ('ES', 'ESPIRITO SANTO', 'ESPÍRITO SANTO') THEN 'ES'
              WHEN UPPER(TRIM(estado_raw)) IN ('RJ', 'RIO DE JANEIRO') THEN 'RJ'
              WHEN UPPER(TRIM(estado_raw)) IN ('SP', 'SAO PAULO', 'SÃO PAULO') THEN 'SP'
              WHEN UPPER(TRIM(estado_raw)) IN ('PR', 'PARANA', 'PARANÁ') THEN 'PR'
              WHEN UPPER(TRIM(estado_raw)) IN ('SC', 'SANTA CATARINA') THEN 'SC'
              WHEN UPPER(TRIM(estado_raw)) IN ('RS', 'RIO GRANDE DO SUL') THEN 'RS'
              WHEN UPPER(TRIM(estado_raw)) IN ('MS', 'MATO GROSSO DO SUL') THEN 'MS'
              WHEN UPPER(TRIM(estado_raw)) IN ('MT', 'MATO GROSSO') THEN 'MT'
              WHEN UPPER(TRIM(estado_raw)) IN ('GO', 'GOIAS', 'GOIÁS') THEN 'GO'
              WHEN UPPER(TRIM(estado_raw)) IN ('DF', 'DISTRITO FEDERAL') THEN 'DF'
              ELSE 'N/D'
            END AS uf,
            cliente_nome,
            etapa_descricao,
            valor_total,
            created_at
          FROM base
          WHERE etapa_descricao IN ('PDV (Em Aprovação)', 'Entrega Futura', 'Faturar', 'Faturado', 'Entregue', 'Aprovado')
            AND ($1::int <= 0 OR (created_at >= (DATE_TRUNC('month', CURRENT_DATE) - make_interval(months => $1::int)) AND created_at < DATE_TRUNC('month', CURRENT_DATE)))
            AND ($2::text = '' OR etapa_descricao = $2::text)
        )
        SELECT
          mes,
          uf,
          cliente_nome,
          SUM(valor_total)::numeric(14,2) AS valor_total
        FROM filtrada
        WHERE uf <> 'N/D'
        GROUP BY mes, uf, cliente_nome
        ORDER BY mes ASC, uf ASC, valor_total DESC
      `, params);
      timelineRows = tRows;
    }

    return res.json({ ok: true, rows, timeline_rows: timelineRows, periodo_meses: periodoMeses, etapa: etapaFiltro || null });
  } catch (err) {
    console.error('[VENDAS] erro mapa-brasil:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/graficos/quantidade-familia-mes — quantidade de itens por família e mês (ignora CFOP 6905)
router.get('/vendas/graficos/quantidade-familia-mes', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH ${VENDAS_NF_POR_PEDIDO_CTE},
      itens_validos AS (
        SELECT
          i.codigo_pedido,
          COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') AS familia,
          i.quantidade
        FROM "Vendas".pedidos_venda_itens i
        LEFT JOIN public.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
        WHERE REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') <> '6905'
      )
      SELECT
        iv.familia,
        TO_CHAR(DATE_TRUNC('month', nf.data_emissao_dt), 'YYYY-MM') AS mes,
        SUM(iv.quantidade)::numeric(14,2)                            AS quantidade_total
      FROM itens_validos iv
      JOIN "Vendas".pedidos_venda p ON p.codigo_pedido = iv.codigo_pedido
      JOIN nf_por_pedido nf
        ON ${vendasNfJoinPedidoSql('nf', 'p')}
      WHERE TRIM(COALESCE(p.etapa::text, '')) = '70'
        AND nf.data_emissao_dt IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 2, 1
    `);

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[VENDAS] erro graficos quantidade-familia-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/graficos/quantidade-familia-mes/detalhe — itens de uma família e mês específicos (ignora CFOP 6905)
router.get('/vendas/graficos/quantidade-familia-mes/detalhe', async (req, res) => {
  const familia = String(req.query.familia || '').trim();
  const mes = String(req.query.mes || '').trim();
  if (!familia || !mes) return res.status(400).json({ ok: false, error: 'familia e mes são obrigatórios.' });
  try {
    const { rows } = await pool.query(`
      WITH ${VENDAS_NF_POR_PEDIDO_CTE}
      SELECT
        p.numero_pedido,
        i.codigo    AS codigo_item,
        i.descricao AS descricao_item,
        i.cfop,
        i.quantidade
      FROM "Vendas".pedidos_venda_itens i
      JOIN "Vendas".pedidos_venda p ON p.codigo_pedido = i.codigo_pedido
      JOIN nf_por_pedido nf
        ON ${vendasNfJoinPedidoSql('nf', 'p')}
      LEFT JOIN public.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
      WHERE COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') = $1
        AND TO_CHAR(DATE_TRUNC('month', nf.data_emissao_dt), 'YYYY-MM') = $2
        AND TRIM(COALESCE(p.etapa::text, '')) = '70'
        AND nf.data_emissao_dt IS NOT NULL
        AND REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') <> '6905'
      ORDER BY i.quantidade DESC NULLS LAST
      LIMIT 200
    `, [familia, mes]);

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[VENDAS] erro graficos quantidade-familia-mes/detalhe:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/graficos/valor-familia-mes — valor total de itens por família e mês (ignora CFOP 6905)
router.get('/vendas/graficos/valor-familia-mes', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH ${VENDAS_NF_POR_PEDIDO_CTE},
      itens_validos AS (
        SELECT
          i.codigo_pedido,
          COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') AS familia,
          i.valor_total AS valor_total_item
        FROM "Vendas".pedidos_venda_itens i
        LEFT JOIN public.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
        WHERE REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') <> '6905'
      )
      SELECT
        iv.familia,
        TO_CHAR(DATE_TRUNC('month', nf.data_emissao_dt), 'YYYY-MM') AS mes,
        SUM(iv.valor_total_item)::numeric(14,2)                      AS valor_total
      FROM itens_validos iv
      JOIN "Vendas".pedidos_venda p ON p.codigo_pedido = iv.codigo_pedido
      JOIN nf_por_pedido nf
        ON ${vendasNfJoinPedidoSql('nf', 'p')}
      WHERE TRIM(COALESCE(p.etapa::text, '')) = '70'
        AND nf.data_emissao_dt IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 2, 1
    `);

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[VENDAS] erro graficos valor-familia-mes:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/graficos/valor-familia-mes/detalhe — itens de uma família e mês específicos (ignora CFOP 6905)
router.get('/vendas/graficos/valor-familia-mes/detalhe', async (req, res) => {
  const familia = String(req.query.familia || '').trim();
  const mes = String(req.query.mes || '').trim();
  if (!familia || !mes) return res.status(400).json({ ok: false, error: 'familia e mes são obrigatórios.' });
  try {
    const { rows } = await pool.query(`
      WITH ${VENDAS_NF_POR_PEDIDO_CTE}
      SELECT
        p.numero_pedido,
        i.codigo      AS codigo_item,
        i.descricao   AS descricao_item,
        i.cfop,
        i.valor_total AS valor_total_item
      FROM "Vendas".pedidos_venda_itens i
      JOIN "Vendas".pedidos_venda p ON p.codigo_pedido = i.codigo_pedido
      JOIN nf_por_pedido nf
        ON ${vendasNfJoinPedidoSql('nf', 'p')}
      LEFT JOIN public.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
      WHERE COALESCE(NULLIF(TRIM(po.descricao_familia), ''), '(sem família)') = $1
        AND TO_CHAR(DATE_TRUNC('month', nf.data_emissao_dt), 'YYYY-MM') = $2
        AND TRIM(COALESCE(p.etapa::text, '')) = '70'
        AND nf.data_emissao_dt IS NOT NULL
        AND REGEXP_REPLACE(TRIM(COALESCE(i.cfop, '')), '\\D', '', 'g') <> '6905'
      ORDER BY i.valor_total DESC NULLS LAST
      LIMIT 200
    `, [familia, mes]);

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[VENDAS] erro graficos valor-familia-mes/detalhe:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/controle/pedidos — lista pedidos de venda com dados básicos
router.get('/vendas/controle/pedidos', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.codigo_pedido,
        p.numero_pedido,
        COALESCE(NULLIF(TRIM(f.nome_fantasia), ''), NULLIF(TRIM(f.razao_social), ''), 'N/D') AS cliente_nome,
        COALESCE(NULLIF(TRIM(p.etapa::text), ''), 'Sem etapa') AS etapa,
        CASE COALESCE(NULLIF(TRIM(p.etapa::text), ''), '')
          WHEN '00' THEN 'Aberto'
          WHEN '10' THEN 'Em análise'
          WHEN '20' THEN 'Aprovado'
          WHEN '50' THEN 'Em processamento'
          WHEN '60' THEN 'Em separação'
          WHEN '70' THEN 'Faturado/Entregue'
          WHEN '80' THEN 'Concluído'
          ELSE 'Etapa ' || COALESCE(NULLIF(TRIM(p.etapa::text), ''), '?')
        END AS etapa_descricao,
        p.updated_at AS created_at,
        p.data_previsao,
        COALESCE(p.numero_pedido_cliente, '') AS origem_pedido,
        COALESCE(p.valor_total_pedido, 0)::numeric(14,2) AS valor_total_pedido
      FROM "Vendas".pedidos_venda p
      LEFT JOIN omie.fornecedores f
        ON TRIM(COALESCE(f.codigo_cliente_omie::text, '')) = TRIM(COALESCE(p.codigo_cliente::text, ''))
      ORDER BY p.numero_pedido DESC NULLS LAST
      LIMIT 500
    `);
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[VENDAS] erro controle/pedidos:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /vendas/controle/pedido-itens/:codigoPedido — itens de um pedido específico
router.get('/vendas/controle/pedido-itens/:codigoPedido', async (req, res) => {
  const codigoPedido = String(req.params.codigoPedido || '').trim();
  if (!codigoPedido) return res.status(400).json({ ok: false, error: 'codigoPedido é obrigatório.' });
  try {
    const { rows } = await pool.query(`
      SELECT
        i.codigo,
        COALESCE(po.descricao, i.descricao, '-') AS descricao,
        i.quantidade,
        COALESCE(i.valor_total, 0)::numeric(14,2) AS valor_total
      FROM "Vendas".pedidos_venda_itens i
      LEFT JOIN public.produtos_omie po ON TRIM(po.codigo) = TRIM(i.codigo)
      WHERE i.codigo_pedido = $1
      ORDER BY i.descricao NULLS LAST
    `, [codigoPedido]);
    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('[VENDAS] erro controle/pedido-itens:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// CRUD sac.alimentacao
router.get('/at/alimentacao', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sac.alimentacao ORDER BY letra_codigo');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/at/alimentacao', async (req, res) => {
  const { letra_codigo, degelo, alimentacao } = req.body || {};
  if (!letra_codigo || !alimentacao) return res.status(400).json({ error: 'letra_codigo e alimentacao são obrigatórios.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO sac.alimentacao (letra_codigo, degelo, alimentacao)
       VALUES (UPPER($1), $2, $3)
       ON CONFLICT (letra_codigo) DO UPDATE SET degelo=$2, alimentacao=$3
       RETURNING *`,
      [letra_codigo.trim(), degelo || null, alimentacao.trim()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/at/alimentacao/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });
  try {
    await pool.query('DELETE FROM sac.alimentacao WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Meus Atalhos (sac.sac_atalhos) — links por usuário no painel AT ─────────
function sacAtalhosUserId(req) {
  return Number(req.session?.user?.id) || 0;
}

function sacAtalhosValidarUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return { ok: false, error: 'URL é obrigatória.' };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, error: 'Use uma URL http ou https.' };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, error: 'URL inválida.' };
  }
}

router.get('/atalhos', async (req, res) => {
  const userId = sacAtalhosUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  try {
    await ensureSacAtalhosSchema();
    const { rows } = await pool.query(
      `SELECT id, label, url, icon_class, icon_color, sort_order, created_at
       FROM sac.sac_atalhos
       WHERE user_id = $1
       ORDER BY sort_order, created_at, id`,
      [userId]
    );
    res.json({ ok: true, atalhos: rows });
  } catch (err) {
    console.error('[SAC/atalhos] GET erro:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/atalhos', async (req, res) => {
  const userId = sacAtalhosUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  const label = String(req.body?.label || '').trim();
  const iconClass = String(req.body?.icon_class || 'fa-solid fa-link').trim() || 'fa-solid fa-link';
  const iconColor = String(req.body?.icon_color || '#38bdf8').trim() || '#38bdf8';
  const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0;
  if (!label) return res.status(400).json({ ok: false, error: 'Nome do atalho é obrigatório.' });
  const urlCheck = sacAtalhosValidarUrl(req.body?.url);
  if (!urlCheck.ok) return res.status(400).json({ ok: false, error: urlCheck.error });
  try {
    await ensureSacAtalhosSchema();
    const { rows } = await pool.query(
      `INSERT INTO sac.sac_atalhos (user_id, label, url, icon_class, icon_color, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, label, url, icon_class, icon_color, sort_order, created_at`,
      [userId, label, urlCheck.url, iconClass, iconColor, sortOrder]
    );
    res.json({ ok: true, atalho: rows[0] });
  } catch (err) {
    console.error('[SAC/atalhos] POST erro:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.put('/atalhos/:id', async (req, res) => {
  const userId = sacAtalhosUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  const label = String(req.body?.label || '').trim();
  const iconClass = String(req.body?.icon_class || 'fa-solid fa-link').trim() || 'fa-solid fa-link';
  const iconColor = String(req.body?.icon_color || '#38bdf8').trim() || '#38bdf8';
  const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0;
  if (!label) return res.status(400).json({ ok: false, error: 'Nome do atalho é obrigatório.' });
  const urlCheck = sacAtalhosValidarUrl(req.body?.url);
  if (!urlCheck.ok) return res.status(400).json({ ok: false, error: urlCheck.error });
  try {
    await ensureSacAtalhosSchema();
    const { rowCount } = await pool.query(
      `UPDATE sac.sac_atalhos
       SET label = $1, url = $2, icon_class = $3, icon_color = $4, sort_order = $5
       WHERE id = $6 AND user_id = $7`,
      [label, urlCheck.url, iconClass, iconColor, sortOrder, id, userId]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'Atalho não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/atalhos] PUT erro:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/atalhos/:id', async (req, res) => {
  const userId = sacAtalhosUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  try {
    await ensureSacAtalhosSchema();
    await pool.query('DELETE FROM sac.sac_atalhos WHERE id = $1 AND user_id = $2', [id, userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/atalhos] DELETE erro:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Material de apoio (R2: AT/material de apoio/) ───────────────────────────
const MAT_APOIO_BUCKET = 'AT';
const MAT_APOIO_PASTA = 'material de apoio';
const MAT_APOIO_FORMATOS = ['Video', 'foto', 'PDF'];
const MAT_APOIO_MAX_ANEXOS = 20;
const materialApoioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 },
});

function materialApoioSanitizeNome(raw) {
  return String(raw || '')
    .replace(/[^a-zA-Z0-9À-ÿ _.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function materialApoioExtFromFile(file) {
  const mimeExt = mime.extension(file.mimetype);
  const originalExt = String(file.originalname || '').split('.').pop();
  return String(mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
}

function materialApoioValidarFormato(formato, file) {
  const fmt = String(formato || '').trim();
  if (!MAT_APOIO_FORMATOS.includes(fmt)) return 'Formato inválido. Use Video, foto ou PDF.';
  const ext = materialApoioExtFromFile(file);
  const mime = String(file.mimetype || '').toLowerCase();
  if (fmt === 'PDF') {
    if (ext !== 'pdf' && !mime.includes('pdf')) return 'Para formato PDF, envie um arquivo .pdf.';
  } else if (fmt === 'foto') {
    const ok = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'].includes(ext)
      || mime.startsWith('image/');
    if (!ok) return 'Para formato foto, envie uma imagem (jpg, png, etc.).';
  } else if (fmt === 'Video') {
    const ok = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(ext)
      || mime.startsWith('video/');
    if (!ok) return 'Para formato Video, envie um vídeo (mp4, webm, etc.).';
  }
  return null;
}

function materialApoioBuildFileName(nome, file, uniqueSuffix) {
  const base = materialApoioSanitizeNome(nome).replace(/\s/g, '_') || 'arquivo';
  const ext = materialApoioExtFromFile(file);
  const origBase = String(file.originalname || '').replace(/\.[^.]+$/, '').slice(0, 60);
  const safeOrig = origBase.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_') || 'arquivo';
  const suf = uniqueSuffix ? `_${uniqueSuffix}` : '';
  return `${base}_${safeOrig}${suf}.${ext}`;
}

function materialApoioParsePublico(val) {
  if (val === true || val === 1) return true;
  const s = String(val ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

function materialApoioMapAnexo(row) {
  return {
    id: row.id,
    nome_arquivo: row.nome_arquivo,
    path_key: row.path_key,
    url_publica: row.url_publica || null,
    content_type: row.content_type,
    tamanho_bytes: row.tamanho_bytes,
    status_upload: row.status_upload || 'concluido',
    upload_erro: row.upload_erro || null,
    criado_em: row.criado_em,
  };
}

function materialApoioStatusAgregado(anexos) {
  const lista = anexos || [];
  if (lista.some((a) => String(a.status_upload || '') === 'enviando')) return 'enviando';
  if (lista.some((a) => String(a.status_upload || '') === 'erro')) return 'erro';
  return 'concluido';
}

function materialApoioMapRow(row, anexos) {
  const anexosList = (anexos || []).map(materialApoioMapAnexo);
  return {
    id: row.id,
    nome: row.nome,
    tipo: row.tipo,
    formato: row.formato,
    publico: row.publico === true,
    criado_por: row.criado_por,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
    anexos: anexosList,
    status_upload: materialApoioStatusAgregado(anexosList),
  };
}

async function materialApoioFetchAnexosMap(materialIds) {
  const ids = [...new Set((materialIds || []).map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) return new Map();
  const { rows } = await pool.query(
    `SELECT id, material_id, nome_arquivo, path_key, url_publica,
            content_type, tamanho_bytes, status_upload, upload_erro, criado_em
       FROM sac.material_apoio_anexo
      WHERE material_id = ANY($1::bigint[])
      ORDER BY material_id, criado_em ASC, id ASC`,
    [ids]
  );
  const map = new Map();
  rows.forEach((row) => {
    const mid = Number(row.material_id);
    if (!map.has(mid)) map.set(mid, []);
    map.get(mid).push(row);
  });
  return map;
}

async function materialApoioFetchItemCompleto(id) {
  const { rows } = await pool.query(
    `SELECT id, nome, tipo, formato, publico, criado_por, criado_em, atualizado_em
       FROM sac.material_apoio WHERE id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const anexosMap = await materialApoioFetchAnexosMap([id]);
  return materialApoioMapRow(rows[0], anexosMap.get(id) || []);
}

async function materialApoioUploadBackgroundAnexo({ anexoId, pathKey, buffer, contentType, oldPathKey }) {
  try {
    const { url } = await uploadPublicFile(MAT_APOIO_BUCKET, pathKey, buffer, {
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    });
    await pool.query(
      `UPDATE sac.material_apoio_anexo
          SET url_publica = $2, status_upload = 'concluido', upload_erro = NULL
        WHERE id = $1`,
      [anexoId, url]
    );
    if (oldPathKey && oldPathKey !== pathKey) {
      try { await removePublicFiles(MAT_APOIO_BUCKET, oldPathKey); } catch (_) { /* ignora */ }
    }
  } catch (err) {
    console.error('[SAC/material-apoio] upload background erro:', err);
    await pool.query(
      `UPDATE sac.material_apoio_anexo
          SET status_upload = 'erro', upload_erro = $2
        WHERE id = $1`,
      [anexoId, String(err.message || err).slice(0, 500)]
    );
  }
}

function materialApoioDispararUploadBackground(opts) {
  setImmediate(() => {
    materialApoioUploadBackgroundAnexo(opts).catch((err) => {
      console.error('[SAC/material-apoio] falha inesperada no upload background:', err);
    });
  });
}

async function materialApoioInserirAnexos({ materialId, formato, nomeMaterial, files }) {
  const inseridos = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const fmtErr = materialApoioValidarFormato(formato, file);
    if (fmtErr) throw new Error(fmtErr);

    const uniqueSuffix = `${Date.now().toString(36)}_${i + 1}`;
    const nomeArquivo = materialApoioBuildFileName(nomeMaterial, file, uniqueSuffix);
    const pathKey = `${MAT_APOIO_PASTA}/${materialId}/${nomeArquivo}`;
    const fileBuffer = Buffer.from(file.buffer);
    const contentType = file.mimetype || 'application/octet-stream';

    const { rows: dup } = await pool.query(
      'SELECT id FROM sac.material_apoio_anexo WHERE path_key = $1 LIMIT 1',
      [pathKey]
    );
    if (dup.length) throw new Error(`Já existe um anexo com o caminho "${nomeArquivo}".`);

    const ins = await pool.query(
      `INSERT INTO sac.material_apoio_anexo
         (material_id, nome_arquivo, path_key, url_publica, content_type, tamanho_bytes, status_upload)
       VALUES ($1,$2,$3,NULL,$4,$5,'enviando')
       RETURNING id, material_id, nome_arquivo, path_key, url_publica,
                 content_type, tamanho_bytes, status_upload, upload_erro, criado_em`,
      [materialId, nomeArquivo, pathKey, contentType, file.size || null]
    );
    const anexo = materialApoioMapAnexo(ins.rows[0]);
    inseridos.push(anexo);
    materialApoioDispararUploadBackground({
      anexoId: anexo.id,
      pathKey,
      buffer: fileBuffer,
      contentType,
    });
  }
  return inseridos;
}

// GET /at/material-apoio/tipos — tipos já cadastrados
router.get('/at/material-apoio/tipos', async (_req, res) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT DISTINCT TRIM(tipo) AS tipo
         FROM sac.material_apoio
        WHERE tipo IS NOT NULL AND TRIM(tipo) != ''
        ORDER BY 1`
    );
    res.json({ ok: true, tipos: rows.map((r) => r.tipo) });
  } catch (err) {
    console.error('[SAC/material-apoio] GET tipos erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/material-apoio — lista materiais com anexos
router.get('/at/material-apoio', async (_req, res) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, nome, tipo, formato, publico, criado_por, criado_em, atualizado_em
         FROM sac.material_apoio
        ORDER BY tipo, nome`
    );
    const anexosMap = await materialApoioFetchAnexosMap(rows.map((r) => r.id));
    res.json({
      ok: true,
      itens: rows.map((row) => materialApoioMapRow(row, anexosMap.get(Number(row.id)) || [])),
    });
  } catch (err) {
    console.error('[SAC/material-apoio] GET erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /at/material-apoio — cria material + um ou mais anexos
router.post('/at/material-apoio', materialApoioUpload.array('arquivo', MAT_APOIO_MAX_ANEXOS), async (req, res) => {
  const nome = materialApoioSanitizeNome(req.body?.nome);
  const tipo = String(req.body?.tipo || '').trim().slice(0, 80);
  const formato = String(req.body?.formato || '').trim();
  const publico = materialApoioParsePublico(req.body?.publico);
  const files = Array.isArray(req.files) ? req.files.filter((f) => f?.buffer?.length) : [];

  if (!nome) return res.status(400).json({ ok: false, error: 'Informe o nome.' });
  if (!tipo) return res.status(400).json({ ok: false, error: 'Informe o tipo.' });
  if (!MAT_APOIO_FORMATOS.includes(formato)) {
    return res.status(400).json({ ok: false, error: 'Formato inválido. Use Video, foto ou PDF.' });
  }
  if (!files.length) {
    return res.status(400).json({ ok: false, error: 'Selecione ao menos um arquivo para anexar.' });
  }

  const usuario = req.session?.user?.fullName || req.session?.user?.username || 'sistema';

  try {
    await ensureSchema();
    const ins = await pool.query(
      `INSERT INTO sac.material_apoio (nome, tipo, formato, publico, criado_por)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, nome, tipo, formato, publico, criado_por, criado_em, atualizado_em`,
      [nome, tipo, formato, publico, usuario]
    );
    const materialId = ins.rows[0].id;
    try {
      const anexos = await materialApoioInserirAnexos({
        materialId,
        formato,
        nomeMaterial: nome,
        files,
      });
      res.json({ ok: true, item: materialApoioMapRow(ins.rows[0], anexos) });
    } catch (anexoErr) {
      await pool.query('DELETE FROM sac.material_apoio WHERE id = $1', [materialId]);
      throw anexoErr;
    }
  } catch (err) {
    console.error('[SAC/material-apoio] POST erro:', err);
    const msg = String(err.message || err);
    const is400 = msg.includes('Formato') || msg.includes('PDF') || msg.includes('foto') || msg.includes('Video');
    res.status(is400 ? 400 : 500).json({ ok: false, error: msg || 'Falha ao salvar material.' });
  }
});

// PUT /at/material-apoio/:id — atualiza metadados do material
router.put('/at/material-apoio/:id', express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });

  const nome = materialApoioSanitizeNome(req.body?.nome);
  const tipo = String(req.body?.tipo || '').trim().slice(0, 80);
  const formato = String(req.body?.formato || '').trim();
  const publico = materialApoioParsePublico(req.body?.publico);
  if (!nome) return res.status(400).json({ ok: false, error: 'Informe o nome.' });
  if (!tipo) return res.status(400).json({ ok: false, error: 'Informe o tipo.' });
  if (!MAT_APOIO_FORMATOS.includes(formato)) {
    return res.status(400).json({ ok: false, error: 'Formato inválido. Use Video, foto ou PDF.' });
  }

  try {
    await ensureSchema();
    const upd = await pool.query(
      `UPDATE sac.material_apoio
          SET nome = $2, tipo = $3, formato = $4, publico = $5, atualizado_em = NOW()
        WHERE id = $1
        RETURNING id, nome, tipo, formato, publico, criado_por, criado_em, atualizado_em`,
      [id, nome, tipo, formato, publico]
    );
    if (!upd.rows.length) return res.status(404).json({ ok: false, error: 'Material não encontrado.' });
    const anexosMap = await materialApoioFetchAnexosMap([id]);
    res.json({ ok: true, item: materialApoioMapRow(upd.rows[0], anexosMap.get(id) || []) });
  } catch (err) {
    console.error('[SAC/material-apoio] PUT erro:', err);
    res.status(500).json({ ok: false, error: err.message || 'Falha ao atualizar material.' });
  }
});

// POST /at/material-apoio/:id/anexos — adiciona anexos a material existente
router.post('/at/material-apoio/:id/anexos', materialApoioUpload.array('arquivo', MAT_APOIO_MAX_ANEXOS), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  const files = Array.isArray(req.files) ? req.files.filter((f) => f?.buffer?.length) : [];
  if (!files.length) return res.status(400).json({ ok: false, error: 'Selecione ao menos um arquivo.' });

  try {
    await ensureSchema();
    const { rows } = await pool.query(
      'SELECT id, nome, formato FROM sac.material_apoio WHERE id = $1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Material não encontrado.' });
    const material = rows[0];

    const { rows: cntRows } = await pool.query(
      'SELECT COUNT(*)::int AS qtd FROM sac.material_apoio_anexo WHERE material_id = $1',
      [id]
    );
    const qtdAtual = cntRows[0]?.qtd || 0;
    if (qtdAtual + files.length > MAT_APOIO_MAX_ANEXOS) {
      return res.status(400).json({
        ok: false,
        error: `Limite de ${MAT_APOIO_MAX_ANEXOS} anexos por material (atual: ${qtdAtual}).`,
      });
    }

    await materialApoioInserirAnexos({
      materialId: id,
      formato: material.formato,
      nomeMaterial: material.nome,
      files,
    });
    const item = await materialApoioFetchItemCompleto(id);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[SAC/material-apoio] POST anexos erro:', err);
    const msg = String(err.message || err);
    const is400 = msg.includes('Formato') || msg.includes('PDF') || msg.includes('foto') || msg.includes('Video') || msg.includes('Limite');
    res.status(is400 ? 400 : 500).json({ ok: false, error: msg || 'Falha ao anexar arquivos.' });
  }
});

// DELETE /at/material-apoio/anexo/:anexoId — remove um anexo
router.delete('/at/material-apoio/anexo/:anexoId', async (req, res) => {
  const anexoId = parseInt(req.params.anexoId, 10);
  if (!anexoId) return res.status(400).json({ ok: false, error: 'ID do anexo inválido.' });
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `DELETE FROM sac.material_apoio_anexo
        WHERE id = $1
        RETURNING material_id, path_key, status_upload`,
      [anexoId]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Anexo não encontrado.' });
    const materialId = rows[0].material_id;
    const pathKey = rows[0].path_key;
    if (pathKey && rows[0].status_upload === 'concluido') {
      setImmediate(() => {
        removePublicFiles(MAT_APOIO_BUCKET, pathKey).catch(() => {});
      });
    }
    const item = await materialApoioFetchItemCompleto(materialId);
    res.json({ ok: true, item });
  } catch (err) {
    console.error('[SAC/material-apoio] DELETE anexo erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /at/material-apoio/:id/publico — alterna visibilidade pública
router.patch('/at/material-apoio/:id/publico', express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  const publico = materialApoioParsePublico(req.body?.publico);
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `UPDATE sac.material_apoio
          SET publico = $2, atualizado_em = NOW()
        WHERE id = $1
        RETURNING id, nome, tipo, formato, publico, criado_por, criado_em, atualizado_em`,
      [id, publico]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Material não encontrado.' });
    const anexosMap = await materialApoioFetchAnexosMap([id]);
    res.json({ ok: true, item: materialApoioMapRow(rows[0], anexosMap.get(id) || []) });
  } catch (err) {
    console.error('[SAC/material-apoio] PATCH publico erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /at/material-apoio/:id — remove material e todos os anexos
router.delete('/at/material-apoio/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  try {
    await ensureSchema();
    const { rows: anexos } = await pool.query(
      `SELECT path_key, status_upload FROM sac.material_apoio_anexo WHERE material_id = $1`,
      [id]
    );
    const { rows } = await pool.query(
      'DELETE FROM sac.material_apoio WHERE id = $1 RETURNING id',
      [id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Material não encontrado.' });
    res.json({ ok: true });
    anexos.forEach((a) => {
      if (a.path_key && a.status_upload === 'concluido') {
        setImmediate(() => {
          removePublicFiles(MAT_APOIO_BUCKET, a.path_key).catch(() => {});
        });
      }
    });
  } catch (err) {
    console.error('[SAC/material-apoio] DELETE erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/tecnicos/ufs — lista UFs distintas disponíveis
router.get('/at/tecnicos/ufs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT UPPER(TRIM(uf)) AS uf FROM sac.controle_tecnicos
       WHERE uf IS NOT NULL AND TRIM(uf) != ''
       ORDER BY 1`
    );
    res.json(rows.map(r => r.uf));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /at/pecas-enviadas/:id — envios vinculados a esta OS via coluna id_at
router.get('/at/pecas-enviadas/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID inválido.' });
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, identificacao, observacao, conteudo, etiqueta_url, declaracao_url, anexos,
              rastreio_status, created_at, usuario, metodo_envio, id_vipp, id_at, valor_envio
       FROM envios.solicitacoes
       WHERE id_at = $1
       ORDER BY id DESC`,
      [id]
    );
    res.json(rows.map(r => {
      let itens = [];
      try { itens = JSON.parse(r.conteudo || '[]'); } catch { itens = []; }
      const etq = String(r.etiqueta_url || '').trim();
      const dec = String(r.declaracao_url || '').trim();
      const isZpl = (s) => s.startsWith('^XA') || s.startsWith('<?xml') || s.startsWith('<RECORDS');
      const isHttp = (s) => /^https?:\/\//i.test(s);
      const anexosHttp = (Array.isArray(r.anexos) ? r.anexos : [])
        .map((a) => String(a || '').trim())
        .filter((a) => isHttp(a));
      const valorEnvio = r.valor_envio != null && r.valor_envio !== ''
        ? Number(r.valor_envio)
        : null;
      return {
        id:              r.id,
        id_at:           r.id_at,
        identificacao:   r.identificacao || '',
        observacao:      r.observacao || '',
        rastreio_status: r.rastreio_status || '',
        usuario:         r.usuario || '',
        created_at:      r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '',
        metodo_envio:    r.metodo_envio || '',
        id_vipp:         r.id_vipp || null,
        valor_envio:     Number.isFinite(valorEnvio) ? valorEnvio : null,
        etiqueta_url:    isHttp(etq) ? etq : null,
        etiqueta_zebra:  !!(r.identificacao || isZpl(etq)),
        declaracao_url:  isHttp(dec) ? dec : null,
        declaracao_zebra: !!(isZpl(dec) || r.id_vipp),
        anexos:          anexosHttp,
        itens,
      };
    }));
  } catch (err) {
    console.error('[AT/pecas-enviadas] erro:', err);
    res.status(500).json({ error: err.message });
  }
});

function _emailValidoDevolucao(raw) {
  const e = String(raw || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

async function _obterEmailRemetenteDevolucao(req) {
  // Brevo só entrega confiável se o From for remetente/domínio verificado.
  // Usamos sempre SMTP_FROM (ex.: calidadefromtherm2@gmail.com) e o e-mail
  // do usuário logado como Reply-To (quando existir).
  const uid = req.session?.user?.id || null;
  const uname = String(req.session?.user?.username || '').trim();
  let email = null;
  let nome = req.session?.user?.fullName || uname || 'Intranet';
  try {
    if (uid) {
      const { rows } = await pool.query(
        `SELECT email, nome_completo, username FROM public.auth_user WHERE id = $1 LIMIT 1`,
        [uid]
      );
      if (rows[0]) {
        email = _emailValidoDevolucao(rows[0].email);
        nome = String(rows[0].nome_completo || rows[0].username || nome).trim() || nome;
      }
    } else if (uname) {
      const { rows } = await pool.query(
        `SELECT email, nome_completo, username FROM public.auth_user WHERE LOWER(username) = LOWER($1) LIMIT 1`,
        [uname]
      );
      if (rows[0]) {
        email = _emailValidoDevolucao(rows[0].email);
        nome = String(rows[0].nome_completo || rows[0].username || nome).trim() || nome;
      }
    }
  } catch (_) { /* ignora */ }

  const smtpFrom = String(process.env.SMTP_FROM || '').trim();
  if (!smtpFrom) {
    return { from: null, email, nome, usadoFallback: true };
  }
  // Mantém o nome amigável do usuário no From, mas o endereço deve ser o verificado no Brevo
  const matchAddr = smtpFrom.match(/<([^>]+)>/);
  const addrFixo = matchAddr ? matchAddr[1].trim() : smtpFrom.replace(/^.*<|>$/g, '').trim() || smtpFrom;
  const from = `${nome} <${addrFixo}>`;
  return { from, email, nome, usadoFallback: true, replyTo: email || undefined };
}

/**
 * GET /at/devolucao-destinatarios
 * Lista usuários com email_devolucao IS NOT NULL (pendentes + ativos).
 */
router.get('/at/devolucao-destinatarios', async (req, res) => {
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `SELECT id, username, nome_completo, email, email_devolucao, is_active
         FROM public.auth_user
        WHERE email_devolucao IS NOT NULL
        ORDER BY
          CASE WHEN email_devolucao = true THEN 0 ELSE 1 END,
          COALESCE(NULLIF(TRIM(nome_completo), ''), username) ASC`
    );
    return res.json({
      ok: true,
      itens: rows.map((r) => ({
        id: Number(r.id),
        username: r.username,
        nome: r.nome_completo || r.username,
        email: r.email || null,
        ativo: r.email_devolucao === true,
        pendente: r.email_devolucao === false,
        is_active: r.is_active !== false,
      })),
    });
  } catch (err) {
    console.error('[AT/devolucao-destinatarios] listar:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao listar destinatários.' });
  }
});

/**
 * GET /at/devolucao-destinatarios/buscar?q=
 * Pesquisa usuários ativos para incluir na lista.
 */
router.get('/at/devolucao-destinatarios/buscar', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, itens: [] });
  try {
    await ensureSchema();
    const like = `%${q.replace(/%/g, '')}%`;
    const { rows } = await pool.query(
      `SELECT id, username, nome_completo, email, email_devolucao, is_active
         FROM public.auth_user
        WHERE COALESCE(is_active, true) = true
          AND (
            username ILIKE $1
            OR COALESCE(nome_completo, '') ILIKE $1
            OR COALESCE(email, '') ILIKE $1
          )
        ORDER BY
          CASE WHEN email_devolucao IS NOT NULL THEN 1 ELSE 0 END,
          COALESCE(NULLIF(TRIM(nome_completo), ''), username) ASC
        LIMIT 20`,
      [like]
    );
    return res.json({
      ok: true,
      itens: rows.map((r) => ({
        id: Number(r.id),
        username: r.username,
        nome: r.nome_completo || r.username,
        email: r.email || null,
        na_lista: r.email_devolucao !== null && r.email_devolucao !== undefined,
        ativo: r.email_devolucao === true,
      })),
    });
  } catch (err) {
    console.error('[AT/devolucao-destinatarios] buscar:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha na pesquisa.' });
  }
});

/**
 * POST /at/devolucao-destinatarios
 * Inclui usuário na lista (email_devolucao = false = aguardando confirmação).
 * Body: { user_id, email? }
 */
router.post('/at/devolucao-destinatarios', async (req, res) => {
  const userId = parseInt(req.body?.user_id, 10);
  if (!userId || userId < 1) return res.status(400).json({ ok: false, error: 'Usuário inválido.' });
  const emailBody = req.body?.email != null ? _emailValidoDevolucao(req.body.email) : null;
  if (req.body?.email != null && String(req.body.email).trim() && !emailBody) {
    return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
  }
  try {
    await ensureSchema();
    const { rows: cur } = await pool.query(
      `SELECT id, username, nome_completo, email, email_devolucao
         FROM public.auth_user WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (!cur[0]) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });

    let email = _emailValidoDevolucao(cur[0].email) || emailBody;
    if (!email) {
      return res.status(400).json({
        ok: false,
        code: 'EMAIL_REQUIRED',
        error: 'Este usuário não tem e-mail cadastrado. Informe o e-mail para continuar.',
        usuario: {
          id: Number(cur[0].id),
          username: cur[0].username,
          nome: cur[0].nome_completo || cur[0].username,
        },
      });
    }

    // Já na lista → só atualiza e-mail se veio no body
    if (cur[0].email_devolucao !== null && cur[0].email_devolucao !== undefined) {
      if (emailBody) {
        await pool.query(`UPDATE public.auth_user SET email = $1, updated_at = NOW() WHERE id = $2`, [emailBody, userId]);
        email = emailBody;
      }
      return res.json({
        ok: true,
        ja_na_lista: true,
        item: {
          id: Number(cur[0].id),
          username: cur[0].username,
          nome: cur[0].nome_completo || cur[0].username,
          email,
          ativo: cur[0].email_devolucao === true,
          pendente: cur[0].email_devolucao === false,
        },
      });
    }

    await pool.query(
      `UPDATE public.auth_user
          SET email = COALESCE($1, email),
              email_devolucao = false,
              updated_at = NOW()
        WHERE id = $2`,
      [emailBody || email, userId]
    );

    return res.json({
      ok: true,
      item: {
        id: Number(cur[0].id),
        username: cur[0].username,
        nome: cur[0].nome_completo || cur[0].username,
        email: emailBody || email,
        ativo: false,
        pendente: true,
      },
    });
  } catch (err) {
    console.error('[AT/devolucao-destinatarios] incluir:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao incluir destinatário.' });
  }
});

/**
 * PUT /at/devolucao-destinatarios/:id/email
 * Grava e-mail em auth_user.email
 */
router.put('/at/devolucao-destinatarios/:id/email', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId || userId < 1) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  const email = _emailValidoDevolucao(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
  try {
    await ensureSchema();
    const { rows } = await pool.query(
      `UPDATE public.auth_user
          SET email = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, username, nome_completo, email, email_devolucao`,
      [email, userId]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
    return res.json({
      ok: true,
      item: {
        id: Number(rows[0].id),
        username: rows[0].username,
        nome: rows[0].nome_completo || rows[0].username,
        email: rows[0].email,
        ativo: rows[0].email_devolucao === true,
        pendente: rows[0].email_devolucao === false,
      },
    });
  } catch (err) {
    console.error('[AT/devolucao-destinatarios] email:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao salvar e-mail.' });
  }
});

/**
 * PUT /at/devolucao-destinatarios/:id
 * Body: { ativo: true|false } — confirma/desativa recebimento (email_devolucao)
 */
router.put('/at/devolucao-destinatarios/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId || userId < 1) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  const ativo = !!req.body?.ativo;
  try {
    await ensureSchema();
    const { rows: cur } = await pool.query(
      `SELECT id, email, email_devolucao FROM public.auth_user WHERE id = $1 LIMIT 1`,
      [userId]
    );
    if (!cur[0]) return res.status(404).json({ ok: false, error: 'Usuário não encontrado.' });
    if (cur[0].email_devolucao === null || cur[0].email_devolucao === undefined) {
      return res.status(400).json({ ok: false, error: 'Usuário não está na lista de devolução. Inclua antes.' });
    }
    if (ativo && !_emailValidoDevolucao(cur[0].email)) {
      return res.status(400).json({ ok: false, error: 'Cadastre um e-mail válido antes de ativar.' });
    }
    const { rows } = await pool.query(
      `UPDATE public.auth_user
          SET email_devolucao = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id, username, nome_completo, email, email_devolucao`,
      [ativo, userId]
    );
    return res.json({
      ok: true,
      item: {
        id: Number(rows[0].id),
        username: rows[0].username,
        nome: rows[0].nome_completo || rows[0].username,
        email: rows[0].email,
        ativo: rows[0].email_devolucao === true,
        pendente: rows[0].email_devolucao === false,
      },
    });
  } catch (err) {
    console.error('[AT/devolucao-destinatarios] ativar:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao atualizar.' });
  }
});

/**
 * DELETE /at/devolucao-destinatarios/:id
 * Remove da lista (email_devolucao = NULL). Não apaga o e-mail do usuário.
 */
router.delete('/at/devolucao-destinatarios/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId || userId < 1) return res.status(400).json({ ok: false, error: 'ID inválido.' });
  try {
    await ensureSchema();
    await pool.query(
      `UPDATE public.auth_user SET email_devolucao = NULL, updated_at = NOW() WHERE id = $1`,
      [userId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[AT/devolucao-destinatarios] remover:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Falha ao remover.' });
  }
});

/**
 * POST /at/devolucao/:id
 * Envia e-mail de devolução com dados da OS + PDF anexado (base64).
 * Body: { pdf_base64: string, pdf_filename?: string }
 * Destinatários: auth_user com email_devolucao = true (+ fallback AT_DEVOLUCAO_EMAILS)
 * Remetente: e-mail do usuário logado (+ fallback SMTP_FROM)
 */
router.post('/at/devolucao/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ ok: false, error: 'ID inválido.' });

  if (!smtpConfigurado()) {
    return res.status(503).json({
      ok: false,
      error: 'SMTP não configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM no .env (Brevo gratuito recomendado).',
    });
  }

  let pdfBase64 = String(req.body?.pdf_base64 || '').trim();
  if (pdfBase64.includes(',')) pdfBase64 = pdfBase64.split(',').pop() || '';
  pdfBase64 = pdfBase64.replace(/\s+/g, '');
  if (!pdfBase64 || pdfBase64.length < 100) {
    return res.status(400).json({ ok: false, error: 'PDF da OS não recebido. Gere o PDF e tente novamente.' });
  }
  if (pdfBase64.length > 11_000_000) {
    return res.status(413).json({ ok: false, error: 'PDF muito grande para envio por e-mail.' });
  }

  const pdfFilename = String(req.body?.pdf_filename || `OS_${id}_devolucao.pdf`)
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 120);

  try {
    await ensureSchema();

    const { rows: destRows } = await pool.query(
      `SELECT email
         FROM public.auth_user
        WHERE email_devolucao = true
          AND COALESCE(is_active, true) = true
          AND email IS NOT NULL
          AND TRIM(email) <> ''`
    );
    let destinatarios = destRows
      .map((r) => _emailValidoDevolucao(r.email))
      .filter(Boolean);
    // Fallback opcional do .env enquanto a lista ainda não foi configurada na tela
    if (!destinatarios.length) {
      destinatarios = parseListaEmails(process.env.AT_DEVOLUCAO_EMAILS || '');
    }
    if (!destinatarios.length) {
      return res.status(400).json({
        ok: false,
        error: 'Nenhum destinatário ativo. Em AT → Configuração → Destinatários de devolução, marque quem deve receber.',
      });
    }

    const remetente = await _obterEmailRemetenteDevolucao(req);
    if (!remetente.from) {
      return res.status(503).json({
        ok: false,
        error: 'Seu usuário não tem e-mail cadastrado e SMTP_FROM não está definido. Cadastre o e-mail em RH ou defina SMTP_FROM no .env.',
      });
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.data, a.tipo, a.status, a.nome_revenda_cliente, a.numero_telefone,
              a.cpf_cnpj, a.modelo, a.cidade, a.estado, a.descreva_reclamacao,
              a.atendimento_inicial, a.motivo_solicitacao, a.acao_tomada, a.tag_problema,
              s.pedido, s.ordem_producao, s.nota_fiscal, s.data_entrega,
              ct.nome AS tecnico_nome
         FROM sac.at a
         LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
         LEFT JOIN sac.fechamento f ON f.id_at = a.id
         LEFT JOIN sac.controle_tecnicos ct ON ct.id = f.id_tecnico
        WHERE a.id = $1
        ORDER BY f.id DESC NULLS LAST
        LIMIT 1`,
      [id]
    );
    const at = rows[0];
    if (!at) return res.status(404).json({ ok: false, error: 'OS não encontrada.' });

    const linha = (lbl, val) => {
      const v = String(val ?? '').trim();
      return v ? `<tr><td style="padding:4px 8px;font-weight:700;color:#334155;white-space:nowrap;">${lbl}</td><td style="padding:4px 8px;color:#0f172a;">${String(v).replace(/</g, '&lt;')}</td></tr>` : '';
    };
    const dataBr = at.data ? new Date(at.data).toLocaleString('pt-BR') : '';

    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;">
        <h2 style="margin:0 0 8px;color:#0ea5e9;">Devolução — OS #${id}</h2>
        <p style="margin:0 0 14px;color:#475569;">Solicitação automática pela Intranet (modal Editar OS).</p>
        <table style="border-collapse:collapse;width:100%;max-width:720px;border:1px solid #e2e8f0;">
          ${linha('OS', `#${id}`)}
          ${linha('Data', dataBr)}
          ${linha('Tipo', at.tipo)}
          ${linha('Status', at.status)}
          ${linha('Cliente / Revenda', at.nome_revenda_cliente)}
          ${linha('Telefone', at.numero_telefone)}
          ${linha('CPF/CNPJ', at.cpf_cnpj)}
          ${linha('Modelo', at.modelo)}
          ${linha('Cidade/UF', [at.cidade, at.estado].filter(Boolean).join(' / '))}
          ${linha('Pedido', at.pedido)}
          ${linha('Ordem de Produção', at.ordem_producao)}
          ${linha('Nota Fiscal', at.nota_fiscal)}
          ${linha('Data Entrega', at.data_entrega)}
          ${linha('Tag', at.tag_problema)}
          ${linha('Técnico', at.tecnico_nome)}
          ${linha('Atendimento inicial', at.atendimento_inicial)}
          ${linha('Motivo', at.motivo_solicitacao)}
          ${linha('Ação tomada', at.acao_tomada)}
          ${linha('Reclamação', at.descreva_reclamacao)}
        </table>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;">PDF da Solicitação de AT anexado a este e-mail.</p>
      </div>`;

    const text = [
      `Devolução — OS #${id}`,
      `Cliente: ${at.nome_revenda_cliente || '-'}`,
      `Modelo: ${at.modelo || '-'}`,
      `NF: ${at.nota_fiscal || '-'}`,
      `OP: ${at.ordem_producao || '-'}`,
      `Pedido: ${at.pedido || '-'}`,
      `Reclamação: ${at.descreva_reclamacao || '-'}`,
      '',
      'PDF da OS anexado.',
    ].join('\n');

    const usuario = req.session?.user?.fullName || req.session?.user?.username || 'sistema';
    const result = await enviarEmail({
      to: destinatarios,
      from: remetente.from,
      replyTo: remetente.replyTo || remetente.email || undefined,
      subject: `Devolução — OS #${id} — ${at.nome_revenda_cliente || at.modelo || 'Fromtherm'}`,
      text,
      html,
      attachments: [{
        filename: pdfFilename,
        content: pdfBase64,
        encoding: 'base64',
        contentType: 'application/pdf',
      }],
    });

    await pool.query(
      `UPDATE sac.at
          SET devolucao_enviada_em = NOW(),
              devolucao_enviada_para = $2
        WHERE id = $1`,
      [id, result.to.join(', ')]
    );

    console.log(`[AT/devolucao] OS #${id} enviada por ${usuario} (from=${result.from}) → ${result.to.join(', ')}`);
    return res.json({
      ok: true,
      enviados: result.to,
      from: result.from,
      remetente_fallback: remetente.usadoFallback,
      messageId: result.messageId,
      enviada_em: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AT/devolucao] erro:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Falha ao enviar e-mail de devolução.',
      code: err.code || null,
    });
  }
});

// GET /at/geocode-cidade?municipio=X&uf=Y&cep=XXXXXXXX — geocoding de cidade: BrasilAPI CEP → Nominatim (proxy, sem CORS)
router.get('/at/geocode-cidade', async (req, res) => {
  const municipio = String(req.query.municipio || '').trim();
  const uf        = String(req.query.uf || '').trim();
  const cep       = String(req.query.cep || '').replace(/\D/g, '');
  let c = null;
  if (cep.length === 8) c = await geocodeByCep(cep);
  if (!c && municipio) c = await geocodeByNominatimBackend(municipio, uf);
  res.json(c || null);
});

// POST /at/tecnicos/geocode?uf=SC — geocodifica entradas sem lat/lng via BrasilAPI CEP (paralelo),
// armazena no banco e retorna lista completa com coordenadas
router.post('/at/tecnicos/geocode', async (req, res) => {
  const uf = req.query.uf ? String(req.query.uf).trim().toUpperCase() : null;
  try {
    // Identifica técnicos sem coordenadas (filtrado por UF se informado)
    const whereMissing = uf
      ? `WHERE UPPER(TRIM(uf)) = $1 AND lat IS NULL`
      : `WHERE lat IS NULL`;
    const paramsMissing = uf ? [uf] : [];
    const { rows: missing } = await pool.query(
      `SELECT ctid, cep, municipio, uf FROM sac.controle_tecnicos ${whereMissing}`,
      paramsMissing
    );

    // Geocodifica em paralelo: BrasilAPI CEP primeiro, Nominatim como fallback
    if (missing.length) {
      await Promise.all(missing.map(async t => {
        let c = await geocodeByCep(t.cep);
        if (!c) c = await geocodeByNominatimBackend(t.municipio, t.uf);
        if (c) {
          await pool.query(
            `UPDATE sac.controle_tecnicos SET lat = $1, lng = $2 WHERE ctid = $3`,
            [c.lat, c.lng, t.ctid]
          );
        }
      }));
    }

    // Retorna lista completa com coordenadas (filtrado por UF se informado)
    const whereFinal = uf ? `WHERE UPPER(TRIM(uf)) = $1` : '';
    const paramsFinal = uf ? [uf] : [];
    const { rows } = await pool.query(
      `SELECT nome, municipio, uf, celular, tipo, lat, lng
       FROM sac.controle_tecnicos ${whereFinal}
       ORDER BY nome LIMIT 200`,
      paramsFinal
    );
    res.json(rows);
  } catch (err) {
    console.error('[SAC/AT] erro ao geocodificar técnicos:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /at/tecnicos — lista técnicos com filtro opcional por uf (pode ser múltiplas separadas por vírgula) e busca por nome
router.get('/at/tecnicos', async (req, res) => {
  const { uf, q } = req.query;
  const params = [];
  const conditions = [];
  if (uf && String(uf).trim()) {
    const ufs = String(uf).split(',').map(u => u.trim().toUpperCase()).filter(Boolean);
    if (ufs.length) {
      params.push(ufs);
      conditions.push(`UPPER(TRIM(uf)) = ANY($${params.length})`);
    }
  }
  if (q && String(q).trim().length >= 1) {
    params.push(`%${String(q).trim()}%`);
    conditions.push(`UPPER(nome) LIKE UPPER($${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, municipio, uf, celular, tipo, lat, lng FROM sac.controle_tecnicos ${where} ORDER BY nome LIMIT 100`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[SAC/AT] erro ao buscar técnicos:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /at/tecnicos/:id — dados completos de um técnico pelo id
router.get('/at/tecnicos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID inválido.' });
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular, tipo, lat, lng, qtd_atend_ult_1_ano
       FROM sac.controle_tecnicos WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Técnico não encontrado.' });
    const row = rows[0];
    const addr = normalizarEnderecoTecnicoRow(row);
    res.json({ ...row, ...addr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /at/tecnicos — cria novo técnico
router.post('/at/tecnicos', async (req, res) => {
  const { nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular, tipo, lat, lng } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'Nome obrigatório.' });
  const addr = sanitizarCamposEnderecoTecnico({ endereco, numero, bairro, complemento });
  if (!addr.endereco) return res.status(400).json({ error: 'Endereço (rua/logradouro) obrigatório.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO sac.controle_tecnicos (nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular, tipo, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular, tipo, lat, lng`,
      [
        String(nome).trim(),
        cnpj_cpf  ? String(cnpj_cpf).trim()  : null,
        addr.endereco,
        addr.numero || null,
        addr.bairro || null,
        addr.complemento || null,
        municipio ? String(municipio).trim() : null,
        uf        ? String(uf).trim().toUpperCase() : null,
        cep       ? String(cep).replace(/\D/g, '') || null : null,
        celular   ? String(celular).trim() : null,
        tipo      ? String(tipo).trim() : null,
        lat != null ? parseFloat(lat) || null : null,
        lng != null ? parseFloat(lng) || null : null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /at/tecnicos/:id — atualiza dados de um técnico
router.put('/at/tecnicos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID inválido.' });
  const { nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular, tipo, lat, lng } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'Nome obrigatório.' });
  const addr = sanitizarCamposEnderecoTecnico({ endereco, numero, bairro, complemento });
  if (!addr.endereco) return res.status(400).json({ error: 'Endereço (rua/logradouro) obrigatório.' });
  try {
    const { rows } = await pool.query(
      `UPDATE sac.controle_tecnicos
       SET nome=$1, cnpj_cpf=$2, endereco=$3, numero=$4, bairro=$5, complemento=$6,
           municipio=$7, uf=$8, cep=$9, celular=$10, tipo=$11, lat=$12, lng=$13
       WHERE id=$14
       RETURNING id, nome, cnpj_cpf, endereco, numero, bairro, complemento, municipio, uf, cep, celular, tipo, lat, lng`,
      [
        String(nome).trim(),
        cnpj_cpf  ? String(cnpj_cpf).trim()  : null,
        addr.endereco,
        addr.numero || null,
        addr.bairro || null,
        addr.complemento || null,
        municipio ? String(municipio).trim() : null,
        uf        ? String(uf).trim().toUpperCase() : null,
        cep       ? String(cep).replace(/\D/g, '') || null : null,
        celular   ? String(celular).trim() : null,
        tipo      ? String(tipo).trim() : null,
        lat != null ? parseFloat(lat) || null : null,
        lng != null ? parseFloat(lng) || null : null,
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Técnico não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Portal AT: autenticação por token único por técnico ───────────────────────
const BCRYPT_ROUNDS = 10;
const AT_SESSION_SECRET = String(process.env.AT_SESSION_SECRET || '').trim();

// ── Portal AT: solicitação de produtos / separação (CNPJs autorizados) ────────
const AT_SEP_CNPJS_PERMITIDOS = new Set(['05240837000121', '48407161000120']);
// Destino padrão Omie das SEPs criadas pelo portal at-link.html
const AT_SEP_LOCAL_ESTOQUE = '10445659161'; // 10. SAC ASSISTENCIA E GARANTIAS
const AT_SEP_LOCAL_NOME_PADRAO = '10. SAC ASSISTENCIA E GARANTIAS';

function _atNormCnpj(v) {
  return String(v || '').replace(/\D/g, '');
}

function _atSepCnpjPermitido(cnpj_cpf) {
  return AT_SEP_CNPJS_PERMITIDOS.has(_atNormCnpj(cnpj_cpf));
}

function _atSepIdUser(tecId) {
  return `at:${tecId}`;
}

async function _atResolverTecnicoToken(token) {
  const tok = String(token || '').trim();
  if (!tok || tok.length < 32) return null;
  const { rows } = await pool.query(
    `SELECT id, nome, cnpj_cpf, tipo FROM sac.controle_tecnicos WHERE token = $1 LIMIT 1`,
    [tok]
  );
  return rows[0] || null;
}

async function _atResolverTecnicoSep(token) {
  const tecnico = await _atResolverTecnicoToken(token);
  if (!tecnico) return { error: 'Link inválido', status: 404 };
  if (!_atSepCnpjPermitido(tecnico.cnpj_cpf)) {
    return { error: 'Funcionalidade não disponível para este técnico.', status: 403 };
  }
  return { tecnico };
}

let _atSepSchemaOk = false;
async function _atEnsureSepSchema(db) {
  const client = db || pool;
  if (_atSepSchemaOk) return;
  await client.query(`ALTER TABLE logistica.carrinho ADD COLUMN IF NOT EXISTS comentario TEXT`);
  await client.query(`ALTER TABLE logistica.carrinho ADD COLUMN IF NOT EXISTS urgente BOOLEAN DEFAULT FALSE`);
  await client.query(`ALTER TABLE solicitacao_produto.itens_solicitados ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT now()`);
  await client.query(`ALTER TABLE solicitacao_produto.itens_solicitados ADD COLUMN IF NOT EXISTS observacao TEXT`);
  await client.query(`ALTER TABLE solicitacao_produto.itens_solicitados ADD COLUMN IF NOT EXISTS motivo TEXT`);
  await client.query(`ALTER TABLE solicitacao_produto.itens_solicitados ADD COLUMN IF NOT EXISTS cod_local TEXT`);
  await client.query(`ALTER TABLE solicitacao_produto.itens_solicitados ADD COLUMN IF NOT EXISTS nome_local TEXT`);
  await client.query(`ALTER TABLE solicitacao_produto.solicitacoes_separacao ADD COLUMN IF NOT EXISTS justificativa_nao_separacao TEXT`);
  await client.query(`ALTER TABLE solicitacao_produto.solicitacoes_separacao ADD COLUMN IF NOT EXISTS urgente BOOLEAN DEFAULT FALSE`);
  await client.query(`ALTER TABLE solicitacao_produto.solicitacoes_separacao ADD COLUMN IF NOT EXISTS n_solic TEXT`);
  _atSepSchemaOk = true;
}

// Cria/retorna token único do técnico e, se id_at informado, vincula ao fechamento
// GET /at/tecnico/token?nome=NOME&id_at=ID
router.get('/at/tecnico/token', async (req, res) => {
  const nome  = String(req.query.nome  || '').trim();
  const id_at = parseInt(req.query.id_at, 10) || null;
  if (!nome) return res.status(400).json({ error: 'nome obrigatório' });
  try {
    const { rows } = await pool.query(
      `SELECT id, ctid, nome, token FROM sac.controle_tecnicos WHERE nome = $1 LIMIT 1`,
      [nome]
    );
    if (!rows.length) return res.status(404).json({ error: 'Técnico não encontrado' });
    let { id: tecId, ctid, token } = rows[0];
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `UPDATE sac.controle_tecnicos SET token = $1 WHERE ctid = $2`,
        [token, ctid]
      );
    }
    // Vincula técnico ao fechamento existente (UPDATE); se não existir, cria linha mínima
    if (id_at && tecId) {
      // Se o par (id_at, id_tecnico) já existe, nada a fazer — vínculo já está correto
      const { rows: jaExiste } = await pool.query(
        `SELECT id FROM sac.fechamento WHERE id_at = $1 AND id_tecnico = $2 LIMIT 1`,
        [id_at, tecId]
      );
      if (!jaExiste.length) {
        // Atualiza o registro mais recente; se não existir nenhum, insere
        const { rowCount } = await pool.query(
          `UPDATE sac.fechamento SET id_tecnico = $1
           WHERE id = (
             SELECT id FROM sac.fechamento WHERE id_at = $2 ORDER BY id DESC LIMIT 1
           )`,
          [tecId, id_at]
        );
        if (rowCount === 0) {
          await pool.query(
            `INSERT INTO sac.fechamento (id_at, id_tecnico) VALUES ($1, $2)
             ON CONFLICT (id_at, id_tecnico) WHERE id_tecnico IS NOT NULL DO NOTHING`,
            [id_at, tecId]
          );
        }
      }
    }
    res.json({ token });
  } catch (err) {
    console.error('[AT/token] erro:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /at/tecnico/status?token=TOKEN
router.get('/at/tecnico/status', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token || token.length < 32) return res.status(400).json({ error: 'token inválido' });
  try {
    const { rows } = await pool.query(
      `SELECT nome, senha FROM sac.controle_tecnicos WHERE token = $1 LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Link inválido' });
    res.json({ temSenha: !!rows[0].senha, nome: rows[0].nome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /at/tecnico/retirar  { id_at } — remove técnico do fechamento
router.post('/at/tecnico/retirar', async (req, res) => {
  const id_at = parseInt(req.body?.id_at, 10);
  if (!id_at) return res.status(400).json({ error: 'id_at obrigatório' });
  try {
    await pool.query(
      `UPDATE sac.fechamento SET id_tecnico = NULL WHERE id_at = $1`,
      [id_at]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /at/tecnico/reset-senha  { nome } — apaga a senha para recriar
router.post('/at/tecnico/reset-senha', async (req, res) => {
  const { nome } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'nome obrigatório' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE sac.controle_tecnicos SET senha = NULL WHERE nome = $1`,
      [String(nome)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Técnico não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /at/tecnico/set-senha  { token, senha }
router.post('/at/tecnico/set-senha', async (req, res) => {
  const { token, senha } = req.body || {};
  if (!token || !senha) return res.status(400).json({ error: 'token e senha obrigatórios' });
  if (String(senha).length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 dígitos' });
  try {
    const { rows } = await pool.query(
      `SELECT ctid, senha FROM sac.controle_tecnicos WHERE token = $1 LIMIT 1`,
      [String(token)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Link inválido' });
    if (rows[0].senha) return res.status(409).json({ error: 'Senha já cadastrada. Use o login.' });
    const hash = await bcrypt.hash(String(senha), BCRYPT_ROUNDS);
    await pool.query(
      `UPDATE sac.controle_tecnicos SET senha = $1 WHERE ctid = $2`,
      [hash, rows[0].ctid]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /at/tecnico/login  { token, senha }
router.post('/at/tecnico/login', async (req, res) => {
  const { token, senha } = req.body || {};
  if (!token || !senha) return res.status(400).json({ error: 'token e senha obrigatórios' });
  if (!AT_SESSION_SECRET) {
    console.error('[AT/login] AT_SESSION_SECRET ausente. Recusando login.');
    return res.status(503).json({ error: 'AT_SESSION_SECRET não configurado' });
  }
  const rl = _atLoginRL;
  const key = String(token).slice(0, 16);
  const now = Date.now();
  const entry = rl.get(key) || { count: 0, reset: now + 5 * 60 * 1000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 5 * 60 * 1000; }
  if (entry.count >= 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  entry.count++;
  rl.set(key, entry);
  try {
    const { rows } = await pool.query(
      `SELECT id, nome, cnpj_cpf, tipo, municipio, uf, celular, senha, qtd_atend_ult_1_ano
       FROM sac.controle_tecnicos WHERE token = $1 LIMIT 1`,
      [String(token)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Link inválido' });
    const row = rows[0];
    if (!row.senha) return res.status(403).json({ error: 'Senha não cadastrada. Cadastre primeiro.' });
    const ok = await bcrypt.compare(String(senha), row.senha);
    if (!ok) return res.status(401).json({ error: 'Senha incorreta' });
    rl.delete(key);
    const ts  = Date.now();
    const sig = crypto.createHmac('sha256', AT_SESSION_SECRET).update(`${token}|${ts}`).digest('hex');
    const session = Buffer.from(JSON.stringify({ token, ts, sig })).toString('base64url');
    res.json({
      session,
      nome: row.nome,
      cnpj_cpf: row.cnpj_cpf || '',
      tipo: row.tipo || '',
      municipio: row.municipio || '',
      uf: row.uf || '',
      celular: row.celular || '',
      qtd_atend_ult_1_ano: row.qtd_atend_ult_1_ano || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const _atLoginRL = new Map();

// GET /at/tecnico/material-apoio?token=TOKEN — materiais públicos (somente consulta no portal)
router.get('/at/tecnico/material-apoio', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token || token.length < 32) return res.status(401).json({ ok: false, error: 'token inválido' });
  try {
    const { rows: valid } = await pool.query(
      `SELECT 1 AS ok FROM sac.controle_tecnicos WHERE token = $1 LIMIT 1`,
      [token]
    );
    if (!valid.length) return res.status(404).json({ ok: false, error: 'Link inválido' });
    const { rows } = await pool.query(
      `SELECT id, nome, tipo, formato, publico, criado_por, criado_em, atualizado_em
         FROM sac.material_apoio
        WHERE publico = true
        ORDER BY tipo, nome`
    );
    const anexosMap = await materialApoioFetchAnexosMap(rows.map((r) => r.id));
    res.json({
      ok: true,
      itens: rows.map((row) => materialApoioMapRow(row, anexosMap.get(Number(row.id)) || [])),
    });
  } catch (err) {
    console.error('[AT/tecnico/material-apoio] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/tecnico/atendimentos?token=TOKEN — lista OS vinculados a este técnico
router.get('/at/tecnico/atendimentos', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT id FROM sac.controle_tecnicos WHERE token = $1 LIMIT 1`, [token]
    );
    if (!tRows.length) return res.status(404).json({ error: 'Link inválido' });
    const tecId = tRows[0].id;
    const { rows } = await pool.query(
      `SELECT
         f.id_at,
         f.created_at,
         f.status_os,
         f.nfe_url,
         a.data            AS data_abertura,
         a.descreva_reclamacao,
         a.motivo_solicitacao,
         a.nome_revenda_cliente,
         s.modelo          AS modelo,
         s.ordem_producao
       FROM sac.fechamento f
       JOIN sac.at a ON a.id = f.id_at
       LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
       WHERE f.id_tecnico = $1
       ORDER BY f.id_at DESC`,
      [tecId]
    );
    res.json(rows.map(r => {
      const dt  = r.data_abertura ? new Date(r.data_abertura) : null;
      const ano = dt && !isNaN(dt) ? String(dt.getFullYear()).slice(-2) : '??';
      return {
        id_at: r.id_at,
        os_num: `${ano}-${r.id_at}`,
        data: dt && !isNaN(dt) ? dt.toLocaleDateString('pt-BR') : '',
        cliente: r.nome_revenda_cliente || r.cliente || '',
        modelo: r.modelo || '',
        problema: r.descreva_reclamacao || r.motivo_solicitacao || '',
        status_os: r.status_os || 'aberta',
        nfe_url: r.nfe_url || null
      };
    }));
  } catch (err) {
    console.error('[AT/atendimentos] erro:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /at/tecnico/os-portal/:id_at?token=TOKEN — dados completos de uma OS para o portal
router.get('/at/tecnico/os-portal/:id_at', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at) return res.status(400).json({ error: 'id_at inválido' });
  try {
    // Verifica acesso: técnico deve ter este atendimento vinculado
    const { rows: tRows } = await pool.query(
      `SELECT ct.id FROM sac.controle_tecnicos ct
       JOIN sac.fechamento f ON f.id_tecnico = ct.id
       WHERE ct.token = $1 AND f.id_at = $2 LIMIT 1`,
      [token, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado a este atendimento.' });

    const { rows } = await pool.query(
      `SELECT
         a.nome_revenda_cliente,
         a.data              AS data_abertura,
         a.numero_telefone   AS at_celular,
         a.cpf_cnpj,
         a.estado, a.cidade, a.rua, a.numero AS num_end, a.bairro, a.cep,
         a.agendar_atendimento_com,
         a.modelo            AS at_modelo,
         a.descreva_reclamacao,
         a.motivo_solicitacao,
         a.atendimento_inicial,
         s.cliente           AS revenda_cliente,
         s.ordem_producao,
         s.modelo            AS serie_modelo,
         s.nota_fiscal,
         s.data_entrega,
         s.teste_tipo_gas,
         COALESCE(NULLIF(TRIM(f2.nome_fantasia),''), NULLIF(TRIM(f2.razao_social),'')) AS revenda_nome,
         f2.telefone1_ddd    AS rev_ddd,
         f2.telefone1_numero AS rev_tel
       FROM sac.at a
       LEFT JOIN sac.at_busca_selecionada s ON s.id_at = a.id
       LEFT JOIN LATERAL (
         SELECT telefone1_ddd, telefone1_numero, nome_fantasia, razao_social
         FROM omie.fornecedores
         WHERE nome_fantasia ILIKE s.cliente OR razao_social ILIKE s.cliente
         ORDER BY CASE WHEN nome_fantasia ILIKE s.cliente THEN 0 ELSE 1 END
         LIMIT 1
       ) f2 ON true
       WHERE a.id = $1 LIMIT 1`,
      [id_at]
    );
    if (!rows.length) return res.status(404).json({ error: 'OS não encontrada.' });
    const r = rows[0];

    let dataVenda = '';
    if (r.data_entrega) {
      const raw = String(r.data_entrega).trim();
      const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (m) { dataVenda = `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}`; }
      else { const d = new Date(raw); if (!isNaN(d)) dataVenda = d.toLocaleDateString('pt-BR'); }
    }
    const modelo = r.serie_modelo || r.at_modelo || '';
    const ordemProd = r.ordem_producao || '';

    let historico = [];
    if (ordemProd) {
      const hRes = await pool.query(
        `SELECT a2.id, a2.data, a2.descreva_reclamacao
         FROM sac.at a2
         JOIN sac.at_busca_selecionada s2 ON s2.id_at = a2.id
         WHERE s2.ordem_producao = $1 AND a2.descreva_reclamacao IS NOT NULL
           AND trim(a2.descreva_reclamacao) != ''
         ORDER BY a2.id DESC`,
        [ordemProd]
      );
      historico = hRes.rows.map(h => {
        const dt = h.data ? new Date(h.data) : null;
        const yy = dt && !isNaN(dt) ? String(dt.getFullYear()).slice(-2) : '';
        return `${yy}-${h.id} ${h.descreva_reclamacao}`;
      });
    }

    res.json({
      id_at,
      os_num: (() => { const d = r.data_abertura ? new Date(r.data_abertura) : null; return `${d && !isNaN(d) ? String(d.getFullYear()).slice(-2) : ''}-${id_at}`; })(),
      revenda: r.revenda_nome || r.revenda_cliente || '',
      revenda_cel: r.rev_ddd && r.rev_tel ? `${r.rev_ddd} ${r.rev_tel}` : '',
      cliente: r.nome_revenda_cliente || '',
      cidade_uf: [r.cidade, r.estado].filter(Boolean).join(' / '),
      endereco: [r.rua, r.num_end].filter(Boolean).join(', '),
      cep: r.cep || '',
      contato: r.agendar_atendimento_com || '',
      celular: r.at_celular || '',
      cpf_cnpj: r.cpf_cnpj || '',
      num_serie: ordemProd,
      nota_fiscal: r.nota_fiscal || '',
      modelo,
      data_venda: dataVenda,
      fluido_refrig: r.teste_tipo_gas || '',
      descricao_problema: r.descreva_reclamacao || '',
      motivo_solicitacao: r.motivo_solicitacao || '',
      atendimento_inicial: r.atendimento_inicial || '',
      data_abertura: (() => {
        if (!r.data_abertura) return '';
        const d = new Date(r.data_abertura);
        return isNaN(d) ? String(r.data_abertura) : d.toLocaleDateString('pt-BR');
      })(),
      historico
    });
  } catch (err) {
    console.error('[AT/os-portal] erro:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /at/tecnico/fechamento/:id_at?token=TOKEN — busca dados de fechamento para o portal do técnico
router.get('/at/tecnico/fechamento/:id_at', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at) return res.status(400).json({ error: 'id_at inválido' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT ct.id FROM sac.controle_tecnicos ct
       JOIN sac.fechamento f ON f.id_tecnico = ct.id
       WHERE ct.token = $1 AND f.id_at = $2 LIMIT 1`,
      [token, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado.' });
    const { rows } = await pool.query(
      `SELECT status_os, nfe_url, descricao_servico_realizado, pecas_reposicao,
              valor_total_mao_obra, valor_gasto_pecas, data_conclusao_servico, observacao_tecnico
       FROM sac.fechamento WHERE id_at = $1 LIMIT 1`,
      [id_at]
    );
    res.json(rows[0] || { status_os: 'aberta' });
  } catch (err) {
    console.error('[AT/fechamento] get erro:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /at/tecnico/fechamento/:id_at?token=TOKEN — salva dados de fechamento pelo técnico
router.patch('/at/tecnico/fechamento/:id_at', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at) return res.status(400).json({ error: 'id_at inválido' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT ct.id FROM sac.controle_tecnicos ct
       JOIN sac.fechamento f ON f.id_tecnico = ct.id
       WHERE ct.token = $1 AND f.id_at = $2 LIMIT 1`,
      [token, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado.' });
    const ALLOWED = [
      'status_os', 'descricao_servico_realizado', 'pecas_reposicao',
      'valor_total_mao_obra', 'valor_gasto_pecas', 'data_conclusao_servico', 'observacao_tecnico'
    ];
    const cols = [], vals = [];
    for (const f of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        cols.push(f);
        vals.push(req.body[f] === '' || req.body[f] == null ? null : req.body[f]);
      }
    }
    if (!cols.length) return res.status(400).json({ error: 'Nenhum campo válido.' });
    const { rows: ex } = await pool.query('SELECT id FROM sac.fechamento WHERE id_at = $1', [id_at]);
    if (ex.length) {
      await pool.query(
        `UPDATE sac.fechamento SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')} WHERE id_at=$1`,
        [id_at, ...vals]
      );
    } else {
      await pool.query(
        `INSERT INTO sac.fechamento (id_at, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
        [id_at, ...vals]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[AT/fechamento] patch erro:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Resolve técnico pelo token; retorna id ou null. */
async function _atTecnicoIdPorToken(token) {
  const { rows } = await pool.query(
    `SELECT id FROM sac.controle_tecnicos WHERE token = $1 LIMIT 1`,
    [token]
  );
  return rows[0]?.id || null;
}

/**
 * Aplica NFe já enviada ao storage em um conjunto de OS do técnico.
 * Reutiliza o mesmo path/url (1 arquivo → N OS).
 */
async function _atAplicarNfeEmOs(tecId, idsAt, nfeUrl, pathKey) {
  const ids = [...new Set(
    (Array.isArray(idsAt) ? idsAt : [])
      .map((v) => parseInt(v, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  )];
  if (!ids.length) return { atualizados: [], rejeitados: [{ motivo: 'Nenhuma OS informada.' }] };

  const { rows: okRows } = await pool.query(
    `SELECT f.id_at, f.nfe_path_key, f.status_os
     FROM sac.fechamento f
     WHERE f.id_tecnico = $1 AND f.id_at = ANY($2::int[])`,
    [tecId, ids]
  );
  const porId = new Map(okRows.map((r) => [Number(r.id_at), r]));
  const atualizados = [];
  const rejeitados = [];
  const oldKeys = new Set();

  for (const idAt of ids) {
    const row = porId.get(idAt);
    if (!row) {
      rejeitados.push({ id_at: idAt, motivo: 'OS não vinculada a este técnico.' });
      continue;
    }
    if (row.nfe_path_key && row.nfe_path_key !== pathKey) oldKeys.add(row.nfe_path_key);
    await pool.query(
      `UPDATE sac.fechamento
       SET nfe_url = $2, nfe_path_key = $3, status_os = 'finalizado', data_envio_nfe = NOW()
       WHERE id_at = $1 AND id_tecnico = $4`,
      [idAt, nfeUrl, pathKey, tecId]
    );
    atualizados.push(idAt);
  }

  for (const old of oldKeys) {
    // Só remove se nenhuma outra OS do técnico ainda usa o path antigo
    const { rows: still } = await pool.query(
      `SELECT 1 FROM sac.fechamento WHERE nfe_path_key = $1 LIMIT 1`,
      [old]
    );
    if (!still.length) {
      supabase.storage.from(AT_BUCKET).remove([old]).catch(() => {});
    }
  }
  return { atualizados, rejeitados };
}

// POST /at/tecnico/fechamento/nfe-lote?token=TOKEN
// FormData: nfe (arquivo) + ids_at (JSON array ou lista separada por vírgula)
router.post('/at/tecnico/fechamento/nfe-lote', atUpload.single('nfe'), async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  let idsRaw = req.body?.ids_at;
  let idsAt = [];
  if (typeof idsRaw === 'string' && idsRaw.trim().startsWith('[')) {
    try { idsAt = JSON.parse(idsRaw); } catch { idsAt = []; }
  } else if (typeof idsRaw === 'string') {
    idsAt = idsRaw.split(/[,;\s]+/).filter(Boolean);
  } else if (Array.isArray(idsRaw)) {
    idsAt = idsRaw;
  }

  try {
    const tecId = await _atTecnicoIdPorToken(token);
    if (!tecId) return res.status(404).json({ error: 'Link inválido' });

    const file = req.file;
    const mimeExt = mime.extension(file.mimetype);
    const originalExt = (file.originalname || '').split('.').pop();
    const ext = (mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
    const safeName = atSanitizeFileName(file.originalname, ext);
    const pathKey = `at-nfe/lote/${uuidv4()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from(AT_BUCKET).upload(pathKey, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false
    });
    if (upErr) throw new Error(`Storage upload: ${upErr.message}`);
    const { data: pubData } = supabase.storage.from(AT_BUCKET).getPublicUrl(pathKey);
    const nfeUrl = pubData?.publicUrl || '';

    const { atualizados, rejeitados } = await _atAplicarNfeEmOs(tecId, idsAt, nfeUrl, pathKey);
    if (!atualizados.length) {
      supabase.storage.from(AT_BUCKET).remove([pathKey]).catch(() => {});
      return res.status(400).json({
        error: 'Nenhuma OS pôde receber a NFe.',
        rejeitados
      });
    }
    res.json({ ok: true, nfe_url: nfeUrl, atualizados, rejeitados });
  } catch (err) {
    console.error('[AT/nfe-lote] upload erro:', err);
    res.status(500).json({ error: 'Falha no upload da NFe.', detail: String(err.message || err) });
  }
});

// POST /at/tecnico/fechamento/:id_at/nfe?token=TOKEN — upload da NFe (1 OS; mantido p/ compat)
router.post('/at/tecnico/fechamento/:id_at/nfe', atUpload.single('nfe'), async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at) return res.status(400).json({ error: 'id_at inválido' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  try {
    const tecId = await _atTecnicoIdPorToken(token);
    if (!tecId) return res.status(404).json({ error: 'Link inválido' });
    const { rows: tRows } = await pool.query(
      `SELECT 1 FROM sac.fechamento WHERE id_tecnico = $1 AND id_at = $2 LIMIT 1`,
      [tecId, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado.' });

    const file = req.file;
    const mimeExt = mime.extension(file.mimetype);
    const originalExt = (file.originalname || '').split('.').pop();
    const ext = (mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
    const safeName = atSanitizeFileName(file.originalname, ext);
    const pathKey = `at-nfe/${id_at}/${uuidv4()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from(AT_BUCKET).upload(pathKey, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false
    });
    if (upErr) throw new Error(`Storage upload: ${upErr.message}`);
    const { data: pubData } = supabase.storage.from(AT_BUCKET).getPublicUrl(pathKey);
    const nfeUrl = pubData?.publicUrl || '';

    const { atualizados, rejeitados } = await _atAplicarNfeEmOs(tecId, [id_at], nfeUrl, pathKey);
    if (!atualizados.length) {
      return res.status(400).json({ error: rejeitados[0]?.motivo || 'Não foi possível aplicar a NFe.' });
    }
    res.json({ ok: true, nfe_url: nfeUrl });
  } catch (err) {
    console.error('[AT/nfe] upload erro:', err);
    res.status(500).json({ error: 'Falha no upload da NFe.', detail: String(err.message || err) });
  }
});

// GET /at/tecnico/fechamento/:id_at/evidencias?token=TOKEN — lista evidências enviadas pelo técnico
router.get('/at/tecnico/fechamento/:id_at/evidencias', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at) return res.status(400).json({ error: 'id_at inválido' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT ct.id FROM sac.controle_tecnicos ct
       JOIN sac.fechamento f ON f.id_tecnico = ct.id
       WHERE ct.token = $1 AND f.id_at = $2 LIMIT 1`,
      [token, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado.' });
    const { rows } = await pool.query(
      `SELECT id, nome_arquivo, url_publica, content_type, tamanho_bytes, criado_em
       FROM sac.at_anexos WHERE id_at = $1 ORDER BY criado_em ASC`,
      [id_at]
    );
    res.json({ ok: true, evidencias: rows });
  } catch (err) {
    console.error('[AT/evidencias] get erro:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /at/tecnico/fechamento/:id_at/evidencias?token=TOKEN — upload de fotos/vídeos de evidência
router.post('/at/tecnico/fechamento/:id_at/evidencias', atUpload.array('evidencias', 10), async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at) return res.status(400).json({ error: 'id_at inválido' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT ct.id FROM sac.controle_tecnicos ct
       JOIN sac.fechamento f ON f.id_tecnico = ct.id
       WHERE ct.token = $1 AND f.id_at = $2 LIMIT 1`,
      [token, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado.' });
    const inseridos = [];
    for (const file of req.files) {
      const mimeExt = mime.extension(file.mimetype);
      const originalExt = (file.originalname || '').split('.').pop();
      const ext = (mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
      const safeName = atSanitizeFileName(file.originalname, ext);
      const pathKey = `at-evidencias/${id_at}/${uuidv4()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from(AT_BUCKET).upload(pathKey, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: false
      });
      if (upErr) throw new Error(`Supabase upload: ${upErr.message}`);
      const { data: pubData } = supabase.storage.from(AT_BUCKET).getPublicUrl(pathKey);
      const urlPublica = pubData?.publicUrl || '';
      const ins = await pool.query(
        `INSERT INTO sac.at_anexos (id_at, nome_arquivo, path_key, url_publica, content_type, tamanho_bytes, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,'tecnico') RETURNING id, nome_arquivo, url_publica, content_type, tamanho_bytes, criado_em`,
        [id_at, safeName, pathKey, urlPublica, file.mimetype || null, file.size || null]
      );
      inseridos.push(ins.rows[0]);
    }
    res.json({ ok: true, evidencias: inseridos });
  } catch (err) {
    console.error('[AT/evidencias] upload erro:', err);
    res.status(500).json({ error: 'Falha no upload.', detail: String(err.message || err) });
  }
});

// DELETE /at/tecnico/fechamento/:id_at/evidencias/:id_evidencia?token=TOKEN — remove evidência
router.delete('/at/tecnico/fechamento/:id_at/evidencias/:id_evidencia', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  const idEvidencia = parseInt(req.params.id_evidencia, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at || !idEvidencia) return res.status(400).json({ error: 'Parâmetros inválidos.' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT ct.id FROM sac.controle_tecnicos ct
       JOIN sac.fechamento f ON f.id_tecnico = ct.id
       WHERE ct.token = $1 AND f.id_at = $2 LIMIT 1`,
      [token, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado.' });
    const { rows } = await pool.query(
      `DELETE FROM sac.at_anexos WHERE id = $1 AND id_at = $2 RETURNING path_key`,
      [idEvidencia, id_at]
    );
    if (!rows.length) return res.status(404).json({ error: 'Anexo não encontrado.' });
    supabase.storage.from(AT_BUCKET).remove([rows[0].path_key]).catch(e =>
      console.warn('[AT/evidencias] falha ao remover do storage:', e?.message)
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[AT/evidencias] delete erro:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/whatsapp/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = String(req.query['hub.challenge'] || '').trim();

  if (!WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.error('[whatsapp/webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN ausente. Recusando verificação.');
    return res.status(503).send('verify_token_not_configured');
  }

  if (mode === 'subscribe' && token && token === WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge || 'ok');
  }
  return res.status(403).send('forbidden');
});

router.post('/whatsapp/webhook', express.json({ limit: '2mb' }), async (req, res) => {
  const body = req.body || {};
  const entries = Array.isArray(body.entry) ? body.entry : [];
  const receivedPhones = new Set();
  const newInboundMessages = [];

  try {
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const metadata = value?.metadata || {};
        const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
        const messages = Array.isArray(value?.messages) ? value.messages : [];

        const profileNameByWaId = new Map();
        contacts.forEach((contact) => {
          const waId = String(contact?.wa_id || '').trim();
          const name = String(contact?.profile?.name || '').trim();
          if (waId) profileNameByWaId.set(waId, name);
        });

        for (const message of messages) {
          const waMessageId = String(message?.id || '').trim() || null;
          const fromPhone = String(message?.from || '').trim() || null;
          const fromPhoneDigits = normalizePhoneDigits(fromPhone);
          const messageType = String(message?.type || '').trim() || null;
          // Suporta texto normal e clique em botão interativo
          const textBody = String(
            message?.text?.body
            || message?.interactive?.button_reply?.title
            || message?.interactive?.list_reply?.title
            || ''
          ).trim() || null;
          const profileName = profileNameByWaId.get(String(message?.from || '').trim()) || null;
          if (fromPhoneDigits) receivedPhones.add(fromPhoneDigits);

          const insertResult = await pool.query(
            `INSERT INTO sac.whatsapp_webhook_messages (
               wa_message_id,
               from_phone,
               from_phone_digits,
               profile_name,
               direction,
               message_type,
               message_text,
               phone_number_id,
               display_phone_number,
                payload_json
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (wa_message_id) DO UPDATE
               SET message_text = EXCLUDED.message_text,
                   profile_name = COALESCE(EXCLUDED.profile_name, sac.whatsapp_webhook_messages.profile_name),
                   payload_json = EXCLUDED.payload_json
             RETURNING ((xmax = 0) AND (wa_message_id IS NOT NULL)) AS inserted`,
            [
              waMessageId,
              fromPhone,
              fromPhoneDigits || null,
              profileName,
              'inbound',
              messageType,
              textBody,
              String(metadata?.phone_number_id || '').trim() || null,
              String(metadata?.display_phone_number || '').trim() || null,
              message || {}
            ]
          );

          if (insertResult.rows[0]?.inserted && fromPhoneDigits && textBody) {
            newInboundMessages.push({
              phone: fromPhoneDigits,
              profileName,
              messageText: textBody,
              waMessageId,
              buttonReplyId: String(message?.interactive?.button_reply?.id || '').trim() || null,
              listReplyId: String(message?.interactive?.list_reply?.id || '').trim() || null,
              phoneNumberId: String(metadata?.phone_number_id || '').trim() || null,
              displayPhoneNumber: String(metadata?.display_phone_number || '').trim() || null
            });
          }
        }
      }
    }

    if (receivedPhones.size) {
      try {
        const sse = req.app?.get('sseBroadcast');
        if (typeof sse === 'function') {
          const phones = Array.from(receivedPhones);
          sse({
            type: 'whatsapp_message_received',
            at: Date.now(),
            phones
          });
        }
      } catch (_) {}
    }

    if (newInboundMessages.length) {
      const sse = req.app?.get('sseBroadcast');
      for (const inbound of newInboundMessages) {
        enqueueWhatsappByPhone(inbound.phone, async () => {
          try {
            // Intercepta clique do botão "Marcar como lidas" da notificação diária
            if (inbound.buttonReplyId && inbound.buttonReplyId.startsWith('sgf_marcar_lidas_')) {
              const uid = Number(inbound.buttonReplyId.replace('sgf_marcar_lidas_', ''));
              if (uid > 0) {
                await pool.query(
                  'UPDATE public.chat_messages SET is_read = true, updated_at = NOW() WHERE to_user_id = $1 AND is_read = false',
                  [uid]
                );
                await enviarMensagemWhatsappTexto({
                  phoneNumberId: inbound.phoneNumberId,
                  toPhone: inbound.phone,
                  text: '✅ Mensagens marcadas como lidas no SGF.'
                });
                console.log('[Notif] Mensagens marcadas como lidas para user_id:', uid);
              }
              return;
            }

            await processarRespostaAutomaticaWhatsapp(inbound);
            if (typeof sse === 'function') {
              sse({
                type: 'whatsapp_message_received',
                at: Date.now(),
                phones: [inbound.phone]
              });
            }
          } catch (autoReplyErr) {
            console.error('[SAC/WhatsApp] falha na resposta automática:', autoReplyErr?.message || autoReplyErr);
          }
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[SAC/WhatsApp] erro ao processar webhook:', err);
    return res.status(500).json({ ok: false });
  }
});

router.get('/whatsapp/conversations', async (req, res) => {
  const limitValue = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 30;

  try {
    const { rows } = await pool.query(
      `WITH base AS (
         SELECT id,
                from_phone,
                from_phone_digits,
                profile_name,
                direction,
                message_type,
                message_text,
                received_at
           FROM sac.whatsapp_webhook_messages
          WHERE COALESCE(from_phone_digits, '') <> ''
       ),
       ranked AS (
         SELECT id,
                from_phone,
                from_phone_digits,
                profile_name,
                direction,
                message_type,
                message_text,
                received_at,
                ROW_NUMBER() OVER (
                  PARTITION BY from_phone_digits
                  ORDER BY received_at DESC, id DESC
                ) AS rn,
                COUNT(*) OVER (PARTITION BY from_phone_digits) AS total_messages
           FROM base
       ),
       inbound_name AS (
         SELECT DISTINCT ON (from_phone_digits)
                from_phone_digits,
                profile_name AS contact_name
           FROM base
          WHERE direction = 'inbound'
            AND COALESCE(NULLIF(TRIM(profile_name), ''), '') <> ''
          ORDER BY from_phone_digits, received_at DESC, id DESC
       )
       SELECT r.from_phone,
              r.from_phone_digits,
              r.profile_name,
              COALESCE(i.contact_name, NULLIF(TRIM(r.profile_name), '')) AS contact_name,
              r.direction AS last_direction,
              r.message_type AS last_message_type,
              r.message_text AS last_message_text,
              r.received_at AS last_received_at,
              r.total_messages,
              COALESCE(rs.last_read_at, (TIMESTAMP '1970-01-01')) AS last_read_at
         FROM ranked r
         LEFT JOIN inbound_name i ON i.from_phone_digits = r.from_phone_digits
         LEFT JOIN sac.whatsapp_conversation_read_status rs ON rs.from_phone_digits = r.from_phone_digits
        WHERE r.rn = 1
        ORDER BY r.received_at DESC
        LIMIT $1`,
      [limit]
    );
    return res.json({ ok: true, conversations: rows });
  } catch (err) {
    console.error('[SAC/WhatsApp] erro ao listar conversas:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao listar conversas do WhatsApp.' });
  }
});

router.post('/whatsapp/mark-read', express.json({ limit: '10kb' }), async (req, res) => {
  const phoneDigits = String(req.body?.phone_digits || '').trim();
  if (!phoneDigits) {
    return res.status(400).json({ ok: false, error: 'phone_digits é obrigatório.' });
  }

  try {
    await pool.query(
      `INSERT INTO sac.whatsapp_conversation_read_status (from_phone_digits, last_read_at, created_at, updated_at)
       VALUES ($1, NOW(), NOW(), NOW())
       ON CONFLICT (from_phone_digits) DO UPDATE SET
         last_read_at = NOW(),
         updated_at = NOW()`,
      [phoneDigits]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[SAC/WhatsApp] erro ao marcar conversa como lida:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao marcar como lido.' });
  }
});

router.post('/whatsapp/reply', express.json({ limit: '30kb' }), async (req, res) => {
  const phoneDigits = normalizePhoneDigits(req.body?.phone);
  const text = String(req.body?.text || '').trim();
  const mode = String(req.body?.mode || 'manual').trim().toLowerCase();

  if (!phoneDigits) {
    return res.status(400).json({ ok: false, error: 'Telefone da conversa é obrigatório.' });
  }
  if (!text) {
    return res.status(400).json({ ok: false, error: 'Texto da resposta é obrigatório.' });
  }

  try {
    const context = await obterContextoWhatsappPorTelefone(phoneDigits);
    if (!context?.phone_number_id) {
      return res.status(404).json({ ok: false, error: 'Phone Number ID não encontrado para esta conversa.' });
    }

    let sendPayload = null;
    let outboundMessageId = null;

    if (mode === 'chatbot') {
      const historyRows = await listarHistoricoWhatsapp(phoneDigits, 12);
      const replyData = await gerarRespostaAutomaticaWhatsapp({
        phone: phoneDigits,
        profileName: context.profile_name || '',
        userMessage: text,
        historyRows
      });
      const sendResult = await enviarRespostaWhatsappComMidia({
        phoneDigits,
        profileName: 'Chatbot Fromtherm',
        phoneNumberId: context.phone_number_id,
        displayPhoneNumber: context.display_phone_number || null,
        requestText: text,
        replyData
      });
      sendPayload = sendResult?.sendPayload || null;
      outboundMessageId = sendResult?.outboundMessageId || null;
    } else {
      sendPayload = await enviarMensagemWhatsappTexto({
        phoneNumberId: context.phone_number_id,
        toPhone: phoneDigits,
        text
      });

      outboundMessageId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
      await insertWhatsappMessageRecord({
        waMessageId: outboundMessageId,
        phone: phoneDigits,
        profileName: 'Atendente Fromtherm',
        messageType: 'text',
        messageText: text,
        phoneNumberId: context.phone_number_id,
        displayPhoneNumber: context.display_phone_number || null,
        payload: sendPayload,
        direction: 'outbound'
      });
    }

    console.log(
      '[SAC/WhatsApp] resposta manual enviada:',
      JSON.stringify({
        from_phone_number_id: context.phone_number_id,
        to_phone_requested: phoneDigits,
        to_phone_sent: sendPayload?.__meta?.sent_to || null,
        outbound_message_id: outboundMessageId,
        mode
      })
    );

    try {
      const sse = req.app?.get('sseBroadcast');
      if (typeof sse === 'function') {
        sse({
          type: 'whatsapp_message_received',
          at: Date.now(),
          phones: [phoneDigits]
        });
      }
    } catch (_) {}

    return res.json({ ok: true, phone: phoneDigits, mode });
  } catch (err) {
    console.error('[SAC/WhatsApp] erro ao responder conversa:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Falha ao enviar resposta do WhatsApp.' });
  }
});

router.get('/whatsapp/messages', async (req, res) => {
  const phoneDigits = normalizePhoneDigits(req.query.phone);

  try {
    let rows;
    if (phoneDigits) {
      const candidates = Array.from(new Set([
        phoneDigits,
        phoneDigits.startsWith('55') ? phoneDigits.slice(2) : `55${phoneDigits}`
      ].filter(Boolean)));

      ({ rows } = await pool.query(
        `SELECT id, wa_message_id, from_phone, from_phone_digits, profile_name, direction, message_type,
                message_text, phone_number_id, display_phone_number, payload_json, received_at
           FROM (
             SELECT id, wa_message_id, from_phone, from_phone_digits, profile_name, direction, message_type,
                    message_text, phone_number_id, display_phone_number, payload_json, received_at
               FROM sac.whatsapp_webhook_messages
              WHERE from_phone_digits = ANY($1::text[])
              ORDER BY received_at DESC, id DESC
              LIMIT 50
           ) latest_messages
          ORDER BY received_at ASC, id ASC`,
        [candidates]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, wa_message_id, from_phone, from_phone_digits, profile_name, direction, message_type,
                message_text, phone_number_id, display_phone_number, payload_json, received_at
           FROM sac.whatsapp_webhook_messages
          ORDER BY received_at DESC, id DESC
          LIMIT 20`
      ));
    }
    return res.json({ ok: true, messages: rows });
  } catch (err) {
    console.error('[SAC/WhatsApp] erro ao listar mensagens:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao listar mensagens do WhatsApp.' });
  }
});

// GET /api/sac/cmc — retorna mapa {codigo_5chars: cmc} para todos os produtos com CMC cadastrado
// Usa os últimos 5 caracteres do campo codigo (ex: "04.MP.N.61016" → "61016")
router.get('/cmc', async (_req, res) => {
  try {
    const sql = `
      SELECT
        RIGHT(codigo, 5) AS codigo_5,
        MAX(cmc) AS cmc
      FROM logistica.estoque_atual
      WHERE cmc IS NOT NULL AND cmc > 0
        AND LENGTH(codigo) >= 5
      GROUP BY RIGHT(codigo, 5)
    `;
    const { rows } = await pool.query(sql);
    const mapa = {};
    rows.forEach((r) => {
      mapa[String(r.codigo_5)] = Number(r.cmc) || 0;
    });
    return res.json({ ok: true, cmc: mapa });
  } catch (err) {
    console.error('[SAC/CMC] erro ao buscar CMC:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao buscar CMC.' });
  }
});

// GET /api/sac/at-info?ids=173,88,95 — retorna tag_problema + descreva_reclamacao do sac.at para os IDs informados
router.get('/at-info', async (req, res) => {
  try {
    const ids = String(req.query?.ids || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (!ids.length) return res.json({ ok: true, data: {} });
    const { rows } = await pool.query(
      `SELECT id, tag_problema, descreva_reclamacao FROM sac."at" WHERE id = ANY($1::bigint[])`,
      [ids]
    );
    const data = {};
    rows.forEach((r) => {
      data[String(r.id)] = {
        tag_problema: r.tag_problema || null,
        descreva_reclamacao: r.descreva_reclamacao || null
      };
    });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[SAC/AT-INFO] erro:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao buscar dados do AT.' });
  }
});

// GET /at/tecnico/separacao/permissao?token= — verifica CNPJ autorizado
router.get('/at/tecnico/separacao/permissao', async (req, res) => {
  const token = String(req.query.token || '').trim();
  try {
    const tecnico = await _atResolverTecnicoToken(token);
    if (!tecnico) return res.status(404).json({ ok: false, error: 'Link inválido' });
    res.json({ ok: true, permitido: _atSepCnpjPermitido(tecnico.cnpj_cpf) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/tecnico/separacao/produtos?q=&token= — busca em produtos_omie (mín. 4 caracteres)
router.get('/at/tecnico/separacao/produtos', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const q = String(req.query.q || '').trim();
  if (q.length < 4) return res.json({ ok: true, itens: [] });
  const auth = await _atResolverTecnicoSep(token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  try {
    const term = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT
          po.codigo,
          po.codigo_produto,
          po.descricao,
          COALESCE(po.unidade, 'UN') AS unidade,
          img.url_imagem
         FROM public.produtos_omie po
         LEFT JOIN LATERAL (
           SELECT i.url_imagem
             FROM public.produtos_omie_imagens i
            WHERE i.codigo_produto = po.codigo_produto
              AND i.ativo = true
              AND i.url_imagem IS NOT NULL
              AND TRIM(i.url_imagem) <> ''
            ORDER BY i.pos ASC
            LIMIT 1
         ) img ON true
        WHERE po.codigo ILIKE $1
           OR CAST(po.codigo_produto AS TEXT) ILIKE $1
           OR po.descricao ILIKE $1
        ORDER BY po.codigo ASC
        LIMIT 40`,
      [term]
    );
    res.json({ ok: true, itens: rows });
  } catch (err) {
    console.error('[AT/separacao/produtos] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /at/tecnico/separacao  { token, codigo, descricao, quantidade, unidade }
router.post('/at/tecnico/separacao', express.json(), async (req, res) => {
  const { token, codigo, descricao, quantidade, unidade } = req.body || {};
  const auth = await _atResolverTecnicoSep(token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const { tecnico } = auth;
  if (!codigo || !quantidade || Number(quantidade) <= 0) {
    return res.status(400).json({ ok: false, error: 'Código e quantidade são obrigatórios.' });
  }
  const unidadeNorm = String(unidade || 'UN').toUpperCase();
  let quantidadeNorm = Number(quantidade);
  if (unidadeNorm === 'UN') quantidadeNorm = Math.max(1, Math.round(quantidadeNorm));
  const id_user = _atSepIdUser(tecnico.id);
  const nome_user = String(tecnico.nome || '').trim();
  try {
    await _atEnsureSepSchema();
    const omieRes = await pool.query(
      `SELECT codigo_produto FROM public.produtos_omie
        WHERE TRIM(codigo_produto::text) = TRIM($1)
           OR TRIM(codigo) = TRIM($1)
        ORDER BY CASE WHEN TRIM(codigo_produto::text) = TRIM($1) THEN 0 ELSE 1 END
        LIMIT 1`,
      [codigo]
    );
    const cod_omie = omieRes.rows[0]?.codigo_produto || null;
    const { rows: existentes } = await pool.query(
      `SELECT c.id
         FROM logistica.carrinho c
        WHERE c.id_user = $1
          AND c.codigo_produto = $2
          AND COALESCE(c.unidade, 'UN') = COALESCE($3, 'UN')
          AND NOT EXISTS (
            SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = c.id
          )
        ORDER BY c.criado_em ASC
        LIMIT 1`,
      [id_user, codigo, unidadeNorm]
    );
    if (existentes.length) {
      const existenteId = existentes[0].id;
      await pool.query(
        `UPDATE logistica.carrinho
            SET quantidade = quantidade + $1,
                descricao = COALESCE(descricao, $2),
                cod_omie = COALESCE(cod_omie, $3),
                nome_user = $4
          WHERE id = $5`,
        [quantidadeNorm, descricao || null, cod_omie, nome_user, existenteId]
      );
      return res.json({ ok: true, id: existenteId, merged: true });
    }
    const { rows } = await pool.query(
      `INSERT INTO logistica.carrinho (id_user, nome_user, codigo_produto, descricao, unidade, quantidade, cod_omie)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [id_user, nome_user, codigo, descricao || null, unidadeNorm, quantidadeNorm, cod_omie]
    );
    res.json({ ok: true, id: rows[0].id, merged: false });
  } catch (err) {
    console.error('[AT/separacao POST] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /at/tecnico/separacao/carrinho?token=
router.get('/at/tecnico/separacao/carrinho', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const auth = await _atResolverTecnicoSep(token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const id_user = _atSepIdUser(auth.tecnico.id);
  try {
    await _atEnsureSepSchema();
    const { rows } = await pool.query(
      `SELECT c.id, c.codigo_produto, c.descricao, c.unidade, c.quantidade,
              c.comentario, COALESCE(c.urgente, false) AS urgente, c.criado_em,
              img.url_imagem
         FROM logistica.carrinho c
         LEFT JOIN public.produtos_omie po ON po.codigo = c.codigo_produto
         LEFT JOIN LATERAL (
           SELECT i.url_imagem
             FROM public.produtos_omie_imagens i
            WHERE i.codigo_produto = po.codigo_produto
              AND i.ativo = true
              AND i.url_imagem IS NOT NULL
              AND TRIM(i.url_imagem) <> ''
            ORDER BY i.pos ASC
            LIMIT 1
         ) img ON true
        WHERE c.id_user = $1
          AND NOT EXISTS (
            SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = c.id
          )
        ORDER BY c.criado_em ASC`,
      [id_user]
    );
    const { rows: localRows } = await pool.query(
      `SELECT nome FROM public.omie_locais_estoque WHERE local_codigo = $1 LIMIT 1`,
      [AT_SEP_LOCAL_ESTOQUE]
    );
    res.json({
      ok: true,
      itens: rows,
      nome_user: auth.tecnico.nome,
      local_estoque: AT_SEP_LOCAL_ESTOQUE,
      local_nome: localRows[0]?.nome || AT_SEP_LOCAL_NOME_PADRAO
    });
  } catch (err) {
    console.error('[AT/separacao/carrinho GET] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /at/tecnico/separacao/carrinho/:id/quantidade  { token, quantidade }
router.patch('/at/tecnico/separacao/carrinho/:id/quantidade', express.json(), async (req, res) => {
  const auth = await _atResolverTecnicoSep(req.body?.token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const itemId = parseInt(req.params.id, 10);
  const qty = Number(req.body?.quantidade);
  if (!itemId || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ ok: false, error: 'Quantidade inválida.' });
  }
  const id_user = _atSepIdUser(auth.tecnico.id);
  try {
    const { rowCount } = await pool.query(
      `UPDATE logistica.carrinho SET quantidade = $1
        WHERE id = $2 AND id_user = $3
          AND NOT EXISTS (
            SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = logistica.carrinho.id
          )`,
      [qty, itemId, id_user]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'Item não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PATCH /at/tecnico/separacao/carrinho/:id/comentario  { token, comentario }
router.patch('/at/tecnico/separacao/carrinho/:id/comentario', express.json(), async (req, res) => {
  const auth = await _atResolverTecnicoSep(req.body?.token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const itemId = parseInt(req.params.id, 10);
  const comentario = String(req.body?.comentario || '').trim() || null;
  const id_user = _atSepIdUser(auth.tecnico.id);
  try {
    const { rowCount } = await pool.query(
      `UPDATE logistica.carrinho SET comentario = $1
        WHERE id = $2 AND id_user = $3
          AND NOT EXISTS (
            SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = logistica.carrinho.id
          )`,
      [comentario, itemId, id_user]
    );
    if (!rowCount) return res.status(404).json({ ok: false, error: 'Item não encontrado.' });
    res.json({ ok: true, comentario });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /at/tecnico/separacao/carrinho/:id?token=
router.delete('/at/tecnico/separacao/carrinho/:id', async (req, res) => {
  const token = String(req.query.token || req.body?.token || '').trim();
  const auth = await _atResolverTecnicoSep(token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const itemId = parseInt(req.params.id, 10);
  const id_user = _atSepIdUser(auth.tecnico.id);
  try {
    await pool.query(`DELETE FROM logistica.carrinho WHERE id = $1 AND id_user = $2`, [itemId, id_user]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /at/tecnico/separacao/carrinho?token= — limpa carrinho
router.delete('/at/tecnico/separacao/carrinho', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const auth = await _atResolverTecnicoSep(token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const id_user = _atSepIdUser(auth.tecnico.id);
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM logistica.carrinho c
        WHERE c.id_user = $1
          AND NOT EXISTS (
            SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = c.id
          )`,
      [id_user]
    );
    res.json({ ok: true, deleted: rowCount || 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /at/tecnico/separacao/enviar  { token, data_prevista, horario, observacao }
router.post('/at/tecnico/separacao/enviar', express.json(), async (req, res) => {
  const { token, data_prevista, horario, observacao } = req.body || {};
  const auth = await _atResolverTecnicoSep(token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const { tecnico } = auth;
  const id_user = _atSepIdUser(tecnico.id);
  const nome_user = String(tecnico.nome || '').trim();
  const solicitadoPara = nome_user;
  const client = await pool.connect();
  try {
    await _atEnsureSepSchema(client);
    await client.query('BEGIN');

    const { rows: localRows } = await client.query(
      `SELECT nome FROM public.omie_locais_estoque WHERE local_codigo = $1 LIMIT 1`,
      [AT_SEP_LOCAL_ESTOQUE]
    );
    const codLocalGravar = AT_SEP_LOCAL_ESTOQUE;
    const nomeLocalGravar = localRows[0]?.nome || AT_SEP_LOCAL_NOME_PADRAO;

    const { rows: itens } = await client.query(
      `SELECT id, codigo_produto, descricao, unidade, quantidade, comentario,
              COALESCE(urgente, false) AS urgente
         FROM logistica.carrinho
        WHERE id_user = $1
          AND NOT EXISTS (
            SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = logistica.carrinho.id
          )
        ORDER BY criado_em ASC`,
      [id_user]
    );
    if (!itens.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Carrinho vazio.' });
    }

    await client.query(
      `UPDATE logistica.carrinho
          SET data_prevista = $1, horario = $2, retirada_por = $3, nome_user = $4
        WHERE id_user = $5
          AND NOT EXISTS (
            SELECT 1 FROM solicitacao_produto.itens_solicitados i WHERE i.id_carr = logistica.carrinho.id
          )`,
      [data_prevista || null, horario || null, solicitadoPara, nome_user, id_user]
    );

    // Próximo SEP: max(itens_solicitados, envios.solicitacoes) — evita reuso após limpeza parcial
    const { rows: [seq] } = await client.query(`
      SELECT GREATEST(
        COALESCE((
          SELECT MAX(SUBSTRING(n_solic FROM 5)::integer)
            FROM solicitacao_produto.itens_solicitados
           WHERE n_solic ~ '^SEP-[0-9]+$'
        ), 999),
        COALESCE((
          SELECT MAX(SUBSTRING(numero_sep FROM 5)::integer)
            FROM envios.solicitacoes
           WHERE numero_sep ~ '^SEP-[0-9]+$'
        ), 999)
      ) + 1 AS next_num
    `);
    const nSolic = `SEP-${Math.max(1000, seq.next_num)}`;

    for (const item of itens) {
      await client.query(
        `INSERT INTO solicitacao_produto.solicitacoes_separacao
           (id_user, nome_user, solicitado_para, codigo_produto, descricao, unidade, quantidade,
            data_prevista, horario, observacao, n_solic, urgente)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id_user, nome_user, solicitadoPara, item.codigo_produto, item.descricao, item.unidade,
         item.quantidade, data_prevista || null, horario || null, item.comentario || null,
         nSolic, item.urgente || false]
      );
      await client.query(
        `INSERT INTO solicitacao_produto.itens_solicitados
           (id_carr, n_solic, status, observacao, motivo, cod_local, nome_local, urgente)
         VALUES ($1, $2, 'pendente', $3, 'AT', $4, $5, $6)`,
        [item.id, nSolic, observacao || null, codLocalGravar, nomeLocalGravar, item.urgente || false]
      );
    }

    await client.query('COMMIT');
    console.log(`[AT/Separação] ${nSolic} enviado por ${nome_user} (${itens.length} itens)`);
    res.json({ ok: true, total: itens.length, n_solic: nSolic });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[AT/separacao/enviar] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// GET /at/tecnico/separacao/acompanhamento?token= — SEPs do técnico (portal AT) com status por etapa
router.get('/at/tecnico/separacao/acompanhamento', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const auth = await _atResolverTecnicoSep(token);
  if (auth.error) return res.status(auth.status).json({ ok: false, error: auth.error });
  const id_user = _atSepIdUser(auth.tecnico.id);
  try {
    const { rows } = await pool.query(
      `SELECT
          i.n_solic,
          COALESCE(c.retirada_por, c.nome_user) AS solicitante,
          MIN(c.data_prevista)::text AS data_prevista,
          MIN(c.horario) AS horario,
          COUNT(*)::int AS total_itens,
          MIN(c.criado_em) AS criado_em,
          MAX(i.criado_em) AS atualizado_em,
          bool_or(COALESCE(i.urgente, false)) AS tem_urgente,
          CASE
            WHEN bool_or(i.status = 'pendente') THEN 'Solicitado'
            WHEN bool_or(i.status = 'Stund-by') THEN 'Stund-by'
            WHEN bool_or(i.status IN ('Separação', 'Em Separação')) THEN 'Em Separação'
            WHEN bool_or(i.status = 'Separado') THEN 'Separado'
            WHEN bool_or(i.status = 'Aguardando retirada') THEN 'Aguardando retirada'
            ELSE 'Concluído'
          END AS status_sep
         FROM solicitacao_produto.itens_solicitados i
         JOIN logistica.carrinho c ON c.id = i.id_carr
        WHERE i.n_solic IS NOT NULL
          AND c.id_user = $1
        GROUP BY i.n_solic, COALESCE(c.retirada_por, c.nome_user)
        ORDER BY MIN(c.criado_em) DESC
        LIMIT 120`,
      [id_user]
    );

    const nSolicList = rows.map(r => r.n_solic).filter(Boolean);
    let itensMap = {};
    if (nSolicList.length) {
      const { rows: itensRows } = await pool.query(
        `SELECT
            i.n_solic,
            c.codigo_produto,
            c.descricao,
            c.unidade,
            c.quantidade,
            i.status,
            COALESCE(i.urgente, false) AS urgente
           FROM solicitacao_produto.itens_solicitados i
           JOIN logistica.carrinho c ON c.id = i.id_carr
          WHERE i.n_solic = ANY($1::text[])
            AND c.id_user = $2
          ORDER BY i.n_solic, c.criado_em ASC`,
        [nSolicList, id_user]
      );
      itensMap = itensRows.reduce((acc, it) => {
        const key = it.n_solic;
        if (!acc[key]) acc[key] = [];
        acc[key].push({
          codigo_produto: it.codigo_produto,
          descricao: it.descricao,
          unidade: it.unidade,
          quantidade: it.quantidade,
          status: it.status,
          urgente: it.urgente
        });
        return acc;
      }, {});
    }

    const seps = rows.map(r => ({
      n_solic: r.n_solic,
      solicitante: r.solicitante,
      data_prevista: r.data_prevista,
      horario: r.horario,
      total_itens: r.total_itens,
      criado_em: r.criado_em,
      atualizado_em: r.atualizado_em,
      tem_urgente: r.tem_urgente,
      status_sep: r.status_sep,
      itens: itensMap[r.n_solic] || []
    })).sort((a, b) => {
      const aDone = a.status_sep === 'Concluído' ? 1 : 0;
      const bDone = b.status_sep === 'Concluído' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return new Date(b.criado_em || 0) - new Date(a.criado_em || 0);
    });

    res.json({ ok: true, seps });
  } catch (err) {
    console.error('[AT/separacao/acompanhamento] erro:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Atualização em lote de rastreio (cron manual ou Render)
router.post('/cron/atualizar-rastreio', async (req, res) => {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const auth = String(req.headers['x-cron-secret'] || req.query?.secret || '').trim();
  if (secret && auth !== secret) {
    return res.status(401).json({ ok: false, error: 'Não autorizado.' });
  }

  try {
    const { executarAtualizacaoRastreioEnvios } = require('../utils/atualizarRastreioEnvios');
    const resumo = await executarAtualizacaoRastreioEnvios();
    return res.json({ ok: true, ...resumo });
  } catch (err) {
    console.error('[SAC] erro cron atualizar-rastreio:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Erro ao atualizar rastreio.' });
  }
});

module.exports = router;
