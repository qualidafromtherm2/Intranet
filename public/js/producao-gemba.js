// Produção — Gemba: ocorrências do chão de fábrica
(function () {
  'use strict';

  const STATUS_LABEL = {
    aberta: 'Aberta',
    em_andamento: 'Em andamento',
    resolvida: 'Resolvida',
    cancelada: 'Cancelada',
  };

  let _carregado = false;
  let _filtroStatus = '';
  let _buscaTimer = null;
  let _lista = [];
  let _fotoObjUrl = null;
  let _videoObjUrl = null;

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
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function revogarPreviews() {
    if (_fotoObjUrl) URL.revokeObjectURL(_fotoObjUrl);
    if (_videoObjUrl) URL.revokeObjectURL(_videoObjUrl);
    _fotoObjUrl = null;
    _videoObjUrl = null;
  }

  function setStatusMsg(texto, isErro) {
    const el = $('gembaStatusMsg');
    if (!el) return;
    if (!texto) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = texto;
    el.classList.toggle('is-erro', !!isErro);
  }

  function atualizarContagens(contagens) {
    const map = contagens || {};
    document.querySelectorAll('#gembaFiltrosStatus [data-count]').forEach((span) => {
      const key = span.getAttribute('data-count');
      span.textContent = String(map[key] ?? 0);
    });
  }

  function renderCards(rows) {
    const box = $('gembaCardsContainer');
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = '<div class="gemba-empty">Nenhuma ocorrência encontrada.</div>';
      return;
    }

    box.innerHTML = rows.map((row) => {
      const status = row.status || 'aberta';
      const desc = String(row.descricao || '').trim();
      const foto = row.foto_url
        ? `<img class="gemba-card-thumb" src="${esc(row.foto_url)}" alt="">`
        : '<div class="gemba-card-thumb is-empty"><i class="fa-solid fa-image"></i></div>';
      const videoBadge = row.video_url
        ? '<span class="gemba-card-video" title="Tem vídeo"><i class="fa-solid fa-video"></i></span>'
        : '';
      return `
        <article class="gemba-card" data-id="${esc(row.id)}" title="Clique para abrir">
          <span class="gemba-card-corner" data-status="${esc(status)}"></span>
          <div class="gemba-card-head">
            <span class="gemba-card-id">#${esc(row.id)}</span>
            <span class="gemba-card-date">${esc(formatarData(row.criado_em))}</span>
            <span class="gemba-card-status" data-status="${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
            ${videoBadge}
          </div>
          <div class="gemba-card-body">
            ${foto}
            <div class="gemba-card-text">
              <h3>${esc(row.titulo || 'Sem título')}</h3>
              <p>${esc(desc || 'Sem descrição')}</p>
            </div>
          </div>
          <div class="gemba-card-foot">
            <span><i class="fa-solid fa-user"></i> ${esc(row.criado_por || '—')}</span>
            <button type="button" class="gemba-card-open" data-id="${esc(row.id)}">Abrir</button>
          </div>
        </article>`;
    }).join('');
  }

  async function carregar() {
    setStatusMsg('Carregando ocorrências...');
    const params = new URLSearchParams();
    if (_filtroStatus) params.set('status', _filtroStatus);
    const q = String($('gembaBusca')?.value || '').trim();
    if (q) params.set('q', q);
    try {
      const resp = await fetch(`/api/gemba?${params.toString()}`);
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || 'Falha ao carregar o Gemba.');
      _lista = Array.isArray(json.data) ? json.data : [];
      atualizarContagens(json.contagens);
      renderCards(_lista);
      setStatusMsg('');
    } catch (err) {
      renderCards([]);
      setStatusMsg(err.message || 'Erro ao carregar.', true);
    }
  }

  function preencherPreviewExistente(row) {
    const fotoBox = $('gembaFotoPreview');
    const videoBox = $('gembaVideoPreview');
    if (fotoBox) {
      fotoBox.innerHTML = row?.foto_url
        ? `<img src="${esc(row.foto_url)}" alt="Foto atual">`
        : 'Nenhuma foto selecionada';
    }
    if (videoBox) {
      videoBox.innerHTML = row?.video_url
        ? `<video src="${esc(row.video_url)}" controls></video>`
        : 'Nenhum vídeo selecionado';
    }
  }

  function renderHistorico(items) {
    const box = $('gembaFormHistorico');
    if (!box) return;
    if (!items?.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = '<div class="gemba-hist-title">Histórico</div>' + items.map((h) => `
      <div class="gemba-hist-item">
        <strong>${esc(STATUS_LABEL[h.status_novo] || h.status_novo)}</strong>
        <span>${esc(formatarData(h.alterado_em))} · ${esc(h.alterado_por || '—')}</span>
        ${h.comentario ? `<em>${esc(h.comentario)}</em>` : ''}
      </div>
    `).join('');
  }

  function preencherFormulario(row, historico) {
    $('gembaFormId').value = row?.id || '';
    $('gembaFormTitulo').value = row?.titulo || '';
    $('gembaFormDescricao').value = row?.descricao || '';
    $('gembaFormStatus').value = row?.status || 'aberta';
    $('gembaFormComentario').value = '';
    $('gembaFormErro').hidden = true;
    $('gembaFormErro').textContent = '';
    const editando = !!row?.id;
    $('gembaFormModalTitle').textContent = editando ? `Ocorrência #${row.id}` : 'Nova ocorrência Gemba';
    $('gembaFormStatusWrap').hidden = !editando;
    $('gembaFormComentarioWrap').hidden = !editando;
    preencherPreviewExistente(row);
    renderHistorico(historico);
  }

  async function abrirModal(row) {
    const modal = $('gembaFormModal');
    if (!modal) return;
    revogarPreviews();
    $('gembaForm')?.reset();
    preencherFormulario(row, []);
    modal.hidden = false;
    $('gembaFormTitulo')?.focus();
    if (!row?.id) return;
    try {
      const resp = await fetch(`/api/gemba/${encodeURIComponent(row.id)}`);
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json.data) preencherFormulario(json.data, json.historico || []);
    } catch (_) {}
  }

  function fecharModal() {
    const modal = $('gembaFormModal');
    if (modal) modal.hidden = true;
    revogarPreviews();
  }

  function mostrarErroForm(msg) {
    const el = $('gembaFormErro');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  async function salvar(ev) {
    ev.preventDefault();
    const titulo = String($('gembaFormTitulo')?.value || '').trim();
    if (!titulo) {
      mostrarErroForm('Informe o título.');
      return;
    }
    const id = String($('gembaFormId')?.value || '').trim();
    const fd = new FormData();
    fd.append('titulo', titulo);
    fd.append('descricao', String($('gembaFormDescricao')?.value || '').trim());
    if (id) {
      fd.append('status', $('gembaFormStatus')?.value || 'aberta');
      fd.append('comentario', String($('gembaFormComentario')?.value || '').trim());
    }
    const foto = $('gembaFormFoto')?.files?.[0];
    const video = $('gembaFormVideo')?.files?.[0];
    if (foto) fd.append('foto', foto);
    if (video) fd.append('video', video);

    const btn = $('gembaFormSalvar');
    if (btn) btn.disabled = true;
    mostrarErroForm('');
    try {
      const resp = await fetch(id ? `/api/gemba/${encodeURIComponent(id)}` : '/api/gemba', {
        method: id ? 'PUT' : 'POST',
        body: fd,
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || 'Não foi possível salvar.');
      fecharModal();
      await carregar();
    } catch (err) {
      mostrarErroForm(err.message || 'Erro ao salvar.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function ligarEventos() {
    if (_carregado) return;
    _carregado = true;

    $('gembaAddBtn')?.addEventListener('click', () => abrirModal(null));
    $('gembaRefreshBtn')?.addEventListener('click', () => carregar());
    $('gembaFormModalClose')?.addEventListener('click', fecharModal);
    $('gembaFormCancelar')?.addEventListener('click', fecharModal);
    $('gembaForm')?.addEventListener('submit', salvar);

    $('gembaFormModal')?.addEventListener('click', (e) => {
      if (e.target === $('gembaFormModal')) fecharModal();
    });

    $('gembaBusca')?.addEventListener('input', () => {
      clearTimeout(_buscaTimer);
      _buscaTimer = setTimeout(() => carregar(), 280);
    });

    $('gembaFiltrosStatus')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.gemba-filtro');
      if (!btn) return;
      _filtroStatus = btn.dataset.status || '';
      $('gembaFiltrosStatus').querySelectorAll('.gemba-filtro').forEach((el) => {
        el.classList.toggle('is-active', el === btn);
      });
      carregar();
    });

    $('gembaCardsContainer')?.addEventListener('click', (e) => {
      const card = e.target.closest('.gemba-card, .gemba-card-open');
      if (!card) return;
      const id = Number(card.dataset.id || e.target.closest('.gemba-card')?.dataset.id);
      if (!id) return;
      const row = _lista.find((r) => Number(r.id) === id);
      abrirModal(row || { id });
    });

    $('gembaFormFoto')?.addEventListener('change', () => {
      const file = $('gembaFormFoto').files?.[0];
      const box = $('gembaFotoPreview');
      if (!box) return;
      if (_fotoObjUrl) URL.revokeObjectURL(_fotoObjUrl);
      if (!file) {
        box.textContent = 'Nenhuma foto selecionada';
        return;
      }
      _fotoObjUrl = URL.createObjectURL(file);
      box.innerHTML = `<img src="${_fotoObjUrl}" alt="Prévia da foto">`;
    });

    $('gembaFormVideo')?.addEventListener('change', () => {
      const file = $('gembaFormVideo').files?.[0];
      const box = $('gembaVideoPreview');
      if (!box) return;
      if (_videoObjUrl) URL.revokeObjectURL(_videoObjUrl);
      if (!file) {
        box.textContent = 'Nenhum vídeo selecionado';
        return;
      }
      _videoObjUrl = URL.createObjectURL(file);
      box.innerHTML = `<video src="${_videoObjUrl}" controls></video>`;
    });
  }

  window.producaoGemba = {
    open() {
      ligarEventos();
      carregar();
    },
  };
})();
