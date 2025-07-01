// menu_produto.js
import config from './config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
const API_BASE = window.location.origin; // já serve https://intranet-30av.onrender.com
let ultimoCodigo = null;      // <-- NOVO

import { initListarProdutosUI } from './requisicoes_omie/ListarProdutos.js';
import { initDadosColaboradoresUI } from './requisicoes_omie/dados_colaboradores.js';
import { initAnexosUI } from './requisicoes_omie/anexos.js';
import { initKanban } from './kanban/kanban.js';
let lastKanbanTab = 'comercial';   // lembra a sub-aba atual




function showMainTab(tabId) {
  // esconde TUDO que possa ser página principal:
  document
    .querySelectorAll('.tab-pane, .kanban-page')
    .forEach(p => (p.style.display = 'none'));

  // tenta achar o alvo em 2 formatos:
  //   • id = tabId  (ex.:  "listaPecas")
  //   • id = "conteudo-" + tabId  (ex.:  "conteudo-pcp")
  const alvo =
    document.getElementById(tabId) ||
    document.getElementById(`conteudo-${tabId}`);

  if (alvo) alvo.style.display = 'block';
}


window.showMainTab = showMainTab;   // expõe p/ outros módulos
// referências ao container principal e ao painel de Acessos
const wrapper      = document.querySelector('.wrapper');
const acessosPanel = document.getElementById('acessos');

// Spinner de carregamento

/* ======== Helpers – alternar Pedidos (Kanban) ======== */
function showKanban () {
  /* esconde QUALQUER painel de produtos que ainda possa estar visível */
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

  /* mostra somente a estrutura do Kanban */
  document.getElementById('produtoTabs').style.display   = 'none';
  document.getElementById('kanbanTabs').style.display    = 'flex';
  document.getElementById('kanbanContent').style.display = 'block';

  /* (re)carrega dados e abre a sub-aba que o usuário visitou por último */
  initKanban();
  showKanbanTab(lastKanbanTab || 'comercial');
}


function hideKanban () {
  document.getElementById('kanbanTabs').style.display    = 'none';
  document.getElementById('kanbanContent').style.display = 'none';
  document.getElementById('produtoTabs').style.display   = 'block';
}



function showSpinner() {
  document.getElementById('productSpinner').style.display = 'inline-flex';
}
function hideSpinner() {
  document.getElementById('productSpinner').style.display = 'none';
}

// --- patch restrito APENAS à rota ListarProdutos -------------------
let prodPending = 0;
// suba isto para cima, antes de qualquer outro fetch
const _origFetch = window.fetch;
window.fetch = async function(input, init = {}) {
  // força o envio do cookie de sessão em TODAS as requests
  init.credentials = init.credentials ?? 'include';

  // --- spinner antigo permanece inalterado ---
  const url = input;
  const isListaProd = typeof url === 'string'
    && url.includes('/api/omie/produtos');

  if (isListaProd && prodPending === 0) showSpinner();
  if (isListaProd) prodPending++;

  try {
    return await _origFetch(input, init);
  } finally {
    if (isListaProd) {
      prodPending--;
      if (prodPending === 0) hideSpinner();
    }
  }
};

