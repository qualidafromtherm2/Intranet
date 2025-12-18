// kanban_base.js
import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;

const getKanbanEndpoint = destino =>
  destino === 'preparacao' ? '/api/preparacao/listar' : '/api/kanban';

// Define a URL-base das chamadas à API: usa window.location.origin
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
  "Pedido aprovado":     "coluna-comercial",
  "Aguardando prazo":   "coluna-pcp-aprovado",
  "Fila de produção":    "coluna-pcp-op"
};

let placeholder = null;
let ulListenersInitialized = false;
let draggedIndex = null;
let draggedFromColumn = null;
/* controla a diferença entre click e dblclick */
let clickTimerId = null;        // null = nenhum clique pendente

// URL base da API ('' = mesma origem; se quiser, defina window.API_BASE em algum <script>)
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '';

// Helper p/ salvar etiqueta no banco + roteirização por código (04.PP => Preparação elétrica)
async function salvarEtiquetaNoDB({
  numero_op,
  codigo_produto,
  tipo_etiqueta,
  zpl,
  usuario = null,
  observacoes = null
}) {
  const ehPrepEletrica = /^04\.PP\b/.test(String(codigo_produto || ''));
  const local_impressao = ehPrepEletrica ? 'Preparação elétrica' : 'Produção';

  const resp = await fetch(`${API_BASE}/api/etiquetas/salvar-db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      numero_op,
      codigo_produto,
      tipo_etiqueta,
      local_impressao,
      conteudo_zpl: zpl,
      usuario_criacao: usuario,
      observacoes
    })
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => '');
    throw new Error(`Falha ao salvar etiqueta no DB: ${resp.status} ${msg}`);
  }
  return resp.json();
}

function ddmmyyyy(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

/**
 * Cria OP na OMIE para o item do Kanban.
 * Resolve nCodProduto se não estiver em item._codigoProd.
 * Lê JSON da resposta e lança erro com faultstring quando houver.
 */
export async function incluirOP_omie(item, diasPrazo = 1) {
  if (!item || !item.codigo) throw new Error('Item inválido.');

  // Data de previsão (amanhã por padrão)
  const now = new Date();
  const when = new Date(now.getTime() + diasPrazo * 24 * 60 * 60 * 1000);
  const dDtPrevisao = ddmmyyyy(when);

  // Garante nCodProduto
  let nCodProduto = Number(item._codigoProd) || 0;
  if (!nCodProduto) {
    const respDet = await fetch(`/api/produtos/detalhes/${encodeURIComponent(item.codigo)}`);
    const detJson = await respDet.json().catch(() => ({}));
    nCodProduto = Number(
      detJson?.codigo_prod ||
      detJson?.codigo_produto ||
      detJson?.produto?.codigo_produto ||
      0
    );
  }
  if (!nCodProduto) {
    throw new Error('nCodProduto ausente (não foi possível mapear o produto).');
  }

  const payloadOP = {
    call: 'IncluirOrdemProducao',
    // pode mandar a chave aqui ou deixar o servidor injetar via env
    app_key: OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      identificacao: {
        cCodIntOP: String(Date.now()),
        dDtPrevisao,
        nCodProduto,
        nQtde: 1,
        codigo_local_estoque: 10564345392 // ajuste se usar env no servidor
      }
    }]
  };

  // Envia ao backend (que repassa para OMIE)
// ==== LOG DE ENVIO DA OP (FRONT: kanban_base.js) ====
const payloadMasked = (() => {
  const p = JSON.parse(JSON.stringify(payloadOP || {}));
  if (p?.app_secret) p.app_secret = String(p.app_secret).slice(0,2) + '***' + String(p.app_secret).slice(-2);
  return p;
})();

console.groupCollapsed('%c[OP][FRONT] POST /api/omie/produtos/op', 'color:#09f');
console.log('Headers:', { 'Content-Type': 'application/json' });
console.log('Payload OP (mask):', payloadMasked);
console.groupEnd();

const t0 = performance.now();
const resp = await fetch(`${API_BASE}/api/omie/produtos/op`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payloadOP)
});
const dataOP = await resp.json().catch(() => ({}));
const dt = (performance.now() - t0).toFixed(0);

console.groupCollapsed('%c[OP][FRONT] RESPOSTA /api/omie/produtos/op', 'color:#0a0');
console.log('Status:', resp.status, resp.statusText, `(${dt}ms)`);
console.log('Body:', dataOP);
console.groupEnd();

if (!resp.ok) {
  const msg = dataOP?.faultstring || dataOP?.message || '';
  throw new Error(`HTTP ${resp.status}${msg ? ' - ' + msg : ''}`);
}
if (dataOP?.faultstring || dataOP?.error) {
  const msg = dataOP?.faultstring || dataOP?.error?.message || 'Falha OMIE';
  throw new Error(msg);
}


  // Sempre leia o corpo para obter faultstring
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.faultstring || data?.message || '';
    throw new Error(`HTTP ${resp.status}${msg ? ' - ' + msg : ''}`);
  }
  if (data?.faultstring || data?.error) {
    const msg = data?.faultstring || data?.error?.message || 'Falha OMIE';
    throw new Error(msg);
  }

  return data;
}
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


// grava direto no SQL (roteia por código: 04.PP → “Preparação elétrica”, senão “Produção”)
await salvarEtiquetaNoDB({
  numero_op: String(pedido),
  codigo_produto: String(codigo),
  tipo_etiqueta: 'Pedido em separacao',
  zpl,                           // usa o ZPL montado acima
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

return salvarEtiquetaNoDB({
  numero_op: String(pedido),
  codigo_produto: String(codigo),
  tipo_etiqueta: 'Observacao',
  zpl,
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
  card.setAttribute('draggable', 'false');
}

const pad2 = (n) => String(n).padStart(2, '0');

function parseDateTimeParts(value) {
  if (!value) return null;

  const fromDate = (d) => {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return {
      date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      hour: pad2(d.getHours()),
      minute: pad2(d.getMinutes()),
      second: pad2(d.getSeconds())
    };
  };

  if (value instanceof Date) {
    return fromDate(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const dt = new Date(raw);
    const parsed = fromDate(dt);
    if (parsed) return parsed;
  }

  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return {
      date: match[1],
      hour: match[2],
      minute: match[3],
      second: match[4] || '00'
    };
  }

  const onlyDate = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (onlyDate) {
    return {
      date: onlyDate[1],
      hour: '00',
      minute: '00',
      second: '00'
    };
  }

  return null;
}

const normalizeStage = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();


function getUlIdByColumn(columnName) {
  return COLUMN_MAP[columnName] || COLUMN_MAP["Pedido aprovado"];
}

function formatDateDisplay(iso, etapa = '') {
  const etapaNorm = normalizeStage(etapa);
  if (etapaNorm === 'produzindo') return 'Produzindo';
  if (etapaNorm === 'excluido') return 'Excluído';

  const parts = parseDateTimeParts(iso);
  if (!parts) return '—';
  const [yyyy, mm, dd] = parts.date.split('-');
  return `${dd}/${mm}/${yyyy} ${parts.hour}:${parts.minute}`;
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
  const escapeAttr = value =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;');

  Object.values(COLUMN_MAP).forEach(ulId => {
    const ul = document.getElementById(ulId);
    if (ul) ul.innerHTML = '';
  });

  itemsKanban.forEach((item, index) => {
    const counts = Array.isArray(item.local)
      ? item.local.reduce((acc, raw) => {
          const col = raw.split(',')[0];
          acc[col] = (acc[col] || 0) + 1;
          return acc;
        }, {})
      : {};
    if (!Object.keys(counts).length && item.aguardandoPrazo) {
      counts['Aguardando prazo'] = item.quantidade || 0;
    }

    Object.entries(counts).forEach(([columnName, count]) => {
      const ulId = getUlIdByColumn(columnName);
      const ul = document.getElementById(ulId);
      if (!ul) return;

      const li = document.createElement('li');
      li.classList.add('kanban-card');
      li.setAttribute('draggable', 'false');
      li.dataset.index  = index;
      li.dataset.column = columnName;
      li.dataset.codigo = item.codigo || '';

      if (columnName === 'Aguardando prazo') {
        const localLabel = item.local_impressao_label || item.local_impressao || 'Sem local';
        const grupos = Array.isArray(item.grupos) ? item.grupos : [];
        const gruposHtml = grupos.map(grupo => {
          const opsHtml = grupo.ops.map(op => `<div class=\"kanban-op-line\">${op.numero_op || op}</div>`).join('');
          const safeLocal = escapeAttr(localLabel);
          const safeCodigo = escapeAttr(grupo.codigo || '');
          const firstPedido = Array.isArray(grupo.pedidos) && grupo.pedidos.length
            ? grupo.pedidos[0].numero_pedido || ''
            : '';
          const pedidoAttr = firstPedido
            ? ` data-pedido=\"${escapeAttr(firstPedido)}\"`
            : '';
          // Botões com seletores originais para disparar modais/calendário
          const botoesHtml = `
            <div class=\"kanban-card-actions\" style=\"display:flex; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1);\">
              <button class=\"btn-kanban kanban-modal-trigger\" title=\"Definir prazo\" data-codigo=\"${safeCodigo}\" data-local=\"${safeLocal}\" data-coluna=\"${escapeAttr(columnName)}\">
                <i class=\"far fa-calendar-alt\"></i> Definir prazo
              </button>
              <button class=\"btn-kanban kanban-stock-trigger\" title=\"Consultar estoque\" data-codigo=\"${safeCodigo}\"${pedidoAttr}>
                <i class=\"fas fa-boxes\"></i> Estoque
              </button>
            </div>
          `;
          return `
            <div class=\"kanban-code-block kanban-code-block-collapsed\">
              <div class=\"kanban-code-header\" style=\"cursor:pointer;\">
                <span>${grupo.codigo || 'Sem código'}</span>
                <span class=\"kanban-code-count\">Qtd ${grupo.quantidade || grupo.ops.length}</span>
                <i class=\"fas fa-chevron-down kanban-toggle-icon\"></i>
              </div>
              <div class=\"kanban-op-list\" style=\"display:none;\">${opsHtml}</div>
              <div class=\"kanban-card-actions-wrapper\" style=\"display:none;\">
                ${botoesHtml}
              </div>
            </div>
          `;
        }).join('');

        li.innerHTML = `
          <div class=\"kanban-card-meta\">${localLabel}</div>
          ${gruposHtml}
        `;
        li.dataset.opsCount = grupos.reduce((acc, g) => acc + (g.quantidade || g.ops?.length || 0), 0);
        li.dataset.localImpressao = item.local_impressao || localLabel.toUpperCase();
        li.setAttribute('draggable', 'false');
        li.classList.add('kanban-card-local');
        
        // Adiciona eventos de expandir/recolher
        setTimeout(() => {
          li.querySelectorAll('.kanban-code-header').forEach(header => {
            header.addEventListener('click', (ev) => {
              if (ev.target.closest('.btn-kanban')) return;
              
              const block = header.closest('.kanban-code-block');
              const wasCollapsed = block.classList.contains('kanban-code-block-collapsed');
              
              // Recolhe todos os outros blocos do mesmo card
              li.querySelectorAll('.kanban-code-block').forEach(b => {
                b.classList.add('kanban-code-block-collapsed');
                const opList = b.querySelector('.kanban-op-list');
                const actions = b.querySelector('.kanban-card-actions-wrapper');
                const icon = b.querySelector('.kanban-toggle-icon');
                if (opList) opList.style.display = 'none';
                if (actions) actions.style.display = 'none';
                if (icon) {
                  icon.classList.remove('fa-chevron-up');
                  icon.classList.add('fa-chevron-down');
                }
              });
              
              // Expande o bloco clicado se estava recolhido
              if (wasCollapsed) {
                block.classList.remove('kanban-code-block-collapsed');
                const opList = block.querySelector('.kanban-op-list');
                const actions = block.querySelector('.kanban-card-actions-wrapper');
                const icon = block.querySelector('.kanban-toggle-icon');
                if (opList) opList.style.display = 'block';
                if (actions) actions.style.display = 'block';
                if (icon) {
                  icon.classList.remove('fa-chevron-down');
                  icon.classList.add('fa-chevron-up');
                }
              }
            });
          });
        }, 0);
      } else if (columnName === 'Fila de produção') {
        const localLabel = item.local_impressao_label || item.local_impressao || 'Sem local';
        const grupos = Array.isArray(item.grupos) ? item.grupos : [];
        const gruposHtml = grupos.map(grupo => {
          const opsHtml = grupo.ops.map(op => {
            const display = formatDateDisplay(op.data_impressao, op.etapa);
            return `
              <div class=\"kanban-op-line\">\n                <span>${op.numero_op || op}</span>\n                <span class=\"kanban-op-date\">${display}</span>\n              </div>\n            `;
          }).join('');
          const safeLocal = escapeAttr(localLabel);
          const safeCodigo = escapeAttr(grupo.codigo || '');
          const firstPedido = Array.isArray(grupo.pedidos) && grupo.pedidos.length
            ? grupo.pedidos[0].numero_pedido || ''
            : '';
          const pedidoAttr = firstPedido
            ? ` data-pedido=\"${escapeAttr(firstPedido)}\"`
            : '';
          // Botões com seletores originais para disparar modais/calendário
          const botoesHtml = `
            <div class=\"kanban-card-actions\" style=\"display:flex; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.1);\">
              <button class=\"btn-kanban kanban-modal-trigger\" title=\"Redefinir prazo\" data-codigo=\"${safeCodigo}\" data-local=\"${safeLocal}\" data-coluna=\"${escapeAttr(columnName)}\">
                <i class=\"fas fa-calendar-alt\"></i> Redefinir prazo
              </button>
              <button class=\"btn-kanban kanban-stock-trigger\" title=\"Consultar estoque\" data-codigo=\"${safeCodigo}\"${pedidoAttr}>
                <i class=\"fas fa-boxes\"></i> Estoque
              </button>
            </div>
          `;
          return `
            <div class=\"kanban-code-block kanban-code-block-collapsed\">
              <div class=\"kanban-code-header\" style=\"cursor:pointer;\">
                <span>${grupo.codigo || 'Sem código'}</span>
                <span class=\"kanban-code-count\">Qtd ${grupo.quantidade || grupo.ops.length}</span>
                <i class=\"fas fa-chevron-down kanban-toggle-icon\"></i>
              </div>
              <div class=\"kanban-op-list\" style=\"display:none;\">${opsHtml}</div>
              <div class=\"kanban-card-actions-wrapper\" style=\"display:none;\">
                ${botoesHtml}
              </div>
            </div>
          `;
        }).join('');

        li.innerHTML = `
          <div class=\"kanban-card-meta\">${localLabel}</div>
          ${gruposHtml}
        `;
        li.dataset.opsCount = grupos.reduce((acc, g) => acc + (g.quantidade || g.ops?.length || 0), 0);
        li.dataset.localImpressao = item.local_impressao || localLabel.toUpperCase();
        li.setAttribute('draggable', 'false');
        li.classList.add('kanban-card-local', 'kanban-card-production');
        
        // Adiciona eventos de expandir/recolher
        setTimeout(() => {
          li.querySelectorAll('.kanban-code-header').forEach(header => {
            header.addEventListener('click', (ev) => {
              if (ev.target.closest('.btn-kanban')) return;
              
              const block = header.closest('.kanban-code-block');
              const wasCollapsed = block.classList.contains('kanban-code-block-collapsed');
              
              // Recolhe todos os outros blocos do mesmo card
              li.querySelectorAll('.kanban-code-block').forEach(b => {
                b.classList.add('kanban-code-block-collapsed');
                const opList = b.querySelector('.kanban-op-list');
                const actions = b.querySelector('.kanban-card-actions-wrapper');
                const icon = b.querySelector('.kanban-toggle-icon');
                if (opList) opList.style.display = 'none';
                if (actions) actions.style.display = 'none';
                if (icon) {
                  icon.classList.remove('fa-chevron-up');
                  icon.classList.add('fa-chevron-down');
                }
              });
              
              // Expande o bloco clicado se estava recolhido
              if (wasCollapsed) {
                block.classList.remove('kanban-code-block-collapsed');
                const opList = block.querySelector('.kanban-op-list');
                const actions = block.querySelector('.kanban-card-actions-wrapper');
                const icon = block.querySelector('.kanban-toggle-icon');
                if (opList) opList.style.display = 'block';
                if (actions) actions.style.display = 'block';
                if (icon) {
                  icon.classList.remove('fa-chevron-down');
                  icon.classList.add('fa-chevron-up');
                }
              }
            });
          });
        }, 0);
      } else if (columnName === 'Pedido aprovado') {
        const desc = item.descricao || '';
        const pedidosHtml = (item.pedidos || []).map(p => `
          <div class="kanban-op-line">
            <span>Pedido ${p.numero_pedido || '—'}</span>
            <span class="kanban-op-date">Qtd ${p.quantidade || 0}</span>
          </div>
        `).join('');
        li.innerHTML = `
          <div class="kanban-card-meta">${desc || 'Produto'}</div>
          <div class="kanban-code-header">
            <span>${item.codigo || 'Sem código'}</span>
            <span class="kanban-code-count">Qtd ${item.quantidade || 0}</span>
          </div>
          <div class="kanban-op-list">${pedidosHtml}</div>
        `;
        li.dataset.opsCount = item.quantidade || 0;
        li.dataset.codigo = item.codigo || '';
      } else {
        let text = `${item.pedido} – ${item.codigo} (${count})`;
        if (columnName === "Pedido aprovado") {
          text += ` | Estoque: ${item.estoque}`;
        }
        li.textContent = text;
      }


      ul.appendChild(li);
    });
  });
}

