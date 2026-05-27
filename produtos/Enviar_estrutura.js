/* =======================================================================
 *  produtos/Enviar_estrutura.js
 *  ---------------------------------------------------------------
 *  • Pré-carrega posição de estoque (ListarPosEstoque) ao abrir a SPA
 *    – 50 itens por página, chamadas em série (intervalo 1,2 s).
 *  • Guarda cache em window.__posEstoqueCache e Promise __posEstoqueReady
 *  • Preenche coluna “Custo real” a partir do cache, sem logs nem CSV
 * ======================================================================= */

// === KILL-SWITCH DA OMIE (evita /api/omie/estoque/consulta) ===
// Se já existir a função, esta substituição entra depois do load:
// Evita consumir Omie na navegação normal
window.buildPosEstoqueCache = async function() { return {}; };

/* === DEBUG helper ==================================================== */
function dbg(...msg) {
  // prefixo comum para facilitar o filtro no DevTools  
  console.log('[PedidoCompra]', ...msg);
}

function hojeDDMMYYYY() {
  const d = new Date();
  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = d.getFullYear();
  return `${day}/${month}/${year}`;
}


/* --------------------- PARÂMETROS ------------------------------------ */
const PAGE_SIZE = 50;
const PAUSE_MS  = 1200;            // 1,2 s entre páginas

const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : 'https://intranet-30av.onrender.com';

/* ----------------------- SPINNER ------------------------------------ */
const $ = id => document.getElementById(id);
function updatePct(p) {
  const sp = $('estoqueSpinner'); if (!sp) return;
  p = Math.round(Math.max(0, Math.min(100, p)));
  sp.setAttribute('data-pct', p);
  const circ = sp.querySelector('#barEst');
  const len  = Math.PI * 2 * +circ.getAttribute('r');
  circ.style.strokeDashoffset = ((100 - p) / 100) * len;
}
function showSpinner() { const b=$('estoqueSpinnerBox'); if(b){b.style.display='flex'; updatePct(0);} }
function hideSpinner() { const b=$('estoqueSpinnerBox'); if(b) b.style.display='none'; }

/* ----------------------- CACHE GLOBAL -------------------------------- */
window.__posEstoqueCache = null;   // dados prontos
window.__posEstoqueReady = null;   // Promise de carregamento

/* ------------------ CONSULTA 1 PÁGINA -------------------------------- */
async function fetchPagina(nPagina = 1) {

  const payload = {
    call: 'ListarPosEstoque',
     param: [{
       nPagina,
       nRegPorPagina: PAGE_SIZE,
       dDataPosicao:  hojeDDMMYYYY(),
       cExibeTodos:   'S',
       codigo_local_estoque: 0
     }]
   };


  const res = await fetch(`${API_BASE}/api/omie/estoque/consulta`, {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type':'application/json' },
    body:        JSON.stringify(payload)
  });

   if (!res.ok) throw new Error(await res.text());
   return res.json();
}




/* ------------------ MONTA CACHE COMPLETO ----------------------------- */
async function buildPosEstoqueCache() {
  showSpinner();

  const first   = await fetchPagina(1);
  const total   = first.nTotRegistros;
  const pages   = first.nTotPaginas;
  const prods   = [...first.produtos];

  for (let pg = 2; pg <= pages; pg++) {
    await new Promise(r => setTimeout(r, PAUSE_MS));
    prods.push(...(await fetchPagina(pg)).produtos);
    updatePct((prods.length / total) * 100);
  }

  updatePct(100);
  setTimeout(hideSpinner, 350);

  window.__posEstoqueCache = { produtos: prods };
}


/* ------------------------------------------------------------------ */
/*  Preenche coluna "Custo real" (unitário × QTD) + totais            */
/* ------------------------------------------------------------------ */

const CODIGO_SEL = '.products';      // célula código
const CUSTO_SEL  = '.custo-real';    // célula valor total
const QTD_SEL    = '.qtd';           // célula QTD

