'use strict';

/**
 * Janela de envio WhatsApp: 06:00–19:00 no horário de Brasília.
 * Fora da janela, a mensagem é gravada e enviada no próximo 06:00.
 */

const { dbQuery, dbGetClient } = require('../src/db');

const TZ = 'America/Sao_Paulo';
const JANELA_INICIO_HORA = 6;
const JANELA_FIM_HORA = 19;
const TAG = '[WhatsAppJanela]';

const WHATSAPP_CLOUD_ACCESS_TOKEN = String(
  process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
  process.env.META_WHATSAPP_ACCESS_TOKEN || ''
).trim();
const WHATSAPP_GRAPH_API_VERSION = String(
  process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0'
).trim() || 'v25.0';

let schemaOk = false;
let processandoFila = false;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function partesBrasilia(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function brasiliaLocalParaDate(y, m, d, h = 0, min = 0, s = 0) {
  const utcGuess = new Date(Date.UTC(y, m - 1, d, h, min, s));
  const atual = partesBrasilia(utcGuess);
  const desejadoMs = Date.UTC(y, m - 1, d, h, min, s);
  const atualMs = Date.UTC(atual.year, atual.month - 1, atual.day, atual.hour, atual.minute, atual.second);
  return new Date(utcGuess.getTime() + (desejadoMs - atualMs));
}

function somarDiasCalendario(p, dias) {
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day));
  base.setUTCDate(base.getUTCDate() + dias);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function estaDentroJanelaEnvio(date = new Date()) {
  const { hour } = partesBrasilia(date);
  return hour >= JANELA_INICIO_HORA && hour < JANELA_FIM_HORA;
}

function proximoInicioJanela(date = new Date()) {
  const p = partesBrasilia(date);
  if (p.hour < JANELA_INICIO_HORA) {
    return brasiliaLocalParaDate(p.year, p.month, p.day, JANELA_INICIO_HORA, 0, 0);
  }
  const amanha = somarDiasCalendario(p, 1);
  return brasiliaLocalParaDate(amanha.year, amanha.month, amanha.day, JANELA_INICIO_HORA, 0, 0);
}

