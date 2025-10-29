
/* =============================
   PREPARAÇÃO ELÉTRICA — JS (FIX COMPLETO)
   - Remove qualquer chamada solta a onScan/start fora de função
   - Leitura QR e manual usam o MESMO fluxo (handleOP)
   - Extrai OP do sufixo após o último "-" (ex.: 04.PP...-P2500018 -> P2500018)
   - Câmera: facingMode:'environment' + fallback por deviceId
   - Modal não abre teclado automaticamente
   - Mantém import do kanban_preparacao e o mini-kanban do Produto
   ============================= */

import { initPreparacaoKanban } from '../kanban/kanban_preparacao.js';

/* ---------- Base de API ---------- */
export const API_BASE = (() => {
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta && meta.content) return meta.content.replace(/\/$/, '');
  if (location.hostname.endsWith('onrender.com')) return `https://${location.host}/api`;
  return '/api';
})();

/* ---------- Utils ---------- */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const forceTop = () => { try { window.scrollTo(0,0); } catch {} };

/* Normaliza URL de imagem (https em https) */
function normalizeImageUrl(imgUrl) {
  if (!imgUrl) return null;
  try {
    const u = new URL(String(imgUrl), location.href);
    if (location.protocol === 'https:' && u.protocol === 'http:') u.protocol = 'https:';
    return u.toString();
  } catch { return imgUrl; }
}

/* Deixa o #qrReader quadrado em qualquer device */
function lockQrSquare() {
  const el = document.getElementById('qrReader');
  if (!el) return;
  const maxW = Math.min(window.innerWidth * 0.92, 520);
  const maxH = Math.min(window.innerHeight * 0.80, 520);
  const size = Math.max(260, Math.floor(Math.min(maxW, maxH)));
  el.style.width  = size + 'px';
  el.style.height = size + 'px';
}

/* ==================================================
   App
   ================================================== */
