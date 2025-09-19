
/* =============================
   PREPARAÇÃO ELÉTRICA — JS (QR FIX)
   - Abre o modal ANTES de iniciar a câmera
   - Garante visibilidade/tamanho do container do vídeo
   - Para/limpa leitor anterior antes de reabrir
   - Mantém API_BASE e normalização de imagens
   ============================= */

import { initPreparacaoKanban } from '../kanban/kanban_preparacao.js';

/* ---------- Base de API ---------- */
export const API_BASE = (() => {
  const meta = document.querySelector('meta[name="api-base"]')?.content?.trim();
  if (meta) return meta.replace(/\/$/, '');
  if (location.hostname.endsWith('onrender.com')) {
    return `https://${location.host}/api`;
  }
  return '/api';
})();

function normalizeImageUrl(imgUrl) {
  if (!imgUrl) return null;
  try {
    const u = new URL(String(imgUrl), location.href);
    if (location.protocol === 'https:' && u.protocol === 'http:') u.protocol = 'https:';
    return u.toString();
  } catch { return imgUrl; }
}

// força rolar para o topo
const forceTop = () => { try { window.scrollTo(0,0); } catch(e){} };
document.addEventListener('DOMContentLoaded', forceTop);
document.getElementById('mainMenu')?.addEventListener('click', () => setTimeout(forceTop, 0));

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

  const setActiveTab = (activeEl) => {
    document.querySelectorAll('#mainMenu .menu-link').forEach(a => {
      a.classList.remove('is-active');
      a.setAttribute('aria-selected','false');
    });
    activeEl.classList.add('is-active');
    activeEl.setAttribute('aria-selected','true');
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display='none');
  };

  elements.menuInicio?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(elements.menuInicio);
    elements.paginaPrep.style.display = 'block';
    elements.paginaPrep.classList.add('fade-in');
  });

  elements.menuProduto?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(elements.menuProduto);
    elements.produtoTab.style.display = 'block';
    elements.produtoTab.classList.add('fade-in');

    if (window.codigoSelecionado) {
      renderMiniKanban(window.codigoSelecionado);
    } else {
      elements.miniCodigoEl.textContent = '';
      elements.ulMiniFila.innerHTML = '<li class="empty">Selecione um item na Fila de produção</li>';
      elements.ulMiniEmProd.innerHTML = '<li class="empty">—</li>';
    }
    setTimeout(fitProdutoKanbanHeight, 50);
  });

  elements.menuGestao?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveTab(elements.menuGestao);
    elements.gestaoTab.style.display = 'block';
    elements.gestaoTab.classList.add('fade-in');
  });

  // ===== Gestão (menu SQL simples) =====
  const setupGestaoTab = () => {
    const sideBox = document.querySelector('#gestaoTab .side-actions');
    const sqlMenu = document.createElement('div');
    sqlMenu.className = 'sql-menu';
    sqlMenu.setAttribute('role','menu');
    sqlMenu.innerHTML = `
      <button data-act="last100" role="menuitem">Últimos 100</button>
      <button data-act="byop" role="menuitem">Digite a OP…</button>
      <button data-act="today" role="menuitem">Hoje</button>
      <button data-act="range" role="menuitem">Entre datas…</button>`;
    sideBox?.appendChild(sqlMenu);

    elements.btnSqlGestao?.addEventListener('click', () => {
      sqlMenu.classList.toggle('open');
      elements.btnSqlGestao.setAttribute('aria-expanded', sqlMenu.classList.contains('open'));
    });
    document.addEventListener('click', (e) => {
      if (!sqlMenu.contains(e.target) && e.target !== elements.btnSqlGestao) {
        sqlMenu.classList.remove('open');
        elements.btnSqlGestao?.setAttribute('aria-expanded','false');
      }
    });

    const openEventosQuery = (query) => {
      const csv = confirm('Baixar CSV? (OK = CSV, Cancelar = ver JSON)');
      const base = csv ? `${API_BASE}/preparacao/eventos.csv` : `${API_BASE}/preparacao/eventos`;
      const qs = new URLSearchParams(query);
      const url = `${base}?${qs.toString()}`;
      if (csv) { const a = document.createElement('a'); a.href=url; a.download='op_eventos.csv'; document.body.appendChild(a); a.click(); a.remove(); }
      else { window.open(url,'_blank'); }
    };

    sqlMenu.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      sqlMenu.classList.remove('open');
      elements.btnSqlGestao?.setAttribute('aria-expanded','false');
      switch(act){
        case 'last100': openEventosQuery({ limit:'100', order:'desc' }); break;
        case 'byop': { const op = prompt('Digite a OP (ex.: P101086):'); if(op) openEventosQuery({ op: op.trim().toUpperCase() }); break; }
        case 'today': { const d=new Date(); const dateStr=d.toISOString().split('T')[0]; openEventosQuery({ from:dateStr, to:dateStr }); break; }
        case 'range': {
          const de=prompt('Data inicial (AAAA-MM-DD):'); if(!de) return;
          const ate=prompt('Data final (AAAA-MM-DD):'); if(!ate) return;
          openEventosQuery({ from:de.trim(), to:ate.trim() }); break;
        }
      }
    });

    elements.btnBaixarCsv?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = `${API_BASE}/preparacao/csv`; a.download = 'preparacao.csv';
      document.body.appendChild(a); a.click(); a.remove();
    });
  };
  setupGestaoTab();

  window.ativarAbaProduto = function(){
    setActiveTab(elements.menuProduto);
    elements.produtoTab.style.display='block';
    elements.produtoTab.classList.add('fade-in');
  };

  // ===== Foto do produto =====
  async function fetchPrimeiraFoto(codigo) {
    if (!codigo) return null;
    const endpoint = `${API_BASE}/produtos/${encodeURIComponent(codigo)}/fotos`;
    try {
      const resp = await fetch(endpoint, { cache: 'no-store', credentials: 'include' });
      if (!resp.ok) return null;
      const j = await resp.json();
      const arr = Array.isArray(j?.fotos) ? j.fotos : (Array.isArray(j?.data) ? j.data : []);
      if (!arr.length) return null;
      const ord = arr.slice().sort((a,b) => Number(a.pos||0) - Number(b.pos||0));
      const f0  = ord[0];
      const raw = f0?.url_imagem ?? f0?.url ?? f0?.imagem ?? null;
      return normalizeImageUrl(raw);
    } catch { return null; }
  }
  async function updateProdutoFotoFrame(codigoPreferencial) {
    const img = document.getElementById('produto-foto-img');
    if (!img) return;
    let url = null;
    try { url = await fetchPrimeiraFoto(codigoPreferencial); } catch{}
    if (url) { img.src = url; img.style.objectFit='cover'; }
    else { img.src = '../img/logo.png'; img.style.objectFit='contain'; }
  }

  // ===== Altura das listas (aba Produto) =====
  function fitProdutoKanbanHeight() {
    const limits = [];
    const addLimit = (sel) => {
      const el = document.querySelector(sel);
      if (el) { const r = el.getBoundingClientRect(); if (r.bottom > 0) limits.push(r.bottom); }
    };
    addLimit('#produtoTab .content-wrapper');
    addLimit('#produtoTab');
    addLimit('main');
    limits.push(window.innerHeight);
    const yLimit = Math.min(...limits);
    const padBottom = 16;
    ['prod-col-fila','prod-col-emprod'].forEach(id => {
      const ul = document.getElementById(id);
      if (!ul) return;
      const top = ul.getBoundingClientRect().top;
      const available = Math.max(100, Math.floor(yLimit - top - padBottom));
      ul.style.maxHeight = `${available}px`;
      ul.style.overflowY = 'auto';
    });
  }
  window.addEventListener('resize', fitProdutoKanbanHeight);
  document.addEventListener('DOMContentLoaded', fitProdutoKanbanHeight);

  // ===== Mini Kanban =====
  async function renderMiniKanban(codigoAlfa, codigoProdutoNum=null){
    const rid = (window.__miniRID = (window.__miniRID || 0) + 1);
    const headerEl   = document.getElementById('produtoSelecionado');
    const ulMiniFila = document.getElementById('prod-col-fila');
    const ulMiniEm   = document.getElementById('prod-col-emprod');
    if (headerEl) headerEl.textContent = `Produto — ${codigoAlfa || ''}`;
    if (!ulMiniFila || !ulMiniEm){ console.warn('[mini-board] listas não encontradas'); return; }

    try {
      const resp = await fetch(`${API_BASE}/preparacao/listar`, { cache:'no-store', credentials:'include' });
      const payload = await resp.json();
      const data   = payload?.data || {};
      const fila   = data['A Produzir'] || [];
      const emprod = data['Produzindo'] || [];

      const codAlfa = String(codigoAlfa || '').trim();
      const codNum  = codigoProdutoNum ? String(codigoProdutoNum).trim() : null;

      let fotoAlfa = codAlfa || codNum || null;
      await updateProdutoFotoFrame(fotoAlfa);

      const all = [...fila, ...emprod];
      const cps = [...new Set(all.map(c => String(c.produto_codigo ?? '').trim()).filter(s => /^\d+$/.test(s)))];
      let cpToAlpha = {};
      if (cps.length){
        const qs = cps.map(cp => 'cp='+encodeURIComponent(cp)).join('&');
        try {
          const r = await fetch(`${API_BASE}/produtos/codigos?`+qs, { credentials:'include' });
          const j = await r.json();
          cpToAlpha = j?.data || {};
        } catch(e){ console.warn('[mini-board] falha ao resolver CP→alfa:', e); }
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
        return arr.filter(c => {
          const k = String(c.op || '').trim();
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      };

      let listaFila   = dedupeByOp(fila.filter(matchProd));
      let listaEmProd = dedupeByOp(emprod.filter(matchProd));
      const emOps = new Set(listaEmProd.map(x => x.op));
      listaFila = listaFila.filter(x => !emOps.has(x.op));

      if (rid !== window.__miniRID) return;
      const fragFila = document.createDocumentFragment();
      const fragEm   = document.createDocumentFragment();
      const pushLi = (frag, op) => {
        const li = document.createElement('li'); li.className='kanban-card'; li.textContent = op || '—'; frag.appendChild(li);
      };
      if (listaEmProd.length === 0) { const li=document.createElement('li'); li.className='empty'; li.textContent='—'; fragEm.appendChild(li); }
      else { for (const c of listaEmProd) pushLi(fragEm, c.op); }

      if (listaFila.length === 0) { const li=document.createElement('li'); li.className='empty'; li.textContent='—'; fragFila.appendChild(li); }
      else { for (const c of listaFila) pushLi(fragFila, c.op); }

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

  // ===== QR Code (iniciar/finalizar) =====
  const setupQRFunctionality = () => {
    const qrModal    = document.getElementById('qrModal');
    const qrClose    = document.getElementById('qrClose');
    const qrManual   = document.getElementById('qrManual');
    const qrManualBtn= document.getElementById('qrManualBtn');
    const qrDebug    = document.getElementById('qrDebug');
    const btnIniciar   = document.getElementById('btn-iniciar');
    const btnFinalizar = document.getElementById('btn-finalizar');

    const ensureModalVisible = () => {
      qrModal.style.display = 'flex';             // vence inline display:none
      qrModal.classList.add('open');
      qrModal.setAttribute('aria-hidden','false');
      const reader = document.getElementById('qrReader');
      if (reader) {
        reader.style.width = '100%';
        reader.style.maxWidth = '520px';
        reader.style.height = '420px';
        reader.style.background = '#000';
        reader.style.borderRadius = '8px';
        reader.style.overflow = 'hidden';
      }
    };

    const fecharModal = async () => {
      try { if (window.qrReader) { await window.qrReader.stop(); await window.qrReader.clear(); } } catch {}
      qrModal.classList.remove('open');
      qrModal.setAttribute('aria-hidden','true');
      qrModal.style.display = 'none';
      qrManual.value=''; qrDebug.textContent='';
    };

    const abrirLeitorQRComAcao = (acao) => {
      return new Promise((resolve, reject) => {
        const onScan = async (raw) => {
          try {
            const op = (raw || '').trim().toUpperCase();
            if (!op) { alert('QR/valor vazio'); return; }
            btnIniciar.disabled = true; btnFinalizar.disabled = true;
            if (acao === 'iniciar')      await Preparacao.iniciarProducao(op);
            else if (acao === 'concluir')await Preparacao.finalizarProducao(op);
            await fecharModal();
            resolve(op);
          } catch (err) {
            alert('Falha: ' + (err?.message || err));
            reject(err);
          } finally {
            btnIniciar.disabled = false; btnFinalizar.disabled = false;
          }
        };

        qrClose.onclick = () => { fecharModal(); reject(new Error('cancelado')); };
        qrManualBtn.onclick = () => { const value = qrManual.value.trim(); if (!value){ alert('Digite uma OP'); qrManual.focus(); return; } onScan(value); };
        qrManual.onkeydown = (ev) => { if (ev.key === 'Enter') qrManualBtn.click(); };

        // Mostra o modal ANTES de iniciar a câmera
        ensureModalVisible();

        // Para leitor anterior se existir
        (async () => { try { if (window.qrReader) { await window.qrReader.stop(); await window.qrReader.clear(); } } catch {} })();

        // Inicia a câmera após o layout estar visível
        const startCamera = async () => {
          if (!window.Html5Qrcode) return;
          try {
            window.qrReader = new Html5Qrcode('qrReader');
            await window.qrReader.start(
              { facingMode: 'environment' },
              { fps: 10, qrbox: 280 },
              (decoded) => onScan(decoded),
              () => {}
            );
          } catch (e) {
            alert('Não foi possível acessar a câmera: ' + (e?.message || e));
          }
        };

        // Dá um tick pro layout aplicar e mede de novo
        requestAnimationFrame(() => setTimeout(startCamera, 60));

        // Escape para fechar
        const esc = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); fecharModal(); reject(new Error('cancelado')); } };
        document.addEventListener('keydown', esc);
        qrManual.focus();
      });
    };

    btnIniciar?.addEventListener('click', (e) => { e.preventDefault(); abrirLeitorQRComAcao('iniciar'); });
    btnFinalizar?.addEventListener('click', (e) => { e.preventDefault(); abrirLeitorQRComAcao('concluir'); });
  };
  setupQRFunctionality();

  // ===== SSE / Atualização ao vivo =====
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
        } catch (e) {
          console.warn('[prep-eletrica] refresh falhou:', e);
        }
      }, 300);
    };

    try {
      const eventSource = new EventSource(`${API_BASE}/produtos/stream`);
      eventSource.onmessage = (event) => {
        try { const message = JSON.parse(event.data); if (message?.type === 'hello') return; } catch {}
        refresh();
      };
      eventSource.onerror = (error) => { console.warn('[SSE] Erro de conexão:', error); };
      window.addEventListener('beforeunload', () => { eventSource.close?.(); });
    } catch {
      console.log('[SSE] Não disponível, usando polling como fallback');
      setInterval(refresh, 30000);
    }
  };
  setupLiveUpdates();
});

export const __debug_fitHeight = () => {
  try { const ev = new Event('resize'); window.dispatchEvent(ev); } catch {}
};