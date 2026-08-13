/**
 * Aba Variação em Informações do produto
 */
let _varInited = false;

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

async function carregarTiposVariacao() {
  const sel = document.getElementById('variacaoTipoSelect');
  if (!sel) return;
  const tipos = await varFetch('/api/produtos/variacoes/tipos');
  sel.innerHTML = ['<option value="">Selecione…</option>']
    .concat((tipos || []).map((t) => `<option value="${t.id}">${varEsc(t.nome)}</option>`))
    .join('');
}

function renderListaVariacoes(data) {
  const box = document.getElementById('variacaoLista');
  if (!box) return;
  const grupos = data?.variacoes || [];
  if (!grupos.length) {
    box.innerHTML = '<p style="color:var(--inactive-color);font-size:13px;">Nenhuma variação cadastrada neste produto.</p>';
    return;
  }
  box.innerHTML = grupos.map((g) => `
    <div style="border:1px solid var(--border-color);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      <div style="font-weight:700;color:var(--content-title-color);margin-bottom:8px;">${varEsc(g.tipo_nome)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${(g.valores || []).map((v) => `
          <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:rgba(59,130,246,.12);color:var(--content-title-color);font-size:12px;">
            ${varEsc(v.valor)}
            <button type="button" class="variacao-del-btn" data-id="${v.id}" title="Excluir" style="border:none;background:transparent;color:#ef4444;cursor:pointer;padding:0;line-height:1;">×</button>
          </span>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function carregarVariacoesProduto() {
  const codigo = codigoProdutoAtual();
  const box = document.getElementById('variacaoLista');
  if (!codigo) {
    if (box) box.innerHTML = '<p style="color:var(--inactive-color);font-size:13px;">Abra um produto para cadastrar variações.</p>';
    return;
  }
  try {
    await carregarTiposVariacao();
    const data = await varFetch(`/api/produtos/${encodeURIComponent(codigo)}/variacoes`);
    renderListaVariacoes(data);
  } catch (err) {
    if (box) box.innerHTML = `<p style="color:#ef4444;font-size:13px;">${varEsc(err.message || err)}</p>`;
  }
}

export function initProdutoVariacoesUI() {
  if (_varInited) return;
  _varInited = true;

  document.getElementById('variacaoSalvarBtn')?.addEventListener('click', async () => {
    const codigo = codigoProdutoAtual();
    if (!codigo) {
      alert('Abra um produto primeiro.');
      return;
    }
    const tipoId = Number(document.getElementById('variacaoTipoSelect')?.value) || null;
    const tipoNovo = document.getElementById('variacaoTipoNovo')?.value?.trim() || '';
    const valores = document.getElementById('variacaoValoresInput')?.value || '';
    if (!tipoId && !tipoNovo) {
      alert('Selecione ou informe o tipo de variação.');
      return;
    }
    if (!String(valores).trim()) {
      alert('Informe as variações (ex.: 41, 42, 43).');
      return;
    }
    try {
      await varFetch(`/api/produtos/${encodeURIComponent(codigo)}/variacoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_id: tipoId || undefined,
          tipo_nome: tipoNovo || undefined,
          valores: String(valores).split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean),
        }),
      });
      document.getElementById('variacaoValoresInput').value = '';
      document.getElementById('variacaoTipoNovo').value = '';
      await carregarVariacoesProduto();
    } catch (err) {
      alert(err.message || err);
    }
  });

  document.getElementById('variacaoLista')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.variacao-del-btn');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (!id || !confirm('Excluir esta variação?')) return;
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
