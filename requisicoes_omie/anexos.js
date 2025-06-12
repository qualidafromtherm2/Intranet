// requisicoes_omie/anexos.js
// -----------------------------------------------------------------------------
// Injeção de controles de anexo no painel de detalhes de colaborador.
// -----------------------------------------------------------------------------

import config from '../config.client.js';

const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;      // Render ou outro domínio
// ────────────────────────────────────────────────────────────────
// 1) listaAnexos via proxy /api/omie/anexo-listar
// ────────────────────────────────────────────────────────────────
export async function listAnexos(cTabela, nId) {
  const res = await fetch(`${API_BASE}/api/omie/anexo-listar`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ cTabela, nId, nPagina: 1, nRegPorPagina: 50 })
  });
  return res.json();
}

let fileInput;
let uploadMode = null;

/**
 * Garante que exista um <input type="file"> oculto e configura o listener de mudança.
 */
function ensureFileInput() {
  if (fileInput) return;
  fileInput = document.createElement('input');
  fileInput.type  = 'file';
  fileInput.id    = 'anexoFileInput';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !uploadMode) return;

    const col = window.currentColaborador?.identificacao;
    if (!col) {
      alert('Colaborador não identificado.');
      uploadMode = null;
      fileInput.value = '';
      return;
    }

    const nId     = Number(col.nCod);
    const cTabela = 'crm-contatos';
    const cCodInt = col.cCodIntAnexo || col.cCodInt;
    const ext     = file.name.split('.').pop().toLowerCase();
    const cNomeArquivo = uploadMode === 'foto'
      ? `${cCodInt}.${ext}`
      : file.name;

    // 1) Preview imediato da foto
    if (uploadMode === 'foto') {
      document.getElementById('colabPhoto').src = URL.createObjectURL(file);
    }
    // 1.1) placeholder imediato na lista de anexos
    const ul = document.getElementById('anexosList');
    let placeholder;
    if (ul) {
      placeholder = document.createElement('li');
      placeholder.className = 'content-list-item placeholder';
      placeholder.innerHTML = `
        <span class="anexo-name">${cNomeArquivo}</span>
        <span class="spinner"><i class="fa-solid fa-spinner fa-spin"></i> Enviando...</span>`;
      ul.appendChild(placeholder);
    }

    // 2) Se for foto, excluir a antiga
    if (uploadMode === 'foto') {
      try {
        await fetch(`${API_BASE}/api/omie/anexo-excluir`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ cTabela, nId, cCodIntAnexo: cCodInt, nIdAnexo: col.lastAnexoId || 0 })
        });
      } catch (err) {
        console.warn('Erro ao excluir antigo:', err);
      }
      await new Promise(r => setTimeout(r, 5000));
    }

    // 3) Envia o arquivo
    const form = new FormData();
    form.append('file', file, cNomeArquivo);
    form.append('param', JSON.stringify([{ cCodIntAnexo: cCodInt, cTabela, nId }]));
    form.append('cNomeArquivo', cNomeArquivo);

    let uploadMeta;
    try {
      const res  = await fetch(`${API_BASE}/api/omie/anexo-file`, { method: 'POST', body: form });
      const data = await res.json();
      if (data.faultstring) throw new Error(data.faultstring);
      uploadMeta = data;
    } catch (err) {
      console.error('Falha no upload', err);
      alert('Falha ao enviar anexo: ' + err.message);
      uploadMode = null;
      fileInput.value = '';
      return;
    }

    // 5) polling de ObterAnexo (5s + 3s×3)
    let found = false;
    const delays = [5000, 3000, 3000, 3000];
    for (let i = 0; i < delays.length && !found; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      try {
        console.log(`Tentativa ${i+1} de ObterAnexo →`, { cCodIntAnexo: cCodInt, cTabela, nId });
        const respLink = await fetch(`${API_BASE}/api/omie/anexo-obter`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ cCodIntAnexo: cCodInt, cTabela, nId })
        });
        const linkResult = await respLink.json();
        console.log('Retorno ObterAnexo:', linkResult);

        if (respLink.ok && linkResult.cLinkDownload) {
          // monta o <li> definitivo
          const li = document.createElement('li');
          li.className = 'content-list-item';
          li.innerHTML = `
            <span class="anexo-name">${linkResult.cNomeArquivo}</span>
            <button class="btn-open"
              data-nomearquivo="${linkResult.cNomeArquivo}"
              data-codint="${linkResult.cCodIntAnexo}"
              data-nidanexo="${linkResult.nIdAnexo}">
              <i class="fa-solid fa-link"></i>
            </button>
            <button class="btn-delete"
              data-codint="${linkResult.cCodIntAnexo}"
              data-nidanexo="${linkResult.nIdAnexo}">
              <i class="fa-solid fa-trash"></i>
            </button>`;
          if (placeholder) {
            ul.replaceChild(li, placeholder);
          } else {
            ul.appendChild(li);
          }

          // remove o anexo antigo da lista
          const oldId = window.currentColaborador.lastAnexoId;
          if (oldId) {
            const oldLi = ul.querySelector(`button.btn-delete[data-nidanexo="${oldId}"]`)?.closest('li');
            if (oldLi) oldLi.remove();
          }

          attachAnexoHandlers(li);
          window.currentColaborador.lastAnexoId = linkResult.nIdAnexo;
          found = true;
        }
      } catch (err) {
        console.warn('Erro na tentativa ObterAnexo', i+1, err);
      }
    }

    if (!found && placeholder) {
      placeholder.innerHTML = `
        <span class="anexo-name">${cNomeArquivo}</span>
        <span class="error">Não localizado</span>`;
    }

    uploadMode = null;
    fileInput.value = '';
  });
}

