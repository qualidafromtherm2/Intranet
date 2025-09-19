
/* ==============================================
   PREPARAÇÃO ELÉTRICA — JS (QR robusto p/ tablets)
   - Modal é (re)anexado ao <body> para evitar pais com transform/overflow
   - Abre o modal ANTES de iniciar a câmera
   - Aguarda dimensões > 0 do #qrReader e calcula qrbox dinamicamente
   - Faz retry de sizing antes de start; fallback se falhar
   - Para/limpa leitor anterior ao fechar/abrir
   - Mantém API_BASE e restante da página
   ============================================== */

import { initPreparacaoKanban } from '../kanban/kanban_preparacao.js';

/* ---------- Base de API ---------- */
export const API_BASE = (() => {
  const meta = document.querySelector('meta[name="api-base"]')?.content?.trim();
  if (meta) return meta.replace(/\/$/, '');
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

const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

/* ---------- Forçar topo ---------- */
const forceTop = () => { try { window.scrollTo(0,0); } catch(e){} };
document.addEventListener('DOMContentLoaded', forceTop);
document.getElementById('mainMenu')?.addEventListener('click', () => setTimeout(forceTop, 0));

/* ==================================================
   App
   ================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initPreparacaoKanban();

  const elements = {
    menuInicio: document.getElementById('menu-inicio'),
    menuProduto: document.getElementById('menu-produto'),
    menuGestao: document.getElementById('menu-gestao'),
    paginaPrep: document.getElementById('paginaPrepEletrica'),
    produtoTab: document.getElementById('produtoTab'),
    gestaoTab: document.getElementById('gestaoTab'),
    miniCodigoEl: document.getElementById('produtoSelecionado'),
    ulMiniFila: document.getElementById('prod-col-fila'),
    ulMiniEmProd: document.getElementById('prod-col-emprod'),
    btnBaixarCsv: document.getElementById('btn-baixar-csv-gestao'),
    btnSqlGestao: document.getElementById('btn-sql-gestao'),
    btnIniciar: document.getElementById('btn-iniciar'),
    btnFinalizar: document.getElementById('btn-finalizar'),
    ulFila: document.getElementById('coluna-prep-fila'),
    ulEmProd: document.getElementById('coluna-prep-em-producao')
  };

  window.codigoSelecionado = null;

  /* ----- Tabs ----- */
  const setActiveTab = (activeEl) => {
    document.querySelectorAll('#mainMenu .menu-link').forEach(a => {
      a.classList.remove('is-active'); a.setAttribute('aria-selected','false');
    });
    activeEl.classList.add('is-active'); activeEl.setAttribute('aria-selected','true');
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display='none');
  };

  elements.menuInicio?.addEventListener('click', (e) => {
    e.preventDefault(); setActiveTab(elements.menuInicio);
    elements.paginaPrep.style.display = 'block'; elements.paginaPrep.classList.add('fade-in');
  });

  elements.menuProduto?.addEventListener('click', (e) => {
    e.preventDefault(); setActiveTab(elements.menuProduto);
    elements.produtoTab.style.display = 'block'; elements.produtoTab.classList.add('fade-in');
    if (window.codigoSelecionado) renderMiniKanban(window.codigoSelecionado);
    else {
      elements.miniCodigoEl.textContent = '';
      elements.ulMiniFila.innerHTML = '<li class="empty">Selecione um item na Fila de produção</li>';
      elements.ulMiniEmProd.innerHTML = '<li class="empty">—</li>';
    }
    setTimeout(fitProdutoKanbanHeight, 50);
  });

  elements.menuGestao?.addEventListener('click', (e) => {
    e.preventDefault(); setActiveTab(elements.menuGestao);
    elements.gestaoTab.style.display = 'block'; elements.gestaoTab.classList.add('fade-in');
  });

  /* ----- Foto do produto ----- */
  async function fetchPrimeiraFoto(codigo) {
    if (!codigo) return null;
    const endpoint = `${API_BASE}/produtos/${encodeURIComponent(codigo)}/fotos`;
    try {
      const resp = await fetch(endpoint, { cache: 'no-store', credentials: 'include' });
      if (!resp.ok) return null;
      const j = await resp.json();
      const arr = Array.isArray(j?.fotos) ? j.fotos : (Array.isArray(j?.data) ? j.data : []);
      if (!arr.length) return null;
      const ord = arr.slice().sort((a,b)=>Number(a.pos||0)-Number(b.pos||0));
      const f0 = ord[0];
      const raw = f0?.url_imagem ?? f0?.url ?? f0?.imagem ?? null;
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

  /* ----- Altura listas (aba Produto) ----- */
  function fitProdutoKanbanHeight() {
    const limits = [];
    for (const sel of ['#produtoTab .content-wrapper','#produtoTab','main']) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect(); if (r.bottom>0) limits.push(r.bottom);
    }
    limits.push(window.innerHeight);
    const yLimit = Math.min(...limits);
    const padBottom = 16;
    for (const id of ['prod-col-fila','prod-col-emprod']) {
      const ul = document.getElementById(id); if (!ul) continue;
      const top = ul.getBoundingClientRect().top;
      const available = Math.max(100, Math.floor(yLimit - top - padBottom));
      ul.style.maxHeight = `${available}px`; ul.style.overflowY = 'auto';
    }
  }
  window.addEventListener('resize', fitProdutoKanbanHeight);
  document.addEventListener('DOMContentLoaded', fitProdutoKanbanHeight);

  /* ----- Mini Kanban ----- */
  async function renderMiniKanban(codigoAlfa, codigoProdutoNum=null){
    const rid = (window.__miniRID = (window.__miniRID || 0) + 1);
    const headerEl   = document.getElementById('produtoSelecionado');
    const ulMiniFila = document.getElementById('prod-col-fila');
    const ulMiniEm   = document.getElementById('prod-col-emprod');
    if (headerEl) headerEl.textContent = `Produto — ${codigoAlfa || ''}`;
    if (!ulMiniFila || !ulMiniEm) { console.warn('[mini-board] listas não encontradas'); return; }

    try {
      const resp = await fetch(`${API_BASE}/preparacao/listar`, { cache:'no-store', credentials:'include' });
      const payload = await resp.json();
      const data   = payload?.data || {};
      const fila   = data['A Produzir'] || [];
      const emprod = data['Produzindo'] || [];

      const codAlfa = String(codigoAlfa || '').trim();
      const codNum  = codigoProdutoNum ? String(codigoProdutoNum).trim() : null;

      const all = [...fila, ...emprod];
      const cps = [...new Set(all.map(c => String(c.produto_codigo ?? '').trim()).filter(s => /^\d+$/.test(s)))];
      let cpToAlpha = {};
      if (cps.length){
        const qs = cps.map(cp => 'cp='+encodeURIComponent(cp)).join('&');
        try {
          const r = await fetch(`${API_BASE}/produtos/codigos?`+qs, { credentials:'include' });
          const j = await r.json();
          cpToAlpha = j?.data || {};
        } catch(e){ console.warn('[mini-board] falha CP→alfa', e); }
      }
      const alphaFromCP = cp => (cpToAlpha[cp]?.codigo || null);
      const matchProd = (c) => {
        const cp   = String(c.produto_codigo ?? '').trim();
        const alfa = alphaFromCP(cp) || cp;
        if (codNum  && cp   === codNum)  return true;
        if (codAlfa && alfa === codAlfa) return true;
        return false;
      };
      const dedupeByOp = (arr) => {
        const seen = new Set();
        return arr.filter(c => { const k=String(c.op||'').trim(); if(!k||seen.has(k))return false; seen.add(k); return true; });
      };

      let listaFila   = dedupeByOp(fila.filter(matchProd));
      let listaEmProd = dedupeByOp(emprod.filter(matchProd));
      const emOps = new Set(listaEmProd.map(x => x.op));
      listaFila = listaFila.filter(x => !emOps.has(x.op));

      // foto
      await updateProdutoFotoFrame(codAlfa || codNum || null);

      if (rid !== window.__miniRID) return;
      const fragFila = document.createDocumentFragment();
      const fragEm   = document.createDocumentFragment();
      const pushLi = (frag, op) => { const li=document.createElement('li'); li.className='kanban-card'; li.textContent=op||'—'; frag.appendChild(li); };
      if (listaEmProd.length===0){ const li=document.createElement('li'); li.className='empty'; li.textContent='—'; fragEm.appendChild(li); }
      else for (const c of listaEmProd) pushLi(fragEm, c.op);

      if (listaFila.length===0){ const li=document.createElement('li'); li.className='empty'; li.textContent='—'; fragFila.appendChild(li); }
      else for (const c of listaFila) pushLi(fragFila, c.op);

      if (rid !== window.__miniRID) return;
      ulMiniEm.replaceChildren(fragEm);
      ulMiniFila.replaceChildren(fragFila);
    } catch (err){
      if (rid !== window.__miniRID) return;
      console.error('[mini-board] erro:', err);
      document.getElementById('prod-col-emprod').innerHTML = '<li class="empty">Erro carregando dados</li>';
      document.getElementById('prod-col-fila').innerHTML = '';
    }
    fitProdutoKanbanHeight();
  }
  window.renderMiniKanban = renderMiniKanban;

  /* ===== QR Code (iniciar/finalizar) ===== */
  const setupQRFunctionality = () => {
    const ensureQrModalStructure = () => {
      let modal = document.getElementById('qrModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'qrModal';
        modal.className = 'modal';
        modal.setAttribute('aria-hidden','true');
        modal.setAttribute('role','dialog');
        modal.setAttribute('aria-modal','true');
        modal.innerHTML = `
          <div class="qr-box" role="document">
            <div class="qr-header">
              <strong>Escanear QR</strong>
              <button id="qrClose" class="qr-close" aria-label="Fechar">×</button>
            </div>
            <div id="qrReader"></div>
            <div class="input-group">
              <input id="qrManual" class="input-modern" placeholder="Digite a OP manualmente" inputmode="text" autocomplete="off">
              <button id="qrManualBtn" class="btn-modern btn-ghost" type="button">OK</button>
            </div>
            <pre id="qrDebug" style="display:none"></pre>
          </div>`;
      }
      // GARANTE QUE ESTÁ NO BODY (sem pais com transform/overflow)
      if (modal.parentElement !== document.body) document.body.appendChild(modal);
      return modal;
    };

    const showModal = () => {
      const modal = ensureQrModalStructure();
      modal.style.display = 'flex';
      modal.classList.add('open');
      modal.setAttribute('aria-hidden','false');
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      // Tamanho do reader
      const reader = document.getElementById('qrReader');
      if (reader) {
        reader.style.width = '100%';
        reader.style.maxWidth = '560px';
        reader.style.height = 'min(60vh, 440px)';
        reader.style.background = '#000';
        reader.style.borderRadius = '8px';
        reader.style.overflow = 'hidden';
        reader.style.position = 'relative';
      }
      return modal;
    };

    const hideModal = async () => {
      try { if (window.qrReader) { await window.qrReader.stop(); await window.qrReader.clear(); } } catch {}
      const modal = document.getElementById('qrModal');
      if (modal) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden','true');
        modal.style.display = 'none';
      }
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      const manual = document.getElementById('qrManual'); if (manual) manual.value='';
      const dbg = document.getElementById('qrDebug'); if (dbg) dbg.textContent='';
    };

    const measureNonZero = async (el, tries=12) => {
      while (tries-- > 0) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 30) return r;
        await sleep(50);
      }
      return el.getBoundingClientRect();
    };

    const startQr = async (acao) => {
      const onScan = async (raw) => {
        const op = (raw || '').trim().toUpperCase();
        if (!op) { alert('QR/valor vazio'); return; }
        try {
          elements.btnIniciar.disabled = true; elements.btnFinalizar.disabled = true;
          if (acao === 'iniciar')      await Preparacao.iniciarProducao(op);
          else if (acao === 'concluir')await Preparacao.finalizarProducao(op);
          await hideModal();
        } catch (err) {
          alert('Falha: ' + (err?.message || err));
        } finally {
          elements.btnIniciar.disabled = false; elements.btnFinalizar.disabled = false;
        }
      };

      const modal = showModal();
      const readerEl = document.getElementById('qrReader');
      const closeBtn = document.getElementById('qrClose');
      const manual   = document.getElementById('qrManual');
      const manualBtn= document.getElementById('qrManualBtn');

      closeBtn.onclick = () => hideModal();
      manualBtn.onclick = () => { const v=manual.value.trim(); if(!v){ alert('Digite uma OP'); manual.focus(); return; } onScan(v); };
      manual.onkeydown = (ev) => { if (ev.key === 'Enter') manualBtn.click(); };
      modal.addEventListener('click', (e) => { if (e.target === modal) hideModal(); }, { once:true });

      // Para leitor anterior
      try { if (window.qrReader) { await window.qrReader.stop(); await window.qrReader.clear(); } } catch {}

      // Aguarda o container ter tamanho real
      const rect = await measureNonZero(readerEl);
      let side = Math.floor(Math.min(rect.width, rect.height));
      side = Math.max(200, Math.min(side, 380)); // entre 200 e 380

      // Inicia
      if (!window.Html5Qrcode) {
        alert('Leitor de QR indisponível.');
        return;
      }
      try {
        window.qrReader = new Html5Qrcode('qrReader', { verbose: false });
        await window.qrReader.start(
          { facingMode: { ideal: 'environment' } },
          { fps: 10, qrbox: side, disableFlip: true, aspectRatio: 1.0 },
          (decoded) => onScan(decoded),
          () => {}
        );
      } catch (e) {
        alert('Não foi possível acessar a câmera: ' + (e?.message || e));
      }
      manual.focus();
    };

    elements.btnIniciar?.addEventListener('click', (e) => { e.preventDefault(); startQr('iniciar'); });
    elements.btnFinalizar?.addEventListener('click', (e) => { e.preventDefault(); startQr('concluir'); });
  };
  setupQRFunctionality();

  /* ----- SSE / Atualização ao vivo ----- */
  const setupLiveUpdates = () => {
    let debounceId;
    const refresh = async () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(async () => {
        try {
          await initPreparacaoKanban();
          if (window.codigoSelecionado && typeof window.renderMiniKanban === 'function') {
            await window.renderMiniKanban(window.codigoSelecionado);
          }
        } catch (e) { console.warn('[prep-eletrica] refresh falhou:', e); }
      }, 300);
    };
    try {
      const eventSource = new EventSource(`${API_BASE}/produtos/stream`);
      eventSource.onmessage = (event) => { try { const m=JSON.parse(event.data); if (m?.type==='hello') return; } catch{}; refresh(); };
      eventSource.onerror = (error) => { console.warn('[SSE] Erro de conexão:', error); };
      window.addEventListener('beforeunload', () => { eventSource.close?.(); });
    } catch {
      setInterval(refresh, 30000);
    }
  };
  setupLiveUpdates();
});

export const __debug_fitHeight = () => { try { const ev=new Event('resize'); window.dispatchEvent(ev); } catch {} };