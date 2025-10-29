// menu_produto.js
import config from './config.client.js';
const { OMIE_APP_KEY, OMIE_APP_SECRET } = config;
const API_BASE = window.location.origin; // já serve https://intranet-30av.onrender.com

// Estado compartilhado do multiplicador da PCP (fator aplicado às quantidades)
if (!Number.isFinite(window.__pcpFactorValue) || window.__pcpFactorValue <= 0) {
  window.__pcpFactorValue = 1;
}
window.__pcpFactorInput = window.__pcpFactorInput || null;
window.__pcpFactorHandler = window.__pcpFactorHandler || null;

function pcpGetFactorValue() {
  const raw = Number(window.__pcpFactorValue ?? 1);
  return (!Number.isFinite(raw) || raw <= 0) ? 1 : raw;
}

function pcpSetFactorValue(newValue, { syncInput = true } = {}) {
  let val = Number(newValue);
  if (!Number.isFinite(val) || val <= 0) val = 1;
  window.__pcpFactorValue = val;

  if (syncInput) {
    const input = document.getElementById('pcp-factor');
    if (input && document.activeElement !== input) {
      input.value = val;
    }
  }
  return val;
}


// refs do modal de colaboradores
const BASE = API_BASE;

const txtId     = document.getElementById('colab-id');



let colabModalMode = 'create';   // 'create' | 'edit'
let colabEditSnapshot = null;    // guarda o estado original p/ "salvar só o que mudou"

// mantém referência ao listener atual para poder remover
let _currentSalvarWrapper = null;


function setSalvarHandler(fn) {
  if (!btnSalvar) return;

  // remove o listener anterior, se houver
  if (_currentSalvarWrapper) {
    btnSalvar.removeEventListener('click', _currentSalvarWrapper);
    _currentSalvarWrapper = null;
  }

  // cria um wrapper único
  const wrapper = async (ev) => {
    ev.preventDefault();
    const original = btnSalvar.textContent;
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando…';
    try { await fn(); }
    finally { btnSalvar.disabled = false; btnSalvar.textContent = original; }
  };

  // registra e guarda a referência
  btnSalvar.addEventListener('click', wrapper);
  _currentSalvarWrapper = wrapper;
}


// ajuda a marcar roles por valor
function marcarRoles(rolesArr) {
  const want = new Set((rolesArr || []).map(String));
  rolesBox.querySelectorAll('input[type=checkbox]').forEach(ch => {
    ch.checked = want.has(String(ch.value));
  });
}

// seleciona <option> por texto visível (quando só temos o nome)
function selectOptionByText(selectEl, label) {
  if (!selectEl || !label) return;
  const lab = String(label).trim().toLowerCase();
  const opt = Array.from(selectEl.options).find(o => o.textContent.trim().toLowerCase() === lab);
  if (opt) selectEl.value = opt.value;
}


const txtUser   = document.getElementById('colab-username');
const selFunc   = document.getElementById('colab-funcao');
const selSetor  = document.getElementById('colab-setor');
const selOper   = document.getElementById('colab-operacao');
const rolesBox  = document.getElementById('colab-roles');
const blocoPerm = document.getElementById('colab-permissoes');
const operListEl = document.getElementById('colab-operacao-list');

function normalizeOperacoes(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

const modal     = document.getElementById('colabModal');
const closeBtn  = document.getElementById('colabModalClose');
const btnSalvar = document.getElementById('colabSalvar');
const btnCanc   = document.getElementById('colabCancelar');

let colabOperacoesSelecionadas = [];

function renderOperacoesSelecionadas() {
  if (!operListEl) return;
  operListEl.innerHTML = '';
  if (!colabOperacoesSelecionadas.length) {
    const empty = document.createElement('div');
    empty.className = 'operacao-empty';
    empty.textContent = 'Nenhuma operação adicionada.';
    operListEl.appendChild(empty);
    return;
  }
  colabOperacoesSelecionadas.forEach(op => {
    const chip = document.createElement('span');
    chip.className = 'operacao-chip';
    chip.dataset.id = op.id != null ? String(op.id) : '';
    chip.innerHTML = `
      <span>${op.label || op.operacao || op.id || '(sem nome)'}</span>
      <button type="button" class="operacao-remove" aria-label="Remover operação" title="Remover operação">&minus;</button>
    `;
    operListEl.appendChild(chip);
  });
}

function setOperacoesSelecionadas(list) {
  const out = [];
  if (Array.isArray(list)) {
    list.forEach((op) => {
      if (!op) return;
      const id = op.id != null ? String(op.id) : '';
      const label = (op.label ?? op.operacao ?? op.name ?? '').trim();
      if (!id) return;
      if (out.some(existing => existing.id === id)) return;
      out.push({ id, label: label || id });
    });
  }
  colabOperacoesSelecionadas = out;
  renderOperacoesSelecionadas();
}

function addOperacaoSelecionada(id, label) {
  const key = id != null ? String(id) : '';
  if (!key) return;
  const already = colabOperacoesSelecionadas.some(op => String(op.id) === key);
  if (already) return;
  colabOperacoesSelecionadas.push({ id: key, label: (label || key).trim() });
  renderOperacoesSelecionadas();
}

function removeOperacaoSelecionada(id) {
  const key = id != null ? String(id) : '';
  const next = colabOperacoesSelecionadas.filter(op => String(op.id) !== key);
  if (next.length !== colabOperacoesSelecionadas.length) {
    colabOperacoesSelecionadas = next;
    renderOperacoesSelecionadas();
  }
}

function handleOperacaoChange() {
  if (!selOper) return;
  const val = selOper.value;
  if (!val) return;
  const label = selOper.selectedOptions?.[0]?.textContent?.trim() || val;
  addOperacaoSelecionada(val, label);
  selOper.value = '';
}

operListEl?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.operacao-remove');
  if (!btn) return;
  const chip = btn.closest('.operacao-chip');
  if (chip) removeOperacaoSelecionada(chip.dataset.id || '');
});

selOper?.addEventListener('change', handleOperacaoChange);

function openColabModalCreate() {
  colabModalMode = 'create';
  document.getElementById('colabModalTitle').textContent = 'Novo colaborador';
  txtId.value = '';
  txtUser.value = '';
  rolesBox.querySelectorAll('input[type=checkbox]').forEach(i => (i.checked = false));
  if (selFunc) selFunc.selectedIndex = 0;
  if (selSetor) selSetor.selectedIndex = 0;
  if (selOper) selOper.selectedIndex = 0;
  setOperacoesSelecionadas([]);

  // no modo criar, ocultamos o bloco de permissões (permanece como está)
  if (blocoPerm) blocoPerm.style.display = 'none';

  // handler de salvar = criar
  setSalvarHandler(salvarNovoColaborador);

  modal.style.display = 'block';
  setTimeout(() => txtUser.focus(), 50);
}

async function openColabModalEdit(userObj) {
  // garante listas carregadas
  await Promise.all([loadFuncoes(), loadSetores(), loadOperacoes()]);

  colabModalMode = 'edit';
  document.getElementById('colabModalTitle').textContent = 'Editar colaborador';

  // snapshot original (por texto) — para compararmos depois
  const operacoesRaw = normalizeOperacoes(userObj.operacoes);
  colabEditSnapshot = {
    id:        String(userObj.id || '').trim(),
    username:  String(userObj.username || '').trim(),
    funcao:    String(userObj.funcao || '').trim(),   // nome da função
    setor:     String(userObj.setor  || '').trim(),   // nome do setor
    operacao:  String(userObj.operacao || '').trim(),
    operacao_id: userObj.operacao_id != null ? Number(userObj.operacao_id) : null,
    operacoes: operacoesRaw.length
      ? operacoesRaw.map(op => ({
          id: op?.id != null ? String(op.id) : '',
          label: op?.label ?? op?.operacao ?? op?.name ?? ''
        })).filter(op => op.id)
      : [],
    roles:     Array.isArray(userObj.roles) ? userObj.roles.slice() : []
  };
  colabEditSnapshot.operacao_ids = (colabEditSnapshot.operacoes || [])
    .map(op => op?.id ? String(op.id) : '')
    .filter(Boolean);

  // preencher campos
  txtId.value   = colabEditSnapshot.id;
  txtUser.value = colabEditSnapshot.username;

  // marcar roles
  marcarRoles(colabEditSnapshot.roles);

  // selecionar função/setor por NOME (se vierem os nomes)
  if (colabEditSnapshot.funcao) selectOptionByText(selFunc, colabEditSnapshot.funcao);
  if (colabEditSnapshot.setor)  selectOptionByText(selSetor, colabEditSnapshot.setor);
  const initialOps = [];
  if (colabEditSnapshot.operacoes?.length) {
    colabEditSnapshot.operacoes.forEach(op => {
      if (op && op.id) {
        initialOps.push({ id: String(op.id), label: op.label || op.operacao || op.name || String(op.id) });
      }
    });
  } else if (colabEditSnapshot.operacao_id != null || colabEditSnapshot.operacao) {
    initialOps.push({
      id: colabEditSnapshot.operacao_id != null ? String(colabEditSnapshot.operacao_id) : '',
      label: colabEditSnapshot.operacao || ''
    });
  }
  setOperacoesSelecionadas(initialOps);
  if (selOper) selOper.value = '';

  // no modo editar também não mexemos em Permissões aqui
  if (blocoPerm) blocoPerm.style.display = 'none';

  // handler de salvar = atualizar
  setSalvarHandler(salvarEdicaoColaborador);

  modal.style.display = 'block';
  setTimeout(() => txtUser.focus(), 50);
}
window.openColabEdit = openColabModalEdit; // expõe p/ dados_colaboradores.js


function closeColabModal() {
  modal.style.display = 'none';
}

// UX: fecha no ESC
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && modal?.style.display === 'block') {
    closeColabModal();
  }
});


function getSelectedRoles() {
  return Array.from(rolesBox.querySelectorAll('input[type=checkbox]:checked'))
    .map(i => i.value);
}

async function loadFuncoes() {
  const r = await fetch(`${BASE}/api/colaboradores/funcoes`, { credentials: 'include' });
  const js = r.ok ? await r.json() : [];
  selFunc.innerHTML = js.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
}

async function loadSetores() {
  const r = await fetch(`${BASE}/api/colaboradores/setores`, { credentials: 'include' });
  const js = r.ok ? await r.json() : [];
  selSetor.innerHTML = js.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

async function loadOperacoes() {
  if (!selOper) return;
  let options = '<option value="">Selecionar operação…</option>';
  try {
    const r = await fetch(`${BASE}/api/colaboradores/operacoes`, { credentials: 'include' });
    if (r.ok) {
      const js = await r.json();
      options += js.map(op => `<option value="${op.id}">${op.operacao || op.name || op.label || op.id}</option>`).join('');
    }
  } catch (e) {
    console.warn('[colab] Falha ao carregar operações', e);
  }
  selOper.innerHTML = options;
}

async function createFuncao() {
  const name = prompt('Nome da nova função:');
  if (!name) return;
  const r = await fetch(`${BASE}/api/colaboradores/funcoes`, {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ name })
  });
  if (!r.ok) return alert('Erro ao criar função');
  const { id } = await r.json();
  await loadFuncoes();
  selFunc.value = String(id);
}

async function createSetor() {
  const name = prompt('Nome do novo setor:');
  if (!name) return;
  const r = await fetch(`${BASE}/api/colaboradores/setores`, {
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
    body: JSON.stringify({ name })
  });
  if (!r.ok) return alert('Erro ao criar setor');
  const { id } = await r.json();
  await loadSetores();
  selSetor.value = String(id);
}

async function salvarNovoColaborador() {
  const username = txtUser.value.trim();
  if (!username) { alert('Informe o Usuário'); txtUser.focus(); return; }

  const roles     = getSelectedRoles();      // ['admin'] / ['editor'] / []
  const funcao_id = Number(selFunc.value);
  const setor_id  = Number(selSetor.value);
 const operacao_ids = colabOperacoesSelecionadas
    .map(op => (op?.id ?? '').toString().trim())
    .filter(id => id.length > 0);
  const operacao_id = operacao_ids.length ? operacao_ids[0] : null;

  // senha inicial simples (pode ser gerada no backend também)
  const senha_inicial = Math.random().toString(36).slice(2, 8) + '123';

  const r = await fetch(`${BASE}/api/colaboradores`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, senha: senha_inicial, roles, funcao_id, setor_id, operacao_id, operacao_ids })
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return alert(err.error || 'Falha ao cadastrar colaborador');
  }

  const novo = await r.json();
  txtId.value = novo.id;

  // fecha e pede recarga da lista
  closeColabModal();
  try { document.getElementById('btn-colab-reload')?.click(); } catch {}
}

async function salvarEdicaoColaborador() {
  if (!colabEditSnapshot) return alert('Sem usuário em edição.');

  const id = txtId.value.trim();
  if (!id) return alert('ID inválido.');

  // valores atuais
  const now = {
    username: txtUser.value.trim(),
    roles: getSelectedRoles(),
    funcao_id: Number(selFunc.value || 0) || null,
    setor_id:  Number(selSetor.value || 0) || null,
    funcao_label: selFunc.selectedOptions?.[0]?.textContent?.trim() || '',
    setor_label:  selSetor.selectedOptions?.[0]?.textContent?.trim() || '',
    operacao_ids: colabOperacoesSelecionadas
      .map(op => (op?.id ?? '').toString().trim())
      .filter(id => id.length > 0),
    operacao_label: colabOperacoesSelecionadas[0]?.label || ''
  };
  now.operacao_id = now.operacao_ids.length ? now.operacao_ids[0] : null;

  // monta payload só com o que mudou
  const body = {};
  if (now.username && now.username !== colabEditSnapshot.username) body.username = now.username;

  const sameRoles = (a,b) => {
    const A = (a||[]).slice().sort().join('|');
    const B = (b||[]).slice().sort().join('|');
    return A === B;
  };
  if (!sameRoles(now.roles, colabEditSnapshot.roles)) body.roles = now.roles;

  if (now.funcao_label && now.funcao_label !== colabEditSnapshot.funcao) body.funcao_id = now.funcao_id;
  if (now.setor_label  && now.setor_label  !== colabEditSnapshot.setor)  body.setor_id  = now.setor_id;

  const snapshotOperIds = (colabEditSnapshot.operacao_ids || [])
    .map(id => id ? String(id).trim() : '')
    .filter(Boolean)
    .sort();
  const currentOperIds = colabOperacoesSelecionadas
    .map(op => op?.id ? String(op.id) : '')
    .filter(Boolean)
    .sort();
  const sameOperIds = snapshotOperIds.length === currentOperIds.length &&
    snapshotOperIds.every((id, idx) => id === currentOperIds[idx]);
  if (!sameOperIds) {
    body.operacao_ids = now.operacao_ids;
    body.operacao_id = now.operacao_id;
  }

  if (!Object.keys(body).length) {
    alert('Nada mudou.');
    return;
  }

  const r = await fetch(`${BASE}/api/colaboradores/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });

if (!r.ok) {
  // trata 409 com mensagem específica
  if (r.status === 409) {
    const e = await r.json().catch(()=> ({}));
    return alert(e.error || 'Este nome de usuário já está em uso.');
  }
  const e = await r.json().catch(()=> ({}));
  return alert(e.error || `Falha ao salvar alterações (HTTP ${r.status}).`);
}


  // OK — fecha modal e recarrega a lista
  modal.style.display = 'none';
  try { document.getElementById('btnRecarregarColab')?.click(); } catch {}
}


function ensureColabCreateButton() {
  // só mostra para quem está logado
  if (!window.__sessionUser) return;

  const root = document.getElementById('dadosColaboradores');
  if (!root) return;

  // tenta encontrar um botão "Recarregar" por id ou pelo texto
  const findReload = () => {
    // 1) id explícito (se seu módulo usar esse id)
    let el = document.getElementById('btn-colab-reload');
    if (el) return el;

    // 2) busca por texto RECARREGAR dentro da seção
    el = [...root.querySelectorAll('button, .content-button, .status-button')]
      .find(b => /recarregar/i.test((b.textContent || '').trim()));
    return el || null;
  };

  // ponto de ancoragem preferencial (depois do “Recarregar”)
  let anchor = findReload();

  // fallback: algum contêiner visível da seção de colaboradores
  if (!anchor) {
    anchor = root.querySelector('.content-buttons, .content .header, .content')
          || root;
  }

  // evita duplicar
  if (document.getElementById('btn-colab-create')) return;

  // cria o botão “+”
  const btn = document.createElement('button');
  btn.id = 'btn-colab-create';
  btn.textContent = '+';
  btn.title = 'Novo colaborador';
  btn.className = (anchor.className && /status-button|content-button/.test(anchor.className))
    ? anchor.className
    : 'content-button status-button';
  btn.style.marginLeft = '6px';

  // insere logo após o “Recarregar” (se encontrado) ou no topo do contêiner
  if (anchor.tagName === 'BUTTON') {
    anchor.insertAdjacentElement('afterend', btn);
  } else {
    anchor.prepend(btn);
  }

  // ao clicar, abre o modal em modo criar
  btn.addEventListener('click', async () => {
    await Promise.all([loadFuncoes(), loadSetores(), loadOperacoes()]);
    openColabModalCreate();
  });
}


// ligar botões do modal (fechar/salvar/cancelar)
document.getElementById('btn-add-funcao')?.addEventListener('click', createFuncao);
document.getElementById('btn-add-setor')?.addEventListener('click', createSetor);
btnCanc  ?.addEventListener('click', closeColabModal);
closeBtn ?.addEventListener('click', closeColabModal);
// fechar clicando fora
modal?.addEventListener('click', (e) => { if (e.target === modal) closeColabModal(); });

// toda vez que você abrir a página "Cadastro de colaboradores",
// chame ensureColabCreateButton() depois que a UI deles renderizar.


let ultimoCodigo = null;      // <-- NOVO

import { initListarProdutosUI } from './requisicoes_omie/ListarProdutos.js';
import { initDadosColaboradoresUI } from './requisicoes_omie/dados_colaboradores.js';
import { initAnexosUI } from './requisicoes_omie/anexos.js';
import { initKanban } from './kanban/kanban.js';
let lastKanbanTab = 'comercial';   // lembra a sub-aba atual

import { loadDadosProduto as loadDadosProdutoReal }
  from './requisicoes_omie/Dados_produto.js';
/* ——— IMPORT único do módulo Kanban ——— */
import * as KanbanViews from './kanban/kanban.js';

import { initPreparacaoKanban } from './kanban/kanban_preparacao.js';

let almoxCurrentPage = 1;
// —— Produção —— //
let prodAllDados   = [];
let prodCurrentPage = 1;
let prodTotalPages  = 1;
// —— Filtro Produção —— //
let prodTipoMap        = new Map();   // desc -> prefixo
let prodActivePrefixes = new Set();   // prefixos ativos
let prodCsvLoaded      = false;


let almoxAllDados = [];   // mantém o array completo para filtro
/* — Filtro por Tipo (Almoxarifado) — */
let almoxTipoMap        = new Map();   // desc  -> prefixo (Tipo do produto)
let almoxActivePrefixes = new Set();   // prefixos atualmente exibidos
let almoxCsvLoaded      = false;
let transferenciaItem   = null;        // último item selecionado para transferência
let transferenciaLista  = [];          // itens adicionados à transferência
let transferLocais      = [];          // locais de estoque disponíveis
const TRANSFER_DEFAULT_ORIGEM  = '10408201806';
const TRANSFER_DEFAULT_DESTINO = '10564345392';

// === PATCH GLOBAL DO FETCH (garante cookie da sessão em TODAS as requests) ===
(function hardenFetchCredentials(){
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    init = init || {};
    // preserva se já estiver setado; senão, força 'include'
    if (!init.credentials) init.credentials = 'include';
    return _fetch(input, init);
  };
})();

// ——— formatação numérica (xx.xxx,yy) ———
const fmtBR = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/* —— desenha <tbody> a partir de um array —— */
function renderAlmoxTable(arr) {
  const tbody = document.querySelector('#tbl-almoxarifado tbody');
  tbody.innerHTML = '';

  let somaCMC = 0;
  arr.forEach(p => {
    somaCMC += parseFloat(p.cmc);  // acumula total

    const tr = document.createElement('tr');
    tr.dataset.codigo    = p.codigo || '';
    tr.dataset.descricao = p.descricao || '';
    tr.dataset.min       = fmtBR.format(p.min);
    tr.dataset.fisico    = fmtBR.format(p.fisico);
    tr.dataset.saldo     = fmtBR.format(p.saldo);
    tr.dataset.cmc       = fmtBR.format(p.cmc);
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td class="num">${fmtBR.format(p.min)}</td>
      <td class="num">${fmtBR.format(p.fisico)}</td>
      <td class="num">${fmtBR.format(p.saldo)}</td>
      <td class="num">R$ ${fmtBR.format(p.cmc)}</td>`;
    tbody.appendChild(tr);
  });

  /* contador de itens */
  document.getElementById('almoxCount').textContent = arr.length;

  /* total CMC */
  document.getElementById('almoxCmcTotal').textContent =
    `Total CMC: R$ ${fmtBR.format(somaCMC)}`;
}

// Controle de botões que exigem login
function setAuthGroupState(isLoggedIn) {
  const group = document.querySelector('[data-auth-guard]');
  if (!group) return;

  const buttons = group.querySelectorAll('.requires-auth');

  buttons.forEach(btn => {
    if (isLoggedIn) {
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
      btn.classList.remove('auth-disabled');
      btn.title = '';
    } else {
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('auth-disabled');
      // dica sutil para o usuário
      btn.title = 'Faça login para usar esta função';
    }
  });
}

// Intercepta cliques quando deslogado (evita navegação/JS acionar)
function installAuthClickGuard() {
  const group = document.querySelector('[data-auth-guard]');
  if (!group) return;

  // delegação de eventos no grupo
  group.addEventListener('click', (ev) => {
    const target = ev.target.closest('.requires-auth');
    if (!target) return;

    // se está marcado como desabilitado, bloqueia
    if (target.classList.contains('auth-disabled') || target.getAttribute('aria-disabled') === 'true' || target.disabled) {
      ev.preventDefault();
      ev.stopPropagation();
      // opcional: algum feedback visual rápido
      target.classList.add('auth-bump');
      setTimeout(() => target.classList.remove('auth-bump'), 150);
    }
  }, true);
}


function aplicarFiltroAlmox() {
  const termo = document.getElementById('almoxSearch').value
                 .trim().toLowerCase();

  const filtrados = almoxAllDados.filter(p => {
    const prefixOk = [...almoxActivePrefixes]
                   .some(pre => p.codigo.startsWith(pre));

    const termoVazio = termo.length === 0;
    const codigoOk   = (p.codigo || '').toLowerCase().includes(termo);
    const descricaoOk = (p.descricao || '').toLowerCase().includes(termo);
    const buscaOk    = termoVazio || codigoOk || descricaoOk;
    return prefixOk && buscaOk;
  });
  renderAlmoxTable(filtrados);
}

function renderProdTable(arr) {
  const tbody = document.querySelector('#tbl-producao tbody');
  tbody.innerHTML = '';
  let soma = 0;

  arr.forEach(p => {
    soma += parseFloat(p.cmc);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td class="num">${fmtBR.format(p.min)}</td>
      <td class="num">${fmtBR.format(p.fisico)}</td>
      <td class="num">${fmtBR.format(p.reservado)}</td>
      <td class="num">${fmtBR.format(p.saldo)}</td>
      <td class="num">R$ ${fmtBR.format(p.cmc)}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('prodCount').textContent = arr.length;
  document.getElementById('prodCmcTotal').textContent =
    `Total CMC: R$ ${fmtBR.format(soma)}`;
}

function aplicarFiltroProd() {
  const termo = document.getElementById('prodSearch').value.trim().toLowerCase();

  const filtrados = prodAllDados.filter(p => {
    const prefixOk = [...prodActivePrefixes]
                      .some(pre => p.codigo.startsWith(pre));
    const buscaOk  = p.descricao.toLowerCase().includes(termo);
    return prefixOk && buscaOk;
  });
  renderProdTable(filtrados);
}


let almoxTotalPages  = 1;


// deixa a versão completa visível globalmente
window.loadDadosProduto = loadDadosProdutoReal;


async function fetchAndRenderProdutos() {
  console.log('[DEBUG] fetchAndRenderProdutos: iniciando');
  showSpinner();
  try {
    console.log(`[DEBUG] fetchAndRenderProdutos: enviando requisição para ${API_BASE}/api/omie/produtos`);
    const res = await fetch(`${API_BASE}/api/omie/produtos`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type':'application/json' },
      body: JSON.stringify({
        call:       'ListarProdutosResumido',
        app_key:    OMIE_APP_KEY,
        app_secret: OMIE_APP_SECRET,
        param: [{
          pagina: 1,
          registros_por_pagina: 100,
          filtrar_apenas_descricao: ''
        }]
      })
    });
    console.log('[DEBUG] fetchAndRenderProdutos: resposta HTTP recebida, status', res.status);

    const json = await res.json();
    console.log('[DEBUG] fetchAndRenderProdutos: JSON completo:', json);

    const items = json.produto_servico_resumido || [];
    console.log('[DEBUG] fetchAndRenderProdutos: items extraídos:', items.length, 'itens');

    // atualiza contador
    document.getElementById('productCount').textContent = items.length;
    console.log('[DEBUG] fetchAndRenderProdutos: contador atualizado para', items.length);

    // monta a lista
    const ul = document.getElementById('listaProdutosList');
    console.log('[DEBUG] fetchAndRenderProdutos: UL encontrado:', ul);

    ul.innerHTML = items.map(item => `
      <li data-codigo="${item.codigo}" data-descricao="${item.descricao}">
        <span class="products">${item.codigo}</span>
        <span class="status">${item.descricao}</span>
        <span class="unidade">${item.saldo_disponivel ?? '-'}</span>
      </li>
    `).join('');
    console.log('[DEBUG] fetchAndRenderProdutos: UL.innerHTML atualizado');

  } catch (err) {
    console.error('[DEBUG] fetchAndRenderProdutos: erro ao buscar produtos →', err);
    alert('Erro ao buscar produtos: ' + err.message);
  } finally {
    hideSpinner();
    console.log('[DEBUG] fetchAndRenderProdutos: spinner escondido');
    console.log('[DEBUG] fetchAndRenderProdutos() terminou');
  }
}



function showMainTab(tabId) {
  // garante que se estava em Armazéns ou Kanban, tudo volte a esconder
  if (typeof hideArmazem === 'function') hideArmazem();
  if (typeof hideKanban === 'function') hideKanban();
  const produtoTabs = document.getElementById('produtoTabs');
  if (produtoTabs) produtoTabs.style.display = 'block';
  // força ocultar qualquer resquício das guias de Armazém
  const armTabs = document.getElementById('armazemTabs');
  const armContent = document.getElementById('armazemContent');
  if (armTabs) armTabs.style.display = 'none';
  if (armContent) armContent.style.display = 'none';
  document
    .querySelectorAll('#armazemContent .armazem-page')
    .forEach(p => (p.style.display = 'none'));

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
// Tenta descobrir o código "ao lado do +" na aba PCP, ou de outras fontes já usadas pelo app
function getPCPProdutoCodigo() {
  // fonte 1: estado corrente (sempre atualizado por quem abriu a PCP)
  if (window.pcpCodigoAtual && window.pcpCodigoAtual.trim()) return window.pcpCodigoAtual.trim();

  // fonte 2: o que já está na barra da PCP (fallback visual)
  const barCode = document.querySelector('#pcp-code')?.textContent?.trim();
  if (barCode) return barCode;

  // fonte 3: outras pistas (antigas)
  return (
       (window.codigoSelecionado || '').trim()
    || (window.prepCodigoSelecionado || '').trim()
    || document.querySelector('#dados-produto .produto-codigo')?.textContent?.trim()
    || ''
  );
}


function setPCPProdutoCodigo(codigo) {
  if (!codigo) return;

  // fonte de verdade do "código atual"
  window.pcpCodigoAtual = codigo;

  // atualiza cabeçalho/label
  const bar = document.querySelector('#pcp-code-bar');
  const slot =
    (bar && (bar.querySelector('.pcp-code-current') ||
             bar.querySelector('[data-role="pcp-code"]') ||
             bar.querySelector('.code'))) ||
    document.querySelector('#pcp-code');

  if (bar) bar.setAttribute('data-codigo', codigo);
  if (slot) slot.textContent = codigo;

  // NÃO chama ensure/fetch aqui
}

window.setPCPProdutoCodigo = setPCPProdutoCodigo;


// Busca a estrutura no SQL (rota: /api/pcp/estrutura)
// Envia pai_codigo no BODY para evitar 400 por parâmetro ausente.
// Mantém ?dbg=1 só para facilitar leitura de logs.
async function fetchEstruturaPCP_SQL(codigo) {
  const url = `${API_BASE}/api/pcp/estrutura?dbg=1`;
  const body = { pai_codigo: String(codigo || '').trim() };

  if (!body.pai_codigo) {
    throw new Error('Sem código do produto para carregar a estrutura (pai_codigo vazio).');
  }

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });

  const from = r.headers.get('X-From') || 'desconhecido';
  console.log('[PCP][Estrutura] Fonte da resposta:', from, 'URL:', url, 'BODY:', body);

  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error || j?.msg) msg = j.error || j.msg;
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}



