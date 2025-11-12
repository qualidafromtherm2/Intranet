// produtos/produto_foto.js
// Mantém SEU layout do carrossel (.options / .option) e usa as rotas SQL atuais:
//   GET    /api/produtos/:codigo/fotos         -> [{ pos, url_imagem, path_key }]
//   POST   /api/produtos/:codigo/fotos?pos=..  -> form-data campo "foto"
//   DELETE /api/produtos/:codigo/fotos/:pos
//
// Comportamento:
// - Clicar em um card: torna-se .active; se já estava .active, abre modal com a imagem.
// - Ícone da câmera abre o seletor de arquivo e faz upload no slot.
// - Ícone de lixeira exclui do Supabase + SQL e recarrega a grade.
// - Compatível com DB pos 0..5 e legado 1..6 (mapeamento automático).

(function () {
  // ---------- Utils ----------
  const $  = (sel, ctx = document) => ctx.querySelector(sel);

  function tryStartCooldown() {
    try { if (typeof startCooldown === 'function') startCooldown(); } catch {}
  }
  function isCoolingDown() {
    try { return typeof cooldownEnd !== 'undefined' && Date.now() < cooldownEnd; } catch { return false; }
  }

  function getCodigoAtual() {
    const h = document.getElementById('productTitle');
    const hidden = document.getElementById('codigo_produto');
    const txt = (h && h.textContent || '').trim();
    const alt = (hidden && hidden.value || '').trim();
    return txt || alt || '';
  }

  // ---------- Backend calls ----------
  async function getFotosRaw(codigo) {
    const url = `/api/produtos/${encodeURIComponent(codigo)}/fotos`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    return Array.isArray(j.fotos) ? j.fotos : [];
  }

  // Mapeia lista do DB em 6 slots, preservando metadados e a posição real do registro
  function mapToSlots(fotos) {
    const byPos = new Map();
    (fotos || []).forEach((f) => {
      const p = Number(f.pos);
      if (Number.isNaN(p)) return;
      byPos.set(p, {
        url: String(f.url_imagem || ''),
        nome: String(f.nome_foto || ''),
        descricao: String(f.descricao_foto || ''),
        pathKey: f.path_key || null,
        posReal: p
      });
    });

    const slots = [];
    for (let i = 0; i < 6; i++) {
      let info = {
        slotIndex: i,
        posReal: i,
        url: '../img/logo.png',
        nome: '',
        descricao: '',
        pathKey: null,
        hasFoto: false
      };

      if (byPos.has(i)) {
        const data = byPos.get(i);
        info = {
          ...info,
          posReal: i,
          url: data.url || '../img/logo.png',
          nome: data.nome,
          descricao: data.descricao,
          pathKey: data.pathKey,
          hasFoto: !!data.url
        };
      } else if (byPos.has(i + 1)) {
        const data = byPos.get(i + 1);
        info = {
          ...info,
          posReal: i + 1,
          url: data.url || '../img/logo.png',
          nome: data.nome,
          descricao: data.descricao,
          pathKey: data.pathKey,
          hasFoto: !!data.url
        };
      }

      // Normaliza flag hasFoto (ignora logo placeholder)
      if (info.hasFoto && info.url.endsWith('logo.png')) {
        info.hasFoto = false;
      }

      slots.push(info);
    }
    return slots;
  }

  async function uploadFoto(codigo, posReal, { file, nome, descricao }) {
    const form = new FormData();
    form.append('foto', file);
    form.append('nome_foto', nome);
    form.append('descricao_foto', descricao);
    const url = `/api/produtos/${encodeURIComponent(codigo)}/fotos?pos=${encodeURIComponent(posReal)}`;
    const r = await fetch(url, { method: 'POST', body: form });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function deleteFoto(codigo, posReal) {
    const url = `/api/produtos/${encodeURIComponent(codigo)}/fotos/${encodeURIComponent(posReal)}`;
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // ---------- UI ----------
  const LABELS = [
    'Foto do produto',
    'Foto Característica visual',
    'Foto esquema eletrico',
    'Foto 4',
    'Foto 5',
    'Foto 6'
  ];

  function renderCarousel(slots) {
    const pane = document.getElementById('listaFotos');
    if (!pane) return;
    const container = pane.querySelector('.options');
    if (!container) return;

    container.innerHTML = '';
    const codigo = getCodigoAtual();

    LABELS.forEach((label, i) => {
      const slot = slots[i] || {
        posReal: i,
        url: '../img/logo.png',
        nome: '',
        descricao: '',
        hasFoto: false
      };
      const bgUrl = slot.hasFoto ? slot.url : '../img/logo.png';
      const posReal = slot.posReal;
      const titulo = slot.nome || label;
      const detalhe = slot.descricao || (slot.hasFoto ? '' : 'Sem descrição');

      // bloco .option conforme seu CSS
      const div = document.createElement('div');
      div.className = 'option' + (i === 0 ? ' active' : '');
      div.style.setProperty('--optionBackground', `url(${bgUrl})`);
      div.dataset.index = String(i);
      div.dataset.posReal = String(posReal);
      div.dataset.hasFoto = slot.hasFoto ? '1' : '0';

      div.innerHTML = `
        <div class="shadow"></div>
        <div class="label">
          <div class="icon"><i class="fas fa-camera"></i></div>
          <div class="info">
            <div class="main">${titulo}</div>
            <div class="sub">${detalhe}</div>
          </div>
        </div>
      `;

      // expandir ao clicar; se já ativa, abre modal
      div.addEventListener('click', () => {
        if (isCoolingDown()) return;
        const wasActive = div.classList.contains('active');
        container.querySelectorAll('.option').forEach(o => o.classList.remove('active'));
        div.classList.add('active');
        if (wasActive && slot.hasFoto) openModal(slot);
      });

      // ícone câmera -> abre modal de upload
      div.querySelector('.icon').addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (isCoolingDown()) return;
        openUploadModal({
          codigo,
          slot,
          onSuccess: async () => {
            await reloadAndRender();
            tryStartCooldown();
          }
        });
      });

      // botão lixeira (só aparece quando ativo)
      const del = document.createElement('div');
      del.className = 'delete-icon';
      del.innerHTML = '<i class="fas fa-trash-alt"></i>';
      del.title = 'Excluir esta foto';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (isCoolingDown()) return;
        if (!slot.hasFoto) {
          alert('Não há foto para excluir neste slot.');
          return;
        }
        if (!confirm('Excluir esta foto do slot atual?')) return;
        try {
          await deleteFoto(codigo, posReal);
          await reloadAndRender();
          tryStartCooldown();
        } catch (e) {
          console.error('Falha ao excluir', e);
          alert('Falha ao excluir a foto.');
        }
      });
      div.appendChild(del);

      container.appendChild(div);
    });
  }

  // Modal simples
  function openModal(slot) {
    const overlay = document.createElement('div');
    overlay.className = 'foto-modal-overlay';
    const wrap = document.createElement('div');
    wrap.className = 'foto-modal-content';
    const img = document.createElement('img');
    img.src = slot.url;
    wrap.appendChild(img);
    if (slot.nome || slot.descricao) {
      const caption = document.createElement('div');
      caption.className = 'foto-modal-caption';
      caption.innerHTML = `
        ${slot.nome ? `<strong>${slot.nome}</strong>` : ''}
        ${slot.descricao ? `<p>${slot.descricao}</p>` : ''}
      `;
      wrap.appendChild(caption);
    }
    overlay.appendChild(wrap);
    overlay.addEventListener('click', () => document.body.removeChild(overlay));
    document.body.appendChild(overlay);
  }

  function openUploadModal({ codigo, slot, onSuccess }) {
    let previewUrl = null;
    let selectedFile = null;

    const overlay = document.createElement('div');
    overlay.className = 'foto-upload-overlay';

    const modal = document.createElement('div');
    modal.className = 'foto-upload-modal';
    modal.innerHTML = `
      <h2>Adicionar foto</h2>
      <div class="foto-upload-field">
        <label for="fotoNome">Nome da foto</label>
        <input id="fotoNome" type="text" maxlength="120" placeholder="Ex.: Vista frontal" />
      </div>
      <div class="foto-upload-field">
        <label for="fotoDescricao">Descrição</label>
        <textarea id="fotoDescricao" rows="3" placeholder="Detalhe o que esta imagem mostra"></textarea>
      </div>
      <div class="foto-upload-field">
        <label>Arquivo</label>
        <div class="foto-upload-file">
          <button type="button" class="foto-upload-select">Selecionar imagem</button>
          <span class="foto-upload-filename">Nenhum arquivo selecionado</span>
          <input type="file" accept="image/*" class="foto-upload-input" />
        </div>
      </div>
      <div class="foto-upload-preview">
        <img alt="Pré-visualização" />
      </div>
      <div class="foto-upload-actions">
        <button type="button" class="foto-upload-cancel">Cancelar</button>
        <button type="button" class="foto-upload-save" disabled>Salvar</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nomeInput = modal.querySelector('#fotoNome');
    const descInput = modal.querySelector('#fotoDescricao');
    const fileInput = modal.querySelector('.foto-upload-input');
    const selectBtn = modal.querySelector('.foto-upload-select');
    const fileNameSpan = modal.querySelector('.foto-upload-filename');
    const previewImg = modal.querySelector('.foto-upload-preview img');
    const cancelBtn = modal.querySelector('.foto-upload-cancel');
    const saveBtn = modal.querySelector('.foto-upload-save');

    if (slot?.nome) nomeInput.value = slot.nome;
    if (slot?.descricao) descInput.value = slot.descricao;

    const close = () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', onKeyDown);
    };

    const updateSaveState = () => {
      const nomeOk = nomeInput.value.trim().length > 0;
      const descOk = descInput.value.trim().length > 0;
      const fileOk = selectedFile instanceof File;
      saveBtn.disabled = !(nomeOk && descOk && fileOk);
    };

    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    selectBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      if (selectedFile) {
        previewUrl = URL.createObjectURL(selectedFile);
        previewImg.src = previewUrl;
        previewImg.classList.add('is-visible');
        fileNameSpan.textContent = selectedFile.name;
      } else {
        previewImg.src = '';
        previewImg.classList.remove('is-visible');
        fileNameSpan.textContent = 'Nenhum arquivo selecionado';
      }
      updateSaveState();
    });

    nomeInput.addEventListener('input', updateSaveState);
    descInput.addEventListener('input', updateSaveState);

    cancelBtn.addEventListener('click', () => {
      close();
    });

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });

    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvando...';

        await uploadFoto(codigo, slot.posReal, {
          file: selectedFile,
          nome: nomeInput.value.trim(),
          descricao: descInput.value.trim()
        });

        close();
        if (typeof onSuccess === 'function') {
          await onSuccess();
        }
      } catch (err) {
        console.error('Falha no upload', err);
        alert('Falha no upload da foto.');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar';
        updateSaveState();
      }
    });

    nomeInput.focus();
    updateSaveState();
  }

  // Estilos mínimos (não alteram seu layout do carrossel)
  (function injectMinimalStyles() {
    if (document.getElementById('foto-modal-styles')) return;
    const s = document.createElement('style');
    s.id = 'foto-modal-styles';
    s.textContent = `
      .foto-modal-overlay{
        position:fixed; inset:0; background:rgba(0,0,0,.75);
        display:flex; align-items:center; justify-content:center; z-index:9999;
      }
      .foto-modal-content img{
        max-width:90vw; max-height:90vh; border-radius:8px;
        box-shadow:0 10px 30px rgba(0,0,0,.35);
      }
      .foto-modal-caption{
        margin-top:16px;
        text-align:center;
        color:#eee;
        font-family:inherit;
      }
      .foto-modal-caption strong{
        display:block;
        font-size:1.1rem;
        margin-bottom:6px;
      }
      .foto-modal-caption p{
        margin:0;
        font-size:.9rem;
        color:#ccc;
      }
      .option .delete-icon{
        position:absolute; bottom:10px; right:10px; width:30px; height:30px;
        border-radius:50%; display:none; align-items:center; justify-content:center;
        background:rgba(255,255,255,.85); color:#c00; cursor:pointer;
      }
      .option.active .delete-icon{ display:flex; }
      .option .delete-icon:hover{ background:#c00; color:#fff; }
      .foto-upload-overlay{
        position:fixed; inset:0; background:rgba(0,0,0,.78);
        display:flex; align-items:center; justify-content:center; z-index:10000;
      }
      .foto-upload-modal{
        width:min(420px,90vw);
        background:#1f1f1f;
        border-radius:12px;
        padding:24px;
        box-shadow:0 18px 48px rgba(0,0,0,.45);
        display:flex;
        flex-direction:column;
        gap:14px;
        color:#f5f5f5;
        font-family:inherit;
      }
      .foto-upload-modal h2{
        margin:0;
        font-size:1.25rem;
        font-weight:600;
        text-align:left;
      }
      .foto-upload-field{
        display:flex;
        flex-direction:column;
        gap:6px;
      }
      .foto-upload-field label{
        font-size:.85rem;
        color:#d0d0d0;
      }
      .foto-upload-field input,
      .foto-upload-field textarea{
        background:#2b2b2b;
        border:1px solid #3a3a3a;
        border-radius:6px;
        padding:10px 12px;
        color:#f2f2f2;
        font-family:inherit;
        font-size:.9rem;
        resize:vertical;
      }
      .foto-upload-file{
        display:flex;
        align-items:center;
        gap:10px;
      }
      .foto-upload-select{
        background:#2d76ff;
        color:#fff;
        border:none;
        border-radius:6px;
        padding:8px 14px;
        font-weight:600;
        cursor:pointer;
        transition:background .2s;
      }
      .foto-upload-select:hover{
        background:#205bce;
      }
      .foto-upload-filename{
        font-size:.8rem;
        color:#bbb;
        flex:1;
        min-height:1.4em;
      }
      .foto-upload-input{ display:none; }
      .foto-upload-preview{
        width:100%;
        min-height:140px;
        border:1px dashed #3a3a3a;
        border-radius:8px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:#262626;
        overflow:hidden;
      }
      .foto-upload-preview img{
        max-width:100%;
        max-height:200px;
        opacity:0;
        transition:opacity .2s;
      }
      .foto-upload-preview img.is-visible{
        opacity:1;
      }
      .foto-upload-actions{
        display:flex;
        justify-content:flex-end;
        gap:10px;
      }
      .foto-upload-actions button{
        border:none;
        border-radius:6px;
        padding:9px 18px;
        font-weight:600;
        cursor:pointer;
        transition:background .2s, color .2s;
      }
      .foto-upload-cancel{
        background:transparent;
        color:#bbb;
        border:1px solid #3a3a3a;
      }
      .foto-upload-cancel:hover{
        color:#fff;
        border-color:#4a4a4a;
      }
      .foto-upload-save{
        background:#30a46c;
        color:#fff;
      }
      .foto-upload-save:disabled{
        background:#2f2f2f;
        color:#777;
        cursor:not-allowed;
      }
      .foto-upload-save:not(:disabled):hover{
        background:#268459;
      }
    `;
    document.head.appendChild(s);
  })();

  // ---------- Load flow ----------
  async function reloadAndRender() {
    const codigo = getCodigoAtual();
    if (!codigo) return;
    const raw   = await getFotosRaw(codigo);
    const slots = mapToSlots(raw);
    renderCarousel(slots);
  }

  function whenFotosTabOpensLoad() {
    // 1) Clique na aba "Fotos"
    document.addEventListener('click', (ev) => {
      const a = ev.target.closest('.main-header .main-header-link[data-target="listaFotos"]');
      if (!a) return;
      // Deixa o handler que troca de aba rodar e depois carrega
      setTimeout(reloadAndRender, 150);
    });

    // 2) Mudanças de visibilidade da própria aba (sem observar o documento inteiro)
    const fotosPane = document.getElementById('listaFotos');
    if (fotosPane) {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
            const visivel = getComputedStyle(fotosPane).display !== 'none';
            if (visivel) reloadAndRender();
          }
        }
      });
      obs.observe(fotosPane, { attributes: true, attributeFilter: ['style', 'class'] });

      // Se já visível ao carregar
      if (getComputedStyle(fotosPane).display !== 'none') {
        reloadAndRender();
      }
    }
  }

  // Boot
  document.addEventListener('DOMContentLoaded', whenFotosTabOpensLoad);
})();
