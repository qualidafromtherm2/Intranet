/**
 * Modal RI — Registro de inspeção (versão Produção 3D).
 * Lista de verificações + Registrar RI + Registrar ocorrência.
 * Sem "Adicionar check".
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normStKanban(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Esteira 3D / status → nome do posto no kanban RI */
export function postoToKanbanLocal(posto, status) {
  const st = String(status || '').trim();
  if (st) return st;
  const map = {
    hermetico: 'Montagem hermetica',
    eletrica: 'Montagem eletrica',
    teste: 'Teste',
    inspecao: 'Inspeção final',
    embalagem: 'Embalagem',
    espera: 'Inspeção final',
    programado: 'Programado',
  };
  return map[posto] || '';
}

function isPostoRiAvancar(kanbanLocal) {
  const s = normStKanban(kanbanLocal);
  if (!s || s === 'programado' || s === 'pedidos' || s === 'embalagem') return false;
  return (
    s.includes('hermetic') ||
    s.includes('eletric') ||
    s === 'teste' ||
    s === 'teste final' ||
    s.includes('inspec')
  );
}

/**
 * @param {object} op — item da cena 3D ({ id, n_op, codigo, descricao, codigo_produto, status })
 * @param {{ posto?: string, onDone?: () => void }} opts
 */
