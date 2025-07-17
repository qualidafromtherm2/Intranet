// kanban.js  (substitua todo o arquivo)

import {
  carregarKanbanLocal,
  renderKanbanDesdeJSON,
  salvarKanbanLocal,
  enableDragAndDrop,
  gerarEtiqueta,
 gerarTicket          // ← NOVO
} from './kanban_base.js';
// kanban.js  – depois dos imports
let pcpOpBusy = false;      // evita cliques repetidos enquanto processa

/* ——————————————————————————————————— */
/*  🔹  Cache com TODOS os produtos tipo 04  */
let productsCache = null;           // null = ainda não carregou
/* ——————————————————————————————————— */

import config from '../config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
/* ——— Filtro de estoque (true = mostra tudo, false = só baixos) ——— */
let pcpShowAll = false;           // começa mostrando **apenas** itens em vermelho
let kanbanCache = [];      // mantém os itens atuais em memória

/* ------------------------------------------------------------------ */
/*  kanban.js  –  garantir BASE das chamadas backend                   */
/* ------------------------------------------------------------------ */
const API_BASE =
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:5001'
    : window.location.origin;           // Render ou outro domínio

/* ───────────────── helpers ───────────────── */
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
  const results = col.querySelector('.add-results');   // 🔹  ADICIONE ESTA LINHA

  btn.addEventListener('click', async () => {
    col.classList.toggle('search-expand');
    if (!col.classList.contains('search-expand')) return;

    setTimeout(() => input.focus(), 100);

    /* —— novo bloco: carrega cache na 1ª vez —— */
    if (!productsCache) {
      results.innerHTML = '<li>Carregando produtos…</li>';
      try {
        await loadProductsCache();          // função de cache
        results.innerHTML = '';             // limpa lista temporária
      } catch (err) {
        results.innerHTML =
          `<li class="error">Falha ao carregar: ${err.message}</li>`;
      }
    }
  });
}

/* Fecha o painel de busca: remove a classe, limpa UL e zera o input */
function collapseSearchPanel() {
  const col = document
    .getElementById('coluna-pcp-aprovado')
    ?.closest('.kanban-column');
  if (!col) return;

  col.classList.remove('search-expand');          // esconde <add-container>
  col.querySelector('.add-results')?.replaceChildren();
}

// <<< Cole AQUI, logo abaixo de setupAddToggle()

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

  /* debounced filtering */
  let debounce;
input.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const term = input.value.trim().toLowerCase();
    if (!productsCache || term.length < 2) {
      results.innerHTML = '';
      return;
    }
    const found = productsCache
      .filter(p => p.codigo.toLowerCase().includes(term))
      .slice(0, 40);                // mostra no máx. 40 itens
    renderSearchResults(found, results);
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
console.log('[PCP] → renderListaPecasPCP() começou');

// 1) encontra a UL
const ul = document.getElementById('listaPecasPCPList');
if (!ul) { console.warn('[PCP] UL não encontrada'); return; }

// 2) encontra o input correto navegando pela coluna
const col = document
  .getElementById('coluna-pcp-aprovado')
  .closest('.kanban-column');
const input = col?.querySelector('.add-search');
console.log('[PCP] input encontrado:', input);
if (!input) { console.warn('[PCP] input .add-search não encontrado'); return; }