function loadEstruturaProduto(codigo) {
  if (!codigo) return;
  ultimoCodigo = codigo;

  const ul      = document.getElementById('malha');
  const spinner = document.getElementById('estoqueSpinnerBox');
  ul.innerHTML  = '';                     // limpa antes de começar
  spinner.style.display = 'inline-flex';  // mostra spinner

  fetch('/api/malha/consultar', {         // ou /api/omie/estrutura
    method : 'POST',
    headers: { 'Content-Type':'application/json' },
    body   : JSON.stringify({ intProduto: codigo })
  })
  .then(r => r.json())
  .then(json => {
    spinner.style.display = 'none';

    if (json.notFound || !Array.isArray(json.itens)) {
      ul.innerHTML = '<li class="fault-message">Estrutura não cadastrada</li>';
      return;
    }

    json.itens.forEach(it => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>${it.codProdMalha}</div>
        <div class="status">${it.descrProdMalha}</div>
        <div class="qtd">${it.quantProdMalha}</div>
        <div class="unidade">${it.unidProdMalha}</div>
        <div class="custo-real">${it.custoReal ?? '–'}</div>
        <div class="button-wrapper">
          <button class="content-button status-button open"
                  data-cod="${it.codProdMalha}">Editar</button>
        </div>`;
      ul.appendChild(li);
    });
  })
  .catch(err => {
    spinner.style.display = 'none';
    ul.innerHTML = `<li class="fault-message">Erro: ${err.message}</li>`;
  });
}
window.loadEstruturaProduto = loadEstruturaProduto;   // ← deixa global

// Abre a aba Dados do produto
// Abre a aba Dados do produto
function openDadosProdutoTab() {
  hideKanban();                
  // 1) Esconde todas as .tab-pane
  document.querySelectorAll('.tab-pane')
    .forEach(p => p.style.display = 'none');

  // 2) Remove destaque de todas as main-header-link
  document.querySelectorAll('.main-header-link')
    .forEach(l => l.classList.remove('is-active'));

  // 3) Destaca o link interno “Dados do produto”
const dadosLink = document.querySelector(
  '.main-header-link[data-target="dadosProduto"]'
);

  if (dadosLink) {
    dadosLink.classList.add('is-active');
  }

  // 4) Exibe o painel #dadosProduto e a barra de abas internas
  const painel = document.getElementById('dadosProduto');
  const barra  = document.querySelector('.main-header');
  if (painel) painel.style.display = 'block';
  if (barra)  barra.style.display  = 'flex';
}


// Navega para a aba de Detalhes
function navigateToDetalhes(codigo) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
  document.querySelector('[data-target="dadosProduto"]').classList.add('is-active');
  document.getElementById('dadosProduto').style.display = 'block';
  document.querySelector('.main-header').style.display = 'flex';
  window.loadDadosProduto(codigo);
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[menu_produto] DOMContentLoaded disparou');

 const inputBusca = document.querySelector('.search-bar input');
console.log('[INIT] inputBusca', inputBusca);

 /* ── anima a barra de pesquisa (lupa) ─────────────────────────── */
const searchBar   = document.querySelector('.search-bar');       // <div …>
const searchInput = inputBusca;                                  // <input …>

// ► abre a barra e foca no input
searchBar.addEventListener('click', e => {
  e.stopPropagation();            // não deixa o clique “vazar”
  searchBar.classList.add('active');
  searchInput.focus();            // aparece o cursor
});

// ► fecha se clicar fora (e o campo estiver vazio)
document.addEventListener('click', e => {
  const clicouFora = !searchBar.contains(e.target);
  const vazio      = !searchInput.value.trim();
  if (clicouFora && vazio) {
    searchBar.classList.remove('active');
  }
});
/* ─────────────────────────────────────────────────────────────── */

// garante foco mesmo se clicar no ícone ou no espaço à esquerda
searchBar.addEventListener('mousedown', e => {
  if (e.target !== inputBusca) {   // agora inputBusca existe :)
    e.preventDefault();
    inputBusca.focus();
  }
});

  const codeFilter = document.getElementById('codeFilter');
  const descFilter = document.getElementById('descFilter');
    // 0) Esconde a aba “Acessos” se não for admin
    const status = await fetch(`${API_BASE}/api/auth/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    })
      .then(r => r.json());
    
if (status.loggedIn && !status.user.roles.includes('admin')) {
document.getElementById('menu-acessos')
.style.display = 'none';
}

// agora seleciona o UL correto da aba "Lista de produtos"
const ulList     = document.getElementById('listaProdutosList');
  const countEl    = document.getElementById('productCount');

  // Guarda os itens da busca resumida
  let resumoItems = [];

  // FILTRO LOCAL (SEM RE-RENDER)
  function applyResumoFilters() {
    const termCode = codeFilter.value.trim().toLowerCase();
    const termDesc = descFilter.value.trim().toLowerCase();
  
    ulList.querySelectorAll('li').forEach(li => {
      const code = (li.dataset.codigo    || '').toLowerCase();
      const desc = (li.dataset.descricao || '').toLowerCase();
  
      const show = ((!termCode || code.includes(termCode)) &&
                    (!termDesc || desc.includes(termDesc)));
      li.style.display = show ? '' : 'none';
    });
  }
  
  codeFilter.addEventListener('input', applyResumoFilters);
  descFilter.addEventListener('input', applyResumoFilters);

  // PESQUISA PRINCIPAL
  inputBusca.addEventListener('keydown', async e => {
    console.log('[TESTE] valor agora →', inputBusca.value);
    if (e.key !== 'Enter') return;
    console.log('[KEY] Enter detectado:', inputBusca.value);
    const termo = inputBusca.value.trim();
    if (!termo) return;

    // 1) tenta detalhes
    try {
      const resDet  = console.log('[FETCH] enviando ListarProdutosResumido'); await fetch(`/api/produtos/detalhes/${encodeURIComponent(termo)}`);
      const detData = await resDet.json();
      if (!detData.error) {
        navigateToDetalhes(termo);
        inputBusca.value = '';
        return;
      }
    } catch {
      /* ignora */
    }

    // 2) fallback: lista resumida
    inputBusca.value = '';
   document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
   document.getElementById('listaProdutos').style.display = 'block';

    document.querySelector('.main-header').style.display = 'none';
    ulList.innerHTML = '';
    countEl.textContent = '0';

    showSpinner();
    try {
const resResumo = await fetch(`${API_BASE}/api/omie/produtos`, {
  method:      'POST',
  credentials: 'include',
  headers:     { 'Content-Type':'application/json' },
  body:        JSON.stringify({
    call:       'ListarProdutosResumido',
    app_key:    OMIE_APP_KEY,
    app_secret: OMIE_APP_SECRET,
    param: [{
      pagina: 1,
      registros_por_pagina: 50,
      filtrar_apenas_descricao: `%${termo}%`,
      apenas_importado_api: 'N',
      filtrar_apenas_omiepdv: 'N'
    }]
  })
});

      const dados = await resResumo.json();
      resumoItems = dados.produto_servico_resumido || [];
      countEl.textContent = resumoItems.length;

      resumoItems.forEach(item => {
        const li = document.createElement('li');
        li.dataset.codigo    = item.codigo;
        li.dataset.descricao = item.descricao;
        li.innerHTML = `
          <span class="products">${item.codigo}</span>
          <span class="status">${item.descricao}</span>
          <div class="button-wrapper">
            <button class="content-button status-button open"
                    data-codigo="${item.codigo}">Abrir</button>
          </div>`;
        li.querySelector('button.open').addEventListener('click', () => {
          navigateToDetalhes(item.codigo);
        });
        ulList.appendChild(li);
      });
       // reaplica o filtro de Código/Descrição
       applyResumoFilters();
    } catch {
      alert('Erro ao buscar produtos');
    } finally {
      hideSpinner();
    }
  });

  // ATALHO ÚNICO: abre aba cacheada + carrega cache EM UM SÓ CLIQUE

   const btnCache = document.getElementById('btn-omie-list1')
                  || document.getElementById('btn-omie-list');
  
  if (btnCache) {
    btnCache.addEventListener('click', async e => {
      e.preventDefault();
      hideKanban(); 
      // 1) esconde todas as panes
document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
document.getElementById('listaProdutos').style.display = 'block';

      // 3) oculta a barra interna (se for o comportamento desejado)
      document.querySelector('.main-header').style.display = 'none';
      // 4) marca o link ativo na lateral
      document.querySelectorAll('.side-menu a').forEach(a => a.classList.remove('is-active'));
      btnCache.classList.add('is-active');
      // 5) dispara o init que carrega todo o cache e renderiza a lista

      await initListarProdutosUI(
  'listaPecasTab',       // o ID real do seu pane
  'listaProdutosList'
);


      // 1) reaplica filtro de código/descrição (input)
applyResumoFilters();

// 2) reaplica filtro de Família / Tipo de Item / Característica / Conteúdo
document.getElementById('familySelect').dispatchEvent(new Event('change'));
document.getElementById('tipoItemSelect').dispatchEvent(new Event('change'));
document.getElementById('caracteristicaSelect').dispatchEvent(new Event('change'));
document.getElementById('conteudoSelect').dispatchEvent(new Event('change'));

      requestAnimationFrame(applyResumoFilters);
      
    });
  }

  document.getElementById('menu-produto')
  .addEventListener('click', e => {
    e.preventDefault();
    openDadosProdutoTab();
  });


// Função para buscar e renderizar usuários sem os campos Admin/Editor
async function loadUsers() {
  const container = document.getElementById('userList');

  // 1) Busca usuários
  const res = await fetch(`${API_BASE}/api/users`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  });
  if (!res.ok) {
    let errText = res.statusText;
    try { errText = (await res.json()).error || errText; } catch {}
    container.innerHTML = `<p class="empty">❌ ${errText}</p>`;
    return;
  }

  // 2) Extrai array
  const data  = await res.json();
  const users = Array.isArray(data) ? data : (data.users || []);
  if (users.length === 0) {
    container.innerHTML = '<p class="empty">Nenhum usuário encontrado</p>';
    return;
  }

  // 3) Gera opções
  const options = users
    .map(u => `<option value="${u.id}">${u.username}</option>`)
    .join('');

  // 4) Renderiza listbox
// substitua por isto:
container.innerHTML = `
  <select
    id="userSelect"
    class="content-select"
  >
    ${options}
  </select>
`;

}






// Botão “Novo Usuário” mostra o formulário
document.getElementById('btnNewUser')
  .addEventListener('click', () => {
    document.getElementById('userForm').style.display = 'block';
  });

// Salvar novo usuário
document.getElementById('btnSaveUser')
  .addEventListener('click', async () => {
    const username = document.getElementById('inpUsername').value.trim();
    const password = '123';      // senha fixa
    const roles    = [];         // sem definição prévia de roles

    await fetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, roles })
    });

    document.getElementById('userForm').style.display = 'none';
    loadUsers();
  });

  // ——— Configura evento para todas as abas do header ———
