/**
 * ============================================================
 * CRON — Notificação diária via WhatsApp (08:00)
 * ============================================================
 * Envia mensagens para usuários com receber_notificacao = true
 * e telefone_contato preenchido.
 *
 * Conteúdo:
 *  1. Agenda do dia (rh.reservas_ambientes + rh.reservas_participantes)
 *  2. Mensagens não lidas no SGF (public.chat_messages)
 *
 * Se houver mensagens não lidas, envia botão interativo
 * "Marcar como lidas". O clique é tratado no webhook do WhatsApp
 * (routes/sacEnvios.js).
 */

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

const TAG = '[NotifWhatsApp]';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Converte telefone brasileiro para formato internacional WhatsApp */
function toWhatsappPhone(telefone) {
  let digits = normalizePhoneDigits(telefone);
  if (!digits) return null;
  if (!digits.startsWith('55')) digits = '55' + digits;
  // Adiciona 9° dígito se necessário (celular)
  if (digits.length === 12) {
    digits = digits.slice(0, 4) + '9' + digits.slice(4);
  }
  return digits.length >= 12 ? digits : null;
}

/** Descobre Phone Number ID para envio */
async function getPhoneNumberId() {
  if (WHATSAPP_DEFAULT_PHONE_NUMBER_ID) return WHATSAPP_DEFAULT_PHONE_NUMBER_ID;
  try {
    const { rows } = await dbQuery(
      `SELECT phone_number_id FROM sac.whatsapp_webhook_messages
       WHERE phone_number_id IS NOT NULL AND direction = 'outbound'
       GROUP BY phone_number_id ORDER BY count(*) DESC LIMIT 1`
    );
    return rows[0]?.phone_number_id || null;
  } catch { return null; }
}

// ─── Envio WhatsApp ───────────────────────────────────────────────────────────

async function enviarWhatsappTexto(phoneNumberId, toPhone, text) {
  const resp = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_CLOUD_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: text }
      })
    }
  );
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`WhatsApp API ${resp.status}: ${err}`);
  }
  return true;
}

async function enviarWhatsappComBotao(phoneNumberId, toPhone, bodyText, buttons) {
  const btns = buttons.slice(0, 3).map((b) => ({
    type: 'reply',
    reply: {
      id: String(b.id).slice(0, 256),
      title: String(b.title).slice(0, 20)
    }
  }));

  const resp = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_CLOUD_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: btns }
        }
      })
    }
  );
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`WhatsApp API botão ${resp.status}: ${err}`);
  }
  return true;
}

// ─── Lógica principal ─────────────────────────────────────────────────────────