// ——— PCP: preencher Qtd Pro / Qtd Alm depois de desenhar a lista ———
// ——— PCP: preencher Qtd Pro / Qtd Alm depois de desenhar a lista ———
async function pcpPreencherSaldosDuplosLocal(ul) {
  // coleta todos os códigos renderizados
  const codigos = Array.from(ul.querySelectorAll('li:not(.header-row) .cod'))
    .map(el => (el.textContent || '').trim())
    .filter(Boolean);

  if (!codigos.length) return;

  const r = await fetch(`${API_BASE}/api/armazem/saldos_duplos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ codigos }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const j   = await r.json();
  const pro = j?.pro || {};
  const alm = j?.alm || {};

  // aplica nos elementos
  ul.querySelectorAll('li:not(.header-row)').forEach(li => {
    const cod      = (li.querySelector('.cod')?.textContent || '').trim();
    const qtdProEl = li.querySelector('.qtdpro');
    const qtdAlmEl = li.querySelector('.qtdalm');

    const vPro = Number(pro[cod] ?? 0);
    const vAlm = Number(alm[cod] ?? 0);

    if (qtdProEl) qtdProEl.textContent = vPro.toLocaleString('pt-BR');
    if (qtdAlmEl) qtdAlmEl.textContent = vAlm.toLocaleString('pt-BR');

    // feedback visual simples
    if (qtdProEl && vPro <= 0) qtdProEl.style.color = '#e44';
    if (qtdAlmEl && vAlm <= 0) qtdAlmEl.style.color = '#e44';
  });
}

// Detecta códigos com padrão de produto principal que possuem estrutura: "xx.PP.yy"
function pcpIsPP(code) {
  return /\.PP\./.test(String(code || '').toUpperCase());
}

/* PCP — renderiza a lista de peças da guia PCP e agora:
   - Lê o multiplicador do input #pcp-factor (antes estava #pcp-mult e não existia no HTML).
   - Salva a Qtd base de cada item em data-qtd-base.
   - Faz o recálculo da coluna "Qtd" em TEMPO REAL a cada digitação no #pcp-factor.
   - DESTACA em vermelho (classe .pcp-warn) quando Qtd > Arm Pro (coluna .qtdpro).
   - Preenche a descrição do ITEM PAI consultando o back-end:
       1º tenta por ID (?id=int_produto),
       2º se não achar/for inválido, tenta por CODE (?code=cod_produto).
   - Mantém a descrição dos itens trocados amarela (classe .desc-trocado), exceto o item pai.
   Observação: "Qtd prod" NÃO é multiplicada. */
async function renderPCPListaEstrutura(payload, codigo) {
  const ul   = document.getElementById('listaPecasPCPList');
  const bar  = document.getElementById('pcp-code-bar');
  const code = document.getElementById('pcp-code');
  if (!ul) return;

  const codigoNorm = String(codigo ?? '').trim();

  if (!codigoNorm) {
    pcpUpdateListaVersaoBadge(null);
  } else {
    try {
      const meta = await pcpFetchEstruturaMetaByCod(codigoNorm);
      pcpUpdateListaVersaoBadge(meta?.versao ?? null);
    } catch (err) {
      console.warn('[PCP] Falha ao obter versão para Lista de peças:', err);
      pcpUpdateListaVersaoBadge(null);
    }
  }

  // ───────── helpers ─────────
  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const isPP = s => /\.PP\./i.test(String(s ?? '')); // “04.PP.N.51005” → true

  const parseQty = (v, def = 0) => {
    if (v === null || v === undefined || v === '') return def;
    if (typeof v === 'number') return Number.isFinite(v) ? v : def;
    let s = String(v).trim();
    const brMilharRegex = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;
    if (brMilharRegex.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  };
  const fmtQtdBR = (n) => {
    const val = Number(parseQty(n));
    const temDecimal = Math.abs(val % 1) > 1e-9;
    return val.toLocaleString('pt-BR', temDecimal ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : {});
  };
  const fmt = (n) => Number(parseQty(n)).toLocaleString('pt-BR');

  const toInputNumber = (val, precision = 6) => {
    const num = Number(parseQty(val, 0));
    if (!Number.isFinite(num)) return '0';
    const mul = Math.pow(10, precision);
    return String(Math.round(num * mul) / mul);
  };

  // garante barra e código visíveis
  if (bar) bar.style.display = 'flex';
  if (code) code.textContent = codigoNorm || '';

  // fonte canônica de itens
  const itens = Array.isArray(payload?.dados) ? payload.dados : [];

  // reset caches auxiliares de subitens PP
  pcpPPChildrenCache.clear();

  // limpa lista (preserva cabeçalho, se estiver dentro da UL)
  Array.from(ul.querySelectorAll('li:not(.header-row)')).forEach(li => li.remove());

  // multiplicador (aplica só na Qtd exibida; NÃO altera Qtd prod)
  let factor = parseQty(pcpGetFactorValue(), 1);
  if (!Number.isFinite(factor) || factor <= 0) factor = 1;
  pcpSetFactorValue(factor);

  // ===== ITEM PAI extraído do primeiro item (seu padrão atual) =====
  const parentInfo = itens[0] || null;
  const parentCodigo = parentInfo?.pai_codigo || codigoNorm || '';
  const parentDescRaw = parentInfo?.pai_descr_omie ?? parentInfo?.pai_descricao ?? '';
  const parentDesc   = String(parentDescRaw ?? '').trim();
  const parentUnidRaw= parentInfo?.pai_unid ?? parentInfo?.comp_unid ?? '';
  const parentUnid   = String(parentUnidRaw ?? '').trim();
  const parentIsPP   = isPP(parentCodigo);
  const parentProdId = parentInfo?.pai_id_omie ?? parentInfo?.pai_id ?? null;
  const parentDescDisplay = parentDesc ? esc(parentDesc) : '—';
  const parentDescTitle   = esc(parentDesc || '');
  const parentUnidDisplay = parentUnid ? esc(parentUnid) : '—';

  // [LOG][PCP][PAI] — depuração do que chegou do backend
  console.log('[PCP][PAI] ▶', {
    parentProdId,
    parentCodigo,
    parentDescRaw,
    parentDesc
  });

  // ===== RENDER DOS FILHOS =====
  const ppRows = [];
  const otherRows = [];

  for (const it of itens) {
    const codStr  = String(it.comp_codigo ?? '');
    const pp      = isPP(codStr);
    const qtdBase = parseQty(it.comp_qtd, 0);
    const qtdFinal= qtdBase * factor;
    const qtdProd = parseQty(it.qtd_prod, 0); // já calculada no backend (para PP)

    const hintTemEstr =
      it.tem_estrutura ?? it.has_estrutura ?? it.has_child ?? it.tem_filhos ??
      (parseQty(it.comp_filhos ?? it.comp_itens ?? 0, 0) > 0 ? true : undefined);

    const li = document.createElement('li');
    li.className = 'data-row';
    li.dataset.codigo = codStr;
    li.dataset.qtdBase = String(qtdBase); // guarda a Qtd base para recálculo ao vivo
    if (hintTemEstr !== undefined) li.dataset.temEstrutura = hintTemEstr ? '1' : '0';

    const codContent = pp
      ? `<label class="pp-select-item">
          <input type="checkbox" class="pp-select-checkbox" data-cod="${esc(codStr)}" aria-label="Selecionar ${esc(codStr)}" checked>
          <span title="${esc(codStr)}">${esc(codStr)}</span>
        </label>`
      : `<span title="${esc(codStr)}">${esc(codStr)}</span>`;

    const qtdCellContent = pp
      ? `<input type="number" class="pp-qtd-input" data-cod="${esc(codStr)}" value="${toInputNumber(qtdFinal)}" step="0.0001" min="0" aria-label="Quantidade para ${esc(codStr)}">`
      : fmtQtdBR(qtdFinal);

    li.innerHTML = `
      <div class="cod ${pp ? 'pp' : ''}">${codContent}</div>
      <div class="desc" title="${esc(it.comp_descricao ?? '')}">${esc(it.comp_descricao ?? '')}</div>
      <div class="unid">${esc(it.comp_unid ?? '')}</div>

      <!-- Qtd da estrutura (formato igual à "Estrutura de produto") -->
      <div class="qtd${pp ? ' qtd-editable' : ''}">${qtdCellContent}</div>

      <!-- Qtd prod: vazia para não-PP -->
      <div class="qtdprod">${pp ? fmtQtdBR(qtdProd) : ''}</div>

      <!-- Estoques -->
      <div class="qtdpro">0</div>
      <div class="qtdalm">${fmt(parseQty(it.qtd_alm, 0))}</div>

      <div class="acao flex gap-2">
        <!-- Trocar (duas setas opostas) -->
        <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${esc(codStr)}" title="Trocar produto">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
          </svg>
        </button>

        <!-- Solicitar (carrinho) -->
        <button class="icon-btn status-button open" data-action="solicitar" data-cod="${esc(codStr)}" title="Solicitar">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 .001 4.001A2 2 0 0 0 17 18ZM3 4h2l1.6 8.2A3 3 0 0 0 9.55 15h7.9a3 3 0 0 0 2.95-2.4L22 7H6.21L5.7 4.8A2 2 0 0 0 3.76 3.5L3 3.5V4Z"/>
          </svg>
        </button>

        <!-- Produzir (fábrica) -->
        ${pp ? `
        <button class="icon-btn produce-btn" data-action="produzir" data-cod="${esc(codStr)}" title="Produzir">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
            <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
          </svg>
        </button>` : ''}

        <!-- Estrutura (sitemap) -->
        ${(hintTemEstr === true && pp) ? `
        <button class="icon-btn estrutura-btn" data-action="estrutura" data-cod="${esc(codStr)}" title="Estrutura do item">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M10 3h4v4h-4V3ZM4 17h4v4H4v-4Zm12 0h4v4h-4v-4ZM11 7v3H7a1 1 0 0 0-1 1v2h4v-2h4v2h4v-2a1 1 0 0 0-1-1h-4V7h-2Z"/>
          </svg>
        </button>` : ''}
      </div>
    `;

    // destacou se Qtd > Arm Pro
    const qtdCell   = li.querySelector('.qtd');
    const qtdInput  = qtdCell?.querySelector('.pp-qtd-input');
    const armProVal = parseQty(li.querySelector('.qtdpro')?.textContent, 0);
    if (pp) li.classList.add('pp-row');

    if (qtdCell) {
      if (pp && qtdInput) qtdInput.value = toInputNumber(qtdFinal);
      if (qtdFinal > armProVal) qtdCell.classList.add('pcp-warn');
      else                      qtdCell.classList.remove('pcp-warn');
    }

    if (pp) ppRows.push(li);
    else    otherRows.push(li);
  }

  // ===== LINHA DO PAI (vai no topo) =====
  const parentLi = document.createElement('li');
  parentLi.className = `data-row pcp-parent-row${parentIsPP ? ' pp' : ''}`;
  parentLi.dataset.qtdBase = '1';
  if (parentProdId !== null && parentProdId !== undefined) {
    parentLi.dataset.produtoId = String(parentProdId);
  }
  parentLi.innerHTML = `
    <div class="cod ${parentIsPP ? 'pp' : ''}">
      <label class="pp-select-item pcp-parent-select">
        <input type="checkbox" class="pp-select-checkbox pcp-parent-checkbox" data-cod="${esc(parentCodigo)}" aria-label="Selecionar ${esc(parentCodigo)}" checked>
        <span title="${esc(parentCodigo)}">${esc(parentCodigo)}</span>
        <span class="pcp-parent-id" data-produto-id="${esc(parentProdId ?? '')}" aria-hidden="true"></span>
      </label>
    </div>
    <div class="desc" title="${parentDescTitle}">${parentDescDisplay}</div>
    <div class="unid">${esc(parentUnidDisplay)}</div>
    <div class="qtd">
      <input id="pcp-factor" type="number" min="1" step="1" value="${factor}" class="pcp-parent-factor" aria-label="Quantidade do produto pai">
    </div>
    <div class="qtdprod">-</div>
    <div class="qtdpro">-</div>
    <div class="qtdalm">-</div>
    <div class="acao parent-actions">
      <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${esc(parentCodigo)}" title="Trocar produto">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
        </svg>
      </button>
      <button class="icon-btn produce-btn" data-action="produzir" data-cod="${esc(parentCodigo)}" title="Produzir itens selecionados">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
          <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `;

  // insere o PAI antes de qualquer grupo
  ul.appendChild(parentLi);

  // [PCP][PAI][fallback] — se a descrição do pai ficou "—", consulta no SQL e atualiza a célula
  (async function ensurePaiDescricao() {
    try {
      const descCell = parentLi.querySelector('.desc');
      const txt = (descCell?.textContent || '').trim();
      const isEmpty = !txt || txt === '—';

      if (!isEmpty && (parentProdId ?? null) !== null) return;

      const idNum   = Number(parentProdId || 0);
      const codeStr = String(parentCodigo || '').trim();

      console.log('[PCP][PAI][fallback] ▶ verificação:', { txt, isEmpty, idNum, codeStr });

      const getJSON = async (url) => {
        const r = await fetch(url, { method: 'GET' });
        let j = null;
        try { j = await r.json(); } catch (e) { j = { ok:false, error:'json-parse', _e:String(e) }; }
        return { status: r.status, body: j };
      };

      let descr = null;

      // 1) tenta por ID
      if (Number.isFinite(idNum) && idNum > 0) {
        const urlId = `${API_BASE}/api/produto/descricao?id=${encodeURIComponent(idNum)}`;
        const { status, body } = await getJSON(urlId);
        console.log('[PCP][PAI][fallback] ◀ (id) status/body:', status, body);
        if (status === 200 && body?.ok && body?.descr_produto) {
          descr = body.descr_produto;
        }
      }

      // 2) se não achou por ID, tenta por CODE (cod_produto)
      if (!descr && codeStr) {
        const urlCode = `${API_BASE}/api/produto/descricao?code=${encodeURIComponent(codeStr)}`;
        const { status, body } = await getJSON(urlCode);
        console.log('[PCP][PAI][fallback] ◀ (code) status/body:', status, body);
        if (status === 200 && body?.ok && body?.descr_produto) {
          descr = body.descr_produto;
        }
      }

      if (descr) {
        descCell.textContent = descr;
        descCell.setAttribute('title', descr);
        console.log('[PCP][PAI][fallback] ✅ descrição aplicada:', descr);
      } else {
        console.warn('[PCP][PAI][fallback] ⚠ não foi possível resolver a descrição do pai por id/code.');
      }
    } catch (e) {
      console.warn('[PCP][PAI][fallback] ❌ erro inesperado:', e);
    }
  })();

  // ===== Agrupamento PP, divisores e binds =====
  if (ppRows.length) {
    const wrapLi = document.createElement('li');
    wrapLi.className = 'pcp-pp-group';
    wrapLi.innerHTML = `
      <div class="pcp-pp-card">
        <div class="pcp-pp-card-header">
          <label class="pcp-pp-master">
            <input type="checkbox" class="pcp-pp-master-checkbox" aria-label="Selecionar todos os itens PP">
            <span class="pcp-pp-card-title">Itens de preparação (PP)</span>
          </label>
          <div class="pcp-pp-card-actions">
            <span class="pcp-pp-card-count"></span>
            <button type="button" class="icon-btn produce-btn pcp-pp-card-produce" title="Produzir itens selecionados">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
                <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
        <ul class="pcp-pp-card-list"></ul>
      </div>
    `;
    const countEl = wrapLi.querySelector('.pcp-pp-card-count');
    if (countEl) {
      const plural = ppRows.length === 1 ? 'item' : 'itens';
      countEl.textContent = `${ppRows.length} ${plural}`;
    }
    const listEl = wrapLi.querySelector('.pcp-pp-card-list');
    if (listEl) ppRows.forEach(row => listEl.appendChild(row));
    ul.appendChild(wrapLi);
    if (listEl) {
      try { await pcpPopulatePPChildren(listEl); }
      catch (err) { console.warn('[PCP] falha ao carregar subitens PP:', err); }
    }

    const masterCb = wrapLi.querySelector('.pcp-pp-master-checkbox');
    if (masterCb && listEl) {
      const getItemCheckboxes = () => Array.from(listEl.querySelectorAll('.pp-select-checkbox'));
      const updateMasterState = () => {
        const boxes = getItemCheckboxes();
        if (!boxes.length) {
          masterCb.checked = false;
          masterCb.indeterminate = false;
          return;
        }
        const checkedCount = boxes.filter(cb => cb.checked).length;
        masterCb.checked = checkedCount === boxes.length;
        masterCb.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
      };

      masterCb.addEventListener('change', () => {
        const boxes = getItemCheckboxes();
        boxes.forEach(cb => { cb.checked = masterCb.checked; });
        masterCb.indeterminate = false;
        updateMasterState();
      });

      listEl.addEventListener('change', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains('pp-select-checkbox')) return;
        updateMasterState();
      });

      updateMasterState();
    }
  }

  if (ppRows.length && otherRows.length) {
    const divider = document.createElement('li');
    divider.className = 'pcp-section-divider';
    divider.innerHTML = '<span>Peças (demais itens)</span>';
    ul.appendChild(divider);
  }

  if (!ul.dataset.ppQtdBound) {
    ul.addEventListener('input', (ev) => {
      const target = ev.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains('pp-qtd-input')) return;
      const li = target.closest('li.data-row.pp-row');
      if (!li) return;
      let f = pcpGetFactorValue();
      if (!Number.isFinite(f) || f <= 0) f = 1;
      const entered = parseQty(target.value || 0, 0);
      const base = f ? entered / f : entered;
      li.dataset.qtdBase = String(base);
      const armPro = parseQty(li.querySelector('.qtdpro')?.textContent, 0);
      const qtdCell = li.querySelector('.qtd');
      if (qtdCell) {
        if (entered > armPro) qtdCell.classList.add('pcp-warn');
        else                 qtdCell.classList.remove('pcp-warn');
      }
    });
    ul.dataset.ppQtdBound = '1';
  }

  if (otherRows.length) {
    const fragRest = document.createDocumentFragment();
    otherRows.forEach(row => fragRest.appendChild(row));
    ul.appendChild(fragRest);
  }

  // [PCP] Ordena a lista principal com PP no topo (código verde primeiro)
  try { pcpReordenarPorPP(ul); } catch (_) {}

  // [PCP] Bind do multiplicador de Qtd (input#pcp-factor) — recalcula "Qtd" ao digitar
  (function attachPCPFactorHandler(){
    const factorInput = document.getElementById('pcp-factor');
    if (!factorInput) return;
    factorInput.value = pcpGetFactorValue();

    if (window.__pcpFactorInput && window.__pcpFactorHandler) {
      window.__pcpFactorInput.removeEventListener('input', window.__pcpFactorHandler);
    }

    const handler = () => {
      let f = parseQty(factorInput.value || 1, 1);
      if (!Number.isFinite(f) || f <= 0) f = 1;
      pcpSetFactorValue(f, { syncInput: false });
      factorInput.value = f;

      const ulNode = document.getElementById('listaPecasPCPList');
      if (!ulNode) return;

      ulNode.querySelectorAll('li.data-row').forEach(li => {
        if (li.classList.contains('pcp-parent-row')) return;
        const base     = parseQty(li.dataset.qtdBase, 0);
        const qtdCell  = li.querySelector('.qtd');
        const qtdInput = qtdCell?.querySelector('input');
        const armPro   = parseQty(li.querySelector('.qtdpro')?.textContent, 0);
        const novoQtd  = base * f;
        if (qtdInput) {
          qtdInput.value = toInputNumber(novoQtd);
        } else if (qtdCell) {
          qtdCell.textContent = fmtQtdBR(novoQtd);
        }
        if (qtdCell) {
          if (novoQtd > armPro) qtdCell.classList.add('pcp-warn');
          else                  qtdCell.classList.remove('pcp-warn');
        }
      });
    };

    factorInput.addEventListener('input', handler);
    window.__pcpFactorInput = factorInput;
    window.__pcpFactorHandler = handler;
  })();

  // — delegate: botão "Trocar produto" (mantém seu fluxo; se o PAI foi trocado, pcpAplicarTrocaProduto deve reconstruir)
  if (!ul.dataset.pcpTrocaBound) {
    ul.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.trocar-btn, [data-action="trocar"]');
      if (!btn) return;

      const row = btn.closest('li.data-row, li.child-row');
      const cod = btn.dataset.cod || row?.querySelector('.cod')?.textContent?.trim();
      try { await pcpToggleTrocaProduto(row, cod); } // sua função já chama pcpAplicarTrocaProduto
      catch (e) { console.warn('[PCP] Falha no painel de troca:', e); }
    });
    ul.dataset.pcpTrocaBound = '1';
  }

  // Delegate do botão "Estrutura" (abre/fecha sub-estrutura)
  if (!ul.dataset.pcpEstruturaBound) {
    ul.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.estrutura-btn, [data-action="estrutura"]');
      if (!btn) return;
      const rowLi = btn.closest('li');
      const cod   = btn.dataset.cod || rowLi.querySelector('.cod')?.textContent?.trim();
      if (!cod) return;
      try { await pcpToggleSubEstrutura(rowLi, cod); }
      catch (e) { console.warn('[PCP] Falha ao abrir sub-estrutura:', e); }
    });
    ul.dataset.pcpEstruturaBound = '1';
  }

  if (!ul.dataset.pcpProduzirBound) {
    ul.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.produce-btn, [data-action="produzir"]');
      if (!btn) return;

      const rowLi = btn.closest('li');
      if (!rowLi) return;

      const isParent = rowLi.classList.contains('pcp-parent-row');
      const isPPItem = !isParent && (rowLi.classList.contains('pp-row') || rowLi.classList.contains('pp-subitem-row') || rowLi.querySelector('.pp-select-checkbox'));

      if (isParent) {
        ev.preventDefault();
        try {
          await pcpGerarEtiquetaPai(rowLi, btn);
        } catch (err) {
          console.warn('[PCP] gerar etiqueta pai falhou:', err);
        }
      } else if (isPPItem) {
        ev.preventDefault();
        try {
          await pcpGerarEtiquetaPP(rowLi, btn);
        } catch (err) {
          console.warn('[PCP] gerar etiqueta PP falhou:', err);
        }
      }
    });
    ul.dataset.pcpProduzirBound = '1';
  }

  // Para linhas sem hint, decide via SQL e adiciona/remove botão Estrutura (ignora não-PP)
  try {
    await pcpDecorateEstruturaButtons(ul);
  } catch (e) {
    console.warn('[PCP] decorateEstruturaButtons falhou:', e);
  }

  // Preenche Qtd Pro / Qtd Alm a partir do SQL (inalterado)
  try {
    const filler = window.pcpPreencherSaldosDuplos || pcpPreencherSaldosDuplosLocal;
    await filler(ul);
  } catch (e) {
    console.warn('Falha ao preencher saldos (Qtd Pro / Qtd Alm):', e);
  }

  // Atualiza badges de versão/modificador
  (async () => {
    try {
      const codMeta = codigo || payload?.cod_produto || window.pcpCodigoAtual || null;
      if (!codMeta) return pcpUpdateVersaoBadges(null);
      const meta = await pcpFetchEstruturaMetaByCod(codMeta);
      pcpUpdateVersaoBadges(meta);
    } catch (e) {
      console.warn('Não foi possível atualizar badges de versão:', e);
      pcpUpdateVersaoBadges(null);
    }
  })();
}


// [PCP][Helper] Carrega a estrutura (view v2) a partir do código do produto PAI,
// replicando o comportamento da guia Comercial: POST /api/pcp/estrutura?view=v2
// Body: { pai_codigo: "<CODIGO>" }
// Retorna o JSON da API (esperado: { ok:true, origem:"view_v2", dados:[...] })
async function pcpCarregarEstruturaPorCodigo(codigoPai) {
  const url = `${API_BASE}/api/pcp/estrutura?view=v2`;
  const body = { pai_codigo: String(codigoPai || '').trim() };

  console.log('[PCP][Helper] ▶ POST estrutura (v2):', url, 'BODY:', body);

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); }
  catch { json = { ok:false, error:'json-parse', raw:text }; }

  console.log('[PCP][Helper] ◀ estrutura status:', r.status, 'json:', json);
  return json;
}



const pcpHasEstruturaCache = new Map();
const __isPP = s => /\.PP\./i.test(String(s ?? ''));

// Consulta rápida: reaproveita o loader SQL da PCP para saber se há filhos.
// Curto-circuito: códigos sem ".PP." retornam false imediatamente.
async function pcpHasEstrutura(codProduto) {
  if (!codProduto) return false;
  if (!__isPP(codProduto)) return false;

  if (pcpHasEstruturaCache.has(codProduto))
    return pcpHasEstruturaCache.get(codProduto);

  let has = false;
  try {
    const payload = await fetchEstruturaPCP_SQL(codProduto);
    const dados = Array.isArray(payload?.dados) ? payload.dados : [];
    has = dados.length > 0;
  } catch (e) {
    console.warn('[PCP] pcpHasEstrutura falhou:', e);
  }
  pcpHasEstruturaCache.set(codProduto, has);
  return has;
}

const pcpPPChildrenCache = new Map();

async function pcpFetchPPChildren(codProduto) {
  const codigo = String(codProduto || '').trim();
  if (!pcpIsPP(codigo)) return [];
  if (pcpPPChildrenCache.has(codigo)) return pcpPPChildrenCache.get(codigo);

  let filhos = [];
  try {
    const payload = await fetchEstruturaPCP_SQL(codigo);
    const dados = Array.isArray(payload?.dados) ? payload.dados : [];
    filhos = dados
      .filter(item => pcpIsPP(item?.comp_codigo))
      .map(item => ({
        codigo: String(item?.comp_codigo || '').trim(),
        descricao: String(item?.comp_descricao || '').trim(),
        unid: String(item?.comp_unid || '').trim(),
        qtd: Number(item?.comp_qtd ?? 0) || 0,
        qtdProd: Number(item?.qtd_prod ?? item?.qtdProd ?? 0) || 0
      }));
  } catch (e) {
    console.warn('[PCP] pcpFetchPPChildren falhou:', e);
  }

  pcpPPChildrenCache.set(codigo, filhos);
  return filhos;
}

async function pcpPopulatePPChildren(listEl) {
  if (!listEl) return;
  listEl.querySelectorAll('li.pp-subitem-row').forEach(el => el.remove());

  const esc = (s) => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const parseQtd = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const str = String(v).trim().replace(/\./g, '').replace(',', '.');
    const n = Number(str);
    return Number.isFinite(n) ? n : 0;
  };
  const fmtQtd = (n) => {
    const val = parseQtd(n);
    const hasDecimal = Math.abs(val % 1) > 1e-9;
    return val.toLocaleString('pt-BR', hasDecimal ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : undefined);
  };
  const toInputNumber = (val) => {
    const num = Number(val);
    if (!Number.isFinite(num)) return '0';
    return String(Math.round(num * 1_000_000) / 1_000_000);
  };

  const rows = Array.from(listEl.querySelectorAll('li.data-row'));
  for (const row of rows) {
    const codigo =
      row.dataset.codigo ||
      row.querySelector('.pp-select-checkbox')?.getAttribute('data-cod') ||
      row.querySelector('.cod')?.textContent ||
      '';
    const code = String(codigo || '').trim();
    if (!pcpIsPP(code)) continue;

    const filhos = await pcpFetchPPChildren(code);
    if (!filhos.length) continue;

    const frag = document.createDocumentFragment();
    const factor = pcpGetFactorValue();
    const fator = (!Number.isFinite(factor) || factor <= 0) ? 1 : factor;

  for (const filho of filhos) {
      const baseQtd = parseQtd(filho.qtd);
      const qtdFinal = baseQtd * fator;
      const qtdProdFmt = filho.qtdProd ? fmtQtd(filho.qtdProd) : '';
      const codEsc = esc(filho.codigo);
      const descEsc = esc(filho.descricao);
      const unidEsc = esc(filho.unid || '');

      const li = document.createElement('li');
      li.className = 'data-row pp-row pp-subitem-row';
      li.dataset.parentCodigo = code;
      li.dataset.codigo = filho.codigo;
      li.dataset.qtdBase = String(baseQtd);
      li.dataset.temEstrutura = '0';
      li.innerHTML = `
        <div class="cod pp">
          <label class="pp-select-item">
            <input type="checkbox" class="pp-select-checkbox" data-cod="${codEsc}" aria-label="Selecionar ${codEsc}" checked>
            <span title="${codEsc}">${codEsc}</span>
          </label>
        </div>
        <div class="desc" title="${descEsc}">${descEsc || '—'}</div>
        <div class="unid">${unidEsc || '—'}</div>
        <div class="qtd qtd-editable">
          <input type="number" class="pp-qtd-input" data-cod="${codEsc}" value="${toInputNumber(qtdFinal)}" step="0.0001" min="0" aria-label="Quantidade para ${codEsc}">
        </div>
        <div class="qtdprod">${qtdProdFmt}</div>
        <div class="qtdpro">0</div>
        <div class="qtdalm">0</div>
        <div class="acao flex gap-2">
          <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${codEsc}" title="Trocar produto">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
            </svg>
          </button>
          <button class="icon-btn status-button open" data-action="solicitar" data-cod="${codEsc}" title="Solicitar">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 .001 4.001A2 2 0 0 0 17 18ZM3 4h2l1.6 8.2A3 3 0 0 0 9.55 15h7.9a3 3 0 0 0 2.95-2.4L22 7H6.21L5.7 4.8A2 2 0 0 0 3.76 3.5L3 3.5V4Z"/>
            </svg>
          </button>
          <button class="icon-btn produce-btn" data-action="produzir" data-cod="${codEsc}" title="Produzir itens selecionados">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
              <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
            </svg>
          </button>
        </div>
      `;
      frag.appendChild(li);
    }
    row.after(frag);

    const currentRows = Array.from(listEl.querySelectorAll('.pp-subitem-row')).filter(child => child.dataset.parentCodigo === code);

    try {
      await Promise.all(currentRows.map(r => pcpAtualizarColunasDinamicas(r)));
    } catch (e) {
      console.warn('[PCP] falha ao atualizar métricas dos subitens PP:', e);
    }
  }

  try { await pcpDecorateEstruturaButtons(listEl); } catch (e) { console.warn('[PCP] decorate (PP filhos) falhou:', e); }
  try {
    const filler = window.pcpPreencherSaldosDuplos || pcpPreencherSaldosDuplosLocal;
    await filler(listEl);
  } catch (e) {
    console.warn('[PCP] preencher saldos (PP filhos) falhou:', e);
  }
}

async function pcpDecorateEstruturaButtons(ul) {
  const rows = Array.from(ul.querySelectorAll('li.data-row'));
  const jobs = [];

  for (const li of rows) {
    const code = li.querySelector('.cod')?.textContent?.trim();
    if (!code) continue;

    // Sem ".PP." → nunca tem estrutura: remova botão se existir
    if (!__isPP(code)) { removeEstruturaButton(li); continue; }

    const hint = li.dataset.temEstrutura;
    if (hint === '1') { ensureEstruturaButton(li, code); continue; }
    if (hint === '0') { removeEstruturaButton(li);  continue; }

    jobs.push((async () => {
      const has = await pcpHasEstrutura(code);
      if (has) ensureEstruturaButton(li, code);
      else     removeEstruturaButton(li);
    })());
  }

  await Promise.allSettled(jobs);
}


function ensureEstruturaButton(li, code) {
  if (li.querySelector('.estrutura-btn')) return;
  const acao = li.querySelector('.acao');
  if (!acao) return;

  const btn = document.createElement('button');
  btn.className = 'icon-btn estrutura-btn';
  btn.dataset.action = 'estrutura';
  btn.dataset.cod = code;
  btn.title = 'Estrutura do item';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M6 3h12v4H6zM12 7v4M4 13h8v4H4zM12 13h8v4h-8z" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  acao.appendChild(btn);
}

function removeEstruturaButton(li) {
  li.querySelector('.estrutura-btn')?.remove();
}
// PCP — abre/fecha a sub-estrutura logo abaixo da linha clicada.
// Agora com CABEÇALHO e colunas: Cod | Desc | Unid | Qtd | Qtd prod | Qtd Pro | Qtd Alm | Ação
// Regras:
//   - Qtd prod (sub) = '' para não-PP (sem OP abertas para o próprio código).
//   - Botões "Solicitar", "Produzir"(só PP) e "Trocar" em cada item.
//   - Botão "Estrutura" injetado depois via pcpDecorateEstruturaButtonsSub (só PP com filhos).
async function pcpToggleSubEstrutura(rowLi, codProduto) {
  const next = rowLi.nextElementSibling;
  if (next && next.classList.contains('pcp-subestrutura')) { next.remove(); return; }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
  const isPP = s => /\.PP\./i.test(String(s ?? ''));
  const parseQty = (v, def = 0) => {
    if (v === null || v === undefined || v === '') return def;
    if (typeof v === 'number') return Number.isFinite(v) ? v : def;
    let s = String(v).trim();
    const brMilharRegex = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;
    if (brMilharRegex.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  };
  const fmtQtdBR = (n) => {
    const val = Number(parseQty(n));
    const temDecimal = Math.abs(val % 1) > 1e-9;
    return val.toLocaleString('pt-BR', temDecimal ? { 
      minimumFractionDigits: 0, maximumFractionDigits: 3 
    } : { maximumFractionDigits: 0 });
  };

  // carrega a estrutura do componente (via SQL)
  let payload;
  try { payload = await fetchEstruturaPCP_SQL(codProduto); }
  catch (e) {
    console.warn('[PCP] falha ao buscar sub-estrutura:', e);
    return;
  }
  const dados = Array.isArray(payload?.dados) ? payload.dados : [];

  const wrap = document.createElement('li');
  wrap.className = 'pcp-subestrutura';
  wrap.innerHTML = `
    <div class="sub-wrap">
      <div class="sub-title">Estrutura de ${esc(codProduto)}</div>
      <ul class="sub-grid">
        <!-- Cabeçalho da sub-estrutura: herda o mesmo grid do cabeçalho principal -->
        <li class="sub-header header-row">
          <div class="cod">Código</div>
          <div class="desc">Descrição</div>
          <div class="unid">Unid</div>
          <div class="hdr-qtd">Qtd</div>
          <div class="hdr-qtdprod">Qtd prod</div>
          <div class="hdr-qtdpro">Arm Pro</div>
          <div class="hdr-qtdalm">Arm Alm</div>
          <div class="acao">Ação</div>
        </li>

        ${dados.map(it => {
          const cod   = String(it.comp_codigo ?? '');
          const pp    = isPP(cod);
          const desc  = String(it.comp_descricao ?? '');
          const unid  = String(it.comp_unid ?? 'UN');
          const q     = parseQty(it.comp_qtd, 0);
          const qtdProdSub = pp ? 0 : ''; // não-PP → vazio

          const produzirBtn = pp ? `
            <button class="icon-btn produce-btn" data-action="produzir" data-cod="${esc(cod)}" title="Produzir">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M2 20h20v-8l-5 3v-3l-5 3V7L8 9V7L2 9v11Z"/>
                <rect x="9" y="15" width="3" height="3" rx="0.5" fill="currentColor"/>
              </svg>
            </button>` : '';

          const trocarBtn = `
            <button class="icon-btn trocar-btn" data-action="trocar" data-cod="${esc(cod)}" title="Trocar produto">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M7 7h10l-3-3v2H7v1Zm10 10H7l3 3v-2h7v-1Z"/>
              </svg>
            </button>`;

          return `
            <!-- Linhas da sub-estrutura: usam o MESMO grid da lista principal -->
            <li class="child-row data-row" data-cod="${esc(cod)}">
              <div class="cod ${pp ? 'pp' : ''}">${esc(cod)}</div>
              <div class="desc" title="${desc}">${desc}</div>
              <div class="unid">${unid}</div>
              <div class="qtd">${fmtQtdBR(q)}</div>
              <div class="qtdprod">${pp ? fmtQtdBR(qtdProdSub) : ''}</div>
              <div class="qtdpro">0</div>
              <div class="qtdalm">0</div>
              <div class="acao">
                <!-- Trocar (duas setas opostas) -->
                ${trocarBtn}

                <!-- Solicitar (carrinho) -->
                <button class="icon-btn status-button open" data-action="solicitar" data-cod="${esc(cod)}" title="Solicitar">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 4h2l1.6 8.2A3 3 0 0 0 9.55 15h7.9a3 3 0 0 0 2.95-2.4L22 7H6.21L5.7 4.8A2 2 0 0 0 3.76 3.5L3 3.5V4Z"/>
                  </svg>
                </button>

                <!-- Produzir (fábrica) -->
                ${produzirBtn}

                <!-- Botão Estrutura é injetado depois se tiver filhos -->
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `;
  rowLi.after(wrap);

  
  // Preenche Qtd Pro / Qtd Alm e injeta "Estrutura" condicional nos itens PP que têm filhos
  try {
    const filler = window.pcpPreencherSaldosDuplos || pcpPreencherSaldosDuplosLocal;
    const subUl = wrap.querySelector('ul.sub-grid');
    pcpReordenarPorPPSub(subUl);
    await filler(subUl);
    await pcpDecorateEstruturaButtonsSub(subUl);
  } catch (e) {
    console.warn('[PCP] Falha ao preencher/decoração na sub-estrutura:', e);
  }
}


// Debounce simples (aguarda digitação parar por ms antes de buscar)
function debounceMS(fn, ms=250) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// util único para escapar HTML (evita conflito de nomes neste módulo)
const htmlEsc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );

// [UI] Lê o usuário logado exibido no header
function getLoggedUserName() {
  const el = document.getElementById('userNameDisplay');
  if (!el) return 'sistema';
  const v = (el.textContent || el.innerText || '').trim();
  return v || 'sistema';
}

function pcpCollectCustomizacoes({ scopeRow = null } = {}) {
  const list = document.getElementById('listaPecasPCPList');
  if (!list) return [];

  let rows = [];
  if (scopeRow instanceof Element) {
    const set = new Set();
    set.add(scopeRow);
    const scopeCodigo =
      scopeRow.dataset.codigo ||
      scopeRow.querySelector('.pp-select-checkbox')?.dataset.cod ||
      scopeRow.querySelector('.cod span')?.textContent ||
      scopeRow.querySelector('.cod')?.textContent ||
      '';
    const scopeCode = String(scopeCodigo || '').trim();
    if (scopeCode) {
      list.querySelectorAll(`.pp-subitem-row[data-parent-codigo="${scopeCode}"]`).forEach(el => set.add(el));
    }
    rows = Array.from(set);
  } else {
    rows = Array.from(list.querySelectorAll('li.data-row, li.pp-subitem-row'));
  }

  const seen = new Set();
  const customizacoes = [];
  for (const row of rows) {
    const original = String(row.dataset.swapOriginalCod || '').trim();
    if (!original) continue;

    let codigoAtual =
      row.dataset.codigo ||
      row.querySelector('.pp-select-checkbox')?.dataset.cod ||
      row.querySelector('.cod span')?.textContent ||
      row.querySelector('.cod')?.textContent ||
      '';
    codigoAtual = String(codigoAtual || '').trim();
    if (!codigoAtual || codigoAtual === original) continue;

    const tipo = row.classList.contains('pcp-parent-row')
      ? 'pai'
      : row.classList.contains('pp-subitem-row')
        ? 'pp-subitem'
        : row.classList.contains('pp-row')
          ? 'pp'
          : 'peca';

    const grupo = row.classList.contains('pp-row') || row.classList.contains('pp-subitem-row')
      ? 'pp'
      : (tipo === 'pai' ? 'pai' : 'pecas');

    const key = `${original}=>${codigoAtual}::${tipo}::${row.dataset.parentCodigo || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let quantidade = null;
    const qtdInput = row.querySelector('.pp-qtd-input');
    if (qtdInput) {
      const parsed = Number(String(qtdInput.value ?? '').replace(',', '.'));
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    } else if (row.dataset.qtdBase) {
      const parsed = Number(row.dataset.qtdBase);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    } else {
      const qtdText = (row.querySelector('.qtd')?.textContent || '')
        .trim()
        .replace(/\./g, '')
        .replace(',', '.');
      const parsed = Number(qtdText);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = parsed;
    }

    customizacoes.push({
      tipo,
      grupo,
      codigo_original: original,
      codigo_novo: codigoAtual,
      descricao_original: String(row.dataset.swapOriginalDesc || '').trim() || null,
      descricao_nova: (row.querySelector('.desc')?.textContent || '').trim() || null,
      parent_codigo: row.dataset.parentCodigo || null,
      quantidade: quantidade != null && Number.isFinite(quantidade) ? quantidade : null
    });
  }

  return customizacoes;
}

async function pcpGerarEtiquetaPai(rowLi, btn) {
  if (!rowLi || !btn) return;

  const codigo =
    rowLi.dataset.codigo ||
    rowLi.querySelector('.pp-select-checkbox')?.dataset.cod ||
    (rowLi.querySelector('.cod span')?.textContent || '').trim() ||
    (rowLi.querySelector('.cod')?.textContent || '').trim();

  if (!codigo) {
    alert('Não foi possível identificar o código do produto pai.');
    return;
  }

  let quantidadePai = 1;
  const factorInput = document.getElementById('pcp-factor');
  if (factorInput) {
    const raw = Number(String(factorInput.value ?? '').replace(',', '.'));
    if (Number.isFinite(raw) && raw > 0) quantidadePai = Math.max(1, Math.round(raw));
  }

  const itensPP = [];
  const ppCheckboxes = document.querySelectorAll('#listaPecasPCPList .pcp-pp-card-list .pp-select-checkbox');
  ppCheckboxes.forEach((cb) => {
    if (!(cb instanceof HTMLInputElement) || !cb.checked) return;
    const li = cb.closest('li');
    const cod = cb.dataset.cod || li?.dataset.codigo || '';
    const desc = (li?.querySelector('.desc')?.textContent || '').trim();
    const qtdInput = li?.querySelector('.pp-qtd-input');
    let quantidade = null;
    if (qtdInput) {
      const raw = String(qtdInput.value ?? '').replace(',', '.');
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = Math.max(1, Math.round(parsed));
    } else {
      const qtdCell = li?.querySelector('.qtd');
      const txt = (qtdCell?.textContent || '').trim().replace(/\./g, '').replace(',', '.');
      const parsed = Number(txt);
      if (Number.isFinite(parsed) && parsed > 0) quantidade = Math.max(1, Math.round(parsed));
    }
    if (!cod) return;
    itensPP.push({ codigo: cod, descricao: desc, quantidade });
  });

  const obsInput = document.getElementById('pcp-obs');
  const observacoes = obsInput ? obsInput.value.trim() : '';
  const usuario = getLoggedUserName();
  let versaoEstrutura = null;
  const versaoEl = document.getElementById('pcpListaVersaoValue');
  if (versaoEl) {
    const txt = (versaoEl.textContent || '').trim();
    const numero = Number(txt.replace(/[^\d]/g, ''));
    if (Number.isFinite(numero) && numero > 0) versaoEstrutura = Math.max(1, Math.round(numero));
  }

  const payload = {
    codigo_produto: codigo,
    usuario_criacao: usuario,
    observacoes,
    itens_pp: itensPP,
    quantidade_pai: quantidadePai,
    versao_estrutura: versaoEstrutura
  };
  payload.customizacoes = pcpCollectCustomizacoes();

  const prevDisabled = btn.disabled;
  btn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/api/pcp/etiquetas/pai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });

    let data = null;
    try { data = await resp.json(); }
    catch { data = null; }

    if (!resp.ok || !data?.ok) {
      const msg = data?.error || `Falha ao gerar etiqueta (HTTP ${resp.status})`;
      throw new Error(msg);
    }

    const opRegistros = Array.isArray(data.op_registros) ? data.op_registros : [];
    const ppGeradas = Array.isArray(data.itens_pp) ? data.itens_pp : [];

    let mensagem = '';
    if (opRegistros.length) {
      const versaoLabel = data.versao ? ` v${data.versao}` : '';
      mensagem += `Etiquetas OP geradas${versaoLabel} (${opRegistros.length}):\n`;
      mensagem += opRegistros.map((op, idx) => `${idx + 1}. ${op.numero_op || '—'}`).join('\n');
    } else {
      mensagem += 'Nenhuma etiqueta OP gerada.';
    }

    if (ppGeradas.length) {
      const linhasPP = ppGeradas.map(pp => {
        const registros = Array.isArray(pp.registros) ? pp.registros : [];
        const linhasRegs = registros.map((r, idx) => `    ${idx + 1}. ${r.numero_op || '—'}`).join('\n');
        const versaoLabel = pp.versao ? ` v${pp.versao}` : '';
        return `${pp.codigo || '—'} (${pp.quantidade || registros.length}${versaoLabel}):\n${linhasRegs}`;
      }).join('\n');
      mensagem += `\n\nEtiquetas OPS:\n${linhasPP}`;
    }
    if (data.personalizacao_id) {
      mensagem += `\n\nCustomização: C${data.personalizacao_id}`;
    }
    alert(mensagem);
  } catch (err) {
    console.error('[PCP] gerar etiqueta pai falhou:', err);
    alert(`Erro ao gerar etiqueta: ${err?.message || err}`);
  } finally {
    btn.disabled = prevDisabled;
  }
}

async function pcpGerarEtiquetaPP(rowLi, btn) {
  if (!rowLi || !btn) return;

  const checkbox = rowLi.querySelector('.pp-select-checkbox');
  const codigo =
    rowLi.dataset.codigo ||
    (checkbox ? checkbox.dataset.cod : '') ||
    (rowLi.querySelector('.cod span')?.textContent || '').trim() ||
    (rowLi.querySelector('.cod')?.textContent || '').trim();

  if (!codigo) {
    alert('Não foi possível identificar o código do item PP.');
    return;
  }

  const desc = (rowLi.querySelector('.desc')?.textContent || '').trim();
  const qtdInput = rowLi.querySelector('.pp-qtd-input');
  let quantidade = 1;
  if (qtdInput) {
    const raw = Number(String(qtdInput.value ?? '').replace(',', '.'));
    if (Number.isFinite(raw) && raw > 0) quantidade = Math.max(1, Math.round(raw));
  } else {
    const qtdCell = rowLi.querySelector('.qtd');
    const txt = (qtdCell?.textContent || '').trim().replace(/\./g, '').replace(',', '.');
    const raw = Number(txt);
    if (Number.isFinite(raw) && raw > 0) quantidade = Math.max(1, Math.round(raw));
  }

  const obsInput = document.getElementById('pcp-obs');
  const observacoes = obsInput ? obsInput.value.trim() : '';
  const usuario = getLoggedUserName();

  const payload = {
    codigo_produto: codigo,
    quantidade,
    descricao: desc,
    usuario_criacao: usuario,
    observacoes
  };
  payload.customizacoes = pcpCollectCustomizacoes({ scopeRow: rowLi });

  const prevDisabled = btn.disabled;
  btn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE}/api/pcp/etiquetas/pp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    let data = null;
    try { data = await resp.json(); }
    catch { data = null; }

    if (!resp.ok || !data?.ok) {
      const msg = data?.error || `Falha ao gerar etiqueta (HTTP ${resp.status})`;
      throw new Error(msg);
    }

    const registros = Array.isArray(data.registros) ? data.registros : [];
    const linhas = registros.map((r, idx) => `${idx + 1}. ${r.numero_op || '—'}`).join('\n');
    const versaoLabel = data.versao ? ` (v${data.versao})` : '';
    const mensagem = [
      `Etiquetas OPS geradas para ${codigo}${versaoLabel}: ${registros.length}`,
      linhas
    ].filter(Boolean).join('\n');
    const mensagemFinal = data.personalizacao_id
      ? `${mensagem}\n\nCustomização: C${data.personalizacao_id}`
      : mensagem;
    alert(mensagemFinal);
  } catch (err) {
    console.error('[PCP] gerar etiqueta PP falhou:', err);
    alert(`Erro ao gerar etiqueta: ${err?.message || err}`);
  } finally {
    btn.disabled = prevDisabled;
  }
}

// [UI] Atualiza os badges Versão/Modificador na barra de título
function pcpUpdateVersaoBadges(meta) {
  const vEl = document.getElementById('estruturaVersaoValue');
  const mEl = document.getElementById('estruturaModValue');
  const versao = (meta && typeof meta.versao !== 'undefined' && meta.versao !== null)
    ? String(meta.versao)
    : '—';
  const mod    = (meta && meta.modificador && String(meta.modificador).trim())
    ? String(meta.modificador).trim()
    : '—';
  if (vEl) vEl.textContent = versao;
  if (mEl) mEl.textContent = mod;
}

function pcpUpdateListaVersaoBadge(versao) {
  const vEl = document.getElementById('pcpListaVersaoValue');
  if (!vEl) return;
  const txt = (versao !== null && versao !== undefined && String(versao).trim())
    ? String(versao).trim()
    : '—';
  vEl.textContent = txt;
}


// [API] Busca meta (versão/modificador) por código do produto.
// - Usa ?cod= para aceitar aliases no servidor.
// - 'credentials: include' garante que o cookie de sessão viaje junto (mesmo em subdomínios).
async function pcpFetchEstruturaMetaByCod(cod) {
  const base = (window.API_BASE || API_BASE || window.location.origin);
  const url  = `${base}/api/estrutura/meta?cod=${encodeURIComponent(String(cod||'').trim())}`.replace(/([^:]\/)(\/)+/g,'$1');
  const res  = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Falha ao buscar meta: HTTP ${res.status}`);
  const j = await res.json();
  // Se 'versao' vier null em bases antigas → trata como 1
  return { id: j.id, cod_produto: j.cod_produto, versao: (j.versao ?? 1), modificador: j.modificador || null };
}


// [PCP] Reordena a UL da lista PRINCIPAL colocando PP primeiro.
// Mantém cabeçalho e carrega junto a sub-estrutura aberta (se houver) para não “descolar” do pai.
function pcpReordenarPorPP(ul) {
  if (!ul) return;

  const kids = Array.from(ul.children);
  const used = new Set();
  const pairs = [];

  for (let i = 0; i < kids.length; i++) {
    const li = kids[i];
    if (used.has(li)) continue;
    if (!li.classList || !li.classList.contains('data-row')) continue; // ignora header/painéis
    if (li.classList.contains('pp-subitem-row')) continue; // mantém subitens presos ao pai
    if (li.classList.contains('pcp-parent-row')) continue;

    const codTxt = (li.querySelector('.cod')?.textContent || '').trim();

    // sub-estrutura grudada ao pai
    const sib = li.nextElementSibling;
    const sub = (sib && sib.classList?.contains('pcp-subestrutura')) ? sib : null;
    if (sub) used.add(sub);

    const subitems = [];
    let follower = sub ? sub.nextElementSibling : li.nextElementSibling;
    while (follower && follower.classList?.contains('pp-subitem-row')) {
      subitems.push(follower);
      used.add(follower);
      follower = follower.nextElementSibling;
    }

    pairs.push({ li, sub, subitems, isPP: pcpIsPP(codTxt) });
  }

  if (!pairs.length) return;

  const ppFirst  = pairs.filter(p => p.isPP);
  const restNext = pairs.filter(p => !p.isPP);

  // mover em nova ordem (append move o nó, preserva listeners)
  for (const group of [ppFirst, restNext]) {
    for (const p of group) {
      ul.appendChild(p.li);
      if (Array.isArray(p.subitems)) {
    for (const child of p.subitems) {
      ul.appendChild(child);
    }
  }
      if (p.sub) ul.appendChild(p.sub);
    }
  }
}

// [PCP] Reordena a UL da sub-estrutura (grid interno) colocando PP primeiro.
// Mantém o header (.header-row) no topo.
function pcpReordenarPorPPSub(subUl) {
  if (!subUl) return;
  const rows = Array.from(subUl.querySelectorAll('li.data-row'));
  if (!rows.length) return;

  const pp  = [];
  const non = [];
  for (const li of rows) {
    const codTxt = (li.querySelector('.cod')?.textContent || '').trim();
    (pcpIsPP(codTxt) ? pp : non).push(li);
  }
  for (const li of [...pp, ...non]) {
    subUl.appendChild(li); // header fica onde está
  }
}

// [PCP] Abre/fecha o painel de TROCA logo abaixo da linha clicada.
// O clique em um resultado altera SOMENTE a UI (DOM) da linha, sem persistir em SQL.
async function pcpToggleTrocaProduto(rowLi, codAtual) {
  if (!rowLi) return;

  // toggle no mesmo item
  const next = rowLi.nextElementSibling;
  if (next && next.classList.contains('pcp-troca')) { next.remove(); return; }

  // fecha outros paineis abertos
  rowLi.parentElement?.querySelectorAll('li.pcp-troca').forEach(el => el.remove());

  // cria painel sem estilos inline de cor/fundo (isso vai para o CSS)
  const wrap = document.createElement('li');
  wrap.className = 'pcp-troca';
  wrap.innerHTML = `
    <div class="troca-wrap">
      <div class="troca-title">
        Trocar produto para a linha <strong>${htmlEsc(codAtual ?? '')}</strong>
      </div>
      <div class="troca-input-row">
        <input type="text" class="troca-input" placeholder="Digite código ou descrição (mín. 2 caracteres)" aria-label="Buscar produto">
      </div>
      <ul class="troca-results" role="listbox" aria-label="Resultados da busca"></ul>
    </div>
  `;
  rowLi.after(wrap);

  const input   = wrap.querySelector('.troca-input');
  const results = wrap.querySelector('.troca-results');

  const useEstruturaSource = rowLi.classList.contains('pcp-parent-row') || rowLi.classList.contains('pp-row');
  const searchFn = useEstruturaSource ? fetchPesquisarProdutosEstrutura : fetchPesquisarProdutos_SQL;

  // Debounce da busca
  const runSearch = debounceMS(async () => {
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ''; return; }

    results.innerHTML = '<li class="info">Buscando…</li>';
    try {
      const itens = await searchFn(q); // [{codigo, descricao}]
      if (!Array.isArray(itens) || itens.length === 0) {
        results.innerHTML = '<li class="info">Nenhum resultado</li>';
        return;
      }
      results.innerHTML = itens.slice(0, 50).map(it => {
        const cod  = htmlEsc(it.codigo ?? '');
        const desc = htmlEsc(it.descricao ?? '');
        return `
          <li class="troca-item" data-codigo="${cod}" data-descricao="${desc}" role="option" tabindex="0">
            <div class="cod ${/\.PP\./i.test(cod) ? 'pp' : ''}">${cod}</div>
            <div class="desc" title="${desc}">${desc}</div>
          </li>
        `;
      }).join('');
    } catch (e) {
      console.warn('[PCP] busca troca falhou:', e);
      results.innerHTML = '<li class="error">Erro na busca</li>';
    }
  }, 300);

  input.addEventListener('input', runSearch);

  // clique no resultado -> troca apenas na UI
  results.addEventListener('click', async (ev) => {
    const li = ev.target.closest('.troca-item');
    if (!li) return;

    const novoCod  = li.getAttribute('data-codigo') || '';
    const novaDesc = li.getAttribute('data-descricao') || '';
    try {
      await pcpAplicarTrocaProduto(rowLi, { codigo: novoCod, descricao: novaDesc });
    } catch (e) {
      console.warn('[PCP] pcpAplicarTrocaProduto falhou:', e);
    }
    wrap.remove();
  });

  // Enter também seleciona
  results.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const li = ev.target.closest('.troca-item');
      if (li) li.click();
    }
  });

  input.focus();
}

 
/* [PCP] Aplica a troca de UM item na UI (sem persistir). 
   ATENÇÃO: se a linha trocada for o **ITEM PAI**, 
   atualiza o código canônico (#pcp-code) e RECONSTRÓI toda a PCP,
   assim como na navegação pela Comercial. */