// ——— Configura evento para todas as abas do header ———
const headerLinks   = document.querySelectorAll('.header .header-menu > .menu-link');
const leftSide      = document.querySelector('.left-side');
const mainContainer = document.querySelector('.main-container');
const panes         = mainContainer.querySelectorAll('.tab-pane');

headerLinks.forEach(link => {
  link.addEventListener('click', async e => {
    e.preventDefault();
    // 1) limpa destaque e esconde todos os panes
    headerLinks.forEach(a => a.classList.remove('is-active'));
    panes.forEach(p => p.style.display = 'none');

        /* toda vez que sair de Pedidos, esconde o painel Kanban */
if (link.id !== 'menu-pedidos') hideKanban();

    // 2) destaca o clicado
    link.classList.add('is-active');



    if (link.id === 'menu-acessos') {
      acessosPanel.style.display = 'block';
      await loadUsers();
      loadMenus();
    
    } else if (link.id === 'menu-produto') {
      acessosPanel.style.display = 'none';
      openDadosProdutoTab();
    
    } else if (link.id === 'menu-notificacoes') {        // ← NOVO
      acessosPanel.style.display = 'none';
      if (window.openNotificacoes) window.openNotificacoes();
      
    } else if (link.textContent.trim() === 'Inicio') {

    }

    
  });
});

