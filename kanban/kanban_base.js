// kanban_base.js
import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

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
    const counts = item.local.reduce((acc, col) => {
      acc[col] = (acc[col] || 0) + 1;
      return acc;
    }, {});

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
    const resp = await fetch('/api/kanban');
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
    const resp = await fetch('/api/kanban', {
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
      e.target.classList.add('dragging');
    });

    li.addEventListener('dragend', e => {
      removePlaceholder();
      draggedIndex = null;
      draggedFromColumn = null;
      e.target.classList.remove('dragging');
    });
  });

  if (!ulListenersInitialized) {
    Object.values(COLUMN_MAP).forEach(ulId => {
      const ul = document.getElementById(ulId);
      if (!ul) return;

      ul.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!ul.contains(placeholder)) ul.appendChild(placeholder);
      });

      ul.addEventListener('dragenter', e => {
        e.preventDefault();
        if (!ul.contains(placeholder)) ul.appendChild(placeholder);
      });

      ul.addEventListener('dragleave', e => {
        if (e.target === ul) removePlaceholder();
      });

      ul.addEventListener('drop', async e => {
        console.log('[DROP] evento drop em', e.currentTarget.id,
                    'indice=', draggedIndex);
        e.preventDefault();
        removePlaceholder();

        if (draggedIndex === null || !draggedFromColumn) {
          console.log('[DROP] drag não iniciado corretamente');
          return;
        }

        const destinationUlId = e.currentTarget.id;
        const newColumn = Object.entries(COLUMN_MAP)
          .find(([, id]) => id === destinationUlId)?.[0];
        if (!newColumn) {
          console.log('[DROP] coluna destino inválida:', destinationUlId);
          return;
        }

        const originColumn = draggedFromColumn; // captura a coluna de origem
        console.log('[DROP] movendo', itemsKanban[draggedIndex].codigo,
                    'de', originColumn, 'para', newColumn);

        // 1) atualiza status no array
        const item = itemsKanban[draggedIndex];
        const idx = item.local.findIndex(c => c === originColumn);
        if (idx !== -1) item.local[idx] = newColumn;

        try {
          const respProd = await fetch(
            `/api/produtos/detalhes/${encodeURIComponent(item.codigo)}`
          );
          const prodData = await respProd.json();
          console.log('[OP] detalhes:', prodData);

          const tipoItem = prodData.tipoItem ?? prodData.tipo_item;
          console.log('[OP] tipoItem:', tipoItem);
          console.log('[OP] origem armazenada:', originColumn,
                      'destino:', newColumn);

          if (
            originColumn === 'Pedido aprovado' &&
            newColumn === 'Separação logística' &&
            (tipoItem === '04' || parseInt(tipoItem, 10) === 4)
          ) {
            console.log('[OP] condição satisfeita, incluindo OP');

            // gera código OP
            const prefix = item.codigo[0];
            const now = new Date();
            const mm = String(now.getMonth()+1).padStart(2,'0');
            const yy = String(now.getFullYear()).slice(-2);
            const seqKey = 'kanban_op_seq';
            const last = parseInt(localStorage.getItem(seqKey),10)||0;
            const seq = last + 1;
            localStorage.setItem(seqKey, seq);
            const seqStr = String(seq).padStart(4,'0');
            const cCodIntOP = `${prefix}${mm}${yy}${seqStr}`;

            const tom = new Date(now.getTime() + 24*60*60*1000);
            const d = String(tom.getDate()).padStart(2,'0');
            const m2 = String(tom.getMonth()+1).padStart(2,'0');
            const y2 = tom.getFullYear();
            const dDtPrevisao = `${d}/${m2}/${y2}`;

            const payloadOP = {
              call: 'IncluirOrdemProducao',
              param: [{ identificacao: { cCodIntOP, dDtPrevisao, nCodProduto: item._codigoProd, nQtde: 1 }}],
              app_key: OMIE_APP_KEY,
              app_secret: OMIE_APP_SECRET
            };
            console.log('[OP] payload OP:', payloadOP);

            const respOP = await fetch('/api/omie/produtos/op', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify(payloadOP)
            });
            console.log('[OP] status OP:', respOP.status);
            const dataOP = await respOP.json();
            console.log('[OP] resposta OP:', dataOP);
          } else {
            console.log('[OP] sem OP: movimento ou tipoItem não correspondem');
          }
        } catch (err) {
          console.error('[OP] erro inclusão OP:', err);
        }

        // 3) re-renderiza e salva
        renderKanbanDesdeJSON(itemsKanban);
        enableDragAndDrop(itemsKanban);
        await salvarKanbanLocal(itemsKanban);

        draggedIndex = null;
        draggedFromColumn = null;
      });
    });
    ulListenersInitialized = true;
  }
}
