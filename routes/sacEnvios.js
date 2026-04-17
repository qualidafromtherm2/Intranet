const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const pdfParse = require('pdf-parse');
const fetch = require('node-fetch');
const { parse: csvParse } = require('csv-parse/sync');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const supabase = require('../utils/supabase');

const router = express.Router();

const STATUS_LIST = ['Pendente', 'Em separação', 'Aguardando correios', 'Enviado', 'Finalizado'];

const TRACK_USER = process.env.TRACK_USER || 'guest';
const TRACK_TOKEN = process.env.TRACK_TOKEN || 'guest';
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
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.META_WHATSAPP_VERIFY_TOKEN || 'fromtherm-sac-wa-teste-2026').trim();
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
  const csvUrl = `https://docs.google.com/spreadsheets/d/${PEDIDOS_SERIE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(PEDIDOS_SERIE_GID)}`;
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
  const csvUrl = `https://docs.google.com/spreadsheets/d/${TESTE_GAS_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(TESTE_GAS_SHEET_GID)}`;
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
  const t = texto.toLowerCase().trim();
  return /\b(quero comprar|preciso comprar|solicitar compra|requisição de compra|fazer compra|nova compra|abrir compra|comprar material|compra de material|iniciar compra)\b/i.test(t);
}

/**
 * Processa o fluxo de compras passo-a-passo.
 * Retorna { content } se o fluxo gerou resposta, ou null se não está em fluxo.
 */