export async function openPcpForCodigo({ codigo, pedido, descricao, versao, customizacao, op } = {}) {
  console.log('[openPcpForCodigo] Recebido:', { codigo, pedido, descricao, versao, customizacao, op });
  const cleanCodigo = String(codigo || '').trim();
  if (!cleanCodigo) return;

  const map = window.__kanbanPedidosMap;
  const upper = cleanCodigo.toUpperCase();
  const entry = map && typeof map?.get === 'function'
    ? (map.get(upper) || map.get(cleanCodigo) || null)
    : null;

  let numeroPedido = String(pedido || '').trim();
  if (!numeroPedido && entry?.pedidos?.length) {
    const found = entry.pedidos.find(p => p?.numero_pedido);
    if (found) numeroPedido = String(found.numero_pedido || '').trim();
  }

  const descricaoFinal = descricao || entry?.descricao || '';
  const label = descricaoFinal
    ? `${cleanCodigo} — ${descricaoFinal}`
    : cleanCodigo;

  window.pcpCodigoAtual = cleanCodigo;
  window.pcpPedidoAtual = numeroPedido || null;

  // Armazena contexto de OP (se vier) para o carregamento da estrutura
  try {
    const ctx = {};
    if (versao != null && String(versao).trim() !== '') ctx.versao = String(versao).trim();
    if (customizacao != null && String(customizacao).trim() !== '') ctx.customizacao = String(customizacao).trim();
    if (op != null && String(op).trim() !== '') ctx.op = String(op).trim();
    if (Object.keys(ctx).length) {
      window.pcpContext = ctx; // usado por fetchEstruturaPCP_SQL
      console.log('[openPcpForCodigo] window.pcpContext definido:', JSON.stringify(ctx));
    } else {
      // se não há contexto explícito, limpa para evitar reaproveitar antigo
      window.pcpContext = undefined;
      console.log('[openPcpForCodigo] window.pcpContext limpo (sem contexto)');
    }
  } catch {}

  const col = document.getElementById('coluna-pcp-aprovado')?.closest('.kanban-column');
  const inp = col?.querySelector('.add-search');
  if (inp) inp.value = label;

  window.setPCPProdutoCodigo?.(cleanCodigo);
  document
    .querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')
    ?.click();

  if (typeof window.ensurePCPEstruturaAutoLoad === 'function') {
    await window.ensurePCPEstruturaAutoLoad();
  }

  const resetObs = (txt = '') => {
    const el = document.getElementById('pcp-obs');
    if (el) el.value = txt;
    else setTimeout(() => resetObs(txt), 100);
  };

  if (!numeroPedido) {
    resetObs('');
    return;
  }

  // Integração OMIE removida: mantemos apenas a limpeza do campo de observações.
  resetObs('');
}

