// kanban.js  (substitua todo o arquivo)

import {
  renderKanbanDesdeJSON,
  enableDragAndDrop,
  salvarKanbanLocal,
  gerarEtiqueta,
  gerarEtiquetaPP,
  gerarEtiquetaObs
} from './kanban_base.js';

// kanban.js  – depois dos imports
let pcpOpBusy = false;      // evita cliques repetidos enquanto processa

/* ——————————————————————————————————— */
/*  🔹  Cache com TODOS os produtos tipo 04  */
let productsCache = null;           // null = ainda não carregou
/* ——————————————————————————————————— */

function obterDescricao(codMP) {
  if (!productsCache) return '';
  const prod = productsCache.find(p => p.codigo === codMP);
  return prod ? prod.descricao : '';
}

import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
/* ——— Filtro de estoque (true = mostra tudo, false = só baixos) ——— */
let pcpShowAll = false;           // começa mostrando **apenas** itens em vermelho
let kanbanCache = [];      // mantém os itens atuais em memória

/* ------------------------------------------------------------------ */
/*  kanban.js  –  garantir BASE das chamadas backend                   */
/* ------------------------------------------------------------------ */
// ——— depósito fixo para Atualizar Kanban ———
const COD_LOCAL_ESTOQUE = 10520299822;
const COD_LOCAL_PCP = 10564345392;   // depósito onde ficam as peças separadas

const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;



/* ───────────────── helpers ───────────────── */

/* ────────────────────────────────
   Atualiza saldo só dos cartões
   "Pedido aprovado" (coluna comercial)
   ──────────────────────────────── */
async function atualizarEstoqueKanban () {
  const HOJE       = new Date().toLocaleDateString('pt-BR'); // dd/mm/aaaa
  const OMIE_URL   = `${API_BASE}/api/omie/estoque/consulta`;

  /* 1) monta o payload – só 1 página, 50 itens */
  const payload = {
    call      : 'ListarPosEstoque',
    app_key   : OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param     : [{
      nPagina: 1,
      nRegPorPagina: 50,
      dDataPosicao: HOJE,
      cExibeTodos: 'N',
      codigo_local_estoque: COD_LOCAL_ESTOQUE,
      cTipoItem: '04'           // produtos acabados
    }]
  };

  /* 2) chama o backend (proxy) */
  const resp = await fetch(OMIE_URL, {
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify(payload)
  });
  if (!resp.ok) {
    console.warn('[Kanban] estoque 105… status', resp.status);
    return;
  }
  const dados = await resp.json();

  /* 3) monta mapa código → saldo */
  const mapa = {};
  (dados.produtos || []).forEach(p => {
    mapa[p.cCodigo.toLowerCase()] = p.nSaldo ?? p.fisico ?? 0;
  });

  /* 4) aplica só nos cartões Pedido aprovado */
  let mudou = false;
  kanbanCache.forEach(it => {
    if (!it.local.some(l => l.startsWith('Pedido aprovado'))) return;

    const key  = it.codigo.toLowerCase();
    const novo = key in mapa ? mapa[key] : 0;   // ← default 0

    if (it.estoque !== novo) {                  // grava sempre que mudou
      it.estoque = novo;
      mudou = true;
    }
  });

  /* 5) se algo mudou, salva e re-renderiza */
  if (mudou) {
    await salvarKanbanLocal(kanbanCache, 'comercial');
    renderKanbanDesdeJSON(kanbanCache);
    enableDragAndDrop(kanbanCache);
  }
}