document.addEventListener('DOMContentLoaded', () => {
  forceTop();
  initPreparacaoKanban();

  const els = {
    menuInicio   : document.getElementById('menu-inicio'),
    menuProduto  : document.getElementById('menu-produto'),
    menuGestao   : document.getElementById('menu-gestao'),
    paginaPrep   : document.getElementById('paginaPrepEletrica'),
    produtoTab   : document.getElementById('produtoTab'),
    gestaoTab    : document.getElementById('gestaoTab'),
    miniCodigoEl : document.getElementById('produtoSelecionado'),
    ulMiniFila   : document.getElementById('prod-col-fila'),
    ulMiniEm     : document.getElementById('prod-col-emprod'),
    btnBaixarCsv : document.getElementById('btn-baixar-csv-gestao'),
    btnSqlGestao : document.getElementById('btn-sql-gestao'),
    btnIniciar   : document.getElementById('btn-iniciar'),
    btnFinalizar : document.getElementById('btn-finalizar'),
    estruturaWrapper: document.getElementById('estrutura-produto-wrapper'),
    estruturaBody   : document.getElementById('estrutura-produto-body'),
    estruturaMeta   : document.getElementById('estrutura-produto-meta'),
    fotoImg         : document.getElementById('produto-foto-img'),
    fotoPrev        : document.querySelector('.foto-nav.foto-prev'),
    fotoNext        : document.querySelector('.foto-nav.foto-next'),
    fotoCounter     : document.getElementById('produto-foto-counter'),
  };

  window.codigoSelecionado = null;
  let filaOpsCache = {};
  let fotosProdutoAtual = [];
  let fotoIndexAtual = 0;
  let fotosProdutoCodigoAtual = null;
  let estruturaProdutoAtual = null;
  let estruturaOpAtual = null;


  const hideEstrutura = () => {
    if (!els.estruturaWrapper || !els.estruturaBody) return;
    els.estruturaWrapper.hidden = true;
    els.estruturaBody.innerHTML = '';
    if (els.estruturaMeta) els.estruturaMeta.textContent = '';
    estruturaProdutoAtual = null;
    estruturaOpAtual = null;
  };

  const clearEstrutura = (mensagem = 'Nenhuma estrutura carregada.', isError = false) => {
    if (!els.estruturaWrapper || !els.estruturaBody) return;
    els.estruturaWrapper.hidden = false;
    els.estruturaBody.innerHTML = `<tr><td colspan="4" class="${isError ? 'error' : 'empty'}">${mensagem}</td></tr>`;
    if (els.estruturaMeta) els.estruturaMeta.textContent = '';
  };

  const renderEstrutura = (payload) => {
    if (!els.estruturaWrapper || !els.estruturaBody) return;
    els.estruturaWrapper.hidden = false;
    const itens = Array.isArray(payload?.itens) ? payload.itens : [];
    if (!itens.length) {
      clearEstrutura('Estrutura não encontrada para esta OP.');
      return;
    }
    const meta = payload?.meta || {};
    if (els.estruturaMeta) {
      const partes = [];
      if (meta.versao) partes.push(`Versão v${meta.versao}`);
      if (meta.custom_suffix) partes.push(`Customização ${meta.custom_suffix}`);
      if (meta.origem) partes.push(`Fonte: ${meta.origem}`);
      els.estruturaMeta.textContent = partes.join(' • ');
    }
    const frag = document.createDocumentFragment();
    itens.forEach(item => {
      const tr = document.createElement('tr');
      if (item.customizado) tr.classList.add('customizado');
      const codigoPrincipal = item.codigo || item.codigo_original || '';
      const descricao = item.descricao || '';
      const quantidade = Number(item.quantidade ?? 0);
      const unidade = item.unidade || '';
      const tdCodigo = document.createElement('td');
      tdCodigo.innerHTML = `<div>${codigoPrincipal || '—'}</div>`;
      if (item.customizado && item.codigo_original && item.codigo_original !== codigoPrincipal) {
        const small = document.createElement('div');
        small.className = 'small';
        small.textContent = `Original: ${item.codigo_original}`;
        tdCodigo.appendChild(small);
      }
      const tdDesc = document.createElement('td');
      tdDesc.textContent = descricao || '—';
      const tdQtd = document.createElement('td');
      tdQtd.textContent = quantidade
        ? quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
        : '0';
      const tdUnid = document.createElement('td');
      tdUnid.textContent = unidade || '—';
      tr.append(tdCodigo, tdDesc, tdQtd, tdUnid);
      frag.appendChild(tr);
    });
    els.estruturaBody.replaceChildren(frag);
  };

  const atualizaFilaCache = (map) => { filaOpsCache = map || {}; };

  const findFilaEntryForOp = (opInput) => {
    if (!opInput) return null;
    const key = opInput.toUpperCase();
    if (filaOpsCache[key]) return filaOpsCache[key];
    const base = key.split('-')[0];
    if (base && filaOpsCache[base]) return filaOpsCache[base];
    if (base.startsWith('OP') && filaOpsCache['OPS' + base.slice(2)]) return filaOpsCache['OPS' + base.slice(2)];
    if (base.startsWith('OPS') && filaOpsCache['OP' + base.slice(3)]) return filaOpsCache['OP' + base.slice(3)];
    return null;
  };

  const carregarEstruturaPersonalizada = async (opCompleta, filaEntry) => {
    if (!filaEntry) {
      hideEstrutura();
      return false;
    }
    clearEstrutura('Carregando estrutura…');
    try {
      const resp = await fetch(`${API_BASE}/preparacao/op/estrutura`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          op: opCompleta,
          produtoCodigo: filaEntry.produto_codigo_alfa || filaEntry.produto_codigo || ''
        })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json?.ok === false) throw new Error(json?.error || 'Resposta inválida.');
      renderEstrutura(json);
      estruturaProdutoAtual = (filaEntry.produto_codigo_alfa || filaEntry.produto_codigo || '').trim().toUpperCase() || null;
      estruturaOpAtual = opCompleta ? opCompleta.toUpperCase() : null;
      if (Array.isArray(fotosProdutoAtual) && fotosProdutoAtual.length > 1) {
        fotoIndexAtual = Math.min(1, fotosProdutoAtual.length - 1);
        renderFotoAtual();
      }
      if (typeof window.renderMiniKanban === 'function' && window.codigoSelecionado) {
        setTimeout(() => {
          try {
            window.renderMiniKanban(window.codigoSelecionado, window.codigoSelecionadoCP || null);
          } catch (err) {
            console.warn('[prep-eletrica] falha ao atualizar mini-kanban após etapa:', err);
          }
        }, 80);
      }
      return true;
    } catch (err) {
      console.error('[prep-eletrica] estrutura personalizada', err);
      clearEstrutura(`Falha ao carregar estrutura: ${err?.message || err}`, true);
      return false;
    }
  };

  const renderFotoAtual = () => {
    const imgEl = els.fotoImg;
    if (!imgEl) return;
    const total = Array.isArray(fotosProdutoAtual) ? fotosProdutoAtual.length : 0;
    if (total === 0) {
      imgEl.src = '../img/logo.png';
      imgEl.style.objectFit = 'contain';
      if (els.fotoCounter) els.fotoCounter.textContent = '';
      if (els.fotoPrev) els.fotoPrev.hidden = true;
      if (els.fotoNext) els.fotoNext.hidden = true;
      return;
    }

    if (fotoIndexAtual >= total) fotoIndexAtual = 0;
    if (fotoIndexAtual < 0) fotoIndexAtual = total - 1;
    const atual = fotosProdutoAtual[fotoIndexAtual] || null;
    const rawUrl = atual?.url_imagem || atual?.url || null;
    const url = normalizeImageUrl(rawUrl);

    if (url) {
      imgEl.src = url;
      imgEl.style.objectFit = 'cover';
    } else {
      imgEl.src = '../img/logo.png';
      imgEl.style.objectFit = 'contain';
    }

    if (els.fotoCounter) {
      els.fotoCounter.textContent = `${fotoIndexAtual + 1}/${total}`;
      els.fotoCounter.hidden = total <= 1;
    }
    const hasMultiple = total > 1;
    if (els.fotoPrev) {
      els.fotoPrev.hidden = !hasMultiple;
      els.fotoPrev.disabled = !hasMultiple;
    }
    if (els.fotoNext) {
      els.fotoNext.hidden = !hasMultiple;
      els.fotoNext.disabled = !hasMultiple;
    }
  };

  async function loadFotosProduto(codigoPreferencial, codigoNumerico = null) {
    const codigo = String(codigoPreferencial || codigoNumerico || '').trim();
    const codigoUpper = codigo.toUpperCase() || null;

    if (codigoUpper && fotosProdutoCodigoAtual === codigoUpper && fotosProdutoAtual.length) {
      renderFotoAtual();
      return;
    }

    fotosProdutoAtual = [];
    fotoIndexAtual = 0;
    fotosProdutoCodigoAtual = codigoUpper;

    if (!codigoUpper) {
      fotosProdutoCodigoAtual = null;
      renderFotoAtual();
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/produtos/${encodeURIComponent(codigo)}/fotos`, {
        cache: 'no-store',
        credentials: 'include'
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const fotos = Array.isArray(json?.fotos) ? json.fotos.slice() : [];
      fotos.sort((a, b) => Number(a.pos || 0) - Number(b.pos || 0));
      fotosProdutoAtual = fotos;
      fotoIndexAtual = 0;
    } catch (err) {
      console.warn('[prep-eletrica] falha ao carregar fotos do produto:', err);
      fotosProdutoAtual = [];
      fotoIndexAtual = 0;
      fotosProdutoCodigoAtual = codigoUpper;
    }

    renderFotoAtual();
  }

  els.fotoPrev?.addEventListener('click', () => {
    const total = Array.isArray(fotosProdutoAtual) ? fotosProdutoAtual.length : 0;
    if (total <= 1) return;
    fotoIndexAtual = (fotoIndexAtual - 1 + total) % total;
    renderFotoAtual();
  });

  els.fotoNext?.addEventListener('click', () => {
    const total = Array.isArray(fotosProdutoAtual) ? fotosProdutoAtual.length : 0;
    if (total <= 1) return;
    fotoIndexAtual = (fotoIndexAtual + 1) % total;
    renderFotoAtual();
  });

  renderFotoAtual();

  hideEstrutura();

  /* ----- Tabs ----- */
  const setActiveTab = (activeEl) => {
    document.querySelectorAll('#mainMenu .menu-link').forEach(a => {
      a.classList.remove('is-active');
      a.setAttribute('aria-selected','false');
    });
    if (activeEl) {
      activeEl.classList.add('is-active');
      activeEl.setAttribute('aria-selected','true');
    }
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  };

  els.menuInicio?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(els.menuInicio);
    els.paginaPrep.style.display = 'block';
    els.paginaPrep.classList.add('fade-in');
    hideEstrutura();
  });

  els.menuProduto?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(els.menuProduto);
    els.produtoTab.style.display = 'block';
    els.produtoTab.classList.add('fade-in');
    if (window.codigoSelecionado) renderMiniKanban(window.codigoSelecionado);
    else {
      els.miniCodigoEl.textContent = '';
      els.ulMiniFila.innerHTML = '<li class="empty">Selecione um item na Fila de produção</li>';
      els.ulMiniEm.innerHTML = '<li class="empty">—</li>';
      hideEstrutura();
    }
    setTimeout(fitProdutoKanbanHeight, 50);
  });

  els.menuGestao?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(els.menuGestao);
    els.gestaoTab.style.display = 'block';
    els.gestaoTab.classList.add('fade-in');
  });

  /* ----- Ações Gestao ----- */
  (function setupGestaoTab(){
    const sideBox = document.querySelector('#gestaoTab .side-actions');
    if (!sideBox) return;
    const sqlMenu = document.createElement('div');
    sqlMenu.className = 'sql-menu'; sqlMenu.setAttribute('role','menu');
    sqlMenu.innerHTML = `
      <button data-act="last100" role="menuitem">Últimos 100</button>
      <button data-act="byop" role="menuitem">Digite a OP…</button>
      <button data-act="today" role="menuitem">Hoje</button>
      <button data-act="range" role="menuitem">Entre datas…</button>`;
    sideBox.appendChild(sqlMenu);

    els.btnSqlGestao?.addEventListener('click', () => {
      sqlMenu.classList.toggle('open');
      els.btnSqlGestao.setAttribute('aria-expanded', sqlMenu.classList.contains('open'));
    });
    document.addEventListener('click', (e) => {
      if (!sqlMenu.contains(e.target) && e.target !== els.btnSqlGestao) {
        sqlMenu.classList.remove('open');
        els.btnSqlGestao?.setAttribute('aria-expanded','false');
      }
    });

    const openEventosQuery = (query) => {
      const csv = confirm('Baixar CSV? (OK = CSV, Cancelar = ver JSON)');
      const base = csv ? `${API_BASE}/preparacao/eventos.csv` : `${API_BASE}/preparacao/eventos`;
      const url = `${base}?${new URLSearchParams(query).toString()}`;
      if (csv) { const a=document.createElement('a'); a.href=url; a.download='op_eventos.csv'; document.body.appendChild(a); a.click(); a.remove(); }
      else { window.open(url,'_blank'); }
    };

    sqlMenu.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act; if (!act) return;
      sqlMenu.classList.remove('open');
      els.btnSqlGestao?.setAttribute('aria-expanded','false');
      switch (act) {
        case 'last100': openEventosQuery({ limit:'100', order:'desc' }); break;
        case 'byop': { const op=prompt('Digite a OP (ex.: P101086):'); if(op) openEventosQuery({ op: op.trim().toUpperCase() }); break; }
        case 'today': { const d=new Date(); const ds=d.toISOString().split('T')[0]; openEventosQuery({ from:ds, to:ds }); break; }
        case 'range': { const de=prompt('Data inicial (AAAA-MM-DD):'); if(!de) return; const ate=prompt('Data final (AAAA-MM-DD):'); if(!ate) return; openEventosQuery({ from:de.trim(), to:ate.trim() }); break; }
      }
    });

    els.btnBaixarCsv?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = `${API_BASE}/preparacao/csv`; a.download = 'preparacao.csv';
      document.body.appendChild(a); a.click(); a.remove();
    });
  })();

  /* ----- Clique robusto nas listas principais ----- */
  function wireKanbanClicks() {
    ['coluna-prep-fila','coluna-prep-em-producao'].forEach((id) => {
      const ul = document.getElementById(id); if (!ul || ul.__wired) return;
      ul.__wired = true;
      ul.addEventListener('click', (e) => {
        const li = e.target?.closest?.('li'); if (!li || li.classList.contains('empty')) return;
        const codigo =
          li.dataset?.codigo ||
          li.querySelector('[data-codigo]')?.dataset?.codigo ||
          li.querySelector('.codigo')?.textContent?.trim() || '';
        const cp =
          li.dataset?.cp || li.getAttribute('data-cp') ||
          li.querySelector('[data-cp]')?.dataset?.cp || '';
        if (!codigo && !cp) return;
        window.codigoSelecionado   = codigo;
        window.codigoSelecionadoCP = cp;
        window.ativarAbaProduto();
        hideEstrutura();
        window.renderMiniKanban(codigo, cp);
      }, { passive:true });
    });
  }
  wireKanbanClicks();

  window.ativarAbaProduto = function(){
    setActiveTab(els.menuProduto);
    els.produtoTab.style.display='block';
    els.produtoTab.classList.add('fade-in');
  };

  /* ----- Altura das listas (aba Produto) ----- */
  function fitProdutoKanbanHeight() {
    const limits = [];
    ['#produtoTab .content-wrapper','#produtoTab','main'].forEach(sel => {
      const el = document.querySelector(sel); if (!el) return;
      const r = el.getBoundingClientRect(); if (r.bottom>0) limits.push(r.bottom);
    });
    limits.push(window.innerHeight);
    const yLimit = Math.min(...limits);
    const padBottom = 16;
  ['prod-col-fila','prod-col-emprod'].forEach(id => {
      const ul = document.getElementById(id); if (!ul) return;
      const top = ul.getBoundingClientRect().top;
      const available = Math.max(100, Math.floor(yLimit - top - padBottom));
      const desired = 10 * 72; // altura aproximada para 10 cards
      const maxHeight = Math.min(Math.max(desired, available), Math.max(desired, window.innerHeight - 60));
      ul.style.maxHeight = `${Math.max(220, maxHeight)}px`;
      ul.style.overflowY = 'auto';
    });
  }
  window.addEventListener('resize', fitProdutoKanbanHeight);
  fitProdutoKanbanHeight();

  /* ----- Mini Kanban (aba Produto) ----- */
  async function renderMiniKanban(codigoAlfa, codigoProdutoNum=null){
    const rid = (window.__miniRID = (window.__miniRID || 0) + 1);
    const headerEl   = document.getElementById('produtoSelecionado');
    const ulMiniFila = document.getElementById('prod-col-fila');
    const ulMiniEm   = document.getElementById('prod-col-emprod');
    if (headerEl) headerEl.textContent = `Produto — ${codigoAlfa || ''}`;
    if (!ulMiniFila || !ulMiniEm) return;

    try {
      const codAlfa = String(codigoAlfa || '').trim();
      const codNum  = codigoProdutoNum ? String(codigoProdutoNum).trim() : null;

      const produtoRef = (codAlfa || codNum || '').toUpperCase();
      if (!estruturaProdutoAtual || estruturaProdutoAtual !== produtoRef) {
        hideEstrutura();
      }

      await loadFotosProduto(codAlfa || null, codNum || null);

      const prepResp = await fetch(`${API_BASE}/preparacao/listar`, { cache: 'no-store', credentials: 'include' })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)));

      const prepData  = prepResp?.data || {};
      const filaRaw   = prepData['A Produzir'] || [];
      const emprod    = prepData['Produzindo'] || [];

      const fila = filaRaw.map(reg => ({
        op: String(reg?.numero_op || reg?.op || '').trim(),
        produto_codigo: String(reg?.produto_codigo || reg?.codigo_produto || reg?.codigo || '').trim()
      })).filter(entry => entry.op);

      const todasReferencias = fila.concat(emprod);
      const cps = [];
      todasReferencias.forEach(c => {
        const cp = String(c.produto_codigo || '').trim();
        if (/^\d+$/.test(cp) && !cps.includes(cp)) cps.push(cp);
      });

      let cpToAlpha = {};
      if (cps.length) {
        const qs = cps.map(cp => 'cp=' + encodeURIComponent(cp)).join('&');
        try {
          const r = await fetch(`${API_BASE}/produtos/codigos?${qs}`, { credentials: 'include' });
          const j = await r.json();
          cpToAlpha = j?.data || {};
        } catch (e) {
          console.warn('[prep-eletrica] falha ao mapear CP → código:', e);
        }
      }
      const alphaFromCP = (cp) => (cpToAlpha[cp]?.codigo) || null;

      const matchProd = (registro) => {
        const cp   = String(registro.produto_codigo || '').trim();
        const alfa = alphaFromCP(cp) || cp;
        if (codNum  && cp   === codNum)  return true;
        if (codAlfa && alfa === codAlfa) return true;
        if (!codAlfa && !codNum && alfa) return true;
        return false;
      };

      const dedupeByOp = (arr) => {
        const seen = Object.create(null);
        const out = [];
        arr.forEach(c => {
          const key = String(c.op || '').trim();
          if (!key || seen[key]) return;
          seen[key] = 1;
          out.push(c);
        });
        return out;
      };

      let listaFila   = dedupeByOp(fila.filter(matchProd));
      let listaEmProd = dedupeByOp(emprod.filter(matchProd));
      const emOps = {}; listaEmProd.forEach(x => { if (x?.op) emOps[x.op] = 1; });
      listaFila = listaFila.filter(x => !emOps[x.op]);

      if (rid !== window.__miniRID) return;
      const opMap = {};
      const registrar = (entry) => {
        const opKey = (entry?.op || '').trim().toUpperCase();
        if (!opKey) return;
        const cp = String(entry.produto_codigo || '').trim();
        const alfa = alphaFromCP(cp) || cp;
        const payload = {
          op: opKey,
          produto_codigo: cp,
          produto_codigo_alfa: alfa
        };
        opMap[opKey] = payload;
        const base = opKey.split('-')[0];
        if (base && !opMap[base]) opMap[base] = payload;
        if (base.startsWith('OP') && !opMap['OPS' + base.slice(2)]) {
          opMap['OPS' + base.slice(2)] = payload;
        }
        if (base.startsWith('OPS') && !opMap['OP' + base.slice(3)]) {
          opMap['OP' + base.slice(3)] = payload;
        }
      };
      listaFila.forEach(registrar);
      listaEmProd.forEach(registrar);
      atualizaFilaCache(opMap);

      let etapasEtiquetas = {};
      const opKeys = Object.keys(opMap);
      if (opKeys.length) {
        try {
          const respStage = await fetch(`${API_BASE}/etiquetas/op/etapas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ops: opKeys })
          });
          const jsonStage = await respStage.json().catch(() => ({}));
          if (respStage.ok && jsonStage && jsonStage.data) {
            etapasEtiquetas = {};
            Object.entries(jsonStage.data).forEach(([opKey, stage]) => {
              if (!opKey) return;
              etapasEtiquetas[String(opKey).trim().toUpperCase()] = stage ? String(stage).trim() : null;
            });
          }
        } catch (err) {
          console.warn('[prep-eletrica] falha ao consultar etapas das etiquetas:', err);
        }
      }

      const filaAjustada = [];
      listaFila.forEach(entry => {
        const opKey = String(entry?.op || '').trim().toUpperCase();
        const etapaEtiqueta = (etapasEtiquetas[opKey] || '').toUpperCase();
        if (etapaEtiqueta === 'PRODUZINDO') {
          if (!emOps[entry.op]) {
            listaEmProd.push(entry);
            emOps[entry.op] = 1;
          }
        } else {
          filaAjustada.push(entry);
        }
      });
      listaFila = filaAjustada;

      const fragFila = document.createDocumentFragment();
      const fragEm   = document.createDocumentFragment();
      const pushLi = (frag, entry) => {
        const li = document.createElement('li');
        li.className = 'kanban-card';
        const opCode = (entry?.op || entry || '').trim();
        li.textContent = opCode || '—';
        if (entry?.op) {
          li.dataset.op = entry.op;
          if (entry.produto_codigo) li.dataset.produtoCodigo = entry.produto_codigo;
          li.addEventListener('click', () => {
            const alvo = findFilaEntryForOp(entry.op);
            if (alvo) {
              carregarEstruturaPersonalizada(entry.op, alvo);
            } else {
              clearEstrutura('OP não pertence a este produto.', true);
            }
          }, { passive: true });
        }
        frag.appendChild(li);
      };
      if (!listaEmProd.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '—';
        fragEm.appendChild(li);
      } else {
        listaEmProd.forEach(c => pushLi(fragEm, c));
      }
      if (!listaFila.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '—';
        fragFila.appendChild(li);
      } else {
        listaFila.forEach(c => pushLi(fragFila, c));
      }
      if (rid !== window.__miniRID) return;
      ulMiniEm.replaceChildren(fragEm);
      ulMiniFila.replaceChildren(fragFila);
    } catch (err) {
      if (rid !== window.__miniRID) return;
      fotosProdutoAtual = [];
      fotoIndexAtual = 0;
      renderFotoAtual();
      ulMiniEm.innerHTML  = '<li class="empty">Erro carregando dados</li>';
      ulMiniFila.innerHTML = '';
    }
    fitProdutoKanbanHeight();
  }
  window.renderMiniKanban = renderMiniKanban;

  /* ===== QR Code (iniciar / concluir) ===== */
  (function setupQRFunctionality(){
    const modal     = document.getElementById('qrModal');
    const btnClose  = document.getElementById('qrClose');
    const inputOP   = document.getElementById('qrManual');
    const btnOP     = document.getElementById('qrManualBtn');
    const btnIniciar   = els.btnIniciar;
    const btnFinalizar = els.btnFinalizar;

    function showModal(){
      modal.style.display = 'flex';
      modal.classList.add('open');
      modal.setAttribute('aria-hidden','false');
      lockQrSquare();
      window.addEventListener('resize', lockQrSquare, { passive:true });

      // NÃO abrir teclado automaticamente:
      inputOP.removeAttribute('autofocus');
      inputOP.setAttribute('readonly','readonly');
      const enableTyping = () => {
        inputOP.removeAttribute('readonly');
        inputOP.focus({ preventScroll:true });
      };
      inputOP.addEventListener('touchstart', enableTyping, { once:true });
      inputOP.addEventListener('mousedown' , enableTyping, { once:true });
    }

    async function hideModal(){
      try { if (window.qrReader){ await window.qrReader.stop(); await window.qrReader.clear(); } } catch {}
      // Remover foco antes de aria-hidden (evita warning de acessibilidade)
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
      modal.style.display = 'none';
      inputOP.value = '';
    }

    // === Extrai a OP a partir do texto do QR ===
    function extractOP(raw){
      if (!raw) return '';
      const s = String(raw).trim();
      const pattern = /(OPS?\d+(?:-V\d+(?:C\d+)?)?)/i;
      const m = s.match(pattern);
      if (m && m[1]) return m[1].toUpperCase();
      try {
        const u = new URL(String(raw));
        const qp = u.searchParams.get('op');
        if (qp) {
          const qpm = String(qp).match(pattern);
          if (qpm && qpm[1]) return qpm[1].toUpperCase();
        }
      } catch {}
      const generic = s.match(/\b([A-Za-z]\d{5,})\b/);
      if (generic && generic[1]) return generic[1].toUpperCase();
      return s.toUpperCase();
    }

    let processing = false;
    async function handleOP(op, acao){
      op = extractOP(op);
      if (!op || processing) return;
      processing = true;
      try {
        const filaEntry = findFilaEntryForOp(op);
        if (acao === 'iniciar' && !filaEntry) {
          alert('OP não pertence a este produto.');
          processing = false;
          return;
        }
        if (acao === 'iniciar' && filaEntry) {
          const ok = await carregarEstruturaPersonalizada(op, filaEntry);
          if (ok === false) {
            processing = false;
            return;
          }
        }
        if (window.qrReader){ try { await window.qrReader.stop(); await window.qrReader.clear(); } catch {} }
        if (acao === 'iniciar')      await Preparacao.iniciarProducao(op);
        else if (acao === 'concluir')await Preparacao.finalizarProducao(op);
        await hideModal();
      } catch (err) {
        alert('Falha ao processar OP '+ op +': ' + (err?.message || err));
      } finally { processing = false; }
    }
    // expõe global para qualquer chamada antiga
    window.handleOP = handleOP;

    // Botão "Usar valor" (manual) + Enter
    btnOP?.addEventListener('click', () => {
      const v = inputOP.value;
      if (!v.trim()) { alert('Digite uma OP'); return; }
      const acao = modal.dataset.acao || 'iniciar';
      handleOP(v, acao);
    });
    inputOP?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const v = inputOP.value;
        if (!v.trim()) { alert('Digite uma OP'); return; }
        const acao = modal.dataset.acao || 'iniciar';
        handleOP(v, acao);
      }
    });

    btnClose?.addEventListener('click', hideModal);

    async function startWithConfig(camConfig, acao, qrSide){
      window.qrReader = new Html5Qrcode('qrReader');
      await window.qrReader.start(
        camConfig,
        { fps:10, qrbox:{ width:qrSide, height:qrSide }, showScanRegionOutline:true, aspectRatio:1.0, disableFlip:true, rememberLastUsedCamera:true },
        (decoded) => { handleOP(decoded, acao); },
        () => {}
      );
    }

    async function startQr(acao){
      showModal();
      await sleep(60);
      const side = document.getElementById('qrReader');
      const size = side?.clientWidth || 320;
      const qrSide = Math.max(220, Math.min(380, Math.floor(size * 0.80)));
      try {
        await startWithConfig({ facingMode: 'environment' }, acao, qrSide);
      } catch (err1) {
        try {
          const cams = await Html5Qrcode.getCameras();
          if (!cams || !cams.length) throw err1;
          const pick = cams.find(c => /back|trás|rear|environment|traseira/i.test(c.label)) || cams[cams.length-1];
          await startWithConfig({ deviceId: { exact: pick.id } }, acao, qrSide);
        } catch (err2) {
          alert('Não foi possível acessar a câmera: ' + (err2?.message || err2));
        }
      }
    }

    btnIniciar?.addEventListener('click', (e) => { e.preventDefault(); modal.dataset.acao='iniciar'; startQr('iniciar'); });
    btnFinalizar?.addEventListener('click', (e) => { e.preventDefault(); modal.dataset.acao='concluir'; startQr('concluir'); });
  })();

  /* ----- SSE / Atualização ao vivo ----- */
  (function setupLiveUpdates(){
    let debounceId;
    const refresh = async () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(async () => {
        try {
          await initPreparacaoKanban();
          // re-wire clicks e mini-kanban se necessário
          if (typeof window.renderMiniKanban === 'function' && window.codigoSelecionado) {
            await window.renderMiniKanban(window.codigoSelecionado);
          }
        } catch (e) { console.warn('[prep-eletrica] refresh falhou:', e); }
      }, 300);
    };
    try {
      const es = new EventSource(`${API_BASE}/produtos/stream`);
      es.onmessage = (event) => { try { const msg = JSON.parse(event.data); if (msg?.type === 'hello') return; } catch{} refresh(); };
      es.onerror   = (err) => { console.warn('[SSE] erro:', err); };
      window.addEventListener('beforeunload', () => { try { es.close(); } catch{} });
    } catch {
      setInterval(refresh, 30000);
    }
  })();

}); // DOMContentLoaded