async function pcpAplicarTrocaProduto(rowLi, novo) {
  if (!rowLi || !novo) return;

  const codDiv  = rowLi.querySelector('.cod');
  const descDiv = rowLi.querySelector('.desc');
  if (!codDiv || !descDiv) return;

  const codAntigo  = (codDiv.textContent || '').trim();
  const descAntiga = (descDiv.textContent || '').trim();

  // Guarda originais uma vez
  if (!rowLi.dataset.swapOriginalCod)  rowLi.dataset.swapOriginalCod  = codAntigo;
  if (!rowLi.dataset.swapOriginalDesc) rowLi.dataset.swapOriginalDesc = descAntiga;

  const novoCod  = (novo.codigo || '').trim();
  const novaDesc = (novo.descricao || '').trim();

  const existingCheckbox = rowLi.querySelector('.pp-select-checkbox');
  const wasChecked = existingCheckbox ? existingCheckbox.checked : null;

  try {
    pcpHasEstruturaCache.delete(codAntigo);
    pcpHasEstruturaCache.delete(novoCod);
    pcpPPChildrenCache.delete(codAntigo);
    pcpPPChildrenCache.delete(novoCod);
  } catch (_) {}

  // Atualiza texto/atributos principais
  const isPPNow = /\.PP\./i.test(novoCod);
  rowLi.dataset.codigo = novoCod;

  if (isPPNow) {
    rowLi.classList.add('pp-row');
    codDiv.classList.add('pp');
    let label = codDiv.querySelector('.pp-select-item');
    if (!label) {
      label = document.createElement('label');
      label.className = 'pp-select-item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'pp-select-checkbox';
      input.checked = wasChecked ?? true;
      input.setAttribute('data-cod', novoCod);
      input.setAttribute('aria-label', `Selecionar ${novoCod}`);
      const span = document.createElement('span');
      span.textContent = novoCod;
      span.title = novoCod;
      label.appendChild(input);
      label.appendChild(span);
      codDiv.innerHTML = '';
      codDiv.appendChild(label);
    } else {
      const input = label.querySelector('.pp-select-checkbox');
      const span = label.querySelector('span');
      if (input) {
        input.setAttribute('data-cod', novoCod);
        input.setAttribute('aria-label', `Selecionar ${novoCod}`);
        if (wasChecked !== null) input.checked = wasChecked;
        else if (!input.checked) input.checked = true;
      }
      if (span) {
        span.textContent = novoCod;
        span.title = novoCod;
      }
    }
  } else {
    rowLi.classList.remove('pp-row');
    codDiv.classList.remove('pp');
    codDiv.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = novoCod;
    span.title = novoCod;
    codDiv.appendChild(span);
  }

  descDiv.textContent = novaDesc;
  descDiv.setAttribute('title', novaDesc);

  // Atualiza todos os botões da coluna Ação com o novo data-cod
  rowLi.querySelectorAll('[data-action][data-cod]').forEach(btn => {
    btn.setAttribute('data-cod', novoCod);
  });

  // Marca a linha como trocada e pinta APENAS a descrição de amarelo
  rowLi.classList.add('pcp-trocado');
  rowLi.querySelectorAll('.swap-pill').forEach(el => el.remove()); // remove selo antigo, se existir
  descDiv.classList.add('desc-trocado');

  // Log leve para depuração
  console.debug('[PCP] Linha trocada (somente UI):', {
    de: { cod: codAntigo, desc: descAntiga },
    para: { cod: novoCod, desc: novaDesc }
  });

  // 🚩 CASO ESPECIAL — TROCA do ITEM PAI
  // Se esta linha for o PAI atual, atualizamos a "fonte canônica" (#pcp-code) e
  // disparamos o mesmo carregamento usado quando a PCP é aberta a partir do Kanban.
  try {
    const barCode = (document.getElementById('pcp-code')?.textContent || '').trim();
    const isParent =
      (rowLi.classList && (rowLi.classList.contains('pcp-parent-row') || rowLi.classList.contains('pcp-estrutura-item--pai'))) ||
      (barCode && barCode === codAntigo);

    if (isParent) {
      // torna o novo código a fonte canônica (atualiza #pcp-code e estado global)
      if (typeof window.setPCPProdutoCodigo === 'function') window.setPCPProdutoCodigo(novoCod);

      // reconstrói toda a lista de peças (usa window.pcpCodigoAtual internamente)
      try { if (typeof window.ensurePCPEstruturaAutoLoad === 'function') window.ensurePCPEstruturaAutoLoad(); } catch (_) {}

      // não precisa atualizar colunas dinâmicas desta linha; ela será recriada
      return;
    }
  } catch (e) {
    console.warn('[PCP][PAI] falha ao reconstruir após troca do pai:', e);
  }

  const ppCardList = rowLi.closest('.pcp-pp-card-list');
  if (ppCardList) {
    ppCardList.querySelectorAll(`.pp-subitem-row[data-parent-codigo="${codAntigo}"]`).forEach(el => el.remove());
    rowLi.classList.remove('pp-has-child-pp');
    try {
      await pcpPopulatePPChildren(ppCardList);
    } catch (e) {
      console.warn('[PCP] falha ao recarregar subitens PP após troca:', e);
    }
  }

  // Atualiza colunas dinâmicas desta linha (Qtd prod / Arm Pro / Arm Alm)
  try { pcpAtualizarColunasDinamicas(rowLi); } catch (e) {}

  // Reordena a lista principal (PP primeiro) após a troca
  try { pcpReordenarPorPP(rowLi.parentElement); } catch (e) {}
}



/* [PCP] Atualiza SALDOS (Arm Pro/Arm Alm) e Qtd prod SOMENTE da linha informada.
   - Usa /api/armazem/saldos_duplos para pegar { pro[cod], alm[cod] }.
   - Para "Qtd prod" (somente PP), tenta buscar num endpoint de mapa; se não houver, usa 0 (fallback).
*/
async function pcpAtualizarColunasDinamicas(rowLi) {
  if (!rowLi) return;
  const cod = (rowLi.querySelector('.cod')?.textContent || '').trim();
  if (!cod) return;

  // 1) Arm Pro / Arm Alm (reaproveita sua API já usada no render)
  try {
    const r = await fetch(`${API_BASE}/api/armazem/saldos_duplos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ codigos: [cod] }),
    });
    if (r.ok) {
      const j   = await r.json();
      const pro = Number((j?.pro || {})[cod] ?? 0);
      const alm = Number((j?.alm || {})[cod] ?? 0);

      const elPro = rowLi.querySelector('.qtdpro');
      const elAlm = rowLi.querySelector('.qtdalm');
      if (elPro) elPro.textContent = pro.toLocaleString('pt-BR');
      if (elAlm) elAlm.textContent = alm.toLocaleString('pt-BR');

      // feedback e aviso de falta (mantém seu padrão)
      if (elPro) elPro.style.color = pro <= 0 ? '#e44' : '';
      if (elAlm) elAlm.style.color = alm <= 0 ? '#e44' : '';

      // Atualiza o aviso de "Quantidade > Arm Pro" (classe .pcp-warn na coluna .qtd)
      const qtdBase = Number(rowLi.dataset.qtdBase || 0);
      let fator = pcpGetFactorValue();
      const qtdFinal = qtdBase * fator;

      const qtdCell  = rowLi.querySelector('.qtd');
      const qtdInput = qtdCell?.querySelector('input');
      if (qtdCell) {
        if (qtdInput) {
          const rounded = Math.round(qtdFinal * 1e6) / 1e6;
          qtdInput.value = String(rounded);
        }
        if (!qtdInput) {
          const hasDecimal = Math.abs(qtdFinal % 1) > 1e-9;
          qtdCell.textContent = Number(qtdFinal).toLocaleString('pt-BR', hasDecimal ? { minimumFractionDigits: 3, maximumFractionDigits: 3 } : undefined);
        }
        if (qtdFinal > pro) qtdCell.classList.add('pcp-warn');
        else                qtdCell.classList.remove('pcp-warn');
      }
    }
  } catch (e) {
    console.warn('[PCP] Falha ao atualizar saldos da linha:', e);
  }

  // 2) Qtd prod (apenas se for PP)
  if (!/\.PP\./i.test(cod)) {
    const qEl = rowLi.querySelector('.qtdprod');
    if (qEl) qEl.textContent = ''; // não-PP fica vazio
    return;
  }

  try {
    const qtd = await pcpFetchQtdProdPorCodigo(cod);
    const qEl = rowLi.querySelector('.qtdprod');
    if (qEl) qEl.textContent = Number(qtd || 0).toLocaleString('pt-BR');
  } catch (e) {
    console.warn('[PCP] Qtd prod (PP) não pôde ser atualizada; usando 0', e);
    const qEl = rowLi.querySelector('.qtdprod');
    if (qEl) qEl.textContent = '0';
  }
}

// [PCP] Busca Qtd prod (somente PP). Tolerante: se não houver endpoint, retorna 0 sem quebrar.
async function pcpFetchQtdProdPorCodigo(codigoPP) {
  const cod = String(codigoPP || '').trim();
  if (!cod) return 0;

  const payload = { codigos: [cod] };
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  };

  try {
    // rota única e simples no back (ver seção B)
    const r = await fetch(`${API_BASE}/api/pcp/qtd_prod`, opts);
    if (r.ok) {
      const j = await r.json();                  // esperado: { "03.PP.N.10923": 1, ... }
      const val = (j && (j[cod] ?? j?.map?.[cod] ?? j?.data?.[cod])) ?? 0;
      return Number(val) || 0;
    }
  } catch (e) {
    // silencioso: não loga erro para não poluir o console em ambiente sem endpoint
  }
  return 0; // fallback seguro
}

async function fetchPesquisarProdutosEstrutura(q) {
  const url = `${API_BASE}/api/pcp/estrutura/busca`;
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ q })
    });
  } catch (e) {
    console.warn('[PCP] busca omie_estrutura falhou (rede):', e);
    return [];
  }

  if (!resp.ok) {
    console.warn('[PCP] busca omie_estrutura falhou:', resp.status, resp.statusText);
    return [];
  }

  let payload;
  try {
    payload = await resp.json();
  } catch (e) {
    console.warn('[PCP] busca omie_estrutura resposta não-JSON:', e);
    return [];
  }

  const itens = Array.isArray(payload?.itens) ? payload.itens : (Array.isArray(payload) ? payload : []);
  return itens
    .map(it => ({
      codigo: String(it.codigo ?? it.cod_produto ?? '').trim(),
      descricao: String(it.descricao ?? it.descr_produto ?? '').trim()
    }))
    .filter(it => it.codigo);
}


// Busca SQL “caça-tudo”: retorna também .fontes (array de schema.tabela)
async function fetchPesquisarProdutos_SQL(q) {
  const url  = `${API_BASE}/api/produtos/busca`;
  const body = { q: q };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn('[PCP] busca troca: falha de rede:', e);
    return [];
  }

  if (resp.status === 404) {
    if (!window.__trocaWarned404) {
      console.warn('[PCP] /api/produtos/busca não implementado no backend (404).');
      window.__trocaWarned404 = 1;
    }
    return [];
  }
  if (!resp.ok) {
    console.warn('[PCP] busca troca falhou:', resp.status, resp.statusText);
    return [];
  }

  const j = await resp.json();
  const itens = Array.isArray(j?.itens) ? j.itens : (Array.isArray(j) ? j : []);
  const seen = new Set();
  const out = [];
  for (const it of itens) {
    const c = String(it.codigo ?? it.cod ?? '').trim();
    const d = String(it.descricao ?? it.desc ?? '').trim();
    const fontes = Array.isArray(it.fontes) ? it.fontes : [];
    if (!c && !d) continue;
    const key = `${c}|${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ codigo: c, descricao: d, fontes });
  }
  return out;
}



