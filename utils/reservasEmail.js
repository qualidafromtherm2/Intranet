'use strict';

/**
 * E-mails de reservas de sala (nova reunião + lembrete diário 07:30 BRT).
 * Usa SMTP já configurado (Hostinger / Brevo).
 */

const { dbQuery } = require('../src/db');
const { smtpConfigurado, enviarEmail } = require('./mailer');

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

async function obterEmailsParticipantes(usernames) {
  const usuarios = Array.from(
    new Set((usernames || []).map((u) => String(u || '').trim()).filter(Boolean))
  );
  if (!usuarios.length) return [];

  const { rows } = await dbQuery(
    `SELECT username, email
       FROM public.auth_user
      WHERE username = ANY($1::text[])`,
    [usuarios]
  );

  const porUsuario = new Map(
    rows.map((r) => [String(r.username || '').trim().toLowerCase(), r])
  );

  const emails = [];
  const seen = new Set();
  for (const username of usuarios) {
    const info = porUsuario.get(String(username).trim().toLowerCase());
    if (!info) continue;
    // Destinatário = e-mail do cadastro (auth_user.email). Remetente = SMTP_FROM no .env.
    const escolhido = normalizarEmail(info.email);
    if (!escolhido || seen.has(escolhido)) continue;
    seen.add(escolhido);
    emails.push(escolhido);
  }
  return emails;
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
  const emails = await obterEmailsParticipantes(reserva.participantes);
  if (!emails.length) {
    console.warn('[ReservasEmail] Nenhum e-mail de participante encontrado para reserva', reserva.id);
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
 * Lembrete matinal: todas as reservas do dia (ainda não realizadas) com participantes.
 */
async function enviarLembretesReservasDoDia(dataIso) {
  if (!smtpConfigurado()) {
    console.warn('[ReservasEmail] SMTP não configurado — pulando lembrete diário.');
    return { ok: false, skipped: true, enviados: 0 };
  }

  const dia = String(dataIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    throw new Error(`Data inválida para lembrete: ${dataIso}`);
  }

  const { rows } = await dbQuery(
    `SELECT r.id,
            r.tipo_espaco AS tipo,
            r.tema_reuniao AS tema,
            to_char(r.data_reserva, 'YYYY-MM-DD') AS data,
            to_char(r.hora_inicio, 'HH24:MI') AS inicio,
            to_char(r.hora_fim, 'HH24:MI') AS fim,
            r.cafe,
            r.descricao,
            r.visitantes,
            r.link_reuniao AS "linkReuniao",
            r.criado_por AS "criadoPor",
            COALESCE(
              array_agg(DISTINCT p.username) FILTER (WHERE p.username IS NOT NULL),
              ARRAY[]::text[]
            ) AS participantes
       FROM rh.reservas_ambientes r
       LEFT JOIN rh.reservas_participantes p ON p.reserva_id = r.id
      WHERE r.data_reserva = $1::date
        AND COALESCE(r.realizada, false) = false
      GROUP BY r.id
      ORDER BY r.hora_inicio ASC`,
    [dia]
  );

  let enviados = 0;
  const erros = [];

  for (const r of rows) {
    const participantes = Array.isArray(r.participantes) ? r.participantes : [];
    if (!participantes.length) continue;

    const emails = await obterEmailsParticipantes(participantes);
    if (!emails.length) continue;

    const reserva = {
      id: r.id,
      tipo: r.tipo,
      tema: r.tema,
      data: r.data,
      inicio: r.inicio,
      fim: r.fim,
      cafe: !!r.cafe,
      descricao: r.descricao,
      visitantes: r.visitantes,
      linkReuniao: r.linkReuniao,
      criadoPor: r.criadoPor,
      participantes,
    };

    const titulo = 'Lembrete: você tem reunião hoje';
    const subject = `[Lembrete] ${reserva.tema || 'Reunião'} hoje às ${formatarHora(reserva.inicio)}`;
    try {
      await enviarEmail({
        to: emails,
        subject,
        text: montarTextoReserva(reserva, { titulo }),
        html: montarHtmlReserva(reserva, { titulo }),
      });
      enviados += 1;
    } catch (err) {
      erros.push({ id: r.id, message: err?.message || String(err) });
      console.error(`[ReservasEmail] Falha lembrete reserva #${r.id}:`, err?.message || err);
    }
  }

  console.log(`[ReservasEmail] Lembrete ${dia}: ${enviados} reunião(ões) notificada(s), ${rows.length} no dia.`);
  return { ok: true, dia, totalDia: rows.length, enviados, erros };
}

module.exports = {
  obterEmailsParticipantes,
  notificarNovaReserva,
  enviarLembretesReservasDoDia,
};