/**
 * 2) Configura handlers de “abrir” e “excluir” para cada <li>
 */
function attachAnexoHandlers(li) {
  const cTabela = 'crm-contatos';
  const nId     = Number(window.currentColaborador.identificacao.nCod);

  // abrir link
  li.querySelector('.btn-open').addEventListener('click', async ev => {
    const btn      = ev.currentTarget;
    const liElem   = btn.closest('li');
    const span     = liElem.querySelector('.anexo-name');
    const fileName = span.textContent.trim();
    const cTabela  = 'crm-contatos';

    console.log(`🔥 Clique em anexo: "${fileName}", codInt="${btn.dataset.codint}", nIdAnexo=${btn.dataset.nidanexo}`);

    try {
      const resp   = await fetch(`${API_BASE}/api/omie/anexo-obter`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cNomeArquivo: fileName, cTabela, nId })
      });
      const result = await resp.json();
      console.log('Resposta ObterAnexo →', result);
      if (!resp.ok || !result.cLinkDownload) {
        throw new Error(result.error || 'Erro ao obter link do anexo');
      }
      window.open(result.cLinkDownload, '_blank');
    } catch (err) {
      console.error('Erro ObterAnexo', err);
      alert('Falha ao obter link do anexo');
    }
  });

  // excluir
  li.querySelector('.btn-delete').addEventListener('click', async ev => {
    if (!confirm('Confirma exclusão do anexo?')) return;
    const btn      = ev.currentTarget;
    const cCodInt  = btn.dataset.codint;
    const nIdAnexo = Number(btn.dataset.nidanexo);

    try {
      await fetch(`${API_BASE}/api/omie/anexo-excluir`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ cTabela, nId, cCodIntAnexo: cCodInt, nIdAnexo })
      });
      li.remove();
      alert('Anexo excluído com sucesso!');
    } catch (err) {
      console.error('Falha ao excluir anexo', err);
      alert('Falha ao excluir anexo');
    }
  });
}

/**
 * 3) Renderiza a lista inicial de anexos
 */
export function renderAnexos(lista = [], container) {
  container.innerHTML = '';
  if (!lista.length) {
    container.innerHTML = '<li class="empty">Nenhum anexo encontrado.</li>';
    return;
  }
  lista.forEach(item => {
    const li = document.createElement('li');
    li.className = 'content-list-item';
    li.innerHTML = `
      <span class="anexo-name">${item.cNomeArquivo}</span>
      <button class="btn-open"
        data-nomearquivo="${item.cNomeArquivo}"
        data-codint="${item.cCodIntAnexo}"
        data-nidanexo="${item.nIdAnexo}">
        <i class="fa-solid fa-link"></i>
      </button>
      <button class="btn-delete"
        data-codint="${item.cCodIntAnexo}"
        data-nidanexo="${item.nIdAnexo}">
        <i class="fa-solid fa-trash"></i>
      </button>`;
    li.style.display    = 'flex';
    li.style.alignItems = 'center';
    const span          = li.querySelector('.anexo-name');
    span.style.flex        = '1';
    span.style.marginRight = '0.5rem';
    container.appendChild(li);
    attachAnexoHandlers(li);
  });
}

/**
 * 4) Injeta o botão “Anexo” + controles no título
 */
export function injectAnexoControls(wrap) {
  ensureFileInput();
  wrap.querySelectorAll('#anexoRow1,#anexoRow2,#anexosList').forEach(n => n.remove());

  const row1 = document.createElement('div');
  row1.id = 'anexoRow1';
  Object.assign(row1.style, { display:'flex', gap:'0.5rem', marginTop:'1rem' });
  const btnAnexo = document.createElement('button');
  btnAnexo.textContent = 'Anexo';
  btnAnexo.className   = 'content-button';
  row1.appendChild(btnAnexo);
  wrap.appendChild(row1);

  btnAnexo.onclick = () => {
    if (wrap.querySelector('#anexoRow2')) return;
    const row2 = document.createElement('div');
    row2.id = 'anexoRow2';
    Object.assign(row2.style, { display:'flex', gap:'0.5rem', marginTop:'0.5rem' });
    const btnFoto   = document.createElement('button');
    btnFoto.textContent = 'Foto do perfil';
    btnFoto.className   = 'content-button';
    const btnOutros = document.createElement('button');
    btnOutros.textContent = 'Outros arquivos';
    btnOutros.className   = 'content-button';
    row2.append(btnFoto, btnOutros);
    wrap.appendChild(row2);

    const ul = document.createElement('ul');
    ul.id        = 'anexosList';
    ul.className = 'content-list';
    ul.style.marginTop = '0.5rem';
    wrap.appendChild(ul);

    btnFoto.onclick = () => {
      uploadMode = 'foto';
      fileInput.accept = '.jpg,.jpeg,.png';
      fileInput.click();
    };
    btnOutros.onclick = () => {
      uploadMode = 'outros';
      fileInput.accept = '*/*';
      fileInput.click();
    };

    refreshList();
  };
}

/**
 * 5) Recarrega a lista de anexos no UL existente
 */
async function refreshList() {
  const col = window.currentColaborador?.identificacao;
  if (!col) return;
  const ul = document.getElementById('anexosList');
  if (!ul) return;
  try {
    const data = await fetch(`${API_BASE}/api/omie/anexo-listar`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cTabela:'crm-contatos', nId: Number(col.nCod), nPagina:1, nRegPorPagina:50 })
    }).then(r => r.json());
    renderAnexos(data.listaAnexos || [], ul);
  } catch (err) {
    console.error('Erro ao listar anexos:', err);
  }
}

/**
 * 6) Inicializador (gera o input se ainda não existir)
 */
export function initAnexosUI() {
  ensureFileInput();
}