/* dentro do MESMO callback que já existe */
const bell       = document.getElementById('bell-icon');
const printBtn   = document.getElementById('print-icon');
const cloudBtn   = document.getElementById('cloud-icon');
const avatar     = document.getElementById('profile-icon');
const etiquetasModal = document.getElementById('etiquetasModal');
const listaEtiq       = document.getElementById('listaEtiquetas');

  /* –– SINO –– */
  bell?.addEventListener('click', e => {
    e.preventDefault();
    // Faz o mesmo que clicar no link do header
    document.getElementById('menu-notificacoes')?.click();
  });

  /* –– IMPRESSORA –– */
printBtn?.addEventListener('click', async e => {
  e.preventDefault(); e.stopPropagation();

  listaEtiq.innerHTML = '<li>carregando…</li>';
  try {
    const resp = await fetch('/api/etiquetas');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const files = await resp.json();  // ex.: ["etiqueta_F06250019.zpl"]

    if (files.length === 0) {
      listaEtiq.innerHTML = '<li>Nenhuma etiqueta encontrada</li>';
    } else {
      listaEtiq.innerHTML = files.map(f => `
        <li>
          <span>${f}</span>
          <button class="btn-print" data-file="${f}">Imprimir</button>
        </li>`).join('');
    }
  } catch (err) {
    console.error(err);
    listaEtiq.innerHTML = '<li>Falha ao buscar etiquetas</li>';
  }

  etiquetasModal.classList.add('is-active');
});

