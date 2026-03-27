let _inited = false;
let _editingId = null;

function findTabsRoot() {
  return document.querySelector('.main-container')
    || document.querySelector('.tab-content')
    || document.body;
}

function mk(tag, cls, txt) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (txt != null) el.textContent = txt;
  return el;
}

function splitExcelRow(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  if (raw.includes('\t')) {
    return raw.split('\t').map(v => String(v || '').trim());
  }

  if (raw.includes(';')) {
    return raw.split(';').map(v => String(v || '').trim());
  }

  return raw.split(',').map(v => String(v || '').trim());
}

function toPayload(pane) {
  return {
    cargo: pane.querySelector('#rhCargo').value.trim(),
    cbo: pane.querySelector('#rhCbo').value.trim(),
    descricao_ltcat: pane.querySelector('#rhDescLtcat').value.trim(),
    descricao_chao_fabrica: pane.querySelector('#rhDescChao').value.trim(),
    epi: pane.querySelector('#rhEpi').value.trim(),
    treinamentos: pane.querySelector('#rhTreinamentos').value.trim(),
    periculosidade: pane.querySelector('#rhPericulosidade').value.trim(),
    insalubridade: pane.querySelector('#rhInsalubridade').value.trim(),
    equipamentos_ferramentas: pane.querySelector('#rhEquipamentos').value.trim(),
  };
}

function fillFormFromRecord(pane, rec) {
  pane.querySelector('#rhCargo').value = rec.cargo || '';
  pane.querySelector('#rhCbo').value = rec.cbo || '';
  pane.querySelector('#rhDescLtcat').value = rec.descricao_ltcat || '';
  pane.querySelector('#rhDescChao').value = rec.descricao_chao_fabrica || '';
  pane.querySelector('#rhEpi').value = rec.epi || '';
  pane.querySelector('#rhTreinamentos').value = rec.treinamentos || '';
  pane.querySelector('#rhPericulosidade').value = rec.periculosidade || '';
  pane.querySelector('#rhInsalubridade').value = rec.insalubridade || '';
  pane.querySelector('#rhEquipamentos').value = rec.equipamentos_ferramentas || '';
}

function clearForm(pane) {
  _editingId = null;
  pane.querySelector('#rhCargoForm').reset();
  pane.querySelector('#rhExcelRow').value = '';
  pane.querySelector('#rhCargoSave').textContent = 'Salvar';
  pane.querySelector('#rhCargoCancel').style.display = 'none';
}