export function enableDragAndDrop(itemsKanban) {
  document.querySelectorAll('.kanban-card').forEach(li => {
    li.setAttribute('draggable', 'false');

    li.addEventListener('click', ev => {
      if (li.dataset.column !== 'Pedido aprovado') return;

      if (ev.detail > 1) {
        if (clickTimerId) {
          clearTimeout(clickTimerId);
          clickTimerId = null;
        }
        return;
      }

      clickTimerId = setTimeout(async () => {
        clickTimerId = null;

        const idx = parseInt(li.dataset.index, 10);
        const it  = itemsKanban[idx];
        if (!it) return;

        const codigo = String(li.dataset.codigo || it.codigo || '').trim();
        if (!codigo) return;

        const pedidos = Array.isArray(it.pedidos) ? it.pedidos : [];
        const preferido = String(it.pedido || (pedidos[0]?.numero_pedido) || '').trim();

        await openPcpForCodigo({
          codigo,
          pedido: preferido,
          descricao: it.descricao
        });
      }, 300);
    });
  });
}
 

// ──────────────────────────────────────────────────────────────
// Persistência do Kanban (stub seguro)
// Se quiser salvar no servidor depois, é só trocar o console.debug por um fetch.
// ──────────────────────────────────────────────────────────────
export async function salvarKanbanLocal(itemsKanban, destino = 'comercial') {
  try {
    console.debug('[salvarKanbanLocal]', destino, (itemsKanban && itemsKanban.length) || 0);
    // Exemplo futuro (quando quiser persistir de verdade):
    // await fetch(`${window.location.origin}/api/kanban/salvar`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ destino, items: itemsKanban }),
    // });
    return true;
  } catch (err) {
    console.warn('[salvarKanbanLocal] falha não crítica:', err);
    return false;
  }
}
