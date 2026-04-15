let _inited = false;

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

function val(sel, root = document) {
  return root.querySelector(sel);
}

let _cacheUsers = [];
let _cacheCargos = [];
let _cacheFuncoes = [];
let _cacheSetores = [];
const DEFAULT_PROFILE_IMAGE = 'https://pxhbginkisinegzupqcy.supabase.co/storage/v1/object/public/compras-anexos/profile-photos/Captura%20de%20tela%20de%202026-01-29%2015-12-33.png';

function normalizeId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function mapById(arr) {
  const m = new Map();
  (arr || []).forEach((x) => m.set(String(x.id), x));
  return m;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSelectedUserId(pane) {
  return normalizeId(val('#rhColabId', pane)?.value || val('#rhColabUserPick', pane)?.value);
}

function setUserPhoto(pane, photoUrl) {
  const img = val('#rhColabUserPhoto', pane);
  if (!img) return;
  img.src = photoUrl || DEFAULT_PROFILE_IMAGE;
}

async function carregarFotoUsuario(pane, userId) {
  if (!userId) {
    setUserPhoto(pane, null);
    return;
  }
  try {
    const data = await fetchJson(`/api/users/${encodeURIComponent(userId)}/foto-perfil`);
    setUserPhoto(pane, data?.foto_perfil_url || null);
  } catch {
    setUserPhoto(pane, null);
  }
}

async function uploadFotoUsuario(pane, file) {
  const userId = getSelectedUserId(pane);
  if (!userId) {
    alert('Selecione um colaborador antes de enviar foto.');
    return;
  }

  const form = new FormData();
  form.append('file', file);
  form.append('bucket', 'Funcionarios');
  form.append('path', `${userId}/fotos/${Date.now()}_${file.name}`);

  const uploadData = await fetchJson('/api/upload/supabase', {
    method: 'POST',
    body: form,
  });

  if (!uploadData?.url) {
    throw new Error('URL da foto não retornada pelo upload');
  }

  await fetchJson(`/api/users/${encodeURIComponent(userId)}/foto-perfil`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ foto_perfil_url: uploadData.url }),
  });

  setUserPhoto(pane, uploadData.url);
}

function renderListaAnexos(pane, anexos) {
  const box = val('#rhColabAnexosList', pane);
  if (!box) return;

  const arr = Array.isArray(anexos) ? anexos : [];
  if (!arr.length) {
    box.innerHTML = '<div class="rh-colab-anexo-empty">Nenhum anexo para este colaborador.</div>';
    return;
  }

  box.innerHTML = arr.map((item) => {
    const id = Number(item.id);
    const nome = escapeHtml(item.nome_arquivo || 'Arquivo');
    const url = escapeHtml(item.url_arquivo || '#');
    return `
      <div class="rh-colab-anexo-item">
        <a class="rh-colab-anexo-link" href="${url}" target="_blank" rel="noopener noreferrer">${nome}</a>
        <button type="button" class="rh-colab-anexo-del" data-anexo-id="${id}">Excluir</button>
      </div>
    `;
  }).join('');
}

async function carregarAnexosUsuario(pane, userId) {
  if (!userId) {
    renderListaAnexos(pane, []);
    return;
  }
  const arr = await fetchJson(`/api/rh/colaboradores/${encodeURIComponent(userId)}/anexos`);
  renderListaAnexos(pane, arr);
}

async function uploadAnexoColaborador(pane, file) {
  const userId = getSelectedUserId(pane);
  if (!userId) {
    alert('Selecione um colaborador antes de anexar arquivo.');
    return;
  }

  const form = new FormData();
  form.append('file', file);
  form.append('bucket', 'Funcionarios');
  form.append('path', `${userId}/anexos/${Date.now()}_${file.name}`);

  const uploadData = await fetchJson('/api/upload/supabase', {
    method: 'POST',
    body: form,
  });

  if (!uploadData?.url || !uploadData?.path) {
    throw new Error('Upload não retornou dados completos do arquivo');
  }

  await fetchJson(`/api/rh/colaboradores/${encodeURIComponent(userId)}/anexos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome_arquivo: file.name,
      url_arquivo: uploadData.url,
      path_arquivo: uploadData.path,
      enviado_por: window.__sessionUser?.username || null,
    }),
  });

  await carregarAnexosUsuario(pane, userId);
}

/* ====== Férias ====== */

function renderFeriasAnexos(pane, anexos) {
  const box = val('#rhColabFeriasAnexosList', pane);
  if (!box) return;
  const arr = Array.isArray(anexos) ? anexos : [];
  if (!arr.length) {
    box.innerHTML = '<div class="rh-colab-anexo-empty">Nenhum anexo de férias.</div>';
    return;
  }
  box.innerHTML = arr.map((item) => {
    const id = Number(item.id);
    const nome = escapeHtml(item.nome_arquivo || 'Arquivo');
    const url = escapeHtml(item.url_arquivo || '#');
    return `
      <div class="rh-colab-anexo-item">
        <a class="rh-colab-anexo-link" href="${url}" target="_blank" rel="noopener noreferrer">${nome}</a>
        <button type="button" class="rh-colab-anexo-del" data-ferias-anexo-id="${id}">Excluir</button>
      </div>
    `;
  }).join('');
}

async function carregarFeriasAnexos(pane, userId) {
  if (!userId) { renderFeriasAnexos(pane, []); return; }
  const arr = await fetchJson(`/api/rh/funcionarios/ferias-anexos/${encodeURIComponent(userId)}`);
  renderFeriasAnexos(pane, arr);
}

async function carregarDadosFerias(pane, userId) {
  const elAdm = val('#rhColabDataAdmissao', pane);

  if (!userId) {
    if (elAdm) elAdm.value = '';
    return;
  }
  try {
    const data = await fetchJson(`/api/rh/funcionarios/ferias/${encodeURIComponent(userId)}`);
    if (elAdm) elAdm.value = data.data_admissao ? data.data_admissao.slice(0, 10) : '';
  } catch {
    if (elAdm) elAdm.value = '';
  }
}

function calcularCicloFerias(pane, registros) {
  const elAdm = val('#rhColabDataAdmissao', pane);
  const elProx = val('#rhColabProxFerias', pane);
  const elLimite = val('#rhColabDataLimiteFerias', pane);
  const elSaldo = val('#rhColabSaldoFerias', pane);

  const admStr = elAdm.value;
  if (!admStr) {
    elProx.value = '';
    elLimite.value = '';
    elSaldo.value = '—';
    return;
  }

  const admissao = new Date(admStr + 'T00:00:00');
  if (isNaN(admissao.getTime())) {
    elProx.value = '';
    elLimite.value = '';
    elSaldo.value = '—';
    return;
  }

  // Total de dias de férias gozados
  const totalDias = (registros || []).reduce((s, r) => s + (r.dias || 0), 0);
  // Cada bloco de 30 dias completa um ciclo
  const ciclosCompletos = Math.floor(totalDias / 30);
  const diasUsadosNoCiclo = totalDias % 30;
  const saldo = 30 - diasUsadosNoCiclo;

  // Ciclo atual (1-based): se usou 0 dias, está no cicloCompletos+1
  const cicloAtual = ciclosCompletos + 1;

  // Próximas férias = admissão + cicloAtual anos (data em que o direito se adquire)
  const proxFerias = new Date(admissao);
  proxFerias.setFullYear(proxFerias.getFullYear() + cicloAtual);

  // Data limite = próximas férias + 12 meses - 1 dia (fim do período concessivo)
  const dataLimite = new Date(proxFerias);
  dataLimite.setFullYear(dataLimite.getFullYear() + 1);
  dataLimite.setDate(dataLimite.getDate() - 1);

  elProx.value = fmtDateISO(proxFerias);
  elLimite.value = fmtDateISO(dataLimite);
  elSaldo.value = `${saldo} / 30 dias restantes`;
}

function fmtDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function fmtDateBR(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00');
  if (isNaN(d.getTime())) return str;
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function renderFeriasHistorico(pane, registros) {
  const box = val('#rhColabFeriasHistorico', pane);
  if (!box) return;
  const arr = Array.isArray(registros) ? registros : [];
  if (!arr.length) {
    box.innerHTML = '<div class="rh-colab-anexo-empty">Nenhum registro de férias.</div>';
    return;
  }
  box.innerHTML = arr.map((r) => {
    const id = Number(r.id);
    return `
      <div class="rh-colab-anexo-item" style="justify-content:space-between">
        <span>${fmtDateBR(r.data_inicio?.slice?.(0,10) || r.data_inicio)} — ${fmtDateBR(r.data_fim?.slice?.(0,10) || r.data_fim)} &nbsp;(${r.dias} dia${r.dias > 1 ? 's' : ''})</span>
        <button type="button" class="rh-colab-anexo-del" data-ferias-reg-id="${id}">Excluir</button>
      </div>
    `;
  }).join('');
}

async function salvarDadosFerias(pane) {
  const userId = getSelectedUserId(pane);
  if (!userId) return;
  await fetchJson(`/api/rh/funcionarios/ferias/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data_admissao: val('#rhColabDataAdmissao', pane).value || null,
      ferias_vencidas: false,
    }),
  });
}

