// menu_produto.js
// v4.0 - Sincronização automática Omie→PostgreSQL antes de abrir produto
import config from './config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
const API_BASE = window.location.origin; // já serve https://intranet-30av.onrender.com

// Silencia todos os logs de debug do chat que começam com "[CHAT]"
;(function silenceChatLogs(){
  try {
    const _log = console.log.bind(console);
    const _warn = console.warn.bind(console);
    console.log = (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[CHAT]')) return;
      _log(...args);
    };
    console.warn = (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[CHAT]')) return;
      _warn(...args);
    };
  } catch {}
})();

// ============================================================================
// SISTEMA CENTRAL DE NAVEGAÇÃO - Garante que só 1 página seja visível por vez
// ============================================================================
window.clearMainContainer = function() {
  try {
    const main = document.querySelector('.main-container');
    if (!main) return;
    
    // Força TODOS os filhos a ficarem invisíveis
    Array.from(main.children).forEach(el => {
      if (!el) return;
      // Use apenas display para não quebrar layout/restauração
      el.style.display = 'none';
      // Limpa quaisquer efeitos anteriores caso existam
      el.style.visibility = '';
      el.style.opacity = '';
      el.style.position = '';
      el.style.left = '';
    });
    
    console.log('[NAV] Container principal limpo - todos os filhos ocultos');
  } catch(e) {
    console.error('[NAV] Erro ao limpar container:', e);
  }
};

window.showOnlyInMain = function(element) {
  try {
    if (!element) {
      console.warn('[NAV] showOnlyInMain: elemento inválido');
      return;
    }
    
    // Limpa TUDO primeiro
    window.clearMainContainer();
    
    // Mostra SOMENTE o elemento especificado
    element.style.display = 'block';
    // Restaura propriedades possivelmente alteradas por outras telas
    element.style.visibility = '';
    element.style.opacity = '';
    element.style.position = '';
    element.style.left = '';
    
    console.log('[NAV] Mostrando apenas:', element.id || element.className);
  } catch(e) {
    console.error('[NAV] Erro ao mostrar elemento:', e);
  }
};

// Inicializa a página mostrando APENAS o painel inicial
document.addEventListener('DOMContentLoaded', () => {
  console.log('[NAV] Inicializando navegação - mostrando página inicial');
  const paginaInicio = document.getElementById('paginaInicio');
  if (paginaInicio) {
    window.showOnlyInMain(paginaInicio);
  }
});

// ============================================================================
// FUNÇÃO GLOBAL PARA ABRIR O CHAT - Disponível imediatamente
// ============================================================================
window.openChat = async function() {
  console.log('[CHAT] openChat chamado - VERSÃO COM LOGS v1.1');
  console.log('[CHAT] Verificando __chatLoadUsers:', typeof window.__chatLoadUsers);
  
  // Aguarda o DOM estar pronto
  if (!document.getElementById('chatPane')) {
    console.warn('[CHAT] chatPane ainda não existe no DOM, aguardando...');
    await new Promise(resolve => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      } else {
        resolve();
      }
    });
  }
  
  const chatPane = document.getElementById('chatPane');
  if (!chatPane) {
    console.error('[CHAT] chatPane não encontrado no DOM');
    return;
  }
  
  // precisa estar logado
  if (!window.__sessionUser?.id) {
    console.warn('[CHAT] Usuário não autenticado');
    console.log('[CHAT] Valor de window.__sessionUser:', window.__sessionUser);
    document.getElementById('profile-icon')?.click();
    return;
  }
  
  console.log('[CHAT] Abrindo chat...');
  
  // Limpa TUDO antes
  window.clearMainContainer();
  
  // Garante que módulos especiais também sejam escondidos
  try { if (typeof hideArmazem === 'function') hideArmazem(); } catch {}
  try { if (typeof hideKanban === 'function') hideKanban(); } catch {}
  document.getElementById('produtoTabs')?.setAttribute('style','display:none');
  document.getElementById('kanbanTabs')?.setAttribute('style','display:none');
  document.getElementById('armazemTabs')?.setAttribute('style','display:none');
  
  // Remove destaque de qualquer link de topo
  try {
    document.querySelectorAll('.header .header-menu > .menu-link, a[id^="menu-"]').forEach(a => a.classList.remove('is-active'));
  } catch {}

  // Mostra SOMENTE o chat
  window.showOnlyInMain(chatPane);

  // Limpa histórico e nome do usuário
  const chatWith = document.getElementById('chatWith');
  if (chatWith) chatWith.textContent = 'Selecione um usuário';
  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) chatMessages.innerHTML = '';
  const chatText = document.getElementById('chatText');
  if (chatText) {
    chatText.value = '';
    chatText.disabled = true;
    chatText.placeholder = 'Digite uma mensagem';
  }
  const chatSend = document.getElementById('chatSend');
  if (chatSend) chatSend.disabled = true;

  // Atualiza hash para evitar lógicas que forçam #inicio
  try { if (location.hash !== '#chat') location.hash = '#chat'; } catch {}

  // Carrega usuários se a função existir
  if (typeof window.__chatLoadUsers === 'function') {
    await window.__chatLoadUsers();
  }

  console.log('[CHAT] Chat aberto com sucesso');
};

// ============================================================================
// Definição da função de carregamento de usuários do chat - ANTES DO IIFE
// ============================================================================
window.__chatLoadUsers = async function() {
  // Só executa se usuário estiver logado
  if (!window.__sessionUser) {
    console.log('[CHAT] Usuário não logado - ignorando carregamento');
    const bellNumber = document.querySelector('.notification-number');
    if (bellNumber) { bellNumber.textContent = ''; bellNumber.style.display = 'none'; }
    return;
  }
  
  console.log('[CHAT] __chatLoadUsers chamado');
  try {
    const r = await fetch('/api/chat/users', { credentials:'include' });
    console.log('[CHAT] Response status:', r.status);
    if (!r.ok) {
      console.error('[CHAT] Erro ao carregar usuários, status:', r.status);
      // zera badge do sino em caso de erro/deslogado
      const bellNumber = document.querySelector('.notification-number');
      if (bellNumber) { bellNumber.textContent = ''; bellNumber.style.display = 'none'; }
      return;
    }
    const data = await r.json();
    console.log('[CHAT] Usuários recebidos:', data);
    
    const currentUserId = window.__sessionUser?.id;
    console.log('[CHAT] ID do usuário logado:', currentUserId);
    
    const users = (data.users||[]).filter(u => !currentUserId || String(u.id) !== String(currentUserId));
    console.log('[CHAT] Total de usuários após filtro:', users.length);
    
    // 1) Atualiza badge do sino independente do DOM do chat
    let usersWithUnread = 0;
    users.forEach(u => { if (u.unreadCount && u.unreadCount > 0) usersWithUnread++; });
    const bellNumber = document.querySelector('.notification-number');
    if (bellNumber) {
      bellNumber.textContent = usersWithUnread > 0 ? String(usersWithUnread) : '';
      bellNumber.style.display = usersWithUnread > 0 ? 'inline-flex' : 'none';
    }
    
    // 2) Renderiza a lista somente se o chat estiver no DOM
    const chatUserList = document.getElementById('chatUserList');
    if (!chatUserList) {
      return; // nada mais a fazer quando não está na tela
    }
    
    chatUserList.innerHTML = '';
    if (!users || users.length === 0) {
      console.warn('[CHAT] Nenhum usuário para renderizar');
      return;
    }

    users.forEach(u => {
      const li = document.createElement('li');
      li.className = 'chat-user-item';
      li.dataset.userId = u.id;

      // Nome do usuário
      const nameSpan = document.createElement('span');
      nameSpan.textContent = u.username;
      li.appendChild(nameSpan);

      // Indicador de não lidas
      if (u.unreadCount && u.unreadCount > 0) {
        const unread = document.createElement('span');
        unread.className = 'chat-user-unread';
        unread.textContent = u.unreadCount;
        li.appendChild(unread);
      }

      li.addEventListener('click', () => selectChatUser(u));
      chatUserList.appendChild(li);
      console.log('[CHAT] Usuário adicionado à lista:', u.username, 'ID:', u.id, 'Não lidas:', u.unreadCount);
    });
    // badge do sino já atualizado acima
  } catch (err) {
    console.error('[CHAT] Erro ao carregar usuários:', err);
    const bellNumber = document.querySelector('.notification-number');
    if (bellNumber) { bellNumber.textContent = ''; bellNumber.style.display = 'none'; }
  }
};

// ============================================================================
// Estado global do chat
// ============================================================================
window.__chatState = {
  selectedUserId: null,
  selectedUsername: null
};

// ============================================================================
// Seleciona um usuário para conversar
// ============================================================================
function selectChatUser(user) {
  console.log('[CHAT] Usuário selecionado:', user.username, 'ID:', user.id);
  
  window.__chatState.selectedUserId = user.id;
  window.__chatState.selectedUsername = user.username;
  
  // Atualiza o nome do usuário selecionado
  const chatWith = document.getElementById('chatWith');
  if (chatWith) chatWith.textContent = user.username;
  
  // Habilita o campo de mensagem e botão enviar
  const chatText = document.getElementById('chatText');
  const chatSend = document.getElementById('chatSend');
  if (chatText) {
    chatText.disabled = false;
    chatText.placeholder = `Digite uma mensagem para ${user.username}...`;
    chatText.focus();
  }
  if (chatSend) chatSend.disabled = false;
  
  // Marca o usuário como ativo na lista
  document.querySelectorAll('.chat-user-item').forEach(li => {
    li.classList.toggle('is-active', li.dataset.userId === user.id);
  });

  // Otimista: remove indicador de não lidas deste usuário imediatamente
  const activeLi = document.querySelector(`.chat-user-item[data-user-id="${user.id}"]`);
  const badge = activeLi?.querySelector('.chat-user-unread');
  if (badge) badge.remove();

  // Recalcula badge do sino com base nos restantes
  const remainingUnread = document.querySelectorAll('.chat-user-unread').length;
  const bellNumber = document.querySelector('.notification-number');
  if (bellNumber) {
    bellNumber.textContent = remainingUnread > 0 ? String(remainingUnread) : '';
    bellNumber.style.display = remainingUnread > 0 ? 'inline-flex' : 'none';
  }
  
  // Carrega o histórico de mensagens
  loadChatConversation(user.id);
}

// ============================================================================
// Carrega o histórico de mensagens com um usuário
// ============================================================================
async function loadChatConversation(userId) {
  // Verifica se está logado antes de carregar conversa
  if (!window.__sessionUser) {
    console.warn('[CHAT] Usuário não logado - impossível carregar conversa');
    return;
  }
  
  console.log('[CHAT] Carregando conversa com usuário ID:', userId);
  try {
    const r = await fetch(`/api/chat/conversation?userId=${userId}`, { credentials:'include' });
    if (!r.ok) {
      console.error('[CHAT] Erro ao carregar conversa, status:', r.status);
      const errorData = await r.json().catch(() => ({}));
      console.error('[CHAT] Erro do backend:', errorData);
      return;
    }
    const data = await r.json();
    console.log('[CHAT] Mensagens recebidas:', data.messages?.length || 0);
    
    renderChatMessages(data.messages || []);
  } catch (err) {
    console.error('[CHAT] Erro ao carregar conversa:', err);
  }
}

// ============================================================================
// Renderiza as mensagens no histórico
// ============================================================================
function renderChatMessages(messages) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) {
    console.error('[CHAT] Elemento chatMessages não encontrado');
    return;
  }
  
  chatMessages.innerHTML = '';
  const currentUserId = window.__sessionUser?.id;
  
  messages.forEach(msg => {
    const div = document.createElement('div');
    const isMine = String(msg.from) === String(currentUserId);
    div.className = `chat-message ${isMine ? 'chat-message-sent' : 'chat-message-received'}`;

    const text = document.createElement('div');
    text.className = 'chat-message-text';
    text.textContent = msg.text;

    const time = document.createElement('div');
    time.className = 'chat-message-time';
    time.textContent = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Ícone de visualização vv azul se lida
    if (isMine && msg.read) {
      const visto = document.createElement('span');
      visto.className = 'chat-message-visto';
      visto.innerHTML = '<i class="fa fa-check-double"></i>';
      time.appendChild(visto);
    }

    div.appendChild(text);
    div.appendChild(time);
    chatMessages.appendChild(div);
  });
  
  // Scroll para o final
  chatMessages.scrollTop = chatMessages.scrollHeight;
  console.log('[CHAT] Mensagens renderizadas:', messages.length);
}

// ============================================================================
// Envia uma mensagem
// ============================================================================
async function sendChatMessage() {
  // Verifica se está logado antes de enviar mensagem
  if (!window.__sessionUser) {
    console.warn('[CHAT] Usuário não logado - impossível enviar mensagem');
    return;
  }
  
  const chatText = document.getElementById('chatText');
  if (!chatText || !chatText.value.trim()) return;
  
  const text = chatText.value.trim();
  const to = window.__chatState.selectedUserId;
  
  if (!to) {
    console.warn('[CHAT] Nenhum usuário selecionado');
    return;
  }
  
  console.log('[CHAT] Enviando mensagem para usuário ID:', to);
  
  try {
    const r = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ to, text })
    });
    
    if (!r.ok) {
      console.error('[CHAT] Erro ao enviar mensagem, status:', r.status);
      const errorData = await r.json().catch(() => ({}));
      console.error('[CHAT] Erro do backend:', errorData);
      return;
    }
    
    const data = await r.json();
    console.log('[CHAT] Mensagem enviada com sucesso:', data);
    
    // Limpa o campo
    chatText.value = '';
    
    // Recarrega a conversa para mostrar a nova mensagem
    loadChatConversation(to);
  } catch (err) {
    console.error('[CHAT] Erro ao enviar mensagem:', err);
  }
}

// ============================================================================
// Bind de eventos do chat
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  const chatSend = document.getElementById('chatSend');
  const chatText = document.getElementById('chatText');
  
  if (chatSend) {
    chatSend.addEventListener('click', sendChatMessage);
  }
  
  if (chatText) {
    chatText.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  // Zera badge "5" do HTML ao carregar
  const bellNumber = document.querySelector('.notification-number');
  if (bellNumber) { bellNumber.textContent = ''; bellNumber.style.display = 'none'; }

  // Atualiza imediatamente e inicia polling a cada 1s SOMENTE se estiver logado
  if (window.__sessionUser && typeof window.__chatLoadUsers === 'function') {
    window.__chatLoadUsers();
  }
  if (window.__chatPollingInterval) clearInterval(window.__chatPollingInterval);
  window.__chatPollingInterval = setInterval(() => {
    // Só faz polling se usuário estiver logado
    if (window.__sessionUser && typeof window.__chatLoadUsers === 'function') {
      window.__chatLoadUsers();
    }
  }, 1000);
});

// Estado compartilhado do multiplicador da PCP (fator aplicado às quantidades)
if (!Number.isFinite(window.__pcpFactorValue) || window.__pcpFactorValue <= 0) {
  window.__pcpFactorValue = 1;
}
window.__pcpFactorInput = window.__pcpFactorInput || null;
window.__pcpFactorHandler = window.__pcpFactorHandler || null;

function pcpGetFactorValue() {
  const raw = Number(window.__pcpFactorValue ?? 1);
  return (!Number.isFinite(raw) || raw <= 0) ? 1 : raw;
}

function pcpSetFactorValue(newValue, { syncInput = true } = {}) {
  let val = Number(newValue);
  if (!Number.isFinite(val) || val <= 0) val = 1;
  window.__pcpFactorValue = val;

  if (syncInput) {
    const input = document.getElementById('pcp-factor');
    if (input && document.activeElement !== input) {
      input.value = val;
    }
  }
  return val;
}


// refs do modal de colaboradores
const BASE = API_BASE;

const txtId     = document.getElementById('colab-id');
const txtUser   = document.getElementById('colab-username');
const selFunc   = document.getElementById('colab-funcao');
const selSetor  = document.getElementById('colab-setor');
const selOper   = document.getElementById('colab-operacao');
const selProdPerm = document.getElementById('colab-produto-permissao');
const rolesBox  = document.getElementById('colab-roles');
const blocoPerm = document.getElementById('colab-permissoes');
const operListEl = document.getElementById('colab-operacao-list');
const prodPermListEl = document.getElementById('colab-produto-permissao-list');

let colabModalMode = 'create';   // 'create' | 'edit'
let colabEditSnapshot = null;    // guarda o estado original p/ "salvar só o que mudou"

// mantém referência ao listener atual para poder remover
let _currentSalvarWrapper = null;


function setSalvarHandler(fn) {
  const btnSalvar = document.getElementById('colabSalvar');
  if (!btnSalvar) return;

  ensureSpinnerCss();

  // remove o listener anterior, se houver
  if (_currentSalvarWrapper) {
    btnSalvar.removeEventListener('click', _currentSalvarWrapper);
    _currentSalvarWrapper = null;
  }

  // cria um wrapper único
  const wrapper = async (ev) => {
    ev.preventDefault();
    const original = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.classList.add('btn-loading');
    btnSalvar.dataset._originalText = original;
    btnSalvar.textContent = 'Salvando…';
    try { await fn(); }
    finally {
      btnSalvar.disabled = false;
      btnSalvar.classList.remove('btn-loading');
      btnSalvar.textContent = btnSalvar.dataset._originalText || original;
      delete btnSalvar.dataset._originalText;
    }
  };

  btnSalvar.addEventListener('click', wrapper);
  _currentSalvarWrapper = wrapper;
}

// CSS do spinner (injeção única)
let _spinnerCssInjected = false;
function ensureSpinnerCss(){
  if (_spinnerCssInjected) return;
  const css = document.createElement('style');
  css.id = 'globalSpinnerCss';
  css.textContent = `
    @keyframes spin{to{transform:rotate(360deg)}}
    .btn-loading{position:relative}
    .btn-loading::after{content:'';position:absolute;right:10px;top:50%;width:14px;height:14px;margin-top:-7px;border:2px solid rgba(255,255,255,.6);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
  `;
  document.head.appendChild(css);
  _spinnerCssInjected = true;
}


// ajuda a marcar roles por valor
function marcarRoles(rolesArr) {
  const want = new Set((rolesArr || []).map(String));
  rolesBox.querySelectorAll('input[type=checkbox]').forEach(ch => {
    ch.checked = want.has(String(ch.value));
  });
}

// seleciona <option> por texto visível (quando só temos o nome)
function selectOptionByText(selectEl, label) {
  if (!selectEl || !label) return;
  const lab = String(label).trim().toLowerCase();
  const opt = Array.from(selectEl.options).find(o => o.textContent.trim().toLowerCase() === lab);
  if (opt) selectEl.value = opt.value;
}


function normalizeOperacoes(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

const modal     = document.getElementById('colabModal');
const closeBtn  = document.getElementById('colabModalClose');
const btnSalvar = document.getElementById('colabSalvar');
const btnCanc   = document.getElementById('colabCancelar');

let colabOperacoesSelecionadas = [];
let colabProdPermSelecionadas = []; // Array para permissões de produto

function renderOperacoesSelecionadas() {
  if (!operListEl) return;
  operListEl.innerHTML = '';
  if (!colabOperacoesSelecionadas.length) {
    const empty = document.createElement('div');
    empty.className = 'operacao-empty';
    empty.textContent = 'Nenhuma operação adicionada.';
    operListEl.appendChild(empty);
    return;
  }
  colabOperacoesSelecionadas.forEach(op => {
    const chip = document.createElement('span');
    chip.className = 'operacao-chip';
    chip.dataset.id = op.id != null ? String(op.id) : '';
    chip.innerHTML = `
      <span>${op.label || op.operacao || op.id || '(sem nome)'}</span>
      <button type="button" class="operacao-remove" aria-label="Remover operação" title="Remover operação">&minus;</button>
    `;
    operListEl.appendChild(chip);
  });
}

function setOperacoesSelecionadas(list) {
  const out = [];
  if (Array.isArray(list)) {
    list.forEach((op) => {
      if (!op) return;
      const id = op.id != null ? String(op.id) : '';
      const label = (op.label ?? op.operacao ?? op.name ?? '').trim();
      if (!id) return;
      if (out.some(existing => existing.id === id)) return;
      out.push({ id, label: label || id });
    });
  }
  colabOperacoesSelecionadas = out;
  renderOperacoesSelecionadas();
}

function addOperacaoSelecionada(id, label) {
  const key = id != null ? String(id) : '';
  if (!key) return;
  const already = colabOperacoesSelecionadas.some(op => String(op.id) === key);
  if (already) return;
  colabOperacoesSelecionadas.push({ id: key, label: (label || key).trim() });
  renderOperacoesSelecionadas();
}

function removeOperacaoSelecionada(id) {
  const key = id != null ? String(id) : '';
  const next = colabOperacoesSelecionadas.filter(op => String(op.id) !== key);
  if (next.length !== colabOperacoesSelecionadas.length) {
    colabOperacoesSelecionadas = next;
    renderOperacoesSelecionadas();
  }
}

function handleOperacaoChange() {
  if (!selOper) return;
  const val = selOper.value;
  if (!val) return;
  const label = selOper.selectedOptions?.[0]?.textContent?.trim() || val;
  addOperacaoSelecionada(val, label);
  selOper.value = '';
}

operListEl?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.operacao-remove');
  if (!btn) return;
  const chip = btn.closest('.operacao-chip');
  if (chip) removeOperacaoSelecionada(chip.dataset.id || '');
});

selOper?.addEventListener('change', handleOperacaoChange);

// ========== Funções para Permissões de Produto ==========

function renderProdPermSelecionadas() {
  if (!prodPermListEl) return;
  prodPermListEl.innerHTML = '';
  if (!colabProdPermSelecionadas.length) {
    const empty = document.createElement('div');
    empty.className = 'operacao-empty';
    empty.textContent = 'Nenhuma permissão adicionada.';
    prodPermListEl.appendChild(empty);
    return;
  }
  colabProdPermSelecionadas.forEach(perm => {
    const chip = document.createElement('span');
    chip.className = 'operacao-chip';
    chip.dataset.codigo = perm.codigo || '';
    chip.innerHTML = `
      <span>${perm.nome || perm.codigo || '(sem nome)'}</span>
      <button type="button" class="operacao-remove" aria-label="Remover permissão" title="Remover permissão">&minus;</button>
    `;
    prodPermListEl.appendChild(chip);
  });
}

function setProdPermSelecionadas(list) {
  const out = [];
  if (Array.isArray(list)) {
    list.forEach((perm) => {
      if (!perm) return;
      const codigo = perm.codigo != null ? String(perm.codigo) : '';
      const nome = (perm.nome ?? '').trim();
      if (!codigo) return;
      if (out.some(existing => existing.codigo === codigo)) return;
      out.push({ codigo, nome: nome || codigo });
    });
  }
  colabProdPermSelecionadas = out;
  renderProdPermSelecionadas();
}

function addProdPermSelecionada(codigo, nome) {
  const key = codigo != null ? String(codigo) : '';
  if (!key) return;
  const already = colabProdPermSelecionadas.some(perm => String(perm.codigo) === key);
  if (already) return;
  colabProdPermSelecionadas.push({ codigo: key, nome: (nome || key).trim() });
  renderProdPermSelecionadas();
}

function removeProdPermSelecionada(codigo) {
  const key = codigo != null ? String(codigo) : '';
  const next = colabProdPermSelecionadas.filter(perm => String(perm.codigo) !== key);
  if (next.length !== colabProdPermSelecionadas.length) {
    colabProdPermSelecionadas = next;
    renderProdPermSelecionadas();
  }
}

function handleProdPermChange() {
  if (!selProdPerm) return;
  const val = selProdPerm.value;
  if (!val) return;
  const nome = selProdPerm.selectedOptions?.[0]?.textContent?.trim() || val;
  addProdPermSelecionada(val, nome);
  selProdPerm.value = '';
}

prodPermListEl?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.operacao-remove');
  if (!btn) return;
  const chip = btn.closest('.operacao-chip');
  if (chip) removeProdPermSelecionada(chip.dataset.codigo || '');
});

selProdPerm?.addEventListener('change', handleProdPermChange);

// ========== Modal de Colaborador ==========

function openColabModalCreate() {
  colabModalMode = 'create';
  document.getElementById('colabModalTitle').textContent = 'Novo colaborador';
  txtId.value = '';
  txtUser.value = '';
  rolesBox.querySelectorAll('input[type=checkbox]').forEach(i => (i.checked = false));
  if (selFunc) selFunc.selectedIndex = 0;
  if (selSetor) selSetor.selectedIndex = 0;
  if (selOper) selOper.selectedIndex = 0;
  if (selProdPerm) selProdPerm.selectedIndex = 0;
  setOperacoesSelecionadas([]);
  setProdPermSelecionadas([]);

  // no modo criar, ocultamos o bloco de permissões (permanece como está)
  if (blocoPerm) blocoPerm.style.display = 'none';

  // handler de salvar = criar
  setSalvarHandler(salvarNovoColaborador);

  modal.style.display = 'block';
  setTimeout(() => txtUser.focus(), 50);
}

async function openColabModalEdit(userObj) {
  // garante listas carregadas
  await Promise.all([loadFuncoes(), loadSetores(), loadOperacoes(), loadProdutoPermissoes()]);

  colabModalMode = 'edit';
  document.getElementById('colabModalTitle').textContent = 'Editar colaborador';

  // snapshot original (por texto) — para compararmos depois
  const operacoesRaw = normalizeOperacoes(userObj.operacoes);
  const prodPermRaw = Array.isArray(userObj.produto_permissoes) ? userObj.produto_permissoes : [];
  
  colabEditSnapshot = {
    id:        String(userObj.id || '').trim(),
    username:  String(userObj.username || '').trim(),
    funcao:    String(userObj.funcao || '').trim(),   // nome da função
    setor:     String(userObj.setor  || '').trim(),   // nome do setor
    operacao:  String(userObj.operacao || '').trim(),
    operacao_id: userObj.operacao_id != null ? Number(userObj.operacao_id) : null,
    operacoes: operacoesRaw.length
      ? operacoesRaw.map(op => ({
          id: op?.id != null ? String(op.id) : '',
          label: op?.label ?? op?.operacao ?? op?.name ?? ''
        })).filter(op => op.id)
      : [],
    produto_permissoes: prodPermRaw.map(perm => ({
      codigo: perm?.codigo || perm?.permissao_codigo || '',
      nome: perm?.nome || perm?.permissao_nome || ''
    })).filter(perm => perm.codigo),
    roles:     Array.isArray(userObj.roles) ? userObj.roles.slice() : []
  };
  colabEditSnapshot.operacao_ids = (colabEditSnapshot.operacoes || [])
    .map(op => op?.id ? String(op.id) : '')
    .filter(Boolean);

  // preencher campos
  txtId.value   = colabEditSnapshot.id;
  txtUser.value = colabEditSnapshot.username;

  // marcar roles
  marcarRoles(colabEditSnapshot.roles);

  // selecionar função/setor por NOME (se vierem os nomes)
  if (colabEditSnapshot.funcao) selectOptionByText(selFunc, colabEditSnapshot.funcao);
  if (colabEditSnapshot.setor)  selectOptionByText(selSetor, colabEditSnapshot.setor);
  const initialOps = [];
  if (colabEditSnapshot.operacoes?.length) {
    colabEditSnapshot.operacoes.forEach(op => {
      if (op && op.id) {
        initialOps.push({ id: String(op.id), label: op.label || op.operacao || op.name || String(op.id) });
      }
    });
  } else if (colabEditSnapshot.operacao_id != null || colabEditSnapshot.operacao) {
    initialOps.push({
      id: colabEditSnapshot.operacao_id != null ? String(colabEditSnapshot.operacao_id) : '',
      label: colabEditSnapshot.operacao || ''
    });
  }
  setOperacoesSelecionadas(initialOps);
  if (selOper) selOper.value = '';

  // Carregar permissões de produto selecionadas
  const initialPerms = colabEditSnapshot.produto_permissoes || [];
  setProdPermSelecionadas(initialPerms);
  if (selProdPerm) selProdPerm.value = '';

  // no modo editar também não mexemos em Permissões aqui
  if (blocoPerm) blocoPerm.style.display = 'none';

  // handler de salvar = atualizar
  setSalvarHandler(salvarEdicaoColaborador);

  modal.style.display = 'block';
  setTimeout(() => txtUser.focus(), 50);
}
window.openColabEdit = openColabModalEdit; // expõe p/ dados_colaboradores.js


function closeColabModal() {
  modal.style.display = 'none';
}

// UX: fecha no ESC
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && modal?.style.display === 'block') {
    closeColabModal();
  }
});


function getSelectedRoles() {
  return Array.from(rolesBox.querySelectorAll('input[type=checkbox]:checked'))
    .map(i => i.value);
}

async function loadFuncoes() {
  const r = await fetch(`${BASE}/api/colaboradores/funcoes`, { credentials: 'include' });
  const js = r.ok ? await r.json() : [];
  selFunc.innerHTML = js.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
}

async function loadSetores() {
  const r = await fetch(`${BASE}/api/colaboradores/setores`, { credentials: 'include' });
  const js = r.ok ? await r.json() : [];
  selSetor.innerHTML = js.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

async function loadOperacoes() {
  if (!selOper) return;
  let options = '<option value="">Selecionar operação…</option>';
  try {
    const r = await fetch(`${BASE}/api/colaboradores/operacoes`, { credentials: 'include' });
    if (r.ok) {
      const js = await r.json();
      options += js.map(op => `<option value="${op.id}">${op.operacao || op.name || op.label || op.id}</option>`).join('');
    }
  } catch (e) {
    console.warn('[colab] Falha ao carregar operações', e);
  }
  selOper.innerHTML = options;
}

async function loadProdutoPermissoes() {
  if (!selProdPerm) return;
  let options = '<option value="">Selecionar permissão…</option>';
  try {
    const r = await fetch(`${BASE}/api/colaboradores/produto-permissoes`, { credentials: 'include' });
    if (r.ok) {
      const js = await r.json();
      options += js.map(perm => `<option value="${perm.codigo}">${perm.nome}</option>`).join('');
    }
  } catch (e) {
    console.warn('[colab] Falha ao carregar permissões de produto', e);
  }
  selProdPerm.innerHTML = options;
}

async function createFuncao() {
  const name = prompt('Nome da nova função:');
  if (!name) return;
  const r = await fetch(`${BASE}/api/colaboradores/funcoes`, {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ name })
  });
  if (!r.ok) return alert('Erro ao criar função');
  const { id } = await r.json();
  await loadFuncoes();
  selFunc.value = String(id);
}

async function createSetor() {
  const name = prompt('Nome do novo setor:');
  if (!name) return;
  const r = await fetch(`${BASE}/api/colaboradores/setores`, {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ name })
  });
  if (!r.ok) return alert('Erro ao criar setor');
  const { id } = await r.json();
  await loadSetores();
  selSetor.value = String(id);
}

async function salvarNovoColaborador() {
  const username = txtUser.value.trim();
  if (!username) { alert('Informe o Usuário'); txtUser.focus(); return; }

  const roles     = getSelectedRoles();      // ['admin'] / ['editor'] / []
  const funcao_id = Number(selFunc.value);
  const setor_id  = Number(selSetor.value);
  const operacao_ids = colabOperacoesSelecionadas
    .map(op => (op?.id ?? '').toString().trim())
    .filter(id => id.length > 0);
  const operacao_id = operacao_ids.length ? operacao_ids[0] : null;
 
  // Pegar códigos das permissões de produto selecionadas
  const produto_permissao_codigos = colabProdPermSelecionadas
    .map(perm => (perm?.codigo ?? '').toString().trim())
    .filter(codigo => codigo.length > 0);

  // senha inicial simples (pode ser gerada no backend também)
  const senha_inicial = Math.random().toString(36).slice(2, 8) + '123';

  const r = await fetch(`${BASE}/api/colaboradores`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify({ 
      username, 
      senha: senha_inicial, 
      roles, 
      funcao_id, 
      setor_id, 
      operacao_id, 
      operacao_ids,
      produto_permissao_codigos
    })
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return alert(err.error || 'Falha ao cadastrar colaborador');
  }

  const novo = await r.json();
  txtId.value = novo.id;

  // fecha e pede recarga da lista
  closeColabModal();
  try { document.getElementById('btnRecarregarColab')?.click(); } catch {}
}

async function salvarEdicaoColaborador() {
  if (!colabEditSnapshot) return alert('Sem usuário em edição.');

  const id = txtId.value.trim();
  if (!id) return alert('ID inválido.');

  // valores atuais
  const now = {
    username: txtUser.value.trim(),
    roles: getSelectedRoles(),
    funcao_id: Number(selFunc.value || 0) || null,
    setor_id:  Number(selSetor.value || 0) || null,
    funcao_label: selFunc.selectedOptions?.[0]?.textContent?.trim() || '',
    setor_label:  selSetor.selectedOptions?.[0]?.textContent?.trim() || '',
    operacao_ids: colabOperacoesSelecionadas
      .map(op => (op?.id ?? '').toString().trim())
      .filter(id => id.length > 0),
    operacao_label: colabOperacoesSelecionadas[0]?.label || ''
  };
  now.operacao_id = now.operacao_ids.length ? now.operacao_ids[0] : null;

  // monta payload só com o que mudou
  const body = {};
  if (now.username && now.username !== colabEditSnapshot.username) body.username = now.username;

  const sameRoles = (a,b) => {
    const A = (a||[]).slice().sort().join('|');
    const B = (b||[]).slice().sort().join('|');
    return A === B;
  };
  if (!sameRoles(now.roles, colabEditSnapshot.roles)) body.roles = now.roles;

  if (now.funcao_label && now.funcao_label !== colabEditSnapshot.funcao) body.funcao_id = now.funcao_id;
  if (now.setor_label  && now.setor_label  !== colabEditSnapshot.setor)  body.setor_id  = now.setor_id;

  const snapshotOperIds = (colabEditSnapshot.operacao_ids || [])
    .map(id => id ? String(id).trim() : '')
    .filter(Boolean)
    .sort();
  const currentOperIds = colabOperacoesSelecionadas
    .map(op => op?.id ? String(op.id) : '')
    .filter(Boolean)
    .sort();
  const sameOperIds = snapshotOperIds.length === currentOperIds.length &&
    snapshotOperIds.every((id, idx) => id === currentOperIds[idx]);
  if (!sameOperIds) {
    body.operacao_ids = now.operacao_ids;
    body.operacao_id = now.operacao_id;
  }

  // Comparar permissões de produto (independente de mudança em operações)
  const snapshotProdPermCodigos = (colabEditSnapshot.produto_permissoes || [])
    .map(perm => perm?.codigo ? String(perm.codigo).trim() : '')
    .filter(Boolean)
    .sort();
  const currentProdPermCodigos = colabProdPermSelecionadas
    .map(perm => perm?.codigo ? String(perm.codigo) : '')
    .filter(Boolean)
    .sort();
  const sameProdPerms = snapshotProdPermCodigos.length === currentProdPermCodigos.length &&
    snapshotProdPermCodigos.every((codigo, idx) => codigo === currentProdPermCodigos[idx]);
  if (!sameProdPerms) {
    body.produto_permissao_codigos = currentProdPermCodigos;
  }

  if (!Object.keys(body).length) {
    alert('Nada mudou.');
    return;
  }

  try {
    console.log('[salvarEdicaoColaborador] payload PUT', body);
  } catch {}

  const r = await fetch(`${BASE}/api/colaboradores/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });

if (!r.ok) {
  // trata 409 com mensagem específica
  if (r.status === 409) {
    const e = await r.json().catch(()=> ({}));
    return alert(e.error || 'Este nome de usuário já está em uso.');
  }
  const e = await r.json().catch(()=> ({}));
  return alert(e.error || `Falha ao salvar alterações (HTTP ${r.status}).`);
}


  // OK — fecha modal e recarrega a lista
  modal.style.display = 'none';
  try { document.getElementById('btnRecarregarColab')?.click(); } catch {}
}


function ensureColabCreateButton() {
  // só mostra para quem está logado
  if (!window.__sessionUser) return;

  const root = document.getElementById('dadosColaboradores');
  if (!root) return;

  // tenta encontrar um botão "Recarregar" por id ou pelo texto
  const findReload = () => {
    // 1) id explícito (se seu módulo usar esse id)
    let el = document.getElementById('btn-colab-reload');
    if (el) return el;

    // 2) busca por texto RECARREGAR dentro da seção
    el = [...root.querySelectorAll('button, .content-button, .status-button')]
      .find(b => /recarregar/i.test((b.textContent || '').trim()));
    return el || null;
  };

  // ponto de ancoragem preferencial (depois do “Recarregar”)
  let anchor = findReload();

  // fallback: algum contêiner visível da seção de colaboradores
  if (!anchor) {
    anchor = root.querySelector('.content-buttons, .content .header, .content')
          || root;
  }

  // evita duplicar
  if (document.getElementById('btn-colab-create')) return;

  // cria o botão “+”
  const btn = document.createElement('button');
  btn.id = 'btn-colab-create';
  btn.textContent = '+';
  btn.title = 'Novo colaborador';
  btn.className = (anchor.className && /status-button|content-button/.test(anchor.className))
    ? anchor.className
    : 'content-button status-button';
  btn.style.marginLeft = '6px';

  // insere logo após o “Recarregar” (se encontrado) ou no topo do contêiner
  if (anchor.tagName === 'BUTTON') {
    anchor.insertAdjacentElement('afterend', btn);
  } else {
    anchor.prepend(btn);
  }

  // ao clicar, abre o modal em modo criar
  btn.addEventListener('click', async () => {
    ensureSpinnerCss();
    const prev = btn.textContent;
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.textContent = 'Abrindo…';
    try {
      await Promise.all([loadFuncoes(), loadSetores(), loadOperacoes(), loadProdutoPermissoes()]);
      openColabModalCreate();
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      btn.textContent = prev;
    }
  });
}


// ligar botões do modal (fechar/salvar/cancelar)
document.getElementById('btn-add-funcao')?.addEventListener('click', createFuncao);
document.getElementById('btn-add-setor')?.addEventListener('click', createSetor);
btnCanc  ?.addEventListener('click', closeColabModal);
closeBtn ?.addEventListener('click', closeColabModal);
// fechar clicando fora
modal?.addEventListener('click', (e) => { if (e.target === modal) closeColabModal(); });

// toda vez que você abrir a página "Cadastro de colaboradores",
// chame ensureColabCreateButton() depois que a UI deles renderizar.


let ultimoCodigo = null;      // <-- NOVO

import { initListarProdutosUI } from './requisicoes_omie/ListarProdutos.js';
import { initDadosColaboradoresUI } from './requisicoes_omie/dados_colaboradores.js';
import { initAnexosUI } from './requisicoes_omie/anexos.js';
import { initKanban } from './kanban/kanban.js';
let lastKanbanTab = 'comercial';   // lembra a sub-aba atual

import { loadDadosProduto as loadDadosProdutoReal }
  from './requisicoes_omie/Dados_produto.js';
/* ——— IMPORT único do módulo Kanban ——— */
import * as KanbanViews from './kanban/kanban.js';

// REMOVIDO: import { initPreparacaoKanban } from './kanban/kanban_preparacao.js';
// Agora a função initPreparacaoKanban está implementada diretamente neste arquivo

let almoxCurrentPage = 1;

let almoxAllDados = [];   // mantém o array completo para filtro
/* — Filtro por Família (Estoque) — */
let almoxFamiliasMap    = new Map();   // codigo -> nome da família
let almoxFamiliasAtivas = new Set();   // códigos atualmente exibidos
let almoxFamiliasLoaded = false;

/* — Ordenação da tabela — */
let almoxSortField = null;  // campo atual de ordenação
let almoxSortOrder = 'asc'; // 'asc' ou 'desc'

/* — Preparação Kanban — */
let preparacaoOperacoes = [];           // lista de operações disponíveis
let preparacaoOperacaoAtual = '';       // operação selecionada
let preparacaoDados = [];               // todos os dados de OPs
let preparacaoDadosFiltrados = [];      // dados filtrados pela operação

let transferenciaItem   = null;        // último item selecionado para transferência
let transferenciaLista  = [];          // itens adicionados à transferência
let transferLocais      = [];          // locais de estoque disponíveis
const TRANSFER_DEFAULT_ORIGEM  = '10408201806';
const TRANSFER_DEFAULT_DESTINO = '10564345392';
let almoxLocalAtual     = TRANSFER_DEFAULT_ORIGEM;
let solicitacoesTransferencias = [];
let solicitacoesTransferenciasLoaded = false;
let solicitacoesTransferenciasCarregando = false;

// === PATCH GLOBAL DO FETCH (garante cookie da sessão em TODAS as requests) ===
(function hardenFetchCredentials(){
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    init = init || {};
    // preserva se já estiver setado; senão, força 'include'
    if (!init.credentials) init.credentials = 'include';
    return _fetch(input, init);
  };
})();

// ——— formatação numérica (xx.xxx,yy) ———
const fmtBR = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const fmtQtd = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4
});

/* —— desenha <tbody> a partir de um array —— */
function renderAlmoxTable(arr) {
  const tbody = document.querySelector('#tbl-almoxarifado tbody');
  tbody.innerHTML = '';

  let somaCMC = 0;
  arr.forEach(p => {
    somaCMC += parseFloat(p.cmc);  // acumula total

    const tr = document.createElement('tr');
    tr.dataset.codigo    = p.codigo || '';
    tr.dataset.descricao = p.descricao || '';
    tr.dataset.min       = fmtBR.format(p.min);
    tr.dataset.fisico    = fmtBR.format(p.fisico);
  tr.dataset.saldo     = fmtBR.format(p.saldo);
  tr.dataset.cmc       = fmtBR.format(p.cmc);
  tr.dataset.codOmie   = p.codOmie || '';
  tr.dataset.origem    = p.origem || almoxLocalAtual || '';
  tr.dataset.familiaCodigo = p.familiaCodigo || '';
  tr.dataset.familiaNome   = p.familiaNome || '';
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td class="num">${fmtBR.format(p.min)}</td>
      <td class="num">${fmtBR.format(p.fisico)}</td>
      <td class="num">${fmtBR.format(p.saldo)}</td>
      <td class="num">R$ ${fmtBR.format(p.cmc)}</td>`;
    tbody.appendChild(tr);
  });

  /* contador de itens */
  document.getElementById('almoxCount').textContent = arr.length;

  /* total CMC */
  document.getElementById('almoxCmcTotal').textContent =
    `Total CMC: R$ ${fmtBR.format(somaCMC)}`;
}

// Controle de botões que exigem login
function setAuthGroupState(isLoggedIn) {
  const group = document.querySelector('[data-auth-guard]');
  if (!group) return;

  const buttons = group.querySelectorAll('.requires-auth');

  buttons.forEach(btn => {
    if (isLoggedIn) {
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
      btn.classList.remove('auth-disabled');
      btn.title = '';
    } else {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('auth-disabled');
      // dica sutil para o usuário
      btn.title = 'Faça login para usar esta função';
    }
  });
}

// Intercepta cliques quando deslogado (evita navegação/JS acionar)
function installAuthClickGuard() {
  const group = document.querySelector('[data-auth-guard]');
  if (!group) return;

  // delegação de eventos no grupo
  group.addEventListener('click', (ev) => {
    const target = ev.target.closest('.requires-auth');
    if (!target) return;

    // se está marcado como desabilitado, bloqueia
    if (target.classList.contains('auth-disabled') || target.getAttribute('aria-disabled') === 'true' || target.disabled) {
      ev.preventDefault();
      ev.stopPropagation();
      // opcional: algum feedback visual rápido
      target.classList.add('auth-bump');
      setTimeout(() => target.classList.remove('auth-bump'), 150);
    }
  }, true);
}


function aplicarFiltroAlmox() {
  const termo = document.getElementById('almoxSearch').value
                 .trim().toLowerCase();

  const totalFamilias = almoxFamiliasMap.size;
  const applyFamiliaFilter = (
    totalFamilias > 0 &&
    almoxFamiliasAtivas.size > 0 &&
    almoxFamiliasAtivas.size < totalFamilias
  );

  const filtrados = almoxAllDados.filter(p => {
    const codigo = String(p.codigo || '').trim();
    const familiaCodigo = p.familiaCodigo ? String(p.familiaCodigo).trim() : '';
    const familiaOk = !applyFamiliaFilter || !familiaCodigo || almoxFamiliasAtivas.has(familiaCodigo);

    const termoVazio = termo.length === 0;
    const codigoOk   = codigo.toLowerCase().includes(termo);
    const descricaoOk = (p.descricao || '').toLowerCase().includes(termo);
    const buscaOk    = termoVazio || codigoOk || descricaoOk;
    return familiaOk && buscaOk;
  });
  
  // Aplica ordenação se houver campo selecionado
  if (almoxSortField) {
    filtrados.sort((a, b) => {
      let valA = a[almoxSortField];
      let valB = b[almoxSortField];
      
      // Converte para número se o campo for numérico
      if (['min', 'fisico', 'saldo', 'cmc'].includes(almoxSortField)) {
        valA = parseFloat(valA) || 0;
        valB = parseFloat(valB) || 0;
      } else {
        // Campos de texto
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }
      
      if (valA < valB) return almoxSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return almoxSortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }
  
  renderAlmoxTable(filtrados);
}

function renderProdTable(arr) {
  const tbody = document.querySelector('#tbl-producao tbody');
  tbody.innerHTML = '';
  let soma = 0;

  arr.forEach(p => {
    soma += parseFloat(p.cmc);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td class="num">${fmtBR.format(p.min)}</td>
      <td class="num">${fmtBR.format(p.fisico)}</td>
      <td class="num">${fmtBR.format(p.reservado)}</td>
      <td class="num">${fmtBR.format(p.saldo)}</td>
      <td class="num">R$ ${fmtBR.format(p.cmc)}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('prodCount').textContent = arr.length;
  document.getElementById('prodCmcTotal').textContent =
    `Total CMC: R$ ${fmtBR.format(soma)}`;
}

function aplicarFiltroProd() {
  const termo = document.getElementById('prodSearch').value.trim().toLowerCase();

  const filtrados = prodAllDados.filter(p => {
    // Se nenhuma família está ativa, mostra tudo (ou nada, dependendo da lógica desejada)
    // Aqui vamos mostrar tudo se o Set estiver vazio
    const familiaOk = prodFamiliasAtivas.size === 0 || prodFamiliasAtivas.has(p.familiaCodigo);
    const buscaOk   = p.descricao.toLowerCase().includes(termo);
    return familiaOk && buscaOk;
  });
  renderProdTable(filtrados);
}


let almoxTotalPages  = 1;


// deixa a versão completa visível globalmente
window.loadDadosProduto = loadDadosProdutoReal;

// === EDIÇÃO INLINE DA DESCRIÇÃO DO PRODUTO ===
function enableProductDescEdit() {
  const descEl = document.getElementById('productDesc');
  if (!descEl) return;
  if (descEl.dataset.editing === '1') return;
  descEl.dataset.editing = '1';
  const original = descEl.textContent;
  descEl.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = original;
  input.className = 'product-desc-edit';
  input.style = 'width: 70%; padding: 6px; font-size: 1em;';
  descEl.appendChild(input);
  // Botão salvar
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Salvar';
  saveBtn.className = 'btn btn-primary';
  saveBtn.style = 'margin-left: 10px; padding: 6px 16px; font-size: 1em; background: #10b981; color: #fff; border: none; border-radius: 6px;';
  descEl.appendChild(saveBtn);
  // Botão cancelar
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.className = 'btn';
  cancelBtn.style = 'margin-left: 6px; padding: 6px 16px; font-size: 1em; background: #eee; color: #333; border: none; border-radius: 6px;';
  descEl.appendChild(cancelBtn);

  // Foco automático
  setTimeout(() => input.focus(), 100);

  // Handler salvar
  saveBtn.onclick = async () => {
    const novaDesc = input.value.trim();
    if (!novaDesc) { input.focus(); return; }
    // Recupera o código do produto
    const codigo = window.pcpCodigoAtual || window.codigoSelecionado || document.getElementById('productTitle')?.textContent?.trim();
    if (!codigo) { alert('Código do produto não encontrado!'); return; }
    // Atualiza na Omie
    try {
      const payload = { codigo, descricao: novaDesc };
      const bodyRaw = JSON.stringify({ produto_servico_cadastro: payload });
      const resp = await fetch(`${API_BASE}/api/produtos/alterar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyRaw
      });
      const result = await resp.json();
      if (resp.ok && (!result.faultcode && !result.error)) {
        descEl.innerHTML = novaDesc;
        descEl.dataset.editing = '';
        // Opcional: feedback visual
        descEl.style.background = '#e6ffe6';
        setTimeout(() => { descEl.style.background = ''; }, 1200);
      } else {
        alert('Erro ao salvar: ' + (result.error || result.faultstring || 'Falha desconhecida'));
      }
    } catch (e) {
      alert('Falha ao salvar descrição: ' + (e.message || e));
    }
  };
  // Handler cancelar
  cancelBtn.onclick = () => {
    descEl.innerHTML = original;
    descEl.dataset.editing = '';
  };
}

// Ativa edição ao clicar na descrição
document.addEventListener('DOMContentLoaded', () => {
  const descEl = document.getElementById('productDesc');
  if (descEl) {
    descEl.style.cursor = 'pointer';
    descEl.title = 'Clique para editar a descrição';
    descEl.addEventListener('click', enableProductDescEdit);
  }
});

async function fetchAndRenderProdutos() {
  console.log('[DEBUG] fetchAndRenderProdutos: iniciando');
  showSpinner();
  try {
    console.log(`[DEBUG] fetchAndRenderProdutos: enviando requisição para ${API_BASE}/api/omie/produtos`);
    const res = await fetch(`${API_BASE}/api/omie/produtos`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type':'application/json' },
      body: JSON.stringify({
        call:       'ListarProdutosResumido',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina: 1,
          registros_por_pagina: 100,
          filtrar_apenas_descricao: ''
        }]
      })
    });
    console.log('[DEBUG] fetchAndRenderProdutos: resposta HTTP recebida, status', res.status);

    const json = await res.json();
    console.log('[DEBUG] fetchAndRenderProdutos: JSON completo:', json);

    const items = json.produto_servico_resumido || [];
    console.log('[DEBUG] fetchAndRenderProdutos: items extraídos:', items.length, 'itens');

    // atualiza contador
    document.getElementById('productCount').textContent = items.length;
    console.log('[DEBUG] fetchAndRenderProdutos: contador atualizado para', items.length);

    // monta a lista
    const ul = document.getElementById('listaProdutosList');
    console.log('[DEBUG] fetchAndRenderProdutos: UL encontrado:', ul);

    ul.innerHTML = items.map(item => `
      <li data-codigo="${item.codigo}" data-descricao="${item.descricao}">
        <span class="products">${item.codigo}</span>
        <span class="status">${item.descricao}</span>
        <span class="unidade">${item.saldo_disponivel ?? '-'}</span>
      </li>
    `).join('');
    console.log('[DEBUG] fetchAndRenderProdutos: UL.innerHTML atualizado');

  } catch (err) {
    console.error('[DEBUG] fetchAndRenderProdutos: erro ao buscar produtos →', err);
    alert('Erro ao buscar produtos: ' + err.message);
  } finally {
    hideSpinner();
    console.log('[DEBUG] fetchAndRenderProdutos: spinner escondido');
    console.log('[DEBUG] fetchAndRenderProdutos() terminou');
  }
}



function showMainTab(tabId) {
  // Limpa TUDO da área principal primeiro
  window.clearMainContainer?.();
  
  // garante que se estava em Armazéns ou Kanban, tudo volte a esconder
  if (typeof hideArmazem === 'function') hideArmazem();
  if (typeof hideKanban === 'function') hideKanban();
  const produtoTabs = document.getElementById('produtoTabs');
  if (produtoTabs) produtoTabs.style.display = 'block';
  // força ocultar qualquer resquício das guias de Armazém
  const armTabs = document.getElementById('armazemTabs');
  const armContent = document.getElementById('armazemContent');
  if (armTabs) armTabs.style.display = 'none';
  if (armContent) armContent.style.display = 'none';
  document
    .querySelectorAll('#armazemContent .armazem-page')
    .forEach(p => (p.style.display = 'none'));

  // tenta achar o alvo em 2 formatos:
  //   • id = tabId  (ex.:  "listaPecas")
  //   • id = "conteudo-" + tabId  (ex.:  "conteudo-pcp")
  const alvo =
    document.getElementById(tabId) ||
    document.getElementById(`conteudo-${tabId}`);

  if (alvo) window.showOnlyInMain?.(alvo);
}


window.showMainTab = showMainTab;   // expõe p/ outros módulos
// Tenta descobrir o código "ao lado do +" na aba PCP, ou de outras fontes já usadas pelo app
function getPCPProdutoCodigo() {
  // fonte 1: estado corrente (sempre atualizado por quem abriu a PCP)
  if (window.pcpCodigoAtual && window.pcpCodigoAtual.trim()) return window.pcpCodigoAtual.trim();

  // fonte 2: o que já está na barra da PCP (fallback visual)
  const barCode = document.querySelector('#pcp-code')?.textContent?.trim();
  if (barCode) return barCode;

  // fonte 3: outras pistas (antigas)
  return (
       (window.codigoSelecionado || '').trim()
    || (window.prepCodigoSelecionado || '').trim()
    || document.querySelector('#dados-produto .produto-codigo')?.textContent?.trim()
    || ''
  );
}


function setPCPProdutoCodigo(codigo) {
  if (!codigo) return;

  // fonte de verdade do "código atual"
  window.pcpCodigoAtual = codigo;

  // atualiza cabeçalho/label
  const bar = document.querySelector('#pcp-code-bar');
  const slot =
    (bar && (bar.querySelector('.pcp-code-current') ||
             bar.querySelector('[data-role="pcp-code"]') ||
             bar.querySelector('.code'))) ||
    document.querySelector('#pcp-code');

  if (bar) bar.setAttribute('data-codigo', codigo);
  if (slot) slot.textContent = codigo;

  // NÃO chama ensure/fetch aqui
}

window.setPCPProdutoCodigo = setPCPProdutoCodigo;


// Busca a estrutura no SQL (rota: /api/pcp/estrutura)
// Envia pai_codigo no BODY para evitar 400 por parâmetro ausente.
// Mantém ?dbg=1 só para facilitar leitura de logs.
async function fetchEstruturaPCP_SQL(codigo) {
  const url = `${API_BASE}/api/pcp/estrutura?dbg=1`;
  const body = { pai_codigo: String(codigo || '').trim() };

  // Se houver um contexto de OP (versão/customização/OP), envia junto
  try {
    const ctx = window.pcpContext || {};
    console.log('[PCP][Fetch] window.pcpContext:', JSON.stringify(ctx));
    if (ctx && typeof ctx === 'object') {
      if (ctx.versao != null && String(ctx.versao).trim() !== '') {
        body.versao = String(ctx.versao).trim();
      }
      if (ctx.customizacao != null && String(ctx.customizacao).trim() !== '') {
        body.customizacao = String(ctx.customizacao).trim();
      }
      if (ctx.op != null && String(ctx.op).trim() !== '') {
        // também aceitamos como numero_referencia para o backend
        body.op = String(ctx.op).trim();
        body.numero_referencia = String(ctx.op).trim();
      }
    }
  } catch {}

  if (!body.pai_codigo) {
    throw new Error('Sem código do produto para carregar a estrutura (pai_codigo vazio).');
  }

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });

  const from = r.headers.get('X-From') || 'desconhecido';
  console.log('[PCP][Estrutura] Fonte da resposta:', from, 'URL:', url, 'BODY:', body);

  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error || j?.msg) msg = j.error || j.msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}



// ——— PCP: preencher Qtd Pro / Qtd Alm depois de desenhar a lista ———
// ——— PCP: preencher Qtd Pro / Qtd Alm depois de desenhar a lista ———
async function pcpPreencherSaldosDuplosLocal(ul) {
  // coleta todos os códigos renderizados
  const codigos = Array.from(ul.querySelectorAll('li:not(.header-row) .cod'))
    .map(el => (el.textContent || '').trim())
    .filter(Boolean);

  if (!codigos.length) return;

  const r = await fetch(`${API_BASE}/api/armazem/saldos_duplos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ codigos }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const j   = await r.json();
  const pro = j?.pro || {};
  const alm = j?.alm || {};

  // aplica nos elementos
  ul.querySelectorAll('li:not(.header-row)').forEach(li => {
    const cod      = (li.querySelector('.cod')?.textContent || '').trim();
    const qtdProEl = li.querySelector('.qtdpro');
    const qtdAlmEl = li.querySelector('.qtdalm');

    const vPro = Number(pro[cod] ?? 0);
    const vAlm = Number(alm[cod] ?? 0);

    if (qtdProEl) qtdProEl.textContent = vPro.toLocaleString('pt-BR');
    if (qtdAlmEl) qtdAlmEl.textContent = vAlm.toLocaleString('pt-BR');

    // feedback visual simples
    if (qtdProEl && vPro <= 0) qtdProEl.style.color = '#e44';
    if (qtdAlmEl && vAlm <= 0) qtdAlmEl.style.color = '#e44';
  });
}

// Detecta códigos com padrão de produto principal que possuem estrutura: "xx.PP.yy"
function pcpIsPP(code) {
  return /\.PP\./.test(String(code || '').toUpperCase());
}

/* PCP — renderiza a lista de peças da guia PCP e agora:
   - Lê o multiplicador do input #pcp-factor (antes estava #pcp-mult e não existia no HTML).
   - Salva a Qtd base de cada item em data-qtd-base.
   - Faz o recálculo da coluna "Qtd" em TEMPO REAL a cada digitação no #pcp-factor.
   - DESTACA em vermelho (classe .pcp-warn) quando Qtd > Arm Pro (coluna .qtdpro).
   - Preenche a descrição do ITEM PAI consultando o back-end:
       1º tenta por ID (?id=int_produto),
       2º se não achar/for inválido, tenta por CODE (?code=cod_produto).
   - Mantém a descrição dos itens trocados amarela (classe .desc-trocado), exceto o item pai.
   Observação: "Qtd prod" NÃO é multiplicada. */
async function renderPCPListaEstrutura(payload, codigo) {
  const ul   = document.getElementById('listaPecasPCPList');
  const bar  = document.getElementById('pcp-code-bar');
  const code = document.getElementById('pcp-code');
  const opInfo = (window.pcpContext && window.pcpContext.op) ? String(window.pcpContext.op) : '';
  if (!ul) return;
  // Atualiza campo OP na UI
  const opField = document.getElementById('pcp-op-num');
  if (opField) {
    if (opInfo) {
      opField.textContent = `OP: ${opInfo}`;
      opField.style.display = 'inline-block';
    } else {
      opField.textContent = '';
      opField.style.display = 'none';
    }
  }

  const codigoNorm = String(codigo ?? '').trim();

  if (!codigoNorm) {
    pcpUpdateListaVersaoBadge(null);
  } else {
    try {
      const meta = await pcpFetchEstruturaMetaByCod(codigoNorm);
      pcpUpdateListaVersaoBadge(meta?.versao ?? null);
    } catch (err) {
      console.warn('[PCP] Falha ao obter versão para Lista de peças:', err);
      pcpUpdateListaVersaoBadge(null);
    }
  }

  // ───────── helpers ─────────
  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const isPP = s => /\.PP\./i.test(String(s ?? '')); // “04.PP.N.51005” → true

  const parseQty = (v, def = 0) => {
    if (v === null || v === undefined || v === '') return def;
    if (typeof v === 'number') return Number.isFinite(v) ? v : def;
    let s = String(v).trim();
    const brMilharRegex = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;
    if (brMilharRegex.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  };
  const fmtQtdBR = (n) => {
    const val = Number(parseQty(n));
    const temDecimal = Math.abs(val % 1) > 1e-9;
    return val.toLocaleString('pt-BR', temDecimal ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : {});
  };
  const fmt = (n) => Number(parseQty(n)).toLocaleString('pt-BR');

  const toInputNumber = (val, precision = 6) => {
    const num = Number(parseQty(val, 0));
    if (!Number.isFinite(num)) return '0';
    const mul = Math.pow(10, precision);
    return String(Math.round(num * mul) / mul);
  };

  // garante barra e código visíveis
  if (bar) bar.style.display = 'flex';
  if (code) code.textContent = codigoNorm || '';

  // fonte canônica de itens
  const itens = Array.isArray(payload?.dados) ? payload.dados : [];

  // reset caches auxiliares de subitens PP
  pcpPPChildrenCache.clear();

  // limpa lista (preserva cabeçalho, se estiver dentro da UL)
  Array.from(ul.querySelectorAll('li:not(.header-row)')).forEach(li => li.remove());

  // multiplicador (aplica só na Qtd exibida; NÃO altera Qtd prod)
  let factor = parseQty(pcpGetFactorValue(), 1);
  if (!Number.isFinite(factor) || factor <= 0) factor = 1;
  pcpSetFactorValue(factor);

  // ===== ITEM PAI extraído do primeiro item (seu padrão atual) =====
  const parentInfo = itens[0] || null;
  const parentCodigo = parentInfo?.pai_codigo || codigoNorm || '';
  const parentDescRaw = parentInfo?.pai_descr_omie ?? parentInfo?.pai_descricao ?? '';
  const parentDesc   = String(parentDescRaw ?? '').trim();
  const parentUnidRaw= parentInfo?.pai_unid ?? parentInfo?.comp_unid ?? '';
  const parentUnid   = String(parentUnidRaw ?? '').trim();
  const parentIsPP   = isPP(parentCodigo);
  const parentProdId = parentInfo?.pai_id_omie ?? parentInfo?.pai_id ?? null;
  const parentDescDisplay = parentDesc ? esc(parentDesc) : '—';
  const parentDescTitle   = esc(parentDesc || '');
  const parentUnidDisplay = parentUnid ? esc(parentUnid) : '—';

  // [LOG][PCP][PAI] — depuração do que chegou do backend
  console.log('[PCP][PAI] ▶', {
    parentProdId,
    parentCodigo,
    parentDescRaw,
    parentDesc
  });

  // ===== RENDER DOS FILHOS =====
  const ppRows = [];
  const otherRows = [];

  // Detecta itens trocados (personalizados)
  const trocados = new Set();
  if (Array.isArray(payload?.dados)) {
    for (const it of payload.dados) {
      if (it._trocado === true || it._personalizado === true) {
        trocados.add(String(it.comp_codigo));
      }
    }
  }

  for (const it of itens) {
    const codStr  = String(it.comp_codigo ?? '');
    const pp      = isPP(codStr);
    const qtdBase = parseQty(it.comp_qtd, 0);
    const qtdFinal= qtdBase * factor;
    const qtdProd = parseQty(it.qtd_prod, 0); // já calculada no backend (para PP)

    const hintTemEstr =
      it.tem_estrutura ?? it.has_estrutura ?? it.has_child ?? it.tem_filhos ??
      (parseQty(it.comp_filhos ?? it.comp_itens ?? 0, 0) > 0 ? true : undefined);

    const li = document.createElement('li');
    li.className = 'data-row';
    // Se for trocado, destaca
    if (trocados.has(codStr)) {
      li.classList.add('pcp-trocado');
      // Preenche datasets com informações da troca
      if (it._codigo_original) {
        li.dataset.swapOriginalCod = it._codigo_original;
      }
      if (it._descricao_original) {
        li.dataset.swapOriginalDesc = it._descricao_original;
      }
    }
    li.dataset.codigo = codStr;
    li.dataset.qtdBase = String(qtdBase); // guarda a Qtd base para recálculo ao vivo
    if (hintTemEstr !== undefined) li.dataset.temEstrutura = hintTemEstr ? '1' : '0';
    // Armazena o Código OMIE (id_produto) no DOM para uso posterior
    if (it.id_produto !== null && it.id_produto !== undefined) {
      li.dataset.idOmie = String(it.id_produto);
    }

    const idOmieDisplay = it.id_produto ? `<small class="codigo-omie-display" style="display:block;color:#666;font-size:0.85em;">ID: ${esc(it.id_produto)}</small>` : '';

    const codContent = pp
      ? `<label class="pp-select-item">
          <input type="checkbox" class="pp-select-checkbox" data-cod="${esc(codStr)}" aria-label="Selecionar ${esc(codStr)}" checked>
          <span title="${esc(codStr)}">${esc(codStr)}</span>
          ${idOmieDisplay}
        </label>`
      : `<span title="${esc(codStr)}">${esc(codStr)}${idOmieDisplay}</span>`;

    const qtdCellContent = pp
      ? `<input type="number" class="pp-qtd-input" data-cod="${esc(codStr)}" value="${toInputNumber(qtdFinal)}" step="0.0001" min="0" aria-label="Quantidade para ${esc(codStr)}">`
      : fmtQtdBR(qtdFinal);

    const descClass = trocados.has(codStr) ? 'desc desc-trocado' : 'desc';
    li.innerHTML = `
      <div class="cod ${pp ? 'pp' : ''}">${codContent}</div>
      <div class="${descClass}" title="${esc(it.comp_descricao ?? '')}">${esc(it.comp_descricao ?? '')}</div>
      <div class="unid">${esc(it.comp_unid ?? '')}</div>

      <!-- Qtd da estrutura (formato igual à \"Estrutura de produto\") -->
      <div class="qtd${pp ? ' qtd-editable' : ''}">${qtdCellContent}</div>

      <!-- Qtd prod: vazia para não-PP -->
      <div class="qtdprod">${pp ? fmtQtdBR(qtdProd) : ''}</div>

      <!-- Estoques -->
      <div class="qtdpro">0</div>
      <div class="qtdalm">${fmt(parseQty(it.qtd_alm, 0))}</div>

      <div class="acao flex gap-2">
        <!-- Trocar (duas setas opostas) -->
        <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${esc(codStr)}" title="Trocar produto">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
          </svg>
        </button>

        <!-- Solicitar (carrinho) -->
        <button class="icon-btn status-button open" data-action="solicitar" data-cod="${esc(codStr)}" title="Solicitar">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 .001 4.001A2 2 0 0 0 17 18ZM3 4h2l1.6 8.2A3 3 0 0 0 9.55 15h7.9a3 3 0 0 0 2.95-2.4L22 7H6.21L5.7 4.8A2 2 0 0 0 3.76 3.5L3 3.5V4Z"/>
          </svg>
        </button>

        <!-- Produzir (fábrica) -->
        ${pp ? `
        <button class="icon-btn produce-btn" data-action="produzir" data-cod="${esc(codStr)}" title="Produzir">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
            <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
          </svg>
        </button>` : ''}

        <!-- Estrutura (sitemap) -->
        ${(hintTemEstr === true && pp) ? `
        <button class="icon-btn estrutura-btn" data-action="estrutura" data-cod="${esc(codStr)}" title="Estrutura do item">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M10 3h4v4h-4V3ZM4 17h4v4H4v-4Zm12 0h4v4h-4v-4ZM11 7v3H7a1 1 0 0 0-1 1v2h4v-2h4v2h4v-2a1 1 0 0 0-1-1h-4V7h-2Z"/>
          </svg>
        </button>` : ''}
      </div>
    `;

    // destacou se Qtd > Arm Pro
    const qtdCell   = li.querySelector('.qtd');
    const qtdInput  = qtdCell?.querySelector('.pp-qtd-input');
    const armProVal = parseQty(li.querySelector('.qtdpro')?.textContent, 0);
    if (pp) li.classList.add('pp-row');

    if (qtdCell) {
      if (pp && qtdInput) qtdInput.value = toInputNumber(qtdFinal);
      if (qtdFinal > armProVal) qtdCell.classList.add('pcp-warn');
      else                      qtdCell.classList.remove('pcp-warn');
    }

    if (pp) ppRows.push(li);
    else    otherRows.push(li);
  }

  // ===== LINHA DO PAI (vai no topo) =====
  const parentLi = document.createElement('li');
  parentLi.className = `data-row pcp-parent-row${parentIsPP ? ' pp' : ''}`;
  parentLi.dataset.qtdBase = '1';
  parentLi.dataset.codigo = String(parentCodigo);
  if (parentProdId !== null && parentProdId !== undefined) {
    parentLi.dataset.produtoId = String(parentProdId);
    parentLi.dataset.idOmie = String(parentProdId); // Código OMIE do PAI
  }
  const parentIdOmieDisplay = parentProdId ? `<small class="codigo-omie-display" style="display:block;color:#666;font-size:0.85em;">ID: ${esc(parentProdId)}</small>` : '';
  parentLi.innerHTML = `
    <div class="cod ${parentIsPP ? 'pp' : ''}">
      <label class="pp-select-item pcp-parent-select">
        <input type="checkbox" class="pp-select-checkbox pcp-parent-checkbox" data-cod="${esc(parentCodigo)}" aria-label="Selecionar ${esc(parentCodigo)}" checked>
        <span title="${esc(parentCodigo)}">${esc(parentCodigo)}</span>
        ${parentIdOmieDisplay}
        <span class="pcp-parent-id" data-produto-id="${esc(parentProdId ?? '')}" aria-hidden="true"></span>
      </label>
    </div>
    <div class="desc" title="${parentDescTitle}">${parentDescDisplay}</div>
    <div class="unid">${esc(parentUnidDisplay)}</div>
    <div class="qtd">
      <input id="pcp-factor" type="number" min="1" step="1" value="${factor}" class="pcp-parent-factor" aria-label="Quantidade do produto pai">
    </div>
    <div class="qtdprod">-</div>
    <div class="qtdpro">-</div>
    <div class="qtdalm">-</div>
    <div class="acao parent-actions">
      <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${esc(parentCodigo)}" title="Trocar produto">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
        </svg>
      </button>
      <button class="icon-btn produce-btn" data-action="produzir" data-cod="${esc(parentCodigo)}" title="${opInfo ? 'Atualizar OP' : 'Produzir itens selecionados'}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
          <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `;

  // insere o PAI antes de qualquer grupo
  ul.appendChild(parentLi);

  // [PCP][PAI][fallback] — se a descrição do pai ficou "—", consulta no SQL e atualiza a célula
  (async function ensurePaiDescricao() {
    try {
      const descCell = parentLi.querySelector('.desc');
      const txt = (descCell?.textContent || '').trim();
      const isEmpty = !txt || txt === '—';

      if (!isEmpty && (parentProdId ?? null) !== null) return;

      const idNum   = Number(parentProdId || 0);
      const codeStr = String(parentCodigo || '').trim();

      console.log('[PCP][PAI][fallback] ▶ verificação:', { txt, isEmpty, idNum, codeStr });

      const getJSON = async (url) => {
        const r = await fetch(url, { method: 'GET' });
        let j = null;
        try { j = await r.json(); } catch (e) { j = { ok:false, error:'json-parse', _e:String(e) }; }
        return { status: r.status, body: j };
      };

      let descr = null;

      // 1) tenta por ID
      if (Number.isFinite(idNum) && idNum > 0) {
        const urlId = `${API_BASE}/api/produto/descricao?id=${encodeURIComponent(idNum)}`;
        const { status, body } = await getJSON(urlId);
        console.log('[PCP][PAI][fallback] ◀ (id) status/body:', status, body);
        if (status === 200 && body?.ok && body?.descr_produto) {
          descr = body.descr_produto;
        }
      }

      // 2) se não achou por ID, tenta por CODE (cod_produto)
      if (!descr && codeStr) {
        const urlCode = `${API_BASE}/api/produto/descricao?code=${encodeURIComponent(codeStr)}`;
        const { status, body } = await getJSON(urlCode);
        console.log('[PCP][PAI][fallback] ◀ (code) status/body:', status, body);
        if (status === 200 && body?.ok && body?.descr_produto) {
          descr = body.descr_produto;
        }
      }

      if (descr) {
        descCell.textContent = descr;
        descCell.setAttribute('title', descr);
        console.log('[PCP][PAI][fallback] ✅ descrição aplicada:', descr);
      } else {
        console.warn('[PCP][PAI][fallback] ⚠ não foi possível resolver a descrição do pai por id/code.');
      }
    } catch (e) {
      console.warn('[PCP][PAI][fallback] ❌ erro inesperado:', e);
    }
  })();

  // ===== Agrupamento PP, divisores e binds =====
  if (ppRows.length) {
    const wrapLi = document.createElement('li');
    wrapLi.className = 'pcp-pp-group';
    wrapLi.innerHTML = `
      <div class="pcp-pp-card">
        <div class="pcp-pp-card-header">
          <label class="pcp-pp-master">
            <input type="checkbox" class="pcp-pp-master-checkbox" aria-label="Selecionar todos os itens PP">
            <span class="pcp-pp-card-title">Itens de preparação (PP)</span>
          </label>
          <div class="pcp-pp-card-actions">
            <span class="pcp-pp-card-count"></span>
            <button type="button" class="icon-btn produce-btn pcp-pp-card-produce" title="Produzir itens selecionados">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
                <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
        <ul class="pcp-pp-card-list"></ul>
      </div>
    `;
    const countEl = wrapLi.querySelector('.pcp-pp-card-count');
    if (countEl) {
      const plural = ppRows.length === 1 ? 'item' : 'itens';
      countEl.textContent = `${ppRows.length} ${plural}`;
    }
    const listEl = wrapLi.querySelector('.pcp-pp-card-list');
    if (listEl) ppRows.forEach(row => listEl.appendChild(row));
    ul.appendChild(wrapLi);
    if (listEl) {
      try { await pcpPopulatePPChildren(listEl); }
      catch (err) { console.warn('[PCP] falha ao carregar subitens PP:', err); }
    }

    const masterCb = wrapLi.querySelector('.pcp-pp-master-checkbox');
    if (masterCb && listEl) {
      const getItemCheckboxes = () => Array.from(listEl.querySelectorAll('.pp-select-checkbox'));
      const updateMasterState = () => {
        const boxes = getItemCheckboxes();
        if (!boxes.length) {
          masterCb.checked = false;
          masterCb.indeterminate = false;
          return;
        }
        const checkedCount = boxes.filter(cb => cb.checked).length;
        masterCb.checked = checkedCount === boxes.length;
        masterCb.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
      };

      masterCb.addEventListener('change', () => {
        const boxes = getItemCheckboxes();
        boxes.forEach(cb => { cb.checked = masterCb.checked; });
        masterCb.indeterminate = false;
        updateMasterState();
      });

      listEl.addEventListener('change', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains('pp-select-checkbox')) return;
        updateMasterState();
      });

      updateMasterState();
    }
  }

  if (ppRows.length && otherRows.length) {
    const divider = document.createElement('li');
    divider.className = 'pcp-section-divider';
    divider.innerHTML = '<span>Peças (demais itens)</span>';
    ul.appendChild(divider);
  }

  if (!ul.dataset.ppQtdBound) {
    ul.addEventListener('input', (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains('pp-qtd-input')) return;
      const li = target.closest('li.data-row.pp-row');
      if (!li) return;
      let f = pcpGetFactorValue();
      if (!Number.isFinite(f) || f <= 0) f = 1;
      const entered = parseQty(target.value || 0, 0);
      const base = f ? entered / f : entered;
      li.dataset.qtdBase = String(base);
      const armPro = parseQty(li.querySelector('.qtdpro')?.textContent, 0);
      const qtdCell = li.querySelector('.qtd');
      if (qtdCell) {
        if (entered > armPro) qtdCell.classList.add('pcp-warn');
        else                 qtdCell.classList.remove('pcp-warn');
      }
    });
    ul.dataset.ppQtdBound = '1';
  }

  if (otherRows.length) {
    const fragRest = document.createDocumentFragment();
    otherRows.forEach(row => fragRest.appendChild(row));
    ul.appendChild(fragRest);
  }

  // [PCP] Ordena a lista principal com PP no topo (código verde primeiro)
  try { pcpReordenarPorPP(ul); } catch (_) {}

  // [PCP] Bind do multiplicador de Qtd (input#pcp-factor) — recalcula "Qtd" ao digitar
  (function attachPCPFactorHandler(){
    const factorInput = document.getElementById('pcp-factor');
    if (!factorInput) return;
    factorInput.value = pcpGetFactorValue();

    if (window.__pcpFactorInput && window.__pcpFactorHandler) {
      window.__pcpFactorInput.removeEventListener('input', window.__pcpFactorHandler);
    }

    const handler = () => {
      let f = parseQty(factorInput.value || 1, 1);
      if (!Number.isFinite(f) || f <= 0) f = 1;
      pcpSetFactorValue(f, { syncInput: false });
      factorInput.value = f;

      const ulNode = document.getElementById('listaPecasPCPList');
      if (!ulNode) return;

      ulNode.querySelectorAll('li.data-row').forEach(li => {
        if (li.classList.contains('pcp-parent-row')) return;
        const base     = parseQty(li.dataset.qtdBase, 0);
        const qtdCell  = li.querySelector('.qtd');
        const qtdInput = qtdCell?.querySelector('input');
        const armPro   = parseQty(li.querySelector('.qtdpro')?.textContent, 0);
        const novoQtd  = base * f;
        if (qtdInput) {
          qtdInput.value = toInputNumber(novoQtd);
        } else if (qtdCell) {
          qtdCell.textContent = fmtQtdBR(novoQtd);
        }
        if (qtdCell) {
          if (novoQtd > armPro) qtdCell.classList.add('pcp-warn');
          else                  qtdCell.classList.remove('pcp-warn');
        }
      });
    };

    factorInput.addEventListener('input', handler);
    window.__pcpFactorInput = factorInput;
    window.__pcpFactorHandler = handler;
  })();

  // — delegate: botão "Trocar produto" (mantém seu fluxo; se o PAI foi trocado, pcpAplicarTrocaProduto deve reconstruir)
  if (!ul.dataset.pcpTrocaBound) {
    ul.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.trocar-btn, [data-action="trocar"]');
      if (!btn) return;

      const row = btn.closest('li.data-row, li.child-row');
      const cod = btn.dataset.cod || row?.querySelector('.cod')?.textContent?.trim();
      try { await pcpToggleTrocaProduto(row, cod); } // sua função já chama pcpAplicarTrocaProduto
      catch (e) { console.warn('[PCP] Falha no painel de troca:', e); }
    });
    ul.dataset.pcpTrocaBound = '1';
  }

  // Delegate do botão "Estrutura" (abre/fecha sub-estrutura)
  if (!ul.dataset.pcpEstruturaBound) {
    ul.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.estrutura-btn, [data-action="estrutura"]');
      if (!btn) return;
      const rowLi = btn.closest('li');
      const cod   = btn.dataset.cod || rowLi.querySelector('.cod')?.textContent?.trim();
      if (!cod) return;
      try { await pcpToggleSubEstrutura(rowLi, cod); }
      catch (e) { console.warn('[PCP] Falha ao abrir sub-estrutura:', e); }
    });
    ul.dataset.pcpEstruturaBound = '1';
  }

  if (!ul.dataset.pcpProduzirBound) {
    ul.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.produce-btn, [data-action="produzir"]');
      if (!btn) return;

      const rowLi = btn.closest('li');
      if (!rowLi) return;

      const isParent = rowLi.classList.contains('pcp-parent-row');
      const isPPItem = !isParent && (rowLi.classList.contains('pp-row') || rowLi.classList.contains('pp-subitem-row') || rowLi.querySelector('.pp-select-checkbox'));

      if (isParent) {
        ev.preventDefault();
        
        // Se houver contexto de OP, chama a função de atualização da OP
        const opInfo = (window.pcpContext && window.pcpContext.op) ? String(window.pcpContext.op) : '';
        if (opInfo) {
          try {
            await pcpAtualizarOP(rowLi, btn);
          } catch (err) {
            console.warn('[PCP] atualizar OP falhou:', err);
            alert('Erro ao atualizar OP: ' + (err.message || err));
          }
        } else {
          // Comportamento original: gerar etiqueta
          try {
            await pcpGerarEtiquetaPai(rowLi, btn);
          } catch (err) {
            console.warn('[PCP] gerar etiqueta pai falhou:', err);
          }
        }
      } else if (isPPItem) {
        ev.preventDefault();
        try {
          await pcpGerarEtiquetaPP(rowLi, btn);
        } catch (err) {
          console.warn('[PCP] gerar etiqueta PP falhou:', err);
        }
      }
    });
    ul.dataset.pcpProduzirBound = '1';
  }

  // Para linhas sem hint, decide via SQL e adiciona/remove botão Estrutura (ignora não-PP)
  try {
    await pcpDecorateEstruturaButtons(ul);
  } catch (e) {
    console.warn('[PCP] decorateEstruturaButtons falhou:', e);
  }

  // Preenche Qtd Pro / Qtd Alm a partir do SQL (inalterado)
  try {
    const filler = window.pcpPreencherSaldosDuplos || pcpPreencherSaldosDuplosLocal;
    await filler(ul);
  } catch (e) {
    console.warn('Falha ao preencher saldos (Qtd Pro / Qtd Alm):', e);
  }

  // Atualiza badges de versão/modificador
  (async () => {
    try {
      const codMeta = codigo || payload?.cod_produto || window.pcpCodigoAtual || null;
      if (!codMeta) return pcpUpdateVersaoBadges(null);
      const meta = await pcpFetchEstruturaMetaByCod(codMeta);
      pcpUpdateVersaoBadges(meta);
    } catch (e) {
      console.warn('Não foi possível atualizar badges de versão:', e);
      pcpUpdateVersaoBadges(null);
    }
  })();

  // Garante binds dos botões Incluir/Resetar sempre que a lista é renderizada
  try { pcpInitToolbar(); } catch (e) { console.warn('[PCP] pcpInitToolbar falhou:', e); }
}


// [PCP][Helper] Carrega a estrutura (view v2) a partir do código do produto PAI,
// replicando o comportamento da guia Comercial: POST /api/pcp/estrutura?view=v2
// Body: { pai_codigo: "<CODIGO>" }
// Retorna o JSON da API (esperado: { ok:true, origem:"view_v2", dados:[...] })
async function pcpCarregarEstruturaPorCodigo(codigoPai) {
  const url = `${API_BASE}/api/pcp/estrutura?view=v2`;
  const body = { pai_codigo: String(codigoPai || '').trim() };

  console.log('[PCP][Helper] ▶ POST estrutura (v2):', url, 'BODY:', body);

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); }
  catch { json = { ok:false, error:'json-parse', raw:text }; }

  console.log('[PCP][Helper] ◀ estrutura status:', r.status, 'json:', json);
  return json;
}



const pcpHasEstruturaCache = new Map();
const __isPP = s => /\.PP\./i.test(String(s ?? ''));

// Consulta rápida: reaproveita o loader SQL da PCP para saber se há filhos.
// Curto-circuito: códigos sem ".PP." retornam false imediatamente.
async function pcpHasEstrutura(codProduto) {
  if (!codProduto) return false;
  if (!__isPP(codProduto)) return false;

  if (pcpHasEstruturaCache.has(codProduto))
    return pcpHasEstruturaCache.get(codProduto);

  let has = false;
  try {
    const payload = await fetchEstruturaPCP_SQL(codProduto);
    const dados = Array.isArray(payload?.dados) ? payload.dados : [];
    has = dados.length > 0;
  } catch (e) {
    console.warn('[PCP] pcpHasEstrutura falhou:', e);
  }
  pcpHasEstruturaCache.set(codProduto, has);
  return has;
}

const pcpPPChildrenCache = new Map();

async function pcpFetchPPChildren(codProduto) {
  const codigo = String(codProduto || '').trim();
  if (!pcpIsPP(codigo)) return [];
  if (pcpPPChildrenCache.has(codigo)) return pcpPPChildrenCache.get(codigo);

  let filhos = [];
  try {
    const payload = await fetchEstruturaPCP_SQL(codigo);
    const dados = Array.isArray(payload?.dados) ? payload.dados : [];
    filhos = dados
      .filter(item => pcpIsPP(item?.comp_codigo))
      .map(item => ({
        codigo: String(item?.comp_codigo || '').trim(),
        descricao: String(item?.comp_descricao || '').trim(),
        unid: String(item?.comp_unid || '').trim(),
        qtd: Number(item?.comp_qtd ?? 0) || 0,
        qtdProd: Number(item?.qtd_prod ?? item?.qtdProd ?? 0) || 0
      }));
  } catch (e) {
    console.warn('[PCP] pcpFetchPPChildren falhou:', e);
  }

  pcpPPChildrenCache.set(codigo, filhos);
  return filhos;
}

async function pcpPopulatePPChildren(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll('li.pp-subitem-row').forEach(el => el.remove());

  const esc = (s) => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const parseQtd = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const str = String(v).trim().replace(/\./g, '').replace(',', '.');
    const n = Number(str);
    return Number.isFinite(n) ? n : 0;
  };
  const fmtQtd = (n) => {
    const val = parseQtd(n);
    const hasDecimal = Math.abs(val % 1) > 1e-9;
    return val.toLocaleString('pt-BR', hasDecimal ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : undefined);
  };
  const toInputNumber = (val) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return '0';
    return String(Math.round(num * 1_000_000) / 1_000_000);
  };

  const rows = Array.from(listEl.querySelectorAll('li.data-row'));
  for (const row of rows) {
    const codigo =
      row.dataset.codigo ||
      row.querySelector('.pp-select-checkbox')?.getAttribute('data-cod') ||
      row.querySelector('.cod')?.textContent ||
      '';
    const code = String(codigo || '').trim();
    if (!pcpIsPP(code)) continue;

    const filhos = await pcpFetchPPChildren(code);
    if (!filhos.length) continue;

    const frag = document.createDocumentFragment();
    const factor = pcpGetFactorValue();
    const fator = (!Number.isFinite(factor) || factor <= 0) ? 1 : factor;

  for (const filho of filhos) {
      const baseQtd = parseQtd(filho.qtd);
      const qtdFinal = baseQtd * fator;
      const qtdProdFmt = filho.qtdProd ? fmtQtd(filho.qtdProd) : '';
      const codEsc = esc(filho.codigo);
      const descEsc = esc(filho.descricao);
      const unidEsc = esc(filho.unid || '');

      const li = document.createElement('li');
      li.className = 'data-row pp-row pp-subitem-row';
      li.dataset.parentCodigo = code;
      li.dataset.codigo = filho.codigo;
      li.dataset.qtdBase = String(baseQtd);
      li.dataset.temEstrutura = '0';
      li.innerHTML = `
        <div class="cod pp">
          <label class="pp-select-item">
            <input type="checkbox" class="pp-select-checkbox" data-cod="${codEsc}" aria-label="Selecionar ${codEsc}" checked>
            <span title="${codEsc}">${codEsc}</span>
          </label>
        </div>
        <div class="desc" title="${descEsc}">${descEsc || '—'}</div>
        <div class="unid">${unidEsc || '—'}</div>
        <div class="qtd qtd-editable">
          <input type="number" class="pp-qtd-input" data-cod="${codEsc}" value="${toInputNumber(qtdFinal)}" step="0.0001" min="0" aria-label="Quantidade para ${codEsc}">
        </div>
        <div class="qtdprod">${qtdProdFmt}</div>
        <div class="qtdpro">0</div>
        <div class="qtdalm">0</div>
        <div class="acao flex gap-2">
          <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${codEsc}" title="Trocar produto">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
            </svg>
          </button>
          <button class="icon-btn status-button open" data-action="solicitar" data-cod="${codEsc}" title="Solicitar">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 .001 4.001A2 2 0 0 0 17 18ZM3 4h2l1.6 8.2A3 3 0 0 0 9.55 15h7.9a3 3 0 0 0 2.95-2.4L22 7H6.21L5.7 4.8A2 2 0 0 0 3.76 3.5L3 3.5V4Z"/>
            </svg>
          </button>
          <button class="icon-btn produce-btn" data-action="produzir" data-cod="${codEsc}" title="Produzir itens selecionados">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
              <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
            </svg>
          </button>
        </div>
      `;
      frag.appendChild(li);
    }
    row.after(frag);

    const currentRows = Array.from(listEl.querySelectorAll('.pp-subitem-row')).filter(child => child.dataset.parentCodigo === code);

    try {
      await Promise.all(currentRows.map(r => pcpAtualizarColunasDinamicas(r)));
    } catch (e) {
      console.warn('[PCP] falha ao atualizar métricas dos subitens PP:', e);
    }
  }

  try { await pcpDecorateEstruturaButtons(listEl); } catch (e) { console.warn('[PCP] decorate (PP filhos) falhou:', e); }
  try {
    const filler = window.pcpPreencherSaldosDuplos || pcpPreencherSaldosDuplosLocal;
    await filler(listEl);
  } catch (e) {
    console.warn('[PCP] preencher saldos (PP filhos) falhou:', e);
  }
}

async function pcpDecorateEstruturaButtons(ul) {
  const rows = Array.from(ul.querySelectorAll('li.data-row'));
  const jobs = [];

  for (const li of rows) {
    const code = li.querySelector('.cod')?.textContent?.trim();
    if (!code) continue;

    // Sem ".PP." → nunca tem estrutura: remova botão se existir
    if (!__isPP(code)) { removeEstruturaButton(li); continue; }

    const hint = li.dataset.temEstrutura;
    if (hint === '1') { ensureEstruturaButton(li, code); continue; }
    if (hint === '0') { removeEstruturaButton(li);  continue; }

    jobs.push((async () => {
      const has = await pcpHasEstrutura(code);
      if (has) ensureEstruturaButton(li, code);
      else     removeEstruturaButton(li);
    })());
  }

  await Promise.allSettled(jobs);
}


function ensureEstruturaButton(li, code) {
  if (li.querySelector('.estrutura-btn')) return;
  const acao = li.querySelector('.acao');
  if (!acao) return;

  const btn = document.createElement('button');
  btn.className = 'icon-btn estrutura-btn';
  btn.dataset.action = 'estrutura';
  btn.dataset.cod = code;
  btn.title = 'Estrutura do item';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M6 3h12v4H6zM12 7v4M4 13h8v4H4zM12 13h8v4h-8z" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  acao.appendChild(btn);
}

function removeEstruturaButton(li) {
  li.querySelector('.estrutura-btn')?.remove();
}
// PCP — abre/fecha a sub-estrutura logo abaixo da linha clicada.
// Agora com CABEÇALHO e colunas: Cod | Desc | Unid | Qtd | Qtd prod | Qtd Pro | Qtd Alm | Ação
// Regras:
//   - Qtd prod (sub) = '' para não-PP (sem OP abertas para o próprio código).
//   - Botões "Solicitar", "Produzir"(só PP) e "Trocar" em cada item.
//   - Botão "Estrutura" injetado depois via pcpDecorateEstruturaButtonsSub (só PP com filhos).
async function pcpToggleSubEstrutura(rowLi, codProduto) {
  const next = rowLi.nextElementSibling;
  if (next && next.classList.contains('pcp-subestrutura')) { next.remove(); return; }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
  const isPP = s => /\.PP\./i.test(String(s ?? ''));
  const parseQty = (v, def = 0) => {
    if (v === null || v === undefined || v === '') return def;
    if (typeof v === 'number') return Number.isFinite(v) ? v : def;
    let s = String(v).trim();
    const brMilharRegex = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;
    if (brMilharRegex.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  };
  const fmtQtdBR = (n) => {
    const val = Number(parseQty(n));
    const temDecimal = Math.abs(val % 1) > 1e-9;
    return val.toLocaleString('pt-BR', temDecimal ? { 
      minimumFractionDigits: 0, maximumFractionDigits: 3 
    } : { maximumFractionDigits: 0 });
  };

  // carrega a estrutura do componente (via SQL)
  let payload;
  try { payload = await fetchEstruturaPCP_SQL(codProduto); }
  catch (e) {
    console.warn('[PCP] falha ao buscar sub-estrutura:', e);
    return;
  }
  const dados = Array.isArray(payload?.dados) ? payload.dados : [];

  const wrap = document.createElement('li');
  wrap.className = 'pcp-subestrutura';
  wrap.innerHTML = `
    <div class="sub-wrap">
      <div class="sub-title">Estrutura de ${esc(codProduto)}</div>
      <ul class="sub-grid">
        <!-- Cabeçalho da sub-estrutura: herda o mesmo grid do cabeçalho principal -->
        <li class="sub-header header-row">
          <div class="cod">Código</div>
          <div class="desc">Descrição</div>
          <div class="unid">Unid</div>
          <div class="hdr-qtd">Qtd</div>
          <div class="hdr-qtdprod">Qtd prod</div>
          <div class="hdr-qtdpro">Arm Pro</div>
          <div class="hdr-qtdalm">Arm Alm</div>
          <div class="acao">Ação</div>
        </li>

        ${dados.map(it => {
          const cod   = String(it.comp_codigo ?? '');
          const pp    = isPP(cod);
          const desc  = String(it.comp_descricao ?? '');
          const unid  = String(it.comp_unid ?? 'UN');
          const q     = parseQty(it.comp_qtd, 0);
          const qtdProdSub = pp ? 0 : ''; // não-PP → vazio

          const produzirBtn = pp ? `
            <button class="icon-btn produce-btn" data-action="produzir" data-cod="${esc(cod)}" title="Produzir">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
                <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
              </svg>
            </button>` : '';

          const trocarBtn = `
            <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${esc(cod)}" title="Trocar produto">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
              </svg>
            </button>`;

          return `
            <!-- Linhas da sub-estrutura: usam o MESMO grid da lista principal -->
            <li class="child-row data-row" data-cod="${esc(cod)}">
              <div class="cod ${pp ? 'pp' : ''}">${esc(cod)}</div>
              <div class="desc" title="${desc}">${desc}</div>
              <div class="unid">${unid}</div>
              <div class="qtd">${fmtQtdBR(q)}</div>
              <div class="qtdprod">${pp ? fmtQtdBR(qtdProdSub) : ''}</div>
              <div class="qtdpro">0</div>
              <div class="qtdalm">0</div>
              <div class="acao">
                <!-- Trocar (duas setas opostas) -->
                ${trocarBtn}

                <!-- Solicitar (carrinho) -->
                <button class="icon-btn status-button open" data-action="solicitar" data-cod="${esc(cod)}" title="Solicitar">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 4h2l1.6 8.2A3 3 0 0 0 9.55 15h7.9a3 3 0 0 0 2.95-2.4L22 7H6.21L5.7 4.8A2 2 0 0 0 3.76 3.5L3 3.5V4Z"/>
                  </svg>
                </button>

                <!-- Produzir (fábrica) -->
                ${produzirBtn}

                <!-- Botão Estrutura é injetado depois se tiver filhos -->
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `;
  rowLi.after(wrap);

  
  // Preenche Qtd Pro / Qtd Alm e injeta "Estrutura" condicional nos itens PP que têm filhos
  try {
    const filler = window.pcpPreencherSaldosDuplos || pcpPreencherSaldosDuplosLocal;
    const subUl = wrap.querySelector('ul.sub-grid');
    pcpReordenarPorPPSub(subUl);
    await filler(subUl);
    await pcpDecorateEstruturaButtonsSub(subUl);
  } catch (e) {
    console.warn('[PCP] Falha ao preencher/decoração na sub-estrutura:', e);
  }
}


// Debounce simples (aguarda digitação parar por ms antes de buscar)
function debounceMS(fn, ms=250) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// util único para escapar HTML (evita conflito de nomes neste módulo)
const htmlEsc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );

// [UI] Lê o usuário logado exibido no header
function getLoggedUserName() {
  const el = document.getElementById('userNameDisplay');
  if (!el) return 'sistema';
  const v = (el.textContent || el.innerText || '').trim();
  return v || 'sistema';
}

function pcpCollectCustomizacoes({ scopeRow = null } = {}) {
  const list = document.getElementById('listaPecasPCPList');
  if (!list) return [];

  let rows = [];
  if (scopeRow instanceof Element) {
    const set = new Set();
    set.add(scopeRow);
    const scopeCodigo =
      scopeRow.dataset.codigo ||
      scopeRow.querySelector('.pp-select-checkbox')?.dataset.cod ||
      scopeRow.querySelector('.cod span')?.textContent ||
      scopeRow.querySelector('.cod')?.textContent ||
      '';
    const scopeCode = String(scopeCodigo || '').trim();
    if (scopeCode) {
      list.querySelectorAll(`.pp-subitem-row[data-parent-codigo="${scopeCode}"]`).forEach(el => set.add(el));
    }
    rows = Array.from(set);
  } else {
    rows = Array.from(list.querySelectorAll('li.data-row, li.pp-subitem-row'));
  }

  const seen = new Set();
  const customizacoes = [];
  for (const row of rows) {
    const original = String(row.dataset.swapOriginalCod || '').trim();
    if (!original) continue;

    let codigoAtual =
      row.dataset.codigo ||
      row.querySelector('.pp-select-checkbox')?.dataset.cod ||
      row.querySelector('.cod span')?.textContent ||
      row.querySelector('.cod')?.textContent ||
      '';
    codigoAtual = String(codigoAtual || '').trim();
    if (!codigoAtual || codigoAtual === original) continue;

    const tipo = row.classList.contains('pcp-parent-row')
      ? 'pai'
      : row.classList.contains('pp-subitem-row')
        ? 'pp-subitem'
        : row.classList.contains('pp-row')
          ? 'pp'
          : 'peca';

    const grupo = row.classList.contains('pp-row') || row.classList.contains('pp-subitem-row')
      ? 'pp'
      : (tipo === 'pai' ? 'pai' : 'pecas');

    const key = `${original}=>${codigoAtual}::${tipo}::${row.dataset.parentCodigo || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let quantidade = null;
    const qtdInput = row.querySelector('.pp-qtd-input');
    if (qtdInput) {
      const parsed = Number(String(qtdInput.value ?? '').replace(',', '.'));
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    } else if (row.dataset.qtdBase) {
      const parsed = Number(row.dataset.qtdBase);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    } else {
      const qtdText = (row.querySelector('.qtd')?.textContent || '')
        .trim()
        .replace(/\./g, '')
        .replace(',', '.');
      const parsed = Number(qtdText);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    }

    customizacoes.push({
      tipo,
      grupo,
      codigo_original: original,
      codigo_novo: codigoAtual,
      descricao_original: String(row.dataset.swapOriginalDesc || '').trim() || null,
      descricao_nova: (row.querySelector('.desc')?.textContent || '').trim() || null,
      parent_codigo: row.dataset.parentCodigo || null,
      quantidade: quantidade != null && Number.isFinite(quantidade) ? quantidade : null
    });
  }

  return customizacoes;
}

async function pcpGerarEtiquetaPai(rowLi, btn) {
  if (!rowLi || !btn) return;

  const codigo =
    rowLi.dataset.codigo ||
    rowLi.querySelector('.pp-select-checkbox')?.dataset.cod ||
    (rowLi.querySelector('.cod span')?.textContent || '').trim() ||
    (rowLi.querySelector('.cod')?.textContent || '').trim();

  if (!codigo) {
    alert('Não foi possível identificar o código do produto pai.');
    return;
  }

  // Lê o Código OMIE do PAI do DOM
  const codigoProdutoId = rowLi.dataset.idOmie ? Number(rowLi.dataset.idOmie) : null;

  let quantidadePai = 1;
  const factorInput = document.getElementById('pcp-factor');
  if (factorInput) {
    const raw = Number(String(factorInput.value ?? '').replace(',', '.'));
    if (Number.isFinite(raw) && raw > 0) quantidadePai = Math.max(1, Math.round(raw));
  }

  const itensPP = [];
  const ppCheckboxes = document.querySelectorAll('#listaPecasPCPList .pcp-pp-card-list .pp-select-checkbox');
  ppCheckboxes.forEach((cb) => {
    if (!(cb instanceof HTMLInputElement) || !cb.checked) return;
    const li = cb.closest('li');
    const cod = cb.dataset.cod || li?.dataset.codigo || '';
    const desc = (li?.querySelector('.desc')?.textContent || '').trim();
    // Lê o Código OMIE de cada item PP do DOM
    const itemIdOmie = li?.dataset.idOmie ? Number(li.dataset.idOmie) : null;
    const qtdInput = li?.querySelector('.pp-qtd-input');
    let quantidade = null;
    if (qtdInput) {
      const raw = String(qtdInput.value ?? '').replace(',', '.');
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = Math.max(1, Math.round(parsed));
    } else {
      const qtdCell = li?.querySelector('.qtd');
      const txt = (qtdCell?.textContent || '').trim().replace(/\./g, '').replace(',', '.');
      const parsed = Number(txt);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = Math.max(1, Math.round(parsed));
    }
    if (!cod) return;
    itensPP.push({ codigo: cod, descricao: desc, quantidade, codigo_produto_id: itemIdOmie });
  });

  const obsInput = document.getElementById('pcp-obs');
  const observacoes = obsInput ? obsInput.value.trim() : '';
  const usuario = getLoggedUserName();
  let versaoEstrutura = null;
  const versaoEl = document.getElementById('pcpListaVersaoValue');
  if (versaoEl) {
    const txt = (versaoEl.textContent || '').trim();
    const numero = Number(txt.replace(/[^\d]/g, ''));
    if (Number.isFinite(numero) && numero > 0) versaoEstrutura = Math.max(1, Math.round(numero));
  }

  const payload = {
    codigo_produto: codigo,
    codigo_produto_id: codigoProdutoId,
    usuario_criacao: usuario,
    observacoes,
    itens_pp: itensPP,
    quantidade_pai: quantidadePai,
    versao_estrutura: versaoEstrutura
  };
  payload.customizacoes = pcpCollectCustomizacoes();

  const prevDisabled = btn.disabled;
  btn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/api/pcp/etiquetas/pai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    let data = null;
    try { data = await resp.json(); }
    catch { data = null; }

    if (!resp.ok || !data?.ok) {
      const msg = data?.error || `Falha ao gerar etiqueta (HTTP ${resp.status})`;
      throw new Error(msg);
    }

    const opRegistros = Array.isArray(data.op_registros) ? data.op_registros : [];
    const ppGeradas = Array.isArray(data.itens_pp) ? data.itens_pp : [];

    let mensagem = '';
    if (opRegistros.length) {
      const versaoLabel = data.versao ? ` v${data.versao}` : '';
      mensagem += `Etiquetas OP geradas${versaoLabel} (${opRegistros.length}):\n`;
      mensagem += opRegistros.map((op, idx) => `${idx + 1}. ${op.numero_op || '—'}`).join('\n');
    } else {
      mensagem += 'Nenhuma etiqueta OP gerada.';
    }

    if (ppGeradas.length) {
      const linhasPP = ppGeradas.map(pp => {
        const registros = Array.isArray(pp.registros) ? pp.registros : [];
        const linhasRegs = registros.map((r, idx) => `    ${idx + 1}. ${r.numero_op || '—'}`).join('\n');
        const versaoLabel = pp.versao ? ` v${pp.versao}` : '';
        return `${pp.codigo || '—'} (${pp.quantidade || registros.length}${versaoLabel}):\n${linhasRegs}`;
      }).join('\n');
      mensagem += `\n\nEtiquetas OPS:\n${linhasPP}`;
    }
    if (data.personalizacao_id) {
      mensagem += `\n\nCustomização: C${data.personalizacao_id}`;
    }
    alert(mensagem);
  } catch (err) {
    console.error('[PCP] gerar etiqueta pai falhou:', err);
    alert(`Erro ao gerar etiqueta: ${err?.message || err}`);
  } finally {
    btn.disabled = prevDisabled;
  }
}

async function pcpGerarEtiquetaPP(rowLi, btn) {
  if (!rowLi || !btn) return;

  const checkbox = rowLi.querySelector('.pp-select-checkbox');
  const codigo =
    rowLi.dataset.codigo ||
    (checkbox ? checkbox.dataset.cod : '') ||
    (rowLi.querySelector('.cod span')?.textContent || '').trim() ||
    (rowLi.querySelector('.cod')?.textContent || '').trim();

  if (!codigo) {
    alert('Não foi possível identificar o código do item PP.');
    return;
  }

  // Lê o Código OMIE do DOM
  const codigoProdutoId = rowLi.dataset.idOmie ? Number(rowLi.dataset.idOmie) : null;

  const desc = (rowLi.querySelector('.desc')?.textContent || '').trim();
  const qtdInput = rowLi.querySelector('.pp-qtd-input');
  let quantidade = 1;
  if (qtdInput) {
    const raw = Number(String(qtdInput.value ?? '').replace(',', '.'));
    if (Number.isFinite(raw) && raw > 0) quantidade = Math.max(1, Math.round(raw));
  } else {
    const qtdCell = rowLi.querySelector('.qtd');
    const txt = (qtdCell?.textContent || '').trim().replace(/\./g, '').replace(',', '.');
    const raw = Number(txt);
    if (Number.isFinite(raw) && raw > 0) quantidade = Math.max(1, Math.round(raw));
  }

  const obsInput = document.getElementById('pcp-obs');
  const observacoes = obsInput ? obsInput.value.trim() : '';
  const usuario = getLoggedUserName();

  const payload = {
    codigo_produto: codigo,
    codigo_produto_id: codigoProdutoId,
    quantidade,
    descricao: desc,
    usuario_criacao: usuario,
    observacoes
  };
  payload.customizacoes = pcpCollectCustomizacoes({ scopeRow: rowLi });

  const prevDisabled = btn.disabled;
  btn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/api/pcp/etiquetas/pp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    let data = null;
    try { data = await resp.json(); }
    catch { data = null; }

    if (!resp.ok || !data?.ok) {
      const msg = data?.error || `Falha ao gerar etiqueta (HTTP ${resp.status})`;
      throw new Error(msg);
    }

    const registros = Array.isArray(data.registros) ? data.registros : [];
    const linhas = registros.map((r, idx) => `${idx + 1}. ${r.numero_op || '—'}`).join('\n');
    const versaoLabel = data.versao ? ` (v${data.versao})` : '';
    const mensagem = [
      `Etiquetas OPS geradas para ${codigo}${versaoLabel}: ${registros.length}`,
      linhas
    ].filter(Boolean).join('\n');
    const mensagemFinal = data.personalizacao_id
      ? `${mensagem}\n\nCustomização: C${data.personalizacao_id}`
      : mensagem;
    alert(mensagemFinal);
  } catch (err) {
    console.error('[PCP] gerar etiqueta PP falhou:', err);
    alert(`Erro ao gerar etiqueta: ${err?.message || err}`);
  } finally {
    btn.disabled = prevDisabled;
  }
}

// [UI] Atualiza os badges Versão/Modificador na barra de título
function pcpUpdateVersaoBadges(meta) {
  const vEl = document.getElementById('estruturaVersaoValue');
  const mEl = document.getElementById('estruturaModValue');
  const versao = (meta && typeof meta.versao !== 'undefined' && meta.versao !== null)
    ? String(meta.versao)
    : '—';
  const mod    = (meta && meta.modificador && String(meta.modificador).trim())
    ? String(meta.modificador).trim()
    : '—';
  if (vEl) vEl.textContent = versao;
  if (mEl) mEl.textContent = mod;
}

function pcpUpdateListaVersaoBadge(versao) {
  const vEl = document.getElementById('pcpListaVersaoValue');
  if (!vEl) return;
  const txt = (versao !== null && versao !== undefined && String(versao).trim())
    ? String(versao).trim()
    : '—';
  vEl.textContent = txt;
}


// [API] Busca meta (versão/modificador) por código do produto.
// - Usa ?cod= para aceitar aliases no servidor.
// - 'credentials: include' garante que o cookie de sessão viaje junto (mesmo em subdomínios).
async function pcpFetchEstruturaMetaByCod(cod) {
  const base = (window.API_BASE || API_BASE || window.location.origin);
  const url  = `${base}/api/estrutura/meta?cod=${encodeURIComponent(String(cod||'').trim())}`.replace(/([^:]\/)(\/)+/g,'$1');
  const res  = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Falha ao buscar meta: HTTP ${res.status}`);
  const j = await res.json();
  // Se 'versao' vier null em bases antigas → trata como 1
  return {
    id: j.id,
    cod_produto: j.cod_produto,
    versao: (j.versao ?? 1),
    modificador: j.modificador || null,
    local_producao: j.local_producao ?? j["local_produção"] ?? null
  };
}


// [PCP] Reordena a UL da lista PRINCIPAL colocando PP primeiro.
// Mantém cabeçalho e carrega junto a sub-estrutura aberta (se houver) para não “descolar” do pai.
function pcpReordenarPorPP(ul) {
  if (!ul) return;

  const kids = Array.from(ul.children);
  const used = new Set();
  const pairs = [];

  for (let i = 0; i < kids.length; i++) {
    const li = kids[i];
    if (used.has(li)) continue;
    if (!li.classList || !li.classList.contains('data-row')) continue; // ignora header/painéis
    if (li.classList.contains('pp-subitem-row')) continue; // mantém subitens presos ao pai
    if (li.classList.contains('pcp-parent-row')) continue;

    const codTxt = (li.querySelector('.cod')?.textContent || '').trim();

    // sub-estrutura grudada ao pai
    const sib = li.nextElementSibling;
    const sub = (sib && sib.classList?.contains('pcp-subestrutura')) ? sib : null;
    if (sub) used.add(sub);

    const subitems = [];
    let follower = sub ? sub.nextElementSibling : li.nextElementSibling;
    while (follower && follower.classList?.contains('pp-subitem-row')) {
      subitems.push(follower);
      used.add(follower);
      follower = follower.nextElementSibling;
    }

    pairs.push({ li, sub, subitems, isPP: pcpIsPP(codTxt) });
  }

  if (!pairs.length) return;

  const ppFirst  = pairs.filter(p => p.isPP);
  const restNext = pairs.filter(p => !p.isPP);

  // mover em nova ordem (append move o nó, preserva listeners)
  for (const group of [ppFirst, restNext]) {
    for (const p of group) {
      ul.appendChild(p.li);
      if (Array.isArray(p.subitems)) {
    for (const child of p.subitems) {
      ul.appendChild(child);
    }
  }
      if (p.sub) ul.appendChild(p.sub);
    }
  }
}

// [PCP] Reordena a UL da sub-estrutura (grid interno) colocando PP primeiro.
// Mantém o header (.header-row) no topo.
function pcpReordenarPorPPSub(subUl) {
  if (!subUl) return;
  const rows = Array.from(subUl.querySelectorAll('li.data-row'));
  if (!rows.length) return;

  const pp  = [];
  const non = [];
  for (const li of rows) {
    const codTxt = (li.querySelector('.cod')?.textContent || '').trim();
    (pcpIsPP(codTxt) ? pp : non).push(li);
  }
  for (const li of [...pp, ...non]) {
    subUl.appendChild(li); // header fica onde está
  }
}

// [PCP] Abre/fecha o painel de TROCA logo abaixo da linha clicada.
// O clique em um resultado altera SOMENTE a UI (DOM) da linha, sem persistir em SQL.
async function pcpToggleTrocaProduto(rowLi, codAtual) {
  if (!rowLi) return;

  // toggle no mesmo item
  const next = rowLi.nextElementSibling;
  if (next && next.classList.contains('pcp-troca')) { next.remove(); return; }

  // fecha outros paineis abertos
  rowLi.parentElement?.querySelectorAll('li.pcp-troca').forEach(el => el.remove());

  // cria painel sem estilos inline de cor/fundo (isso vai para o CSS)
  const wrap = document.createElement('li');
  wrap.className = 'pcp-troca';
  wrap.innerHTML = `
    <div class="troca-wrap">
      <div class="troca-title">
        Trocar produto para a linha <strong>${htmlEsc(codAtual ?? '')}</strong>
      </div>
      <div class="troca-input-row">
        <input type="text" class="troca-input" placeholder="Digite código ou descrição (mín. 2 caracteres)" aria-label="Buscar produto">
      </div>
      <ul class="troca-results" role="listbox" aria-label="Resultados da busca"></ul>
    </div>
  `;
  rowLi.after(wrap);

  const input   = wrap.querySelector('.troca-input');
  const results = wrap.querySelector('.troca-results');

  const useEstruturaSource = rowLi.classList.contains('pcp-parent-row') || rowLi.classList.contains('pp-row');
  const searchFn = useEstruturaSource ? fetchPesquisarProdutosEstrutura : fetchPesquisarProdutos_SQL;

  // Debounce da busca
  const runSearch = debounceMS(async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }

    results.innerHTML = '<li class="info">Buscando…</li>';
    try {
      const itens = await searchFn(q); // [{codigo, descricao}]
      if (!Array.isArray(itens) || itens.length === 0) {
        results.innerHTML = '<li class="info">Nenhum resultado</li>';
        return;
      }
      results.innerHTML = itens.slice(0, 50).map(it => {
        const cod  = htmlEsc(it.codigo ?? '');
        const desc = htmlEsc(it.descricao ?? '');
        return `
          <li class="troca-item" data-codigo="${cod}" data-descricao="${desc}" role="option" tabindex="0">
            <div class="cod ${/\.PP\./i.test(cod) ? 'pp' : ''}">${cod}</div>
            <div class="desc" title="${desc}">${desc}</div>
          </li>
        `;
      }).join('');
    } catch (e) {
      console.warn('[PCP] busca troca falhou:', e);
      results.innerHTML = '<li class="error">Erro na busca</li>';
    }
  }, 300);

  input.addEventListener('input', runSearch);

  // clique no resultado -> troca apenas na UI
  results.addEventListener('click', async (ev) => {
    const li = ev.target.closest('.troca-item');
    if (!li) return;

    const novoCod  = li.getAttribute('data-codigo') || '';
    const novaDesc = li.getAttribute('data-descricao') || '';
    try {
      await pcpAplicarTrocaProduto(rowLi, { codigo: novoCod, descricao: novaDesc });
    } catch (e) {
      console.warn('[PCP] pcpAplicarTrocaProduto falhou:', e);
    }
    wrap.remove();
  });

  // Enter também seleciona
  results.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const li = ev.target.closest('.troca-item');
      if (li) li.click();
    }
  });

  input.focus();
}

 
/* [PCP] Aplica a troca de UM item na UI (sem persistir). 
   ATENÇÃO: se a linha trocada for o **ITEM PAI**, 
   atualiza o código canônico (#pcp-code) e RECONSTRÓI toda a PCP,
   assim como na navegação pela Comercial. */
async function pcpAplicarTrocaProduto(rowLi, novo) {
  if (!rowLi || !novo) return;

  const codDiv  = rowLi.querySelector('.cod');
  const descDiv = rowLi.querySelector('.desc');
  if (!codDiv || !descDiv) return;

  const codAntigo  = (codDiv.textContent || '').trim();
  const descAntiga = (descDiv.textContent || '').trim();

  // Guarda originais uma vez
  if (!rowLi.dataset.swapOriginalCod)  rowLi.dataset.swapOriginalCod  = codAntigo;
  if (!rowLi.dataset.swapOriginalDesc) rowLi.dataset.swapOriginalDesc = descAntiga;

  const novoCod  = (novo.codigo || '').trim();
  const novaDesc = (novo.descricao || '').trim();

  const existingCheckbox = rowLi.querySelector('.pp-select-checkbox');
  const wasChecked = existingCheckbox ? existingCheckbox.checked : null;

  try {
    pcpHasEstruturaCache.delete(codAntigo);
    pcpHasEstruturaCache.delete(novoCod);
    pcpPPChildrenCache.delete(codAntigo);
    pcpPPChildrenCache.delete(novoCod);
  } catch (_) {}

  // Atualiza texto/atributos principais
  const isPPNow = /\.PP\./i.test(novoCod);
  rowLi.dataset.codigo = novoCod;

  if (isPPNow) {
    rowLi.classList.add('pp-row');
    codDiv.classList.add('pp');
    let label = codDiv.querySelector('.pp-select-item');
    if (!label) {
      label = document.createElement('label');
      label.className = 'pp-select-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'pp-select-checkbox';
      input.checked = wasChecked ?? true;
      input.setAttribute('data-cod', novoCod);
      input.setAttribute('aria-label', `Selecionar ${novoCod}`);
      const span = document.createElement('span');
      span.textContent = novoCod;
      span.title = novoCod;
      label.appendChild(input);
      label.appendChild(span);
      codDiv.innerHTML = '';
      codDiv.appendChild(label);
    } else {
      const input = label.querySelector('.pp-select-checkbox');
      const span = label.querySelector('span');
      if (input) {
        input.setAttribute('data-cod', novoCod);
        input.setAttribute('aria-label', `Selecionar ${novoCod}`);
        if (wasChecked !== null) input.checked = wasChecked;
        else if (!input.checked) input.checked = true;
      }
      if (span) {
        span.textContent = novoCod;
        span.title = novoCod;
      }
    }
  } else {
    rowLi.classList.remove('pp-row');
    codDiv.classList.remove('pp');
    codDiv.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = novoCod;
    span.title = novoCod;
    codDiv.appendChild(span);
  }

  descDiv.textContent = novaDesc;
  descDiv.setAttribute('title', novaDesc);

  // Atualiza todos os botões da coluna Ação com o novo data-cod
  rowLi.querySelectorAll('[data-action][data-cod]').forEach(btn => {
    btn.setAttribute('data-cod', novoCod);
  });

  // Marca a linha como trocada e pinta APENAS a descrição de amarelo
  rowLi.classList.add('pcp-trocado');
  rowLi.querySelectorAll('.swap-pill').forEach(el => el.remove()); // remove selo antigo, se existir
  descDiv.classList.add('desc-trocado');

  // Log leve para depuração
  console.debug('[PCP] Linha trocada (somente UI):', {
    de: { cod: codAntigo, desc: descAntiga },
    para: { cod: novoCod, desc: novaDesc }
  });

  // 🚩 CASO ESPECIAL — TROCA do ITEM PAI
  // Se esta linha for o PAI atual, atualizamos a "fonte canônica" (#pcp-code) e
  // disparamos o mesmo carregamento usado quando a PCP é aberta a partir do Kanban.
  try {
    const barCode = (document.getElementById('pcp-code')?.textContent || '').trim();
    const isParent =
      (rowLi.classList && (rowLi.classList.contains('pcp-parent-row') || rowLi.classList.contains('pcp-estrutura-item--pai'))) ||
      (barCode && barCode === codAntigo);

    if (isParent) {
      // torna o novo código a fonte canônica (atualiza #pcp-code e estado global)
      if (typeof window.setPCPProdutoCodigo === 'function') window.setPCPProdutoCodigo(novoCod);

      // reconstrói toda a lista de peças (usa window.pcpCodigoAtual internamente)
      try { if (typeof window.ensurePCPEstruturaAutoLoad === 'function') window.ensurePCPEstruturaAutoLoad(); } catch (_) {}

      // não precisa atualizar colunas dinâmicas desta linha; ela será recriada
      return;
    }
  } catch (e) {
    console.warn('[PCP][PAI] falha ao reconstruir após troca do pai:', e);
  }

  const ppCardList = rowLi.closest('.pcp-pp-card-list');
  if (ppCardList) {
    ppCardList.querySelectorAll(`.pp-subitem-row[data-parent-codigo="${codAntigo}"]`).forEach(el => el.remove());
    rowLi.classList.remove('pp-has-child-pp');
    try {
      await pcpPopulatePPChildren(ppCardList);
    } catch (e) {
      console.warn('[PCP] falha ao recarregar subitens PP após troca:', e);
    }
  }

  // Atualiza colunas dinâmicas desta linha (Qtd prod / Arm Pro / Arm Alm)
  try { pcpAtualizarColunasDinamicas(rowLi); } catch (e) {}

  // Reordena a lista principal (PP primeiro) após a troca
  try { pcpReordenarPorPP(rowLi.parentElement); } catch (e) {}
}



/* [PCP] Atualiza SALDOS (Arm Pro/Arm Alm) e Qtd prod SOMENTE da linha informada.
   - Usa /api/armazem/saldos_duplos para pegar { pro[cod], alm[cod] }.
   - Para "Qtd prod" (somente PP), tenta buscar num endpoint de mapa; se não houver, usa 0 (fallback).
*/
async function pcpAtualizarColunasDinamicas(rowLi) {
  if (!rowLi) return;
  const cod = (rowLi.querySelector('.cod')?.textContent || '').trim();
  if (!cod) return;

  // 1) Arm Pro / Arm Alm (reaproveita sua API já usada no render)
  try {
    const r = await fetch(`${API_BASE}/api/armazem/saldos_duplos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ codigos: [cod] }),
    });
    if (r.ok) {
      const j   = await r.json();
      const pro = Number((j?.pro || {})[cod] ?? 0);
      const alm = Number((j?.alm || {})[cod] ?? 0);

      const elPro = rowLi.querySelector('.qtdpro');
      const elAlm = rowLi.querySelector('.qtdalm');
      if (elPro) elPro.textContent = pro.toLocaleString('pt-BR');
      if (elAlm) elAlm.textContent = alm.toLocaleString('pt-BR');

      // feedback e aviso de falta (mantém seu padrão)
      if (elPro) elPro.style.color = pro <= 0 ? '#e44' : '';
      if (elAlm) elAlm.style.color = alm <= 0 ? '#e44' : '';

      // Atualiza o aviso de "Quantidade > Arm Pro" (classe .pcp-warn na coluna .qtd)
      const qtdBase = Number(rowLi.dataset.qtdBase || 0);
      let fator = pcpGetFactorValue();
      const qtdFinal = qtdBase * fator;

      const qtdCell  = rowLi.querySelector('.qtd');
      const qtdInput = qtdCell?.querySelector('input');
      if (qtdCell) {
        if (qtdInput) {
          const rounded = Math.round(qtdFinal * 1e6) / 1e6;
          qtdInput.value = String(rounded);
        }
        if (!qtdInput) {
          const hasDecimal = Math.abs(qtdFinal % 1) > 1e-9;
          qtdCell.textContent = Number(qtdFinal).toLocaleString('pt-BR', hasDecimal ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : undefined);
        }
        if (qtdFinal > pro) qtdCell.classList.add('pcp-warn');
        else                qtdCell.classList.remove('pcp-warn');
      }
    }
  } catch (e) {
    console.warn('[PCP] Falha ao atualizar saldos da linha:', e);
  }

  // 2) Qtd prod (apenas se for PP)
  if (!/\.PP\./i.test(cod)) {
    const qEl = rowLi.querySelector('.qtdprod');
    if (qEl) qEl.textContent = ''; // não-PP fica vazio
    return;
  }

  try {
    const qtd = await pcpFetchQtdProdPorCodigo(cod);
    const qEl = rowLi.querySelector('.qtdprod');
    if (qEl) qEl.textContent = Number(qtd || 0).toLocaleString('pt-BR');
  } catch (e) {
    console.warn('[PCP] Qtd prod (PP) não pôde ser atualizada; usando 0', e);
    const qEl = rowLi.querySelector('.qtdprod');
    if (qEl) qEl.textContent = '0';
  }
}

// [PCP] Busca Qtd prod (somente PP). Tolerante: se não houver endpoint, retorna 0 sem quebrar.
async function pcpFetchQtdProdPorCodigo(codigoPP) {
  const cod = String(codigoPP || '').trim();
  if (!cod) return 0;

  const payload = { codigos: [cod] };
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  };

  try {
    // rota única e simples no back (ver seção B)
    const r = await fetch(`${API_BASE}/api/pcp/qtd_prod`, opts);
    if (r.ok) {
      const j = await r.json();                  // esperado: { "03.PP.N.10923": 1, ... }
      const val = (j && (j[cod] ?? j?.map?.[cod] ?? j?.data?.[cod])) ?? 0;
      return Number(val) || 0;
    }
  } catch (e) {
    // silencioso: não loga erro para não poluir o console em ambiente sem endpoint
  }
  return 0; // fallback seguro
}

async function fetchPesquisarProdutosEstrutura(q) {
  const url = `${API_BASE}/api/pcp/estrutura/busca`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ q })
    });
  } catch (e) {
    console.warn('[PCP] busca omie_estrutura falhou (rede):', e);
    return [];
  }

  if (!resp.ok) {
    console.warn('[PCP] busca omie_estrutura falhou:', resp.status, resp.statusText);
    return [];
  }

  let payload;
  try {
    payload = await resp.json();
  } catch (e) {
    console.warn('[PCP] busca omie_estrutura resposta não-JSON:', e);
    return [];
  }

  const itens = Array.isArray(payload?.itens) ? payload.itens : (Array.isArray(payload) ? payload : []);
  return itens
    .map(it => ({
      codigo: String(it.codigo ?? it.cod_produto ?? '').trim(),
      descricao: String(it.descricao ?? it.descr_produto ?? '').trim()
    }))
    .filter(it => it.codigo);
}


// Busca SQL “caça-tudo”: retorna também .fontes (array de schema.tabela)
async function fetchPesquisarProdutos_SQL(q) {
  const url  = `${API_BASE}/api/produtos/busca`;
  const body = { q: q };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn('[PCP] busca troca: falha de rede:', e);
    return [];
  }

  if (resp.status === 404) {
    if (!window.__trocaWarned404) {
      console.warn('[PCP] /api/produtos/busca não implementado no backend (404).');
      window.__trocaWarned404 = 1;
    }
    return [];
  }
  if (!resp.ok) {
    console.warn('[PCP] busca troca falhou:', resp.status, resp.statusText);
    return [];
  }

  const j = await resp.json();
  const itens = Array.isArray(j?.itens) ? j.itens : (Array.isArray(j) ? j : []);
  const seen = new Set();
  const out = [];
  for (const it of itens) {
    const c = String(it.codigo ?? it.cod ?? '').trim();
    const d = String(it.descricao ?? it.desc ?? '').trim();
    const fontes = Array.isArray(it.fontes) ? it.fontes : [];
    if (!c && !d) continue;
    const key = `${c}|${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ codigo: c, descricao: d, fontes });
  }
  return out;
}

// Atualiza a OP no banco de dados com a nova estrutura montada pelo usuário
async function pcpAtualizarOP(parentLi, btn) {
  const opInfo = (window.pcpContext && window.pcpContext.op) ? String(window.pcpContext.op) : '';
  if (!opInfo) {
    alert('Nenhuma OP identificada para atualizar.');
    return;
  }

  const codigoProduto = String(window.pcpCodigoAtual || '').trim();
  if (!codigoProduto) {
    alert('Código do produto não identificado.');
    return;
  }

  // Coleta todos os itens visíveis da estrutura (exceto o pai)
  const ul = document.getElementById('listaPecasPCPList');
  if (!ul) return;

  const rows = Array.from(ul.querySelectorAll('li.data-row:not(.pcp-parent-row)'));
  const itensAtuais = [];

  for (const li of rows) {
    const codigo = String(li.dataset.codigo || '').trim();
    if (!codigo) continue;
    
    const descEl = li.querySelector('.desc');
    const descricao = descEl ? descEl.textContent.trim() : '';
    
    // Verifica se é item trocado (não original)
    const isTrocado = li.classList.contains('pcp-trocado') || descEl?.classList.contains('desc-trocado');
    
    // Determina tipo e grupo
    const isPP = li.classList.contains('pp-row') || li.classList.contains('pp-subitem-row');
    const tipo = isPP ? 'pp' : 'peca';
    const grupo = isPP ? 'pp' : 'pecas';
    
    // Busca quantidade
    let quantidade = null;
    const qtdInput = li.querySelector('.pp-qtd-input, .pcp-qtd-input');
    if (qtdInput) {
      const parsed = Number(String(qtdInput.value ?? '').replace(',', '.'));
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    } else if (li.dataset.qtdBase) {
      const parsed = Number(li.dataset.qtdBase);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    }
    // Busca unidade
    let unidade = null;
    const unidInput = li.querySelector('.pcp-unid-input');
    if (unidInput) {
      const v = String(unidInput.value || '').trim().toUpperCase();
      unidade = v || null;
    } else if (li.dataset.unid) {
      unidade = String(li.dataset.unid || '').trim().toUpperCase() || null;
    } else {
      const unidCell = li.querySelector('.unid');
      const t = unidCell ? String(unidCell.textContent || '').trim().toUpperCase() : '';
      unidade = t || null;
    }
    
    itensAtuais.push({
      codigo,
      descricao,
      trocado: isTrocado,
      tipo,
      grupo,
      quantidade,
      unidade,
      parent_codigo: li.dataset.parentCodigo || codigoProduto,
      descricao_original: String(li.dataset.swapOriginalDesc || '').trim() || null,
      codigo_original: String(li.dataset.swapOriginalCod || '').trim() || null
    });
  }

  console.log('[PCP][Atualizar OP] Itens atuais:', itensAtuais);

  // Envia para o backend processar
  const payload = {
    numero_referencia: opInfo,
    codigo_produto: codigoProduto,
    itens: itensAtuais,
    versao: window.pcpContext?.versao || null
  };

  try {
    const resp = await fetch(`${API_BASE}/api/pcp/atualizar-op`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errText}`);
    }

    const result = await resp.json();
    console.log('[PCP][Atualizar OP] Resultado:', result);

    alert(result.message || 'OP atualizada com sucesso!');
  } catch (err) {
    console.error('[PCP][Atualizar OP] Erro:', err);
    throw err;
  }
}


async function pcpDecorateEstruturaButtonsSub(subUl) {
  const rows = Array.from(subUl.querySelectorAll('li.child-row'));
  const jobs = rows.map(async li => {
    const code = li.dataset.cod || li.querySelector('.cod')?.textContent?.trim();
    if (!code || !pcpIsPP(code)) { li.querySelector('.estrutura-btn')?.remove(); return; }

    const has = await pcpHasEstrutura(code);
    const acao = li.querySelector('.acao');
    if (!acao) return;

    if (has && !acao.querySelector('.estrutura-btn')) {
      const btn = document.createElement('button');
      btn.className = 'icon-btn estrutura-btn';
      btn.dataset.action = 'estrutura';
      btn.dataset.cod = code;
      btn.title = 'Estrutura do item';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 3h12v4H6zM12 7v4M4 13h8v4H4zM12 13h8v4h-8z" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      acao.appendChild(btn);
    } else if (!has) {
      li.querySelector('.estrutura-btn')?.remove();
    }
  });
  await Promise.allSettled(jobs);
}



// Caminho único para abrir/carregar a PCP a partir de Comercial/Preparação
window.PCP = window.PCP || {};
window.PCP.open = function(codigo) {
  if (!codigo) return;
  // Limpa o contexto quando abrindo PCP sem contexto de OP
  window.pcpContext = undefined;
  console.log('[PCP.open] Limpando pcpContext (aberto sem contexto de OP)');
  setPCPProdutoCodigo(codigo);     // atualiza título
  showKanbanTab('pcp');            // mostra a aba
  ensurePCPEstruturaAutoLoad(codigo); // carrega a estrutura do MESMO código
};


// Sequenciador global para “última chamada vence”
window.__pcpLoadSeq = 0;

async function ensurePCPEstruturaAutoLoad(/* codigoIgnorado */) {
  // IGNORA parâmetro externo: só vale a fonte canônica
  const code = String(window.pcpCodigoAtual || '').trim();
  if (!code) return;

  const mySeq = ++window.__pcpLoadSeq; // carimbo desta execução

  try {
    const payload = await fetchEstruturaPCP_SQL(code);

    // Só renderiza se ainda formos o mais recente
    if (mySeq === window.__pcpLoadSeq) {
      renderPCPListaEstrutura(payload, code);
    }
  } catch (e) {
    // Também protege o fallback com o sequenciador
    if (mySeq === window.__pcpLoadSeq) {
      console.error('[PCP] falha ao carregar estrutura:', e);
      renderPCPListaEstrutura({ dados: [] }, code);
    }
  }
}





// expõe global para quem chama de outros módulos (kanban.js / kanban_base.js)
window.ensurePCPEstruturaAutoLoad = ensurePCPEstruturaAutoLoad;


function compactPCPFilters() {
  const code = document.getElementById('codeFilterPCP');
  const desc = document.getElementById('descFilterPCP');
  [code, desc].forEach((el, i) => {
    if (!el) return;
    el.style.flex = 'none';
    el.style.height = '24px';
    el.style.padding = '2px 6px';
    el.style.fontSize = '12px';
    el.style.border = '1px solid var(--border-color)';
    el.style.borderRadius = '4px';
    el.style.width = i === 0 ? '120px' : '200px'; // 0=código, 1=descrição
  });
}

// ===== Toolbar PCP: Incluir item / Resetar =====
function pcpInitToolbar() {
  const addBtn   = document.getElementById('pcpAddBtn');
  const resetBtn = document.getElementById('pcpResetBtn');
  const panel    = document.getElementById('pcpAddContainer');
  const searchIn = document.getElementById('pcpAddSearch');
  const results  = document.getElementById('pcpAddResults');
  const dropdown = panel ? panel.querySelector('.transfer-search-dropdown') : null;
  if (!addBtn && !resetBtn) {
    console.warn('[PCP][Toolbar] Botões não encontrados (ainda).');
  }

  if (addBtn && !addBtn.dataset.bound) {
    addBtn.addEventListener('click', () => {
      console.log('[PCP][Toolbar] Incluir item acionado');
      if (!panel) return;
      panel.style.display = panel.style.display === 'none' || panel.style.display === '' ? 'block' : 'none';
      if (panel.style.display === 'block' && searchIn) {
        searchIn.value = '';
        results && (results.innerHTML = '');
        searchIn.focus();
      }
    });
    addBtn.dataset.bound = '1';
  }

  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.addEventListener('click', () => {
      console.log('[PCP][Toolbar] Resetar acionado');
      pcpResetListaPCP();
    });
    resetBtn.dataset.bound = '1';
  }

  if (searchIn && !searchIn.dataset.bound) {
    let t = null;
    searchIn.addEventListener('input', () => {
      const q = searchIn.value.trim();
      clearTimeout(t);
      t = setTimeout(async () => {
        if (q.length < 2) {
          if (results) results.innerHTML = '';
          if (dropdown) dropdown.style.display = 'none';
          return;
        }
        try {
          if (dropdown) dropdown.style.display = 'block';
          if (results) results.innerHTML = '<li class="info">Buscando…</li>';
          const r = await fetch(`${API_BASE}/api/pcp/estrutura/busca`, {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            credentials: 'include',
            body: JSON.stringify({ q })
          });
          if (!r.ok) { results && (results.innerHTML = '<li>Falha na busca</li>'); return; }
          const j = await r.json();
          const itens = Array.isArray(j?.itens) ? j.itens : [];
          if (!results) return;
          if (!itens.length) {
            results.innerHTML = '<li class="no-results">Nenhum resultado</li>';
          } else {
            results.innerHTML = itens.map(it => 
              `<li style="cursor:pointer;" data-codigo="${it.codigo}" data-desc="${(it.descricao||'').replace(/\"/g,'&quot;')}">
                 <strong>${it.codigo}</strong> — ${(it.descricao||'')}</li>`
            ).join('');
          }
        } catch (e) {
          if (results) results.innerHTML = '<li class="error">Erro na busca</li>';
        }
      }, 220);
    });
    searchIn.dataset.bound = '1';
  }

  if (results && !results.dataset.bound) {
    results.addEventListener('click', async (ev) => {
      const li = ev.target.closest('li');
      if (!li) return;
      const codigo = li.dataset.codigo || '';
      const desc   = li.dataset.desc || '';
      if (!codigo) return;
      await pcpAddCustomItem(codigo, desc);
      if (panel) panel.style.display = 'none';
      if (dropdown) dropdown.style.display = 'none';
      if (searchIn) searchIn.value = '';
      if (results) results.innerHTML = '';
    });
    results.dataset.bound = '1';
  }

  // Fecha o dropdown quando sai do foco ou clica fora
  if (searchIn && !searchIn.dataset.blurBound) {
    searchIn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (searchIn) searchIn.value = '';
        if (results) results.innerHTML = '';
        if (dropdown) dropdown.style.display = 'none';
      }
    });
    searchIn.addEventListener('blur', () => {
      setTimeout(() => {
        if (!document.activeElement || document.activeElement.closest('#pcpAddResults') === null) {
          if (dropdown) dropdown.style.display = 'none';
        }
      }, 120);
    });
    document.addEventListener('click', (ev) => {
      if (ev.target === searchIn) return;
      if (dropdown && dropdown.contains(ev.target)) return;
      if (dropdown) dropdown.style.display = 'none';
    });
    searchIn.dataset.blurBound = '1';
  }
}

async function pcpAddCustomItem(codigo, descricao) {
  const ul = document.getElementById('listaPecasPCPList');
  if (!ul) return;

  // Carrega e cacheia unidades disponíveis
  async function pcpGetUnidades() {
    if (Array.isArray(window.__pcpUnidades) && window.__pcpUnidades.length) {
      return window.__pcpUnidades;
    }
    try {
      const r = await fetch(`${API_BASE}/api/pcp/unidades`, { credentials: 'include' });
      const j = await r.json();
      const arr = Array.isArray(j?.unidades) ? j.unidades : [];
      window.__pcpUnidades = arr;
      return arr;
    } catch (_) {
      return [];
    }
  }

  const unidades = await pcpGetUnidades();
  const hasUN = unidades.includes('UN');

  // monta linha simples como peça (não-PP)
  const li = document.createElement('li');
  li.className = 'data-row pcp-custom-added pcp-trocado';
  li.dataset.codigo = codigo;
  li.dataset.qtdBase = '1';

  const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const unidOptions = (unidades && unidades.length)
    ? unidades.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('')
    : '<option value="UN">UN</option>';

  li.innerHTML = `
    <div class="cod"><span title="${esc(codigo)}">${esc(codigo)}</span></div>
    <div class="desc desc-trocado" title="${esc(descricao)}">${esc(descricao||'')}</div>
    <div class="unid">
      <select class="pcp-unid-input" style="width:76px; text-transform:uppercase;">
        ${unidOptions}
      </select>
    </div>
    <div class="qtd"><input class="pcp-qtd-input" type="number" inputmode="decimal" step="any" min="0" value="1" style="width:70px;"></div>
    <div class="qtdprod"></div>
    <div class="qtdpro">0</div>
    <div class="qtdalm">0</div>
    <div class="acao flex gap-2">
      <button class="icon-btn danger pcp-del-btn" title="Remover item">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `;

  // insere após o último item
  ul.appendChild(li);

  // Atualiza saldos para incluir o novo código
  try {
    const filler = window.pcpPreencherSaldosDuplos || pcpPreencherSaldosDuplosLocal;
    await filler(ul);
  } catch {}

  // pequenos ajustes UX: força maiúsculas no campo de unidade
  try {
    const unid = li.querySelector('.pcp-unid-input');
    if (unid && !unid.__bound) {
      unid.__bound = true;
      // define valor padrão
      if (!li.dataset.unid) {
        const def = hasUN ? 'UN' : (unidades[0] || '');
        if (def) {
          try { unid.value = def; } catch {}
          li.dataset.unid = def;
        }
      }
      unid.addEventListener('change', () => {
        li.dataset.unid = String(unid.value || '').trim().toUpperCase();
      });
    }
    const qtd = li.querySelector('.pcp-qtd-input');
    if (qtd && !qtd.__bound) {
      qtd.__bound = true;
      qtd.addEventListener('change', () => {
        const n = Number(String(qtd.value ?? '').replace(',', '.'));
        if (!Number.isFinite(n) || n <= 0) {
          qtd.value = '1';
          li.dataset.qtdBase = '1';
        } else {
          li.dataset.qtdBase = String(n);
        }
      });
    }
  } catch {}
}

// Delegação para remoção de itens customizados
(function bindPCPListDelete(){
  const ul = document.getElementById('listaPecasPCPList');
  if (!ul || ul.dataset.pcpDeleteBound) return;
  ul.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.pcp-del-btn');
    if (!btn) return;
    const li = btn.closest('li.data-row');
    if (!li) return;
    li.remove();
  });
  ul.dataset.pcpDeleteBound = '1';
})();

function pcpResetListaPCP() {
  const ul = document.getElementById('listaPecasPCPList');
  if (!ul) return;
  ul.querySelectorAll('li.data-row').forEach(li => {
    if (!li.classList.contains('pcp-parent-row')) li.remove();
  });
}

// também fica global, pois é chamado a partir do kanban.js
window.compactPCPFilters = compactPCPFilters;

// referências ao container principal
const wrapper = document.querySelector('.wrapper');

// Spinner de carregamento

/* ======== Helpers – alternar Pedidos (Kanban) ======== */
function showKanban () {
    hideArmazem();                 // ← NOVA LINHA
  /* esconde QUALQUER painel de produtos que ainda possa estar visível */
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

  /* mostra somente a estrutura do Kanban */
  document.getElementById('produtoTabs').style.display   = 'none';
  document.getElementById('kanbanTabs').style.display    = 'flex';
  document.getElementById('kanbanContent').style.display = 'block';

  /* (re)carrega dados e abre a sub-aba que o usuário visitou por último */
  initKanban();
  showKanbanTab(lastKanbanTab || 'comercial');
}


function hideKanban () {
  document.getElementById('kanbanTabs').style.display    = 'none';
  document.getElementById('kanbanContent').style.display = 'none';
  document.getElementById('produtoTabs').style.display   = 'block';
}



function showSpinner() {
  document.getElementById('productSpinner').style.display = 'inline-flex';
}

// Spinner exclusivo da guia “Estrutura de produto”
function showEstruturaSpinner() {
  const dst = document.getElementById('estruturaSpinner');
  if (!dst) return;
  ensureEstruturaSpinnerMarkup();               // injeta e corrige display do <i>
  dst.style.display = 'inline-flex';            // mostra o contêiner
  const i = dst.querySelector('.kanban-spinner');
  if (i) i.style.display = 'inline-flex';       // sobrepõe o CSS global do Kanban
}

function hideEstruturaSpinner() {
  const dst = document.getElementById('estruturaSpinner');
  if (dst) dst.style.display = 'none';
}

// [Estrutura] Reusa o mesmo spinner do Kanban (fa-spinner fa-spin)
// Mantém a função NO ESCOPO GLOBAL, pois showEstruturaSpinner a chama diretamente.
function ensureEstruturaSpinnerMarkup() {
  const dst = document.getElementById('estruturaSpinner');
  if (!dst) return;

  // injeta o <i> do spinner se ainda não existir
  let i = dst.querySelector('.kanban-spinner');
  if (!i) {
    dst.innerHTML = '<i class="fas fa-spinner fa-spin kanban-spinner" aria-hidden="true"></i>';
    i = dst.querySelector('.kanban-spinner');
  }

  // garante que fique visível (o CSS do kanban esconde por padrão)
  i.style.display = 'inline-block';
}

// expõe no escopo global (útil para futuros usos/DevTools)
window.ensureEstruturaSpinnerMarkup = ensureEstruturaSpinnerMarkup;



function hideSpinner() {
  document.getElementById('productSpinner').style.display = 'none';
}

// --- patch restrito APENAS à rota ListarProdutos -------------------
let prodPending = 0;
// suba isto para cima, antes de qualquer outro fetch
const _origFetch = window.fetch;
window.fetch = async function(input, init = {}) {
  // força o envio do cookie de sessão em TODAS as requests
  init.credentials = init.credentials ?? 'include';

  // --- spinner antigo permanece inalterado ---
  const url = input;
  const isListaProd = typeof url === 'string'
    && url.includes('/api/omie/produtos');

  if (isListaProd && prodPending === 0) showSpinner();
  if (isListaProd) prodPending++;

  try {
    return await _origFetch(input, init);
  } finally {
    if (isListaProd) {
      prodPending--;
      if (prodPending === 0) hideSpinner();
    }
  }
};

// injeta CSS para esconder via classe
(function ensurePermCss(){
  if (document.getElementById('perm-hide-style')) return;
  const st = document.createElement('style');
  st.id = 'perm-hide-style';
  st.textContent = `.perm-hidden{display:none !important;}`;
  document.head.appendChild(st);
})();


// Exemplo: chamar após confirmar sessão
document.addEventListener('DOMContentLoaded', () => {
  // quando você já tiver setado window.__sessionUser
  setTimeout(applyCurrentUserPermissionsToUI, 200);
  // garante que o botão "+" apareça assim que a UI renderizar
setTimeout(ensureColabCreateButton, 50);

// Listener global: fechar painéis de filtro ao clicar fora
document.addEventListener('click', (e) => {
  const almoxPanel = document.getElementById('almoxFilterPanel');
  const almoxBtn = document.getElementById('almoxFilterBtn');

  // Fechar painel Estoque se clicou fora
  if (almoxPanel && almoxPanel.classList.contains('is-open')) {
    if (!almoxPanel.contains(e.target) && !almoxBtn.contains(e.target)) {
      almoxPanel.classList.remove('is-open');
      almoxPanel.style.display = 'none';
    }
  }
});

// Comercial → fixa código e abre PCP carregando via SQL
document.getElementById('coluna-comercial')?.addEventListener('click', (ev) => {
  const li = ev.target.closest('.kanban-card');
  if (!li) return;

  const codigo = (li.dataset.codigo || '').trim();
  if (!codigo) return;

  // Limpa o contexto quando abrindo PCP sem contexto de OP
  window.pcpContext = undefined;
  console.log('[Comercial→PCP] Limpando pcpContext (aberto sem contexto de OP)');

  // 1) Define a FONTE CANÔNICA
  window.setPCPProdutoCodigo?.(codigo);

  // 2) Abre a sub-aba PCP
  document.querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')?.click();

  // 3) Carrega SEM parâmetro (usa pcpCodigoAtual)
  setTimeout(() => window.ensurePCPEstruturaAutoLoad?.(), 30);
});



// Se a guia PCP abrir por hash/rota, tenta carregar automático
try {
  const hash = String(location.hash || '');
  if (hash.includes('pcp')) setTimeout(ensurePCPEstruturaAutoLoad, 80);
} catch (_) {}

// Se clicar em alguma aba/âncora que aponte para PCP, tenta carregar após a troca
document.body.addEventListener('click', (ev) => {
  const goPCP = ev.target.closest('[data-kanban-tab="pcp"], [data-nav-key="pcp"], [href="#pcp"], [data-tab-target="pcp"], a[href*="conteudo-pcp"]');
  if (goPCP) {
    // Se não estiver vindo do modal de Preparação (que define pcpContext),
    // limpa o contexto para garantir que não fique de uma navegação anterior
    const viaModal = ev.target.closest('.prep-ops-modal-content');
    if (!viaModal && !window.pcpContext) {
      window.pcpContext = undefined;
      console.log('[Click→PCP] Limpando pcpContext (aberto sem contexto de OP)');
    }
    setTimeout(ensurePCPEstruturaAutoLoad, 60);
    // Reforça a inicialização da toolbar
    setTimeout(() => { try { pcpInitToolbar(); } catch {} }, 80);
  }
});

// Inicializa toolbar no carregamento inicial
try { document.addEventListener('DOMContentLoaded', () => pcpInitToolbar()); } catch {}


});

// Abre a aba Dados do produto
function openDadosProdutoTab() {
  try {
    hideKanban?.();
    // Limpa container principal (deixa só o produto visível depois)
    window.clearMainContainer?.();

    const prodTabs = document.getElementById('produtoTabs');
    if (!prodTabs) {
      console.warn('[PRODUTO] Wrapper #produtoTabs não encontrado');
      return;
    }

    // Mostra apenas o wrapper principal de produto
    window.showOnlyInMain?.(prodTabs);

    // Ativa card "Dados" e desativa os demais
    document.querySelectorAll('#produtoTabs .main-header .nav-card').forEach(c => c.classList.remove('active'));
    const dadosCard = document.querySelector('#produtoTabs .main-header .nav-card[data-target="dadosProduto"]');
    if (dadosCard) dadosCard.classList.add('active');

    // Esconde todas as tab-panes internas e mostra #dadosProduto
    document.querySelectorAll('#produtoTabs .tab-content .tab-pane').forEach(p => p.style.display = 'none');
    const dadosPane = document.getElementById('dadosProduto');
    if (dadosPane) dadosPane.style.display = 'block';

    // Garante header principal visível
    const mainHeader = document.querySelector('#produtoTabs .main-header');
    if (mainHeader) mainHeader.style.display = 'flex';

    // Ativa sub-tab "detalhes" dentro de Dados
    const subLinks = document.querySelectorAll('#dadosProduto .sub-tabs .main-header-link');
    subLinks.forEach(l => l.classList.remove('is-active'));
    const detalhesLink = document.querySelector('#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]');
    if (detalhesLink) {
      detalhesLink.classList.add('is-active');
      // Dispara click para rodar lógica já existente da sub-tab
      detalhesLink.click();
    }

    // Atualiza hash para navegação/estado
    try { if (location.hash !== '#produto-dados') location.hash = '#produto-dados'; } catch {}

    console.log('[PRODUTO] Aba Dados do produto aberta');
  } catch (e) {
    console.error('[PRODUTO] Erro ao abrir aba Dados:', e);
  }
}


/* ======== Helpers – alternar Armazéns ======== */
function showArmazem () {
  // Limpa todo o container principal
  window.clearMainContainer?.();
  
  // esconde Kanban e Produto
  hideKanban();
  document.getElementById('produtoTabs').style.display = 'none';

  // mostra Armazéns
  const armazemContent = document.getElementById('armazemContent');
  if (armazemContent) {
    window.showOnlyInMain?.(armazemContent);
  }
  document.getElementById('armazemTabs').style.display = 'flex';
  showArmazemTab('estoque');          // abre a guia Estoque por padrão
}

function hideArmazem () {
  document.getElementById('armazemTabs').style.display    = 'none';
  document.getElementById('armazemContent').style.display = 'none';
  // se preferir, pode voltar a mostrar produtoTabs aqui
}

/* ——— sub-abas internas ——— */
async function showArmazemTab(nome) {

  document.querySelectorAll('#armazemTabs .main-header-link')
    .forEach(a => a.classList.toggle('is-active', a.dataset.armTab === nome));

  document.querySelectorAll('#armazemContent .armazem-page')
    .forEach(p => p.style.display = (p.id === `conteudo-${nome}` ? 'block' : 'none'));

// —— Estoque: sempre recarrega a página corrente ——
if (nome === 'estoque') {
  // Carregar locais de estoque no listbox
  await carregarLocaisEstoqueListbox();
  
  // 1) busca dados caso ainda não exista nada carregado
  if (!almoxAllDados.length) {
    await carregarAlmoxarifado();      // primeira vez
  } else {
    aplicarFiltroAlmox();              // reaplica prefixos + texto
  }

  // 2) carrega famílias e monta checkboxes só na primeira abertura
  if (!almoxFamiliasLoaded) {
    await loadAlmoxFamilias();
  }
}
else if (nome === 'transferencia') {
  // Carrega locais de estoque para os selects Origem/Destino
  await carregarLocaisEstoque();
  // Renderiza lista de itens selecionados
  window.renderTransferenciaLista?.();
}

}


/* ====================================================== */
/*  Almoxarifado – carregar dados                         */
/* ====================================================== */
let almoxDataLoaded = false;

/* ====================================================== */
/*  Almoxarifado – carregar todos os itens                */
/* ====================================================== */
async function carregarAlmoxarifado() {
  const tbody = document.querySelector('#tbl-almoxarifado tbody');
  tbody.innerHTML = '<tr><td colspan="6">⏳ Carregando…</td></tr>';

  try {
    const resp = await fetch('/api/armazem/almoxarifado', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        pagina: 1,
        local : almoxLocalAtual || TRANSFER_DEFAULT_ORIGEM
      })        // backend devolve tudo já filtrado pelo local desejado
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha na API');

    /* —— guarda e desenha —— */
    almoxAllDados   = json.dados;      // mantém a lista completa
    almoxTotalPages = 1;               // sempre 1 agora
    almoxCurrentPage = 1;
    almoxDataLoaded = true;

    renderAlmoxTable(almoxAllDados);   // cria as <tr>

    /* —— contador e pager —— */
    document.querySelector('.almox-pager').style.display = 'none';  // esconde ◀▶
    document.getElementById('almoxPageInfo').textContent = '1 / 1';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="6">⚠️ Erro ao carregar dados</td></tr>';
  }
}

async function ensureAlmoxDadosCarregados() {
  if (almoxDataLoaded && almoxAllDados.length) return;
  try {
    await carregarAlmoxarifado();
  } catch (err) {
    console.error('[transfer] Falha ao garantir dados do Almoxarifado:', err);
  }
}

function preencherTransferLocais() {
  const selects = [
    document.getElementById('transferOrigem'),
    document.getElementById('transferDestino')
  ].filter(Boolean);

  selects.forEach(sel => {
    const current = sel.value;
    const isOrigem = sel.id === 'transferOrigem';
    const preferido = isOrigem ? TRANSFER_DEFAULT_ORIGEM : TRANSFER_DEFAULT_DESTINO;
    sel.innerHTML = '<option value="">Selecione…</option>';
    transferLocais.forEach(loc => {
      const opt = document.createElement('option');
      const codigoLocal = String(loc.codigo_local_estoque || loc.codigo || '');
      const codigo = loc.codigo ? `${loc.codigo} — ` : '';
      const descricao = loc.descricao || '';
      const label = `${codigo}${descricao}${loc.inativo ? ' (inativo)' : ''}`.trim();
      opt.value = codigoLocal;
      opt.dataset.codigo = loc.codigo || '';
      opt.dataset.inativo = loc.inativo ? 'S' : 'N';
      opt.title = label;
      opt.textContent = label;
      if (loc.inativo) opt.classList.add('is-inactive');
      sel.appendChild(opt);
    });
    const hasCurrent = current && Array.from(sel.options).some(o => o.value === current);
    if (hasCurrent) {
      sel.value = current;
    } else if (preferido && Array.from(sel.options).some(o => o.value === preferido)) {
      sel.value = preferido;
    } else if (sel.options.length > 1) {
      sel.selectedIndex = 1;
    }
  });
}

async function carregarLocaisEstoque() {
  if (transferLocais.length) {
    preencherTransferLocais();
    return transferLocais;
  }

  try {
    const resp = await fetch('/api/armazem/locais');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha ao listar locais');
    transferLocais = Array.isArray(json.locais) ? json.locais.map(loc => ({
      codigo: loc.codigo || '',
      descricao: loc.descricao || '',
      codigo_local_estoque: String(loc.codigo_local_estoque || ''),
      inativo: !!loc.inativo,
      padrao: !!loc.padrao
    })) : [];
    transferLocais.sort((a, b) => (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR'));
    preencherTransferLocais();
  } catch (err) {
    console.error('[transfer] Falha ao carregar locais de estoque:', err);
    const selects = [
      document.getElementById('transferOrigem'),
      document.getElementById('transferDestino')
    ].filter(Boolean);
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">Não foi possível carregar os locais</option>';
    });
  }
  return transferLocais;
}

// Função para carregar locais de estoque no listbox da guia Estoque
async function carregarLocaisEstoqueListbox() {
  const select = document.getElementById('estoqueLocalSelect');
  if (!select) return;

  // Se já temos os locais carregados, apenas preenche
  if (transferLocais.length) {
    preencherEstoqueListbox(select);
    return;
  }

  // Buscar locais da API
  try {
    const resp = await fetch('/api/armazem/locais');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha ao listar locais');
    
    transferLocais = Array.isArray(json.locais) ? json.locais.map(loc => ({
      codigo: loc.codigo || '',
      descricao: loc.descricao || '',
      codigo_local_estoque: String(loc.codigo_local_estoque || ''),
      inativo: !!loc.inativo,
      padrao: !!loc.padrao
    })) : [];
    
    transferLocais.sort((a, b) => (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR'));
    preencherEstoqueListbox(select);
  } catch (err) {
    console.error('[Estoque Listbox] Falha ao carregar locais:', err);
    select.innerHTML = '<option value="">Erro ao carregar locais</option>';
  }
}

// Preenche o select com locais ativos
function preencherEstoqueListbox(select) {
  if (!select) return;
  
  // Filtrar apenas estoques ativos
  const ativos = transferLocais.filter(loc => !loc.inativo);
  
  select.innerHTML = '';
  ativos.forEach(loc => {
    const opt = document.createElement('option');
    opt.value = loc.codigo_local_estoque;
    opt.textContent = `${loc.codigo} — ${loc.descricao}`;
    select.appendChild(opt);
  });

  // Selecionar o padrão (#ALMOX — ALMOXARIFADO CENTRAL)
  const padrao = ativos.find(loc => loc.codigo === '#ALMOX') || ativos[0];
  if (padrao) {
    select.value = padrao.codigo_local_estoque;
    almoxLocalAtual = padrao.codigo_local_estoque;
  }
}

async function loadAlmoxFamilias() {
  if (almoxFamiliasLoaded) return;     // só carrega uma vez

  const panel = document.getElementById('almoxFilterPanel');
  panel.innerHTML = '<span class="filter-loading">Carregando famílias…</span>';

  try {
    const resp = await fetch(`${API_BASE}/api/omie/familias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'PesquisarFamilias',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ pagina: 1, registros_por_pagina: 50 }]
      })
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const familias = Array.isArray(data.famCadastro) ? data.famCadastro : [];

    panel.innerHTML = '';

    if (!familias.length) {
      panel.innerHTML = '<span class="filter-empty">Nenhuma família retornada.</span>';
      almoxFamiliasLoaded = true;
      return;
    }

    // Controle único que alterna entre marcar e desmarcar todas as famílias.
    const controls = document.createElement('div');
    controls.className = 'almox-filter-controls';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'almox-select-toggle';
    toggleLabel.setAttribute('for', 'almoxToggleAll');

    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.id = 'almoxToggleAll';
    toggleInput.checked = true;

    const toggleText = document.createElement('span');
    toggleText.className = 'almox-toggle-text';
    toggleText.textContent = 'Desmarcar tudo';

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleText);
    controls.appendChild(toggleLabel);
    panel.appendChild(controls);

    const optionCheckboxes = [];

    const syncToggleState = () => {
      const total = optionCheckboxes.length;
      const marcados = optionCheckboxes.filter(chk => chk.checked).length;

      if (!total) return;

      if (marcados === total) {
        toggleInput.checked = true;
        toggleInput.indeterminate = false;
        toggleText.textContent = 'Desmarcar tudo';
      } else {
        toggleInput.checked = false;
        toggleInput.indeterminate = marcados > 0;
        toggleText.textContent = 'Marcar tudo';
      }
    };

    toggleInput.addEventListener('change', () => {
      const marcarTudo = toggleInput.checked;
      toggleInput.indeterminate = false;

      almoxFamiliasAtivas.clear();
      optionCheckboxes.forEach((chk) => {
        chk.checked = marcarTudo;
        const codigo = chk.dataset.codigo || '';
        if (marcarTudo && codigo) almoxFamiliasAtivas.add(codigo);
      });

      syncToggleState();
      aplicarFiltroAlmox();
    });

    familias.forEach(fam => {
      const nome = String(fam?.nomeFamilia || '').trim();
      const codigo = fam?.codigo != null
        ? String(fam.codigo)
        : String(fam?.codFamilia || '').trim();

      if (!nome || !codigo) return;

      almoxFamiliasMap.set(codigo, nome);
      almoxFamiliasAtivas.add(codigo);

      const sanitizedId = `fam_${codigo}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const label = document.createElement('label');
      label.className = 'almox-filter-option';
      label.innerHTML = `
        <input type="checkbox" id="${sanitizedId}" data-codigo="${codigo}" checked>
        <span>${nome}</span>`;
      panel.appendChild(label);

      const input = label.querySelector('input');
      optionCheckboxes.push(input);

      input.addEventListener('change', (e) => {
        if (e.target.checked) almoxFamiliasAtivas.add(codigo);
        else almoxFamiliasAtivas.delete(codigo);

        syncToggleState();
        aplicarFiltroAlmox();           // refaz a tabela
      });
    });

    syncToggleState();

    almoxFamiliasLoaded = true;
    if (almoxAllDados.length) aplicarFiltroAlmox();
  } catch (err) {
    console.error('[almox filtro famílias] Falha ao carregar famílias:', err);
    panel.innerHTML = '<span class="filter-error">Não foi possível carregar as famílias.</span>';
  }
}

/* ====================================================== */
/*  Produção – carregar filtro de famílias (igual Almoxarifado) */
/* ====================================================== */
async function loadProdFamilias() {
  if (prodFamiliasLoaded) return;     // só carrega uma vez

  const panel = document.getElementById('prodFilterPanel');
  panel.innerHTML = '<span class="filter-loading">Carregando famílias…</span>';

  try {
    const resp = await fetch(`${API_BASE}/api/omie/familias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call: 'PesquisarFamilias',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ pagina: 1, registros_por_pagina: 50 }]
      })
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const familias = Array.isArray(data.famCadastro) ? data.famCadastro : [];

    panel.innerHTML = '';

    if (!familias.length) {
      panel.innerHTML = '<span class="filter-empty">Nenhuma família retornada.</span>';
      prodFamiliasLoaded = true;
      return;
    }

    // Controle único que alterna entre marcar e desmarcar todas as famílias
    const controls = document.createElement('div');
    controls.className = 'prod-filter-controls';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'prod-select-toggle';
    toggleLabel.setAttribute('for', 'prodToggleAll');

    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.id = 'prodToggleAll';
    toggleInput.checked = true;

    const toggleText = document.createElement('span');
    toggleText.className = 'prod-toggle-text';
    toggleText.textContent = 'Desmarcar tudo';

    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(toggleText);
    controls.appendChild(toggleLabel);
    panel.appendChild(controls);

    const optionCheckboxes = [];

    const syncToggleState = () => {
      const total = optionCheckboxes.length;
      const marcados = optionCheckboxes.filter(chk => chk.checked).length;

      if (!total) return;

      if (marcados === total) {
        toggleInput.checked = true;
        toggleInput.indeterminate = false;
        toggleText.textContent = 'Desmarcar tudo';
      } else {
        toggleInput.checked = false;
        toggleInput.indeterminate = marcados > 0;
        toggleText.textContent = 'Marcar tudo';
      }
    };

    toggleInput.addEventListener('change', () => {
      const marcarTudo = toggleInput.checked;
      toggleInput.indeterminate = false;

      prodFamiliasAtivas.clear();
      optionCheckboxes.forEach((chk) => {
        chk.checked = marcarTudo;
        const codigo = chk.dataset.codigo || '';
        if (marcarTudo && codigo) prodFamiliasAtivas.add(codigo);
      });

      syncToggleState();
      aplicarFiltroProd();
    });

    familias.forEach(fam => {
      const nome = String(fam?.nomeFamilia || '').trim();
      const codigo = fam?.codigo != null
        ? String(fam.codigo)
        : String(fam?.codFamilia || '').trim();

      if (!nome || !codigo) return;

      prodFamiliasMap.set(codigo, nome);
      prodFamiliasAtivas.add(codigo);

      const sanitizedId = `prodFam_${codigo}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const label = document.createElement('label');
      label.className = 'prod-filter-option';
      label.innerHTML = `
        <input type="checkbox" id="${sanitizedId}" data-codigo="${codigo}" checked>
        <span>${nome}</span>`;
      panel.appendChild(label);

      const input = label.querySelector('input');
      optionCheckboxes.push(input);

      input.addEventListener('change', (e) => {
        if (e.target.checked) prodFamiliasAtivas.add(codigo);
        else prodFamiliasAtivas.delete(codigo);

        syncToggleState();
        aplicarFiltroProd();           // refaz a tabela
      });
    });

    syncToggleState();

    prodFamiliasLoaded = true;
    if (prodAllDados.length) aplicarFiltroProd();
  } catch (err) {
    console.error('[prod filtro famílias] Falha ao carregar famílias:', err);
    panel.innerHTML = '<span class="filter-error">Não foi possível carregar as famílias.</span>';
  }
}

// Preenche o <select id="estruturaLocalProducao"> com as operações vindas do SQL (public.omie_operacao.operacao)
async function ensureLocalProducaoSelectOptions() {
  const sel = document.getElementById('estruturaLocalProducao');
  if (!sel) return;

  sel.innerHTML = '<option value="">Carregando…</option>';

  try {
    // Usa endpoint já existente que lista operações a partir da tabela public.omie_operacao
    const resp = await fetch('/api/colaboradores/operacoes');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arr = await resp.json(); // [{ id, operacao }]

    const itens = (Array.isArray(arr) ? arr : [])
      .map(x => ({ id: x.id != null ? String(x.id) : '', label: String(x.operacao ?? '').trim() }))
      .filter(x => x.label);

    itens.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

    const esc = (s) => String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const opts = [
      '<option value="">Selecione…</option>',
      ...itens.map(op => `<option value="${esc(op.label)}" data-id="${esc(op.id)}">${esc(op.label)}</option>`)
    ];
    sel.innerHTML = opts.join('');

    // vincula handler de mudança (uma vez)
    if (!sel.dataset.bound) {
      sel.addEventListener('change', onLocalProducaoChange);
      sel.dataset.bound = '1';
    }
  } catch (err) {
    console.warn('[Local de produção] Falha ao carregar operações:', err);
    sel.innerHTML = '<option value="">(não foi possível carregar operações)</option>';
  }
}

// Tenta ler o "Código OMIE" exibido na UI (aba Dados do produto > Dados de cadastro)
function getCodigoOmieFromUI() {
  const tryNum = (t) => {
    const s = String(t || '').trim();
    return /^\d{6,14}$/.test(s) ? Number(s) : null;
  };

  // procura pelo label com texto "Código OMIE" e lê um número próximo
  const labels = Array.from(document.querySelectorAll('.products'))
    .filter(el => /c[óo]digo\s+omie/i.test(el.textContent || ''));
  for (const lb of labels) {
    const scope = lb.closest('li, .row, .wrap, .side-menu, .card, div') || lb.parentElement;
    if (!scope) continue;
    for (const el of scope.querySelectorAll('.status-text, .value, span, div')) {
      const n = tryNum(el.textContent);
      if (n) return n;
    }
  }
  // fallback global
  const any = Array.from(document.querySelectorAll('.status-text, .value, span, div'))
    .map(el => tryNum(el.textContent)).find(Boolean);
  return any || null;
}

// On-change: envia atualização do local de produção para o SQL (omie_estrutura.local_produção)
async function onLocalProducaoChange(ev) {
  try {
    const sel = ev?.currentTarget || ev?.target || document.getElementById('estruturaLocalProducao');
    if (!sel) return;
    const valor = String(sel.value || '').trim(); // label da operação

    const id_produto = getCodigoOmieFromUI();
    if (!id_produto) {
      console.warn('[Local de produção] Código OMIE não encontrado na tela. Abra a guia Dados do produto > Dados de cadastro.');
      return;
    }

    const body = { id_produto, local_producao: valor || null };
    const base = (window.API_BASE || API_BASE || window.location.origin);
    const url  = `${base}/api/pcp/estrutura/localproducao`.replace(/([^:]\/)(\/)+/g,'$1');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const raw = await r.text();
    let js; try { js = JSON.parse(raw); } catch { js = { raw }; }
    if (!r.ok || js?.ok === false) {
      throw new Error(js?.error || `HTTP ${r.status}`);
    }
    // opcional: feedback leve
    sel.title = `Salvo: ${valor || '—'}`;

    // Badge de confirmação temporário ao lado do select
    let badge = sel.parentElement?.querySelector?.('.local-producao-save-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'local-producao-save-badge';
      badge.setAttribute('aria-live', 'polite');
      badge.style.marginLeft = '8px';
      badge.style.padding = '2px 8px';
      badge.style.borderRadius = '12px';
      badge.style.background = '#16a34a'; // verde
      badge.style.color = '#fff';
      badge.style.fontSize = '12px';
      badge.style.display = 'none';
      badge.style.verticalAlign = 'middle';
      sel.insertAdjacentElement('afterend', badge);
    }
    badge.textContent = 'Salvo';
    badge.style.display = 'inline-block';
    // esconde após 2s (reinicia se clicar rápido)
    if (badge._timer) clearTimeout(badge._timer);
    badge._timer = setTimeout(() => {
      badge.style.display = 'none';
    }, 2000);
  } catch (err) {
    console.error('[Local de produção] Falha ao salvar:', err);
    alert('Não foi possível salvar o Local de produção.');
  }
}


async function carregarProducao() {
  const tbody = document.querySelector('#tbl-producao tbody');
  tbody.innerHTML = '<tr><td colspan="7">⏳ Carregando…</td></tr>';

  try {
    const resp = await fetch('/api/armazem/producao', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ pagina:1 })
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha na API');

    prodAllDados   = json.dados;
    prodCurrentPage = 1;
    prodTotalPages  = 1;

    renderProdTable(prodAllDados);
    document.querySelector('#conteudo-producao .almox-pager').style.display = 'none';
    document.getElementById('prodPageInfo').textContent = '1 / 1';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="7">⚠️ Erro ao carregar dados</td></tr>';
  }
}


document.getElementById('menu-armazens').addEventListener('click', e => {
  e.preventDefault();
  window.clearMainContainer?.();
  showArmazem();
});

document.getElementById('menu-solicitacao-transferencia')?.addEventListener('click', async e => {
  e.preventDefault();
  await window.openSolicitacoesTransferencia?.();
});

document.getElementById('solicitacoesTransferRefresh')?.addEventListener('click', () => {
  carregarSolicitacoesTransferencias(true);
});

// Ao abrir "Cadastro de colaboradores", mostra a aba e injeta o botão "+"
// Ao abrir "Cadastro de colaboradores", mostra a aba e injeta o botão "+"
document.getElementById('btn-colaboradores')?.addEventListener('click', (e) => {
  e.preventDefault();
  showMainTab('dadosColaboradores');

  // tenta várias vezes enquanto o módulo termina de montar o DOM
  let tentativas = 0;
  const iv = setInterval(() => {
    tentativas++;
    try { ensureColabCreateButton(); } catch {}
    const ok = !!document.getElementById('btn-colab-create');
    if (ok || tentativas >= 20) clearInterval(iv); // ~3s no total
  }, 150);
});


window.addEventListener('auth:changed', () => {
  try { ensureColabCreateButton(); } catch {}
});


document.querySelectorAll('#armazemTabs .main-header-link')
  .forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showArmazemTab(link.dataset.armTab);   // estoque / transferencia
    });
  });

/* —— Listbox de seleção de estoque —— */
const estoqueLocalSelect = document.getElementById('estoqueLocalSelect');
if (estoqueLocalSelect) {
  estoqueLocalSelect.addEventListener('change', async (e) => {
    almoxLocalAtual = e.target.value;
    await carregarAlmoxarifado();  // Recarrega dados do estoque selecionado
  });
}

  /* ——— paginação ——— */
document.getElementById('almoxPrev').addEventListener('click', () => {
  if (almoxCurrentPage > 1) {
    carregarAlmoxarifado(almoxCurrentPage - 1);
  }
});
document.getElementById('almoxNext').addEventListener('click', () => {
  if (almoxCurrentPage < almoxTotalPages) {
    carregarAlmoxarifado(almoxCurrentPage + 1);
  }
});

/* —— pesquisa em tempo-real —— */
const inpSearch = document.getElementById('almoxSearch');
if (inpSearch) {
  inpSearch.addEventListener('input', aplicarFiltroAlmox);
}

/* —— Botão de filtro Almoxarifado (toggle) —— */
const btnFiltro = document.getElementById('almoxFilterBtn');
if (btnFiltro) {
  btnFiltro.addEventListener('click', (e) => {
    e.stopPropagation(); // impede propagação para o document
    const panel = document.getElementById('almoxFilterPanel');
    if (!panel) return;
    
    const isOpen = panel.classList.contains('is-open');
    if (isOpen) {
      panel.classList.remove('is-open');
      panel.style.display = 'none';
      return;
    }

    panel.classList.add('is-open');
    panel.style.display = 'flex';

    // Centraliza o painel na tela
    panel.style.position = 'fixed';
    panel.style.left = '50%';
    panel.style.top = '50%';
    panel.style.transform = 'translate(-50%, -50%)';
    panel.style.zIndex = '9999';
    
    // carrega famílias se ainda não carregou
    loadAlmoxFamilias();
  });
}

/* —— Botão de atualizar Almoxarifado —— */
const btnAlmoxRefresh = document.getElementById('almoxRefreshBtn');
if (btnAlmoxRefresh) {
  btnAlmoxRefresh.addEventListener('click', async () => {
    btnAlmoxRefresh.disabled = true;
    btnAlmoxRefresh.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i>';
    try {
      await carregarAlmoxarifado();
    } finally {
      btnAlmoxRefresh.disabled = false;
      btnAlmoxRefresh.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    }
  });
}

/* —— Ordenação por colunas —— */
document.querySelectorAll('#tbl-almoxarifado th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const field = th.dataset.sort;
    
    // Se clicar na mesma coluna, inverte a ordem
    if (almoxSortField === field) {
      almoxSortOrder = almoxSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      // Nova coluna: sempre começa em ascendente
      almoxSortField = field;
      almoxSortOrder = 'asc';
    }
    
    // Remove classes de todos os cabeçalhos
    document.querySelectorAll('#tbl-almoxarifado th.sortable').forEach(h => {
      h.classList.remove('sort-asc', 'sort-desc');
    });
    
    // Adiciona classe ao cabeçalho ativo
    th.classList.add(almoxSortOrder === 'asc' ? 'sort-asc' : 'sort-desc');
    
    // Reaplica o filtro (que agora inclui ordenação)
    aplicarFiltroAlmox();
  });
});

/* —— Listbox de seleção de operação (Preparação) —— */
const preparacaoOperacaoSelect = document.getElementById('preparacaoOperacaoSelect');
if (preparacaoOperacaoSelect) {
  preparacaoOperacaoSelect.addEventListener('change', (e) => {
    preparacaoOperacaoAtual = e.target.value;
    filtrarPreparacaoPorOperacao();
  });
}


// Navega para a aba de Detalhes
function navigateToDetalhes(codigo) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
  document.querySelector('[data-target="dadosProduto"]').classList.add('is-active');
  document.getElementById('dadosProduto').style.display = 'block';
  document.querySelector('.main-header').style.display = 'flex';
  window.loadDadosProduto(codigo);
}

const OMIE_SYNC_TASKS = [
  {
    key: 'clientes',
    label: 'clientes_cadastro',
    description: 'Atualiza os cadastros de clientes vindos da Omie.',
    endpoint: '/api/admin/sync/clientes',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar clientes'
  },
  {
    key: 'pedidos',
    label: 'pedidos_venda / pedidos_venda_itens',
    description: 'Sincronização completa dos pedidos e respectivos itens.',
    endpoint: '/api/admin/sync/pedidos/completo',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar pedidos (completo)'
  },
  {
    key: 'pedidos-simples',
    label: 'pedidos_venda (modo simples)',
    description: 'Rotina resumida para atualizar os pedidos mais recentes.',
    endpoint: '/api/admin/sync/pedidos/simples',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar pedidos (simples)'
  },
  {
    key: 'estruturas',
    label: 'omie_estrutura / omie_estrutura_item',
    description: 'Reimporta todas as estruturas de produto listadas na Omie.',
    endpoint: '/api/admin/sync/pcp/estruturas',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar estruturas'
  },
  {
    key: 'produtos-omie',
    label: 'produtos_omie',
    description: 'Sincroniza os produtos cadastrados na Omie para a tabela produtos_omie.',
    endpoint: '/api/admin/sync/produtos-omie',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar produtos Omie'
  }
];

let omieSyncRendered = false;
let omieSyncHandlersReady = false;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[menu_produto] DOMContentLoaded disparou');
  renderOmieSyncButtons();
  ensureOmieSyncBindings();

  const almoxTbody = document.querySelector('#tbl-almoxarifado tbody');
  if (almoxTbody && !almoxTbody.__transferBound) {
    almoxTbody.addEventListener('click', onAlmoxRowClick);
    almoxTbody.__transferBound = true;
  }
  window.renderTransferenciaLista?.();

  const transferTbody = document.getElementById('transferenciaTbody');
  if (transferTbody && !transferTbody.__transferBound) {
    transferTbody.addEventListener('change', (ev) => {
      const cb = ev.target.closest('.transfer-check');
      if (cb) {
        const codigo = cb.dataset.codigo || '';
        const item = transferenciaLista.find(i => i.codigo === codigo);
        if (item) item.selecionado = cb.checked;
        updateTransferControlsState();
        return;
      }
      const input = ev.target.closest('.transfer-qtd');
      if (input) {
        const codigo = input.dataset.codigo || '';
        const item = transferenciaLista.find(i => i.codigo === codigo);
        if (item) {
          item.qtd = sanitizeQtd(input.value, item.qtd || 1);
          input.value = formatQtdInput(item.qtd);
        }
        updateTransferControlsState();
      }
    });
    transferTbody.addEventListener('input', (ev) => {
      const input = ev.target.closest('.transfer-qtd');
      if (!input) return;
      const codigo = input.dataset.codigo || '';
      const item = transferenciaLista.find(i => i.codigo === codigo);
      if (!item) return;
      const num = parseFloat(input.value.replace(',', '.'));
      if (Number.isFinite(num) && num >= 0) item.qtd = num;
    });
    transferTbody.__transferBound = true;
  }

  const transferSelectAllBtn = document.getElementById('transferSelectAllBtn');
  const transferQtdBulk = document.getElementById('transferQtdBulk');
  const transferAcaoBtn = document.getElementById('transferenciaBtn');

  if (transferQtdBulk && !transferQtdBulk.__transferBound) {
    transferQtdBulk.__transferBound = true;
    const aplicarQtdBulk = () => {
      if (!transferenciaLista.length) return;
      const valor = sanitizeQtd(transferQtdBulk.value, null);
      if (valor === null) return;
  transferenciaLista.forEach(item => { item.qtd = valor; });
  window.renderTransferenciaLista?.();
      transferQtdBulk.value = formatQtdInput(valor);
    };
    transferQtdBulk.addEventListener('input', aplicarQtdBulk);
    transferQtdBulk.addEventListener('change', aplicarQtdBulk);
    transferQtdBulk.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); aplicarQtdBulk(); }
    });
  }

  if (transferSelectAllBtn && !transferSelectAllBtn.__transferBound) {
    transferSelectAllBtn.__transferBound = true;
    transferSelectAllBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!transferenciaLista.length) return;
      const selecionarTudo = transferSelectAllBtn.dataset.state !== 'all';
      transferenciaLista.forEach(item => {
        item.selecionado = selecionarTudo;
        item.qtd = sanitizeQtd(item.qtd);
      });
      window.renderTransferenciaLista?.();
    });
  }

  if (transferAcaoBtn && !transferAcaoBtn.__transferBound) {
    transferAcaoBtn.__transferBound = true;
    transferAcaoBtn.addEventListener('click', async () => {
      const selecionados = transferenciaLista.filter(item => item && item.selecionado !== false);
      if (!selecionados.length) {
        alert('Selecione pelo menos um item para transferir.');
        return;
      }

      const origemSel = document.getElementById('transferOrigem');
      const destinoSel = document.getElementById('transferDestino');
      const origem = String(origemSel?.value || '').trim() || TRANSFER_DEFAULT_ORIGEM;
      const destino = String(destinoSel?.value || '').trim() || TRANSFER_DEFAULT_DESTINO;

      if (!origem || !destino) {
        alert('Informe origem e destino da transferência.');
        return;
      }

      const solicitanteLabel = document.getElementById('userNameDisplay');
      const solicitanteRaw = String(solicitanteLabel?.textContent || '').trim();
      const solicitante = solicitanteRaw && solicitanteRaw !== '—' ? solicitanteRaw : null;

      const payload = {
        origem,
        destino,
        solicitante,
        itens: selecionados.map(item => ({
          codigo: item.codigo,
          descricao: item.descricao,
          qtd: item.qtd,
          codigo_produto: item.codOmie || item.codigo_produto || null,
          codOmie: item.codOmie || null
        }))
      };

      const originalHtml = transferAcaoBtn.innerHTML;
      transferAcaoBtn.disabled = true;
      transferAcaoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

      try {
        const resp = await fetch('/api/transferencias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        let resposta;
        try {
          resposta = await resp.json();
        } catch (jsonErr) {
          throw new Error('Resposta inválida do servidor.');
        }

        if (!resp.ok || !resposta?.ok) {
          const msg = resposta?.error || resposta?.detail || `Falha ao registrar transferência (HTTP ${resp.status}).`;
          throw new Error(msg);
        }

        alert('Transferência registrada com sucesso.');
        transferenciaLista = [];
        window.renderTransferenciaLista?.();
        updateTransferControlsState();
        if (transferQtdBulk) transferQtdBulk.value = '';
        solicitacoesTransferenciasLoaded = false;
        carregarSolicitacoesTransferencias(true).catch(() => {});
      } catch (err) {
        console.error('[transferencia] registrar', err);
        alert(`Falha ao registrar transferência: ${err?.message || err}`);
      } finally {
        transferAcaoBtn.innerHTML = originalHtml;
        transferAcaoBtn.disabled = false;
        updateTransferControlsState();
      }
    });
  }

  const transferSearchInput    = document.getElementById('transferSearch');
  const transferSearchDropdown = document.querySelector('.transfer-search-dropdown');
  const transferSearchResults  = document.getElementById('transferSearchResults');
  if (transferSearchInput && transferSearchResults && !transferSearchInput.__transferBound) {
    transferSearchInput.__transferBound = true;
    let debounceId = null;

    const hideTransferResults = () => {
      if (debounceId) {
        clearTimeout(debounceId);
        debounceId = null;
      }
      if (transferSearchDropdown) transferSearchDropdown.style.display = 'none';
      transferSearchResults.innerHTML = '';
      transferSearchResults.scrollTop = 0;
      transferSearchResults.style.maxHeight = '';
      transferSearchResults.style.height = '';
      transferSearchResults.style.overflowY = '';
    };

    transferSearchInput.addEventListener('input', () => {
      const termo = transferSearchInput.value.trim();
      if (debounceId) clearTimeout(debounceId);

      if (termo.length < 2) {
        hideTransferResults();
        return;
      }

      debounceId = setTimeout(async () => {
        if (transferSearchDropdown) transferSearchDropdown.style.display = 'block';
        transferSearchResults.innerHTML = '<li class="info">Buscando…</li>';
        transferSearchResults.scrollTop = 0;
        transferSearchResults.style.maxHeight = '';
        transferSearchResults.style.height = 'auto';
        transferSearchResults.style.overflowY = 'hidden';

        try {
          const resp = await fetch(`/api/produtos/search?q=${encodeURIComponent(termo)}&limit=40`, { credentials: 'include' });
          const json = await resp.json();
          const itens = Array.isArray(json?.data) ? json.data : [];

          if (!itens.length) {
            transferSearchResults.innerHTML = '<li class="no-results">Nenhum item encontrado</li>';
            transferSearchResults.scrollTop = 0;
            transferSearchResults.style.maxHeight = '';
            transferSearchResults.style.height = 'auto';
            transferSearchResults.style.overflowY = 'hidden';
            return;
          }

          await ensureAlmoxDadosCarregados().catch(() => {});

          transferSearchResults.innerHTML = '';
          transferSearchResults.scrollTop = 0;
          itens.forEach(prod => {
            const li = document.createElement('li');
            li.dataset.codigo = prod.codigo || '';
            li.dataset.descricao = prod.descricao || '';
            li.innerHTML = `<span class="codigo">${escapeHtml(prod.codigo || '')}</span><span class="descricao">${escapeHtml(prod.descricao || '')}</span>`;
            transferSearchResults.appendChild(li);
          });

          const first = transferSearchResults.firstElementChild;
          const itemHeight = first ? first.getBoundingClientRect().height || 44 : 44;
          const totalHeight = itens.length * itemHeight;
          const maxVisible = itemHeight * 5;
          transferSearchResults.style.maxHeight = `${maxVisible}px`;
          if (totalHeight > maxVisible) {
            transferSearchResults.style.height = `${maxVisible}px`;
            transferSearchResults.style.overflowY = 'auto';
          } else {
            transferSearchResults.style.height = 'auto';
            transferSearchResults.style.overflowY = 'hidden';
          }
        } catch (err) {
          console.error('[transferencia] autocomplete', err);
          transferSearchResults.innerHTML = '<li class="error">Erro ao buscar</li>';
          transferSearchResults.scrollTop = 0;
          transferSearchResults.style.maxHeight = '';
          transferSearchResults.style.height = 'auto';
          transferSearchResults.style.overflowY = 'hidden';
        }
      }, 150);
    });

    transferSearchResults.addEventListener('click', async (ev) => {
      const li = ev.target.closest('li[data-codigo]');
      if (!li || li.classList.contains('info') || li.classList.contains('error') || li.classList.contains('no-results')) return;

      const codigo = li.dataset.codigo || '';
      const descricao = li.dataset.descricao || '';
      await ensureAlmoxDadosCarregados().catch(() => {});
      const extra = almoxAllDados.find(item => item.codigo === codigo) || {};

      adicionarItemTransferencia({
        codigo,
        descricao,
        min: extra.min ?? 0,
        fisico: extra.fisico ?? 0,
        saldo: extra.saldo ?? 0,
        cmc: extra.cmc ?? 0,
        codOmie: extra.codOmie ?? '',
        qtd: 1
      });

      transferSearchInput.value = '';
      hideTransferResults();
      showArmazemTab('transferencia');
    });

    transferSearchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        transferSearchInput.value = '';
        hideTransferResults();
      }
    });

    transferSearchInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!document.activeElement || document.activeElement.closest('#transferSearchResults') === null) {
          hideTransferResults();
        }
      }, 150);
    });

    document.addEventListener('click', (ev) => {
      if (ev.target === transferSearchInput) return;
      if (transferSearchDropdown && transferSearchDropdown.contains(ev.target)) return;
      hideTransferResults();
    });
  }

  const solicitacoesTbody = document.getElementById('solicitacoesTransferTbody');
  if (solicitacoesTbody && !solicitacoesTbody.__approveBound) {
    solicitacoesTbody.__approveBound = true;
    solicitacoesTbody.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.btn-approve-transfer');
      if (!btn) return;

      const id = Number(btn.dataset.id);
      if (!Number.isInteger(id)) {
        alert('Não foi possível identificar a solicitação selecionada.');
        return;
      }

      const usuario = String(document.getElementById('userNameDisplay')?.textContent || '').trim();
      if (!usuario || usuario === 'Usuário' || usuario === '—') {
        alert('Não foi possível identificar o usuário atual. Faça login novamente.');
        return;
      }

      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Aprovando…';

      try {
        const resp = await fetch(`/api/transferencias/${id}/aprovar`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aprovadoPor: usuario })
        });

        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json?.ok) {
          const msg = json?.error || `Falha ao aprovar (HTTP ${resp.status}).`;
          throw new Error(msg);
        }

        const mensagem = json?.descricao_status || json?.message || json?.mensagem || 'Transferência aprovada com sucesso.';
        if (mensagem) alert(mensagem);
        await carregarSolicitacoesTransferencias(true);
        return;
      } catch (err) {
        console.error('[transferencias] aprovar', err);
        alert(err?.message || 'Falha ao aprovar a solicitação.');
        btn.disabled = false;
        btn.textContent = originalLabel;
        return;
      }
    });
  }
  carregarLocaisEstoque();
  // abre o painel Início como padrão
  showMainTab('paginaInicio');

  const setupIappSyncButton = (buttonId, {
    endpoint,
    inputId,
    uploadingLabel = 'Sincronizando…',
    contextLabel = 'Sincronização'
  } = {}) => {
    const btn = document.getElementById(buttonId);
    if (!btn || btn.dataset.iappSyncBound || !endpoint) return;
    btn.dataset.iappSyncBound = 'true';

    const originalInnerHTML = btn.innerHTML;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fileInput.style.display = 'none';
    fileInput.id = inputId || `${buttonId}-input`;
    document.body.appendChild(fileInput);

    let busy = false;

    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (busy) return;
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file || busy) return;

      busy = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('is-disabled');
      btn.innerHTML = uploadingLabel;

      try {
        const formData = new FormData();
        formData.append('file', file);

        const resp = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });

        let payload;
        try {
          payload = await resp.json();
        } catch {
          throw new Error('Resposta inesperada do servidor.');
        }

        if (!resp.ok || !payload?.ok) {
          const msg = payload?.error || `Falha ao sincronizar (HTTP ${resp.status}).`;
          throw new Error(msg);
        }

        const makeSummary = (sheetPayload) => {
          const inserted = Number(sheetPayload?.inserted || 0);
          const updated = Number(sheetPayload?.updated || 0);
          const unchanged = Number(sheetPayload?.unchanged || 0);
          const workbookRows = Number(sheetPayload?.workbookRows || 0);
          const existing = Number(sheetPayload?.existingCount || 0);
          const label = sheetPayload?.sheetName || '(Aba desconhecida)';
          return { inserted, updated, unchanged, workbookRows, existing, label };
        };

        if (payload.sheets && typeof payload.sheets === 'object') {
          const summaries = Object.values(payload.sheets).map(makeSummary);
          const totalInserted = summaries.reduce((sum, s) => sum + s.inserted, 0);
          const totalUpdated = summaries.reduce((sum, s) => sum + s.updated, 0);
          const details = summaries
            .map(s => `${s.label}: ${s.inserted} inserida(s), ${s.updated} atualizada(s), ${s.unchanged} inalterada(s) (planilha ${s.workbookRows}, registros anteriores ${s.existing})`)
            .join('\n');
          const headerMsg = (totalInserted + totalUpdated) > 0
            ? `${contextLabel} concluída!`
            : `${contextLabel} concluída: nenhuma alteração encontrada.`;
          alert(`${headerMsg}\n${details}`);
        } else {
          const { inserted, updated, unchanged, workbookRows, existing } = makeSummary(payload);
          const headerMsg = (inserted + updated) > 0
            ? `${contextLabel} concluída!\nInseridas: ${inserted}. Atualizadas: ${updated}.`
            : `${contextLabel} concluída: nenhuma alteração encontrada.`;
          alert(`${headerMsg}\nInalteradas: ${unchanged}.\nLinhas na planilha: ${workbookRows}.\nRegistros anteriores: ${existing}.`);
        }
      } catch (err) {
        console.error(`[iapp-sync] erro ao processar planilha (${buttonId}):`, err);
        alert(`Erro ao sincronizar planilha: ${err?.message || err}`);
      } finally {
        busy = false;
        btn.innerHTML = originalInnerHTML;
        btn.classList.remove('is-disabled');
        btn.removeAttribute('aria-disabled');
        fileInput.value = '';
      }
    });
  };

  setupIappSyncButton('menu-iapp-sincronizar-op-iapp', {
    endpoint: '/api/iapp/historico-op/sync',
    inputId: 'iapp-sync-op-input',
    contextLabel: 'Sincronização do histórico de OP IAPP'
  });

  setupIappSyncButton('menu-iapp-sincronizar-lista-pecas', {
    endpoint: '/api/iapp/historico-estrutura/sync',
    inputId: 'iapp-sync-lista-pecas-input',
    contextLabel: 'Sincronização da lista de peças'
  });

  setupIappSyncButton('menu-iapp-sincronizar-op-glide', {
    endpoint: '/api/glide/historico-op/sync',
    inputId: 'iapp-sync-op-glide-input',
    contextLabel: 'Sincronização do histórico de OP GLIDE'
  });

  setupIappSyncButton('menu-iapp-sincronizar-at', {
    endpoint: '/api/assistencia/sync',
    inputId: 'iapp-sync-at-input',
    contextLabel: 'Sincronização AT'
  });

  setupIappSyncButton('menu-iapp-sincronizar-originalis', {
    endpoint: '/api/originalis/pedidos/sync',
    inputId: 'iapp-sync-originalis-input',
    contextLabel: 'Sincronização dos pedidos Originalis'
  });

  setupIappSyncButton('menu-iapp-sincronizar-pre2024', {
    endpoint: '/api/iapp/historico-pre2024/sync',
    inputId: 'iapp-sync-pre2024-input',
    contextLabel: 'Sincronização &lt; 2024'
  });

  // Atalho: sincronização de Produtos (Omie) direto pelo menu IAPP
  // Objetivo: permitir que o usuário dispare a rotina sem precisar navegar manualmente até a aba "Atualizar tabelas Omie".
  const menuIappSyncProdutosOmie = document.getElementById('menu-iapp-sincronizar-produtos-omie');
  menuIappSyncProdutosOmie?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    // marca seleção no menu
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuIappSyncProdutosOmie.classList.add('is-active');

    // abre a aba "Atualizar tabelas Omie" e garante que os botões existam
    renderOmieSyncButtons();
    ensureOmieSyncBindings();
    showMainTab('omieAtualizarTabelas');
    // Não dispara mais automaticamente. Execução somente pelo botão "Atualizar produtos Omie".
  });

  function renderClientePedidosCard(entry) {
    const raw = entry?.raw || {};
    const nome = raw.razao_social || raw.nome_fantasia || `Cliente ${formatQualidadeValue(raw.codigo_cliente_omie)}`;
    const fantasia = raw.nome_fantasia && raw.nome_fantasia !== raw.razao_social ? raw.nome_fantasia : null;
    const doc = raw.cnpj_cpf ? `CNPJ/CPF: ${formatQualidadeValue(raw.cnpj_cpf)}` : null;
    const codigoCliente = raw.codigo_cliente_omie ? `Código Omie: ${formatQualidadeValue(raw.codigo_cliente_omie)}` : null;
    const grupos = Array.isArray(raw.pedidos) ? raw.pedidos : [];

    const formatDateTime = (value) => {
      if (!value) return '—';
      try {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        }
      } catch (_err) {}
      return formatQualidadeValue(value);
    };

    const pedidosHtml = grupos.length
      ? grupos.map((grupo) => {
          const codigo = grupo?.codigo ? escapeHtml(formatQualidadeValue(grupo.codigo)) : '—';
          const descricao = grupo?.descricao ? escapeHtml(formatQualidadeValue(grupo.descricao)) : 'Sem descrição';
          const totalQuantidade = grupo?.total_quantidade === null || grupo?.total_quantidade === undefined
            ? '—'
            : escapeHtml(formatQualidadeValue(grupo.total_quantidade));
          const pedidosLista = Array.isArray(grupo?.pedidos) ? grupo.pedidos : [];
          const pedidosListaHtml = pedidosLista.length
            ? pedidosLista.map((pedido) => {
                const pedidoLabel = pedido?.numero_pedido || pedido?.codigo_pedido || '—';
                const pedidoDisplay = escapeHtml(formatQualidadeValue(pedidoLabel));
                const quantidade = pedido?.quantidade === null || pedido?.quantidade === undefined
                  ? '—'
                  : escapeHtml(formatQualidadeValue(pedido.quantidade));
                const updated = escapeHtml(formatDateTime(pedido?.updated_at));
                const pedidoCliente = pedido?.numero_pedido_cliente
                  ? `<small>${escapeHtml(`Cliente: ${formatQualidadeValue(pedido.numero_pedido_cliente)}`)}</small>`
                  : '';
                return `
                  <li class="qualidade-pedido-item">
                    <span class="qualidade-pedido-id">${pedidoDisplay}${pedidoCliente}</span>
                    <span class="qualidade-pedido-qtd">${quantidade}</span>
                    <span class="qualidade-pedido-date">${updated}</span>
                  </li>`;
              }).join('')
            : '<li class="qualidade-pedido-item"><span class="qualidade-pedido-id">—</span><span class="qualidade-pedido-qtd">—</span><span class="qualidade-pedido-date">—</span></li>';

          return `
            <div class="qualidade-pedido-card">
              <div class="qualidade-pedido-header">
                <span class="qualidade-pedido-codigo">${codigo}</span>
                <span class="qualidade-pedido-descricao">${descricao}</span>
                <span class="qualidade-pedido-total">Total: ${totalQuantidade}</span>
              </div>
              <ul class="qualidade-pedido-items">
                <li class="qualidade-pedido-item qualidade-pedido-item-head">
                  <span class="qualidade-pedido-id">Pedidos</span>
                  <span class="qualidade-pedido-qtd">Qtd</span>
                  <span class="qualidade-pedido-date">Atualizado</span>
                </li>
                ${pedidosListaHtml}
              </ul>
            </div>`;
        }).join('')
      : '<div class="qualidade-cliente-empty">Nenhum pedido encontrado para este cliente.</div>';

    const headerExtra = [fantasia, doc, codigoCliente]
      .filter(Boolean)
      .map((value) => `<span>${escapeHtml(value)}</span>`)
      .join('');

  return `
      <div class="qualidade-cliente-card">
        <div class="qualidade-cliente-header">
          <span class="qualidade-cliente-nome">${escapeHtml(formatQualidadeValue(nome))}</span>
          ${headerExtra ? `<div class="qualidade-cliente-meta">${headerExtra}</div>` : ''}
        </div>
        <div class="qualidade-pedidos-list">
          ${pedidosHtml}
        </div>
      </div>`;
  }

  function renderOmieSyncButtons(force = false) {
    const listEl = document.getElementById('omie-sync-list');
    const emptyEl = document.getElementById('omie-sync-empty');
    if (!listEl || !emptyEl) return;
    if (omieSyncRendered && !force) return;
    omieSyncRendered = true;

    if (!OMIE_SYNC_TASKS.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    listEl.innerHTML = OMIE_SYNC_TASKS.map((task) => {
      const base = `
      <div class="omie-sync-card" data-omie-key="${escapeHtml(task.key)}">
        <h3>${escapeHtml(task.label)}</h3>
        <p>${escapeHtml(task.description)}</p>
        <button
          type="button"
          class="omie-sync-button"
          data-omie-action="${escapeHtml(task.key)}"
        >${escapeHtml(task.buttonLabel || 'Atualizar')}</button>
        <div class="omie-sync-status" id="omie-sync-status-${escapeHtml(task.key)}"></div>
      `;

      if (task.key === 'produtos-omie') {
        return base + `
          <div class="omie-sync-schedule">
            <div class="omie-sync-schedule-row">
              <label for="omie-schedule-time">Agendar horário diário</label>
              <input type="time" id="omie-schedule-time" class="omie-schedule-time" />
              <label class="omie-schedule-enabled-label">
                <input type="checkbox" id="omie-schedule-enabled" /> Ativo
              </label>
              <button type="button" class="omie-schedule-save">Agendar</button>
            </div>
            <div class="omie-sync-filter">
              <div class="omie-sync-schedule-row">
                <label for="omie-filter-column">Filtrar por coluna</label>
                <select id="omie-filter-column"></select>
                <button type="button" class="omie-filter-load">Carregar opções</button>
              </div>
              <div id="omie-filter-values" class="omie-filter-values"></div>
            </div>
            <div class="omie-sync-next" id="omie-schedule-next"></div>
            <div class="omie-logs">
              <div class="omie-sync-schedule-row">
                <button type="button" class="omie-logs-toggle">Mostrar logs</button>
                <button type="button" class="omie-logs-refresh" style="display:none;">Atualizar logs</button>
                <label>
                  <span style="opacity:.8;">Linhas:</span>
                  <input id="omie-logs-lines" type="number" min="50" max="1000" value="200" style="width:80px;">
                </label>
              </div>
              <div id="omie-logs-box" class="omie-logs-box" style="display:none;"></div>
            </div>
          </div>
        </div>`;
      }
      return base + `</div>`;
    }).join('');

    // carrega o agendamento (se houver) para 'produtos-omie'
    try { loadProdutosOmieSchedule(); } catch {}
  }

  async function runOmieSyncTask(taskKey) {
    const task = OMIE_SYNC_TASKS.find(t => t.key === taskKey);
    if (!task) return;
    const button = document.querySelector(`.omie-sync-button[data-omie-action="${taskKey}"]`);
    const statusEl = document.getElementById(`omie-sync-status-${taskKey}`);
    if (!button || !statusEl) return;

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Sincronizando…';
    statusEl.textContent = 'Executando sincronização…';
    statusEl.classList.remove('is-success', 'is-error');
    statusEl.classList.add('is-running');

    const opts = {
      method: task.method || 'POST',
      credentials: 'include',
      headers: {}
    };
    // Corpo da requisição: para 'produtos-omie', incluir filtro selecionado (se houver)
    let bodyPayload = task.body !== undefined ? { ...task.body } : null;
    if (taskKey === 'produtos-omie') {
      const colEl = document.getElementById('omie-filter-column');
      const selectedValues = Array.from(document.querySelectorAll('#omie-filter-values input[type="checkbox"]:checked'))
        .map(cb => cb.value);
      const filter = (colEl && colEl.value && selectedValues.length) ? { column: colEl.value, values: selectedValues } : null;
      bodyPayload = { ...(bodyPayload||{}), filter };
    }
    if (bodyPayload) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(bodyPayload);
    } else {
      if (Object.keys(opts.headers).length === 0) delete opts.headers;
    }

    const startedAt = Date.now();
    try {
      const resp = await fetch(task.endpoint, opts);
      let payload = null;
      const text = await resp.text();
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }

      if (!resp.ok) {
        const errMsg =
          (payload && typeof payload === 'object' && payload.error) ||
          (typeof payload === 'string' && payload) ||
          `Falha HTTP ${resp.status}`;
        throw new Error(errMsg);
      }

      if (payload && typeof payload === 'object' && payload.ok === false && payload.error) {
        throw new Error(payload.error);
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      let detail = '';
      if (payload && typeof payload === 'object') {
        if (payload.started) {
          // Execução assíncrona: orienta o usuário e inicia uma sondagem breve do histórico
          detail = payload.message || 'Sincronização iniciada.';
          try {
            // pequena sondagem 3x para buscar o último histórico e exibir no status
            for (let i=0; i<3; i++) {
              await new Promise(r => setTimeout(r, 1500));
              const s = await fetch('/api/admin/schedule/produtos-omie', { credentials: 'include' });
              const j = await s.json().catch(() => null);
              if (j && j.last_summary) {
                // mostra um resumo curto no status
                const short = typeof j.last_summary === 'string' ? j.last_summary.slice(0, 160) : JSON.stringify(j.last_summary).slice(0,160);
                detail = `Iniciado · Último: ${short}`;
                break;
              }
            }
          } catch {}

          // Auto-refresh do painel de logs por ~30s, se estiver aberto
          if (taskKey === 'produtos-omie') {
            const box = document.getElementById('omie-logs-box');
            const linesEl = document.getElementById('omie-logs-lines');
            const isOpen = box && box.style.display !== 'none';
            if (isOpen) {
              const started = Date.now();
              const maxMs = 30000; // 30s
              const intervalMs = 2000; // a cada 2s
              const refreshOnce = async () => {
                const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
                try { await loadProdutosOmieLogs(n); } catch {}
              };
              try { await refreshOnce(); } catch {}
              if (window.__omieLogsTimer) clearInterval(window.__omieLogsTimer);
              window.__omieLogsTimer = setInterval(async () => {
                if (Date.now() - started > maxMs) {
                  clearInterval(window.__omieLogsTimer);
                  window.__omieLogsTimer = null;
                  return;
                }
                await refreshOnce();
              }, intervalMs);
            }
          }
        } else if (payload.message) detail = payload.message;
        else if (payload.produtos_processados != null) {
          detail = `${payload.produtos_processados} registros processados`;
        } else if (payload.pedidos_processados != null) {
          detail = `${payload.pedidos_processados} registros processados`;
        } else if (payload.paginas_processadas != null) {
          detail = `${payload.paginas_processadas} página(s) processadas`;
        }
      } else if (typeof payload === 'string' && payload.trim()) {
        detail = payload.trim().slice(0, 200);
      }
      statusEl.textContent = detail
        ? `Concluído em ${elapsed}s · ${detail}`
        : `Concluído em ${elapsed}s`;
      statusEl.classList.remove('is-error', 'is-running');
      statusEl.classList.add('is-success');
    } catch (err) {
      statusEl.textContent = `Erro ao sincronizar: ${err.message || err}`;
      statusEl.classList.remove('is-success', 'is-running');
      statusEl.classList.add('is-error');
      console.error('[omie-sync]', err);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
      // se for produtos-omie, atualiza logs (se painel estiver aberto)
      if (taskKey === 'produtos-omie') {
        const box = document.getElementById('omie-logs-box');
        if (box && box.style.display !== 'none') {
          const linesEl = document.getElementById('omie-logs-lines');
          const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
          try { await loadProdutosOmieLogs(n); } catch {}
        }
      }
    }
  }

  function ensureOmieSyncBindings() {
    const listEl = document.getElementById('omie-sync-list');
    if (!listEl || omieSyncHandlersReady) return;
    omieSyncHandlersReady = true;
    listEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.omie-sync-button');
      if (!btn) return;
      ev.preventDefault();
      const key = btn.dataset.omieAction;
      if (key) runOmieSyncTask(key);
    });

    // bind salvar agendamento
    listEl.addEventListener('click', async (ev) => {
      const saveBtn = ev.target.closest('.omie-schedule-save');
      if (!saveBtn) return;
      ev.preventDefault();
      try {
        const timeEl = document.getElementById('omie-schedule-time');
        const enabledEl = document.getElementById('omie-schedule-enabled');
        const colEl = document.getElementById('omie-filter-column');
        const selectedValues = Array.from(document.querySelectorAll('#omie-filter-values input[type="checkbox"]:checked')).map(cb => cb.value);
        if (!timeEl) return;
        const time = (timeEl.value || '').trim();
        const enabled = !!(enabledEl && enabledEl.checked);
        if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(time)) {
          alert('Informe um horário válido (HH:MM).');
          return;
        }
        const resp = await fetch('/api/admin/schedule/produtos-omie', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ time, enabled, filter_column: colEl?.value || null, filter_values: selectedValues })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data?.ok === false) {
          const msg = data?.error || `Falha HTTP ${resp.status}`;
          alert('Erro ao salvar agendamento: ' + msg);
          return;
        }
        updateProdutosOmieScheduleUI(data);
        alert('Agendamento salvo.');
      } catch (e) {
        alert('Erro ao salvar agendamento: ' + (e?.message || e));
      }
    });

    // carregar colunas disponíveis
    loadProdutosOmieFilterColumns();

    // carregar valores distintos para a coluna escolhida
    listEl.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.omie-filter-load');
      if (!btn) return;
      ev.preventDefault();
      const colEl = document.getElementById('omie-filter-column');
      if (!colEl || !colEl.value) { alert('Selecione uma coluna.'); return; }
      await loadProdutosOmieFilterValues(colEl.value);
    });

    // logs: toggle e refresh
    listEl.addEventListener('click', async (ev) => {
      const toggle = ev.target.closest('.omie-logs-toggle');
      if (toggle) {
        ev.preventDefault();
        const box = document.getElementById('omie-logs-box');
        const refresh = document.querySelector('.omie-logs-refresh');
        const linesEl = document.getElementById('omie-logs-lines');
        const isHidden = !box || box.style.display === 'none';
        if (isHidden) {
          if (box) box.style.display = 'block';
          if (refresh) refresh.style.display = 'inline-block';
          toggle.textContent = 'Ocultar logs';
          const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
          await loadProdutosOmieLogs(n);
        } else {
          if (box) box.style.display = 'none';
          if (refresh) refresh.style.display = 'none';
          toggle.textContent = 'Mostrar logs';
          if (window.__omieLogsTimer) { clearInterval(window.__omieLogsTimer); window.__omieLogsTimer = null; }
        }
        return;
      }
      const refresh = ev.target.closest('.omie-logs-refresh');
      if (refresh) {
        ev.preventDefault();
        const linesEl = document.getElementById('omie-logs-lines');
        const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
        await loadProdutosOmieLogs(n);
      }
    });
  }

  async function loadProdutosOmieSchedule() {
    try {
      const resp = await fetch('/api/admin/schedule/produtos-omie', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Falha HTTP ${resp.status}`);
      updateProdutosOmieScheduleUI(data);
      // popula colunas e valores conforme configuração salva
      await loadProdutosOmieFilterColumns(data?.filter_column || null);
      if (data?.filter_column) await loadProdutosOmieFilterValues(data.filter_column, new Set(data?.filter_values || []));
    } catch (e) {
      // silencioso; apenas não preenche o UI
      console.warn('[omie-schedule] não foi possível carregar:', e?.message || e);
    }
  }

  function updateProdutosOmieScheduleUI(conf) {
    const timeEl = document.getElementById('omie-schedule-time');
    const enabledEl = document.getElementById('omie-schedule-enabled');
    const nextEl = document.getElementById('omie-schedule-next');
    if (timeEl && conf?.time) timeEl.value = conf.time;
    if (enabledEl && typeof conf?.enabled === 'boolean') enabledEl.checked = !!conf.enabled;
    if (nextEl) {
      if (conf?.enabled && conf?.next_run_iso) {
        const dt = new Date(conf.next_run_iso);
        const fmt = dt.toLocaleString();
        nextEl.textContent = `Próxima execução: ${fmt}`;
      } else if (conf?.time) {
        nextEl.textContent = 'Agendamento desativado';
      } else {
        nextEl.textContent = '';
      }
    }
    const last = document.createElement('div');
    last.className = 'omie-sync-next';
    if (conf?.last_run_at) {
      const ok = conf?.last_ok === true ? 'sucesso' : (conf?.last_ok === false ? 'falha' : 'desconhecido');
      const when = new Date(conf.last_run_at).toLocaleString();
      last.textContent = `Última execução: ${when} (${ok})`;
    }
    const container = document.querySelector('.omie-sync-card[data-omie-key="produtos-omie"] .omie-sync-schedule');
    if (container) {
      const old = container.querySelector('.omie-sync-last');
      if (old) old.remove();
      last.classList.add('omie-sync-last');
      container.appendChild(last);
    }
  }

  async function loadProdutosOmieFilterColumns(selected = null) {
    try {
      const resp = await fetch('/api/admin/schedule/produtos-omie/columns', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) return;
      const sel = document.getElementById('omie-filter-column');
      if (!sel) return;
      sel.innerHTML = '<option value="">– selecione –</option>' + (data.columns||[]).map(c => `<option value="${escapeHtml(c.key)}" ${selected===c.key?'selected':''}>${escapeHtml(c.label)}</option>`).join('');
    } catch {}
  }

  async function loadProdutosOmieFilterValues(column, preselected = new Set()) {
    try {
      const resp = await fetch(`/api/admin/schedule/produtos-omie/column-values?column=${encodeURIComponent(column)}`, { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) return;
      const box = document.getElementById('omie-filter-values');
      if (!box) return;
      if (!Array.isArray(data.values) || !data.values.length) {
        box.innerHTML = '<div class="content-note">Sem valores para esta coluna.</div>';
        return;
      }
      const TIPOITEM_LABEL = {
        '00':'Mercadoria para revenda','01':'Matéria-prima','02':'Embalagem','03':'Produto em processo','04':'Produto acabado','05':'Subproduto','06':'Produto intermediário','07':'Material de uso e consumo','08':'Ativo imobilizado','09':'Serviço','10':'Outros insumos','99':'Outras','KT':'Kit'
      };
      const allId = 'omie-filter-all';
      box.innerHTML = [
        `<label class="omie-filter-all"><input type="checkbox" id="${allId}"> <strong>Selecionar todos</strong></label>`,
        '<div class="omie-filter-grid">',
        ...data.values.map(v => {
          const checked = preselected.has(String(v));
          const display = column === 'tipoitem' ? `${String(v)} — ${TIPOITEM_LABEL[String(v)] || ''}` : String(v) || '(vazio)';
          return `<label><input type="checkbox" value="${escapeHtml(String(v))}" ${checked?'checked':''}/> <span>${escapeHtml(display)}</span></label>`;
        }),
        '</div>'
      ].join('');
      // toggle marcar todos
      const all = document.getElementById(allId);
      if (all) {
        all.addEventListener('change', () => {
          box.querySelectorAll('input[type="checkbox"]').forEach(cb => { if (cb !== all) cb.checked = all.checked; });
        });
      }
    } catch {}
  }

  async function loadProdutosOmieLogs(lines = 200) {
    try {
      const resp = await fetch(`/api/admin/schedule/produtos-omie/logs?lines=${encodeURIComponent(lines)}`, { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) throw new Error(data?.error || `Falha HTTP ${resp.status}`);
      const box = document.getElementById('omie-logs-box');
      if (!box) return;
      const content = (data.lines || []).map(l => escapeHtml(l)).join('\n');
      box.innerHTML = `<pre class="omie-logs-pre">${content}</pre>`;
    } catch (e) {
      const box = document.getElementById('omie-logs-box');
      if (box) box.innerHTML = `<div class="content-note">Erro ao carregar logs: ${escapeHtml(e?.message || String(e))}</div>`;
    }
  }

  const QUALIDADE_OS_GROUPS = [
    { key: 'controle_assistencia_tecnica', label: "Histórico de OS's" },
    { key: 'historico_op_glide', label: 'Histórico OP e NS', subtitle: 'GLIDE' },
    { key: 'historico_op_glide_f_escopo', label: 'Histórico OP e NS', subtitle: 'GLIDE (F Escopo)' },
    { key: 'historico_op_iapp', label: 'Histórico OP' },
    { key: 'historico_pedido_originalis', label: 'Histórico NF/OP/Pedidos' },
    { key: 'pedidos_por_cliente', label: 'Pedidos por Cliente', subtitle: 'Clientes e pedidos' },
    { key: 'historico_pre2024', label: 'Histórico pré-2024', subtitle: 'Pedidos anteriores a 2024' }
  ];
  const QUALIDADE_SOURCE_META = {
    controle_assistencia_tecnica: {
      keyColumns: ['protc'],
      extras: [{ field: 'protc', label: 'OS' }]
    },
    historico_op_glide: {
      keyColumns: ['ordem_de_producao', 'pedido'],
      extras: [
        { field: 'ordem_de_producao', label: 'OP' },
        { field: 'pedido', label: 'Pedido/NS' }
      ]
    },
    historico_op_glide_f_escopo: {
      keyColumns: ['ordem_de_producao', 'pedido'],
      extras: [
        { field: 'ordem_de_producao', label: 'OP' },
        { field: 'pedido', label: 'Pedido/NS' }
      ]
    },
    historico_op_iapp: {
      keyColumns: ['lote_antecipado'],
      extras: [
        { field: 'lote_antecipado', label: 'OP' },
        { field: 'ficha_tecnica_identificacao', label: 'Ficha técnica' }
      ]
    },
    historico_pedido_originalis: {
      keyColumns: ['nota_fiscal', 'ordem_de_producao', 'pedido'],
      extras: [
        { field: 'nota_fiscal', label: 'NF' },
        { field: 'ordem_de_producao', label: 'OP/NS' },
        { field: 'pedido', label: 'Pedido/NS' }
      ]
    },
    pedidos_por_cliente: {
      keyColumns: ['codigo_cliente_omie'],
      render: renderClientePedidosCard,
      disableDetail: true
    },
    historico_pre2024: {
      keyColumns: ['pedido'],
      extras: [
        { field: 'pedido', label: 'Pedido' },
        { field: 'modelo', label: 'Modelo' },
        { field: 'data_aprovacao_pedido', label: 'Data Aprovação' },
        { field: 'quantidade', label: 'Quantidade' }
      ]
    }
  };
  const QUALIDADE_OS_GROUP_MAP = QUALIDADE_OS_GROUPS.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});
  const QUALIDADE_DETAIL_LABELS = {
    protc: 'OS',
    lote_antecipado: 'OP',
    ordem_de_producao: 'OP',
    pedido: 'Pedido/NS',
    ficha_tecnica_identificacao: 'Ficha técnica',
    nota_fiscal: 'NF',
    modelo: 'Modelo',
    data_aprovacao_pedido: 'Data Aprovação Pedido',
    quantidade: 'Quantidade',
    razao_social_faturamento: 'Razão Social (Faturamento)',
    nome_fantasia_revende: 'Nome Fantasia (Revenda)'
  };
  const qualidadeOsCache = {};
  let qualidadeOsCurrentGroups = {};
  let qualidadeOsLastItemKey = null;
  let qualidadeOsSearchSeq = 0;
  let qualidadeCurrentDetailSource = null;
  let qualidadeCurrentDetailIndex = null;
  let qualidadeDetailOriginal = {};
  let qualidadeDetailEdits = {};
  let qualidadeDetailEditingColumns = new Set();

  function formatQualidadeValue(value) {
    if (value === null || value === undefined) return '—';
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(formatQualidadeValue).join(', ');
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (_) {
        return String(value);
      }
    }
    return String(value);
  }

  function formatQualidadeLabel(key) {
    const custom = QUALIDADE_DETAIL_LABELS[key];
    if (custom) return custom;
    return key
      .split('_')
      .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
      .join(' ');
  }

  function buildQualidadeKeyValues(meta, raw) {
    const out = {};
    const keys = Array.isArray(meta?.keyColumns) ? meta.keyColumns : [];
    keys.forEach((col) => {
      const val = raw?.[col];
      if (val === null || val === undefined) return;
      const str = String(val).trim();
      if (!str) return;
      out[col] = val;
    });
    return out;
  }

  function buildQualidadeExtrasHtml(meta, entry) {
    if (typeof meta?.render === 'function') {
      return meta.render(entry);
    }
    const extrasConfig = Array.isArray(meta?.extras) ? meta.extras : [];
    const parts = [];
    extrasConfig.forEach((extra) => {
      const val = entry.raw?.[extra.field];
      if (val === null || val === undefined) return;
      const str = String(val).trim();
      if (!str) return;
      parts.push(
        `<span class="qualidade-extra-item"><span class="qualidade-extra-label">${escapeHtml(extra.label || '')}</span><span>${escapeHtml(formatQualidadeValue(val))}</span></span>`
      );
    });
    if (!parts.length && entry.match) {
      parts.push(`<span class="qualidade-extra-item"><span class="qualidade-extra-label">Código</span><span>${escapeHtml(formatQualidadeValue(entry.match))}</span></span>`);
    }
    return parts.length ? `<div class="qualidade-extra-list">${parts.join('')}</div>` : '';
  }

  function refreshQualidadeResultItem(sourceKey, index) {
    const cacheKey = `${sourceKey}:${index}`;
    const entry = qualidadeOsCache[cacheKey];
    if (!entry) return;
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    const listItem = document.querySelector(`.qualidade-result-item[data-source="${sourceKey}"][data-index="${index}"]`);
    if (!listItem) return;
    listItem.innerHTML = buildQualidadeExtrasHtml(meta, entry);
  }

  function updateQualidadeSaveState() {
    const saveBtn = qualidadeDetailSaveBtn;
    if (!saveBtn) return;
    const hasChanges = Object.keys(qualidadeDetailEdits).length > 0;
    saveBtn.disabled = !hasChanges;
    if (!hasChanges) saveBtn.textContent = 'Salvar alterações';
  }

  async function executeQualidadeOsSearch(term) {
    const feedbackEl = document.getElementById('qualidade-os-feedback');
    const resultsEl = document.getElementById('qualidade-os-results');
    if (!feedbackEl || !resultsEl) return;

    const trimmed = String(term || '').trim();
    if (!trimmed) {
      feedbackEl.textContent = 'Digite um código para buscar.';
      resultsEl.innerHTML = '';
      return;
    }

    // Coleta quais tabelas estão marcadas
    const checkboxes = document.querySelectorAll('#qualidade-sources-checkboxes input[type="checkbox"]:checked');
    const selectedSources = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedSources.length === 0) {
      feedbackEl.textContent = 'Selecione pelo menos uma tabela para pesquisar.';
      resultsEl.innerHTML = '';
      return;
    }

    const seq = ++qualidadeOsSearchSeq;
    feedbackEl.textContent = 'Buscando…';
    resultsEl.innerHTML = '';

    try {
      const sourcesParam = selectedSources.join(',');
      const resp = await fetch(`/api/qualidade/abertura-os/search?term=${encodeURIComponent(trimmed)}&sources=${encodeURIComponent(sourcesParam)}`, { credentials: 'include' });
      if (seq !== qualidadeOsSearchSeq) return;

      if (!resp.ok) {
        let message = `Falha ao pesquisar (${resp.status})`;
        try {
          const errPayload = await resp.json();
          if (errPayload?.error) message = errPayload.error;
        } catch {}
        feedbackEl.textContent = message;
        return;
      }

      const payload = await resp.json();
      if (seq !== qualidadeOsSearchSeq) return;
      renderQualidadeOsResults(payload);
    } catch (err) {
      if (seq !== qualidadeOsSearchSeq) return;
      console.error('[qualidade-os] falha na pesquisa', err);
      feedbackEl.textContent = `Erro ao buscar: ${err?.message || err}`;
    }
  }

  function renderQualidadeOsResults(payload) {
    const feedbackEl = document.getElementById('qualidade-os-feedback');
    const resultsEl = document.getElementById('qualidade-os-results');
    if (!feedbackEl || !resultsEl) return;

    if (!payload || payload.ok === false) {
      feedbackEl.textContent = payload?.error || 'Não foi possível obter os dados.';
      resultsEl.innerHTML = '';
      return;
    }

    Object.keys(qualidadeOsCache).forEach(k => delete qualidadeOsCache[k]);
    qualidadeOsCurrentGroups = {};
    qualidadeOsLastItemKey = null;
    qualidadeDetailEditingColumns.clear();

    const order = Array.isArray(payload?.order) && payload.order.length
      ? payload.order
      : QUALIDADE_OS_GROUPS.map(g => g.key);
    const results = payload?.results || {};

    let total = 0;
    const groupHtml = [];

    for (const key of order) {
      const groupData = results[key];
      const rows = Array.isArray(groupData?.rows) ? groupData.rows : [];
      if (!rows.length) continue;
      total += rows.length;
      const groupMeta = QUALIDADE_OS_GROUP_MAP[key] || {};
      const sourceMeta = QUALIDADE_SOURCE_META[key] || {};
      const label = groupData?.label || groupMeta.label || key;
      const subtitle = groupMeta.subtitle || groupData?.subtitle || '';
      qualidadeOsCurrentGroups[key] = { label, subtitle };
      const itemsHtml = rows.map((row, idx) => {
        const cacheKey = `${key}:${idx}`;
        const raw = row.raw || {};
        const entry = {
          raw,
          label,
          subtitle,
          match: row.match || '',
          keyValues: buildQualidadeKeyValues(sourceMeta, raw)
        };
        qualidadeOsCache[cacheKey] = entry;
        const extrasHtml = buildQualidadeExtrasHtml(sourceMeta, entry);
        const itemClasses = ['qualidade-result-item'];
        if (sourceMeta.disableDetail) itemClasses.push('is-static');
        const tabindexAttr = sourceMeta.disableDetail ? '' : 'tabindex="0"';
        return `<li class="${itemClasses.join(' ')}" data-source="${key}" data-index="${idx}" ${tabindexAttr}>${extrasHtml}</li>`;
      }).join('');
      groupHtml.push(`
        <div class="qualidade-result-group">
          <div class="qualidade-group-header">
            <div class="qualidade-group-title">
              ${escapeHtml(label)}
              ${subtitle ? `<span class="qualidade-group-sub">${escapeHtml(subtitle)}</span>` : ''}
            </div>
            <span class="qualidade-group-total">${rows.length} resultado(s)</span>
          </div>
          <ul class="qualidade-result-list">${itemsHtml}</ul>
        </div>`);
    }

    if (!total) {
      feedbackEl.textContent = 'Nenhum resultado encontrado.';
      resultsEl.innerHTML = '';
      return;
    }

    feedbackEl.textContent = `Localizamos ${total} registro(s).`;
    resultsEl.innerHTML = groupHtml.join('\n');
  }

  const qualidadeInputEl = document.getElementById('qualidade-os-input');
  const qualidadeButtonEl = document.getElementById('qualidade-os-search-btn');
  const qualidadeFeedbackEl = document.getElementById('qualidade-os-feedback');
  const menuQualidadeAbertura = document.getElementById('menu-qualidade-abertura-os');

  if (qualidadeFeedbackEl) qualidadeFeedbackEl.textContent = 'Digite um código para buscar.';

  const triggerQualidadeSearch = () => {
    if (qualidadeInputEl) executeQualidadeOsSearch(qualidadeInputEl.value);
  };

  qualidadeButtonEl?.addEventListener('click', (ev) => {
    ev.preventDefault();
    triggerQualidadeSearch();
  });

  qualidadeInputEl?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      triggerQualidadeSearch();
    }
  });

  // Botões de marcar/desmarcar todas as tabelas
  const selectAllBtn = document.getElementById('qualidade-select-all');
  const deselectAllBtn = document.getElementById('qualidade-deselect-all');
  const filterToggleBtn = document.getElementById('qualidade-filter-toggle');
  const filterCountEl   = document.getElementById('qualidade-filter-count');
  const sourcesContainer= document.getElementById('qualidade-sources-container');
  const sourcesBox      = document.getElementById('qualidade-sources-checkboxes');

  // ========== CONSULTAR EQUIPAMENTO (IAPP) ==========
  const iappConsultaInput = document.getElementById('iapp-consulta-input');
  const iappConsultaBtn = document.getElementById('iapp-consulta-btn');
  const iappConsultaFeedback = document.getElementById('iapp-consulta-feedback');
  const iappConsultaOutput = document.getElementById('iapp-consulta-output');

  async function executarConsultaIAPP() {
    const id = (iappConsultaInput?.value || '').trim();
    if (!id) {
      if (iappConsultaFeedback) iappConsultaFeedback.textContent = 'Por favor, informe um ID numérico.';
      if (iappConsultaOutput) iappConsultaOutput.textContent = '';
      return;
    }
    if (iappConsultaBtn) iappConsultaBtn.disabled = true;
    if (iappConsultaFeedback) iappConsultaFeedback.textContent = 'Consultando IAPP...';
    if (iappConsultaOutput) iappConsultaOutput.textContent = '';

    try {
      const r = await fetch(`/api/iapp/ordens-producao/busca/${encodeURIComponent(id)}`);
      const j = await r.json().catch(() => ({ raw: '<resposta não-JSON>' }));
      
      if (iappConsultaOutput) {
        iappConsultaOutput.textContent = JSON.stringify(j, null, 2);
      }
      
      if (j.ok && j.data?.success) {
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✓ Ordem encontrada: ${j.data.response?.identificacao || id}`;
      } else {
        const msg = j.data?.message || j.error || 'Erro desconhecido';
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `⚠ ${msg}`;
      }
    } catch (e) {
      if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✗ Erro: ${e.message}`;
      if (iappConsultaOutput) iappConsultaOutput.textContent = String(e);
    } finally {
      if (iappConsultaBtn) iappConsultaBtn.disabled = false;
    }
  }

  iappConsultaBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    executarConsultaIAPP();
  });

  iappConsultaInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      executarConsultaIAPP();
    }
  });

  // ========== LISTAR EQUIPAMENTOS (IAPP) ==========
  const iappListarBtn = document.getElementById('iapp-listar-btn');

  async function executarListagemIAPP() {
    if (iappListarBtn) iappListarBtn.disabled = true;
    if (iappConsultaFeedback) iappConsultaFeedback.textContent = 'Listando todas as OPs da IAPP...';
    if (iappConsultaOutput) iappConsultaOutput.textContent = '';

    try {
      // Chama endpoint /lista com offset=0 (obrigatório pela API IAPP)
      const r = await fetch('/api/iapp/ordens-producao/lista?offset=0');
      const j = await r.json().catch(() => ({ raw: '<resposta não-JSON>' }));
      
      if (iappConsultaOutput) {
        iappConsultaOutput.textContent = JSON.stringify(j, null, 2);
      }
      
      if (j.ok && j.data?.success) {
        const total = j.data.response?.length || 0;
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✓ ${total} ordens listadas`;
      } else {
        const msg = j.data?.message || j.error || 'Erro desconhecido';
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `⚠ ${msg}`;
      }
    } catch (e) {
      if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✗ Erro: ${e.message}`;
      if (iappConsultaOutput) iappConsultaOutput.textContent = String(e);
    } finally {
      if (iappListarBtn) iappListarBtn.disabled = false;
    }
  }

  iappListarBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    executarListagemIAPP();
  });
  // ========== FIM LISTAR EQUIPAMENTOS ==========

  function updateQualidadeFilterCount() {
    if (!sourcesBox || !filterCountEl) return;
    const all = Array.from(sourcesBox.querySelectorAll('input[type="checkbox"]'));
    const sel = all.filter(cb => cb.checked).length;
    filterCountEl.textContent = `· ${sel}/${all.length} selecionadas`;
    if (filterToggleBtn && sourcesContainer) {
      const collapsed = sourcesContainer.classList.contains('is-collapsed');
      filterToggleBtn.textContent = collapsed ? 'Mostrar filtros' : 'Ocultar filtros';
      filterToggleBtn.setAttribute('aria-expanded', String(!collapsed));
      sourcesContainer.setAttribute('aria-hidden', String(collapsed));
    }
  }

  selectAllBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const checkboxes = document.querySelectorAll('#qualidade-sources-checkboxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    updateQualidadeFilterCount();
  });

  deselectAllBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const checkboxes = document.querySelectorAll('#qualidade-sources-checkboxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateQualidadeFilterCount();
  });

  filterToggleBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!sourcesContainer) return;
    sourcesContainer.classList.toggle('is-collapsed');
    updateQualidadeFilterCount();
  });

  sourcesBox?.addEventListener('change', (ev) => {
    if (ev.target && ev.target.matches('input[type="checkbox"]')) {
      updateQualidadeFilterCount();
    }
  });

  // Inicializa contador
  updateQualidadeFilterCount();

  menuQualidadeAbertura?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuQualidadeAbertura.classList.add('is-active');
    showMainTab('qualidadeAberturaOsNova');
    // Foca no primeiro campo do formulário
    const clienteInput = document.getElementById('abertura-os-cliente');
    if (clienteInput) {
      setTimeout(() => clienteInput.focus(), 50);
    }
  });

  // Handler para o botão Consulta (ex-Consultar OS)
  const menuQualidadeConsultar = document.getElementById('menu-qualidade-consultar-os');
  menuQualidadeConsultar?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuQualidadeConsultar.classList.add('is-active');
    showMainTab('qualidadeConsultaOs');
    if (qualidadeInputEl) {
      setTimeout(() => qualidadeInputEl.focus(), 50);
    }
  });

  // Handler para o botão Consultar equipamento (IAPP)
  const menuQualidadeConsultarEquipamento = document.getElementById('menu-qualidade-consultar-equipamento');
  menuQualidadeConsultarEquipamento?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuQualidadeConsultarEquipamento.classList.add('is-active');
    showMainTab('qualidadeConsultarEquipamento');
    const iappInput = document.getElementById('iapp-consulta-input');
    if (iappInput) {
      setTimeout(() => iappInput.focus(), 50);
    }
  });

  const menuOmieAtualizar = document.getElementById('menu-omie-atualizar');
  menuOmieAtualizar?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuOmieAtualizar.classList.add('is-active');
    renderOmieSyncButtons();
    ensureOmieSyncBindings();
    showMainTab('omieAtualizarTabelas');
  });

  // Handlers para o formulário de Abertura de OS
  const aberturaOsLimparBtn = document.getElementById('abertura-os-limpar');
  const aberturaOsSalvarBtn = document.getElementById('abertura-os-salvar');
  
  aberturaOsLimparBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    // Limpa todos os campos do formulário
    document.getElementById('abertura-os-cliente').value = '';
    document.getElementById('abertura-os-produto').value = '';
    document.getElementById('abertura-os-descricao').value = '';
    document.getElementById('abertura-os-prioridade').value = 'media';
    // Foca no primeiro campo
    document.getElementById('abertura-os-cliente').focus();
  });

  aberturaOsSalvarBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    
    const cliente = document.getElementById('abertura-os-cliente').value.trim();
    const produto = document.getElementById('abertura-os-produto').value.trim();
    const descricao = document.getElementById('abertura-os-descricao').value.trim();
    const prioridade = document.getElementById('abertura-os-prioridade').value;

    // Validação básica
    if (!cliente || !produto || !descricao) {
      alert('Por favor, preencha todos os campos obrigatórios: Cliente, Produto e Descrição.');
      return;
    }

    try {
      // Aqui você pode implementar a lógica para salvar a OS
      // Por enquanto, apenas mostra uma mensagem de sucesso
      const novaOS = {
        cliente,
        produto,
        descricao,
        prioridade,
        dataAbertura: new Date().toISOString(),
        status: 'aberta'
      };

      console.log('Nova OS criada:', novaOS);
      alert(`OS criada com sucesso!\nCliente: ${cliente}\nProduto: ${produto}\nPrioridade: ${prioridade}`);
      
      // Limpa o formulário após salvar
      aberturaOsLimparBtn.click();
      
    } catch (error) {
      console.error('Erro ao criar OS:', error);
      alert('Erro ao criar a OS. Tente novamente.');
    }
  });

  const qualidadeResultsEl = document.getElementById('qualidade-os-results');
  const qualidadeDetailTitleEl = document.getElementById('qualidade-os-detail-title');
  const qualidadeDetailSubtitleEl = document.getElementById('qualidade-os-detail-subtitle');
  const qualidadeDetailMetaEl = document.getElementById('qualidade-os-detail-meta');
  const qualidadeDetailListEl = document.getElementById('qualidade-os-detail-list');
  const qualidadeDetailBackBtn = document.getElementById('qualidade-os-back');
  const qualidadeDetailSaveBtn = document.getElementById('qualidade-os-save');

  updateQualidadeSaveState();

  function openQualidadeOsDetail(sourceKey, index, options = {}) {
    const cacheKey = `${sourceKey}:${index}`;
    const cached = qualidadeOsCache[cacheKey];
    if (!cached) {
      alert('Registro não disponível. Refaça a busca.');
      return;
    }
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    if (meta.disableDetail) {
      return;
    }

    const reset = options.resetEdits !== false;
    qualidadeCurrentDetailSource = sourceKey;
    qualidadeCurrentDetailIndex = index;
    qualidadeOsLastItemKey = cacheKey;

    if (reset) {
      qualidadeDetailOriginal = { ...(cached.raw || {}) };
      qualidadeDetailEdits = {};
      qualidadeDetailEditingColumns = new Set();
      updateQualidadeSaveState();
    }

    if (options.editingColumn) {
      qualidadeDetailEditingColumns.add(options.editingColumn);
    }

    const keySet = new Set(meta.keyColumns || []);
    const hasKeys = keySet.size > 0 && Object.keys(cached.keyValues || {}).length > 0;
    const baseRaw = cached.raw || {};
    const mergedRaw = { ...baseRaw };
    Object.keys(qualidadeDetailEdits).forEach((col) => {
      mergedRaw[col] = qualidadeDetailEdits[col];
    });

    if (qualidadeDetailTitleEl) qualidadeDetailTitleEl.textContent = cached.label || 'Detalhes';
    if (qualidadeDetailSubtitleEl) qualidadeDetailSubtitleEl.textContent = cached.subtitle || '';
    if (qualidadeDetailMetaEl) qualidadeDetailMetaEl.textContent = cached.match ? `Código consultado: ${formatQualidadeValue(cached.match)}` : '';

    if (qualidadeDetailListEl) {
      const entries = Object.keys(baseRaw);
      const inner = entries.length
        ? entries.map((column) => {
            const displayLabel = formatQualidadeLabel(column);
            const pendingValue = mergedRaw[column];
            const displayValue = escapeHtml(formatQualidadeValue(pendingValue)).replace(/\n/g, '<br>');
            const isKey = keySet.has(column);
            const canEdit = hasKeys && !isKey;
            const isEditing = canEdit && qualidadeDetailEditingColumns.has(column);
            if (isEditing) {
              const textValue = Object.prototype.hasOwnProperty.call(qualidadeDetailEdits, column)
                ? (qualidadeDetailEdits[column] === null ? '' : String(qualidadeDetailEdits[column]))
                : (baseRaw[column] === null || baseRaw[column] === undefined ? '' : String(baseRaw[column]));
              const rows = Math.min(8, Math.max(3, textValue.split(/\r?\n/).length + 1));
              return `
                <div class="qualidade-detail-item is-editing" data-column="${column}" data-source="${sourceKey}" data-editable="${canEdit ? '1' : '0'}">
                  <div class="qualidade-detail-label">${escapeHtml(displayLabel)}</div>
                  <div class="qualidade-detail-editor">
                    <textarea class="qualidade-detail-input" rows="${rows}">${escapeHtml(textValue)}</textarea>
                    <div class="qualidade-detail-actions">
                      <button class="qualidade-detail-cancel" data-column="${column}">Cancelar</button>
                    </div>
                  </div>
                </div>`;
            }
            return `
              <div class="qualidade-detail-item" data-column="${column}" data-source="${sourceKey}" data-editable="${canEdit ? '1' : '0'}" ${canEdit ? 'tabindex="0"' : ''}>
                <div class="qualidade-detail-label">${escapeHtml(displayLabel)}</div>
                <div class="qualidade-detail-value">${displayValue}</div>
              </div>`;
          }).join('')
        : '<div class="qualidade-detail-empty">Nenhum dado disponível.</div>';
      qualidadeDetailListEl.innerHTML = inner;
    }

    updateQualidadeSaveState();
    showMainTab('qualidadeAberturaOsDetalhe');
  }

  function focusQualidadeResult(cacheKey) {
    if (!cacheKey) return;
    const [sourceKey, index] = cacheKey.split(':');
    const items = document.querySelectorAll('.qualidade-result-item');
    for (const el of items) {
      if (el.dataset.source === sourceKey && el.dataset.index === index) {
        el.focus();
        break;
      }
    }
  }

  qualidadeResultsEl?.addEventListener('click', (ev) => {
    const item = ev.target.closest('.qualidade-result-item');
    if (!item) return;
    const sourceKey = item.dataset.source || '';
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    if (meta.disableDetail) return;
    openQualidadeOsDetail(sourceKey, item.dataset.index || '', { resetEdits: true });
  });

  qualidadeResultsEl?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const item = ev.target.closest('.qualidade-result-item');
    if (!item) return;
    ev.preventDefault();
    const sourceKey = item.dataset.source || '';
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    if (meta.disableDetail) return;
    openQualidadeOsDetail(sourceKey, item.dataset.index || '', { resetEdits: true });
  });

  qualidadeDetailBackBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    qualidadeDetailEdits = {};
    qualidadeDetailEditingColumns.clear();
    updateQualidadeSaveState();
    qualidadeCurrentDetailSource = null;
    qualidadeCurrentDetailIndex = null;
    showMainTab('qualidadeConsultaOs'); // Corrigido: agora volta para o painel de consulta correto
    focusQualidadeResult(qualidadeOsLastItemKey);
  });

  qualidadeDetailListEl?.addEventListener('click', (ev) => {
    if (!qualidadeCurrentDetailSource) return;
    const btn = ev.target.closest('button');
    if (btn && btn.classList.contains('qualidade-detail-cancel')) {
      const column = btn.dataset.column;
      if (!column) return;
      qualidadeDetailEditingColumns.delete(column);
      delete qualidadeDetailEdits[column];
      updateQualidadeSaveState();
      openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false });
      return;
    }

    const item = ev.target.closest('.qualidade-detail-item');
    if (!item) return;
    const editable = item.dataset.editable === '1';
    const column = item.dataset.column;
    if (!editable || !column) return;
    if (item.classList.contains('is-editing')) return;
    qualidadeDetailEditingColumns.add(column);
    openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false, editingColumn: column });
    const textarea = qualidadeDetailListEl?.querySelector(`.qualidade-detail-item.is-editing[data-column="${column}"] .qualidade-detail-input`);
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
  });

  qualidadeDetailListEl?.addEventListener('keydown', (ev) => {
    if (!qualidadeCurrentDetailSource) return;
    if (ev.target.closest('.qualidade-detail-input')) return;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const item = ev.target.closest('.qualidade-detail-item');
    if (!item) return;
    const editable = item.dataset.editable === '1';
    const column = item.dataset.column;
    if (!editable || !column) return;
    ev.preventDefault();
    if (item.classList.contains('is-editing')) return;
    qualidadeDetailEditingColumns.add(column);
    openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false, editingColumn: column });
    const textarea = qualidadeDetailListEl?.querySelector(`.qualidade-detail-item.is-editing[data-column="${column}"] .qualidade-detail-input`);
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
  });

  qualidadeDetailListEl?.addEventListener('input', (ev) => {
    if (!qualidadeCurrentDetailSource) return;
    const textarea = ev.target.closest('.qualidade-detail-input');
    if (!textarea) return;
    const item = textarea.closest('.qualidade-detail-item');
    if (!item) return;
    const column = item.dataset.column;
    if (!column) return;
    const original = qualidadeDetailOriginal[column];
    const originalStr = original === null || original === undefined ? '' : String(original);
    const newStr = textarea.value;
    if (newStr === originalStr) {
      delete qualidadeDetailEdits[column];
    } else {
      qualidadeDetailEdits[column] = newStr === '' ? null : newStr;
    }
    updateQualidadeSaveState();
  });

  async function saveAllQualidadeEdits() {
    if (!qualidadeCurrentDetailSource) return;
    const cacheKey = `${qualidadeCurrentDetailSource}:${qualidadeCurrentDetailIndex}`;
    const entry = qualidadeOsCache[cacheKey];
    if (!entry) {
      alert('Registro não disponível. Refaça a busca.');
      return;
    }

    const columns = Object.keys(qualidadeDetailEdits);
    if (!columns.length) return;

    if (!entry.keyValues || !Object.keys(entry.keyValues).length) {
      alert('Este registro não possui chave identificadora para edição.');
      return;
    }

    const saveBtn = qualidadeDetailSaveBtn;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando…';
    }

    const meta = QUALIDADE_SOURCE_META[qualidadeCurrentDetailSource] || {};
    let updatedRow = entry.raw;

    try {
      for (const column of columns) {
        const payloadValue = qualidadeDetailEdits[column];
        const resp = await fetch('/api/qualidade/abertura-os/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            source: qualidadeCurrentDetailSource,
            column,
            value: payloadValue,
            keyValues: entry.keyValues
          })
        });
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json?.ok) {
          throw new Error(json?.error || `Falha HTTP ${resp.status}`);
        }
        updatedRow = json.row || updatedRow;
        entry.raw = updatedRow;
        entry.keyValues = buildQualidadeKeyValues(meta, updatedRow);
        delete qualidadeDetailEdits[column];
        qualidadeDetailEditingColumns.delete(column);
      }

      qualidadeDetailOriginal = { ...updatedRow };
      qualidadeDetailEdits = {};
      qualidadeDetailEditingColumns.clear();
      updateQualidadeSaveState();
      openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false });
      refreshQualidadeResultItem(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex);
      alert('Alterações salvas com sucesso.');
    } catch (err) {
      alert(`Erro ao salvar: ${err?.message || err}`);
      if (saveBtn) {
        saveBtn.textContent = 'Salvar alterações';
        saveBtn.disabled = false;
      }
      updateQualidadeSaveState();
      return;
    }

    if (saveBtn) {
      saveBtn.textContent = 'Salvar alterações';
      saveBtn.disabled = true;
    }
    updateQualidadeSaveState();
  }

  qualidadeDetailSaveBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    saveAllQualidadeEdits();
  });

  // Exibe o nome do usuário no elemento #userNameDisplay, se existir
// --- Login status helper ---
// --- Login status helper ---
async function renderUserName() {
  const el = document.getElementById('userNameDisplay');
  if (!el) return;

  const BASE = typeof window.API_BASE === 'string' ? window.API_BASE : '';

  try {
    const res = await fetch(`${BASE}/api/auth/status`, { credentials: 'include' });
    const js  = res.ok ? await res.json() : { loggedIn: false };

    if (js.loggedIn && js.user) {
      const nome = js.user.nome || js.user.username || js.user.login || 'Usuário';
      el.textContent = nome;
      el.classList.remove('is-ghost');
      setAuthGroupState(true);
    } else {
      el.textContent = '—';
      el.classList.add('is-ghost');
      try {
        localStorage.removeItem('auth_user');
        localStorage.removeItem('auth_user_name');
        sessionStorage.removeItem('auth_user');
        sessionStorage.removeItem('auth_user_name');
      } catch {}
      setAuthGroupState(false);
    }
  } catch {
    el.textContent = '—';
    el.classList.add('is-ghost');
    setAuthGroupState(false);
  }
}

// inicialização
document.addEventListener('DOMContentLoaded', () => {
  try {
    installAuthClickGuard(); // instala o bloqueio de clique
    renderUserName();        // e já define o estado inicial (logged / not logged)
  } catch {}
});

// quando login/logout acontecer, reavaliar
window.addEventListener('auth:changed', () => {
  try { renderUserName(); } catch {}
});


// chama na carga da página
document.addEventListener('DOMContentLoaded', () => {
  try { renderUserName(); } catch {}
});

// re-renderiza quando o login.js avisar mudanças de sessão
window.addEventListener('auth:changed', () => {
  try { renderUserName(); } catch {}
});


  const codeFilter = document.getElementById('codeFilter');
  const descFilter = document.getElementById('descFilter');

// agora seleciona o UL correto da aba "Lista de produtos"
const ulList     = document.getElementById('listaProdutosList');
  const countEl    = document.getElementById('productCount');

  // Guarda os itens da busca resumida
  let resumoItems = [];

  // FILTRO LOCAL (SEM RE-RENDER)
  function applyResumoFilters() {
    const termCode = codeFilter.value.trim().toLowerCase();
    const termDesc = descFilter.value.trim().toLowerCase();
  
    ulList.querySelectorAll('li').forEach(li => {
      const code = (li.dataset.codigo    || '').toLowerCase();
      const desc = (li.dataset.descricao || '').toLowerCase();
  
      const show = ((!termCode || code.includes(termCode)) &&
                    (!termDesc || desc.includes(termDesc)));
      li.style.display = show ? '' : 'none';
    });
  }
  
  codeFilter.addEventListener('input', applyResumoFilters);
  descFilter.addEventListener('input', applyResumoFilters);


  // pega referências ao botão e ao painel de filtros
const filterBtn   = document.getElementById('filterBtn');
const filterPanel = document.getElementById('filterPanel');

filterBtn.addEventListener('click', e => {
  e.preventDefault();
  // alterna visibilidade
  const isOpen = filterPanel.classList.contains('is-open');
  if (isOpen) {
    filterPanel.classList.remove('is-open');
    filterPanel.style.display = 'none';
    return;
  }

  filterPanel.classList.add('is-open');
  filterPanel.style.display = 'flex';
});

function normalizaNumeroParaBR(val) {
  if (val === null || val === undefined || val === '') return '0,00';
  if (typeof val === 'number') return fmtBR.format(val);
  const num = Number(String(val).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? fmtBR.format(num) : '0,00';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  }[c]));
}

function truncateText(str, maxLength = 25) {
  const texto = String(str ?? '');
  if (texto.length <= maxLength) return texto;
  if (maxLength <= 3) return texto.slice(0, maxLength);
  return `${texto.slice(0, maxLength - 3)}...`;
}

function getSelectedOrigemLocal() {
  const sel = document.getElementById('transferOrigem');
  const valor = sel && sel.value ? String(sel.value).trim() : '';
  return valor || TRANSFER_DEFAULT_ORIGEM;
}

function atualizarItensTransferenciaDoAlmox() {
  if (!transferenciaLista.length) return;
  const origemAtual = almoxLocalAtual || getSelectedOrigemLocal();
  transferenciaLista = transferenciaLista.map(item => {
    const dados = almoxAllDados.find(d => d.codigo === item.codigo);
    if (!dados) {
      return {
        ...item,
        codOmie: '',
        origem: origemAtual
      };
    }
    return {
      ...item,
      min: normalizaNumeroParaBR(dados.min),
      fisico: normalizaNumeroParaBR(dados.fisico),
      saldo: normalizaNumeroParaBR(dados.saldo),
      cmc: normalizaNumeroParaBR(dados.cmc),
      codOmie: dados.codOmie ? String(dados.codOmie).trim() : '',
      origem: origemAtual
    };
  });
  window.renderTransferenciaLista?.();
}

function sanitizeQtd(value, fallback = 1) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function formatQtdInput(value) {
  const num = sanitizeQtd(value);
  return Number.isInteger(num) ? String(num) : num.toString();
}

function updateTransferControlsState() {
  const transferBtn = document.getElementById('transferenciaBtn');
  const selectAllBtn = document.getElementById('transferSelectAllBtn');
  const totalItens = transferenciaLista.length;
  const selecionados = transferenciaLista.filter(i => i.selecionado !== false).length;

  if (transferBtn) {
    transferBtn.disabled = selecionados === 0;
  }
  if (selectAllBtn) {
    selectAllBtn.disabled = totalItens === 0;
    const state = (totalItens > 0 && selecionados === totalItens) ? 'all' : 'partial';
    selectAllBtn.dataset.state = state;
    let title = 'Selecionar todos os itens';
    if (totalItens === 0) {
      title = 'Nenhum item disponível para selecionar';
    } else if (state === 'all') {
      title = 'Desmarcar todos os itens';
    }
    selectAllBtn.title = title;
  }
}

function renderTransferenciaLista() {
  const tbody = document.getElementById('transferenciaTbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!transferenciaLista.length) {
    const tr = document.createElement('tr');
    tr.className = 'transferencia-placeholder';
    tr.innerHTML = '<td colspan="7">Nenhum item selecionado para transferência.</td>';
    tbody.appendChild(tr);
    updateTransferControlsState();
    return;
  }

  transferenciaLista.forEach(item => {
    const checked = item.selecionado !== false;
    item.qtd = sanitizeQtd(item.qtd);
    const descricaoCompleta = item.descricao || '';
    const descricaoCurta = truncateText(descricaoCompleta, 25);
    const codigoSeguro = escapeHtml(item.codigo || '');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="sel">
        <input type="checkbox"
               class="transfer-check"
               data-codigo="${codigoSeguro}"
               ${checked ? 'checked' : ''}>
      </td>
      <td>${codigoSeguro}</td>
      <td class="desc-cell" title="${escapeHtml(descricaoCompleta)}">${escapeHtml(descricaoCurta)}</td>
      <td>${escapeHtml(item.codOmie || '')}</td>
      <td class="qtd-cell"><input type="number" min="0" step="0.01" value="${formatQtdInput(item.qtd)}" data-codigo="${codigoSeguro}" class="transfer-qtd"></td>
      <td class="num">${escapeHtml(String(item.fisico ?? '0'))}</td>
      <td class="num">${escapeHtml(String(item.saldo ?? '0'))}</td>`;
    tbody.appendChild(tr);
  });

  updateTransferControlsState();
}

window.renderTransferenciaLista = renderTransferenciaLista;

function renderSolicitacoesTransferencias() {
  const tbody = document.getElementById('solicitacoesTransferTbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!solicitacoesTransferencias.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="10">Nenhuma solicitação registrada.</td>';
    tbody.appendChild(tr);
    return;
  }

  solicitacoesTransferencias.forEach(item => {
    const quantidade = Number(item.qtd);
    const qtdFormatada = Number.isFinite(quantidade) ? fmtQtd.format(quantidade) : '-';
    const descricaoCompleta = String(item.descricao || '');
    const statusAtual = String(item.status || '');
    const podeAprovar = statusAtual.toLowerCase() !== 'transferido';
    const botaoHtml = podeAprovar
      ? `<button type="button" class="btn tiny btn-approve-transfer" data-id="${escapeHtml(String(item.id ?? ''))}">Aprovar</button>`
      : '<span>Transferido</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(String(item.id ?? ''))}</td>
      <td>${escapeHtml(item.codigo || '')}</td>
      <td class="desc-cell" title="${escapeHtml(descricaoCompleta)}">${escapeHtml(truncateText(descricaoCompleta, 40))}</td>
      <td class="num">${escapeHtml(qtdFormatada)}</td>
      <td>${escapeHtml(item.origem || '')}</td>
      <td>${escapeHtml(item.destino || '')}</td>
      <td>${escapeHtml(item.solicitante || '')}</td>
      <td>${escapeHtml(statusAtual)}</td>
      <td>${escapeHtml(item.aprovado_pro || '-')}</td>
      <td>${botaoHtml}</td>`;
    tbody.appendChild(tr);
  });
}

async function carregarSolicitacoesTransferencias(forceReload = false) {
  if (solicitacoesTransferenciasCarregando) return;
  if (solicitacoesTransferenciasLoaded && !forceReload) {
    renderSolicitacoesTransferencias();
    return;
  }

  const spinner = document.getElementById('solicitacoesTransferSpinner');
  const tbody = document.getElementById('solicitacoesTransferTbody');
  if (!tbody) return;

  solicitacoesTransferenciasCarregando = true;
  if (spinner) spinner.style.display = 'block';
  tbody.innerHTML = '<tr><td colspan="10">Carregando solicitações…</td></tr>';

  try {
    const resp = await fetch('/api/transferencias');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha ao carregar lista.');

  const registros = Array.isArray(json.registros) ? json.registros : [];
  solicitacoesTransferencias = registros.filter(item => String(item.status || '').toLowerCase() !== 'transferido');
    solicitacoesTransferenciasLoaded = true;
    renderSolicitacoesTransferencias();
  } catch (err) {
    console.error('[transferencias] falha ao carregar solicitações', err);
  tbody.innerHTML = '<tr><td colspan="10">⚠️ Falha ao carregar solicitações de transferência.</td></tr>';
  } finally {
    solicitacoesTransferenciasCarregando = false;
    if (spinner) spinner.style.display = 'none';
  }
}

async function openSolicitacoesTransferencia(forceReload = false) {
  if (typeof hideKanban === 'function') hideKanban();
  if (typeof hideArmazem === 'function') hideArmazem();

  // Limpa todo o container principal
  window.clearMainContainer?.();

  const prodTabs = document.getElementById('produtoTabs');
  if (prodTabs) prodTabs.style.display = 'none';
  const prodHeader = document.querySelector('#produtoTabs .main-header');
  if (prodHeader) prodHeader.style.display = 'none';

  const kanbanTabs = document.getElementById('kanbanTabs');
  if (kanbanTabs) kanbanTabs.style.display = 'none';

  const pane = document.getElementById('solicitacaoTransferencia');
  if (pane) {
    window.showOnlyInMain?.(pane);
  }

  document
    .querySelectorAll('.left-side .side-menu a')
    .forEach(a => a.classList.remove('is-active'));
  document.getElementById('menu-solicitacao-transferencia')?.classList.add('is-active');

  await carregarSolicitacoesTransferencias(forceReload);
}

window.openSolicitacoesTransferencia = openSolicitacoesTransferencia;

function adicionarItemTransferencia(item) {
  if (!item) return;
  const codigo = (item.codigo || '').trim();
  if (!codigo) return;

  const normalizado = {
    codigo,
    descricao: (item.descricao || '').trim(),
    min: normalizaNumeroParaBR(item.min),
    fisico: normalizaNumeroParaBR(item.fisico),
    saldo: normalizaNumeroParaBR(item.saldo),
    cmc: normalizaNumeroParaBR(item.cmc),
    codOmie: (item.codOmie || '').trim(),
    selecionado: true,
    qtd: sanitizeQtd(item.qtd ?? 1)
  };

  const idx = transferenciaLista.findIndex(i => i.codigo === codigo);
  if (idx >= 0) {
    const anterior = transferenciaLista[idx];
    transferenciaLista[idx] = {
      ...anterior,
      ...normalizado,
      qtd: sanitizeQtd(anterior?.qtd ?? normalizado.qtd),
      selecionado: true
    };
    transferenciaItem = transferenciaLista[idx];
  } else {
    transferenciaLista.push(normalizado);
    transferenciaItem = normalizado;
  }
  window.renderTransferenciaLista?.();
}

function onAlmoxRowClick(ev) {
  const tr = ev.target.closest('tr');
  if (!tr || !tr.dataset || !tr.dataset.codigo) return;

  transferenciaItem = {
    codigo:    tr.dataset.codigo || '',
    descricao: tr.dataset.descricao || '',
    min:       tr.dataset.min || '0,00',
    fisico:    tr.dataset.fisico || '0,00',
    saldo:     tr.dataset.saldo || '0,00',
    cmc:       tr.dataset.cmc || '0,00',
    codOmie:   tr.dataset.codOmie || '',
    qtd:       1
  };

  adicionarItemTransferencia(transferenciaItem);
  showArmazemTab('transferencia');
}


  // ATALHO ÚNICO: abre aba cacheada + carrega cache EM UM SÓ CLIQUE

   const btnCache = document.getElementById('btn-omie-list1')
                  || document.getElementById('btn-omie-list');
  console.log('[DEBUG] btnCache encontrado em DOMContentLoaded:', btnCache);
if (btnCache) {
btnCache.addEventListener('click', async e => {
  e.preventDefault();
  hideKanban();
  if (typeof hideArmazem === 'function') hideArmazem();
  const armTabsEl = document.getElementById('armazemTabs');
  const armContentEl = document.getElementById('armazemContent');
  if (armTabsEl) armTabsEl.style.display = 'none';
  if (armContentEl) armContentEl.style.display = 'none';
  document
    .querySelectorAll('#armazemContent .armazem-page')
    .forEach(p => (p.style.display = 'none'));

  // 1) esconde todas as panes e mostra só o painel de produtos
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.getElementById('listaProdutos').style.display = 'block';

  // 2) remove destaque e destaca o menu lateral
  document.querySelector('.main-header').style.display = 'none';
  document.querySelectorAll('.side-menu a').forEach(a => a.classList.remove('is-active'));
  btnCache.classList.add('is-active');

  // 3) carrega toda a lista usando o cache e filtros já testados
  console.log('[DEBUG] iniciando initListarProdutosUI…');
  await initListarProdutosUI('listaProdutos', 'listaProdutosList');
  console.log('[DEBUG] initListarProdutosUI completo');

  // === [B] Clique em um produto da lista -> abre "Dados do produto" ===
(function bindOpenFromListOnce(){
  const ul = document.getElementById('listaProdutosList');
  if (!ul || ul.__boundOpenProduto) return;   // evita duplicar
  ul.__boundOpenProduto = true;

  ul.addEventListener('click', (ev) => {
    // 1) tenta achar um LI com data-codigo
    const li = ev.target.closest('li[data-codigo]');
    // 2) se não tiver, tenta um botão/ancora com data-codigo
    const btn = li ? null : ev.target.closest('[data-codigo]');
    const el  = li || btn;
    if (!el) return;

    const codigo = String(el.dataset.codigo || '').trim();
    if (!codigo) return;

    // abre a UI do produto no fluxo padrão
    window.openProdutoPorCodigo(codigo);
  });
})();

});

}

// === Definições (Famílias) =================================================
(function initDefinicoes(){
  const btn = document.getElementById('btn-definicoes');
  if (!btn) return;
  const paneId = 'definicoesPane';
  const spinner = () => document.getElementById('familiaSpinner');
  const tbody   = () => document.getElementById('familiaTbody');
  const errBox  = () => document.getElementById('familiaError');
  const refreshBtn = () => document.getElementById('familiaRefreshBtn');
  const saveBtn = () => document.getElementById('familiaSaveBtn');

  // Armazena as alterações pendentes: { originalCod: { cod: newCod, tipo: newTipo } }
  const pendingChanges = {};

  async function fetchFamilias(force = false){
    try {
      if (spinner()) spinner().style.display = 'block';
      if (errBox()) { errBox().style.display = 'none'; errBox().textContent = ''; }
      // usa endpoint interno que persiste no banco se necessário
      const res = await fetch(`${API_BASE}/api/familia/list`);
      const json = await res.json();
      const list = Array.isArray(json?.familias)
        ? json.familias.map(f => ({ 
            codigo: f.cod || f.codigo, 
            nomeFamilia: f.nome_familia || f.nomeFamilia || '',
            tipo: f.tipo || ''
          }))
        : [];
      renderFamilias(list);
    } catch(e){
      if (errBox()) { 
        errBox().style.display='flex'; 
        const textDiv = document.getElementById('familiaErrorText');
        if (textDiv) {
          textDiv.textContent = 'Erro ao carregar famílias: '+ (e?.message||e);
        } else {
          errBox().innerHTML = '<i class="fa-solid fa-exclamation-triangle" style="color: #dc2626; font-size: 18px; margin-top: 2px;"></i><div style="color: #991b1b; font-size: 13px; line-height: 1.6; font-weight: 500;">Erro ao carregar famílias: '+ (e?.message||e) + '</div>';
        }
      }
    } finally {
      if (spinner()) spinner().style.display = 'none';
    }
  }

  function renderFamilias(list){
    const tb = tbody();
    if (!tb) return;
    tb.innerHTML = '';
    if (!list.length){
      tb.innerHTML = '<tr><td colspan="3" style="padding: 40px 20px; text-align: center; color: var(--inactive-color); font-size: 14px;"><i class="fa-solid fa-inbox" style="font-size: 32px; color: #f59e0b; opacity: 0.3; display: block; margin-bottom: 12px;"></i>Nenhuma família encontrada. Clique em "Recarregar" para sincronizar.</td></tr>';
      return;
    }
    const frag = document.createDocumentFragment();
    list.forEach(f => {
      const tr = document.createElement('tr');
      const codigo = f?.codigo != null ? String(f.codigo) : '';
      const nome   = f?.nomeFamilia || '';
      const tipo   = f?.tipo || '';
      
      const tdCodigo = document.createElement('td');
      tdCodigo.textContent = codigo;
      tdCodigo.style.cursor = 'pointer';
      tdCodigo.dataset.originalCod = codigo;
      tdCodigo.classList.add('familia-cod-cell');
      
      const tdNome = document.createElement('td');
      tdNome.textContent = nome;
      
      const tdTipo = document.createElement('td');
      tdTipo.textContent = tipo;
      tdTipo.style.cursor = 'pointer';
      tdTipo.dataset.originalCod = codigo;
      tdTipo.dataset.originalTipo = tipo;
      tdTipo.classList.add('familia-tipo-cell');
      
      tr.appendChild(tdCodigo);
      tr.appendChild(tdNome);
      tr.appendChild(tdTipo);
      frag.appendChild(tr);
    });
    tb.appendChild(frag);
    
    // Delega clique nas células editáveis
    tb.removeEventListener('click', handleCellClick);
    tb.addEventListener('click', handleCellClick);
  }

  function handleCellClick(ev){
    const codCell = ev.target.closest('.familia-cod-cell');
    const tipoCell = ev.target.closest('.familia-tipo-cell');
    
    if (codCell && !codCell.querySelector('input')) {
      makeEditable(codCell, 'cod');
    } else if (tipoCell && !tipoCell.querySelector('input')) {
      makeEditable(tipoCell, 'tipo');
    }
  }

  function makeEditable(cell, fieldType){
    const originalValue = cell.textContent.trim();
    const originalCod = cell.dataset.originalCod || '';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalValue;
    input.style.width = fieldType === 'cod' ? '80px' : '120px';
    input.style.padding = '2px 4px';
    input.style.border = '1px solid #3b82f6';
    input.style.borderRadius = '3px';
    input.style.background = '#1f2937';
    input.style.color = '#fff';
    
    cell.textContent = '';
    cell.appendChild(input);
    cell.style.cursor = 'default';
    input.focus();
    input.select();
    
    // Salva ao pressionar Enter ou perder foco
    const saveEdit = () => {
      const newValue = input.value.trim();
      cell.textContent = newValue;
      cell.style.cursor = 'pointer';
      
      // Registra a mudança
      if (!pendingChanges[originalCod]) {
        pendingChanges[originalCod] = { originalCod };
      }
      
      if (fieldType === 'cod') {
        pendingChanges[originalCod].newCod = newValue;
        cell.dataset.originalCod = newValue; // atualiza para próximas edições
        // Marca visualmente
        if (newValue !== originalValue) {
          cell.style.background = '#fef3c7';
          cell.style.color = '#92400e';
        }
      } else {
        pendingChanges[originalCod].newTipo = newValue;
        cell.dataset.originalTipo = newValue;
        // Marca visualmente
        if (newValue !== originalValue) {
          cell.style.background = '#fef3c7';
          cell.style.color = '#92400e';
        }
      }
    };
    
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        cell.textContent = originalValue;
        cell.style.cursor = 'pointer';
      }
    });
  }

  // Salva todas as alterações pendentes
  async function saveAllChanges(){
    const changes = Object.values(pendingChanges);
    if (!changes.length) {
      alert('Nenhuma alteração pendente.');
      return;
    }

    const btn = saveBtn();
    if (!btn) return;
    
    btn.disabled = true;
    btn.textContent = 'Salvando...';
    
    try {
      // Processa cada alteração
      for (const change of changes) {
        const { originalCod, newCod, newTipo } = change;
        
        // Se o código foi alterado, precisa atualizar o registro
        if (newCod && newCod !== originalCod) {
          const res = await fetch(`${API_BASE}/api/familia/${encodeURIComponent(originalCod)}/cod`, {
            method: 'PATCH',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ newCod })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) {
            throw new Error(json.error || `Erro ao atualizar código de ${originalCod}`);
          }
        }
        
        // Se o tipo foi alterado
        if (newTipo !== undefined) {
          const codToUse = newCod || originalCod;
          const res = await fetch(`${API_BASE}/api/familia/${encodeURIComponent(codToUse)}/tipo`, {
            method: 'PATCH',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ tipo: newTipo })
          });
          const json = await res.json();
          if (!res.ok || !json.ok) {
            throw new Error(json.error || `Erro ao atualizar tipo de ${codToUse}`);
          }
        }
      }
      
      // Limpa as alterações pendentes
      Object.keys(pendingChanges).forEach(key => delete pendingChanges[key]);
      
      // Remove destaque visual
      tbody().querySelectorAll('td[style*="background"]').forEach(td => {
        td.style.background = '';
        td.style.color = '';
      });
      
      alert('Alterações salvas com sucesso!');
      await fetchFamilias();
      
    } catch(e){
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  }
  

  btn.addEventListener('click', async ev => {
    ev.preventDefault();
    
    // esconde kanban
    if (typeof hideKanban === 'function') hideKanban();
    
    // esconde armazem
    if (typeof hideArmazem === 'function') hideArmazem();
    const armTabsEl = document.getElementById('armazemTabs');
    const armContentEl = document.getElementById('armazemContent');
    if (armTabsEl) armTabsEl.style.display = 'none';
    if (armContentEl) armContentEl.style.display = 'none';
    document
      .querySelectorAll('#armazemContent .armazem-page')
      .forEach(p => (p.style.display = 'none'));
    
    // esconde todos os painéis principais
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display='none');
    
    // esconde abas de produto
    const mainHeader = document.querySelector('.main-header');
    if (mainHeader) mainHeader.style.display = 'none';
    
    // mostra painel Definições
    const pane = document.getElementById(paneId);
    if (pane) pane.style.display='block';
    
    // atualiza menu lateral
    document.querySelectorAll('.side-menu a').forEach(a => a.classList.remove('is-active'));
    btn.classList.add('is-active');
    
    // carrega famílias
    await fetchFamilias();
    
    // Não carrega campos automaticamente - só quando selecionar uma família
    // loadCamposConfig();
  });

  refreshBtn()?.addEventListener('click', e => { e.preventDefault(); fetchFamilias(true); });
  saveBtn()?.addEventListener('click', e => { e.preventDefault(); saveAllChanges(); });

  // === Configuração de Campos Obrigatórios ===
  
  // Escaneia todos os campos editáveis da página Produto
  function escanearCamposProduto() {
    const campos = [];
    
    // Busca todos os inputs, selects e textareas dentro de #produtoTabs
    const selectors = [
      '#produtoTabs input[id]:not([type="hidden"]):not([type="button"]):not([type="submit"])',
      '#produtoTabs select[id]',
      '#produtoTabs textarea[id]'
    ];
    
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const id = el.id;
        if (!id) return;
        
        // Tenta encontrar o label associado
        let rotulo = '';
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) {
          rotulo = label.textContent.trim();
        } else {
          // Tenta pegar de placeholder ou name
          rotulo = el.placeholder || el.name || el.getAttribute('aria-label') || id;
        }
        
        // Determina a guia (aba) onde o campo está
        let guia = 'desconhecida';
        let parent = el.closest('[id][style*="display"]');
        if (parent && parent.id) {
          guia = parent.id;
        }
        
        campos.push({
          chave: id,
          rotulo: rotulo,
          guia: guia,
          tipo: el.tagName.toLowerCase(),
          inputType: el.type || ''
        });
      });
    });
    
    return campos;
  }
  
  // Carrega campos salvos no servidor
  async function loadCamposConfig() {
    const spinner = document.getElementById('camposConfigSpinner');
    const container = document.getElementById('camposConfigContainer');
    if (!container) return;
    
    try {
      if (spinner) spinner.style.display = 'block';
      container.innerHTML = '';
      
      const res = await fetch(`${API_BASE}/api/config/campos-produto`);
      if (!res.ok) throw new Error('Erro ao carregar campos');
      
      const json = await res.json();
      const campos = json.campos || [];
      
      if (!campos.length) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--inactive-color);">Nenhum campo cadastrado. Clique em "Escanear Campos" para detectar os campos da página Produto.</div>';
        return;
      }
      
      // Agrupa por guia
      const porGuia = {};
      campos.forEach(c => {
        const g = c.guia || 'outros';
        if (!porGuia[g]) porGuia[g] = [];
        porGuia[g].push(c);
      });
      
      // Renderiza por guia
      Object.keys(porGuia).sort().forEach(guia => {
        const section = document.createElement('div');
        section.style.gridColumn = '1 / -1';
        section.style.marginTop = '16px';
        
        const title = document.createElement('h4');
        title.textContent = guia.replace(/([A-Z])/g, ' $1').trim();
        title.style.color = 'var(--content-title-color)';
        title.style.fontSize = '14px';
        title.style.fontWeight = '600';
        title.style.marginBottom = '8px';
        title.style.textTransform = 'capitalize';
        section.appendChild(title);
        
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
        grid.style.gap = '12px';
        
        porGuia[guia].forEach(campo => {
          const label = document.createElement('label');
          label.style.display = 'flex';
          label.style.alignItems = 'center';
          label.style.gap = '8px';
          label.style.cursor = 'pointer';
          label.style.padding = '8px 12px';
          label.style.border = '1px solid var(--border-color)';
          label.style.borderRadius = '6px';
          label.style.transition = 'background 0.2s, border-color 0.2s';
          
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = campo.habilitado !== false;
          checkbox.dataset.campoId = campo.id;
          checkbox.dataset.chave = campo.chave;
          checkbox.style.width = '18px';
          checkbox.style.height = '18px';
          checkbox.style.cursor = 'pointer';
          checkbox.style.accentColor = '#3a6df0';
          
          const textWrapper = document.createElement('div');
          textWrapper.style.flex = '1';
          textWrapper.style.display = 'flex';
          textWrapper.style.flexDirection = 'column';
          textWrapper.style.gap = '2px';
          
          const spanRotulo = document.createElement('span');
          spanRotulo.textContent = campo.rotulo || campo.chave;
          spanRotulo.style.fontWeight = '500';
          spanRotulo.style.fontSize = '13px';
          
          const spanChave = document.createElement('span');
          spanChave.textContent = campo.chave;
          spanChave.style.fontSize = '11px';
          spanChave.style.color = 'var(--inactive-color)';
          spanChave.style.fontFamily = 'monospace';
          
          textWrapper.appendChild(spanRotulo);
          textWrapper.appendChild(spanChave);
          
          label.appendChild(checkbox);
          label.appendChild(textWrapper);
          grid.appendChild(label);
          
          // Efeitos visuais
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              label.style.borderColor = '#3a6df0';
              label.style.background = 'rgba(58, 109, 240, 0.05)';
            } else {
              label.style.borderColor = 'var(--border-color)';
              label.style.background = 'transparent';
            }
          });
          
          if (checkbox.checked) {
            label.style.borderColor = '#3a6df0';
            label.style.background = 'rgba(58, 109, 240, 0.05)';
          }
          
          label.addEventListener('mouseenter', () => {
            if (!checkbox.checked) {
              label.style.background = 'var(--hover-menu-bg)';
            }
          });
          label.addEventListener('mouseleave', () => {
            if (!checkbox.checked) {
              label.style.background = 'transparent';
            }
          });
        });
        
        section.appendChild(grid);
        container.appendChild(section);
      });
      
    } catch (e) {
      console.error('Erro ao carregar campos:', e);
      container.innerHTML = `<div style="padding:20px; text-align:center; color:#f00;">Erro: ${e.message}</div>`;
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  }
  
  // Carregar famílias no combobox
  async function loadFamiliasConfig() {
    const select = document.getElementById('familiaConfigSelect');
    if (!select) return;
    
    try {
      const res = await fetch(`${API_BASE}/api/produtos/familias`);
      if (!res.ok) throw new Error('Erro ao buscar famílias');
      
      const familias = await res.json();
      
      // Limpa opções existentes (exceto a primeira "Selecione...")
      select.innerHTML = '<option value="">Selecione uma família...</option>';
      
      // Adiciona famílias (usa 'codigo' como value)
      familias.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.codigo;
        opt.textContent = f.nome_familia;
        opt.dataset.familiaId = f.id;
        select.appendChild(opt);
      });
      
      console.log(`[Config] ${familias.length} famílias carregadas`);
      
      // Mensagem inicial no container
      const container = document.getElementById('camposConfigContainer');
      if (container) {
        container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--inactive-color); font-size:14px;"><p style="margin:0;">📋 Selecione uma família acima para configurar os campos obrigatórios.</p></div>';
      }
      
    } catch (e) {
      console.error('[Config] Erro ao carregar famílias:', e);
    }
  }
  
  // Carrega campos obrigatórios de uma família
  async function loadCamposConfigFamilia(familiaCodigo) {
    const container = document.getElementById('camposConfigContainer');
    const spinner = document.getElementById('camposConfigSpinner');
    const infoDiv = document.getElementById('camposConfigInfo');
    
    if (!container) return;
    
    try {
      if (spinner) spinner.style.display = 'block';
      if (infoDiv) infoDiv.style.display = 'none';
      container.innerHTML = '';
      
      const res = await fetch(`${API_BASE}/api/config/familia-campos/${encodeURIComponent(familiaCodigo)}`);
      if (!res.ok) throw new Error('Erro ao buscar configuração');
      
      const campos = await res.json();
      
      if (!campos.length) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--inactive-color);">Nenhum campo disponível. Execute "Escanear Campos" primeiro.</div>';
        return;
      }
      
      // Agrupa por guia
      const porGuia = {};
      campos.forEach(c => {
        const g = c.guia || 'outros';
        if (!porGuia[g]) porGuia[g] = [];
        porGuia[g].push(c);
      });
      
      // Renderiza por guia (mesmo formato do loadCamposConfig)
      Object.keys(porGuia).sort().forEach(guia => {
        const section = document.createElement('div');
        section.style.gridColumn = '1 / -1';
        section.style.marginTop = '20px';
        
        const title = document.createElement('h4');
        title.innerHTML = `<i class="fa-solid fa-folder-open" style="color: #3b82f6; margin-right: 8px;"></i>${guia.replace(/([A-Z])/g, ' $1').trim()}`;
        title.style.color = 'var(--content-title-color)';
        title.style.fontSize = '15px';
        title.style.fontWeight = '600';
        title.style.marginBottom = '12px';
        title.style.textTransform = 'capitalize';
        title.style.borderBottom = '2px solid #3b82f6';
        title.style.paddingBottom = '8px';
        title.style.display = 'inline-block';
        section.appendChild(title);
        
        const grid = document.createElement('div');
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(300px, 1fr))';
        grid.style.gap = '12px';
        
        porGuia[guia].forEach(campo => {
          const label = document.createElement('label');
          label.style.display = 'flex';
          label.style.alignItems = 'center';
          label.style.gap = '12px';
          label.style.cursor = 'pointer';
          label.style.padding = '12px 16px';
          label.style.border = '2px solid var(--border-color)';
          label.style.borderRadius = '10px';
          label.style.transition = 'all 0.2s';
          label.style.background = 'var(--content-bg)';
          label.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
          
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = campo.obrigatorio;
          checkbox.dataset.chave = campo.chave;
          checkbox.style.width = '20px';
          checkbox.style.height = '20px';
          checkbox.style.cursor = 'pointer';
          checkbox.style.accentColor = '#3b82f6';
          checkbox.style.flexShrink = '0';
          
          const textWrapper = document.createElement('div');
          textWrapper.style.flex = '1';
          textWrapper.style.display = 'flex';
          textWrapper.style.flexDirection = 'column';
          textWrapper.style.gap = '4px';
          textWrapper.style.minWidth = '0';
          
          const spanRotulo = document.createElement('span');
          spanRotulo.textContent = campo.rotulo || campo.chave;
          spanRotulo.style.fontWeight = '600';
          spanRotulo.style.fontSize = '14px';
          spanRotulo.style.color = 'var(--content-title-color)';
          
          const spanChave = document.createElement('span');
          spanChave.textContent = campo.chave;
          spanChave.style.fontSize = '11px';
          spanChave.style.color = 'var(--inactive-color)';
          spanChave.style.fontFamily = 'monospace';
          spanChave.style.background = 'rgba(0,0,0,0.05)';
          spanChave.style.padding = '2px 6px';
          spanChave.style.borderRadius = '4px';
          spanChave.style.display = 'inline-block';
          
          textWrapper.appendChild(spanRotulo);
          textWrapper.appendChild(spanChave);
          
          label.appendChild(checkbox);
          label.appendChild(textWrapper);
          grid.appendChild(label);
          
          // Efeitos visuais
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              label.style.borderColor = '#3b82f6';
              label.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(37, 99, 235, 0.05) 100%)';
              label.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.2)';
              spanRotulo.style.color = '#3b82f6';
            } else {
              label.style.borderColor = 'var(--border-color)';
              label.style.background = 'var(--content-bg)';
              label.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
              spanRotulo.style.color = 'var(--content-title-color)';
            }
          });
          
          // Hover effect
          label.addEventListener('mouseenter', () => {
            label.style.transform = 'translateY(-2px)';
            label.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
          });
          
          label.addEventListener('mouseleave', () => {
            label.style.transform = 'translateY(0)';
            if (checkbox.checked) {
              label.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.2)';
            } else {
              label.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
            }
          });
          
          if (checkbox.checked) {
            label.style.borderColor = '#3b82f6';
            label.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(37, 99, 235, 0.05) 100%)';
            label.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.2)';
            spanRotulo.style.color = '#3b82f6';
          }
          
          label.addEventListener('mouseenter', () => {
            if (!checkbox.checked) {
              label.style.background = 'var(--hover-menu-bg)';
            }
          });
          label.addEventListener('mouseleave', () => {
            if (!checkbox.checked) {
              label.style.background = 'transparent';
            }
          });
        });
        
        section.appendChild(grid);
        container.appendChild(section);
      });
      
      if (infoDiv) {
        infoDiv.style.display = 'flex';
        infoDiv.innerHTML = `
          <i class="fa-solid fa-info-circle" style="color: #3b82f6; font-size: 18px; margin-top: 2px;"></i>
          <div style="color: #1e40af; font-size: 13px; line-height: 1.6;">
            Marque os campos que são <strong>obrigatórios</strong> para liberar produtos da família <strong>${familiaCodigo}</strong>.
          </div>
        `;
      }
      
      console.log(`[Config] ${campos.length} campos carregados para família ${familiaCodigo}`);
      
    } catch (e) {
      console.error('[Config] Erro ao carregar campos da família:', e);
      container.innerHTML = `<div style="padding:20px; text-align:center; color:#f00;">Erro: ${e.message}</div>`;
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  }
  
  // Listener para mudança de família no select
  const familiaSelect = document.getElementById('familiaConfigSelect');
  if (familiaSelect) {
    familiaSelect.addEventListener('change', e => {
      const familiaCodigo = e.target.value;
      if (familiaCodigo) {
        loadCamposConfigFamilia(familiaCodigo);
      } else {
        const container = document.getElementById('camposConfigContainer');
        const infoDiv = document.getElementById('camposConfigInfo');
        if (container) container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--inactive-color); font-size:14px;"><p style="margin:0;">📋 Selecione uma família acima para configurar os campos obrigatórios.</p></div>';
        if (infoDiv) {
          infoDiv.style.display = 'flex';
          infoDiv.innerHTML = `
            <i class="fa-solid fa-info-circle" style="color: #3b82f6; font-size: 18px; margin-top: 2px;"></i>
            <div style="color: #1e40af; font-size: 13px; line-height: 1.6;">
              <strong>Importante:</strong> Campos marcados como obrigatórios devem ser preenchidos antes de remover o status "Inativo" ou "Bloqueado". Use o botão "Escanear Campos" para atualizar a lista de campos disponíveis.
            </div>
          `;
        }
      }
    });
  }
  
  // Carrega famílias ao inicializar
  loadFamiliasConfig();
  
  // Botão: Escanear Campos
  const scanBtn = document.getElementById('scanCamposBtn');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      if (!confirm('Escanear campos irá detectar todos os campos editáveis da página Produto e salvá-los no banco. Continuar?')) {
        return;
      }
      
      try {
        scanBtn.disabled = true;
        scanBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Escaneando...';
        
        const campos = escanearCamposProduto();
        
        if (!campos.length) {
          alert('Nenhum campo detectado. Certifique-se de que a página Produto está carregada.');
          return;
        }
        
        const res = await fetch(`${API_BASE}/api/config/campos-produto/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campos })
        });
        
        if (!res.ok) throw new Error('Erro ao salvar campos');
        
        const json = await res.json();
        alert(`${json.novos || 0} campo(s) novo(s) detectado(s) e salvo(s)!`);
        
        await loadCamposConfig();
        
      } catch (e) {
        alert('Erro ao escanear: ' + (e.message || e));
      } finally {
        scanBtn.disabled = false;
        scanBtn.innerHTML = '<i class="fa-solid fa-sync"></i> Escanear Campos';
      }
    });
  }
  
  // Botão: Salvar Configuração
  const saveCamposBtn = document.getElementById('saveCamposConfigBtn');
  if (saveCamposBtn) {
    saveCamposBtn.addEventListener('click', async () => {
      const select = document.getElementById('familiaConfigSelect');
      const container = document.getElementById('camposConfigContainer');
      
      if (!select || !container) return;
      
      const familiaCodigo = select.value;
      if (!familiaCodigo) {
        alert('Selecione uma família antes de salvar.');
        return;
      }
      
      const checkboxes = container.querySelectorAll('input[type="checkbox"][data-chave]');
      const camposObrigatorios = [];
      
      checkboxes.forEach(cb => {
        if (cb.checked) {
          camposObrigatorios.push(cb.dataset.chave);
        }
      });
      
      try {
        saveCamposBtn.disabled = true;
        saveCamposBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        
        const res = await fetch(`${API_BASE}/api/config/familia-campos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            familiaCodigo,
            camposObrigatorios
          })
        });
        
        if (!res.ok) throw new Error('Erro ao salvar configuração');
        
        const json = await res.json();
        alert(`Configuração salva com sucesso! ${json.campos} campo(s) obrigatório(s) definido(s) para a família.`);
        
      } catch (e) {
        alert('Erro ao salvar: ' + (e.message || e));
      } finally {
        saveCamposBtn.disabled = false;
        saveCamposBtn.innerHTML = '<i class="fa-solid fa-save"></i> Salvar Configuração';
      }
    });
  }

})();

// ===== ATIVIDADES DE ENGENHARIA =====
(function initAtividadesEngenharia() {
  let familiaAtualAtividades = '';
  
  // Carrega atividades de uma família
  async function loadAtividades(familiaCodigo) {
    familiaAtualAtividades = familiaCodigo;
    const container = document.getElementById('atividadesContainer');
    const spinner = document.getElementById('atividadesSpinner');
    const infoDiv = document.getElementById('atividadesInfo');
    
    if (!container) return;
    
    if (!familiaCodigo) {
      container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--inactive-color); font-size:14px;"><p style="margin:0;">📋 Selecione uma família para gerenciar as atividades de engenharia.</p></div>';
      return;
    }
    
    try {
      if (spinner) spinner.style.display = 'block';
      if (infoDiv) infoDiv.style.display = 'none';
      container.innerHTML = '';
      
      const res = await fetch(`${API_BASE}/api/engenharia/atividades/${encodeURIComponent(familiaCodigo)}`);
      if (!res.ok) throw new Error('Erro ao buscar atividades');
      
      const atividades = await res.json();
      
      if (!atividades.length) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--inactive-color);">Nenhuma atividade cadastrada. Clique em "Adicionar Atividade" para criar.</div>';
        return;
      }
      
      // Renderiza cada atividade
      atividades.forEach((ativ, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'position: relative; padding: 20px; border: 2px solid var(--border-color); border-radius: 12px; background: linear-gradient(135deg, var(--content-bg) 0%, rgba(16, 185, 129, 0.02) 100%); display: flex; justify-content: space-between; align-items: start; gap: 16px; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.05);';
        
        card.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
              <span style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 4px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);">#${idx + 1}</span>
              <strong style="font-size: 16px; color: var(--content-title-color); font-weight: 600;">${ativ.nome_atividade}</strong>
            </div>
            ${ativ.descricao_atividade 
              ? `<p style="margin: 0; color: var(--inactive-color); font-size: 14px; line-height: 1.6; padding-left: 4px;">${ativ.descricao_atividade}</p>` 
              : '<p style="margin: 0; color: var(--inactive-color); font-size: 14px; font-style: italic; padding-left: 4px;">Sem descrição</p>'
            }
          </div>
          <button class="btn-delete-atividade" data-id="${ativ.id}" title="Remover atividade" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s; box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3); flex-shrink: 0;">
            <i class="fa-solid fa-trash"></i>
          </button>
        `;
        
        // Hover effects no card
        card.addEventListener('mouseenter', () => {
          card.style.borderColor = '#10b981';
          card.style.boxShadow = '0 4px 16px rgba(16, 185, 129, 0.2)';
          card.style.transform = 'translateY(-2px)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.borderColor = 'var(--border-color)';
          card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
          card.style.transform = 'translateY(0)';
        });
        
        // Hover effect no botão delete
        const deleteBtn = card.querySelector('.btn-delete-atividade');
        deleteBtn.addEventListener('mouseenter', () => {
          deleteBtn.style.transform = 'scale(1.05)';
          deleteBtn.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.5)';
        });
        deleteBtn.addEventListener('mouseleave', () => {
          deleteBtn.style.transform = 'scale(1)';
          deleteBtn.style.boxShadow = '0 2px 6px rgba(239, 68, 68, 0.3)';
        });
        
        container.appendChild(card);
      });
      
      // Event listeners para botões de deletar
      container.querySelectorAll('.btn-delete-atividade').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Tem certeza que deseja remover esta atividade?')) return;
          
          try {
            const res = await fetch(`${API_BASE}/api/engenharia/atividades/${id}`, {
              method: 'DELETE'
            });
            
            if (!res.ok) throw new Error('Erro ao deletar');
            
            await loadAtividades(familiaAtualAtividades);
            
          } catch (e) {
            alert('Erro ao remover: ' + (e.message || e));
          }
        });
      });
      
      if (infoDiv) {
        infoDiv.style.display = 'flex';
        infoDiv.innerHTML = `
          <i class="fa-solid fa-lightbulb" style="color: #059669; font-size: 18px; margin-top: 2px;"></i>
          <div style="color: #065f46; font-size: 13px; line-height: 1.6;">
            <strong>${atividades.length}</strong> atividade(s) cadastrada(s) para esta família. Adicione ou remova atividades conforme necessário.
          </div>
        `;
      }
      
      console.log(`[Atividades] ${atividades.length} atividade(s) carregada(s) para família ${familiaCodigo}`);
      
    } catch (e) {
      console.error('[Atividades] Erro ao carregar:', e);
      container.innerHTML = `<div style="padding:20px; text-align:center; color:red;">Erro: ${e.message}</div>`;
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  }
  
  // Modal de adicionar atividade
  const modal = document.getElementById('modalAtividade');
  const btnAdd = document.getElementById('addAtividadeBtn');
  const btnClose = document.getElementById('closeModalAtividade');
  const btnCancel = document.getElementById('cancelModalAtividade');
  const btnSave = document.getElementById('saveModalAtividade');
  const inputNome = document.getElementById('inputNomeAtividade');
  const inputDesc = document.getElementById('inputDescricaoAtividade');
  
  function abrirModal() {
    if (!familiaAtualAtividades) {
      alert('Selecione uma família primeiro!');
      return;
    }
    
    inputNome.value = '';
    inputDesc.value = '';
    modal.style.display = 'block';
    inputNome.focus();
  }
  
  function fecharModal() {
    modal.style.display = 'none';
  }
  
  async function salvarAtividade() {
    const nome = inputNome.value.trim();
    const descricao = inputDesc.value.trim();
    
    if (!nome) {
      alert('O nome da atividade é obrigatório!');
      inputNome.focus();
      return;
    }
    
    if (!familiaAtualAtividades) {
      alert('Nenhuma família selecionada!');
      fecharModal();
      return;
    }
    
    try {
      btnSave.disabled = true;
      btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
      
      const res = await fetch(`${API_BASE}/api/engenharia/atividades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familiaCodigo: familiaAtualAtividades,
          nomeAtividade: nome,
          descricaoAtividade: descricao,
          ordem: 0
        })
      });
      
      if (!res.ok) throw new Error('Erro ao salvar atividade');
      
      const json = await res.json();
      console.log('[Atividades] Atividade criada:', json.atividade);
      
      fecharModal();
      await loadAtividades(familiaAtualAtividades);
      
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i class="fa-solid fa-save"></i> Salvar';
    }
  }
  
  // Event listeners
  if (btnAdd) btnAdd.addEventListener('click', abrirModal);
  if (btnClose) btnClose.addEventListener('click', fecharModal);
  if (btnCancel) btnCancel.addEventListener('click', fecharModal);
  if (btnSave) btnSave.addEventListener('click', salvarAtividade);
  
  // Fecha modal ao clicar fora
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) fecharModal();
    });
  }
  
  // Enter no input nome salva
  if (inputNome) {
    inputNome.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        salvarAtividade();
      }
    });
  }
  
  // Listener para mudança de família (reutiliza o select de campos obrigatórios)
  const familiaSelect = document.getElementById('familiaConfigSelect');
  if (familiaSelect) {
    familiaSelect.addEventListener('change', (e) => {
      const familiaCodigo = e.target.value;
      loadAtividades(familiaCodigo);
    });
  }
  
  // Inicializa com mensagem padrão
  loadAtividades('');
  
})();

// ===== ATIVIDADES DE COMPRAS =====
(function initAtividadesCompras() {
  let familiaAtualCompras = '';

  async function loadAtividadesCompras(familiaCodigo) {
    familiaAtualCompras = familiaCodigo;
    const container = document.getElementById('atividadesComprasContainer');
    const spinner = document.getElementById('atividadesComprasSpinner');
    const infoDiv = document.getElementById('atividadesComprasInfo');
    if (!container) return;

    if (!familiaCodigo) {
      container.innerHTML = '<div style="padding:40px 20px; text-align:center; color:var(--inactive-color); font-size:14px;"><p style="margin:0;">🛒 Selecione uma família para gerenciar as atividades de compras.</p></div>';
      return;
    }

    try {
      if (spinner) spinner.style.display = 'block';
      if (infoDiv) infoDiv.style.display = 'none';
      container.innerHTML = '';

      const res = await fetch(`${API_BASE}/api/compras/atividades/${encodeURIComponent(familiaCodigo)}`);
      if (!res.ok) throw new Error('Erro ao buscar atividades (compras)');
      const atividades = await res.json();

      if (!atividades.length) {
        container.innerHTML = '<div style="padding:20px; text-align:center; color: var(--inactive-color);">Nenhuma atividade cadastrada. Clique em "Adicionar Atividade".</div>';
        return;
      }

      atividades.forEach((ativ, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'position: relative; padding: 20px; border: 2px solid var(--border-color); border-radius: 12px; background: linear-gradient(135deg, var(--content-bg) 0%, rgba(245, 158, 11, 0.03) 100%); display: flex; justify-content: space-between; align-items: start; gap: 16px; transition: all 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.05);';
        card.innerHTML = `
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
              <span style=\"background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 4px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3);\">#${idx + 1}</span>
              <strong style=\"font-size: 16px; color: var(--content-title-color); font-weight: 600;\">${ativ.nome_atividade}</strong>
            </div>
            ${ativ.descricao_atividade 
              ? `<p style=\"margin: 0; color: var(--inactive-color); font-size: 14px; line-height: 1.6; padding-left: 4px;\">${ativ.descricao_atividade}</p>` 
              : '<p style="margin: 0; color: var(--inactive-color); font-size: 14px; font-style: italic; padding-left: 4px;">Sem descrição</p>'
            }
          </div>
          <button class="btn-delete-atividade-compras" data-id="${ativ.id}" title="Remover atividade" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s; box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3); flex-shrink: 0;">
            <i class="fa-solid fa-trash"></i>
          </button>
        `;

        card.addEventListener('mouseenter', () => {
          card.style.borderColor = '#f59e0b';
          card.style.boxShadow = '0 4px 16px rgba(245, 158, 11, 0.25)';
          card.style.transform = 'translateY(-2px)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.borderColor = 'var(--border-color)';
          card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
          card.style.transform = 'translateY(0)';
        });

        const deleteBtn = card.querySelector('.btn-delete-atividade-compras');
        deleteBtn.addEventListener('mouseenter', () => {
          deleteBtn.style.transform = 'scale(1.05)';
          deleteBtn.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.5)';
        });
        deleteBtn.addEventListener('mouseleave', () => {
          deleteBtn.style.transform = 'scale(1)';
          deleteBtn.style.boxShadow = '0 2px 6px rgba(239, 68, 68, 0.3)';
        });

        container.appendChild(card);
      });

      container.querySelectorAll('.btn-delete-atividade-compras').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          if (!confirm('Tem certeza que deseja remover esta atividade (Compras)?')) return;
          try {
            const res = await fetch(`${API_BASE}/api/compras/atividades/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Erro ao deletar');
            await loadAtividadesCompras(familiaAtualCompras);
          } catch (e) {
            alert('Erro ao remover: ' + (e.message || e));
          }
        });
      });

      if (infoDiv) {
        infoDiv.style.display = 'flex';
        infoDiv.innerHTML = `
          <i class="fa-solid fa-lightbulb" style="color: #b45309; font-size: 18px; margin-top: 2px;"></i>
          <div style="color: #92400e; font-size: 13px; line-height: 1.6;">
            <strong>${atividades.length}</strong> atividade(s) de compras cadastrada(s) para esta família.
          </div>
        `;
      }
    } catch (e) {
      console.error('[Compras/Atividades] Erro ao carregar:', e);
      container.innerHTML = `<div style="padding:20px; text-align:center; color:red;">Erro: ${e.message}</div>`;
    } finally {
      if (spinner) spinner.style.display = 'none';
    }
  }

  const modal = document.getElementById('modalAtividadeCompras');
  const btnAdd = document.getElementById('addAtividadeComprasBtn');
  const btnClose = document.getElementById('closeModalAtividadeCompras');
  const btnCancel = document.getElementById('cancelModalAtividadeCompras');
  const btnSave = document.getElementById('saveModalAtividadeCompras');
  const inputNome = document.getElementById('inputNomeAtividadeCompras');
  const inputDesc = document.getElementById('inputDescricaoAtividadeCompras');

  function abrirModal() {
    if (!familiaAtualCompras) {
      alert('Selecione uma família primeiro!');
      return;
    }
    inputNome.value = '';
    inputDesc.value = '';
    modal.style.display = 'block';
    inputNome.focus();
  }

  function fecharModal() { modal.style.display = 'none'; }

  async function salvarAtividade() {
    const nome = inputNome.value.trim();
    const descricao = inputDesc.value.trim();
    if (!nome) {
      alert('O nome da atividade é obrigatório!');
      inputNome.focus();
      return;
    }
    if (!familiaAtualCompras) {
      alert('Nenhuma família selecionada!');
      fecharModal();
      return;
    }
    try {
      btnSave.disabled = true;
      btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
      const res = await fetch(`${API_BASE}/api/compras/atividades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familiaCodigo: familiaAtualCompras,
          nomeAtividade: nome,
          descricaoAtividade: descricao,
          ordem: 0
        })
      });
      if (!res.ok) throw new Error('Erro ao salvar atividade');
      fecharModal();
      await loadAtividadesCompras(familiaAtualCompras);
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i class="fa-solid fa-save"></i> Salvar Atividade';
    }
  }

  if (btnAdd) btnAdd.addEventListener('click', abrirModal);
  if (btnClose) btnClose.addEventListener('click', fecharModal);
  if (btnCancel) btnCancel.addEventListener('click', fecharModal);
  if (btnSave) btnSave.addEventListener('click', salvarAtividade);
  if (modal) {
    modal.addEventListener('click', (e) => { if (e.target === modal) fecharModal(); });
  }
  if (inputNome) {
    inputNome.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); salvarAtividade(); }
    });
  }
  const familiaSelect = document.getElementById('familiaConfigSelect');
  if (familiaSelect) {
    familiaSelect.addEventListener('change', (e) => {
      const familiaCodigo = e.target.value;
      loadAtividadesCompras(familiaCodigo);
    });
  }
  loadAtividadesCompras('');
})();

// ===== CHECK-PROJ (Checklist de Engenharia por Produto) =====
(function initCheckProj() {
  const listaEl = () => document.getElementById('checkProjLista');
  const loadingEl = () => document.getElementById('checkProjLoading');
  const infoEl = () => document.getElementById('checkProjInfo');
  const progressBar = () => document.getElementById('checkProjProgressBar');
  const progressText = () => document.getElementById('checkProjProgressText');

  function computeAndRenderProgress(items) {
    const total = items.length;
    const done = items.filter(i => i.concluido === true).length;
    const pct = total > 0 ? Math.round((done/total)*100) : 0;
    if (progressBar()) progressBar().style.width = pct + '%';
    if (progressText()) progressText().textContent = `${done}/${total} concluídas (${pct}%)`;
  }

  function renderLista(atividades) {
    const root = listaEl();
    if (!root) return;
    root.innerHTML = '';
    if (!atividades.length) {
      root.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color: var(--inactive-color); padding: 16px;">Nenhuma atividade de engenharia configurada para a família deste produto.</div>';
      computeAndRenderProgress([]);
      return;
    }

    atividades.forEach((a, idx) => {
      const card = document.createElement('div');
      card.className = 'check-proj-item';
      
      // Define cor da borda: azul para atividades específicas, cinza para da família
      const borderColor = a.origem === 'produto' ? '#3b82f6' : 'var(--border-color)';
      card.style.cssText = `border:2px solid ${borderColor}; border-radius:10px; padding:12px; background:var(--content-bg); display:flex; gap:12px; align-items:flex-start;`;

      // Nome da atividade (usa nome_atividade para família, nome para produto)
      const nomeAtividade = a.nome_atividade || a.nome || 'Sem nome';
      const descricaoAtividade = a.descricao_atividade || a.observacoes || '';
      
      // Badge "ESPECÍFICA" para atividades do produto
      const badgeEspecifica = a.origem === 'produto' 
        ? '<span style="background:#3b82f6; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:600; margin-left:8px;">ESPECÍFICA</span>'
        : '';

      card.innerHTML = `
        <input type="checkbox" class="chk-concluido" ${a.concluido ? 'checked' : ''} style="width:18px; height:18px; margin-top:3px; accent-color:#22c55e;"/>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span style="background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:600;">#${idx+1}</span>
              <strong style="color: var(--content-title-color); font-size:15px;">${nomeAtividade}</strong>
              ${badgeEspecifica}
            </div>
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; color: var(--inactive-color); white-space:nowrap;">
              <input type="checkbox" class="chk-na" ${a.nao_aplicavel ? 'checked' : ''} style="accent-color:#f59e0b; width:16px; height:16px;"/> Não se aplica
            </label>
          </div>
          <div style="margin-top:6px; color: var(--inactive-color); font-size:13px;">${descricaoAtividade || '<em>Sem descrição</em>'}</div>
          <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
            <input type="text" class="inp-obs" placeholder="Observação (opcional)" value="${(a.observacao_status || a.observacao || '').replaceAll('"','&quot;')}" style="flex:1; padding:8px 10px; border:2px solid var(--border-color); border-radius:8px; background:#fff; color:#1f2937; font-size:13px;"/>
            <span class="status-data" style="font-size:12px; color:${a.concluido ? '#16a34a' : 'var(--inactive-color)'};">
              ${a.concluido && a.data_conclusao ? new Date(a.data_conclusao).toLocaleString('pt-BR') : ''}
            </span>
          </div>
        </div>
      `;

      // interactions
      const chk = card.querySelector('.chk-concluido');
      const chkNa = card.querySelector('.chk-na');
      const inpObs = card.querySelector('.inp-obs');
      const statusData = card.querySelector('.status-data');

      const updateLocal = () => {
        a.concluido = chk.checked;
        a.nao_aplicavel = chkNa.checked;
        a.observacao = inpObs.value;
        a.data_conclusao = a.concluido ? (a.data_conclusao || new Date().toISOString()) : null;
        statusData.style.color = a.concluido ? '#16a34a' : 'var(--inactive-color)';
        statusData.textContent = a.concluido && a.data_conclusao ? new Date(a.data_conclusao).toLocaleString('pt-BR') : '';
        computeAndRenderProgress(atividades);
      };
      chk.addEventListener('change', updateLocal);
      chkNa.addEventListener('change', updateLocal);
      inpObs.addEventListener('change', updateLocal);

      card.dataset.atividadeId = a.atividade_id || a.id;
      card.dataset.origem = a.origem;
      root.appendChild(card);
    });

    computeAndRenderProgress(atividades);
  }

  async function loadCheckProj() {
    const codigo = window.currentProdutoCodigo || window.codigoSelecionado || '';
    const familia = window.currentProdutoFamilia || '';
    if (!codigo || !familia) {
      if (listaEl()) {
        listaEl().innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--inactive-color); padding: 16px;">Abra um produto para carregar o checklist.</div>';
      }
      return;
    }
    if (loadingEl()) loadingEl().style.display = 'block';
    if (infoEl()) { infoEl().style.display = 'none'; infoEl().textContent = ''; }
    try {
      // Busca atividades da família
      const urlFamilia = `${API_BASE}/api/engenharia/produto-atividades?codigo=${encodeURIComponent(codigo)}&familia=${encodeURIComponent(familia)}`;
      const resFamilia = await fetch(urlFamilia);
      if (!resFamilia.ok) throw new Error('Falha ao carregar checklist da família');
      const atividadesFamilia = await resFamilia.json();
      
      // Busca atividades específicas do produto
      const urlProduto = `${API_BASE}/api/engenharia/atividades-produto/${encodeURIComponent(codigo)}`;
      const resProduto = await fetch(urlProduto);
      let atividadesProduto = [];
      if (resProduto.ok) {
        const data = await resProduto.json();
        atividadesProduto = data.atividades || [];
      }
      
      // Mescla as atividades: da família + específicas do produto
      // Marca as atividades específicas com um flag para diferenciar visualmente
      const atividadesMescladas = [
        ...atividadesFamilia.map(a => ({ ...a, origem: 'familia' })),
        ...atividadesProduto.map(a => ({ ...a, atividade_id: null, atividade_produto_id: a.id, origem: 'produto' }))
      ];
      
      renderLista(atividadesMescladas);
      
      if (infoEl()) {
        const totalFamilia = atividadesFamilia.length;
        const totalProduto = atividadesProduto.length;
        const total = totalFamilia + totalProduto;
        infoEl().style.display = 'block';
        infoEl().innerHTML = `<strong>${total}</strong> atividade(s): <strong>${totalFamilia}</strong> da família + <strong>${totalProduto}</strong> específica(s) do produto <strong>${codigo}</strong>.`;
      }
    } catch (e) {
      console.error('[Check-Proj] Erro:', e);
      if (listaEl()) listaEl().innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#ef4444; padding:16px;">Erro ao carregar: ${e.message}</div>`;
    } finally {
      if (loadingEl()) loadingEl().style.display = 'none';
    }
  }

  async function salvarCheckProj() {
    const codigo = window.currentProdutoCodigo || window.codigoSelecionado || '';
    const produtoIdOmie = window.currentProdutoIdOmie || null;
    const items = Array.from((listaEl()||document.createElement('div')).querySelectorAll('.check-proj-item'));
    if (!items.length || !codigo) return;

    // Separar atividades da família e específicas do produto
    const atividadesFamilia = [];
    const atividadesProduto = [];
    
    items.forEach(card => {
      const origem = card.dataset.origem;
      const data = {
        concluido: card.querySelector('.chk-concluido')?.checked || false,
        nao_aplicavel: card.querySelector('.chk-na')?.checked || false,
        observacao: card.querySelector('.inp-obs')?.value || ''
      };
      
      if (origem === 'produto') {
        atividadesProduto.push({
          atividade_produto_id: Number(card.dataset.atividadeId),
          ...data
        });
      } else {
        atividadesFamilia.push({
          atividade_id: Number(card.dataset.atividadeId),
          ...data
        });
      }
    });

    try {
      // Salvar atividades da família
      if (atividadesFamilia.length > 0) {
        const res = await fetch(`${API_BASE}/api/engenharia/produto-status/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produto_codigo: codigo, produto_id_omie: produtoIdOmie, itens: atividadesFamilia })
        });
        if (!res.ok) throw new Error('Falha ao salvar atividades da família');
      }
      
      // Salvar atividades específicas do produto
      if (atividadesProduto.length > 0) {
        const res = await fetch(`${API_BASE}/api/engenharia/atividade-produto-status/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produto_codigo: codigo, itens: atividadesProduto })
        });
        if (!res.ok) throw new Error('Falha ao salvar atividades específicas');
      }
      
      // reload to reflect timestamps
      await loadCheckProj();
      alert('Checklist salvo com sucesso.');
    } catch (e) {
      alert('Erro ao salvar checklist: ' + e.message);
    }
  }

  // Expor função globalmente para o handler de navegação
  window.checkProj = { loadCheckProj };

  document.getElementById('checkProjSalvarBtn')?.addEventListener('click', salvarCheckProj);

  // Se o usuário abrir um produto e esta aba já estiver ativa, recarrega
  window.addEventListener('produto-carregado', () => {
    const active = document.querySelector('#produtoTabs .main-header .nav-card.active[data-target="checkProjTab"]');
    if (active) loadCheckProj();
  });
  
  // === MODAL: Nova Tarefa do Produto ===
  const modal = document.getElementById('modalNovaTarefaProduto');
  const btnNovaTarefa = document.getElementById('checkProjNovaTarefaBtn');
  const btnFechar = document.getElementById('modalNovaTarefaFechar');
  const btnCancelar = document.getElementById('modalNovaTarefaCancelar');
  const btnSalvar = document.getElementById('modalNovaTarefaSalvar');
  const inputDescricao = document.getElementById('novaTarefaDescricao');
  const inputObs = document.getElementById('novaTarefaObs');
  
  function abrirModal() {
    if (!window.currentProdutoCodigo) {
      alert('Nenhum produto selecionado');
      return;
    }
    if (inputDescricao) inputDescricao.value = '';
    if (inputObs) inputObs.value = '';
    if (modal) modal.style.display = 'flex';
  }
  
  function fecharModal() {
    if (modal) modal.style.display = 'none';
  }
  
  async function salvarNovaTarefa() {
    const descricao = inputDescricao?.value.trim();
    const observacoes = inputObs?.value.trim();
    
    if (!descricao) {
      alert('Por favor, informe a descrição da tarefa');
      return;
    }
    
    if (!window.currentProdutoCodigo) {
      alert('Nenhum produto selecionado');
      return;
    }
    
    try {
      btnSalvar.disabled = true;
      btnSalvar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
      
      const resp = await fetch('/api/engenharia/atividade-produto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          produto_codigo: window.currentProdutoCodigo,
          descricao,
          observacoes
        })
      });
      
      if (!resp.ok) throw new Error('Erro ao criar atividade');
      
      const data = await resp.json();
      console.log('[CheckProj] Nova atividade criada:', data);
      
      fecharModal();
      
      // Recarrega a lista para mostrar a nova atividade
      loadCheckProj();
      
      alert('Tarefa criada com sucesso!');
    } catch (err) {
      console.error('[CheckProj] Erro ao salvar tarefa:', err);
      alert('Erro ao salvar tarefa. Tente novamente.');
    } finally {
      btnSalvar.disabled = false;
      btnSalvar.innerHTML = '<i class="fa-solid fa-check"></i> Adicionar';
    }
  }
  
  if (btnNovaTarefa) btnNovaTarefa.addEventListener('click', abrirModal);
  if (btnFechar) btnFechar.addEventListener('click', fecharModal);
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModal);
  if (btnSalvar) btnSalvar.addEventListener('click', salvarNovaTarefa);
  
  // Fechar modal ao clicar fora
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) fecharModal();
    });
  }
  
  // Fechar modal com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
      fecharModal();
    }
  });
})();

// ===== CHECK-COMPRAS (Checklist de Compras por Produto) =====
(function initCheckCompras() {
  const listaEl = () => document.getElementById('checkComprasLista');
  const loadingEl = () => document.getElementById('checkComprasLoading');
  const infoEl = () => document.getElementById('checkComprasInfo');
  const progressBar = () => document.getElementById('checkComprasProgressBar');
  const progressText = () => document.getElementById('checkComprasProgressText');

  function computeAndRenderProgress(items) {
    const total = items.length;
    const done = items.filter(i => i.concluido === true).length;
    const pct = total > 0 ? Math.round((done/total)*100) : 0;
    if (progressBar()) progressBar().style.width = pct + '%';
    if (progressText()) progressText().textContent = `${done}/${total} concluídas (${pct}%)`;
  }

  function renderLista(atividades) {
    const root = listaEl();
    if (!root) return;
    root.innerHTML = '';
    if (!atividades.length) {
      root.innerHTML = '<div style="grid-column: 1/-1; text-align:center; color: var(--inactive-color); padding: 16px;">Nenhuma atividade de compras configurada para a família deste produto.</div>';
      computeAndRenderProgress([]);
      return;
    }
    
    atividades.forEach((a, idx) => {
      const card = document.createElement('div');
      card.className = 'check-compras-item';
      
      // Define cor da borda: laranja para atividades específicas, cinza para da família
      const borderColor = a.origem === 'produto' ? '#f59e0b' : 'var(--border-color)';
      card.style.cssText = `border:2px solid ${borderColor}; border-radius:10px; padding:12px; background:var(--content-bg); display:flex; gap:12px; align-items:flex-start;`;
      
      // Nome da atividade (usa nome_atividade para família, nome para produto)
      const nomeAtividade = a.nome_atividade || a.nome || 'Sem nome';
      const descricaoAtividade = a.descricao_atividade || a.observacoes || '';
      
      // Badge "ESPECÍFICA" para atividades do produto
      const badgeEspecifica = a.origem === 'produto' 
        ? '<span style="background:#f59e0b; color:#fff; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:600; margin-left:8px;">ESPECÍFICA</span>'
        : '';
      
      card.innerHTML = `
        <input type="checkbox" class="chk-concluido" ${a.concluido ? 'checked' : ''} style="width:18px; height:18px; margin-top:3px; accent-color:#f59e0b;"/>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span style="background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:600;">#${idx+1}</span>
              <strong style="color: var(--content-title-color); font-size:15px;">${nomeAtividade}</strong>
              ${badgeEspecifica}
            </div>
            <label style="display:flex; align-items:center; gap:6px; font-size:12px; color: var(--inactive-color); white-space:nowrap;">
              <input type="checkbox" class="chk-na" ${a.nao_aplicavel ? 'checked' : ''} style="accent-color:#f59e0b; width:16px; height:16px;"/> Não se aplica
            </label>
          </div>
          <div style="margin-top:6px; color: var(--inactive-color); font-size:13px;">${descricaoAtividade || '<em>Sem descrição</em>'}</div>
          <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
            <input type="text" class="inp-obs" placeholder="Observação (opcional)" value="${(a.observacao || a.observacao_status || '').replaceAll('"','&quot;')}" style="flex:1; padding:8px 10px; border:2px solid var(--border-color); border-radius:8px; background:#fff; color:#1f2937; font-size:13px;"/>
            <span class="status-data" style="font-size:12px; color:${a.concluido ? '#b45309' : 'var(--inactive-color)'};">
              ${a.concluido && a.data_conclusao ? new Date(a.data_conclusao).toLocaleString('pt-BR') : ''}
            </span>
          </div>
        </div>`;

      const chk = card.querySelector('.chk-concluido');
      const chkNa = card.querySelector('.chk-na');
      const inpObs = card.querySelector('.inp-obs');
      const statusData = card.querySelector('.status-data');
      
      const updateLocal = () => {
        a.concluido = chk.checked;
        a.nao_aplicavel = chkNa.checked;
        a.observacao = inpObs.value;
        a.data_conclusao = a.concluido ? (a.data_conclusao || new Date().toISOString()) : null;
        statusData.style.color = a.concluido ? '#b45309' : 'var(--inactive-color)';
        statusData.textContent = a.concluido && a.data_conclusao ? new Date(a.data_conclusao).toLocaleString('pt-BR') : '';
        computeAndRenderProgress(atividades);
      };
      
      chk.addEventListener('change', updateLocal);
      chkNa.addEventListener('change', updateLocal);
      inpObs.addEventListener('change', updateLocal);
      
      card.dataset.atividadeId = a.atividade_id || a.id;
      card.dataset.origem = a.origem;
      root.appendChild(card);
    });
    
    computeAndRenderProgress(atividades);
  }

  async function loadCheckCompras() {
    const codigo = window.currentProdutoCodigo || window.codigoSelecionado || '';
    const familia = window.currentProdutoFamilia || '';
    if (!codigo || !familia) {
      if (listaEl()) {
        listaEl().innerHTML = '<div style="grid-column:1/-1; text-align:center; color: var(--inactive-color); padding: 16px;">Abra um produto para carregar o checklist.</div>';
      }
      return;
    }
    if (loadingEl()) loadingEl().style.display = 'block';
    if (infoEl()) { infoEl().style.display = 'none'; infoEl().textContent = ''; }
    try {
      // Busca atividades da família
      const urlFamilia = `${API_BASE}/api/compras/produto-atividades?codigo=${encodeURIComponent(codigo)}&familia=${encodeURIComponent(familia)}`;
      const resFamilia = await fetch(urlFamilia);
      if (!resFamilia.ok) throw new Error('Falha ao carregar checklist da família');
      const atividadesFamilia = await resFamilia.json();
      
      // Busca atividades específicas do produto
      const urlProduto = `${API_BASE}/api/compras/atividades-produto/${encodeURIComponent(codigo)}`;
      const resProduto = await fetch(urlProduto);
      let atividadesProduto = [];
      if (resProduto.ok) {
        const data = await resProduto.json();
        atividadesProduto = data.atividades || [];
      }
      
      // Mescla as atividades: da família + específicas do produto
      // Marca as atividades específicas com um flag para diferenciar visualmente
      const atividadesMescladas = [
        ...atividadesFamilia.map(a => ({ ...a, origem: 'familia' })),
        ...atividadesProduto.map(a => ({ ...a, atividade_id: null, atividade_produto_id: a.id, origem: 'produto' }))
      ];
      
      renderLista(atividadesMescladas);
      
      if (infoEl()) {
        const totalFamilia = atividadesFamilia.length;
        const totalProduto = atividadesProduto.length;
        const total = totalFamilia + totalProduto;
        infoEl().style.display = 'block';
        infoEl().innerHTML = `<strong>${total}</strong> atividade(s): <strong>${totalFamilia}</strong> da família + <strong>${totalProduto}</strong> específica(s) do produto <strong>${codigo}</strong>.`;
      }
    } catch (e) {
      console.error('[Check-Compras] Erro:', e);
      if (listaEl()) listaEl().innerHTML = `<div style="grid-column:1/-1; text-align:center; color:#ef4444; padding:16px;">Erro ao carregar: ${e.message}</div>`;
    } finally {
      if (loadingEl()) loadingEl().style.display = 'none';
    }
  }

  async function salvarCheckCompras() {
    const codigo = window.currentProdutoCodigo || window.codigoSelecionado || '';
    const produtoIdOmie = window.currentProdutoIdOmie || null;
    const items = Array.from((listaEl()||document.createElement('div')).querySelectorAll('.check-compras-item'));
    if (!items.length || !codigo) return;

    // Separar atividades da família e específicas do produto
    const atividadesFamilia = [];
    const atividadesProduto = [];
    
    items.forEach(card => {
      const origem = card.dataset.origem;
      const data = {
        concluido: card.querySelector('.chk-concluido')?.checked || false,
        nao_aplicavel: card.querySelector('.chk-na')?.checked || false,
        observacao: card.querySelector('.inp-obs')?.value || ''
      };
      
      if (origem === 'produto') {
        atividadesProduto.push({
          atividade_produto_id: Number(card.dataset.atividadeId),
          ...data
        });
      } else {
        atividadesFamilia.push({
          atividade_id: Number(card.dataset.atividadeId),
          ...data
        });
      }
    });

    try {
      // Salvar atividades da família
      if (atividadesFamilia.length > 0) {
        const res = await fetch(`${API_BASE}/api/compras/produto-status/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produto_codigo: codigo, produto_id_omie: produtoIdOmie, itens: atividadesFamilia })
        });
        if (!res.ok) throw new Error('Falha ao salvar atividades da família');
      }
      
      // Salvar atividades específicas do produto
      if (atividadesProduto.length > 0) {
        const res = await fetch(`${API_BASE}/api/compras/atividade-produto-status/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produto_codigo: codigo, itens: atividadesProduto })
        });
        if (!res.ok) throw new Error('Falha ao salvar atividades específicas');
      }
      
      // reload to reflect timestamps
      await loadCheckCompras();
      alert('Checklist de compras salvo com sucesso.');
    } catch (e) {
      alert('Erro ao salvar checklist: ' + e.message);
    }
  }

  // Expor função globalmente para o handler de navegação
  window.checkCompras = { loadCheckCompras };

  document.getElementById('checkComprasSalvarBtn')?.addEventListener('click', salvarCheckCompras);
  window.addEventListener('produto-carregado', () => {
    const active = document.querySelector('#produtoTabs .main-header .nav-card.active[data-target="checkComprasTab"]');
    if (active) loadCheckCompras();
  });
  
  // === MODAL: Nova Tarefa de Compras do Produto ===
  const modal = document.getElementById('modalNovaTarefaCompras');
  const btnNovaTarefa = document.getElementById('checkComprasNovaTarefaBtn');
  const btnFechar = document.getElementById('modalNovaTarefaComprasFechar');
  const btnCancelar = document.getElementById('modalNovaTarefaComprasCancelar');
  const btnSalvar = document.getElementById('modalNovaTarefaComprasSalvar');
  const inputDescricao = document.getElementById('novaTarefaComprasDescricao');
  const inputObs = document.getElementById('novaTarefaComprasObs');
  
  function abrirModal() {
    if (!window.currentProdutoCodigo) {
      alert('Nenhum produto selecionado');
      return;
    }
    if (inputDescricao) inputDescricao.value = '';
    if (inputObs) inputObs.value = '';
    if (modal) modal.style.display = 'flex';
  }
  
  function fecharModal() {
    if (modal) modal.style.display = 'none';
  }
  
  async function salvarNovaTarefa() {
    const descricao = inputDescricao?.value.trim();
    const observacoes = inputObs?.value.trim();
    
    if (!descricao) {
      alert('Por favor, informe a descrição da tarefa');
      return;
    }
    
    if (!window.currentProdutoCodigo) {
      alert('Nenhum produto selecionado');
      return;
    }
    
    try {
      btnSalvar.disabled = true;
      btnSalvar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
      
      const resp = await fetch('/api/compras/atividade-produto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          produto_codigo: window.currentProdutoCodigo,
          descricao,
          observacoes
        })
      });
      
      if (!resp.ok) throw new Error('Erro ao criar atividade');
      
      const data = await resp.json();
      console.log('[CheckCompras] Nova atividade criada:', data);
      
      fecharModal();
      
      // Recarrega a lista para mostrar a nova atividade
      loadCheckCompras();
      
      alert('Tarefa criada com sucesso!');
    } catch (err) {
      console.error('[CheckCompras] Erro ao salvar tarefa:', err);
      alert('Erro ao salvar tarefa. Tente novamente.');
    } finally {
      btnSalvar.disabled = false;
      btnSalvar.innerHTML = '<i class="fa-solid fa-check"></i> Adicionar';
    }
  }
  
  if (btnNovaTarefa) btnNovaTarefa.addEventListener('click', abrirModal);
  if (btnFechar) btnFechar.addEventListener('click', fecharModal);
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModal);
  if (btnSalvar) btnSalvar.addEventListener('click', salvarNovaTarefa);
  
  // Fechar modal ao clicar fora
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) fecharModal();
    });
  }
  
  // Fechar modal com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
      fecharModal();
    }
  });
})();



// ===== MODAL NOVO PRODUTO =====
(function initModalNovoProduto() {
  const modalOverlay = document.getElementById('modalNovoProduto');
  const btnNovoProduto = document.getElementById('btnNovoProduto');
  const btnClose = modalOverlay?.querySelector('.modal-close');
  const btnCancel = modalOverlay?.querySelector('.btn-cancel');
  const selectFamilia = document.getElementById('novoProd_familia');
  const spanFamiliaTipo = document.getElementById('novoProd_familiaTipo');
  const formNovoProduto = document.getElementById('formNovoProduto');
  const codigoPreview = document.getElementById('codigoPreview');
  const origemLabel = document.getElementById('novoProd_origem_label');
  const selectOrigem = document.getElementById('novoProd_origem');
  const inputResto = document.getElementById('novoProd_resto');
  const restoHelp = document.getElementById('novoProd_resto_help');

  if (!modalOverlay || !btnNovoProduto) return;

  // Dados da família selecionada
  let familiaAtual = { tipo: '', codigo: '', nome: '' };

  // Helper: verifica se código da família é alfabético (1-3 letras)
  function familiaPrefixoAlfabetico() {
    const c = String(familiaAtual.codigo || '').trim();
    return /^[A-Za-z]{1,3}$/.test(c);
  }

  // Atualiza preview do código automaticamente quando seleciona família
  function updateCodigoPreview() {
    // Basta ter o código da família; tipo é necessário só no ramo numérico
    if (!familiaAtual.codigo) {
      codigoPreview.textContent = '--.--.-.-----';
      codigoPreview.style.color = '#6b7280'; // cinza se não selecionado
      return;
    }
    if (familiaPrefixoAlfabetico()) {
      // Modo prefixo por letras: FT + números digitados (2-5)
      const prefixo = String(familiaAtual.codigo).toUpperCase();
      const resto = (inputResto?.value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0,10);
      codigoPreview.textContent = `${prefixo}${resto || ''}`;
      codigoPreview.style.color = '#60a5fa';
    } else {
      // Modo padrão numérico com pontos e origem
      const cod = String(familiaAtual.codigo).padStart(2, '0');
      const tipo = String(familiaAtual.tipo || '--').toUpperCase();
      let origemChar = '-';
      if (selectOrigem) {
        const origemVal = selectOrigem.value;
        if (origemVal === '0') origemChar = 'N';
        else if (origemVal === '1') origemChar = 'I';
      }
      codigoPreview.textContent = `${cod}.${tipo}.${origemChar}.-----`;
      codigoPreview.style.color = '#60a5fa';
    }
  }

  // Abre modal
  btnNovoProduto.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Adiciona spinner no botão
    const originalHTML = btnNovoProduto.innerHTML;
    btnNovoProduto.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Carregando...';
    btnNovoProduto.disabled = true;
    
    try {
      await Promise.all([loadFamilias(), loadUnidades()]);
      updateCodigoPreview();
      modalOverlay.classList.add('active');
    } finally {
      // Restaura o botão
      btnNovoProduto.innerHTML = originalHTML;
      btnNovoProduto.disabled = false;
    }
  });

  // Fecha modal
  function closeModal() {
    modalOverlay.classList.remove('active');
    formNovoProduto.reset();
    familiaAtual = { tipo: '', codigo: '', nome: '' };
    spanFamiliaTipo.textContent = '-';
    codigoPreview.textContent = '--.--.-.-----';
    codigoPreview.style.color = '#6b7280';
  // Reset campos dinâmicos
  if (origemLabel) origemLabel.innerHTML = 'Origem <span style="color:#f87171;">*</span>';
  if (selectOrigem) { selectOrigem.style.display = ''; selectOrigem.required = true; selectOrigem.value=''; }
  if (inputResto) { inputResto.style.display = 'none'; inputResto.required = false; inputResto.value=''; }
  if (restoHelp) restoHelp.style.display = 'none';
    
    // Limpa status
    const statusDiv = document.getElementById('statusCriacaoProduto');
    const statusSpinner = document.getElementById('statusSpinner');
    const statusTexto = document.getElementById('statusTexto');
    const statusDetalhes = document.getElementById('statusDetalhes');
    
    if (statusDiv) statusDiv.style.display = 'none';
    if (statusSpinner) statusSpinner.style.display = 'none';
    if (statusTexto) statusTexto.textContent = '';
    if (statusDetalhes) statusDetalhes.textContent = '';
    
    // Reabilita botões
    const btnCancelar = document.getElementById('btnCancelarModal');
    const btnCriar = document.getElementById('btnCriarProduto');
    if (btnCancelar) btnCancelar.disabled = false;
    if (btnCriar) btnCriar.disabled = false;
  }

  btnClose?.addEventListener('click', closeModal);
  btnCancel?.addEventListener('click', closeModal);

  // Fecha ao clicar fora
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Carrega famílias do backend
  async function loadFamilias() {
    try {
      const resp = await fetch(`${API_BASE}/api/familia/list`);
      if (!resp.ok) {
        const errorText = await resp.text();
        throw new Error(`Status ${resp.status}: ${errorText}`);
      }
      
      const result = await resp.json();
      const data = result.familias || result;
      
      if (!Array.isArray(data)) {
        throw new Error('Resposta da API não contém um array de famílias');
      }
      
      selectFamilia.innerHTML = '';
      
      // Adiciona opção em branco
      const optBlank = document.createElement('option');
      optBlank.value = '';
      optBlank.textContent = '-- Selecione uma família --';
      selectFamilia.appendChild(optBlank);
      
      data.forEach(fam => {
        const opt = document.createElement('option');
        opt.value = fam.cod || fam.codigo;
        opt.textContent = fam.nome_familia || fam.nomeFamilia || 'Sem nome';
        opt.dataset.tipo = fam.tipo || '';
        selectFamilia.appendChild(opt);
      });
      
      console.log(`${data.length} famílias carregadas com sucesso`);
    } catch (err) {
      console.error('Erro ao carregar famílias:', err);
      alert('Erro ao carregar famílias: ' + err.message);
    }
  }

  // Carrega unidades do banco de dados
  async function loadUnidades() {
    const selectUnidade = document.getElementById('novoProd_unidade');
    if (!selectUnidade) return;
    
    try {
      const resp = await fetch(`${API_BASE}/api/produtos/unidades`, {
        method: 'GET',
        credentials: 'include'
      });
      
      if (!resp.ok) {
        throw new Error(`Erro ao buscar unidades: ${resp.status}`);
      }
      
      const result = await resp.json();
      const unidades = result.unidade_cadastro || [];
      
      selectUnidade.innerHTML = '';
      
      // Adiciona opção em branco
      const optBlank = document.createElement('option');
      optBlank.value = '';
      optBlank.textContent = '-- Selecione uma unidade --';
      selectUnidade.appendChild(optBlank);
      
      unidades.forEach(un => {
        const opt = document.createElement('option');
        opt.value = un.codigo;
        opt.textContent = `${un.codigo} - ${un.descricao}`;
        selectUnidade.appendChild(opt);
      });
      
      console.log(`${unidades.length} unidades carregadas com sucesso`);
    } catch (err) {
      console.error('Erro ao carregar unidades:', err);
      selectUnidade.innerHTML = '<option value="">Erro ao carregar unidades</option>';
    }
  }

  // Ao selecionar família, atualiza dados e preview
  selectFamilia?.addEventListener('change', () => {
    const selectedOpt = selectFamilia.options[selectFamilia.selectedIndex];
    
    if (!selectedOpt || !selectedOpt.value) {
      familiaAtual = { tipo: '', codigo: '', nome: '' };
      spanFamiliaTipo.textContent = '-';
    } else {
      familiaAtual = {
        tipo: selectedOpt.dataset.tipo || '',
        codigo: selectedOpt.value || '',
        nome: selectedOpt.textContent || ''
      };
      spanFamiliaTipo.textContent = familiaAtual.tipo || '-';
    }
    // Alterna controles conforme tipo de prefixo
    if (familiaPrefixoAlfabetico()) {
      if (origemLabel) origemLabel.textContent = 'Restante do código';
      if (selectOrigem) { selectOrigem.style.display = 'none'; selectOrigem.required = false; selectOrigem.value=''; }
      if (inputResto) { inputResto.style.display = ''; inputResto.required = true; }
      if (restoHelp) restoHelp.style.display = 'block';
    } else {
      if (origemLabel) origemLabel.innerHTML = 'Origem <span style="color:#f87171;">*</span>';
      if (selectOrigem) { selectOrigem.style.display = ''; selectOrigem.required = true; }
      if (inputResto) { inputResto.style.display = 'none'; inputResto.required = false; inputResto.value=''; }
      if (restoHelp) restoHelp.style.display = 'none';
    }
    updateCodigoPreview();
  });

  // Submissão do formulário
  // Atualiza preview do código ao trocar Origem
  if (selectOrigem) selectOrigem.addEventListener('change', updateCodigoPreview);
  if (inputResto) inputResto.addEventListener('input', () => {
    // Mantém apenas letras e números e atualiza preview
    inputResto.value = inputResto.value
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0,10);
    updateCodigoPreview();
  });

  // Validação do campo Descrição Principal (apenas uma palavra)
  const inputDescricao = document.getElementById('novoProd_descricaoPrincipal');
  if (inputDescricao) {
    inputDescricao.addEventListener('input', (e) => {
      // Remove espaços e mantém apenas a primeira palavra
      let value = e.target.value.trim();
      if (value.includes(' ')) {
        // Pega apenas a primeira palavra
        value = value.split(/\s+/)[0];
        e.target.value = value;
        
        // Mostra aviso visual temporário
        e.target.style.borderColor = '#f87171';
        setTimeout(() => {
          e.target.style.borderColor = '';
        }, 1000);
      }
    });
  }

  formNovoProduto.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!familiaAtual.codigo || !familiaAtual.tipo) {
      alert('Selecione uma família antes de salvar!');
      return;
    }
    
    const formData = new FormData(formNovoProduto);
    const payload = {};
    
    for (let [key, value] of formData.entries()) {
      payload[key] = value;
    }
    
    // Valida descrição principal (apenas uma palavra)
    if (payload.descricao_principal) {
      const palavras = payload.descricao_principal.trim().split(/\s+/);
      if (palavras.length > 1) {
        alert('A descrição principal deve conter apenas UMA palavra!');
        return;
      }
    }
    
    // Valida unidade
    if (!payload.unidade) {
      alert('Selecione uma unidade!');
      return;
    }
    
  // Monta código base (dois fluxos)
  const prefixoEhLetra = familiaPrefixoAlfabetico();
  let codigoCompleto = '';
  // Variáveis usadas apenas no fluxo sequencial antigo (numérico)
  let cod = '';
  let tipo = '';
  let origemChar = '';
    
    const statusDiv = document.getElementById('statusCriacaoProduto');
    const statusSpinner = document.getElementById('statusSpinner');
    const statusTexto = document.getElementById('statusTexto');
    const statusDetalhes = document.getElementById('statusDetalhes');
    // Exibe imediatamente o bloco de status para feedback rápido
    if (statusDiv) {
      statusDiv.style.display = 'block';
      statusDiv.style.backgroundColor = '#fef9c3';
      statusDiv.style.border = '1px solid #fde047';
    }
    if (statusSpinner) statusSpinner.style.display = 'block';
    if (statusTexto) {
      statusTexto.textContent = 'Criando produto na Omie...';
      statusTexto.style.color = '#92400e';
    }
    if (statusDetalhes) {
      statusDetalhes.textContent = 'Enviando dados iniciais';
    }
    
    try {
  let sequencial = '';
  let totalRegistros = null; // usado apenas no fluxo sequencial numérico
      if (prefixoEhLetra) {
        // Validação do restante alfanumérico (2-5)
        const resto = (inputResto?.value || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '')
          .slice(0,10);
        if (!resto || resto.length < 2) {
          alert('Informe ao menos 2 caracteres (letras ou números) para o restante do código.');
          return;
        }
        const prefixo = String(familiaAtual.codigo).toUpperCase();
        codigoCompleto = `${prefixo}${resto}`;
      } else {
        // Fluxo antigo: calcula sequencial e monta com pontos
        cod = String(familiaAtual.codigo).padStart(2, '0');
        tipo = String(familiaAtual.tipo || '').toUpperCase();
        origemChar = '-';
        if (payload.origem === '0') origemChar = 'N';
        else if (payload.origem === '1') origemChar = 'I';

        // Busca total de registros via backend (evita CORS)
        const omieResp = await fetch(`${API_BASE}/api/produtos/total-omie`, {
          method: 'GET',
          credentials: 'include'
        });
        if (!omieResp.ok) {
          throw new Error(`Erro ao buscar total de produtos: ${omieResp.status}`);
        }
        const omieData = await omieResp.json();
        totalRegistros = omieData.total_de_registros || 0;
        sequencial = String(totalRegistros + 1).padStart(5, '0');
        codigoCompleto = `${cod}.${tipo}.${origemChar}.${sequencial}`;
      }
      
      // Debug após definição de todas variáveis
      console.log('=== DEBUG CÓDIGO ===');
      console.log('familiaAtual:', familiaAtual);
      console.log('prefixoEhLetra:', prefixoEhLetra);
      if (!prefixoEhLetra) {
        console.log('cod:', cod);
        console.log('tipo:', tipo);
        console.log('origem:', payload.origem);
        console.log('origemChar:', origemChar);
      }
      console.log('codigoCompleto:', codigoCompleto);

      // Monta descrição única para Omie: "Em criação - PALAVRA - 02622"
  const descricaoPalavra = payload.descricao_principal.trim().toUpperCase();
  const descricaoOmie = `Em criação - ${descricaoPalavra}` + (codigoCompleto ? ` - ${codigoCompleto.slice(-5)}` : '');
      
      if (!prefixoEhLetra) {
        console.log('=== DEBUG SEQUENCIAL ===');
        console.log('totalRegistros:', totalRegistros);
        console.log('sequencial:', sequencial);
        console.log('codigoCompleto:', codigoCompleto);
        console.log('descricaoOmie:', descricaoOmie);
      } else {
        console.log('=== DEBUG ALFANUM ===');
        console.log('codigoCompleto:', codigoCompleto);
        console.log('descricaoOmie:', descricaoOmie);
      }
      
      // Envia produto para a Omie
      const incluirResp = await fetch(`${API_BASE}/api/produtos/incluir-omie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          codigo_produto_integracao: codigoCompleto,
          codigo: codigoCompleto,
          descricao: descricaoOmie,
          unidade: payload.unidade
        })
      });
      
      console.log('=== DEBUG PAYLOAD OMIE ===');
      console.log('Enviando para Omie:', {
        codigo_produto_integracao: codigoCompleto,
        codigo: codigoCompleto,
        descricao: descricaoOmie,
        unidade: payload.unidade
      });
      
      if (!incluirResp.ok) {
        const errorData = await incluirResp.json();
        throw new Error(errorData.error || 'Erro ao incluir produto na Omie');
      }
      
      const incluirData = await incluirResp.json();
      
      console.log('Produto criado na Omie:', incluirData);
      
      // Obtém o codigo_produto retornado pela Omie
      const codigoProdutoOmie = incluirData.codigo_produto;
      
      if (!codigoProdutoOmie) {
        throw new Error('Omie não retornou o codigo_produto');
      }
      
      // Desabilita botões durante o processo
      const btnCancelar = document.getElementById('btnCancelarModal');
      const btnCriar = document.getElementById('btnCriarProduto');
      if (btnCancelar) btnCancelar.disabled = true;
      if (btnCriar) btnCriar.disabled = true;
      
      // Exibe status com spinner (MANTÉM VISÍVEL durante todo o processo)
      const statusSpinner = document.getElementById('statusSpinner');
      const statusTexto = document.getElementById('statusTexto');
      const statusDetalhes = document.getElementById('statusDetalhes');
      
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.backgroundColor = '#dbeafe';
        statusDiv.style.border = '1px solid #93c5fd';
      }
      if (statusSpinner) statusSpinner.style.display = 'block'; // SPINNER ATIVO
      if (statusTexto) {
        statusTexto.textContent = incluirData.descricao_status || 'Produto cadastrado com sucesso!';
        statusTexto.style.color = '#1e40af';
      }
      if (statusDetalhes) {
        statusDetalhes.textContent = 'Aguardando sincronização com Omie... (30s)';
      }
      
      // Aguarda 30 segundos antes da primeira tentativa
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Tenta consultar o produto até 10 vezes com intervalo de 10s
      let tentativa = 1;
      let produtoEncontrado = null;
      const maxTentativas = 10;
      
      while (tentativa <= maxTentativas && !produtoEncontrado) {
        if (statusDetalhes) {
          statusDetalhes.textContent = `🔄 Consultando produto na Omie... (tentativa ${tentativa}/${maxTentativas})`;
        }
        
        try {
          const consultaResp = await fetch(`${API_BASE}/api/produtos/consultar-omie/${codigoProdutoOmie}`, {
            method: 'GET',
            credentials: 'include'
          });
          
          if (consultaResp.ok) {
            const consultaData = await consultaResp.json();
            
            if (consultaData.encontrado) {
              produtoEncontrado = consultaData;
              console.log('Produto encontrado na Omie:', consultaData);
              break;
            }
          }
        } catch (err) {
          console.error(`Tentativa ${tentativa} falhou:`, err);
        }
        
        // Aguarda 10 segundos antes da próxima tentativa
        if (tentativa < maxTentativas) {
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
        
        tentativa++;
      }
      
      // Remove spinner SOMENTE após terminar todas as tentativas
      if (statusSpinner) statusSpinner.style.display = 'none';
      
      // Reabilita botões
      if (btnCancelar) btnCancelar.disabled = false;
      if (btnCriar) btnCriar.disabled = false;
      
      if (produtoEncontrado) {
        // Produto encontrado com sucesso
        if (statusDiv) {
          statusDiv.style.backgroundColor = '#d1fae5';
          statusDiv.style.border = '1px solid #6ee7b7';
        }
        if (statusTexto) {
          statusTexto.textContent = '✓ Produto sincronizado com sucesso!';
          statusTexto.style.color = '#065f46';
        }
        if (statusDetalhes) {
          statusDetalhes.textContent = `Abrindo produto ${codigoCompleto}...`;
        }
        
        // Aguarda 2 segundos para usuário ver a mensagem
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Fecha o modal
        closeModal();
        
        // Aguarda modal fechar completamente
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // === USAR O MESMO FLUXO DO BOTÃO "ABRIR" ===
        console.log('[DEBUG] Abrindo produto:', codigoCompleto);
        
        try {
          // 1) Mostra o bloco de produto e esconde outras páginas
          const prodTabs   = document.getElementById('produtoTabs');
          const inicioPane = document.getElementById('paginaInicio');
          if (inicioPane)  inicioPane.style.display = 'none';
          if (prodTabs)    prodTabs.style.display   = 'block';

          // 2) Ativa a aba principal "Dados do produto"
          document.querySelectorAll('#produtoTabs .main-header .nav-card')
            .forEach(a => a.classList.remove('active'));
          const linkDados = document.querySelector('#produtoTabs .main-header .nav-card[data-target="dadosProduto"]');
          if (linkDados) linkDados.classList.add('active');

          // Mostra apenas o painel de dados
          document.querySelectorAll('#produtoTabs .tab-content .tab-pane').forEach(p => p.style.display = 'none');
          const paneDados = document.getElementById('dadosProduto');
          if (paneDados) paneDados.style.display = 'block';

          // 3) Guarda global
          window.codigoSelecionado = codigoCompleto;

          // 4) Carrega os dados do produto (FAZ TODAS AS REQUISIÇÕES)
          if (typeof window.loadDadosProduto === 'function') {
            console.log('[DEBUG] Carregando dados do produto...');
            await window.loadDadosProduto(codigoCompleto);
            console.log('[DEBUG] Dados do produto carregados com sucesso');
          } else {
            console.error('[DEBUG] window.loadDadosProduto não está disponível');
          }
          
          // Alert de sucesso após carregar
          setTimeout(() => {
            alert(`✓ Produto criado e sincronizado com sucesso!\n\nCódigo: ${codigoCompleto}\nDescrição: ${descricaoPalavra}\nUnidade: ${payload.unidade}\nFamília: ${familiaAtual.nome}\nOrigem: ${payload.origem === '0' ? 'Nacional' : 'Importado'}`);
          }, 500);
          
        } catch (err) {
          console.error('[DEBUG] Erro ao abrir produto:', err);
          const paneDadosOk = document.getElementById('dadosProduto');
          const exibido = paneDadosOk && paneDadosOk.style.display !== 'none';
          if (exibido) {
            console.warn('[DEBUG] Pane de dados já exibida; suprimindo alerta de erro.');
          } else {
            alert('Produto criado com sucesso, mas houve um erro ao abrir os detalhes.\n\nCódigo: ' + codigoCompleto);
          }
        }
        
      } else {
        // Não conseguiu encontrar após 10 tentativas
        if (statusDiv) {
          statusDiv.style.backgroundColor = '#fef3c7';
          statusDiv.style.border = '1px solid #fcd34d';
        }
        if (statusTexto) {
          statusTexto.textContent = '⚠ Produto criado, mas sincronização pendente';
          statusTexto.style.color = '#92400e';
        }
        if (statusDetalhes) {
          statusDetalhes.innerHTML = `Código: ${codigoCompleto}<br>Por favor, verifique manualmente na guia <strong>Lista de produtos</strong>`;
        }
        
        // Aguarda 5 segundos e fecha o modal
        setTimeout(() => {
          closeModal();
          alert(`Produto criado, mas a sincronização está demorando.\n\nCódigo: ${codigoCompleto}\n\nPor favor, verifique manualmente na guia "Lista de produtos" em alguns minutos.`);
        }, 5000);
      }
      
    } catch (err) {
      console.error('Erro ao criar produto:', err);
      
      // Remove spinner
      const statusSpinner = document.getElementById('statusSpinner');
      if (statusSpinner) statusSpinner.style.display = 'none';
      
      // Reabilita botões
      const btnCancelar = document.getElementById('btnCancelarModal');
      const btnCriar = document.getElementById('btnCriarProduto');
      if (btnCancelar) btnCancelar.disabled = false;
      if (btnCriar) btnCriar.disabled = false;
      
      // Exibe erro no status
      const statusTexto = document.getElementById('statusTexto');
      const statusDetalhes = document.getElementById('statusDetalhes');
      
      if (statusDiv) {
        statusDiv.style.display = 'block';
        statusDiv.style.backgroundColor = '#fee2e2';
        statusDiv.style.border = '1px solid #fca5a5';
      }
      if (statusTexto) {
        statusTexto.textContent = '✗ Erro ao criar produto';
        statusTexto.style.color = '#991b1b';
      }
      if (statusDetalhes) {
        statusDetalhes.textContent = err.message;
      }
      
      alert('Erro ao criar produto: ' + err.message);
    }
  });
})();


  document.getElementById('menu-produto')
  .addEventListener('click', e => {
    e.preventDefault();
    openDadosProdutoTab();
  });

  // ——— Configura evento para todas as abas do header ———
const headerLinks   = document.querySelectorAll('.header .header-menu > .menu-link');
const leftSide      = document.querySelector('.left-side');
const mainContainer = document.querySelector('.main-container');
const panes         = mainContainer.querySelectorAll('.tab-pane');

headerLinks.forEach(link => {
  link.addEventListener('click', async e => {
    e.preventDefault();
    // Se estávamos no chat, restaura os panes guardados antes de navegar
    try { window.restoreStashedPanes?.(); } catch {}
    // 1) limpa destaque e esconde todos os panes
    headerLinks.forEach(a => a.classList.remove('is-active'));
    panes.forEach(p => p.style.display = 'none');

    /* toda vez que sair de Pedidos, esconde o painel Kanban */
    if (link.id !== 'menu-pedidos') hideKanban();
    if (link.id !== 'menu-armazens') hideArmazem();

    // 2) destaca o clicado
    link.classList.add('is-active');

    if (link.id === 'menu-produto') {
      openDadosProdutoTab();
    
    } else if (link.id === 'menu-registros') {
      if (window.openRegistros) window.openRegistros();
      
    } else if (link.id === 'menu-inicio') {

  /* 1) fecha Kanban e Armazéns, se abertos */
  hideKanban();
  hideArmazem();

  /* 2) esconde todas as outras seções */
  document.querySelectorAll('.tab-pane, .kanban-page')
          .forEach(p => p.style.display = 'none');
  document.getElementById('produtoTabs').style.display  = 'none';
  document.getElementById('kanbanTabs').style.display   = 'none';
  document.getElementById('armazemTabs').style.display  = 'none';
const mh = document.querySelector('.main-header');
if (mh) mh.style.display = 'none';


  /* 3) mostra a Home com os 6 botões */
  showMainTab('paginaInicio');

  /* 4) mantém o link Início destacado */
  headerLinks.forEach(a => a.classList.remove('is-active'));
  link.classList.add('is-active');

  /* 5) garante que a sidebar esteja visível */
  document.querySelector('.left-side')?.classList.remove('is-hidden');
}





    
  });
});

/* dentro do MESMO callback que já existe */
const bell       = document.getElementById('bell-icon');
const printBtn   = document.getElementById('print-icon');
const cloudBtn   = document.getElementById('cloud-icon');
const avatar     = document.getElementById('profile-icon');
const etiquetasModal = document.getElementById('etiquetasModal');
const listaEtiq       = document.getElementById('listaEtiquetas');

  /* –– SINO –– */
  bell?.addEventListener('click', e => {
    e.preventDefault();
    // Abre diretamente o Chat
    if (window.openChat) return window.openChat();
    // fallback (se ainda não carregou lógica do chat)
    document.getElementById('chatPane').style.display = 'block';
  });
// ——— Função para abrir painel de registros de modificações de produto ———
window.openRegistros = async function() {
  try {
    // Limpa tudo
    window.clearMainContainer?.();

    const prodTabs = document.getElementById('produtoTabs');
    if (!prodTabs) {
      console.warn('[REGISTROS] wrapper #produtoTabs inexistente');
      return;
    }

    // Mostra somente o wrapper principal de produto
    window.showOnlyInMain?.(prodTabs);

    // Esconde todas as tab-panes internas
    document.querySelectorAll('#produtoTabs .tab-content .tab-pane').forEach(p => p.style.display = 'none');

    // Mostra painel de registros
    const notif = document.getElementById('notificacoes');
    if (notif) notif.style.display = 'block';

    // Ajusta header principal visível
    const mainHeader = document.querySelector('#produtoTabs .main-header');
    if (mainHeader) mainHeader.style.display = 'flex';

    // Monta barra de filtros (uma vez)
    const container = document.getElementById('notificacoes');
  let filtros = document.getElementById('filtros-registros');
  if (!filtros) {
    filtros = document.createElement('div');
    filtros.id = 'filtros-registros';
    filtros.style.cssText = 'background:#f8f9fa; padding:16px; border-radius:8px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.1);';
    filtros.innerHTML = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:end;">
        <label style="display:flex; flex-direction:column; min-width:180px;">
          <span style="font-weight:600; margin-bottom:4px; color:#495057;">Tipo de Ação</span>
          <select id="reg-tipo" style="padding:8px; border:1px solid #ced4da; border-radius:4px; font-size:14px;">
            <option value="">(todos)</option>
            <option>ABERTURA_OP</option>
            <option>MUDANCA_ESTRUTURA</option>
            <option>MENCAO</option>
            <option>OP_DATA_IMPRESSAO</option>
            <option>ALTERACAO_LOCAL_PRODUCAO</option>
            <option>ALTERACAO_CADASTRO</option>
            <option>ALTERACAO_CARACTERISTICA</option>
            <option>PRODUTO_FOTO_ADD</option>
            <option>PRODUTO_FOTO_REMOVE</option>
            <option>PRODUTO_ANEXO_ADD</option>
            <option>PRODUTO_ANEXO_REMOVE</option>
          </select>
        </label>
        <label style="display:flex; flex-direction:column; min-width:150px;">
          <span style="font-weight:600; margin-bottom:4px; color:#495057;">Código</span>
          <input id="reg-codigo" placeholder="Código do produto" style="padding:8px; border:1px solid #ced4da; border-radius:4px; font-size:14px;" />
        </label>
        <label style="display:flex; flex-direction:column; min-width:140px;">
          <span style="font-weight:600; margin-bottom:4px; color:#495057;">Usuário</span>
          <input id="reg-usuario" placeholder="Nome ou login" style="padding:8px; border:1px solid #ced4da; border-radius:4px; font-size:14px;" />
        </label>
        <label style="display:flex; flex-direction:column;">
          <span style="font-weight:600; margin-bottom:4px; color:#495057;">De</span>
          <input id="reg-de" type="datetime-local" style="padding:8px; border:1px solid #ced4da; border-radius:4px; font-size:14px;" />
        </label>
        <label style="display:flex; flex-direction:column;">
          <span style="font-weight:600; margin-bottom:4px; color:#495057;">Até</span>
          <input id="reg-ate" type="datetime-local" style="padding:8px; border:1px solid #ced4da; border-radius:4px; font-size:14px;" />
        </label>
        <button id="reg-buscar" style="padding:8px 20px; background:#007bff; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer; transition:background 0.2s;">Buscar</button>
        <button id="reg-limpar" style="padding:8px 20px; background:#6c757d; color:white; border:none; border-radius:4px; font-weight:600; cursor:pointer; transition:background 0.2s;">Limpar</button>
      </div>
    `;
    container.prepend(filtros);
    
    // Hover effects
    const btnBuscar = filtros.querySelector('#reg-buscar');
    const btnLimpar = filtros.querySelector('#reg-limpar');
    btnBuscar.addEventListener('mouseenter', () => btnBuscar.style.background = '#0056b3');
    btnBuscar.addEventListener('mouseleave', () => btnBuscar.style.background = '#007bff');
    btnLimpar.addEventListener('mouseenter', () => btnLimpar.style.background = '#5a6268');
    btnLimpar.addEventListener('mouseleave', () => btnLimpar.style.background = '#6c757d');
  }

  // Mapa de ícones e cores por tipo de ação
  const acaoConfig = {
    'ABERTURA_OP': { icon: '📋', color: '#28a745', bg: '#d4edda', label: 'Abertura de OP' },
    'MUDANCA_ESTRUTURA': { icon: '🔧', color: '#17a2b8', bg: '#d1ecf1', label: 'Mudança de Estrutura' },
    'MENCAO': { icon: '🔗', color: '#6c757d', bg: '#e2e3e5', label: 'Menção' },
    'OP_DATA_IMPRESSAO': { icon: '🖨️', color: '#ffc107', bg: '#fff3cd', label: 'Data de Impressão' },
    'ALTERACAO_LOCAL_PRODUCAO': { icon: '📍', color: '#fd7e14', bg: '#ffe5d0', label: 'Local de Produção' },
    'ALTERACAO_CADASTRO': { icon: '✏️', color: '#007bff', bg: '#d1ecf1', label: 'Alteração de Cadastro' },
    'ALTERACAO_CARACTERISTICA': { icon: '⚙️', color: '#6f42c1', bg: '#e2d9f3', label: 'Alteração de Característica' },
    'PRODUTO_FOTO_ADD': { icon: '📷', color: '#20c997', bg: '#d4f4dd', label: 'Foto Adicionada' },
    'PRODUTO_FOTO_REMOVE': { icon: '🗑️', color: '#dc3545', bg: '#f8d7da', label: 'Foto Removida' },
    'PRODUTO_ANEXO_ADD': { icon: '📎', color: '#20c997', bg: '#d4f4dd', label: 'Anexo Adicionado' },
    'PRODUTO_ANEXO_REMOVE': { icon: '🗑️', color: '#dc3545', bg: '#f8d7da', label: 'Anexo Removido' }
  };

  async function buscar() {
    const timeline = document.getElementById('listaRegistros');
    timeline.innerHTML = '<div style="text-align:center; padding:40px; color:#6c757d;"><div style="font-size:24px;">⏳</div><div style="margin-top:12px;">Carregando histórico...</div></div>';
    
    const params = new URLSearchParams();
    const tipo = document.getElementById('reg-tipo').value.trim();
    const codigo = document.getElementById('reg-codigo').value.trim();
    const usuario = document.getElementById('reg-usuario').value.trim();
    const de = document.getElementById('reg-de').value.trim();
    const ate = document.getElementById('reg-ate').value.trim();
    
    if (tipo) params.set('tipo', tipo);
    if (codigo) params.set('codigo', codigo);
    if (usuario) params.set('usuario', usuario);
    if (de) params.set('data_inicio', de);
    if (ate) params.set('data_fim', ate);
    
    const url = '/api/registros' + (params.toString() ? ('?' + params.toString()) : '');
    
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const lista = await resp.json();
      
      if (!Array.isArray(lista) || lista.length === 0) {
        timeline.innerHTML = `
          <div style="text-align:center; padding:60px; color:#6c757d;">
            <div style="font-size:48px; margin-bottom:16px;">📭</div>
            <div style="font-size:18px; font-weight:600; margin-bottom:8px;">Nenhum registro encontrado</div>
            <div style="font-size:14px;">Tente ajustar os filtros ou selecionar um período diferente</div>
          </div>
        `;
        return;
      }
      
      // Renderiza timeline
      timeline.innerHTML = `
        <div style="position:relative; padding:20px 0;">
          <div style="position:absolute; left:50%; top:0; bottom:0; width:2px; background:linear-gradient(180deg, #007bff 0%, #6c757d 100%); transform:translateX(-50%); z-index:0;"></div>
          ${lista.map((r, idx) => {
            const config = acaoConfig[r.tipo_acao] || { icon: '📌', color: '#6c757d', bg: '#e2e3e5', label: r.tipo_acao };
            const isLeft = idx % 2 === 0;
            const dataFormatada = new Date(r.data_hora).toLocaleString('pt-BR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            
            // Monta códigos (texto + id OMIE se disponível)
            let codigoDisplay = r.codigo_texto || r.codigo_omie || '';
            if (r.codigo_produto && r.codigo_produto != codigoDisplay) {
              codigoDisplay += ` <span style="color:#6c757d; font-size:0.85em;">(ID: ${r.codigo_produto})</span>`;
            }
            
            return `
              <div style="position:relative; margin-bottom:50px; display:flex; align-items:center; ${isLeft ? 'justify-content:flex-end;' : 'justify-content:flex-start;'}">
                <!-- Círculo do ícone -->
                <div style="position:absolute; left:50%; transform:translateX(-50%); z-index:2; width:56px; height:56px; border-radius:50%; background:${config.bg}; border:3px solid ${config.color}; display:flex; align-items:center; justify-content:center; font-size:24px; box-shadow:0 4px 8px rgba(0,0,0,0.15);">
                  ${config.icon}
                </div>
                
                <!-- Card do registro -->
                <div style="width:45%; ${isLeft ? 'margin-right:60px; text-align:right;' : 'margin-left:60px; text-align:left;'}">
                  <div style="background:white; border-radius:12px; padding:20px; box-shadow:0 4px 12px rgba(0,0,0,0.1); border-left:4px solid ${config.color}; transition:transform 0.2s, box-shadow 0.2s;" onmouseenter="this.style.transform='translateY(-4px)'; this.style.boxShadow='0 8px 20px rgba(0,0,0,0.15)';" onmouseleave="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; ${isLeft ? 'justify-content:flex-end;' : ''}">
                      <span style="display:inline-block; padding:4px 12px; background:${config.bg}; color:${config.color}; border-radius:20px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">${config.label}</span>
                    </div>
                    
                    <div style="font-size:16px; font-weight:700; color:#212529; margin-bottom:8px;">${codigoDisplay}</div>
                    
                    <div style="display:flex; gap:16px; margin-bottom:12px; font-size:13px; color:#6c757d; flex-wrap:wrap; ${isLeft ? 'justify-content:flex-end;' : ''}">
                      <span style="display:flex; align-items:center; gap:4px;">
                        <span style="font-size:14px;">👤</span>
                        <strong>${r.usuario}</strong>
                      </span>
                      <span style="display:flex; align-items:center; gap:4px;">
                        <span style="font-size:14px;">🕐</span>
                        ${dataFormatada}
                      </span>
                      ${r.origem ? `<span style="display:flex; align-items:center; gap:4px;"><span style="font-size:14px;">🔖</span>${r.origem}</span>` : ''}
                    </div>
                    
                    ${r.detalhes ? `
                      <div style="margin-top:12px; padding:12px; background:#f8f9fa; border-radius:6px; font-size:13px; color:#495057; line-height:1.6; white-space:pre-wrap; ${isLeft ? 'text-align:left;' : ''}">${r.detalhes}</div>
                    ` : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } catch (err) {
      timeline.innerHTML = `
        <div style="text-align:center; padding:60px; color:#dc3545;">
          <div style="font-size:48px; margin-bottom:16px;">⚠️</div>
          <div style="font-size:18px; font-weight:600; margin-bottom:8px;">Falha ao carregar registros</div>
          <div style="font-size:14px;">${err.message}</div>
        </div>
      `;
    }
  }

    document.getElementById('reg-buscar').onclick = buscar;
    document.getElementById('reg-limpar').onclick = () => {
      document.getElementById('reg-tipo').value = '';
      document.getElementById('reg-codigo').value = '';
      document.getElementById('reg-usuario').value = '';
      document.getElementById('reg-de').value = '';
      document.getElementById('reg-ate').value = '';
      buscar();
    };

    // Busca inicial
    await buscar();

    // Atualiza hash
    try { if (location.hash !== '#registros') location.hash = '#registros'; } catch {}
    console.log('[REGISTROS] painel aberto');
  } catch (e) {
    console.error('[REGISTROS] erro ao abrir painel:', e);
  }
};

  /* –– IMPRESSORA –– */
printBtn?.addEventListener('click', async e => {
  e.preventDefault(); e.stopPropagation();

  listaEtiq.innerHTML = '<li>carregando…</li>';
  try {
    const resp = await fetch('/api/etiquetas');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const files = await resp.json();  // ex.: ["etiqueta_F06250019.zpl"]

    if (files.length === 0) {
      listaEtiq.innerHTML = '<li>Nenhuma etiqueta encontrada</li>';
    } else {
      listaEtiq.innerHTML = files.map(f => `
        <li>
          <span>${f}</span>
          <button class="btn-print" data-file="${f}">Imprimir</button>
        </li>`).join('');
    }
  } catch (err) {
    console.error(err);
    listaEtiq.innerHTML = '<li>Falha ao buscar etiquetas</li>';
  }

  etiquetasModal.classList.add('is-active');
});

document
  .querySelector('#etiquetasModal .close-modal')
  .addEventListener('click', () =>
    etiquetasModal.classList.remove('is-active')
  );

listaEtiq.addEventListener('click', e => {
  if (e.target.matches('.btn-print')) {
    const file = e.target.dataset.file;
    window.open(`/etiquetas/printed/${encodeURIComponent(file)}`, '_blank');
  }
});

  /* –– NUVEM –– */
  cloudBtn?.addEventListener('click', e => {
    e.preventDefault();
    alert('Clicou em nuvem');
  });
/* –– AVATAR –– */
/*  Só chama o modal se a função já estiver registrada
    (login.js a registra na janela).  Nada de redirecionar! */
avatar?.addEventListener('click', e => {
  e.preventDefault();
  if (window.openLoginModal) window.openLoginModal();
});


// ─── Sub-abas unificadas em Dados do produto ───
const subTabLinks = document.querySelectorAll(
  '#dadosProduto .sub-tabs .main-header-link'
);
subTabLinks.forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    // 1) destaco só este link
    subTabLinks.forEach(l => l.classList.remove('is-active'));
    link.classList.add('is-active');
    // 2) escondo todos os sub-conteúdos
    document
      .querySelectorAll('#dadosProduto .sub-content')
      .forEach(sec => (sec.style.display = 'none'));
    // 3) mostro só o target correto
    const alvoId = link.dataset.subtarget;            // ex: "detalhesTab"
    const alvoEl = document.getElementById(alvoId);
    if (!alvoEl) return console.error(`Sub-aba "${alvoId}" não existe`);
    alvoEl.style.display = 'block';
    console.log(`[Sub-aba] exibindo "${alvoId}"`);
  });
});

// forço, ao abrir Dados do produto, a sub-aba “Detalhes”
const detalhesInicial = document.querySelector(
  '#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]'
);
if (detalhesInicial) detalhesInicial.click();

// Ao carregar, parte da Home → oculta abas internas de Produto
const prodHeader = document.querySelector('#produtoTabs .main-header');
if (prodHeader) prodHeader.style.display = 'none';
document.getElementById('produtoTabs').style.display = 'none';



  // … quaisquer outras inicializações finais …
  initDadosColaboradoresUI();
  initAnexosUI();
});  // <--- aqui fecha o DOMContentLoaded


// 1) Alterna entre Produto ⇄ Pedidos
/* ======== Funções da Preparação (Kanban com filtro por operação) ======== */

// Carrega operações da tabela public.omie_operacao
async function carregarPreparacaoOperacoes() {
  const select = document.getElementById('preparacaoOperacaoSelect');
  if (!select) return;

  try {
    const resp = await fetch('/api/colaboradores/operacoes');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arr = await resp.json();
    
    preparacaoOperacoes = (Array.isArray(arr) ? arr : [])
      .map(x => ({ id: String(x.id || ''), operacao: String(x.operacao || '').trim() }))
      .filter(x => x.operacao);
    
    select.innerHTML = '<option value="">Selecione uma operação...</option>';
    preparacaoOperacoes.forEach(op => {
      const opt = document.createElement('option');
      opt.value = op.operacao;
      opt.textContent = op.operacao;
      select.appendChild(opt);
    });
    
    // Seleciona a primeira operação por padrão
    if (preparacaoOperacoes.length > 0) {
      select.value = preparacaoOperacoes[0].operacao;
      preparacaoOperacaoAtual = preparacaoOperacoes[0].operacao;
      await carregarPreparacaoDados();
    }
  } catch (err) {
    console.error('[Preparação] Erro ao carregar operações:', err);
    select.innerHTML = '<option value="">Erro ao carregar operações</option>';
  }
}

// Carrega todos os dados de OPs da tabela "OrdemProducao".tab_op
async function carregarPreparacaoDados() {
  try {
    const resp = await fetch('/api/ops/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    
    preparacaoDados = Array.isArray(data.ops) ? data.ops : [];
    // Logs de diagnóstico: quantos códigos e por operação
    try {
      const codigos = new Set(preparacaoDados.map(o => o.codigo_produto));
      const porOperacao = preparacaoDados.reduce((acc, o) => {
        const k = String(o.local_impressao || '').trim();
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      console.log('[Preparação] OPs carregadas:', preparacaoDados.length, 'Códigos distintos:', codigos.size, 'Por operação:', porOperacao);
    } catch {}
    filtrarPreparacaoPorOperacao();
  } catch (err) {
    console.error('[Preparação] Erro ao carregar dados:', err);
    preparacaoDados = [];
    filtrarPreparacaoPorOperacao();
  }
}

// Filtra dados pela operação selecionada (local_impressao)
function filtrarPreparacaoPorOperacao() {
  // Normaliza strings para comparação segura (case-insensitive e sem acentos)
  const norm = (s) => String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toUpperCase();

  const operacaoAlvo = norm(preparacaoOperacaoAtual);

  if (!operacaoAlvo) {
    preparacaoDadosFiltrados = [];
  } else {
    preparacaoDadosFiltrados = preparacaoDados.filter(op => norm(op.local_impressao) === operacaoAlvo);
  }
  
  console.log('[Preparação] Operação atual:', preparacaoOperacaoAtual, '→', operacaoAlvo);
  console.log('[Preparação] Total de OPs no sistema:', preparacaoDados.length);
  console.log('[Preparação] OPs filtradas:', preparacaoDadosFiltrados.length);
  console.log('[Preparação] Amostra filtrada:', preparacaoDadosFiltrados.slice(0, 5));
  
  renderPreparacaoKanbans();
  
  // Atualiza contador
  const countEl = document.getElementById('preparacaoCount');
  if (countEl) {
    countEl.textContent = `${preparacaoDadosFiltrados.length} ${preparacaoDadosFiltrados.length === 1 ? 'item' : 'itens'}`;
  }
}

// Renderiza os kanbans (Aguardando prazo e Fila de produção)
function renderPreparacaoKanbans() {
  const aguardandoList = document.getElementById('coluna-prep-aguardando');
  const filaList = document.getElementById('coluna-prep-fila');
  
  if (!aguardandoList || !filaList) return;
  
  aguardandoList.innerHTML = '';
  filaList.innerHTML = '';
  
  console.log('[Preparação] Dados filtrados para renderizar:', preparacaoDadosFiltrados);
  
  // Agrupa OPs por codigo_produto
  const aguardandoGrupos = agruparPorCodigoProduto(
    preparacaoDadosFiltrados.filter(op => op.status === 'aguardando')
  );
  
  const filaGrupos = agruparPorCodigoProduto(
    preparacaoDadosFiltrados.filter(op => op.status === 'fila' || op.status === 'em_producao')
  );
  
  console.log('[Preparação] Grupos aguardando:', aguardandoGrupos);
  console.log('[Preparação] Grupos fila:', filaGrupos);
  
  // Renderiza cards agrupados - Aguardando prazo
  aguardandoGrupos.forEach(grupo => {
    const card = criarCardPreparacaoAgrupado(grupo, 'aguardando');
    aguardandoList.appendChild(card);
  });
  
  // Renderiza cards agrupados - Fila de produção
  filaGrupos.forEach(grupo => {
    const card = criarCardPreparacaoAgrupado(grupo, 'fila');
    filaList.appendChild(card);
  });
  
  // Se nenhum item, mostra mensagem
  if (aguardandoList.children.length === 0) {
    aguardandoList.innerHTML = '<li style="padding:12px; opacity:0.5; text-align:center;">Nenhum item aguardando</li>';
  }
  if (filaList.children.length === 0) {
    filaList.innerHTML = '<li style="padding:12px; opacity:0.5; text-align:center;">Fila vazia</li>';
  }
  
  // Ativa os event listeners dos botões específicos para Preparação
  attachPreparacaoModalTriggers();
}

// Agrupa OPs por codigo_produto
function agruparPorCodigoProduto(ops) {
  console.log('[agruparPorCodigoProduto] Recebeu OPs:', ops);
  console.log('[agruparPorCodigoProduto] Total de OPs:', ops.length);
  
  const grupos = {};
  
  ops.forEach(op => {
    const codigo = op.codigo_produto || 'SEM_CODIGO';
    
    console.log(`[agruparPorCodigoProduto] Processando OP - codigo: ${codigo}, numero_op: ${op.numero_op}, id: ${op.id}`);
    
    if (!grupos[codigo]) {
      grupos[codigo] = {
        codigo: codigo,
        ops: [],
        quantidade: 0,
        local_impressao: op.local_impressao
      };
      console.log(`[agruparPorCodigoProduto] Criou novo grupo para: ${codigo}`);
    }
    
    grupos[codigo].ops.push(op);
    grupos[codigo].quantidade += 1;
    
    console.log(`[agruparPorCodigoProduto] Grupo ${codigo} agora tem ${grupos[codigo].ops.length} OPs`);
  });
  
  const resultado = Object.values(grupos);
  console.log('[agruparPorCodigoProduto] Grupos finais:', resultado);
  
  return resultado;
}

// Cria o card HTML agrupado por código_produto
function criarCardPreparacaoAgrupado(grupo, coluna) {
  const li = document.createElement('li');
  li.className = 'kanban-card kanban-card-local kanban-card-collapsed';
  li.dataset.codigo = grupo.codigo;
  li.dataset.localImpressao = grupo.local_impressao;
  
  const codigo = grupo.codigo || 'Sem código';
  const quantidade = grupo.quantidade || 0;
  const local = grupo.local_impressao || '—';
  
  // Monta lista de OPs
  const opsHtml = grupo.ops.map(op => {
    const dataFormatada = op.data_impressao 
      ? new Date(op.data_impressao).toLocaleString('pt-BR', { 
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '—';
    return `
      <div class="kanban-op-line">
        <span>${op.numero_op || '—'}</span>
        ${op.data_impressao ? `<span class="kanban-op-date">${dataFormatada}</span>` : ''}
      </div>
    `;
  }).join('');
  
  // Botões baseados na coluna
  let botoesHtml = '';
  if (coluna === 'aguardando') {
    botoesHtml = `
      <div class="kanban-card-actions" style="display:flex; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1);">
        <button class="btn-kanban kanban-modal-trigger" title="Configurar OP" data-codigo="${codigo}" data-grupo='${JSON.stringify(grupo)}' data-coluna="Aguardando prazo">
          <i class="far fa-calendar-alt"></i> Configurar OP
        </button>
      </div>
    `;
  } else if (coluna === 'fila') {
    botoesHtml = `
      <div class="kanban-card-actions" style="display:flex; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1);">
        <button class="btn-kanban kanban-modal-trigger" title="Configurar OP" data-codigo="${codigo}" data-grupo='${JSON.stringify(grupo)}' data-coluna="Fila de produção">
          <i class="fas fa-calendar-alt"></i> Configurar OP
        </button>
      </div>
    `;
  }
  
  li.innerHTML = `
    <div class="kanban-code-block">
      <div class="kanban-code-header" style="cursor:pointer;">
        <span>${codigo}</span>
        <span class="kanban-code-count">QTD ${quantidade}</span>
        <i class="fas fa-chevron-down kanban-toggle-icon"></i>
      </div>
      <div class="kanban-op-list" style="display:none;">${opsHtml}</div>
      <div class="kanban-card-actions-wrapper" style="display:none;">
        ${botoesHtml}
      </div>
    </div>
  `;
  
  // Adiciona evento de clique no header para expandir/recolher
  const header = li.querySelector('.kanban-code-header');
  header.addEventListener('click', (ev) => {
    // Não expande se clicar em um botão
    if (ev.target.closest('.btn-kanban')) return;
    
    const wasCollapsed = li.classList.contains('kanban-card-collapsed');
    
    // Recolhe todos os outros cards
    const allCards = li.closest('ul').querySelectorAll('.kanban-card');
    allCards.forEach(card => {
      card.classList.add('kanban-card-collapsed');
      const opList = card.querySelector('.kanban-op-list');
      const actions = card.querySelector('.kanban-card-actions-wrapper');
      const icon = card.querySelector('.kanban-toggle-icon');
      if (opList) opList.style.display = 'none';
      if (actions) actions.style.display = 'none';
      if (icon) icon.classList.remove('fa-chevron-up');
      if (icon) icon.classList.add('fa-chevron-down');
    });
    
    // Expande o card clicado se estava recolhido
    if (wasCollapsed) {
      li.classList.remove('kanban-card-collapsed');
      const opList = li.querySelector('.kanban-op-list');
      const actions = li.querySelector('.kanban-card-actions-wrapper');
      const icon = li.querySelector('.kanban-toggle-icon');
      if (opList) opList.style.display = 'block';
      if (actions) actions.style.display = 'block';
      if (icon) icon.classList.remove('fa-chevron-down');
      if (icon) icon.classList.add('fa-chevron-up');
    }
  });
  
  return li;
}

// Event listeners específicos para os botões da guia Preparação
function attachPreparacaoModalTriggers() {
  // Botão "Definir prazo" / "Redefinir prazo"
  document.querySelectorAll('#conteudo-preparacao .kanban-modal-trigger').forEach(btn => {
    if (btn.dataset.prepBound === '1') return;
    btn.dataset.prepBound = '1';
    
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      const codigo = btn.dataset.codigo || '';
      const coluna = btn.dataset.coluna || 'Aguardando prazo';
      
      // Pega o grupo do data-attribute
      let grupo;
      try {
        grupo = JSON.parse(btn.dataset.grupo || '{}');
      } catch (e) {
        console.error('[Preparação] Erro ao parsear grupo:', e);
        return;
      }
      
      if (!grupo || !grupo.ops || grupo.ops.length === 0) {
        console.warn('[Preparação] Grupo inválido ou sem OPs');
        return;
      }
      
      openPreparacaoOpsModal({ grupo, coluna });
    });
  });

// ——— Chat UI ———
;(function initChatUI(){
  const chatPane     = document.getElementById('chatPane');
  const chatUserList = document.getElementById('chatUserList');
  const chatSearch   = document.getElementById('chatSearch');
  const chatWith     = document.getElementById('chatWith');
  const chatMsgs     = document.getElementById('chatMessages');
  const chatText     = document.getElementById('chatText');
  const chatSend     = document.getElementById('chatSend');

  // Não retorna mais se chatPane não existe, assim a função global é definida

  const ChatState = {
    users: [],
    filtered: [],
    selectedId: null,
    polling: null
  };

  // Nota: clearMainContainer e showOnlyInMain agora são funções globais definidas no topo do arquivo

  function renderUsers(list){
    console.log('[CHAT] Renderizando usuários, quantidade:', list?.length || 0);
    if (!chatUserList) {
      console.error('[CHAT] Elemento chatUserList não encontrado');
      return;
    }
    chatUserList.innerHTML = '';
    if (!list || list.length === 0) {
      console.warn('[CHAT] Nenhum usuário para renderizar');
      return;
    }
    list.forEach(u => {
      const li = document.createElement('li');
      li.textContent = u.username;
      li.dataset.userId = u.id;
      li.className = 'chat-user-item' + (ChatState.selectedId===u.id ? ' is-active' : '');
      li.addEventListener('click', () => selectUser(u.id));
      chatUserList.appendChild(li);
      console.log('[CHAT] Usuário adicionado à lista:', u.username, 'ID:', u.id);
    });
  }

  async function loadUsers(){
    console.log('[CHAT] Carregando usuários...');
    try {
      const r = await fetch('/api/chat/users', { credentials:'include' });
      console.log('[CHAT] Response status:', r.status);
      if (!r.ok) {
        console.error('[CHAT] Erro ao carregar usuários, status:', r.status);
        return;
      }
      const data = await r.json();
      console.log('[CHAT] Usuários recebidos:', data);
      
      // Remove o próprio usuário se existir
      const currentUserId = window.__sessionUser?.id;
      console.log('[CHAT] ID do usuário logado:', currentUserId);
      
      ChatState.users = (data.users||[]).filter(u => !currentUserId || String(u.id) !== String(currentUserId));
      ChatState.filtered = ChatState.users;
      
      console.log('[CHAT] Total de usuários após filtro:', ChatState.users.length);
      
      renderUsers(ChatState.filtered);
    } catch (err) {
      console.error('[CHAT] Erro ao carregar usuários:', err);
    }
  }

  // Torna a função global SEMPRE
  window.__chatLoadUsers = loadUsers;

  function filterUsers(term){
    const t = term.trim().toLowerCase();
    ChatState.filtered = !t ? ChatState.users : ChatState.users.filter(u => (u.username||'').toLowerCase().includes(t));
    renderUsers(ChatState.filtered);
  }

  function renderMessages(msgs){
    const me = String(window.__sessionUser?.id || '');
    chatMsgs.innerHTML = '';
    msgs.forEach(m => {
      const wrap = document.createElement('div');
      const mine = (m.from === me);
      wrap.className = 'msg ' + (mine ? 'you' : 'other');
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = m.text;
      const t = document.createElement('div');
      t.className = 'time';
      const dt = new Date(m.timestamp);
      t.textContent = dt.toLocaleString();
      wrap.appendChild(b);
      wrap.appendChild(t);
      chatMsgs.appendChild(wrap);
    });
    chatMsgs.scrollTop = chatMsgs.scrollHeight;
  }

  async function loadConversation(userId){
    try {
      const r = await fetch(`/api/chat/conversation?userId=${encodeURIComponent(userId)}`, { credentials:'include' });
      if (!r.ok) return;
      const data = await r.json();
      renderMessages(data.messages || []);
    } catch {}
  }

  async function selectUser(userId){
    ChatState.selectedId = String(userId);
    const u = ChatState.users.find(x => x.id === ChatState.selectedId);
    chatWith.textContent = u ? (u.username || `ID ${u.id}`) : 'Selecionado';
    chatText.disabled = false;
    chatSend.disabled = false;
    // re-render lista p/ destacar
    renderUsers(ChatState.filtered);
    await loadConversation(ChatState.selectedId);
    // polling simples
    if (ChatState.polling) clearInterval(ChatState.polling);
    ChatState.polling = setInterval(() => loadConversation(ChatState.selectedId), 5000);
  }

  async function sendMessage(){
    const txt = (chatText.value || '').trim();
    if (!txt || !ChatState.selectedId) return;
    chatText.value = '';
    try {
      const r = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ to: ChatState.selectedId, text: txt })
      });
      if (!r.ok) return;
      // recarrega conversa
      await loadConversation(ChatState.selectedId);
    } catch {}
  }

  chatSend?.addEventListener('click', sendMessage);
  chatText?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  chatSearch?.addEventListener('input', (e) => filterUsers(e.target.value || ''));

  // Expõe funções para uso externo
  window.__chatLoadUsers = loadUsers;
  window.__chatSelectUser = selectUser;
  
  console.log('[CHAT] Módulo de chat inicializado');
})();

  // Botão "Consultar estoque"
  document.querySelectorAll('#conteudo-preparacao .kanban-stock-trigger').forEach(btn => {
    if (btn.dataset.prepStockBound === '1') return;
    btn.dataset.prepStockBound = '1';
    
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      const codigo = btn.dataset.codigo || '';
      if (!codigo) return;
      
      // Abre a guia Armazém/Estoque e filtra pelo código do produto
      showArmazemTab('estoque');
      
      setTimeout(() => {
        const filtroInput = document.querySelector('#conteudo-almoxarifado input[placeholder*="Pesquisar"]');
        if (filtroInput) {
          filtroInput.value = codigo;
          filtroInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 300);
    });
  });
}

// Abre modal de prazo para GRUPO de OPs da guia Preparação
function openPreparacaoOpsModal({ grupo, coluna }) {
  closePreparacaoOpsModal();
  
  const esc = (val) => String(val ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch] || ch));

  const overlay = document.createElement('div');
  overlay.className = 'kanban-modal-overlay';
  overlay.id = 'preparacao-modal-overlay';
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closePreparacaoOpsModal();
  });

  const modal = document.createElement('div');
  modal.className = 'kanban-modal';
  
  const tituloModal = 'Configurar ordem de produção';
  
  modal.innerHTML = `
    <header>
      <div>
        <h2>${tituloModal}</h2>
        <span>${esc(grupo.codigo || 'Produto')}</span>
      </div>
      <button class="close-btn" aria-label="Fechar">&times;</button>
    </header>
    <div class="kanban-modal-body">
      <div class="modal-code-block">
        <div class="modal-code-header">
          <span>${esc(grupo.codigo)}</span>
          <span>${grupo.quantidade || grupo.ops.length} OP(s)</span>
        </div>
      </div>
    </div>
    <footer>
      <button type="button" class="modal-secondary">Cancelar</button>
      <button type="button" class="modal-primary">Salvar</button>
    </footer>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Adiciona os campos de data/hora para cada OP
  const body = modal.querySelector('.kanban-modal-body .modal-code-block');
  const form = document.createElement('div');
  
  grupo.ops.forEach(op => {
    const row = document.createElement('div');
    row.className = 'op-row';
    const inputId = `prep-op-date-${op.id}`;
    const timeId = `prep-op-time-${op.id}`;
    const dateValue = formatDateInput(op.data_impressao);
    const timeValue = formatTimeInput(op.data_impressao);
    
    row.innerHTML = `
      <strong>${esc(op.numero_op || op.id)}</strong>
      <div class="op-inputs">
        <input type="date" id="${inputId}" value="${dateValue}" />
        <input type="time" id="${timeId}" value="${timeValue}" />
      </div>
      <div class="op-actions">
        <button type="button" class="op-editar" title="Editar estrutura do produto" aria-label="Editar estrutura do produto">
          <i class="fas fa-edit" aria-hidden="true"></i>
        </button>
        <button type="button" class="op-excluir" data-op="${esc(op.numero_op || '')}" title="Marcar como excluída" aria-label="Marcar OP ${esc(op.numero_op || '')} como excluída">
          <i class="fas fa-trash" aria-hidden="true"></i>
        </button>
      </div>
    `;
    form.appendChild(row);
  });
  
  body.appendChild(form);

  modal.querySelector('.close-btn').addEventListener('click', closePreparacaoOpsModal);
  modal.querySelector('.modal-secondary').addEventListener('click', closePreparacaoOpsModal);
  
  // Função auxiliar: marca OP como Excluída via endpoint
  async function preparacaoSetOpExcluida(numeroOp, produtoCodigo) {
    const base = (window.API_BASE || '');
    const url = `${base}/api/etiquetas/op/${encodeURIComponent(String(numeroOp || '').trim())}/etapa`;
    const payload = { etapa: 'Excluido' };
    if (produtoCodigo && String(produtoCodigo).trim()) {
      payload.produto_codigo = String(produtoCodigo).trim();
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`Falha HTTP ${resp.status}: ${txt}`);
    }
    return resp.json();
  }

  // Handler do botão Excluir (igual ao modal da guia Comercial)
  form.querySelectorAll('.op-excluir').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const numeroOp = btn.dataset.op;
      if (!numeroOp) return;
      const confirmacao = confirm(`Marcar a OP ${numeroOp} como Excluída?`);
      if (!confirmacao) return;
      btn.disabled = true;
      try {
        // Usa função global se existir; caso contrário, chama o endpoint diretamente
        if (typeof setOpEtapa === 'function') {
          try {
            await setOpEtapa(numeroOp, 'Excluido', grupo.codigo);
          } catch (e) {
            console.warn('[Preparação] setOpEtapa falhou, usando fallback direto:', e);
            await preparacaoSetOpExcluida(numeroOp, grupo.codigo);
          }
        } else {
          await preparacaoSetOpExcluida(numeroOp, grupo.codigo);
        }
        closePreparacaoOpsModal();
        await carregarPreparacaoDados();
      } catch (err) {
        console.error('[Preparação] excluir OP', err);
        alert('Falha ao marcar a OP como excluída.');
        btn.disabled = false;
      }
    });
  });

  // Handler do botão Editar: abre a guia PCP com o código do produto do grupo
  form.querySelectorAll('.op-editar').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      try {
          // Extrai código do produto (grupo.codigo) e versão/customização da OP
          const opRow = btn.closest('.op-row');
          let numeroOp = '';
          if (opRow) {
            const strong = opRow.querySelector('strong');
            if (strong) numeroOp = strong.textContent.trim();
          }
          // Exemplo: OPS2500037-v2C7
          // Extrai versão e customização
          let versao = '';
          let customizacao = '';
          const match = numeroOp.match(/-v(\d+)(C\d+)?$/i);
          if (match) {
            versao = match[1] || '';
            customizacao = match[2] || '';
          }
          // Código do produto
          const codigoProduto = grupo.codigo;

          // Monta payload para PCP
          const pcpPayload = { codigo: codigoProduto };
          if (versao) pcpPayload.versao = versao;
          if (customizacao) pcpPayload.customizacao = customizacao.replace('C', '');
          if (numeroOp) pcpPayload.op = numeroOp;

          console.log('[Preparação][Editar] Abrindo PCP com payload:', JSON.stringify(pcpPayload));

          // Define o contexto global para o carregamento da estrutura
          try {
            const ctx = {};
            if (versao) ctx.versao = versao;
            if (customizacao) ctx.customizacao = customizacao.replace('C', '');
            if (numeroOp) ctx.op = numeroOp;
            if (Object.keys(ctx).length) {
              window.pcpContext = ctx;
              console.log('[Preparação][Editar] window.pcpContext definido:', JSON.stringify(ctx));
            } else {
              window.pcpContext = undefined;
              console.log('[Preparação][Editar] window.pcpContext limpo');
            }
          } catch (e) {
            console.error('[Preparação][Editar] Erro ao definir pcpContext:', e);
          }

          // Tenta usar openPcpForCodigo se disponível, senão faz manualmente
          if (typeof openPcpForCodigo === 'function') {
            await openPcpForCodigo(pcpPayload);
          } else {
            // Fallback: abre PCP manualmente
            window.pcpCodigoAtual = codigoProduto;
            window.setPCPProdutoCodigo?.(codigoProduto);
            document
              .querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')
              ?.click();
            await window.ensurePCPEstruturaAutoLoad?.();
          }
          closePreparacaoOpsModal();
      } catch (e) {
        console.error('[Preparação] abrir PCP para edição', e);
      }
    });
  });

  modal.querySelector('.modal-primary').addEventListener('click', async () => {
    try {
      const updates = [];
      
      for (const op of grupo.ops) {
        const dateInput = modal.querySelector(`#prep-op-date-${op.id}`);
        const timeInput = modal.querySelector(`#prep-op-time-${op.id}`);
        const novoPrazo = combineDateTime(dateInput?.value || '', timeInput?.value || '00:00');
        
        if (novoPrazo) {
          updates.push({
            id: op.id,
            numero_op: op.numero_op,
            data_impressao: novoPrazo
          });
        }
      }
      
      if (updates.length === 0) {
        alert('Defina pelo menos uma data/hora válida.');
        return;
      }
      
      // Atualiza todas as OPs
      const promises = updates.map(update =>
        fetch('/api/ops/atualizar-data-impressao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update)
        }).then(res => res.json())
      );
      
      const results = await Promise.all(promises);
      const erros = results.filter(r => !r.success);
      
      if (erros.length > 0) {
        alert(`${erros.length} erro(s) ao atualizar. Verifique o console.`);
        console.error('Erros:', erros);
      } else {
        alert('Prazos atualizados com sucesso!');
      }
      
      closePreparacaoOpsModal();
      await carregarPreparacaoDados(); // Recarrega os dados
      
    } catch (err) {
      console.error('[Preparação] Erro ao salvar prazos:', err);
      alert('Falha ao salvar os prazos das OPs.');
    }
  });
}

function closePreparacaoOpsModal() {
  const overlay = document.getElementById('preparacao-modal-overlay');
  if (overlay) overlay.remove();
}

// Funções auxiliares para formatação de data/hora
function formatDateInput(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeInput(isoString) {
  if (!isoString) return '00:00';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '00:00';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const time = timeStr || '00:00';
  return `${dateStr}T${time}:00`;
}

// Cria o card HTML para o kanban (EXATAMENTE igual ao Comercial)
function criarCardPreparacao(op, coluna) {
  const li = document.createElement('li');
  li.className = 'kanban-card';
  li.dataset.opId = op.id || '';
  li.dataset.codigo = op.codigo || '';
  li.dataset.opsCount = op.quantidade || 0;
  
  const descricao = op.produto || 'Produto';
  const codigo = op.codigo || 'Sem código';
  const quantidade = op.quantidade || 0;
  const prazo = op.prazo_entrega || op.prazo || '';
  
  // Monta lista de pedidos/OPs se houver
  const pedidosHtml = (op.pedidos || []).map(p => `
    <div class="kanban-op-line">
      <span>Pedido ${p.numero_pedido || '—'}</span>
      <span class="kanban-op-date">Qtd ${p.quantidade || 0}</span>
    </div>
  `).join('');
  
  // Botões baseados na coluna
  let botoesHtml = '';
  if (coluna === 'aguardando') {
    // Coluna "Aguardando prazo": definir prazo + consultar estoque
    botoesHtml = `
      <div class="kanban-card-actions" style="display:flex; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1);">
        <button class="btn-kanban kanban-modal-trigger" title="Definir prazo" data-op-id="${op.id}" data-codigo="${codigo}" data-coluna="Aguardando prazo">
          <i class="far fa-calendar-alt"></i> Definir prazo
        </button>
      </div>
    `;
  } else if (coluna === 'fila') {
    // Coluna "Fila de produção": redefinir prazo + consultar estoque
    botoesHtml = `
      <div class="kanban-card-actions" style="display:flex; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1);">
        <button class="btn-kanban kanban-modal-trigger" title="Redefinir prazo" data-op-id="${op.id}" data-codigo="${codigo}" data-coluna="Fila de produção">
          <i class="fas fa-calendar-alt"></i> Redefinir prazo
        </button>
      </div>
    `;
  }
  
  li.innerHTML = `
    <div class="kanban-card-meta">${descricao}</div>
    <div class="kanban-code-header">
      <span>${codigo}</span>
      <span class="kanban-code-count">Qtd ${quantidade}</span>
    </div>
    <div class="kanban-op-list">${pedidosHtml}</div>
    ${prazo ? `<div class="kanban-prazo" style="font-size:0.85em; opacity:0.7; margin-top:4px;">Prazo: ${prazo}</div>` : ''}
    ${botoesHtml}
  `;
  
  return li;
}

// Inicializa a guia Preparação
async function initPreparacaoKanban() {
  // Carrega operações se ainda não carregou
  if (preparacaoOperacoes.length === 0) {
    await carregarPreparacaoOperacoes();
  } else {
    renderPreparacaoKanbans();
  }
}

/* ======== Links diretos do cabeçalho ======== */
document.getElementById('menu-produto') .addEventListener('click', e => {
  e.preventDefault();
  hideKanban();            // <<<<< usa o helper novo
  openDadosProdutoTab();   // já existia
});

document.getElementById('menu-pedidos').addEventListener('click', e => {
  e.preventDefault();
  showKanban();            // <<<<< usa o helper novo
});


/* ------------------------------------------------------------ *
 *  Mostra uma sub-aba do Kanban                                *
 *  nome = comercial | pcp | preparacao | producao | detalhes   *
 * ------------------------------------------------------------ */
function showKanbanTab(nome) {

  /* 1) destaca o link ativo na barra -------------------------- */
  document.querySelectorAll('#kanbanTabs .main-header-link')
    .forEach(a => a.classList.toggle('is-active',
                                     a.dataset.kanbanTab === nome));

  /* 2) exibe só o painel correspondente ----------------------- */
  document.querySelectorAll('#kanbanContent .kanban-page')
    .forEach(p =>
      p.style.display = (p.id === `conteudo-${nome}` ? 'block' : 'none')
    );

  /* 3) carrega / atualiza as colunas da aba escolhida ---------- */
if (nome === 'comercial')       KanbanViews.renderKanbanComercial?.();
else if (nome === 'pcp') {
  // Garante visibilidade do painel PCP
  const pcpPane = document.getElementById('conteudo-pcp');
  if (pcpPane) pcpPane.style.display = 'block';
setTimeout(compactPCPFilters, 80);

  // (opcional) Se existir um "render" da sua camada Kanban, deixamos rodar depois:
  try { KanbanViews.renderKanbanPCP?.(); } catch (_) {}
}

else if (nome === 'preparacao') initPreparacaoKanban();
else if (nome === 'producao')   KanbanViews.renderKanbanProducao?.();
else if (nome === 'detalhes') {
  // Inicializa o calendário de OPs de forma assíncrona para não bloquear a UI
  setTimeout(() => {
    try { initCalendarioUI(); } catch(e){ console.warn('[Calendario] init falhou', e); }
  }, 0);
  try { KanbanViews.renderKanbanDetalhes?.(); } catch(_) {}
}



  /* 4) guarda a última aba visitada --------------------------- */
  lastKanbanTab = nome;
}

/* ------------------------------------------------------------ *
 *  Listeners da barra “Comercial | PCP | …”                    *
 * ------------------------------------------------------------ */
document.querySelectorAll('#kanbanTabs .main-header-link')
  .forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();                    // cancela o href
      hideArmazem();                         // oculta abas de estoque
      const alvo = link.dataset.kanbanTab;   // comercial / pcp / …
      showKanbanTab(alvo);                   // exibe sub-kanban
    });
  });

/* ============================================================
   Calendário de OPs (aba "Calendario")
   Backend: GET /api/pcp/calendario?ano=YYYY&mes=MM&local=XXX (1-12)
   Estrutura resposta: { ok, ano, mes, dias: { 'YYYY-MM-DD': { impressao:[] } }, locais:[] }
============================================================ */
function initCalendarioUI() {
  if (window.__calInit) return; // evita duplicar
  window.__calInit = true;
  const selMes = document.getElementById('calMes');
  const inpAno = document.getElementById('calAno');
  const selLocal = document.getElementById('calLocal');
  const btnPrev = document.getElementById('calPrev');
  const btnNext = document.getElementById('calNext');
  const grid = document.getElementById('calGrid');
  if (!selMes || !inpAno || !selLocal || !btnPrev || !btnNext || !grid) return;

  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  selMes.innerHTML = meses.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
  const hoje = new Date();
  selMes.value = String(hoje.getMonth()+1);
  inpAno.value = hoje.getFullYear();

  btnPrev.addEventListener('click', () => navigateCalendario(-1));
  btnNext.addEventListener('click', () => navigateCalendario(1));
  selMes.addEventListener('change', () => carregarCalendarioAtual());
  inpAno.addEventListener('change', () => carregarCalendarioAtual());
  selLocal.addEventListener('change', () => carregarCalendarioAtual());

  // Carrega a lista de locais disponíveis a partir do backend
  (async function carregarLocaisCalendario(){
    try {
      const resp = await fetch(`${API_BASE}/api/pcp/calendario/locais`, { credentials: 'include' });
      if (!resp.ok) { console.warn('[Calendario] locais HTTP', resp.status); return; }
      const data = await resp.json();
      if (!data.ok || !Array.isArray(data.locais)) { console.warn('[Calendario] locais payload inválido', data); return; }
      const selecionado = selLocal.value || '';
      selLocal.innerHTML = '<option value="">Todos os locais</option>' +
        data.locais.map(loc => `<option value="${String(loc)}">${String(loc)}</option>`).join('');
      // restaura seleção anterior, se existir
      selLocal.value = selecionado;
    } catch (e){ console.warn('[Calendario] falha ao carregar locais', e); }
  })();

  // tooltip simples com detecção de bordas
  let tipEl = null;
  function showTip(ev, text){
    if (!text) return; 
    if (!tipEl){ 
      tipEl=document.createElement('div'); 
      tipEl.className='cal-tip'; 
      document.body.appendChild(tipEl);
    } 
    tipEl.textContent = text;
    
    // Posição inicial
    let x = ev.pageX + 12;
    let y = ev.pageY - 12;
    
    // Aplica posição para calcular dimensões
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
    tipEl.classList.add('show');
    
    // Ajusta se estourar pela direita
    const tipRect = tipEl.getBoundingClientRect();
    if (tipRect.right > window.innerWidth) {
      x = ev.pageX - tipRect.width - 12;
    }
    
    // Ajusta se estourar por cima
    if (tipRect.top < 0) {
      y = ev.pageY + 12;
    }
    
    // Ajusta se estourar por baixo
    if (tipRect.bottom > window.innerHeight) {
      y = ev.pageY - tipRect.height - 12;
    }
    
    // Ajusta se estourar pela esquerda
    if (x < 0) {
      x = 12;
    }
    
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  }
  function hideTip(){ if (tipEl) tipEl.classList.remove('show'); }
  grid.addEventListener('mouseover', ev => {
    const tgt = ev.target.closest('.code');
    if (tgt && tgt.dataset.full) showTip(ev, tgt.dataset.full);
  });
  grid.addEventListener('mousemove', ev => { 
    if (tipEl?.classList.contains('show')) { 
      const tgt = ev.target.closest('.code');
      if (tgt && tgt.dataset.full) showTip(ev, tgt.dataset.full);
    }
  });
  grid.addEventListener('mouseout', hideTip);

  carregarCalendarioAtual();
}

function navigateCalendario(dir){
  const selMes = document.getElementById('calMes');
  const inpAno = document.getElementById('calAno');
  let mes = parseInt(selMes.value,10); let ano = parseInt(inpAno.value,10);
  mes += dir;
  if (mes < 1){ mes = 12; ano--; }
  else if (mes > 12){ mes = 1; ano++; }
  selMes.value = String(mes); inpAno.value = String(ano);
  carregarCalendarioAtual();
}

async function carregarCalendarioAtual(){
  const selMes = document.getElementById('calMes');
  const inpAno = document.getElementById('calAno');
  const selLocal = document.getElementById('calLocal');
  const grid = document.getElementById('calGrid');
  if (!selMes || !inpAno || !selLocal || !grid) return;
  const mes = parseInt(selMes.value,10); 
  const ano = parseInt(inpAno.value,10);
  const local = selLocal.value || '';
  grid.innerHTML = '<div class="loading-cal" style="grid-column:1 / -1;">Carregando…</div>';
  try {
    const url = `/api/pcp/calendario?ano=${ano}&mes=${mes}${local ? `&local=${encodeURIComponent(local)}` : ''}`;
    const resp = await fetch(url, { credentials:'include' });
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Falha');
    
    // Processar dados retornados e agrupar por dia
    const dias = {};
    if (data.data && Array.isArray(data.data)) {
      data.data.forEach(item => {
        const dataKey = item.data_previsao?.split('T')[0]; // Pega apenas a data (YYYY-MM-DD)
        if (!dataKey) return;
        
        if (!dias[dataKey]) {
          dias[dataKey] = {
            porLocal: {},
            locais: []
          };
        }
        
        // Adiciona o produto ao dia
        const produtoInfo = {
          nome: item.codigo_produto || 'Sem código',
          status: item.status || 'aguardando',
          quantidade: item.quantidade || 0,
          descricao: item.produto_descricao || ''
        };
        
        dias[dataKey].locais.push(produtoInfo);
      });
    }
    
    renderCalendario(ano, mes, dias);
  } catch(e){
    grid.innerHTML = `<div class="loading-cal" style="grid-column:1 / -1;">Erro: ${e.message}</div>`;
  }
}

function renderSemData(semData){
  const box = document.getElementById('calSemData');
  if (!box) return;
  if (!semData || !Array.isArray(semData.locais) || semData.locais.length === 0){
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const chips = semData.locais.map(l => {
    const nome = l.nome || '';
    const st = String(l.status||'').toLowerCase();
    const count = l.count || 0;
    const iconStatus = st==='excluido' ? '<i class="fa-solid fa-circle-xmark status-excluido" title="Excluído"></i>'
                     : st==='aguardando' ? '<i class="fa-solid fa-hourglass-half status-aguardando" title="Aguardando produção"></i>'
                     : st==='produzindo' ? '<i class="fa-solid fa-gear fa-spin status-produzindo" title="Produzindo"></i>'
                     : st==='produzido' ? '<i class="fa-solid fa-circle-check status-produzido" title="Produzido"></i>'
                     : '';
    const iconSemData = '<i class="fa-solid fa-calendar-xmark" title="Sem data de impressão"></i>';
    return `<div class="chip"><span class="sd-icons">${iconSemData} ${iconStatus}</span><span>${nome} (${count})</span></div>`;
  }).join('');
  box.innerHTML = chips;
  box.style.display = 'flex';
}

function renderCalendario(ano, mes, dias){
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  // handler de clique para abrir modal com detalhes
  grid.onclick = (ev) => {
    const dayEl = ev.target.closest('.cal-day');
    if (!dayEl || dayEl.classList.contains('empty')) return;
    const dayKey = dayEl.dataset.date;
    if (!dayKey) return;
    abrirModalDia(dayKey, dias[dayKey] || { porLocal:{}, locais:[] });
  };
  const primeiro = new Date(Date.UTC(ano, mes-1, 1));
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const dowHeader = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const hoje = new Date(); const hojeKey = hoje.toISOString().slice(0,10);
  let html = dowHeader.map(d=>`<div class="dow">${d}</div>`).join('');
  const primeiroDow = primeiro.getUTCDay();
  for (let i=0;i<primeiroDow;i++) html += '<div class="cal-day empty"></div>';
  for (let dia=1; dia<=ultimoDia; dia++) {
    const key = `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
    const info = dias[key] || { porLocal:{}, locais:[] };
    // Exibir LOCAIS (objetos {nome, status, quantidade}) dentro do dia
    const locais = Array.isArray(info.locais) ? info.locais : [];
    const classes = ['cal-day'];
    if (locais.length) classes.push('has-impressao');
    if (key === hojeKey) classes.push('hoje');
    const muitos = locais.length > 6; if (muitos) classes.push('muitos');
    let codesHtml = '';
    
    // Função para obter o ícone baseado no status/etapa
    const getIcone = (st) => {
      const status = (st || '').toLowerCase().trim();
      if (status === 'excluido') return '<i class="fa-solid fa-circle-xmark status-excluido"></i>';
      if (status === 'produzindo') return '<i class="fa-solid fa-gear fa-spin status-produzindo"></i>';
      if (status === 'produzido') return '<i class="fa-solid fa-circle-check status-produzido"></i>';
      if (status === '' || status === 'aguardando') return '<i class="fa-solid fa-clock status-aguardando"></i>';
      return '<i class="fa-solid fa-calendar-plus status-novo"></i>'; // Sem data definida
    };
    
    if (muitos) {
      codesHtml = locais.slice(0,6).map(o=>{
        const nome = typeof o === 'string' ? o : (o?.nome || '');
        const desc = (typeof o === 'object' && o?.descricao) ? o.descricao : nome;
        const qtd = typeof o === 'object' ? (o.quantidade || 1) : 1;
        const st   = typeof o === 'object' ? (o.status||'') : '';
        const icon = getIcone(st);
        return `<span class="code impressao" data-full="${desc}\nStatus: ${st || 'Novo'}">${icon} ${nome} ${qtd}x</span>`;
      }).join('');
      const desces = locais.map(o => (typeof o === 'object' && o?.descricao) ? o.descricao : (typeof o==='string'?o:(o?.nome||'')));
      codesHtml += `<span class="code" style="background:#334155; color:#fff;" data-full="${desces.join(' | ')}">+${locais.length-6}</span>`;
    } else {
      codesHtml = locais.map(o=>{
        const nome = typeof o === 'string' ? o : (o?.nome || '');
        const desc = (typeof o === 'object' && o?.descricao) ? o.descricao : nome;
        const qtd = typeof o === 'object' ? (o.quantidade || 1) : 1;
        const st   = typeof o === 'object' ? (o.status||'') : '';
        const icon = getIcone(st);
        return `<span class="code impressao" data-full="${desc}\nStatus: ${st || 'Novo'}">${icon} ${nome} ${qtd}x</span>`;
      }).join('');
    }
    html += `<div class="${classes.join(' ')}" data-date="${key}"><div class="day-num">${dia}</div><div class="codes">${codesHtml}</div></div>`;
  }
  grid.innerHTML = html;
}

async function abrirModalDia(dayKey, info){
  const modal = document.getElementById('calModal');
  const body  = document.getElementById('calModalBody');
  const titulo= document.getElementById('calModalTitulo');
  const btnClose = document.getElementById('calModalClose');
  if (!modal || !body || !titulo || !btnClose) return;
  
  // Formata a data para DD/MM/AAAA no título do modal
  const fmtDataBr = (dStr) => {
    if (!dStr || typeof dStr !== 'string') return dStr;
    const parts = dStr.split('-');
    if (parts.length !== 3) return dStr;
    const [yyyy, mm, dd] = parts;
    return `${dd}/${mm}/${yyyy}`;
  };
  titulo.textContent = `Detalhes de ${fmtDataBr(dayKey)}`;
  body.innerHTML = '<div style="text-align:center;padding:20px;">Carregando...</div>';
  
  try {
  const selLocal = document.getElementById('calLocal');
  const localSel = selLocal ? (selLocal.value || '') : '';
  const url = `/api/pcp/calendario/dia?data=${dayKey}${localSel ? `&local=${encodeURIComponent(localSel)}` : ''}`;
    const resp = await fetch(url, { credentials: 'include' });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Falha ao carregar detalhes');
    
    if (!data.data || data.data.length === 0) {
      body.innerHTML = '<div style="padding:20px;">Nenhuma OP encontrada para este dia.</div>';
    } else {
      // Agrupa por código de produto
      const porProduto = new Map();
      for (const op of data.data) {
        const key = op.codigo_produto || 'Sem código';
        const arr = porProduto.get(key) || [];
        arr.push(op);
        porProduto.set(key, arr);
      }
      
      const blocos = Array.from(porProduto.entries()).map(([codigo, ops]) => {
        const descricao = ops[0]?.produto_descricao || 'Sem descrição';
        const opsHtml = ops.map(op => {
          const statusClass = (op.status || 'aguardando').toLowerCase();
          const etapaText = op.etapa || 'N/A';
          const qtd = op.quantidade || 0;
          return `<li>
            <span class="badge etapa-${statusClass}">${op.status || 'Aguardando'}</span>
            OP: ${op.num_op} | Qtd: ${qtd} | Etapa: ${etapaText}
            ${op.observacoes ? `<br><small>${op.observacoes}</small>` : ''}
          </li>`;
        }).join('');
        
        return `<div class="mod-local">
          <h4>${codigo} — ${descricao}</h4>
          <ul class="mod-prod-ops">${opsHtml}</ul>
        </div>`;
      }).join('');
      
      body.innerHTML = blocos;
    }
    
  } catch (e) {
    body.innerHTML = `<div style="color:#ef4444; padding:20px;">${e.message}</div>`;
  }
  
  modal.style.display = 'flex';
  btnClose.onclick = () => { modal.style.display = 'none'; };
  modal.onclick = (ev) => { if (ev.target === modal) modal.style.display = 'none'; };
}

window.initCalendarioUI = initCalendarioUI;
window.carregarCalendarioAtual = carregarCalendarioAtual;
window.renderCalendario = renderCalendario;
window.abrirModalDia = abrirModalDia;
/* Autoabrir PCP se a URL já vier com #pcp */
(function autoOpenPCPFromHash(){
  try {
    if (String(location.hash).toLowerCase().includes('pcp')) {
      // abre o quadro Kanban e ativa a sub-aba PCP
      showKanban();
      // vindo da COMERCIAL: define o código vencedor para a PCP
window.setPCPProdutoCodigo?.(codigo);   // 'codigo' é o do item clicado na Comercial

      showKanbanTab('pcp'); // isso já dispara ensurePCPEstruturaAutoLoad()
    }
  } catch {}
})();



// ---------- MENU RESPONSIVO ----------
const header   = document.getElementById('appHeader');   // <div class="header">
const menu     = document.getElementById('mainMenu');    // <nav …>

document.addEventListener('DOMContentLoaded', () => {
  if (window.inicializarImportacaoCaracteristicas)
       window.inicializarImportacaoCaracteristicas();
});

// quando clicar na sub-aba "Estrutura de produto"
document.querySelector('#produto-tabs [data-subtab="estrutura"]')?.addEventListener('click', () => {
  const codigo =
    // 1) algum elemento que mostra o código na área "Dados do produto"
    document.querySelector('#dados-produto .produto-codigo')?.textContent?.trim()
    // 2) ou algo global que você já usa
    || window.codigoProdutoAtual
    || window.prepCodigoSelecionado
    || '';
  if (codigo) {
    window.loadEstruturaProduto(codigo);
  }
});

// ========== Abrir Produto por código (força a guia Produto/Dados do produto) ==========
window.openProdutoPorCodigo = async function openProdutoPorCodigo(codigo) {
  try {
    // Se estamos vindo da guia Engenharia, esconder o painel de engenharia
    const engPane = document.getElementById('engenhariaPane');
    if (engPane) engPane.style.display = 'none';
    // Reusa fluxo padrão para abrir a aba de dados do produto (garante hamburger e layout)
    openDadosProdutoTab();

    // 2) ativa a aba principal "Dados do produto"
    document.querySelectorAll('#produtoTabs .main-header .nav-card')
      .forEach(a => a.classList.remove('active'));
    const linkDados = document.querySelector('#produtoTabs .main-header .nav-card[data-target="dadosProduto"]');
    if (linkDados) linkDados.classList.add('active');

    // mostra apenas o painel de dados
    document.querySelectorAll('#produtoTabs .tab-content .tab-pane').forEach(p => p.style.display = 'none');
    const paneDados = document.getElementById('dadosProduto');
    if (paneDados) paneDados.style.display = 'block';

  // guarda global (o resto da UI já usa essa variável)
  window.codigoSelecionado = (codigo || '').trim();

    // dispara o carregamento normal dos “Dados do produto”
    if (typeof window.loadDadosProduto === 'function') {
      await window.loadDadosProduto(codigo);
    }

    // não carrega estrutura aqui; deixamos o clique da sub-aba disparar
  } catch (e) {
    console.warn('[openProdutoPorCodigo]', e);
  }
};

// ========== Engenharia: carregar produtos "Em criação" =====================
// Função auxiliar para fechar todas as linhas expandidas
function closeAllExpandRows() {
  const tbody = document.querySelector('#engTbody');
  if (!tbody) return;
  
  const allExpandRows = tbody.querySelectorAll('.expand-row');
  allExpandRows.forEach(row => row.remove());
  
  const allChevrons = tbody.querySelectorAll('.fa-chevron-up');
  allChevrons.forEach(icon => {
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
  });
}

// Funções auxiliares para expandir/recolher detalhes
async function toggleExpandCadastro(btn) {
  const codigo = btn.dataset.codigo;
  const tr = btn.closest('tr');
  const existingRow = tr.nextElementSibling;
  const icon = btn.querySelector('i');
  
  // Se já existe uma linha expandida, remove
  if (existingRow && existingRow.classList.contains('expand-row-cadastro')) {
    existingRow.remove();
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
    return;
  }
  
  // Fecha todas as outras expansões
  closeAllExpandRows();
  
  // Busca dados
  try {
    btn.disabled = true;
    icon.classList.add('fa-spin');
    
    const resp = await fetch(`/api/engenharia/produto-cadastro/${encodeURIComponent(codigo)}`, { credentials: 'include' });
    if (!resp.ok) throw new Error('Falha ao buscar detalhes');
    const data = await resp.json();
    
    // Cria linha expandida
    const expandRow = document.createElement('tr');
    expandRow.classList.add('expand-row', 'expand-row-cadastro');
    expandRow.innerHTML = `
      <td colspan="5" style="padding:0;border-bottom:1px solid var(--border-color);background:#f9fafb;">
        <div style="padding:16px 24px;">
          <h4 style="margin:0 0 12px 0;font-size:14px;font-weight:600;color:#1f2937;">Campos do Cadastro</h4>
          ${data.campos_pendentes.length > 0 ? `
            <div style="margin-bottom:16px;">
              <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#dc2626;">Pendentes (${data.campos_pendentes.length}):</p>
              <ul style="margin:0;padding-left:20px;font-size:12px;color:#dc2626;">
                ${data.campos_pendentes.map(c => `<li>${c.nome}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${data.campos_preenchidos.length > 0 ? `
            <div>
              <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#16a34a;">Preenchidos (${data.campos_preenchidos.length}):</p>
              <ul style="margin:0;padding-left:20px;font-size:12px;color:#6b7280;">
                ${data.campos_preenchidos.map(c => `<li>${c.nome}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${data.campos_pendentes.length === 0 && data.campos_preenchidos.length === 0 ? `
            <p style="margin:0;font-size:12px;color:#9ca3af;">Nenhum campo obrigatório configurado para esta família.</p>
          ` : ''}
        </div>
      </td>
    `;
    
    tr.parentNode.insertBefore(expandRow, tr.nextSibling);
    icon.classList.remove('fa-chevron-down', 'fa-spin');
    icon.classList.add('fa-chevron-up');
  } catch (err) {
    console.error('[Expandir Cadastro] Erro:', err);
    alert('Erro ao carregar detalhes do cadastro');
  } finally {
    btn.disabled = false;
    icon.classList.remove('fa-spin');
  }
}

async function toggleExpandEngenharia(btn) {
  const codigo = btn.dataset.codigo;
  const tr = btn.closest('tr');
  const existingRow = tr.nextElementSibling;
  const icon = btn.querySelector('i');
  
  if (existingRow && existingRow.classList.contains('expand-row-engenharia')) {
    existingRow.remove();
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
    return;
  }
  
  // Fecha todas as outras expansões
  closeAllExpandRows();
  
  try {
    btn.disabled = true;
    icon.classList.add('fa-spin');
    
    const resp = await fetch(`/api/engenharia/produto-tarefas/${encodeURIComponent(codigo)}`, { credentials: 'include' });
    if (!resp.ok) throw new Error('Falha ao buscar detalhes');
    const data = await resp.json();
    
    const expandRow = document.createElement('tr');
    expandRow.classList.add('expand-row', 'expand-row-engenharia');
    expandRow.innerHTML = `
      <td colspan="5" style="padding:0;border-bottom:1px solid var(--border-color);background:#f9fafb;">
        <div style="padding:16px 24px;">
          <h4 style="margin:0 0 12px 0;font-size:14px;font-weight:600;color:#1f2937;">Tarefas de Engenharia (${data.total})</h4>
          ${data.pendentes.length > 0 ? `
            <div style="margin-bottom:16px;">
              <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#dc2626;">Pendentes (${data.pendentes.length}):</p>
              <ul style="margin:0;padding-left:20px;font-size:12px;color:#374151;">
                ${data.pendentes.map(t => `
                  <li style="margin-bottom:8px;">
                    <div style="margin-bottom:2px;">
                      <strong>${t.nome_atividade}</strong>
                      ${t.origem === 'produto' ? '<span style="background:#3b82f6;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px;">ESPECÍFICA</span>' : ''}
                    </div>
                    ${t.descricao_atividade ? `<div style="color:#6b7280;font-size:11px;margin-top:4px;">${t.descricao_atividade}</div>` : ''}
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
          ${data.concluidas.length > 0 ? `
            <div>
              <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#16a34a;">Concluídas (${data.concluidas.length}):</p>
              <ul style="margin:0;padding-left:20px;font-size:12px;color:#6b7280;">
                ${data.concluidas.map(t => `
                  <li style="margin-bottom:6px;">
                    <strong>${t.nome_atividade}</strong>
                    ${t.origem === 'produto' ? '<span style="background:#3b82f6;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px;">ESPECÍFICA</span>' : ''}
                    ${t.nao_aplicavel ? '<span style="color:#f59e0b;font-size:11px;"> (Não se aplica)</span>' : ''}
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
          ${data.total === 0 ? `
            <p style="margin:0;font-size:12px;color:#9ca3af;">Nenhuma atividade configurada.</p>
          ` : ''}
        </div>
      </td>
    `;
    
    tr.parentNode.insertBefore(expandRow, tr.nextSibling);
    icon.classList.remove('fa-chevron-down', 'fa-spin');
    icon.classList.add('fa-chevron-up');
  } catch (err) {
    console.error('[Expandir Engenharia] Erro:', err);
    alert('Erro ao carregar tarefas de engenharia');
  } finally {
    btn.disabled = false;
    icon.classList.remove('fa-spin');
  }
}

async function toggleExpandCompras(btn) {
  const codigo = btn.dataset.codigo;
  const tr = btn.closest('tr');
  const existingRow = tr.nextElementSibling;
  const icon = btn.querySelector('i');
  
  if (existingRow && existingRow.classList.contains('expand-row-compras')) {
    existingRow.remove();
    icon.classList.remove('fa-chevron-up');
    icon.classList.add('fa-chevron-down');
    return;
  }
  
  // Fecha todas as outras expansões
  closeAllExpandRows();
  
  try {
    btn.disabled = true;
    icon.classList.add('fa-spin');
    
    const resp = await fetch(`/api/engenharia/produto-compras/${encodeURIComponent(codigo)}`, { credentials: 'include' });
    if (!resp.ok) throw new Error('Falha ao buscar detalhes');
    const data = await resp.json();
    
    const expandRow = document.createElement('tr');
    expandRow.classList.add('expand-row', 'expand-row-compras');
    expandRow.innerHTML = `
      <td colspan="5" style="padding:0;border-bottom:1px solid var(--border-color);background:#f9fafb;">
        <div style="padding:16px 24px;">
          <h4 style="margin:0 0 12px 0;font-size:14px;font-weight:600;color:#1f2937;">Tarefas de Compras (${data.total})</h4>
          ${data.pendentes.length > 0 ? `
            <div style="margin-bottom:16px;">
              <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#dc2626;">Pendentes (${data.pendentes.length}):</p>
              <ul style="margin:0;padding-left:20px;font-size:12px;color:#374151;">
                ${data.pendentes.map(t => `
                  <li style="margin-bottom:8px;">
                    <div style="margin-bottom:2px;">
                      <strong>${t.nome_atividade}</strong>
                      ${t.origem === 'produto' ? '<span style="background:#f59e0b;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px;">ESPECÍFICA</span>' : ''}
                    </div>
                    ${t.descricao_atividade ? `<div style="color:#6b7280;font-size:11px;margin-top:4px;">${t.descricao_atividade}</div>` : ''}
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
          ${data.concluidas.length > 0 ? `
            <div>
              <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#16a34a;">Concluídas (${data.concluidas.length}):</p>
              <ul style="margin:0;padding-left:20px;font-size:12px;color:#6b7280;">
                ${data.concluidas.map(t => `
                  <li style="margin-bottom:6px;">
                    <strong>${t.nome_atividade}</strong>
                    ${t.origem === 'produto' ? '<span style="background:#f59e0b;color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px;">ESPECÍFICA</span>' : ''}
                    ${t.nao_aplicavel ? '<span style="color:#f59e0b;font-size:11px;"> (Não se aplica)</span>' : ''}
                  </li>
                `).join('')}
              </ul>
            </div>
          ` : ''}
          ${data.total === 0 ? `
            <p style="margin:0;font-size:12px;color:#9ca3af;">Nenhuma atividade configurada.</p>
          ` : ''}
        </div>
      </td>
    `;
    
    tr.parentNode.insertBefore(expandRow, tr.nextSibling);
    icon.classList.remove('fa-chevron-down', 'fa-spin');
    icon.classList.add('fa-chevron-up');
  } catch (err) {
    console.error('[Expandir Compras] Erro:', err);
    alert('Erro ao carregar tarefas de compras');
  } finally {
    btn.disabled = false;
    icon.classList.remove('fa-spin');
  }
}

async function loadEngenhariaLista() {
  const tbody = document.getElementById('engTbody');
  const spinner = document.getElementById('engSpinner');
  if (!tbody) return;
  try {
    if (spinner) spinner.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="5" style="padding:20px 12px;text-align:center;color:#6b7280;">Carregando...</td></tr>';
    const resp = await fetch('/api/engenharia/em-criacao', { credentials: 'include' });
    if (!resp.ok) throw new Error('Falha ao buscar lista');
    const data = await resp.json();
    const itens = Array.isArray(data.itens) ? data.itens : [];
    if (!itens.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:28px 12px;text-align:center;color:#6b7280;">Nenhum produto em criação encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    itens.forEach(p => {
      const tr = document.createElement('tr');
      tr.dataset.codigo = p.codigo;
      
      // GRÁFICO CIRCULAR (CADASTRO): Usa dados de COMPLETUDE (campos obrigatórios)
      const pctCompletude = Number(p.completude_percentual) || 0;
      const totalCompletude = Number(p.completude_total) || 0;
      const concluidasCompletude = Number(p.completude_concluidas) || 0;
      
      // BARRA DE PROGRESSO (TAREFAS): Usa dados de ENGENHARIA (atividades Check-Proj)
      const pctEng = Number(p.eng_percentual) || 0;
      const totalEng = Number(p.eng_total) || 0;
      const concluidasEng = Number(p.eng_concluidas) || 0;
      
      // BARRA DE PROGRESSO (COMPRAS): Usa dados de COMPRAS (atividades Check-Compras)
      const pctCompras = Number(p.compras_percentual) || 0;
      const totalCompras = Number(p.compras_total) || 0;
      const concluidasCompras = Number(p.compras_concluidas) || 0;
      
      // Cor do círculo baseada na completude
      let corCirculo = '#dc2626'; // vermelho
      let corTextoCirculo = '#dc2626';
      if (pctCompletude === 100) {
        corCirculo = '#16a34a'; // verde escuro
        corTextoCirculo = '#16a34a';
      } else if (pctCompletude >= 70) {
        corCirculo = '#22c55e'; // verde claro
        corTextoCirculo = '#16a34a';
      } else if (pctCompletude >= 40) {
        corCirculo = '#f59e0b'; // amarelo
        corTextoCirculo = '#d97706';
      }
      
      // Cor da barra baseada nas atividades de engenharia
      let corBarra = '#dc2626'; // vermelho
      let corTextoBarra = '#dc2626';
      if (pctEng === 100) {
        corBarra = '#16a34a'; // verde escuro
        corTextoBarra = '#16a34a';
      } else if (pctEng >= 70) {
        corBarra = '#22c55e'; // verde claro
        corTextoBarra = '#16a34a';
      } else if (pctEng >= 40) {
        corBarra = '#f59e0b'; // amarelo
        corTextoBarra = '#d97706';
      }
      
      // Cor da barra de compras
      let corBarraCompras = '#dc2626'; // vermelho
      let corTextoBarraCompras = '#dc2626';
      if (pctCompras === 100) {
        corBarraCompras = '#16a34a'; // verde escuro
        corTextoBarraCompras = '#16a34a';
      } else if (pctCompras >= 70) {
        corBarraCompras = '#22c55e'; // verde claro
        corTextoBarraCompras = '#16a34a';
      } else if (pctCompras >= 40) {
        corBarraCompras = '#f59e0b'; // amarelo
        corTextoBarraCompras = '#d97706';
      }
      
      // Cálculo do stroke-dashoffset para o círculo (circunferência = 2πr = 125.6 para r=20)
      const circumference = 125.6;
      const offset = circumference - (pctCompletude / 100) * circumference;
      
      // HTML da coluna CADASTRO (gráfico circular + botão expandir)
      const cadastroHtml = totalCompletude > 0 ? `
        <div style="display:flex;justify-content:center;align-items:center;gap:8px;">
          <svg width="50" height="50" viewBox="0 0 50 50" title="Completude: ${concluidasCompletude}/${totalCompletude} campos (${pctCompletude}%)">
            <circle cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" stroke-width="4"/>
            <circle cx="25" cy="25" r="20" fill="none" 
                    stroke="${corCirculo}" stroke-width="4" stroke-linecap="round"
                    stroke-dasharray="125.6" stroke-dashoffset="${offset}"
                    transform="rotate(-90 25 25)"
                    style="transition: stroke-dashoffset 0.5s ease;"/>
            <text x="25" y="29" text-anchor="middle" 
                  font-size="11" font-weight="bold" fill="${corTextoCirculo}">${pctCompletude}%</text>
          </svg>
          <button class="btn-expand-cadastro" data-codigo="${p.codigo}" style="background:none;border:none;cursor:pointer;padding:4px;color:#6b7280;font-size:16px;" title="Expandir detalhes">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
      ` : '<span style="font-size:12px;color:#9ca3af;">-</span>';
      
      // HTML da coluna ENGENHARIA (barra de progresso + botão expandir)
      const tarefasHtml = totalEng > 0 ? `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;background:#e5e7eb;height:8px;border-radius:4px;overflow:hidden;" title="Check-Proj: ${concluidasEng}/${totalEng} atividades (${pctEng}%)">
            <div style="width:${pctEng}%;height:100%;background:${corBarra};transition:width 0.3s;"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:${corTextoBarra};min-width:70px;text-align:right;">${concluidasEng}/${totalEng} (${pctEng}%)</span>
          <button class="btn-expand-engenharia" data-codigo="${p.codigo}" style="background:none;border:none;cursor:pointer;padding:4px;color:#6b7280;font-size:16px;" title="Expandir detalhes">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
      ` : '<span style="font-size:12px;color:#9ca3af;">Sem atividades</span>';
      
      // HTML da coluna COMPRAS (barra de progresso + botão expandir)
      const comprasHtml = totalCompras > 0 ? `
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;background:#e5e7eb;height:8px;border-radius:4px;overflow:hidden;" title="Check-Compras: ${concluidasCompras}/${totalCompras} atividades (${pctCompras}%)">
            <div style="width:${pctCompras}%;height:100%;background:${corBarraCompras};transition:width 0.3s;"></div>
          </div>
          <span style="font-size:12px;font-weight:600;color:${corTextoBarraCompras};min-width:70px;text-align:right;">${concluidasCompras}/${totalCompras} (${pctCompras}%)</span>
          <button class="btn-expand-compras" data-codigo="${p.codigo}" style="background:none;border:none;cursor:pointer;padding:4px;color:#6b7280;font-size:16px;" title="Expandir detalhes">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
      ` : '<span style="font-size:12px;color:#9ca3af;">Sem atividades</span>';
      
      tr.innerHTML = `
        <td class="td-clickable" data-codigo="${p.codigo}" style="padding:8px 12px;border-bottom:1px solid var(--border-color);font-size:13px;white-space:nowrap;cursor:pointer;">${p.codigo}</td>
        <td class="td-clickable" data-codigo="${p.codigo}" style="padding:8px 12px;border-bottom:1px solid var(--border-color);font-size:13px;cursor:pointer;">${p.descricao}</td>
        <td style="padding:8px 12px;border-bottom:1px solid var(--border-color);text-align:center;">${cadastroHtml}</td>
        <td style="padding:8px 12px;border-bottom:1px solid var(--border-color);">${tarefasHtml}</td>
        <td style="padding:8px 12px;border-bottom:1px solid var(--border-color);">${comprasHtml}</td>
      `;
      tr.dataset.codigo = p.codigo;
      tbody.appendChild(tr);
    });
    
    // Event handlers para células clicáveis (código e descrição)
    tbody.querySelectorAll('.td-clickable').forEach(td => {
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        const codigo = td.dataset.codigo;
        if (codigo) window.openProdutoPorCodigo(codigo);
      });
    });
    
    // Event handlers para botões de expandir
    tbody.querySelectorAll('.btn-expand-cadastro').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleExpandCadastro(btn);
      });
    });
    
    tbody.querySelectorAll('.btn-expand-engenharia').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleExpandEngenharia(btn);
      });
    });
    
    tbody.querySelectorAll('.btn-expand-compras').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleExpandCompras(btn);
      });
    });
    
  } catch (err) {
    console.error('[Engenharia] Erro ao carregar lista:', err);
    tbody.innerHTML = '<tr><td colspan="5" style="padding:28px 12px;text-align:center;color:#dc2626;">Erro ao carregar lista.</td></tr>';
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

// Handler clique da guia Engenharia
function openEngenharia() {
  // Remove active de outros links top
  document.querySelectorAll('.header .menu-link').forEach(a=>a.classList.remove('is-active'));
  const link = document.getElementById('menu-engenharia');
  if (link) link.classList.add('is-active');

  // Esconde inicio e produtoTabs se estiverem visíveis
  const inicioPane = document.getElementById('paginaInicio');
  if (inicioPane) inicioPane.style.display = 'none';
  const prodTabs = document.getElementById('produtoTabs');
  if (prodTabs) prodTabs.style.display = 'none';

  // Esconde qualquer .tab-pane aberto
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

  // Mostra engenharia
  const pane = document.getElementById('engenhariaPane');
  if (pane) pane.style.display = 'block';
  // Atualiza hash para evitar scripts que reabrem produto
  try { location.hash = '#engenharia'; } catch(_){}

  // SEMPRE recarrega a lista para garantir dados atualizados
  loadEngenhariaLista();
}

const engLink = document.getElementById('menu-engenharia');
engLink?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation(); // evita outros handlers abrirem produto
  openEngenharia();
}, true); // captura primeiro

// Expor para outros módulos se necessário
window.openEngenharia = openEngenharia;

// ========== Interceptar navegadores antigos para "Início" ==========
(function interceptarNavigateToDetalhes() {
  const prev = window.navigateToDetalhes;
  window.navigateToDetalhes = function patchedNavigateToDetalhes(target, codigo) {
    // se vierem pedindo "iniciar" com código, redireciona para Produto
    if (codigo && (String(target).toLowerCase() === 'iniciar' || String(target).toLowerCase() === 'inicio')) {
      return window.openProdutoPorCodigo(codigo);
    }
    if (typeof prev === 'function') return prev(target, codigo);
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Estrutura de produto (render por grupos de Operação)
// - Busca a estrutura via API (/api/pcp/estrutura)
// - Agrupa por comp_operacao e renderiza blocos (categoria) com contador
// - A COLUNA "Operação" foi REMOVIDA da grade (fica só no título do grupo)
// - Atualiza "Estrutura de produto (x)" só dentro de #estruturaProduto (sem varrer a página)
// ─────────────────────────────────────────────────────────────────────────────
window.loadEstruturaProduto = async function loadEstruturaProduto(codigo) {
  const ul = document.querySelector('#estruturaProduto #malha');
  if (!ul) return;

  const cod = (codigo || window.codigoSelecionado || '').trim();
  let metaForPreselect = null;

  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Atualiza o contador "Estrutura de produto (x)" SOMENTE dentro de #estruturaProduto
  const setEstruturaCount = (n) => {
    const root = document.getElementById('estruturaProduto') || document.querySelector('#estruturaProduto');
    if (!root) return;

    // 1) Elemento dedicado (se existir)
    const badge = root.querySelector('[data-estrutura-count], #estruturaCount, .estrutura-count');
    if (badge) { badge.textContent = String(n); return; }

    // 2) Algum heading DENTRO da seção com o texto "Estrutura de produto"
    const heads = root.querySelectorAll('h1,h2,h3,.section-title,.titulo,.header-title');
    for (const el of heads) {
      const txt = (el.textContent || '').trim();
      if (!/estrutura de produto/i.test(txt)) continue;

      if (/\(\s*\d+\s*\)$/.test(txt)) {
        const base = txt.replace(/\s*\(\s*\d+\s*\)\s*$/, '');
        el.textContent = `${base} (${n})`;
      } else {
        const span = document.createElement('span');
        span.className = 'estrutura-count';
        span.style.marginLeft = '6px';
        span.textContent = `(${n})`;
        el.appendChild(span);
      }
      return;
    }

    // 3) Sem fallback fora da seção para não destruir a página
    console.debug('[Estrutura][count] Sem alvo dedicado para mostrar o número.');
  };

  // header inicial (SEM coluna "Operação")
  ul.innerHTML = `
  <li class="header-row">
    <div>Código</div><div>Descrição</div><div>QTD</div>
    <div>Unidade</div><div>Custo real</div><div>Ações</div>
  </li>
    <li><div style="opacity:.7">${cod ? `Carregando estrutura de ${esc(cod)}…` : 'Selecione um produto.'}</div></li>
  `;
  if (!cod) { setEstruturaCount(0); return; }

  // Atualiza badges de versão/modificador após exibir placeholder
  if (typeof pcpUpdateVersaoBadges === 'function') {
    try {
      const meta = await pcpFetchEstruturaMetaByCod(cod);
      metaForPreselect = meta;
      pcpUpdateVersaoBadges(meta);
    } catch (metaErr) {
      console.warn('[Estrutura] Não foi possível carregar meta (versão/modificador):', metaErr);
      pcpUpdateVersaoBadges(null);
    }
  }

  // Preenche o listbox "Local de produção." com operações do SQL (public.omie_operacao)
  try { await ensureLocalProducaoSelectOptions(); } catch (e) { console.warn('[Estrutura] Falha ao carregar locais de produção:', e); }

  // Pré-seleciona o valor salvo (se existir)
  try {
    const sel = document.getElementById('estruturaLocalProducao');
    if (sel) {
      let saved = metaForPreselect?.local_producao || null;
      if (!saved) {
        // fallback: buscar meta de novo (caso badge tenha sido pulado)
        try {
          const meta = await pcpFetchEstruturaMetaByCod(cod);
          saved = meta?.local_producao || null;
        } catch {}
      }
      if (saved) {
        // tenta seleção por label exata
        const opt = Array.from(sel.options).find(o => (o.value || '').trim() === String(saved).trim());
        if (opt) sel.value = opt.value;
      }
    }
  } catch (e) {
    console.warn('[Estrutura] Pré-seleção de Local de produção falhou:', e);
  }

  const norm = (s) => (s ?? '').toString().trim();
  const labelOper = (s) => (norm(s) || 'SEM OPERAÇÃO');

  try {
    // busca a estrutura (API já devolve comp_operacao)
    const r = await fetch('/api/pcp/estrutura?pai_codigo=' + encodeURIComponent(cod), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const j = await r.json();
    const dados = Array.isArray(j?.dados) ? j.dados : [];

    const frag = document.createDocumentFragment();

    // cabeçalho fixo (SEM "Operação")
    const head = document.createElement('li');
    head.className = 'header-row';
    head.innerHTML = `
      <div>Código</div><div>Descrição</div><div>QTD</div>
      <div>Unidade</div><div>Custo real</div><div>Ações</div>`;
    frag.appendChild(head);

    if (!dados.length) {
      const li = document.createElement('li');
      li.innerHTML = `<div style="opacity:.7">Estrutura de produto (${esc(cod)}) vazia.</div>`;
      frag.appendChild(li);
      setEstruturaCount(0);
    } else {
      // — agrupa por Operação —
      const grupos = new Map();
      for (const r of dados) {
        const key = labelOper(r.comp_operacao);
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(r);
      }

      // — ordena grupos: BASE e HIGIENIZAÇÃO primeiro; SEM OPERAÇÃO por último; resto alfabético —
      const prio = new Map([['BASE', -2], ['HIGIENIZAÇÃO', -1], ['HIGIENIZACAO', -1], ['SEM OPERAÇÃO', 999]]);
      const opsOrdenadas = Array.from(grupos.keys()).sort((a,b) => {
        const pa = prio.get(a.toUpperCase()) ?? 0;
        const pb = prio.get(b.toUpperCase()) ?? 0;
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b, 'pt-BR');
      });

      // — render: cabeçalho de grupo + linhas (6 colunas) —
      for (const opNome of opsOrdenadas) {
        const arr = grupos.get(opNome);

        // cabeçalho do grupo
        const cat = document.createElement('li');
        cat.className = 'category-header';
        cat.innerHTML = `
          <div class="left">
            ${esc(opNome)} <span class="badge">(${arr.length})</span>
          </div>
          <div class="right"></div>
        `;
        frag.appendChild(cat);

        // linhas do grupo
        for (const row of arr) {
          const li = document.createElement('li');
          li.dataset.comp = row.comp_codigo || '';
          li.innerHTML = `
            <div>${esc(row.comp_codigo || '')}</div>
            <div class="desc" title="${esc(row.comp_descricao || '')}">${esc(row.comp_descricao || '')}</div>
            <div>${Number(row.comp_qtd || 0)}</div>
            <div>${esc(row.comp_unid || '')}</div>
            <div>—</div>
            <div class="acoes">
              <!-- Trocar -->
              <button type="button" class="icon-btn" data-action="trocar" title="Trocar" aria-label="Trocar">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 7h10"></path><path d="M14 4l3 3-3 3"></path><path d="M17 17H7"></path><path d="M10 20l-3-3 3-3"></path></svg>
              </button>
              <!-- Abrir -->
              <button type="button" class="icon-btn" data-action="abrir" title="Abrir" aria-label="Abrir">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 3L10 14"></path><path d="M5 7v12h12"></path></svg>
              </button>
              <!-- Estrutura -->
              <button type="button" class="icon-btn" data-action="estrutura" title="Estrutura" aria-label="Estrutura">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <circle cx="6"  cy="6"  r="2"></circle>
                  <circle cx="18" cy="6"  r="2"></circle>
                  <circle cx="18" cy="12" r="2"></circle>
                  <circle cx="18" cy="18" r="2"></circle>
                  <path d="M8 6h8"></path><path d="M8 6v12"></path>
                  <path d="M14 12h4"></path><path d="M14 18h4"></path>
                </svg>
              </button>
            </div>`;
          frag.appendChild(li);
        }
      }

      // total de itens (todas as linhas)
      setEstruturaCount(dados.length);
    }

    ul.replaceChildren(frag);

    // mantém delegações existentes e marca ícones "Estrutura" quando houver filhos
    ensureEstruturaDelegation();
    await markEstruturaButtons(ul);

  } catch (e) {
    console.error('[loadEstruturaProduto]', e);
    ul.innerHTML = `
      <li class="header-row">
        <div>Código</div><div>Descrição</div><div>QTD</div>
        <div>Unidade</div><div>Custo real</div><div>Ações</div>
      </li>
      <li><div style="color:#ef4444">Falha ao carregar estrutura.</div></li>`;
    setEstruturaCount(0);
  }
};




// ————————————————————————————————————————————————————————————————
// Delegação: Abrir (dados), Estrutura (expand/collapse), Trocar (editor 1-campo)
// ————————————————————————————————————————————————————————————————
let __estruturaDelegationBound = false;
function ensureEstruturaDelegation() {
  if (__estruturaDelegationBound) return;
  const root = document.querySelector('#estruturaProduto #malha');
  if (!root) return;

  root.addEventListener('click', async (ev) => {
    const btnAbrir  = ev.target.closest('.icon-btn[data-action="abrir"], .button-wrapper .content-button.open');
    const btnEstr   = ev.target.closest('.icon-btn[data-action="estrutura"]');
    const btnTrocar = ev.target.closest('.icon-btn[data-action="trocar"]');
    const row       = ev.target.closest('li');
    if (!row) return;

    const codigo = (row.dataset.comp || row.querySelector(':scope > div:first-child')?.textContent || '').trim();
    if (!codigo) return;

    // ——— Abrir ———
    if (btnAbrir) {
      try {
        if (typeof window.openProdutoPorCodigo === 'function') return void window.openProdutoPorCodigo(codigo);
        if (typeof window.navigateToDetalhes === 'function')   return void window.navigateToDetalhes('iniciar', codigo);
        document.querySelectorAll('.tab-pane').forEach(p => { if (p && p.style) p.style.display = 'none'; });
        document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
        const tabBtn = document.querySelector('.main-header-link[data-target="dadosProduto"]'); if (tabBtn) tabBtn.classList.add('is-active');
        const pane   = document.getElementById('dadosProduto'); if (pane && pane.style) pane.style.display = 'block';
        const header = document.querySelector('.main-header');  if (header && header.style) header.style.display = 'flex';
        window.codigoSelecionado = codigo;
        if (typeof window.loadDadosProduto === 'function') await window.loadDadosProduto(codigo);
      } catch (err) { console.error('[Abrir] falha:', err); }
      return;
    }

    // ——— Estrutura ———
    if (btnEstr) { await toggleEstruturaInline(row, codigo, root); return; }

// ——— Trocar ——— (usa o MESMO painel da PCP)
if (btnTrocar) {
  const next = row.nextElementSibling;
  // fecha se já estiver aberto (antigo "swap-row" ou o novo "pcp-troca")
  if (next && (next.classList.contains('pcp-troca') || next.classList.contains('swap-row'))) {
    next.remove();
    return;
  }
  try {
    await pcpToggleTrocaProduto(row, codigo); // ← mesmo painel/UX da PCP
  } catch (e) {
    console.warn('[Estrutura] Troca falhou:', e);
  }
  return;
}

  });

  __estruturaDelegationBound = true;
}

// ——— Editor inline de Troca (1 campo unificado com highlight) ———
function renderSwapEditorOneField(row, codigoAntigo) {
  // local debouncer (evita colisões globais)
  const __debounceLocal = (fn, ms = 220) => { let h; return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms); }; };

  const li = document.createElement('li');
  li.className = 'swap-row';

  const pai = (window.codigoSelecionado || '').trim(); // produto pai aberto

  li.innerHTML = `
    <div style="grid-column: 1 / 3">
      <label class="swap-label">Pesquisar código ou descrição</label>
      <input type="text" class="swap-input swap-q" placeholder="Digite um código (ex: FTI185LPTBR) ou palavras (ex: BOMBA DE CALOR, TRIFASICA 380V)..." />
    </div>
    <div></div><div></div><div></div>
    <div class="swap-actions">
      <button type="button" class="swap-btn swap-cancelar">Cancelar</button>
    </div>
    <div class="swap-results" style="display:none;">
      <ul></ul>
    </div>
  `;

  row.after(li);

  const inpQ  = li.querySelector('.swap-q');
  const box   = li.querySelector('.swap-results');
  const ulRes = li.querySelector('.swap-results ul');
  const btnCanc = li.querySelector('.swap-cancelar');

  const doSearch = async () => {
    const q = (inpQ.value || '').trim();
    if (!q) { box.style.display = 'none'; ulRes.innerHTML = ''; return; }

    const resultados = await searchProdutosQuery(q, 30);
    ulRes.innerHTML = '';

    if (!resultados.length) {
      box.style.display = 'block';
      ulRes.innerHTML = `<li><div class="codigo">—</div><div class="descricao">Nenhum resultado.</div></li>`;
      return;
    }

    const tokens = tokenize(q);
    for (const it of resultados) {
      const liRes = document.createElement('li');
      const codHi = highlightTokens(escapeHtml(it.codigo||''), tokens);
      const desHi = highlightTokens(escapeHtml(it.descricao||''), tokens);
      liRes.innerHTML = `
        <div class="codigo">${codHi}</div>
        <div class="descricao" title="${escapeHtml(it.descricao||'')}">${desHi}</div>`;
      liRes.addEventListener('click', async () => {
        liRes.style.opacity = '.6';
        try {
          await trocarItemEstrutura({ pai_codigo: pai, de_codigo: codigoAntigo, para_codigo: it.codigo });
          // reload da estrutura do pai e fecha editor
          if (typeof window.loadEstruturaProduto === 'function') await window.loadEstruturaProduto(pai);
        } catch (e) {
          console.error('[Trocar] erro ao trocar:', e);
          alert('Falha ao trocar item na estrutura.');
          liRes.style.opacity = '1';
        }
      });
      ulRes.appendChild(liRes);
    }
    box.style.display = 'block';
  };

  const debounced = __debounceLocal(doSearch, 220);
  inpQ.addEventListener('input', debounced);
  btnCanc.addEventListener('click', () => li.remove());
  setTimeout(() => inpQ && inpQ.focus(), 0);
}

// ——— Busca unificada (usa funções do projeto se existirem; senão 1–2 endpoints) ———
async function searchProdutosQuery(query, limit = 30) {
  const q = String(query || '').trim();
  const tokens = tokenize(q.toLowerCase());

  // 1) Usa a Lista de produtos já carregada (DOM) ou tenta carregá-la
  const base = await ensureProdutosCacheFromLista();
  if (Array.isArray(base) && base.length) {
    let items = base;
    if (tokens.length) {
      items = items.filter(it => {
        const c = (it.codigo || '').toLowerCase();
        const d = (it.descricao || '').toLowerCase();
        return tokens.every(t => c.includes(t) || d.includes(t));
      });
    }
    return items.slice(0, limit);
  }

  // 2) Se você tem buscadores globais prontos, usa eles
  if (typeof window.buscarProdutos === 'function') {
    try {
      const r = await window.buscarProdutos({ query: q, q, descricao: q, codigo: q, limit });
      if (Array.isArray(r) && r.length) return normalizeProdutos(r).slice(0, limit);
    } catch {}
  }
  if (typeof window.searchProdutos === 'function') {
    try {
      const r = await window.searchProdutos({ query: q, q, descricao: q, codigo: q, limit });
      if (Array.isArray(r) && r.length) return normalizeProdutos(r).slice(0, limit);
    } catch {}
  }

  // 3) Último recurso: se sua Lista usa Omie, puxa um lote e filtra localmente (mantém seu fallback)
  try {
    if (typeof API_BASE !== 'undefined' && typeof OMIE_APP_KEY !== 'undefined') {
      const res = await fetch(`${API_BASE}/api/omie/produtos`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call:       'ListarProdutosResumido',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{ pagina: 1, registros_por_pagina: 500, filtrar_apenas_descricao: '' }]
        })
      });
      if (res.ok) {
        const j = await res.json();
        let arr = Array.isArray(j?.produto_servico_resumido) ? j.produto_servico_resumido
                 : (Array.isArray(j?.dados) ? j.dados
                 : (Array.isArray(j?.items) ? j.items : []));
        let items = normalizeProdutos(arr);
        if (tokens.length) {
          items = items.filter(it => {
            const c = (it.codigo || '').toLowerCase();
            const d = (it.descricao || '').toLowerCase();
            return tokens.every(t => c.includes(t) || d.includes(t));
          });
        }
        return items.slice(0, limit);
      }
    }
  } catch {}

  return [];
}


function normalizeProdutos(arr){
  return arr.map(x => ({
    codigo: x.codigo || x.cod || x.cod_produto || x.PRO_COD || x.id || '',
    descricao: x.descricao || x.nome || x.PRO_DES || x.desc || ''
  })).filter(x => x.codigo);
}

// ——— utils: tokens, highlight, debounce, escape ———
function tokenize(q){ return (q||'').trim().split(/\s+/).filter(Boolean); }
function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlightTokens(escapedText, tokens){
  if (!tokens.length) return escapedText;
  const pattern = tokens.map(t => escapeRegex(t)).join('|');
  return escapedText.replace(new RegExp(pattern, 'gi'), m => `<mark class="hi">${m}</mark>`);
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }


// UI: expand/collapse da sub-estrutura com “grupo visual” próprio
// - Adiciona uma linha-cabeçalho (child-group-header) antes das child-row
// - Remove header + filhos ao colapsar
// - Mantém grade/ações existentes
async function toggleEstruturaInline(row, codigo, root) {
  const ancestorPrefix = ((row.dataset.ancestor ? row.dataset.ancestor + '>' : '') + codigo);

  // 1) Se já estiver aberto: remove header + todas as child-row do mesmo ancestorPrefix
  {
    let it = row.nextElementSibling, removed = false;
    while (it && (it.classList.contains('child-row') || it.classList.contains('child-group-header'))) {
      const anc = it.dataset.ancestor || '';
      if (anc.startsWith(ancestorPrefix)) {
        const nxt = it.nextElementSibling;
        it.remove();
        it = nxt;
        removed = true;
        continue;
      }
      break;
    }
    if (removed) return; // colapsou
  }

  // 2) Carrega filhos do item clicado
  let dados = [];
  try {
    const r = await fetch('/api/pcp/estrutura?pai_codigo=' + encodeURIComponent(codigo), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const j = await r.json();
    dados = Array.isArray(j?.dados) ? j.dados : [];
  } catch (err) {
    console.error('[sub-estrutura] fetch', err);
  }
  if (!dados.length) return;

  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const parentPath = ancestorPrefix;

  // 3) Header visual do grupo (destaca que é a estrutura DO item clicado)
  const header = document.createElement('li');
  header.className = 'child-group-header';
  header.dataset.ancestor = parentPath;
  header.innerHTML = `
    <!-- Cabeçalho da sub-lista (ocupa a linha toda) -->
    <div class="child-group-title" title="Estrutura de ${esc(codigo)}">
      <span class="pip"></span>
      Estrutura de <strong>${esc(codigo)}</strong>
    </div>
  `;
  row.after(header);

  // 4) Linhas filhas (mesma grade, porém com estilo “child-row” diferenciado)
  let anchor = header;
  for (let idx = 0; idx < dados.length; idx++) {
    const d = dados[idx];
    const li2 = document.createElement('li');
    li2.className = 'child-row' + (idx === 0 ? ' child-first' : '') + (idx === dados.length - 1 ? ' child-last' : '');
    li2.dataset.comp = d.comp_codigo || '';
    li2.dataset.ancestor = parentPath;
    li2.innerHTML = `
      <div>${esc(d.comp_codigo || '')}</div>
      <div class="desc" title="${esc(d.comp_descricao || '')}">${esc(d.comp_descricao || '')}</div>
      <div>${Number(d.comp_qtd || 0)}</div>
      <div>${esc(d.comp_unid || '')}</div>
      <div>—</div>
      <div class="acoes">
        <!-- Trocar -->
        <button type="button" class="icon-btn" data-action="trocar" title="Trocar" aria-label="Trocar">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 7h10"></path><path d="M14 4l3 3-3 3"></path><path d="M17 17H7"></path><path d="M10 20l-3-3 3-3"></path></svg>
        </button>
        <!-- Abrir -->
        <button type="button" class="icon-btn" data-action="abrir" title="Abrir" aria-label="Abrir">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 3h7v7"></path><path d="M21 3L10 14"></path><path d="M5 7v12h12"></path></svg>
        </button>
        <!-- Estrutura (mostrada só se tiver filhos; JS já trata) -->
        <button type="button" class="icon-btn" data-action="estrutura" title="Estrutura" aria-label="Estrutura">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <circle cx="6"  cy="6"  r="2"></circle>
            <circle cx="18" cy="6"  r="2"></circle>
            <circle cx="18" cy="12" r="2"></circle>
            <circle cx="18" cy="18" r="2"></circle>
            <path d="M8 6h8"></path><path d="M8 6v12"></path>
            <path d="M14 12h4"></path><path d="M14 18h4"></path>
          </svg>
        </button>
      </div>`;
    anchor.after(li2);
    anchor = li2;
  }

  // 5) Reaplica a lógica que mostra o botão “Estrutura” só quando há filhos
  if (typeof window.markEstruturaButtons === 'function') {
    await window.markEstruturaButtons(root);
  }
}


// ——— Editor inline de Troca ———

// ——— Busca de produtos (adapta ao que você já tiver) ———
// ——— Chamada para TROCAR item na estrutura no backend ———
async function trocarItemEstrutura({ pai_codigo, de_codigo, para_codigo }) {
  if (!pai_codigo || !de_codigo || !para_codigo) throw new Error('Parâmetros incompletos');
  // 1) rota oficial (ajuste para a sua API!)
  const tries = [
    { url:'/api/pcp/estrutura/trocar',  method:'POST', body:{ pai_codigo, de_codigo, para_codigo } },
    // fallback comuns:
    { url:'/api/pcp/estrutura/replace', method:'POST', body:{ pai_codigo, de_codigo, para_codigo } },
    { url:'/api/pcp/estrutura/update',  method:'POST', body:{ pai_codigo, de_codigo, para_codigo } },
  ];
  for (const t of tries) {
    try {
      const r = await fetch(t.url, { method:t.method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(t.body) });
      if (!r.ok) continue;
      const j = await r.json();
      // sucesso se backend retornar {ok:true} ou similar; se não tiver, assume 200
      if (j?.ok === false) continue;
      return true;
    } catch {}
  }
  throw new Error('Nenhuma rota de troca respondeu com sucesso');
}




// ————————————————————————————————————————————————————————————————
// Mostra o botão "Estrutura" apenas onde há filhos (e deixa por último)
// ————————————————————————————————————————————————————————————————
const __hasChildrenCache = new Map(); // codigo -> boolean

async function fetchHasChildren(codigo) {
  if (__hasChildrenCache.has(codigo)) return __hasChildrenCache.get(codigo);
  try {
    const r = await fetch('/api/pcp/estrutura?pai_codigo=' + encodeURIComponent(codigo), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const j = await r.json();
    const has = Array.isArray(j?.dados) && j.dados.length > 0;
    __hasChildrenCache.set(codigo, has);
    return has;
  } catch {
    __hasChildrenCache.set(codigo, false);
    return false;
  }
}

async function markEstruturaButtons(containerEl) {
  const rows = Array.from(containerEl.querySelectorAll('li')).filter(li => !li.classList.contains('header-row'));
  const tasks = rows.map(async (li) => {
    const codigo = (li.dataset.comp || li.querySelector(':scope > div:first-child')?.textContent || '').trim();
    if (!codigo) return;
    const acoes = li.querySelector('.acoes');
    const btn = li.querySelector('.icon-btn[data-action="estrutura"]');
    if (!acoes || !btn) return;
    const has = await fetchHasChildren(codigo);

    if (has) {
      // garante que o botão Estrutura fica SEMPRE por último
      acoes.appendChild(btn);               // mover para o fim, se necessário
      btn.style.display = 'inline-flex';    // exibe
      btn.classList.remove('has-estrutura'); // (limpa estilos antigos se havia)
    } else {
      // oculta (ou remova, se preferir: btn.remove())
      btn.style.display = 'none';
    }
  });
  await Promise.allSettled(tasks);
}





// Disparo ao clicar na sub-aba “Estrutura de produto”

// Ligação robusta da sub-aba "Estrutura de produto"
(function wireEstruturaTab(){
  function bind(){
    const container = document.querySelector('#produtoTabs .main-header');
    if (!container) return false;
    if (container.__estruturaBound) return true;
    container.__estruturaBound = true;

    container.addEventListener('click', (ev) => {
      const link = ev.target.closest('.nav-card[data-target="estruturaProduto"]');
      if (!link) return;
      ev.preventDefault();

      // ativa visualmente a tab
      document.querySelectorAll('#produtoTabs .main-header .nav-card')
        .forEach(a => a.classList.remove('active'));
      link.classList.add('active');

      // mostra o pane correto
      document.querySelectorAll('#produtoTabs .tab-content .tab-pane')
        .forEach(p => p.style.display = 'none');
      const pane = document.getElementById('estruturaProduto');
      if (pane) pane.style.display = 'block';

      // carrega do SQL
      const titulo = document.getElementById('productTitle')?.textContent?.trim() || '';
      const cod = (window.codigoSelecionado || titulo || '').trim();
      if (typeof window.loadEstruturaProduto === 'function') {
        window.loadEstruturaProduto(cod);
      }
    }, true);

    return true;
  }

  if (!bind()){
    document.addEventListener('DOMContentLoaded', bind);
    const iv = setInterval(() => { if (bind()) clearInterval(iv); }, 300);
    setTimeout(() => clearInterval(iv), 5000);
  }
})();
;

// ===== VISIBILIDADE POR AUTENTICAÇÃO & PERMISSÕES =====

// CSS utilitário (1x)
(function ensureAuthCss(){
  if (document.getElementById('perm-hide-style')) return;
  const st = document.createElement('style');
  st.id = 'perm-hide-style';
  st.textContent = `.perm-hidden{display:none!important}`;
  document.head.appendChild(st);
})();

// O que pode ficar visível quando DESLOGADO
const PUBLIC_WHEN_LOGGED_OUT = [
  '#menu-inicio',          // Início no topo
  '#profile-icon',         // ícone usuário (abre login)
  '#btn-login','#user-button','#btn-user','#login-btn' // fallbacks, se existirem
];

// **TUDO** que é controlado por login/permissão
// Ajuste: botões dentro de .tab-header só serão controlados se tiverem a classe .perm-gated.
// Isso evita esconder ações como "Adicionar" em abas onde não há nó explícito de permissão.
const GATED_SELECTORS = [
  // topo (qualquer item com id #menu-*)
  'a[id^="menu-"]',
  '.header .header-menu > .menu-link',

  // abas internas (Produto, etc.)
  '#produtoTabs .main-header .main-header-link',
  '#kanbanTabs .main-header .main-header-link',
  '#armazemTabs .main-header .main-header-link',

  // lateral
  '.side-menu-item',
  '.left-side .side-menu a',
  '.sidebar a',
  '.menu-lateral a',

  // genéricos
  '.tab-header a',
  '.tab-header button.perm-gated',
  '[data-top]', '[data-menu]', '[data-submenu]'
].join(',');

function findGatedCandidates(){
  return document.querySelectorAll(GATED_SELECTORS);
}

// Deslogado: esconde tudo e mostra só Início + Login
function applyLoggedOutUI(){
  const gated = findGatedCandidates();
  gated.forEach(el => el.classList.add('perm-hidden'));
  PUBLIC_WHEN_LOGGED_OUT.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.classList.remove('perm-hidden'));
  });
}

// Logado: revela só o que a ÁRVORE permitir
async function applyCurrentUserPermissionsToUI(){
  // começa escondendo tudo
  const gated = findGatedCandidates();
  gated.forEach(el => el.classList.add('perm-hidden'));

  const me = window.__sessionUser;
  if (!me) { applyLoggedOutUI(); return; }

  const r = await fetch(`/api/users/${me.id}/permissions/tree`, { credentials:'include' });
  if (!r.ok) { applyLoggedOutUI(); return; }
  const data = await r.json();

  for (const n of data.nodes || []) {
    if (!n.selector) continue;
    document.querySelectorAll(n.selector).forEach(el => {
      el.classList.toggle('perm-hidden', !n.allowed);
    });
  }

  // Início sempre visível
  document.querySelectorAll('#menu-inicio').forEach(el => el.classList.remove('perm-hidden'));
}

// Checa auth no backend e aplica estado
async function ensureAuthVisibility(){
  try {
    // estado seguro imediato
    applyLoggedOutUI();

    const r  = await fetch('/api/auth/status', { credentials:'include' });
    const st = r.ok ? await r.json() : { loggedIn:false };
  window.__sessionUser = st.loggedIn ? st.user : null;
  console.log('[AUTH] window.__sessionUser atualizado:', window.__sessionUser);

    if (st.loggedIn) await applyCurrentUserPermissionsToUI();
    else             applyLoggedOutUI();
  } catch {
    applyLoggedOutUI();
  }
}

// ====== AUTODESCoberta de navegação + sync ======
function _navComputeSelector(el) {
  // Preferimos um seletor estável pelo próprio data-nav-key
  const key = el.dataset.navKey;
  if (key) return `[data-nav-key="${key}"]`;
  // fallback: id
  if (el.id) return `#${el.id}`;
  return null; // sem selector -> só aparece na lista, não oculta nada na UI
}

function collectNavNodesFromDOM() {
  const els = document.querySelectorAll('[data-nav-key]');
  const nodes = [];
  els.forEach(el => {
    const key   = el.dataset.navKey;
    const label = el.dataset.navLabel?.trim() || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const pos   = (el.dataset.navPos || '').toLowerCase() === 'top' ? 'top' : 'side';
    const parentKey = el.dataset.navParent || null;
    const sort  = Number(el.dataset.navSort || 0) || 0;
    const selector = el.dataset.navSelector || _navComputeSelector(el);
    if (key && label && pos) {
      nodes.push({ key, label, position: pos, parentKey, sort, selector });
    }
  });
  return nodes;
}

// === SINCRONIZAÇÃO DE NÓS DE NAVEGAÇÃO COM O SQL ===
// ====== NAV SYNC (com cache) ======
window.__navSync = window.__navSync || { running:false, last:0 };

// chama o /api/nav/sync somente se logado e só a cada N ms
window.syncNavNodes = async function(force = false) {
  try {
    if (!window.__sessionUser) return; // precisa estar logado
    if (window.__navSync.running) return;
    const now = Date.now();
    if (!force && now - window.__navSync.last < 60_000) return; // 1 min de cache

    window.__navSync.running = true;

    // coleta os nós do DOM
    const els = document.querySelectorAll('[data-nav-key]');
    const nodes = [];
    els.forEach(el => {
      const key       = el.dataset.navKey;
      const label     = el.dataset.navLabel?.trim() || (el.textContent || '').trim().replace(/\s+/g,' ').slice(0,60);
      const position  = (el.dataset.navPos || '').toLowerCase() === 'top' ? 'top' : 'side';
      const parentKey = el.dataset.navParent || null;
      const sort      = Number(el.dataset.navSort || 0) || 0;
      const selector  = el.dataset.navSelector || null;
      if (key && label && position) nodes.push({ key, label, position, parentKey, sort, selector });
    });
    if (!nodes.length) { window.__navSync.running = false; return; }

    const r = await fetch('/api/nav/sync', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify({ nodes })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      console.warn('[nav-sync]', r.status, e);
    } else {
      window.__navSync.last = Date.now();
    }
  } catch (e) {
    console.warn('[nav-sync] falhou', e);
  } finally {
    window.__navSync.running = false;
  }
};


// helper que só chama se passou o cache
window.maybeSyncNavNodes = function() {
  return window.syncNavNodes(false); // respeita o cache
};

window.addEventListener('auth:changed', () => {
  if (!window.__sessionUser) {
    if (userNameDisplay) userNameDisplay.textContent = '';
  } else {
    if (userNameDisplay) {
      userNameDisplay.textContent =
        window.__sessionUser.nome || window.__sessionUser.username || '';
    }
  }
});



// depois do login ok:
window.dispatchEvent(new Event('auth:changed'));

// lifecycle
document.addEventListener('DOMContentLoaded', () => {
  applyLoggedOutUI();
  ensureAuthVisibility();
});

// reapply quando login/logout ou permissões mudarem
window.addEventListener('auth:changed', ensureAuthVisibility);

// após login/logout, sincroniza nós (se logado)
window.addEventListener('auth:changed', async () => {
  if (window.__sessionUser) {
    try { await window.syncNavNodes?.(); } catch {}
  }
});

// === Bind global para botão de deslogar (fora do modal de login) ===
(function bindLogoutButton(){
  async function doLogout(e) {
    e?.preventDefault();
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {}

    // limpa sessão local
    window.__sessionUser = null;
    localStorage.removeItem('user');
    localStorage.removeItem('password');

    // dispara evento para toda a UI se atualizar
    window.dispatchEvent(new Event('auth:changed'));
  }

  // tenta ligar ao carregar
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('#btn-logout, [data-logout]');
    if (btn) btn.addEventListener('click', doLogout);
  });
})();

window.applyCurrentUserPermissionsToUI = applyCurrentUserPermissionsToUI;

// ——— Importar Estrutura: botão (apenas gancho por enquanto) ———
(function wireEstruturaImportButtonOnce(){
  const btn = document.getElementById('btnImportarEstrutura');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    console.log('[Estrutura] Importar estrutura de produto — clique');
    // Próximo passo: abrir modal/upload/colagem JSON/clonar/OMIE...
  });
})();

// Fallback se o DOM ainda não estiver pronto quando este arquivo carregar:
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnImportarEstrutura');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        console.log('[Estrutura] Importar estrutura de produto — clique');
      });
    }
  });
}

// Formata a quantidade EXATAMENTE como pedido: "0.002000" → "0,002"
function fmtQtdBR(v) {
  if (v === null || v === undefined || v === '') return '';
  // aceita number ou string ("0.002000" / "0,002000")
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  // até 6 casas (compatível com numeric(20,6)), tirando zeros à direita
  let s = n.toFixed(6).replace(/\.?0+$/, '');
  if (s === '') s = '0';
  return s.replace('.', ',');
}

// ——— Exportar Estrutura no layout "Listagem dos Materiais (B.O.M.)" (CSV) ———
// Inclui a coluna "Operação" a partir de it.comp_operacao
function exportarEstruturaAtualCSV_BOM(){
  (async () => {
    const codigo = (window.codigoSelecionado || window.ultimoCodigo || '').trim();
    if (!codigo) { alert('Não consegui identificar o código do produto aberto.'); return; }

    const btn = document.getElementById('btnExportarEstrutura');
    const prevDisabled = btn?.disabled;
    if (btn) btn.disabled = true;

    try {
      const resp = await fetch(`${API_BASE}/api/pcp/estrutura?pai_codigo=${encodeURIComponent(codigo)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const json = await resp.json();
      if (!json || json.ok !== true) throw new Error(json?.error || 'Falha ao buscar estrutura no SQL.');
      const itens = Array.isArray(json.dados) ? json.dados : [];

      // Cabeçalho EXATO (10 colunas) — mantém seu layout B.O.M.
      const HEADERS = [
        'Identificação do Produto',
        'Descrição do Produto',
        'Tipo do Produto',
        'Operação',
        'Qtde Prevista',
        'Unidade',
        'Qtde Cúbica',
        'Custo Unitário',
        'Custo Total',
        'Ficha'
      ];

      // helpers de CSV ; com aspas
      const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
      // número sem milhar e com vírgula decimal
      const fmtNum = v => {
        if (v === null || v === undefined || v === '') return '';
        const n = Number(String(v).replace(/\./g,'').replace(',', '.'));
        if (!Number.isFinite(n)) return '';
        const s = String(n);
        return s.replace('.', ',');
      };

      // ⬇️ AQUI está a mudança: quarta coluna agora recebe it.comp_operacao
      const rows = itens.map(it => ([
        it?.comp_descricao ?? '',        // Identificação do Produto
        it?.comp_codigo ?? '',           // Descrição do Produto
        '',                              // Tipo do Produto (sem fonte no SQL)
        it?.comp_operacao ?? '',         // Operação  ← NOVO (preenchido)
        fmtQtdBR(it.comp_qtd),   //  ← Qtde Prevista no formato "0,002"
        it?.comp_unid ?? '',             // Unidade
        '',                              // Qtde Cúbica
        '',                              // Custo Unitário
        '',                              // Custo Total
        ''                               // Ficha
      ]));

      const csv =
        [HEADERS.map(esc).join(';')]
        .concat(rows.map(cols => cols.map(esc).join(';')))
        .join('\r\n');

      // BOM ajuda Excel PT-BR a reconhecer UTF-8
      const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `BOM_${codigo}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Exportar BOM CSV] erro:', err);
      alert('Erro ao exportar a BOM: ' + err.message);
    } finally {
      if (btn) btn.disabled = prevDisabled;
    }
  })();
}


// ——— Religa o botão Exportar para usar CSV ———
(function wireExportBOM(){
  const btn = document.getElementById('btnExportarEstrutura');
  if (!btn) return;
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);
  clone.addEventListener('click', exportarEstruturaAtualCSV_BOM);
})();

// ---------------------------------------------------------------------------
// PÓS-EXCLUSÃO: ATUALIZAR (quant/unidade) O QUE SOBROU + INCLUIR NOVOS
//   • Consulta a OMIE após as exclusões.
//   • Compara cada item remanescente com o CSV:
//       - Se mudar quantidade (quantProdMalha) ou unidade (unidProdMalha) → AlterarEstrutura
//   • Inclui itens do CSV que não estão na OMIE → IncluirEstrutura
//   • Não mexe em SQL aqui.
// ---------------------------------------------------------------------------
async function atualizarEIncluirEstruturaOmie(paiCodigo, itensCsv) {
  // helper local (igual ao usado na etapa excluir)
  async function omieMalhaCall(call, param) {
    const resp = await fetch(`${API_BASE}/api/omie/malha/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ call, param })
    });
    const raw = await resp.text();
    let js; try { js = JSON.parse(raw); } catch { js = { raw }; }
    if (!resp.ok || js?.faultstring) {
      throw new Error(js?.faultstring || `HTTP ${resp.status} em ${call}`);
    }
    return js;
  }

  // resolve idProduto (PREFERIR tela → fallback SQL)
  async function resolveIdProduto(paiCodigo) {
    const tryNum = s => /^\d{6,14}$/.test(String(s||'').trim()) ? Number(String(s).trim()) : null;

    // tenta achar na UI (campo "Código OMIE")
    const labelNodes = Array.from(document.querySelectorAll('.products'))
      .filter(el => /c[óo]digo\s+omie/i.test(el.textContent || ''));
    for (const lb of labelNodes) {
      const scope = lb.closest('li, .row, .wrap, .side-menu, .card, div') || lb.parentElement;
      if (!scope) continue;
      for (const el of scope.querySelectorAll('.status-text, .value, span, div')) {
        const n = tryNum(el.textContent);
        if (n) return n;
      }
    }
    // fallback global
    const any = Array.from(document.querySelectorAll('.status-text, .value, span, div'))
      .map(el => tryNum(el.textContent)).find(Boolean);
    if (any) return any;

    // último fallback: rota SQL já existente
    const r = await fetch(`${API_BASE}/api/sql/produto-id/${encodeURIComponent(paiCodigo)}`);
    if (r.ok) {
      const js = await r.json();
      return Number(js?.codigo_produto || 0) || null;
    }
    return null;
  }

  // resolve id do componente (idProdMalha) a partir do código (coluna "codigo")
  async function resolveIdProdMalha_noSQL(codigoComp) {
    try {
      const r = await fetch(`${API_BASE}/api/sql/produto-id/${encodeURIComponent(codigoComp)}`);
      if (!r.ok) return null;
      const js = await r.json();
      return Number(js?.codigo_produto || 0) || null;
    } catch { return null; }
  }

  // normaliza CSV: consolida por código (soma quantidades) e padroniza unidade
  const somaPorCod = new Map();
  for (const it of (Array.isArray(itensCsv) ? itensCsv : [])) {
    const cod = String(it?.comp_codigo || '').trim();
    const qt  = Number(it?.comp_qtd ?? 0) || 0;
    const un  = String(it?.comp_unid || '').trim().toUpperCase();
    if (!cod || qt <= 0) continue;
    const acc = somaPorCod.get(cod) || { qt:0, unid: un };
    acc.qt += qt;
    // se vier unidade divergente em linhas distintas, prevalece a última não-vazia
    if (un) acc.unid = un;
    somaPorCod.set(cod, acc);
  }

  // idProduto pai
  const idProduto = await resolveIdProduto(paiCodigo);
  if (!idProduto) throw new Error(`idProduto OMIE não encontrado para ${paiCodigo}.`);

  // consulta OMIE pós-exclusão
  let consult;
  try {
    consult = await omieMalhaCall('ConsultarEstrutura', [{ idProduto }]);
  } catch (e) {
    // 103 = sem estrutura → nada a atualizar; somente incluir tudo
    if (!String(e?.message||'').includes('103')) throw e;
    consult = { itens: [] };
  }

  const existentes = Array.isArray(consult?.itens) ? consult.itens
                    : Array.isArray(consult?.itensEstrutura) ? consult.itensEstrutura
                    : Array.isArray(consult?.itensMalha) ? consult.itensMalha
                    : [];

  // mapeia existentes por código (codProdMalha/intMalha)
  const mapOmie = new Map();
  for (const ex of existentes) {
    const cod = String(ex?.codProdMalha || ex?.intMalha || '').trim();
    if (!cod) continue;
    mapOmie.set(cod, {
      idMalha      : ex?.idMalha || null,
      idProdMalha  : ex?.idProdMalha || null,
      intMalha     : String(ex?.intMalha || cod).trim(),
      quant        : Number(ex?.quantProdMalha || 0) || 0,
      unid         : String(ex?.unidProdMalha || '').trim().toUpperCase()
    });
  }

  const paraAlterar = []; // { intMalha, idProdMalha, quantProdMalha, unidProdMalha?, percPerdaProdMalha?, obsProdMalha? }
  const paraIncluir = []; // { intMalha, idProdMalha, quantProdMalha, percPerdaProdMalha, obsProdMalha }

  // compara e decide ALTERAR/INCLUIR
  for (const [cod, csv] of somaPorCod.entries()) {
    const ex = mapOmie.get(cod);
    if (ex) {
      const needQt  = Math.abs((ex.quant || 0) - (csv.qt || 0)) > 1e-9;
      const needUn  = (String(ex.unid||'') !== String(csv.unid||''));
      if (needQt || needUn) {
        let idProdMalha = ex.idProdMalha;
        if (!idProdMalha) idProdMalha = await resolveIdProdMalha_noSQL(cod);
        if (!idProdMalha) {
          console.warn(`[ATUALIZAR] ${cod}: sem idProdMalha — pulando AlterarEstrutura.`);
          continue;
        }
        const item = {
          intMalha: ex.intMalha || cod,
          idProdMalha,
          quantProdMalha: csv.qt
        };
        if (needUn && csv.unid) item.unidProdMalha = csv.unid; // só manda se mudar
        paraAlterar.push(item);
      }
    } else {
      // novo → incluir
      const idProdMalha = await resolveIdProdMalha_noSQL(cod);
      if (!idProdMalha) {
        console.warn(`[INCLUIR] ${cod}: sem idProdMalha no SQL — pulando inclusão.`);
        continue;
      }
      paraIncluir.push({
        intMalha: cod,
        idProdMalha,
        quantProdMalha: csv.qt,
        percPerdaProdMalha: 0,
        obsProdMalha: ''
      });
    }
  }

  // aplica AlterarEstrutura em lotes de 40
  const CHUNK = 40;
  async function chunkDo(arr, n, fn) {
    for (let i = 0; i < arr.length; i += n) {
      const lote = arr.slice(i, i+n);
      await fn(lote);
      await new Promise(r => setTimeout(r, 350)); // ~3/s
    }
  }

  let alterados = 0, incluidos = 0;

  if (paraAlterar.length) {
    await chunkDo(paraAlterar, CHUNK, async (lote) => {
      await omieMalhaCall('AlterarEstrutura', [{ idProduto, itemMalhaAlterar: lote }]);
      alterados += lote.length;
    });
  }

  if (paraIncluir.length) {
    await chunkDo(paraIncluir, CHUNK, async (lote) => {
      await omieMalhaCall('IncluirEstrutura', [{ idProduto, itemMalhaIncluir: lote }]);
      incluidos += lote.length;
    });
  }

  return { alterados, incluidos, existentesAntes: existentes.length };
}

// ---------------------------------------------------------------------------
// EXCLUIR APENAS OS ITENS QUE NÃO ESTÃO NO CSV (OMIE → ExcluirEstrutura)
// Fluxo: pega idProduto (tela > SQL fallback) → ConsultarEstrutura →
// compara codProdMalha com a 2ª coluna do CSV (comp_codigo) → ExcluirEstrutura.
// NÃO inclui / NÃO altera / NÃO mexe em SQL.
// ---------------------------------------------------------------------------
async function excluirExcedentesEstruturaOmie(paiCodigo, itensCsv) {
  // 1) Descobrir idProduto: preferir a UI ("Código OMIE"), senão SQL
  const idFromUI = (() => {
    const tryNum = (t) => {
      const s = String(t || '').trim();
      return /^\d{6,14}$/.test(s) ? Number(s) : null;
    };

    // varre labels "Código OMIE" e procura um .status-text com número ao lado
    const labels = Array.from(document.querySelectorAll('.products'))
      .filter(el => /c[óo]digo\s+omie/i.test(el.textContent || ''));

    for (const lb of labels) {
      const scope = lb.closest('li, .row, .wrap, .side-menu, .card, div') || lb.parentElement;
      if (!scope) continue;
      const candidates = scope.querySelectorAll('.status-text, .value, span, div');
      for (const el of candidates) {
        const n = tryNum(el.textContent);
        if (n) return n;
      }
    }
    // fallback global (qualquer status-text com número)
    const anyNum = Array.from(document.querySelectorAll('.status-text, .value, span, div'))
      .map(el => tryNum(el.textContent)).find(Boolean);
    return anyNum || null;
  })();

  let idProduto = idFromUI;
  if (!idProduto) {
    // fallback via SQL (sua rota já existente)
    const r = await fetch(`${API_BASE}/api/sql/produto-id/${encodeURIComponent(paiCodigo)}`);
    if (r.ok) {
      const js = await r.json();
      idProduto = Number(js?.codigo_produto || 0) || null;
    }
  }
  if (!idProduto) {
    throw new Error(`idProduto OMIE não encontrado para ${paiCodigo} (tela/SQL).`);
  }

  // 2) Helper para chamar OMIE pelo novo proxy do backend (sem passar no SQL)
  async function omieMalhaCall(call, param) {
    const resp = await fetch(`${API_BASE}/api/omie/malha/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ call, param })
    });
    const raw = await resp.text();
    let js; try { js = JSON.parse(raw); } catch { js = { raw }; }
    if (!resp.ok || js?.faultstring) {
      throw new Error(js?.faultstring || `HTTP ${resp.status} em ${call}`);
    }
    return js;
  }

  // 3) Consultar estrutura atual na OMIE
  let consult;
  try {
    consult = await omieMalhaCall('ConsultarEstrutura', [{ idProduto }]);
  } catch (e) {
    // Fault 103 (produto sem estrutura) = não há nada para excluir
    if (String(e?.message || '').includes('103')) {
      return { deletados: 0, total_existentes: 0 };
    }
    throw e;
  }

  // 4) Normaliza lista de itens existentes na OMIE
  const itensOmie = Array.isArray(consult?.itens) ? consult.itens
                   : Array.isArray(consult?.itensEstrutura) ? consult.itensEstrutura
                   : Array.isArray(consult?.itensMalha) ? consult.itensMalha
                   : [];

  // códigos vindos do CSV (2ª coluna) — no seu parser, está em comp_codigo
  const codsCsv = new Set(
    (itensCsv || [])
      .map(it => String(it?.comp_codigo || it?.codigo || it?.cod || '').trim())
      .filter(Boolean)
  );

  let deletados = 0;

  // 5) Para cada item da OMIE que NÃO está no CSV: ExcluirEstrutura
  for (const ex of itensOmie) {
    // tenta ler o "código do componente" de formas comuns
    const cod =
      String(
        ex?.codProdMalha ||
        ex?.intProdMalha?.cCodigo ||
        ex?.codProduto ||
        ex?.codigo ||
        ''
      ).trim();

    const idMalha = ex?.idMalha || ex?.nIdMalha || ex?.id_item_malha || null;

    if (!cod || !idMalha) continue;
    if (!codsCsv.has(cod)) {
      // exclusão 1 a 1; dá um pequeno respiro pra evitar rate-limit
      await omieMalhaCall('ExcluirEstrutura', [{ idProduto, idMalha }]);
      deletados++;
      await new Promise(r => setTimeout(r, 350)); // ~3/s
    }
  }

  return { deletados, total_existentes: itensOmie.length };
}



// ——— Importar Estrutura (apenas CSV no layout B.O.M.) ———
(function wireImportBOM(){
  const btn = document.getElementById('btnImportarEstrutura');
  if (!btn) return;

  // evita múltiplos handlers caso este bloco rode mais de uma vez
  if (!btn.dataset.boundImportBOM) {
    btn.dataset.boundImportBOM = '1';
  }

  // cria (ou reaproveita) input oculto
  let fileInput = document.getElementById('fileImportBOMcsv');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'fileImportBOMcsv';
    fileInput.accept = '.csv';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }

  // abre seletor de arquivo
  btn.addEventListener('click', () => fileInput.click(), { passive: true });

  // ——— helpers ———
  function parseCSV(text, sep = ';') {
    const out = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i+1];
      if (inQuotes) {
        if (ch === '"') {
          if (next === '"') { cell += '"'; i++; } // aspas escapada ""
          else { inQuotes = false; }
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === sep) { row.push(cell); cell=''; }
        else if (ch === '\n') { row.push(cell); out.push(row); row=[]; cell=''; }
        else if (ch === '\r') { /* ignora CR */ }
        else { cell += ch; }
      }
    }
    row.push(cell); out.push(row);
    while (out.length && out[out.length-1].every(c => String(c).trim()==='')) out.pop();
    return out;
  }

  const normHeader = s => String(s ?? '')
    .replace(/[\u00A0\s]+/g, ' ')   // NBSP + múltiplos espaços → 1 espaço
    .trim()
    .toLowerCase();

  const EXPECT = [
    'identificação do produto',
    'descrição do produto',
    'tipo do produto',
    'operação',
    'qtde prevista',
    'unidade',
    'qtde cúbica',
    'custo unitário',
    'custo total',
    'ficha'
  ];

  const toNum = v => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/\./g,'').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const trim = v => String(v ?? '').trim();

  // evita duplicar o listener se este bloco rodar novamente
  if (fileInput.dataset.bound) return;
  fileInput.dataset.bound = '1';

fileInput.addEventListener('change', async () => {
  // sempre permitir reanexar o mesmo arquivo
  try {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    // 🔄 spinner ON assim que o usuário anexa o CSV
    showEstruturaSpinner();


    const codigo = (window.codigoSelecionado || window.ultimoCodigo || '').trim();
    if (!codigo) {
      console.warn('[Importar BOM CSV] Código do produto não identificado na tela.');
      return;
    }

    const text = await file.text();

    // tenta ;, se não, tenta ,
    let rows = parseCSV(text, ';');
    if (rows.length <= 1 || rows[0].length < 4) rows = parseCSV(text, ',');
    if (!rows || !rows.length) throw new Error('Arquivo CSV vazio.');

    const headerRaw = rows[0].map(h => h.replace(/^"|"$/g,''));
    const header    = headerRaw.map(normHeader);

    // mapeia cabeçalhos esperados → índice
    const idx = {};
    EXPECT.forEach(h => { idx[h] = header.indexOf(h); });

    // valida colunas mínimas
    const req = ['identificação do produto','descrição do produto','qtde prevista','unidade'];
    const missing = req.filter(h => idx[h] === -1);
    if (missing.length) {
      console.warn('[Import CSV] Cabeçalho detectado:', headerRaw);
      throw new Error('Cabeçalho do CSV não confere. Faltando: ' + missing.join(', '));
    }

    // converte linhas do CSV
    const itens = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const get = (h) => {
        const j = idx[h];
        return j >= 0 ? String(cols[j] ?? '').trim() : '';
      };

      const comp_descricao = get('identificação do produto');
      const comp_codigo    = get('descrição do produto');
      const comp_unid      = get('unidade');
      const comp_qtd       = toNum(get('qtde prevista'));
      const comp_operacao  = get('operação');

      // ignora linha totalmente vazia
      if (!comp_descricao && !comp_codigo && !comp_unid && (comp_qtd == null) && !comp_operacao) continue;

      itens.push({
        comp_codigo,
        comp_descricao,
        comp_unid,
        comp_qtd,
        comp_operacao,
        comp_tipo: null,
        comp_perda_pct: null,
        comp_qtd_bruta: null
      });
    }

    if (itens.length) console.debug('[Import CSV] amostra do primeiro item:', itens[0]);

    // ⚙️ OMIE: Excluir → Atualizar → Incluir (sem alert/return)
    console.group('[ImportarBOM] OMIE — Excluir/Atualizar/Incluir');
    try {
      try {
        const r1 = await excluirExcedentesEstruturaOmie(codigo, itens);
        console.log(`[ImportarBOM] OMIE Excluir → deletados=${r1?.deletados || 0} de ${r1?.total_existentes || 0}`);
      } catch (e) {
        console.error('[ImportarBOM] OMIE Excluir falhou (segue fluxo):', e);
      }

      try {
        const r2 = await atualizarEIncluirEstruturaOmie(codigo, itens);
        console.log(`[ImportarBOM] OMIE Atualizar/Incluir → alterados=${r2?.alterados || 0} | incluidos=${r2?.incluidos || 0}`);
      } catch (e) {
        console.error('[ImportarBOM] OMIE Atualizar/Incluir falhou (segue fluxo):', e);
      }
    } finally {
      console.groupEnd();
    }

    // 🗄️ SQL: replace normal (sem pop-up de sucesso)
    const base = (window.API_BASE || '');
    const url  = `${base}/api/pcp/estrutura/replace`.replace(/([^:]\/)\/+/g, '$1');
    const user = getLoggedUserName();
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-user': user
      },
      body: JSON.stringify({ pai_codigo: codigo, itens })
    });

    // leitura tolerante a HTML
    const raw = await resp.text();
    let js; try { js = JSON.parse(raw); } catch { js = { raw }; }

    if (!resp.ok || js?.error) {
      console.error('[Importar BOM CSV] Erro JSON recebido da API:', js);
      throw new Error(js?.error || `Falha HTTP ${resp.status}`);
    }

    // refresh da UI sem alert
    if (typeof window.loadEstruturaProduto === 'function') {
      window.loadEstruturaProduto(codigo);
    }
    console.info(`[ImportarBOM] Concluído para ${codigo}. Linhas CSV: ${itens.length}`);

    // Recarrega meta para atualizar Versão/Atualizado por na UI
    try {
      const meta = await pcpFetchEstruturaMetaByCod(codigo);
      pcpUpdateVersaoBadges(meta);
    } catch (e) {
      console.warn('Falha ao atualizar meta após import:', e);
    }

  } catch (err) {
    console.error('[Importar BOM CSV] erro:', err);
  } finally {
    // 🔄 spinner OFF (sempre)
    hideEstruturaSpinner();

  }
});

})();

async function importarBOMCSV_normalizado(paiCodigo, itensNormalizados) {
  const user = getLoggedUserName();
  const resp = await fetch(`${API_BASE}/api/pcp/estrutura/replace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user': user
    },
    body: JSON.stringify({ pai_codigo: paiCodigo, itens: itensNormalizados }),
  });

  // leitura tolerante a HTML (erros 404/500 que voltam com <html>)
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const txt = await resp.text();
    const snippet = txt.slice(0, 300);
    console.error('[Importar BOM CSV] Resposta NÃO-JSON da API', { status: resp.status, statusText: resp.statusText, url: resp.url, body_snippet: snippet });
    throw new Error(`A API respondeu ${resp.status} (${resp.statusText}). Veja o console para detalhes.`);
  }

  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || 'Falha ao importar.');
  return data;
}

// Cache compartilhado de produtos (codigo / descricao)
window.__PRODUTOS_CACHE = window.__PRODUTOS_CACHE || [];

// Tira produtos já renderizados na aba "Lista de produtos"
function collectProdutosFromListaDOM() {
  const ul = document.getElementById('listaProdutosList');
  if (!ul) return [];
  const out = [];
  // Tenta data-attrs; se não houver, lê as 2 primeiras colunas (divs)
  ul.querySelectorAll('li').forEach(li => {
    let codigo = li.getAttribute('data-codigo');
    let descricao = li.getAttribute('data-descricao');
    if (!codigo)   codigo   = li.querySelector(':scope > div:nth-child(1)')?.textContent;
    if (!descricao) descricao = li.querySelector(':scope > div:nth-child(2)')?.textContent;
    codigo = (codigo || '').trim();
    descricao = (descricao || '').trim();
    if (codigo) out.push({ codigo, descricao });
  });
  return out;
}

// Garante que o cache está carregado a partir da Lista de produtos.
// Se existir uma função oficial da sua lista (ex.: window.loadListaProdutos),
// tentamos chamá-la silenciosamente antes de ler o DOM.
async function ensureProdutosCacheFromLista() {
  if (Array.isArray(window.__PRODUTOS_CACHE) && window.__PRODUTOS_CACHE.length) return window.__PRODUTOS_CACHE;

  // tenta chamar a função oficial da Lista (se existir)
  if (typeof window.loadListaProdutos === 'function') {
    try { await window.loadListaProdutos({ silent: true }); } catch {}
  }

  const items = collectProdutosFromListaDOM();
  if (items.length) window.__PRODUTOS_CACHE = items;
  return window.__PRODUTOS_CACHE;
}

// ========================================
// FUNÇÕES PARA GERENCIAR A ABA RI
// ========================================

// Variável global para armazenar o código e id_omie do produto atual
window.produtoRIAtual = {
  codigo: null,
  id_omie: null
};

// Cache de operações
let operacoesCache = null;

// Carregar operações disponíveis
async function carregarOperacoes() {
  if (operacoesCache) return operacoesCache;
  
  try {
    const response = await fetch(`${API_BASE}/api/ri/operacoes`);
    if (!response.ok) throw new Error('Erro ao carregar operações');
    operacoesCache = await response.json();
    return operacoesCache;
  } catch (error) {
    console.error('Erro ao carregar operações:', error);
    return [];
  }
}

// Gerar options do select de operações
function gerarOptionsOperacoes(operacoes, valorSelecionado = '') {
  return `
    <option value="">Selecione...</option>
    ${operacoes.map(op => `<option value="${op}" ${op === valorSelecionado ? 'selected' : ''}>${op}</option>`).join('')}
  `;
}

// Carregar itens RI do produto
async function carregarItensRI(idOmie) {
  try {
    const response = await fetch(`${API_BASE}/api/ri/${idOmie}`);
    if (!response.ok) throw new Error('Erro ao carregar itens RI');
    const itens = await response.json();
    renderizarTabelaRI(itens);
  } catch (error) {
    console.error('Erro ao carregar RI:', error);
    alert('Erro ao carregar itens de RI');
  }
}

// Renderizar tabela RI
function renderizarTabelaRI(itens) {
  const tbody = document.getElementById('tabelaRIBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (!itens || itens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color: var(--content-color);">Nenhum item de verificação cadastrado</td></tr>';
    return;
  }
  
  itens.forEach(item => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    
    const fotoHtml = item.foto_url 
      ? `<img src="${item.foto_url}" style="max-width:80px; max-height:60px; cursor:pointer;" onclick="window.open('${item.foto_url}', '_blank')" />`
      : '<span style="color:#999;">Sem foto</span>';    tr.innerHTML = `
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.codigo || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.item_verificado || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.o_que_verificar || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.local_verificacao || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.prioridade || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">${fotoHtml}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
        <button class="btn-editar-ri" data-id="${item.id}" title="Editar" style="background:none; border:none; color:var(--button-bg); cursor:pointer; margin-right:8px;">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="btn-excluir-ri" data-id="${item.id}" title="Excluir" style="background:none; border:none; color:#e74c3c; cursor:pointer;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  // Adicionar eventos aos botões
  document.querySelectorAll('.btn-editar-ri').forEach(btn => {
    btn.addEventListener('click', () => editarItemRI(btn.dataset.id));
  });
  
  document.querySelectorAll('.btn-excluir-ri').forEach(btn => {
    btn.addEventListener('click', () => excluirItemRI(btn.dataset.id));
  });
}

// Adicionar nova linha para inserção
async function adicionarNovaLinhaRI() {
  const tbody = document.getElementById('tabelaRIBody');
  if (!tbody) return;
  
  // Verificar se já existe uma linha de edição
  if (tbody.querySelector('.linha-edicao-ri')) {
    alert('Finalize a edição atual antes de adicionar um novo item');
    return;
  }
  
  // Usar Código OMIE global (armazenado ao carregar produto)
  const codigoOmie = window.codigoOmieSelecionado;
  const codigo = window.codigoSelecionado;
  
  if (!codigoOmie) {
    alert('Selecione um produto primeiro ou aguarde o carregamento do Código OMIE');
    return;
  }
  
  // Atualiza produtoRIAtual com Código OMIE
  window.produtoRIAtual = {
    codigo: codigo,
    id_omie: codigoOmie
  };
  
  const { id_omie } = window.produtoRIAtual;
  
  // Carregar operações
  const operacoes = await carregarOperacoes();
  
  const tr = document.createElement('tr');
  tr.className = 'linha-edicao-ri';
  tr.style.borderBottom = '1px solid var(--border-color)';
  tr.style.backgroundColor = 'var(--content-bg)';
  tr.innerHTML = `
    <td style="padding: 10px; border: 1px solid var(--border-color);">${codigo}</td>
    <td style="padding: 10px; border: 1px solid var(--border-color);">
      <input type="text" id="riItemVerificado" placeholder="Item verificado" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color);">
      <input type="text" id="riOQueVerificar" placeholder="O que verificar" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color);">
      <select id="riLocalVerificacao" style="width:100%; padding:6px; border:1px solid var(--border-color); background:#fff; color:#000;">
        ${gerarOptionsOperacoes(operacoes)}
      </select>
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color);">
      <select id="riPrioridade" style="width:100%; padding:6px; border:1px solid var(--border-color); background:#fff; color:#000;">
        <option value="">Selecione...</option>
        <option value="Primario">Primário</option>
        <option value="Secundario">Secundário</option>
      </select>
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
      <input type="file" id="riFotoInput" accept="image/*" style="display:none;" />
      <div id="riFotoPreview" style="margin-bottom:8px;"></div>
      <button id="btnAnexarFotoRI" class="btn btn-secondary" style="font-size:0.9rem;">
        <i class="fa-solid fa-camera"></i> Foto
      </button>
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
      <button id="btnSalvarRI" class="btn btn-primary" style="margin-right:8px;">
        <i class="fa-solid fa-check"></i> Salvar
      </button>
      <button id="btnCancelarRI" class="btn btn-danger">
        <i class="fa-solid fa-times"></i> Cancelar
      </button>
    </td>
  `;
  
  tbody.insertBefore(tr, tbody.firstChild);
  
  // Eventos do upload de foto
  const fotoInput = document.getElementById('riFotoInput');
  const btnAnexarFoto = document.getElementById('btnAnexarFotoRI');
  const fotoPreview = document.getElementById('riFotoPreview');
  
  btnAnexarFoto.addEventListener('click', () => fotoInput.click());
  fotoInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        fotoPreview.innerHTML = `<img src="${ev.target.result}" style="max-width:80px; max-height:60px;" />`;
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });
  
  // Eventos dos botões
  document.getElementById('btnSalvarRI').addEventListener('click', salvarNovoItemRI);
  document.getElementById('btnCancelarRI').addEventListener('click', () => {
    tr.remove();
    // Se não houver mais itens, mostrar mensagem
    if (tbody.children.length === 0) {
      renderizarTabelaRI([]);
    }
  });
  
  // Focar no primeiro campo
  document.getElementById('riItemVerificado').focus();
}

// Salvar novo item RI
async function salvarNovoItemRI() {
  const itemVerificado = document.getElementById('riItemVerificado').value.trim();
  const oQueVerificar = document.getElementById('riOQueVerificar').value.trim();
  const localVerificacao = document.getElementById('riLocalVerificacao').value;
  const prioridade = document.getElementById('riPrioridade').value;
  
  if (!itemVerificado || !oQueVerificar || !localVerificacao || !prioridade) {
    alert('Preencha todos os campos');
    return;
  }
  
  const { codigo, id_omie } = window.produtoRIAtual;
  
  try {
    // Primeiro salva o item
    const dados = {
      id_omie,
      codigo,
      item_verificado: itemVerificado,
      o_que_verificar: oQueVerificar,
      local_verificacao: localVerificacao,
      prioridade
    };
    
    const response = await fetch(`${API_BASE}/api/ri`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    
    if (!response.ok) throw new Error('Erro ao salvar item RI');
    
    const itemSalvo = await response.json();
    
    // Se houver foto, faz upload
    const fotoInput = document.getElementById('riFotoInput');
    if (fotoInput && fotoInput.files[0]) {
      const formData = new FormData();
      formData.append('foto', fotoInput.files[0]);
      
      const uploadResponse = await fetch(`${API_BASE}/api/qualidade/ri/${itemSalvo.id}/foto`, {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        console.error('Erro ao fazer upload da foto');
      }
    }
    
    alert('Item salvo com sucesso!');
    await carregarItensRI(id_omie);
  } catch (error) {
    console.error('Erro ao salvar RI:', error);
    alert('Erro ao salvar item RI');
  }
}

// Editar item RI
async function editarItemRI(id) {
  // Buscar dados do item
  try {
    const response = await fetch(`${API_BASE}/api/ri/item/${id}`);
    if (!response.ok) throw new Error('Erro ao buscar item');
    const item = await response.json();
    
    // Carregar operações
    const operacoes = await carregarOperacoes();
    
    // Encontrar a linha e substituir por formulário de edição
    const tbody = document.getElementById('tabelaRIBody');
    const linhas = tbody.querySelectorAll('tr');
    
    linhas.forEach(tr => {
      const btnEditar = tr.querySelector(`[data-id="${id}"]`);
      if (btnEditar && btnEditar.classList.contains('btn-editar-ri')) {
        const fotoPreviewHtml = item.foto_url
          ? `<img src="${item.foto_url}" style=\"max-width:80px; max-height:60px; margin-bottom:8px;\" />`
          : '';

        tr.innerHTML = `
          <td style="padding: 10px; border: 1px solid var(--border-color);">${item.codigo}</td>
          <td style="padding: 10px; border: 1px solid var(--border-color);">
            <input type="text" id="editRiItemVerificado" value="${item.item_verificado || ''}" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color);">
            <input type="text" id="editRiOQueVerificar" value="${item.o_que_verificar || ''}" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color);">
            <select id="editRiLocalVerificacao" style="width:100%; padding:6px; border:1px solid var(--border-color); background:#fff; color:#000;">
              ${gerarOptionsOperacoes(operacoes, item.local_verificacao)}
            </select>
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color);">
            <select id="editRiPrioridade" style="width:100%; padding:6px; border:1px solid var(--border-color); background:#fff; color:#000;">
              <option value="Primario" ${item.prioridade === 'Primario' ? 'selected' : ''}>Primário</option>
              <option value="Secundario" ${item.prioridade === 'Secundario' ? 'selected' : ''}>Secundário</option>
            </select>
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
            <input type="file" id="editRiFotoInput" accept="image/*" style="display:none;" />
            <div id="editRiFotoPreview">${fotoPreviewHtml}</div>
            <button id="btnEditAnexarFotoRI" class="btn btn-secondary" style="font-size:0.9rem;">
              <i class="fa-solid fa-camera"></i> ${item.foto_url ? 'Alterar' : 'Anexar'}
            </button>
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
            <button class="btn btn-primary btn-salvar-edicao-ri" data-id="${id}" style="margin-right:8px;">
              <i class="fa-solid fa-check"></i> Salvar
            </button>
            <button class="btn btn-danger btn-cancelar-edicao-ri">
              <i class="fa-solid fa-times"></i> Cancelar
            </button>
          </td>
        `;

        // eventos foto
        const fotoInput = document.getElementById('editRiFotoInput');
        const btnAnexarFoto = document.getElementById('btnEditAnexarFotoRI');
        const fotoPreview = document.getElementById('editRiFotoPreview');
        btnAnexarFoto.addEventListener('click', () => fotoInput.click());
        fotoInput.addEventListener('change', (e) => {
          if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              fotoPreview.innerHTML = `<img src=\"${ev.target.result}\" style=\"max-width:80px; max-height:60px; margin-bottom:8px;\" />`;
            };
            reader.readAsDataURL(e.target.files[0]);
          }
        });

        tr.querySelector('.btn-salvar-edicao-ri').addEventListener('click', () => salvarEdicaoRI(id));
        tr.querySelector('.btn-cancelar-edicao-ri').addEventListener('click', () => carregarItensRI(window.produtoRIAtual.id_omie));
      }
    });
  } catch (error) {
    console.error('Erro ao editar item:', error);
    alert('Erro ao editar item');
  }
}

// Salvar edição
async function salvarEdicaoRI(id) {
  const itemVerificado = document.getElementById('editRiItemVerificado').value.trim();
  const oQueVerificar = document.getElementById('editRiOQueVerificar').value.trim();
  const localVerificacao = document.getElementById('editRiLocalVerificacao').value;
  const prioridade = document.getElementById('editRiPrioridade').value;
  
  if (!itemVerificado || !oQueVerificar || !localVerificacao || !prioridade) {
    alert('Preencha todos os campos');
    return;
  }
  
  const dados = {
    item_verificado: itemVerificado,
    o_que_verificar: oQueVerificar,
    local_verificacao: localVerificacao,
    prioridade
  };
  
  try {
    const response = await fetch(`${API_BASE}/api/ri/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    
    if (!response.ok) throw new Error('Erro ao atualizar item');
    
    // Se houver nova foto, faz upload
    const fotoInput = document.getElementById('editRiFotoInput');
    if (fotoInput && fotoInput.files[0]) {
      const formData = new FormData();
      formData.append('foto', fotoInput.files[0]);
      
      const uploadResponse = await fetch(`${API_BASE}/api/qualidade/ri/${id}/foto`, {
        method: 'POST',
        body: formData
      });
      if (!uploadResponse.ok) {
        console.error('Erro ao fazer upload da foto');
      }
    }
    
    alert('Item atualizado com sucesso!');
    await carregarItensRI(window.produtoRIAtual.id_omie);
  } catch (error) {
    console.error('Erro ao atualizar:', error);
    alert('Erro ao atualizar item');
  }
}

// Excluir item RI
async function excluirItemRI(id) {
  if (!confirm('Deseja realmente excluir este item?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/ri/${id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Erro ao excluir item');
    
    alert('Item excluído com sucesso!');
    await carregarItensRI(window.produtoRIAtual.id_omie);
  } catch (error) {
    console.error('Erro ao excluir:', error);
    alert('Erro ao excluir item');
  }
}

// Event listener para o botão adicionar RI
document.addEventListener('DOMContentLoaded', () => {
  const btnAdicionarRI = document.getElementById('btnAdicionarRI');
  if (btnAdicionarRI) {
    btnAdicionarRI.addEventListener('click', adicionarNovaLinhaRI);
  }
  
  const btnAdicionarPIR = document.getElementById('btnAdicionarPIR');
  if (btnAdicionarPIR) {
    btnAdicionarPIR.addEventListener('click', adicionarNovaLinhaPIR);
  }
});

// Expor funções globalmente
window.carregarItensRI = carregarItensRI;
window.adicionarNovaLinhaRI = adicionarNovaLinhaRI;

// ========================================
// FUNÇÕES PARA GERENCIAR A ABA PIR
// ========================================

// Variável global para PIR
window.produtoPIRAtual = {
  codigo: null,
  id_omie: null
};

// Carregar itens PIR do produto
async function carregarItensPIR(idOmie) {
  try {
    const response = await fetch(`${API_BASE}/api/pir/${idOmie}`);
    if (!response.ok) throw new Error('Erro ao carregar itens PIR');
    const itens = await response.json();
    renderizarTabelaPIR(itens);
  } catch (error) {
    console.error('Erro ao carregar PIR:', error);
    alert('Erro ao carregar itens de PIR');
  }
}

// Renderizar tabela PIR
function renderizarTabelaPIR(itens) {
  const tbody = document.getElementById('tabelaPIRBody');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (!itens || itens.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color: var(--content-color);">Nenhum item cadastrado</td></tr>';
    return;
  }
  
  itens.forEach(item => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    
    const fotoHtml = item.foto_url 
      ? `<img src="${item.foto_url}" style="max-width:80px; max-height:60px; cursor:pointer;" onclick="window.open('${item.foto_url}', '_blank')" />`
      : '<span style="color:#999;">Sem foto</span>';
    
    tr.innerHTML = `
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.codigo || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.item_verificado || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color);">${item.o_que_verificar || ''}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">${fotoHtml}</td>
      <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
        <button class="btn-editar-pir" data-id="${item.id}" title="Editar" style="background:none; border:none; color:var(--button-bg); cursor:pointer; margin-right:8px;">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="btn-excluir-pir" data-id="${item.id}" title="Excluir" style="background:none; border:none; color:#e74c3c; cursor:pointer;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  
  // Adicionar eventos aos botões
  document.querySelectorAll('.btn-editar-pir').forEach(btn => {
    btn.addEventListener('click', () => editarItemPIR(btn.dataset.id));
  });
  
  document.querySelectorAll('.btn-excluir-pir').forEach(btn => {
    btn.addEventListener('click', () => excluirItemPIR(btn.dataset.id));
  });
}

// Adicionar nova linha PIR
async function adicionarNovaLinhaPIR() {
  const tbody = document.getElementById('tabelaPIRBody');
  if (!tbody) return;
  
  if (tbody.querySelector('.linha-edicao-pir')) {
    alert('Finalize a edição atual antes de adicionar um novo item');
    return;
  }
  
  // Usar Código OMIE global (armazenado ao carregar produto)
  const codigoOmie = window.codigoOmieSelecionado;
  const codigo = window.codigoSelecionado;
  
  if (!codigoOmie) {
    alert('Selecione um produto primeiro ou aguarde o carregamento do Código OMIE');
    return;
  }
  
  // Atualiza produtoPIRAtual com Código OMIE
  window.produtoPIRAtual = {
    codigo: codigo,
    id_omie: codigoOmie
  };
  
  const { id_omie } = window.produtoPIRAtual;
  
  const tr = document.createElement('tr');
  tr.className = 'linha-edicao-pir';
  tr.style.borderBottom = '1px solid var(--border-color)';
  tr.style.backgroundColor = 'var(--content-bg)';
  tr.innerHTML = `
    <td style="padding: 10px; border: 1px solid var(--border-color);">${codigo}</td>
    <td style="padding: 10px; border: 1px solid var(--border-color);">
      <input type="text" id="pirItemVerificado" placeholder="Item verificado" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color);">
      <input type="text" id="pirOQueVerificar" placeholder="O que verificar" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
      <input type="file" id="pirFotoInput" accept="image/*" style="display:none;" />
      <div id="pirFotoPreview" style="margin-bottom:8px;"></div>
      <button id="btnAnexarFotoPIR" class="btn btn-secondary" style="font-size:0.9rem;">
        <i class="fa-solid fa-camera"></i> Foto
      </button>
    </td>
    <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
      <button id="btnSalvarPIR" class="btn btn-primary" style="margin-right:8px;">
        <i class="fa-solid fa-check"></i> Salvar
      </button>
      <button id="btnCancelarPIR" class="btn btn-danger">
        <i class="fa-solid fa-times"></i> Cancelar
      </button>
    </td>
  `;
  
  tbody.insertBefore(tr, tbody.firstChild);
  
  // Eventos do upload de foto
  const fotoInput = document.getElementById('pirFotoInput');
  const btnAnexarFoto = document.getElementById('btnAnexarFotoPIR');
  const fotoPreview = document.getElementById('pirFotoPreview');
  
  btnAnexarFoto.addEventListener('click', () => fotoInput.click());
  fotoInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        fotoPreview.innerHTML = `<img src="${ev.target.result}" style="max-width:80px; max-height:60px;" />`;
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });
  
  // Eventos dos botões
  document.getElementById('btnSalvarPIR').addEventListener('click', salvarNovoItemPIR);
  document.getElementById('btnCancelarPIR').addEventListener('click', () => {
    tr.remove();
    if (tbody.children.length === 0) {
      renderizarTabelaPIR([]);
    }
  });
  
  document.getElementById('pirItemVerificado').focus();
}

// Salvar novo item PIR
async function salvarNovoItemPIR() {
  const itemVerificado = document.getElementById('pirItemVerificado').value.trim();
  const oQueVerificar = document.getElementById('pirOQueVerificar').value.trim();
  
  if (!itemVerificado || !oQueVerificar) {
    alert('Preencha todos os campos obrigatórios');
    return;
  }
  
  const { codigo, id_omie } = window.produtoPIRAtual;
  
  try {
    // Primeiro salva o item
    const dados = {
      id_omie,
      codigo,
      item_verificado: itemVerificado,
      o_que_verificar: oQueVerificar
    };
    
    const response = await fetch(`${API_BASE}/api/pir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    
    if (!response.ok) throw new Error('Erro ao salvar item PIR');
    
    const itemSalvo = await response.json();
    
    // Se houver foto, faz upload
    const fotoInput = document.getElementById('pirFotoInput');
    if (fotoInput && fotoInput.files[0]) {
      const formData = new FormData();
      formData.append('foto', fotoInput.files[0]);
      
      const uploadResponse = await fetch(`${API_BASE}/api/qualidade/pir/${itemSalvo.id}/foto`, {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        console.error('Erro ao fazer upload da foto');
      }
    }
    
    alert('Item salvo com sucesso!');
    await carregarItensPIR(id_omie);
  } catch (error) {
    console.error('Erro ao salvar PIR:', error);
    alert('Erro ao salvar item PIR');
  }
}

// Editar item PIR
async function editarItemPIR(id) {
  try {
    const response = await fetch(`${API_BASE}/api/pir/item/${id}`);
    if (!response.ok) throw new Error('Erro ao buscar item');
    const item = await response.json();
    
    const tbody = document.getElementById('tabelaPIRBody');
    const linhas = tbody.querySelectorAll('tr');
    
    linhas.forEach(tr => {
      const btnEditar = tr.querySelector(`[data-id="${id}"]`);
      if (btnEditar && btnEditar.classList.contains('btn-editar-pir')) {
        const fotoPreviewHtml = item.foto_url
          ? `<img src="${item.foto_url}" style="max-width:80px; max-height:60px; margin-bottom:8px;" />`
          : '';
        
        tr.innerHTML = `
          <td style="padding: 10px; border: 1px solid var(--border-color);">${item.codigo}</td>
          <td style="padding: 10px; border: 1px solid var(--border-color);">
            <input type="text" id="editPirItemVerificado" value="${item.item_verificado || ''}" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color);">
            <input type="text" id="editPirOQueVerificar" value="${item.o_que_verificar || ''}" style="width:100%; padding:6px; border:1px solid var(--border-color); background:var(--content-bg); color:var(--content-color);" />
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
            <input type="file" id="editPirFotoInput" accept="image/*" style="display:none;" />
            <div id="editPirFotoPreview">${fotoPreviewHtml}</div>
            <button id="btnEditAnexarFotoPIR" class="btn btn-secondary" style="font-size:0.9rem;">
              <i class="fa-solid fa-camera"></i> ${item.foto_url ? 'Alterar' : 'Anexar'}
            </button>
          </td>
          <td style="padding: 10px; border: 1px solid var(--border-color); text-align: center;">
            <button class="btn btn-primary btn-salvar-edicao-pir" data-id="${id}" style="margin-right:8px;">
              <i class="fa-solid fa-check"></i> Salvar
            </button>
            <button class="btn btn-danger btn-cancelar-edicao-pir">
              <i class="fa-solid fa-times"></i> Cancelar
            </button>
          </td>
        `;
        
        // Eventos foto
        const fotoInput = document.getElementById('editPirFotoInput');
        const btnAnexarFoto = document.getElementById('btnEditAnexarFotoPIR');
        const fotoPreview = document.getElementById('editPirFotoPreview');
        
        btnAnexarFoto.addEventListener('click', () => fotoInput.click());
        fotoInput.addEventListener('change', (e) => {
          if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              fotoPreview.innerHTML = `<img src="${ev.target.result}" style="max-width:80px; max-height:60px; margin-bottom:8px;" />`;
            };
            reader.readAsDataURL(e.target.files[0]);
          }
        });
        
        tr.querySelector('.btn-salvar-edicao-pir').addEventListener('click', () => salvarEdicaoPIR(id));
        tr.querySelector('.btn-cancelar-edicao-pir').addEventListener('click', () => carregarItensPIR(window.produtoPIRAtual.id_omie));
      }
    });
  } catch (error) {
    console.error('Erro ao editar item:', error);
    alert('Erro ao editar item');
  }
}

// Salvar edição PIR
async function salvarEdicaoPIR(id) {
  const itemVerificado = document.getElementById('editPirItemVerificado').value.trim();
  const oQueVerificar = document.getElementById('editPirOQueVerificar').value.trim();
  
  if (!itemVerificado || !oQueVerificar) {
    alert('Preencha todos os campos');
    return;
  }
  
  const dados = {
    item_verificado: itemVerificado,
    o_que_verificar: oQueVerificar
  };
  
  try {
    const response = await fetch(`${API_BASE}/api/pir/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados)
    });
    
    if (!response.ok) throw new Error('Erro ao atualizar item');
    
    // Se houver nova foto, faz upload
    const fotoInput = document.getElementById('editPirFotoInput');
    if (fotoInput && fotoInput.files[0]) {
      const formData = new FormData();
      formData.append('foto', fotoInput.files[0]);
      
      const uploadResponse = await fetch(`${API_BASE}/api/qualidade/pir/${id}/foto`, {
        method: 'POST',
        body: formData
      });
      
      if (!uploadResponse.ok) {
        console.error('Erro ao fazer upload da foto');
      }
    }
    
    alert('Item atualizado com sucesso!');
    await carregarItensPIR(window.produtoPIRAtual.id_omie);
  } catch (error) {
    console.error('Erro ao atualizar:', error);
    alert('Erro ao atualizar item');
  }
}

// ========== CARROSSEL SEMANAL (Página Início) ==========

let currentCenterDate = null;
let currentCarouselTranslate = 0;
let carouselDataCache = {};
const CAROUSEL_WINDOW_DAYS = 7; // 7 antes e 7 depois (total 15 dias fixos)
const CARD_WIDTH = 162;         // deve bater com o CSS
const CARD_GAP = 12;            // gap definido no CSS (.semana-carousel { gap })
const STEP_WIDTH = CARD_WIDTH + CARD_GAP; // largura efetiva por cartão

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function initCarrosselSemanal() {
  currentCenterDate = new Date();
  currentCenterDate.setHours(0, 0, 0, 0);
  
  console.log('[CARROSSEL] Iniciando com data central:', currentCenterDate);
  
  await carregarSemanaCompleta();
  renderCarrossel();
  
  // AGUARDA o DOM atualizar antes de calcular posição
  await new Promise(resolve => setTimeout(resolve, 50));
  
  centralizarNoHoje();
  setupDragScroll();
  
  // Botão para voltar ao dia atual
  const btnHoje = document.getElementById('btnVoltarHoje');
  if (btnHoje) {
    btnHoje.addEventListener('click', () => {
      console.log('[CARROSSEL] Centralizando no hoje (janela fixa) ...');
      currentCenterDate = new Date();
      currentCenterDate.setHours(0, 0, 0, 0);
      // janela é fixa, não recarrega dados
      centralizarNoHoje();
      setupDragScroll();
    });
  }
}

function centralizarNoHoje() {
  const cardWidth = CARD_WIDTH;
  const viewportContainer = document.querySelector('.semana-carousel-container');
  
  if (!viewportContainer) {
    console.error('[CARROSSEL] Container viewport não encontrado!');
    return;
  }
  
  const viewportWidth = viewportContainer.clientWidth;
  
  console.log('[CARROSSEL] Viewport width:', viewportWidth);
  
  // índice do "hoje" no conjunto de 15 dias (0..14)
  const hojeIndex = CAROUSEL_WINDOW_DAYS; // 7º índice (meio)
  const step = STEP_WIDTH;
  const totalCards = (CAROUSEL_WINDOW_DAYS * 2) + 1; // 15
  const totalWidth = (totalCards * step) - CARD_GAP;  // soma dos cards + gaps

  const posicaoInicioHoje = hojeIndex * step;
  const centroHoje = posicaoInicioHoje + (cardWidth / 2);
  const centroViewport = viewportWidth / 2;
  let centerOffset = centroViewport - centroHoje;
  
  console.log('[CARROSSEL] Cálculo de centralização:', {
    viewportWidth,
    posicaoInicioHoje,
    centroHoje,
    centroViewport,
    centerOffset
  });
  
  // clamp para não mostrar espaços vazios além das bordas
  let minTranslate = Math.min(0, viewportWidth - totalWidth);
  let maxTranslate = 0;
  // se o total for menor que a viewport, centraliza completamente
  if (totalWidth <= viewportWidth) {
    const centered = Math.floor((viewportWidth - totalWidth) / 2);
    minTranslate = centered;
    maxTranslate = centered;
  }
  centerOffset = Math.max(minTranslate, Math.min(maxTranslate, centerOffset));
  currentCarouselTranslate = centerOffset;
  
  const carouselEl = document.getElementById('semanaCarousel');
  if (carouselEl) {
    carouselEl.style.transform = `translateX(${centerOffset}px)`;
    console.log('[CARROSSEL] Transform aplicado:', centerOffset);
  }
}

function setupDragScroll() {
  const carousel = document.getElementById('semanaCarousel');
  if (!carousel) {
    console.log('[DRAG] Carousel não encontrado!');
    return;
  }
  
  console.log('[DRAG] Configurando drag com transform...');
  
  const newCarousel = carousel.cloneNode(true);
  carousel.parentNode.replaceChild(newCarousel, carousel);
  const carouselEl = document.getElementById('semanaCarousel');
  
  let isDown = false;
  let startX = 0;
  let currentX = 0;
  let translateX = currentCarouselTranslate;
  let targetX = currentCarouselTranslate;
  let velocity = 0;
  let rafId = null;

  // limites de arraste (borda a borda)
  const viewportContainer = document.querySelector('.semana-carousel-container');
  const viewportWidth = viewportContainer?.clientWidth || 0;
  const totalCards = (CAROUSEL_WINDOW_DAYS * 2) + 1; // 15
  const totalWidth = (totalCards * STEP_WIDTH) - CARD_GAP;
  const MIN_X = Math.min(0, viewportWidth - totalWidth);
  const MAX_X = 0;
  
  carouselEl.style.transform = `translateX(${translateX}px)`;
  
  const lerp = (start, end, factor) => start + (end - start) * factor;
  
  const animate = () => {
    if (!isDown && Math.abs(velocity) > 0.5) {
      velocity *= 0.95;
      targetX += velocity;
    }
    
    translateX = lerp(translateX, targetX, 0.15);
    // aplica limites
    if (translateX < MIN_X) { translateX = MIN_X; targetX = MIN_X; velocity = 0; }
    if (translateX > MAX_X) { translateX = MAX_X; targetX = MAX_X; velocity = 0; }
    carouselEl.style.transform = `translateX(${translateX}px)`;
    currentCarouselTranslate = translateX;
    
    if (isDown || Math.abs(velocity) > 0.5 || Math.abs(targetX - translateX) > 0.5) {
      rafId = requestAnimationFrame(animate);
    } else {
      rafId = null;
    }
  };
  
  carouselEl.addEventListener('mousedown', (e) => {
    isDown = true;
    startX = e.pageX;
    currentX = e.pageX;
    velocity = 0;
    
    carouselEl.style.cursor = 'grabbing';
    
    if (rafId) cancelAnimationFrame(rafId);
    if (!rafId) {
      rafId = requestAnimationFrame(animate);
    }
  });
  
  carouselEl.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    
    const prevX = currentX;
    currentX = e.pageX;
    const delta = currentX - prevX;
    velocity = delta;
    targetX += delta;
  });
  
  carouselEl.addEventListener('mouseup', () => {
    if (!isDown) return;
    isDown = false;
    carouselEl.style.cursor = 'grab';
  });
  
  carouselEl.addEventListener('mouseleave', () => {
    if (!isDown) return;
    isDown = false;
    carouselEl.style.cursor = 'grab';
  });
  
  carouselEl.addEventListener('touchstart', (e) => {
    isDown = true;
    startX = e.touches[0].pageX;
    currentX = e.touches[0].pageX;
    velocity = 0;
    
    if (rafId) cancelAnimationFrame(rafId);
    if (!rafId) {
      rafId = requestAnimationFrame(animate);
    }
  });
  
  carouselEl.addEventListener('touchmove', (e) => {
    if (!isDown) return;
    
    const prevX = currentX;
    currentX = e.touches[0].pageX;
    const delta = currentX - prevX;
    velocity = delta;
    targetX += delta;
  });
  
  carouselEl.addEventListener('touchend', () => {
    if (!isDown) return;
    isDown = false;
  });
  
  carouselEl.style.cursor = 'grab';
  
  console.log('[DRAG] Setup completo com posição inicial:', currentCarouselTranslate);
}

// Janela fixa: não há mudança de conjunto ao arrastar
function moveCarrossel(direction) { /* noop em janela fixa */ }

async function carregarSemanaCompleta() {
  const promises = [];
  const start = -CAROUSEL_WINDOW_DAYS;
  const end = CAROUSEL_WINDOW_DAYS;
  for (let offset = start; offset <= end; offset++) {
    const date = new Date(currentCenterDate);
    date.setDate(date.getDate() + offset);
    const key = formatDateKey(date);
    
    if (!carouselDataCache[key]) {
      promises.push(carregarDadosDia(date));
    }
  }
  
  await Promise.all(promises);
}

async function carregarDadosDia(date) {
  const key = formatDateKey(date);
  const ano = date.getFullYear();
  const mes = date.getMonth() + 1;
  
  try {
    const resp = await fetch(`/api/pcp/calendario?ano=${ano}&mes=${mes}`, {
      credentials: 'include'
    });
    
    if (!resp.ok) {
      console.error('[CARROSSEL] Erro HTTP:', resp.status);
      carouselDataCache[key] = [];
      return;
    }
    
    const data = await resp.json();
    
    if (!data.ok || !data.data) {
      console.error('[CARROSSEL] Resposta inválida:', data);
      carouselDataCache[key] = [];
      return;
    }
    
    const produtos = data.data
      .filter(item => {
        const itemDate = item.data_previsao?.split('T')[0];
        return itemDate === key;
      })
      .map(item => ({
        codigo: item.codigo_produto || 'Sem código',
        quantidade: item.quantidade || 0,
        status: item.status || 'aguardando',
        descricao: item.produto_descricao || ''
      }));
    
    carouselDataCache[key] = produtos;
    
  } catch (error) {
    console.error('[CARROSSEL] Erro ao carregar dia:', error);
    carouselDataCache[key] = [];
  }
}

function renderCarrossel() {
  const container = document.getElementById('semanaCarousel');
  if (!container) return;
  
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hojeKey = formatDateKey(hoje);
  
  let html = '';
  const start = -CAROUSEL_WINDOW_DAYS;
  const end = CAROUSEL_WINDOW_DAYS;
  for (let offset = start; offset <= end; offset++) {
    const date = new Date(currentCenterDate);
    date.setDate(date.getDate() + offset);
    const key = formatDateKey(date);
    const produtos = carouselDataCache[key] || [];
    
    const isCenter = offset === 0;
    const isToday = key === hojeKey;
    
    const classes = ['semana-day-card'];
    if (isCenter) classes.push('center');
    if (isToday) classes.push('hoje');
    
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const dayName = dayNames[date.getDay()];
    const dia = date.getDate();
    const mes = date.getMonth() + 1;
    
    let produtosHtml = '';
    if (produtos.length === 0) {
      produtosHtml = '<div class="semana-empty">Nenhuma produção agendada</div>';
    } else {
      produtosHtml = produtos.map(prod => {
        const status = (prod.status || '').toLowerCase().trim();
        let icon = '';
        if (status === 'excluido') icon = '<i class="fa-solid fa-circle-xmark status-excluido"></i>';
        else if (status === 'produzindo') icon = '<i class="fa-solid fa-gear fa-spin status-produzindo"></i>';
        else if (status === 'produzido') icon = '<i class="fa-solid fa-circle-check status-produzido"></i>';
        else if (status === '' || status === 'aguardando') icon = '<i class="fa-solid fa-clock status-aguardando"></i>';
        else icon = '<i class="fa-solid fa-calendar-plus status-novo"></i>';
        
        const tooltipText = `${prod.descricao || 'Sem descrição'}\nStatus: ${prod.status || 'Novo'}`;
        return `<div class="semana-produto-item" title="${tooltipText}">
                  ${icon}
                  <span style="flex:1">${prod.codigo}</span>
                  <span style="color:#9ca3af">${prod.quantidade}x</span>
                </div>`;
      }).join('');
    }
    
    html += `
      <div class="${classes.join(' ')}" data-date="${key}" data-offset="${offset}">
        <div class="semana-day-header">
          <div>
            <div class="semana-day-date">${dia}/${mes}</div>
            <div class="semana-day-dow">${dayName}</div>
          </div>
          <div class="semana-day-badge">${produtos.length} ${produtos.length === 1 ? 'produto' : 'produtos'}</div>
        </div>
        <div class="semana-produtos">
          ${produtosHtml}
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

// Inicializar o carrossel quando a página carregar
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('semanaCarousel')) {
    console.log('[CARROSSEL] Inicializando carrossel semanal...');
    initCarrosselSemanal();
  }
});

// Excluir item PIR
async function excluirItemPIR(id) {
  if (!confirm('Deseja realmente excluir este item?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/api/pir/${id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) throw new Error('Erro ao excluir item');
    
    alert('Item excluído com sucesso!');
    await carregarItensPIR(window.produtoPIRAtual.id_omie);
  } catch (error) {
    console.error('Erro ao excluir:', error);
    alert('Erro ao excluir item');
  }
}

// Expor funções PIR globalmente
window.carregarItensPIR = carregarItensPIR;
window.adicionarNovaLinhaPIR = adicionarNovaLinhaPIR;


// ===== HANDLER PARA NAVIGATION CARDS =====
(function initNavigationCards() {
  function setupCards() {
    const hamburger = document.getElementById('navHamburger');
    const navGrid = document.getElementById('productNavGrid');
    const cards = document.querySelectorAll('.nav-card:not(.nav-card-action)');
    const btnNovoCard = document.getElementById('btnNovoProdutoCard');
    const sectionTitle = document.getElementById('currentSectionTitle');
    
    if (!hamburger || !navGrid || !cards.length) return false;

    // Mapeamento de títulos
    const titleMap = {
      'dadosProduto': 'Dados do produto',
      'estruturaProduto': 'Estrutura de produto',
      'listaPecasTab': 'Lista de peças',
      'listaFotos': 'Fotos',
      'listaAnexos': 'Anexos',
      'listaRI': 'RI',
      'listaPIR': 'PIR',
      'checkProjTab': 'Check-Proj',
      'checkComprasTab': 'Check-Compras'
    };

    // Toggle do menu hambúrguer
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = navGrid.style.display === 'none';
      navGrid.style.display = isCollapsed ? 'grid' : 'none';
      hamburger.classList.toggle('active', isCollapsed);
    });

    // Fechar menu ao clicar fora
    document.addEventListener('click', (e) => {
      if (!navGrid.contains(e.target) && !hamburger.contains(e.target)) {
        navGrid.style.display = 'none';
        hamburger.classList.remove('active');
      }
    });

    // Handler dos cards de navegação
    cards.forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Remove active de todos
        cards.forEach(c => c.classList.remove('active'));
        // Adiciona active no clicado
        card.classList.add('active');

        // Esconde todos os panes
        document.querySelectorAll('#produtoTabs .tab-content .tab-pane')
          .forEach(p => p.style.display = 'none');

        // Mostra o pane correspondente
        const targetId = card.dataset.target;
        const targetPane = document.getElementById(targetId);
        
        if (targetPane) {
          targetPane.style.display = 'block';
          
          // Atualiza título da seção
          if (sectionTitle && titleMap[targetId]) {
            sectionTitle.textContent = titleMap[targetId];
          }
          
          console.log(`[Nav Card] Navegou para: ${targetId}`);

          // Trigger especial para estrutura (carrega dados)
          if (targetId === 'estruturaProduto') {
            const cod = window.codigoSelecionado || 
                       document.getElementById('productTitle')?.textContent?.trim() || '';
            if (cod && typeof window.loadEstruturaProduto === 'function') {
              window.loadEstruturaProduto(cod);
            }
          }
          
          // Trigger especial para Check-Proj
          if (targetId === 'checkProjTab') {
            if (typeof window.checkProj?.loadCheckProj === 'function') {
              window.checkProj.loadCheckProj();
            }
          }
          
          // Trigger especial para Check-Compras
          if (targetId === 'checkComprasTab') {
            if (typeof window.checkCompras?.loadCheckCompras === 'function') {
              window.checkCompras.loadCheckCompras();
            }
          }

          // Trigger especial para Anexos (reforça handler btnNovoAnexo)
          if (targetId === 'listaAnexos') {
            const btn = document.getElementById('btnNovoAnexo');
            if (btn && !btn.dataset.handlerAttached) {
              btn.dataset.handlerAttached = 'true';
              btn.addEventListener('click', () => {
                const codigo = window.codigoSelecionado || 
                              document.getElementById('productTitle')?.textContent?.trim() || '';
                if (!codigo) {
                  alert('Selecione um produto antes de adicionar anexos.');
                  return;
                }
                // Força disparo do evento de click do script anexo
                const evClick = new MouseEvent('click', { bubbles: true, cancelable: true });
                btn.dispatchEvent(evClick);
              });
            }
          }
        }

        // Fecha o menu após selecionar
        navGrid.style.display = 'none';
        hamburger.classList.remove('active');
      });
    });

    // Handler do botão Novo (não fecha o menu)
    if (btnNovoCard) {
      btnNovoCard.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Dispara o evento do botão original
        const btnNovoProduto = document.getElementById('btnNovoProduto');
        if (btnNovoProduto) {
          btnNovoProduto.click();
        }
        
        // Fecha o menu
        navGrid.style.display = 'none';
        hamburger.classList.remove('active');
      });
    }

    // Ativa o card "Dados" por padrão ao carregar
    const dadosCard = document.querySelector('.nav-card[data-target="dadosProduto"]');
    if (dadosCard && !document.querySelector('.nav-card.active')) {
      dadosCard.classList.add('active');
    }

    return true;
  }

  // Tenta configurar imediatamente
  if (!setupCards()) {
    // Se não conseguir, tenta novamente após DOM carregar
    document.addEventListener('DOMContentLoaded', setupCards);
    // Fallback: tenta a cada 300ms por 5 segundos
    const interval = setInterval(() => {
      if (setupCards()) clearInterval(interval);
    }, 300);
    setTimeout(() => clearInterval(interval), 5000);
  }
})();

// ===== HANDLER PARA SIDEBAR HAMBÚRGUER =====
(function initSidebarHamburger() {
  function setupSidebar() {
    const hamburger = document.getElementById('sidebarHamburger');
    const sidebarContent = document.getElementById('sidebarContent');
    
    if (!hamburger || !sidebarContent) return false;

    // Toggle do menu lateral
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = sidebarContent.classList.contains('collapsed');
      
      if (isCollapsed) {
        sidebarContent.classList.remove('collapsed');
        hamburger.classList.add('active');
      } else {
        sidebarContent.classList.add('collapsed');
        hamburger.classList.remove('active');
      }
    });

    // Fechar menu ao clicar fora
    document.addEventListener('click', (e) => {
      if (!sidebarContent.contains(e.target) && !hamburger.contains(e.target)) {
        sidebarContent.classList.add('collapsed');
        hamburger.classList.remove('active');
      }
    });

    // Fechar menu ao clicar em qualquer link do menu
    const sidebarLinks = sidebarContent.querySelectorAll('a');
    sidebarLinks.forEach(link => {
      link.addEventListener('click', () => {
        sidebarContent.classList.add('collapsed');
        hamburger.classList.remove('active');
      });
    });

    return true;
  }

  // Tenta configurar imediatamente
  if (!setupSidebar()) {
    document.addEventListener('DOMContentLoaded', setupSidebar);
    const interval = setInterval(() => {
      if (setupSidebar()) clearInterval(interval);
    }, 300);
    setTimeout(() => clearInterval(interval), 5000);
  }
})();
