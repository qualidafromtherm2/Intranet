/**
 * Texto do Chatbot Cloud Agent: follow-up não pode colar a resposta anterior.
 * Stream: não aparar espaços dos deltas (senão "sessão"+" devolve" vira "sessãodevolve").
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
 * Importante: se NÃO houver vazamento, preserva espaços no início do chunk (deltas do stream).
 */
function stripPreviousAssistantPrefix(text, previousTexts = []) {
  let out = String(text || '');
  if (!out) return out;

  let stripped = false;
  for (const prev of asList(previousTexts)) {
    const candidate = out.replace(/^\s+/, '');
    if (!candidate) return '';
    if (candidate === prev) return '';
    if (candidate.startsWith(prev)) {
      out = candidate.slice(prev.length).replace(/^[\s.]+/, '');
      stripped = true;
      continue;
    }
    const outN = collapseWs(candidate);
    const prevN = collapseWs(prev);
    if (outN === prevN) return '';
    if (outN.startsWith(prevN)) {
      out = outN.slice(prevN.length).replace(/^\s+/, '');
      stripped = true;
    }
  }
  // Só trim no resultado final quando cortou prefixo (mensagem completa).
  // Deltas do stream (" devolve") precisam manter o espaço inicial.
  return stripped ? out.trim() : out;
}

function needsSpaceBetween(left, right) {
  if (!left || !right) return false;
  if (/\s$/.test(left) || /^\s/.test(right)) return false;
  // )Vou  …Vou  .Vou  `cod`Agora
  if (/[.!?…,:;)\]}`"'»]$/.test(left) && /^[\p{L}\p{N}`"'«“(\[]/u.test(right)) return true;
  // letra + Maiúscula (nova frase/token)
  if (/\p{L}$/u.test(left) && /^\p{Lu}/u.test(right)) return true;
  // palavra + abertura de código
  if (/[\p{L}\p{N}]$/u.test(left) && /^`/.test(right)) return true;
  return false;
}

function joinStreamParts(left, right) {
  if (needsSpaceBetween(left, right)) {
    return `${left} ${String(right).replace(/^\s+/, '')}`;
  }
  return left + right;
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
  // Overlap curto (≥ 8) evita "…sessão" + "sessão devolve" virar duplicata
  for (let i = maxOverlap; i >= 8; i -= 1) {
    if (acc.endsWith(next.slice(0, i))) {
      return joinStreamParts(acc, next.slice(i));
    }
  }
  return joinStreamParts(acc, next);
}

/**
 * Corrige texto já grudado (exibição e gravação).
 */
function normalizeAssistantText(src) {
  let s = String(src || '').replace(/\r\n/g, '\n');

  // Frases grudadas: "modal.O modal" → nova linha
  s = s.replace(/([.!?…])(\p{Lu})/gu, '$1\n$2');
  s = s.replace(/([.!?…])[ \t]+(?=[\p{Lu}"“'(\[])/gu, '$1\n');

  // Pontuação/fechamento colado em letra: ")Vou" "`x`Agora"
  s = s.replace(/([)\]}…])(\p{L})/gu, '$1 $2');
  s = s.replace(/(`[^`]+`)(\p{L})/gu, '$1 $2');

  // Minúscula/número/código colado em maiúscula: "códigoVou"
  s = s.replace(/([\p{Ll}\p{N}`])(\p{Lu})/gu, '$1 $2');

  // "sessãodevolve" / "conversãopara" — sufixo comum colado em palavra minúscula
  s = s.replace(/(ção|são|ssão|agem|dade|mente)(?=\p{Ll}{3,})/giu, '$1 ');

  // ", emparalelo" / "emseguida"
  s = s.replace(
    /\b(em|na|no|ao|à)(?=(paralelo|seguida|frente|baixo|cima|conjunto|contato))/giu,
    '$1 '
  );
  // fallback: vírgula + "em" colado
  s = s.replace(/,\s*em(?=\p{Ll}{4,})/giu, ', em ');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/[ \t]{2,}/g, ' ');
  return s;
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
  normalizeAssistantText,
  needsSpaceBetween,
  joinStreamParts,
  assistantForRun,
  previousAssistantContents,
};