function formatDateBR(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const showSpinner = () =>
  (document.querySelector('.kanban-spinner') ?? {}).style && (
    document.querySelector('.kanban-spinner').style.display = 'inline-block');
const hideSpinner = () =>
  (document.querySelector('.kanban-spinner') ?? {}).style && (
    document.querySelector('.kanban-spinner').style.display = 'none');



const PAGE_SIZE   = 100;
async function loadProductsCache () {
  if (productsCache) return productsCache;          // já carregado

  const todos = [];
  let   page  = 1;
  let   totPg = 1;                                  // 1ª suposição

  do {
    const body = {
      call : 'ListarProdutosResumido',
      param: [{
        pagina: page,
        registros_por_pagina: PAGE_SIZE,
        apenas_importado_api : 'N',
        filtrar_apenas_omiepdv: 'N',
        filtrar_apenas_tipo   : '04'                // 💡 só produtos finais
      }]
    };

    const res  = await fetch(`${API_BASE}/api/omie/produtos`, {
      method      : 'POST',
      credentials : 'include',
      headers     : { 'Content-Type':'application/json' },
      body        : JSON.stringify(body)
    });

    if (!res.ok) {
      console.error('[loadProductsCache] HTTP', res.status, await res.text());
      throw new Error('Falha ao consultar OMIE');
    }

    const json = await res.json();
    const arr  = json.produto_servico_resumido || [];
    todos.push(...arr);

    // OMIE devolve o nº total de páginas
    totPg = json.total_de_paginas ?? 1;
    page++;

    if (page <= totPg) await sleep(650);            // 0,65 s ≈ 2 req/s
  } while (page <= totPg);

  todos.sort((a,b) => a.codigo.localeCompare(b.codigo));
  productsCache = todos;
  return todos;
}


function setupAddToggle() {
  const colElem = document.getElementById('coluna-pcp-aprovado');
  if (!colElem) return;

  const col     = colElem.closest('.kanban-column');
  if (!col) return;

  const btn     = col.querySelector('.add-btn');
  const input   = col.querySelector('.add-search');
  const results = col.querySelector('.add-results');

  btn.addEventListener('click', async () => {
    col.classList.toggle('search-expand');
    if (!col.classList.contains('search-expand')) return;
    setTimeout(() => input.focus(), 100);
    results.innerHTML = ''; // nada de pré-carregar
  });
}


/* Fecha o painel de busca: remove a classe, limpa UL e zera o input */
 function collapseSearchPanel() {
   /* fecha QUALQUER coluna que esteja com o search aberto */
   document.querySelectorAll('.kanban-column.search-expand').forEach(col => {
     col.classList.remove('search-expand');
     col.querySelector('.add-results')?.replaceChildren(); // limpa lista
   });
 }

window.collapseSearchPanel = collapseSearchPanel;   // torna-a global

// <<< Cole AQUI, logo abaixo de setupAddToggle()


// === SSE p/ auto-atualização do Kanban Comercial ===
let __comercialSseStarted = false;

export function startComercialSSE() {
  if (__comercialSseStarted) return;
  __comercialSseStarted = true;

  try {
    const src = new EventSource('/api/produtos/stream');

    // Qualquer evento (exceto o "hello" inicial) dispara um refresh do quadro
    src.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.type === 'hello') return;
      } catch (_) {
        // não era JSON? Sem crise, atualiza do mesmo jeito
      }
      Promise.resolve(initKanban()).catch(err =>
        console.error('[SSE][Comercial] falha ao recarregar:', err)
      );
    };

    window.addEventListener('beforeunload', () => src.close?.());
  } catch (e) {
    console.warn('[SSE] EventSource indisponível, ativando polling como fallback');
    setInterval(() => {
      Promise.resolve(initKanban()).catch(() => {});
    }, 5000);
  }
}

