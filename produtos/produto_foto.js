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

  // Mapeia lista do DB em 6 slots e guarda o pos real para cada índice
  function mapToSlots(fotos) {
    // fotos: [{ pos, url_imagem }]
    const byPos = new Map();
    (fotos || []).forEach(f => {
      const p = Number(f.pos);
      if (!Number.isNaN(p)) byPos.set(p, String(f.url_imagem || ''));
    });

    const urls  = new Array(6).fill('../img/logo.png');
    const posOf = new Array(6).fill(null);

    for (let i = 0; i < 6; i++) {
      // 1ª preferência: pos = i (0..5)
      if (byPos.has(i)) {
        urls[i]  = byPos.get(i) || '../img/logo.png';
        posOf[i] = i;
        continue;
      }
      // 2ª preferência: legado pos = i+1 (1..6)
      if (byPos.has(i + 1)) {
        urls[i]  = byPos.get(i + 1) || '../img/logo.png';
        posOf[i] = i + 1;
        continue;
      }
      // vazio -> placeholder; se inserir, gravaremos em i
      posOf[i] = i;
    }
    return { urls, posOf };
  }

  async function uploadFoto(codigo, posReal, file) {
    const form = new FormData();
    form.append('foto', file); // nome do campo aceito pela rota nova
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

  function renderCarousel(urls, posOf) {
    const pane = document.getElementById('listaFotos');
    if (!pane) return;
    const container = pane.querySelector('.options');
    if (!container) return;

    container.innerHTML = '';
    const codigo = getCodigoAtual();

    LABELS.forEach((label, i) => {
      const url    = urls[i] || '../img/logo.png';
      const posReal = posOf[i]; // pos real no DB para esse slot

      // bloco .option conforme seu CSS
      const div = document.createElement('div');
      div.className = 'option' + (i === 0 ? ' active' : '');
      div.style.setProperty('--optionBackground', `url(${url})`);
      div.dataset.index = String(i);

      div.innerHTML = `
        <div class="shadow"></div>
        <div class="label">
          <div class="icon"><i class="fas fa-camera"></i></div>
          <div class="info">
            <div class="main">${label}</div>
            <div class="sub"></div>
          </div>
        </div>
      `;

      // expandir ao clicar; se já ativa, abre modal
      div.addEventListener('click', () => {
        if (isCoolingDown()) return;
        const wasActive = div.classList.contains('active');
        container.querySelectorAll('.option').forEach(o => o.classList.remove('active'));
        div.classList.add('active');
        if (wasActive && url && !url.endsWith('logo.png')) openModal(url);
      });

      // input de arquivo escondido
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      div.appendChild(fileInput);

      // ícone câmera -> abre seletor
      div.querySelector('.icon').addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (isCoolingDown()) return;
        fileInput.click();
      });

      // upload
      fileInput.addEventListener('change', async () => {
        if (isCoolingDown()) return;
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;

        // preview imediato no card
        const reader = new FileReader();
        reader.onload = (ev) => {
          div.style.setProperty('--optionBackground', `url(${ev.target.result})`);
          container.querySelectorAll('.option').forEach(o => o.classList.remove('active'));
          div.classList.add('active');
        };
        reader.readAsDataURL(file);

        try {
          await uploadFoto(codigo, posReal, file);
          await reloadAndRender(); // pega URL pública definitiva
          tryStartCooldown();
        } catch (e) {
          console.error('Falha no upload', e);
          alert('Falha no upload da foto.');
        }
      });

      // botão lixeira (só aparece quando ativo)
      const del = document.createElement('div');
      del.className = 'delete-icon';
      del.innerHTML = '<i class="fas fa-trash-alt"></i>';
      del.title = 'Excluir esta foto';
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (isCoolingDown()) return;
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
  function openModal(src) {
    const overlay = document.createElement('div');
    overlay.className = 'foto-modal-overlay';
    const wrap = document.createElement('div');
    wrap.className = 'foto-modal-content';
    const img = document.createElement('img');
    img.src = src;
    wrap.appendChild(img);
    overlay.appendChild(wrap);
    overlay.addEventListener('click', () => document.body.removeChild(overlay));
    document.body.appendChild(overlay);
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
      .option .delete-icon{
        position:absolute; bottom:10px; right:10px; width:30px; height:30px;
        border-radius:50%; display:none; align-items:center; justify-content:center;
        background:rgba(255,255,255,.85); color:#c00; cursor:pointer;
      }
      .option.active .delete-icon{ display:flex; }
      .option .delete-icon:hover{ background:#c00; color:#fff; }
    `;
    document.head.appendChild(s);
  })();

  // ---------- Load flow ----------
  async function reloadAndRender() {
    const codigo = getCodigoAtual();
    if (!codigo) return;
    const raw   = await getFotosRaw(codigo);
    const { urls, posOf } = mapToSlots(raw);
    renderCarousel(urls, posOf);
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
