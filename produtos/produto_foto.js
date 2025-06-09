// produto_foto.js

// injeta estilos do modal, cooldown e delete-icon
(function insertStyles() {
    if (document.getElementById('foto-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'foto-modal-styles';
    style.textContent = `
      /* Modal */
      .foto-modal-overlay { /* ... mesmo estilo ... */ }
      .foto-modal-content { /* ... */ }
      .foto-modal-content img { /* ... */ }
      .foto-modal-close { /* ... */ }
  
      /* Delete icon: posição inferior direita, oculto por padrão */
      .option .delete-icon {
        position: absolute;
        bottom: 10px;
        right: 10px;
        width: 30px; height: 30px;
        background: rgba(255,255,255,0.8);
        border-radius: 50%;
        display: none;            /* oculto inicialmente */
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s;
        z-index: 1;
      }
      /* só aparece quando a foto está expandida */
      .option.active .delete-icon {
        display: flex;
      }
      .option .delete-icon:hover {
        background: rgba(255,0,0,0.8);
        color: #fff;
      }
  
      /* Cooldown banner */
      #fotoCooldown {
        text-align: center;
        color: #fff;
        background: rgba(0,0,0,0.7);
        padding: 6px;
        font-size: 1rem;
        margin-top: 8px;
        border-radius: 4px;
        display: none;
      }
    `;
    document.head.appendChild(style);
  })();
  
  let cooldownEnd = 0;
  let cooldownTimer = null;
  
  // inicia cooldown de 60 segundos
  function startCooldown() {
    const banner = document.getElementById('fotoCooldown');
    cooldownEnd = Date.now() + 60000; // 60s
    banner.style.display = 'block';
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
      if (remaining > 0) {
        banner.textContent = `Aguarde ${remaining}s antes de nova operação`;
      } else {
        clearInterval(cooldownTimer);
        banner.style.display = 'none';
      }
    }, 250);
  }
  
  $(document).ready(function() {
    // insere banner de cooldown abaixo do carrossel
    const container = document.querySelector('#listaFotos .options');
    const banner = document.createElement('div');
    banner.id = 'fotoCooldown';
    container.parentNode.insertBefore(banner, container.nextSibling);
  
  // 1) Salva o load original
  const originalLoad = window.loadDadosProduto;

  // 2) Sobrescreve sem await, chamando loadFotos em paralelo
  window.loadDadosProduto = function(codigo) {
    // Dispara o carregamento dos dados do produto
    const promise = originalLoad(codigo);
    // Atualiza as fotos imediatamente (sempre que mudar de produto)
    loadFotos(codigo);
    // Retorna a promise original pra quem usar await
    return promise;
  };

  // 3) Expõe loadFotos globalmente (caso precise chamar em outro lugar)
  window.loadFotos = loadFotos;
});
  
  async function loadFotos(codigo) {
    try {
      const resp  = await fetch(`/api/produtos/detalhes/${encodeURIComponent(codigo)}`);
      const dados = await resp.json();
      const urls  = Array.isArray(dados.imagens) ? dados.imagens.map(i => i.url_imagem) : [];
      populateFotos(urls);
    } catch (err) {
      console.error('Erro ao carregar fotos:', err);
    }
  }
  
  function openPhotoModal(src) {
    const overlay = document.createElement('div');
    overlay.className = 'foto-modal-overlay';
  
    const wrap = document.createElement('div');
    wrap.className = 'foto-modal-content';
  
    const closeBtn = document.createElement('div');
    closeBtn.className = 'foto-modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => document.body.removeChild(overlay));
  
    const img = document.createElement('img');
    img.src = src;
    img.addEventListener('click', () => {
      if (overlay.parentNode) document.body.removeChild(overlay);
    });
  
    wrap.appendChild(closeBtn);
    wrap.appendChild(img);
    overlay.appendChild(wrap);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  
    document.body.appendChild(overlay);
  }
  
  function populateFotos(urls) {
    const container = document.querySelector('#listaFotos .options');
    if (!container) return;
    container.innerHTML = '';
  
    const labels = [
      'Foto do produto',
      'Foto da identificação',
      'Foto diferencial',
      'Foto 4',
      'Foto 5',
      'Foto 6'
    ];
    const codigo = document.getElementById('productTitle').textContent;
  
    labels.forEach((label, i) => {
      const url = urls[i] || '../img/logo.png';
      const div = document.createElement('div');
      div.className = 'option' + (i === 0 ? ' active' : '');
      div.style.setProperty('--optionBackground', `url(${url})`);
  
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
  
      // expande ou abre modal
      div.addEventListener('click', () => {
        if (Date.now() < cooldownEnd) return;
        const wasActive = div.classList.contains('active');
        container.querySelectorAll('.option').forEach(o => o.classList.remove('active'));
        div.classList.add('active');
        if (wasActive) openPhotoModal(url);
      });
  
      // delete icon
      const deleteBtn = document.createElement('div');
      deleteBtn.className = 'delete-icon';
      deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
      deleteBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (Date.now() < cooldownEnd) return;
        try {
          const resp = await fetch(`/api/produtos/${encodeURIComponent(codigo)}/foto-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: i })
          });
          if (!resp.ok) throw new Error(await resp.text());
          const { imagens } = await resp.json();
          populateFotos(imagens);
          startCooldown();
        } catch (err) {
          console.error('Falha ao deletar foto', err);
        }
      });
      div.appendChild(deleteBtn);
  
      // file input para upload
      const fileInput = document.createElement('input');
      fileInput.type    = 'file';
      fileInput.accept  = 'image/*';
      fileInput.style.display = 'none';
      div.appendChild(fileInput);
  
      div.querySelector('.icon').addEventListener('click', e => {
        e.stopPropagation();
        if (Date.now() < cooldownEnd) return;
        fileInput.click();
      });
  
      fileInput.addEventListener('change', async () => {
        if (Date.now() < cooldownEnd) return;
        const file = fileInput.files[0];
        if (!file) return;
  
        // preview
        const reader = new FileReader();
        reader.onload = evt => {
          div.style.setProperty('--optionBackground', `url(${evt.target.result})`);
          container.querySelectorAll('.option').forEach(o => o.classList.remove('active'));
          div.classList.add('active');
        };
        reader.readAsDataURL(file);
  
        // upload com índice
        try {
          const form = new FormData();
          form.append('file', file);
          form.append('label', label);
          form.append('index', i);
  
          const resp = await fetch(`/api/produtos/${encodeURIComponent(codigo)}/foto`, {
            method: 'POST',
            body:   form
          });
          if (!resp.ok) throw new Error(await resp.text());
          const { imagens } = await resp.json();
          populateFotos(imagens);
          startCooldown();
        } catch (err) {
          console.error('Falha no upload:', err);
        }
      });
  
      container.appendChild(div);
    });
  }
  
  