async function pcpDecorateEstruturaButtonsSub(subUl) {
  const rows = Array.from(subUl.querySelectorAll('li.child-row'));
  const jobs = rows.map(async li => {
    const code = li.dataset.cod || li.querySelector('.cod')?.textContent?.trim();
    if (!code || !pcpIsPP(code)) { li.querySelector('.estrutura-btn')?.remove(); return; }

    const has = await pcpHasEstrutura(code);
    const acao = li.querySelector('.acao');
    if (!acao) return;

    if (has && !acao.querySelector('.estrutura-btn')) {
      const btn = document.createElement('button');
      btn.className = 'icon-btn estrutura-btn';
      btn.dataset.action = 'estrutura';
      btn.dataset.cod = code;
      btn.title = 'Estrutura do item';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 3h12v4H6zM12 7v4M4 13h8v4H4zM12 13h8v4h-8z" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
      acao.appendChild(btn);
    } else if (!has) {
      li.querySelector('.estrutura-btn')?.remove();
    }
  });
  await Promise.allSettled(jobs);
}



// Caminho único para abrir/carregar a PCP a partir de Comercial/Preparação
window.PCP = window.PCP || {};
window.PCP.open = function(codigo) {
  if (!codigo) return;
  setPCPProdutoCodigo(codigo);     // atualiza título
  showKanbanTab('pcp');            // mostra a aba
  ensurePCPEstruturaAutoLoad(codigo); // carrega a estrutura do MESMO código
};


// Sequenciador global para “última chamada vence”
window.__pcpLoadSeq = 0;

async function ensurePCPEstruturaAutoLoad(/* codigoIgnorado */) {
  // IGNORA parâmetro externo: só vale a fonte canônica
  const code = String(window.pcpCodigoAtual || '').trim();
  if (!code) return;

  const mySeq = ++window.__pcpLoadSeq; // carimbo desta execução

  try {
    const payload = await fetchEstruturaPCP_SQL(code);

    // Só renderiza se ainda formos o mais recente
    if (mySeq === window.__pcpLoadSeq) {
      renderPCPListaEstrutura(payload, code);
    }
  } catch (e) {
    // Também protege o fallback com o sequenciador
    if (mySeq === window.__pcpLoadSeq) {
      console.error('[PCP] falha ao carregar estrutura:', e);
      renderPCPListaEstrutura({ dados: [] }, code);
    }
  }
}





// expõe global para quem chama de outros módulos (kanban.js / kanban_base.js)
window.ensurePCPEstruturaAutoLoad = ensurePCPEstruturaAutoLoad;


function compactPCPFilters() {
  const code = document.getElementById('codeFilterPCP');
  const desc = document.getElementById('descFilterPCP');
  [code, desc].forEach((el, i) => {
    if (!el) return;
    el.style.flex = 'none';
    el.style.height = '24px';
    el.style.padding = '2px 6px';
    el.style.fontSize = '12px';
    el.style.border = '1px solid var(--border-color)';
    el.style.borderRadius = '4px';
    el.style.width = i === 0 ? '120px' : '200px'; // 0=código, 1=descrição
  });
}

// também fica global, pois é chamado a partir do kanban.js
window.compactPCPFilters = compactPCPFilters;

// referências ao container principal e ao painel de Acessos
const wrapper      = document.querySelector('.wrapper');
const acessosPanel = document.getElementById('acessos');

// Spinner de carregamento

/* ======== Helpers – alternar Pedidos (Kanban) ======== */
function showKanban () {
    hideArmazem();                 // ← NOVA LINHA
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

// Spinner exclusivo da guia “Estrutura de produto”
function showEstruturaSpinner() {
  const dst = document.getElementById('estruturaSpinner');
  if (!dst) return;
  ensureEstruturaSpinnerMarkup();               // injeta e corrige display do <i>
  dst.style.display = 'inline-flex';            // mostra o contêiner
  const i = dst.querySelector('.kanban-spinner');
  if (i) i.style.display = 'inline-flex';       // sobrepõe o CSS global do Kanban
}

function hideEstruturaSpinner() {
  const dst = document.getElementById('estruturaSpinner');
  if (dst) dst.style.display = 'none';
}

// [Estrutura] Reusa o mesmo spinner do Kanban (fa-spinner fa-spin)
// Mantém a função NO ESCOPO GLOBAL, pois showEstruturaSpinner a chama diretamente.
function ensureEstruturaSpinnerMarkup() {
  const dst = document.getElementById('estruturaSpinner');
  if (!dst) return;

  // injeta o <i> do spinner se ainda não existir
  let i = dst.querySelector('.kanban-spinner');
  if (!i) {
    dst.innerHTML = '<i class="fas fa-spinner fa-spin kanban-spinner" aria-hidden="true"></i>';
    i = dst.querySelector('.kanban-spinner');
  }

  // garante que fique visível (o CSS do kanban esconde por padrão)
  i.style.display = 'inline-block';
}

// expõe no escopo global (útil para futuros usos/DevTools)
window.ensureEstruturaSpinnerMarkup = ensureEstruturaSpinnerMarkup;



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

// injeta CSS para esconder via classe
(function ensurePermCss(){
  if (document.getElementById('perm-hide-style')) return;
  const st = document.createElement('style');
  st.id = 'perm-hide-style';
  st.textContent = `.perm-hidden{display:none !important;}`;
  document.head.appendChild(st);
})();


// Exemplo: chamar após confirmar sessão
document.addEventListener('DOMContentLoaded', () => {
  // quando você já tiver setado window.__sessionUser
  setTimeout(applyCurrentUserPermissionsToUI, 200);
  // garante que o botão "+" apareça assim que a UI renderizar
setTimeout(ensureColabCreateButton, 50);

// Comercial → fixa código e abre PCP carregando via SQL
document.getElementById('coluna-comercial')?.addEventListener('click', (ev) => {
  const li = ev.target.closest('.kanban-card');
  if (!li) return;

  const codigo = (li.dataset.codigo || '').trim();
  if (!codigo) return;

  // 1) Define a FONTE CANÔNICA
  window.setPCPProdutoCodigo?.(codigo);

  // 2) Abre a sub-aba PCP
  document.querySelector('#kanbanTabs .main-header-link[data-kanban-tab="pcp"]')?.click();

  // 3) Carrega SEM parâmetro (usa pcpCodigoAtual)
  setTimeout(() => window.ensurePCPEstruturaAutoLoad?.(), 30);
});



// Se a guia PCP abrir por hash/rota, tenta carregar automático
try {
  const hash = String(location.hash || '');
  if (hash.includes('pcp')) setTimeout(ensurePCPEstruturaAutoLoad, 80);
} catch (_) {}

// Se clicar em alguma aba/âncora que aponte para PCP, tenta carregar após a troca
document.body.addEventListener('click', (ev) => {
  const goPCP = ev.target.closest('[data-kanban-tab="pcp"], [data-nav-key="pcp"], [href="#pcp"], [data-tab-target="pcp"], a[href*="conteudo-pcp"]');
  if (goPCP) setTimeout(ensurePCPEstruturaAutoLoad, 60);
});


});

// Abre a aba Dados do produto
function openDadosProdutoTab() {
  hideKanban();

  // 1) esconde todas as panes
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  // 2) limpa destaque de todos os links principais
  document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
  // 3) destaca “Dados do produto”
  const dadosLink = document.querySelector('.main-header-link[data-target="dadosProduto"]');
  if (dadosLink) dadosLink.classList.add('is-active');
  // 4) mostra painel e sub-header
  document.getElementById('dadosProduto').style.display = 'block';
  document.querySelector('.main-header').style.display = 'flex';
  // 5) dispara sempre a sub-aba “Detalhes”
  const detalhesInicial = document.querySelector(
    '#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]'
  );
  if (detalhesInicial) detalhesInicial.click();
}


/* ======== Helpers – alternar Armazéns ======== */
function showArmazem () {
  // esconde qualquer pane de Produto
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  // esconde Kanban e Produto
  hideKanban();
  document.getElementById('produtoTabs').style.display = 'none';

  // mostra Armazéns
  document.getElementById('armazemTabs').style.display    = 'flex';
  document.getElementById('armazemContent').style.display = 'block';
  showArmazemTab('almoxarifado');          // primeira aba
}

function hideArmazem () {
  document.getElementById('armazemTabs').style.display    = 'none';
  document.getElementById('armazemContent').style.display = 'none';
  // se preferir, pode voltar a mostrar produtoTabs aqui
}

/* ——— sub-abas internas ——— */
async function showArmazemTab(nome) {

  document.querySelectorAll('#armazemTabs .main-header-link')
    .forEach(a => a.classList.toggle('is-active', a.dataset.armTab === nome));

  document.querySelectorAll('#armazemContent .armazem-page')
    .forEach(p => p.style.display = (p.id === `conteudo-${nome}` ? 'block' : 'none'));

// —— Almoxarifado: sempre recarrega a página corrente ——
if (nome === 'almoxarifado') {
  // 1) busca dados caso ainda não exista nada carregado
  if (!almoxAllDados.length) {
    await carregarAlmoxarifado();      // primeira vez
  } else {
    aplicarFiltroAlmox();              // reaplica prefixos + texto
  }

  // 2) carrega o CSV e monta checkboxes só na primeira abertura
  if (!almoxCsvLoaded) {
    await loadAlmoxTipoCSV();
  }
}
else if (nome === 'producao') {
  if (!prodAllDados.length) {
    await carregarProducao();          // busca dados 1ª vez
  } else {
    aplicarFiltroProd();
  }

  if (!prodCsvLoaded) await loadProdTipoCSV();
}
else if (nome === 'transferencia') {
  renderTransferenciaLista();
  carregarLocaisEstoque();
}



}


/* ====================================================== */
/*  Almoxarifado – carregar dados                         */
/* ====================================================== */
let almoxDataLoaded = false;

/* ====================================================== */
/*  Almoxarifado – carregar todos os itens                */
/* ====================================================== */
async function carregarAlmoxarifado() {
  const tbody = document.querySelector('#tbl-almoxarifado tbody');
  tbody.innerHTML = '<tr><td colspan="6">⏳ Carregando…</td></tr>';

  try {
    const resp = await fetch('/api/armazem/almoxarifado', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ pagina: 1 })        // backend devolve tudo
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha na API');

    /* —— guarda e desenha —— */
    almoxAllDados   = json.dados;      // mantém a lista completa
    almoxTotalPages = 1;               // sempre 1 agora
    almoxCurrentPage = 1;
    almoxDataLoaded = true;

    renderAlmoxTable(almoxAllDados);   // cria as <tr>

    /* —— contador e pager —— */
    document.querySelector('.almox-pager').style.display = 'none';  // esconde ◀▶
    document.getElementById('almoxPageInfo').textContent = '1 / 1';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="6">⚠️ Erro ao carregar dados</td></tr>';
  }
}

async function ensureAlmoxDadosCarregados() {
  if (almoxDataLoaded && almoxAllDados.length) return;
  try {
    await carregarAlmoxarifado();
  } catch (err) {
    console.error('[transfer] Falha ao garantir dados do Almoxarifado:', err);
  }
}

function preencherTransferLocais() {
  const selects = [
    document.getElementById('transferOrigem'),
    document.getElementById('transferDestino')
  ].filter(Boolean);

  selects.forEach(sel => {
    const current = sel.value;
    const isOrigem = sel.id === 'transferOrigem';
    const preferido = isOrigem ? TRANSFER_DEFAULT_ORIGEM : TRANSFER_DEFAULT_DESTINO;
    sel.innerHTML = '<option value="">Selecione…</option>';
    transferLocais.forEach(loc => {
      const opt = document.createElement('option');
      const codigoLocal = String(loc.codigo_local_estoque || loc.codigo || '');
      const codigo = loc.codigo ? `${loc.codigo} — ` : '';
      const descricao = loc.descricao || '';
      const label = `${codigo}${descricao}${loc.inativo ? ' (inativo)' : ''}`.trim();
      opt.value = codigoLocal;
      opt.dataset.codigo = loc.codigo || '';
      opt.dataset.inativo = loc.inativo ? 'S' : 'N';
      opt.title = label;
      opt.textContent = label;
      if (loc.inativo) opt.classList.add('is-inactive');
      sel.appendChild(opt);
    });
    const hasCurrent = current && Array.from(sel.options).some(o => o.value === current);
    if (hasCurrent) {
      sel.value = current;
    } else if (preferido && Array.from(sel.options).some(o => o.value === preferido)) {
      sel.value = preferido;
    } else if (sel.options.length > 1) {
      sel.selectedIndex = 1;
    }
  });
}

async function carregarLocaisEstoque() {
  if (transferLocais.length) {
    preencherTransferLocais();
    return transferLocais;
  }

  try {
    const resp = await fetch('/api/armazem/locais');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha ao listar locais');
    transferLocais = Array.isArray(json.locais) ? json.locais.map(loc => ({
      codigo: loc.codigo || '',
      descricao: loc.descricao || '',
      codigo_local_estoque: String(loc.codigo_local_estoque || ''),
      inativo: !!loc.inativo,
      padrao: !!loc.padrao
    })) : [];
    transferLocais.sort((a, b) => (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR'));
    preencherTransferLocais();
  } catch (err) {
    console.error('[transfer] Falha ao carregar locais de estoque:', err);
    const selects = [
      document.getElementById('transferOrigem'),
      document.getElementById('transferDestino')
    ].filter(Boolean);
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">Não foi possível carregar os locais</option>';
    });
  }
  return transferLocais;
}

async function loadAlmoxTipoCSV() {
  if (almoxCsvLoaded) return;     // só carrega uma vez

  const panel = document.getElementById('almoxFilterPanel');
  panel.innerHTML = '';
  // carrega CSV (servido como arquivo estático)
  const textoCsv = await (await fetch('csv/Tipo.csv')).text();

  Papa.parse(textoCsv, {
    header: true,
    skipEmptyLines: true,
    complete: ({ data }) => {
      data.forEach(row => {
        const desc   = row['Descrição'].trim();
        const raw    = row['Grupo'].trim();
const prefix = raw.padStart(2, '0');   // “1” → “01”, “9” → “09”
 
        const padrao = row['almoxarifado']?.trim().toUpperCase() === 'S';

        almoxTipoMap.set(desc, prefix);
        if (padrao) almoxActivePrefixes.add(prefix);

        // monta checkbox
        const id = `chk_${prefix}`;
        const label = document.createElement('label');
        label.innerHTML = `
          <input type="checkbox" id="${id}" ${padrao ? 'checked' : ''}>
          <span>${desc}</span>`;
        panel.appendChild(label);

        // listener deste checkbox
        label.querySelector('input').addEventListener('change', e => {
          if (e.target.checked)  almoxActivePrefixes.add(prefix);
          else                   almoxActivePrefixes.delete(prefix);
          aplicarFiltroAlmox();           // refaz a tabela
        });
      });
      // se os dados já estão na memória, reaplica filtro imediatamente
      if (almoxAllDados.length) aplicarFiltroAlmox();

      almoxCsvLoaded = true;
    }
  });
}

async function loadProdTipoCSV() {
  if (prodCsvLoaded) return;

  const panel = document.getElementById('prodFilterPanel');
  const textoCsv = await (await fetch('csv/Tipo.csv')).text();

  Papa.parse(textoCsv, {
    header: true,
    skipEmptyLines: true,
    complete: ({ data }) => {
      data.forEach(row => {
        const desc   = row['Descrição'].trim();
        const raw    = row['Grupo'].trim();
        const prefix = raw.padStart(2, '0');         // “1” → “01”
        // Na aba Produção vamos iniciar **todos** ativos
prodTipoMap.set(desc, prefix);
const padrao = (row['produção'] ?? '').trim().toUpperCase() !== 'N';
if (padrao) prodActivePrefixes.add(prefix);


        const id = `chkProd_${prefix}`;
        const label = document.createElement('label');
label.innerHTML = `
  <input type="checkbox" id="${id}" ${padrao ? 'checked' : ''}>
  <span>${desc}</span>`;

        panel.appendChild(label);

        label.querySelector('input').addEventListener('change', e => {
          if (e.target.checked)  prodActivePrefixes.add(prefix);
          else                   prodActivePrefixes.delete(prefix);
          aplicarFiltroProd();          // refaz tabela produção
        });
      });

      prodCsvLoaded = true;
      if (prodAllDados.length) aplicarFiltroProd();   // reaplica filtro inicial
    }
  });
}


async function carregarProducao() {
  const tbody = document.querySelector('#tbl-producao tbody');
  tbody.innerHTML = '<tr><td colspan="7">⏳ Carregando…</td></tr>';

  try {
    const resp = await fetch('/api/armazem/producao', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ pagina:1 })
    });
    const json = await resp.json();
    if (!json.ok) throw new Error(json.error || 'Falha na API');

    prodAllDados   = json.dados;
    prodCurrentPage = 1;
    prodTotalPages  = 1;

    renderProdTable(prodAllDados);
    document.querySelector('#conteudo-producao .almox-pager').style.display = 'none';
    document.getElementById('prodPageInfo').textContent = '1 / 1';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="7">⚠️ Erro ao carregar dados</td></tr>';
  }
}


document.getElementById('menu-armazens').addEventListener('click', e => {
  e.preventDefault();
  showArmazem();
});

// Ao abrir "Cadastro de colaboradores", mostra a aba e injeta o botão "+"
// Ao abrir "Cadastro de colaboradores", mostra a aba e injeta o botão "+"
document.getElementById('btn-colaboradores')?.addEventListener('click', (e) => {
  e.preventDefault();
  showMainTab('dadosColaboradores');

  // tenta várias vezes enquanto o módulo termina de montar o DOM
  let tentativas = 0;
  const iv = setInterval(() => {
    tentativas++;
    try { ensureColabCreateButton(); } catch {}
    const ok = !!document.getElementById('btn-colab-create');
    if (ok || tentativas >= 20) clearInterval(iv); // ~3s no total
  }, 150);
});


window.addEventListener('auth:changed', () => {
  try { ensureColabCreateButton(); } catch {}
});


document.querySelectorAll('#armazemTabs .main-header-link')
  .forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showArmazemTab(link.dataset.armTab);   // almoxarifado / producao / …
    });
  });

  /* ——— paginação ——— */
document.getElementById('almoxPrev').addEventListener('click', () => {
  if (almoxCurrentPage > 1) {
    carregarAlmoxarifado(almoxCurrentPage - 1);
  }
});
document.getElementById('almoxNext').addEventListener('click', () => {
  if (almoxCurrentPage < almoxTotalPages) {
    carregarAlmoxarifado(almoxCurrentPage + 1);
  }
});

/* —— pesquisa em tempo-real —— */
const inpSearch = document.getElementById('almoxSearch');
inpSearch.addEventListener('input', aplicarFiltroAlmox);

/* —— Botão de filtro (toggle) —— */
const btnFiltro = document.getElementById('almoxFilterBtn');
btnFiltro.addEventListener('click', () => {
  const panel = document.getElementById('almoxFilterPanel');
  const isOpen = panel.classList.contains('is-open');
  if (isOpen) {
    panel.classList.remove('is-open');
    panel.style.display = 'none';
    return;
  }

  panel.classList.add('is-open');
  panel.style.display = 'flex';

  // posiciona logo abaixo do botão
  const r = btnFiltro.getBoundingClientRect();
  panel.style.left = `${window.scrollX + r.left}px`;
  panel.style.top  = `${window.scrollY + r.bottom + 6}px`;
});

/* —— busca Produção —— */
const prodInput = document.getElementById('prodSearch');
prodInput.addEventListener('input', aplicarFiltroProd);

const prodBtnFiltro = document.getElementById('prodFilterBtn');
prodBtnFiltro.addEventListener('click', () => {
  const panel = document.getElementById('prodFilterPanel');
  const isOpen = panel.classList.contains('is-open');
  if (isOpen) {
    panel.classList.remove('is-open');
    panel.style.display = 'none';
    return;
  }

  panel.classList.add('is-open');
  panel.style.display = 'flex';

  const r = prodBtnFiltro.getBoundingClientRect();
  panel.style.left = r.left + 'px';
  panel.style.top  = (r.bottom + 6) + 'px';
});


// Navega para a aba de Detalhes
function navigateToDetalhes(codigo) {
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
  document.querySelector('[data-target="dadosProduto"]').classList.add('is-active');
  document.getElementById('dadosProduto').style.display = 'block';
  document.querySelector('.main-header').style.display = 'flex';
  window.loadDadosProduto(codigo);
}

const OMIE_SYNC_TASKS = [
  {
    key: 'clientes',
    label: 'clientes_cadastro',
    description: 'Atualiza os cadastros de clientes vindos da Omie.',
    endpoint: '/api/admin/sync/clientes',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar clientes'
  },
  {
    key: 'pedidos',
    label: 'pedidos_venda / pedidos_venda_itens',
    description: 'Sincronização completa dos pedidos e respectivos itens.',
    endpoint: '/api/admin/sync/pedidos/completo',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar pedidos (completo)'
  },
  {
    key: 'pedidos-simples',
    label: 'pedidos_venda (modo simples)',
    description: 'Rotina resumida para atualizar os pedidos mais recentes.',
    endpoint: '/api/admin/sync/pedidos/simples',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar pedidos (simples)'
  },
  {
    key: 'estruturas',
    label: 'omie_estrutura / omie_estrutura_item',
    description: 'Reimporta todas as estruturas de produto listadas na Omie.',
    endpoint: '/api/admin/sync/pcp/estruturas',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar estruturas'
  },
  {
    key: 'produtos-omie',
    label: 'produtos_omie',
    description: 'Sincroniza os produtos cadastrados na Omie para a tabela produtos_omie.',
    endpoint: '/api/admin/sync/produtos-omie',
    method: 'POST',
    body: {},
    buttonLabel: 'Atualizar produtos Omie'
  }
];

