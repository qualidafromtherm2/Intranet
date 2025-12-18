const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const pdfParse = require('pdf-parse');
const fetch = require('node-fetch');

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

function sanitizeIdentificacao(codigo) {
  return String(codigo || '').replace(/\s+/g, '').toUpperCase() || null;
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

function normalizeStatus(statusRaw) {
  const val = String(statusRaw || '').trim();
  if (!val) return STATUS_LIST[0];
  const normalized = STATUS_LIST.find(s => s.toLowerCase() === val.toLowerCase());
  return normalized || STATUS_LIST[0];
}

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
    // ignora headers ou linhas puramente numéricas (artefatos de layout)
    if (!/[A-Za-z]/.test(normalized)) continue;
    if (/^í?tem|^conte(ú|u)do|^quant|^valor/i.test(normalized)) continue;
    if (/(item|ítem).*(conte(ú|u)do)/i.test(normalized)) continue;
    if (/^totais?/i.test(normalized)) break;
    if (seen.has(normalized)) continue; // evita duplicar página 2
    seen.add(normalized);
    items.push({ conteudo: normalized, quantidade: 1 });
  }

  if (!items.length) return null;

  return items
    .map((it, idx) => `Item ${idx + 1}: ${it.conteudo} Quantidade ${it.quantidade}`)
    .join(' | ');
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
  `);
}

ensureSchema().catch(err => {
  console.error('[SAC] falha ao garantir schema/tabela envios:', err);
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

router.get('/solicitacoes', async (req, res) => {
  try {
    const hideDone = String(req.query?.hideDone || '').toLowerCase() === 'true' || req.query?.hideDone === '1';

    const whereClause = hideDone
      ? "WHERE COALESCE(status, '') NOT IN ('Enviado', 'Finalizado')"
      : '';

    const r = await pool.query(
      `SELECT id, created_at, usuario, observacao, status, conferido, etiqueta_url, declaracao_url, identificacao, conteudo, rastreio_status, rastreio_quando, finalizado_em
         FROM envios.solicitacoes
        ${whereClause}
        ORDER BY id DESC
        LIMIT 200`
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

module.exports = router;
