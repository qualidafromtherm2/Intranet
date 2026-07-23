/**
 * CRON — Lembrete de reuniões do dia por e-mail às 07:30 (America/Sao_Paulo).
 */
const { dbQuery } = require('../src/db');
const { enviarLembretesReservasDoDia } = require('../utils/reservasEmail');

const TAG = '[ReservasEmailCron]';
const CHAVE = 'lembrete_reservas_email_ultima_execucao';
let _lastRunDate = '';

function dateKeyBrasilia(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function jaRodouHoje(hoje) {
  try {
    const { rows } = await dbQuery(
      `SELECT valor FROM public.cron_control WHERE chave = $1 LIMIT 1`,
      [CHAVE]
    );
    return rows[0]?.valor === hoje;
  } catch {
    return _lastRunDate === hoje;
  }
}

async function marcarRodouHoje(hoje) {
  _lastRunDate = hoje;
  try {
    await dbQuery(
      `INSERT INTO public.cron_control (chave, valor)
       VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [CHAVE, hoje]
    );
  } catch {
    /* memória já atualizada */
  }
}

async function executarLembreteDiario() {
  const hoje = dateKeyBrasilia();
  const resultado = await enviarLembretesReservasDoDia(hoje);
  console.log(
    TAG,
    `Lembrete ${hoje}: enviados=${resultado.enviados || 0} totalDia=${resultado.totalDia || 0}`
  );
  return resultado;
}

function verificarHorarioLembreteReservas() {
  const now = new Date();
  const hoje = dateKeyBrasilia(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const hora = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minuto = Number(parts.find((p) => p.type === 'minute')?.value || 0);

  // Janela 07:30–07:34 (timer a cada 1 min)
  if (hora === 7 && minuto >= 30 && minuto < 35 && _lastRunDate !== hoje) {
    _lastRunDate = hoje;
    jaRodouHoje(hoje)
      .then((jaRodou) => {
        if (jaRodou) {
          console.log(TAG, `Já executado hoje (${hoje}) — ignorando.`);
          return;
        }
        return marcarRodouHoje(hoje).then(() => executarLembreteDiario());
      })
      .catch((err) => {
        console.error(TAG, 'Erro:', err?.message || err);
      });
  }
}

function iniciarCronLembreteReservasEmail() {
  console.log(TAG, 'Timer iniciado — verifica a cada 1 min (disparo 07:30 BRT).');
  verificarHorarioLembreteReservas();
  setInterval(verificarHorarioLembreteReservas, 60 * 1000);
}

module.exports = {
  iniciarCronLembreteReservasEmail,
  executarLembreteDiario,
};