let omieSyncRendered = false;
let omieSyncHandlersReady = false;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[menu_produto] DOMContentLoaded disparou');
  renderOmieSyncButtons();
  ensureOmieSyncBindings();

  const almoxTbody = document.querySelector('#tbl-almoxarifado tbody');
  if (almoxTbody && !almoxTbody.__transferBound) {
    almoxTbody.addEventListener('click', onAlmoxRowClick);
    almoxTbody.__transferBound = true;
  }
  renderTransferenciaLista();

  const transferTbody = document.getElementById('transferenciaTbody');
  if (transferTbody && !transferTbody.__transferBound) {
    transferTbody.addEventListener('change', (ev) => {
      const cb = ev.target.closest('.transfer-check');
      if (cb) {
        const codigo = cb.dataset.codigo || '';
        const item = transferenciaLista.find(i => i.codigo === codigo);
        if (item) item.selecionado = cb.checked;
        updateTransferControlsState();
        return;
      }
      const input = ev.target.closest('.transfer-qtd');
      if (input) {
        const codigo = input.dataset.codigo || '';
        const item = transferenciaLista.find(i => i.codigo === codigo);
        if (item) {
          item.qtd = sanitizeQtd(input.value, item.qtd || 1);
          input.value = formatQtdInput(item.qtd);
        }
        updateTransferControlsState();
      }
    });
    transferTbody.addEventListener('input', (ev) => {
      const input = ev.target.closest('.transfer-qtd');
      if (!input) return;
      const codigo = input.dataset.codigo || '';
      const item = transferenciaLista.find(i => i.codigo === codigo);
      if (!item) return;
      const num = parseFloat(input.value.replace(',', '.'));
      if (Number.isFinite(num) && num >= 0) item.qtd = num;
    });
    transferTbody.__transferBound = true;
  }

  const transferSelectAllBtn = document.getElementById('transferSelectAllBtn');
  const transferQtdBulk = document.getElementById('transferQtdBulk');

  if (transferQtdBulk && !transferQtdBulk.__transferBound) {
    transferQtdBulk.__transferBound = true;
    const aplicarQtdBulk = () => {
      if (!transferenciaLista.length) return;
      const valor = sanitizeQtd(transferQtdBulk.value, null);
      if (valor === null) return;
      transferenciaLista.forEach(item => { item.qtd = valor; });
      renderTransferenciaLista();
      transferQtdBulk.value = formatQtdInput(valor);
    };
    transferQtdBulk.addEventListener('input', aplicarQtdBulk);
    transferQtdBulk.addEventListener('change', aplicarQtdBulk);
    transferQtdBulk.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); aplicarQtdBulk(); }
    });
  }

  if (transferSelectAllBtn && !transferSelectAllBtn.__transferBound) {
    transferSelectAllBtn.__transferBound = true;
    transferSelectAllBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!transferenciaLista.length) return;
      const selecionarTudo = transferSelectAllBtn.dataset.state !== 'all';
      transferenciaLista.forEach(item => {
        item.selecionado = selecionarTudo;
        item.qtd = sanitizeQtd(item.qtd);
      });
      renderTransferenciaLista();
    });
  }

  const transferSearchInput    = document.getElementById('transferSearch');
  const transferSearchDropdown = document.querySelector('.transfer-search-dropdown');
  const transferSearchResults  = document.getElementById('transferSearchResults');
  if (transferSearchInput && transferSearchResults && !transferSearchInput.__transferBound) {
    transferSearchInput.__transferBound = true;
    let debounceId = null;

    const hideTransferResults = () => {
      if (debounceId) {
        clearTimeout(debounceId);
        debounceId = null;
      }
      if (transferSearchDropdown) transferSearchDropdown.style.display = 'none';
      transferSearchResults.innerHTML = '';
      transferSearchResults.style.maxHeight = '';
      transferSearchResults.style.height = '';
      transferSearchResults.style.overflowY = '';
    };

    transferSearchInput.addEventListener('input', () => {
      const termo = transferSearchInput.value.trim();
      if (debounceId) clearTimeout(debounceId);

      if (termo.length < 2) {
        hideTransferResults();
        return;
      }

      debounceId = setTimeout(async () => {
        if (transferSearchDropdown) transferSearchDropdown.style.display = 'block';
        transferSearchResults.innerHTML = '<li class="info">Buscando…</li>';
        transferSearchResults.style.maxHeight = `${44 * 5}px`;
        transferSearchResults.style.height = `${44 * 5}px`;
        transferSearchResults.style.overflowY = 'hidden';

        try {
          const resp = await fetch(`/api/produtos/search?q=${encodeURIComponent(termo)}&limit=40`, { credentials: 'include' });
          const json = await resp.json();
          const itens = Array.isArray(json?.data) ? json.data : [];

          if (!itens.length) {
            transferSearchResults.innerHTML = '<li class="no-results">Nenhum item encontrado</li>';
            transferSearchResults.style.maxHeight = '44px';
            transferSearchResults.style.height = '44px';
            transferSearchResults.style.overflowY = 'hidden';
            return;
          }

          await ensureAlmoxDadosCarregados().catch(() => {});

          transferSearchResults.innerHTML = '';
          itens.forEach(prod => {
            const li = document.createElement('li');
            li.dataset.codigo = prod.codigo || '';
            li.dataset.descricao = prod.descricao || '';
            li.innerHTML = `<span class="codigo">${escapeHtml(prod.codigo || '')}</span><span class="descricao">${escapeHtml(prod.descricao || '')}</span>`;
            transferSearchResults.appendChild(li);
          });

          const first = transferSearchResults.firstElementChild;
          const itemHeight = first ? first.getBoundingClientRect().height || 44 : 44;
          const totalHeight = itens.length * itemHeight;
          const maxHeight = Math.min(totalHeight, itemHeight * 5);
          transferSearchResults.style.maxHeight = `${maxHeight}px`;
          transferSearchResults.style.height = `${maxHeight}px`;
          transferSearchResults.style.overflowY = totalHeight > maxHeight ? 'auto' : 'hidden';
        } catch (err) {
          console.error('[transferencia] autocomplete', err);
          transferSearchResults.innerHTML = '<li class="error">Erro ao buscar</li>';
          transferSearchResults.style.maxHeight = '44px';
          transferSearchResults.style.height = '44px';
          transferSearchResults.style.overflowY = 'hidden';
        }
      }, 150);
    });

    transferSearchResults.addEventListener('click', async (ev) => {
      const li = ev.target.closest('li[data-codigo]');
      if (!li || li.classList.contains('info') || li.classList.contains('error') || li.classList.contains('no-results')) return;

      const codigo = li.dataset.codigo || '';
      const descricao = li.dataset.descricao || '';
      await ensureAlmoxDadosCarregados().catch(() => {});
      const extra = almoxAllDados.find(item => item.codigo === codigo) || {};

      adicionarItemTransferencia({
        codigo,
        descricao,
        min: extra.min ?? 0,
        fisico: extra.fisico ?? 0,
        saldo: extra.saldo ?? 0,
        cmc: extra.cmc ?? 0,
        qtd: 1
      });

      transferSearchInput.value = '';
      hideTransferResults();
      showArmazemTab('transferencia');
    });

    transferSearchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        transferSearchInput.value = '';
        hideTransferResults();
      }
    });

    transferSearchInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!document.activeElement || document.activeElement.closest('#transferSearchResults') === null) {
          hideTransferResults();
        }
      }, 150);
    });

    document.addEventListener('click', (ev) => {
      if (ev.target === transferSearchInput) return;
      if (transferSearchDropdown && transferSearchDropdown.contains(ev.target)) return;
      hideTransferResults();
    });
  }
  carregarLocaisEstoque();
  // abre o painel Início como padrão
  showMainTab('paginaInicio');

  const setupIappSyncButton = (buttonId, {
    endpoint,
    inputId,
    uploadingLabel = 'Sincronizando…',
    contextLabel = 'Sincronização'
  } = {}) => {
    const btn = document.getElementById(buttonId);
    if (!btn || btn.dataset.iappSyncBound || !endpoint) return;
    btn.dataset.iappSyncBound = 'true';

    const originalInnerHTML = btn.innerHTML;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fileInput.style.display = 'none';
    fileInput.id = inputId || `${buttonId}-input`;
    document.body.appendChild(fileInput);

    let busy = false;

    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (busy) return;
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file || busy) return;

      busy = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('is-disabled');
      btn.innerHTML = uploadingLabel;

      try {
        const formData = new FormData();
        formData.append('file', file);

        const resp = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });

        let payload;
        try {
          payload = await resp.json();
        } catch {
          throw new Error('Resposta inesperada do servidor.');
        }

        if (!resp.ok || !payload?.ok) {
          const msg = payload?.error || `Falha ao sincronizar (HTTP ${resp.status}).`;
          throw new Error(msg);
        }

        const makeSummary = (sheetPayload) => {
          const inserted = Number(sheetPayload?.inserted || 0);
          const updated = Number(sheetPayload?.updated || 0);
          const unchanged = Number(sheetPayload?.unchanged || 0);
          const workbookRows = Number(sheetPayload?.workbookRows || 0);
          const existing = Number(sheetPayload?.existingCount || 0);
          const label = sheetPayload?.sheetName || '(Aba desconhecida)';
          return { inserted, updated, unchanged, workbookRows, existing, label };
        };

        if (payload.sheets && typeof payload.sheets === 'object') {
          const summaries = Object.values(payload.sheets).map(makeSummary);
          const totalInserted = summaries.reduce((sum, s) => sum + s.inserted, 0);
          const totalUpdated = summaries.reduce((sum, s) => sum + s.updated, 0);
          const details = summaries
            .map(s => `${s.label}: ${s.inserted} inserida(s), ${s.updated} atualizada(s), ${s.unchanged} inalterada(s) (planilha ${s.workbookRows}, registros anteriores ${s.existing})`)
            .join('\n');
          const headerMsg = (totalInserted + totalUpdated) > 0
            ? `${contextLabel} concluída!`
            : `${contextLabel} concluída: nenhuma alteração encontrada.`;
          alert(`${headerMsg}\n${details}`);
        } else {
          const { inserted, updated, unchanged, workbookRows, existing } = makeSummary(payload);
          const headerMsg = (inserted + updated) > 0
            ? `${contextLabel} concluída!\nInseridas: ${inserted}. Atualizadas: ${updated}.`
            : `${contextLabel} concluída: nenhuma alteração encontrada.`;
          alert(`${headerMsg}\nInalteradas: ${unchanged}.\nLinhas na planilha: ${workbookRows}.\nRegistros anteriores: ${existing}.`);
        }
      } catch (err) {
        console.error(`[iapp-sync] erro ao processar planilha (${buttonId}):`, err);
        alert(`Erro ao sincronizar planilha: ${err?.message || err}`);
      } finally {
        busy = false;
        btn.innerHTML = originalInnerHTML;
        btn.classList.remove('is-disabled');
        btn.removeAttribute('aria-disabled');
        fileInput.value = '';
      }
    });
  };

  setupIappSyncButton('menu-iapp-sincronizar-op-iapp', {
    endpoint: '/api/iapp/historico-op/sync',
    inputId: 'iapp-sync-op-input',
    contextLabel: 'Sincronização do histórico de OP IAPP'
  });

  setupIappSyncButton('menu-iapp-sincronizar-lista-pecas', {
    endpoint: '/api/iapp/historico-estrutura/sync',
    inputId: 'iapp-sync-lista-pecas-input',
    contextLabel: 'Sincronização da lista de peças'
  });

  setupIappSyncButton('menu-iapp-sincronizar-op-glide', {
    endpoint: '/api/glide/historico-op/sync',
    inputId: 'iapp-sync-op-glide-input',
    contextLabel: 'Sincronização do histórico de OP GLIDE'
  });

  setupIappSyncButton('menu-iapp-sincronizar-at', {
    endpoint: '/api/assistencia/sync',
    inputId: 'iapp-sync-at-input',
    contextLabel: 'Sincronização AT'
  });

  setupIappSyncButton('menu-iapp-sincronizar-originalis', {
    endpoint: '/api/originalis/pedidos/sync',
    inputId: 'iapp-sync-originalis-input',
    contextLabel: 'Sincronização dos pedidos Originalis'
  });

  setupIappSyncButton('menu-iapp-sincronizar-pre2024', {
    endpoint: '/api/iapp/historico-pre2024/sync',
    inputId: 'iapp-sync-pre2024-input',
    contextLabel: 'Sincronização &lt; 2024'
  });

  // Atalho: sincronização de Produtos (Omie) direto pelo menu IAPP
  // Objetivo: permitir que o usuário dispare a rotina sem precisar navegar manualmente até a aba "Atualizar tabelas Omie".
  const menuIappSyncProdutosOmie = document.getElementById('menu-iapp-sincronizar-produtos-omie');
  menuIappSyncProdutosOmie?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    // marca seleção no menu
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuIappSyncProdutosOmie.classList.add('is-active');

    // abre a aba "Atualizar tabelas Omie" e garante que os botões existam
    renderOmieSyncButtons();
    ensureOmieSyncBindings();
    showMainTab('omieAtualizarTabelas');
    // Não dispara mais automaticamente. Execução somente pelo botão "Atualizar produtos Omie".
  });

  function renderClientePedidosCard(entry) {
    const raw = entry?.raw || {};
    const nome = raw.razao_social || raw.nome_fantasia || `Cliente ${formatQualidadeValue(raw.codigo_cliente_omie)}`;
    const fantasia = raw.nome_fantasia && raw.nome_fantasia !== raw.razao_social ? raw.nome_fantasia : null;
    const doc = raw.cnpj_cpf ? `CNPJ/CPF: ${formatQualidadeValue(raw.cnpj_cpf)}` : null;
    const codigoCliente = raw.codigo_cliente_omie ? `Código Omie: ${formatQualidadeValue(raw.codigo_cliente_omie)}` : null;
    const grupos = Array.isArray(raw.pedidos) ? raw.pedidos : [];

    const formatDateTime = (value) => {
      if (!value) return '—';
      try {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
          return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        }
      } catch (_err) {}
      return formatQualidadeValue(value);
    };

    const pedidosHtml = grupos.length
      ? grupos.map((grupo) => {
          const codigo = grupo?.codigo ? escapeHtml(formatQualidadeValue(grupo.codigo)) : '—';
          const descricao = grupo?.descricao ? escapeHtml(formatQualidadeValue(grupo.descricao)) : 'Sem descrição';
          const totalQuantidade = grupo?.total_quantidade === null || grupo?.total_quantidade === undefined
            ? '—'
            : escapeHtml(formatQualidadeValue(grupo.total_quantidade));
          const pedidosLista = Array.isArray(grupo?.pedidos) ? grupo.pedidos : [];
          const pedidosListaHtml = pedidosLista.length
            ? pedidosLista.map((pedido) => {
                const pedidoLabel = pedido?.numero_pedido || pedido?.codigo_pedido || '—';
                const pedidoDisplay = escapeHtml(formatQualidadeValue(pedidoLabel));
                const quantidade = pedido?.quantidade === null || pedido?.quantidade === undefined
                  ? '—'
                  : escapeHtml(formatQualidadeValue(pedido.quantidade));
                const updated = escapeHtml(formatDateTime(pedido?.updated_at));
                const pedidoCliente = pedido?.numero_pedido_cliente
                  ? `<small>${escapeHtml(`Cliente: ${formatQualidadeValue(pedido.numero_pedido_cliente)}`)}</small>`
                  : '';
                return `
                  <li class="qualidade-pedido-item">
                    <span class="qualidade-pedido-id">${pedidoDisplay}${pedidoCliente}</span>
                    <span class="qualidade-pedido-qtd">${quantidade}</span>
                    <span class="qualidade-pedido-date">${updated}</span>
                  </li>`;
              }).join('')
            : '<li class="qualidade-pedido-item"><span class="qualidade-pedido-id">—</span><span class="qualidade-pedido-qtd">—</span><span class="qualidade-pedido-date">—</span></li>';

          return `
            <div class="qualidade-pedido-card">
              <div class="qualidade-pedido-header">
                <span class="qualidade-pedido-codigo">${codigo}</span>
                <span class="qualidade-pedido-descricao">${descricao}</span>
                <span class="qualidade-pedido-total">Total: ${totalQuantidade}</span>
              </div>
              <ul class="qualidade-pedido-items">
                <li class="qualidade-pedido-item qualidade-pedido-item-head">
                  <span class="qualidade-pedido-id">Pedidos</span>
                  <span class="qualidade-pedido-qtd">Qtd</span>
                  <span class="qualidade-pedido-date">Atualizado</span>
                </li>
                ${pedidosListaHtml}
              </ul>
            </div>`;
        }).join('')
      : '<div class="qualidade-cliente-empty">Nenhum pedido encontrado para este cliente.</div>';

    const headerExtra = [fantasia, doc, codigoCliente]
      .filter(Boolean)
      .map((value) => `<span>${escapeHtml(value)}</span>`)
      .join('');

  return `
      <div class="qualidade-cliente-card">
        <div class="qualidade-cliente-header">
          <span class="qualidade-cliente-nome">${escapeHtml(formatQualidadeValue(nome))}</span>
          ${headerExtra ? `<div class="qualidade-cliente-meta">${headerExtra}</div>` : ''}
        </div>
        <div class="qualidade-pedidos-list">
          ${pedidosHtml}
        </div>
      </div>`;
  }

  function renderOmieSyncButtons(force = false) {
    const listEl = document.getElementById('omie-sync-list');
    const emptyEl = document.getElementById('omie-sync-empty');
    if (!listEl || !emptyEl) return;
    if (omieSyncRendered && !force) return;
    omieSyncRendered = true;

    if (!OMIE_SYNC_TASKS.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }

    emptyEl.style.display = 'none';
    listEl.innerHTML = OMIE_SYNC_TASKS.map((task) => {
      const base = `
      <div class="omie-sync-card" data-omie-key="${escapeHtml(task.key)}">
        <h3>${escapeHtml(task.label)}</h3>
        <p>${escapeHtml(task.description)}</p>
        <button
          type="button"
          class="omie-sync-button"
          data-omie-action="${escapeHtml(task.key)}"
        >${escapeHtml(task.buttonLabel || 'Atualizar')}</button>
        <div class="omie-sync-status" id="omie-sync-status-${escapeHtml(task.key)}"></div>
      `;

      if (task.key === 'produtos-omie') {
        return base + `
          <div class="omie-sync-schedule">
            <div class="omie-sync-schedule-row">
              <label for="omie-schedule-time">Agendar horário diário</label>
              <input type="time" id="omie-schedule-time" class="omie-schedule-time" />
              <label class="omie-schedule-enabled-label">
                <input type="checkbox" id="omie-schedule-enabled" /> Ativo
              </label>
              <button type="button" class="omie-schedule-save">Agendar</button>
            </div>
            <div class="omie-sync-filter">
              <div class="omie-sync-schedule-row">
                <label for="omie-filter-column">Filtrar por coluna</label>
                <select id="omie-filter-column"></select>
                <button type="button" class="omie-filter-load">Carregar opções</button>
              </div>
              <div id="omie-filter-values" class="omie-filter-values"></div>
            </div>
            <div class="omie-sync-next" id="omie-schedule-next"></div>
            <div class="omie-logs">
              <div class="omie-sync-schedule-row">
                <button type="button" class="omie-logs-toggle">Mostrar logs</button>
                <button type="button" class="omie-logs-refresh" style="display:none;">Atualizar logs</button>
                <label>
                  <span style="opacity:.8;">Linhas:</span>
                  <input id="omie-logs-lines" type="number" min="50" max="1000" value="200" style="width:80px;">
                </label>
              </div>
              <div id="omie-logs-box" class="omie-logs-box" style="display:none;"></div>
            </div>
          </div>
        </div>`;
      }
      return base + `</div>`;
    }).join('');

    // carrega o agendamento (se houver) para 'produtos-omie'
    try { loadProdutosOmieSchedule(); } catch {}
  }

  async function runOmieSyncTask(taskKey) {
    const task = OMIE_SYNC_TASKS.find(t => t.key === taskKey);
    if (!task) return;
    const button = document.querySelector(`.omie-sync-button[data-omie-action="${taskKey}"]`);
    const statusEl = document.getElementById(`omie-sync-status-${taskKey}`);
    if (!button || !statusEl) return;

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Sincronizando…';
    statusEl.textContent = 'Executando sincronização…';
    statusEl.classList.remove('is-success', 'is-error');
    statusEl.classList.add('is-running');

    const opts = {
      method: task.method || 'POST',
      credentials: 'include',
      headers: {}
    };
    // Corpo da requisição: para 'produtos-omie', incluir filtro selecionado (se houver)
    let bodyPayload = task.body !== undefined ? { ...task.body } : null;
    if (taskKey === 'produtos-omie') {
      const colEl = document.getElementById('omie-filter-column');
      const selectedValues = Array.from(document.querySelectorAll('#omie-filter-values input[type="checkbox"]:checked'))
        .map(cb => cb.value);
      const filter = (colEl && colEl.value && selectedValues.length) ? { column: colEl.value, values: selectedValues } : null;
      bodyPayload = { ...(bodyPayload||{}), filter };
    }
    if (bodyPayload) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(bodyPayload);
    } else {
      if (Object.keys(opts.headers).length === 0) delete opts.headers;
    }

    const startedAt = Date.now();
    try {
      const resp = await fetch(task.endpoint, opts);
      let payload = null;
      const text = await resp.text();
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }

      if (!resp.ok) {
        const errMsg =
          (payload && typeof payload === 'object' && payload.error) ||
          (typeof payload === 'string' && payload) ||
          `Falha HTTP ${resp.status}`;
        throw new Error(errMsg);
      }

      if (payload && typeof payload === 'object' && payload.ok === false && payload.error) {
        throw new Error(payload.error);
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      let detail = '';
      if (payload && typeof payload === 'object') {
        if (payload.started) {
          // Execução assíncrona: orienta o usuário e inicia uma sondagem breve do histórico
          detail = payload.message || 'Sincronização iniciada.';
          try {
            // pequena sondagem 3x para buscar o último histórico e exibir no status
            for (let i=0; i<3; i++) {
              await new Promise(r => setTimeout(r, 1500));
              const s = await fetch('/api/admin/schedule/produtos-omie', { credentials: 'include' });
              const j = await s.json().catch(() => null);
              if (j && j.last_summary) {
                // mostra um resumo curto no status
                const short = typeof j.last_summary === 'string' ? j.last_summary.slice(0, 160) : JSON.stringify(j.last_summary).slice(0,160);
                detail = `Iniciado · Último: ${short}`;
                break;
              }
            }
          } catch {}

          // Auto-refresh do painel de logs por ~30s, se estiver aberto
          if (taskKey === 'produtos-omie') {
            const box = document.getElementById('omie-logs-box');
            const linesEl = document.getElementById('omie-logs-lines');
            const isOpen = box && box.style.display !== 'none';
            if (isOpen) {
              const started = Date.now();
              const maxMs = 30000; // 30s
              const intervalMs = 2000; // a cada 2s
              const refreshOnce = async () => {
                const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
                try { await loadProdutosOmieLogs(n); } catch {}
              };
              try { await refreshOnce(); } catch {}
              if (window.__omieLogsTimer) clearInterval(window.__omieLogsTimer);
              window.__omieLogsTimer = setInterval(async () => {
                if (Date.now() - started > maxMs) {
                  clearInterval(window.__omieLogsTimer);
                  window.__omieLogsTimer = null;
                  return;
                }
                await refreshOnce();
              }, intervalMs);
            }
          }
        } else if (payload.message) detail = payload.message;
        else if (payload.produtos_processados != null) {
          detail = `${payload.produtos_processados} registros processados`;
        } else if (payload.pedidos_processados != null) {
          detail = `${payload.pedidos_processados} registros processados`;
        } else if (payload.paginas_processadas != null) {
          detail = `${payload.paginas_processadas} página(s) processadas`;
        }
      } else if (typeof payload === 'string' && payload.trim()) {
        detail = payload.trim().slice(0, 200);
      }
      statusEl.textContent = detail
        ? `Concluído em ${elapsed}s · ${detail}`
        : `Concluído em ${elapsed}s`;
      statusEl.classList.remove('is-error', 'is-running');
      statusEl.classList.add('is-success');
    } catch (err) {
      statusEl.textContent = `Erro ao sincronizar: ${err.message || err}`;
      statusEl.classList.remove('is-success', 'is-running');
      statusEl.classList.add('is-error');
      console.error('[omie-sync]', err);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
      // se for produtos-omie, atualiza logs (se painel estiver aberto)
      if (taskKey === 'produtos-omie') {
        const box = document.getElementById('omie-logs-box');
        if (box && box.style.display !== 'none') {
          const linesEl = document.getElementById('omie-logs-lines');
          const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
          try { await loadProdutosOmieLogs(n); } catch {}
        }
      }
    }
  }

  function ensureOmieSyncBindings() {
    const listEl = document.getElementById('omie-sync-list');
    if (!listEl || omieSyncHandlersReady) return;
    omieSyncHandlersReady = true;
    listEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.omie-sync-button');
      if (!btn) return;
      ev.preventDefault();
      const key = btn.dataset.omieAction;
      if (key) runOmieSyncTask(key);
    });

    // bind salvar agendamento
    listEl.addEventListener('click', async (ev) => {
      const saveBtn = ev.target.closest('.omie-schedule-save');
      if (!saveBtn) return;
      ev.preventDefault();
      try {
        const timeEl = document.getElementById('omie-schedule-time');
        const enabledEl = document.getElementById('omie-schedule-enabled');
        const colEl = document.getElementById('omie-filter-column');
        const selectedValues = Array.from(document.querySelectorAll('#omie-filter-values input[type="checkbox"]:checked')).map(cb => cb.value);
        if (!timeEl) return;
        const time = (timeEl.value || '').trim();
        const enabled = !!(enabledEl && enabledEl.checked);
        if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(time)) {
          alert('Informe um horário válido (HH:MM).');
          return;
        }
        const resp = await fetch('/api/admin/schedule/produtos-omie', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ time, enabled, filter_column: colEl?.value || null, filter_values: selectedValues })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data?.ok === false) {
          const msg = data?.error || `Falha HTTP ${resp.status}`;
          alert('Erro ao salvar agendamento: ' + msg);
          return;
        }
        updateProdutosOmieScheduleUI(data);
        alert('Agendamento salvo.');
      } catch (e) {
        alert('Erro ao salvar agendamento: ' + (e?.message || e));
      }
    });

    // carregar colunas disponíveis
    loadProdutosOmieFilterColumns();

    // carregar valores distintos para a coluna escolhida
    listEl.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.omie-filter-load');
      if (!btn) return;
      ev.preventDefault();
      const colEl = document.getElementById('omie-filter-column');
      if (!colEl || !colEl.value) { alert('Selecione uma coluna.'); return; }
      await loadProdutosOmieFilterValues(colEl.value);
    });

    // logs: toggle e refresh
    listEl.addEventListener('click', async (ev) => {
      const toggle = ev.target.closest('.omie-logs-toggle');
      if (toggle) {
        ev.preventDefault();
        const box = document.getElementById('omie-logs-box');
        const refresh = document.querySelector('.omie-logs-refresh');
        const linesEl = document.getElementById('omie-logs-lines');
        const isHidden = !box || box.style.display === 'none';
        if (isHidden) {
          if (box) box.style.display = 'block';
          if (refresh) refresh.style.display = 'inline-block';
          toggle.textContent = 'Ocultar logs';
          const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
          await loadProdutosOmieLogs(n);
        } else {
          if (box) box.style.display = 'none';
          if (refresh) refresh.style.display = 'none';
          toggle.textContent = 'Mostrar logs';
          if (window.__omieLogsTimer) { clearInterval(window.__omieLogsTimer); window.__omieLogsTimer = null; }
        }
        return;
      }
      const refresh = ev.target.closest('.omie-logs-refresh');
      if (refresh) {
        ev.preventDefault();
        const linesEl = document.getElementById('omie-logs-lines');
        const n = Math.min(Math.max(parseInt(linesEl?.value || '200', 10) || 200, 50), 1000);
        await loadProdutosOmieLogs(n);
      }
    });
  }

  async function loadProdutosOmieSchedule() {
    try {
      const resp = await fetch('/api/admin/schedule/produtos-omie', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Falha HTTP ${resp.status}`);
      updateProdutosOmieScheduleUI(data);
      // popula colunas e valores conforme configuração salva
      await loadProdutosOmieFilterColumns(data?.filter_column || null);
      if (data?.filter_column) await loadProdutosOmieFilterValues(data.filter_column, new Set(data?.filter_values || []));
    } catch (e) {
      // silencioso; apenas não preenche o UI
      console.warn('[omie-schedule] não foi possível carregar:', e?.message || e);
    }
  }

  function updateProdutosOmieScheduleUI(conf) {
    const timeEl = document.getElementById('omie-schedule-time');
    const enabledEl = document.getElementById('omie-schedule-enabled');
    const nextEl = document.getElementById('omie-schedule-next');
    if (timeEl && conf?.time) timeEl.value = conf.time;
    if (enabledEl && typeof conf?.enabled === 'boolean') enabledEl.checked = !!conf.enabled;
    if (nextEl) {
      if (conf?.enabled && conf?.next_run_iso) {
        const dt = new Date(conf.next_run_iso);
        const fmt = dt.toLocaleString();
        nextEl.textContent = `Próxima execução: ${fmt}`;
      } else if (conf?.time) {
        nextEl.textContent = 'Agendamento desativado';
      } else {
        nextEl.textContent = '';
      }
    }
    const last = document.createElement('div');
    last.className = 'omie-sync-next';
    if (conf?.last_run_at) {
      const ok = conf?.last_ok === true ? 'sucesso' : (conf?.last_ok === false ? 'falha' : 'desconhecido');
      const when = new Date(conf.last_run_at).toLocaleString();
      last.textContent = `Última execução: ${when} (${ok})`;
    }
    const container = document.querySelector('.omie-sync-card[data-omie-key="produtos-omie"] .omie-sync-schedule');
    if (container) {
      const old = container.querySelector('.omie-sync-last');
      if (old) old.remove();
      last.classList.add('omie-sync-last');
      container.appendChild(last);
    }
  }

  async function loadProdutosOmieFilterColumns(selected = null) {
    try {
      const resp = await fetch('/api/admin/schedule/produtos-omie/columns', { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) return;
      const sel = document.getElementById('omie-filter-column');
      if (!sel) return;
      sel.innerHTML = '<option value="">– selecione –</option>' + (data.columns||[]).map(c => `<option value="${escapeHtml(c.key)}" ${selected===c.key?'selected':''}>${escapeHtml(c.label)}</option>`).join('');
    } catch {}
  }

  async function loadProdutosOmieFilterValues(column, preselected = new Set()) {
    try {
      const resp = await fetch(`/api/admin/schedule/produtos-omie/column-values?column=${encodeURIComponent(column)}`, { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) return;
      const box = document.getElementById('omie-filter-values');
      if (!box) return;
      if (!Array.isArray(data.values) || !data.values.length) {
        box.innerHTML = '<div class="content-note">Sem valores para esta coluna.</div>';
        return;
      }
      const TIPOITEM_LABEL = {
        '00':'Mercadoria para revenda','01':'Matéria-prima','02':'Embalagem','03':'Produto em processo','04':'Produto acabado','05':'Subproduto','06':'Produto intermediário','07':'Material de uso e consumo','08':'Ativo imobilizado','09':'Serviço','10':'Outros insumos','99':'Outras','KT':'Kit'
      };
      const allId = 'omie-filter-all';
      box.innerHTML = [
        `<label class="omie-filter-all"><input type="checkbox" id="${allId}"> <strong>Selecionar todos</strong></label>`,
        '<div class="omie-filter-grid">',
        ...data.values.map(v => {
          const checked = preselected.has(String(v));
          const display = column === 'tipoitem' ? `${String(v)} — ${TIPOITEM_LABEL[String(v)] || ''}` : String(v) || '(vazio)';
          return `<label><input type="checkbox" value="${escapeHtml(String(v))}" ${checked?'checked':''}/> <span>${escapeHtml(display)}</span></label>`;
        }),
        '</div>'
      ].join('');
      // toggle marcar todos
      const all = document.getElementById(allId);
      if (all) {
        all.addEventListener('change', () => {
          box.querySelectorAll('input[type="checkbox"]').forEach(cb => { if (cb !== all) cb.checked = all.checked; });
        });
      }
    } catch {}
  }

  async function loadProdutosOmieLogs(lines = 200) {
    try {
      const resp = await fetch(`/api/admin/schedule/produtos-omie/logs?lines=${encodeURIComponent(lines)}`, { credentials: 'include' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data?.ok === false) throw new Error(data?.error || `Falha HTTP ${resp.status}`);
      const box = document.getElementById('omie-logs-box');
      if (!box) return;
      const content = (data.lines || []).map(l => escapeHtml(l)).join('\n');
      box.innerHTML = `<pre class="omie-logs-pre">${content}</pre>`;
    } catch (e) {
      const box = document.getElementById('omie-logs-box');
      if (box) box.innerHTML = `<div class="content-note">Erro ao carregar logs: ${escapeHtml(e?.message || String(e))}</div>`;
    }
  }

  const QUALIDADE_OS_GROUPS = [
    { key: 'controle_assistencia_tecnica', label: "Histórico de OS's" },
    { key: 'historico_op_glide', label: 'Histórico OP e NS', subtitle: 'GLIDE' },
    { key: 'historico_op_glide_f_escopo', label: 'Histórico OP e NS', subtitle: 'GLIDE (F Escopo)' },
    { key: 'historico_op_iapp', label: 'Histórico OP' },
    { key: 'historico_pedido_originalis', label: 'Histórico NF/OP/Pedidos' },
    { key: 'pedidos_por_cliente', label: 'Pedidos por Cliente', subtitle: 'Clientes e pedidos' },
    { key: 'historico_pre2024', label: 'Histórico pré-2024', subtitle: 'Pedidos anteriores a 2024' }
  ];
  const QUALIDADE_SOURCE_META = {
    controle_assistencia_tecnica: {
      keyColumns: ['protc'],
      extras: [{ field: 'protc', label: 'OS' }]
    },
    historico_op_glide: {
      keyColumns: ['ordem_de_producao', 'pedido'],
      extras: [
        { field: 'ordem_de_producao', label: 'OP' },
        { field: 'pedido', label: 'Pedido/NS' }
      ]
    },
    historico_op_glide_f_escopo: {
      keyColumns: ['ordem_de_producao', 'pedido'],
      extras: [
        { field: 'ordem_de_producao', label: 'OP' },
        { field: 'pedido', label: 'Pedido/NS' }
      ]
    },
    historico_op_iapp: {
      keyColumns: ['lote_antecipado'],
      extras: [
        { field: 'lote_antecipado', label: 'OP' },
        { field: 'ficha_tecnica_identificacao', label: 'Ficha técnica' }
      ]
    },
    historico_pedido_originalis: {
      keyColumns: ['nota_fiscal', 'ordem_de_producao', 'pedido'],
      extras: [
        { field: 'nota_fiscal', label: 'NF' },
        { field: 'ordem_de_producao', label: 'OP/NS' },
        { field: 'pedido', label: 'Pedido/NS' }
      ]
    },
    pedidos_por_cliente: {
      keyColumns: ['codigo_cliente_omie'],
      render: renderClientePedidosCard,
      disableDetail: true
    },
    historico_pre2024: {
      keyColumns: ['pedido'],
      extras: [
        { field: 'pedido', label: 'Pedido' },
        { field: 'modelo', label: 'Modelo' },
        { field: 'data_aprovacao_pedido', label: 'Data Aprovação' },
        { field: 'quantidade', label: 'Quantidade' }
      ]
    }
  };
  const QUALIDADE_OS_GROUP_MAP = QUALIDADE_OS_GROUPS.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});
  const QUALIDADE_DETAIL_LABELS = {
    protc: 'OS',
    lote_antecipado: 'OP',
    ordem_de_producao: 'OP',
    pedido: 'Pedido/NS',
    ficha_tecnica_identificacao: 'Ficha técnica',
    nota_fiscal: 'NF',
    modelo: 'Modelo',
    data_aprovacao_pedido: 'Data Aprovação Pedido',
    quantidade: 'Quantidade',
    razao_social_faturamento: 'Razão Social (Faturamento)',
    nome_fantasia_revende: 'Nome Fantasia (Revenda)'
  };
  const qualidadeOsCache = {};
  let qualidadeOsCurrentGroups = {};
  let qualidadeOsLastItemKey = null;
  let qualidadeOsSearchSeq = 0;
  let qualidadeCurrentDetailSource = null;
  let qualidadeCurrentDetailIndex = null;
  let qualidadeDetailOriginal = {};
  let qualidadeDetailEdits = {};
  let qualidadeDetailEditingColumns = new Set();

  function formatQualidadeValue(value) {
    if (value === null || value === undefined) return '—';
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(formatQualidadeValue).join(', ');
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (_) {
        return String(value);
      }
    }
    return String(value);
  }

  function formatQualidadeLabel(key) {
    const custom = QUALIDADE_DETAIL_LABELS[key];
    if (custom) return custom;
    return key
      .split('_')
      .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
      .join(' ');
  }

  function buildQualidadeKeyValues(meta, raw) {
    const out = {};
    const keys = Array.isArray(meta?.keyColumns) ? meta.keyColumns : [];
    keys.forEach((col) => {
      const val = raw?.[col];
      if (val === null || val === undefined) return;
      const str = String(val).trim();
      if (!str) return;
      out[col] = val;
    });
    return out;
  }

  function buildQualidadeExtrasHtml(meta, entry) {
    if (typeof meta?.render === 'function') {
      return meta.render(entry);
    }
    const extrasConfig = Array.isArray(meta?.extras) ? meta.extras : [];
    const parts = [];
    extrasConfig.forEach((extra) => {
      const val = entry.raw?.[extra.field];
      if (val === null || val === undefined) return;
      const str = String(val).trim();
      if (!str) return;
      parts.push(
        `<span class="qualidade-extra-item"><span class="qualidade-extra-label">${escapeHtml(extra.label || '')}</span><span>${escapeHtml(formatQualidadeValue(val))}</span></span>`
      );
    });
    if (!parts.length && entry.match) {
      parts.push(`<span class="qualidade-extra-item"><span class="qualidade-extra-label">Código</span><span>${escapeHtml(formatQualidadeValue(entry.match))}</span></span>`);
    }
    return parts.length ? `<div class="qualidade-extra-list">${parts.join('')}</div>` : '';
  }

  function refreshQualidadeResultItem(sourceKey, index) {
    const cacheKey = `${sourceKey}:${index}`;
    const entry = qualidadeOsCache[cacheKey];
    if (!entry) return;
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    const listItem = document.querySelector(`.qualidade-result-item[data-source="${sourceKey}"][data-index="${index}"]`);
    if (!listItem) return;
    listItem.innerHTML = buildQualidadeExtrasHtml(meta, entry);
  }

  function updateQualidadeSaveState() {
    const saveBtn = qualidadeDetailSaveBtn;
    if (!saveBtn) return;
    const hasChanges = Object.keys(qualidadeDetailEdits).length > 0;
    saveBtn.disabled = !hasChanges;
    if (!hasChanges) saveBtn.textContent = 'Salvar alterações';
  }

  async function executeQualidadeOsSearch(term) {
    const feedbackEl = document.getElementById('qualidade-os-feedback');
    const resultsEl = document.getElementById('qualidade-os-results');
    if (!feedbackEl || !resultsEl) return;

    const trimmed = String(term || '').trim();
    if (!trimmed) {
      feedbackEl.textContent = 'Digite um código para buscar.';
      resultsEl.innerHTML = '';
      return;
    }

    // Coleta quais tabelas estão marcadas
    const checkboxes = document.querySelectorAll('#qualidade-sources-checkboxes input[type="checkbox"]:checked');
    const selectedSources = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedSources.length === 0) {
      feedbackEl.textContent = 'Selecione pelo menos uma tabela para pesquisar.';
      resultsEl.innerHTML = '';
      return;
    }

    const seq = ++qualidadeOsSearchSeq;
    feedbackEl.textContent = 'Buscando…';
    resultsEl.innerHTML = '';

    try {
      const sourcesParam = selectedSources.join(',');
      const resp = await fetch(`/api/qualidade/abertura-os/search?term=${encodeURIComponent(trimmed)}&sources=${encodeURIComponent(sourcesParam)}`, { credentials: 'include' });
      if (seq !== qualidadeOsSearchSeq) return;

      if (!resp.ok) {
        let message = `Falha ao pesquisar (${resp.status})`;
        try {
          const errPayload = await resp.json();
          if (errPayload?.error) message = errPayload.error;
        } catch {}
        feedbackEl.textContent = message;
        return;
      }

      const payload = await resp.json();
      if (seq !== qualidadeOsSearchSeq) return;
      renderQualidadeOsResults(payload);
    } catch (err) {
      if (seq !== qualidadeOsSearchSeq) return;
      console.error('[qualidade-os] falha na pesquisa', err);
      feedbackEl.textContent = `Erro ao buscar: ${err?.message || err}`;
    }
  }

  function renderQualidadeOsResults(payload) {
    const feedbackEl = document.getElementById('qualidade-os-feedback');
    const resultsEl = document.getElementById('qualidade-os-results');
    if (!feedbackEl || !resultsEl) return;

    if (!payload || payload.ok === false) {
      feedbackEl.textContent = payload?.error || 'Não foi possível obter os dados.';
      resultsEl.innerHTML = '';
      return;
    }

    Object.keys(qualidadeOsCache).forEach(k => delete qualidadeOsCache[k]);
    qualidadeOsCurrentGroups = {};
    qualidadeOsLastItemKey = null;
    qualidadeDetailEditingColumns.clear();

    const order = Array.isArray(payload?.order) && payload.order.length
      ? payload.order
      : QUALIDADE_OS_GROUPS.map(g => g.key);
    const results = payload?.results || {};

    let total = 0;
    const groupHtml = [];

    for (const key of order) {
      const groupData = results[key];
      const rows = Array.isArray(groupData?.rows) ? groupData.rows : [];
      if (!rows.length) continue;
      total += rows.length;
      const groupMeta = QUALIDADE_OS_GROUP_MAP[key] || {};
      const sourceMeta = QUALIDADE_SOURCE_META[key] || {};
      const label = groupData?.label || groupMeta.label || key;
      const subtitle = groupMeta.subtitle || groupData?.subtitle || '';
      qualidadeOsCurrentGroups[key] = { label, subtitle };
      const itemsHtml = rows.map((row, idx) => {
        const cacheKey = `${key}:${idx}`;
        const raw = row.raw || {};
        const entry = {
          raw,
          label,
          subtitle,
          match: row.match || '',
          keyValues: buildQualidadeKeyValues(sourceMeta, raw)
        };
        qualidadeOsCache[cacheKey] = entry;
        const extrasHtml = buildQualidadeExtrasHtml(sourceMeta, entry);
        const itemClasses = ['qualidade-result-item'];
        if (sourceMeta.disableDetail) itemClasses.push('is-static');
        const tabindexAttr = sourceMeta.disableDetail ? '' : 'tabindex="0"';
        return `<li class="${itemClasses.join(' ')}" data-source="${key}" data-index="${idx}" ${tabindexAttr}>${extrasHtml}</li>`;
      }).join('');
      groupHtml.push(`
        <div class="qualidade-result-group">
          <div class="qualidade-group-header">
            <div class="qualidade-group-title">
              ${escapeHtml(label)}
              ${subtitle ? `<span class="qualidade-group-sub">${escapeHtml(subtitle)}</span>` : ''}
            </div>
            <span class="qualidade-group-total">${rows.length} resultado(s)</span>
          </div>
          <ul class="qualidade-result-list">${itemsHtml}</ul>
        </div>`);
    }

    if (!total) {
      feedbackEl.textContent = 'Nenhum resultado encontrado.';
      resultsEl.innerHTML = '';
      return;
    }

    feedbackEl.textContent = `Localizamos ${total} registro(s).`;
    resultsEl.innerHTML = groupHtml.join('\n');
  }

  const qualidadeInputEl = document.getElementById('qualidade-os-input');
  const qualidadeButtonEl = document.getElementById('qualidade-os-search-btn');
  const qualidadeFeedbackEl = document.getElementById('qualidade-os-feedback');
  const menuQualidadeAbertura = document.getElementById('menu-qualidade-abertura-os');

  if (qualidadeFeedbackEl) qualidadeFeedbackEl.textContent = 'Digite um código para buscar.';

  const triggerQualidadeSearch = () => {
    if (qualidadeInputEl) executeQualidadeOsSearch(qualidadeInputEl.value);
  };

  qualidadeButtonEl?.addEventListener('click', (ev) => {
    ev.preventDefault();
    triggerQualidadeSearch();
  });

  qualidadeInputEl?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      triggerQualidadeSearch();
    }
  });

  // Botões de marcar/desmarcar todas as tabelas
  const selectAllBtn = document.getElementById('qualidade-select-all');
  const deselectAllBtn = document.getElementById('qualidade-deselect-all');
  const filterToggleBtn = document.getElementById('qualidade-filter-toggle');
  const filterCountEl   = document.getElementById('qualidade-filter-count');
  const sourcesContainer= document.getElementById('qualidade-sources-container');
  const sourcesBox      = document.getElementById('qualidade-sources-checkboxes');

  // ========== CONSULTAR EQUIPAMENTO (IAPP) ==========
  const iappConsultaInput = document.getElementById('iapp-consulta-input');
  const iappConsultaBtn = document.getElementById('iapp-consulta-btn');
  const iappConsultaFeedback = document.getElementById('iapp-consulta-feedback');
  const iappConsultaOutput = document.getElementById('iapp-consulta-output');

  async function executarConsultaIAPP() {
    const id = (iappConsultaInput?.value || '').trim();
    if (!id) {
      if (iappConsultaFeedback) iappConsultaFeedback.textContent = 'Por favor, informe um ID numérico.';
      if (iappConsultaOutput) iappConsultaOutput.textContent = '';
      return;
    }
    if (iappConsultaBtn) iappConsultaBtn.disabled = true;
    if (iappConsultaFeedback) iappConsultaFeedback.textContent = 'Consultando IAPP...';
    if (iappConsultaOutput) iappConsultaOutput.textContent = '';

    try {
      const r = await fetch(`/api/iapp/ordens-producao/busca/${encodeURIComponent(id)}`);
      const j = await r.json().catch(() => ({ raw: '<resposta não-JSON>' }));
      
      if (iappConsultaOutput) {
        iappConsultaOutput.textContent = JSON.stringify(j, null, 2);
      }
      
      if (j.ok && j.data?.success) {
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✓ Ordem encontrada: ${j.data.response?.identificacao || id}`;
      } else {
        const msg = j.data?.message || j.error || 'Erro desconhecido';
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `⚠ ${msg}`;
      }
    } catch (e) {
      if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✗ Erro: ${e.message}`;
      if (iappConsultaOutput) iappConsultaOutput.textContent = String(e);
    } finally {
      if (iappConsultaBtn) iappConsultaBtn.disabled = false;
    }
  }

  iappConsultaBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    executarConsultaIAPP();
  });

  iappConsultaInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      executarConsultaIAPP();
    }
  });

  // ========== LISTAR EQUIPAMENTOS (IAPP) ==========
  const iappListarBtn = document.getElementById('iapp-listar-btn');

  async function executarListagemIAPP() {
    if (iappListarBtn) iappListarBtn.disabled = true;
    if (iappConsultaFeedback) iappConsultaFeedback.textContent = 'Listando todas as OPs da IAPP...';
    if (iappConsultaOutput) iappConsultaOutput.textContent = '';

    try {
      // Chama endpoint /lista com offset=0 (obrigatório pela API IAPP)
      const r = await fetch('/api/iapp/ordens-producao/lista?offset=0');
      const j = await r.json().catch(() => ({ raw: '<resposta não-JSON>' }));
      
      if (iappConsultaOutput) {
        iappConsultaOutput.textContent = JSON.stringify(j, null, 2);
      }
      
      if (j.ok && j.data?.success) {
        const total = j.data.response?.length || 0;
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✓ ${total} ordens listadas`;
      } else {
        const msg = j.data?.message || j.error || 'Erro desconhecido';
        if (iappConsultaFeedback) iappConsultaFeedback.textContent = `⚠ ${msg}`;
      }
    } catch (e) {
      if (iappConsultaFeedback) iappConsultaFeedback.textContent = `✗ Erro: ${e.message}`;
      if (iappConsultaOutput) iappConsultaOutput.textContent = String(e);
    } finally {
      if (iappListarBtn) iappListarBtn.disabled = false;
    }
  }

  iappListarBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    executarListagemIAPP();
  });
  // ========== FIM LISTAR EQUIPAMENTOS ==========

  function updateQualidadeFilterCount() {
    if (!sourcesBox || !filterCountEl) return;
    const all = Array.from(sourcesBox.querySelectorAll('input[type="checkbox"]'));
    const sel = all.filter(cb => cb.checked).length;
    filterCountEl.textContent = `· ${sel}/${all.length} selecionadas`;
    if (filterToggleBtn && sourcesContainer) {
      const collapsed = sourcesContainer.classList.contains('is-collapsed');
      filterToggleBtn.textContent = collapsed ? 'Mostrar filtros' : 'Ocultar filtros';
      filterToggleBtn.setAttribute('aria-expanded', String(!collapsed));
      sourcesContainer.setAttribute('aria-hidden', String(collapsed));
    }
  }

  selectAllBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const checkboxes = document.querySelectorAll('#qualidade-sources-checkboxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = true);
    updateQualidadeFilterCount();
  });

  deselectAllBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    const checkboxes = document.querySelectorAll('#qualidade-sources-checkboxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    updateQualidadeFilterCount();
  });

  filterToggleBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!sourcesContainer) return;
    sourcesContainer.classList.toggle('is-collapsed');
    updateQualidadeFilterCount();
  });

  sourcesBox?.addEventListener('change', (ev) => {
    if (ev.target && ev.target.matches('input[type="checkbox"]')) {
      updateQualidadeFilterCount();
    }
  });

  // Inicializa contador
  updateQualidadeFilterCount();

  menuQualidadeAbertura?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuQualidadeAbertura.classList.add('is-active');
    showMainTab('qualidadeAberturaOsNova');
    // Foca no primeiro campo do formulário
    const clienteInput = document.getElementById('abertura-os-cliente');
    if (clienteInput) {
      setTimeout(() => clienteInput.focus(), 50);
    }
  });

  // Handler para o botão Consulta (ex-Consultar OS)
  const menuQualidadeConsultar = document.getElementById('menu-qualidade-consultar-os');
  menuQualidadeConsultar?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuQualidadeConsultar.classList.add('is-active');
    showMainTab('qualidadeConsultaOs');
    if (qualidadeInputEl) {
      setTimeout(() => qualidadeInputEl.focus(), 50);
    }
  });

  // Handler para o botão Consultar equipamento (IAPP)
  const menuQualidadeConsultarEquipamento = document.getElementById('menu-qualidade-consultar-equipamento');
  menuQualidadeConsultarEquipamento?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuQualidadeConsultarEquipamento.classList.add('is-active');
    showMainTab('qualidadeConsultarEquipamento');
    const iappInput = document.getElementById('iapp-consulta-input');
    if (iappInput) {
      setTimeout(() => iappInput.focus(), 50);
    }
  });

  const menuOmieAtualizar = document.getElementById('menu-omie-atualizar');
  menuOmieAtualizar?.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.left-side .side-menu a').forEach(a => a.classList.remove('is-active'));
    menuOmieAtualizar.classList.add('is-active');
    renderOmieSyncButtons();
    ensureOmieSyncBindings();
    showMainTab('omieAtualizarTabelas');
  });

  // Handlers para o formulário de Abertura de OS
  const aberturaOsLimparBtn = document.getElementById('abertura-os-limpar');
  const aberturaOsSalvarBtn = document.getElementById('abertura-os-salvar');
  
  aberturaOsLimparBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    // Limpa todos os campos do formulário
    document.getElementById('abertura-os-cliente').value = '';
    document.getElementById('abertura-os-produto').value = '';
    document.getElementById('abertura-os-descricao').value = '';
    document.getElementById('abertura-os-prioridade').value = 'media';
    // Foca no primeiro campo
    document.getElementById('abertura-os-cliente').focus();
  });

  aberturaOsSalvarBtn?.addEventListener('click', async (ev) => {
    ev.preventDefault();
    
    const cliente = document.getElementById('abertura-os-cliente').value.trim();
    const produto = document.getElementById('abertura-os-produto').value.trim();
    const descricao = document.getElementById('abertura-os-descricao').value.trim();
    const prioridade = document.getElementById('abertura-os-prioridade').value;

    // Validação básica
    if (!cliente || !produto || !descricao) {
      alert('Por favor, preencha todos os campos obrigatórios: Cliente, Produto e Descrição.');
      return;
    }

    try {
      // Aqui você pode implementar a lógica para salvar a OS
      // Por enquanto, apenas mostra uma mensagem de sucesso
      const novaOS = {
        cliente,
        produto,
        descricao,
        prioridade,
        dataAbertura: new Date().toISOString(),
        status: 'aberta'
      };

      console.log('Nova OS criada:', novaOS);
      alert(`OS criada com sucesso!\nCliente: ${cliente}\nProduto: ${produto}\nPrioridade: ${prioridade}`);
      
      // Limpa o formulário após salvar
      aberturaOsLimparBtn.click();
      
    } catch (error) {
      console.error('Erro ao criar OS:', error);
      alert('Erro ao criar a OS. Tente novamente.');
    }
  });

  const qualidadeResultsEl = document.getElementById('qualidade-os-results');
  const qualidadeDetailTitleEl = document.getElementById('qualidade-os-detail-title');
  const qualidadeDetailSubtitleEl = document.getElementById('qualidade-os-detail-subtitle');
  const qualidadeDetailMetaEl = document.getElementById('qualidade-os-detail-meta');
  const qualidadeDetailListEl = document.getElementById('qualidade-os-detail-list');
  const qualidadeDetailBackBtn = document.getElementById('qualidade-os-back');
  const qualidadeDetailSaveBtn = document.getElementById('qualidade-os-save');

  updateQualidadeSaveState();

  function openQualidadeOsDetail(sourceKey, index, options = {}) {
    const cacheKey = `${sourceKey}:${index}`;
    const cached = qualidadeOsCache[cacheKey];
    if (!cached) {
      alert('Registro não disponível. Refaça a busca.');
      return;
    }
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    if (meta.disableDetail) {
      return;
    }

    const reset = options.resetEdits !== false;
    qualidadeCurrentDetailSource = sourceKey;
    qualidadeCurrentDetailIndex = index;
    qualidadeOsLastItemKey = cacheKey;

    if (reset) {
      qualidadeDetailOriginal = { ...(cached.raw || {}) };
      qualidadeDetailEdits = {};
      qualidadeDetailEditingColumns = new Set();
      updateQualidadeSaveState();
    }

    if (options.editingColumn) {
      qualidadeDetailEditingColumns.add(options.editingColumn);
    }

    const keySet = new Set(meta.keyColumns || []);
    const hasKeys = keySet.size > 0 && Object.keys(cached.keyValues || {}).length > 0;
    const baseRaw = cached.raw || {};
    const mergedRaw = { ...baseRaw };
    Object.keys(qualidadeDetailEdits).forEach((col) => {
      mergedRaw[col] = qualidadeDetailEdits[col];
    });

    if (qualidadeDetailTitleEl) qualidadeDetailTitleEl.textContent = cached.label || 'Detalhes';
    if (qualidadeDetailSubtitleEl) qualidadeDetailSubtitleEl.textContent = cached.subtitle || '';
    if (qualidadeDetailMetaEl) qualidadeDetailMetaEl.textContent = cached.match ? `Código consultado: ${formatQualidadeValue(cached.match)}` : '';

    if (qualidadeDetailListEl) {
      const entries = Object.keys(baseRaw);
      const inner = entries.length
        ? entries.map((column) => {
            const displayLabel = formatQualidadeLabel(column);
            const pendingValue = mergedRaw[column];
            const displayValue = escapeHtml(formatQualidadeValue(pendingValue)).replace(/\n/g, '<br>');
            const isKey = keySet.has(column);
            const canEdit = hasKeys && !isKey;
            const isEditing = canEdit && qualidadeDetailEditingColumns.has(column);
            if (isEditing) {
              const textValue = Object.prototype.hasOwnProperty.call(qualidadeDetailEdits, column)
                ? (qualidadeDetailEdits[column] === null ? '' : String(qualidadeDetailEdits[column]))
                : (baseRaw[column] === null || baseRaw[column] === undefined ? '' : String(baseRaw[column]));
              const rows = Math.min(8, Math.max(3, textValue.split(/\r?\n/).length + 1));
              return `
                <div class="qualidade-detail-item is-editing" data-column="${column}" data-source="${sourceKey}" data-editable="${canEdit ? '1' : '0'}">
                  <div class="qualidade-detail-label">${escapeHtml(displayLabel)}</div>
                  <div class="qualidade-detail-editor">
                    <textarea class="qualidade-detail-input" rows="${rows}">${escapeHtml(textValue)}</textarea>
                    <div class="qualidade-detail-actions">
                      <button class="qualidade-detail-cancel" data-column="${column}">Cancelar</button>
                    </div>
                  </div>
                </div>`;
            }
            return `
              <div class="qualidade-detail-item" data-column="${column}" data-source="${sourceKey}" data-editable="${canEdit ? '1' : '0'}" ${canEdit ? 'tabindex="0"' : ''}>
                <div class="qualidade-detail-label">${escapeHtml(displayLabel)}</div>
                <div class="qualidade-detail-value">${displayValue}</div>
              </div>`;
          }).join('')
        : '<div class="qualidade-detail-empty">Nenhum dado disponível.</div>';
      qualidadeDetailListEl.innerHTML = inner;
    }

    updateQualidadeSaveState();
    showMainTab('qualidadeAberturaOsDetalhe');
  }

  function focusQualidadeResult(cacheKey) {
    if (!cacheKey) return;
    const [sourceKey, index] = cacheKey.split(':');
    const items = document.querySelectorAll('.qualidade-result-item');
    for (const el of items) {
      if (el.dataset.source === sourceKey && el.dataset.index === index) {
        el.focus();
        break;
      }
    }
  }

  qualidadeResultsEl?.addEventListener('click', (ev) => {
    const item = ev.target.closest('.qualidade-result-item');
    if (!item) return;
    const sourceKey = item.dataset.source || '';
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    if (meta.disableDetail) return;
    openQualidadeOsDetail(sourceKey, item.dataset.index || '', { resetEdits: true });
  });

  qualidadeResultsEl?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const item = ev.target.closest('.qualidade-result-item');
    if (!item) return;
    ev.preventDefault();
    const sourceKey = item.dataset.source || '';
    const meta = QUALIDADE_SOURCE_META[sourceKey] || {};
    if (meta.disableDetail) return;
    openQualidadeOsDetail(sourceKey, item.dataset.index || '', { resetEdits: true });
  });

  qualidadeDetailBackBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    qualidadeDetailEdits = {};
    qualidadeDetailEditingColumns.clear();
    updateQualidadeSaveState();
    qualidadeCurrentDetailSource = null;
    qualidadeCurrentDetailIndex = null;
    showMainTab('qualidadeConsultaOs'); // Corrigido: agora volta para o painel de consulta correto
    focusQualidadeResult(qualidadeOsLastItemKey);
  });

  qualidadeDetailListEl?.addEventListener('click', (ev) => {
    if (!qualidadeCurrentDetailSource) return;
    const btn = ev.target.closest('button');
    if (btn && btn.classList.contains('qualidade-detail-cancel')) {
      const column = btn.dataset.column;
      if (!column) return;
      qualidadeDetailEditingColumns.delete(column);
      delete qualidadeDetailEdits[column];
      updateQualidadeSaveState();
      openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false });
      return;
    }

    const item = ev.target.closest('.qualidade-detail-item');
    if (!item) return;
    const editable = item.dataset.editable === '1';
    const column = item.dataset.column;
    if (!editable || !column) return;
    if (item.classList.contains('is-editing')) return;
    qualidadeDetailEditingColumns.add(column);
    openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false, editingColumn: column });
    const textarea = qualidadeDetailListEl?.querySelector(`.qualidade-detail-item.is-editing[data-column="${column}"] .qualidade-detail-input`);
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
  });

  qualidadeDetailListEl?.addEventListener('keydown', (ev) => {
    if (!qualidadeCurrentDetailSource) return;
    if (ev.target.closest('.qualidade-detail-input')) return;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const item = ev.target.closest('.qualidade-detail-item');
    if (!item) return;
    const editable = item.dataset.editable === '1';
    const column = item.dataset.column;
    if (!editable || !column) return;
    ev.preventDefault();
    if (item.classList.contains('is-editing')) return;
    qualidadeDetailEditingColumns.add(column);
    openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false, editingColumn: column });
    const textarea = qualidadeDetailListEl?.querySelector(`.qualidade-detail-item.is-editing[data-column="${column}"] .qualidade-detail-input`);
    if (textarea) {
      textarea.focus();
      textarea.select();
    }
  });

  qualidadeDetailListEl?.addEventListener('input', (ev) => {
    if (!qualidadeCurrentDetailSource) return;
    const textarea = ev.target.closest('.qualidade-detail-input');
    if (!textarea) return;
    const item = textarea.closest('.qualidade-detail-item');
    if (!item) return;
    const column = item.dataset.column;
    if (!column) return;
    const original = qualidadeDetailOriginal[column];
    const originalStr = original === null || original === undefined ? '' : String(original);
    const newStr = textarea.value;
    if (newStr === originalStr) {
      delete qualidadeDetailEdits[column];
    } else {
      qualidadeDetailEdits[column] = newStr === '' ? null : newStr;
    }
    updateQualidadeSaveState();
  });

  async function saveAllQualidadeEdits() {
    if (!qualidadeCurrentDetailSource) return;
    const cacheKey = `${qualidadeCurrentDetailSource}:${qualidadeCurrentDetailIndex}`;
    const entry = qualidadeOsCache[cacheKey];
    if (!entry) {
      alert('Registro não disponível. Refaça a busca.');
      return;
    }

    const columns = Object.keys(qualidadeDetailEdits);
    if (!columns.length) return;

    if (!entry.keyValues || !Object.keys(entry.keyValues).length) {
      alert('Este registro não possui chave identificadora para edição.');
      return;
    }

    const saveBtn = qualidadeDetailSaveBtn;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando…';
    }

    const meta = QUALIDADE_SOURCE_META[qualidadeCurrentDetailSource] || {};
    let updatedRow = entry.raw;

    try {
      for (const column of columns) {
        const payloadValue = qualidadeDetailEdits[column];
        const resp = await fetch('/api/qualidade/abertura-os/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            source: qualidadeCurrentDetailSource,
            column,
            value: payloadValue,
            keyValues: entry.keyValues
          })
        });
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json?.ok) {
          throw new Error(json?.error || `Falha HTTP ${resp.status}`);
        }
        updatedRow = json.row || updatedRow;
        entry.raw = updatedRow;
        entry.keyValues = buildQualidadeKeyValues(meta, updatedRow);
        delete qualidadeDetailEdits[column];
        qualidadeDetailEditingColumns.delete(column);
      }

      qualidadeDetailOriginal = { ...updatedRow };
      qualidadeDetailEdits = {};
      qualidadeDetailEditingColumns.clear();
      updateQualidadeSaveState();
      openQualidadeOsDetail(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex, { resetEdits: false });
      refreshQualidadeResultItem(qualidadeCurrentDetailSource, qualidadeCurrentDetailIndex);
      alert('Alterações salvas com sucesso.');
    } catch (err) {
      alert(`Erro ao salvar: ${err?.message || err}`);
      if (saveBtn) {
        saveBtn.textContent = 'Salvar alterações';
        saveBtn.disabled = false;
      }
      updateQualidadeSaveState();
      return;
    }

    if (saveBtn) {
      saveBtn.textContent = 'Salvar alterações';
      saveBtn.disabled = true;
    }
    updateQualidadeSaveState();
  }

  qualidadeDetailSaveBtn?.addEventListener('click', (ev) => {
    ev.preventDefault();
    saveAllQualidadeEdits();
  });

  // Exibe o nome do usuário no elemento #userNameDisplay, se existir
