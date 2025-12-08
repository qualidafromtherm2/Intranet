(function () {
  const TAB_ID = 'listaAnexos';
  const LIST_ID = 'listaAnexosConteudo';
  const BUTTON_ID = 'btnNovoAnexo';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);

  function getCodigoAtual() {
    const titulo = document.getElementById('productTitle');
    const hidden = document.getElementById('codigo_produto');
    const rawTitle = titulo?.textContent?.trim() || '';
    const rawHidden = hidden?.value?.trim() || '';
    return rawTitle || rawHidden || '';
  }

  async function fetchAnexos(codigo) {
    const url = `/api/produtos/${encodeURIComponent(codigo)}/anexos`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Erro ao carregar anexos');
    }
    const data = await res.json();
    return Array.isArray(data.anexos) ? data.anexos : [];
  }

  async function uploadAnexo(codigo, { file, nome, descricao }) {
    const form = new FormData();
    form.append('arquivo', file);
    form.append('nome_anexo', nome);
    form.append('descricao_anexo', descricao);

    const url = `/api/produtos/${encodeURIComponent(codigo)}/anexos`;
    const res = await fetch(url, { method: 'POST', body: form });
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'Falha no upload do anexo');
    try {
      return JSON.parse(text);
    } catch (err) {
      return { ok: true };
    }
  }

  async function deleteAnexo(codigo, id) {
    const url = `/api/produtos/${encodeURIComponent(codigo)}/anexos/${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Falha ao excluir anexo');
    }
    return res.json();
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let value = size;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  function formatDate(value) {
    if (!value) return '';
    try {
      const dt = new Date(value);
      if (Number.isNaN(dt.getTime())) return '';
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(dt);
    } catch {
      return '';
    }
  }

  function renderList(anexos) {
    const list = document.getElementById(LIST_ID);
    if (!list) return;

    if (!Array.isArray(anexos) || anexos.length === 0) {
      list.innerHTML = '<li class="content-list-item empty">Nenhum anexo encontrado para este produto.</li>';
      return;
    }

    const items = anexos.map((item) => {
      const nome = escapeHtml(item.nome_anexo || item.nome || item.titulo || 'Sem nome');
      const descRaw = item.descricao_anexo || item.descricao || '';
      const desc = escapeHtml(descRaw || 'Sem descrição');
      const tamanho = formatBytes(item.tamanho_bytes);
      const quando = formatDate(item.criado_em);
      const metaParts = [];
      if (tamanho) metaParts.push(tamanho);
      if (quando) metaParts.push(quando);
      const meta = metaParts.join(' • ');
      const url = escapeHtml(item.url_anexo || item.url || '');
      return `
        <li class="content-list-item anexo-item" data-id="${item.id}" data-url="${url}">
          <div class="anexo-info">
            <div class="anexo-name">${nome}</div>
            <div class="anexo-desc">${desc}</div>
            ${meta ? `<div class="anexo-meta">${meta}</div>` : ''}
          </div>
          <div class="anexo-actions">
            <button type="button" class="anexo-btn open" data-url="${url}" ${url ? '' : 'disabled'}>
              <i class="fa-solid fa-arrow-up-right-from-square"></i>
              <span>Abrir</span>
            </button>
            <button type="button" class="anexo-btn danger delete" data-id="${item.id}">
              <i class="fa-solid fa-trash"></i>
              <span>Excluir</span>
            </button>
          </div>
        </li>`;
    });

    list.innerHTML = items.join('');
  }

  function ensureStyles() {
    if (document.getElementById('produto-anexos-styles')) return;
    const style = document.createElement('style');
    style.id = 'produto-anexos-styles';
    style.textContent = `
      #${TAB_ID} .title-wrapper button{
        display:flex;
        align-items:center;
        gap:6px;
      }
      #${LIST_ID} .content-list-item{
        display:flex;
        gap:16px;
        align-items:flex-start;
        justify-content:space-between;
      }
      #${LIST_ID} .empty,
      #${LIST_ID} .error,
      #${LIST_ID} .loading{
        justify-content:flex-start;
        color:#9ca3af;
      }
      .anexo-info{
        flex:1;
        display:flex;
        flex-direction:column;
        gap:4px;
      }
      .anexo-name{
        font-weight:600;
        color:#f3f4f6;
      }
      .anexo-desc{
        color:#cbd5f5;
        font-size:0.9rem;
      }
      .anexo-meta{
        font-size:0.8rem;
        color:#9ca3af;
      }
      .anexo-actions{
        display:flex;
        gap:8px;
        flex-shrink:0;
      }
      .anexo-btn{
        display:flex;
        align-items:center;
        gap:6px;
        border:none;
        border-radius:6px;
        padding:8px 14px;
        background:#2563eb;
        color:#fff;
        cursor:pointer;
        font-weight:600;
        transition:background .2s ease;
      }
      .anexo-btn:hover:not(:disabled){
        background:#1d4ed8;
      }
      .anexo-btn:disabled{
        opacity:.4;
        cursor:not-allowed;
      }
      .anexo-btn.danger{
        background:#dc2626;
      }
      .anexo-btn.danger:hover{
        background:#b91c1c;
      }
      .anexo-upload-overlay{
        position:fixed;
        inset:0;
        background:rgba(0,0,0,.78);
        display:flex;
        align-items:center;
        justify-content:center;
        z-index:10000;
      }
      .anexo-upload-modal{
        width:min(440px,90vw);
        background:#1f1f1f;
        border-radius:12px;
        padding:24px;
        box-shadow:0 18px 48px rgba(0,0,0,.45);
        display:flex;
        flex-direction:column;
        gap:16px;
        color:#f5f5f5;
        font-family:inherit;
      }
      .anexo-upload-modal h2{
        margin:0;
        font-size:1.25rem;
        font-weight:600;
      }
      .anexo-upload-field{
        display:flex;
        flex-direction:column;
        gap:6px;
      }
      .anexo-upload-field label{
        font-size:.85rem;
        color:#d0d0d0;
      }
      .anexo-upload-field input,
      .anexo-upload-field textarea{
        background:#2b2b2b;
        border:1px solid #3a3a3a;
        border-radius:6px;
        padding:10px 12px;
        color:#f2f2f2;
        font-family:inherit;
        font-size:.9rem;
        resize:vertical;
      }
      .anexo-upload-file{
        display:flex;
        align-items:center;
        gap:10px;
      }
      .anexo-upload-select{
        background:#2d76ff;
        color:#fff;
        border:none;
        border-radius:6px;
        padding:8px 14px;
        font-weight:600;
        cursor:pointer;
        transition:background .2s ease;
      }
      .anexo-upload-select:hover{
        background:#205bce;
      }
      .anexo-upload-filename{
        font-size:.8rem;
        color:#bbb;
        flex:1;
        min-height:1.4em;
      }
      .anexo-upload-input{ display:none; }
      .anexo-upload-actions{
        display:flex;
        justify-content:flex-end;
        gap:10px;
      }
      .anexo-upload-actions button{
        border:none;
        border-radius:6px;
        padding:9px 18px;
        font-weight:600;
        cursor:pointer;
      }
      .anexo-upload-cancel{
        background:transparent;
        color:#bbb;
        border:1px solid #3a3a3a;
      }
      .anexo-upload-cancel:hover{
        color:#fff;
        border-color:#4a4a4a;
      }
      .anexo-upload-save{
        background:#30a46c;
        color:#fff;
        transition:background .2s ease;
      }
      .anexo-upload-save:disabled{
        background:#2f2f2f;
        color:#777;
        cursor:not-allowed;
      }
      .anexo-upload-save:not(:disabled):hover{
        background:#268459;
      }
    `;
    document.head.appendChild(style);
  }

  let currentLoadToken = 0;

  async function reloadAnexos() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;

    const codigo = getCodigoAtual();
    if (!codigo) {
      list.innerHTML = '<li class="content-list-item empty">Selecione um produto para visualizar anexos.</li>';
      return;
    }

    const token = ++currentLoadToken;
    list.innerHTML = '<li class="content-list-item loading"><i class="fa-solid fa-spinner fa-spin"></i><span style="margin-left:8px;">Carregando anexos…</span></li>';

    try {
      const anexos = await fetchAnexos(codigo);
      if (token !== currentLoadToken) return; // carregamento obsoleto
      renderList(anexos);
    } catch (err) {
      console.error('[produto anexos] falha ao carregar', err);
      if (token !== currentLoadToken) return;
      list.innerHTML = '<li class="content-list-item error">Falha ao carregar anexos do produto.</li>';
    }
  }

  function openUploadModal({ codigo, onSuccess }) {
    // Verifica se já existe um modal aberto e remove
    const existingOverlay = document.querySelector('.anexo-upload-overlay');
    if (existingOverlay) {
      console.warn('[produto anexos] Modal já existe, removendo...');
      existingOverlay.remove();
    }
    
    let selectedFile = null;

    const overlay = document.createElement('div');
    overlay.className = 'anexo-upload-overlay';

    const modal = document.createElement('div');
    modal.className = 'anexo-upload-modal';
    modal.innerHTML = `
      <h2>Novo anexo</h2>
      <div class="anexo-upload-field">
        <label for="anexoNome">Nome</label>
        <input id="anexoNome" type="text" maxlength="160" placeholder="Ex.: Manual técnico" />
      </div>
      <div class="anexo-upload-field">
        <label for="anexoDescricao">Descrição</label>
        <textarea id="anexoDescricao" rows="3" placeholder="Descreva o conteúdo do arquivo"></textarea>
      </div>
      <div class="anexo-upload-field">
        <label>Arquivo</label>
        <div class="anexo-upload-file">
          <button type="button" class="anexo-upload-select">Selecionar arquivo</button>
          <span class="anexo-upload-filename">Nenhum arquivo selecionado</span>
          <input class="anexo-upload-input" type="file" />
        </div>
      </div>
      <div class="anexo-upload-actions">
        <button type="button" class="anexo-upload-cancel">Cancelar</button>
        <button type="button" class="anexo-upload-save" disabled>Salvar</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nomeInput = modal.querySelector('#anexoNome');
    const descInput = modal.querySelector('#anexoDescricao');
    const selectBtn = modal.querySelector('.anexo-upload-select');
    const fileInput = modal.querySelector('.anexo-upload-input');
    const fileNameSpan = modal.querySelector('.anexo-upload-filename');
    const cancelBtn = modal.querySelector('.anexo-upload-cancel');
    const saveBtn = modal.querySelector('.anexo-upload-save');

    let modalClosed = false; // Flag para evitar múltiplas chamadas

    function close() {
      if (modalClosed) {
        console.log('[produto anexos] close() já foi chamado, ignorando...');
        return;
      }
      
      console.log('[produto anexos] Executando close()...');
      modalClosed = true;
      
      try {
        // Remove listener de teclado
        document.removeEventListener('keydown', onKeyDown);
        console.log('[produto anexos] Listener de teclado removido');
        
        // Remove o overlay específico
        if (overlay && document.body.contains(overlay)) {
          document.body.removeChild(overlay);
          console.log('[produto anexos] Overlay específico removido do DOM');
        } else {
          console.warn('[produto anexos] Overlay específico não encontrado no DOM');
        }
        
        // Remove TODOS os overlays restantes (garantia adicional)
        const allOverlays = document.querySelectorAll('.anexo-upload-overlay');
        if (allOverlays.length > 0) {
          console.log(`[produto anexos] Removendo ${allOverlays.length} overlay(s) adicional(is)...`);
          allOverlays.forEach(o => o.remove());
        }
      } catch (err) {
        console.error('[produto anexos] erro ao fechar modal', err);
      }
    }

    function updateSaveState() {
      const nomeOk = nomeInput.value.trim().length > 0;
      const descOk = descInput.value.trim().length > 0;
      const fileOk = selectedFile instanceof File;
      saveBtn.disabled = !(nomeOk && descOk && fileOk);
    }

    function onKeyDown(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    selectBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      if (selectedFile) {
        const size = formatBytes(selectedFile.size);
        const name = selectedFile.name;
        fileNameSpan.textContent = size ? `${name} (${size})` : name;
      } else {
        fileNameSpan.textContent = 'Nenhum arquivo selecionado';
      }
      updateSaveState();
    });

    nomeInput.addEventListener('input', updateSaveState);
    descInput.addEventListener('input', updateSaveState);

    // Botão Cancelar: previne propagação e fecha modal
    cancelBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      console.log('[produto anexos] Botão Cancelar clicado');
      close();
    });

    // Clique fora do modal (no overlay) fecha
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        console.log('[produto anexos] Clique fora do modal detectado');
        close();
      }
    });

    // Impede propagação de clicks dentro do modal
    modal.addEventListener('click', (ev) => {
      ev.stopPropagation();
    });

    // Botão Salvar: previne propagação, faz upload e fecha
    saveBtn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      if (saveBtn.disabled) return;
      
      console.log('[produto anexos] Iniciando upload...');
      
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvando...';
        
        console.log('[produto anexos] Enviando arquivo para servidor...');
        await uploadAnexo(codigo, {
          file: selectedFile,
          nome: nomeInput.value.trim(),
          descricao: descInput.value.trim(),
        });
        
        console.log('[produto anexos] Upload concluído, fechando modal...');
        // Fecha modal imediatamente
        close();
        
        console.log('[produto anexos] Recarregando lista de anexos...');
        // Recarrega a lista de anexos
        if (typeof onSuccess === 'function') {
          await onSuccess();
        }
        console.log('[produto anexos] Processo completo!');
      } catch (err) {
        console.error('[produto anexos] falha upload', err);
        alert('Falha ao enviar o anexo.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar';
        updateSaveState();
      }
    });

    setTimeout(() => nomeInput.focus(), 50);
    updateSaveState();
  }

  function attachListHandlers() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;

    list.addEventListener('click', async (ev) => {
      const openBtn = ev.target.closest('.anexo-btn.open');
      if (openBtn) {
        const url = openBtn.dataset.url;
        if (url) window.open(url, '_blank');
        return;
      }

      const deleteBtn = ev.target.closest('.anexo-btn.delete');
      if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const codigo = getCodigoAtual();
        if (!id || !codigo) return;
        if (!confirm('Confirma exclusão deste anexo?')) return;
        deleteBtn.disabled = true;
        try {
          await deleteAnexo(codigo, id);
          await reloadAnexos();
        } catch (err) {
          console.error('[produto anexos] falha exclusão', err);
          alert('Falha ao excluir o anexo.');
          deleteBtn.disabled = false;
        }
      }
    });
  }

  function observeTabVisibility() {
    document.addEventListener('click', (ev) => {
      const anchor = ev.target.closest('.main-header .main-header-link[data-target="listaAnexos"]');
      if (!anchor) return;
      setTimeout(reloadAnexos, 150);
    });

    const pane = document.getElementById(TAB_ID);
    if (!pane) return;
    const observer = new MutationObserver(() => {
      const visible = getComputedStyle(pane).display !== 'none';
      if (visible) reloadAnexos();
    });
    observer.observe(pane, { attributes: true, attributeFilter: ['style', 'class'] });
    if (getComputedStyle(pane).display !== 'none') reloadAnexos();
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureStyles();
    attachListHandlers();
    observeTabVisibility();

    const btn = document.getElementById(BUTTON_ID);
    if (btn) {
      btn.addEventListener('click', () => {
        const codigo = getCodigoAtual();
        if (!codigo) {
          alert('Selecione um produto antes de adicionar anexos.');
          return;
        }
        openUploadModal({ codigo, onSuccess: reloadAnexos });
      });
    }
  });
})();