async function uploadFeriasAnexo(pane, file) {
  const userId = getSelectedUserId(pane);
  if (!userId) { alert('Selecione um colaborador.'); return; }

  const form = new FormData();
  form.append('file', file);
  form.append('bucket', 'Funcionarios');
  form.append('path', `${userId}/ferias/${Date.now()}_${file.name}`);

  const uploadData = await fetchJson('/api/upload/supabase', {
    method: 'POST',
    body: form,
  });

  if (!uploadData?.url || !uploadData?.path) {
    throw new Error('Upload não retornou dados completos');
  }

  await fetchJson(`/api/rh/funcionarios/ferias-anexos/${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome_arquivo: file.name,
      url_arquivo: uploadData.url,
      path_arquivo: uploadData.path,
      enviado_por: window.__sessionUser?.username || null,
    }),
  });

  await carregarFeriasAnexos(pane, userId);
}

function fillSelect(selectEl, items, opts = {}) {
  const placeholder = opts.placeholder || 'Selecionar...';
  const valueKey = opts.valueKey || 'id';
  const labelKey = opts.labelKey || 'name';

  selectEl.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = placeholder;
  selectEl.appendChild(opt0);

  (items || []).forEach((item) => {
    const opt = document.createElement('option');
    opt.value = String(item[valueKey] ?? '');
    opt.textContent = String(item[labelKey] ?? '');
    selectEl.appendChild(opt);
  });
}

function setCargoDetails(pane, cargo) {
  val('#rhColabCargoCbo', pane).value = cargo?.cbo || '';
  val('#rhColabCargoLtcat', pane).value = cargo?.descricao_ltcat || '';
  val('#rhColabCargoChao', pane).value = cargo?.descricao_chao_fabrica || '';
  val('#rhColabCargoEpi', pane).value = cargo?.epi || '';
  val('#rhColabCargoTreinamentos', pane).value = cargo?.treinamentos || '';
  val('#rhColabCargoPericulosidade', pane).value = cargo?.periculosidade || '';
  val('#rhColabCargoInsalubridade', pane).value = cargo?.insalubridade || '';
  val('#rhColabCargoEquipamentos', pane).value = cargo?.equipamentos_ferramentas || '';
}

function setBasicUserFields(pane, row) {
  val('#rhColabId', pane).value = row?.id || '';
  val('#rhColabUsuario', pane).value = row?.username || '';
  val('#rhColabNomeCompleto', pane).value = row?.nome_completo || '';
  val('#rhColabEmail', pane).value = row?.email || '';
  val('#rhColabDataNascimento', pane).value = row?.data_nascimento ? row.data_nascimento.slice(0, 10) : '';
  val('#rhColabTelefone', pane).value = row?.telefone_contato || '';
  val('#rhColabReceberNotificacao', pane).checked = row?.receber_notificacao === true;

  const funcaoId = normalizeId(row?.funcao_id);
  const setorId = normalizeId(row?.setor_id);
  val('#rhColabFuncao', pane).value = funcaoId ? String(funcaoId) : '';
  val('#rhColabSetor', pane).value = setorId ? String(setorId) : '';
  val('#rhColabTipoContrato', pane).value = row?.tipo_contrato || '';
}

async function carregarBases(pane) {
  const [users, cargos, funcoes, setores] = await Promise.all([
    fetchJson('/api/rh/colaboradores/usuarios'),
    fetchJson('/api/rh/cargos'),
    fetchJson('/api/colaboradores/funcoes'),
    fetchJson('/api/colaboradores/setores'),
  ]);

  _cacheUsers = Array.isArray(users) ? users : [];
  _cacheCargos = Array.isArray(cargos) ? cargos : [];
  _cacheFuncoes = Array.isArray(funcoes) ? funcoes : [];
  _cacheSetores = Array.isArray(setores) ? setores : [];

  fillSelect(val('#rhColabUserPick', pane), _cacheUsers, {
    placeholder: 'Selecionar colaborador (usuário)...',
    valueKey: 'id',
    labelKey: 'username',
  });
  fillSelect(val('#rhColabFuncao', pane), _cacheFuncoes, {
    placeholder: 'Selecionar função...',
    valueKey: 'id',
    labelKey: 'name',
  });
  fillSelect(val('#rhColabSetor', pane), _cacheSetores, {
    placeholder: 'Selecionar setor...',
    valueKey: 'id',
    labelKey: 'name',
  });
  fillSelect(val('#rhColabCargo', pane), _cacheCargos, {
    placeholder: 'Selecionar cargo...',
    valueKey: 'id',
    labelKey: 'cargo',
  });
}

async function carregarUsuarioSelecionado(pane) {
  const userId = normalizeId(val('#rhColabUserPick', pane).value);
  if (!userId) {
    setBasicUserFields(pane, null);
    val('#rhColabCargo', pane).value = '';
    setCargoDetails(pane, null);
    setUserPhoto(pane, null);
    renderListaAnexos(pane, []);
    carregarDadosFerias(pane, null);
    return;
  }

  const row = await fetchJson(`/api/rh/colaboradores/${encodeURIComponent(userId)}`);
  setBasicUserFields(pane, row);

  const cargoId = normalizeId(row?.cargo_id);
  val('#rhColabCargo', pane).value = cargoId ? String(cargoId) : '';

  const cargosById = mapById(_cacheCargos);
  setCargoDetails(pane, cargoId ? cargosById.get(String(cargoId)) : null);
  await carregarFotoUsuario(pane, userId);
  await carregarAnexosUsuario(pane, userId);
  await carregarDadosFerias(pane, userId);
}

async function salvarCadastroRh(pane) {
  const userId = normalizeId(val('#rhColabId', pane).value);
  if (!userId) {
    alert('Selecione um usuário para salvar o cadastro RH.');
    return;
  }

  const payload = {
    user_id: userId,
    nome_completo: val('#rhColabNomeCompleto', pane).value.trim() || null,
    email: val('#rhColabEmail', pane).value.trim(),
    data_nascimento: val('#rhColabDataNascimento', pane).value || null,
    telefone_contato: val('#rhColabTelefone', pane).value.trim() || null,
    receber_notificacao: val('#rhColabReceberNotificacao', pane).checked,
    funcao_id: normalizeId(val('#rhColabFuncao', pane).value),
    setor_id: normalizeId(val('#rhColabSetor', pane).value),
    cargo_id: normalizeId(val('#rhColabCargo', pane).value),
    tipo_contrato: val('#rhColabTipoContrato', pane).value || null,
  };

  const btn = val('#rhColabSave', pane);
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const saved = await fetchJson('/api/rh/colaboradores/salvar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await salvarDadosFerias(pane);

    await carregarBases(pane);
    val('#rhColabUserPick', pane).value = String(saved.id || userId);
    await carregarUsuarioSelecionado(pane);
    alert('Cadastro RH salvo com sucesso.');
  } catch (err) {
    alert('Falha ao salvar cadastro RH: ' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

function closeNewUserModal() {
  val('#rhColabNovoModal')?.remove();
  document.body.style.overflow = '';
}

function openNewUserModal(pane) {
  closeNewUserModal();

  const back = document.createElement('div');
  back.id = 'rhColabNovoModal';
  back.className = 'rh-colab-modal-backdrop';
  back.innerHTML = `
    <div class="rh-colab-modal" role="dialog" aria-modal="true" aria-label="Novo colaborador RH">
      <header>
        <h3>Novo colaborador</h3>
        <button type="button" class="rh-colab-modal-close">×</button>
      </header>
      <div class="rh-colab-modal-body">
        <div>
          <label>ID</label>
          <input type="text" value="(gerado ao salvar)" readonly>
        </div>
        <div>
          <label>Usuário</label>
          <input id="rhNovoUser" type="text" placeholder="ex.: joao.silva">
        </div>
        <div class="span2">
          <label>E-mail</label>
          <input id="rhNovoEmail" type="email" placeholder="ex.: joao.silva@empresa.com.br">
        </div>
        <div class="rh-colab-plus-field">
          <div>
            <label>Função</label>
            <select id="rhNovoFuncao"></select>
          </div>
          <button id="rhNovoFuncaoAdd" type="button" class="rh-plus-btn" title="Adicionar função" aria-label="Adicionar função">+</button>
        </div>
        <div class="rh-colab-plus-field">
          <div>
            <label>Setor</label>
            <select id="rhNovoSetor"></select>
          </div>
          <button id="rhNovoSetorAdd" type="button" class="rh-plus-btn" title="Adicionar setor" aria-label="Adicionar setor">+</button>
        </div>
      </div>
      <footer>
        <button type="button" class="content-button status-button rh-colab-cancel">Cancelar</button>
        <button type="button" class="content-button status-button rh-colab-create">Criar colaborador</button>
      </footer>
    </div>
  `;

  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';

  fillSelect(val('#rhNovoFuncao', back), _cacheFuncoes, {
    placeholder: 'Selecionar função...',
    valueKey: 'id',
    labelKey: 'name',
  });
  fillSelect(val('#rhNovoSetor', back), _cacheSetores, {
    placeholder: 'Selecionar setor...',
    valueKey: 'id',
    labelKey: 'name',
  });

  const close = () => closeNewUserModal();
  val('.rh-colab-modal-close', back)?.addEventListener('click', close);
  val('.rh-colab-cancel', back)?.addEventListener('click', close);
  back.addEventListener('click', (ev) => {
    if (ev.target === back) close();
  });

  const addFuncaoOrSetor = async (kind) => {
    const isFuncao = kind === 'funcao';
    const label = isFuncao ? 'função' : 'setor';
    const nome = prompt(`Nome da nova ${label}:`);
    if (!nome || !nome.trim()) return;

    try {
      const created = await fetchJson(isFuncao ? '/api/colaboradores/funcoes' : '/api/colaboradores/setores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nome.trim() }),
      });

      const lista = await fetchJson(isFuncao ? '/api/colaboradores/funcoes' : '/api/colaboradores/setores');

      if (isFuncao) {
        _cacheFuncoes = Array.isArray(lista) ? lista : [];
        fillSelect(val('#rhNovoFuncao', back), _cacheFuncoes, {
          placeholder: 'Selecionar função...',
          valueKey: 'id',
          labelKey: 'name',
        });
        val('#rhNovoFuncao', back).value = String(created.id || '');
      } else {
        _cacheSetores = Array.isArray(lista) ? lista : [];
        fillSelect(val('#rhNovoSetor', back), _cacheSetores, {
          placeholder: 'Selecionar setor...',
          valueKey: 'id',
          labelKey: 'name',
        });
        val('#rhNovoSetor', back).value = String(created.id || '');
      }
    } catch (err) {
      alert(`Não foi possível criar ${label}: ` + (err.message || err));
    }
  };

  val('#rhNovoFuncaoAdd', back)?.addEventListener('click', () => addFuncaoOrSetor('funcao'));
  val('#rhNovoSetorAdd', back)?.addEventListener('click', () => addFuncaoOrSetor('setor'));

  val('.rh-colab-create', back)?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const username = val('#rhNovoUser', back).value.trim();
    const email = val('#rhNovoEmail', back).value.trim();
    const funcaoId = normalizeId(val('#rhNovoFuncao', back).value);
    const setorId = normalizeId(val('#rhNovoSetor', back).value);

    if (!username) {
      alert('Informe o usuário para criar o colaborador.');
      val('#rhNovoUser', back).focus();
      return;
    }

    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Criando...';

    try {
      const created = await fetchJson('/api/rh/colaboradores/novo-usuario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          email,
          funcao_id: funcaoId,
          setor_id: setorId,
        }),
      });

      closeNewUserModal();

      // Cria pasta do colaborador no bucket Funcionarios
      try {
        await fetchJson(`/api/rh/funcionarios/criar-pasta/${encodeURIComponent(created.id)}`, { method: 'POST' });
      } catch (_) { /* ignora erro: pasta pode já existir */ }

      await carregarBases(pane);
      val('#rhColabUserPick', pane).value = String(created.id);
      await carregarUsuarioSelecionado(pane);
      alert('Novo colaborador criado. Permissões iniciam desmarcadas por padrão.');
    } catch (err) {
      alert('Não foi possível criar o colaborador: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

/* ============================
   Modal EPI
   ============================ */
function closeEpiModal() {
  document.getElementById('rhEpiModal')?.remove();
  document.body.style.overflow = '';
}

async function openEpiModal(_pane, userId) {
  closeEpiModal();

  const userName = val('#rhColabUsuario', _pane)?.value || '';

  const back = document.createElement('div');
  back.id = 'rhEpiModal';
  back.className = 'rh-colab-modal-backdrop';
  back.innerHTML = `
    <div class="rh-colab-modal" role="dialog" aria-modal="true" aria-label="EPI do funcionário" style="max-height:90vh;display:flex;flex-direction:column">
      <header>
        <h3><i class="fa-solid fa-hard-hat" style="margin-right:8px"></i>EPI – ${escapeHtml(userName)}</h3>
        <button type="button" class="rh-colab-modal-close">×</button>
      </header>
      <div class="rh-colab-modal-body" style="overflow-y:auto;flex:1">
        <div>
          <label for="rhEpiCamiseta">Tamanho de camiseta</label>
          <input id="rhEpiCamiseta" type="text" placeholder="ex.: M, G, GG">
        </div>
        <div>
          <label for="rhEpiCalca">Short / Calça</label>
          <input id="rhEpiCalca" type="text" placeholder="ex.: 40, 42, 44">
        </div>
        <div>
          <label for="rhEpiSapato">Sapato</label>
          <input id="rhEpiSapato" type="text" placeholder="ex.: 38, 40, 42">
        </div>
        <div>
          <button id="rhEpiSalvarTam" type="button" class="content-button status-button" style="margin-top:18px">Salvar tamanhos</button>
        </div>
        <div class="span2" style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px;margin-top:4px">
          <h4 style="margin:0 0 8px;font-size:15px">Registrar entrega de EPI</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label for="rhEpiEntregaItem">Item entregue</label>
              <select id="rhEpiEntregaItem">
                <option value="">Selecionar...</option>
                <option value="Camiseta">Camiseta</option>
                <option value="Short/Calça">Short/Calça</option>
                <option value="Sapato">Sapato</option>
                <option value="Luva">Luva</option>
                <option value="Óculos">Óculos</option>
                <option value="Capacete">Capacete</option>
                <option value="Protetor auricular">Protetor auricular</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
            <div>
              <label for="rhEpiEntregaTam">Tamanho</label>
              <input id="rhEpiEntregaTam" type="text" placeholder="ex.: M, 42">
            </div>
            <div>
              <label for="rhEpiEntregaData">Data da entrega</label>
              <input id="rhEpiEntregaData" type="date">
            </div>
            <div>
              <label for="rhEpiEntregaObs">Observação</label>
              <input id="rhEpiEntregaObs" type="text" placeholder="(opcional)">
            </div>
          </div>
          <button id="rhEpiRegistrarEntrega" type="button" class="content-button status-button" style="margin-top:10px">Registrar entrega</button>
        </div>
        <div class="span2">
          <h4 style="margin:0 0 6px;font-size:15px">Histórico de entregas</h4>
          <div id="rhEpiEntregasLista"></div>
        </div>
      </div>
      <footer>
        <button type="button" class="content-button status-button rh-colab-cancel">Fechar</button>
      </footer>
    </div>
  `;

  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';

  // Set today as default date
  val('#rhEpiEntregaData', back).value = new Date().toISOString().slice(0, 10);

  const close = () => closeEpiModal();
  val('.rh-colab-modal-close', back)?.addEventListener('click', close);
  val('.rh-colab-cancel', back)?.addEventListener('click', close);
  back.addEventListener('click', (ev) => { if (ev.target === back) close(); });

  // Load existing EPI sizes
  try {
    const epi = await fetchJson(`/api/rh/funcionarios/epi/${encodeURIComponent(userId)}`);
    val('#rhEpiCamiseta', back).value = epi.tam_camiseta || '';
    val('#rhEpiCalca', back).value = epi.tam_calca || '';
    val('#rhEpiSapato', back).value = epi.tam_sapato || '';
  } catch {}

  // Save EPI sizes
  val('#rhEpiSalvarTam', back).addEventListener('click', async () => {
    try {
      await fetchJson(`/api/rh/funcionarios/epi/${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tam_camiseta: val('#rhEpiCamiseta', back).value.trim(),
          tam_calca: val('#rhEpiCalca', back).value.trim(),
          tam_sapato: val('#rhEpiSapato', back).value.trim(),
        }),
      });
      alert('Tamanhos de EPI salvos com sucesso.');
    } catch (err) {
      alert('Falha ao salvar tamanhos: ' + (err.message || err));
    }
  });

  async function carregarEntregas() {
    const box = val('#rhEpiEntregasLista', back);
    try {
      const entregas = await fetchJson(`/api/rh/funcionarios/epi-entregas/${encodeURIComponent(userId)}`);
      if (!entregas.length) {
        box.innerHTML = '<div class="rh-hist-empty">Nenhuma entrega registrada.</div>';
        return;
      }
      box.innerHTML = `<table class="rh-epi-table">
        <thead><tr><th>Item</th><th>Tamanho</th><th>Data</th><th>Obs.</th><th>Registrado por</th><th></th></tr></thead>
        <tbody>${entregas.map(e => `<tr>
          <td>${escapeHtml(e.item)}</td>
          <td>${escapeHtml(e.tamanho || '-')}</td>
          <td>${e.data_entrega ? new Date(e.data_entrega).toLocaleDateString('pt-BR') : '-'}</td>
          <td>${escapeHtml(e.observacao || '-')}</td>
          <td>${escapeHtml(e.registrado_por || '-')}</td>
          <td><button class="btn-del-row" data-eid="${e.id}">Excluir</button></td>
        </tr>`).join('')}</tbody>
      </table>`;
    } catch (err) {
      box.innerHTML = '<div class="rh-hist-empty">Erro ao carregar entregas.</div>';
    }
  }

  await carregarEntregas();

  // Register delivery
  val('#rhEpiRegistrarEntrega', back).addEventListener('click', async () => {
    const item = val('#rhEpiEntregaItem', back).value;
    if (!item) { alert('Selecione o item entregue.'); return; }
    try {
      await fetchJson(`/api/rh/funcionarios/epi-entregas/${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item,
          tamanho: val('#rhEpiEntregaTam', back).value.trim(),
          data_entrega: val('#rhEpiEntregaData', back).value || null,
          observacao: val('#rhEpiEntregaObs', back).value.trim(),
          registrado_por: window.__sessionUser?.username || null,
        }),
      });
      val('#rhEpiEntregaItem', back).value = '';
      val('#rhEpiEntregaTam', back).value = '';
      val('#rhEpiEntregaObs', back).value = '';
      val('#rhEpiEntregaData', back).value = new Date().toISOString().slice(0, 10);
      await carregarEntregas();
    } catch (err) {
      alert('Falha ao registrar entrega: ' + (err.message || err));
    }
  });

  // Delete delivery
  val('#rhEpiEntregasLista', back).addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.btn-del-row');
    if (!btn) return;
    const eid = Number(btn.dataset.eid);
    if (!eid || !confirm('Excluir esta entrega?')) return;
    try {
      await fetchJson(`/api/rh/funcionarios/epi-entregas/${encodeURIComponent(eid)}`, { method: 'DELETE' });
      await carregarEntregas();
    } catch (err) {
      alert('Falha ao excluir entrega: ' + (err.message || err));
    }
  });
}

/* ============================
   Modal Conversas
   ============================ */
function closeConversasModal() {
  document.getElementById('rhConversasModal')?.remove();
  document.body.style.overflow = '';
}

async function openConversasModal(_pane, userId) {
  closeConversasModal();

  const userName = val('#rhColabUsuario', _pane)?.value || '';

  const back = document.createElement('div');
  back.id = 'rhConversasModal';
  back.className = 'rh-colab-modal-backdrop';
  back.innerHTML = `
    <div class="rh-colab-modal" role="dialog" aria-modal="true" aria-label="Histórico de conversas" style="max-height:90vh;display:flex;flex-direction:column">
      <header>
        <h3><i class="fa-solid fa-comments" style="margin-right:8px"></i>Conversas – ${escapeHtml(userName)}</h3>
        <button type="button" class="rh-colab-modal-close">×</button>
      </header>
      <div class="rh-colab-modal-body" style="overflow-y:auto;flex:1;display:block">
        <div style="margin-bottom:14px">
          <label for="rhConvTema">Tema abordado</label>
          <input id="rhConvTema" type="text" placeholder="ex.: Feedback de desempenho" style="margin-bottom:8px">
          <label for="rhConvDescricao">Descrição do assunto</label>
          <textarea id="rhConvDescricao" rows="3" placeholder="Descreva o assunto da conversa..."></textarea>
          <button id="rhConvRegistrar" type="button" class="content-button status-button" style="margin-top:10px">Registrar conversa</button>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px">
          <h4 style="margin:0 0 8px;font-size:15px">Histórico</h4>
          <div id="rhConvLista"></div>
        </div>
      </div>
      <footer>
        <button type="button" class="content-button status-button rh-colab-cancel">Fechar</button>
      </footer>
    </div>
  `;

  document.body.appendChild(back);
  document.body.style.overflow = 'hidden';

  const close = () => closeConversasModal();
  val('.rh-colab-modal-close', back)?.addEventListener('click', close);
  val('.rh-colab-cancel', back)?.addEventListener('click', close);
  back.addEventListener('click', (ev) => { if (ev.target === back) close(); });

  async function carregarConversas() {
    const box = val('#rhConvLista', back);
    try {
      const conversas = await fetchJson(`/api/rh/funcionarios/conversas/${encodeURIComponent(userId)}`);
      if (!conversas.length) {
        box.innerHTML = '<div class="rh-hist-empty">Nenhuma conversa registrada.</div>';
        return;
      }
      box.innerHTML = `<table class="rh-conv-table">
        <thead><tr><th>Tema</th><th>Descrição</th><th>Registrado por</th><th>Data</th><th></th></tr></thead>
        <tbody>${conversas.map(c => `<tr>
          <td>${escapeHtml(c.tema)}</td>
          <td>${escapeHtml(c.descricao || '-')}</td>
          <td>${escapeHtml(c.registrado_por || '-')}</td>
          <td>${c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '-'}</td>
          <td><button class="btn-del-row" data-cid="${c.id}">Excluir</button></td>
        </tr>`).join('')}</tbody>
      </table>`;
    } catch (err) {
      box.innerHTML = '<div class="rh-hist-empty">Erro ao carregar conversas.</div>';
    }
  }

  await carregarConversas();

  // Register new conversation
  val('#rhConvRegistrar', back).addEventListener('click', async () => {
    const tema = val('#rhConvTema', back).value.trim();
    if (!tema) { alert('Informe o tema da conversa.'); return; }
    try {
      await fetchJson(`/api/rh/funcionarios/conversas/${encodeURIComponent(userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tema,
          descricao: val('#rhConvDescricao', back).value.trim(),
          registrado_por: window.__sessionUser?.username || null,
        }),
      });
      val('#rhConvTema', back).value = '';
      val('#rhConvDescricao', back).value = '';
      await carregarConversas();
    } catch (err) {
      alert('Falha ao registrar conversa: ' + (err.message || err));
    }
  });

  // Delete conversation
  val('#rhConvLista', back).addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.btn-del-row');
    if (!btn) return;
    const cid = Number(btn.dataset.cid);
    if (!cid || !confirm('Excluir esta conversa?')) return;
    try {
      await fetchJson(`/api/rh/funcionarios/conversas/${encodeURIComponent(cid)}`, { method: 'DELETE' });
      await carregarConversas();
    } catch (err) {
      alert('Falha ao excluir conversa: ' + (err.message || err));
    }
  });
}