// 3) extrai o código
const raw = input.value;
const codigo = raw.split('—')[0]?.trim();
console.log('[PCP] Código extraído:', codigo);
if (!codigo) { console.warn('[PCP] Sem código válido'); return; }

  (function renderCodigoHeader() {
    const alvo = document.querySelector('#listaPecasPCP .title-wrapper')
               || document.getElementById('listaPecasPCP');
    if (!alvo) return;

    // cria só 1 vez
    let barra = document.getElementById('pcp-code-bar');
    if (!barra) {
      barra = document.createElement('div');
      barra.id        = 'pcp-code-bar';
      barra.className = 'code-bar';
barra.innerHTML = `
  <span class="prod-code"></span>
  <i id="pcpSpinner" class="fas fa-spinner fa-spin kanban-spinner"
     style="display:none;margin-left:6px"></i>
  <button class="plus-btn" title="(em construção)">+</button>

  <input  id="pcp-factor" type="number" min="1" max="999"
          placeholder="×" style="display:none;width:60px">
  <button id="pcp-ok" style="display:none">OK</button>
`;

      alvo.parentNode.insertBefore(barra, alvo);   // vira irmão ANTES do wrapper
    }
    // sempre atualiza o texto
    barra.querySelector('.prod-code').textContent = codigo;
barra.querySelector('#pcpSpinner').style.display = 'inline-block';

     /* ── clique no “+” abre input numérico ───────────────────────── */
/* ── clique no “+” abre input numérico ───────────────────────── */
const plusBtn = barra.querySelector('.plus-btn');
if (!plusBtn.dataset.init) {
  plusBtn.dataset.init = '1';

plusBtn.addEventListener('click', () => {
  /* evita abrir 2× */
  let inp = barra.querySelector('.qty-input');
  if (!inp) {
    inp            = document.createElement('input');
    inp.type       = 'number';
    inp.min        = 1;
    inp.max        = 999;
    inp.value      = 1;
    inp.className  = 'qty-input';
    barra.appendChild(inp);
  }
  inp.focus();

  /* 🔹 1)  GARANTE QUE O BOTÃO OK EXISTA E JÁ FIQUE VISÍVEL */
  let okBtn = barra.querySelector('.ok-btn');
  if (!okBtn) {
    okBtn              = document.createElement('button');
    okBtn.textContent  = 'OK';
    okBtn.className    = 'ok-btn';
okBtn.addEventListener('click', async () => {
  if (pcpOpBusy) return;        // já em execução
  pcpOpBusy = true;

  okBtn.disabled   = true;
  plusBtn.disabled = true;
  inp.disabled     = true;

  try {
    /* ----------------------------------------------------------
       0) valida quantidade
    ---------------------------------------------------------- */
    const fator = Number(barra.querySelector('.qty-input')?.value || 0);
    if (!Number.isInteger(fator) || fator < 1) return;

    /* ----------------------------------------------------------
       1) busca nCodProduto
    ---------------------------------------------------------- */
    let nCodProduto = 0;
    try {
      const r = await fetch(
        `/api/produtos/detalhes/${encodeURIComponent(codigo)}`
      );
      const d = await r.json();
      nCodProduto = d.codigo_produto ?? d.codigo_produto_integracao ?? 0;
    } catch {/* continua 0 */ }

    /* ----------------------------------------------------------
       2) data +2 dias
    ---------------------------------------------------------- */
    const hoje   = new Date();
    const prev   = new Date(hoje.getTime() + 2*24*60*60*1e3);
    const dPrev  = prev.toLocaleDateString('pt-BR');       // dd/mm/aaaa

    /* ----------------------------------------------------------
       3) gera N OPs sequenciais
    ---------------------------------------------------------- */
    const localArr   = [];
    const primeiroOP = parseInt(await gerarTicket(), 10);  // 21004…

    for (let i = 0; i < fator; i++) {
      const cCodIntOP = String(primeiroOP + i);

      /* 3.1) cria OP */
      const payloadOP = {
        call      : 'IncluirOrdemProducao',
        app_key   : OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param:[{ identificacao:{
          cCodIntOP, dDtPrevisao:dPrev, nCodProduto, nQtde:1
        }}]
      };
      const rOP = await fetch(`${API_BASE}/api/omie/produtos/op`, {
        method :'POST',
        headers:{'Content-Type':'application/json'},
        body   : JSON.stringify(payloadOP)
      });
      const jOP = await rOP.json();
      if (jOP.faultstring || jOP.error) {
        console.warn('Falha OP', cCodIntOP, jOP);
        continue;
      }

      /* 3.2) guarda + etiqueta */
      localArr.push(`Separação logística,${cCodIntOP}`);
      await gerarEtiqueta(cCodIntOP, codigo);

      /* 3.3) 2 req/s = pausa 600 ms */
      if (i < fator-1) await sleep(600);
    }

    /* ----------------------------------------------------------
       4) atualiza Kanban / salva
    ---------------------------------------------------------- */
    if (localArr.length) {
      const existente = kanbanCache
        .find(it => it.pedido==='Estoque' && it.codigo===codigo);

      if (existente) {
        existente.quantidade += localArr.length;
        existente.local.push(...localArr);
      } else {
        kanbanCache.push({
          pedido:'Estoque', codigo,
          quantidade: localArr.length,
          local: localArr, estoque:0, _codigoProd:nCodProduto
        });
      }

      await salvarKanbanLocal(kanbanCache);
      renderKanbanDesdeJSON(kanbanCache);
      enableDragAndDrop(kanbanCache);
    }

    /* UX extra – volta à aba Comercial, destaca cartão */
    document.querySelector(
      '#kanbanTabs .main-header-link[data-kanban-tab="comercial"]'
    )?.click();
    setTimeout(() => {
      const col   = document.getElementById('coluna-pcp-aprovado');
      col?.lastElementChild?.classList.add('flash-new');
      setTimeout(() =>
        col?.lastElementChild?.classList.remove('flash-new'), 3000);
    }, 80);

  } catch (err) {
    console.error('[PCP-OK] erro:', err);
    alert('Erro ao gerar OP/etiquetas:\n' + err.message);
  } finally {
    /* -------- SEMPRE reabilita controles -------- */
    okBtn.disabled   = false;
    plusBtn.disabled = false;
    inp.disabled     = false;
    pcpOpBusy        = false;

    /* limpa input */
    barra.querySelector('.qty-input').value = 1;
    barra.querySelector('.qty-input').blur();
  }
});



    barra.appendChild(okBtn);
  }

  /* 🔹 2)  callback em tempo real (já existente) */
  const onType = () => {
    const fator = Number(inp.value);
    if (Number.isInteger(fator) && fator >= 1 && fator <= 999) {
      aplicarMultiplicador(fator);
    }
  };

  if (!inp.dataset.init) {
    inp.dataset.init = '1';
    inp.addEventListener('input',  onType);
    inp.addEventListener('change', onType);
  }
});


}

  })();


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