// ─── busca paginada na OMIE (com logs) ───────────────────────────────────────
// ─── busca paginada na OMIE (com logs) ───────────────────────────────────────
async function fetchAllProducts(filter) {
  const all = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const payload = {
      call: 'ListarProdutos',
      param: [{
        pagina: page,
        registros_por_pagina: perPage,
        apenas_importado_api: 'N',
        filtrar_apenas_omiepdv: 'N',
        filtrar_apenas_descricao: `%${filter}%`
      }],
      app_key:    OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };

    console.log(`[OMIE][Page ${page}] Enviando payload:`, payload);
    const resp = await fetch(`${API_BASE}/api/omie/produtos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    console.log(`[OMIE][Page ${page}] Status HTTP:`, resp.status);

    let data;
    try {
      data = await resp.json();
    } catch (err) {
      console.error(`[OMIE][Page ${page}] Falha ao parsear JSON:`, err);
      throw err;
    }
    console.log(`[OMIE][Page ${page}] JSON recebido:`, data);

    // busca pelo campo correto retornado pela OMIE:
    const list = Array.isArray(data.produto_servico_cadastro)
      ? data.produto_servico_cadastro
      : Array.isArray(data.produtos_cadastro)
        ? data.produtos_cadastro
        : [];

    console.log(`[OMIE][Page ${page}] Itens nesta página:`, list.length);
    all.push(...list);

    if (list.length < perPage) break;
    page++;
  }

  console.log('[OMIE] Total de itens coletados:', all.length);
  return all;
}


// ─── renderiza o listbox ─────────────────────────────────────────
function renderSearchResults(products, container) {
  container.innerHTML = '';
  products.forEach(p => {
    const li = document.createElement('li');
    li.classList.add('result-item');
    li.textContent = `${p.codigo} — ${p.descricao}`;
    li.dataset.desc = p.descricao;              // << NOVO
    container.appendChild(li);
li.addEventListener('click', ev => {
  /* 0) Impede que o clique “vaze” para outros handlers */
  ev.preventDefault();
  ev.stopPropagation();

  /* 1) Preenche o input com código e descrição */
  const input = container.previousElementSibling;
  input.value = `${p.codigo} — ${p.descricao}`;

  /* 2) Esconde a lista e recolhe o painel de busca */
  container.innerHTML = '';
  container.closest('.kanban-column')
           ?.classList.remove('search-expand');

  /* 3) Abre a aba PCP (isso já chama renderListaPecasPCP() lá) */
  document.querySelector(
    '#kanbanTabs .main-header-link[data-kanban-tab="pcp"]'
  )?.click();
});


  });
}

function setupProductSearch() {
  const col     = document
    .getElementById('coluna-pcp-aprovado')
    ?.closest('.kanban-column');
  if (!col) return;

  const input   = col.querySelector('.add-search');
  const results = col.querySelector('.add-results');

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const term = input.value.trim();
      if (term.length < 2) {
        results.innerHTML = '';
        return;
      }
      try {
const url = `/api/produtos/search?q=${encodeURIComponent(term)}&limit=40`;
const resp = await fetch(url, { credentials: 'include' });
const json = await resp.json();
const items = json?.data || [];   // <-- era json.items

results.innerHTML = '';
items.forEach(p => {
  const li = document.createElement('li');
  li.classList.add('result-item');
  li.textContent = `${p.codigo} — ${p.descricao}`;
  li.dataset.desc = p.descricao;

          li.addEventListener('click', ev => {
            ev.preventDefault();
            ev.stopPropagation();

            input.value = `${p.codigo} — ${p.descricao}`;

            // recolhe a caixa
            results.innerHTML = '';
            col.classList.remove('search-expand');

            // troca para a aba PCP para montar a lista de peças
            document.querySelector(
              '#kanbanTabs .main-header-link[data-kanban-tab="pcp"]'
            )?.click();
          });

          results.appendChild(li);
        });
      } catch (err) {
        console.error('[autocomplete produtos]', err);
        results.innerHTML = '<li class="error">Erro ao buscar</li>';
      }
    }, 150);
  });
}



function filtrarPorEstoque() {
  document.querySelectorAll('#listaPecasPCPList li').forEach(li => {
    /* span.est recebe .low quando estoque < 1  OU  estoque < Qtd   */
    const isLow = li.querySelector('.est')?.classList.contains('low');
    li.style.display = (pcpShowAll || isLow) ? '' : 'none';
  });


}

// ─── 1) Renderiza a Lista de Peças na aba PCP ────────────────────────
async function renderListaPecasPCP() {
// renderListaPecasPCP()
console.debug('[PCP] renderListaPecasPCP() começou');


// 1) encontra a UL
const ul = document.getElementById('listaPecasPCPList');
if (!ul) { console.warn('[PCP] UL não encontrada'); return; }

// 2) encontra o input correto navegando pela coluna
const col = document
  .getElementById('coluna-pcp-aprovado')
  .closest('.kanban-column');
const input = col?.querySelector('.add-search');

  // ——— patch: código vindo da aba “Solicitar produção” ———
  if (window.prepCodigoSelecionado) {     // ← SEM checar se está vazio
    input.value = window.prepCodigoSelecionado;   // cola o código
    window.prepCodigoSelecionado = null;          // zera a variável
  }

console.log('[PCP] input encontrado:', input);
if (!input) { console.warn('[PCP] input .add-search não encontrado'); return; }

// 3) extrai o código
const raw = input.value;
const codigo = raw.split('—')[0]?.trim();
console.debug('[PCP] Código lido =', codigo);
if (!codigo) { console.warn('[PCP] Sem código válido'); return; }

/* ───────────────────── Cabeçalho da aba PCP ───────────────────── */
function renderCodigoHeader () {
  const alvo = document.querySelector('#listaPecasPCP .title-wrapper')
             || document.getElementById('listaPecasPCP');
  if (!alvo) return;

  /* cria só 1 vez -------------------------------------------------------- */
  let barra = document.getElementById('pcp-code-bar');
  if (!barra) {
    barra = document.createElement('div');
    barra.id        = 'pcp-code-bar';
    barra.className = 'code-bar';
    barra.innerHTML = `
      <span class="prod-code"></span>
      <i id="pcpSpinner" class="fas fa-spinner fa-spin kanban-spinner"
         style="display:none;margin-left:6px"></i>

      <input id="pcp-factor" class="qty-input" type="number"
             min="1" max="999" value="1" title="Quantidade" style="width:60px">

      <button id="pcp-ok"  class="ok-btn">OK</button>

      <textarea id="pcp-obs" rows="2" placeholder="Observações…"
                style="margin-left:10px;width:300px;resize:vertical"></textarea>
    `;
    alvo.parentNode.insertBefore(barra, alvo);   /* irmão ANTES do wrapper */
  }

  /* sempre actualiza o código e mostra o spinner ------------------------ */
  barra.querySelector('.prod-code').textContent = codigo;
  barra.querySelector('#pcpSpinner').style.display = 'inline-block';

  /* ───────────── 1)  EVENTO DO BOTÃO OK  (uma única vez) ────────────── */
  const okBtn = barra.querySelector('#pcp-ok');
  if (!okBtn.dataset.init) {          /* evita duplicar o listener */
    okBtn.dataset.init = '1';

    okBtn.addEventListener('click', async () => {
      if (pcpOpBusy) return;
      pcpOpBusy = true;

      /* desabilita controles enquanto roda ----------------------------- */
      okBtn.disabled  = true;
      barra.querySelector('#pcp-factor').disabled = true;

      try {
        /* 0) valida quantidade ---------------------------------------- */
        const fator = Number(barra.querySelector('#pcp-factor').value || 0);

                /* lê o código visível no header e decide o destino do Kanban */
        const codigoOK = barra.querySelector('.prod-code').textContent.trim();
        const destino = /PP/i.test(codigoOK) ? 'preparacao' : 'comercial';






        if (!Number.isInteger(fator) || fator < 1) return;

        /* 1) busca nCodProduto --------------------------------------- */
let nCodProduto = 0;
let descOK      = '';               // ← já declara aqui
try {
  const r = await fetch(`/api/produtos/detalhes/${encodeURIComponent(codigoOK)}`);
  const d = await r.json();

  nCodProduto = d.codigo_produto ?? d.codigo_produto_integracao ?? 0;
  descOK      = (d.descricao || '').trim();   // 👈 captura descrição
} catch {/* se falhar, descOK fica vazio */}


        /* 2) data +2 dias -------------------------------------------- */
        const hoje  = new Date();
        const prev  = new Date(hoje.getTime() + 2*24*60*60*1e3);
        const dPrev = prev.toLocaleDateString('pt-BR');   // dd/mm/aaaa

        /* 3) gera N OPs + etiquetas ---------------------------------- */
        const localArr   = [];
        const txtObs = barra.querySelector('#pcp-obs').value.trim();

                /* ——— descobre o maior nº de OP já usado ——— */
/* ——— descobre o maior nº de OP já usado ——— */
const getNextOP = async destino => {
  let max = 100000;                           // ponto de partida seguro

  /* 1) percorre o cache já carregado (tela atual) */
  kanbanCache.forEach(reg => {
    reg.local.forEach(tag => {
      const id  = tag.split(',')[1];          // "P101050"
      const num = parseInt(id?.replace(/^P/, ''), 10);
      if (!isNaN(num) && num > max) max = num;
    });
  });

  /* 2) se for preparação, consulta também o arquivo em disco */
  if (destino === 'preparacao') {
    try {
      const resp = await fetch('/api/preparacao/listar');
      if (resp.ok) {
        const prep = await resp.json();
        prep.forEach(reg => {
          reg.local.forEach(tag => {
            const id  = tag.split(',')[1];
            const num = parseInt(id?.replace(/^P/, ''), 10);
            if (!isNaN(num) && num > max) max = num;
          });
        });
      }
    } catch (e) {
      console.warn('[getNextOP] Falha lendo kanban_preparacao:', e);
    }
  }

  return max + 1;                              // próximo livre
};



 for (let i = 0; i < fator; i++) {
   let cCodIntOP = null; // o servidor vai gerar e devolver

  /* 3.1) cria OP --------------------------------------------------- */
const payloadOP = {
  call      : 'IncluirOrdemProducao',
  app_key   : OMIE_APP_KEY,
  app_secret: OMIE_APP_SECRET,
  param: [{
    identificacao: {
      cCodIntOP,
      dDtPrevisao: dPrev,            // ← hoje
      nCodProduto,
      nQtde: 1,                      // ← sempre 1
      codigo_local_estoque: COD_LOCAL_PCP  // ← 10564345392 fixo
    }
  }]
};

const rOP = await fetch(`${API_BASE}/api/omie/produtos/op`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payloadOP)
});
const jOP = await rOP.json();
if (jOP?.used_cCodIntOP) cCodIntOP = jOP.used_cCodIntOP;

if (!rOP.ok || jOP?.faultstring || jOP?.error) {
  console.error('Falha ao criar OP:', jOP || rOP.statusText);
  throw new Error(jOP?.faultstring || jOP?.error || 'Falha ao criar OP');
}

// 🔑 use sempre o código que o servidor gerou
if (jOP?.used_cCodIntOP) cCodIntOP = jOP.used_cCodIntOP;


  if (jOP.faultstring || jOP.error) {
    console.warn('Falha OP', cCodIntOP, jOP);
    continue;
  }

  /* 3.2) etiqueta + observação ------------------------------------ */
  localArr.push(`Fila de produção,${cCodIntOP}`);


if (/PP/i.test(codigoOK)) {
  const zplPP = gerarEtiquetaPP({
    codMP     : codigoOK,
    op        : cCodIntOP,
    descricao : descOK            // ← já vem da Omie
  });

    await fetch('/api/etiquetas/gravar', {
      method : 'POST',
      headers: { 'Content-Type':'application/json' },
      body   : JSON.stringify({
        file: `mp_${cCodIntOP}.zpl`,
        zpl : zplPP,
        ns  : '',
        tipo: 'Teste'
      })
    });
  } else {
    await gerarEtiqueta(cCodIntOP, codigoOK);        // modelo antigo
  }

  if (txtObs) await gerarEtiquetaObs(txtObs);        // observação

  /* 3.3) respeita 2 req/s ----------------------------------------- */
  if (i < fator - 1) await sleep(600);
}


        /* 4) actualiza Kanban / salva -------------------------------- */
        if (localArr.length) {

 const existente = kanbanCache.find(it =>
   it.pedido==='Estoque' && it.codigo===codigoOK);


          if (existente) {
            existente.quantidade += localArr.length;
            existente.local.push(...localArr);
          } else {
            kanbanCache.push({
              pedido:'Estoque', codigo: codigoOK,
              quantidade: localArr.length,
              local: localArr, estoque:0, _codigoProd:nCodProduto
            });
          }


           /* — separa os arrays e salva no arquivo certo — */
           const arrPrep = kanbanCache.filter(it => /PP/i.test(it.codigo));
           const arrCom  = kanbanCache.filter(it => !/PP/i.test(it.codigo));

if (arrCom.length)  await salvarKanbanLocal(arrCom , 'comercial');
if (arrPrep.length) await salvarKanbanLocal(arrPrep, 'preparacao');



          renderKanbanDesdeJSON(kanbanCache);
          enableDragAndDrop(kanbanCache);
        }

  /* 5) escolhe a aba correta */
  const tabSelector = destino === 'preparacao'
    ? '[data-kanban-tab="preparacao"]'
    : '[data-kanban-tab="comercial"]';
  document.querySelector(`#kanbanTabs .main-header-link${tabSelector}`)?.click();
        setTimeout(() => {
          const col = document.getElementById('coluna-pcp-aprovado');
          col?.lastElementChild?.classList.add('flash-new');
          setTimeout(() => col?.lastElementChild?.classList.remove('flash-new'),
                     3000);
        }, 80);

      } catch (err) {
        console.error('[PCP-OK] erro:', err);
        alert('Erro ao gerar OP/etiquetas:\n' + err.message);
      } finally {
        okBtn.disabled  = false;
        barra.querySelector('#pcp-factor').disabled = false;
        pcpOpBusy = false;
        barra.querySelector('#pcp-factor').value = 1;   /* limpa */
      }
    });
  }
}
renderCodigoHeader();   //  <-- executa agora
/* ———————————————————————————————————————————————————————————————— */




  // 3.2) Chama o seu proxy de “ConsultarEstrutura”
  console.log('[PCP] Enviando requisição para /api/omie/estrutura', codigo);
  const resp = await fetch(`${API_BASE}/api/omie/estrutura`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ param:[{ codProduto: codigo }] })
  });
  console.log('[PCP] status HTTP:', resp.status);

  // 3.3) Parse do JSON
  let data;
  try {
    data = await resp.json();
    console.log('[PCP] JSON recebido:', data);
} catch (err) {
  console.error('[PCP] Erro ao ler JSON:', err);
  const sp = document.getElementById('pcpSpinner');
  if (sp) sp.style.display = 'none';
  return;
}



  // 3.4) Pega o array de peças (ajuste o nome se for diferente)
  const pecas = data.itens || data.pecas || [];
  console.log('[PCP] Total de peças:', pecas.length);

  // 3.5) Limpa e popula o UL
  ul.innerHTML = '';
  pecas.forEach(p => {
    const li = document.createElement('li');
  li.classList.add('content-item');
  li.innerHTML = `
    <span class="cod">${p.codProdMalha}</span>
    <span class="desc">${p.descrProdMalha}</span>
    <span class="qtd">(Qtd: ${p.quantProdMalha})</span>
  `;
    li.dataset.codigo    = p.codProdMalha.toLowerCase();
    li.dataset.descricao = p.descrProdMalha.toLowerCase();
    li.dataset.qtd      = p.quantProdMalha;          //  ← novo
    li.dataset.qtdBase  = p.quantProdMalha;
    li.dataset.unid      = p.unidProdMalha        // ➕ primeiro nome possível
 || p.unidade               // ➕ ou este…
 || p.unidProduto           // ➕ …ou este
 || '';                     // ➕ fallback vazio
    ul.appendChild(li);
  });

