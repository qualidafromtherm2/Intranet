'use strict';

/**
 * Envio de e-mail via SMTP (Brevo / Gmail / Office 365).
 * Variáveis:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   SMTP_SECURE=true para porta 465
 */

function smtpConfigurado() {
  return !!(
    String(process.env.SMTP_HOST || '').trim()
    && String(process.env.SMTP_USER || '').trim()
    && String(process.env.SMTP_PASS || '').trim()
  );
}

function parseListaEmails(raw) {
  return String(raw || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

async function enviarEmail({ to, subject, text, html, attachments = [], from: fromOverride = null, replyTo = null }) {
  if (!smtpConfigurado()) {
    const err = new Error(
      'E-mail não configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM no .env (ex.: Brevo gratuito).'
    );
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_) {
    const err = new Error('Dependência nodemailer não instalada. Rode: npm install nodemailer');
    err.code = 'NO_NODEMAILER';
    throw err;
  }

  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587) || 587;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const fromDefault = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  const from = String(fromOverride || '').trim() || fromDefault;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const destinatarios = Array.isArray(to) ? to : parseListaEmails(to);
  if (!destinatarios.length) {
    const err = new Error('Nenhum destinatário de e-mail válido.');
    err.code = 'NO_RECIPIENTS';
    throw err;
  }

  const mailOpts = {
    from,
    to: destinatarios.join(', '),
    subject: String(subject || '(sem assunto)'),
    text: text || undefined,
    html: html || undefined,
    attachments: (attachments || []).map((a) => ({
      filename: a.filename || 'anexo.pdf',
      content: a.content,
      encoding: a.encoding || (Buffer.isBuffer(a.content) ? undefined : 'base64'),
      contentType: a.contentType || 'application/pdf',
    })),
  };
  const reply = String(replyTo || '').trim();
  if (reply) mailOpts.replyTo = reply;

  const info = await transporter.sendMail(mailOpts);

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    to: destinatarios,
    from,
  };
}

module.exports = {
  smtpConfigurado,
  parseListaEmails,
  enviarEmail,
};