// --- Login status helper ---
// --- Login status helper ---
async function renderUserName() {
  const el = document.getElementById('userNameDisplay');
  if (!el) return;

  const BASE = typeof window.API_BASE === 'string' ? window.API_BASE : '';

  try {
    const res = await fetch(`${BASE}/api/auth/status`, { credentials: 'include' });
    const js  = res.ok ? await res.json() : { loggedIn: false };

    if (js.loggedIn && js.user) {
      const nome = js.user.nome || js.user.username || js.user.login || 'Usuário';
      el.textContent = nome;
      el.classList.remove('is-ghost');
      setAuthGroupState(true);
    } else {
      el.textContent = '—';
      el.classList.add('is-ghost');
      try {
        localStorage.removeItem('auth_user');
        localStorage.removeItem('auth_user_name');
        sessionStorage.removeItem('auth_user');
        sessionStorage.removeItem('auth_user_name');
      } catch {}
      setAuthGroupState(false);
    }
  } catch {
    el.textContent = '—';
    el.classList.add('is-ghost');
    setAuthGroupState(false);
  }
}

// inicialização
document.addEventListener('DOMContentLoaded', () => {
  try {
    installAuthClickGuard(); // instala o bloqueio de clique
    renderUserName();        // e já define o estado inicial (logged / not logged)
  } catch {}
});

// quando login/logout acontecer, reavaliar
window.addEventListener('auth:changed', () => {
  try { renderUserName(); } catch {}
});


// chama na carga da página
document.addEventListener('DOMContentLoaded', () => {
  try { renderUserName(); } catch {}
});

// re-renderiza quando o login.js avisar mudanças de sessão
window.addEventListener('auth:changed', () => {
  try { renderUserName(); } catch {}
});


  const codeFilter = document.getElementById('codeFilter');
  const descFilter = document.getElementById('descFilter');

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


  // pega referências ao botão e ao painel de filtros
const filterBtn   = document.getElementById('filterBtn');
const filterPanel = document.getElementById('filterPanel');

filterBtn.addEventListener('click', e => {
  e.preventDefault();
  // alterna visibilidade
  const isOpen = filterPanel.classList.contains('is-open');
  if (isOpen) {
    filterPanel.classList.remove('is-open');
    filterPanel.style.display = 'none';
    return;
  }

  filterPanel.classList.add('is-open');
  filterPanel.style.display = 'flex';
});

function normalizaNumeroParaBR(val) {
  if (val === null || val === undefined || val === '') return '0,00';
  if (typeof val === 'number') return fmtBR.format(val);
  const num = Number(String(val).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? fmtBR.format(num) : '0,00';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  }[c]));
}

function sanitizeQtd(value, fallback = 1) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function formatQtdInput(value) {
  const num = sanitizeQtd(value);
  return Number.isInteger(num) ? String(num) : num.toString();
}

function updateTransferControlsState() {
  const transferBtn = document.getElementById('transferenciaBtn');
  const selectAllBtn = document.getElementById('transferSelectAllBtn');
  const totalItens = transferenciaLista.length;
  const selecionados = transferenciaLista.filter(i => i.selecionado !== false).length;

  if (transferBtn) {
    transferBtn.disabled = selecionados === 0;
  }
  if (selectAllBtn) {
    selectAllBtn.disabled = totalItens === 0;
    const state = (totalItens > 0 && selecionados === totalItens) ? 'all' : 'partial';
    selectAllBtn.dataset.state = state;
    let title = 'Selecionar todos os itens';
    if (totalItens === 0) {
      title = 'Nenhum item disponível para selecionar';
    } else if (state === 'all') {
      title = 'Desmarcar todos os itens';
    }
    selectAllBtn.title = title;
  }
}