// ===== Voltar ao menu pelo logo (tolerante a HTML antigo, preventDefault e caminhos) =====
(function () {
  const onReady = (fn) =>
    (document.readyState === 'loading')
      ? document.addEventListener('DOMContentLoaded', fn, { once: true })
      : fn();

  function guessMenuURL() {
    // Se o <a id="logo-link"> existir e tiver href, respeita-o
    const href = document.getElementById('logo-link')?.getAttribute('href');
    if (href && href.trim()) return href.trim();

    // Caso contrário, deduz pelo caminho da página
    const p = location.pathname || '';
    // Se estiver dentro de /pst_prep_eletrica/, o menu provavelmente está um nível acima
    if (p.includes('/pst_prep_eletrica/')) return '../menu_produto.html';
    // fallback genérico (mesmo nível)
    return './menu_produto.html';
  }

  function isLogoNode(n) {
    if (!n || n === document) return false;
    if (n.matches?.('#logo-link, header .menu-logo, header img[alt="Logo da empresa"], header .logo')) return true;
    return false;
  }

  function getPathNodes(e) {
    if (e.composedPath) return e.composedPath();
    const arr = []; let n = e.target;
    while (n) { arr.push(n); n = n.parentNode; }
    return arr;
  }

  onReady(() => {
    const MENU_URL = guessMenuURL();

    // “mãozinha” e clique garantido no cabeçalho
    document.querySelectorAll('header .menu-logo, header .logo, #logo-link img').forEach(img => {
      img.style.cursor = 'pointer';
      img.style.pointerEvents = 'auto';
    });

    // Clique do mouse (captura) -> navega
    document.addEventListener('click', (e) => {
      const path = getPathNodes(e);
      if (!path.some(isLogoNode)) return;

      // respeita cliques modificados (abrir nova aba, etc.)
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      e.preventDefault();
      e.stopPropagation();
      window.location.assign(MENU_URL);
    }, true);

    // Teclado (Enter/Espaço) quando o foco estiver no logo/link
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = document.activeElement;
      if (!isLogoNode(el)) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(MENU_URL);
    }, true);
  });
})();



export const __debug_fitHeight = () => { try { window.dispatchEvent(new Event('resize')); } catch {} };
