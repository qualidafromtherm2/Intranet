/**
 * CRON — Registra turnos do dia às 07:00 (dias úteis)
 * Copia todos os Turno_padrao para Turno_dia na data atual.
 */
const { dbQuery } = require('../src/db');
const {
  registrarTurnosDiaAutomatico,
  dateKeyInTz,
} = require('../utils/tempoProducao');

const TAG = '[TurnoDiaAuto]';
let _lastRunDate = '';

async function jaRodouHoje(hoje) {
  try {
    const { rows } = await dbQuery(
      `SELECT valor FROM public.cron_control WHERE chave = 'turno_dia_auto_ultima_execucao' LIMIT 1`
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
       VALUES ('turno_dia_auto_ultima_execucao', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [hoje]
    );
  } catch {
    /* memória já atualizada */
  }
}

function isDiaUtil(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

async function executarRegistroAutomatico() {
  const hoje = dateKeyInTz(new Date());
  if (!isDiaUtil(hoje)) {
    console.log(TAG, `Hoje (${hoje}) não é dia útil — ignorando.`);
    return;
  }
  const resultado = await registrarTurnosDiaAutomatico(hoje);
  console.log(TAG, `Turnos do dia registrados: ${resultado.total} (${hoje}).`);
}

function verificarHorarioTurnoDia() {
  const now = new Date();
  const hoje = dateKeyInTz(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const hora = Number(parts.find(p => p.type === 'hour')?.value || 0);
  const minuto = Number(parts.find(p => p.type === 'minute')?.value || 0);

  if (hora === 7 && minuto < 5 && _lastRunDate !== hoje) {
    _lastRunDate = hoje;
    jaRodouHoje(hoje).then((jaRodou) => {
      if (jaRodou) {
        console.log(TAG, `Já executado hoje (${hoje}) — ignorando.`);
        return;
      }
      return marcarRodouHoje(hoje).then(() => executarRegistroAutomatico());
    }).catch((err) => {
      console.error(TAG, 'Erro:', err?.message || err);
    });
  }
}

function iniciarCronTurnoDiaAutomatico() {
  console.log(TAG, 'Timer iniciado — verifica a cada 1 min (disparo 07:00 dias úteis).');
  verificarHorarioTurnoDia();
  setInterval(verificarHorarioTurnoDia, 60 * 1000);
}

module.exports = {
  iniciarCronTurnoDiaAutomatico,
  executarRegistroAutomatico,
};
