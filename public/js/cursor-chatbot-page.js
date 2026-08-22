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
    liveBubble: null,
    pendingImages: [],
    specialistId: null,
    specialistName: null,
    specialistsCache: null,
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
  }

  /** Markdown leve → HTML seguro (negrito, código, tabelas, listas, links). */
  function renderMarkdown(src) {
    let s = String(src || '');
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

    box.appendChild(b);
    box.scrollTop = box.scrollHeight;
    return b;
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
      line.textContent = workText;
      if (badge) {
        badge.className = 'cursor-chat-badge warn';
        badge.textContent = 'Trabalhando';
      }
    } else {
      line.textContent = state.lastActivity || 'Pronto';
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
    state.lastActivity = text || '';
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
  }

  function stopWorkWatchers() {
    stopPoll();
    stopStream();
    stopTick();
    state.workStartedAt = null;
    state.lastEventAt = null;
    if (state.liveBubble) {
      state.liveBubble.classList.remove('streaming');
      const body = state.liveBubble.querySelector('.md-body');
      if (body && body.textContent) {
        body.innerHTML = renderMarkdown(body.textContent);
      }
      state.liveBubble = null;
    }
  }

  function setBusy(v) {
    state.busy = v;
    const send = $('cursorChatSend');
    if (send) send.disabled = v;
  }

  function markActivity(label) {
    state.lastEventAt = Date.now();
    if (label) state.lastActivity = label;
    refreshStatusLine();
  }

  function updatePublishBar() {
    const bar = $('cursorChatPublishBar');
    const del = $('cursorChatDelete');
    if (del) del.style.display = state.conversationId || state.agentId ? '' : 'none';
    if (!bar) return;
    if (state.prNumber) {
      bar.hidden = false;
    } else {
      bar.hidden = true;
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
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return data;
  }

  function renderSqlMessages(messages) {
    clearMessages();
    if (!messages?.length) {
      appendBubble('meta', 'Nenhuma mensagem ainda. Escolha um especialista (Agentes) ou envie um comando.');
      return;
    }
    messages.forEach((m) => {
      const role = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
      const images = (m.attachments || []).map((a) => ({ url: a.url, mimeType: a.mimeType }));
      if (role === 'user') {
        appendBubble('user', m.content || '', {
          id: `m-${m.id}`,
          images,
          specialist: Boolean(m.specialistId),
        });
      } else if (m.role === 'run') {
        if (m.result) appendBubble('assistant', m.result, { id: `a-${m.id}` });
      } else {
        appendBubble(role === 'system' ? 'meta' : 'assistant', m.content || '', { id: `m-${m.id}` });
      }
    });
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
      const resp = await fetch('/public/js/cursor-specialists.json?v=20260821f', {
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
          }),
        });
        state.agentId = data.agentId;
        state.conversationId = data.conversationId || null;
        runId = data.runId;
        state.runId = runId;
        saveCloudSession();
      } else {
        const data = await api(`/agents/${encodeURIComponent(state.agentId)}/runs`, {
          method: 'POST',
          body: JSON.stringify({
            specialistId: spec.id,
            activateSpecialist: true,
            conversationId: state.conversationId,
          }),
        });
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
    if (body.textContent === 'Agent trabalhando… (recebendo ao vivo)') body.textContent = '';
    body.textContent += chunk;
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

    const url = `/api/dev-agent/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    state.eventSource = es;

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
        const text = data.text || '';
        const b = ensureLiveBubble();
        b.classList.remove('streaming');
        if (text) setBubbleMarkdown(b, text);
        else {
          const body = b.querySelector('.md-body');
          if (body?.textContent) body.innerHTML = renderMarkdown(body.textContent);
        }
      } catch (_) {}
    });

    es.addEventListener('done', () => {
      stopStream();
      void finishFromPoll();
    });

    es.addEventListener('error', (ev) => {
      if (ev?.data) {
        try {
          const data = JSON.parse(ev.data);
          if (data.message) appendBubble('error', data.message);
        } catch (_) {}
      }
      markActivity('reconectando stream…');
    });

    es.onerror = () => {
      markActivity('stream instável — checando por status…');
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

  async function refreshAgentList() {
    const list = $('cursorChatAgentList');
    if (!list) return;
    list.innerHTML = '<div class="cursor-chat-bubble meta">Carregando conversas…</div>';
    try {
      const data = await api('/conversations');
      const items = data.items || [];
      if (!items.length) {
        // fallback lista Cursor
        const legacy = await api('/agents').catch(() => ({ items: [] }));
        if (!(legacy.items || []).length) {
          list.innerHTML = '<div class="cursor-chat-bubble meta">Nenhuma conversa ainda.</div>';
          return;
        }
        list.innerHTML = '';
        legacy.items.forEach((a) => {
          const btn = el(
            'button',
            'cursor-chat-agent-item' + (a.agentId === state.agentId || a.id === state.agentId ? ' active' : '')
          );
          btn.type = 'button';
          btn.innerHTML = '<strong></strong><span></span>';
          btn.querySelector('strong').textContent = a.name || a.id;
          btn.querySelector('span').textContent = String(a.status || '—');
          btn.addEventListener('click', () => openAgent(a.agentId || a.id, a.conversationId));
          list.appendChild(btn);
        });
        return;
      }
      list.innerHTML = '';
      items.forEach((c) => {
        const active =
          Number(c.conversationId || c.id) === Number(state.conversationId) ||
          (c.agentId && c.agentId === state.agentId);
        const btn = el('button', 'cursor-chat-agent-item' + (active ? ' active' : ''));
        btn.type = 'button';
        btn.innerHTML = '<strong></strong><span></span><button type="button" class="cursor-chat-side-del" title="Excluir">×</button>';
        btn.querySelector('strong').textContent = c.title || c.name || `Conversa #${c.id}`;
        const when = (c.updatedAt || '').toString().slice(0, 16).replace('T', ' ');
        btn.querySelector('span').textContent = `${c.status || '—'} · ${when}`;
        btn.addEventListener('click', (e) => {
          if (e.target?.closest?.('.cursor-chat-side-del')) return;
          void openConversation(c.conversationId || c.id);
        });
        btn.querySelector('.cursor-chat-side-del').addEventListener('click', (e) => {
          e.stopPropagation();
          void deleteConversation(c.conversationId || c.id);
        });
        list.appendChild(btn);
      });
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('div', 'cursor-chat-bubble error', e.message || 'Falha ao listar'));
    }
  }

  async function openConversation(conversationId) {
    stopWorkWatchers();
    state.conversationId = conversationId;
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
      updatePublishBar();
      saveCloudSession();

      const st = String(data.runStatus || data.status || '').toUpperCase();
      if (st === 'RUNNING' || st === 'CREATING') {
        setBusy(true);
        state.workStartedAt = Date.now();
        startTick();
        setStatus('Agent trabalhando…', 'warn');
        // precisa do runId — busca no agent
        if (state.agentId) {
          const ag = await api(`/agents/${encodeURIComponent(state.agentId)}`);
          state.runId = ag.runId;
          if (state.runId) startStream(state.agentId, state.runId);
          startPoll();
        }
      } else {
        setBusy(false);
        setStatus(data.title || 'Conversa', data.prNumber ? 'ok' : '');
      }
      await refreshAgentList();
    } catch (e) {
      clearMessages();
      appendBubble('error', e.message);
      setStatus('Erro', 'err');
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
      await refreshAgentList();
    } catch (e) {
      appendBubble('error', e.message);
    }
  }

  function hideBannerExtras() {
    updatePublishBar();
  }

  async function finishFromPoll() {
    if (!state.agentId && !state.conversationId) return;
    try {
      if (state.conversationId) {
        const data = await api(`/conversations/${encodeURIComponent(state.conversationId)}`);
        state.prNumber = data.prNumber || state.prNumber;
        state.prUrl = data.prUrl || state.prUrl;
        state.branch = data.branch || state.branch;
        stopWorkWatchers();
        setBusy(false);
        renderSqlMessages(data.messages || []);
        updatePublishBar();
        setStatus(data.prNumber ? 'Resposta pronta · dá para publicar no site' : 'Resposta pronta', 'ok');
        await refreshAgentList();
        return;
      }
      const data = await api(`/agents/${encodeURIComponent(state.agentId)}/conversation`);
      state.conversationId = data.conversationId || state.conversationId;
      state.runId = data.runId || state.runId;
      state.prNumber = data.prNumber || state.prNumber;
      state.prUrl = data.prUrl || state.prUrl;
      state.branch = data.branch || state.branch;
      const st = String(data.runStatus || '').toUpperCase();
      if (st === 'FINISHED' || st === 'ERROR' || st === 'CANCELLED' || st === 'EXPIRED') {
        stopWorkWatchers();
        setBusy(false);
        renderSqlMessages(data.messages || []);
        updatePublishBar();
        setStatus(st === 'FINISHED' ? 'Resposta pronta' : st, st === 'FINISHED' ? 'ok' : 'err');
        await refreshAgentList();
      }
    } catch (_) {}
  }

  async function poll() {
    if (!state.agentId) return;
    try {
      const data = await api(`/agents/${encodeURIComponent(state.agentId)}`);
      state.conversationId = data.conversationId || state.conversationId;
      state.runId = data.runId || state.runId;
      state.prNumber = data.prNumber || state.prNumber;
      state.prUrl = data.prUrl || state.prUrl;
      state.branch = data.branch || state.branch;
      updatePublishBar();
      const st = String(data.runStatus || '').toUpperCase();
      markActivity(state.lastActivity || `status ${st || '…'}`);

      if (!state.eventSource && (st === 'RUNNING' || st === 'CREATING') && state.runId) {
        startStream(state.agentId, state.runId);
      }

      if (st === 'FINISHED' || st === 'ERROR' || st === 'CANCELLED' || st === 'EXPIRED') {
        await finishFromPoll();
      }
    } catch (_) {
      markActivity('falha ao consultar status — tentando de novo');
    }
  }

  function startPoll() {
    stopPoll();
    void poll();
    state.pollTimer = setInterval(() => {
      void poll();
    }, 6000);
  }

  async function sendMessage() {
    const input = $('cursorChatInput');
    const text = String(input?.value || '').trim();
    const images = state.pendingImages.slice();
    if ((!text && !images.length) || state.busy) return;
    input.value = '';
    clearPendingImages();
    appendBubble('user', text || '(imagem anexada)', { images });
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
      if (!state.agentId) {
        const data = await api('/agents', {
          method: 'POST',
          body: JSON.stringify({
            prompt: text,
            images: payloadImages,
            autoCreatePR: true,
            ...specialistPayload,
          }),
        });
        state.agentId = data.agentId;
        state.conversationId = data.conversationId || null;
        runId = data.runId;
        state.runId = runId;
        saveCloudSession();
      } else {
        const data = await api(`/agents/${encodeURIComponent(state.agentId)}/runs`, {
          method: 'POST',
          body: JSON.stringify({
            prompt: text,
            images: payloadImages,
            conversationId: state.conversationId,
            ...specialistPayload,
          }),
        });
        state.conversationId = data.conversationId || state.conversationId;
        runId = data.run?.id || data.runId || null;
        state.runId = runId;
        saveCloudSession();
      }
      state.liveBubble = appendBubble('assistant', 'Agent trabalhando… (recebendo ao vivo)', {
        streaming: true,
      });
      const st = document.createElement('div');
      st.className = 'cursor-chat-work-status';
      st.textContent = 'Trabalhando…';
      state.liveBubble.appendChild(st);
      if (state.runId) startStream(state.agentId, state.runId);
      startPoll();
      await refreshAgentList();
    } catch (e) {
      stopWorkWatchers();
      setBusy(false);
      appendBubble('error', e.message || 'Falha ao enviar');
      setStatus('Erro', 'err');
    }
  }

  async function approve() {
    if (!state.prNumber) {
      appendBubble('error', 'Ainda não há PR para publicar. Continue a conversa até o agent abrir um pull request.');
      return;
    }
    if (!window.confirm('Publicar no site de verdade? (merge na main → Render)')) return;
    setBusy(true);
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
      appendBubble('meta', `✅ ${data.message || 'Publicado — aguarde o deploy.'}`);
      state.prNumber = null;
      clearCloudSession();
      state.agentId = null;
      state.conversationId = null;
      updatePublishBar();
      setStatus('Publicado', 'ok');
      await refreshAgentList();
      newChat();
    } catch (e) {
      appendBubble('error', e.message);
      setStatus('Erro', 'err');
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
    state.conversationId = null;
    state.agentId = null;
    state.runId = null;
    state.prNumber = null;
    state.prUrl = null;
    state.branch = null;
    state.specialistId = null;
    state.specialistName = null;
    clearCloudSession();
    updateSpecialistChip();
    updatePublishBar();
    setBusy(false);
    clearMessages();
    appendBubble(
      'assistant',
      'Nova conversa (+).\n\nA partir daqui as mensagens ficam juntas nesta conversa. Use **Agentes** ou **⚙** para especialista. Publicar/Descartar só no topo desta página.'
    );
    setStatus('Nova conversa', '');
    $('cursorChatInput')?.focus();
  }

  async function checkConfig() {
    try {
      const s = await api('/status');
      const bits = [];
      if (!s.cursorConfigured) bits.push('falta CURSOR_API_KEY');
      if (!s.githubConfigured) bits.push('falta GITHUB_TOKEN');
      if (bits.length) {
        setStatus(bits.join(' · '), 'err');
        appendBubble('error', `Configuração incompleta no servidor: ${bits.join(', ')}.`);
      } else {
        setStatus(`Repo: ${s.repo || 'Intranet'}`, 'ok');
      }
    } catch (e) {
      setStatus(e.message || 'Sem permissão (admin)', 'err');
      appendBubble('error', e.message || 'Acesso restrito a administradores.');
    }
  }

  window.abrirPainelCursorChatbot = async function abrirPainelCursorChatbot() {
    if (typeof showMainTab === 'function') showMainTab('cursorChatbotPane');
    document.querySelectorAll('.left-side .side-menu a').forEach((a) => a.classList.remove('is-active'));
    $('menu-chatbot-cursor')?.classList.add('is-active');
    await checkConfig();

    const sess = loadCloudSession();
    if (sess?.conversationId && !state.conversationId) {
      applySession(sess);
      updateSpecialistChip();
      await openConversation(sess.conversationId);
      return;
    }

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

    $('menu-chatbot-cursor')?.addEventListener('click', (e) => {
      e.preventDefault();
      void window.abrirPainelCursorChatbot();
    });
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
        if (t.closest('#cursorChatCfgAgents')) {
          e.preventDefault();
          closeConfigModal();
          void openAgentsModal();
        }
      },
      true
    );
    $('cursorChatConfigBtn')?.addEventListener('click', openConfigModal);
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
    $('cursorChatAgentsClose')?.addEventListener('click', closeAgentsModal);
    $('cursorChatAgentsModal')?.addEventListener('click', (e) => {
      if (e.target === $('cursorChatAgentsModal')) closeAgentsModal();
    });
    $('cursorChatAgentsSearch')?.addEventListener('input', (e) => {
      renderAgentsModal(e.target.value);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
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
    $('cursorChatNew')?.addEventListener('click', newChat);
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
    $('cursorChatBannerExit')?.addEventListener('click', () => {
      document.body.classList.remove('cursor-chat-preview-mode');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
