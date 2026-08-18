/**
 * CRON — Lembrete de reuniões do dia (e-mail + WhatsApp) às 07:00 (America/Sao_Paulo).
 * Se o servidor estiver fora às 07:00, tenta de novo até 19:00 (uma vez por dia),
 * mas não envia para reunião cujo horário de início já passou.
 */
const { dbQuery } = require('../src/db');
const { enviarLembretesReservasDoDia } = require('../utils/reservasEmail');

const TAG = '[ReservasEmailCron]';
const CHAVE = 'lembrete_reservas_dia_v2_ultima_execucao';
let _lastRunDate = '';
let _executando = false;

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
    `Lembrete ${hoje}: email=${resultado.enviadosEmail || resultado.enviados || 0} ` +
      `whatsapp=${resultado.enviadosWhats || 0} totalDia=${resultado.totalDia || 0} ` +
      `puladasHorario=${resultado.puladasHorario || 0}`
  );
  return resultado;
}

function verificarHorarioLembreteReservas() {
  const now = new Date();
  const hoje = dateKeyBrasilia(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const hora = Number(parts.find((p) => p.type === 'hour')?.value || 0);

  // 07:00 BRT; se perdeu a janela (deploy/reinício), reenvia até 19:00 (uma vez ao dia).
  if (hora >= 7 && hora < 19 && !_executando && _lastRunDate !== hoje) {
    _executando = true;
    jaRodouHoje(hoje)
      .then((jaRodou) => {
        if (jaRodou) {
          _lastRunDate = hoje;
          console.log(TAG, `Já executado hoje (${hoje}) — ignorando.`);
          return;
        }
        // Só marca após sucesso — se falhar, tenta de novo nos próximos minutos da janela.
        return executarLembreteDiario().then(() => marcarRodouHoje(hoje));
      })
      .catch((err) => {
        console.error(TAG, 'Erro:', err?.message || err);
      })
      .finally(() => {
        _executando = false;
      });
  }
}

function iniciarCronLembreteReservasEmail() {
  console.log(TAG, 'Timer iniciado — verifica a cada 1 min (disparo 07:00 BRT, reenvio até 19:00).');
  verificarHorarioLembreteReservas();
  setInterval(verificarHorarioLembreteReservas, 60 * 1000);
}

module.exports = {
  iniciarCronLembreteReservasEmail,
  executarLembreteDiario,
};