function updateCustoReal() {
  const BRL2 = { style: 'currency', currency: 'BRL' };   // 2 casas padrão

  const cache = window.__posEstoqueCache;
  if (!cache) return;

  /* 1) mapa código → custo unitário ---------------------------------- */
  const map = new Map();
  cache.produtos.forEach(p => {
    map.set(String(p.cCodigo).trim().toUpperCase(), p.nCMC);
    if (p.cCodInt)
      map.set(String(p.cCodInt).trim().toUpperCase(), p.nCMC);
  });

  /* 2) percorre linhas de item e calcula ----------------------------- */
  let totalGeral = 0;
  const totaisCat = new Map();              // <li.category-header, soma>
  let catAtual   = null;

  document.querySelectorAll('#malha > li').forEach(li => {

    /* cabeçalho fixo -------------------------------------------------- */
    if (li.classList.contains('header-row')) return;

    /* cabeçalho de categoria ----------------------------------------- */
    if (li.classList.contains('category-header')) {
      catAtual = li;
      return;
    }

    /* linha de item -------------------------------------------------- */
    const celCod = li.querySelector(CODIGO_SEL) || li.children[0];
    const celQtd = li.querySelector(QTD_SEL)    || li.children[2];
    const celCus = li.querySelector(CUSTO_SEL)  || li.children[4];
    if (!celCod || !celQtd || !celCus) return;

    const unit = map.get(celCod.textContent.trim().toUpperCase());
    if (unit === undefined) return;

    const qtd = parseFloat(
      celQtd.textContent.replace(/\./g, '').replace(',', '.')
    ) || 0;

    const total = unit * qtd;
    celCus.textContent = total.toLocaleString('pt-BR', BRL2);


    totalGeral += total;
    if (catAtual) {
      totaisCat.set(catAtual,
        (totaisCat.get(catAtual) || 0) + total);
    }
  });

  /* 3) escreve total geral no cabeçalho ------------------------------ */
  const hdrCusto = document
    .querySelector('#malha > li.header-row ' + CUSTO_SEL)      // via classe
    || document.querySelector('#malha > li.header-row')
         ?.children?.[4];                                      // fallback idx
  if (hdrCusto) {
    hdrCusto.textContent = totalGeral.toLocaleString('pt-BR', BRL2);

  }

  /* 4) acrescenta total aos nomes de categoria ----------------------- */
  for (const [li, soma] of totaisCat) {
    const strong = li.querySelector('strong');
    if (!strong) continue;

    // evita duplicar valor se a função rodar de novo
    strong.textContent = strong.textContent.split(' – ')[0] + ' – ' +
    soma.toLocaleString('pt-BR', BRL2);
  
  }
}

/* expõe globalmente (caso ainda não exista) */
window.updateCustoReal = updateCustoReal;


/* ------------------ INICIALIZAÇÃO GLOBAL ----------------------------- */
 document.addEventListener('DOMContentLoaded', () => {

  // não pré-carrega estoque: só faz build quando abrir produto

   /* intercepta detalhe do produto */
   const original = window.loadDadosProduto;
   if (typeof original === 'function') {
     setTimeout(window.updateCustoReal, 0);
     window.loadDadosProdutoEnviar = async function (codigo) {
       await original(codigo);
      // carrega o cache de estoque só na primeira vez
      if (!window.__posEstoqueReady) {
        window.__posEstoqueReady = buildPosEstoqueCache().catch(hideSpinner);
      }
       await window.__posEstoqueReady;
       updateCustoReal();
     };
   }
 });


/* =====================================================================
 *  ROTINA ORIGINAL – INCLUIR ESTRUTURA  (sem alterações)
 * ===================================================================== */
/**
 * Lida com o processo de leitura de um arquivo CSV contendo dados de estrutura de produtos,
 * faz o parsing do conteúdo e envia os dados para uma API externa para processamento.
 * 
 * A função realiza os seguintes passos:
 * 1. Lê e faz o parsing de um arquivo CSV contendo informações da estrutura de produtos.
 * 2. Valida a presença das colunas obrigatórias no cabeçalho do CSV.
 * 3. Itera pelas linhas do CSV para encontrar dados correspondentes ao produto.
 * 4. Para cada linha correspondente, recupera detalhes adicionais do produto de uma API.
 * 5. Envia os dados processados para outra API para atualizar a estrutura do produto.
 * 6. Trata erros e os registra para análise posterior.
 * 7. Gera um arquivo-resumo caso ocorram erros durante o processamento.
 * 
 * @async
 * @function handlePedidoCompra
 * @returns {Promise<void>} Resolve quando o processo é concluído.
 */