console.log('[PCP] UL populada no DOM com as peças');
try {
  await carregarPosicaoEstoque();
  filtrarPorEstoque();
} finally {
  const sp = document.getElementById('pcpSpinner');
  if (sp) sp.style.display = 'none';
}


}



// ─── 2) Aplica filtros de código e descrição na lista PCP ───────────
function applyPecasFilterPCP() {
  const container = document.querySelector('#listaPecasPCP .title-wrapper');
  if (!container) return;

  // Evita criar duas vezes os inputs
  if (container.querySelector('#codeFilterPCP')) return;

  const codeFilter = document.createElement('input');
  codeFilter.id = 'codeFilterPCP';
  codeFilter.placeholder = 'Pesquisar código';

/* --- CAMPO "Pesquisar descrição" + ícone Limpar ---------------- */
const descFilter = document.createElement('input');
descFilter.id          = 'descFilterPCP';
descFilter.placeholder = 'Pesquisar descrição';

/* wrapper mantém input e ícone lado-a-lado */
const wrapper = document.createElement('div');
wrapper.className = 'desc-wrapper';
wrapper.appendChild(descFilter);

/* ícone “X” para limpar (a lógica virá depois) */
const clearBtn = document.createElement('button');
clearBtn.type       = 'button';
clearBtn.id         = 'clearFilterPCP';
clearBtn.className  = 'clear-icon';
clearBtn.innerHTML  = '&times;';   // ×
wrapper.appendChild(clearBtn);

clearBtn.addEventListener('click', () => {
  pcpShowAll = !pcpShowAll;                // inverte: true = mostra todos
  clearBtn.classList.toggle('active', pcpShowAll);  // (estilo opcional)
  filtrarPorEstoque();                     // reaplica filtro
});

/* ordem visual: código | descrição+ícone */
container.appendChild(codeFilter);
container.appendChild(wrapper);

  const filtrar = () => {
    const c = codeFilter.value.trim().toLowerCase();
    const d = descFilter.value.trim().toLowerCase();
    document
      .querySelectorAll('#listaPecasPCPList li')
      .forEach(li => {
        const ok = (!c || li.dataset.codigo.includes(c))
                && (!d || li.dataset.descricao.includes(d));
        li.style.display = ok ? '' : 'none';
      });
  };

  codeFilter.addEventListener('input', filtrar);
  descFilter.addEventListener('input', filtrar);
}

