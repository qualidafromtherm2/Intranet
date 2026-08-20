'use strict';

/**
 * E-mail e WhatsApp quando um item entra na Área vermelha
 * (PIR → Reprovar material, ou NIQ da linha/preparações).
 *
 * Destinatários: usuários que ligaram o tipo "area_vermelha"
 * em Configurações de notificações (canal e-mail e/ou WhatsApp).
 */

const { smtpConfigurado, enviarEmail } = require('./mailer');
const { listarUsuariosHabilitados } = require('./notificacaoPreferencias');
const {
  toWhatsappPhone,
  getWhatsappPhoneNumberId,
  whatsappConfigurado,
  enviarWhatsappNotificacao,
} = require('./whatsappEnvio');

const TAG = '[AlertaAreaVermelha]';

function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizarEmail(valor) {
  const email = String(valor || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function formatarQtd(qtd) {
  if (qtd == null || qtd === '') return '—';
  const n = Number(qtd);
  if (!Number.isFinite(n)) return String(qtd);
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function montarConteudo(item) {
  const origem = String(item?.origem || '').toLowerCase() === 'niq' ? 'NIQ (produção)' : 'Reprovar material (PIR)';
  const codigo = item?.codigo_produto || item?.codigo || '—';
  const descricao = item?.descricao || '—';
  const qtd = formatarQtd(item?.quantidade);
  const op = item?.numero_op || '—';
  const falha = item?.descricao_falha || '—';
  const quem = item?.definido_por || item?.registrado_por || '—';

  const linhas = [
    'Área vermelha — novo item',
    '',
    `Origem: ${origem}`,
    `Código: ${codigo}`,
    `Descrição: ${descricao}`,
    `Quantidade: ${qtd}`,
    `OP da máquina: ${op}`,
    `Falha: ${falha}`,
    `Quem: ${quem}`,
    '',
    'Abra na intranet: Qualidade → Area vermelha',
  ];

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#111827;line-height:1.5;">
      <h2 style="margin:0 0 12px;color:#b91c1c;">Área vermelha — novo item</h2>
      <p style="margin:0 0 12px;">Um item entrou na lista <strong>Qualidade → Area vermelha</strong>.</p>
      <table style="border-collapse:collapse;width:100%;max-width:560px;">
        <tr><td style="padding:6px 8px;color:#6b7280;width:140px;">Origem</td><td style="padding:6px 8px;">${escaparHtml(origem)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280;">Código</td><td style="padding:6px 8px;">${escaparHtml(codigo)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280;">Descrição</td><td style="padding:6px 8px;">${escaparHtml(descricao)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280;">Quantidade</td><td style="padding:6px 8px;">${escaparHtml(qtd)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280;">OP da máquina</td><td style="padding:6px 8px;">${escaparHtml(op)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280;">Falha</td><td style="padding:6px 8px;">${escaparHtml(falha)}</td></tr>
        <tr><td style="padding:6px 8px;color:#6b7280;">Quem</td><td style="padding:6px 8px;">${escaparHtml(quem)}</td></tr>
      </table>
    </div>
  `;

  return {
    subject: `[Área vermelha] ${codigo} — ${origem}`,
    text: linhas.join('\n'),
    html,
  };
}

async function enviarAlertaAreaVermelhaEmail(item, conteudo) {
  if (!smtpConfigurado()) {
    console.log(TAG, 'SMTP não configurado — e-mail ignorado.');
    return { ok: false, reason: 'smtp_nao_configurado' };
  }
  const destinatarios = await listarUsuariosHabilitados('area_vermelha', 'email', { exigirEmail: true });
  const emails = [...new Set(destinatarios.map((u) => normalizarEmail(u.email)).filter(Boolean))];
  if (!emails.length) {
    console.log(TAG, 'Nenhum destinatário com preferência area_vermelha / e-mail.');
    return { ok: false, reason: 'sem_destinatarios_email' };
  }
  const info = await enviarEmail({
    to: emails,
    subject: conteudo.subject,
    text: conteudo.text,
    html: conteudo.html,
  });
  console.log(TAG, `E-mail enviado para ${emails.length} destinatário(s).`);
  return { ok: true, to: info?.to || emails };
}

async function enviarAlertaAreaVermelhaWhatsapp(item, conteudo) {
  if (!whatsappConfigurado()) {
    console.log(TAG, 'WhatsApp não configurado — alerta ignorado.');
    return { ok: false, reason: 'whatsapp_nao_configurado' };
  }
  const destinatarios = await listarUsuariosHabilitados('area_vermelha', 'whatsapp', { exigirTelefone: true });
  if (!destinatarios.length) {
    console.log(TAG, 'Nenhum destinatário com preferência area_vermelha / WhatsApp.');
    return { ok: false, reason: 'sem_destinatarios_whatsapp' };
  }
  const phoneNumberId = await getWhatsappPhoneNumberId();
  if (!phoneNumberId) {
    console.warn(TAG, 'Phone Number ID não encontrado.');
    return { ok: false, reason: 'sem_phone_number_id' };
  }
  const mensagem = String(conteudo?.text || '').replace(/^Área vermelha — novo item/, '*Área vermelha — novo item*');
  const enviados = [];
  const vistos = new Set();
  for (const dest of destinatarios) {
    try {
      const phone = toWhatsappPhone(dest.telefone_contato);
      if (!phone || vistos.has(phone)) continue;
      vistos.add(phone);
      const result = await enviarWhatsappNotificacao(dest.telefone_contato, mensagem, phoneNumberId);
      enviados.push(`${dest.username || dest.id}:${result?.wa_id || phone}`);
      console.log(TAG, `WhatsApp enviado para ${dest.username || dest.id}`);
    } catch (err) {
      console.error(TAG, `Falha WhatsApp para ${dest.username || dest.id}:`, err?.message || err);
    }
  }
  return { ok: enviados.length > 0, enviados };
}

async function enviarAlertaAreaVermelha(item) {
  if (!item) return { ok: false, reason: 'sem_item' };
  const conteudo = montarConteudo(item);
  const [email, whatsapp] = await Promise.all([
    enviarAlertaAreaVermelhaEmail(item, conteudo).catch((err) => {
      console.warn(TAG, 'Falha e-mail:', err?.message || err);
      return { ok: false, reason: err?.message || 'erro_email' };
    }),
    enviarAlertaAreaVermelhaWhatsapp(item, conteudo).catch((err) => {
      console.warn(TAG, 'Falha WhatsApp:', err?.message || err);
      return { ok: false, reason: err?.message || 'erro_whatsapp' };
    }),
  ]);
  return { ok: email.ok === true || whatsapp.ok === true, email, whatsapp };
}

function dispararAlertaAreaVermelha(item) {
  setImmediate(() => {
    enviarAlertaAreaVermelha(item).catch((err) => {
      console.warn(TAG, 'Falha ao enviar:', err?.message || err);
    });
  });
}

module.exports = {
  enviarAlertaAreaVermelha,
  dispararAlertaAreaVermelha,
};
