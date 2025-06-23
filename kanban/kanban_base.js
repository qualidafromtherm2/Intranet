// kanban_base.js
import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;      // Render ou outro domínio
/**
 * Mapeia nomes de coluna para os IDs das <ul>.
 */
const COLUMN_MAP = {
  "Pedido aprovado":       "coluna-comercial",
  "Separação logística":   "coluna-pcp-aprovado",
  "Fila de produção":      "coluna-pcp-op"
};

let placeholder = null;
let ulListenersInitialized = false;
let draggedIndex = null;
let draggedFromColumn = null;

// No início do arquivo, adicione:
function showSpinnerOnCard(card) {
  if (!card) return;
  card.innerHTML = '<i class="fas fa-spinner fa-spin kanban-spinner"></i>';
}

function restoreCardContent(card, originalContent) {
  if (!card || !originalContent) return;
  card.textContent = originalContent;
  card.setAttribute('draggable', 'true');
}


function getUlIdByColumn(columnName) {
  return COLUMN_MAP[columnName] || COLUMN_MAP["Pedido aprovado"];
}

function createPlaceholder() {
  const li = document.createElement('li');
  li.classList.add('placeholder');
  return li;
}

function removePlaceholder() {
  if (placeholder && placeholder.parentElement) {
    placeholder.parentElement.removeChild(placeholder);
  }
}

export function renderKanbanDesdeJSON(itemsKanban) {
  Object.values(COLUMN_MAP).forEach(ulId => {
    const ul = document.getElementById(ulId);
    if (ul) ul.innerHTML = '';
  });

  itemsKanban.forEach((item, index) => {
    const counts = item.local.reduce((acc, raw) => {
  const col = raw.split(',')[0];       // pega tudo antes da vírgula
  acc[col] = (acc[col]||0) + 1;
  return acc;
}, {})

    Object.entries(counts).forEach(([columnName, count]) => {
      const ulId = getUlIdByColumn(columnName);
      const ul = document.getElementById(ulId);
      if (!ul) return;

      const li = document.createElement('li');
      let text = `${item.pedido} – ${item.codigo} (${count})`;
      if (columnName === "Pedido aprovado") {
        text += ` | Estoque: ${item.estoque}`;
      }
      li.textContent = text;
      li.classList.add('kanban-card');
      li.setAttribute('draggable', 'true');
      li.dataset.index = index;
      li.dataset.column = columnName;

      ul.appendChild(li);
    });
  });
}

export async function carregarKanbanLocal() {
  try {
    const resp = await fetch(`${API_BASE}/api/kanban`);
    if (!resp.ok) {
      console.warn('GET /api/kanban retornou status', resp.status);
      return [];
    }
    const json = await resp.json();
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.error('Erro ao carregar kanban.json local:', err);
    return [];
  }
}