async function handlePedidoCompra() {
dbg('Início do fluxo');

/* -----------------------------------------------------------------
   0) Códigos de referência
   ----------------------------------------------------------------- */
const idProduto  = [...document.querySelectorAll('#cadastroList li')]
  .find(li => li.querySelector('.products')?.textContent.trim() === 'Código OMIE')
  ?.querySelector('.status-text')?.textContent.trim() ?? '';

if (!idProduto) {
  alert('Código OMIE não encontrado. Abra a aba “Dados de cadastro” e tente de novo.');
  return;
}

const intProduto = '(todos)';   // ← não usamos mais para filtrar, mas evita erro

dbg('🔍 CSV → enviar TODAS as linhas | Código OMIE:', idProduto);

  

  /* ---------- 1. Lê o CSV ----------------------------------------- */
  const file = await new Promise(resolve => {
  const input = Object.assign(document.createElement('input'), {
    type: 'file', accept: '.csv'
  });
  input.onchange = () => resolve(input.files[0] || null);
  input.click();
});

if (!file) { dbg('🚫 Upload cancelado'); return; }

// 1) envia para /api/upload/bom
const fd = new FormData();
fd.append('bom', file, 'BOM.csv');
const up = await fetch('/api/upload/bom', { method:'POST', body: fd });
if (!up.ok) { alert('Falha ao salvar CSV'); return; }

// 2) lê o arquivo salvo
const texto = await fetch('/csv/BOM.csv?'+Date.now()).then(r => r.text());


  const linhas = texto.trim().split(/\r?\n/);
  dbg(`📄 CSV carregado – ${linhas.length - 1} linhas (+ cabeçalho)`);

  /* ---------- 2. Cabeçalho & índices ------------------------------ */
  const header = linhas.shift();
  const delim  = header.includes(';') ? ';' : ',';
// regex: “splitar” no separador, mas só quando não estiver dentro de aspas
const splitPattern = new RegExp(
  `${delim}(?=(?:[^"]*"[^"]*")*[^"]*$)`
);

// parsing do cabeçalho
const campos = header
  .split(splitPattern)
  .map(s => s.replace(/^"|"$/g, '').trim());

  dbg('🔑 Cabeçalho CSV:', campos.join(' | '));


const idxC = campos.findIndex(h => /descrição do produto/i.test(h));
const idxQ = campos.findIndex(h => /qtde\s*prevista/i.test(h));
if ([idxC, idxQ].some(i => i < 0)) {
  dbg('❌ Colunas obrigatórias não encontradas → abortando');
  return;
}

/* ---------- 3. Total de linhas ---------------------------------- */
const totalMatches = linhas.length;                // todas as linhas do CSV
dbg(`📄 Encontradas ${totalMatches} linhas no CSV`);

  /* ---------- 4. Monta itens -------------------------------------- */
  const itens = [];
  let seq = 0;


  for (let i = 0; i < linhas.length; i++) {
    const col = linhas[i]
      .split(splitPattern)
      .map(s => s.replace(/^"|"$/g, '').trim());

  
    // ── debug dos valores brutos vindos do CSV
    const rawCod = col[idxC];
    const rawQt  = col[idxQ];
  
    // **defina `cod` antes de usar**
    const cod = rawCod.trim();
  
    // já limpamos as aspas no map; basta trocar vírgula por ponto
    const qt = parseFloat(rawQt.replace(',', '.')) || 0;
  
    // ── filtra vazios ou zero
    if (!cod) {
      dbg(`⏭️  [${seq+1}] cod inválido – pulando`);
      continue;
    }
    if (qt <= 0) {
      dbg(`⏭️  [${seq+1}] qt=${qt} – pulando`);
      continue;
    }
  
    seq++;
    dbg(`➡️  [${seq + 1}] cod=${cod}, qtd=${qt}`);


/* --- consulta detalhes p/ pegar intProdMalha --- */
const det = await fetch(
  `/api/produtos/detalhes/${encodeURIComponent(cod)}`
).then(r => r.json());

if (det.error) {
  dbg(`⏭️  [${seq}] ${det.error} – pulando`);
  erros.push(`Linha ${i+2}: ${det.error}`);
  continue;
}
// --- agora pegamos o código “principal” do produto, não o de integração
const id = det.codigo_produto;
if (!id) {
  dbg(`⏭️  [${seq}] Sem codigo_produto – pulando`);
  erros.push(`Linha ${i+2}: Sem codigo_produto`);
  continue;
}

itens.push({
  intMalha          : cod,
  idProdMalha       : id,
  quantProdMalha    : qt,
  percPerdaProdMalha: 0,
  obsProdMalha      : ''
});


  }

  /* ---------- 5. Envia único POST --------------------------------- */
  if (!itens.length) { dbg('⚠️ Nenhum item válido – nada a enviar'); return; }

const payload = {
  call       : 'IncluirEstrutura',
  param      : [{ idProduto, itemMalhaIncluir: itens }]
};
  dbg('🚚 Payload FINAL →\n' + JSON.stringify(payload, null, 2));

  try {
    const resp = await fetch(`${API_BASE}/api/omie/malha`, {
      method :'POST',
      headers:{ 'Content-Type':'application/json' },
      body   : JSON.stringify(payload)
    });
    const json = await resp.json();
    dbg('⇦ Resposta OMIE', resp.status, json);

    if (!resp.ok || json.faultstring)
      throw new Error(json.faultstring || `HTTP ${resp.status}`);

    dbg('✅ Processo concluído sem erros!');
  } catch (err) {
    dbg('❌ Falha na requisição:', err.message);
  }

  if (erros.length)
    dbg('⚠️ Linhas ignoradas:', erros);
}


/* botão “Pedido de compra” */
function initEnviarEstrutura() {
  const btn = document.querySelector(
    '#dadosProduto .content-wrapper-header .content-button'
  );
  if (btn) {
    btn.removeEventListener('click', handlePedidoCompra);
    btn.addEventListener('click', e => {
      dbg('▶️  Clique no botão – disparando handlePedidoCompra');
      handlePedidoCompra().catch(err =>
        dbg('❌ Erro não‑capturado:', err)
      );
    });
    
  }
}
document.addEventListener('DOMContentLoaded', initEnviarEstrutura);