/* ───────────────── navegação de abas ───────────────── */
function setupTabNavigation() {
  const links = document.querySelectorAll('#kanbanTabs .main-header-link');
  links.forEach(lk =>
    lk.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();         // ← ADICIONE ESTA LINHA
        collapseSearchPanel();      // garante que “+” nunca fique bloqueado

      const alvo = lk.dataset.kanbanTab; // comercial | pcp | produção…
      console.log('[TAB] Aba selecionada →', alvo);
      links.forEach(a => a.classList.remove('is-active'));
      lk.classList.add('is-active');
      document.querySelectorAll('.kanban-page')
        .forEach(p => p.style.display = 'none');
      const pg = document.getElementById(`conteudo-${alvo}`);
      if (pg) pg.style.display = 'block';

  if (alvo === 'pcp') {
    console.log('[TAB] Iniciando renderização da lista de peças PCP');
    renderListaPecasPCP();
    applyPecasFilterPCP();
    console.log('[TAB] Lista de peças PCP finalizada');
  }
    })
  );
}


/* ───────────────── detalhes via duplo-clique ─────────────────
   Agora SEM cache: sempre chama ConsultarPedido.
   A tabela inclui todos os itens (det[]) do pedido. */
function attachDoubleClick(itemsKanban) {
  const ul = document.getElementById('coluna-comercial');
  if (!ul || ul.dataset.dblInit) return;   // evita duplicar listeners
  ul.dataset.dblInit = '1';

  ul.addEventListener('dblclick', async e => {
    const li = e.target.closest('.kanban-card');
    if (!li) return;

    /* identifica o pedido */
    const idx     = parseInt(li.dataset.index, 10);
    const kanItem = itemsKanban[idx];
    if (!kanItem) return;
    const numeroPedido = String(kanItem.pedido);

    /* —— seleciona a aba Detalhes —— */
    document.querySelectorAll('#kanbanTabs .main-header-link').forEach(a =>
      a.classList.toggle('is-active', a.dataset.kanbanTab === 'detalhes'));
    document.querySelectorAll('.kanban-page').forEach(p => p.style.display = 'none');
    const pgDet = document.getElementById('conteudo-detalhes');
    if (pgDet) pgDet.style.display = 'block';

    const container = document.getElementById('detalhesContainer');
    if (!container) return;
    container.innerHTML = '<p class="loading-details">Carregando detalhes…</p>';

    /* —— sempre consulta OMIE —— */
    try {
      const payload = {
        call: 'ConsultarPedido',
        app_key: OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{ numero_pedido: numeroPedido }]
      };
      const resp = await fetch(`${API_BASE}/api/omie/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      const data = await resp.json();

      const pedObj = Array.isArray(data.pedido_venda_produto)
        ? data.pedido_venda_produto[0]
        : data.pedido_venda_produto;
      if (!pedObj) throw new Error('pedido_venda_produto vazio');

      /* cabeçalho */
      const cab   = pedObj.cabecalho ?? {};
      const obsV  = pedObj.observacoes?.obs_venda ?? '';
      const detAr = Array.isArray(pedObj.det) ? pedObj.det : [];

      const htmlTopo = `
        <div class="detalhes-header">
          <div class="campo-detalhe"><span class="label-detalhe">Pedido:</span>
            <span class="valor-detalhe">${numeroPedido}</span></div>
          <div class="campo-detalhe"><span class="label-detalhe">Itens:</span>
            <span class="valor-detalhe">${cab.quantidade_itens ?? detAr.length}</span></div>
          <div class="campo-detalhe largura-max"><span class="label-detalhe">Obs. venda:</span>
            <span class="valor-detalhe">${obsV || '(sem)'}</span></div>
        </div>`;

      /* monta tabela com TODOS os det[] */
      let htmlRows = '';
      detAr.forEach(d => {
        const cod  = d.produto?.codigo ?? '';
        const desc = d.produto?.descricao ?? '';
        const qtd  = d.produto?.quantidade ?? '';
        /* tenta achar estoque em itemsKanban (caso já exista) */
        const matchKan = itemsKanban.find(it => it.pedido == numeroPedido && it.codigo == cod);
        const est = matchKan?.estoque ?? 0;

        htmlRows += `
          <tr>
            <td>${cod}</td>
            <td>${desc}</td>
            <td>${qtd}</td>
            <td>${est}</td>
          </tr>`;
      });

      const htmlTabela = `
        <table class="tabela-detalhes">
          <thead>
            <tr><th>Código</th><th>Descrição</th><th>Qtd</th><th>Estoque</th></tr>
          </thead>
          <tbody>${htmlRows}</tbody>
        </table>`;

      container.innerHTML = `
        <div class="detalhes-wrapper">
          ${htmlTopo}
          <div class="detalhes-tabela-container">
            ${htmlTabela}
          </div>
        </div>`;

    } catch (err) {
      container.innerHTML = `<p class="fault-message">
        Erro ao consultar pedido ${numeroPedido}: ${err.message}</p>`;
    }
  });
}
export async function initKanban() {
  // mostra spinner se existir (já tinha no seu código)
  if (typeof showSpinner === 'function') showSpinner();

  try {
    // 1) carrega do SQL: só etapa 80
    const resp = await fetch(`${API_BASE}/api/comercial/pedidos/kanban`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const payload = await resp.json();

    // 2) pega apenas a coluna "Pedido aprovado"
    const aprov = (payload?.colunas?.['Pedido aprovado']) || [];

    // 3) adapta cada linha do SQL ao formato do seu renderizador
    //    - 'pedido'  → numero_pedido (fallback: codigo_pedido)
    //    - 'codigo'  → produto_codigo_txt
    //    - 'quantidade' → usa para repetir o status "Pedido aprovado" no array 'local'
    const arr = aprov.map((r) => {
      const qtd = Math.max(1, Number(r.quantidade || 1));
      const local = Array.from({ length: qtd }, () => 'Pedido aprovado'); // p/ (count)

      return {
        pedido     : String(r.numero_pedido || r.codigo_pedido || ''),
        codigo     : String(r.produto_codigo_txt || ''),
        quantidade : qtd,
        estoque    : 0,                   // saldo pode ser atualizado depois, se quiser
        local,                            // usado pelo renderKanbanDesdeJSON p/ (count)
        // campos extras úteis (sem quebrar nada):
        _codigo_pedido : String(r.codigo_pedido || ''),
        _descricao     : String(r.produto_descricao || ''),
        _previsao_br   : r.data_previsao_br || r.data_previsao || null,
        _valor_total   : r.valor_total_pedido || null,
      };
    });

    // 4) cache e render com seus utilitários já existentes
    if (typeof kanbanCache !== 'undefined') kanbanCache = arr;
    renderKanbanDesdeJSON(arr);      // já usa "Pedido aprovado" → "coluna-comercial"
    enableDragAndDrop(arr);          // mantém DnD preparado p/ fase 100/101

    // 5) ganchos auxiliares que você já usa (detalhes, busca, abas…)
    if (typeof attachDoubleClick === 'function') attachDoubleClick(arr, {});
    if (typeof setupAddToggle === 'function') setupAddToggle();
    if (typeof setupProductSearch === 'function') setupProductSearch();
    if (typeof setupTabNavigation === 'function') setupTabNavigation();

  } catch (err) {
    console.error('[KANBAN] Falha ao carregar do SQL:', err);
    alert('Falha ao carregar o Kanban do SQL em /api/comercial/pedidos/kanban.');
  } finally {
    if (typeof hideSpinner === 'function') hideSpinner();
  }
}


/* ------------------------------------------------------------------ */
/* 2) Nova função assíncrona                                          */
async function carregarPosicaoEstoque() {
  const OMIE_URL   = `${API_BASE}/api/omie/estoque/resumo`;
  const HOJE       = new Date().toLocaleDateString('pt-BR'); // 26/06/2025 → dd/mm/yyyy
  const POR_PAGINA = 50;

  let pagina      = 1;
  let totPaginas  = 1;          // valor inicial fictício
  const mapFisico = {};         // código → quantidade

  do {
 const payload = {
   call  : 'ListarPosEstoque',
   param : [{
      nPagina          : pagina,
      nRegPorPagina    : POR_PAGINA,
      dDataPosicao     : HOJE,
      cExibeTodos      : 'N',
      codigo_local_estoque : COD_LOCAL_PCP,
      cTipoItem        : '01'
    }]
 };

    const res  = await fetch(OMIE_URL, {
      method  : 'POST',
      headers : { 'Content-Type':'application/json' },
      body    : JSON.stringify(payload)
    });
    const dat  = await res.json();

    // atualiza total de páginas na 1ª volta
    totPaginas = dat.nTotPaginas ?? 1;

    // guarda fisico de cada produto
    (dat.produtos || []).forEach(p => {
      mapFisico[p.cCodigo.toLowerCase()] = p.fisico ?? 0;
    });

    pagina++;
  } while (pagina <= totPaginas);

  /* --- 3) percorre a UL que já existe e injeta o (Est:…) ------------ */
/* --- 3) percorre a UL e injeta unidade + estoque ------------------- */
document.querySelectorAll('#listaPecasPCPList li')
  .forEach(li => {
    const codigo = li.dataset.codigo;
    const qtdEl  = li.querySelector('.qtd') || li;   // <span class="qtd">
    const valor  = mapFisico[codigo];
    const unid   = li.dataset.unid || '';

    /* 0) Remove spans antigos — evita duplicar quando a aba é reaberta */
    qtdEl.querySelector('.unit')?.remove();
    qtdEl.querySelector('.est') ?.remove();

    /* 1) Unidade ------------- */
    if (unid) {
      const spanU = document.createElement('span');
      spanU.className   = 'unit';
      spanU.textContent = ` ${unid}`;   // espaço antes deixa “) UN” colado
      qtdEl.appendChild(spanU);
    }

    /* 2) Estoque ------------- */
    if (valor !== undefined) {
      const spanEst = document.createElement('span');
      spanEst.className   = 'est';
      spanEst.textContent = ` (Est: ${valor})`;
      li.dataset.est = valor;          // ← grava o estoque numérico
      const qtd = Number(li.dataset.qtd) || 0;
if (valor < 1 || valor < qtd) {          // critério de “baixo estoque”
  spanEst.classList.add('low');          //  ← ADICIONE ESTA LINHA
  spanEst.style.color = '#e44';          // vermelho
} else {
  spanEst.classList.remove('low');       // garante consistência
}

      qtdEl.appendChild(spanEst);
} else {                                     // ← NOVO: item não existe no depósito
  const spanEst = document.createElement('span');
  spanEst.className   = 'est low';           // já entra com .low
  spanEst.textContent = ' (Est:–)';          // hífen indica inexistente
  qtdEl.appendChild(spanEst);
}
  });
filtrarPorEstoque();
}
function aplicarMultiplicador (fator) {
  document.querySelectorAll('#listaPecasPCPList li').forEach(li => {
    const base = Number(li.dataset.qtdBase);
    const novo = +(base * fator);                // força número

    /* 1) guarda e exibe a nova quantidade */
    li.dataset.qtd = novo;
    const spanQtd  = li.querySelector('.qtd');
    if (spanQtd) spanQtd.firstChild.nodeValue = `(Qtd: ${novo})`;

        /* —— ajusta a cor / classe do estoque —— */
    const estSpan = li.querySelector('.est');
    if (estSpan) {
      const estValor = Number(
        estSpan.textContent.match(/-?\d+(?:[.,]\d+)?/)[0]
      );
      if (estValor < 1 || estValor < novo) {
        estSpan.classList.add('low');
        estSpan.style.color = '#e44';
      } else {
        estSpan.classList.remove('low');
        estSpan.style.color = '';
      }
    }

    /* 2) recolore o (Est: …) conforme regra */
    const spanEst = li.querySelector('.est');
    if (spanEst) {
      const estVal = Number(spanEst.textContent.match(/[-\d.]+/)[0] || 0);
      if (estVal < 1 || estVal < novo) {
        spanEst.style.color = '#e44';
      } else {
        spanEst.style.color = '';       // volta ao padrão
      }
    }
  });
filtrarPorEstoque();
}

