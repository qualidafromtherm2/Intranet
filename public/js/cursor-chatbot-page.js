/**
 * Página Conf. sistema → Chatbot
 * Cloud Agents (Cursor) + aprovação GitHub — UI estilo app Android.
 */
(function () {
  'use strict';

  const state = {
    agentId: null,
    runId: null,
    prNumber: null,
    prUrl: null,
    branch: null,
    pollTimer: null,
    busy: false,
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

  function appendBubble(role, text) {
    const box = $('cursorChatMessages');
    if (!box) return;
    const b = el('div', `cursor-chat-bubble ${role}`, text);
    box.appendChild(b);
    box.scrollTop = box.scrollHeight;
    return b;
  }

  function setStatus(text, kind) {
    const line = $('cursorChatStatus');
    if (!line) return;
    line.textContent = text || '';
    const badge = $('cursorChatBadge');
    if (badge) {
      badge.className = 'cursor-chat-badge' + (kind ? ` ${kind}` : '');
      badge.textContent = kind === 'ok' ? 'Pronto' : kind === 'err' ? 'Erro' : kind === 'warn' ? 'Trabalhando' : 'Chatbot';
    }
  }

  function stopPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function setBusy(v) {
    state.busy = v;
    const send = $('cursorChatSend');
    const input = $('cursorChatInput');
    if (send) send.disabled = v;
    if (input) input.disabled = v;
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

  function showReview(summary) {
    const box = $('cursorChatReview');
    const text = $('cursorChatReviewText');
    if (!box || !text) return;
    const parts = [
      'Proposta pronta para revisão.',
      summary.branch ? `Branch: ${summary.branch}` : null,
      summary.prUrl ? `PR: ${summary.prUrl}` : null,
      summary.result ? `\n${summary.result}` : null,
    ].filter(Boolean);
    text.textContent = parts.join('\n');
    box.classList.add('visible');
  }

  function hideReview() {
    $('cursorChatReview')?.classList.remove('visible');
    const files = $('cursorChatFiles');
    if (files) files.textContent = '';
  }

  async function loadPrFiles(prNumber) {
    const files = $('cursorChatFiles');
    if (!files || !prNumber) return;
    files.textContent = 'Carregando arquivos…';
    try {
      const data = await api(`/pulls/${prNumber}/files`);
      const lines = (data.items || []).slice(0, 50).map((f) => {
        const sign = f.status === 'removed' ? '-' : f.status === 'added' ? '+' : '~';
        return `${sign} ${f.filename} (+${f.additions}/-${f.deletions})`;
      });
      files.textContent = lines.length ? lines.join('\n') : 'Sem arquivos listados.';
    } catch (e) {
      files.textContent = e.message || 'Falha ao listar arquivos.';
    }
  }

  async function refreshAgentList() {
    const list = $('cursorChatAgentList');
    if (!list) return;
    list.innerHTML = '<div class="cursor-chat-bubble meta">Carregando conversas…</div>';
    try {
      const data = await api('/agents');
      const items = data.items || [];
      if (!items.length) {
        list.innerHTML = '<div class="cursor-chat-bubble meta">Nenhuma conversa ainda.</div>';
        return;
      }
      list.innerHTML = '';
      items.forEach((a) => {
        const btn = el('button', 'cursor-chat-agent-item' + (a.id === state.agentId ? ' active' : ''));
        btn.type = 'button';
        btn.innerHTML = `<strong></strong><span></span>`;
        btn.querySelector('strong').textContent = a.name || a.id;
        btn.querySelector('span').textContent = `${a.status || '—'} · ${(a.updatedAt || '').slice(0, 16).replace('T', ' ')}`;
        btn.addEventListener('click', () => openAgent(a.id));
        list.appendChild(btn);
      });
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('div', 'cursor-chat-bubble error', e.message || 'Falha ao listar'));
    }
  }

  async function openAgent(agentId) {
    state.agentId = agentId;
    hideReview();
    const box = $('cursorChatMessages');
    if (box) box.innerHTML = '';
    setStatus('Carregando conversa…', 'warn');
    try {
      const data = await api(`/agents/${encodeURIComponent(agentId)}`);
      state.runId = data.runId;
      state.prNumber = data.prNumber;
      state.prUrl = data.prUrl;
      state.branch = data.branch;
      if (data.result) appendBubble('assistant', data.result);
      else appendBubble('meta', 'Conversa carregada. Envie um comando abaixo.');
      const st = String(data.runStatus || '').toUpperCase();
      if (st === 'FINISHED' && data.prNumber) {
        showReview(data);
        await loadPrFiles(data.prNumber);
        setStatus('Proposta pronta', 'ok');
      } else if (st === 'RUNNING' || st === 'CREATING') {
        setStatus('Agent trabalhando…', 'warn');
        startPoll();
      } else {
        setStatus(data.name || 'Conversa', '');
      }
      await refreshAgentList();
    } catch (e) {
      appendBubble('error', e.message);
      setStatus('Erro', 'err');
    }
  }

  async function poll() {
    if (!state.agentId) return;
    try {
      const data = await api(`/agents/${encodeURIComponent(state.agentId)}`);
      state.runId = data.runId || state.runId;
      state.prNumber = data.prNumber || state.prNumber;
      state.prUrl = data.prUrl || state.prUrl;
      state.branch = data.branch || state.branch;
      const st = String(data.runStatus || '').toUpperCase();
      if (st === 'FINISHED') {
        stopPoll();
        setBusy(false);
        if (data.result) appendBubble('assistant', data.result);
        showReview(data);
        if (data.prNumber) await loadPrFiles(data.prNumber);
        setStatus('Proposta pronta', 'ok');
        await refreshAgentList();
      } else if (st === 'ERROR' || st === 'CANCELLED' || st === 'EXPIRED') {
        stopPoll();
        setBusy(false);
        appendBubble('error', `Agent: ${st}`);
        setStatus(st, 'err');
      } else {
        setStatus('Agent trabalhando…', 'warn');
      }
    } catch (_) {}
  }

  function startPoll() {
    stopPoll();
    void poll();
    state.pollTimer = setInterval(() => { void poll(); }, 8000);
  }

  async function sendMessage() {
    const input = $('cursorChatInput');
    const text = String(input?.value || '').trim();
    if (!text || state.busy) return;
    input.value = '';
    appendBubble('user', text);
    setBusy(true);
    setStatus('Enviando…', 'warn');
    try {
      if (!state.agentId) {
        const data = await api('/agents', {
          method: 'POST',
          body: JSON.stringify({ prompt: text, autoCreatePR: true }),
        });
        state.agentId = data.agentId;
        state.runId = data.runId;
        appendBubble('assistant', 'Agent iniciado. Aguarde a proposta (branch/PR).');
      } else {
        const data = await api(`/agents/${encodeURIComponent(state.agentId)}/runs`, {
          method: 'POST',
          body: JSON.stringify({ prompt: text }),
        });
        state.runId = data.run?.id || data.runId || state.runId;
        appendBubble('assistant', 'Follow-up enviado. Trabalhando…');
      }
      startPoll();
      await refreshAgentList();
    } catch (e) {
      setBusy(false);
      appendBubble('error', e.message || 'Falha ao enviar');
      setStatus('Erro', 'err');
    }
  }

  function enterTestMode() {
    document.body.classList.add('cursor-chat-preview-mode');
    const t = $('cursorChatPreviewText');
    if (t) {
      t.textContent = `Modo de teste — branch ${state.branch || 'pendente'}. A publicação no GitHub só acontece quando você aprovar.`;
    }
    appendBubble(
      'assistant',
      'Modo de teste ativo.\nO código da PR ainda não está no site ao vivo. Quando estiver bom, clique em “Aprovar e publicar”.'
    );
  }

  function exitTestMode() {
    document.body.classList.remove('cursor-chat-preview-mode');
  }

  async function approve() {
    if (!state.prNumber) {
      appendBubble('error', 'Não há PR para aprovar.');
      return;
    }
    if (!window.confirm('Publicar de verdade no GitHub (merge na main)? O Render vai atualizar o site.')) return;
    setBusy(true);
    try {
      const data = await api('/approve', {
        method: 'POST',
        body: JSON.stringify({ prNumber: state.prNumber, agentId: state.agentId }),
      });
      exitTestMode();
      hideReview();
      appendBubble('assistant', `✅ Publicado.\n${data.message || 'Merge ok — aguarde o deploy.'}`);
      state.agentId = null;
      state.runId = null;
      state.prNumber = null;
      state.prUrl = null;
      state.branch = null;
      stopPoll();
      setStatus('Publicado', 'ok');
      await refreshAgentList();
    } catch (e) {
      appendBubble('error', e.message);
      setStatus('Erro', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!window.confirm('Descartar a proposta (fecha o PR sem publicar)?')) return;
    try {
      await api('/reject', {
        method: 'POST',
        body: JSON.stringify({ prNumber: state.prNumber, agentId: state.agentId }),
      });
      exitTestMode();
      hideReview();
      appendBubble('assistant', 'Proposta descartada.');
      state.agentId = null;
      state.prNumber = null;
      stopPoll();
      await refreshAgentList();
    } catch (e) {
      appendBubble('error', e.message);
    }
  }

  function newChat() {
    stopPoll();
    state.agentId = null;
    state.runId = null;
    state.prNumber = null;
    state.prUrl = null;
    state.branch = null;
    hideReview();
    exitTestMode();
    const box = $('cursorChatMessages');
    if (box) box.innerHTML = '';
    appendBubble(
      'assistant',
      'Nova conversa.\nDescreva a mudança que quer na intranet (como no Cursor). Eu crio branch/PR no GitHub. Depois você testa e aprova para publicar.'
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
    const box = $('cursorChatMessages');
    if (box && !box.children.length) {
      appendBubble(
        'assistant',
        'Olá. Este é o Chatbot de desenvolvimento (Cloud Agent).\nMande o comando como no Cursor. Quando a proposta ficar pronta, revise, teste e aprove para subir no GitHub.'
      );
    }
    await checkConfig();
    await refreshAgentList();
  };

  function bind() {
    $('menu-chatbot-cursor')?.addEventListener('click', (e) => {
      e.preventDefault();
      void window.abrirPainelCursorChatbot();
    });
    $('cursorChatSend')?.addEventListener('click', () => { void sendMessage(); });
    $('cursorChatInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      }
    });
    $('cursorChatNew')?.addEventListener('click', newChat);
    $('cursorChatRefresh')?.addEventListener('click', () => { void refreshAgentList(); });
    $('cursorChatTest')?.addEventListener('click', enterTestMode);
    $('cursorChatApprove')?.addEventListener('click', () => { void approve(); });
    $('cursorChatReject')?.addEventListener('click', () => { void reject(); });
    $('cursorChatBannerApprove')?.addEventListener('click', () => { void approve(); });
    $('cursorChatBannerExit')?.addEventListener('click', exitTestMode);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