function renderTransferenciaLista() {
  const tbody = document.getElementById('transferenciaTbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!transferenciaLista.length) {
    const tr = document.createElement('tr');
    tr.className = 'transferencia-placeholder';
    tr.innerHTML = '<td colspan="6">Nenhum item selecionado para transferência.</td>';
    tbody.appendChild(tr);
    updateTransferControlsState();
    return;
  }

  transferenciaLista.forEach(item => {
    const checked = item.selecionado !== false;
    item.qtd = sanitizeQtd(item.qtd);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="sel">
        <input type="checkbox"
               class="transfer-check"
               data-codigo="${item.codigo}"
               ${checked ? 'checked' : ''}>
      </td>
      <td>${item.codigo}</td>
      <td>${item.descricao}</td>
      <td class="qtd-cell"><input type="number" min="0" step="0.01" value="${formatQtdInput(item.qtd)}" data-codigo="${item.codigo}" class="transfer-qtd"></td>
      <td class="num">${item.fisico}</td>
      <td class="num">${item.saldo}</td>`;
    tbody.appendChild(tr);
  });

  updateTransferControlsState();
}

function adicionarItemTransferencia(item) {
  if (!item) return;
  const codigo = (item.codigo || '').trim();
  if (!codigo) return;

  const normalizado = {
    codigo,
    descricao: (item.descricao || '').trim(),
    min: normalizaNumeroParaBR(item.min),
    fisico: normalizaNumeroParaBR(item.fisico),
    saldo: normalizaNumeroParaBR(item.saldo),
    cmc: normalizaNumeroParaBR(item.cmc),
    selecionado: true,
    qtd: sanitizeQtd(item.qtd ?? 1)
  };

  const idx = transferenciaLista.findIndex(i => i.codigo === codigo);
  if (idx >= 0) {
    const anterior = transferenciaLista[idx];
    transferenciaLista[idx] = {
      ...anterior,
      ...normalizado,
      qtd: sanitizeQtd(anterior?.qtd ?? normalizado.qtd),
      selecionado: true
    };
    transferenciaItem = transferenciaLista[idx];
  } else {
    transferenciaLista.push(normalizado);
    transferenciaItem = normalizado;
  }
  renderTransferenciaLista();
}

function onAlmoxRowClick(ev) {
  const tr = ev.target.closest('tr');
  if (!tr || !tr.dataset || !tr.dataset.codigo) return;

  transferenciaItem = {
    codigo:    tr.dataset.codigo || '',
    descricao: tr.dataset.descricao || '',
    min:       tr.dataset.min || '0,00',
    fisico:    tr.dataset.fisico || '0,00',
    saldo:     tr.dataset.saldo || '0,00',
    cmc:       tr.dataset.cmc || '0,00',
    qtd:       1
  };

  adicionarItemTransferencia(transferenciaItem);
  showArmazemTab('transferencia');
}


  // === HOME – Preparação elétrica =========================
document.getElementById('btn-prep-eletrica')?.addEventListener('click', e => {
  e.preventDefault();                 // não siga o href
  window.location.href = 'preparacao_eletrica.html';  // carrega a nova página
});


  // ATALHO ÚNICO: abre aba cacheada + carrega cache EM UM SÓ CLIQUE

   const btnCache = document.getElementById('btn-omie-list1')
                  || document.getElementById('btn-omie-list');
  console.log('[DEBUG] btnCache encontrado em DOMContentLoaded:', btnCache);
if (btnCache) {
btnCache.addEventListener('click', async e => {
  e.preventDefault();
  hideKanban();
  if (typeof hideArmazem === 'function') hideArmazem();
  const armTabsEl = document.getElementById('armazemTabs');
  const armContentEl = document.getElementById('armazemContent');
  if (armTabsEl) armTabsEl.style.display = 'none';
  if (armContentEl) armContentEl.style.display = 'none';
  document
    .querySelectorAll('#armazemContent .armazem-page')
    .forEach(p => (p.style.display = 'none'));

  // 1) esconde todas as panes e mostra só o painel de produtos
  document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  document.getElementById('listaProdutos').style.display = 'block';

  // 2) remove destaque e destaca o menu lateral
  document.querySelector('.main-header').style.display = 'none';
  document.querySelectorAll('.side-menu a').forEach(a => a.classList.remove('is-active'));
  btnCache.classList.add('is-active');

  // 3) carrega toda a lista usando o cache e filtros já testados
  console.log('[DEBUG] iniciando initListarProdutosUI…');
  await initListarProdutosUI('listaProdutos', 'listaProdutosList');
  console.log('[DEBUG] initListarProdutosUI completo');

  // === [B] Clique em um produto da lista -> abre "Dados do produto" ===
(function bindOpenFromListOnce(){
  const ul = document.getElementById('listaProdutosList');
  if (!ul || ul.__boundOpenProduto) return;   // evita duplicar
  ul.__boundOpenProduto = true;

  ul.addEventListener('click', (ev) => {
    // 1) tenta achar um LI com data-codigo
    const li = ev.target.closest('li[data-codigo]');
    // 2) se não tiver, tenta um botão/ancora com data-codigo
    const btn = li ? null : ev.target.closest('[data-codigo]');
    const el  = li || btn;
    if (!el) return;

    const codigo = String(el.dataset.codigo || '').trim();
    if (!codigo) return;

    // abre a UI do produto no fluxo padrão
    window.openProdutoPorCodigo(codigo);
  });
})();

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
if (link.id !== 'menu-armazens') hideArmazem();

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
      
} else if (link.id === 'menu-inicio') {

  /* 1) fecha Kanban e Armazéns, se abertos */
  hideKanban();
  hideArmazem();

  /* 2) esconde todas as outras seções */
  document.querySelectorAll('.tab-pane, .kanban-page')
          .forEach(p => p.style.display = 'none');
  document.getElementById('produtoTabs').style.display  = 'none';
  document.getElementById('kanbanTabs').style.display   = 'none';
  document.getElementById('armazemTabs').style.display  = 'none';
const mh = document.querySelector('.main-header');
if (mh) mh.style.display = 'none';


  /* 3) mostra a Home com os 6 botões */
  showMainTab('paginaInicio');

  /* 4) mantém o link Início destacado */
  headerLinks.forEach(a => a.classList.remove('is-active'));
  link.classList.add('is-active');

  /* 5) garante que a sidebar esteja visível */
  document.querySelector('.left-side')?.classList.remove('is-hidden');
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


// ─── Sub-abas unificadas em Dados do produto ───
const subTabLinks = document.querySelectorAll(
  '#dadosProduto .sub-tabs .main-header-link'
);
subTabLinks.forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    // 1) destaco só este link
    subTabLinks.forEach(l => l.classList.remove('is-active'));
    link.classList.add('is-active');
    // 2) escondo todos os sub-conteúdos
    document
      .querySelectorAll('#dadosProduto .sub-content')
      .forEach(sec => (sec.style.display = 'none'));
    // 3) mostro só o target correto
    const alvoId = link.dataset.subtarget;            // ex: "detalhesTab"
    const alvoEl = document.getElementById(alvoId);
    if (!alvoEl) return console.error(`Sub-aba "${alvoId}" não existe`);
    alvoEl.style.display = 'block';
    console.log(`[Sub-aba] exibindo "${alvoId}"`);
  });
});

// forço, ao abrir Dados do produto, a sub-aba “Detalhes”
const detalhesInicial = document.querySelector(
  '#dadosProduto .sub-tabs .main-header-link[data-subtarget="detalhesTab"]'
);
if (detalhesInicial) detalhesInicial.click();

// Ao carregar, parte da Home → oculta abas internas de Produto
const prodHeader = document.querySelector('#produtoTabs .main-header');
if (prodHeader) prodHeader.style.display = 'none';
document.getElementById('produtoTabs').style.display = 'none';



  // … quaisquer outras inicializações finais …
  initDadosColaboradoresUI();
  initAnexosUI();
});  // <--- aqui fecha o DOMContentLoaded


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


/* ------------------------------------------------------------ *
 *  Mostra uma sub-aba do Kanban                                *
 *  nome = comercial | pcp | preparacao | producao | detalhes   *
 * ------------------------------------------------------------ */
function showKanbanTab(nome) {

  /* 1) destaca o link ativo na barra -------------------------- */
  document.querySelectorAll('#kanbanTabs .main-header-link')
    .forEach(a => a.classList.toggle('is-active',
                                     a.dataset.kanbanTab === nome));

  /* 2) exibe só o painel correspondente ----------------------- */
  document.querySelectorAll('#kanbanContent .kanban-page')
    .forEach(p =>
      p.style.display = (p.id === `conteudo-${nome}` ? 'block' : 'none')
    );

  /* 3) carrega / atualiza as colunas da aba escolhida ---------- */
if (nome === 'comercial')       KanbanViews.renderKanbanComercial?.();
else if (nome === 'pcp') {
  // Garante visibilidade do painel PCP
  const pcpPane = document.getElementById('conteudo-pcp');
  if (pcpPane) pcpPane.style.display = 'block';
setTimeout(compactPCPFilters, 80);

  // (opcional) Se existir um "render" da sua camada Kanban, deixamos rodar depois:
  try { KanbanViews.renderKanbanPCP?.(); } catch (_) {}
}

else if (nome === 'preparacao') initPreparacaoKanban();
else if (nome === 'producao')   KanbanViews.renderKanbanProducao?.();
else if (nome === 'detalhes')   KanbanViews.renderKanbanDetalhes?.();



  /* 4) guarda a última aba visitada --------------------------- */
  lastKanbanTab = nome;
}

/* ------------------------------------------------------------ *
 *  Listeners da barra “Comercial | PCP | …”                    *
 * ------------------------------------------------------------ */
document.querySelectorAll('#kanbanTabs .main-header-link')
  .forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();                    // cancela o href
      hideArmazem();                         // oculta abas de estoque
      const alvo = link.dataset.kanbanTab;   // comercial / pcp / …
      showKanbanTab(alvo);                   // exibe sub-kanban
    });
  });
/* Autoabrir PCP se a URL já vier com #pcp */
(function autoOpenPCPFromHash(){
  try {
    if (String(location.hash).toLowerCase().includes('pcp')) {
      // abre o quadro Kanban e ativa a sub-aba PCP
      showKanban();
      // vindo da COMERCIAL: define o código vencedor para a PCP
window.setPCPProdutoCodigo?.(codigo);   // 'codigo' é o do item clicado na Comercial

      showKanbanTab('pcp'); // isso já dispara ensurePCPEstruturaAutoLoad()
    }
  } catch {}
})();



// ---------- MENU RESPONSIVO ----------
const header   = document.getElementById('appHeader');   // <div class="header">
const menu     = document.getElementById('mainMenu');    // <nav …>

document.addEventListener('DOMContentLoaded', () => {
  if (window.inicializarImportacaoCaracteristicas)
       window.inicializarImportacaoCaracteristicas();
});

// quando clicar na sub-aba "Estrutura de produto"
document.querySelector('#produto-tabs [data-subtab="estrutura"]')?.addEventListener('click', () => {
  const codigo =
    // 1) algum elemento que mostra o código na área "Dados do produto"
    document.querySelector('#dados-produto .produto-codigo')?.textContent?.trim()
    // 2) ou algo global que você já usa
    || window.codigoProdutoAtual
    || window.prepCodigoSelecionado
    || '';
  if (codigo) {
    window.loadEstruturaProduto(codigo);
  }
});

// ========== Abrir Produto por código (força a guia Produto/Dados do produto) ==========
window.openProdutoPorCodigo = async function openProdutoPorCodigo(codigo) {
  try {
    // 1) mostra o bloco de produto e esconde as outras páginas
    const prodTabs   = document.getElementById('produtoTabs');
    const inicioPane = document.getElementById('paginaInicio');
    if (inicioPane)  inicioPane.style.display = 'none';
    if (prodTabs)    prodTabs.style.display   = 'block';

    // 2) ativa a aba principal "Dados do produto"
    document.querySelectorAll('#produtoTabs .main-header .main-header-link')
      .forEach(a => a.classList.remove('is-active'));
    const linkDados = document.querySelector('#produtoTabs .main-header .main-header-link[data-target="dadosProduto"]');
    if (linkDados) linkDados.classList.add('is-active');

    // mostra apenas o painel de dados
    document.querySelectorAll('#produtoTabs .tab-content .tab-pane').forEach(p => p.style.display = 'none');
    const paneDados = document.getElementById('dadosProduto');
    if (paneDados) paneDados.style.display = 'block';

    // 3) guarda global (o resto da UI já usa essa variável)
    window.codigoSelecionado = (codigo || '').trim();

    // 4) dispara o carregamento normal dos “Dados do produto”
    if (typeof window.loadDadosProduto === 'function') {
      await window.loadDadosProduto(codigo);
    }

    // 5) não carrega estrutura aqui; deixamos o clique da sub-aba disparar (ver passo 3)
  } catch (e) {
    console.warn('[openProdutoPorCodigo]', e);
  }
};

// ========== Interceptar navegadores antigos para "Início" ==========
(function interceptarNavigateToDetalhes() {
  const prev = window.navigateToDetalhes;
  window.navigateToDetalhes = function patchedNavigateToDetalhes(target, codigo) {
    // se vierem pedindo "iniciar" com código, redireciona para Produto
    if (codigo && (String(target).toLowerCase() === 'iniciar' || String(target).toLowerCase() === 'inicio')) {
      return window.openProdutoPorCodigo(codigo);
    }
    if (typeof prev === 'function') return prev(target, codigo);
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// Estrutura de produto (render por grupos de Operação)
// - Busca a estrutura via API (/api/pcp/estrutura)
// - Agrupa por comp_operacao e renderiza blocos (categoria) com contador
// - A COLUNA "Operação" foi REMOVIDA da grade (fica só no título do grupo)
// - Atualiza "Estrutura de produto (x)" só dentro de #estruturaProduto (sem varrer a página)
// ─────────────────────────────────────────────────────────────────────────────
window.loadEstruturaProduto = async function loadEstruturaProduto(codigo) {
  const ul = document.querySelector('#estruturaProduto #malha');
  if (!ul) return;

  const cod = (codigo || window.codigoSelecionado || '').trim();

  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Atualiza o contador "Estrutura de produto (x)" SOMENTE dentro de #estruturaProduto
  const setEstruturaCount = (n) => {
    const root = document.getElementById('estruturaProduto') || document.querySelector('#estruturaProduto');
    if (!root) return;

    // 1) Elemento dedicado (se existir)
    const badge = root.querySelector('[data-estrutura-count], #estruturaCount, .estrutura-count');
    if (badge) { badge.textContent = String(n); return; }

    // 2) Algum heading DENTRO da seção com o texto "Estrutura de produto"
    const heads = root.querySelectorAll('h1,h2,h3,.section-title,.titulo,.header-title');
    for (const el of heads) {
      const txt = (el.textContent || '').trim();
      if (!/estrutura de produto/i.test(txt)) continue;

      if (/\(\s*\d+\s*\)$/.test(txt)) {
        const base = txt.replace(/\s*\(\s*\d+\s*\)\s*$/, '');
        el.textContent = `${base} (${n})`;
      } else {
        const span = document.createElement('span');
        span.className = 'estrutura-count';
        span.style.marginLeft = '6px';
        span.textContent = `(${n})`;
        el.appendChild(span);
      }
      return;
    }

    // 3) Sem fallback fora da seção para não destruir a página
    console.debug('[Estrutura][count] Sem alvo dedicado para mostrar o número.');
  };

  // header inicial (SEM coluna "Operação")
  ul.innerHTML = `
  <li class="header-row">
    <div>Código</div><div>Descrição</div><div>QTD</div>
    <div>Unidade</div><div>Custo real</div><div>Ações</div>
  </li>
    <li><div style="opacity:.7">${cod ? `Carregando estrutura de ${esc(cod)}…` : 'Selecione um produto.'}</div></li>
  `;
  if (!cod) { setEstruturaCount(0); return; }

  // Atualiza badges de versão/modificador após exibir placeholder
  if (typeof pcpUpdateVersaoBadges === 'function') {
    try {
      const meta = await pcpFetchEstruturaMetaByCod(cod);
      pcpUpdateVersaoBadges(meta);
    } catch (metaErr) {
      console.warn('[Estrutura] Não foi possível carregar meta (versão/modificador):', metaErr);
      pcpUpdateVersaoBadges(null);
    }
  }

  const norm = (s) => (s ?? '').toString().trim();
  const labelOper = (s) => (norm(s) || 'SEM OPERAÇÃO');

  try {
    // busca a estrutura (API já devolve comp_operacao)
    const r = await fetch('/api/pcp/estrutura?pai_codigo=' + encodeURIComponent(cod), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const j = await r.json();
    const dados = Array.isArray(j?.dados) ? j.dados : [];

    const frag = document.createDocumentFragment();

    // cabeçalho fixo (SEM "Operação")
    const head = document.createElement('li');
    head.className = 'header-row';
    head.innerHTML = `
      <div>Código</div><div>Descrição</div><div>QTD</div>
      <div>Unidade</div><div>Custo real</div><div>Ações</div>`;
    frag.appendChild(head);

    if (!dados.length) {
      const li = document.createElement('li');
      li.innerHTML = `<div style="opacity:.7">Estrutura de produto (${esc(cod)}) vazia.</div>`;
      frag.appendChild(li);
      setEstruturaCount(0);
    } else {
      // — agrupa por Operação —
      const grupos = new Map();
      for (const r of dados) {
        const key = labelOper(r.comp_operacao);
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(r);
      }

      // — ordena grupos: BASE e HIGIENIZAÇÃO primeiro; SEM OPERAÇÃO por último; resto alfabético —
      const prio = new Map([['BASE', -2], ['HIGIENIZAÇÃO', -1], ['HIGIENIZACAO', -1], ['SEM OPERAÇÃO', 999]]);
      const opsOrdenadas = Array.from(grupos.keys()).sort((a,b) => {
        const pa = prio.get(a.toUpperCase()) ?? 0;
        const pb = prio.get(b.toUpperCase()) ?? 0;
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b, 'pt-BR');
      });

      // — render: cabeçalho de grupo + linhas (6 colunas) —
      for (const opNome of opsOrdenadas) {
        const arr = grupos.get(opNome);

        // cabeçalho do grupo
        const cat = document.createElement('li');
        cat.className = 'category-header';
        cat.innerHTML = `
          <div class="left">
            ${esc(opNome)} <span class="badge">(${arr.length})</span>
          </div>
          <div class="right"></div>
        `;
        frag.appendChild(cat);

        // linhas do grupo
        for (const row of arr) {
          const li = document.createElement('li');
          li.dataset.comp = row.comp_codigo || '';
          li.innerHTML = `
            <div>${esc(row.comp_codigo || '')}</div>
            <div class="desc" title="${esc(row.comp_descricao || '')}">${esc(row.comp_descricao || '')}</div>
            <div>${Number(row.comp_qtd || 0)}</div>
            <div>${esc(row.comp_unid || '')}</div>
            <div>—</div>
            <div class="acoes">
              <!-- Trocar -->
              <button type="button" class="icon-btn" data-action="trocar" title="Trocar" aria-label="Trocar">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 7h10"></path><path d="M14 4l3 3-3 3"></path><path d="M17 17H7"></path><path d="M10 20l-3-3 3-3"></path></svg>
              </button>
              <!-- Abrir -->
              <button type="button" class="icon-btn" data-action="abrir" title="Abrir" aria-label="Abrir">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 3L10 14"></path><path d="M5 7v12h12"></path></svg>
              </button>
              <!-- Estrutura -->
              <button type="button" class="icon-btn" data-action="estrutura" title="Estrutura" aria-label="Estrutura">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <circle cx="6"  cy="6"  r="2"></circle>
                  <circle cx="18" cy="6"  r="2"></circle>
                  <circle cx="18" cy="12" r="2"></circle>
                  <circle cx="18" cy="18" r="2"></circle>
                  <path d="M8 6h8"></path><path d="M8 6v12"></path>
                  <path d="M14 12h4"></path><path d="M14 18h4"></path>
                </svg>
              </button>
            </div>`;
          frag.appendChild(li);
        }
      }

      // total de itens (todas as linhas)
      setEstruturaCount(dados.length);
    }

    ul.replaceChildren(frag);

    // mantém delegações existentes e marca ícones "Estrutura" quando houver filhos
    ensureEstruturaDelegation();
    await markEstruturaButtons(ul);

  } catch (e) {
    console.error('[loadEstruturaProduto]', e);
    ul.innerHTML = `
      <li class="header-row">
        <div>Código</div><div>Descrição</div><div>QTD</div>
        <div>Unidade</div><div>Custo real</div><div>Ações</div>
      </li>
      <li><div style="color:#ef4444">Falha ao carregar estrutura.</div></li>`;
    setEstruturaCount(0);
  }
};




// ————————————————————————————————————————————————————————————————
// Delegação: Abrir (dados), Estrutura (expand/collapse), Trocar (editor 1-campo)
// ————————————————————————————————————————————————————————————————
let __estruturaDelegationBound = false;
function ensureEstruturaDelegation() {
  if (__estruturaDelegationBound) return;
  const root = document.querySelector('#estruturaProduto #malha');
  if (!root) return;

  root.addEventListener('click', async (ev) => {
    const btnAbrir  = ev.target.closest('.icon-btn[data-action="abrir"], .button-wrapper .content-button.open');
    const btnEstr   = ev.target.closest('.icon-btn[data-action="estrutura"]');
    const btnTrocar = ev.target.closest('.icon-btn[data-action="trocar"]');
    const row       = ev.target.closest('li');
    if (!row) return;

    const codigo = (row.dataset.comp || row.querySelector(':scope > div:first-child')?.textContent || '').trim();
    if (!codigo) return;

    // ——— Abrir ———
    if (btnAbrir) {
      try {
        if (typeof window.openProdutoPorCodigo === 'function') return void window.openProdutoPorCodigo(codigo);
        if (typeof window.navigateToDetalhes === 'function')   return void window.navigateToDetalhes('iniciar', codigo);
        document.querySelectorAll('.tab-pane').forEach(p => { if (p && p.style) p.style.display = 'none'; });
        document.querySelectorAll('.main-header-link').forEach(l => l.classList.remove('is-active'));
        const tabBtn = document.querySelector('.main-header-link[data-target="dadosProduto"]'); if (tabBtn) tabBtn.classList.add('is-active');
        const pane   = document.getElementById('dadosProduto'); if (pane && pane.style) pane.style.display = 'block';
        const header = document.querySelector('.main-header');  if (header && header.style) header.style.display = 'flex';
        window.codigoSelecionado = codigo;
        if (typeof window.loadDadosProduto === 'function') await window.loadDadosProduto(codigo);
      } catch (err) { console.error('[Abrir] falha:', err); }
      return;
    }

    // ——— Estrutura ———
    if (btnEstr) { await toggleEstruturaInline(row, codigo, root); return; }

// ——— Trocar ——— (usa o MESMO painel da PCP)
if (btnTrocar) {
  const next = row.nextElementSibling;
  // fecha se já estiver aberto (antigo "swap-row" ou o novo "pcp-troca")
  if (next && (next.classList.contains('pcp-troca') || next.classList.contains('swap-row'))) {
    next.remove();
    return;
  }
  try {
    await pcpToggleTrocaProduto(row, codigo); // ← mesmo painel/UX da PCP
  } catch (e) {
    console.warn('[Estrutura] Troca falhou:', e);
  }
  return;
}

  });

  __estruturaDelegationBound = true;
}

// ——— Editor inline de Troca (1 campo unificado com highlight) ———
function renderSwapEditorOneField(row, codigoAntigo) {
  // local debouncer (evita colisões globais)
  const __debounceLocal = (fn, ms = 220) => { let h; return (...args) => { clearTimeout(h); h = setTimeout(() => fn(...args), ms); }; };

  const li = document.createElement('li');
  li.className = 'swap-row';

  const pai = (window.codigoSelecionado || '').trim(); // produto pai aberto

  li.innerHTML = `
    <div style="grid-column: 1 / 3">
      <label class="swap-label">Pesquisar código ou descrição</label>
      <input type="text" class="swap-input swap-q" placeholder="Digite um código (ex: FTI185LPTBR) ou palavras (ex: BOMBA DE CALOR, TRIFASICA 380V)..." />
    </div>
    <div></div><div></div><div></div>
    <div class="swap-actions">
      <button type="button" class="swap-btn swap-cancelar">Cancelar</button>
    </div>
    <div class="swap-results" style="display:none;">
      <ul></ul>
    </div>
  `;

  row.after(li);

  const inpQ  = li.querySelector('.swap-q');
  const box   = li.querySelector('.swap-results');
  const ulRes = li.querySelector('.swap-results ul');
  const btnCanc = li.querySelector('.swap-cancelar');

  const doSearch = async () => {
    const q = (inpQ.value || '').trim();
    if (!q) { box.style.display = 'none'; ulRes.innerHTML = ''; return; }

    const resultados = await searchProdutosQuery(q, 30);
    ulRes.innerHTML = '';

    if (!resultados.length) {
      box.style.display = 'block';
      ulRes.innerHTML = `<li><div class="codigo">—</div><div class="descricao">Nenhum resultado.</div></li>`;
      return;
    }

    const tokens = tokenize(q);
    for (const it of resultados) {
      const liRes = document.createElement('li');
      const codHi = highlightTokens(escapeHtml(it.codigo||''), tokens);
      const desHi = highlightTokens(escapeHtml(it.descricao||''), tokens);
      liRes.innerHTML = `
        <div class="codigo">${codHi}</div>
        <div class="descricao" title="${escapeHtml(it.descricao||'')}">${desHi}</div>`;
      liRes.addEventListener('click', async () => {
        liRes.style.opacity = '.6';
        try {
          await trocarItemEstrutura({ pai_codigo: pai, de_codigo: codigoAntigo, para_codigo: it.codigo });
          // reload da estrutura do pai e fecha editor
          if (typeof window.loadEstruturaProduto === 'function') await window.loadEstruturaProduto(pai);
        } catch (e) {
          console.error('[Trocar] erro ao trocar:', e);
          alert('Falha ao trocar item na estrutura.');
          liRes.style.opacity = '1';
        }
      });
      ulRes.appendChild(liRes);
    }
    box.style.display = 'block';
  };

  const debounced = __debounceLocal(doSearch, 220);
  inpQ.addEventListener('input', debounced);
  btnCanc.addEventListener('click', () => li.remove());
  setTimeout(() => inpQ && inpQ.focus(), 0);
}

// ——— Busca unificada (usa funções do projeto se existirem; senão 1–2 endpoints) ———
async function searchProdutosQuery(query, limit = 30) {
  const q = String(query || '').trim();
  const tokens = tokenize(q.toLowerCase());

  // 1) Usa a Lista de produtos já carregada (DOM) ou tenta carregá-la
  const base = await ensureProdutosCacheFromLista();
  if (Array.isArray(base) && base.length) {
    let items = base;
    if (tokens.length) {
      items = items.filter(it => {
        const c = (it.codigo || '').toLowerCase();
        const d = (it.descricao || '').toLowerCase();
        return tokens.every(t => c.includes(t) || d.includes(t));
      });
    }
    return items.slice(0, limit);
  }

  // 2) Se você tem buscadores globais prontos, usa eles
  if (typeof window.buscarProdutos === 'function') {
    try {
      const r = await window.buscarProdutos({ query: q, q, descricao: q, codigo: q, limit });
      if (Array.isArray(r) && r.length) return normalizeProdutos(r).slice(0, limit);
    } catch {}
  }
  if (typeof window.searchProdutos === 'function') {
    try {
      const r = await window.searchProdutos({ query: q, q, descricao: q, codigo: q, limit });
      if (Array.isArray(r) && r.length) return normalizeProdutos(r).slice(0, limit);
    } catch {}
  }

  // 3) Último recurso: se sua Lista usa Omie, puxa um lote e filtra localmente (mantém seu fallback)
  try {
    if (typeof API_BASE !== 'undefined' && typeof OMIE_APP_KEY !== 'undefined') {
      const res = await fetch(`${API_BASE}/api/omie/produtos`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call:       'ListarProdutosResumido',
          app_key:    OMIE_APP_KEY,
          app_secret: OMIE_APP_SECRET,
          param: [{ pagina: 1, registros_por_pagina: 500, filtrar_apenas_descricao: '' }]
        })
      });
      if (res.ok) {
        const j = await res.json();
        let arr = Array.isArray(j?.produto_servico_resumido) ? j.produto_servico_resumido
                 : (Array.isArray(j?.dados) ? j.dados
                 : (Array.isArray(j?.items) ? j.items : []));
        let items = normalizeProdutos(arr);
        if (tokens.length) {
          items = items.filter(it => {
            const c = (it.codigo || '').toLowerCase();
            const d = (it.descricao || '').toLowerCase();
            return tokens.every(t => c.includes(t) || d.includes(t));
          });
        }
        return items.slice(0, limit);
      }
    }
  } catch {}

  return [];
}


function normalizeProdutos(arr){
  return arr.map(x => ({
    codigo: x.codigo || x.cod || x.cod_produto || x.PRO_COD || x.id || '',
    descricao: x.descricao || x.nome || x.PRO_DES || x.desc || ''
  })).filter(x => x.codigo);
}

// ——— utils: tokens, highlight, debounce, escape ———
function tokenize(q){ return (q||'').trim().split(/\s+/).filter(Boolean); }
function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlightTokens(escapedText, tokens){
  if (!tokens.length) return escapedText;
  const pattern = tokens.map(t => escapeRegex(t)).join('|');
  return escapedText.replace(new RegExp(pattern, 'gi'), m => `<mark class="hi">${m}</mark>`);
}
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }


// UI: expand/collapse da sub-estrutura com “grupo visual” próprio
// - Adiciona uma linha-cabeçalho (child-group-header) antes das child-row
// - Remove header + filhos ao colapsar
// - Mantém grade/ações existentes
async function toggleEstruturaInline(row, codigo, root) {
  const ancestorPrefix = ((row.dataset.ancestor ? row.dataset.ancestor + '>' : '') + codigo);

  // 1) Se já estiver aberto: remove header + todas as child-row do mesmo ancestorPrefix
  {
    let it = row.nextElementSibling, removed = false;
    while (it && (it.classList.contains('child-row') || it.classList.contains('child-group-header'))) {
      const anc = it.dataset.ancestor || '';
      if (anc.startsWith(ancestorPrefix)) {
        const nxt = it.nextElementSibling;
        it.remove();
        it = nxt;
        removed = true;
        continue;
      }
      break;
    }
    if (removed) return; // colapsou
  }

  // 2) Carrega filhos do item clicado
  let dados = [];
  try {
    const r = await fetch('/api/pcp/estrutura?pai_codigo=' + encodeURIComponent(codigo), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const j = await r.json();
    dados = Array.isArray(j?.dados) ? j.dados : [];
  } catch (err) {
    console.error('[sub-estrutura] fetch', err);
  }
  if (!dados.length) return;

  const esc = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const parentPath = ancestorPrefix;

  // 3) Header visual do grupo (destaca que é a estrutura DO item clicado)
  const header = document.createElement('li');
  header.className = 'child-group-header';
  header.dataset.ancestor = parentPath;
  header.innerHTML = `
    <!-- Cabeçalho da sub-lista (ocupa a linha toda) -->
    <div class="child-group-title" title="Estrutura de ${esc(codigo)}">
      <span class="pip"></span>
      Estrutura de <strong>${esc(codigo)}</strong>
    </div>
  `;
  row.after(header);

  // 4) Linhas filhas (mesma grade, porém com estilo “child-row” diferenciado)
  let anchor = header;
  for (let idx = 0; idx < dados.length; idx++) {
    const d = dados[idx];
    const li2 = document.createElement('li');
    li2.className = 'child-row' + (idx === 0 ? ' child-first' : '') + (idx === dados.length - 1 ? ' child-last' : '');
    li2.dataset.comp = d.comp_codigo || '';
    li2.dataset.ancestor = parentPath;
    li2.innerHTML = `
      <div>${esc(d.comp_codigo || '')}</div>
      <div class="desc" title="${esc(d.comp_descricao || '')}">${esc(d.comp_descricao || '')}</div>
      <div>${Number(d.comp_qtd || 0)}</div>
      <div>${esc(d.comp_unid || '')}</div>
      <div>—</div>
      <div class="acoes">
        <!-- Trocar -->
        <button type="button" class="icon-btn" data-action="trocar" title="Trocar" aria-label="Trocar">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 7h10"></path><path d="M14 4l3 3-3 3"></path><path d="M17 17H7"></path><path d="M10 20l-3-3 3-3"></path></svg>
        </button>
        <!-- Abrir -->
        <button type="button" class="icon-btn" data-action="abrir" title="Abrir" aria-label="Abrir">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M14 3h7v7"></path><path d="M21 3L10 14"></path><path d="M5 7v12h12"></path></svg>
        </button>
        <!-- Estrutura (mostrada só se tiver filhos; JS já trata) -->
        <button type="button" class="icon-btn" data-action="estrutura" title="Estrutura" aria-label="Estrutura">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <circle cx="6"  cy="6"  r="2"></circle>
            <circle cx="18" cy="6"  r="2"></circle>
            <circle cx="18" cy="12" r="2"></circle>
            <circle cx="18" cy="18" r="2"></circle>
            <path d="M8 6h8"></path><path d="M8 6v12"></path>
            <path d="M14 12h4"></path><path d="M14 18h4"></path>
          </svg>
        </button>
      </div>`;
    anchor.after(li2);
    anchor = li2;
  }

  // 5) Reaplica a lógica que mostra o botão “Estrutura” só quando há filhos
  if (typeof window.markEstruturaButtons === 'function') {
    await window.markEstruturaButtons(root);
  }
}


// ——— Editor inline de Troca ———

// ——— Busca de produtos (adapta ao que você já tiver) ———
// ——— Chamada para TROCAR item na estrutura no backend ———
async function trocarItemEstrutura({ pai_codigo, de_codigo, para_codigo }) {
  if (!pai_codigo || !de_codigo || !para_codigo) throw new Error('Parâmetros incompletos');
  // 1) rota oficial (ajuste para a sua API!)
  const tries = [
    { url:'/api/pcp/estrutura/trocar',  method:'POST', body:{ pai_codigo, de_codigo, para_codigo } },
    // fallback comuns:
    { url:'/api/pcp/estrutura/replace', method:'POST', body:{ pai_codigo, de_codigo, para_codigo } },
    { url:'/api/pcp/estrutura/update',  method:'POST', body:{ pai_codigo, de_codigo, para_codigo } },
  ];
  for (const t of tries) {
    try {
      const r = await fetch(t.url, { method:t.method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(t.body) });
      if (!r.ok) continue;
      const j = await r.json();
      // sucesso se backend retornar {ok:true} ou similar; se não tiver, assume 200
      if (j?.ok === false) continue;
      return true;
    } catch {}
  }
  throw new Error('Nenhuma rota de troca respondeu com sucesso');
}




// ————————————————————————————————————————————————————————————————
// Mostra o botão "Estrutura" apenas onde há filhos (e deixa por último)
// ————————————————————————————————————————————————————————————————
const __hasChildrenCache = new Map(); // codigo -> boolean

async function fetchHasChildren(codigo) {
  if (__hasChildrenCache.has(codigo)) return __hasChildrenCache.get(codigo);
  try {
    const r = await fetch('/api/pcp/estrutura?pai_codigo=' + encodeURIComponent(codigo), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const j = await r.json();
    const has = Array.isArray(j?.dados) && j.dados.length > 0;
    __hasChildrenCache.set(codigo, has);
    return has;
  } catch {
    __hasChildrenCache.set(codigo, false);
    return false;
  }
}

async function markEstruturaButtons(containerEl) {
  const rows = Array.from(containerEl.querySelectorAll('li')).filter(li => !li.classList.contains('header-row'));
  const tasks = rows.map(async (li) => {
    const codigo = (li.dataset.comp || li.querySelector(':scope > div:first-child')?.textContent || '').trim();
    if (!codigo) return;
    const acoes = li.querySelector('.acoes');
    const btn = li.querySelector('.icon-btn[data-action="estrutura"]');
    if (!acoes || !btn) return;
    const has = await fetchHasChildren(codigo);

    if (has) {
      // garante que o botão Estrutura fica SEMPRE por último
      acoes.appendChild(btn);               // mover para o fim, se necessário
      btn.style.display = 'inline-flex';    // exibe
      btn.classList.remove('has-estrutura'); // (limpa estilos antigos se havia)
    } else {
      // oculta (ou remova, se preferir: btn.remove())
      btn.style.display = 'none';
    }
  });
  await Promise.allSettled(tasks);
}





// Disparo ao clicar na sub-aba “Estrutura de produto”

// Ligação robusta da sub-aba "Estrutura de produto"
(function wireEstruturaTab(){
  function bind(){
    const container = document.querySelector('#produtoTabs .main-header');
    if (!container) return false;
    if (container.__estruturaBound) return true;
    container.__estruturaBound = true;

    container.addEventListener('click', (ev) => {
      const link = ev.target.closest('.main-header-link[data-target="estruturaProduto"]');
      if (!link) return;
      ev.preventDefault();

      // ativa visualmente a tab
      document.querySelectorAll('#produtoTabs .main-header .main-header-link')
        .forEach(a => a.classList.remove('is-active'));
      link.classList.add('is-active');

      // mostra o pane correto
      document.querySelectorAll('#produtoTabs .tab-content .tab-pane')
        .forEach(p => p.style.display = 'none');
      const pane = document.getElementById('estruturaProduto');
      if (pane) pane.style.display = 'block';

      // carrega do SQL
      const titulo = document.getElementById('productTitle')?.textContent?.trim() || '';
      const cod = (window.codigoSelecionado || titulo || '').trim();
      if (typeof window.loadEstruturaProduto === 'function') {
        window.loadEstruturaProduto(cod);
      }
    }, true);

    return true;
  }

  if (!bind()){
    document.addEventListener('DOMContentLoaded', bind);
    const iv = setInterval(() => { if (bind()) clearInterval(iv); }, 300);
    setTimeout(() => clearInterval(iv), 5000);
  }
})();
;

// ===== VISIBILIDADE POR AUTENTICAÇÃO & PERMISSÕES =====

// CSS utilitário (1x)
(function ensureAuthCss(){
  if (document.getElementById('perm-hide-style')) return;
  const st = document.createElement('style');
  st.id = 'perm-hide-style';
  st.textContent = `.perm-hidden{display:none!important}`;
  document.head.appendChild(st);
})();

// O que pode ficar visível quando DESLOGADO
const PUBLIC_WHEN_LOGGED_OUT = [
  '#menu-inicio',          // Início no topo
  '#profile-icon',         // ícone usuário (abre login)
  '#btn-login','#user-button','#btn-user','#login-btn' // fallbacks, se existirem
];

// **TUDO** que é controlado por login/permissão
const GATED_SELECTORS = [
  // topo (qualquer item com id #menu-*)
  'a[id^="menu-"]',
  '.header .header-menu > .menu-link',

  // abas internas (Produto, etc.)
  '#produtoTabs .main-header .main-header-link',
  '#kanbanTabs .main-header .main-header-link',
  '#armazemTabs .main-header .main-header-link',

  // lateral
  '.side-menu-item',
  '.left-side .side-menu a',
  '.sidebar a',
  '.menu-lateral a',

  // genéricos
  '.tab-header a',
  '.tab-header button',
  '[data-top]', '[data-menu]', '[data-submenu]'
].join(',');

function findGatedCandidates(){
  return document.querySelectorAll(GATED_SELECTORS);
}

// Deslogado: esconde tudo e mostra só Início + Login
function applyLoggedOutUI(){
  const gated = findGatedCandidates();
  gated.forEach(el => el.classList.add('perm-hidden'));
  PUBLIC_WHEN_LOGGED_OUT.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.classList.remove('perm-hidden'));
  });
}

// Logado: revela só o que a ÁRVORE permitir
async function applyCurrentUserPermissionsToUI(){
  // começa escondendo tudo
  const gated = findGatedCandidates();
  gated.forEach(el => el.classList.add('perm-hidden'));

  const me = window.__sessionUser;
  if (!me) { applyLoggedOutUI(); return; }

  const r = await fetch(`/api/users/${me.id}/permissions/tree`, { credentials:'include' });
  if (!r.ok) { applyLoggedOutUI(); return; }
  const data = await r.json();

  for (const n of data.nodes || []) {
    if (!n.selector) continue;
    document.querySelectorAll(n.selector).forEach(el => {
      el.classList.toggle('perm-hidden', !n.allowed);
    });
  }

  // Início sempre visível
  document.querySelectorAll('#menu-inicio').forEach(el => el.classList.remove('perm-hidden'));
}

// Checa auth no backend e aplica estado
async function ensureAuthVisibility(){
  try {
    // estado seguro imediato
    applyLoggedOutUI();

    const r  = await fetch('/api/auth/status', { credentials:'include' });
    const st = r.ok ? await r.json() : { loggedIn:false };
    window.__sessionUser = st.loggedIn ? st.user : null;

    if (st.loggedIn) await applyCurrentUserPermissionsToUI();
    else             applyLoggedOutUI();
  } catch {
    applyLoggedOutUI();
  }
}

// ====== AUTODESCoberta de navegação + sync ======
function _navComputeSelector(el) {
  // Preferimos um seletor estável pelo próprio data-nav-key
  const key = el.dataset.navKey;
  if (key) return `[data-nav-key="${key}"]`;
  // fallback: id
  if (el.id) return `#${el.id}`;
  return null; // sem selector -> só aparece na lista, não oculta nada na UI
}

function collectNavNodesFromDOM() {
  const els = document.querySelectorAll('[data-nav-key]');
  const nodes = [];
  els.forEach(el => {
    const key   = el.dataset.navKey;
    const label = el.dataset.navLabel?.trim() || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const pos   = (el.dataset.navPos || '').toLowerCase() === 'top' ? 'top' : 'side';
    const parentKey = el.dataset.navParent || null;
    const sort  = Number(el.dataset.navSort || 0) || 0;
    const selector = el.dataset.navSelector || _navComputeSelector(el);
    if (key && label && pos) {
      nodes.push({ key, label, position: pos, parentKey, sort, selector });
    }
  });
  return nodes;
}

// === SINCRONIZAÇÃO DE NÓS DE NAVEGAÇÃO COM O SQL ===
// ====== NAV SYNC (com cache) ======
window.__navSync = window.__navSync || { running:false, last:0 };

// chama o /api/nav/sync somente se logado e só a cada N ms
window.syncNavNodes = async function(force = false) {
  try {
    if (!window.__sessionUser) return; // precisa estar logado
    if (window.__navSync.running) return;
    const now = Date.now();
    if (!force && now - window.__navSync.last < 60_000) return; // 1 min de cache

    window.__navSync.running = true;

    // coleta os nós do DOM
    const els = document.querySelectorAll('[data-nav-key]');
    const nodes = [];
    els.forEach(el => {
      const key       = el.dataset.navKey;
      const label     = el.dataset.navLabel?.trim() || (el.textContent || '').trim().replace(/\s+/g,' ').slice(0,60);
      const position  = (el.dataset.navPos || '').toLowerCase() === 'top' ? 'top' : 'side';
      const parentKey = el.dataset.navParent || null;
      const sort      = Number(el.dataset.navSort || 0) || 0;
      const selector  = el.dataset.navSelector || null;
      if (key && label && position) nodes.push({ key, label, position, parentKey, sort, selector });
    });
    if (!nodes.length) { window.__navSync.running = false; return; }

    const r = await fetch('/api/nav/sync', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify({ nodes })
    });
    if (!r.ok) {
      const e = await r.json().catch(()=>({}));
      console.warn('[nav-sync]', r.status, e);
    } else {
      window.__navSync.last = Date.now();
    }
  } catch (e) {
    console.warn('[nav-sync] falhou', e);
  } finally {
    window.__navSync.running = false;
  }
};


// helper que só chama se passou o cache
window.maybeSyncNavNodes = function() {
  return window.syncNavNodes(false); // respeita o cache
};

window.addEventListener('auth:changed', () => {
  if (!window.__sessionUser) {
    if (userNameDisplay) userNameDisplay.textContent = '';
  } else {
    if (userNameDisplay) {
      userNameDisplay.textContent =
        window.__sessionUser.nome || window.__sessionUser.username || '';
    }
  }
});



// depois do login ok:
window.dispatchEvent(new Event('auth:changed'));

// lifecycle
document.addEventListener('DOMContentLoaded', () => {
  applyLoggedOutUI();
  ensureAuthVisibility();
});

// reapply quando login/logout ou permissões mudarem
window.addEventListener('auth:changed', ensureAuthVisibility);

// após login/logout, sincroniza nós (se logado)
window.addEventListener('auth:changed', async () => {
  if (window.__sessionUser) {
    try { await window.syncNavNodes?.(); } catch {}
  }
});

// === Bind global para botão de deslogar (fora do modal de login) ===
(function bindLogoutButton(){
  async function doLogout(e) {
    e?.preventDefault();
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {}

    // limpa sessão local
    window.__sessionUser = null;
    localStorage.removeItem('user');
    localStorage.removeItem('password');

    // dispara evento para toda a UI se atualizar
    window.dispatchEvent(new Event('auth:changed'));
  }

  // tenta ligar ao carregar
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('#btn-logout, [data-logout]');
    if (btn) btn.addEventListener('click', doLogout);
  });
})();