function ensurePane(root) {
  let pane = document.getElementById('rhCadastroColaboradores');
  if (pane) return pane;

  pane = document.createElement('div');
  pane.id = 'rhCadastroColaboradores';
  pane.className = 'tab-pane';
  pane.style.display = 'none';
  pane.innerHTML = `
    <div class="content-wrapper">
      <div class="content-section">
        <div class="title-wrapper rh-colab-title-row">
          <div class="content-section-title">Cadastro RH de colaboradores</div>
          <div class="rh-colab-actions-top">
            <button id="rhColabReload" class="content-button status-button" type="button">Recarregar</button>
            <button id="rhColabAddUser" class="content-button status-button" type="button">+ Novo colaborador</button>
          </div>
        </div>

        <div class="rh-colab-form">
          <div class="rh-colab-span2 rh-colab-user-top">
            <div class="rh-colab-photo-wrap" id="rhColabPhotoWrap" title="Alterar foto do colaborador">
              <img id="rhColabUserPhoto" src="${DEFAULT_PROFILE_IMAGE}" alt="Foto do colaborador">
              <button id="rhColabPhotoBtn" type="button" class="rh-colab-photo-btn" aria-label="Alterar foto">
                <i class="fa-solid fa-camera"></i>
              </button>
              <input id="rhColabPhotoInput" type="file" accept="image/*" style="display:none">
            </div>
            <div class="rh-colab-user-pick">
              <div class="rh-colab-user-pick-row">
                <label for="rhColabUserPick">Funcionário (usuário já cadastrado)</label>
                <div class="rh-colab-user-quick-actions">
                  <button id="rhColabBtnEpi" type="button" class="rh-colab-quick-btn" title="EPI – Equipamento de Proteção Individual" aria-label="EPI">
                    <i class="fa-solid fa-hard-hat"></i>
                  </button>
                  <button id="rhColabBtnConversas" type="button" class="rh-colab-quick-btn" title="Histórico de Conversas" aria-label="Histórico de conversas">
                    <i class="fa-solid fa-comments"></i>
                  </button>
                  <label class="rh-colab-check-label-inline" title="Receber notificação">
                    <input id="rhColabReceberNotificacao" type="checkbox">
                    <span>Notificação</span>
                  </label>
                </div>
              </div>
              <select id="rhColabUserPick"></select>
            </div>
          </div>

          <div class="rh-colab-span2">
            <label>Anexos do colaborador</label>
            <div id="rhColabAnexosList" class="rh-colab-anexos-list"></div>
          </div>

          <div class="rh-colab-span2 rh-colab-row3">
            <div>
              <label for="rhColabId">ID</label>
              <input id="rhColabId" type="text" readonly>
            </div>
            <div>
              <label for="rhColabUsuario">Usuário</label>
              <input id="rhColabUsuario" type="text" readonly>
            </div>
            <div>
              <label for="rhColabNomeCompleto">Nome completo</label>
              <input id="rhColabNomeCompleto" type="text" placeholder="ex.: João da Silva">
            </div>
          </div>

          <div class="rh-colab-span2 rh-colab-row3">
            <div>
              <label for="rhColabEmail">E-mail</label>
              <input id="rhColabEmail" type="email" placeholder="ex.: joao.silva@empresa.com.br">
            </div>
            <div>
              <label for="rhColabDataNascimento">Data de nascimento</label>
              <input id="rhColabDataNascimento" type="date">
            </div>
            <div>
              <label for="rhColabTelefone">Telefone</label>
              <input id="rhColabTelefone" type="tel" placeholder="ex.: (11) 99999-9999">
            </div>
          </div>

          <div>
            <label for="rhColabFuncao">Função</label>
            <select id="rhColabFuncao"></select>
          </div>
          <div>
            <label for="rhColabSetor">Setor</label>
            <select id="rhColabSetor"></select>
          </div>

          <div>
            <label for="rhColabTipoContrato">Tipo de contrato</label>
            <select id="rhColabTipoContrato">
              <option value="">Selecionar...</option>
              <option value="CLT">CLT</option>
              <option value="PJ">PJ</option>
              <option value="Temporario">Temporário</option>
              <option value="Terceiro">Terceiro</option>
            </select>
          </div>
          <div>
            <label for="rhColabDataAdmissao">Data de admissão</label>
            <input id="rhColabDataAdmissao" type="date">
          </div>

          <div class="rh-colab-span2">
            <label for="rhColabCargo">Cargo (Descrição de cargos RH)</label>
            <select id="rhColabCargo"></select>
          </div>

          <div>
            <label for="rhColabCargoCbo">CBO</label>
            <input id="rhColabCargoCbo" type="text" readonly>
          </div>
          <div></div>

          <div class="rh-colab-span2">
            <label for="rhColabCargoLtcat">Descrição das atividades no LTCAT</label>
            <textarea id="rhColabCargoLtcat" rows="3" readonly></textarea>
          </div>

          <div class="rh-colab-span2">
            <label for="rhColabCargoChao">Descrição das atividades no chão de fábrica</label>
            <textarea id="rhColabCargoChao" rows="3" readonly></textarea>
          </div>

          <div>
            <label for="rhColabCargoEpi">EPI</label>
            <textarea id="rhColabCargoEpi" rows="2" readonly></textarea>
          </div>
          <div>
            <label for="rhColabCargoTreinamentos">Treinamentos</label>
            <textarea id="rhColabCargoTreinamentos" rows="2" readonly></textarea>
          </div>

          <div>
            <label for="rhColabCargoPericulosidade">Periculosidade</label>
            <input id="rhColabCargoPericulosidade" type="text" readonly>
          </div>
          <div>
            <label for="rhColabCargoInsalubridade">Insalubridade</label>
            <input id="rhColabCargoInsalubridade" type="text" readonly>
          </div>

          <div class="rh-colab-span2">
            <label for="rhColabCargoEquipamentos">Equipamentos/Ferramentas</label>
            <textarea id="rhColabCargoEquipamentos" rows="2" readonly></textarea>
          </div>

          <div class="rh-colab-save-row rh-colab-span2">
            <button id="rhColabAttach" type="button" class="content-button status-button">Anexar arquivo</button>
            <input id="rhColabAttachInput" type="file" style="display:none">
            <button id="rhColabSave" type="button" class="content-button status-button">Salvar cadastro RH</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const st = document.createElement('style');
  st.textContent = `
    #rhCadastroColaboradores .rh-colab-title-row{display:flex;justify-content:space-between;align-items:center;gap:12px}
    #rhCadastroColaboradores .rh-colab-actions-top{display:flex;gap:8px;align-items:center}
    #rhCadastroColaboradores .rh-colab-form{display:grid;grid-template-columns:repeat(2,minmax(260px,1fr));gap:12px;margin-top:14px}
    #rhCadastroColaboradores .rh-colab-form label{display:block;margin-bottom:6px;font-size:12px;opacity:.85}
    #rhCadastroColaboradores .rh-colab-user-top{display:grid;grid-template-columns:104px 1fr;gap:12px;align-items:center}
    #rhCadastroColaboradores .rh-colab-user-pick{min-width:0}
    #rhCadastroColaboradores .rh-colab-user-pick-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
    #rhCadastroColaboradores .rh-colab-user-quick-actions{display:flex;gap:6px;align-items:center}
    #rhCadastroColaboradores .rh-colab-quick-btn{width:34px;height:34px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#d7defe;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:15px;transition:background .15s,border-color .15s,color .15s,transform .15s}
    #rhCadastroColaboradores .rh-colab-quick-btn:hover{background:rgba(77,128,255,.22);border-color:rgba(96,148,255,.55);color:#f5f7ff;transform:translateY(-1px)}
    #rhCadastroColaboradores .rh-colab-quick-btn:focus-visible{outline:2px solid rgba(95,142,255,.8);outline-offset:2px}
    #rhCadastroColaboradores .rh-colab-check-label-inline{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;white-space:nowrap;margin-left:4px}
    #rhCadastroColaboradores .rh-colab-check-label-inline input[type=checkbox]{width:16px;height:16px;accent-color:#3a6df0;cursor:pointer}
    #rhCadastroColaboradores .rh-colab-photo-wrap{position:relative;width:96px;height:96px;border-radius:999px;overflow:hidden;border:2px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;cursor:pointer}
    #rhCadastroColaboradores .rh-colab-photo-wrap img{width:100%;height:100%;object-fit:cover}
    #rhCadastroColaboradores .rh-colab-photo-btn{position:absolute;right:2px;bottom:2px;width:30px;height:30px;border-radius:999px;border:0;background:#3a6df0;color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px}
    #rhCadastroColaboradores .rh-colab-photo-btn:hover{filter:brightness(1.08)}
    #rhCadastroColaboradores .rh-colab-form input,
    #rhCadastroColaboradores .rh-colab-form select,
    #rhCadastroColaboradores .rh-colab-form textarea{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.6);color:#e8ecff}
    #rhCadastroColaboradores .rh-colab-form textarea{resize:vertical;min-height:44px}
    #rhCadastroColaboradores .rh-colab-form input[readonly],
    #rhCadastroColaboradores .rh-colab-form textarea[readonly]{opacity:.92;background:rgba(255,255,255,.06)}
    #rhCadastroColaboradores .rh-colab-span2{grid-column:1/-1}
    #rhCadastroColaboradores .rh-colab-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    #rhCadastroColaboradores .rh-colab-save-row{display:flex;justify-content:flex-end;padding-top:4px;gap:8px}
    #rhCadastroColaboradores .rh-colab-check-label{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:14px}
    #rhCadastroColaboradores .rh-colab-check-label input[type=checkbox]{width:18px;height:18px;accent-color:#3a6df0;cursor:pointer}
    #rhCadastroColaboradores .rh-colab-anexos-list{display:flex;flex-direction:column;gap:8px;background:rgba(13,16,24,.45);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px}
    #rhCadastroColaboradores .rh-colab-anexo-item{display:flex;justify-content:space-between;align-items:center;gap:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 10px}
    #rhCadastroColaboradores .rh-colab-anexo-link{color:#dbe5ff;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #rhCadastroColaboradores .rh-colab-anexo-link:hover{text-decoration:underline}
    #rhCadastroColaboradores .rh-colab-anexo-del{border:1px solid rgba(255,115,115,.35);background:rgba(255,95,95,.14);color:#ffc9c9;border-radius:8px;padding:4px 10px;cursor:pointer}
    #rhCadastroColaboradores .rh-colab-anexo-empty{opacity:.8;padding:6px 2px}

    .rh-colab-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10001}
    .rh-colab-modal{width:min(720px,94vw);background:#171c27;border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden}
    .rh-colab-modal header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
    .rh-colab-modal header h3{margin:0;font-size:28px;font-weight:700}
    .rh-colab-modal .rh-colab-modal-close{border:0;background:transparent;color:#cdd7f5;font-size:28px;cursor:pointer;line-height:1}
    .rh-colab-modal .rh-colab-modal-body{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 16px}
    .rh-colab-modal .rh-colab-modal-body .span2{grid-column:1/-1}
    .rh-colab-modal .rh-colab-modal-body label{display:block;margin-bottom:6px;font-size:12px;opacity:.85}
    .rh-colab-modal .rh-colab-modal-body input,
    .rh-colab-modal .rh-colab-modal-body select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.65);color:#e8ecff}
    .rh-colab-modal .rh-colab-plus-field{display:flex;gap:8px;align-items:flex-end}
    .rh-colab-modal .rh-colab-plus-field > div{flex:1}
    .rh-colab-modal .rh-plus-btn{width:36px;height:36px;flex:0 0 36px;border-radius:999px;border:0;background:#3a6df0;color:#fff;font-size:22px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
    .rh-colab-modal .rh-plus-btn:hover{filter:brightness(1.08)}
    .rh-colab-modal .rh-plus-btn:focus-visible{outline:2px solid rgba(95,142,255,.8);outline-offset:2px}
    .rh-colab-modal footer{padding:12px 16px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:flex-end;gap:8px}

    .rh-epi-table,.rh-conv-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
    .rh-epi-table th,.rh-conv-table th{text-align:left;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#a8b3d4;background:rgba(255,255,255,.03)}
    .rh-epi-table td,.rh-conv-table td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:#e1e6f8}
    .rh-epi-table .btn-del-row,.rh-conv-table .btn-del-row{border:1px solid rgba(255,115,115,.35);background:rgba(255,95,95,.14);color:#ffc9c9;border-radius:8px;padding:3px 8px;cursor:pointer;font-size:12px}
    .rh-colab-modal .rh-colab-modal-body textarea{width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(17,20,28,.65);color:#e8ecff;resize:vertical;min-height:60px}
    .rh-colab-modal .rh-hist-empty{opacity:.7;padding:12px 4px;text-align:center;font-size:13px}

    /* ====== Light-mode overrides ====== */
    #rhCadastroColaboradores input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(1) brightness(1.5)}
    .light-mode #rhCadastroColaboradores input[type="date"]::-webkit-calendar-picker-indicator{filter:none}
    .light-mode #rhCadastroColaboradores .rh-colab-form input,
    .light-mode #rhCadastroColaboradores .rh-colab-form select,
    .light-mode #rhCadastroColaboradores .rh-colab-form textarea{background:#f9fafb;border-color:#d1d5db;color:#1f2937}
    .light-mode #rhCadastroColaboradores .rh-colab-form input[readonly],
    .light-mode #rhCadastroColaboradores .rh-colab-form textarea[readonly]{background:#f3f4f6;color:#374151}
    .light-mode #rhCadastroColaboradores .rh-colab-form label{color:#374151}
    .light-mode #rhCadastroColaboradores .rh-colab-anexos-list{background:#f3f4f6;border-color:#e5e7eb}
    .light-mode #rhCadastroColaboradores .rh-colab-anexo-item{background:#fff;border-color:#e5e7eb}
    .light-mode #rhCadastroColaboradores .rh-colab-anexo-link{color:#1f2937}
    .light-mode #rhCadastroColaboradores .rh-colab-anexo-del{border-color:#fca5a5;background:#fef2f2;color:#b91c1c}
    .light-mode #rhCadastroColaboradores .rh-colab-photo-wrap{border-color:#d1d5db;background:#f3f4f6}
    .light-mode #rhCadastroColaboradores .rh-colab-quick-btn{border-color:#d1d5db;background:#f3f4f6;color:#374151}
    .light-mode #rhCadastroColaboradores .rh-colab-quick-btn:hover{background:#dbeafe;border-color:#93c5fd;color:#1e40af}
    .light-mode #rhCadastroColaboradores .rh-colab-check-label-inline{color:#374151}
    .light-mode .rh-colab-modal{background:#ffffff;border-color:#e5e7eb}
    .light-mode .rh-colab-modal header{border-color:#e5e7eb}
    .light-mode .rh-colab-modal header h3{color:#1f2937}
    .light-mode .rh-colab-modal .rh-colab-modal-close{color:#6b7280}
    .light-mode .rh-colab-modal footer{border-color:#e5e7eb}
    .light-mode .rh-colab-modal .rh-colab-modal-body input,
    .light-mode .rh-colab-modal .rh-colab-modal-body select,
    .light-mode .rh-colab-modal .rh-colab-modal-body textarea{background:#f9fafb;border-color:#d1d5db;color:#1f2937}
    .light-mode .rh-colab-modal .rh-colab-modal-body label{color:#374151}
    .light-mode .rh-epi-table th,.light-mode .rh-conv-table th{color:#374151;border-color:#e5e7eb;background:#f9fafb}
    .light-mode .rh-epi-table td,.light-mode .rh-conv-table td{color:#1f2937;border-color:#f3f4f6}
    .light-mode .rh-epi-table .btn-del-row,.light-mode .rh-conv-table .btn-del-row{border-color:#fca5a5;background:#fef2f2;color:#b91c1c}
    .light-mode .rh-colab-modal .rh-hist-empty{color:#6b7280}

    @media (max-width: 960px){
      #rhCadastroColaboradores .rh-colab-form{grid-template-columns:1fr}
      #rhCadastroColaboradores .rh-colab-span2{grid-column:auto}
      #rhCadastroColaboradores .rh-colab-row3{grid-template-columns:1fr}
      #rhCadastroColaboradores .rh-colab-user-top{grid-template-columns:1fr}
      #rhCadastroColaboradores .rh-colab-photo-wrap{width:104px;height:104px}
      .rh-colab-modal .rh-colab-modal-body{grid-template-columns:1fr}
      .rh-colab-modal .rh-colab-modal-body .span2{grid-column:auto}
      .rh-colab-modal .rh-colab-plus-field{align-items:stretch}
      .rh-colab-modal .rh-plus-btn{height:44px;flex-basis:44px}
    }
  `;

  pane.appendChild(st);
  root.appendChild(pane);

  val('#rhColabReload', pane).addEventListener('click', async () => {
    try {
      await carregarBases(pane);
      await carregarUsuarioSelecionado(pane);
    } catch (err) {
      alert('Falha ao recarregar dados de RH: ' + (err.message || err));
    }
  });

  val('#rhColabAddUser', pane).addEventListener('click', () => openNewUserModal(pane));

  val('#rhColabBtnEpi', pane).addEventListener('click', () => {
    const userId = getSelectedUserId(pane);
    if (!userId) { alert('Selecione um colaborador antes.'); return; }
    openEpiModal(pane, userId);
  });

  val('#rhColabBtnConversas', pane).addEventListener('click', () => {
    const userId = getSelectedUserId(pane);
    if (!userId) { alert('Selecione um colaborador antes.'); return; }
    openConversasModal(pane, userId);
  });

  val('#rhColabPhotoWrap', pane).addEventListener('click', () => val('#rhColabPhotoInput', pane)?.click());
  val('#rhColabPhotoBtn', pane).addEventListener('click', (ev) => {
    ev.stopPropagation();
    val('#rhColabPhotoInput', pane)?.click();
  });
  val('#rhColabPhotoInput', pane).addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Selecione uma imagem válida para a foto do colaborador.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('A foto deve ter no máximo 5MB.');
      return;
    }
    try {
      await uploadFotoUsuario(pane, file);
      alert('Foto atualizada com sucesso.');
    } catch (err) {
      alert('Falha ao atualizar foto: ' + (err.message || err));
    }
  });

  val('#rhColabAttach', pane).addEventListener('click', () => {
    const userId = getSelectedUserId(pane);
    if (!userId) {
      alert('Selecione um colaborador antes de anexar arquivo.');
      return;
    }
    val('#rhColabAttachInput', pane)?.click();
  });

  val('#rhColabAttachInput', pane).addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      await uploadAnexoColaborador(pane, file);
      alert('Anexo enviado com sucesso.');
    } catch (err) {
      alert('Falha ao enviar anexo: ' + (err.message || err));
    }
  });

  val('#rhColabAnexosList', pane).addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.rh-colab-anexo-del');
    if (!btn) return;
    const anexoId = normalizeId(btn.dataset.anexoId);
    if (!anexoId) return;
    if (!confirm('Confirma excluir este anexo?')) return;
    try {
      await fetchJson(`/api/rh/colaboradores/anexos/${encodeURIComponent(anexoId)}`, { method: 'DELETE' });
      await carregarAnexosUsuario(pane, getSelectedUserId(pane));
    } catch (err) {
      alert('Falha ao excluir anexo: ' + (err.message || err));
    }
  });

  val('#rhColabUserPick', pane).addEventListener('change', async () => {
    try {
      await carregarUsuarioSelecionado(pane);
    } catch (err) {
      alert('Falha ao carregar colaborador: ' + (err.message || err));
    }
  });

  val('#rhColabCargo', pane).addEventListener('change', () => {
    const cargoId = normalizeId(val('#rhColabCargo', pane).value);
    const byId = mapById(_cacheCargos);
    setCargoDetails(pane, cargoId ? byId.get(String(cargoId)) : null);
  });

  val('#rhColabSave', pane).addEventListener('click', async () => {
    await salvarCadastroRh(pane);
  });

  return pane;
}

async function doOpen() {
  const root = findTabsRoot();
  const pane = ensurePane(root);

  try {
    await carregarBases(pane);
    await carregarUsuarioSelecionado(pane);
  } catch (err) {
    alert('Falha ao abrir cadastro RH de colaboradores: ' + (err.message || err));
  }

  if (typeof window.showMainTab === 'function') {
    window.showMainTab('rhCadastroColaboradores');
  } else {
    document.querySelectorAll('.tab-pane, .kanban-page').forEach((el) => {
      const active = el.id === 'rhCadastroColaboradores';
      el.style.display = active ? 'block' : 'none';
      el.classList.toggle('active', active);
    });
  }
}

export function initRhColaboradoresUI() {
  if (_inited) return;
  _inited = true;

  const btn = document.querySelector('#btn-rh-colaboradores');
  if (!btn) return;

  if (!btn.dataset.bindRhColab) {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      doOpen();
    });
    btn.dataset.bindRhColab = '1';
  }

  window.openRhColaboradores = doOpen;
}

export const openRhColaboradores = doOpen;