function parseExcelIntoForm(pane) {
  const source = pane.querySelector('#rhExcelRow').value;
  const cols = splitExcelRow(source);

  if (!cols.length) {
    alert('Cole uma linha do Excel para preencher os campos.');
    return;
  }

  if (cols.length < 9) {
    alert(`Linha com ${cols.length} colunas. Esperado: 9 colunas (Cargo até Equipamentos/Ferramentas).`);
    return;
  }

  pane.querySelector('#rhCargo').value = cols[0] || '';
  pane.querySelector('#rhCbo').value = cols[1] || '';
  pane.querySelector('#rhDescLtcat').value = cols[2] || '';
  pane.querySelector('#rhDescChao').value = cols[3] || '';
  pane.querySelector('#rhEpi').value = cols[4] || '';
  pane.querySelector('#rhTreinamentos').value = cols[5] || '';
  pane.querySelector('#rhPericulosidade').value = cols[6] || '';
  pane.querySelector('#rhInsalubridade').value = cols[7] || '';
  pane.querySelector('#rhEquipamentos').value = cols[8] || '';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderFlag(value) {
  const raw = String(value || '').trim();
  const norm = raw.toLowerCase();
  let cls = 'is-neutral';
  if (['sim', 'yes', 'true', '1'].includes(norm)) cls = 'is-yes';
  if (['nao', 'não', 'no', 'false', '0'].includes(norm)) cls = 'is-no';
  return `<span class="rh-flag ${cls}">${escapeHtml(raw || '—')}</span>`;
}

function renderRows(pane, rows) {
  const tbody = pane.querySelector('#rhCargosTableBody');
  tbody.innerHTML = '';

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="rh-empty">Nenhum cargo cadastrado ainda.</td>';
    tbody.appendChild(tr);
    return;
  }

  rows.forEach(rec => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(rec.cargo || '—')}</td>
      <td>${escapeHtml(rec.cbo || '—')}</td>
      <td>${renderFlag(rec.periculosidade)}</td>
      <td>${renderFlag(rec.insalubridade)}</td>
      <td class="rh-actions"></td>
    `;

    const actions = tr.querySelector('.rh-actions');
    const btnEdit = mk('button', 'content-button status-button rh-action-btn', 'Editar');
    const btnDel = mk('button', 'content-button status-button rh-action-btn', 'Excluir');

    btnEdit.type = 'button';
    btnDel.type = 'button';

    btnEdit.addEventListener('click', () => {
      _editingId = rec.id;
      fillFormFromRecord(pane, rec);
      pane.querySelector('#rhCargoSave').textContent = 'Atualizar';
      pane.querySelector('#rhCargoCancel').style.display = 'inline-flex';
      pane.querySelector('#rhCargo').focus();
    });

    btnDel.addEventListener('click', async () => {
      const ok = confirm(`Excluir o cargo "${rec.cargo}"?`);
      if (!ok) return;

      try {
        const res = await fetch(`/api/rh/cargos/${encodeURIComponent(rec.id)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        await carregarLista(pane);
        if (String(_editingId) === String(rec.id)) {
          clearForm(pane);
        }
      } catch (err) {
        alert('Não foi possível excluir: ' + (err.message || err));
      }
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnDel);
    tbody.appendChild(tr);
  });
}