export function openProducao3dRiModal(op, opts = {}) {
  const opId = Number(op?.id) || 0;
  if (!opId) {
    alert('OP inválida para registro de inspeção.');
    return;
  }

  const kanbanLocal = postoToKanbanLocal(opts.posto, op.status);
  const isRiAvancar = isPostoRiAvancar(kanbanLocal);
  const codigo = String(op.codigo || '').trim();
  const descricao = String(op.descricao || '').trim();
  const opIdent = String(op.n_op || opId).trim();

  const overlay = document.createElement('div');
  overlay.className = 'p3d-modal-overlay';
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  const modal = document.createElement('div');
  modal.className = 'p3d-modal';
  modal.innerHTML = `
    <header>
      <div>
        <h2>RI - Registro de inspeção</h2>
        <span>OP ${esc(opIdent)} · ${esc(codigo)}</span>
      </div>
      <button type="button" class="p3d-modal-close" aria-label="Fechar">&times;</button>
    </header>
    <div class="p3d-modal-body">
      <div id="p3d-ri-status" class="p3d-ri-status">Carregando...</div>
      <div id="p3d-ri-info" class="p3d-ri-info"></div>
      <div class="p3d-ri-sec-head">
        <span>Verificações</span>
      </div>
      ${kanbanLocal ? `<p class="p3d-ri-hint">Exibindo verificações do kanban: <b>${esc(kanbanLocal)}</b></p>` : ''}
      <div id="p3d-ri-lista"></div>
      <div class="p3d-ri-ocorrencias">
        <div class="p3d-ri-sec-head">
          <span>Ocorrências (falhas detectadas)</span>
          <button type="button" id="p3d-ri-btn-ocorrencia" class="p3d-btn p3d-btn-warn">
            ⚠ Registrar ocorrência
          </button>
        </div>
        <div id="p3d-ri-lista-niq"></div>
      </div>
    </div>
    <footer class="p3d-modal-footer">
      <div id="p3d-ri-spinner" class="p3d-ri-spinner" hidden>
        <div class="p3d-ri-spinner-inner"></div>
        <span>Registrando RI...</span>
      </div>
      <button type="button" class="p3d-btn p3d-btn-secondary" data-close>Fechar</button>
      ${isRiAvancar
    ? `<button type="button" id="p3d-ri-btn-registrar" class="p3d-btn p3d-btn-primary" hidden>
            ✓ Registrar RI
          </button>`
    : `<button type="button" id="p3d-ri-btn-registrar" class="p3d-btn p3d-btn-primary">
            Salvar
          </button>`}
    </footer>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const statusEl = modal.querySelector('#p3d-ri-status');
  const infoEl = modal.querySelector('#p3d-ri-info');
  const listaEl = modal.querySelector('#p3d-ri-lista');
  const listaNiqEl = modal.querySelector('#p3d-ri-lista-niq');
  const btnRegistrar = modal.querySelector('#p3d-ri-btn-registrar');
  const btnOcorrencia = modal.querySelector('#p3d-ri-btn-ocorrencia');
  const spinnerEl = modal.querySelector('#p3d-ri-spinner');
  const btnCloseFooter = modal.querySelector('[data-close]');
  const btnCloseHeader = modal.querySelector('.p3d-modal-close');

  let riCheckId = null;
  let riCheckData = null;
  let riDadosProntos = false;
  let riJaRegistrado = false;
  let riAtivo = false;
  let riProdutoMeta = null;
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (typeof opts.onDone === 'function') opts.onDone();
  }

  btnCloseHeader?.addEventListener('click', close);
  btnCloseFooter?.addEventListener('click', close);

  function atualizarBtnRegistrarVisivel() {
    if (!btnRegistrar || !isRiAvancar) return;
    if (!spinnerEl?.hidden) return;
    if (!riAtivo || riJaRegistrado) {
      btnRegistrar.hidden = true;
      return;
    }
    btnRegistrar.hidden = !riDadosProntos;
  }

  function setRegistrandoRi(ativo) {
    if (spinnerEl) spinnerEl.hidden = !ativo;
    if (btnCloseFooter) btnCloseFooter.disabled = !!ativo;
    if (btnCloseHeader) btnCloseHeader.disabled = !!ativo;
    if (btnOcorrencia) btnOcorrencia.disabled = !!ativo;
    if (btnRegistrar) {
      if (ativo) {
        btnRegistrar.hidden = true;
        btnRegistrar.disabled = true;
      } else {
        btnRegistrar.disabled = false;
        atualizarBtnRegistrarVisivel();
      }
    }
  }

  function renderLista(verificacoes) {
    const items = (verificacoes || []).filter((v) => {
      if (!kanbanLocal) return true;
      return String(v.local || '').trim() === kanbanLocal;
    });
    if (!items.length) {
      listaEl.innerHTML = `<div class="p3d-ri-empty">Nenhuma verificação neste kanban (${esc(kanbanLocal || '—')}).</div>`;
      return;
    }
    listaEl.innerHTML = items.map((v) => {
      const fotoHtml = v.foto
        ? `<a href="${esc(v.foto)}" target="_blank" rel="noopener"><img src="${esc(v.foto)}" alt="Foto" class="p3d-ri-thumb"></a>`
        : '<span class="p3d-ri-muted">—</span>';
      const videoHtml = v.video
        ? `<a href="${esc(v.video)}" target="_blank" rel="noopener" class="p3d-ri-link">▶ Ver vídeo</a>`
        : '<span class="p3d-ri-muted">—</span>';
      return `<div class="p3d-ri-card">
        <div class="p3d-ri-card-top">
          <div class="p3d-ri-card-title">${esc(v.check_nome || '—')}</div>
          <span class="p3d-ri-badge">${esc(v.local || '—')}</span>
        </div>
        <div class="p3d-ri-card-desc">${esc(v.descricao_check || '—')}</div>
        <div class="p3d-ri-media">
          <div><div class="p3d-ri-muted">Foto</div>${fotoHtml}</div>
          <div><div class="p3d-ri-muted">Vídeo</div>${videoHtml}</div>
        </div>
      </div>`;
    }).join('');
  }

  function renderListaNiq(ocorrencias) {
    if (!listaNiqEl) return;
    const items = ocorrencias || [];
    if (!items.length) {
      listaNiqEl.innerHTML = '<div class="p3d-ri-empty">Nenhuma ocorrência registrada.</div>';
      return;
    }
    listaNiqEl.innerHTML = items.map((o) => {
      const fotoHtml = o.foto
        ? `<a href="${esc(o.foto)}" target="_blank" rel="noopener"><img src="${esc(o.foto)}" alt="Foto" class="p3d-ri-thumb"></a>`
        : '<span class="p3d-ri-muted">—</span>';
      const videoHtml = o.video
        ? `<a href="${esc(o.video)}" target="_blank" rel="noopener" class="p3d-ri-link">▶ Ver vídeo</a>`
        : '<span class="p3d-ri-muted">—</span>';
      const dt = o.created_at ? String(o.created_at).replace('T', ' ').slice(0, 16) : '—';
      return `<div class="p3d-ri-card p3d-ri-card-warn">
        <div class="p3d-ri-card-top">
          <div class="p3d-ri-card-title warn">#${esc(String(o.id))} · ${esc(o.falha_detectada || '—')}</div>
          <span class="p3d-ri-muted">${esc(dt)}</span>
        </div>
        <div class="p3d-ri-media">
          <div><div class="p3d-ri-muted">Foto</div>${fotoHtml}</div>
          <div><div class="p3d-ri-muted">Vídeo</div>${videoHtml}</div>
        </div>
      </div>`;
    }).join('');
  }

  async function recarregarNiq() {
    if (!riCheckId) return;
    try {
      const rec = await fetch(`/api/qualidade/ri-check/${riCheckId}/niq`, { credentials: 'include' });
      const recData = await rec.json();
      if (rec.ok && recData.ok) renderListaNiq(recData.ocorrencias);
    } catch (_) { /* silencioso */ }
  }

  function renderInfo(check) {
    if (!check) {
      riCheckData = null;
      riCheckId = null;
      riDadosProntos = true;
      const codShow = riProdutoMeta?.codigo || codigo;
      infoEl.innerHTML = `
        <div class="p3d-ri-grid">
          <div><span class="p3d-ri-muted">Código:</span> <b>${esc(codShow)}</b></div>
          <div><span class="p3d-ri-muted">OP:</span> <b>${esc(opIdent)}</b></div>
          <div><span class="p3d-ri-muted">Posto:</span> <b class="p3d-ri-accent">${esc(kanbanLocal || '—')}</b></div>
          <div><span class="p3d-ri-muted">Status RI:</span> <b class="p3d-ri-warn">Aguardando registro</b></div>
        </div>
        ${(riProdutoMeta?.descricao || descricao)
    ? `<div class="p3d-ri-desc">${esc(riProdutoMeta?.descricao || descricao)}</div>`
    : ''}
        <div class="p3d-ri-hint">Revise as verificações abaixo e clique em <b>Registrar RI</b> para gravar.</div>`;
      if (btnRegistrar && isRiAvancar) {
        btnRegistrar.disabled = false;
        btnRegistrar.style.opacity = '1';
      }
      atualizarBtnRegistrarVisivel();
      return;
    }
    riCheckData = check;
    riCheckId = check.id;
    riDadosProntos = !!check.id;
    const st = String(check.status || 'Em andamento');
    const stCor = st === 'Liberado' ? '#4ade80'
      : (st === 'Teste' ? '#fdba74'
        : (st === 'Teste OK' ? '#d8b4fe'
          : (st === 'Finalizado' ? '#86efac' : '#facc15')));
    infoEl.innerHTML = `
      <div class="p3d-ri-grid">
        <div><span class="p3d-ri-muted">ID RI:</span> <b>${esc(String(check.id))}</b></div>
        <div><span class="p3d-ri-muted">Código:</span> <b>${esc(check.codigo || codigo)}</b></div>
        ${check.codigo_produto ? `<div><span class="p3d-ri-muted">ID produto:</span> <b>${esc(String(check.codigo_produto))}</b></div>` : ''}
        <div><span class="p3d-ri-muted">Status:</span> <b style="color:${stCor}">${esc(st)}</b></div>
      </div>
      ${check.descricao ? `<div class="p3d-ri-desc">${esc(check.descricao)}</div>` : ''}`;
    if (btnRegistrar && isRiAvancar) {
      btnRegistrar.disabled = !riAtivo || riJaRegistrado;
      btnRegistrar.style.opacity = (!riAtivo || riJaRegistrado) ? '0.5' : '1';
    }
    atualizarBtnRegistrarVisivel();
  }

  async function carregar() {
    riDadosProntos = false;
    riJaRegistrado = false;
    riAtivo = false;
    riCheckId = null;
    riCheckData = null;
    atualizarBtnRegistrarVisivel();
    statusEl.textContent = 'Carregando verificações...';
    statusEl.className = 'p3d-ri-status';
    try {
      const resp = await fetch('/api/qualidade/ri-check/preparar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          op_producao_id: opId,
          op_iapp_id: opId,
          numero_op: opIdent,
          codigo,
          descricao,
          codigo_produto: op.codigo_produto || null,
          kanban_local: kanbanLocal,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || `Erro ${resp.status}`);
      riProdutoMeta = data.produto || null;
      riAtivo = data.ri_ativo === true;
      riJaRegistrado = !riAtivo || !!data.ja_registrado;
      renderInfo(data.check || null);
      renderLista(data.verificacoes);
      renderListaNiq(data.ocorrencias || []);
      statusEl.textContent = !riAtivo
        ? 'RI já liberada (checkbox desativado).'
        : (data.template_apenas
          ? 'Verificações carregadas — clique em Registrar RI para gravar.'
          : (riJaRegistrado ? 'RI já registrado neste posto.' : ''));
      if (!riAtivo || riJaRegistrado) statusEl.classList.add('ok');
    } catch (err) {
      statusEl.textContent = err.message || 'Falha ao carregar RI.';
      statusEl.classList.add('err');
      riDadosProntos = false;
      atualizarBtnRegistrarVisivel();
    }
  }

  function abrirModalOcorrencia() {
    if (!riCheckId) {
      alert('Clique em "Registrar RI" para gravar o registro antes de registrar ocorrências.');
      return;
    }

    const sub = document.createElement('div');
    sub.className = 'p3d-modal-overlay p3d-modal-overlay--sub';
    sub.innerHTML = `
      <div class="p3d-modal p3d-modal--sm">
        <header>
          <div>
            <h2>Registrar ocorrência</h2>
            <span>OP ${esc(opIdent)}</span>
          </div>
          <button type="button" class="p3d-modal-close" aria-label="Fechar">&times;</button>
        </header>
        <div class="p3d-modal-body">
          <label class="p3d-field">
            <span>Falha detectada *</span>
            <textarea id="p3d-niq-falha" rows="4" inputmode="text" autocomplete="off"
              placeholder="Toque aqui e digite a falha encontrada"></textarea>
          </label>
          <div class="p3d-field">
            <span>Evidência</span>
            <div class="p3d-evidencia-row">
              <button type="button" id="p3d-niq-anexar" class="p3d-btn p3d-btn-secondary">
                📎 Anexar evidência
              </button>
              <input type="file" id="p3d-niq-file" accept="image/*,video/*" multiple hidden>
              <span id="p3d-niq-file-label" class="p3d-ri-muted">Nenhum arquivo</span>
            </div>
          </div>
          <p id="p3d-niq-status" class="p3d-ri-status"></p>
        </div>
        <footer class="p3d-modal-footer">
          <button type="button" class="p3d-btn p3d-btn-secondary" data-cancel>Cancelar</button>
          <button type="button" id="p3d-niq-salvar" class="p3d-btn p3d-btn-danger">Registrar</button>
        </footer>
      </div>`;
    document.body.appendChild(sub);

    const fecharSub = () => sub.remove();
    sub.querySelector('.p3d-modal-close')?.addEventListener('click', fecharSub);
    sub.querySelector('[data-cancel]')?.addEventListener('click', fecharSub);
    sub.addEventListener('click', (e) => { if (e.target === sub) fecharSub(); });

    const ta = sub.querySelector('#p3d-niq-falha');
    const fileInput = sub.querySelector('#p3d-niq-file');
    const fileLabel = sub.querySelector('#p3d-niq-file-label');
    const btnAnexar = sub.querySelector('#p3d-niq-anexar');

    // Abre teclado (nativo) no celular/tablet
    requestAnimationFrame(() => {
      try {
        ta?.focus({ preventScroll: false });
      } catch (_) {
        ta?.focus();
      }
    });

    btnAnexar?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) {
        fileLabel.textContent = 'Nenhum arquivo';
        return;
      }
      fileLabel.textContent = files.map((f) => f.name).join(', ');
    });

    sub.querySelector('#p3d-niq-salvar')?.addEventListener('click', async () => {
      const falha = ta?.value?.trim();
      const files = Array.from(fileInput?.files || []);
      const st = sub.querySelector('#p3d-niq-status');
      if (!falha) {
        if (st) {
          st.textContent = 'Informe a falha detectada.';
          st.className = 'p3d-ri-status err';
        }
        ta?.focus();
        return;
      }
      const fd = new FormData();
      fd.append('falha_detectada', falha);
      let foto = null;
      let video = null;
      for (const f of files) {
        if (!foto && /^image\//i.test(f.type)) foto = f;
        else if (!video && /^video\//i.test(f.type)) video = f;
        else if (!foto && !/^video\//i.test(f.type)) foto = f;
        else if (!video) video = f;
      }
      if (foto) fd.append('foto', foto);
      if (video) fd.append('video', video);

      const btn = sub.querySelector('#p3d-niq-salvar');
      if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
      try {
        const resp = await fetch(`/api/qualidade/ri-check/${riCheckId}/niq`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || `Erro ${resp.status}`);
        fecharSub();
        await recarregarNiq();
        statusEl.textContent = 'Ocorrência registrada.';
        statusEl.className = 'p3d-ri-status ok';
      } catch (err) {
        if (st) {
          st.textContent = err.message || 'Falha ao registrar.';
          st.className = 'p3d-ri-status err';
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Registrar'; }
      }
    });
  }

  btnOcorrencia?.addEventListener('click', abrirModalOcorrencia);

  btnRegistrar?.addEventListener('click', async () => {
    if (!riDadosProntos || riJaRegistrado || !riAtivo) return;
    if (isRiAvancar) {
      const postoLabel = kanbanLocal || 'atual';
      if (!confirm(`Confirmar registro do RI no posto ${postoLabel}?`)) return;
    }
    setRegistrandoRi(true);
    try {
      if (!riCheckId) {
        const respAbrir = await fetch('/api/qualidade/ri-check/abrir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            op_producao_id: opId,
            op_iapp_id: opId,
            numero_op: opIdent,
            codigo,
            descricao,
            codigo_produto: op.codigo_produto || null,
            kanban_local: kanbanLocal,
          }),
        });
        const dataAbrir = await respAbrir.json();
        if (!respAbrir.ok || !dataAbrir.ok) throw new Error(dataAbrir.error || `Erro ${respAbrir.status}`);
        riCheckId = dataAbrir.check?.id || null;
        if (!riCheckId) throw new Error('Falha ao criar registro RI.');
        renderInfo(dataAbrir.check);
        renderLista(dataAbrir.verificacoes);
      }

      const respSalvar = await fetch(`/api/qualidade/ri-check/${riCheckId}/salvar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kanban_local: kanbanLocal }),
      });
      const dataSalvar = await respSalvar.json();
      if (!respSalvar.ok || !dataSalvar.ok) throw new Error(dataSalvar.error || `Erro ${respSalvar.status}`);

      if (isRiAvancar) {
        const respLib = await fetch(`/api/qualidade/ri-check/${riCheckId}/liberar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            kanban_origem: kanbanLocal,
            op_producao_id: opId,
            numero_op: opIdent,
          }),
        });
        const dataLib = await respLib.json();
        if (!respLib.ok || !dataLib.ok) throw new Error(dataLib.error || `Erro ${respLib.status}`);
        riAtivo = false;
        riJaRegistrado = true;
        renderInfo(dataLib.check);
        renderLista(dataLib.verificacoes);
        const postoRegistrado = dataLib.kanban_status || kanbanLocal || 'atual';
        statusEl.textContent = `RI registrado no posto ${postoRegistrado}.`;
        statusEl.className = 'p3d-ri-status ok';
        if (typeof opts.onRegistered === 'function') opts.onRegistered();
        close();
      } else {
        renderInfo(dataSalvar.check);
        renderLista(dataSalvar.verificacoes);
        statusEl.textContent = 'Registro salvo.';
        statusEl.className = 'p3d-ri-status ok';
        setRegistrandoRi(false);
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Falha ao registrar RI.';
      statusEl.className = 'p3d-ri-status err';
      setRegistrandoRi(false);
    }
  });

  void carregar();
}