function formatarHorarioBrasilia(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

async function ensureWhatsappFilaSchema() {
  if (schemaOk) return;
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS sac.whatsapp_fila_envio (
      id              BIGSERIAL PRIMARY KEY,
      phone_number_id TEXT NOT NULL,
      to_phone        TEXT,
      payload_json    JSONB NOT NULL,
      origem          TEXT,
      agendado_para   TIMESTAMPTZ NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pendente',
      tentativas      INTEGER NOT NULL DEFAULT 0,
      ultimo_erro     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      enviado_em      TIMESTAMPTZ
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS whatsapp_fila_envio_pendente_idx
      ON sac.whatsapp_fila_envio (agendado_para, id)
      WHERE status = 'pendente'
  `);
  schemaOk = true;
}

async function postGraphWhatsapp(phoneNumberId, body) {
  if (!WHATSAPP_CLOUD_ACCESS_TOKEN) {
    throw new Error('Token WhatsApp não configurado.');
  }
  if (!phoneNumberId) {
    throw new Error('Phone Number ID não encontrado.');
  }
  const resp = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(String(phoneNumberId))}/messages`,
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

async function enfileirarWhatsapp({ phoneNumberId, body, origem = null }) {
  await ensureWhatsappFilaSchema();
  const quando = proximoInicioJanela();
  const toPhone = body?.to || null;
  const { rows } = await dbQuery(
    `INSERT INTO sac.whatsapp_fila_envio
       (phone_number_id, to_phone, payload_json, origem, agendado_para, status)
     VALUES ($1, $2, $3::jsonb, $4, $5, 'pendente')
     RETURNING id, agendado_para`,
    [String(phoneNumberId), toPhone, JSON.stringify(body || {}), origem, quando]
  );
  const row = rows[0];
  console.log(
    TAG,
    `Mensagem agendada #${row.id} para ${formatarHorarioBrasilia(row.agendado_para)}`
    + (origem ? ` (${origem})` : '')
    + (toPhone ? ` → ${toPhone}` : '')
  );
  return {
    id: row.id,
    agendado_para: row.agendado_para,
    agendado_para_fmt: formatarHorarioBrasilia(row.agendado_para),
  };
}

/**
 * Envia agora se estiver na janela; senão agenda para o próximo 06:00 de Brasília.
 * force=true envia mesmo fora da janela (usado pelo processador da fila).
 */
async function entregarMensagemWhatsapp(phoneNumberId, body, opts = {}) {
  const force = Boolean(opts.force);
  const origem = opts.origem || null;

  if (!force && !estaDentroJanelaEnvio()) {
    const ag = await enfileirarWhatsapp({ phoneNumberId, body, origem });
    return {
      ok: true,
      status: 202,
      agendado: true,
      agendado_para: ag.agendado_para,
      agendado_para_fmt: ag.agendado_para_fmt,
      fila_id: ag.id,
      payload: {
        messages: [],
        contacts: [],
        __meta: {
          agendado: true,
          agendado_para: ag.agendado_para,
          agendado_para_fmt: ag.agendado_para_fmt,
          fila_id: ag.id,
          sent_to: body?.to || null,
          request_body: body,
        },
      },
    };
  }

  const result = await postGraphWhatsapp(phoneNumberId, body);
  return { ...result, agendado: false };
}

async function processarFilaWhatsapp() {
  if (processandoFila) return { skipped: true };
  if (!estaDentroJanelaEnvio()) return { fora_janela: true };
  if (!WHATSAPP_CLOUD_ACCESS_TOKEN) return { sem_token: true };

  processandoFila = true;
  let enviados = 0;
  let erros = 0;

  try {
    await ensureWhatsappFilaSchema();
    const client = await dbGetClient();
    let rows = [];
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        `SELECT id
           FROM sac.whatsapp_fila_envio
          WHERE status = 'pendente'
            AND agendado_para <= NOW()
          ORDER BY agendado_para ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 20`
      );
      const ids = locked.rows.map((r) => r.id);
      if (ids.length) {
        const upd = await client.query(
          `UPDATE sac.whatsapp_fila_envio
              SET status = 'enviando', updated_at = NOW()
            WHERE id = ANY($1::bigint[])
            RETURNING id, phone_number_id, payload_json, tentativas`,
          [ids]
        );
        rows = upd.rows;
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }

    for (const row of rows) {
      try {
        const result = await entregarMensagemWhatsapp(row.phone_number_id, row.payload_json, {
          force: true,
          origem: 'fila',
        });
        if (!result.ok) {
          const msg = result.payload?.error?.message
            || result.payload?.error?.error_user_msg
            || `Falha WhatsApp (${result.status})`;
          throw new Error(msg);
        }
        await dbQuery(
          `UPDATE sac.whatsapp_fila_envio
              SET status = 'enviado',
                  enviado_em = NOW(),
                  updated_at = NOW(),
                  ultimo_erro = NULL
            WHERE id = $1`,
          [row.id]
        );
        enviados += 1;
      } catch (err) {
        erros += 1;
        const tentativas = Number(row.tentativas || 0) + 1;
        const status = tentativas >= 5 ? 'erro' : 'pendente';
        await dbQuery(
          `UPDATE sac.whatsapp_fila_envio
              SET status = $2,
                  tentativas = $3,
                  ultimo_erro = $4,
                  updated_at = NOW(),
                  agendado_para = CASE
                    WHEN $2 = 'pendente' THEN NOW() + INTERVAL '2 minutes'
                    ELSE agendado_para
                  END
            WHERE id = $1`,
          [row.id, status, tentativas, String(err?.message || err).slice(0, 500)]
        );
        console.error(TAG, `Falha ao enviar fila #${row.id}:`, err?.message || err);
      }
    }

    if (enviados || erros) {
      console.log(TAG, `Fila processada: enviados=${enviados} erros=${erros}`);
    }
    return { enviados, erros };
  } catch (err) {
    console.error(TAG, 'Erro ao processar fila:', err?.message || err);
    return { erro: err?.message || String(err) };
  } finally {
    processandoFila = false;
  }
}

function iniciarProcessadorFilaWhatsapp() {
  console.log(
    TAG,
    `Processador iniciado — envio só ${pad2(JANELA_INICIO_HORA)}:00–${pad2(JANELA_FIM_HORA)}:00 (${TZ}).`
  );
  processarFilaWhatsapp().catch((err) => {
    console.error(TAG, 'Erro inicial da fila:', err?.message || err);
  });
  setInterval(() => {
    processarFilaWhatsapp().catch((err) => {
      console.error(TAG, 'Erro no timer da fila:', err?.message || err);
    });
  }, 60 * 1000);
}

module.exports = {
  TZ,
  JANELA_INICIO_HORA,
  JANELA_FIM_HORA,
  partesBrasilia,
  estaDentroJanelaEnvio,
  proximoInicioJanela,
  formatarHorarioBrasilia,
  ensureWhatsappFilaSchema,
  entregarMensagemWhatsapp,
  processarFilaWhatsapp,
  iniciarProcessadorFilaWhatsapp,
};