export async function salvarKanbanLocal(itemsKanban) {
  try {
    const resp = await fetch(`${API_BASE}/api/kanban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(itemsKanban, null, 2)
    });
    if (!resp.ok) {
      console.error('Falha ao salvar kanban.json:', await resp.text());
    } else {
      console.log('kanban.json atualizado com sucesso (rota /api/kanban).');
    }
  } catch (err) {
    console.error('Erro ao chamar POST /api/kanban:', err);
  }
}

export function enableDragAndDrop(itemsKanban) {
  document.querySelectorAll('.kanban-card').forEach(li => {
    li.addEventListener('dragstart', e => {
      removePlaceholder();
      placeholder = createPlaceholder();
      draggedIndex = parseInt(e.target.dataset.index, 10);
      draggedFromColumn = e.target.dataset.column;
      e.dataTransfer.setData('text/plain', '');
      e.dataTransfer.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
      removePlaceholder();
      draggedIndex = null;
      draggedFromColumn = null;
    });
  });

if (!ulListenersInitialized) {
  Object.values(COLUMN_MAP).forEach(ulId => {
    const ul = document.getElementById(ulId);
    if (!ul) return;

    // 1) Quando o cursor entra na UL, expande o espaço
    ul.addEventListener('dragenter', e => {
      e.preventDefault();
      // só expande se for o próprio UL (não filhos)
      if (e.target === ul) {
        ul.classList.add('drop-expand');
        if (!ul.contains(placeholder)) ul.appendChild(placeholder);
      }
    });

    // 2) Enquanto estiver sobre, mantém o espaço
    ul.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    // 3) Quando sai de vez da UL (e não apenas de um filho), recolhe
    ul.addEventListener('dragleave', e => {
      const to = e.relatedTarget;
      // se o novo elemento NÃO for filho da UL, então saiu de verdade
      if (!to || !ul.contains(to)) {
        ul.classList.remove('drop-expand');
        removePlaceholder();
      }
    });

ul.addEventListener('drop', async e => {
  e.preventDefault();
  ul.classList.remove('drop-expand');
  removePlaceholder();

  // 0) Valida estado de drag
  if (draggedIndex === null || !draggedFromColumn) {
    console.log('[DROP] drag não iniciado corretamente');
    return;
  }

  // 1) Identifica coluna de destino e item
  const destinationUlId = e.currentTarget.id;
  const newColumn = Object.entries(COLUMN_MAP)
    .find(([, id]) => id === destinationUlId)?.[0];
  if (!newColumn) {
    console.log('[DROP] coluna destino inválida:', destinationUlId);
    return;
  }
  const originColumn = draggedFromColumn;
  const item = itemsKanban[draggedIndex];
  if (!item) return;

  // 2) Insere um LI “vazio” com barra de loading
  const loadingLi = document.createElement('li');
  loadingLi.classList.add('kanban-card', 'loading');
  loadingLi.innerHTML = `
    <div class="loading-bar">
      <div class="progress"></div>
    </div>
  `;
  ul.appendChild(loadingLi);

  // 3) Atualiza imediatamente o modelo local
  const idxLocal = item.local.findIndex(c => c === originColumn);
  if (idxLocal !== -1) item.local[idxLocal] = newColumn;

  try {
    // 4) Envia log de arrasto (se for Separação logística)
    if (newColumn === 'Separação logística') {
      await fetch(`${API_BASE}/api/logs/arrasto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          etapa: 'Arrasto para Separação logística',
          pedido: item.pedido,
          codigo: item.codigo,
          quantidade: item.quantidade
        })
      });
    }

    // 5) Gera OP se necessário
    const respProd = await fetch(`/api/produtos/detalhes/${encodeURIComponent(item.codigo)}`);
    const prodData = await respProd.json();
    const tipoItem = prodData.tipoItem ?? prodData.tipo_item;

    if (
      originColumn === 'Pedido aprovado' &&
      newColumn === 'Separação logística' &&
      (tipoItem === '04' || parseInt(tipoItem, 10) === 4)
    ) {
      const prefix = item.codigo.startsWith('P') ? 'P' : 'F';
      const respNext = await fetch(`${API_BASE}/api/op/next-code/${prefix}`, { credentials: 'include' });
      const { nextCode: cCodIntOP } = await respNext.json();

      const now = new Date();
      const tom = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const d = String(tom.getDate()).padStart(2, '0');
      const m2 = String(tom.getMonth() + 1).padStart(2, '0');
      const y2 = tom.getFullYear();
      const dDtPrevisao = `${d}/${m2}/${y2}`;

      const payloadOP = {
        call: 'IncluirOrdemProducao',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          identificacao: { cCodIntOP, dDtPrevisao, nCodProduto: item._codigoProd, nQtde: 1 }
        }]
      };

      const respOP = await fetch(`${API_BASE}/api/omie/produtos/op`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadOP)
      });
      const dataOP = await respOP.json();

      if (!dataOP.faultstring && !dataOP.error) {
        const arr = item.local;
        const idxMov = arr.findIndex(s => s === newColumn);
        if (idxMov !== -1) {
          arr[idxMov] = `${newColumn},${cCodIntOP}`;
          try {
            await fetch(`${API_BASE}/api/etiquetas`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ numeroOP: cCodIntOP, tipo: 'Expedicao' })
            });
          } catch (err) {
            console.error('[ETIQUETA] falha ao chamar /api/etiquetas:', err);
          }
        }
      }
    }

    // 6) Persiste e re-renderiza o Kanban
    await salvarKanbanLocal(itemsKanban);
    renderKanbanDesdeJSON(itemsKanban);
    enableDragAndDrop(itemsKanban);

  } catch (err) {
    // 7) Em caso de erro, remove o loader, reverte o modelo e alerta
    loadingLi.remove();
    if (idxLocal !== -1) item.local[idxLocal] = originColumn;
    alert(`❌ Erro ao mover o cartão: ${err.message}`);
    renderKanbanDesdeJSON(itemsKanban);
    enableDragAndDrop(itemsKanban);
  } finally {
    // 8) Limpa estado de drag
    draggedIndex = null;
    draggedFromColumn = null;
  }
});


    });
    ulListenersInitialized = true;
  }
}
