// produtos/engenharia_paineis.js — painéis globais Engenharia (menu lateral)
(function initEngenhariaPaineis() {
  const menuAlteracoes = document.getElementById('menu-engenharia-alteracoes');
  const menuDesenho = document.getElementById('menu-engenharia-desenho-tecnico');
  if (!menuAlteracoes && !menuDesenho) return;

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

  function formatarReferencia(ref) {
    const raw = String(ref || '').trim();
    if (!raw) return '—';
    const match = raw.match(/^(Lote|Data):\s*(.+)$/i);
    if (!match) return raw;
    const tipo = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
    const valor = match[2].trim();
    if (tipo === 'Data') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        const [y, m, d] = valor.split('-');
        return `${d}/${m}/${y}`;
      }
      return formatarData(valor);
    }
    return `Lote: ${valor}`;
  }

  function truncar(texto, max = 80) {
    const t = String(texto || '').trim();
    if (t.length <= max) return t || '—';
    return `${t.slice(0, max)}…`;
  }

  function montarLinksAnexosAlteracao(row) {
    const links = [];
    if (row.foto_antes) links.push(`<a href="${escHtml(row.foto_antes)}" target="_blank" rel="noopener" title="Foto antes"><i class="fa-solid fa-image"></i></a>`);
    if (row.foto_depois) links.push(`<a href="${escHtml(row.foto_depois)}" target="_blank" rel="noopener" title="Foto depois"><i class="fa-solid fa-image"></i></a>`);
    if (row.video) links.push(`<a href="${escHtml(row.video)}" target="_blank" rel="noopener" title="Vídeo"><i class="fa-solid fa-video"></i></a>`);
    if (row.arquivo) links.push(`<a href="${escHtml(row.arquivo)}" target="_blank" rel="noopener" title="Arquivo"><i class="fa-solid fa-file"></i></a>`);
    if (!links.length) return '—';
    return `<span style="display:inline-flex;gap:10px;font-size:16px;">${links.join('')}</span>`;
  }

  function ativarMenu(link) {
    document.querySelectorAll('.left-side .side-menu a').forEach((a) => a.classList.remove('is-active'));
    if (link) link.classList.add('is-active');
  }

  async function carregarAlteracoesGlobal() {
    const loadingEl = document.getElementById('engAlteracoesGlobalLoading');
    const tableEl = document.getElementById('engAlteracoesGlobalTable');
    const bodyEl = document.getElementById('engAlteracoesGlobalBody');
    const vazioEl = document.getElementById('engAlteracoesGlobalVazio');
    if (!bodyEl) return;

    if (loadingEl) loadingEl.style.display = 'block';
    if (vazioEl) vazioEl.style.display = 'none';
    if (tableEl) tableEl.style.display = 'none';

    try {
      const resp = await fetch('/api/engenharia/alteracoes-produto/todos', { credentials: 'same-origin' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar histórico.');

      const rows = Array.isArray(data.alteracoes) ? data.alteracoes : [];
      bodyEl.innerHTML = '';

      if (!rows.length) {
        if (vazioEl) {
          vazioEl.textContent = 'Nenhuma alteração registrada.';
          vazioEl.style.display = 'block';
        }
        return;
      }

      rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.innerHTML = `
          <td style="padding:8px;white-space:nowrap;">${escHtml(formatarData(row.data))}</td>
          <td style="padding:8px;">${escHtml(row.codigo_omie || '—')}</td>
          <td style="padding:8px;">${escHtml(row.codigo_interno || '—')}</td>
          <td style="padding:8px;max-width:160px;" title="${escHtml(row.antes || '')}">${escHtml(truncar(row.antes))}</td>
          <td style="padding:8px;max-width:160px;" title="${escHtml(row.depois || '')}">${escHtml(truncar(row.depois))}</td>
          <td style="padding:8px;white-space:nowrap;">${escHtml(formatarReferencia(row.referencia))}</td>
          <td style="padding:8px;">${montarLinksAnexosAlteracao(row)}</td>
          <td style="padding:8px;">
            <button type="button" class="content-button eng-btn-editar-alteracao"
              style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#fff;padding:6px 12px;font-size:12px;">
              <i class="fa-solid fa-pen"></i> Editar
            </button>
          </td>
        `;
        tr.querySelector('.eng-btn-editar-alteracao')?.addEventListener('click', () => {
          if (typeof window.abrirModalEdicaoAlteracao === 'function') {
            window.abrirModalEdicaoAlteracao(row);
          }
        });
        bodyEl.appendChild(tr);
      });

      if (tableEl) tableEl.style.display = 'table';
    } catch (err) {
      console.error('[Engenharia global alterações]', err);
      if (vazioEl) {
        vazioEl.textContent = err.message || 'Erro ao carregar histórico.';
        vazioEl.style.display = 'block';
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  async function carregarDesenhosGlobal() {
    const loadingEl = document.getElementById('engDesenhoGlobalLoading');
    const tableEl = document.getElementById('engDesenhoGlobalTable');
    const bodyEl = document.getElementById('engDesenhoGlobalBody');
    const vazioEl = document.getElementById('engDesenhoGlobalVazio');
    if (!bodyEl) return;

    if (loadingEl) loadingEl.style.display = 'block';
    if (vazioEl) vazioEl.style.display = 'none';
    if (tableEl) tableEl.style.display = 'none';

    try {
      const resp = await fetch('/api/engenharia/desenho-tecnico/todos', { credentials: 'same-origin' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Falha ao carregar desenhos.');

      const rows = Array.isArray(data.desenhos) ? data.desenhos : [];
      bodyEl.innerHTML = '';

      if (!rows.length) {
        if (vazioEl) {
          vazioEl.textContent = 'Nenhum desenho técnico registrado.';
          vazioEl.style.display = 'block';
        }
        return;
      }

      rows.forEach((row) => {
        const ativo = String(row.status).toLowerCase() === 'ativo';
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.innerHTML = `
          <td style="padding:8px;white-space:nowrap;">${escHtml(formatarData(row.data))}</td>
          <td style="padding:8px;">${escHtml(row.codigo_omie || '—')}</td>
          <td style="padding:8px;">${escHtml(row.codigo_interno || '—')}</td>
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
            <button type="button" class="content-button eng-btn-editar-desenho"
              style="background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#fff;padding:6px 12px;font-size:12px;">
              <i class="fa-solid fa-pen"></i> Editar
            </button>
          </td>
        `;
        tr.querySelector('.eng-btn-editar-desenho')?.addEventListener('click', () => {
          if (typeof window.abrirModalEdicaoDesenhoTecnico === 'function') {
            window.abrirModalEdicaoDesenhoTecnico(row);
          }
        });
        bodyEl.appendChild(tr);
      });

      if (tableEl) tableEl.style.display = 'table';
    } catch (err) {
      console.error('[Engenharia global desenhos]', err);
      if (vazioEl) {
        vazioEl.textContent = err.message || 'Erro ao carregar desenhos.';
        vazioEl.style.display = 'block';
      }
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  window.recarregarEngAlteracoesGlobal = carregarAlteracoesGlobal;
  window.recarregarEngDesenhosGlobal = carregarDesenhosGlobal;

  if (menuAlteracoes) {
    menuAlteracoes.addEventListener('click', (e) => {
      e.preventDefault();
      ativarMenu(menuAlteracoes);
      if (typeof window.showMainTab === 'function') {
        window.showMainTab('engenhariaAlteracoesPane');
      }
      carregarAlteracoesGlobal();
    });
  }

  if (menuDesenho) {
    menuDesenho.addEventListener('click', (e) => {
      e.preventDefault();
      ativarMenu(menuDesenho);
      if (typeof window.showMainTab === 'function') {
        window.showMainTab('engenhariaDesenhoTecnicoPane');
      }
      carregarDesenhosGlobal();
    });
  }
})();