window.applyCurrentUserPermissionsToUI = applyCurrentUserPermissionsToUI;

// ——— Importar Estrutura: botão (apenas gancho por enquanto) ———
(function wireEstruturaImportButtonOnce(){
  const btn = document.getElementById('btnImportarEstrutura');
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = '1';
  btn.addEventListener('click', () => {
    console.log('[Estrutura] Importar estrutura de produto — clique');
    // Próximo passo: abrir modal/upload/colagem JSON/clonar/OMIE...
  });
})();

// Fallback se o DOM ainda não estiver pronto quando este arquivo carregar:
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnImportarEstrutura');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        console.log('[Estrutura] Importar estrutura de produto — clique');
      });
    }
  });
}

// Formata a quantidade EXATAMENTE como pedido: "0.002000" → "0,002"
function fmtQtdBR(v) {
  if (v === null || v === undefined || v === '') return '';
  // aceita number ou string ("0.002000" / "0,002000")
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  // até 6 casas (compatível com numeric(20,6)), tirando zeros à direita
  let s = n.toFixed(6).replace(/\.?0+$/, '');
  if (s === '') s = '0';
  return s.replace('.', ',');
}

// ——— Exportar Estrutura no layout "Listagem dos Materiais (B.O.M.)" (CSV) ———
// Inclui a coluna "Operação" a partir de it.comp_operacao
function exportarEstruturaAtualCSV_BOM(){
  (async () => {
    const codigo = (window.codigoSelecionado || window.ultimoCodigo || '').trim();
    if (!codigo) { alert('Não consegui identificar o código do produto aberto.'); return; }

    const btn = document.getElementById('btnExportarEstrutura');
    const prevDisabled = btn?.disabled;
    if (btn) btn.disabled = true;

    try {
      const resp = await fetch(`${API_BASE}/api/pcp/estrutura?pai_codigo=${encodeURIComponent(codigo)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const json = await resp.json();
      if (!json || json.ok !== true) throw new Error(json?.error || 'Falha ao buscar estrutura no SQL.');
      const itens = Array.isArray(json.dados) ? json.dados : [];

      // Cabeçalho EXATO (10 colunas) — mantém seu layout B.O.M.
      const HEADERS = [
        'Identificação do Produto',
        'Descrição do Produto',
        'Tipo do Produto',
        'Operação',
        'Qtde Prevista',
        'Unidade',
        'Qtde Cúbica',
        'Custo Unitário',
        'Custo Total',
        'Ficha'
      ];

      // helpers de CSV ; com aspas
      const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
      // número sem milhar e com vírgula decimal
      const fmtNum = v => {
        if (v === null || v === undefined || v === '') return '';
        const n = Number(String(v).replace(/\./g,'').replace(',', '.'));
        if (!Number.isFinite(n)) return '';
        const s = String(n);
        return s.replace('.', ',');
      };

      // ⬇️ AQUI está a mudança: quarta coluna agora recebe it.comp_operacao
      const rows = itens.map(it => ([
        it?.comp_descricao ?? '',        // Identificação do Produto
        it?.comp_codigo ?? '',           // Descrição do Produto
        '',                              // Tipo do Produto (sem fonte no SQL)
        it?.comp_operacao ?? '',         // Operação  ← NOVO (preenchido)
        fmtQtdBR(it.comp_qtd),   //  ← Qtde Prevista no formato "0,002"
        it?.comp_unid ?? '',             // Unidade
        '',                              // Qtde Cúbica
        '',                              // Custo Unitário
        '',                              // Custo Total
        ''                               // Ficha
      ]));

      const csv =
        [HEADERS.map(esc).join(';')]
        .concat(rows.map(cols => cols.map(esc).join(';')))
        .join('\r\n');

      // BOM ajuda Excel PT-BR a reconhecer UTF-8
      const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `BOM_${codigo}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Exportar BOM CSV] erro:', err);
      alert('Erro ao exportar a BOM: ' + err.message);
    } finally {
      if (btn) btn.disabled = prevDisabled;
    }
  })();
}


// ——— Religa o botão Exportar para usar CSV ———
(function wireExportBOM(){
  const btn = document.getElementById('btnExportarEstrutura');
  if (!btn) return;
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);
  clone.addEventListener('click', exportarEstruturaAtualCSV_BOM);
})();

// ---------------------------------------------------------------------------
// PÓS-EXCLUSÃO: ATUALIZAR (quant/unidade) O QUE SOBROU + INCLUIR NOVOS
//   • Consulta a OMIE após as exclusões.
//   • Compara cada item remanescente com o CSV:
//       - Se mudar quantidade (quantProdMalha) ou unidade (unidProdMalha) → AlterarEstrutura
//   • Inclui itens do CSV que não estão na OMIE → IncluirEstrutura
//   • Não mexe em SQL aqui.
// ---------------------------------------------------------------------------
async function atualizarEIncluirEstruturaOmie(paiCodigo, itensCsv) {
  // helper local (igual ao usado na etapa excluir)
  async function omieMalhaCall(call, param) {
    const resp = await fetch(`${API_BASE}/api/omie/malha/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ call, param })
    });
    const raw = await resp.text();
    let js; try { js = JSON.parse(raw); } catch { js = { raw }; }
    if (!resp.ok || js?.faultstring) {
      throw new Error(js?.faultstring || `HTTP ${resp.status} em ${call}`);
    }
    return js;
  }

  // resolve idProduto (PREFERIR tela → fallback SQL)
  async function resolveIdProduto(paiCodigo) {
    const tryNum = s => /^\d{6,14}$/.test(String(s||'').trim()) ? Number(String(s).trim()) : null;

    // tenta achar na UI (campo "Código OMIE")
    const labelNodes = Array.from(document.querySelectorAll('.products'))
      .filter(el => /c[óo]digo\s+omie/i.test(el.textContent || ''));
    for (const lb of labelNodes) {
      const scope = lb.closest('li, .row, .wrap, .side-menu, .card, div') || lb.parentElement;
      if (!scope) continue;
      for (const el of scope.querySelectorAll('.status-text, .value, span, div')) {
        const n = tryNum(el.textContent);
        if (n) return n;
      }
    }
    // fallback global
    const any = Array.from(document.querySelectorAll('.status-text, .value, span, div'))
      .map(el => tryNum(el.textContent)).find(Boolean);
    if (any) return any;

    // último fallback: rota SQL já existente
    const r = await fetch(`${API_BASE}/api/sql/produto-id/${encodeURIComponent(paiCodigo)}`);
    if (r.ok) {
      const js = await r.json();
      return Number(js?.codigo_produto || 0) || null;
    }
    return null;
  }

  // resolve id do componente (idProdMalha) a partir do código (coluna "codigo")
  async function resolveIdProdMalha_noSQL(codigoComp) {
    try {
      const r = await fetch(`${API_BASE}/api/sql/produto-id/${encodeURIComponent(codigoComp)}`);
      if (!r.ok) return null;
      const js = await r.json();
      return Number(js?.codigo_produto || 0) || null;
    } catch { return null; }
  }

  // normaliza CSV: consolida por código (soma quantidades) e padroniza unidade
  const somaPorCod = new Map();
  for (const it of (Array.isArray(itensCsv) ? itensCsv : [])) {
    const cod = String(it?.comp_codigo || '').trim();
    const qt  = Number(it?.comp_qtd ?? 0) || 0;
    const un  = String(it?.comp_unid || '').trim().toUpperCase();
    if (!cod || qt <= 0) continue;
    const acc = somaPorCod.get(cod) || { qt:0, unid: un };
    acc.qt += qt;
    // se vier unidade divergente em linhas distintas, prevalece a última não-vazia
    if (un) acc.unid = un;
    somaPorCod.set(cod, acc);
  }

  // idProduto pai
  const idProduto = await resolveIdProduto(paiCodigo);
  if (!idProduto) throw new Error(`idProduto OMIE não encontrado para ${paiCodigo}.`);

  // consulta OMIE pós-exclusão
  let consult;
  try {
    consult = await omieMalhaCall('ConsultarEstrutura', [{ idProduto }]);
  } catch (e) {
    // 103 = sem estrutura → nada a atualizar; somente incluir tudo
    if (!String(e?.message||'').includes('103')) throw e;
    consult = { itens: [] };
  }

  const existentes = Array.isArray(consult?.itens) ? consult.itens
                    : Array.isArray(consult?.itensEstrutura) ? consult.itensEstrutura
                    : Array.isArray(consult?.itensMalha) ? consult.itensMalha
                    : [];

  // mapeia existentes por código (codProdMalha/intMalha)
  const mapOmie = new Map();
  for (const ex of existentes) {
    const cod = String(ex?.codProdMalha || ex?.intMalha || '').trim();
    if (!cod) continue;
    mapOmie.set(cod, {
      idMalha      : ex?.idMalha || null,
      idProdMalha  : ex?.idProdMalha || null,
      intMalha     : String(ex?.intMalha || cod).trim(),
      quant        : Number(ex?.quantProdMalha || 0) || 0,
      unid         : String(ex?.unidProdMalha || '').trim().toUpperCase()
    });
  }

  const paraAlterar = []; // { intMalha, idProdMalha, quantProdMalha, unidProdMalha?, percPerdaProdMalha?, obsProdMalha? }
  const paraIncluir = []; // { intMalha, idProdMalha, quantProdMalha, percPerdaProdMalha, obsProdMalha }

  // compara e decide ALTERAR/INCLUIR
  for (const [cod, csv] of somaPorCod.entries()) {
    const ex = mapOmie.get(cod);
    if (ex) {
      const needQt  = Math.abs((ex.quant || 0) - (csv.qt || 0)) > 1e-9;
      const needUn  = (String(ex.unid||'') !== String(csv.unid||''));
      if (needQt || needUn) {
        let idProdMalha = ex.idProdMalha;
        if (!idProdMalha) idProdMalha = await resolveIdProdMalha_noSQL(cod);
        if (!idProdMalha) {
          console.warn(`[ATUALIZAR] ${cod}: sem idProdMalha — pulando AlterarEstrutura.`);
          continue;
        }
        const item = {
          intMalha: ex.intMalha || cod,
          idProdMalha,
          quantProdMalha: csv.qt
        };
        if (needUn && csv.unid) item.unidProdMalha = csv.unid; // só manda se mudar
        paraAlterar.push(item);
      }
    } else {
      // novo → incluir
      const idProdMalha = await resolveIdProdMalha_noSQL(cod);
      if (!idProdMalha) {
        console.warn(`[INCLUIR] ${cod}: sem idProdMalha no SQL — pulando inclusão.`);
        continue;
      }
      paraIncluir.push({
        intMalha: cod,
        idProdMalha,
        quantProdMalha: csv.qt,
        percPerdaProdMalha: 0,
        obsProdMalha: ''
      });
    }
  }

  // aplica AlterarEstrutura em lotes de 40
  const CHUNK = 40;
  async function chunkDo(arr, n, fn) {
    for (let i = 0; i < arr.length; i += n) {
      const lote = arr.slice(i, i+n);
      await fn(lote);
      await new Promise(r => setTimeout(r, 350)); // ~3/s
    }
  }

  let alterados = 0, incluidos = 0;

  if (paraAlterar.length) {
    await chunkDo(paraAlterar, CHUNK, async (lote) => {
      await omieMalhaCall('AlterarEstrutura', [{ idProduto, itemMalhaAlterar: lote }]);
      alterados += lote.length;
    });
  }

  if (paraIncluir.length) {
    await chunkDo(paraIncluir, CHUNK, async (lote) => {
      await omieMalhaCall('IncluirEstrutura', [{ idProduto, itemMalhaIncluir: lote }]);
      incluidos += lote.length;
    });
  }

  return { alterados, incluidos, existentesAntes: existentes.length };
}

// ---------------------------------------------------------------------------
// EXCLUIR APENAS OS ITENS QUE NÃO ESTÃO NO CSV (OMIE → ExcluirEstrutura)
// Fluxo: pega idProduto (tela > SQL fallback) → ConsultarEstrutura →
// compara codProdMalha com a 2ª coluna do CSV (comp_codigo) → ExcluirEstrutura.
// NÃO inclui / NÃO altera / NÃO mexe em SQL.
// ---------------------------------------------------------------------------
async function excluirExcedentesEstruturaOmie(paiCodigo, itensCsv) {
  // 1) Descobrir idProduto: preferir a UI ("Código OMIE"), senão SQL
  const idFromUI = (() => {
    const tryNum = (t) => {
      const s = String(t || '').trim();
      return /^\d{6,14}$/.test(s) ? Number(s) : null;
    };

    // varre labels "Código OMIE" e procura um .status-text com número ao lado
    const labels = Array.from(document.querySelectorAll('.products'))
      .filter(el => /c[óo]digo\s+omie/i.test(el.textContent || ''));

    for (const lb of labels) {
      const scope = lb.closest('li, .row, .wrap, .side-menu, .card, div') || lb.parentElement;
      if (!scope) continue;
      const candidates = scope.querySelectorAll('.status-text, .value, span, div');
      for (const el of candidates) {
        const n = tryNum(el.textContent);
        if (n) return n;
      }
    }
    // fallback global (qualquer status-text com número)
    const anyNum = Array.from(document.querySelectorAll('.status-text, .value, span, div'))
      .map(el => tryNum(el.textContent)).find(Boolean);
    return anyNum || null;
  })();

  let idProduto = idFromUI;
  if (!idProduto) {
    // fallback via SQL (sua rota já existente)
    const r = await fetch(`${API_BASE}/api/sql/produto-id/${encodeURIComponent(paiCodigo)}`);
    if (r.ok) {
      const js = await r.json();
      idProduto = Number(js?.codigo_produto || 0) || null;
    }
  }
  if (!idProduto) {
    throw new Error(`idProduto OMIE não encontrado para ${paiCodigo} (tela/SQL).`);
  }

  // 2) Helper para chamar OMIE pelo novo proxy do backend (sem passar no SQL)
  async function omieMalhaCall(call, param) {
    const resp = await fetch(`${API_BASE}/api/omie/malha/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ call, param })
    });
    const raw = await resp.text();
    let js; try { js = JSON.parse(raw); } catch { js = { raw }; }
    if (!resp.ok || js?.faultstring) {
      throw new Error(js?.faultstring || `HTTP ${resp.status} em ${call}`);
    }
    return js;
  }

  // 3) Consultar estrutura atual na OMIE
  let consult;
  try {
    consult = await omieMalhaCall('ConsultarEstrutura', [{ idProduto }]);
  } catch (e) {
    // Fault 103 (produto sem estrutura) = não há nada para excluir
    if (String(e?.message || '').includes('103')) {
      return { deletados: 0, total_existentes: 0 };
    }
    throw e;
  }

  // 4) Normaliza lista de itens existentes na OMIE
  const itensOmie = Array.isArray(consult?.itens) ? consult.itens
                   : Array.isArray(consult?.itensEstrutura) ? consult.itensEstrutura
                   : Array.isArray(consult?.itensMalha) ? consult.itensMalha
                   : [];

  // códigos vindos do CSV (2ª coluna) — no seu parser, está em comp_codigo
  const codsCsv = new Set(
    (itensCsv || [])
      .map(it => String(it?.comp_codigo || it?.codigo || it?.cod || '').trim())
      .filter(Boolean)
  );

  let deletados = 0;

  // 5) Para cada item da OMIE que NÃO está no CSV: ExcluirEstrutura
  for (const ex of itensOmie) {
    // tenta ler o "código do componente" de formas comuns
    const cod =
      String(
        ex?.codProdMalha ||
        ex?.intProdMalha?.cCodigo ||
        ex?.codProduto ||
        ex?.codigo ||
        ''
      ).trim();

    const idMalha = ex?.idMalha || ex?.nIdMalha || ex?.id_item_malha || null;

    if (!cod || !idMalha) continue;
    if (!codsCsv.has(cod)) {
      // exclusão 1 a 1; dá um pequeno respiro pra evitar rate-limit
      await omieMalhaCall('ExcluirEstrutura', [{ idProduto, idMalha }]);
      deletados++;
      await new Promise(r => setTimeout(r, 350)); // ~3/s
    }
  }

  return { deletados, total_existentes: itensOmie.length };
}



// ——— Importar Estrutura (apenas CSV no layout B.O.M.) ———
(function wireImportBOM(){
  const btn = document.getElementById('btnImportarEstrutura');
  if (!btn) return;

  // evita múltiplos handlers caso este bloco rode mais de uma vez
  if (!btn.dataset.boundImportBOM) {
    btn.dataset.boundImportBOM = '1';
  }

  // cria (ou reaproveita) input oculto
  let fileInput = document.getElementById('fileImportBOMcsv');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'fileImportBOMcsv';
    fileInput.accept = '.csv';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }

  // abre seletor de arquivo
  btn.addEventListener('click', () => fileInput.click(), { passive: true });

  // ——— helpers ———
  function parseCSV(text, sep = ';') {
    const out = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i+1];
      if (inQuotes) {
        if (ch === '"') {
          if (next === '"') { cell += '"'; i++; } // aspas escapada ""
          else { inQuotes = false; }
        } else {
          cell += ch;
        }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === sep) { row.push(cell); cell=''; }
        else if (ch === '\n') { row.push(cell); out.push(row); row=[]; cell=''; }
        else if (ch === '\r') { /* ignora CR */ }
        else { cell += ch; }
      }
    }
    row.push(cell); out.push(row);
    while (out.length && out[out.length-1].every(c => String(c).trim()==='')) out.pop();
    return out;
  }

  const normHeader = s => String(s ?? '')
    .replace(/[\u00A0\s]+/g, ' ')   // NBSP + múltiplos espaços → 1 espaço
    .trim()
    .toLowerCase();

  const EXPECT = [
    'identificação do produto',
    'descrição do produto',
    'tipo do produto',
    'operação',
    'qtde prevista',
    'unidade',
    'qtde cúbica',
    'custo unitário',
    'custo total',
    'ficha'
  ];

  const toNum = v => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/\./g,'').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const trim = v => String(v ?? '').trim();

  // evita duplicar o listener se este bloco rodar novamente
  if (fileInput.dataset.bound) return;
  fileInput.dataset.bound = '1';

fileInput.addEventListener('change', async () => {
  // sempre permitir reanexar o mesmo arquivo
  try {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    // 🔄 spinner ON assim que o usuário anexa o CSV
    showEstruturaSpinner();


    const codigo = (window.codigoSelecionado || window.ultimoCodigo || '').trim();
    if (!codigo) {
      console.warn('[Importar BOM CSV] Código do produto não identificado na tela.');
      return;
    }

    const text = await file.text();

    // tenta ;, se não, tenta ,
    let rows = parseCSV(text, ';');
    if (rows.length <= 1 || rows[0].length < 4) rows = parseCSV(text, ',');
    if (!rows || !rows.length) throw new Error('Arquivo CSV vazio.');

    const headerRaw = rows[0].map(h => h.replace(/^"|"$/g,''));
    const header    = headerRaw.map(normHeader);

    // mapeia cabeçalhos esperados → índice
    const idx = {};
    EXPECT.forEach(h => { idx[h] = header.indexOf(h); });

    // valida colunas mínimas
    const req = ['identificação do produto','descrição do produto','qtde prevista','unidade'];
    const missing = req.filter(h => idx[h] === -1);
    if (missing.length) {
      console.warn('[Import CSV] Cabeçalho detectado:', headerRaw);
      throw new Error('Cabeçalho do CSV não confere. Faltando: ' + missing.join(', '));
    }

    // converte linhas do CSV
    const itens = [];
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      const get = (h) => {
        const j = idx[h];
        return j >= 0 ? String(cols[j] ?? '').trim() : '';
      };

      const comp_descricao = get('identificação do produto');
      const comp_codigo    = get('descrição do produto');
      const comp_unid      = get('unidade');
      const comp_qtd       = toNum(get('qtde prevista'));
      const comp_operacao  = get('operação');

      // ignora linha totalmente vazia
      if (!comp_descricao && !comp_codigo && !comp_unid && (comp_qtd == null) && !comp_operacao) continue;

      itens.push({
        comp_codigo,
        comp_descricao,
        comp_unid,
        comp_qtd,
        comp_operacao,
        comp_tipo: null,
        comp_perda_pct: null,
        comp_qtd_bruta: null
      });
    }

    if (itens.length) console.debug('[Import CSV] amostra do primeiro item:', itens[0]);

    // ⚙️ OMIE: Excluir → Atualizar → Incluir (sem alert/return)
    console.group('[ImportarBOM] OMIE — Excluir/Atualizar/Incluir');
    try {
      try {
        const r1 = await excluirExcedentesEstruturaOmie(codigo, itens);
        console.log(`[ImportarBOM] OMIE Excluir → deletados=${r1?.deletados || 0} de ${r1?.total_existentes || 0}`);
      } catch (e) {
        console.error('[ImportarBOM] OMIE Excluir falhou (segue fluxo):', e);
      }

      try {
        const r2 = await atualizarEIncluirEstruturaOmie(codigo, itens);
        console.log(`[ImportarBOM] OMIE Atualizar/Incluir → alterados=${r2?.alterados || 0} | incluidos=${r2?.incluidos || 0}`);
      } catch (e) {
        console.error('[ImportarBOM] OMIE Atualizar/Incluir falhou (segue fluxo):', e);
      }
    } finally {
      console.groupEnd();
    }

    // 🗄️ SQL: replace normal (sem pop-up de sucesso)
    const base = (window.API_BASE || '');
    const url  = `${base}/api/pcp/estrutura/replace`.replace(/([^:]\/)\/+/g, '$1');
    const user = getLoggedUserName();
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-user': user
      },
      body: JSON.stringify({ pai_codigo: codigo, itens })
    });

    // leitura tolerante a HTML
    const raw = await resp.text();
    let js; try { js = JSON.parse(raw); } catch { js = { raw }; }

    if (!resp.ok || js?.error) {
      console.error('[Importar BOM CSV] Erro JSON recebido da API:', js);
      throw new Error(js?.error || `Falha HTTP ${resp.status}`);
    }

    // refresh da UI sem alert
    if (typeof window.loadEstruturaProduto === 'function') {
      window.loadEstruturaProduto(codigo);
    }
    console.info(`[ImportarBOM] Concluído para ${codigo}. Linhas CSV: ${itens.length}`);

    // Recarrega meta para atualizar Versão/Atualizado por na UI
    try {
      const meta = await pcpFetchEstruturaMetaByCod(codigo);
      pcpUpdateVersaoBadges(meta);
    } catch (e) {
      console.warn('Falha ao atualizar meta após import:', e);
    }

  } catch (err) {
    console.error('[Importar BOM CSV] erro:', err);
  } finally {
    // 🔄 spinner OFF (sempre)
    hideEstruturaSpinner();

  }
});

})();

async function importarBOMCSV_normalizado(paiCodigo, itensNormalizados) {
  const user = getLoggedUserName();
  const resp = await fetch(`${API_BASE}/api/pcp/estrutura/replace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user': user
    },
    body: JSON.stringify({ pai_codigo: paiCodigo, itens: itensNormalizados }),
  });

  // leitura tolerante a HTML (erros 404/500 que voltam com <html>)
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const txt = await resp.text();
    const snippet = txt.slice(0, 300);
    console.error('[Importar BOM CSV] Resposta NÃO-JSON da API', { status: resp.status, statusText: resp.statusText, url: resp.url, body_snippet: snippet });
    throw new Error(`A API respondeu ${resp.status} (${resp.statusText}). Veja o console para detalhes.`);
  }

  const data = await resp.json();
  if (!data.ok) throw new Error(data.error || 'Falha ao importar.');
  return data;
}

// Cache compartilhado de produtos (codigo / descricao)
window.__PRODUTOS_CACHE = window.__PRODUTOS_CACHE || [];

// Tira produtos já renderizados na aba "Lista de produtos"
function collectProdutosFromListaDOM() {
  const ul = document.getElementById('listaProdutosList');
  if (!ul) return [];
  const out = [];
  // Tenta data-attrs; se não houver, lê as 2 primeiras colunas (divs)
  ul.querySelectorAll('li').forEach(li => {
    let codigo = li.getAttribute('data-codigo');
    let descricao = li.getAttribute('data-descricao');
    if (!codigo)   codigo   = li.querySelector(':scope > div:nth-child(1)')?.textContent;
    if (!descricao) descricao = li.querySelector(':scope > div:nth-child(2)')?.textContent;
    codigo = (codigo || '').trim();
    descricao = (descricao || '').trim();
    if (codigo) out.push({ codigo, descricao });
  });
  return out;
}

// Garante que o cache está carregado a partir da Lista de produtos.
// Se existir uma função oficial da sua lista (ex.: window.loadListaProdutos),
// tentamos chamá-la silenciosamente antes de ler o DOM.
async function ensureProdutosCacheFromLista() {
  if (Array.isArray(window.__PRODUTOS_CACHE) && window.__PRODUTOS_CACHE.length) return window.__PRODUTOS_CACHE;

  // tenta chamar a função oficial da Lista (se existir)
  if (typeof window.loadListaProdutos === 'function') {
    try { await window.loadListaProdutos({ silent: true }); } catch {}
  }

  const items = collectProdutosFromListaDOM();
  if (items.length) window.__PRODUTOS_CACHE = items;
  return window.__PRODUTOS_CACHE;
}
