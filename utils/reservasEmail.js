'use strict';

/**
 * E-mails e WhatsApp de reservas de sala (nova reunião + lembrete diário 07:00 BRT).
 * Usa SMTP já configurado (Hostinger / Brevo).
 */

const { dbQuery } = require('../src/db');
const { smtpConfigurado, enviarEmail } = require('./mailer');
const { filtrarUsuarios } = require('./notificacaoPreferencias');

function normalizarEmail(valor) {
  const email = String(valor || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function formatarDataPtBr(dataIso) {
  const raw = String(dataIso || '').slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || '-';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatarHora(hora) {
  return String(hora || '').slice(0, 5) || '-';
}

/** Sigla do dia da semana (dom..sab) em America/Sao_Paulo para YYYY-MM-DD. */
function siglaDiaSemanaBrasilia(dataIso) {
  const raw = String(dataIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  // Meio-dia UTC evita virar o dia anterior/posterior em qualquer fuso do servidor.
  const d = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][d.getUTCDay()] || null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Relógio de Brasília: { dia: YYYY-MM-DD, hm: HH:MM }. */
function agoraBrasiliaYmdHm() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return {
    dia: `${get('year')}-${pad2(get('month'))}-${pad2(get('day'))}`,
    hm: `${pad2(get('hour'))}:${pad2(get('minute'))}`,
  };
}

/** true se o horário de início da reserva já passou em Brasília. */
function reservaJaComecou(dataIso, horaInicio) {
  const dia = String(dataIso || '').slice(0, 10);
  const hm = String(horaInicio || '').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(hm)) return false;
  const agora = agoraBrasiliaYmdHm();
  if (agora.dia > dia) return true;
  if (agora.dia < dia) return false;
  return agora.hm >= hm;
}

async function listarParticipantesComEmail(usernames) {
  const usuarios = Array.from(
    new Set((usernames || []).map((u) => String(u || '').trim()).filter(Boolean))
  );
  if (!usuarios.length) return [];

  const { rows } = await dbQuery(
    `SELECT id, username, email
       FROM public.auth_user
      WHERE username = ANY($1::text[])`,
    [usuarios]
  );

  const porUsuario = new Map(
    rows.map((r) => [String(r.username || '').trim().toLowerCase(), r])
  );

  const out = [];
  const seen = new Set();
  for (const username of usuarios) {
    const info = porUsuario.get(String(username).trim().toLowerCase());
    if (!info) continue;
    // Destinatário = e-mail do cadastro (auth_user.email). Remetente = SMTP_FROM no .env.
    const escolhido = normalizarEmail(info.email);
    if (!escolhido || seen.has(escolhido)) continue;
    seen.add(escolhido);
    out.push({ id: info.id, username: info.username, email: escolhido });
  }
  return out;
}

/** @returns {Promise<string[]>} e-mails dos participantes (sem filtro de preferência). */
async function obterEmailsParticipantes(usernames) {
  const lista = await listarParticipantesComEmail(usernames);
  return lista.map((d) => d.email);
}

/** Filtra participantes por preferência e devolve só os e-mails. */
async function emailsComPreferencia(usernames, tipoPreferencia) {
  const comEmail = await listarParticipantesComEmail(usernames);
  if (!comEmail.length) return [];
  const aceitos = await filtrarUsuarios(comEmail, tipoPreferencia, 'email');
  return aceitos.map((d) => d.email);
}

function montarTextoReserva(reserva, { titulo }) {
  const linhas = [
    titulo,
    '',
    `Tema: ${reserva.tema || '-'}`,
    `Tipo / local: ${reserva.tipo || '-'}`,
    `Data: ${formatarDataPtBr(reserva.data)}`,
    `Horário: ${formatarHora(reserva.inicio)} às ${formatarHora(reserva.fim)}`,
  ];
  if (Array.isArray(reserva.participantes) && reserva.participantes.length) {
    linhas.push(`Participantes: ${reserva.participantes.join(', ')}`);
  }
  if (reserva.linkReuniao) linhas.push(`Link: ${reserva.linkReuniao}`);
  if (reserva.cafe) linhas.push('Café: sim');
  if (reserva.visitantes) linhas.push(`Visitantes: ${reserva.visitantes}`);
  if (reserva.descricao) linhas.push(`Descrição: ${reserva.descricao}`);
  if (reserva.criadoPor) linhas.push(`Agendado por: ${reserva.criadoPor}`);
  linhas.push('', '— Intranet Fromtherm');
  return linhas.join('\n');
}

function montarHtmlReserva(reserva, { titulo }) {
  const row = (label, value) =>
    value
      ? `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;">${label}</td><td style="padding:4px 0;">${String(value)}</td></tr>`
      : '';

  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;line-height:1.45;">
  <h2 style="margin:0 0 12px;font-size:18px;">${titulo}</h2>
  <table style="border-collapse:collapse;">
    ${row('Tema', reserva.tema || '-')}
    ${row('Tipo / local', reserva.tipo || '-')}
    ${row('Data', formatarDataPtBr(reserva.data))}
    ${row('Horário', `${formatarHora(reserva.inicio)} às ${formatarHora(reserva.fim)}`)}
    ${row('Participantes', (reserva.participantes || []).join(', '))}
    ${row('Link', reserva.linkReuniao ? `<a href="${reserva.linkReuniao}">${reserva.linkReuniao}</a>` : '')}
    ${row('Café', reserva.cafe ? 'Sim' : '')}
    ${row('Visitantes', reserva.visitantes || '')}
    ${row('Descrição', reserva.descricao || '')}
    ${row('Agendado por', reserva.criadoPor || '')}
  </table>
  <p style="margin-top:16px;color:#888;font-size:12px;">Intranet Fromtherm</p>
</div>`;
}

/**
 * Avisa participantes logo após criar a reserva.
 * Não bloqueia o fluxo se SMTP falhar.
 */
async function notificarNovaReserva(reserva) {
  if (!smtpConfigurado()) {
    console.warn('[ReservasEmail] SMTP não configurado — pulando aviso de nova reserva.');
    return { ok: false, skipped: true, reason: 'smtp_nao_configurado' };
  }
  const emails = await emailsComPreferencia(reserva.participantes, 'reuniao_nova');
  if (!emails.length) {
    console.warn('[ReservasEmail] Nenhum e-mail com preferência reuniao_nova para reserva', reserva.id);
    return { ok: false, skipped: true, reason: 'sem_emails' };
  }

  const titulo = 'Nova reunião agendada';
  const subject = `[Reunião] ${reserva.tema || 'Reserva'} — ${formatarDataPtBr(reserva.data)} ${formatarHora(reserva.inicio)}`;
  const info = await enviarEmail({
    to: emails,
    subject,
    text: montarTextoReserva(reserva, { titulo }),
    html: montarHtmlReserva(reserva, { titulo }),
  });
  console.log(`[ReservasEmail] Nova reserva #${reserva.id} → ${emails.length} destinatário(s)`);
  return { ok: true, to: info.to };
}

/**
 * Lembrete do dia: reservas únicas + recorrentes que caem hoje,
 * ainda não realizadas (datas_realizadas), com participantes.
 * Destinatários vêm da preferência do usuário (reuniao_lembrete),
 * não do checkbox "Avisar por e-mail" da reserva.
 */
async function enviarLembretesReservasDoDia(dataIso) {
  const dia = String(dataIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    throw new Error(`Data inválida para lembrete: ${dataIso}`);
  }

  const siglaDia = siglaDiaSemanaBrasilia(dia);
  if (!siglaDia) {
    throw new Error(`Não foi possível obter o dia da semana para: ${dia}`);
  }

  const smtpOk = smtpConfigurado();
  if (!smtpOk) {
    console.warn('[ReservasEmail] SMTP não configurado — pulando e-mails do lembrete diário.');
  }

  const { rows } = await dbQuery(
    `SELECT r.id,
            r.tipo_espaco AS tipo,
            r.tema_reuniao AS tema,
            to_char(r.data_reserva, 'YYYY-MM-DD') AS data_base,
            to_char(r.hora_inicio, 'HH24:MI') AS inicio,
            to_char(r.hora_fim, 'HH24:MI') AS fim,
            r.cafe,
            r.descricao,
            r.visitantes,
            r.link_reuniao AS "linkReuniao",
            r.criado_por AS "criadoPor",
            r.repetir,
            COALESCE(
              array_agg(DISTINCT p.username) FILTER (WHERE p.username IS NOT NULL),
              ARRAY[]::text[]
            ) AS participantes
       FROM rh.reservas_ambientes r
       LEFT JOIN rh.reservas_participantes p ON p.reserva_id = r.id
      WHERE NOT ($1::date = ANY(COALESCE(r.datas_realizadas, ARRAY[]::date[])))
        AND COALESCE(r.cancelada, false) = false
        AND NOT ($1::date = ANY(COALESCE(r.datas_canceladas, ARRAY[]::date[])))
        AND NOT (
          -- Legado: reserva única marcada realizada antes de datas_realizadas
          r.repetir = false
          AND COALESCE(r.realizada, false) = true
          AND cardinality(COALESCE(r.datas_realizadas, ARRAY[]::date[])) = 0
        )
        AND (
          (
            r.repetir = false
            AND r.data_reserva = $1::date
          )
          OR (
            r.repetir = true
            AND EXTRACT(YEAR FROM r.data_reserva) = EXTRACT(YEAR FROM $1::date)
            AND (
              r.repetir_todos_meses = true
              OR EXTRACT(MONTH FROM r.data_reserva) = EXTRACT(MONTH FROM $1::date)
            )
            AND $2 = ANY(r.dias_semana)
            AND NOT ($1::date = ANY(COALESCE(r.datas_excecao, ARRAY[]::date[])))
          )
        )
      GROUP BY r.id
      ORDER BY r.hora_inicio ASC, r.id ASC`,
    [dia, siglaDia]
  );

  // Mesmo tema + mesmo horário: mantém o ID mais alto (séries recriadas).
  const dedup = new Map();
  for (const r of rows) {
    const chave = `${String(r.tema || '').toLowerCase().trim()}|${String(r.inicio || '').slice(0, 5)}`;
    const existente = dedup.get(chave);
    if (!existente || Number(r.id) > Number(existente.id)) {
      dedup.set(chave, r);
    }
  }
  const reservasDoDia = Array.from(dedup.values()).sort((a, b) =>
    String(a.inicio || '').localeCompare(String(b.inicio || ''))
  );

  let enviadosEmail = 0;
  let enviadosWhats = 0;
  const erros = [];

  let notificarLembreteReservaWhatsapp = null;
  try {
    ({ notificarLembreteReservaWhatsapp } = require('./reservasWhatsapp'));
  } catch (err) {
    console.warn('[ReservasEmail] Módulo WhatsApp indisponível para lembrete:', err?.message || err);
  }

  let puladasHorario = 0;

  for (const r of reservasDoDia) {
    const participantes = Array.isArray(r.participantes) ? r.participantes : [];
    if (!participantes.length) continue;
    if (reservaJaComecou(dia, r.inicio)) {
      puladasHorario += 1;
      console.log(
        `[ReservasEmail] Lembrete pulado #${r.id}: reunião já começou (${formatarHora(r.inicio)})`
      );
      continue;
    }

    const reserva = {
      id: r.id,
      tipo: r.tipo,
      tema: r.tema,
      data: dia,
      inicio: r.inicio,
      fim: r.fim,
      cafe: !!r.cafe,
      descricao: r.descricao,
      visitantes: r.visitantes,
      linkReuniao: r.linkReuniao,
      criadoPor: r.criadoPor,
      participantes,
    };

    if (smtpOk) {
      const emails = await emailsComPreferencia(participantes, 'reuniao_lembrete');
      if (emails.length) {
        const titulo = 'Lembrete: você tem reunião hoje';
        const subject = `[Lembrete] ${reserva.tema || 'Reunião'} hoje às ${formatarHora(reserva.inicio)}`;
        try {
          await enviarEmail({
            to: emails,
            subject,
            text: montarTextoReserva(reserva, { titulo }),
            html: montarHtmlReserva(reserva, { titulo }),
          });
          enviadosEmail += 1;
        } catch (err) {
          erros.push({ id: r.id, canal: 'email', message: err?.message || String(err) });
          console.error(`[ReservasEmail] Falha lembrete reserva #${r.id}:`, err?.message || err);
        }
      }
    }

    if (typeof notificarLembreteReservaWhatsapp === 'function') {
      try {
        const wa = await notificarLembreteReservaWhatsapp(reserva);
        if (wa?.ok) enviadosWhats += 1;
      } catch (err) {
        erros.push({ id: r.id, canal: 'whatsapp', message: err?.message || String(err) });
        console.error(`[ReservasEmail] Falha WhatsApp lembrete #${r.id}:`, err?.message || err);
      }
    }
  }

  console.log(
    `[ReservasEmail] Lembrete ${dia} (${siglaDia}): email=${enviadosEmail} whatsapp=${enviadosWhats}, ` +
      `${reservasDoDia.length} no dia (bruto=${rows.length}, puladasHorario=${puladasHorario}).`
  );
  return {
    ok: true,
    dia,
    totalDia: reservasDoDia.length,
    enviados: enviadosEmail,
    enviadosEmail,
    enviadosWhats,
    puladasHorario,
    erros,
  };
}

module.exports = {
  obterEmailsParticipantes,
  notificarNovaReserva,
  enviarLembretesReservasDoDia,
};
