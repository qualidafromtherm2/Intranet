/**
 * Conf. sistema → Chatbot
 * Chat estilo Cursor/WhatsApp: markdown, histórico SQL, sem caixa “Aprovar” no meio.
 */
(function () {
  'use strict';

  const PROMPTS_KEY = 'cursorChatPromptsV1';
  const CLOUD_CHAT_KEY = 'cursorCloudChatActiveV1';

  const state = {
    conversationId: null,
    agentId: null,
    runId: null,
    streamRunId: null,
    finishWaitCount: 0,
    prNumber: null,
    prUrl: null,
    branch: null,
    pollTimer: null,
    tickTimer: null,
    eventSource: null,
    busy: false,
    workStartedAt: null,
    lastEventAt: null,
    lastActivity: '',
    statusPinned: '',
    lastUiError: '',
    liveBubble: null,
    pendingImages: [],
    specialistId: null,
    specialistName: null,
    specialistsCache: null,
    previousAssistantText: '',
    histTab: 'atual',
    routing: null,
    preferredProvider: null,
    freeProviders: [],
    previewUrl: null,
    previewPollTimer: null,
    previewOpenedOnce: false,
    previewStartedAt: null,
    previewSyncedFor: null,
    /** idle | pending | live | failed */
    previewStatus: 'idle',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function loadCloudSession() {
    try {
      return JSON.parse(localStorage.getItem(CLOUD_CHAT_KEY) || 'null') || null;
    } catch {
      return null;
    }
  }

  function saveCloudSession(patch = {}) {
    const prev = loadCloudSession() || {};
    const next = {
      ...prev,
      conversationId: state.conversationId ?? prev.conversationId ?? null,
      agentId: state.agentId ?? prev.agentId ?? null,
      prNumber: state.prNumber ?? prev.prNumber ?? null,
      prUrl: state.prUrl ?? prev.prUrl ?? null,
      branch: state.branch ?? prev.branch ?? null,
      specialistId: state.specialistId ?? prev.specialistId ?? null,
      specialistName: state.specialistName ?? prev.specialistName ?? null,
      preferredProvider: state.preferredProvider ?? prev.preferredProvider ?? null,
      previewUrl: state.previewUrl ?? prev.previewUrl ?? null,
      previewStatus: state.previewStatus ?? prev.previewStatus ?? 'idle',
      ...patch,
      updatedAt: Date.now(),
    };
    localStorage.setItem(CLOUD_CHAT_KEY, JSON.stringify(next));
  }

  function clearCloudSession() {
    localStorage.removeItem(CLOUD_CHAT_KEY);
  }

  function applySession(sess) {
    if (!sess) return;
    if (sess.conversationId) state.conversationId = sess.conversationId;
    if (sess.agentId) state.agentId = sess.agentId;
    if (sess.prNumber != null) state.prNumber = sess.prNumber;
    if (sess.prUrl) state.prUrl = sess.prUrl;
    if (sess.branch) state.branch = sess.branch;
    if (sess.specialistId) state.specialistId = sess.specialistId;
    if (sess.specialistName) state.specialistName = sess.specialistName;
    if (Object.prototype.hasOwnProperty.call(sess, 'preferredProvider')) {
      state.preferredProvider = sess.preferredProvider || null;
    }
    if (sess.previewUrl) state.previewUrl = sess.previewUrl;
    if (sess.previewStatus) state.previewStatus = sess.previewStatus;
  }

  function collapseWs(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function stripPreviousAssistantPrefix(text, previousTexts) {
    let out = String(text || '');
    if (!out) return out;
    let stripped = false;
    const list = (Array.isArray(previousTexts) ? previousTexts : [previousTexts])
      .map((t) => String(t || '').trim())
      .filter((t) => t.length >= 32)
      .sort((a, b) => b.length - a.length);
    for (const prev of list) {
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
    return stripped ? out.trim() : out;
  }

  function needsSpaceBetween(left, right) {
    if (!left || !right) return false;
    if (/\s$/.test(left) || /^\s/.test(right)) return false;
    if (/[.!?…,:;)\]}`"'»]$/.test(left) && /^[\p{L}\p{N}`"'«“(\[]/u.test(right)) return true;
    if (/\p{L}$/u.test(left) && /^\p{Lu}/u.test(right)) return true;
    if (/[\p{L}\p{N}]$/u.test(left) && /^`/.test(right)) return true;
    return false;
  }

  function joinStreamParts(left, right) {
    if (needsSpaceBetween(left, right)) {
      return `${left} ${String(right).replace(/^\s+/, '')}`;
    }
    return left + right;
  }

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
    for (let i = maxOverlap; i >= 8; i -= 1) {
      if (acc.endsWith(next.slice(0, i))) return joinStreamParts(acc, next.slice(i));
    }
    return joinStreamParts(acc, next);
  }

  function messageRunId(m) {
    return m?.runId || m?.cursor_run_id || m?.cursorRunId || null;
  }

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

  function rememberPreviousAssistant(text) {
    const t = String(text || '').trim();
    if (t) state.previousAssistantText = t;
  }

  function withoutPreviousLeak(text) {
    return stripPreviousAssistantPrefix(text, [state.previousAssistantText]);
  }

  function lastCompletedAssistantText() {
    const box = $('cursorChatMessages');
    if (!box) return state.previousAssistantText || '';
    const bubbles = [...box.querySelectorAll('.cursor-chat-bubble.assistant:not(.streaming)')];
    const last = bubbles[bubbles.length - 1];
    if (!last) return state.previousAssistantText || '';
    const body = last.querySelector('.md-body');
    return String(body?.textContent || last.textContent || '').trim() || state.previousAssistantText || '';
  }

  /** Markdown leve → HTML seguro (negrito, código, tabelas, listas, links). */
  function normalizeAssistantText(src) {
    let s = String(src || '').replace(/\r\n/g, '\n');
    // Frases grudadas do stream: "modal.O modal" → nova linha
    s = s.replace(/([.!?…])(\p{Lu})/gu, '$1\n$2');
    s = s.replace(/([.!?…])[ \t]+(?=[\p{Lu}"“'(\[])/gu, '$1\n');
    // )Vou  `x`Agora
    s = s.replace(/([)\]}…])(\p{L})/gu, '$1 $2');
    s = s.replace(/(`[^`]+`)(\p{L})/gu, '$1 $2');
    // Minúscula/número colado em maiúscula: "códigoVou"
    s = s.replace(/([\p{Ll}\p{N}`])(\p{Lu})/gu, '$1 $2');
    // "sessãodevolve"
    s = s.replace(/(ção|são|ssão|agem|dade|mente)(?=\p{Ll}{3,})/giu, '$1 ');
    s = s.replace(
      /\b(em|na|no|ao|à)(?=(paralelo|seguida|frente|baixo|cima|conjunto|contato))/giu,
      '$1 '
    );
    s = s.replace(/,\s*em(?=\p{Ll}{4,})/giu, ', em ');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.replace(/[ \t]{2,}/g, ' ');
    return s;
  }

  function markBubbleDone(bubble) {
    if (!bubble || !bubble.classList.contains('assistant')) return;
    if (bubble.classList.contains('streaming')) return;
    bubble.classList.add('is-done');
    if (bubble.querySelector('.cursor-chat-done-icon')) return;
    const icon = document.createElement('span');
    icon.className = 'cursor-chat-done-icon';
    icon.title = 'Resposta concluída';
    icon.setAttribute('aria-label', 'Resposta concluída');
    icon.textContent = '✓';
    bubble.appendChild(icon);
  }

  function renderMarkdown(src) {
    let s = normalizeAssistantText(src);
    s = s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // code fences
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="md-pre"><code class="lang-${lang || 'txt'}">${code.replace(/\n$/, '')}</code></pre>`;
    });
    // inline code
    s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
    // bold / italic
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // links
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    // tables
    s = s.replace(/(^|\n)((?:\|.+\|\n)+)/g, (match, lead, block) => {
      const rows = block.trim().split('\n').filter(Boolean);
      if (rows.length < 2) return match;
      const parseRow = (row) =>
        row
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const isSep = (row) => /^\|?\s*:?-{3,}/.test(row);
      let i = 0;
      let html = `${lead}<table class="md-table"><thead><tr>`;
      parseRow(rows[0]).forEach((c) => {
        html += `<th>${c}</th>`;
      });
      html += '</tr></thead><tbody>';
      i = isSep(rows[1]) ? 2 : 1;
      for (; i < rows.length; i += 1) {
        if (isSep(rows[i])) continue;
        html += '<tr>';
        parseRow(rows[i]).forEach((c) => {
          html += `<td>${c}</td>`;
        });
        html += '</tr>';
      }
      html += '</tbody></table>';
      return html;
    });
    // lists
    s = s.replace(/(^|\n)((?:[-*] .+(?:\n|$))+)/g, (match, lead, block) => {
      const items = block
        .trim()
        .split('\n')
        .map((line) => line.replace(/^[-*] /, '').trim())
        .filter(Boolean);
      return `${lead}<ul class="md-ul">${items.map((it) => `<li>${it}</li>`).join('')}</ul>`;
    });
    // paragraphs / breaks
    s = s.replace(/\n\n+/g, '</p><p>');
    s = s.replace(/\n/g, '<br>');
    return `<p>${s}</p>`;
  }

  function clearMessages() {
    const box = $('cursorChatMessages');
    if (box) box.innerHTML = '';
    state.liveBubble = null;
  }

  function appendBubble(role, text, opts) {
    const box = $('cursorChatMessages');
    if (!box) return null;
    const b = el('div', `cursor-chat-bubble ${role}`, null);
    if (opts?.id) b.dataset.msgId = opts.id;
    if (opts?.messageId) b.dataset.messageId = String(opts.messageId);
    if (opts?.streaming) b.classList.add('streaming');
    if (opts?.specialist) b.classList.add('specialist');

    if (opts?.images?.length) {
      b.classList.add('user-with-image');
      opts.images.forEach((img) => {
        const image = document.createElement('img');
        image.src = img.url || img.previewUrl || `data:${img.mimeType};base64,${img.data}`;
        image.alt = 'anexo';
        image.loading = 'lazy';
        b.appendChild(image);
      });
    }

    if (text) {
      const body = document.createElement('div');
      body.className = 'md-body';
      if (opts?.specialist) {
        body.textContent = text;
      } else if (role === 'assistant' || role === 'system') {
        body.innerHTML = renderMarkdown(text);
      } else {
        body.textContent = text;
      }
      b.appendChild(body);
    } else if (!opts?.images?.length) {
      b.textContent = '';
    }

    if (opts?.messageId && role !== 'meta' && role !== 'error' && !opts?.streaming) {
      attachStarButton(b, opts.messageId, Boolean(opts.favorited));
    }

    box.appendChild(b);
    if (role === 'assistant' && !opts?.streaming) markBubbleDone(b);
    box.scrollTop = box.scrollHeight;
    return b;
  }

  function attachStarButton(bubble, messageId, favorited) {
    if (!bubble || !messageId) return;
    if (bubble.classList.contains('streaming') || bubble.classList.contains('meta') || bubble.classList.contains('error')) {
      return;
    }
    let star = bubble.querySelector(':scope > .cursor-chat-star');
    if (!star) {
      star = document.createElement('button');
      star.type = 'button';
      star.className = 'cursor-chat-star';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        void toggleFavorite(messageId, star);
      });
      bubble.appendChild(star);
    }
    const on = Boolean(favorited);
    star.classList.toggle('is-on', on);
    star.textContent = on ? '★' : '☆';
    star.title = on ? 'Remover dos favoritos' : 'Favoritar mensagem';
  }

  async function toggleFavorite(messageId, starEl) {
    const turningOn = !starEl?.classList.contains('is-on');
    try {
      const data = await api(`/messages/${encodeURIComponent(messageId)}/favorite`, {
        method: 'POST',
        body: JSON.stringify({ favorite: turningOn }),
      });
      attachStarButton(starEl?.closest('.cursor-chat-bubble'), messageId, data.favorited);
      if (state.histTab === 'favorito') await refreshFavoriteList();
    } catch (e) {
      showStickyError(e.message || 'Falha ao favoritar');
    }
  }

  function setBubbleMarkdown(bubble, text) {
    if (!bubble) return;
    let body = bubble.querySelector('.md-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'md-body';
      bubble.appendChild(body);
    }
    // durante stream: texto puro; ao final renderiza markdown
    if (bubble.classList.contains('streaming')) {
      body.textContent = text;
    } else {
      body.innerHTML = renderMarkdown(text);
    }
    const box = $('cursorChatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function renderPendingPreviews() {
    const box = $('cursorChatPreviews');
    if (!box) return;
    box.innerHTML = '';
    state.pendingImages.forEach((img, idx) => {
      const wrap = el('div', 'cursor-chat-preview-item');
      const image = document.createElement('img');
      image.src = img.previewUrl;
      image.alt = `foto ${idx + 1}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '×';
      btn.title = 'Remover';
      btn.addEventListener('click', () => {
        URL.revokeObjectURL(img.previewUrl);
        state.pendingImages.splice(idx, 1);
        renderPendingPreviews();
      });
      wrap.appendChild(image);
      wrap.appendChild(btn);
      box.appendChild(wrap);
    });
  }

  function clearPendingImages() {
    state.pendingImages.forEach((img) => {
      try {
        URL.revokeObjectURL(img.previewUrl);
      } catch (_) {}
    });
    state.pendingImages = [];
    renderPendingPreviews();
  }

  function fileToImagePayload(file) {
    return new Promise((resolve, reject) => {
      if (!file || !String(file.type || '').startsWith('image/')) {
        reject(new Error('Arquivo não é imagem'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const m = result.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) {
          reject(new Error('Falha ao ler imagem'));
          return;
        }
        resolve({
          data: m[2],
          mimeType: m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase(),
          previewUrl: URL.createObjectURL(file),
        });
      };
      reader.onerror = () => reject(new Error('Falha ao ler imagem'));
      reader.readAsDataURL(file);
    });
  }

  async function addImageFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (state.pendingImages.length >= 5) {
        appendBubble('error', 'Máximo de 5 imagens por mensagem.');
        break;
      }
      try {
        const payload = await fileToImagePayload(file);
        if (payload.data.length > 22_000_000) {
          appendBubble('error', `Imagem muito grande: ${file.name || 'anexo'}`);
          URL.revokeObjectURL(payload.previewUrl);
          continue;
        }
        state.pendingImages.push(payload);
      } catch (e) {
        appendBubble('error', e.message || 'Não foi possível anexar a imagem');
      }
    }
    renderPendingPreviews();
  }

  function formatElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m <= 0) return `${r}s`;
    return `${m}m ${String(r).padStart(2, '0')}s`;
  }

  /** Altura mínima → cresce com o texto → scrollbar no teto (~Cursor). */
  function autoResizeChatInput() {
    const ta = $('cursorChatInput');
    if (!ta) return;
    const min = 44;
    const max = 200;
    ta.style.height = 'auto';
    const next = Math.min(Math.max(ta.scrollHeight, min), max);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }

  const voice = {
    recognition: null,
    active: false,
    sendOnEnd: false,
    baseText: '',
    finalParts: [],
  };

  function setMicUi(on) {
    const mic = $('cursorChatMic');
    if (!mic) return;
    mic.classList.toggle('is-recording', !!on);
    mic.setAttribute('aria-pressed', on ? 'true' : 'false');
    mic.title = on ? 'Parar e enviar' : 'Falar (grava → texto → envia)';
  }

  function applyVoiceDraft(interim) {
    const input = $('cursorChatInput');
    if (!input) return;
    const spoken = [...voice.finalParts, interim || ''].join(' ').replace(/\s+/g, ' ').trim();
    const base = voice.baseText;
    input.value = [base, spoken].filter(Boolean).join(base && spoken ? ' ' : '');
    autoResizeChatInput();
  }

  function stopVoiceInput(shouldSend) {
    voice.sendOnEnd = !!shouldSend;
    voice.active = false;
    setMicUi(false);
    try {
      voice.recognition?.stop();
    } catch (_) {}
  }

  function finishVoiceAndMaybeSend() {
    const input = $('cursorChatInput');
    const spoken = voice.finalParts.join(' ').replace(/\s+/g, ' ').trim();
    const base = String(voice.baseText || '').trim();
    const full = [base, spoken].filter(Boolean).join(base && spoken ? ' ' : '');
    if (input) {
      input.value = full;
      autoResizeChatInput();
    }
    const doSend = voice.sendOnEnd;
    voice.sendOnEnd = false;
    voice.finalParts = [];
    voice.baseText = '';
    if (doSend && full && !state.busy) {
      void sendMessage();
    } else if (doSend && !full) {
      setStatus('Nada captado no áudio — tente de novo', 'warn');
    }
  }

  function startVoiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      appendBubble(
        'error',
        'Ditado por voz não disponível neste navegador. Use Chrome ou Edge (HTTPS) e permita o microfone.'
      );
      return;
    }
    if (state.busy) return;

    const input = $('cursorChatInput');
    voice.baseText = String(input?.value || '').trim();
    voice.finalParts = [];
    voice.sendOnEnd = false;
    voice.active = true;
    setMicUi(true);
    setStatus('Ouvindo… clique de novo no microfone para enviar', 'warn');

    const recognition = new SR();
    voice.recognition = recognition;
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      const finals = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i]?.[0]?.transcript || '';
        if (event.results[i].isFinal) finals.push(piece.trim());
        else interim += piece;
      }
      if (finals.length) {
        finals.forEach((p) => {
          if (p) voice.finalParts.push(p);
        });
      }
      applyVoiceDraft(interim.trim());
    };

    recognition.onerror = (event) => {
      const code = String(event?.error || '');
      voice.active = false;
      setMicUi(false);
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        appendBubble('error', 'Permissão de microfone negada. Libere o microfone neste site e tente de novo.');
      } else if (code !== 'aborted' && code !== 'no-speech') {
        appendBubble('error', `Falha no ditado (${code || 'erro'}).`);
      }
      if (code === 'no-speech') {
        setStatus('Sem fala detectada', 'warn');
      }
    };

    recognition.onend = () => {
      const wasActive = voice.active;
      voice.active = false;
      setMicUi(false);
      // Alguns browsers encerram sozinhos; se ainda queríamos gravar, reinicia
      if (wasActive && !voice.sendOnEnd) {
        try {
          recognition.start();
          voice.active = true;
          setMicUi(true);
          return;
        } catch (_) {}
      }
      finishVoiceAndMaybeSend();
    };

    try {
      recognition.start();
    } catch (e) {
      voice.active = false;
      setMicUi(false);
      appendBubble('error', e.message || 'Não foi possível iniciar o microfone.');
    }
  }

  function toggleVoiceInput() {
    if (voice.active) stopVoiceInput(true);
    else startVoiceInput();
  }

  function refreshStatusLine() {
    const line = $('cursorChatStatus');
    const badge = $('cursorChatBadge');
    if (!line) return;

    let workText = '';
    if (state.busy || state.eventSource) {
      const elapsed = state.workStartedAt ? formatElapsed(Date.now() - state.workStartedAt) : '…';
      const ago = state.lastEventAt
        ? ` · sinal há ${formatElapsed(Date.now() - state.lastEventAt)}`
        : '';
      const act = state.lastActivity ? ` · ${state.lastActivity}` : '';
      workText = `Trabalhando há ${elapsed}${act}${ago}`;
      // topo: só badge / título fixo — o ticker fica só debaixo da bolha
      line.textContent = state.statusPinned || 'Em execução';
      if (badge) {
        badge.className = 'cursor-chat-badge warn';
        badge.textContent = 'Trabalhando';
      }
    } else {
      line.textContent = state.statusPinned || state.lastActivity || 'Pronto';
    }

    // status colado debaixo da bolha que está respondendo
    if (state.liveBubble) {
      let st = state.liveBubble.querySelector('.cursor-chat-work-status');
      if (!st) {
        st = document.createElement('div');
        st.className = 'cursor-chat-work-status';
        state.liveBubble.appendChild(st);
      }
      if (workText) {
        st.textContent = workText;
        st.hidden = false;
      } else {
        st.hidden = true;
      }
    }
  }

  function setStatus(text, kind) {
    const t = text || '';
    const ephemeral =
      /trabalhando|conectando|enviando|escrevendo|pensando|usando |concluiu |sinal|stream|ativando|ainda trabalhando|reconectando|instável|checando|finalizando|atualizando status/i.test(
        t
      );
    if (!ephemeral) state.statusPinned = t;
    state.lastActivity = t;
    const badge = $('cursorChatBadge');
    if (badge) {
      badge.className = 'cursor-chat-badge' + (kind ? ` ${kind}` : '');
      badge.textContent =
        kind === 'ok' ? 'Pronto' : kind === 'err' ? 'Erro' : kind === 'warn' ? 'Trabalhando' : 'Chatbot';
    }
    refreshStatusLine();
  }

  function stopTick() {
    if (state.tickTimer) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
  }

  function startTick() {
    stopTick();
    state.tickTimer = setInterval(refreshStatusLine, 1000);
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function stopStream() {
    if (state.eventSource) {
      try {
        state.eventSource.close();
      } catch (_) {}
      state.eventSource = null;
    }
    state.streamRunId = null;
  }

  function stopWorkWatchers({ keepLive = false } = {}) {
    stopPoll();
    stopStream();
    stopTick();
    state.workStartedAt = null;
    state.lastEventAt = null;
    if (state.liveBubble && !keepLive) {
      const doneBubble = state.liveBubble;
      doneBubble.classList.remove('streaming');
      const body = doneBubble.querySelector('.md-body');
      if (body && body.textContent) {
        body.innerHTML = renderMarkdown(body.textContent);
      }
      const st = doneBubble.querySelector('.cursor-chat-work-status');
      if (st) st.hidden = true;
      markBubbleDone(doneBubble);
      state.liveBubble = null;
    }
  }

  function setBusy(v) {
    state.busy = v;
    const send = $('cursorChatSend');
    if (send) send.disabled = false; // allow follow-up while busy (backend cancela)
    updatePublishBar();
    updateConfigActions();
  }

  function isTerminalStatus(st) {
    const s = String(st || '').toUpperCase();
    return s === 'FINISHED' || s === 'ERROR' || s === 'CANCELLED' || s === 'EXPIRED';
  }

  function isActiveStatus(st) {
    const s = String(st || '').toUpperCase();
    return s === 'RUNNING' || s === 'CREATING';
  }

  /** Atualiza bolha ao vivo a partir do SQL sem apagar a UI no meio do run. */
  async function softSyncWhileBusy() {
    if (!state.conversationId || !state.busy) return;
    try {
      const data = await api(`/conversations/${encodeURIComponent(state.conversationId)}`);
      state.prNumber = data.prNumber || state.prNumber;
      state.prUrl = data.prUrl || state.prUrl;
      state.branch = data.branch || state.branch;
      updatePublishBar();
      const msgs = data.messages || [];
      const lastCompleted = [...msgs].reverse().find(
        (m) =>
          m.role === 'assistant' &&
          m.content &&
          (!state.runId || String(messageRunId(m) || '') !== String(state.runId))
      );
      if (lastCompleted?.content) rememberPreviousAssistant(lastCompleted.content);
      // Só o texto DESTE run — senão a bolha nova nasce com pedaços da resposta antiga
      const lastAsst = assistantForRun(msgs, state.runId);
      if (lastAsst?.content) {
        const b = ensureLiveBubble();
        setBubbleMarkdown(b, withoutPreviousLeak(lastAsst.content));
        b.classList.add('streaming');
      }
    } catch (_) {}
  }

  function ensureWorkingUi() {
    setBusy(true);
    state.workStartedAt = state.workStartedAt || Date.now();
    state.lastEventAt = Date.now();
    startTick();
    ensureLiveBubble();
    refreshStatusLine();
    updatePublishBar();
  }

  function markActivity(label) {
    state.lastEventAt = Date.now();
    if (label) state.lastActivity = label;
    refreshStatusLine();
  }

  function isTestMode() {
    return document.body.classList.contains('cursor-chat-preview-mode');
  }

  function stopPreviewPoll() {
    if (state.previewPollTimer) {
      clearTimeout(state.previewPollTimer);
      state.previewPollTimer = null;
    }
  }

  function setPreviewBanner({ text, showOpen, showApprove }) {
    document.body.classList.add('cursor-chat-preview-mode');
    const el = $('cursorChatPreviewText');
    if (el) el.textContent = text || '';
    const openBtn = $('cursorChatBannerOpen');
    if (openBtn) {
      openBtn.hidden = !showOpen || !state.previewUrl;
      openBtn.style.display = showOpen && state.previewUrl ? '' : 'none';
    }
    const approveBtn = $('cursorChatBannerApprove');
    if (approveBtn) {
      approveBtn.hidden = showApprove === false;
      approveBtn.style.display = showApprove === false ? 'none' : '';
    }
    updateTestPrButtons();
  }

  function previewReady() {
    return state.previewStatus === 'live' && Boolean(state.previewUrl);
  }

  function applyPreviewPayload(data, prNumber) {
    const n = prNumber || data?.prNumber || state.prNumber;
    if (data?.previewUrl) state.previewUrl = data.previewUrl;
    if (data?.status === 'live' && data.previewUrl) {
      state.previewStatus = 'live';
      setPreviewBanner({
        text:
          `Preview PR #${n} pronto — use “Abrir PR#${n}” no topo. ` +
          `Usa o mesmo banco do site ao vivo. Ainda NÃO está publicado na main.`,
        showOpen: true,
        showApprove: true,
      });
      setStatus(`Abrir PR#${n}`, 'ok');
      saveCloudSession({ previewUrl: state.previewUrl, previewStatus: 'live' });
      return 'live';
    }
    if (data?.status === 'failed') {
      state.previewStatus = 'failed';
      setPreviewBanner({
        text: `Falha no preview do PR #${n}: ${data.error || 'erro desconhecido'}. Confira Previews Manual no Render.`,
        showOpen: false,
        showApprove: true,
      });
      setStatus('Preview falhou', 'err');
      saveCloudSession({ previewStatus: 'failed' });
      return 'failed';
    }
    if (data?.triggered || data?.status === 'pending') {
      state.previewStatus = 'pending';
      setPreviewBanner({
        text:
          `Subindo preview do PR #${n}… ${data.detail || data.message || 'pode levar alguns minutos'}. ` +
          `Aviso: o preview usa o mesmo banco do site ao vivo.`,
        showOpen: Boolean(data?.previewUrl),
        showApprove: true,
      });
      saveCloudSession({ previewUrl: state.previewUrl, previewStatus: 'pending' });
      return 'pending';
    }
    updateTestPrButtons();
    return data?.status || 'idle';
  }

  async function syncPreviewFromServer() {
    if (!state.prNumber) {
      updateTestPrButtons();
      return;
    }
    try {
      const data = await api(`/preview/${encodeURIComponent(state.prNumber)}`);
      const st = applyPreviewPayload(data, state.prNumber);
      if (st === 'pending' && !state.previewPollTimer) {
        void pollPreviewStatus(state.prNumber);
      }
    } catch (_) {
      updateTestPrButtons();
    }
  }

  function updateTestPrButtons() {
    const hasPr = Boolean(state.prNumber);
    const n = state.prNumber || '…';
    const pending = state.previewStatus === 'pending';
    const live = previewReady();
    const label = !hasPr
      ? 'Testar PR'
      : live
        ? `Abrir PR#${n}`
        : pending
          ? `Subindo PR#${n}…`
          : `Testar PR#${n}`;
    const title = !hasPr
      ? 'Espere o agent abrir um PR'
      : live
        ? 'Abre o site de teste (preview Render) em nova aba'
        : pending
          ? 'Aguardando GitHub + Render liberar o link do preview'
          : 'Dispara label render-preview no GitHub e sobe o preview no Render';
    const disabled = !hasPr || state.busy || pending;
    [ $('cursorChatTestPr'), $('cursorChatCfgTest') ].forEach((btn) => {
      if (!btn) return;
      btn.textContent = label;
      btn.title = title;
      btn.disabled = disabled;
      btn.classList.toggle('is-on', live || pending);
      btn.classList.toggle('success', live);
      btn.classList.toggle('warn', !live);
    });
  }

  function updateConfigActions() {
    const hasPr = Boolean(state.prNumber);
    const approveBtn = $('cursorChatCfgApprove');
    const publishBtn = $('cursorChatCfgPublish');
    const discardBtn = $('cursorChatCfgDiscard');
    const hint = $('cursorChatCfgPrHint');
    updateTestPrButtons();
    [approveBtn, publishBtn, discardBtn].forEach((btn) => {
      if (btn) btn.disabled = !hasPr || state.busy;
    });
    if (hint) {
      if (hasPr) {
        const branch = state.branch ? ` · ${state.branch}` : '';
        if (previewReady()) {
          hint.textContent =
            `PR #${state.prNumber}${branch} — preview pronto. Use “Abrir PR#${state.prNumber}” para ver. Depois Publicar ou Descartar.`;
        } else if (state.previewStatus === 'pending') {
          hint.textContent =
            `PR #${state.prNumber}${branch} — subindo preview no Render (label render-preview). Quando liberar, o botão vira Abrir.`;
        } else {
          hint.textContent =
            `PR #${state.prNumber}${branch} pronto. Clique em “Testar PR#${state.prNumber}” para subir o preview (mesmo banco do site ao vivo).`;
        }
      } else {
        hint.textContent =
          'Ainda sem PR nesta conversa. Quando o agent abrir um pull request, Testar / Publicar / Descartar ficam disponíveis no topo.';
      }
    }
  }

  function exitTestMode() {
    stopPreviewPoll();
    document.body.classList.remove('cursor-chat-preview-mode');
    state.previewOpenedOnce = false;
    if (state.previewStatus === 'pending') state.previewStatus = 'idle';
    updateConfigActions();
  }

  function openPreviewTab() {
    if (!state.previewUrl) return;
    try {
      window.open(state.previewUrl, '_blank', 'noopener,noreferrer');
    } catch (_) {}
  }

  function onTestPrClick() {
    if (!state.prNumber) {
      appendBubble('error', 'Ainda sem PR nesta conversa. Espere o agent abrir um pull request.');
      return;
    }
    if (previewReady()) {
      openPreviewTab();
      return;
    }
    if (state.previewStatus === 'pending') return;
    void startPreviewMode();
  }

  async function pollPreviewStatus(prNumber) {
    stopPreviewPoll();
    try {
      const data = await api(`/preview/${encodeURIComponent(prNumber)}`);
      const st = applyPreviewPayload(data, prNumber);
      if (st === 'live' || st === 'failed') return;
      const started = Number(state.previewStartedAt || 0);
      if (started && Date.now() - started > 8 * 60 * 1000 && !data.previewUrl) {
        state.previewStatus = 'failed';
        setPreviewBanner({
          text:
            `O Render não criou o site de teste do PR #${prNumber}. ` +
            `No Dashboard: serviço da intranet → Previews → Pull Request Previews = Manual. Depois clique de novo em Testar.`,
          showOpen: false,
          showApprove: true,
        });
        setStatus('Preview não subiu', 'err');
        saveCloudSession({ previewStatus: 'failed' });
        return;
      }
      state.previewPollTimer = setTimeout(() => {
        state.previewPollTimer = null;
        void pollPreviewStatus(prNumber);
      }, 5000);
    } catch (e) {
      state.previewStatus = 'failed';
      setPreviewBanner({
        text: `Erro ao consultar preview: ${e.message || 'falha'}`,
        showOpen: false,
        showApprove: true,
      });
      setStatus(e.message || 'Erro no preview', 'err');
    }
  }

  async function startPreviewMode() {
    if (!state.prNumber) {
      appendBubble('error', 'Ainda sem PR nesta conversa. Espere o agent abrir um pull request.');
      return;
    }
    state.previewOpenedOnce = false;
    state.previewUrl = null;
    state.previewStatus = 'pending';
    state.previewStartedAt = Date.now();
    setPreviewBanner({
      text: `Pedindo preview do PR #${state.prNumber} no Render… (Manual: label render-preview)`,
      showOpen: false,
      showApprove: true,
    });
    setStatus(`Subindo PR#${state.prNumber}…`, 'warn');
    saveCloudSession({ previewStatus: 'pending', previewUrl: null });
    try {
      const data = await api('/preview', {
        method: 'POST',
        body: JSON.stringify({
          prNumber: state.prNumber,
          conversationId: state.conversationId,
        }),
      });
      const st = applyPreviewPayload(data, state.prNumber);
      if (st === 'live' || st === 'failed') return;
      void pollPreviewStatus(state.prNumber);
    } catch (e) {
      state.previewStatus = 'failed';
      setPreviewBanner({
        text: `Não foi possível iniciar o preview: ${e.message || 'erro'}`,
        showOpen: false,
        showApprove: true,
      });
      appendBubble('error', e.message || 'Falha ao iniciar preview');
      setStatus(e.message || 'Erro no preview', 'err');
    }
  }

  function updatePublishBar() {
    const bar = $('cursorChatPublishBar');
    const del = $('cursorChatDelete');
    const stop = $('cursorChatStop');
    if (del) del.style.display = state.conversationId || state.agentId ? '' : 'none';
    if (stop) stop.style.display = state.agentId && (state.busy || state.eventSource) ? '' : 'none';
    if (bar) {
      bar.hidden = !state.prNumber;
    }
    updateConfigActions();
    if (state.prNumber && state.previewSyncedFor !== state.prNumber && state.previewStatus === 'idle') {
      state.previewSyncedFor = state.prNumber;
      void syncPreviewFromServer();
    }
  }

  async function api(path, opts) {
    const resp = await fetch(`/api/dev-agent${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
      ...opts,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      const err = new Error(
        data.agentArchived || data.code === 'agent_archived'
          ? 'O agent anterior foi encerrado. A conversa continua.'
          : data.error || `HTTP ${resp.status}`
      );
      err.agentArchived = Boolean(data.agentArchived || data.code === 'agent_archived');
      err.code = data.code || null;
      err.conversationId = data.conversationId || null;
      throw err;
    }
    return data;
  }

  function isAgentArchivedError(err) {
    if (err?.agentArchived || err?.code === 'agent_archived') return true;
    const msg = String(err?.message || '').toLowerCase();
    return /agent_archived|agent is archived|agent has been archived/.test(msg);
  }

  function renderSqlMessages(messages) {
    clearMessages();
    const lastAsst = [...(messages || [])].reverse().find((m) => m.role === 'assistant' && m.content);
    rememberPreviousAssistant(lastAsst?.content || '');
    if (!messages?.length) {
      appendBubble('meta', 'Nenhuma mensagem ainda. Escolha um especialista (Agentes) ou envie um comando.');
    } else {
      messages.forEach((m) => {
        const role = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
        const images = (m.attachments || []).map((a) => ({ url: a.url, mimeType: a.mimeType }));
        if (role === 'user') {
          appendBubble('user', m.content || '', {
            id: `m-${m.id}`,
            messageId: m.id,
            favorited: Boolean(m.favorited),
            images,
            specialist: Boolean(m.specialistId),
          });
        } else if (m.role === 'run') {
          if (m.result) {
            appendBubble('assistant', m.result, {
              id: `a-${m.id}`,
              messageId: m.id,
              favorited: Boolean(m.favorited),
            });
          }
        } else {
          appendBubble(role === 'system' ? 'meta' : 'assistant', m.content || '', {
            id: `m-${m.id}`,
            messageId: role === 'system' ? null : m.id,
            favorited: Boolean(m.favorited),
          });
        }
      });
    }
    if (state.lastUiError) {
      appendBubble('error', state.lastUiError);
    }
  }

  function showStickyError(message) {
    const msg = String(message || 'Erro').trim();
    state.lastUiError = msg;
    appendBubble('error', msg);
    setStatus(msg.slice(0, 80), 'err');
    if (state.conversationId) {
      void api('/conversations/' + encodeURIComponent(state.conversationId) + '/system-note', {
        method: 'POST',
        body: JSON.stringify({ content: `⚠️ ${msg}` }),
      }).catch(() => {});
    }
  }

  function clearStickyError() {
    state.lastUiError = '';
  }

  function updateSpecialistChip() {
    const chip = $('cursorChatSpecialistChip');
    if (!chip) return;
    if (!state.specialistId || !state.specialistName) {
      chip.hidden = true;
      chip.innerHTML = '';
      return;
    }
    chip.hidden = false;
    chip.innerHTML = '';
    chip.appendChild(document.createTextNode(state.specialistName));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Remover especialista';
    btn.textContent = '×';
    btn.addEventListener('click', () => {
      state.specialistId = null;
      state.specialistName = null;
      updateSpecialistChip();
    });
    chip.appendChild(btn);
  }

  async function loadSpecialists() {
    if (state.specialistsCache?.length) return state.specialistsCache;

    // 1) JSON estático (rápido, sem auth) — funciona mesmo se a API falhar
    try {
      const resp = await fetch('/public/js/cursor-specialists.json?v=20260822e', {
        credentials: 'same-origin',
        cache: 'no-cache',
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.items) && data.items.length) {
          state.specialistsCache = data.items;
          return state.specialistsCache;
        }
      }
    } catch (_) {}

    // 2) API admin
    try {
      const data = await api('/specialists');
      state.specialistsCache = data.items || [];
      if (state.specialistsCache.length) return state.specialistsCache;
    } catch (_) {}

    // 3) Fallback mínimo (módulos)
    state.specialistsCache = [
      { id: 'logistica-lista-produtos', name: 'Lista de produtos', group: 'Módulos', blurb: 'Grid, filtros, sync Omie' },
      { id: 'modulo-sac-at', name: 'SAC / AT', group: 'Módulos', blurb: 'OS, VIPP, envios' },
      { id: 'modulo-compras', name: 'Compras', group: 'Módulos', blurb: 'Kanban, cotação, NF-e' },
      { id: 'modulo-produto', name: 'Produto', group: 'Módulos', blurb: 'Dados, fotos, estrutura' },
      { id: 'sql-schema-intranet', name: 'Banco / SQL', group: 'Transversal', blurb: 'Schema e migrations' },
      { id: 'deploy-github', name: 'Deploy / GitHub', group: 'Transversal', blurb: 'Commit e push' },
    ];
    return state.specialistsCache;
  }

  function closeAgentsModal() {
    const modal = $('cursorChatAgentsModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.style.removeProperty('display');
  }

  function ensureAgentsModalOnBody() {
    const modal = $('cursorChatAgentsModal');
    if (modal && modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    return modal;
  }

  function showAgentsModalEl(modal) {
    if (!modal) return;
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
    // belt-and-suspenders: inline style beats leftover CSS from overlays
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('z-index', '2147483000', 'important');
  }

  function renderAgentsModal(filter) {
    const body = $('cursorChatAgentsBody');
    if (!body) return;
    const q = String(filter || '').trim().toLowerCase();
    const items = (state.specialistsCache || []).filter((s) => {
      if (!q) return true;
      return (
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.blurb || '').toLowerCase().includes(q) ||
        String(s.group || '').toLowerCase().includes(q) ||
        String(s.id || '').toLowerCase().includes(q)
      );
    });
    const groups = {};
    items.forEach((s) => {
      const g = s.group || 'Outros';
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    });
    const order = ['Módulos', 'Transversal', 'Botões', 'Outros'];
    const keys = Object.keys(groups).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'pt-BR');
    });
    body.innerHTML = '';
    if (!keys.length) {
      body.appendChild(el('div', 'cursor-chat-bubble meta', 'Nenhum especialista encontrado.'));
      return;
    }
    keys.forEach((g) => {
      const wrap = el('div', 'cursor-chat-agents-group');
      wrap.appendChild(el('h4', null, g));
      const grid = el('div', 'cursor-chat-agents-grid');
      groups[g].forEach((s) => {
        const btn = el('button', 'cursor-chat-agent-pick');
        btn.type = 'button';
        btn.dataset.noGlobalSpinner = '1';
        btn.innerHTML = '<strong></strong><span></span>';
        btn.querySelector('strong').textContent = s.name;
        btn.querySelector('span').textContent = s.blurb || s.id;
        btn.addEventListener('click', () => {
          void activateSpecialist(s);
        });
        grid.appendChild(btn);
      });
      wrap.appendChild(grid);
      body.appendChild(wrap);
    });
  }

  async function openAgentsModal() {
    const modal = ensureAgentsModalOnBody();
    if (!modal) {
      appendBubble('error', 'Modal de agentes não encontrado. Dê F5 e tente de novo.');
      return;
    }
    // abre no próximo tick p/ o click do botão não “passar” pelo backdrop
    await new Promise((r) => setTimeout(r, 0));
    showAgentsModalEl(modal);
    const search = $('cursorChatAgentsSearch');
    if (search) search.value = '';
    const body = $('cursorChatAgentsBody');
    if (body) {
      body.innerHTML = '';
      body.appendChild(el('div', 'cursor-chat-bubble meta', 'Carregando especialistas…'));
    }
    try {
      await loadSpecialists();
      renderAgentsModal('');
      search?.focus();
    } catch (e) {
      if (body) {
        body.innerHTML = '';
        body.appendChild(el('div', 'cursor-chat-bubble error', e.message || 'Falha ao carregar'));
      }
    }
  }

  // API global: onclick inline + outros scripts
  window.__cursorOpenAgents = function __cursorOpenAgents(ev) {
    if (ev) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (_) {}
    }
    void openAgentsModal();
  };

  window.__cursorOpenConfig = function __cursorOpenConfig(ev) {
    if (ev) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch (_) {}
    }
    openConfigModal();
  };

  async function activateSpecialist(spec) {
    if (!spec?.id || state.busy) return;
    closeAgentsModal();
    if (!state.agentId) applySession(loadCloudSession());
    state.specialistId = spec.id;
    state.specialistName = spec.name;
    updateSpecialistChip();
    saveCloudSession();
    appendBubble('user', spec.name, { specialist: true });
    setBusy(true);
    state.workStartedAt = Date.now();
    state.lastEventAt = Date.now();
    startTick();
    setStatus(`Ativando ${spec.name}…`, 'warn');
    try {
      let runId = null;
      if (!state.agentId) {
        const data = await api('/agents', {
          method: 'POST',
          body: JSON.stringify({
            specialistId: spec.id,
            activateSpecialist: true,
            autoCreatePR: true,
            conversationId: state.conversationId,
          }),
        });
        state.agentId = data.agentId;
        state.conversationId = data.conversationId || null;
        runId = data.runId;
        state.runId = runId;
        saveCloudSession();
      } else {
        let data;
        try {
          data = await api(`/agents/${encodeURIComponent(state.agentId)}/runs`, {
            method: 'POST',
            body: JSON.stringify({
              specialistId: spec.id,
              activateSpecialist: true,
              conversationId: state.conversationId,
            }),
          });
        } catch (followErr) {
          if (!isAgentArchivedError(followErr)) throw followErr;
          state.agentId = null;
          saveCloudSession({ agentId: null });
          data = await api('/agents', {
            method: 'POST',
            body: JSON.stringify({
              specialistId: spec.id,
              activateSpecialist: true,
              autoCreatePR: true,
              conversationId: state.conversationId,
            }),
          });
        }
        if (data.agentId) state.agentId = data.agentId;
        state.conversationId = data.conversationId || state.conversationId;
        runId = data.run?.id || data.runId || null;
        state.runId = runId;
        saveCloudSession();
      }
      state.liveBubble = appendBubble('assistant', 'Especialista entrando na conversa…', {
        streaming: true,
      });
      const stEl = document.createElement('div');
      stEl.className = 'cursor-chat-work-status';
      stEl.textContent = 'Trabalhando…';
      state.liveBubble.appendChild(stEl);
      if (state.runId) startStream(state.agentId, state.runId);
      startPoll();
      await refreshAgentList();
    } catch (e) {
      stopWorkWatchers();
      setBusy(false);
      appendBubble('error', e.message || 'Falha ao ativar especialista');
      setStatus('Erro', 'err');
    }
  }

  function ensureLiveBubble() {
    if (state.liveBubble && document.body.contains(state.liveBubble)) return state.liveBubble;
    state.liveBubble = appendBubble('assistant', '', { streaming: true });
    const st = document.createElement('div');
    st.className = 'cursor-chat-work-status';
    st.textContent = 'Trabalhando…';
    state.liveBubble.appendChild(st);
    return state.liveBubble;
  }

  function appendLiveText(chunk) {
    if (!chunk) return;
    const b = ensureLiveBubble();
    let body = b.querySelector('.md-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'md-body';
      b.appendChild(body);
    }
    const cur = String(body.textContent || '');
    // Placeholder: limpa mesmo se espaços/pontuação variarem
    if (/^Agent trabalhando/i.test(cur) && /\(recebendo ao vivo\)/i.test(cur)) {
      body.textContent = '';
    }
    const incoming = withoutPreviousLeak(String(chunk));
    if (!incoming) return;
    const prev = withoutPreviousLeak(body.textContent || '');
    let next = incoming;
    // Se o chunk novo começa frase maiúscula grudada no ponto anterior, quebra parágrafo
    if (prev && /[.!?…]$/.test(prev) && /^[A-ZÀ-Ü]/.test(next) && !/^\s/.test(next)) {
      next = `\n\n${next}`;
    } else if (prev && /[.!?…]$/.test(prev) && /^\s*[A-ZÀ-Ü]/.test(next) && !/\n\s*$/.test(prev)) {
      next = next.replace(/^\s+/, '\n\n');
    }
    body.textContent = normalizeAssistantText(mergeAssistantStream(prev, next));
    const box = $('cursorChatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function startStream(agentId, runId) {
    stopStream();
    if (!agentId || !runId) return;

    state.workStartedAt = state.workStartedAt || Date.now();
    state.lastEventAt = Date.now();
    startTick();
    setStatus('Conectado ao vivo…', 'warn');
    ensureLiveBubble();

    const url = `/api/dev-agent/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    state.eventSource = es;
    state.streamRunId = runId;

    es.addEventListener('assistant', (ev) => {
      markActivity('escrevendo resposta');
      try {
        const data = JSON.parse(ev.data || '{}');
        appendLiveText(data.text || '');
      } catch (_) {}
    });

    es.addEventListener('thinking', () => markActivity('pensando…'));

    es.addEventListener('tool_call', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        const name = friendlyTool(data.name || '');
        const st = data.status || '';
        markActivity(st === 'completed' ? `concluiu ${name}` : `usando ${name}`);
      } catch (_) {
        markActivity('usando ferramenta');
      }
    });

    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse(ev.data || '{}');
        markActivity(`status: ${data.status || '…'}`);
      } catch (_) {
        markActivity('atualizando status');
      }
    });

    es.addEventListener('heartbeat', () => {
      markActivity(state.lastActivity || 'ainda trabalhando');
    });

    es.addEventListener('result', (ev) => {
      markActivity('finalizando');
      try {
        const data = JSON.parse(ev.data || '{}');
        const text = withoutPreviousLeak(data.text || '');
        const b = ensureLiveBubble();
        if (text) setBubbleMarkdown(b, text);
        else {
          const body = b.querySelector('.md-body');
          if (body?.textContent) body.innerHTML = renderMarkdown(body.textContent);
        }
      } catch (_) {}
    });

    es.addEventListener('done', () => {
      // NÃO finaliza a UI aqui: o stream pode cair enquanto o run ainda está RUNNING.
      try {
        es.close();
      } catch (_) {}
      if (state.eventSource === es) state.eventSource = null;
      markActivity('stream encerrado — confirmando status…');
      void poll();
    });

    es.addEventListener('error', (ev) => {
      // Erro SSE do Cursor (com data) — não mostra vermelho efêmero; só status
      if (ev?.data) {
        try {
          const data = JSON.parse(ev.data);
          if (data.message) markActivity(`stream: ${String(data.message).slice(0, 80)}`);
        } catch (_) {
          markActivity('stream com aviso');
        }
      } else {
        markActivity('reconectando stream…');
      }
    });

    es.onerror = () => {
      // EventSource nativo dispara isto em queda/reconexão — nunca bolha vermelha
      markActivity('stream instável — checando por status…');
      void softSyncWhileBusy();
    };
  }

  function friendlyTool(name) {
    const map = {
      run_terminal_cmd: 'terminal',
      Shell: 'terminal',
      read_file: 'leitura de arquivo',
      Read: 'leitura de arquivo',
      Write: 'edição',
      write: 'edição',
      StrReplace: 'edição',
      search_replace: 'edição',
      Grep: 'busca',
      grep: 'busca',
      Glob: 'arquivos',
      WebSearch: 'web',
    };
    return map[name] || name || 'ferramenta';
  }

  function providerShortLabel(id) {
    const map = {
      gemini: 'Gemini',
      groq: 'Groq',
      openrouter: 'OpenRouter',
      deepseek: 'DeepSeek',
      mistral: 'Mistral',
      ops: 'Ops',
      cursor: 'Cursor',
    };
    return map[id] || String(id || '?');
  }

  function providerIconLetter(id) {
    const map = {
      gemini: 'Ge',
      groq: 'Gq',
      openrouter: 'OR',
      deepseek: 'DS',
      mistral: 'Mi',
      ops: 'Op',
      cursor: 'Cu',
    };
    return map[id] || String(id || '?').slice(0, 2).toUpperCase();
  }

  function statusCaption(status) {
    if (status === 'ok') return 'utilizado / ok';
    if (status === 'nok') return 'não utilizado / nok';
    if (status === 'running') return 'utilizado / rodando';
    return 'não utilizado';
  }

  function idleRoutingFromConfigured() {
    const configured = Array.isArray(state.freeProviders) ? state.freeProviders : [];
    const ids = configured.length
      ? [...configured.map((p) => p.id), 'ops', 'cursor']
      : ['openrouter', 'groq', 'gemini', 'deepseek', 'mistral', 'ops', 'cursor'];
    return {
      providers: ids.map((id) => ({ id, status: 'idle', detail: 'não utilizado' })),
    };
  }

  function applyCursorTerminalToRouting(routing, runStatus) {
    const st = String(runStatus || '').toUpperCase();
    let cursorStatus = null;
    if (st === 'FINISHED') cursorStatus = 'ok';
    else if (st === 'ERROR' || st === 'CANCELLED' || st === 'EXPIRED') cursorStatus = 'nok';
    else if (st === 'RUNNING' || st === 'CREATING') cursorStatus = 'running';
    if (!cursorStatus) return routing;
    const base =
      routing && Array.isArray(routing.providers) ? routing : idleRoutingFromConfigured();
    return {
      ...base,
      providers: base.providers.map((p) =>
        p.id === 'cursor'
          ? { ...p, status: cursorStatus, detail: statusCaption(cursorStatus) }
          : p
      ),
    };
  }

  function renderProviders(routing, { reset = false } = {}) {
    const box = $('cursorChatProviders');
    if (!box) return;
    if (reset) state.routing = routing || null;
    else if (routing) state.routing = routing;
    box.innerHTML = '';
    const board = state.routing && Array.isArray(state.routing.providers)
      ? state.routing
      : idleRoutingFromConfigured();
    const providers = Array.isArray(board.providers) ? board.providers : [];
    if (!providers.length) return;
    const anyUsed = providers.some(
      (p) => p.status === 'ok' || p.status === 'nok' || p.status === 'running'
    );
    const hint = el('div', 'cursor-chat-prov-hint');
    hint.textContent = state.preferredProvider
      ? `Usar: ${providerShortLabel(state.preferredProvider)} · toque de novo = Auto`
      : 'Auto · toque numa IA para usar ela';
    box.appendChild(hint);
    providers.forEach((p) => {
      const st = p.status || 'idle';
      const selectable = p.id !== 'ops';
      const selected = selectable && state.preferredProvider === p.id;
      const chip = document.createElement(selectable ? 'button' : 'span');
      if (selectable) chip.type = 'button';
      chip.className =
        `cursor-chat-prov is-${st}` +
        (st === 'running' ? ' is-running' : '') +
        (selected ? ' is-selected' : '') +
        (anyUsed && st === 'idle' && !selected ? ' is-dim' : '');
      chip.dataset.id = p.id || '';
      chip.title = selectable
        ? `${providerShortLabel(p.id)} — ${p.detail || statusCaption(st)}. Toque para ${
            selected ? 'voltar ao Auto' : 'usar esta IA'
          }.`
        : `${providerShortLabel(p.id)} — ${p.detail || statusCaption(st)}`;
      const ico = document.createElement('span');
      ico.className = 'cursor-chat-prov-ico';
      ico.textContent = providerIconLetter(p.id);
      const lab = document.createElement('span');
      lab.className = 'cursor-chat-prov-label';
      lab.textContent =
        st === 'ok'
          ? `${providerShortLabel(p.id)} · ok`
          : st === 'nok'
            ? `${providerShortLabel(p.id)} · nok`
            : st === 'running'
              ? `${providerShortLabel(p.id)} · …`
              : providerShortLabel(p.id);
      chip.appendChild(ico);
      chip.appendChild(lab);
      if (selectable) {
        chip.addEventListener('click', () => {
          state.preferredProvider = state.preferredProvider === p.id ? null : p.id;
          saveCloudSession({ preferredProvider: state.preferredProvider });
          renderProviders(state.routing);
        });
      }
      box.appendChild(chip);
    });
  }

  async function refreshAgentList() {
    const list = $('cursorChatAgentList');
    if (!list) return;
    list.innerHTML = '<div class="cursor-chat-bubble meta">Carregando conversas…</div>';
    try {
      const data = await api('/conversations');
      let items = data.items || [];
      if (!items.length) {
        const legacy = await api('/agents').catch(() => ({ items: [] }));
        items = (legacy.items || []).map((a) => ({
          conversationId: a.conversationId || null,
          agentId: a.agentId || a.id,
          title: a.name || a.title || a.id,
          status: a.status || '—',
          updatedAt: a.updatedAt || '',
          source: 'cursor',
        }));
      }

      if (!items.length) {
        list.innerHTML = '<div class="cursor-chat-bubble meta">Nenhuma conversa ainda.</div>';
        return;
      }
      // Mais novo → mais antigo pela última resposta da IA (não pelo início da conversa)
      items.sort((a, b) => {
        const ta = new Date(a.updatedAt || 0).getTime() || 0;
        const tb = new Date(b.updatedAt || 0).getTime() || 0;
        return tb - ta;
      });
      list.innerHTML = '';
      items.forEach((c) => {
        const cid = c.conversationId || c.id || null;
        const agentId = c.agentId || null;
        const active =
          (cid && Number(cid) === Number(state.conversationId)) ||
          (agentId && agentId === state.agentId);
        const btn = el('button', 'cursor-chat-agent-item' + (active ? ' active' : ''));
        btn.type = 'button';
        if (cid) btn.dataset.conversationId = String(cid);
        if (agentId) btn.dataset.agentId = String(agentId);
        btn.innerHTML =
          '<strong></strong><span></span><button type="button" class="cursor-chat-side-del" title="Excluir" aria-label="Excluir">×</button>';
        btn.querySelector('strong').textContent = c.title || c.name || (cid ? `Conversa #${cid}` : agentId);
        const when = (c.updatedAt || '').toString().slice(0, 16).replace('T', ' ');
        btn.querySelector('span').textContent = when
          ? `${c.status || '—'} · ${when}`
          : String(c.status || '—');
        btn.addEventListener('click', (e) => {
          if (e.target?.closest?.('.cursor-chat-side-del')) return;
          if (cid) void openConversation(cid);
          else if (agentId) void openAgent(agentId, null);
        });
        btn.querySelector('.cursor-chat-side-del').addEventListener('click', (e) => {
          e.stopPropagation();
          void removeHistoryItem({ conversationId: cid, agentId });
        });
        list.appendChild(btn);
      });
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('div', 'cursor-chat-bubble error', e.message || 'Falha ao listar'));
    }
  }

  function markHistoryActive() {
    document.querySelectorAll('#cursorChatAgentList .cursor-chat-agent-item').forEach((btn) => {
      const cid = btn.dataset.conversationId;
      const aid = btn.dataset.agentId;
      const active =
        (cid && Number(cid) === Number(state.conversationId)) ||
        (aid && state.agentId && aid === state.agentId);
      btn.classList.toggle('active', Boolean(active));
    });
  }

  function setHistTab(tab) {
    state.histTab = tab === 'favorito' ? 'favorito' : 'atual';
    const atualBtn = $('cursorChatTabAtual');
    const favBtn = $('cursorChatTabFavorito');
    const list = $('cursorChatAgentList');
    const favList = $('cursorChatFavoriteList');
    atualBtn?.classList.toggle('active', state.histTab === 'atual');
    favBtn?.classList.toggle('active', state.histTab === 'favorito');
    if (atualBtn) atualBtn.setAttribute('aria-selected', state.histTab === 'atual' ? 'true' : 'false');
    if (favBtn) favBtn.setAttribute('aria-selected', state.histTab === 'favorito' ? 'true' : 'false');
    if (list) list.hidden = state.histTab !== 'atual';
    if (favList) favList.hidden = state.histTab !== 'favorito';
    if (state.histTab === 'favorito') void refreshFavoriteList();
  }

  async function refreshFavoriteList() {
    const list = $('cursorChatFavoriteList');
    if (!list) return;
    list.innerHTML = '<div class="cursor-chat-bubble meta">Carregando favoritos…</div>';
    try {
      const data = await api('/favorites');
      const items = data.items || [];
      if (!items.length) {
        list.innerHTML =
          '<div class="cursor-chat-bubble meta">Nenhuma mensagem favorita. Toque na estrela de uma mensagem.</div>';
        return;
      }
      list.innerHTML = '';
      items.forEach((m) => {
        const btn = el('button', 'cursor-chat-fav-item');
        btn.type = 'button';
        const preview = String(m.content || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 90);
        btn.innerHTML =
          '<strong></strong><span></span><button type="button" class="cursor-chat-star is-on" title="Remover dos favoritos">★</button>';
        btn.querySelector('strong').textContent = m.title || `Conversa #${m.conversationId}`;
        btn.querySelector('span').textContent = preview || '(sem texto)';
        btn.addEventListener('click', (e) => {
          if (e.target?.closest?.('.cursor-chat-star')) return;
          setHistTab('atual');
          if (m.conversationId) void openConversation(m.conversationId);
        });
        btn.querySelector('.cursor-chat-star').addEventListener('click', (e) => {
          e.stopPropagation();
          void (async () => {
            try {
              await api(`/messages/${encodeURIComponent(m.id)}/favorite`, {
                method: 'POST',
                body: JSON.stringify({ favorite: false }),
              });
              await refreshFavoriteList();
            } catch (err) {
              showStickyError(err.message || 'Falha ao remover favorito');
            }
          })();
        });
        list.appendChild(btn);
      });
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('div', 'cursor-chat-bubble error', e.message || 'Falha ao listar favoritos'));
    }
  }

  async function removeHistoryItem({ conversationId, agentId }) {
    if (!window.confirm('Excluir este histórico da lista?')) return;
    try {
      if (conversationId) {
        await api(`/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
        if (Number(state.conversationId) === Number(conversationId)) newChat();
      } else if (agentId) {
        await api(`/agents/${encodeURIComponent(agentId)}/archive`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (state.agentId === agentId) newChat();
      }
      await refreshAgentList();
    } catch (e) {
      appendBubble('error', e.message || 'Falha ao excluir');
    }
  }

  async function openConversation(conversationId) {
    stopWorkWatchers();
    state.conversationId = conversationId;
    markHistoryActive();
    clearStickyError();
    hideBannerExtras();
    setStatus('Carregando histórico…', 'warn');
    try {
      const data = await api(`/conversations/${encodeURIComponent(conversationId)}`);
      state.agentId = data.agentId;
      state.prNumber = data.prNumber || null;
      state.prUrl = data.prUrl || null;
      state.branch = data.branch || null;
      state.specialistId = data.specialistId || null;
      if (state.specialistId) {
        try {
          const list = await loadSpecialists();
          const hit = list.find((s) => s.id === state.specialistId);
          state.specialistName = hit?.name || state.specialistId;
        } catch (_) {
          state.specialistName = state.specialistId;
        }
      } else {
        state.specialistName = null;
      }
      updateSpecialistChip();
      renderSqlMessages(data.messages || []);
      renderProviders(data.routing || null, { reset: true });
      updatePublishBar();
      saveCloudSession();
      markHistoryActive();
      if (state.prNumber) void syncPreviewFromServer();

      const st = String(data.runStatus || data.status || '').toUpperCase();
      if (st === 'RUNNING' || st === 'CREATING') {
        setBusy(true);
        state.workStartedAt = Date.now();
        startTick();
        setStatus('Agent trabalhando…', 'warn');
        // precisa do runId — busca no agent
        if (state.agentId) {
          try {
            const ag = await api(`/agents/${encodeURIComponent(state.agentId)}`);
            state.runId = ag.runId;
            if (state.runId) startStream(state.agentId, state.runId);
            startPoll();
          } catch (agErr) {
            if (isAgentArchivedError(agErr)) {
              state.agentId = null;
              saveCloudSession({ agentId: null });
              setBusy(false);
              setStatus('Agent anterior encerrado — a conversa continua. Pode enviar.', 'warn');
            } else {
              throw agErr;
            }
          }
        }
      } else {
        setBusy(false);
        setStatus(data.title || 'Conversa', data.prNumber ? 'ok' : '');
      }
    } catch (e) {
      clearMessages();
      showStickyError(e.message || 'Falha ao abrir conversa');
    }
  }

  async function openAgent(agentId, conversationId) {
    if (conversationId) return openConversation(conversationId);
    stopWorkWatchers();
    state.agentId = agentId;
    state.conversationId = null;
    setStatus('Carregando…', 'warn');
    try {
      const data = await api(`/agents/${encodeURIComponent(agentId)}/conversation`);
      if (data.conversationId) {
        state.conversationId = data.conversationId;
      }
      state.runId = data.runId;
      state.prNumber = data.prNumber;
      state.prUrl = data.prUrl;
      state.branch = data.branch;
      renderSqlMessages(data.messages || []);
      renderProviders(data.routing || null, { reset: true });
      updatePublishBar();

      const st = String(data.runStatus || '').toUpperCase();
      if (st === 'RUNNING' || st === 'CREATING') {
        setBusy(true);
        state.workStartedAt = Date.now();
        startTick();
        if (data.runId) startStream(agentId, data.runId);
        startPoll();
      } else {
        setBusy(false);
        setStatus(data.name || 'Conversa', '');
      }
      markHistoryActive();
    } catch (e) {
      appendBubble('error', e.message);
    }
  }

  function hideBannerExtras() {
    updatePublishBar();
  }

  async function finishFromPoll({ force = false } = {}) {
    if (!state.agentId && !state.conversationId) return;
    try {
      // Sempre confirma no Cursor se o run realmente terminou (stream cai no meio do caminho)
      let st = '';
      if (state.agentId) {
        const ag = await api(`/agents/${encodeURIComponent(state.agentId)}`);
        state.conversationId = ag.conversationId || state.conversationId;
        state.runId = ag.runId || state.runId;
        state.prNumber = ag.prNumber || state.prNumber;
        state.prUrl = ag.prUrl || state.prUrl;
        state.branch = ag.branch || state.branch;
        st = String(ag.runStatus || '').toUpperCase();
        updatePublishBar();

        if (!force && isActiveStatus(st)) {
          ensureWorkingUi();
          markActivity(`ainda ${st.toLowerCase()} — retomando…`);
          if (!state.eventSource && state.runId) startStream(state.agentId, state.runId);
          await softSyncWhileBusy();
          return;
        }
      }

      if (!force && st && !isTerminalStatus(st) && !isActiveStatus(st)) {
        // status desconhecido — mantém poll
        markActivity(`status ${st || '…'}`);
        return;
      }

      if (state.conversationId) {
        const data = await api(`/conversations/${encodeURIComponent(state.conversationId)}`);
        state.prNumber = data.prNumber || state.prNumber;
        state.prUrl = data.prUrl || state.prUrl;
        state.branch = data.branch || state.branch;
        // Se o SQL ainda não tem a resposta e o Cursor diz FINISHED, espera soft sync
        const msgs = data.messages || [];
        const hasAssistant = Boolean(
          assistantForRun(msgs, state.runId) ||
            (!state.runId && msgs.some((m) => m.role === 'assistant' && String(m.content || '').trim()))
        );
        if (!force && st === 'FINISHED' && !hasAssistant && state.busy) {
          state.finishWaitCount = (state.finishWaitCount || 0) + 1;
          markActivity('aguardando gravar resposta…');
          await softSyncWhileBusy();
          if (state.finishWaitCount < 4) return;
          // após algumas tentativas, mostra o que tiver
        }
        state.finishWaitCount = 0;
        stopWorkWatchers();
        setBusy(false);
        clearStickyError();
        renderSqlMessages(msgs);
        renderProviders(applyCursorTerminalToRouting(data.routing || state.routing, st), {
          reset: true,
        });
        updatePublishBar();
        if (st === 'ERROR') {
          showStickyError('O agent terminou com erro. Veja o histórico ou tente Nova conversa.');
          setStatus('ERROR', 'err');
        } else if (st === 'CANCELLED') {
          setStatus('Cancelado', 'warn');
        } else {
          setStatus(data.prNumber ? 'Resposta pronta · dá para publicar no site' : 'Resposta pronta', 'ok');
        }
        await refreshAgentList();
        return;
      }

      const data = await api(`/agents/${encodeURIComponent(state.agentId)}/conversation`);
      state.conversationId = data.conversationId || state.conversationId;
      state.runId = data.runId || state.runId;
      state.prNumber = data.prNumber || state.prNumber;
      state.prUrl = data.prUrl || state.prUrl;
      state.branch = data.branch || state.branch;
      st = String(data.runStatus || st || '').toUpperCase();
      if (isTerminalStatus(st) || force) {
        stopWorkWatchers();
        setBusy(false);
        if (st === 'FINISHED') clearStickyError();
        else if (st === 'ERROR') showStickyError('O agent terminou com erro. Veja o histórico ou tente Nova conversa.');
        renderSqlMessages(data.messages || []);
        renderProviders(applyCursorTerminalToRouting(data.routing || state.routing, st), {
          reset: true,
        });
        updatePublishBar();
        setStatus(st === 'FINISHED' ? 'Resposta pronta' : st, st === 'FINISHED' ? 'ok' : 'err');
        await refreshAgentList();
      }
    } catch (e) {
      if (isAgentArchivedError(e)) {
        state.agentId = null;
        saveCloudSession({ agentId: null });
        stopWorkWatchers();
        setBusy(false);
        setStatus('Agent anterior encerrado — a conversa continua. Pode enviar de novo.', 'warn');
      }
    }
  }

  async function poll() {
    if (!state.agentId) return;
    try {
      const data = await api(`/agents/${encodeURIComponent(state.agentId)}`);
      state.conversationId = data.conversationId || state.conversationId;
      const nextRunId = data.runId || state.runId;
      // Se o run mudou (follow-up), reconecta o stream
      if (nextRunId && state.streamRunId && nextRunId !== state.streamRunId && isActiveStatus(data.runStatus)) {
        stopStream();
      }
      state.runId = nextRunId;
      state.prNumber = data.prNumber || state.prNumber;
      state.prUrl = data.prUrl || state.prUrl;
      state.branch = data.branch || state.branch;
      updatePublishBar();
      const st = String(data.runStatus || '').toUpperCase();
      if (data.routing) {
        renderProviders(applyCursorTerminalToRouting(data.routing, st));
      }
      markActivity(state.lastActivity || `status ${st || '…'}`);

      if (isActiveStatus(st)) {
        ensureWorkingUi();
        if (!state.eventSource && state.runId) {
          startStream(state.agentId, state.runId);
        }
        // Fallback: se o stream sumiu, puxa texto do SQL
        if (!state.eventSource) await softSyncWhileBusy();
        return;
      }

      if (isTerminalStatus(st)) {
        await finishFromPoll();
      }
    } catch (e) {
      if (isAgentArchivedError(e)) {
        state.agentId = null;
        saveCloudSession({ agentId: null });
        stopWorkWatchers();
        setBusy(false);
        setStatus('Agent anterior encerrado — a conversa continua. Pode enviar de novo.', 'warn');
        return;
      }
      markActivity('falha ao consultar status — tentando de novo');
    }
  }

  function startPoll() {
    stopPoll();
    const tick = async () => {
      await poll();
      if (!(state.busy || state.eventSource) || !state.agentId) return;
      state.pollTimer = setTimeout(() => {
        state.pollTimer = null;
        void tick();
      }, 2500);
    };
    void tick();
  }

  async function sendMessage() {
    const input = $('cursorChatInput');
    const text = String(input?.value || '').trim();
    const images = state.pendingImages.slice();
    if (!text && !images.length) return;
    // Se há run preso, o backend cancela e envia o follow-up (não bloqueia mais)
    if (state.busy || state.eventSource) {
      setStatus('Parando o run atual e enviando follow-up…', 'warn');
      stopStream();
    }
    clearStickyError();
    rememberPreviousAssistant(lastCompletedAssistantText());
    if (state.liveBubble) {
      const prevBubble = state.liveBubble;
      prevBubble.classList.remove('streaming');
      const stale = prevBubble.querySelector('.md-body');
      const staleText = String(stale?.textContent || '').trim();
      if (!staleText || staleText === 'Agent trabalhando… (recebendo ao vivo)') {
        prevBubble.remove();
      } else {
        if (stale) stale.innerHTML = renderMarkdown(staleText);
        markBubbleDone(prevBubble);
      }
      state.liveBubble = null;
    }
    input.value = '';
    autoResizeChatInput();
    clearPendingImages();
    setBusy(true);
    state.workStartedAt = Date.now();
    state.lastEventAt = Date.now();
    startTick();
    setStatus(images.length ? 'Enviando com imagem…' : 'Enviando…', 'warn');
    updatePublishBar();
    const payloadImages = images.map((img) => ({ data: img.data, mimeType: img.mimeType }));
    const specialistPayload = state.specialistId ? { specialistId: state.specialistId } : {};
    // retoma conversa ativa (página ou Assistente SGF) — não cria outra sem "Nova conversa"
    if (!state.agentId) {
      const sess = loadCloudSession();
      if (sess?.agentId) applySession(sess);
    }
    try {
      let runId = null;
      const createBody = {
        prompt: text,
        images: payloadImages,
        autoCreatePR: true,
        conversationId: state.conversationId,
        preferredProvider: state.preferredProvider || undefined,
        ...specialistPayload,
      };
      const followBody = {
        prompt: text,
        images: payloadImages,
        conversationId: state.conversationId,
        preferredProvider: state.preferredProvider || undefined,
        ...specialistPayload,
      };
      let data;
      if (state.agentId) {
        try {
          data = await api(`/agents/${encodeURIComponent(state.agentId)}/runs`, {
            method: 'POST',
            body: JSON.stringify(followBody),
          });
        } catch (followErr) {
          if (!isAgentArchivedError(followErr)) throw followErr;
          state.agentId = null;
          saveCloudSession({ agentId: null });
          setStatus('Agent anterior encerrado — reenviando na mesma conversa…', 'warn');
          data = await api('/agents', {
            method: 'POST',
            body: JSON.stringify(createBody),
          });
        }
      } else {
        data = await api('/agents', {
          method: 'POST',
          body: JSON.stringify(createBody),
        });
      }
      if (data.agentId) state.agentId = data.agentId;
      state.conversationId = data.conversationId || state.conversationId;
      runId = data.run?.id || data.runId || null;
      state.runId = runId;
      saveCloudSession();
      appendBubble('user', text || '(imagem anexada)', { images });

      const orchUi = data.orchestrator?.ui || '';
      if (orchUi) {
        appendBubble('meta', orchUi);
      }
      if (data.routing) renderProviders(data.routing);

      // Resposta imediata da IA grátis / ops (sem stream do Cursor)
      if (data.assistantMessage && !runId) {
        appendBubble('assistant', data.assistantMessage, {
          messageId: data.assistantMessageId || null,
        });
        stopWorkWatchers();
        setBusy(false);
        const eng = data.engine || 'free';
        setStatus(
          eng === 'ops'
            ? 'Concluído (ops)'
            : eng === 'free'
              ? 'Concluído (IA grátis)'
              : 'Concluído',
          'ok'
        );
        updatePublishBar();
        if (data.deletedConversationId || (data.engine === 'ops' && /exclu/i.test(data.assistantMessage || ''))) {
          // conversa atual pode ter sido apagada
          if (Number(data.deletedConversationId) === Number(state.conversationId)) {
            state.conversationId = null;
            state.agentId = null;
            saveCloudSession({ conversationId: null, agentId: null });
          }
        }
        await refreshAgentList();
        if (data.hasDraft) {
          const bar = el('div', 'cursor-chat-bubble meta', null);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cursor-chat-btn';
          btn.textContent = 'Aplicar com Cursor';
          btn.title = 'Envia o rascunho HTML/CSS para o Cursor aplicar no código';
          btn.addEventListener('click', () => {
            const inputEl = $('cursorChatInput');
            if (inputEl) {
              inputEl.value = 'aplicar';
              autoResizeChatInput();
            }
            void sendMessage();
          });
          bar.appendChild(btn);
          const box = $('cursorChatMessages');
          if (box) box.appendChild(bar);
        }
        return;
      }

      state.liveBubble = appendBubble('assistant', 'Agent trabalhando… (recebendo ao vivo)', {
        streaming: true,
      });
      const st = document.createElement('div');
      st.className = 'cursor-chat-work-status';
      st.textContent = orchUi ? 'Cursor (plano do orquestrador)…' : 'Trabalhando…';
      state.liveBubble.appendChild(st);
      if (state.runId) startStream(state.agentId, state.runId);
      startPoll();
      await refreshAgentList();
      if (data.engine === 'mixed') {
        setStatus('Orquestrador → Free + Cursor', 'warn');
      } else if (data.orchestrator?.ui) {
        setStatus(data.orchestrator.ui.slice(0, 80), 'warn');
      }
    } catch (e) {
      stopWorkWatchers();
      setBusy(false);
      updatePublishBar();
      if (input && text) {
        input.value = text;
        autoResizeChatInput();
      }
      if (images.length) {
        state.pendingImages = images.slice();
        renderPendingPreviews();
      }
      showStickyError(e.message || 'Falha ao enviar');
    }
  }

  async function approve() {
    if (!state.prNumber) {
      appendBubble('error', 'Ainda não há PR para publicar. Continue a conversa até o agent abrir um pull request.');
      return;
    }
    if (!window.confirm('Publicar no site de verdade? (merge na main → Render)')) return;
    setBusy(true);
    setStatus('Publicando… se houver conflito, resolvo com segurança.', 'warn');
    try {
      const data = await api('/approve', {
        method: 'POST',
        body: JSON.stringify({
          prNumber: state.prNumber,
          agentId: state.agentId,
          conversationId: state.conversationId,
        }),
      });
      stopWorkWatchers();
      exitTestMode();
      state.previewUrl = null;
      state.previewStatus = 'idle';
      appendBubble('meta', `✅ ${data.message || 'Publicado — aguarde o deploy.'}`);
      state.prNumber = null;
      saveCloudSession();
      updatePublishBar();
      setStatus('Publicado', 'ok');
      await refreshAgentList();
    } catch (e) {
      const msg = e.message || 'Falha ao publicar';
      if (/conflito|conflict|merge seguro/i.test(msg)) {
        appendBubble('meta', msg);
        setStatus('Conflito — agente de merge seguro', 'warn');
      } else {
        appendBubble('error', msg);
        setStatus('Erro', 'err');
      }
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!window.confirm('Descartar o PR sem publicar?')) return;
    try {
      await api('/reject', {
        method: 'POST',
        body: JSON.stringify({
          prNumber: state.prNumber,
          agentId: state.agentId,
          conversationId: state.conversationId,
        }),
      });
      stopWorkWatchers();
      exitTestMode();
      state.previewUrl = null;
      state.previewStatus = 'idle';
      appendBubble('meta', 'PR descartado.');
      state.prNumber = null;
      updatePublishBar();
      setBusy(false);
      if (state.conversationId) await openConversation(state.conversationId);
    } catch (e) {
      appendBubble('error', e.message);
    }
  }

  async function deleteConversation(id) {
    const cid = id || state.conversationId;
    if (!cid) return;
    if (!window.confirm('Excluir esta conversa e as fotos guardadas?')) return;
    try {
      await api(`/conversations/${encodeURIComponent(cid)}`, { method: 'DELETE' });
      if (Number(state.conversationId) === Number(cid)) {
        newChat();
      }
      await refreshAgentList();
    } catch (e) {
      appendBubble('error', e.message);
    }
  }

  function newChat() {
    stopWorkWatchers();
    exitTestMode();
    state.conversationId = null;
    state.agentId = null;
    state.runId = null;
    state.prNumber = null;
    state.prUrl = null;
    state.branch = null;
    state.previewUrl = null;
    state.previewStatus = 'idle';
    state.specialistId = null;
    state.specialistName = null;
    state.previousAssistantText = '';
    state.routing = null;
    state.preferredProvider = null;
    clearStickyError();
    clearCloudSession();
    updateSpecialistChip();
    updatePublishBar();
    setBusy(false);
    clearMessages();
    renderProviders(null, { reset: true });
    appendBubble(
      'assistant',
      'Nova conversa (+).\n\nA partir daqui as mensagens ficam juntas nesta conversa. Use **Agentes** ou **⚙** para especialista. Testar / Publicar / Descartar só no topo desta página.'
    );
    setStatus('Nova conversa', '');
    markHistoryActive();
    $('cursorChatInput')?.focus();
  }

  async function stopCurrentRun() {
    if (!state.agentId) return;
    setStatus('Cancelando run…', 'warn');
    try {
      await api(`/agents/${encodeURIComponent(state.agentId)}/cancel`, { method: 'POST', body: '{}' });
      stopWorkWatchers();
      setBusy(false);
      clearStickyError();
      setStatus('Run cancelado — pode enviar de novo', 'ok');
      updatePublishBar();
      if (state.conversationId) await openConversation(state.conversationId);
      else await refreshAgentList();
    } catch (e) {
      showStickyError(e.message || 'Falha ao cancelar');
      updatePublishBar();
    }
  }

  async function checkConfig() {
    try {
      const s = await api('/status');
      const bits = [];
      if (!s.cursorConfigured) bits.push('falta CURSOR_API_KEY');
      if (!s.githubConfigured) bits.push('falta GITHUB_TOKEN');
      if (!s.sqlViaAgentConfigured && !s.sqlTicketAuth) {
        bits.push('SQL do agent sem autenticação (DEV_AGENT_MOBILE_TOKEN / CURSOR_API_KEY)');
      }
      if (bits.length) {
        setStatus(bits.join(' · '), 'err');
        appendBubble('error', `Configuração incompleta no servidor: ${bits.join(', ')}.`);
      } else {
        const sqlOk = s.sqlViaAgentConfigured ? 'SQL ok' : 'SQL via ticket';
        setStatus(`Repo: ${s.repo || 'Intranet'} · ${sqlOk}`, 'ok');
      }
      state.freeProviders = Array.isArray(s.orchestrator?.freeProviders)
        ? s.orchestrator.freeProviders
        : [];
      renderProviders(state.routing);
    } catch (e) {
      setStatus(e.message || 'Sem permissão (admin)', 'err');
      appendBubble('error', e.message || 'Acesso restrito a administradores.');
    }
  }

  window.abrirPainelCursorChatbot = async function abrirPainelCursorChatbot() {
    if (typeof showMainTab === 'function') showMainTab('cursorChatbotPane');
    document.querySelectorAll('.left-side .side-menu a').forEach((a) => a.classList.remove('is-active'));
    await checkConfig();

    const sess = loadCloudSession();
    if (sess?.conversationId && !state.conversationId) {
      applySession(sess);
      updateSpecialistChip();
      await openConversation(sess.conversationId);
      return;
    }
    if (state.prNumber) void syncPreviewFromServer();

    const box = $('cursorChatMessages');
    if (box && !box.children.length) {
      appendBubble(
        'assistant',
        'Olá — Chatbot de desenvolvimento.\n\n**Agentes** / **⚙** ao lado de Enviar. Mensagens ficam na mesma conversa até **Nova conversa**. Publicar só no topo desta página (não no Assistente SGF).'
      );
    }
    await refreshAgentList();
  };

  function openConfigModal() {
    const modal = $('cursorChatConfigModal');
    if (!modal) return;
    showAgentsModalEl(modal);
  }

  function closeConfigModal() {
    const modal = $('cursorChatConfigModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.style.removeProperty('display');
  }

  function bind() {
    // sobe modais pro body já no boot (fora de tab-pane / overflow)
    ensureAgentsModalOnBody();
    const cfgModal = $('cursorChatConfigModal');
    if (cfgModal && cfgModal.parentElement !== document.body) {
      document.body.appendChild(cfgModal);
    }

    $('cursorChatSend')?.addEventListener('click', () => {
      void sendMessage();
    });
    // delegação em captura: funciona mesmo se o botão for recriado
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest('#cursorChatAgentsBtn')) {
          e.preventDefault();
          void openAgentsModal();
          return;
        }
        if (t.closest('#cursorChatConfigBtn')) {
          e.preventDefault();
          openConfigModal();
          return;
        }
        if (t.closest('#cursorChatCfgAgents')) {
          e.preventDefault();
          closeConfigModal();
          void openAgentsModal();
        }
      },
      true
    );
    $('cursorChatConfigClose')?.addEventListener('click', closeConfigModal);
    $('cursorChatConfigModal')?.addEventListener('click', (e) => {
      if (e.target === $('cursorChatConfigModal')) closeConfigModal();
    });
    $('cursorChatCfgNew')?.addEventListener('click', () => {
      closeConfigModal();
      newChat();
    });
    $('cursorChatCfgClearSpec')?.addEventListener('click', () => {
      state.specialistId = null;
      state.specialistName = null;
      saveCloudSession({ specialistId: null, specialistName: null });
      updateSpecialistChip();
      closeConfigModal();
    });
    $('cursorChatCfgTest')?.addEventListener('click', () => {
      closeConfigModal();
      onTestPrClick();
    });
    $('cursorChatTestPr')?.addEventListener('click', () => {
      onTestPrClick();
    });
    $('cursorChatCfgApprove')?.addEventListener('click', () => {
      closeConfigModal();
      void approve();
    });
    $('cursorChatCfgPublish')?.addEventListener('click', () => {
      closeConfigModal();
      void approve();
    });
    $('cursorChatCfgDiscard')?.addEventListener('click', () => {
      closeConfigModal();
      void reject();
    });
    $('cursorChatAgentsClose')?.addEventListener('click', closeAgentsModal);
    $('cursorChatAgentsModal')?.addEventListener('click', (e) => {
      if (e.target === $('cursorChatAgentsModal')) closeAgentsModal();
    });
    $('cursorChatAgentsSearch')?.addEventListener('input', (e) => {
      renderAgentsModal(e.target.value);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (voice.active) stopVoiceInput(false);
        closeAgentsModal();
        closeConfigModal();
      }
    });
    $('cursorChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    });
    $('cursorChatInput')?.addEventListener('input', autoResizeChatInput);
    autoResizeChatInput();
    $('cursorChatInput')?.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const files = items
        .filter((it) => it.kind === 'file' && String(it.type || '').startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      void addImageFiles(files);
    });
    $('cursorChatAttach')?.addEventListener('click', () => $('cursorChatFile')?.click());
    $('cursorChatMic')?.addEventListener('click', () => {
      toggleVoiceInput();
    });
    $('cursorChatFile')?.addEventListener('change', (e) => {
      void addImageFiles(e.target?.files);
      e.target.value = '';
    });
    const pane = $('cursorChatbotPane');
    pane?.addEventListener('dragover', (e) => e.preventDefault());
    pane?.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) void addImageFiles(e.dataTransfer.files);
    });
    $('cursorChatTabAtual')?.addEventListener('click', () => setHistTab('atual'));
    $('cursorChatTabFavorito')?.addEventListener('click', () => setHistTab('favorito'));
    $('cursorChatNew')?.addEventListener('click', newChat);
    $('cursorChatStop')?.addEventListener('click', () => {
      void stopCurrentRun();
    });
    $('cursorChatRefresh')?.addEventListener('click', () => {
      if (state.conversationId) void openConversation(state.conversationId);
      else if (state.agentId) void openAgent(state.agentId);
      else void refreshAgentList();
    });
    $('cursorChatDelete')?.addEventListener('click', () => {
      void deleteConversation();
    });
    $('cursorChatApprove')?.addEventListener('click', () => {
      void approve();
    });
    $('cursorChatReject')?.addEventListener('click', () => {
      void reject();
    });
    $('cursorChatBannerApprove')?.addEventListener('click', () => {
      void approve();
    });
    $('cursorChatBannerOpen')?.addEventListener('click', () => {
      openPreviewTab();
    });
    $('cursorChatBannerDiscard')?.addEventListener('click', () => {
      void reject();
    });
    $('cursorChatBannerExit')?.addEventListener('click', () => {
      exitTestMode();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