document
  .querySelector('#etiquetasModal .close-modal')
  .addEventListener('click', () =>
    etiquetasModal.classList.remove('is-active')
  );

listaEtiq.addEventListener('click', e => {
  if (e.target.matches('.btn-print')) {
    const file = e.target.dataset.file;
    window.open(`/etiquetas/printed/${encodeURIComponent(file)}`, '_blank');
  }
});

  /* –– NUVEM –– */
  cloudBtn?.addEventListener('click', e => {
    e.preventDefault();
    alert('Clicou em nuvem');
  });
/* –– AVATAR –– */
/*  Só chama o modal se a função já estiver registrada
    (login.js a registra na janela).  Nada de redirecionar! */
avatar?.addEventListener('click', e => {
  e.preventDefault();
  if (window.openLoginModal) window.openLoginModal();
});

});

initDadosColaboradoresUI();
initAnexosUI();



// Substitua toda a função resetSubTabs atual por esta:
// --- substitua a função inteira por isto ---
function resetSubTabs() {
  // 1) desmarca todas as sub-abas
  document
    .querySelectorAll('#dadosProduto .sub-tabs .main-header-link')
    .forEach(link => link.classList.remove('is-active'));

  // 2) oculta todos os conteúdos secundários
  document
    .querySelectorAll('#dadosProduto .sub-content')
    .forEach(sec => (sec.style.display = 'none'));

  // 3) destaca a sub-aba “Detalhes”
  const detalhesLink = document.querySelector(
    '#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]'
  );
  if (detalhesLink) detalhesLink.classList.add('is-active');

  // 4) exibe o container <div id="detalhesTab">
  const detalhesContent = document.getElementById('detalhesTab');
  if (detalhesContent) detalhesContent.style.display = 'block';
}

// garante que clicar em QUALQUER ponto da barra de pesquisa dá foco ao input
document.querySelector('.search-bar').addEventListener('click', () => {
  const inp = document.querySelector('.search-bar input');
  if (inp) inp.focus();
});

