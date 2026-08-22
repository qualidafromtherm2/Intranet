/**
 * Erros da API Cursor ligados a agent encerrado/arquivado.
 */
'use strict';

function collectErrorText(err) {
  if (err == null) return '';
  const parts = [
    err.message,
    err.code,
    err.error,
    err.data?.error,
    err.data?.code,
    err.data?.message,
    typeof err.data === 'string' ? err.data : '',
  ];
  return parts
    .map((v) => {
      if (v == null) return '';
      if (typeof v === 'object') {
        try {
          return JSON.stringify(v);
        } catch {
          return '';
        }
      }
      return String(v);
    })
    .join(' ')
    .toLowerCase();
}

function isAgentArchivedError(err) {
  const blob = collectErrorText(err);
  if (!blob) return false;
  return /agent_archived|agent is archived|agent has been archived|agent archived/.test(blob);
}

module.exports = {
  collectErrorText,
  isAgentArchivedError,
};
