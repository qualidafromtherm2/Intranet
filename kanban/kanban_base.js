// kanban_base.js
import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

 // Decide em qual endpoint salvar
 const getKanbanEndpoint = destino =>
   destino === 'preparacao' ? '/api/kanban_preparacao' : '/api/kanban';

// Define a URL-base das chamadas à API: usa window.location.origin
const API_BASE = window.location.origin;
const ZPL_TOKEN = 'fr0mTh3rm2025';          // ←  o MESMO valor que está no Render
 // Mantenha o token original
 const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
 // Em local, imprime na própria máquina; em prod, aponta para o Windows da logística
 const PRINTER_URL = isLocal
   ? window.location.origin
   : 'http://DESKTOP-0RJO5A6:5001';
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
/* controla a diferença entre click e dblclick */
let clickTimerId = null;        // null = nenhum clique pendente


/* ——— devolve o próximo código sequencial gravado no backend ——— */
export async function gerarTicket () {
  const resp = await fetch('/api/op/next-code/0', { credentials: 'include' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const { nextCode } = await resp.json();   // ← vem do server
  return nextCode;                          // ex.: 21007
}

 // 🔹 NOVO helper – dispara a API
 export async function gerarEtiqueta(numeroOP, codigo) {
   // 1) Se for local, sempre TESTE
   // 2) Se for produção (não local), decide pela prefixo 'FT':
   //      FT → Linha de producao
   //      outro → Quadro eletrico
   let tipo;
   if (isLocal) {
     tipo = 'Teste';
   } else if (codigo.startsWith('FT')) {
     tipo = 'Linha de producao';
   } else {
     tipo = 'Quadro eletrico';
   }
   const payload = JSON.stringify({ numeroOP, codigo, tipo });

  const headers = { 'Content-Type': 'application/json' };

   // 1) Gera o .zpl na pasta determinada acima
   await fetch(
     `/api/etiquetas?token=${encodeURIComponent(ZPL_TOKEN)}`,
     { method: 'POST', headers, body: payload }
   );

  // ---- Removido o fetch direto ao PC ----
}


// ───── Etiqueta PP (Matéria-Prima / Preparação) ───────────────
// kanban_base.js  – substitua APENAS o corpo da gerarEtiquetaPP
export function gerarEtiquetaPP({ codMP, op, descricao = '' }) {
  /* ajuste aqui até ficar no local ideal -------------------------- */
  const DX = 100;      // deslocamento horizontal
  const DY = 0;      // deslocamento vertical
  /* --------------------------------------------------------------- */

  const agora = new Date();
  const dataHora =
    agora.toLocaleDateString('pt-BR') + ' ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  /* helper p/ somar offset às coordenadas ------------------------- */
  const fo = (x, y) => `^FO${x + DX},${y + DY}`;

  return `
^XA
^FWB
${fo(7, 10)}
^BQN,2,4
^FDQA,${codMP}-${op}^FS

${fo(135, 10)}
^A0B,40,35
^FD ${codMP} ^FS

${fo(170, 50)}
^A0B,20,20
^FD ${dataHora} ^FS

${fo(180, 0)}
^A0B,23,23
^FB320,1,0,L,0
^FD --------------- ^FS

${fo(20, 0)}
^A0B,20,20
^FB230,2,0,L,0
^FD OP: ${op} ^FS

${fo(196, 0)}
^A0B,23,23
^FB320,1,0,L,0
^FD --------------- ^FS

${fo(210, 10)}
^A0B,23,23
^FB220,8,0,L,0
^FD ${descricao || 'SEM DESCRIÇÃO'} ^FS

${fo(110, 10)}
^A0B,20,20
^FB225,1,0,L,0
^FD FT-M00-ETQP - REV01 ^FS
^XZ`.trim();
}



/**
 * Gera etiqueta curta “Pedido em separação”.
 * Cria o arquivo em etiquetas/Teste/sep_<pedido>.zpl
 */
// …kanban_base.js
export async function gerarEtiquetaSeparacao (codigo, pedido, ns = '') {




  /* ── Consulta OMIE p/ descrição + obs_venda ───────────────────── */
  let descProd = '';
  let obsVenda = '';
let itemsStr = '';          // <- aqui

  try {
    const numPed = pedido;           // evita colidir com o parâmetro
    const resp = await fetch('/api/omie/pedido', {
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({ param:[{ numero_pedido: numPed }] })
    });
    const json = await resp.json();

    // pega o objeto do pedido
    const pedOmie = Array.isArray(json.pedido_venda_produto)
                  ? json.pedido_venda_produto[0]
                  : json.pedido_venda_produto;

    // acha a linha do produto
    const det = (pedOmie.det || []).find(
      d => d?.produto?.codigo === codigo
    );

    descProd = det?.produto?.descricao || '';
    obsVenda = pedOmie?.observacoes?.obs_venda || '';

    // ——— monta texto “Código – quantidade” (1 linha por item) ———
const detArray = Array.isArray(pedOmie.det) ? pedOmie.det : [];
            // ← “\&” quebra de linha
 const pad = 12;                // largura máxima do código
 itemsStr = detArray
   .map(d => {
     const qtd = String(d.produto.quantidade).padStart(4, ' '); // alinhar à dir.
     const cod = String(d.produto.codigo).padEnd(pad, ' ');
     return `${qtd}  ${cod}`;
   })
   .join('\\&');                // \& = nova linha em ^FH_ modo
        //  “\&” = quebra de linha (^FH_ ativo)


  } catch (err) {
    console.error('[gerarEtiquetaSeparacao] falhou →', err);
    alert('❌ Falha ao gerar etiqueta:\n' + err.message);
  }




  const nomeArq = `etiqueta_${ns || pedido}.zpl`;   // prefixo que o watcher reconhece



const zpl = `
^XA
^CI28
^PW600
^LH0,0

; ---------- Título ----------
^CF0,60
^FO40,60^FDSeparar produto:^FS
^FO40,120^FH_^FDPedido: ${pedido}^FS

; ---------- Código ----------
^CF0,30
^FO250,200^FH_^FDCod.: ${codigo}^FS

; ---------- QR-Code (esquerda) ----------
^FO40,200
^BQN,4,8
^FH_^FDLA,${ns || pedido}^FS

; ---------- Descrição (à direita do QR) ----------
^FO250,240
^A0N,30,30
^FB300,6,0,L
^FH_^FD${descProd}^FS

; ---------- Número-de-Série ----------
^CF0,40
^FO40,400^FDNS: ${ns || 'SN'}^FS

; ---------- Observação (quebra em 40) ----------
^CF0,28
^FO40,440^FH_^FDObs.: ${obsVenda.slice(0,40)}^FS
^FO40,480^FH_^FD${obsVenda.slice(40,80)}^FS

; ---------- Itens do pedido ----------
^CF0,30
^FO40,520^FDItens do pedido ${pedido}:^FS
^A0N,26,26
^FO40,560
^FB520,10,0,L
^FH_^FD${itemsStr}^FS        ; linhas “qtd – cod”

^XZ
`.trim();
;


// decide a pasta onde o .zpl será salvo
const pastaTipo = isLocal ? 'Teste' : 'Expedicao';

await fetch('/api/etiquetas/gravar', {
  method : 'POST',
  headers: { 'Content-Type':'application/json' },
  body   : JSON.stringify({
    file: nomeArq,
    zpl,
    ns,
    tipo: pastaTipo          // ← aqui a mágica
  })
});

}

/* ───────────────── Etiqueta de OBSERVAÇÃO ───────────────────── */
/**
 * Gera uma etiqueta só com o texto do campo Observações
 * e grava em etiquetas/Teste  (local)  ou  etiquetas/Expedicao (prod).
 * Quebra o texto a cada 48 colunas automaticamente.
 */
export function gerarEtiquetaObs (texto) {
  /* 1) remove quebras manuais e deixa o ^FB quebrar sozinho */
  const txtLimpo = texto.replace(/\r?\n+/g, ' ').trim();   // limpa CR/LF extras

  /* 2) data + hora no formato  dd/mm/aaaa HH:MM  */
  const dataHora = new Date().toLocaleString('pt-BR', { hour12:false });

  /* 3) monta ZPL  */
  const zpl = `
^XA
^CI28
^PW600
^LL640                   ; cobre até 20 linhas de 26 pt
^CF0,30
^FO40,30^FD↑ destacar aqui ↑ ${dataHora}^FS
^FO40,70^FDDados adicionais:^FS

^A0N,26,26
^FO40,130
^FB520,20,0,L            ; larg. 520 px, máx. 20 linhas
^FH_^FD${txtLimpo}^FS

^XZ`.trim();

  /* 4) envia ao backend */
  const nomeArq = `obs_${Date.now()}.zpl`;
  const pasta   = isLocal ? 'Teste' : 'Expedicao';

  return fetch('/api/etiquetas/gravar', {
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify({ file:nomeArq, zpl, tipo:pasta })
  });
}




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


/**
 * Salva o array em:
 *   • /api/kanban              → Comercial
 *   • /api/kanban_preparacao  → Preparação
 */
export async function salvarKanbanLocal(items, board = 'comercial') {
  const rota = board === 'preparacao'
             ? '/api/kanban_preparacao'
             : '/api/kanban';

  /* 1) Lê o arquivo atual p/ não perder histórico -------------------- */
  let antigos = [];
  try {
    const r = await fetch(`${API_BASE}${rota}`);
    if (r.ok) antigos = await r.json();
  } catch { /* se falhar, continua com [] */ }

  /* 2) Mescla quantidade e local onde pedido+codigo coincidem -------- */
  items.forEach(novo => {
    const old = antigos.find(a =>
      a.pedido === novo.pedido && a.codigo === novo.codigo);
    if (old) {
      old.quantidade = novo.quantidade;           // já somada antes
      old.local = Array.from(new Set([...old.local, ...novo.local]));

    } else {
      antigos.push(novo);
    }
  });

  /* 3) Grava a versão mesclada --------------------------------------- */
  const resp = await fetch(`${API_BASE}${rota}`, {
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify(antigos, null, 2)
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`[salvarKanbanLocal] HTTP ${resp.status}: ${txt}`);
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


/* ───────── clique simples vs. duplo ───────── */
li.addEventListener('click', ev => {
  /* se não é da coluna Pedido aprovado, ignore */
  if (li.dataset.column !== 'Pedido aprovado') return;

  /* 2 cliques? cancela o pending do single e sai */
  if (ev.detail > 1) {
    if (clickTimerId) {
      clearTimeout(clickTimerId);
      clickTimerId = null;
    }
    return;                       // deixa o dblclick agir
  }

  /* clique simples → agenda abrir PCP */
 clickTimerId = setTimeout(async () => {   //  ⬅️ torna o callback assíncrono
    clickTimerId = null;          // libera para o próximo

    const idx = +li.dataset.index;
    const it  = itemsKanban[idx];
    if (!it) return;

    /* 1) preenche o campo do “+” */
    const col = document.getElementById('coluna-pcp-aprovado')
                 ?.closest('.kanban-column');
    const inp = col?.querySelector('.add-search');
    if (!inp) return;
    inp.value = `${it.codigo} — ${it.codigo}`;

    /* 2) ativa a aba PCP */
    document
      .querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')
      ?.click();

    /* 3) busca obs_venda do pedido e preenche o campo Observações  */
    try {
      const payload = {
        call      : 'ConsultarPedido',
        app_key   : OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param     : [{ numero_pedido: it.pedido }]
      };

      const resp = await fetch(`${API_BASE}/api/omie/pedido`, {
        method : 'POST',
        headers: { 'Content-Type':'application/json' },
        body   : JSON.stringify(payload)
      });
      const json = await resp.json();

      /* garante sempre um objeto único */
      const ped = Array.isArray(json.pedido_venda_produto)
                ? json.pedido_venda_produto[0]
                : json.pedido_venda_produto || {};

      /* ➊ pega obs_venda — default = '' */
      let obs = ped.observacoes?.obs_venda ?? '';

      /* ➋ decodifica &quot; → " e extrai só o interior das aspas   */
      obs = obs.replace(/&quot;/g, '"');
      const m = obs.match(/"([^"]+)"/);
      if (m) obs = m[1];                   // só o texto dentro das aspas

      /* ➌ espera o textarea existir e grava o valor                */
      const setObs = txt => {
        const el = document.getElementById('pcp-obs');
        if (el) { el.value = txt; }
        else    { setTimeout(() => setObs(txt), 100); }
      };
      setObs(obs);

    } catch (err) {
      console.error('[PCP-obs] falha ao obter obs_venda:', err);
    }

  }, 350);   // um pouco acima do tempo típico de dbl-click
});
/* ───────────────────────────────────────────── */


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
  const ticketsParaImprimir = [];

  e.preventDefault();
  ul.classList.remove('drop-expand');
  removePlaceholder();

    /* ➊ — cria o loader ANTES de qualquer validação */
  const loadingLi = document.createElement('li');
  loadingLi.classList.add('kanban-card', 'loading');
  loadingLi.innerHTML = `
    <div class="loading-bar"><div class="progress"></div></div>`;
  ul.appendChild(loadingLi);

  // 0) Valida estado de drag
  if (draggedIndex === null || !draggedFromColumn) {
    console.log('[DROP] drag não iniciado corretamente');
    loadingLi.remove();
    return;
  }

  // 1) Identifica coluna de destino e item
  const destinationUlId = e.currentTarget.id;
  const newColumn = Object.entries(COLUMN_MAP)
    .find(([, id]) => id === destinationUlId)?.[0];
  if (!newColumn) {
    console.log('[DROP] coluna destino inválida:', destinationUlId);
    loadingLi.remove();
    return;
  }
  
  const originColumn = draggedFromColumn;
  const item = itemsKanban[draggedIndex];
  if (!item) return;

// ── DEFINIÇÕES DE ESCOPO AMPLO ─────────────────────────
const estoqueDisp   = Number(item.estoque) || 0;   // saldo atual
const qtdSolicitada = item.local.length;           // nº de etiquetas
// ───────────────────────────────────────────────────────
if (originColumn === 'Pedido aprovado' && newColumn === 'Separação logística') {

    /* ------------------------------------------------------------------
     BLOCO NOVO – move só a quantidade solicitada e controla NS
  ------------------------------------------------------------------ */

const estoqueDisp = Number(item.estoque) || 0;     // saldo atual no 105…
const pendentes   = item.local
                      .filter(l => l.startsWith('Pedido aprovado'))
                      .length;                     // só o que falta mover
const movMax      = Math.min(pendentes, estoqueDisp);


  if (movMax < 1) {
    alert('❌ Sem estoque disponível para mover.');
    loadingLi.remove();
    return;
  }

  /* 1) pergunta ao usuário */
  let qtdMover = movMax;                          // declara ANTES de usar
  if (movMax > 1) {
    const entrada = prompt(
      `Quantas unidades deseja mover? (1 – ${movMax})`,
      String(movMax)
    );
    if (entrada === null) {                      // Cancelar
      loadingLi.remove();
      return;
    }
    qtdMover = parseInt(entrada, 10);
    if (!qtdMover || qtdMover < 1 || qtdMover > movMax) {
      alert('Valor inválido.');
      loadingLi.remove();
      return;
    }


    /* ------------------------------------------------------------------
   1) registra a movimentação de estoque no OMIE
   ------------------------------------------------------------------ */
try {
  const payloadAjuste = {
    call: 'IncluirAjusteEstoque',
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      codigo_local_estoque        : 10520299822,
      codigo_local_estoque_destino: 10564345392,
      id_prod : item._codigoProd,                          // ← do Kanban
      data    : new Date().toLocaleDateString('pt-BR'),    // dd/mm/aaaa
      quan    : String(qtdMover),                          // quantidade movida
      obs     : `Movimentação de pedido de venda ${item.pedido}`,
      origem  : 'AJU',
      tipo    : 'TRF',
      motivo  : 'TRF',
      valor   : 10
    }]
  };
console.log('[PP→SL] payloadAjuste →',
            JSON.stringify(payloadAjuste, null, 2));   //  ⬅️  ADICIONE
  await fetch('/api/omie/estoque/ajuste', {
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify(payloadAjuste)
  });
} catch (e) {
  console.warn('[PP→SL] falha ao registrar ajuste de estoque:', e);
  // não bloqueia o fluxo principal – apenas loga
}

  }

  /* 2) coleta números-de-série no back-end */
  const nsMovidos = [];
  for (let i = 0; i < qtdMover; i++) {
    const resp = await fetch(
      `/api/serie/next/${encodeURIComponent(item.codigo)}`
    );
    const { ns } = await resp.json();             // p.ex. 101002
    nsMovidos.push(ns);
  }


  /* ─── NOVO: imprime 2ª etiqueta se houver observação ─── */
const campoObs = document.getElementById('pcp-obs');
if (campoObs && campoObs.value.trim()) {
  await gerarEtiquetaObs(campoObs.value.trim());
}


  /* 3) imprime uma etiqueta (Pedido em separação) para cada NS */
  for (const serie of nsMovidos) {
    // dentro do for (const serie of nsMovidos) { … }
await gerarEtiquetaSeparacao(item.codigo, item.pedido, serie);





  }

  /* 4) grava o NS no array local, só nas posições movidas */
  let movidos = 0;
  item.local = item.local.map(coluna => {
    if (
      movidos < qtdMover &&
      coluna.startsWith('Pedido aprovado')
    ) {
      const serie = nsMovidos[movidos++];
      return `${newColumn},${serie}`;             // “Separação logística,101002”
    }
    return coluna;                                // mantém as demais
  });

  /* 5) baixa o estoque do cartão */
  item.estoque = Math.max(0, estoqueDisp - qtdMover);

  /* 6) persiste e re-renderiza */
  await salvarKanbanLocal(itemsKanban);
  renderKanbanDesdeJSON(itemsKanban);
  enableDragAndDrop(itemsKanban);

  loadingLi.remove();
  draggedIndex = null;
  draggedFromColumn = null;
  return;                                         // impede código antigo
}


ul.classList.remove('drop-expand');
removePlaceholder();

  
  // 3) Atualiza imediatamente o modelo local
const idxLocal = item.local.findIndex(
  c => c.split(',')[0] === originColumn      // ← olha só a coluna
);

if (idxLocal !== -1) {
  const ticket = await gerarTicket();
  ticketsParaImprimir.push({ ticket, codigo: item.codigo });
      // ← para imprimir depois
  item.local[idxLocal] = `${newColumn},${ticket}`;
  item.estoque = Math.max(0, item.estoque - 1); // baixa 1 do saldo
}


if (
  originColumn === 'Pedido aprovado' &&
  newColumn    === 'Separação logística' &&
  item.estoque >= item.local.length      // saldo era suficiente
) {
  item.local.forEach(l => {
    const ticket = l.split(',')[1];      // “F06250142”
    ticketsParaImprimir.push({ ticket, codigo: item.codigo });

  });
}



  /* se o movimento foi 100 % do cartão (saldo suficiente),
   precisamos imprimir 1 etiqueta para CADA ticket que saiu */
if (
  originColumn === 'Pedido aprovado' &&
  newColumn    === 'Separação logística' &&
  estoqueDisp  >= qtdSolicitada        // ⇢ estamos no caso “saldo suficiente”
) {
  item.local.forEach(l => {
    const ticket = l.split(',')[1];    // pega só “F06250142”
    ticketsParaImprimir.push({ ticket, codigo: item.codigo });

  });
}


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

 const isPPtoSL = originColumn === 'Pedido aprovado' &&
                  newColumn    === 'Separação logística';

 if ( !isPPtoSL &&                                           // ← pula PP→SL
      (tipoItem === '04' || parseInt(tipoItem, 10) === 4) ) {
const cCodIntOP = await gerarTicket();   // já vem sequencial do backend
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

    // 6.1) Dispara a impressão de tudo que foi acumulado
for (const tObj of ticketsParaImprimir) {
  // cada tObj agora é { ticket, codigo }
  if (tObj.ticket) await gerarEtiqueta(tObj.ticket, tObj.codigo);
}


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
