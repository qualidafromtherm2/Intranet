/**
 * MASP — página do Relatório Gerencial AT (guias D1–D8).
 * Usado pelo bloco IIFE do Relatório AT em menu_produto.js via window.__AtMaspRelatorio.
 */
(function (global) {
  const DISCS = [
    { id: 'D1', label: 'D1 · Equipe' },
    { id: 'D2', label: 'D2 · Problema' },
    { id: 'D3', label: 'D3 · Contenção' },
    { id: 'D4', label: 'D4 · Causa raiz' },
    { id: 'D5', label: 'D5 · Ações corretivas' },
    { id: 'D6', label: 'D6 · Implementar' },
    { id: 'D7', label: 'D7 · Prevenir' },
    { id: 'D8', label: 'D8 · Reconhecer' },
  ];

  const ISHI_CAMPOS = [
    { key: 'metodo', label: 'Método' },
    { key: 'maquina', label: 'Máquina' },
    { key: 'material', label: 'Material' },
    { key: 'mao_obra', label: 'Mão de obra' },
    { key: 'meio_ambiente', label: 'Meio ambiente' },
    { key: 'medicao', label: 'Medição' },
  ];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtData(raw) {
    if (!raw) return '-';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
    return d.toLocaleDateString('pt-BR');
  }

  function fmtOs(id, dataOs) {
    const ano = dataOs ? new Date(dataOs) : new Date();
    const aa = Number.isNaN(ano.getTime())
      ? String(new Date().getFullYear()).slice(-2)
      : String(ano.getFullYear()).slice(-2);
    return `${aa} - ${id}`;
  }

  function estadoVazio(tag, periodoLabel, modo, tipo) {
    return {
      id: null,
      tag_problema: tag || '',
      modo: modo || '3m',
      tipo_at: tipo || 'Qualidade',
      periodo_label: periodoLabel || '',
      resumo: '',
      d3_contencao: '',
      d8_reconhecimento: '',
      status: 'em_andamento',
      equipe: [],
      causas: [],
      acoes: { D5: [], D6: [], D7: [] },
    };
  }

  function novoTempId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function garantirCausas(analise) {
    if (!analise) return;
    if (!Array.isArray(analise.causas)) analise.causas = [];
    analise.causas.forEach((c) => {
      if (!c.temp_id) c.temp_id = c.id ? String(c.id) : novoTempId('c');
      if (!Array.isArray(c.porques)) c.porques = [];
      if (c.validado && !c.porques.length) {
        c.porques = [{ n: 1, pergunta: '', resposta: '' }];
      }
    });
  }

  function ultimoPorqueTexto(causa) {
    const pqs = Array.isArray(causa?.porques) ? causa.porques : [];
    if (!pqs.length) return '';
    const last = pqs[pqs.length - 1];
    return String(last.resposta || last.pergunta || '').trim();
  }

  function syncAcoesD5FromCausas(analise) {
    if (!analise) return;
    garantirCausas(analise);
    if (!analise.acoes) analise.acoes = { D5: [], D6: [], D7: [] };
    if (!Array.isArray(analise.acoes.D5)) analise.acoes.D5 = [];
    const validadas = analise.causas.filter((c) => c.validado);
    const byKey = new Map();
    analise.acoes.D5.forEach((a) => {
      const k = String(a.causa_temp_id || a.causa_id || '');
      if (k) byKey.set(k, a);
    });
    analise.acoes.D5 = validadas.map((c) => {
      const key = String(c.temp_id || c.id);
      const prev = byKey.get(key) || {};
      return {
        disciplina: 'D5',
        causa_id: c.id || null,
        causa_temp_id: key,
        causa_texto: c.texto || '',
        ultimo_porque: ultimoPorqueTexto(c),
        descricao: prev.descricao || '',
        responsavel_user_id: prev.responsavel_user_id || null,
        responsavel_nome: prev.responsavel_nome || '',
        prazo: prev.prazo || null,
      };
    });
  }

  function createController(deps) {
    const {
      getRelData,
      getDefeitosLote,
      getModo,
      getTipo,
      abrirOsModal,
    } = deps;

    let guia = 'D1';
    let analise = null;
    let osRows = [];
    let setores = [];
    let usersSetor = [];
    let setorSel = '';
    let loading = false;
    let pickerDisc = null; // D5|D6|D7|equipe
    let pickerAcaoIdx = null;

    function status(msg) {
      const el = document.getElementById('atMaspStatus');
      if (el) el.textContent = msg || '';
    }

    function tagAtual() {
      return String(document.getElementById('atMaspTagSelect')?.value || '').trim();
    }

    function preencherComboDefeitos() {
      const sel = document.getElementById('atMaspTagSelect');
      if (!sel) return;
      const defs = getDefeitosLote() || [];
      const prev = sel.value;
      if (!defs.length) {
        sel.innerHTML = '<option value="">Nenhum defeito na janela de lote</option>';
        return;
      }
      sel.innerHTML = defs.map((d, i) =>
        `<option value="${esc(d.tag)}" ${(!prev && i === 0) || prev === d.tag ? 'selected' : ''}>` +
        `${esc(d.tag)} — ${d.total || 0} O.S. (${d.pct || 0}%)</option>`
      ).join('');
    }

    function osNaAnalise() {
      return osRows.filter((r) => !!r.validado);
    }

    function osDesconsideradas() {
      return osRows.filter((r) => !r.validado);
    }

    function calcParticipacao(qtdIncluidas) {
      const defs = getDefeitosLote() || [];
      const den = defs.reduce((s, d) => s + (Number(d.total) || 0), 0);
      if (!den) return 0;
      return Math.round((qtdIncluidas / den) * 1000) / 10;
    }

    function htmlOsRow(r) {
      const desconsiderar = !r.validado;
      return `
        <tr data-os-id="${r.id}" class="${desconsiderar ? 'at-masp-os-desconsiderada' : ''}">
          <td class="os-id"><button type="button" class="at-masp-os-link" data-open-os="${r.id}">${esc(fmtOs(r.id, r.data_os))}</button></td>
          <td>${esc(fmtData(r.data_os))}</td>
          <td>${esc(r.modelo || '-')}</td>
          <td>${esc(r.cliente || r.revenda_cliente || '-')}</td>
          <td>${esc(r.estado || '-')}</td>
          <td class="recl">${esc((r.reclamacao || r.motivo || '-').slice(0, 160))}</td>
          <td>${htmlTipoFalhaCell(r)}</td>
          <td>
            <input type="text" class="at-masp-comentario" data-os-id="${r.id}"
              value="${esc(r.comentario_tecnico || '')}" placeholder="Comentário técnico..." maxlength="4000">
          </td>
          <td class="at-masp-validado-td">
            <input type="checkbox" class="at-masp-desconsiderar" data-os-id="${r.id}"
              title="${desconsiderar ? 'Desmarque para voltar à análise' : 'Marque para desconsiderar na análise'}"
              ${desconsiderar ? 'checked' : ''}>
          </td>
        </tr>`;
    }

    function renderHeaderResumo() {
      const box = document.getElementById('atMaspHeaderResumo');
      if (!box) return;
      const janela = getRelData()?.analise_lote?.janela_3m || {};
      const periodoTxt = janela.inicio && janela.fim
        ? `${janela.inicio} a ${janela.fim}`
        : (analise?.periodo_label || getRelData()?.periodo || '—');
      const incluidas = osNaAnalise().length;
      const fora = osDesconsideradas().length;
      const pct = calcParticipacao(incluidas);
      box.innerHTML = `
        <div class="at-masp-kpis">
          <div class="at-masp-kpi"><div class="lbl">Defeito</div><div class="val">${esc(tagAtual() || '—')}</div></div>
          <div class="at-masp-kpi"><div class="lbl">O.S. do defeito</div><div class="val">${incluidas}</div></div>
          <div class="at-masp-kpi"><div class="lbl">Participação</div><div class="val">${pct}%</div></div>
          <div class="at-masp-kpi"><div class="lbl">Desconsideradas</div><div class="val">${fora}</div></div>
        </div>
        <div class="at-masp-meta">
          <b>Janela (Análise de Lote):</b> Defeitos nas O.S. abertas em ${esc(periodoTxt)}
          · Equipe: <b>${(analise?.equipe || []).length}</b> membro(s)
        </div>
        <div class="at-rel-ger-field" style="margin-top:10px;">
          <label for="atMaspResumo">Resumo da falha escolhida</label>
          <textarea id="atMaspResumo" rows="2" placeholder="Resumo executivo da falha em análise...">${esc(analise?.resumo || '')}</textarea>
        </div>
      `;
      document.getElementById('atMaspResumo')?.addEventListener('change', (e) => {
        if (analise) analise.resumo = e.target.value;
      });
    }

    function renderGuias() {
      const nav = document.getElementById('atMaspGuias');
      if (!nav) return;
      nav.innerHTML = DISCS.map((d) =>
        `<button type="button" class="at-masp-guia${guia === d.id ? ' is-active' : ''}" data-guia="${d.id}">${d.label}</button>`
      ).join('');
      nav.querySelectorAll('.at-masp-guia').forEach((btn) => {
        btn.addEventListener('click', () => {
          guia = btn.dataset.guia;
          renderGuias();
          renderPainel();
        });
      });
    }

    function htmlPickerEquipe(titulo) {
      return `
        <div class="at-masp-picker">
          <div class="at-masp-picker-title">${esc(titulo)}</div>
          <div class="at-masp-picker-row">
            <label>Setor</label>
            <select id="atMaspSetorSel">
              <option value="">Selecione o setor...</option>
              ${setores.map((s) =>
                `<option value="${s.id}" ${String(s.id) === String(setorSel) ? 'selected' : ''}>${esc(s.name)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="at-masp-picker-row">
            <label>Usuário do setor</label>
            <select id="atMaspUserSel">
              <option value="">${setorSel ? 'Selecione o usuário...' : 'Escolha um setor primeiro'}</option>
              ${usersSetor.map((u) =>
                `<option value="${u.id}" data-username="${esc(u.username)}" data-nome="${esc(u.nome)}" data-sector="${esc(u.sector_name)}" data-sector-id="${u.sector_id}">${esc(u.nome)} (${esc(u.username)})</option>`
              ).join('')}
            </select>
          </div>
          <div class="at-masp-picker-actions">
            <button type="button" class="at-rel-ger-btn primary" id="atMaspAddUserBtn"><i class="fa-solid fa-plus"></i> Adicionar</button>
            <button type="button" class="at-rel-ger-btn" id="atMaspCancelPickerBtn">Cancelar</button>
          </div>
        </div>
      `;
    }

    function bindPicker(onAdd) {
      document.getElementById('atMaspSetorSel')?.addEventListener('change', async (e) => {
        setorSel = e.target.value;
        usersSetor = [];
        if (setorSel) {
          try {
            const resp = await fetch(`/api/sac/at/relatorio-gerencial/masp/users?sector_id=${encodeURIComponent(setorSel)}`, { credentials: 'include' });
            const data = await resp.json();
            if (resp.ok && data.ok) usersSetor = data.users || [];
          } catch (_) { /* ignore */ }
        }
        renderPainel();
      });
      document.getElementById('atMaspCancelPickerBtn')?.addEventListener('click', () => {
        pickerDisc = null;
        pickerAcaoIdx = null;
        renderPainel();
      });
      document.getElementById('atMaspAddUserBtn')?.addEventListener('click', () => {
        const sel = document.getElementById('atMaspUserSel');
        const opt = sel?.selectedOptions?.[0];
        if (!opt?.value) return alert('Selecione um usuário.');
        onAdd({
          user_id: Number(opt.value),
          username: opt.dataset.username || '',
          nome: opt.dataset.nome || opt.textContent || '',
          sector_id: Number(opt.dataset.sectorId) || Number(setorSel) || null,
          sector_name: opt.dataset.sector || '',
        });
        pickerDisc = null;
        pickerAcaoIdx = null;
        renderPainel();
      });
    }

    function renderD1() {
      const equipe = analise?.equipe || [];
      return `
        <div class="at-masp-panel">
          <div class="at-rel-ger-edit-toolbar">
            <button type="button" class="at-rel-ger-btn primary" id="atMaspEscolherEquipeBtn">
              <i class="fa-solid fa-users"></i> Escolher equipes
            </button>
          </div>
          ${pickerDisc === 'equipe' ? htmlPickerEquipe('Adicionar membro da equipe de análise') : ''}
          <table class="at-rel-ger-tbl">
            <thead><tr><th>Nome</th><th>Usuário</th><th>Setor</th><th></th></tr></thead>
            <tbody>
              ${equipe.length ? equipe.map((m, i) => `
                <tr>
                  <td>${esc(m.nome || '-')}</td>
                  <td>${esc(m.username || '-')}</td>
                  <td>${esc(m.sector_name || '-')}</td>
                  <td><button type="button" class="at-rel-ger-btn" data-rm-equipe="${i}" title="Remover"><i class="fa-solid fa-trash"></i></button></td>
                </tr>
              `).join('') : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;">Nenhum membro na equipe.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    }

    function htmlTipoFalhaCell(r) {
      return `<div class="at-masp-tipo-mount" data-os-id="${r.id}" data-valor="${esc(r.tipo_falha || '')}"></div>`;
    }

    function renderD2() {
      const ativas = osNaAnalise();
      const fora = osDesconsideradas();
      return `
        <div class="at-masp-panel">
          <p class="at-masp-hint">Todas as O.S. entram na análise. Marque <b>Desconsiderar</b> quando a O.S. não deve afetar a análise (ex.: não é o defeito / não é falha de fábrica) — a linha some da lista e desconta O.S. e Participação. Tipo de falha: <b>×</b> exclui do catálogo; <b>+ Inserir</b> cadastra novo.</p>
          <div style="overflow:auto;max-height:420px;">
            <table class="at-rel-ger-tbl at-masp-os-tbl">
              <thead>
                <tr>
                  <th>O.S.</th><th>Data</th><th>Modelo</th><th>Cliente</th><th>UF</th>
                  <th>Reclamação</th><th>Tipo de falha</th><th>Comentário</th><th>Desconsiderar</th>
                </tr>
              </thead>
              <tbody>
                ${ativas.length
                  ? ativas.map(htmlOsRow).join('')
                  : '<tr><td colspan="9" style="text-align:center;color:#94a3b8;">Nenhuma O.S. na análise (todas desconsideradas ou lista vazia).</td></tr>'}
              </tbody>
            </table>
          </div>
          ${fora.length ? `
            <details class="at-masp-desconsideradas">
              <summary>Desconsideradas (${fora.length}) — desmarque Desconsiderar para voltar à análise</summary>
              <div style="overflow:auto;max-height:220px;margin-top:8px;">
                <table class="at-rel-ger-tbl at-masp-os-tbl">
                  <thead>
                    <tr>
                      <th>O.S.</th><th>Data</th><th>Modelo</th><th>Cliente</th><th>UF</th>
                      <th>Reclamação</th><th>Tipo de falha</th><th>Comentário</th><th>Desconsiderar</th>
                    </tr>
                  </thead>
                  <tbody>${fora.map(htmlOsRow).join('')}</tbody>
                </table>
              </div>
            </details>
          ` : ''}
        </div>
      `;
    }

    function renderD3() {
      return `
        <div class="at-masp-panel">
          <div class="at-rel-ger-field">
            <label for="atMaspD3">Contenção provisória</label>
            <textarea id="atMaspD3" rows="8" placeholder="Descreva a contenção que será realizada...">${esc(analise?.d3_contencao || '')}</textarea>
          </div>
        </div>
      `;
    }


    function renderD4() {
      garantirCausas(analise);
      const causas = analise.causas || [];
      const porCat = (cat) => causas
        .map((c, idx) => ({ c, idx }))
        .filter((x) => x.c.categoria === cat);

      const boneHtml = (cat, label, side) => {
        const items = porCat(cat);
        return `
          <div class="at-masp-bone ${side}" data-cat="${cat}">
            <div class="at-masp-bone-label">${label}</div>
            <div class="at-masp-bone-items">
              ${items.map(({ c, idx }) => `
                <div class="at-masp-causa" data-causa-idx="${idx}">
                  <input type="text" class="at-masp-causa-texto" data-causa-idx="${idx}"
                    value="${esc(c.texto || '')}" placeholder="Possível causa...">
                  <textarea class="at-masp-causa-comentario" data-causa-idx="${idx}" rows="2"
                    placeholder="Comentário da causa...">${esc(c.comentario || '')}</textarea>
                  <label class="at-masp-causa-valid">
                    <input type="checkbox" class="at-masp-causa-check" data-causa-idx="${idx}" ${c.validado ? 'checked' : ''}>
                    Validar causa
                  </label>
                  <button type="button" class="at-rel-ger-btn" data-rm-causa="${idx}" title="Remover">×</button>
                </div>
              `).join('') || '<div class="at-masp-bone-empty">Sem causas</div>'}
              <button type="button" class="at-rel-ger-btn" data-add-causa="${cat}">
                <i class="fa-solid fa-plus"></i> Adicionar
              </button>
            </div>
          </div>`;
      };

      const validadas = causas.filter((c) => c.validado);
      const porquesHtml = validadas.length ? validadas.map((c) => {
        const idx = causas.indexOf(c);
        const pqs = c.porques || [];
        return `
          <div class="at-masp-pq-block" data-causa-idx="${idx}">
            <div class="at-masp-pq-head">
              <b>${esc(c.texto || 'Causa')}</b>
              <span class="cat">${esc((ISHI_CAMPOS.find((x) => x.key === c.categoria) || {}).label || c.categoria)}</span>
            </div>
            <div class="at-masp-5p">
              ${pqs.map((p, pi) => `
                <div class="at-masp-5p-item" data-causa-idx="${idx}" data-pq-idx="${pi}">
                  <div class="n">Porquê ${pi + 1}</div>
                  <input type="text" data-pq-field="pergunta" data-causa-idx="${idx}" data-pq-idx="${pi}"
                    placeholder="Por que...?" value="${esc(p.pergunta || '')}">
                  <textarea data-pq-field="resposta" data-causa-idx="${idx}" data-pq-idx="${pi}" rows="2"
                    placeholder="Resposta / causa...">${esc(p.resposta || '')}</textarea>
                  <button type="button" class="at-rel-ger-btn" data-rm-pq="${idx}" data-pq-idx="${pi}" title="Remover porquê">×</button>
                </div>
              `).join('')}
            </div>
            <button type="button" class="at-rel-ger-btn primary" data-add-pq="${idx}">
              <i class="fa-solid fa-plus"></i> Adicionar porquê
            </button>
          </div>`;
      }).join('') : '<div class="status-msg">Valide causas no Ishikawa para abrir a análise de Porquês.</div>';

      return `
        <div class="at-masp-panel">
          <h4 class="at-masp-sub">Ishikawa — espinha de peixe</h4>
          <p class="at-masp-hint">Inclua possíveis causas em cada osso. Ao <b>validar</b>, a causa gera uma análise de Porquês abaixo.</p>
          <div class="at-masp-fishbone">
            <div class="at-masp-fish-col left">
              ${boneHtml('metodo', 'Método', 'up')}
              ${boneHtml('maquina', 'Máquina', 'up')}
              ${boneHtml('material', 'Material', 'down')}
            </div>
            <div class="at-masp-fish-spine">
              <div class="at-masp-fish-line"></div>
              <div class="at-masp-fish-head">${esc(tagAtual() || 'Efeito')}</div>
            </div>
            <div class="at-masp-fish-col right">
              ${boneHtml('mao_obra', 'Mão de obra', 'up')}
              ${boneHtml('meio_ambiente', 'Meio ambiente', 'up')}
              ${boneHtml('medicao', 'Medição', 'down')}
            </div>
          </div>
          <h4 class="at-masp-sub" style="margin-top:18px;">Porquês das causas validadas</h4>
          ${porquesHtml}
        </div>`;
    }

    function renderD5() {
      syncAcoesD5FromCausas(analise);
      const rows = analise?.acoes?.D5 || [];
      return `
        <div class="at-masp-panel">
          <p class="at-masp-hint">Ações corretivas geradas a partir das <b>causas validadas</b> do Ishikawa e do <b>último porquê</b> de cada uma.</p>
          ${pickerDisc === 'D5' ? htmlPickerEquipe('Responsável da ação corretiva (D5)') : ''}
          <div class="at-masp-acoes">
            ${rows.length ? rows.map((a, i) => `
              <div class="at-masp-acao" data-disc="D5" data-idx="${i}">
                <div class="at-masp-acao-causa">
                  <div><b>Causa validada:</b> ${esc(a.causa_texto || '—')}</div>
                  <div><b>Último porquê:</b> ${esc(a.ultimo_porque || '—')}</div>
                </div>
                <div class="at-rel-ger-field">
                  <label>Ação corretiva</label>
                  <textarea rows="2" data-acao-field="descricao">${esc(a.descricao || '')}</textarea>
                </div>
                <div class="at-masp-acao-row">
                  <div class="at-rel-ger-field" style="flex:1;">
                    <label>Responsável</label>
                    <div class="at-masp-resp">
                      <span>${esc(a.responsavel_nome || '—')}</span>
                      <button type="button" class="at-rel-ger-btn" data-pick-resp="D5" data-idx="${i}">Escolher</button>
                    </div>
                  </div>
                  <div class="at-rel-ger-field">
                    <label>Prazo</label>
                    <input type="date" data-acao-field="prazo" value="${esc(a.prazo ? String(a.prazo).slice(0, 10) : '')}">
                  </div>
                </div>
              </div>
            `).join('') : '<div class="status-msg">Nenhuma causa validada ainda. Valide causas no D4.</div>'}
          </div>
        </div>`;
    }

    function renderAcoes(disc, titulo) {
      const rows = analise?.acoes?.[disc] || [];
      return `
        <div class="at-masp-panel">
          <div class="at-rel-ger-edit-toolbar">
            <button type="button" class="at-rel-ger-btn primary" data-add-acao="${disc}">
              <i class="fa-solid fa-plus"></i> Adicionar ${titulo}
            </button>
          </div>
          ${pickerDisc === disc ? htmlPickerEquipe(`Responsável da ação (${disc})`) : ''}
          <div class="at-masp-acoes">
            ${rows.length ? rows.map((a, i) => `
              <div class="at-masp-acao" data-disc="${disc}" data-idx="${i}">
                <div class="at-rel-ger-field">
                  <label>Descrição</label>
                  <textarea rows="2" data-acao-field="descricao">${esc(a.descricao || '')}</textarea>
                </div>
                <div class="at-masp-acao-row">
                  <div class="at-rel-ger-field" style="flex:1;">
                    <label>Responsável</label>
                    <div class="at-masp-resp">
                      <span>${esc(a.responsavel_nome || '—')}</span>
                      <button type="button" class="at-rel-ger-btn" data-pick-resp="${disc}" data-idx="${i}">Escolher</button>
                    </div>
                  </div>
                  <div class="at-rel-ger-field">
                    <label>Prazo</label>
                    <input type="date" data-acao-field="prazo" value="${esc(a.prazo ? String(a.prazo).slice(0, 10) : '')}">
                  </div>
                  <button type="button" class="at-rel-ger-btn" data-rm-acao="${disc}" data-idx="${i}" title="Remover"><i class="fa-solid fa-trash"></i></button>
                </div>
              </div>
            `).join('') : `<div class="status-msg">Nenhuma ação cadastrada em ${disc}.</div>`}
          </div>
        </div>
      `;
    }

    function renderD8() {
      return `
        <div class="at-masp-panel">
          <div class="at-rel-ger-field">
            <label for="atMaspD8">Reconhecer a equipe / fechamento</label>
            <textarea id="atMaspD8" rows="8" placeholder="Fechamento da análise MASP, reconhecimento da equipe...">${esc(analise?.d8_reconhecimento || '')}</textarea>
          </div>
        </div>
      `;
    }

    function coletarDoDom() {
      if (!analise) return;
      garantirCausas(analise);
      const resumoEl = document.getElementById('atMaspResumo');
      if (resumoEl) analise.resumo = resumoEl.value;
      const d3 = document.getElementById('atMaspD3');
      if (d3) analise.d3_contencao = d3.value;
      const d8 = document.getElementById('atMaspD8');
      if (d8) analise.d8_reconhecimento = d8.value;

      document.querySelectorAll('.at-masp-causa-texto').forEach((el) => {
        const idx = Number(el.dataset.causaIdx);
        if (analise.causas[idx]) analise.causas[idx].texto = el.value;
      });
      document.querySelectorAll('.at-masp-causa-comentario').forEach((el) => {
        const idx = Number(el.dataset.causaIdx);
        if (analise.causas[idx]) analise.causas[idx].comentario = el.value;
      });
      document.querySelectorAll('.at-masp-causa-check').forEach((el) => {
        const idx = Number(el.dataset.causaIdx);
        if (!analise.causas[idx]) return;
        const was = !!analise.causas[idx].validado;
        analise.causas[idx].validado = !!el.checked;
        if (el.checked && !was && !(analise.causas[idx].porques || []).length) {
          analise.causas[idx].porques = [{ n: 1, pergunta: '', resposta: '' }];
        }
      });
      document.querySelectorAll('[data-pq-field]').forEach((el) => {
        const ci = Number(el.dataset.causaIdx);
        const pi = Number(el.dataset.pqIdx);
        if (!analise.causas[ci]?.porques?.[pi]) return;
        analise.causas[ci].porques[pi][el.dataset.pqField] = el.value;
        analise.causas[ci].porques[pi].n = pi + 1;
      });

      document.querySelectorAll('.at-masp-acao').forEach((box) => {
        const disc = box.dataset.disc;
        const idx = Number(box.dataset.idx);
        if (!analise.acoes?.[disc]?.[idx]) return;
        const desc = box.querySelector('[data-acao-field="descricao"]');
        const prazo = box.querySelector('[data-acao-field="prazo"]');
        if (desc) analise.acoes[disc][idx].descricao = desc.value;
        if (prazo) analise.acoes[disc][idx].prazo = prazo.value || null;
      });
    }

    function renderPainel() {
      const painel = document.getElementById('atMaspPainel');
      if (!painel) return;
      coletarDoDom();
      if (guia === 'D1') painel.innerHTML = renderD1();
      else if (guia === 'D2') painel.innerHTML = renderD2();
      else if (guia === 'D3') painel.innerHTML = renderD3();
      else if (guia === 'D4') painel.innerHTML = renderD4();
      else if (guia === 'D5') painel.innerHTML = renderD5();
      else if (guia === 'D6') painel.innerHTML = renderAcoes('D6', 'implementação/validação');
      else if (guia === 'D7') painel.innerHTML = renderAcoes('D7', 'prevenção');
      else if (guia === 'D8') painel.innerHTML = renderD8();
      else painel.innerHTML = '';

      // binds
      document.getElementById('atMaspEscolherEquipeBtn')?.addEventListener('click', async () => {
        pickerDisc = 'equipe';
        if (!setores.length) await carregarSetores();
        renderPainel();
      });
      if (pickerDisc === 'equipe') {
        bindPicker((user) => {
          if (!analise.equipe) analise.equipe = [];
          if (analise.equipe.some((m) => Number(m.user_id) === user.user_id)) {
            alert('Usuário já está na equipe.');
            return;
          }
          analise.equipe.push(user);
          renderHeaderResumo();
        });
      }
      painel.querySelectorAll('[data-rm-equipe]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const i = Number(btn.dataset.rmEquipe);
          analise.equipe.splice(i, 1);
          renderHeaderResumo();
          renderPainel();
        });
      });

      async function patchOs(id, body) {
        const resp = await fetch(`/api/sac/at/relatorio-gerencial/masp/os/${id}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || 'Falha ao salvar');
        const row = osRows.find((r) => String(r.id) === String(id));
        if (row) {
          if (Object.prototype.hasOwnProperty.call(body, 'tipo_falha')) row.tipo_falha = data.tipo_falha || '';
          if (Object.prototype.hasOwnProperty.call(body, 'validado')) row.validado = !!data.validado;
          if (Object.prototype.hasOwnProperty.call(body, 'comentario_tecnico')) {
            row.comentario_tecnico = data.comentario_tecnico || '';
          }
        }
        return data;
      }

      painel.querySelectorAll('[data-open-os]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.openOs;
          if (typeof abrirOsModal === 'function') abrirOsModal(id);
        });
      });

      const TipoFalha = global.__AtTipoFalha;
      painel.querySelectorAll('.at-masp-tipo-mount').forEach((mountEl) => {
        if (!TipoFalha?.mount) {
          mountEl.textContent = mountEl.dataset.valor || '—';
          return;
        }
        const osId = mountEl.dataset.osId;
        TipoFalha.mount(mountEl, {
          value: mountEl.dataset.valor || '',
          onChange: async (nome) => {
            try {
              await patchOs(osId, { tipo_falha: nome });
              status(nome ? 'Tipo de falha salvo.' : 'Tipo de falha limpo.');
            } catch (err) {
              alert(err.message || err);
            }
          },
        });
      });

      let comentarioTimers = {};
      painel.querySelectorAll('.at-masp-comentario').forEach((inp) => {
        const salvar = async () => {
          try {
            await patchOs(inp.dataset.osId, { comentario_tecnico: inp.value });
            status('Comentário salvo.');
          } catch (err) {
            alert(err.message || err);
          }
        };
        inp.addEventListener('change', salvar);
        inp.addEventListener('input', () => {
          const id = inp.dataset.osId;
          clearTimeout(comentarioTimers[id]);
          comentarioTimers[id] = setTimeout(salvar, 800);
        });
      });

      painel.querySelectorAll('.at-masp-desconsiderar').forEach((chk) => {
        chk.addEventListener('change', async () => {
          const id = chk.dataset.osId;
          const desconsiderar = !!chk.checked;
          // no banco: validado=true = entra na análise
          const validado = !desconsiderar;
          try {
            await patchOs(id, { validado });
            renderHeaderResumo();
            renderPainel();
            status(desconsiderar ? 'O.S. desconsiderada na análise.' : 'O.S. voltou para a análise.');
          } catch (err) {
            chk.checked = !desconsiderar;
            alert(err.message || err);
          }
        });
      });

      document.getElementById('atMaspD3')?.addEventListener('change', (e) => {
        if (analise) analise.d3_contencao = e.target.value;
      });
      document.getElementById('atMaspD8')?.addEventListener('change', (e) => {
        if (analise) analise.d8_reconhecimento = e.target.value;
      });

      ['D6', 'D7'].forEach((disc) => {
        painel.querySelector(`[data-add-acao="${disc}"]`)?.addEventListener('click', () => {
          if (!analise.acoes) analise.acoes = { D5: [], D6: [], D7: [] };
          if (!analise.acoes[disc]) analise.acoes[disc] = [];
          analise.acoes[disc].push({
            disciplina: disc,
            descricao: '',
            responsavel_user_id: null,
            responsavel_nome: '',
            prazo: null,
          });
          renderPainel();
        });
      });

      // D4 Ishikawa
      painel.querySelectorAll('[data-add-causa]').forEach((btn) => {
        btn.addEventListener('click', () => {
          garantirCausas(analise);
          analise.causas.push({
            temp_id: novoTempId('c'),
            categoria: btn.dataset.addCausa,
            texto: '',
            comentario: '',
            validado: false,
            porques: [],
          });
          renderPainel();
        });
      });
      painel.querySelectorAll('[data-rm-causa]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.rmCausa);
          analise.causas.splice(idx, 1);
          syncAcoesD5FromCausas(analise);
          renderPainel();
        });
      });
      painel.querySelectorAll('.at-masp-causa-check').forEach((chk) => {
        chk.addEventListener('change', () => {
          coletarDoDom();
          syncAcoesD5FromCausas(analise);
          renderPainel();
        });
      });
      painel.querySelectorAll('[data-add-pq]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.addPq);
          const c = analise.causas[idx];
          if (!c) return;
          if (!Array.isArray(c.porques)) c.porques = [];
          c.porques.push({ n: c.porques.length + 1, pergunta: '', resposta: '' });
          renderPainel();
        });
      });
      painel.querySelectorAll('[data-rm-pq]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ci = Number(btn.dataset.rmPq);
          const pi = Number(btn.dataset.pqIdx);
          const c = analise.causas[ci];
          if (!c?.porques) return;
          if (c.porques.length <= 1) {
            alert('Mantenha pelo menos 1 porquê na causa validada.');
            return;
          }
          c.porques.splice(pi, 1);
          c.porques.forEach((p, i) => { p.n = i + 1; });
          syncAcoesD5FromCausas(analise);
          renderPainel();
        });
      });

      if (pickerDisc && pickerDisc !== 'equipe') {
        bindPicker((user) => {
          const list = analise.acoes?.[pickerDisc];
          if (!list || pickerAcaoIdx == null || !list[pickerAcaoIdx]) return;
          list[pickerAcaoIdx].responsavel_user_id = user.user_id;
          list[pickerAcaoIdx].responsavel_nome = user.nome || user.username;
        });
      }

      painel.querySelectorAll('[data-pick-resp]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          pickerDisc = btn.dataset.pickResp;
          pickerAcaoIdx = Number(btn.dataset.idx);
          if (!setores.length) await carregarSetores();
          renderPainel();
        });
      });
      painel.querySelectorAll('[data-rm-acao]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const disc = btn.dataset.rmAcao;
          const idx = Number(btn.dataset.idx);
          analise.acoes[disc].splice(idx, 1);
          renderPainel();
        });
      });
    }

    async function carregarSetores() {
      try {
        const resp = await fetch('/api/sac/at/relatorio-gerencial/masp/setores', { credentials: 'include' });
        const data = await resp.json();
        if (resp.ok && data.ok) setores = data.setores || [];
      } catch (_) { /* ignore */ }
    }

    async function carregarOs() {
      const tag = tagAtual();
      if (!tag) {
        osRows = [];
        return;
      }
      const modo = getModo();
      const tipo = getTipo();
      const qs = new URLSearchParams({ tag, modo, tipo });
      const resp = await fetch(`/api/sac/at/relatorio-gerencial/masp/os?${qs}`, { credentials: 'include' });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Erro ao carregar O.S.');
      osRows = data.rows || [];
    }

    async function carregarAnalise() {
      const tag = tagAtual();
      if (!tag) {
        analise = estadoVazio('', '', getModo(), getTipo());
        return;
      }
      const modo = getModo();
      const tipo = getTipo();
      const qs = new URLSearchParams({ tag, modo, tipo });
      const resp = await fetch(`/api/sac/at/relatorio-gerencial/masp?${qs}`, { credentials: 'include' });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Erro ao carregar MASP');
      analise = data.analise || estadoVazio(tag, data.periodo, modo, tipo);
      if (!analise.acoes) analise.acoes = { D5: [], D6: [], D7: [] };
      ['D5', 'D6', 'D7'].forEach((d) => {
        if (!Array.isArray(analise.acoes[d])) analise.acoes[d] = [];
      });
      garantirCausas(analise);
      syncAcoesD5FromCausas(analise);
    }

    async function salvar() {
      if (!analise || !tagAtual()) {
        alert('Escolha um defeito antes de salvar.');
        return;
      }
      coletarDoDom();
      status('Salvando...');
      syncAcoesD5FromCausas(analise);
      const acoesFlat = [];
      ['D5', 'D6', 'D7'].forEach((d) => {
        (analise.acoes?.[d] || []).forEach((a) => {
          acoesFlat.push({
            disciplina: d,
            descricao: a.descricao || '',
            responsavel_user_id: a.responsavel_user_id || null,
            responsavel_nome: a.responsavel_nome || '',
            prazo: a.prazo || null,
            causa_id: a.causa_id || null,
            causa_temp_id: a.causa_temp_id || null,
            ultimo_porque: a.ultimo_porque || '',
          });
        });
      });
      const body = {
        id: analise.id,
        tag_problema: tagAtual(),
        modo: getModo(),
        tipo_at: getTipo(),
        resumo: analise.resumo || '',
        d3_contencao: analise.d3_contencao || '',
        d8_reconhecimento: analise.d8_reconhecimento || '',
        status: analise.status || 'em_andamento',
        equipe: analise.equipe || [],
        causas: (analise.causas || []).map((c) => ({
          temp_id: c.temp_id || (c.id ? String(c.id) : undefined),
          id: c.id || null,
          categoria: c.categoria,
          texto: c.texto || '',
          comentario: c.comentario || '',
          validado: !!c.validado,
          porques: (c.porques || []).map((p, i) => ({
            n: i + 1,
            pergunta: p.pergunta || '',
            resposta: p.resposta || '',
          })),
        })),
        acoes: acoesFlat,
      };
      const resp = await fetch('/api/sac/at/relatorio-gerencial/masp', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Erro ao salvar');
      analise = data.analise;
      status('MASP salvo.');
      renderHeaderResumo();
      renderPainel();
    }

    async function aoEscolherTag() {
      if (loading) return;
      loading = true;
      status('Carregando dados do defeito...');
      try {
        await Promise.all([carregarAnalise(), carregarOs()]);
        renderHeaderResumo();
        renderGuias();
        renderPainel();
        status('');
      } catch (err) {
        console.error('[MASP]', err);
        status('Erro: ' + (err.message || err));
      } finally {
        loading = false;
      }
    }

    function montarPaginaHtml(hdr, footerHtml) {
      return `
      <div class="at-rel-ger-page" data-sec="masp">
        ${hdr()}
        <div class="at-rel-ger-sec-title"><i class="fa-solid fa-diagram-project"></i> MASP — Análise e Solução de Problemas</div>
        <div class="at-rel-ger-body">
          <div class="at-masp-header">
            <div class="at-masp-tag-row">
              <label for="atMaspTagSelect">Top defeitos (Análise de Lote)</label>
              <select id="atMaspTagSelect"></select>
              <button type="button" id="atMaspSalvarBtn" class="at-rel-ger-btn primary">
                <i class="fa-solid fa-floppy-disk"></i> Salvar MASP
              </button>
              <span id="atMaspStatus" class="status-msg"></span>
            </div>
            <div id="atMaspHeaderResumo"></div>
          </div>
          <nav class="at-masp-guias" id="atMaspGuias" aria-label="Disciplinas MASP"></nav>
          <div id="atMaspPainel"></div>
        </div>
        ${footerHtml}
      </div>`;
    }

    let wired = false;

    function wire() {
      if (wired) return;
      wired = true;
      document.getElementById('atMaspTagSelect')?.addEventListener('change', () => aoEscolherTag());
      document.getElementById('atMaspSalvarBtn')?.addEventListener('click', async () => {
        try { await salvar(); } catch (err) { alert(err.message || err); status('Erro ao salvar'); }
      });
    }

    async function ativar() {
      // remonta listeners se o DOM da página foi recriado
      if (!document.getElementById('atMaspTagSelect')) return;
      wired = false;
      preencherComboDefeitos();
      wire();
      renderGuias();
      if (tagAtual()) await aoEscolherTag();
      else {
        analise = estadoVazio('', getRelData()?.periodo || '', getModo(), getTipo());
        renderHeaderResumo();
        renderPainel();
      }
    }

    function reset() {
      analise = null;
      osRows = [];
      guia = 'D1';
      pickerDisc = null;
      pickerAcaoIdx = null;
      wired = false;
    }

    return { montarPaginaHtml, ativar, reset, preencherComboDefeitos };
  }

  global.__AtMaspRelatorio = { createController };
})(window);
