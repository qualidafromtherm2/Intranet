/**
 * Aba Variação em Informações do produto
 * Grupo (variacao_tipo) + valores (produto_variacao) — um valor por vez.
 */
let _varInited = false;
let _varLastTipoId = null;

function varEsc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function varFetch(url, init = {}) {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function codigoProdutoAtual() {
  return String(window.codigoSelecionado || window.currentProdutoCodigo || '').trim();
}

async function carregarTiposVariacao(preferTipoId = null) {
  const sel = document.getElementById('variacaoTipoSelect');
  if (!sel) return;
  const tipos = await varFetch('/api/produtos/variacoes/tipos');
  const keep = preferTipoId != null ? Number(preferTipoId) : (Number(sel.value) || _varLastTipoId);
  sel.innerHTML = ['<option value="">Selecione o grupo…</option>']
    .concat((tipos || []).map((t) => `<option value="${t.id}">${varEsc(t.nome)}</option>`))
    .join('');
  if (keep && [...sel.options].some((o) => Number(o.value) === keep)) {
    sel.value = String(keep);
  }
}

function renderListaVariacoes(data) {
  const box = document.getElementById('variacaoLista');
  if (!box) return;
  const grupos = data?.variacoes || [];
  if (!grupos.length) {
    box.innerHTML = '<p style="color:var(--inactive-color);font-size:13px;">Nenhum grupo de variação neste produto. Crie um grupo acima e adicione valores.</p>';
    return;
  }
  box.innerHTML = grupos.map((g) => {
    const vals = g.valores || [];
    return `
    <div class="variacao-grupo" data-tipo-id="${g.tipo_id}" style="border:1px solid var(--border-color);border-radius:12px;padding:0;margin-bottom:12px;overflow:hidden;background:var(--content-bg);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:rgba(59,130,246,.08);border-bottom:1px solid var(--border-color);">
        <div style="font-weight:700;color:var(--content-title-color);font-size:14px;">
          <i class="fa-solid fa-layer-group" style="opacity:.7;margin-right:6px;"></i>${varEsc(g.tipo_nome)}
          <span style="font-weight:500;font-size:12px;color:var(--inactive-color);margin-left:8px;">${vals.length} valor${vals.length === 1 ? '' : 'es'}</span>
        </div>
        <button type="button" class="variacao-usar-grupo-btn btn" data-tipo-id="${g.tipo_id}"
          style="padding:4px 10px;font-size:12px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--content-title-color);cursor:pointer;">
          Usar este grupo
        </button>
      </div>
      <div style="padding:0;">
        ${vals.length ? `
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="color:var(--inactive-color);text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.03em;">
              <th style="padding:8px 14px;font-weight:600;">Valor</th>
              <th style="padding:8px 14px;font-weight:600;width:90px;text-align:right;">Saldo</th>
              <th style="padding:8px 10px;width:44px;"></th>
            </tr>
          </thead>
          <tbody>
            ${vals.map((v) => `
              <tr style="border-top:1px solid var(--border-color);">
                <td style="padding:8px 14px;color:var(--content-title-color);">${varEsc(v.valor)}</td>
                <td style="padding:8px 14px;text-align:right;color:var(--inactive-color);">${Number(v.estoque_qtd) || 0}</td>
                <td style="padding:8px 10px;text-align:center;">
                  <button type="button" class="variacao-del-btn" data-id="${v.id}" title="Excluir valor"
                    style="border:none;background:transparent;color:#ef4444;cursor:pointer;padding:2px 6px;line-height:1;font-size:16px;">×</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : `
        <p style="margin:0;padding:12px 14px;font-size:13px;color:var(--inactive-color);">Grupo vazio — adicione um valor acima.</p>`}
      </div>
    </div>`;
  }).join('');
}

async function carregarVariacoesProduto() {
  const codigo = codigoProdutoAtual();
  const box = document.getElementById('variacaoLista');
  if (!codigo) {
    if (box) box.innerHTML = '<p style="color:var(--inactive-color);font-size:13px;">Abra um produto para cadastrar variações.</p>';
    return;
  }
  try {
    await carregarTiposVariacao(_varLastTipoId);
    const data = await varFetch(`/api/produtos/${encodeURIComponent(codigo)}/variacoes`);
    renderListaVariacoes(data);
  } catch (err) {
    if (box) box.innerHTML = `<p style="color:#ef4444;font-size:13px;">${varEsc(err.message || err)}</p>`;
  }
}

async function adicionarValorAoGrupo() {
  const codigo = codigoProdutoAtual();
  if (!codigo) {
    alert('Abra um produto primeiro.');
    return;
  }
  const tipoId = Number(document.getElementById('variacaoTipoSelect')?.value) || null;
  const tipoNovo = document.getElementById('variacaoTipoNovo')?.value?.trim() || '';
  const valorRaw = String(document.getElementById('variacaoValoresInput')?.value || '').trim();
  if (!tipoId && !tipoNovo) {
    alert('Selecione um grupo existente ou digite o nome de um novo grupo.');
    return;
  }
  if (!valorRaw) {
    alert('Informe um valor para adicionar ao grupo (ex.: G, 42, XG).');
    document.getElementById('variacaoValoresInput')?.focus();
    return;
  }
  // Um valor por vez — se colar com vírgula, pega só o primeiro e avisa
  const partes = valorRaw.split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean);
  const valor = partes[0];
  if (partes.length > 1) {
    alert('Adicione um valor por vez. Será incluído só o primeiro: ' + valor);
  }
  try {
    const resp = await varFetch(`/api/produtos/${encodeURIComponent(codigo)}/variacoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo_id: tipoId || undefined,
        tipo_nome: tipoNovo || undefined,
        valores: [valor],
      }),
    });
    const inserted = resp?.itens?.[0];
    if (inserted?.tipo_id) _varLastTipoId = Number(inserted.tipo_id);
    else if (tipoId) _varLastTipoId = tipoId;

    document.getElementById('variacaoValoresInput').value = '';
    document.getElementById('variacaoTipoNovo').value = '';
    await carregarVariacoesProduto();
    document.getElementById('variacaoValoresInput')?.focus();
  } catch (err) {
    alert(err.message || err);
  }
}

export function initProdutoVariacoesUI() {
  if (_varInited) return;
  _varInited = true;

  document.getElementById('variacaoSalvarBtn')?.addEventListener('click', () => {
    adicionarValorAoGrupo().catch(() => {});
  });

  document.getElementById('variacaoValoresInput')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      adicionarValorAoGrupo().catch(() => {});
    }
  });

  document.getElementById('variacaoLista')?.addEventListener('click', async (ev) => {
    const usar = ev.target.closest('.variacao-usar-grupo-btn');
    if (usar) {
      const tid = Number(usar.dataset.tipoId);
      if (tid) {
        _varLastTipoId = tid;
        const sel = document.getElementById('variacaoTipoSelect');
        if (sel) sel.value = String(tid);
        document.getElementById('variacaoTipoNovo').value = '';
        document.getElementById('variacaoValoresInput')?.focus();
      }
      return;
    }

    const btn = ev.target.closest('.variacao-del-btn');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!id || !confirm('Excluir este valor do grupo?')) return;
    try {
      await varFetch(`/api/produtos/variacoes/${id}`, { method: 'DELETE' });
      await carregarVariacoesProduto();
    } catch (err) {
      alert(err.message || err);
    }
  });

  // Carrega ao abrir a sub-aba
  document.querySelectorAll('#dadosProduto .sub-tabs .main-header-link').forEach((link) => {
    link.addEventListener('click', () => {
      if (link.dataset.subtarget === 'variacaoTab') {
        carregarVariacoesProduto().catch(() => {});
      }
    });
  });

  window.carregarVariacoesProduto = carregarVariacoesProduto;
}
