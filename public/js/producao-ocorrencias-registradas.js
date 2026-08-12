// Produção — Ocorrências registradas (falhas detectadas no RI)
(function () {
  'use strict';

  let _filtroStatus = '';
  let _buscaTimer = null;
  let _lista = [];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatarData(iso) {
    if (!iso) return '—';
    const s = String(iso).replace('T', ' ').slice(0, 16);
    if (s) return s;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function setStatusMsg(texto, isErro) {
    const el = $('prodOcorrenciasStatusMsg');
    if (!el) return;
    if (!texto) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = texto;
    el.style.color = isErro ? '#fca5a5' : '#94a3b8';
  }

  function normalizarAnexos(item) {
    let list = [];
    const raw = item?.anexos;
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === 'string' && raw.trim()) {
      try { list = JSON.parse(raw); } catch (_) { list = []; }
    }
    if (!Array.isArray(list)) list = [];
    list = list.filter((a) => a && a.url);
    if (!list.length) {
      if (item?.foto) list.push({ url: item.foto, tipo: 'foto', nome: 'Foto' });
      if (item?.video) list.push({ url: item.video, tipo: 'video', nome: 'Vídeo' });
    }
    return list;
  }

  function renderAnexosHtml(anexos) {
    if (!anexos.length) return '';
    return `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;">${anexos.map((a) => {
      const url = esc(a.url);
      const nome = esc(a.nome || 'Arquivo');
      const tipo = String(a.tipo || '').toLowerCase();
      const isFoto = tipo === 'foto' || /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(a.url || '');
      const isVideo = tipo === 'video' || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(a.url || '');
      if (isFoto) {
        return `<a href="${url}" target="_blank" rel="noopener" title="${nome}" style="display:block;line-height:0;">
          <img src="${url}" alt="${nome}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,.15);">
        </a>`;
      }
      if (isVideo) {
        return `<a href="${url}" target="_blank" rel="noopener" title="${nome}"
          style="display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:6px;background:rgba(99,102,241,.15);color:#c7d2fe;font-size:11px;text-decoration:none;">
          <i class="fa-solid fa-video"></i> ${nome}
        </a>`;
      }
      return `<a href="${url}" target="_blank" rel="noopener" title="${nome}"
        style="display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:6px;background:rgba(148,163,184,.12);color:#cbd5e1;font-size:11px;text-decoration:none;">
        <i class="fa-solid fa-file"></i> ${nome}
      </a>`;
    }).join('')}</div>`;
  }

  function atualizarContagens(contagens) {
    const map = contagens || {};
    document.querySelectorAll('#prodOcorrenciasFiltros [data-count]').forEach((span) => {
      const key = span.getAttribute('data-count');
      span.textContent = String(map[key] ?? 0);
    });
  }

  function renderLista(rows) {
    const box = $('prodOcorrenciasLista');
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<div style="text-align:center;padding:24px 0;color:#64748b;font-size:13px;">Nenhuma ocorrência registrada.</div>';
      return;
    }
    box.innerHTML = rows.map((o) => {
      const anexos = normalizarAnexos(o);
      const dt = formatarData(o.created_at);
      const opTxt = String(o.numero_op || '').trim();
      const codigo = String(o.codigo_produto || '').trim();
      const corrigida = o.corrigido === true || o.corrigido === 't' || o.corrigido === 'true';
      const corBorda = corrigida ? 'rgba(74,222,128,.28)' : 'rgba(248,113,113,.25)';
      const corFundo = corrigida ? 'rgba(20,83,45,.18)' : 'rgba(127,29,29,.12)';
      const corTitulo = corrigida ? '#bbf7d0' : '#fecaca';
      const opLinha = [opTxt ? `OP ${esc(opTxt)}` : '', codigo ? esc(codigo) : ''].filter(Boolean).join(' · ') || 'OP —';
      const liberadoHtml = corrigida
        ? `<div style="font-size:11px;color:#86efac;margin-top:6px;">Corrigido · liberado por <b>${esc(o.corrigido_por || '—')}</b></div>`
        : '';
      return `<div style="border:1px solid ${corBorda};border-radius:8px;padding:10px 12px;margin-bottom:8px;background:${corFundo};">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;">
          <div style="font-size:12px;font-weight:700;color:${corTitulo};line-height:1.35;">#${esc(String(o.id))} · ${esc(o.falha_detectada || '—')}</div>
          <span style="font-size:10px;color:#94a3b8;flex-shrink:0;">${esc(dt)}</span>
        </div>
        <div style="font-size:11px;color:#93c5fd;margin-top:4px;">${opLinha}</div>
        ${liberadoHtml}
        ${renderAnexosHtml(anexos)}
      </div>`;
    }).join('');
  }

  async function carregar() {
    const busca = String($('prodOcorrenciasBusca')?.value || '').trim();
    const params = new URLSearchParams();
    if (busca) params.set('q', busca);
    if (_filtroStatus) params.set('status', _filtroStatus);
    setStatusMsg('Carregando...');
    try {
      const resp = await fetch(`/api/qualidade/ri-check/ocorrencias?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao carregar ocorrências.');
      }
      _lista = Array.isArray(data.ocorrencias) ? data.ocorrencias : [];
      atualizarContagens(data.contagens);
      renderLista(_lista);
      const n = _lista.length;
      setStatusMsg(n ? `${n} ocorrência${n === 1 ? '' : 's'} — mais nova primeiro.` : '');
    } catch (err) {
      _lista = [];
      renderLista([]);
      setStatusMsg(err.message || 'Falha ao carregar.', true);
    }
  }

  function bindOnce() {
    const pane = $('producaoOcorrenciasPane');
    if (!pane || pane.dataset.bound === '1') return;
    pane.dataset.bound = '1';

    $('prodOcorrenciasRefreshBtn')?.addEventListener('click', () => { carregar(); });

    $('prodOcorrenciasBusca')?.addEventListener('input', () => {
      clearTimeout(_buscaTimer);
      _buscaTimer = setTimeout(() => { carregar(); }, 280);
    });

    document.querySelectorAll('#prodOcorrenciasFiltros [data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _filtroStatus = btn.getAttribute('data-status') || '';
        document.querySelectorAll('#prodOcorrenciasFiltros [data-status]').forEach((b) => {
          const ativo = b === btn;
          b.style.background = ativo ? 'rgba(248,113,113,.18)' : 'rgba(255,255,255,.04)';
          b.style.borderColor = ativo ? 'rgba(248,113,113,.45)' : 'rgba(255,255,255,.12)';
          b.style.color = ativo ? '#fecaca' : '#cbd5e1';
        });
        carregar();
      });
    });
  }

  window.producaoOcorrenciasRegistradas = {
    open() {
      bindOnce();
      carregar();
    },
  };
})();