async function processarFluxoCompras({ phoneDigits, userMessage, contatoInfo }) {
  const msg = String(userMessage || '').trim();
  const msgLower = msg.toLowerCase();
  let state = comprasFlowState.get(phoneDigits);

  // Cancelamento a qualquer momento
  if (state && /^(cancelar|sair|parar|cancel)$/i.test(msg)) {
    comprasFlowState.delete(phoneDigits);
    return { content: '❌ Fluxo de compras cancelado. Pode me perguntar qualquer coisa normalmente.' };
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
      if (msg === '1') {
        state.step = 'BUSCAR_PRODUTO';
        state.data.tipoCompra = 'omie';
        return { content: '🔍 Digite o *código ou nome* do produto para buscar no catálogo Omie:' };
      }
      if (msg === '2' || msg === '3') {
        state.step = 'DESCRICAO_PRODUTO';
        state.data.tipoCompra = 'sem_cadastro';
        return { content: '📝 Descreva o produto que precisa comprar:' };
      }
      return { content: 'Por favor, digite *1*, *2* ou *3*:\n\n1️⃣ Sim (cadastrado na Omie)\n2️⃣ Não\n3️⃣ Não sei' };
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
          state.data.departamentosLista = depts.map(d => d.nome);
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
      state.data.departamento = depts[escolha - 1];
      delete state.data.departamentosLista;
      state.step = 'OBSERVACAO';
      return { content: '📝 Alguma *observação*? (ou digite *pular*)' };
    }

    /* ---- Passo 4b: Departamento livre ---- */
    case 'DEPARTAMENTO_LIVRE': {
      if (msg.length < 2) return { content: 'Digite o nome do departamento:' };
      state.data.departamento = msg;
      state.step = 'OBSERVACAO';
      return { content: '📝 Alguma *observação*? (ou digite *pular*)' };
    }

    /* ---- Passo 5: Observação ---- */
    case 'OBSERVACAO': {
      if (!/^pular$/i.test(msg)) {
        state.data.observacao = msg;
      }
      state.step = 'CONFIRMACAO';
      // Monta resumo
      const d = state.data;
      let resumo = '📋 *Resumo da solicitação:*\n\n';
      if (d.produto_codigo) resumo += `• *Código:* ${d.produto_codigo}\n`;
      resumo += `• *Produto:* ${d.produto_descricao}\n`;
      resumo += `• *Quantidade:* ${d.quantidade}\n`;
      resumo += `• *Departamento:* ${d.departamento}\n`;
      if (d.observacao) resumo += `• *Obs:* ${d.observacao}\n`;
      resumo += `• *Solicitante:* ${d.solicitante}\n`;
      resumo += '\n*Confirmar solicitação?*\n\n1️⃣ Confirmar\n2️⃣ Cancelar';
      return { content: resumo };
    }

    /* ---- Passo 6: Confirmação ---- */
    case 'CONFIRMACAO': {
      if (msg === '2' || /^(n[aã]o|cancelar)$/i.test(msg)) {
        comprasFlowState.delete(phoneDigits);
        return { content: '❌ Solicitação cancelada.' };
      }
      if (msg !== '1' && !/^(sim|confirmar|ok)$/i.test(msg)) {
        return { content: 'Digite *1* para confirmar ou *2* para cancelar:' };
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
                objetivo_compra: d.observacao || 'Solicitação via WhatsApp',
                retorno_cotacao: 'Sim',
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
                  observacao: d.observacao || 'Solicitação via WhatsApp'
                }],
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

async function processarRespostaAutomaticaWhatsapp({ phone, profileName, messageText, phoneNumberId, displayPhoneNumber }) {
  if (!WHATSAPP_CHATBOT_AUTOREPLY_ENABLED) return;
  const phoneDigits = normalizePhoneDigits(phone);
  const userText = String(messageText || '').trim();
  if (!phoneDigits || !userText) return;

  // Verificar contato interno para fluxo de compras
  const contatoInfo = await verificarContatoInterno(phoneDigits);

  // Fluxo de compras interativo (apenas para contatos internos)
  if (contatoInfo.isInternal) {
    const comprasReply = await processarFluxoCompras({
      phoneDigits,
      userMessage: userText,
      contatoInfo
    });
    if (comprasReply) {
      // Envia resposta do fluxo de compras diretamente
      const sendPayload = await enviarMensagemWhatsappTexto({
        phoneNumberId,
        toPhone: phoneDigits,
        text: comprasReply.content
      });
      const outboundMessageId = String(sendPayload?.messages?.[0]?.id || '').trim() || null;
      await insertWhatsappMessageRecord({
        waMessageId: outboundMessageId,
        phone: phoneDigits,
        profileName: 'Chatbot Fromtherm',
        messageType: 'text',
        messageText: comprasReply.content,
        phoneNumberId,
        displayPhoneNumber,
        payload: sendPayload,
        direction: 'outbound'
      });
      console.log('[WhatsApp] resposta fluxo compras enviada:', JSON.stringify({
        mode: 'compras',
        from_phone_number_id: phoneNumberId,
        to_phone: phoneDigits,
        outbound_message_id: outboundMessageId
      }));
      return;
    }
  }

  const historyRows = await listarHistoricoWhatsapp(phoneDigits, 10);
  const replyData = await gerarRespostaAutomaticaWhatsapp({
    phone: phoneDigits,
    profileName,
    userMessage: userText,
    historyRows
  });
  const sendResult = await enviarRespostaWhatsappComMidia({
    phoneDigits,
    profileName: 'Chatbot Fromtherm',
    phoneNumberId,
    displayPhoneNumber,
    requestText: userText,
    replyData
  });

  console.log(
    '[WhatsApp] resposta automática enviada:',
    JSON.stringify({
      mode: replyData?.modo || 'externo',
      from_phone_number_id: phoneNumberId,
      to_phone_requested: phoneDigits,
      to_phone_sent: sendResult?.sendPayload?.__meta?.sent_to || null,
      outbound_message_id: sendResult?.outboundMessageId || null,
      media_messages: Array.isArray(sendResult?.mediaPayloads) ? sendResult.mediaPayloads.length : 0
    })
  );
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

async function persistStatus(codigo, { status, detalhe, local, cidade, uf, quando }) {
  const statusVal = String(status || '').trim() || 'sem status';
  const quandoVal = quando ? new Date(quando) : null;
  const isDelivered = /entregue ao destinat[áa]rio/i.test(statusVal) || /\bentregue\b/i.test(statusVal);

  try {
    await pool.query(
      `UPDATE envios.solicitacoes
          SET rastreio_status = $2,
              rastreio_quando = COALESCE($3, rastreio_quando),
              status = CASE
                         WHEN $4 AND status <> 'Finalizado' THEN 'Finalizado'
                         ELSE status
                       END,
              finalizado_em = CASE
                                WHEN $4 THEN COALESCE($3, finalizado_em, NOW())
                                ELSE finalizado_em
                              END
        WHERE upper(regexp_replace(COALESCE(identificacao, ''), '\\s+', '', 'g')) = $1
           OR upper(identificacao) = $1`,
      [codigo, statusVal, quandoVal, isDelivered]
    );
  } catch (err) {
    console.warn('[SAC] falha ao atualizar rastreio_status:', err?.message || err);
  }
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

// Extrai e formata o conteúdo da declaração de conteúdo (PDF)
function extractConteudo(textRaw) {
  const text = String(textRaw || '');
  const lower = text.toLowerCase();
  const startKey = 'identificação dos bens';
  const startKeyAlt = 'identificacao dos bens';
  let start = lower.indexOf(startKey);
  if (start === -1) start = lower.indexOf(startKeyAlt);
  if (start === -1) return null;

  const slice = text.slice(start);
  const lowerSlice = lower.slice(start);
  const endMarkers = ['totais', 'peso total', 'declaração', 'declaracao'];
  let end = slice.length;
  for (const mark of endMarkers) {
    const idx = lowerSlice.indexOf(mark);
    if (idx !== -1 && idx < end) end = idx;
  }

  let section = slice.slice(0, end);
  section = section.replace(/Identificação Dos Bens/i, '');
  section = section.replace(/Item\s*Conteúdo\s*Quant\.?\s*Valor/i, '');

  const lines = section
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const items = [];
  const seen = new Set();
  
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    
    // Ignora headers ou linhas puramente numéricas
    if (!/[A-Za-z]/.test(normalized)) continue;
    if (/^í?tem|^conte(ú|u)do|^quant|^valor/i.test(normalized)) continue;
    if (/(item|ítem).*(conte(ú|u)do)/i.test(normalized)) continue;
    if (/^totais?/i.test(normalized)) break;
    if (seen.has(normalized)) continue; // evita duplicar
    seen.add(normalized);
    
    // Extrai apenas conteúdo e quantidade (ignora coluna Item do PDF)
    // Quantidade deve ser apenas 1 ou 2 dígitos no FINAL da linha
    
    // Remove número inicial (coluna Item do PDF) se existir
    const withoutLeadingNumber = normalized.replace(/^\d+\s+/, '');
    
    // Tenta extrair quantidade: apenas 1 ou 2 dígitos no final
    const match = withoutLeadingNumber.match(/^(.+?)\s+(\d{1,2})\s*$/);
    
    if (match) {
      const conteudo = match[1].trim();
      const quantidade = match[2];
      
      items.push({
        conteudo: conteudo,
        quantidade: quantidade
      });
    } else {
      // Se não encontrou quantidade, adiciona com quantidade 1
      if (withoutLeadingNumber) {
        items.push({
          conteudo: withoutLeadingNumber,
          quantidade: '1'
        });
      }
    }
  }

  if (!items.length) return null;

  // Retorna em formato JSON para melhor estruturação no frontend
  return JSON.stringify(items);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const BUCKET = process.env.SUPABASE_BUCKET_SAC || process.env.SUPABASE_BUCKET || 'produtos';

// Upload em memória, máximo 12MB por arquivo, até 2 arquivos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 2 }
});

async function ensureSchema() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS envios;
    CREATE TABLE IF NOT EXISTS envios.solicitacoes (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      usuario TEXT NOT NULL,
      observacao TEXT,
      status TEXT NOT NULL DEFAULT 'Pendente',
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
      ADD COLUMN IF NOT EXISTS conteudo TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS rastreio_status TEXT;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS rastreio_quando TIMESTAMPTZ;

    ALTER TABLE envios.solicitacoes
      ADD COLUMN IF NOT EXISTS finalizado_em TIMESTAMPTZ;

    ALTER TABLE envios.solicitacoes
      ALTER COLUMN status SET DEFAULT 'Pendente';

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

    CREATE TABLE IF NOT EXISTS sac.alimentacao (
      id            BIGSERIAL PRIMARY KEY,
      letra_codigo  TEXT NOT NULL UNIQUE,
      degelo        TEXT,
      alimentacao   TEXT NOT NULL,
      criado_em     TIMESTAMP NOT NULL DEFAULT NOW()
    );

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
  `);
}

ensureSchema().catch(err => {
  console.error('[SAC] falha ao garantir schema/tabela envios:', err);
});

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
    atendimentoInicial: String(body.atendimento_inicial || '').trim() || null,
    modelo: String(body.modelo || '').trim() || null,
    tagProblema: String(body.tag_problema || '').trim() || null,
    plataformaAtendimento: String(body.plataforma_atendimento || '').trim() || null,
  };

  // Atendimento Rápido → sempre fechado automaticamente
  const statusInicial = (payload.tipo || '').toLowerCase() === 'atendimento rapido' ? 'Fechado' : null;

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
           atendimento_inicial,
           modelo,
           tag_problema,
           plataforma_atendimento,
           status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
          payload.atendimentoInicial,
          payload.modelo,
          payload.tagProblema,
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
           atendimento_inicial,
           modelo,
           tag_problema,
           plataforma_atendimento,
           status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
          payload.atendimentoInicial,
          payload.modelo,
          payload.tagProblema,
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

router.get('/at/atendimentos', async (_req, res) => {
  try {
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
           a.estado,
           a.cidade,
           a.descreva_reclamacao,
           a.atendimento_inicial,
           a.motivo_solicitacao,
           COALESCE(a.modelo, s.modelo) AS modelo,
           a.tag_problema,
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
           f.status_os                AS status_os,
           a.status                   AS status,
           ct.nome                    AS tecnico_nome,
           COALESCE(anx.qtd, 0)       AS qtd_anexos
         FROM sac.at a
         LEFT JOIN sac.at_busca_selecionada s  ON s.id_at = a.id
         LEFT JOIN sac.fechamento           f  ON f.id_at = a.id
         LEFT JOIN sac.controle_tecnicos    ct ON ct.id = f.id_tecnico
         LEFT JOIN anexos_cnt              anx ON anx.id_at = a.id
         ORDER BY a.id DESC, f.id DESC`
      ),
      // 2) Busca observacoes das solicitações (poucas linhas) em paralelo
      pool.query(`SELECT observacao FROM envios.solicitacoes WHERE observacao IS NOT NULL`)
    ]);

    const tQuery = Date.now() - t0;

    // 3) Computa has_pecas_enviadas em JS (~7ms em vez de ~38s no SQL)
    const osPattern = /O\.S\s+(\S+)/gi;
    const osTokens = new Set();
    for (const row of solResult.rows) {
      let m;
      while ((m = osPattern.exec(row.observacao)) !== null) {
        // Normaliza removendo hífens para match com "YYID" e "YY-ID"
        const raw = m[1].replace(/-/g, '');
        // Se tiver barra (ex: "260020/260021"), separa cada token
        for (const part of raw.split('/')) {
          if (part) osTokens.add(part);
        }
      }
    }

    const rows = mainResult.rows;
    for (const at of rows) {
      const yr = at.data ? new Date(at.data).getFullYear().toString().slice(-2) : '';
      const chaves = [at.atendimento_inicial, yr ? yr + at.id : ''].filter(Boolean);
      at.has_pecas_enviadas = chaves.some(ch => osTokens.has(ch.replace(/-/g, '')));
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
    modelo:                 'modelo',
    tag_problema:           'tag_problema',
    plataforma_atendimento: 'plataforma_atendimento',
    atendimento_inicial:    'atendimento_inicial',
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

  if (!setClauses.length)
    return res.status(400).json({ ok: false, error: 'Nenhum campo válido enviado.' });

  const usuarioLogado = req.session?.user?.fullName
                     || req.session?.user?.username
                     || req.session?.user?.login
                     || 'desconhecido';

  // editado_por como parâmetro; editado_em usa NOW() direto
  setClauses.push(`editado_por = $${setClauses.length + 1}`);
  colValues.push(usuarioLogado);
  setClauses.push(`editado_em = NOW()`);

  const values = [...colValues, id];

  try {
    await pool.query(
      `UPDATE sac.at SET ${setClauses.join(', ')} WHERE id = $${values.length}`,
      values
    );
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

  const VALORES_VALIDOS = ['Aberto', 'Fechado', 'Aguardando NF AT'];
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
    'data_conclusao_servico', 'observacoes', 'midias_servico'
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

router.post('/solicitacoes', upload.array('anexos', 2), async (req, res) => {
  const usuario = String(req.body?.usuario || '').trim();
  const observacao = String(req.body?.observacao || '').trim();
  const status = normalizeStatus(req.body?.status);

  if (!usuario) {
    return res.status(400).json({ ok: false, error: 'Usuário é obrigatório.' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  const urls = [];
  let identificacao = null;
  let conteudo = null;

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

      // Extrai conteúdo da declaração (assumindo segundo arquivo)
      if (index === 1 && !conteudo && file.mimetype === 'application/pdf') {
        try {
          const parsed = await pdfParse(file.buffer);
          conteudo = extractConteudo(parsed?.text);
        } catch (err) {
          console.warn('[SAC] não foi possível extrair conteúdo da declaração:', err?.message || err);
        }
      }
    }

    const etiquetaUrl = urls[0] || null;
    const declaracaoUrl = urls[1] || null;

    const result = await pool.query(
      `INSERT INTO envios.solicitacoes (usuario, observacao, status, anexos, conferido, etiqueta_url, declaracao_url, identificacao, conteudo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at, status, anexos, conferido, etiqueta_url, declaracao_url, identificacao, conteudo`,
      [usuario, observacao, status, urls, false, etiquetaUrl, declaracaoUrl, identificacao, conteudo]
    );

    const row = result.rows[0];
    return res.json({ ok: true, id: row.id, created_at: row.created_at, status: row.status, anexos: row.anexos, conferido: row.conferido, etiqueta_url: row.etiqueta_url, declaracao_url: row.declaracao_url, identificacao: row.identificacao, conteudo: row.conteudo });
  } catch (err) {
    console.error('[SAC] erro ao inserir solicitação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao registrar solicitação.' });
  }
});

// Lista solicitações de envio (com opção de filtrar por usuário logado)
router.get('/solicitacoes', async (req, res) => {
  try {
    const hideDone = String(req.query?.hideDone || '').toLowerCase() === 'true' || req.query?.hideDone === '1';
    // Novo parâmetro: filterByUser=1 indica que deve filtrar apenas registros do usuário logado
    const filterByUser = String(req.query?.filterByUser || '').toLowerCase() === 'true' || req.query?.filterByUser === '1';

    const conditions = [];
    const params = [];

    // Filtro por status (oculta Enviado e Finalizado)
    if (hideDone) {
      conditions.push("COALESCE(status, '') NOT IN ('Enviado', 'Finalizado')");
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
      `SELECT id, created_at, usuario, observacao, status, conferido, etiqueta_url, declaracao_url, identificacao, conteudo, rastreio_status, rastreio_quando, finalizado_em
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
          SET status = $1
        WHERE id = $2
      RETURNING id, status`,
      [status, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, status: r.rows[0].status });
  } catch (err) {
    console.error('[SAC] erro ao atualizar status:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar status.' });
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
          SET status = $1
        WHERE id = $2
      RETURNING id, status`,
      [status, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, status: r.rows[0].status });
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

// Endpoint para excluir (marcar status como "Excluído")
router.delete('/solicitacoes/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID inválido.' });
  }

  try {
    const r = await pool.query(
      `UPDATE envios.solicitacoes
          SET status = 'Excluído'
        WHERE id = $1
      RETURNING id, status`,
      [id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Registro não encontrado.' });
    }

    return res.json({ ok: true, status: r.rows[0].status });
  } catch (err) {
    console.error('[SAC] erro ao excluir solicitação:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao excluir solicitação.' });
  }
});

router.get('/at/busca-serie', async (req, res) => {
  const termo = String(req.query?.termo || '').trim();
  if (termo.length < 2) {
    return res.status(400).json({ ok: false, error: 'Informe ao menos 2 caracteres para a busca.' });
  }

  const termoNorm = normalizeText(termo);
  const maxResultados = 10;

  try {
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
         a.descreva_reclamacao,
         a.motivo_solicitacao,
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
            const dt = new Date(fc.data_conclusao_servico);
            if (isNaN(dt)) return String(fc.data_conclusao_servico);
            // data_conclusao_servico é DATE (sem timezone) — lê como local
            const [y, m, d2] = String(fc.data_conclusao_servico).substring(0, 10).split('-');
            return `${d2}/${m}/${y}`;
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
      atendimento_inicial: r.atendimento_inicial || '',
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

// GET /at/graficos/relatorio — dados para relatório PDF (últimos 3 meses), breakdown por tag × mês
router.get('/at/graficos/relatorio', async (req, res) => {
  try {
    const [rQ, rR, rM] = await Promise.all([
      // OS aberta (Qualidade) — por tag × mês
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(tag_problema),''), '(sem tag)') AS tag,
          TO_CHAR(DATE_TRUNC('month', data), 'YYYY-MM')        AS mes,
          COUNT(*)::int                                         AS total
        FROM sac.at
        WHERE LOWER(TRIM(tipo)) = 'qualidade'
          AND data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
          AND data <  DATE_TRUNC('month', CURRENT_DATE)
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
          AND data >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
          AND data <  DATE_TRUNC('month', CURRENT_DATE)
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
        WHERE m.criado_em >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '3 months'
          AND m.criado_em <  DATE_TRUNC('month', CURRENT_DATE)
          AND LOWER(TRIM(a.tipo)) NOT IN ('atendimento rapido','atendimento rápido')
        GROUP BY 1, 2
        ORDER BY tag, mes
      `),
    ]);

    // Meses do eixo X (YYYY-MM e label legível)
    const meses = [];
    const nomesMes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    for (let i = 3; i >= 1; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const yyyymm = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      meses.push({ yyyymm, label: `${nomesMes[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}` });
    }

    res.json({
      ok:      true,
      periodo: meses.map(m => m.label).join(' – '),
      meses,
      qualidade: rQ.rows,
      rapido:    rR.rows,
      mencoes:   rM.rows,
    });
  } catch (err) {
    console.error('[SAC/AT] erro relatorio:', err);
    res.status(500).json({ ok: false, error: err.message });
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

// GET /at/pecas-enviadas/:id — envios vinculados a esta OS via campo observacao
router.get('/at/pecas-enviadas/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID inválido.' });
  try {
    // Busca atendimento_inicial e id da AT para montar os padrões de busca
    const { rows: atRows } = await pool.query(
      `SELECT a.id, a.atendimento_inicial, a.data
       FROM sac.at a WHERE a.id = $1 LIMIT 1`,
      [id]
    );
    if (!atRows.length) return res.json([]);
    const at = atRows[0];
    // Padrões de match no campo observacao:
    // 1. atendimento_inicial exato (ex: "260093")
    // 2. formato ano2digitos + id sem zeros (ex: "262177")
    // 3. formato com traço (ex: "26-2177")
    const anoAT = at.data ? String(new Date(at.data).getFullYear()).slice(-2) : '';
    const patterns = [];
    if (at.atendimento_inicial) patterns.push(at.atendimento_inicial.trim());
    if (anoAT) {
      patterns.push(`${anoAT}${at.id}`);
      patterns.push(`${anoAT}-${at.id}`);
    }
    if (!patterns.length) return res.json([]);

    // Busca todos os registros onde algum padrão aparece após "O.S "
    const { rows } = await pool.query(
      `SELECT id, identificacao, observacao, conteudo, etiqueta_url, declaracao_url, anexos,
              status, created_at, usuario, rastreio_status
       FROM envios.solicitacoes
       WHERE ${ patterns.map((_, i) => `observacao ~* ('O\.S[[:space:]]+' || $${i + 1})`).join(' OR ') }
       ORDER BY id DESC`,
      patterns
    );
    res.json(rows.map(r => {
      let itens = [];
      try { itens = JSON.parse(r.conteudo || '[]'); } catch { itens = []; }
      return {
        id:              r.id,
        identificacao:   r.identificacao || '',
        observacao:      r.observacao || '',
        status:          r.status || '',
        rastreio_status: r.rastreio_status || '',
        usuario:         r.usuario || '',
        created_at:      r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR') : '',
        etiqueta_url:    r.etiqueta_url || null,
        declaracao_url:  r.declaracao_url || null,
        anexos:          Array.isArray(r.anexos) ? r.anexos : [],
        itens,
      };
    }));
  } catch (err) {
    console.error('[AT/pecas-enviadas] erro:', err);
    res.status(500).json({ error: err.message });
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
      `SELECT id, nome, cnpj_cpf, endereco, municipio, uf, cep, celular, tipo, lat, lng, qtd_atend_ult_1_ano
       FROM sac.controle_tecnicos WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Técnico não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /at/tecnicos — cria novo técnico
router.post('/at/tecnicos', async (req, res) => {
  const { nome, cnpj_cpf, endereco, municipio, uf, cep, celular, tipo, lat, lng } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'Nome obrigatório.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO sac.controle_tecnicos (nome, cnpj_cpf, endereco, municipio, uf, cep, celular, tipo, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, nome, cnpj_cpf, endereco, municipio, uf, cep, celular, tipo, lat, lng`,
      [
        String(nome).trim(),
        cnpj_cpf  ? String(cnpj_cpf).trim()  : null,
        endereco  ? String(endereco).trim()  : null,
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
  const { nome, cnpj_cpf, endereco, municipio, uf, cep, celular, tipo, lat, lng } = req.body || {};
  if (!nome || !String(nome).trim()) return res.status(400).json({ error: 'Nome obrigatório.' });
  try {
    const { rows } = await pool.query(
      `UPDATE sac.controle_tecnicos
       SET nome=$1, cnpj_cpf=$2, endereco=$3, municipio=$4, uf=$5, cep=$6, celular=$7, tipo=$8, lat=$9, lng=$10
       WHERE id=$11
       RETURNING id, nome, cnpj_cpf, endereco, municipio, uf, cep, celular, tipo, lat, lng`,
      [
        String(nome).trim(),
        cnpj_cpf  ? String(cnpj_cpf).trim()  : null,
        endereco  ? String(endereco).trim()  : null,
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
const AT_SESSION_SECRET = process.env.AT_SESSION_SECRET || 'at_portal_s3cr3t';

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

// POST /at/tecnico/fechamento/:id_at/nfe?token=TOKEN — upload da NFe do serviço pelo técnico
router.post('/at/tecnico/fechamento/:id_at/nfe', atUpload.single('nfe'), async (req, res) => {
  const token = String(req.query.token || '').trim();
  const id_at = parseInt(req.params.id_at, 10);
  if (!token || token.length < 32) return res.status(401).json({ error: 'token inválido' });
  if (!id_at) return res.status(400).json({ error: 'id_at inválido' });
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  try {
    const { rows: tRows } = await pool.query(
      `SELECT ct.id FROM sac.controle_tecnicos ct
       JOIN sac.fechamento f ON f.id_tecnico = ct.id
       WHERE ct.token = $1 AND f.id_at = $2 LIMIT 1`,
      [token, id_at]
    );
    if (!tRows.length) return res.status(403).json({ error: 'Acesso negado.' });
    const { rows: fRows } = await pool.query(
      'SELECT nfe_path_key FROM sac.fechamento WHERE id_at = $1 LIMIT 1', [id_at]
    );
    const oldPathKey = fRows[0]?.nfe_path_key || null;
    const file = req.file;
    const mimeExt = mime.extension(file.mimetype);
    const originalExt = (file.originalname || '').split('.').pop();
    const ext = (mimeExt || originalExt || 'bin').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'bin';
    const safeName = atSanitizeFileName(file.originalname, ext);
    const pathKey  = `at-nfe/${id_at}/${uuidv4()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from(AT_BUCKET).upload(pathKey, file.buffer, {
      contentType: file.mimetype || 'application/octet-stream',
      upsert: false
    });
    if (upErr) throw new Error(`Supabase upload: ${upErr.message}`);
    const { data: pubData } = supabase.storage.from(AT_BUCKET).getPublicUrl(pathKey);
    const nfeUrl = pubData?.publicUrl || '';
    const { rows: ex } = await pool.query('SELECT id FROM sac.fechamento WHERE id_at = $1', [id_at]);
    if (ex.length) {
      await pool.query("UPDATE sac.fechamento SET nfe_url=$2, nfe_path_key=$3, status_os='finalizado', data_envio_nfe=NOW() WHERE id_at=$1", [id_at, nfeUrl, pathKey]);
    } else {
      await pool.query("INSERT INTO sac.fechamento (id_at, nfe_url, nfe_path_key, status_os, data_envio_nfe) VALUES ($1,$2,$3,'finalizado',NOW())", [id_at, nfeUrl, pathKey]);
    }
    if (oldPathKey && oldPathKey !== pathKey) {
      supabase.storage.from(AT_BUCKET).remove([oldPathKey]).catch(() => {});
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

router.get('/whatsapp/webhook', (req, res) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = String(req.query['hub.challenge'] || '').trim();

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
              buttonReplyId: String(message?.interactive?.button_reply?.id || '').trim() || null,
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
      Promise.resolve().then(async () => {
        for (const inbound of newInboundMessages) {
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
              continue;
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
        }
      });
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
      `WITH ranked AS (
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
           FROM sac.whatsapp_webhook_messages
          WHERE COALESCE(from_phone_digits, '') <> ''
       )
       SELECT from_phone,
              from_phone_digits,
              profile_name,
              direction AS last_direction,
              message_type AS last_message_type,
              message_text AS last_message_text,
              received_at AS last_received_at,
              total_messages
         FROM ranked
        WHERE rn = 1
        ORDER BY last_received_at DESC
        LIMIT $1`,
      [limit]
    );
    return res.json({ ok: true, conversations: rows });
  } catch (err) {
    console.error('[SAC/WhatsApp] erro ao listar conversas:', err);
    return res.status(500).json({ ok: false, error: 'Falha ao listar conversas do WhatsApp.' });
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

module.exports = router;