/* ───────────────── FUNÇÃO PRINCIPAL ───────────────── */
export async function initKanban() {
  showSpinner();
  const hoje = formatDateBR(new Date());

  try {
    /* 1) carrega kanban.json existente */
    const existingItems = await carregarKanbanLocal();
    if (existingItems.length) {
      renderKanbanDesdeJSON(existingItems);
      enableDragAndDrop(existingItems);
    }

    /* 2) busca ListarPedidos */
    const payloadLP = {
      call: 'ListarPedidos',
      param: [{ pagina:1, registros_por_pagina:100, etapa:'80', apenas_importado_api:'N' }],
      app_key: OMIE_APP_KEY,
      app_secret: OMIE_APP_SECRET
    };
    const respLP = await fetch(`${API_BASE}/api/omie/pedidos`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payloadLP)
    });
    const dataLP = respLP.ok ? await respLP.json() : {};
    const pedidos = Array.isArray(dataLP.pedido_venda_produto)
      ? dataLP.pedido_venda_produto : [];

    /* cria mapa para cache de pedidos */
    const pedidosMap = {};
    pedidos.forEach(p => {
      pedidosMap[String(p.cabecalho.numero_pedido)] = p;
    });

    /* 3) identifica novos itens / consulta estoque */
    const keySet = new Set(existingItems.map(i => `${i.pedido}|${i.codigo}`));
    const novos = [];
    for (const p of pedidos) {
      const np = p.cabecalho.numero_pedido;
      for (const det of (Array.isArray(p.det)?p.det:[])) {
        const k = `${np}|${det.produto.codigo}`;
        if (keySet.has(k)) continue;

        const obj = {
          pedido: np,
          codigo: det.produto.codigo,
          quantidade: det.produto.quantidade,
          local: Array(det.produto.quantidade).fill('Pedido aprovado'),
          estoque: null,
          _codigoProd: det.produto.codigo_produto
        };
        /* consulta estoque */
        const payloadEst = {
          call:'PosicaoEstoque',
          param:[{ codigo_local_estoque:0, id_prod:obj._codigoProd,
                   cod_int:obj.codigo, data:hoje }],
          app_key:OMIE_APP_KEY, app_secret:OMIE_APP_SECRET
        };
        try {
          const r = await fetch(`${API_BASE}/api/omie/estoque/consulta`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payloadEst)
          });
          const d = r.ok?await r.json():{};
          obj.estoque =
            d.saldo ?? d.posicao?.[0]?.saldo_atual ?? d.posicao?.[0]?.quantidade_estoque ?? 0;
        } catch {
          obj.estoque = 0;
        }
        novos.push(obj);
        await sleep(300);
      }
    }

    /* 4) mescla + renderiza */
const allItems = existingItems.concat(novos);   // mantém igual
kanbanCache = allItems;                         // ← NOVO
renderKanbanDesdeJSON(allItems);

    enableDragAndDrop(allItems);
    if (novos.length) await salvarKanbanLocal(allItems);

    /* 5) ativa dblclick, toggle de “+”, busca e navegação de abas */    /* 5) ativa dblclick, toggle de “+”, busca e navegação de abas */
    attachDoubleClick(allItems, pedidosMap);
    setupAddToggle();        // abre/fecha campo de pesquisa
    setupProductSearch();    // instala listener de digitação
    setupTabNavigation();    // mantém navegação de abas

    /* exibe aba Comercial como default */
    const linkCom = document.querySelector(
      '#kanbanTabs .main-header-link[data-kanban-tab="comercial"]'
    );
    linkCom?.click?.();


  }
  
  
  
  catch (err) {
    console.error('Erro no initKanban:', err);
  } finally {
    hideSpinner();
  }
}

/* ------------------------------------------------------------------ */
/* 2) Nova função assíncrona                                          */
async function carregarPosicaoEstoque() {
  const OMIE_URL   = `${API_BASE}/api/omie/estoque/pagina`;
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
      codigo_local_estoque : 0,
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

