// produtos/alteracao_produto.js — modal e histórico de alteração de produto
(function initAlteracaoProduto() {
  const modal = document.getElementById('modalAlteracaoProduto');
  const form = document.getElementById('formAlteracaoProduto');
  const btnFechar = document.getElementById('modalAlteracaoProdutoFechar');
  const btnRegistrar = document.getElementById('apBtnRegistrar');
  const modalTitulo = document.getElementById('modalAlteracaoProdutoTitulo');
  const inputId = document.getElementById('apAlteracaoId');
  const selTipo = document.getElementById('apReferenciaTipo');
  const wrapLote = document.getElementById('apReferenciaLoteWrap');
  const wrapData = document.getElementById('apReferenciaDataWrap');
  const inputLote = document.getElementById('apReferenciaLote');
  const inputData = document.getElementById('apReferenciaData');
  const wrapAnexosAtuais = document.getElementById('apAnexosAtuaisWrap');
  const listaAnexosAtuais = document.getElementById('apAnexosAtuaisLista');

  const FILE_FIELDS = [
    { inputId: 'apFotoAntes', statusId: 'apFotoAntesStatus', label: 'Foto antes' },
    { inputId: 'apFotoDepois', statusId: 'apFotoDepoisStatus', label: 'Foto depois' },
    { inputId: 'apVideo', statusId: 'apVideoStatus', label: 'Vídeo' },
    { inputId: 'apArquivo', statusId: 'apArquivoStatus', label: 'Arquivo' },
  ];

  if (!modal || !form) return;

  function normalizarCodigoOmie(valor) {
    const raw = String(valor ?? '').trim();
    if (!raw || raw === 'N/A') return '';
    return raw.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, '');
  }

  function obterCodigoInternoAtual() {
    return String(
      document.getElementById('productTitle')?.textContent
      || document.getElementById('headerCodigo')?.textContent
      || window.codigoSelecionado
      || ''
    ).trim();
  }

  function obterCodigoOmieAtual() {
    const candidatos = [
      window.codigoOmieSelecionado,
      document.getElementById('codigo_produto')?.value,
      window.produtoPIRAtual?.id_omie,
      window.produtoRIAtual?.id_omie,
      document.getElementById('headerCodigoOmie')?.textContent,
    ];
    for (const item of candidatos) {
      const codigo = normalizarCodigoOmie(item);
      if (codigo) return codigo;
    }
    return obterCodigoInternoAtual();
  }

  function parseReferencia(ref) {
    const raw = String(ref || '').trim();
    if (!raw) return { tipo: '', valor: '' };
    const match = raw.match(/^(Lote|Data):\s*(.+)$/i);
    if (match) {
      const tipo = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
      let valor = match[2].trim();
      if (tipo === 'Data' && /^\d{2}\/\d{2}\/\d{4}/.test(valor)) {
        const [d, m, y] = valor.split(/[\/\s]/)[0].split('/');
        valor = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      return { tipo, valor };
    }
    return { tipo: '', valor: raw };
  }

  function formatarData(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function formatarReferencia(ref) {
    const { tipo, valor } = parseReferencia(ref);
    if (!tipo && !valor) return '—';
    if (tipo === 'Data') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        const [y, m, d] = valor.split('-');
        return `${d}/${m}/${y}`;
      }
      return formatarData(valor);
    }
    if (tipo === 'Lote') return `Lote: ${valor}`;
    return ref || '—';
  }

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncar(texto, max = 80) {
    const t = String(texto || '').trim();
    if (t.length <= max) return t || '—';
    return `${t.slice(0, max)}…`;
  }

  function atualizarStatusArquivo(inputId, statusId) {
    const input = document.getElementById(inputId);
    const status = document.getElementById(statusId);
    if (!input || !status) return;

    const file = input.files?.[0];
    status.classList.remove('has-file');
    if (file) {
      status.classList.add('has-file');
      status.innerHTML = `<span class="ap-file-name"><i class="fa-solid fa-circle-check"></i> ${escHtml(file.name)}</span>`;
    } else {
      status.textContent = 'Nenhum arquivo selecionado';
    }
  }

  function limparStatusArquivos() {
    FILE_FIELDS.forEach(({ inputId, statusId }) => {
      const input = document.getElementById(inputId);
      const status = document.getElementById(statusId);
      if (input) input.value = '';
      if (status) {
        status.classList.remove('has-file');
        status.textContent = 'Nenhum arquivo selecionado';
      }
    });
  }

  function initFileInputs() {
    FILE_FIELDS.forEach(({ inputId, statusId }) => {
      const input = document.getElementById(inputId);
      if (!input) return;
      atualizarStatusArquivo(inputId, statusId);
      input.addEventListener('change', () => atualizarStatusArquivo(inputId, statusId));
    });
  }

  function atualizarCampoReferencia() {
    const tipo = selTipo?.value || '';
    if (wrapLote) wrapLote.style.display = tipo === 'Lote' ? 'block' : 'none';
    if (wrapData) wrapData.style.display = tipo === 'Data' ? 'block' : 'none';
    if (inputLote) inputLote.required = tipo === 'Lote';
    if (inputData) inputData.required = tipo === 'Data';
  }

  function renderAnexosAtuais(row) {
    if (!wrapAnexosAtuais || !listaAnexosAtuais) return;
    const itens = [
      { label: 'Foto antes', url: row.foto_antes },
      { label: 'Foto depois', url: row.foto_depois },
      { label: 'Vídeo', url: row.video },
      { label: 'Arquivo', url: row.arquivo },
    ].filter((i) => i.url);

    if (!itens.length) {
      wrapAnexosAtuais.style.display = 'none';
      listaAnexosAtuais.innerHTML = '';
      return;
    }

    wrapAnexosAtuais.style.display = 'block';
    listaAnexosAtuais.innerHTML = itens.map((item) => `
      <a href="${escHtml(item.url)}" target="_blank" rel="noopener noreferrer"
         style="color:#38bdf8;text-decoration:underline;display:inline-flex;align-items:center;gap:6px;">
        <i class="fa-solid fa-paperclip"></i> ${escHtml(item.label)} — ver anexo atual
      </a>
    `).join('');
  }

  function resetModalCriacao() {
    if (inputId) inputId.value = '';
    if (modalTitulo) modalTitulo.textContent = 'Alteração de produto';
    if (btnRegistrar) {
      btnRegistrar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Registrar';
    }
    if (wrapAnexosAtuais) wrapAnexosAtuais.style.display = 'none';
    if (listaAnexosAtuais) listaAnexosAtuais.innerHTML = '';
    form.reset();
    limparStatusArquivos();
    atualizarCampoReferencia();
  }

  function fecharModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    resetModalCriacao();
  }

  function abrirModal() {
    const codigo = obterCodigoOmieAtual();
    if (!codigo || codigo === 'N/A') {
      alert('Selecione um produto na lista antes de registrar uma alteração.');
      return;
    }

    resetModalCriacao();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function abrirModalEdicao(row) {
    if (!row?.id) return;

    resetModalCriacao();
    if (inputId) inputId.value = String(row.id);
    if (modalTitulo) modalTitulo.textContent = 'Editar alteração de produto';
    if (btnRegistrar) {
      btnRegistrar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar alterações';
    }

    document.getElementById('apAntes').value = row.antes || '';
    document.getElementById('apDepois').value = row.depois || '';

    const ref = parseReferencia(row.referencia);
    if (selTipo) selTipo.value = ref.tipo || '';
    atualizarCampoReferencia();
    if (ref.tipo === 'Lote' && inputLote) inputLote.value = ref.valor;
    if (ref.tipo === 'Data' && inputData) inputData.value = ref.valor;

    renderAnexosAtuais(row);
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  window.abrirModalAlteracaoProduto = abrirModal;
  window.abrirModalEdicaoAlteracao = abrirModalEdicao;

  function montarLinksAnexos(row) {
    const links = [];
    if (row.foto_antes) links.push(`<a href="${escHtml(row.foto_antes)}" target="_blank" rel="noopener" title="Foto antes"><i class="fa-solid fa-image"></i></a>`);
    if (row.foto_depois) links.push(`<a href="${escHtml(row.foto_depois)}" target="_blank" rel="noopener" title="Foto depois"><i class="fa-solid fa-image"></i></a>`);
    if (row.video) links.push(`<a href="${escHtml(row.video)}" target="_blank" rel="noopener" title="Vídeo"><i class="fa-solid fa-video"></i></a>`);
    if (row.arquivo) links.push(`<a href="${escHtml(row.arquivo)}" target="_blank" rel="noopener" title="Arquivo"><i class="fa-solid fa-file"></i></a>`);
    if (!links.length) return '—';
    return `<span style="display:inline-flex;gap:10px;font-size:16px;">${links.join('')}</span>`;
  }

  async function carregarHistoricoAlteracoes() {
    const codigo = obterCodigoOmieAtual();
    const loadingEl = document.getElementById('alteracoesHistoricoLoading');
    const tableEl = document.getElementById('alteracoesHistoricoTable');
    const bodyEl = document.getElementById('alteracoesHistoricoBody');
    const vazioEl = document.getElementById('alteracoesHistoricoVazio');

    if (!bodyEl) return;

    if (!codigo || codigo === 'N/A') {
      if (tableEl) tableEl.style.display = 'none';
      if (loadingEl) loadingEl.style.display = 'none';
      if (vazioEl) {
        vazioEl.textContent = 'Selecione um produto para ver o histórico.';
        vazioEl.style.display = 'block';
      }
      bodyEl.innerHTML = '';
      return;
    }

    if (loadingEl) loadingEl.style.display = 'block';
    if (vazioEl) vazioEl.style.display = 'none';
    if (tableEl) tableEl.style.display = 'none';

    try {
      const resp = await fetch(`/api/engenharia/alteracoes-produto/${encodeURIComponent(codigo)}`, {
        credentials: 'same-origin',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar histórico.');

      const rows = Array.isArray(data.alteracoes) ? data.alteracoes : [];
      bodyEl.innerHTML = '';

      if (!rows.length) {
        if (vazioEl) {
          vazioEl.textContent = 'Nenhuma alteração registrada para este produto.';
          vazioEl.style.display = 'block';
        }
        return;
      }

      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.innerHTML = `
          <td style="padding:8px; white-space:nowrap;">${escHtml(formatarData(row.data))}</td>
          <td style="padding:8px; max-width:180px;" title="${escHtml(row.antes || '')}">${escHtml(truncar(row.antes))}</td>
          <td style="padding:8px; max-width:180px;" title="${escHtml(row.depois || '')}">${escHtml(truncar(row.depois))}</td>
          <td style="padding:8px; white-space:nowrap;">${escHtml(formatarReferencia(row.referencia))}</td>
          <td style="padding:8px;">${montarLinksAnexos(row)}</td>
          <td style="padding:8px;">
            <button type="button" class="content-button ap-btn-editar-alteracao"
              style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#fff;padding:6px 12px;font-size:12px;">
              <i class="fa-solid fa-pen"></i> Editar
            </button>
          </td>
        `;
        tr.querySelector('.ap-btn-editar-alteracao')?.addEventListener('click', () => {
          abrirModalEdicao(row);
        });
        bodyEl.appendChild(tr);
      });

      if (tableEl) tableEl.style.display = 'table';
    } catch (err) {
      console.error('[Histórico alterações]', err);
      if (vazioEl) {
        vazioEl.textContent = err.message || 'Erro ao carregar histórico.';
        vazioEl.style.display = 'block';
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  window.recarregarHistoricoAlteracoes = carregarHistoricoAlteracoes;

  function initTabHistorico() {
    const tabLink = document.querySelector(
      '#dadosProduto .sub-tabs .main-header-link[data-subtarget="alteracoesHistoricoTab"]'
    );
    if (!tabLink) return;
    tabLink.addEventListener('click', () => {
      setTimeout(carregarHistoricoAlteracoes, 0);
    });
  }

  window.addEventListener('produto-carregado', () => {
    const historicoVisivel = document.getElementById('alteracoesHistoricoTab')?.style.display !== 'none';
    if (historicoVisivel) {
      carregarHistoricoAlteracoes();
    }
  });

  initFileInputs();
  initTabHistorico();

  selTipo?.addEventListener('change', atualizarCampoReferencia);

  btnFechar?.addEventListener('click', fecharModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const editId = String(inputId?.value || '').trim();
    const isEdicao = !!editId;
    const codigoOmie = obterCodigoOmieAtual();

    if (!isEdicao && (!codigoOmie || codigoOmie === 'N/A')) {
      alert('Código OMIE do produto não encontrado.');
      return;
    }

    const referenciaTipo = selTipo?.value || '';
    let referenciaValor = '';
    if (referenciaTipo === 'Lote') {
      referenciaValor = String(inputLote?.value || '').trim();
      if (!referenciaValor) {
        alert('Informe o número do lote.');
        return;
      }
    } else if (referenciaTipo === 'Data') {
      referenciaValor = String(inputData?.value || '').trim();
      if (!referenciaValor) {
        alert('Selecione a data de referência.');
        return;
      }
    }

    const fd = new FormData();
    if (!isEdicao) fd.append('codigo_omie', codigoOmie);
    fd.append('antes', document.getElementById('apAntes')?.value || '');
    fd.append('depois', document.getElementById('apDepois')?.value || '');
    if (referenciaTipo) {
      fd.append('referencia_tipo', referenciaTipo);
      fd.append('referencia_valor', referenciaValor);
    }

    const fotoAntes = document.getElementById('apFotoAntes')?.files?.[0];
    const fotoDepois = document.getElementById('apFotoDepois')?.files?.[0];
    const video = document.getElementById('apVideo')?.files?.[0];
    const arquivo = document.getElementById('apArquivo')?.files?.[0];
    if (fotoAntes) fd.append('foto_antes', fotoAntes);
    if (fotoDepois) fd.append('foto_depois', fotoDepois);
    if (video) fd.append('video', video);
    if (arquivo) fd.append('arquivo', arquivo);

    const originalHtml = btnRegistrar?.innerHTML;
    if (btnRegistrar) {
      btnRegistrar.disabled = true;
      btnRegistrar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    try {
      const url = isEdicao
        ? `/api/engenharia/alteracoes-produto/${encodeURIComponent(editId)}`
        : '/api/engenharia/alteracoes-produto';
      const resp = await fetch(url, {
        method: isEdicao ? 'PUT' : 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Falha ao salvar alteração.');
      }
      alert(isEdicao ? 'Alteração atualizada com sucesso!' : 'Alteração registrada com sucesso!');
      fecharModal();
      await carregarHistoricoAlteracoes();
      if (typeof window.recarregarEngAlteracoesGlobal === 'function') {
        window.recarregarEngAlteracoesGlobal();
      }
    } catch (err) {
      console.error('[Alteração produto]', err);
      alert(err.message || 'Erro ao salvar alteração.');
    } finally {
      if (btnRegistrar) {
        btnRegistrar.disabled = false;
        btnRegistrar.innerHTML = originalHtml;
      }
    }
  });
})();