// 2) Dentro de loadDadosProduto, após obter `dados`, chame:
function populateSubTabs(dados) {
  // DETALHES DO PRODUTO
  const dl = document.getElementById('detalhesList');
  dl.innerHTML = `
    <li><div>Descrição família</div><div>${dados.familia || ''}</div></li>
    <li><div>Valor unitário</div><div>${dados.valor_unitario || ''}</div></li>
    <li><div>Tipo item</div><div>${dados.tipo_item || ''}</div></li>
    <li><div>Marca</div><div>${dados.marca || ''}</div></li>
    <li><div>Modelo</div><div>${dados.modelo || ''}</div></li>
    <li><div>Descrição detalhada</div><div>${dados.descricao_detalhada || ''}</div></li>
    <li><div>Obs internas</div><div>${dados.obs_internas || ''}</div></li>
  `;

  // DADOS DE CADASTRO
  const cad = document.getElementById('cadastroList');
  cad.innerHTML = `
    <li><div>Código OMIE</div><div>${dados.codigo_omie || ''}</div></li>
    <li><div>Código família</div><div>${dados.codigo_familia || ''}</div></li>
    <li><div>Usuário alteração</div><div>${dados.usuario_alteracao || ''}</div></li>
    <li><div>Data alteração</div><div>${dados.data_alteracao || ''}</div></li>
    <li><div>Hora alteração</div><div>${dados.hora_alteracao || ''}</div></li>
    <li><div>Usuário inclusão</div><div>${dados.usuario_inclusao || ''}</div></li>
    <li><div>Data inclusão</div><div>${dados.data_inclusao || ''}</div></li>
    <li><div>Hora inclusão</div><div>${dados.hora_inclusao || ''}</div></li>
    <li><div>Bloqueado</div><div>${dados.bloqueado || ''}</div></li>
    <li><div>Bloquear exclusão</div><div>${dados.bloquear_exclusao || ''}</div></li>
    <li><div>Inativo</div><div>${dados.inativo || ''}</div></li>
  `;

  // FINANCEIRO
  const fin = document.getElementById('financeiroList');
  fin.innerHTML = `
    <li><div>NCM</div><div>${dados.ncm || ''}</div></li>
  `;

  // LOGÍSTICA: o que sobrar
  const log = document.getElementById('logisticaList');
  log.innerHTML = Object.entries(dados.logistica || {})
    .map(([chave, valor]) =>
      `<li><div>${chave.replace(/_/g,' ')}</div><div>${valor}</div></li>`
    )
    .join('');
}

// 3) Dentro da sua função assíncrona que carrega o produto:
// corrigido: marque como async
async function loadDadosProduto(codigo) {
  // 1) faça o fetch com await também (caso ainda não esteja):
  const res = await fetch(`/api/produtos/detalhes/${encodeURIComponent(codigo)}`);
  // 2) agora você pode usar await res.json()
  const dados = await res.json();
  ultimoCodigo = codigo;        // grava o código para outras abas

  // 3) popula as sub-abas
  populateSubTabs(dados);

  // 4) garante que abra a aba “Detalhes”
  const trigger = document.querySelector(
    '#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]'
  );
  if (trigger) trigger.click();
}

window.loadDadosProduto = loadDadosProduto;   // <-- expõe globalmente


// Função para preencher os menus lateral e superior com um <select> de permissões
function loadMenus() {
  const sideContainer = document.getElementById('sideMenuList');
  const topContainer  = document.getElementById('topMenuList');
  if (!sideContainer || !topContainer) return;

  const roles = ['admin', 'visualizacao', 'edição', 'Ocultar'];

  // — Preenche Menu Lateral —
  sideContainer.innerHTML = '';
  document.querySelectorAll('.left-side .side-menu a').forEach(link => {
    const li     = document.createElement('li');
    const span   = document.createElement('span');
    const select = document.createElement('select');

    li.classList.add('content-list-item');
    select.classList.add('content-select');

    span.textContent = link.textContent.trim();
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value       = r;
      opt.textContent = r;
      select.appendChild(opt);
    });
    select.value = 'Ocultar';

    li.append(span, select);
    sideContainer.appendChild(li);
  });

  // — Preenche Menu Superior —
  topContainer.innerHTML = '';
  document.querySelectorAll('.header .header-menu > .menu-link').forEach(link => {
    const li     = document.createElement('li');
    const span   = document.createElement('span');
    const select = document.createElement('select');

    li.classList.add('content-list-item');
    select.classList.add('content-select');

    span.textContent = link.textContent.trim();
    roles.forEach(r => {
      const opt = document.createElement('option');
      opt.value       = r;
      opt.textContent = r;
      select.appendChild(opt);
    });
    select.value = 'Ocultar';

    li.append(span, select);
    // **Aqui** você deve usar o topContainer
    topContainer.appendChild(li);
  });
}


// 1) Alterna entre Produto ⇄ Pedidos
/* ======== Links diretos do cabeçalho ======== */
document.getElementById('menu-produto') .addEventListener('click', e => {
  e.preventDefault();
  hideKanban();            // <<<<< usa o helper novo
  openDadosProdutoTab();   // já existia
});

