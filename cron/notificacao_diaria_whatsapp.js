/**
 * ============================================================
 * CRON — Notificação diária via WhatsApp (06:00 Brasília)
 * ============================================================
 * Envia mensagens para usuários com telefone_contato preenchido
 * e preferência resumo_diario / whatsapp habilitada (opt-in estrito).
 *
 * Conteúdo:
 *  1. Agenda do dia (rh.reservas_ambientes + rh.reservas_participantes)
 */

const { dbQuery } = require('../src/db');
const { enviarWhatsappNotificacao } = require('../utils/whatsappEnvio');
const { partesBrasilia } = require('../utils/whatsappJanelaEnvio');
const { filtrarUsuarios } = require('../utils/notificacaoPreferencias');

const WHATSAPP_CLOUD_ACCESS_TOKEN = String(
  process.env.WHATSAPP_CLOUD_ACCESS_TOKEN ||
  process.env.META_WHATSAPP_ACCESS_TOKEN || ''
).trim();
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

  // Usuários com telefone; preferência resumo_diario filtrada abaixo (opt-in)
  const { rows: usersComTel } = await dbQuery(
    `SELECT id, username, telefone_contato
     FROM public.auth_user
     WHERE telefone_contato IS NOT NULL
       AND TRIM(telefone_contato) <> ''`
  );

  const users = await filtrarUsuarios(usersComTel, 'resumo_diario', 'whatsapp');

  if (!users.length) {
    console.log(TAG, 'Nenhum usuário com preferência resumo_diario / whatsapp.');
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
      // Busca reuniões únicas do dia E reuniões recorrentes que ocorrem hoje
      const hojeDate = new Date(hoje + 'T00:00:00');
      const diaSemanaJS = hojeDate.getDay(); // 0=dom,1=seg,...,6=sab
      const DIA_MAP = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };

      const { rows: todasReservas } = await dbQuery(
        `SELECT ra.id, ra.tema_reuniao, ra.tipo_espaco, ra.data_reserva,
                ra.hora_inicio, ra.hora_fim, ra.repetir, ra.dias_semana, ra.datas_excecao
         FROM rh.reservas_ambientes ra
         JOIN rh.reservas_participantes rp ON rp.reserva_id = ra.id
         WHERE rp.username = $1
           AND ra.data_reserva <= $2::date
         ORDER BY ra.hora_inicio`,
        [user.username, hoje]
      );

      // Filtra quais ocorrem hoje
      const reservasHoje = [];
      for (const r of todasReservas) {
        const dataBase = new Date(r.data_reserva);
        dataBase.setHours(0, 0, 0, 0);

        const excecoes = new Set();
        if (Array.isArray(r.datas_excecao)) {
          for (const d of r.datas_excecao) {
            excecoes.add(new Date(d).toISOString().slice(0, 10));
          }
        }
        if (excecoes.has(hoje)) continue;

        if (r.repetir && Array.isArray(r.dias_semana) && r.dias_semana.length > 0) {
          const diasAlvo = r.dias_semana.map(d => DIA_MAP[d]).filter(d => d !== undefined);
          if (diasAlvo.includes(diaSemanaJS) && dataBase <= hojeDate) {
            reservasHoje.push(r);
          }
        } else {
          const dataStr = dataBase.toISOString().slice(0, 10);
          if (dataStr === hoje) {
            reservasHoje.push(r);
          }
        }
      }

      // Deduplica: mesmo tema no mesmo dia → mantém maior ID
      const deduplicadoMap = new Map();
      for (const r of reservasHoje) {
        const chave = (r.tema_reuniao || '').toLowerCase().trim();
        const existente = deduplicadoMap.get(chave);
        if (!existente || Number(r.id) > Number(existente.id)) {
          deduplicadoMap.set(chave, r);
        }
      }
      const reservas = Array.from(deduplicadoMap.values())
        .sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || ''));

      if (reservas.length) {
        partes.push('📅 *Bom dia! Sua agenda de hoje:*');
        reservas.forEach((r) => {
          const tema = r.tema_reuniao || 'Sem tema';
          const tipo = r.tipo_espaco || '';
          const hIni = r.hora_inicio ? String(r.hora_inicio).slice(0, 5) : '';
          const hFim = r.hora_fim ? String(r.hora_fim).slice(0, 5) : '';
          partes.push(`\n📌 *${tema}*\n   📍 ${tipo}\n   ⏰ ${hIni} — ${hFim}`);
        });
      }

      // Sem agenda do dia → não envia (chat interno desativado)
      if (!partes.length) continue;

      const mensagemFinal = partes.join('\n');

      // Dentro da janela de 24h → texto livre.
      // Fora da janela → template aprovado (WHATSAPP_TEMPLATE_NOTIF), senão a Meta bloqueia.
      const envio = await enviarWhatsappNotificacao(phone, mensagemFinal, phoneNumberId);

      telefonesNotificados.add(phone);
      console.log(TAG, `✓ Notificação enviada para ${user.username} (${phone}) [${envio?.modo || 'texto'}]`);
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

function dateKeyBrasilia(date = new Date()) {
  const p = partesBrasilia(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function verificarHorarioNotificacao() {
  const now = new Date();
  const p = partesBrasilia(now);
  const hoje = dateKeyBrasilia(now);
  const hora = p.hour;
  const minuto = p.minute;

  // Executa às 06:00 de Brasília (janela até 06:04) se ainda não rodou hoje
  if (hora === 6 && minuto < 5 && _lastRunDate !== hoje) {
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
  console.log(TAG, 'Timer de notificação diária iniciado — disparo 06:00 Brasília.');
  setInterval(verificarHorarioNotificacao, 60 * 1000);
  verificarHorarioNotificacao();
}

module.exports = {
  iniciarCronNotificacaoDiaria,
  executarNotificacaoDiaria
};
