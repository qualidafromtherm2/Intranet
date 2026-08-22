/**
 * Texto do Chatbot Cloud Agent: follow-up não pode colar a resposta anterior.
 */
'use strict';

function collapseWs(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function asList(previousTexts) {
  return (Array.isArray(previousTexts) ? previousTexts : [previousTexts])
    .map((t) => String(t || '').trim())
    .filter((t) => t.length >= 32)
    .sort((a, b) => b.length - a.length);
}

/**
 * Se a resposta nova começa com o texto da resposta anterior, corta o prefixo.
 */
function stripPreviousAssistantPrefix(text, previousTexts = []) {
  let out = String(text || '').trim();
  if (!out) return out;

  for (const prev of asList(previousTexts)) {
    if (!out) return '';
    if (out === prev) return '';
    if (out.startsWith(prev)) {
      out = out.slice(prev.length).replace(/^[\s.]+/, '').trim();
      continue;
    }
    const outN = collapseWs(out);
    const prevN = collapseWs(prev);
    if (outN === prevN) return '';
    if (outN.startsWith(prevN)) {
      out = outN.slice(prevN.length).trim();
    }
  }
  return out;
}

/**
 * Junta chunks do stream: snapshot crescente substitui; delta duplicado é ignorado.
 */
function mergeAssistantStream(accumulated, chunk) {
  const acc = String(accumulated || '');
  const next = String(chunk || '');
  if (!next) return acc;
  if (!acc) return next;
  if (next === acc) return acc;
  if (next.startsWith(acc)) return next;
  if (acc.startsWith(next)) return acc;
  if (acc.endsWith(next)) return acc;

  const maxOverlap = Math.min(acc.length, next.length);
  for (let i = maxOverlap; i >= 16; i -= 1) {
    if (acc.endsWith(next.slice(0, i))) {
      return acc + next.slice(i);
    }
  }
  return acc + next;
}

function messageRunId(m) {
  return m?.runId || m?.cursor_run_id || m?.cursorRunId || null;
}

/** Última mensagem assistant gravada neste run (não a do turno anterior). */
function assistantForRun(messages, runId) {
  const list = Array.isArray(messages) ? messages : [];
  const want = String(runId || '').trim();
  if (!want) return null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (!m || m.role !== 'assistant') continue;
    if (String(messageRunId(m) || '') !== want) continue;
    if (!String(m.content || '').trim()) continue;
    return m;
  }
  return null;
}

function previousAssistantContents(messages, { excludeRunId } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const skip = String(excludeRunId || '').trim();
  const out = [];
  for (const m of list) {
    if (!m || m.role !== 'assistant') continue;
    if (skip && String(messageRunId(m) || '') === skip) continue;
    const c = String(m.content || '').trim();
    if (c) out.push(c);
  }
  return out;
}

module.exports = {
  collapseWs,
  stripPreviousAssistantPrefix,
  mergeAssistantStream,
  assistantForRun,
  previousAssistantContents,
};
