/**
 * Modal Chamado IA — conversa restrita (SQL leitura + abrir chamado).
 * Sem config, sem escolher especialista, sem publicar/PR.
 */
(function () {
  'use strict';

  const SPECIALIST_ID = 'chamado-ia';
  const SESSION_KEY = 'chamadoIaChatSession';

  const state = {
    open: false,
    busy: false,
    agentId: null,
    conversationId: null,
    runId: null,
    eventSource: null,
    pollTimer: null,
    tickTimer: null,
    workStartedAt: 0,
    lastEventAt: 0,
    liveBubble: null,
    pendingImages: [],
    contexto: { nav_key: '', nav_label: '', contexto_descricao: '' },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function saveSession() {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          agentId: state.agentId,
          conversationId: state.conversationId,
        })
      );
    } catch (_) {}
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clearSession() {
    state.agentId = null;
    state.conversationId = null;
    state.runId = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  function setStatus(text, kind) {
    const el = $('chamadoIaStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('is-warn', 'is-ok', 'is-err');
    if (kind === 'warn') el.classList.add('is-warn');
    if (kind === 'ok') el.classList.add('is-ok');
    if (kind === 'err') el.classList.add('is-err');
  }

  function setBusy(v) {
    state.busy = Boolean(v);
    const send = $('chamadoIaSend');
    const input = $('chamadoIaInput');
    if (send) send.disabled = state.busy;
    if (input) input.disabled = state.busy;
  }

  function appendBubble(role, text, opts = {}) {
    const box = $('chamadoIaMessages');
    if (!box) return null;
    const div = document.createElement('div');
    div.className = `chamado-ia-bubble ${role}${opts.streaming ? ' streaming' : ''}`;
    div.textContent = text || '';
    if (opts.images?.length) {
      opts.images.forEach((img) => {
        if (!img?.data) return;
        const im = document.createElement('img');
        im.src = `data:${img.mimeType || 'image/png'};base64,${img.data}`;
        im.alt = 'anexo';
        im.style.cssText = 'max-width:180px;border-radius:8px;margin-top:8px;display:block;';
        div.appendChild(im);
      });
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  function autoResize() {
    const ta = $('chamadoIaInput');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(140, Math.max(44, ta.scrollHeight))}px`;
  }

  function renderPreviews() {
    const wrap = $('chamadoIaPreviews');
    if (!wrap) return;
    wrap.innerHTML = '';
    state.pendingImages.forEach((img, idx) => {
      const d = document.createElement('div');
      d.className = 'chamado-ia-preview';
      d.innerHTML = `<img src="data:${esc(img.mimeType)};base64,${img.data}" alt=""><button type="button" aria-label="Remover">×</button>`;
      d.querySelector('button')?.addEventListener('click', () => {
        state.pendingImages.splice(idx, 1);
        renderPreviews();
      });
      wrap.appendChild(d);
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const raw = String(reader.result || '');
        const m = raw.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) return reject(new Error('Falha ao ler imagem'));
        resolve({ mimeType: m[1], data: m[2] });
      };
      reader.onerror = () => reject(reader.error || new Error('Falha ao ler'));
      reader.readAsDataURL(file);
    });
  }

  async function api(path, opts = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Chamado-Ia': '1',
      ...(opts.headers || {}),
    };
    const resp = await fetch(`/api/dev-agent${path}`, {
      credentials: 'include',
      ...opts,
      headers,
    });
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    if (!resp.ok) {
      const err = new Error(data?.error || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function stopStream() {
    if (state.eventSource) {
      try {
        state.eventSource.close();
      } catch (_) {}
      state.eventSource = null;
    }
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function stopTick() {
    if (state.tickTimer) {
      clearInterval(state.tickTimer);
      state.tickTimer = null;
    }
  }

  function stopWork() {
    stopStream();
    stopPoll();
    stopTick();
  }

  function startTick() {
    stopTick();
    state.tickTimer = setInterval(() => {
      if (!state.busy) return;
      const sec = Math.max(0, Math.round((Date.now() - (state.workStartedAt || Date.now())) / 1000));
      setStatus(`Trabalhando… ${sec}s`, 'warn');
    }, 1000);
  }

  function startStream(agentId, runId) {
    stopStream();
    if (!agentId || !runId) return;
    const url = `/api/dev-agent/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream?chamadoIa=1`;
    const es = new EventSource(url, { withCredentials: true });
    state.eventSource = es;
    let buf = '';

    es.addEventListener('message', (ev) => {
      state.lastEventAt = Date.now();
      try {
        const payload = JSON.parse(ev.data);
        const chunk =
          payload?.delta ||
          payload?.text ||
          payload?.message ||
          payload?.content ||
          '';
        if (chunk) {
          buf += chunk;
          if (state.liveBubble) state.liveBubble.textContent = buf;
          const box = $('chamadoIaMessages');
          if (box) box.scrollTop = box.scrollHeight;
        }
        const st = String(payload?.status || '').toUpperCase();
        if (st === 'FINISHED' || st === 'ERROR' || st === 'CANCELLED') {
          finishRun(buf, st);
        }
      } catch (_) {}
    });

    es.onerror = () => {
      /* poll cobre */
    };
  }

  async function pollOnce() {
    if (!state.agentId) return;
    try {
      const data = await api(`/agents/${encodeURIComponent(state.agentId)}`);
      const st = String(data?.runStatus || data?.status || '').toUpperCase();
      const result = data?.result || data?.run?.result || '';
      if (st === 'FINISHED' || st === 'ERROR' || st === 'CANCELLED') {
        finishRun(result || (state.liveBubble?.textContent || ''), st);
      } else if (result && state.liveBubble) {
        state.liveBubble.textContent = result;
      }
    } catch (_) {}
  }

  function startPoll() {
    stopPoll();
    state.pollTimer = setInterval(() => {
      void pollOnce();
    }, 2500);
  }

  function finishRun(text, st) {
    stopWork();
    setBusy(false);
    const finalText =
      String(text || '').trim() ||
      (st === 'ERROR' ? 'Falha na resposta da IA.' : 'Resposta pronta.');
    if (state.liveBubble) {
      state.liveBubble.textContent = finalText;
      state.liveBubble.classList.remove('streaming');
    } else {
      appendBubble('assistant', finalText);
    }
    state.liveBubble = null;
    setStatus(st === 'ERROR' ? 'Erro' : 'Resposta pronta', st === 'ERROR' ? 'err' : 'ok');
  }

  async function sendMessage() {
    const input = $('chamadoIaInput');
    const text = String(input?.value || '').trim();
    const images = state.pendingImages.slice();
    if (!text && !images.length) return;
    if (state.busy) {
      stopStream();
    }

    input.value = '';
    autoResize();
    state.pendingImages = [];
    renderPreviews();

    setBusy(true);
    state.workStartedAt = Date.now();
    state.lastEventAt = Date.now();
    startTick();
    setStatus(images.length ? 'Enviando com imagem…' : 'Enviando…', 'warn');

    const payloadImages = images.map((img) => ({ data: img.data, mimeType: img.mimeType }));
    const baseBody = {
      prompt: text,
      images: payloadImages,
      chamadoIa: true,
      specialistId: SPECIALIST_ID,
      autoCreatePR: false,
      mode: 'ask',
      contextoChamadoIa: {
        nav_key: state.contexto.nav_key || '',
        nav_label: state.contexto.nav_label || '',
      },
      nav_key: state.contexto.nav_key || '',
      nav_label: state.contexto.nav_label || '',
    };

    try {
      let runId = null;
      if (!state.agentId) {
        const data = await api('/agents', {
          method: 'POST',
          body: JSON.stringify({
            ...baseBody,
            name: 'Chamado IA',
          }),
        });
        state.agentId = data.agentId;
        state.conversationId = data.conversationId || null;
        runId = data.runId;
        state.runId = runId;
        saveSession();
      } else {
        const data = await api(`/agents/${encodeURIComponent(state.agentId)}/runs`, {
          method: 'POST',
          body: JSON.stringify({
            ...baseBody,
            conversationId: state.conversationId,
          }),
        });
        state.conversationId = data.conversationId || state.conversationId;
        runId = data.run?.id || data.runId || null;
        state.runId = runId;
        saveSession();
      }

      appendBubble('user', text || '(imagem anexada)', { images });
      state.liveBubble = appendBubble('assistant', 'Consultando…', { streaming: true });
      if (state.runId) startStream(state.agentId, state.runId);
      startPoll();
    } catch (e) {
      stopWork();
      setBusy(false);
      if (input && text) input.value = text;
      appendBubble('error', e.message || 'Falha ao enviar');
      setStatus('Erro ao enviar', 'err');
    }
  }

  function resetConversation(keepContext) {
    stopWork();
    setBusy(false);
    clearSession();
    const box = $('chamadoIaMessages');
    if (box) box.innerHTML = '';
    appendBubble(
      'system',
      'Posso consultar registros no SQL (somente leitura) e abrir chamado de suporte. Não altero o sistema.'
    );
    if (keepContext && (state.contexto.nav_label || state.contexto.nav_key)) {
      appendBubble(
        'system',
        `Contexto da tela: ${state.contexto.nav_label || state.contexto.nav_key}`
      );
    }
    setStatus('Pronto', 'ok');
    $('chamadoIaInput')?.focus();
  }

  function fecharModal() {
    const ov = $('chamadoIaModal');
    if (!ov) return;
    ov.classList.remove('is-open');
    ov.style.display = 'none';
    state.open = false;
    stopWork();
    setBusy(false);
  }

  function abrirModal(opts = {}) {
    const ov = $('chamadoIaModal');
    if (!ov) {
      alert('Modal Chamado IA indisponível.');
      return;
    }
    state.contexto = {
      nav_key: String(opts.nav_key || '').trim(),
      nav_label: String(opts.nav_label || '').trim(),
      contexto_descricao: String(opts.contexto_descricao || '').trim(),
    };
    ov.style.display = 'flex';
    ov.classList.add('is-open');
    state.open = true;

    const sess = loadSession();
    if (sess?.agentId) {
      state.agentId = sess.agentId;
      state.conversationId = sess.conversationId || null;
      setStatus('Continuando conversa…', 'ok');
      if (!$('chamadoIaMessages')?.childElementCount) {
        appendBubble('system', 'Conversa anterior retomada. Digite sua dúvida ou peça para abrir um chamado.');
      }
    } else {
      resetConversation(true);
    }
    $('chamadoIaInput')?.focus();
  }

  function bindOnce() {
    if (window.__chamadoIaBound) return;
    window.__chamadoIaBound = true;

    $('chamadoIaFechar')?.addEventListener('click', fecharModal);
    $('chamadoIaNova')?.addEventListener('click', () => resetConversation(true));
    $('chamadoIaSend')?.addEventListener('click', () => void sendMessage());
    $('chamadoIaAttach')?.addEventListener('click', () => $('chamadoIaFile')?.click());

    $('chamadoIaFile')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const f of files.slice(0, 4)) {
        if (!/^image\//.test(f.type)) continue;
        try {
          state.pendingImages.push(await fileToBase64(f));
        } catch (_) {}
      }
      renderPreviews();
    });

    const input = $('chamadoIaInput');
    input?.addEventListener('input', autoResize);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    });
    input?.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      for (const it of items) {
        if (!/^image\//.test(it.type)) continue;
        const file = it.getAsFile();
        if (!file) continue;
        e.preventDefault();
        try {
          state.pendingImages.push(await fileToBase64(file));
          renderPreviews();
        } catch (_) {}
      }
    });

    $('chamadoIaModal')?.addEventListener('click', (e) => {
      if (e.target?.id === 'chamadoIaModal') fecharModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) fecharModal();
    });
  }

  window.abrirChamadoIaModal = function abrirChamadoIaModal(opts) {
    bindOnce();
    abrirModal(opts || {});
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOnce);
  } else {
    bindOnce();
  }
})();
