
/* ==============================================
   PREPARAÇÃO ELÉTRICA — JS (atualizado)
   - Mantém tudo que já funcionava (abas, mini-kanban, foto)
   - Clique robusto nos cards para abrir a aba Produto
   - Modal do QR abre SEM teclado (campo fica readonly até tocar)
   - Fluxo unificado: leitura via QR == clique "Usar valor"
   - Leitor quadrado (overlay correto em tablets), com contorno
   ============================================== */

import { initPreparacaoKanban } from '../kanban/kanban_preparacao.js';

/* ---------- Base de API ---------- */
export const API_BASE = (() => {
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta && meta.content) return meta.content.replace(/\/$/, '');
  if (location.hostname.endsWith('onrender.com')) return `https://${location.host}/api`;
  return '/api';
})();

/* ---------- Util ---------- */
function normalizeImageUrl(imgUrl) {
  if (!imgUrl) return null;
  try {
    const u = new URL(String(imgUrl), location.href);
    if (location.protocol === 'https:' && u.protocol === 'http:') u.protocol = 'https:';
    return u.toString();
  } catch { return imgUrl; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const forceTop = () => { try { window.scrollTo(0, 0); } catch {} };

/* ---------- Deixa o #qrReader quadrado (também em tablets antigos) ---------- */
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
    ulMiniEmProd : document.getElementById('prod-col-emprod'),
    btnBaixarCsv : document.getElementById('btn-baixar-csv-gestao'),
    btnSqlGestao : document.getElementById('btn-sql-gestao'),
    btnIniciar   : document.getElementById('btn-iniciar'),
    btnFinalizar : document.getElementById('btn-finalizar'),
  };

  window.codigoSelecionado = null;

  /* ----- Tabs ----- */
  const setActiveTab = (activeEl) => {
    document.querySelectorAll('#mainMenu .menu-link').forEach(a => {
      a.classList.remove('is-active');
      a.setAttribute('aria-selected', 'false');
    });
    if (activeEl) {
      activeEl.classList.add('is-active');
      activeEl.setAttribute('aria-selected', 'true');
    }
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
  };

  els.menuInicio && els.menuInicio.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(els.menuInicio);
    els.paginaPrep.style.display = 'block';
    els.paginaPrep.classList.add('fade-in');
  });

  els.menuProduto && els.menuProduto.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(els.menuProduto);
    els.produtoTab.style.display = 'block';
    els.produtoTab.classList.add('fade-in');
    if (window.codigoSelecionado) renderMiniKanban(window.codigoSelecionado);
    else {
      els.miniCodigoEl.textContent = '';
      els.ulMiniFila.innerHTML = '<li class="empty">Selecione um item na Fila de produção</li>';
      els.ulMiniEmProd.innerHTML = '<li class="empty">—</li>';
    }
    setTimeout(fitProdutoKanbanHeight, 50);
  });

  els.menuGestao && els.menuGestao.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(els.menuGestao);
    els.gestaoTab.style.display = 'block';
    els.gestaoTab.classList.add('fade-in');
  });

  /* ----- Ações de gestão simples ----- */
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

    els.btnSqlGestao && els.btnSqlGestao.addEventListener('click', () => {
      sqlMenu.classList.toggle('open');
      els.btnSqlGestao.setAttribute('aria-expanded', sqlMenu.classList.contains('open'));
    });
    document.addEventListener('click', (e) => {
      if (!sqlMenu.contains(e.target) && e.target !== els.btnSqlGestao) {
        sqlMenu.classList.remove('open');
        els.btnSqlGestao && els.btnSqlGestao.setAttribute('aria-expanded','false');
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
      const act = e.target && e.target.dataset && e.target.dataset.act;
      if (!act) return;
      sqlMenu.classList.remove('open');
      els.btnSqlGestao && els.btnSqlGestao.setAttribute('aria-expanded','false');
      switch (act) {
        case 'last100': openEventosQuery({ limit:'100', order:'desc' }); break;
        case 'byop': {
          const op = prompt('Digite a OP (ex.: P101086):'); if(op) openEventosQuery({ op: op.trim().toUpperCase() });
          break;
        }
        case 'today': {
          const d=new Date(); const dateStr=d.toISOString().split('T')[0]; openEventosQuery({ from:dateStr, to:dateStr });
          break;
        }
        case 'range': {
          const de=prompt('Data inicial (AAAA-MM-DD):'); if(!de) return;
          const ate=prompt('Data final (AAAA-MM-DD):'); if(!ate) return;
          openEventosQuery({ from:de.trim(), to:ate.trim() }); break;
        }
      }
    });

    els.btnBaixarCsv && els.btnBaixarCsv.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = `${API_BASE}/preparacao/csv`; a.download = 'preparacao.csv';
      document.body.appendChild(a); a.click(); a.remove();
    });
  })();

  /* ----- Clique robusto nas listas principais ----- */
  function wireKanbanClicks() {
    ['coluna-prep-fila', 'coluna-prep-em-producao'].forEach((id) => {
      const ul = document.getElementById(id);
      if (!ul || ul.__wired) return;
      ul.__wired = true;
      ul.addEventListener('click', (e) => {
        const li = e.target && e.target.closest ? e.target.closest('li') : null;
        if (!li || li.classList.contains('empty')) return;
        const codigo =
          (li.dataset && li.dataset.codigo) ||
          (li.querySelector('[data-codigo]') && li.querySelector('[data-codigo]').dataset.codigo) ||
          (li.querySelector('.codigo') && li.querySelector('.codigo').textContent.trim()) ||
          '';
        const cp =
          (li.dataset && (li.dataset.cp || li.getAttribute('data-cp'))) ||
          (li.querySelector('[data-cp]') && li.querySelector('[data-cp]').dataset.cp) ||
          '';
        if (!codigo && !cp) return;
        window.codigoSelecionado   = codigo;
        window.codigoSelecionadoCP = cp;
        window.ativarAbaProduto();
        window.renderMiniKanban(codigo, cp);
      }, { passive: true });
    });
  }
  wireKanbanClicks();

  window.ativarAbaProduto = function(){
    setActiveTab(els.menuProduto);
    els.produtoTab.style.display='block';
    els.produtoTab.classList.add('fade-in');
  };

  /* ----- Foto do produto ----- */
  async function fetchPrimeiraFoto(codigo) {
    if (!codigo) return null;
    const endpoint = `${API_BASE}/produtos/${encodeURIComponent(codigo)}/fotos`;
    try {
      const resp = await fetch(endpoint, { cache:'no-store', credentials:'include' });
      if (!resp.ok) return null;
      const j = await resp.json();
      const arr = Array.isArray(j && j.fotos) ? j.fotos : (Array.isArray(j && j.data) ? j.data : []);
      if (!arr.length) return null;
      const ord = arr.slice().sort((a,b)=>Number(a.pos||0)-Number(b.pos||0));
      const f0 = ord[0];
      const raw = (f0 && (f0.url_imagem || f0.url || f0.imagem)) || null;
      return normalizeImageUrl(raw);
    } catch { return null; }
  }

  async function updateProdutoFotoFrame(codigoPreferencial) {
    const img = document.getElementById('produto-foto-img');
    if (!img) return;
    let url = null;
    try { url = await fetchPrimeiraFoto(codigoPreferencial); } catch {}
    if (url) { img.src = url; img.style.objectFit='cover'; }
    else { img.src = '../img/logo.png'; img.style.objectFit='contain'; }
  }

  /* ----- Altura das listas (aba Produto) ----- */
  function fitProdutoKanbanHeight() {
    const limits = [];
    ['#produtoTab .content-wrapper','#produtoTab','main'].forEach(sel => {
      const el = document.querySelector(sel); if (!el) return;
      const r = el.getBoundingClientRect(); if (r.bottom>0) limits.push(r.bottom);
    });
    limits.push(window.innerHeight);
    const yLimit = Math.min.apply(Math, limits);
    const padBottom = 16;
    ['prod-col-fila','prod-col-emprod'].forEach(id => {
      const ul = document.getElementById(id); if (!ul) return;
      const top = ul.getBoundingClientRect().top;
      const available = Math.max(100, Math.floor(yLimit - top - padBottom));
      ul.style.maxHeight = `${available}px`; ul.style.overflowY = 'auto';
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
      const resp = await fetch(`${API_BASE}/preparacao/listar`, { cache:'no-store', credentials:'include' });
      const payload = await resp.json();
      const data   = (payload && payload.data) || {};
      const fila   = data['A Produzir'] || [];
      const emprod = data['Produzindo'] || [];

      const codAlfa = String(codigoAlfa || '').trim();
      const codNum  = codigoProdutoNum ? String(codigoProdutoNum).trim() : null;

      await updateProdutoFotoFrame(codAlfa || codNum || null);

      const all = fila.concat(emprod);
      const cps = [];
      all.forEach(c => {
        const cp = String(c.produto_codigo || '').trim();
        if (/^\d+$/.test(cp) && cps.indexOf(cp) === -1) cps.push(cp);
      });

      let cpToAlpha = {};
      if (cps.length) {
        const qs = cps.map(cp=>'cp='+encodeURIComponent(cp)).join('&');
        try {
          const r = await fetch(`${API_BASE}/produtos/codigos?`+qs, { credentials:'include' });
          const j = await r.json();
          cpToAlpha = (j && j.data) || {};
        } catch {}
      }
      const alphaFromCP = (cp) => (cpToAlpha[cp] && cpToAlpha[cp].codigo) || null;

      const matchProd = (c) => {
        const cp   = String(c.produto_codigo || '').trim();
        const alfa = alphaFromCP(cp) || cp;
        if (codNum  && cp   === codNum)  return true;
        if (codAlfa && alfa === codAlfa) return true;
        return false;
      };

      const dedupeByOp = (arr) => {
        const seen = Object.create(null); const out = [];
        arr.forEach(c => { const k=String(c.op||'').trim(); if(!k || seen[k]) return; seen[k]=1; out.push(c); });
        return out;
      };

      let listaFila   = dedupeByOp(fila.filter(matchProd));
      let listaEmProd = dedupeByOp(emprod.filter(matchProd));
      const emOps = {}; listaEmProd.forEach(x => emOps[x.op]=1);
      listaFila = listaFila.filter(x => !emOps[x.op]);

      if (rid !== window.__miniRID) return;
      const fragFila = document.createDocumentFragment();
      const fragEm   = document.createDocumentFragment();
      const pushLi = (frag, op) => { const li=document.createElement('li'); li.className='kanban-card'; li.textContent=op||'—'; frag.appendChild(li); };
      if (!listaEmProd.length) { const li=document.createElement('li'); li.className='empty'; li.textContent='—'; fragEm.appendChild(li); }
      else listaEmProd.forEach(c => pushLi(fragEm, c.op));
      if (!listaFila.length)   { const li=document.createElement('li'); li.className='empty'; li.textContent='—'; fragFila.appendChild(li); }
      else listaFila.forEach(c => pushLi(fragFila, c.op));
      if (rid !== window.__miniRID) return;
      ulMiniEm.replaceChildren(fragEm);
      ulMiniFila.replaceChildren(fragFila);
    } catch (err) {
      if (rid !== window.__miniRID) return;
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
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
      modal.style.display = 'none';
      inputOP.value = '';
    }

    let processing = false;
    const handleOP = async (op, acao) => {
      op = (op || '').trim().toUpperCase();
      if (!op || processing) return;
      processing = true;
      try {
        if (window.qrReader){ try { await window.qrReader.stop(); await window.qrReader.clear(); } catch {} }
        if (acao === 'iniciar')      await Preparacao.iniciarProducao(op);
        else if (acao === 'concluir')await Preparacao.finalizarProducao(op);
        await hideModal();
      } catch (err) {
        alert('Falha: ' + (err && err.message ? err.message : err));
      } finally { processing = false; }
    };

    async function startQr(acao){
      showModal();
      await sleep(50); // deixa o layout aplicar
      const side = document.getElementById('qrReader').clientWidth || 320;
      const qrSide = Math.max(220, Math.min(380, Math.floor(side * 0.80)));
      try {
        window.qrReader = new Html5Qrcode('qrReader');
        await window.qrReader.start(
          { facingMode: { ideal:'environment' } },
          { fps:10, qrbox:{ width:qrSide, height:qrSide }, aspectRatio:1.0, showScanRegionOutline:true, disableFlip:true, rememberLastUsedCamera:true },
          (decoded) => { handleOP(decoded, acao); },
          () => {}
        );
      } catch (e) {
        alert('Não foi possível acessar a câmera: ' + (e && e.message ? e.message : e));
      }
    }

    btnOP && btnOP.addEventListener('click', () => {
      const v = inputOP.value;
      if (!v.trim()) { alert('Digite uma OP'); return; }
      handleOP(v, modal.dataset.acao || 'iniciar');
    });
    inputOP && inputOP.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const v = inputOP.value;
        if (!v.trim()) { alert('Digite uma OP'); return; }
        handleOP(v, modal.dataset.acao || 'iniciar');
      }
    });

    btnClose && btnClose.addEventListener('click', hideModal);

    btnIniciar && btnIniciar.addEventListener('click', (e) => {
      e.preventDefault(); modal.dataset.acao = 'iniciar'; startQr('iniciar');
    });
    btnFinalizar && btnFinalizar.addEventListener('click', (e) => {
      e.preventDefault(); modal.dataset.acao = 'concluir'; startQr('concluir');
    });
  })();

  /* ----- SSE / Atualização ao vivo ----- */
  (function setupLiveUpdates(){
    let debounceId;
    const refresh = async () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(async () => {
        try {
          await initPreparacaoKanban();
          wireKanbanClicks();
          if (window.codigoSelecionado && typeof window.renderMiniKanban === 'function') {
            await window.renderMiniKanban(window.codigoSelecionado);
          }
        } catch (e) { console.warn('[prep-eletrica] refresh falhou:', e); }
      }, 250);
    };
    try {
      const es = new EventSource(`${API_BASE}/produtos/stream`);
      es.onmessage = (event) => { try { const msg = JSON.parse(event.data); if (msg && msg.type === 'hello') return; } catch{} refresh(); };
      es.onerror   = (err) => { console.warn('[SSE] erro:', err); };
      window.addEventListener('beforeunload', () => { try { es.close(); } catch{} });
    } catch {
      setInterval(refresh, 30000);
    }
  })();

}); // DOMContentLoaded

export const __debug_fitHeight = () => {
  try { window.dispatchEvent(new Event('resize')); } catch {}
};