/**
 * Anexa horário (| HH:MM, America/Sao_Paulo) à observação enviada à Omie.
 * Se já houver padrão de hora no texto, não duplica.
 * Respeita o limite de 200 caracteres da Omie, priorizando a hora no final.
 */

const HORA_OBS_RE = /\|\s*\d{1,2}:\d{2}\b/;
const LIMITE_OBS_OMIE = 200;

function horaAgoraSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function anexarHoraObs(obs, date = new Date()) {
  const base = String(obs || '').trim();
  if (HORA_OBS_RE.test(base)) {
    return base.slice(0, LIMITE_OBS_OMIE);
  }

  const hora = horaAgoraSaoPaulo(date);
  const sufixo = ` | ${hora}`;
  const maxBase = LIMITE_OBS_OMIE - sufixo.length;
  const texto = base ? base.slice(0, Math.max(0, maxBase)) : '';
  const resultado = texto ? `${texto}${sufixo}` : sufixo.trim();
  return resultado.slice(0, LIMITE_OBS_OMIE);
}

module.exports = {
  anexarHoraObs,
  horaAgoraSaoPaulo,
  HORA_OBS_RE,
  LIMITE_OBS_OMIE
};
