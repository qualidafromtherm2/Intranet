'use strict';

/**
 * Aviso de reunião cancelada via WhatsApp (telefone_contato do cadastro).
 */

const { dbQuery } = require('../src/db');
const {
  whatsappConfigurado,
  getWhatsappPhoneNumberId,
  toWhatsappPhone,
  enviarWhatsappNotificacao,
} = require('./whatsappEnvio');

function formatarDataPtBr(dataIso) {
  const raw = String(dataIso || '').slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || '-';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatarHora(hora) {
  return String(hora || '').slice(0, 5) || '-';
}

function montarMensagemReserva(reserva, titulo) {
  const linhas = [
    titulo,
    '',
    `Tema: ${reserva.tema || '-'}`,
    `Tipo / local: ${reserva.tipo || '-'}`,
    `Data: ${formatarDataPtBr(reserva.data)}`,
    `Horário: ${formatarHora(reserva.inicio)} às ${formatarHora(reserva.fim)}`,
  ];
  if (reserva.canceladaPor) linhas.push(`Cancelada por: ${reserva.canceladaPor}`);
  if (reserva.criadoPor) linhas.push(`Agendada por: ${reserva.criadoPor}`);
  linhas.push('', '— Intranet Fromtherm');
  return linhas.join('\n');
}

function montarMensagemCancelamento(reserva) {
  return montarMensagemReserva(reserva, 'Reunião cancelada');
}

async function obterTelefonesParticipantes(usernames) {
  const usuarios = Array.from(
    new Set((usernames || []).map((u) => String(u || '').trim()).filter(Boolean))
  );
  if (!usuarios.length) return [];

  const { rows } = await dbQuery(
    `SELECT username, telefone_contato
       FROM public.auth_user
      WHERE lower(username) = ANY($1::text[])
        AND telefone_contato IS NOT NULL
        AND TRIM(telefone_contato) <> ''`,
    [usuarios.map((u) => u.toLowerCase())]
  );

  return rows.map((r) => ({
    username: r.username,
    telefone: r.telefone_contato,
  }));
}

/**
 * Envia WhatsApp aos participantes (e ao criador, se não estiver na lista).
 * Não lança: falha de um número não impede os demais.
 */
async function notificarReservaCanceladaWhatsapp(reserva) {
  const destinatarios = Array.from(new Set([
    ...(Array.isArray(reserva.participantes) ? reserva.participantes : []),
    reserva.criadoPor,
  ].map((u) => String(u || '').trim()).filter(Boolean)));

  if (!whatsappConfigurado()) {
    console.warn('[ReservasWhatsapp] WhatsApp não configurado — pulando aviso de cancelamento.');
    return { ok: false, skipped: true, reason: 'whatsapp_nao_configurado', enviados: [], semTelefone: destinatarios };
  }

  if (!destinatarios.length) {
    return { ok: false, skipped: true, reason: 'sem_destinatarios', enviados: [], semTelefone: [] };
  }

  const comTelefone = await obterTelefonesParticipantes(destinatarios);
  const comTelSet = new Set(comTelefone.map((d) => String(d.username || '').trim().toLowerCase()));
  const semTelefone = destinatarios.filter((u) => !comTelSet.has(u.toLowerCase()));

  if (!comTelefone.length) {
    console.warn('[ReservasWhatsapp] Nenhum telefone cadastrado para reserva', reserva.id);
    return { ok: false, skipped: true, reason: 'sem_telefones', enviados: [], semTelefone };
  }

  const phoneNumberId = await getWhatsappPhoneNumberId();
  if (!phoneNumberId) {
    return { ok: false, skipped: true, reason: 'sem_phone_number_id', enviados: [], semTelefone };
  }

  const mensagem = montarMensagemCancelamento(reserva);
  const enviados = [];
  const erros = [];
  const vistos = new Set();

  for (const dest of comTelefone) {
    const phone = toWhatsappPhone(dest.telefone);
    if (!phone || vistos.has(phone)) continue;
    vistos.add(phone);
    try {
      const result = await enviarWhatsappNotificacao(dest.telefone, mensagem, phoneNumberId);
      enviados.push(`${dest.username}:${result?.wa_id || phone}`);
    } catch (err) {
      erros.push(`${dest.username}: ${err?.message || err}`);
      console.warn('[ReservasWhatsapp] Falha ao enviar para', dest.username, err?.message || err);
    }
  }

  console.log(`[ReservasWhatsapp] Cancelamento #${reserva.id} → ${enviados.length} enviado(s)`);
  return {
    ok: enviados.length > 0,
    enviados,
    semTelefone,
    erros,
  };
}

async function notificarNovaReservaWhatsapp(reserva) {
  if (!whatsappConfigurado()) {
    console.warn('[ReservasWhatsapp] WhatsApp não configurado — pulando aviso de nova reserva.');
    return { ok: false, skipped: true, reason: 'whatsapp_nao_configurado', enviados: [] };
  }
  const destinatarios = Array.from(new Set(
    (Array.isArray(reserva.participantes) ? reserva.participantes : [])
      .map((u) => String(u || '').trim())
      .filter(Boolean)
  ));
  if (!destinatarios.length) {
    return { ok: false, skipped: true, reason: 'sem_destinatarios', enviados: [] };
  }

  const comTelefone = await obterTelefonesParticipantes(destinatarios);
  if (!comTelefone.length) {
    return { ok: false, skipped: true, reason: 'sem_telefones', enviados: [], semTelefone: destinatarios };
  }

  const phoneNumberId = await getWhatsappPhoneNumberId();
  if (!phoneNumberId) {
    return { ok: false, skipped: true, reason: 'sem_phone_number_id', enviados: [] };
  }

  const mensagem = montarMensagemReserva(reserva, 'Nova reunião agendada');
  const enviados = [];
  const vistos = new Set();
  for (const dest of comTelefone) {
    const phone = toWhatsappPhone(dest.telefone);
    if (!phone || vistos.has(phone)) continue;
    vistos.add(phone);
    try {
      const result = await enviarWhatsappNotificacao(dest.telefone, mensagem, phoneNumberId);
      enviados.push(`${dest.username}:${result?.wa_id || phone}`);
    } catch (err) {
      console.warn('[ReservasWhatsapp] Falha ao enviar nova reserva para', dest.username, err?.message || err);
    }
  }
  console.log(`[ReservasWhatsapp] Nova reserva #${reserva.id} → ${enviados.length} enviado(s)`);
  return { ok: enviados.length > 0, enviados };
}

module.exports = {
  notificarReservaCanceladaWhatsapp,
  notificarNovaReservaWhatsapp,
};