async function carregarLista(pane) {
  const res = await fetch('/api/rh/cargos', { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const rows = await res.json();
  pane._rows = Array.isArray(rows) ? rows : [];
  renderRows(pane, pane._rows);
}

async function salvarRegistro(pane) {
  const data = toPayload(pane);
  if (!data.cargo) {
    alert('O campo Cargo é obrigatório.');
    pane.querySelector('#rhCargo').focus();
    return;
  }

  const isEdit = Number.isInteger(_editingId) || /^[0-9]+$/.test(String(_editingId || ''));
  const url = isEdit ? `/api/rh/cargos/${encodeURIComponent(_editingId)}` : '/api/rh/cargos';
  const method = isEdit ? 'PUT' : 'POST';

  const btn = pane.querySelector('#rhCargoSave');
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = isEdit ? 'Atualizando...' : 'Salvando...';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    clearForm(pane);
    await carregarLista(pane);
  } catch (err) {
    alert('Não foi possível salvar: ' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

function ensurePane(root) {
  let pane = document.getElementById('rhConfiguracaoCargos');
  if (pane) return pane;

  pane = document.createElement('div');
  pane.id = 'rhConfiguracaoCargos';
  pane.className = 'tab-pane';
  pane.style.display = 'none';
  pane.innerHTML = `
    <div class="content-wrapper">
      <div class="content-section">
        <div class="title-wrapper rh-title-row">
          <div class="content-section-title">Configuração de cargos</div>
          <button id="rhReloadCargos" class="content-button status-button">Recarregar</button>
        </div>

        <form id="rhCargoForm" class="rh-cargo-form" autocomplete="off">
          <div class="rh-form-span">
            <label for="rhExcelRow">Colar linha inteira do Excel (9 colunas)</label>
            <textarea id="rhExcelRow" rows="2" placeholder="Cole a linha completa aqui"></textarea>
            <div class="rh-inline-actions">
              <button id="rhParseExcel" type="button" class="content-button status-button">Preencher campos</button>
            </div>
          </div>

          <div>
            <label for="rhCargo">Cargo</label>
            <input id="rhCargo" type="text" required>
          </div>
          <div>
            <label for="rhCbo">CBO</label>
            <input id="rhCbo" type="text">
          </div>

          <div class="rh-form-span">
            <label for="rhDescLtcat">Descrição das atividades no LTCAT</label>
            <textarea id="rhDescLtcat" rows="3"></textarea>
          </div>

          <div class="rh-form-span">
            <label for="rhDescChao">Descrição das atividades no chão de fábrica</label>
            <textarea id="rhDescChao" rows="3"></textarea>
          </div>

          <div>
            <label for="rhEpi">EPI</label>
            <textarea id="rhEpi" rows="2"></textarea>
          </div>

          <div>
            <label for="rhTreinamentos">Treinamentos</label>
            <textarea id="rhTreinamentos" rows="2"></textarea>
          </div>

          <div>
            <label for="rhPericulosidade">Periculosidade</label>
            <input id="rhPericulosidade" type="text" placeholder="Sim / Não">
          </div>

          <div>
            <label for="rhInsalubridade">Insalubridade</label>
            <input id="rhInsalubridade" type="text" placeholder="Sim / Não">
          </div>

          <div class="rh-form-span">
            <label for="rhEquipamentos">Equipamentos/Ferramentas</label>
            <textarea id="rhEquipamentos" rows="2"></textarea>
          </div>

          <div class="rh-form-actions rh-form-span">
            <button id="rhCargoSave" type="submit" class="content-button status-button">Salvar</button>
            <button id="rhCargoCancel" type="button" class="content-button status-button" style="display:none">Cancelar edição</button>
            <button id="rhCargoClear" type="button" class="content-button status-button">Limpar</button>
          </div>
        </form>

        <div class="products-area-wrapper tableView rh-table-shell">
          <div class="rh-table-scroll">
            <table class="products-table rh-cargos-table">
              <thead>
                <tr>
                  <th>Cargo</th>
                  <th>CBO</th>
                  <th>Periculosidade</th>
                  <th>Insalubridade</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="rhCargosTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
  root.appendChild(pane);

  const style = document.createElement('style');
  style.textContent = `
    #rhConfiguracaoCargos .rh-title-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #rhConfiguracaoCargos .rh-cargo-form{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:12px;margin:14px 0 18px}
    #rhConfiguracaoCargos .rh-cargo-form label{display:block;margin-bottom:6px;font-size:12px;opacity:.85}
    #rhConfiguracaoCargos .rh-cargo-form input,
    #rhConfiguracaoCargos .rh-cargo-form textarea{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.6);color:#e8ecff}
    #rhConfiguracaoCargos .rh-cargo-form textarea{resize:vertical;min-height:44px}
    #rhConfiguracaoCargos .rh-form-span{grid-column:1/-1}
    #rhConfiguracaoCargos .rh-form-actions{display:flex;gap:8px;align-items:center}
    #rhConfiguracaoCargos .rh-inline-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
    #rhConfiguracaoCargos .rh-table-shell{margin-top:6px;padding:14px;border-radius:14px;background:rgba(13,16,24,.55);border:1px solid rgba(255,255,255,.08)}
    #rhConfiguracaoCargos .rh-table-scroll{overflow-x:auto}
    #rhConfiguracaoCargos .rh-cargos-table{width:100%;min-width:760px;border-collapse:separate;border-spacing:0 10px}
    #rhConfiguracaoCargos .rh-cargos-table thead th{padding:0 14px 8px;text-align:left;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#aab5d8;white-space:nowrap}
    #rhConfiguracaoCargos .rh-cargos-table tbody td{padding:13px 14px;background:rgba(255,255,255,.03);border-top:1px solid rgba(255,255,255,.1);border-bottom:1px solid rgba(255,255,255,.07);vertical-align:middle}
    #rhConfiguracaoCargos .rh-cargos-table tbody td:first-child{border-left:1px solid rgba(255,255,255,.1);border-radius:12px 0 0 12px;max-width:320px;font-weight:600}
    #rhConfiguracaoCargos .rh-cargos-table tbody td:last-child{border-right:1px solid rgba(255,255,255,.1);border-radius:0 12px 12px 0}
    #rhConfiguracaoCargos .rh-cargos-table tbody td:nth-child(2){width:120px;white-space:nowrap}
    #rhConfiguracaoCargos .rh-cargos-table tbody td:nth-child(3),
    #rhConfiguracaoCargos .rh-cargos-table tbody td:nth-child(4){width:150px}
    #rhConfiguracaoCargos .rh-cargos-table tbody td:nth-child(5){width:210px}
    #rhConfiguracaoCargos .rh-cargos-table .rh-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;white-space:nowrap}
    #rhConfiguracaoCargos .rh-cargos-table .rh-action-btn{min-width:84px;padding:8px 12px;border-radius:10px}
    #rhConfiguracaoCargos .rh-cargos-table .rh-flag{display:inline-flex;align-items:center;justify-content:center;min-width:64px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.02em;border:1px solid transparent}
    #rhConfiguracaoCargos .rh-cargos-table .rh-flag.is-yes{background:rgba(28,182,122,.18);border-color:rgba(48,219,152,.34);color:#9ef2cf}
    #rhConfiguracaoCargos .rh-cargos-table .rh-flag.is-no{background:rgba(255,95,87,.18);border-color:rgba(255,129,122,.34);color:#ffc3bf}
    #rhConfiguracaoCargos .rh-cargos-table .rh-flag.is-neutral{background:rgba(146,159,186,.16);border-color:rgba(170,182,208,.3);color:#cfd7eb}
    #rhConfiguracaoCargos .rh-empty{text-align:center;opacity:.75;padding:14px;border-radius:12px}
    @media (max-width: 900px){
      #rhConfiguracaoCargos .rh-cargo-form{grid-template-columns:1fr}
      #rhConfiguracaoCargos .rh-table-shell{padding:10px}
      #rhConfiguracaoCargos .rh-cargos-table thead th{padding:0 10px 8px}
      #rhConfiguracaoCargos .rh-cargos-table tbody td{padding:11px 10px}
      #rhConfiguracaoCargos .rh-cargos-table .rh-action-btn{min-width:76px}
    }
  `;
  pane.appendChild(style);

  pane.querySelector('#rhParseExcel').addEventListener('click', () => parseExcelIntoForm(pane));
  pane.querySelector('#rhReloadCargos').addEventListener('click', () => carregarLista(pane).catch(handleLoadErr));
  pane.querySelector('#rhCargoClear').addEventListener('click', () => clearForm(pane));
  pane.querySelector('#rhCargoCancel').addEventListener('click', () => clearForm(pane));
  pane.querySelector('#rhCargoForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await salvarRegistro(pane);
  });

  return pane;
}

function handleLoadErr(err) {
  alert('Falha ao carregar configuração de cargos: ' + (err.message || err));
}

async function doOpen() {
  const root = findTabsRoot();
  const pane = ensurePane(root);

  try {
    await carregarLista(pane);
  } catch (err) {
    handleLoadErr(err);
  }

  if (typeof window.showMainTab === 'function') {
    window.showMainTab('rhConfiguracaoCargos');
  } else {
    document.querySelectorAll('.tab-pane, .kanban-page').forEach((el) => {
      const active = el.id === 'rhConfiguracaoCargos';
      el.style.display = active ? 'block' : 'none';
      el.classList.toggle('active', active);
    });
  }
}

export function initRhConfiguracaoCargosUI() {
  if (_inited) return;
  _inited = true;

  const btn = document.querySelector('#btn-rh-config-cargos');
  if (!btn) return;

  if (!btn.dataset.rhCargoBind) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      doOpen();
    });
    btn.dataset.rhCargoBind = '1';
  }

  window.openRhConfiguracaoCargos = doOpen;
}

export const openRhConfiguracaoCargos = doOpen;