document.getElementById('menu-pedidos').addEventListener('click', e => {
  e.preventDefault();
  showKanban();            // <<<<< usa o helper novo
});


/* —————————————————————————————
   Kanban interno  (Comercial / PCP / …)
————————————————————————————— */
function showKanbanTab(nome) {
  lastKanbanTab = nome;          //  ← NOVO
  /* 1) fixa o highlight na barra */
  document.querySelectorAll('#kanbanTabs .main-header-link')
    .forEach(a => a.classList.toggle('is-active',
                                     a.dataset.kanbanTab === nome));

  /* 2) mostra só a página pedida */
  document.querySelectorAll('#kanbanContent .kanban-page')
    .forEach(p => p.style.display =
                p.id === `conteudo-${nome}` ? 'block' : 'none');
}

/*  listeners da barra “Comercial | PCP | …”  */
document.querySelectorAll('#kanbanTabs .main-header-link')
  .forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const alvo = link.dataset.kanbanTab;   // comercial / pcp / …
      showKanbanTab(alvo);
    });
  });


  /* ===========================================================
   Abas internas (Dados do produto | Estrutura | Fotos | …)
   =========================================================== */
document.querySelectorAll('#produtoTabs .main-header-link').forEach(tab => {
  tab.addEventListener('click', e => {
    e.preventDefault();

    // 1) visual ------------------------------------------------
    document
      .querySelectorAll('#produtoTabs .main-header-link')
      .forEach(a => a.classList.remove('is-active'));
    tab.classList.add('is-active');

    const paneId = tab.dataset.target;
    document
      .querySelectorAll('#produtoTabs .tab-pane')
      .forEach(p => p.style.display = (p.id === paneId ? 'block' : 'none'));

    // 2) lógica ------------------------------------------------
if (paneId === 'estruturaProduto') {
      if (!ultimoCodigo) {
        console.warn('Estrutura → nenhum produto carregado ainda');
        return;
      }

      // ====== SUBSTITUA todo o bloco abaixo ======
      //   if (typeof window.loadDadosProduto === 'function') {
      //     window.loadDadosProduto(ultimoCodigo);
      //   }
      // ===========================================

      loadEstruturaProduto(ultimoCodigo);   // ✔ mostra spinner + carrega malha
}
  });
});

// ---------- MENU RESPONSIVO ----------
const header   = document.getElementById('appHeader');   // <div class="header">
const menu     = document.getElementById('mainMenu');    // <nav …>
const moreBtn  = document.getElementById('moreBtn');     // botão ⋯
const moreMenu = document.getElementById('moreMenu');    // dropdown
const notifLi  = document.getElementById('menu-notificacoes'); // link “Notificações”

function recalculaMenu () {
  /* 1) devolve tudo ao <nav> antes de medir ----------------------- */
  while (moreMenu.firstChild) menu.appendChild(moreMenu.firstChild);
  moreBtn.style.display = 'none';

  /* 2)       ↙ larg. header  − (busca + ícones + paddings + ‘…’) */
  const busca   = document.getElementById('searchBar');
  const icones  = document.querySelector('.header-profile');
  const padding = 60;                             // 2 × 30 px

  const livre = header.clientWidth
              - busca.offsetWidth
              - icones.offsetWidth
              - moreBtn.offsetWidth
              - padding;

  /* 3) força “Notificações” a ficar SEMPRE no dropdown ------------ */
  if (notifLi && menu.contains(notifLi)) {
    moreMenu.prepend(notifLi);
    moreBtn.style.display = 'block';
  }

  /* 4) empurra o que mais não couber ------------------------------ */
  while (menu.scrollWidth > livre && menu.children.length > 1) {
    moreMenu.prepend(menu.lastElementChild);
    moreBtn.style.display = 'block';
  }
}

/* abre/fecha o dropdown */
moreBtn.addEventListener('click', () => {
  moreMenu.classList.toggle('open');
});

/* recalcula em 3 situações */
window.addEventListener('resize',           recalculaMenu);
document.fonts?.ready.then(                  recalculaMenu);
document.addEventListener('DOMContentLoaded', recalculaMenu);