async function executarNotificacaoDiaria() {
  if (!WHATSAPP_CLOUD_ACCESS_TOKEN) {
    console.log(TAG, 'Token WhatsApp não configurado — notificação ignorada.');
    return;
  }

  const phoneNumberId = await getPhoneNumberId();
  if (!phoneNumberId) {
    console.log(TAG, 'Phone Number ID não encontrado — notificação ignorada.');
    return;
  }

  // Usuários com notificação ativada e telefone preenchido
  const { rows: users } = await dbQuery(
    `SELECT id, username, telefone_contato
     FROM public.auth_user
     WHERE receber_notificacao = true
       AND telefone_contato IS NOT NULL
       AND TRIM(telefone_contato) <> ''`
  );

  if (!users.length) {
    console.log(TAG, 'Nenhum usuário com notificação ativada.');
    return;
  }

  console.log(TAG, `Processando ${users.length} usuário(s)...`);
  const hoje = new Date().toISOString().slice(0, 10);
  const telefonesNotificados = new Set();

  for (const user of users) {
    try {
      const phone = toWhatsappPhone(user.telefone_contato);
      if (!phone) {
        console.log(TAG, `Telefone inválido para ${user.username}: ${user.telefone_contato}`);
        continue;
      }

      if (telefonesNotificados.has(phone)) {
        console.log(TAG, `Telefone ${phone} já notificado — pulando ${user.username}.`);
        continue;
      }

      const partes = [];

      // ── 1. Reservas do dia ──────────────────────────────────────────────
      const { rows: reservas } = await dbQuery(
        `SELECT ra.tema_reuniao, ra.tipo_espaco, ra.data_reserva,
                ra.hora_inicio, ra.hora_fim
         FROM rh.reservas_ambientes ra
         JOIN rh.reservas_participantes rp ON rp.reserva_id = ra.id
         WHERE rp.username = $1
           AND ra.data_reserva = $2::date
         ORDER BY ra.hora_inicio`,
        [user.username, hoje]
      );

      if (reservas.length) {
        partes.push('Bom dia, segue agenda do dia:');
        reservas.forEach((r) => {
          const tema = r.tema_reuniao || 'Sem tema';
          const tipo = r.tipo_espaco || '';
          const hIni = r.hora_inicio ? String(r.hora_inicio).slice(0, 5) : '';
          const hFim = r.hora_fim ? String(r.hora_fim).slice(0, 5) : '';
          partes.push(`\n📋 *${tema}*\n   Local: ${tipo}\n   Horário: ${hIni} - ${hFim}`);
        });
      }

      // ── 2. Mensagens não lidas ──────────────────────────────────────────
      const { rows: mensagens } = await dbQuery(
        `SELECT cm.id, cm.message_text, cm.from_user_id, cm.created_at
         FROM public.chat_messages cm
         WHERE cm.to_user_id = $1
           AND cm.is_read = false
         ORDER BY cm.created_at DESC
         LIMIT 10`,
        [user.id]
      );

      let temMensagensNaoLidas = false;
      if (mensagens.length) {
        temMensagensNaoLidas = true;

        // Buscar nomes dos remetentes
        const fromIds = [...new Set(mensagens.map((m) => m.from_user_id))];
        const { rows: remetentes } = await dbQuery(
          `SELECT id, username FROM public.auth_user WHERE id = ANY($1::int[])`,
          [fromIds]
        );
        const nomeMap = new Map(remetentes.map((r) => [r.id, r.username]));

        partes.push('\nSegue mensagem não lida no sistema de mensagem do SGF:');
        mensagens.forEach((m) => {
          const de = nomeMap.get(m.from_user_id) || 'Desconhecido';
          const texto = String(m.message_text || '').slice(0, 200);
          partes.push(`\n💬 De: *${de}*\n   "${texto}"`);
        });
      }

      // Se não tem nada para enviar, pula
      if (!partes.length) continue;

      // Se não teve reservas, abre com bom dia genérico
      if (!reservas.length) {
        partes.unshift('Bom dia!');
      }

      const mensagemFinal = partes.join('\n');

      // Envia a mensagem principal
      await enviarWhatsappTexto(phoneNumberId, phone, mensagemFinal);

      // Se tem mensagens não lidas, envia botão interativo
      if (temMensagensNaoLidas) {
        await enviarWhatsappComBotao(
          phoneNumberId,
          phone,
          'Deseja marcar as mensagens como lidas?',
          [{ id: `sgf_marcar_lidas_${user.id}`, title: 'Marcar como lidas' }]
        );
      }

      telefonesNotificados.add(phone);
      console.log(TAG, `✓ Notificação enviada para ${user.username} (${phone})`);
    } catch (err) {
      console.error(TAG, `✗ Erro ao enviar para ${user.username}:`, err?.message || err);
    }
  }

  console.log(TAG, 'Notificação diária concluída.');
}

// ─── Timer ────────────────────────────────────────────────────────────────────

let _lastRunDate = null;

async function jaRodouHoje(hoje) {
  try {
    const { rows } = await dbQuery(
      `SELECT valor FROM public.cron_control WHERE chave = 'notif_whatsapp_ultima_execucao'`
    );
    return rows[0]?.valor === hoje;
  } catch {
    // Tabela pode não existir — usar fallback em memória
    return false;
  }
}

async function marcarRodouHoje(hoje) {
  try {
    await dbQuery(
      `INSERT INTO public.cron_control (chave, valor)
       VALUES ('notif_whatsapp_ultima_execucao', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [hoje]
    );
  } catch {
    // Silencia: fallback em memória já garante a sessão atual
  }
}

function verificarHorarioNotificacao() {
  const now = new Date();
  const hoje = now.toISOString().slice(0, 10);
  const hora = now.getHours();
  const minuto = now.getMinutes();

  // Executa às 05:00 (janela até 05:04) se ainda não rodou hoje
  if (hora === 5 && minuto < 5 && _lastRunDate !== hoje) {
    _lastRunDate = hoje; // guarda em memória imediatamente para evitar duplo disparo
    jaRodouHoje(hoje).then((jaRodou) => {
      if (jaRodou) {
        console.log(TAG, `Notificação já enviada hoje (${hoje}) — ignorando.`);
        return;
      }
      return marcarRodouHoje(hoje).then(() => executarNotificacaoDiaria());
    }).catch((err) => {
      console.error(TAG, 'Erro na notificação diária:', err?.message || err);
    });
  }
}

function iniciarCronNotificacaoDiaria() {
  console.log(TAG, 'Timer de notificação diária iniciado — verificando a cada minuto.');
  setInterval(verificarHorarioNotificacao, 60 * 1000);
  verificarHorarioNotificacao();
}

module.exports = {
  iniciarCronNotificacaoDiaria,
  executarNotificacaoDiaria
};
