(() => {
  'use strict';

  const STORAGE_AGENT = 'fromtherm:cursor-chat:agent';
  const PRESET_AGENTS = [
    { id: 'auto', label: 'Auto', description: 'Cursor escolhe o modelo padrão da conta' },
    { id: 'gpt', label: 'GPT', description: 'Usa um modelo GPT disponível no Cloud Agent' },
    { id: 'cloud', label: 'Cloud', description: 'Agente na nuvem com o modelo mais capaz da lista' }
  ];

  const openBtn = document.getElementById('cursor-chat-open-btn');
  const panel = document.getElementById('cursor-chat-panel');
  const closeBtn = document.getElementById('cursor-chat-close');
  const newBtn = document.getElementById('cursor-chat-new');
  const messagesEl = document.getElementById('cursor-chat-messages');
  const input = document.getElementById('cursor-chat-input');
  const sendBtn = document.getElementById('cursor-chat-send');
  const agentBtn = document.querySelector('.cursor-chat-btn');
  const agentLabel = document.getElementById('cursor-chat-agent-label');
  const agentMenu = document.getElementById('cursor-chat-menu');

  if (!panel || !agentBtn || !agentMenu) return;

  const state = {
    agentId: readStoredAgent(),
    conversationId: null,
    agents: PRESET_AGENTS.slice(),
    loading: false,
    configured: false
  };

  function readStoredAgent() {
    try {
      const value = String(localStorage.getItem(STORAGE_AGENT) || 'auto').trim();
      return value || 'auto';
    } catch (_) {
      return 'auto';
    }
  }

  function saveAgent(id) {
    state.agentId = id;
    try { localStorage.setItem(STORAGE_AGENT, id); } catch (_) {}
    updateAgentLabel();
    renderMenu();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function agentMeta(id) {
    const chave = String(id || 'auto');
    return state.agents.find((item) => item.id === chave || item.id.toLowerCase() === chave.toLowerCase())
      || { id: chave, label: chave, description: '' };
  }

  function updateAgentLabel() {
    if (agentLabel) agentLabel.textContent = `Agentes · ${agentMeta(state.agentId).label}`;
  }

  function appendMsg(kind, text) {
    if (!messagesEl) return;
    const div = document.createElement('div');
    div.className = `cursor-chat-msg ${kind}`;
    div.innerHTML = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function setTyping(on) {
    const atual = messagesEl?.querySelector('.cursor-chat-msg.typing');
    if (atual) atual.remove();
    if (on) appendMsg('typing', 'Agente Cursor trabalhando…');
  }

  function renderMenu() {
    const atual = String(state.agentId || 'auto');
    agentMenu.innerHTML = state.agents.map((item) => {
      const active = item.id === atual || item.id.toLowerCase() === atual.toLowerCase();
      return `<button type="button" class="cursor-chat-option${active ? ' is-active' : ''}" role="option" aria-selected="${active ? 'true' : 'false'}" data-agent-id="${escapeHtml(item.id)}">
        <span><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description || '')}</span></span>
      </button>`;
    }).join('');
  }

  function positionMenu() {
    const rect = agentBtn.getBoundingClientRect();
    const menuWidth = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
    agentMenu.style.width = `${menuWidth}px`;
    agentMenu.style.left = `${left}px`;
    agentMenu.style.visibility = 'hidden';
    agentMenu.hidden = false;
    const height = agentMenu.offsetHeight || 220;
    const above = rect.top - 8 - height;
    const top = above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - height - 8);
    agentMenu.style.top = `${Math.max(8, top)}px`;
    agentMenu.style.visibility = 'visible';
  }

  function openMenu() {
    if (agentMenu.parentElement !== document.body) {
      document.body.appendChild(agentMenu);
    }
    renderMenu();
    agentMenu.hidden = false;
    agentBtn.setAttribute('aria-expanded', 'true');
    positionMenu();
  }

  function closeMenu() {
    agentMenu.hidden = true;
    agentBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    if (agentMenu.hidden) openMenu();
    else closeMenu();
  }

  function openPanel() {
    panel.classList.add('open');
    input?.focus();
    void loadStatus();
  }

  function closePanel() {
    panel.classList.remove('open');
    closeMenu();
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api/cursor-chat${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const erro = new Error(data.error || `Falha HTTP ${res.status}`);
      erro.status = res.status;
      erro.data = data;
      throw erro;
    }
    return data;
  }

  async function loadStatus() {
    try {
      const status = await api('/status');
      state.configured = Boolean(status.configured);
      if (!state.configured) {
        if (!messagesEl.querySelector('[data-cursor-unconfigured]')) {
          const msg = appendMsg('error', 'A chave CURSOR_API_KEY ainda não está no servidor. Este chat é o Cloud Agent do Cursor — não o Assistente SGF.');
          if (msg) msg.dataset.cursorUnconfigured = '1';
        }
        return;
      }
      const models = await api('/models');
      if (Array.isArray(models.agents) && models.agents.length) state.agents = models.agents;
      updateAgentLabel();
      renderMenu();
    } catch (err) {
      appendMsg('error', escapeHtml(err.message || 'Não foi possível falar com a API do Cursor.'));
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollRun(agentId) {
    let lastText = '';
    for (let i = 0; i < 40; i += 1) {
      const data = await api(`/agents/${encodeURIComponent(agentId)}`);
      const status = String(data.run?.status || data.agent?.status || '').toUpperCase();
      const result = String(data.run?.result || '').trim();
      if (result) lastText = result;
      if (['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED'].includes(status)) {
        return { status, result: lastText, url: data.agent?.url, git: data.run?.git };
      }
      await wait(3000);
    }
    return { status: 'RUNNING', result: lastText };
  }

  async function refreshConversation(agentId) {
    try {
      const data = await api(`/agents/${encodeURIComponent(agentId)}/conversation`);
      if (!Array.isArray(data.messages) || !data.messages.length) return false;
      messagesEl.innerHTML = '';
      for (const item of data.messages) {
        const tipo = String(item.type || '').includes('user') ? 'user' : 'assistant';
        appendMsg(tipo, escapeHtml(item.text || ''));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function sendMessage() {
    const text = String(input?.value || '').trim();
    if (!text || state.loading) return;
    input.value = '';
    appendMsg('user', escapeHtml(text));
    state.loading = true;
    setTyping(true);
    sendBtn.disabled = true;
    try {
      let data;
      if (state.conversationId) {
        data = await api(`/agents/${encodeURIComponent(state.conversationId)}/runs`, {
          method: 'POST',
          body: JSON.stringify({ text })
        });
      } else {
        data = await api('/agents', {
          method: 'POST',
          body: JSON.stringify({ text, agent: state.agentId })
        });
      }
      state.conversationId = data.agent?.id || state.conversationId;
      const polled = state.conversationId ? await pollRun(state.conversationId) : {};
      setTyping(false);
      const refreshed = state.conversationId ? await refreshConversation(state.conversationId) : false;
      if (!refreshed) {
        const reply = polled.result || 'O agente recebeu a tarefa e continua no Cursor.';
        appendMsg('assistant', escapeHtml(reply));
      }
      if (data.agent?.url || polled.url) {
        const url = escapeHtml(data.agent?.url || polled.url);
        appendMsg('system', `Conversa no Cursor: <a class="cursor-chat-link" href="${url}" target="_blank" rel="noopener">abrir agente</a>`);
      }
    } catch (err) {
      setTyping(false);
      appendMsg('error', escapeHtml(err.message || 'Falha ao falar com o agente do Cursor.'));
    } finally {
      state.loading = false;
      sendBtn.disabled = false;
      input?.focus();
    }
  }

  function novaConversa() {
    state.conversationId = null;
    messagesEl.innerHTML = '';
    appendMsg('system', 'Nova conversa do Cloud Agent do Cursor. O Assistente SGF continua no outro botão.');
    input?.focus();
  }

  agentBtn.addEventListener('click', toggleMenu);
  agentMenu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-agent-id]');
    if (!option) return;
    event.preventDefault();
    saveAgent(option.getAttribute('data-agent-id'));
    closeMenu();
    appendMsg('system', `Agente selecionado: ${escapeHtml(agentMeta(state.agentId).label)}`);
  });
  document.addEventListener('click', (event) => {
    if (agentMenu.hidden) return;
    if (event.target.closest('.cursor-chat-btn') || event.target.closest('#cursor-chat-menu')) return;
    closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => {
    if (!agentMenu.hidden) positionMenu();
  });

  openBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  newBtn?.addEventListener('click', novaConversa);
  sendBtn?.addEventListener('click', sendMessage);
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });

  renderMenu();
  updateAgentLabel();
  closeMenu();
})();
