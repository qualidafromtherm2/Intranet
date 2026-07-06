// produtos/desenho_tecnico.js — desenho técnico por produto
(function initDesenhoTecnico() {
  const modal = document.getElementById('modalDesenhoTecnico');
  const form = document.getElementById('formDesenhoTecnico');
  const btnFechar = document.getElementById('modalDesenhoTecnicoFechar');
  const btnRegistrar = document.getElementById('dtBtnRegistrar');
  const modalTitulo = document.getElementById('modalDesenhoTecnicoTitulo');
  const inputId = document.getElementById('dtDesenhoId');
  const inputNome = document.getElementById('dtNomeArquivo');
  const inputAnexo = document.getElementById('dtAnexo');
  const statusAnexo = document.getElementById('dtAnexoStatus');
  const wrapSubstituir = document.getElementById('dtSubstituirWrap');
  const selSubstituir = document.getElementById('dtSubstituir');
  const wrapAnexoAtual = document.getElementById('dtAnexoAtualWrap');
  const linkAnexoAtual = document.getElementById('dtAnexoAtualLink');
  const labelAnexoObrigatorio = document.getElementById('dtAnexoObrigatorio');

  if (!modal || !form) return;

  let cacheDesenhos = [];

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

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function atualizarStatusAnexo() {
    if (!inputAnexo || !statusAnexo) return;
    const file = inputAnexo.files?.[0];
    statusAnexo.classList.remove('has-file');
    if (file) {
      statusAnexo.classList.add('has-file');
      statusAnexo.innerHTML = `<span class="dt-file-name"><i class="fa-solid fa-circle-check"></i> ${escHtml(file.name)}</span>`;
    } else {
      statusAnexo.textContent = 'Nenhum arquivo selecionado';
    }
  }

  function limparStatusAnexo() {
    if (inputAnexo) inputAnexo.value = '';
    if (statusAnexo) {
      statusAnexo.classList.remove('has-file');
      statusAnexo.textContent = 'Nenhum arquivo selecionado';
    }
  }

  function montarOpcoesSubstituir(ativos) {
    if (!selSubstituir) return;
    selSubstituir.innerHTML = '<option value="">Novo desenho (V1)</option>';
    ativos.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = String(item.id);
      opt.textContent = `${item.nome_arquivo} — V${item.versao}`;
      selSubstituir.appendChild(opt);
    });
    if (wrapSubstituir) {
      wrapSubstituir.style.display = ativos.length ? 'block' : 'none';
    }
  }

  function resetModal() {
    if (inputId) inputId.value = '';
    if (modalTitulo) modalTitulo.textContent = 'Desenho técnico';
    if (btnRegistrar) {
      btnRegistrar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Registrar';
    }
    if (wrapAnexoAtual) wrapAnexoAtual.style.display = 'none';
    if (wrapSubstituir) wrapSubstituir.style.display = 'none';
    if (labelAnexoObrigatorio) labelAnexoObrigatorio.style.display = '';
    if (inputAnexo) inputAnexo.required = true;
    form.reset();
    limparStatusAnexo();
    montarOpcoesSubstituir(cacheDesenhos.filter((d) => String(d.status).toLowerCase() === 'ativo'));
  }

  function fecharModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    resetModal();
  }

  async function abrirModalNovo() {
    const codigo = obterCodigoOmieAtual();
    if (!codigo || codigo === 'N/A') {
      alert('Selecione um produto na lista antes de registrar um desenho técnico.');
      return;
    }

    await carregarDesenhosTecnico(true);
    resetModal();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function abrirModalEdicao(row) {
    if (!row?.id) return;

    resetModal();
    if (inputId) inputId.value = String(row.id);
    if (modalTitulo) modalTitulo.textContent = 'Editar desenho técnico';
    if (btnRegistrar) {
      btnRegistrar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar alterações';
    }
    if (inputNome) inputNome.value = row.nome_arquivo || '';
    if (wrapSubstituir) wrapSubstituir.style.display = 'none';
    if (labelAnexoObrigatorio) labelAnexoObrigatorio.style.display = 'none';
    if (inputAnexo) inputAnexo.required = false;

    if (row.anexo && wrapAnexoAtual && linkAnexoAtual) {
      wrapAnexoAtual.style.display = 'block';
      linkAnexoAtual.href = row.anexo;
      linkAnexoAtual.textContent = row.nome_arquivo || 'Ver anexo';
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  window.abrirModalDesenhoTecnico = abrirModalNovo;
  window.abrirModalEdicaoDesenhoTecnico = abrirModalEdicao;

  async function carregarDesenhosTecnico(silencioso = false) {
    const codigo = obterCodigoOmieAtual();
    const loadingEl = document.getElementById('desenhoTecnicoLoading');
    const tableEl = document.getElementById('desenhoTecnicoTable');
    const bodyEl = document.getElementById('desenhoTecnicoBody');
    const vazioEl = document.getElementById('desenhoTecnicoVazio');

    if (!bodyEl) return cacheDesenhos;

    if (!codigo || codigo === 'N/A') {
      cacheDesenhos = [];
      if (tableEl) tableEl.style.display = 'none';
      if (loadingEl) loadingEl.style.display = 'none';
      if (vazioEl) {
        vazioEl.textContent = 'Selecione um produto para ver os desenhos técnicos.';
        vazioEl.style.display = 'block';
      }
      bodyEl.innerHTML = '';
      return cacheDesenhos;
    }

    if (!silencioso) {
      if (loadingEl) loadingEl.style.display = 'block';
      if (vazioEl) vazioEl.style.display = 'none';
      if (tableEl) tableEl.style.display = 'none';
    }

    try {
      const resp = await fetch(`/api/engenharia/desenho-tecnico/${encodeURIComponent(codigo)}`, {
        credentials: 'same-origin',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar desenhos técnicos.');

      cacheDesenhos = Array.isArray(data.desenhos) ? data.desenhos : [];
      bodyEl.innerHTML = '';

      if (!cacheDesenhos.length) {
        if (vazioEl) {
          vazioEl.textContent = 'Nenhum desenho técnico registrado para este produto.';
          vazioEl.style.display = 'block';
        }
        return cacheDesenhos;
      }

      cacheDesenhos.forEach((row) => {
        const ativo = String(row.status).toLowerCase() === 'ativo';
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.innerHTML = `
          <td style="padding:8px; white-space:nowrap;">${escHtml(formatarData(row.data))}</td>
          <td style="padding:8px;">${escHtml(row.nome_arquivo || '—')}</td>
          <td style="padding:8px;">V${escHtml(row.versao || 1)}</td>
          <td style="padding:8px;">
            <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:${ativo ? 'rgba(52,211,153,.15)' : 'rgba(148,163,184,.15)'};color:${ativo ? '#34d399' : '#94a3b8'};">
              ${ativo ? 'Ativo' : 'Inativo'}
            </span>
          </td>
          <td style="padding:8px;">
            ${row.anexo
              ? `<a href="${escHtml(row.anexo)}" target="_blank" rel="noopener" title="Abrir anexo"><i class="fa-solid fa-file"></i></a>`
              : '—'}
          </td>
          <td style="padding:8px;">
            <button type="button" class="content-button dt-btn-editar"
              style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#fff;padding:6px 12px;font-size:12px;">
              <i class="fa-solid fa-pen"></i> Editar
            </button>
          </td>
        `;
        tr.querySelector('.dt-btn-editar')?.addEventListener('click', () => abrirModalEdicao(row));
        bodyEl.appendChild(tr);
      });

      if (tableEl) tableEl.style.display = 'table';
      if (vazioEl) vazioEl.style.display = 'none';
    } catch (err) {
      console.error('[Desenho técnico]', err);
      if (vazioEl) {
        vazioEl.textContent = err.message || 'Erro ao carregar desenhos técnicos.';
        vazioEl.style.display = 'block';
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }

    return cacheDesenhos;
  }

  window.recarregarDesenhosTecnico = carregarDesenhosTecnico;

  function initTabDesenho() {
    const tabLink = document.querySelector(
      '#dadosProduto .sub-tabs .main-header-link[data-subtarget="desenhoTecnicoTab"]'
    );
    if (!tabLink) return;
    tabLink.addEventListener('click', () => {
      setTimeout(() => carregarDesenhosTecnico(false), 0);
    });
  }

  window.addEventListener('produto-carregado', () => {
    const visivel = document.getElementById('desenhoTecnicoTab')?.style.display !== 'none';
    if (visivel) carregarDesenhosTecnico(false);
  });

  if (inputAnexo) {
    inputAnexo.addEventListener('change', atualizarStatusAnexo);
    atualizarStatusAnexo();
  }

  initTabDesenho();

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

    const nomeArquivo = String(inputNome?.value || '').trim();
    if (!nomeArquivo) {
      alert('Informe o nome do arquivo.');
      return;
    }

    const arquivo = inputAnexo?.files?.[0];
    if (!isEdicao && !arquivo) {
      alert('Anexe o arquivo do desenho técnico.');
      return;
    }

    const fd = new FormData();
    if (!isEdicao) fd.append('codigo_omie', codigoOmie);
    fd.append('nome_arquivo', nomeArquivo);
    if (arquivo) fd.append('anexo', arquivo);

    if (!isEdicao && selSubstituir?.value) {
      fd.append('substituir_id', selSubstituir.value);
    }

    const originalHtml = btnRegistrar?.innerHTML;
    if (btnRegistrar) {
      btnRegistrar.disabled = true;
      btnRegistrar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    try {
      const url = isEdicao
        ? `/api/engenharia/desenho-tecnico/${encodeURIComponent(editId)}`
        : '/api/engenharia/desenho-tecnico';
      const resp = await fetch(url, {
        method: isEdicao ? 'PUT' : 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao salvar desenho técnico.');

      alert(isEdicao ? 'Desenho técnico atualizado com sucesso!' : 'Desenho técnico registrado com sucesso!');
      fecharModal();
      await carregarDesenhosTecnico(false);
      if (typeof window.recarregarEngDesenhosGlobal === 'function') {
        window.recarregarEngDesenhosGlobal();
      }
    } catch (err) {
      console.error('[Desenho técnico]', err);
      alert(err.message || 'Erro ao salvar desenho técnico.');
    } finally {
      if (btnRegistrar) {
        btnRegistrar.disabled = false;
        btnRegistrar.innerHTML = originalHtml;
      }
    }
  });
})();
