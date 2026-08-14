(() => {
  'use strict';

  const API = '/api/logistica/bipagem-contagem';
  const ACTIVE_KEY = 'fromtherm:bipagem-contagem:sessao';
  const QUEUE_KEY = 'fromtherm:bipagem-contagem:fila';
  const state = {
    sessao: null,
    leituras: [],
    fila: lerFila(),
    enviando: false,
    detector: null,
    cameraMode: '',
    cameraCanvas: null,
    cameraContext: null,
    cameraStream: null,
    cameraLoop: 0,
    cameraUltima: new Map(),
    audio: null,
    mudo: false,
  };

  const $ = (id) => document.getElementById(id);
  const el = {};

  function escapeHtml(valor) {
    return String(valor ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function lerFila() {
    try {
      const valor = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(valor) ? valor : [];
    } catch (_) { return []; }
  }

  function salvarFila() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state.fila.slice(-500)));
    renderTotais();
  }

  async function api(caminho, opcoes = {}) {
    const res = await fetch(`${API}${caminho}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
      ...opcoes,
    });
    let dados = {};
    try { dados = await res.json(); } catch (_) {}
    if (!res.ok) {
      const erro = new Error(dados.error || `Falha HTTP ${res.status}`);
      erro.status = res.status;
      erro.dados = dados;
      throw erro;
    }
    return dados;
  }

  function dataHora(valor) {
    if (!valor) return '—';
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? String(valor) : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function rotuloLeitura(item) {
    if (item.modelo && item.ordem_producao) return `${item.modelo} · OP ${item.ordem_producao}`;
    if (item.ordem_producao) return `OP ${item.ordem_producao}`;
    return item.valor_bruto || 'Código lido';
  }

  function iniciarAudio() {
    if (!state.audio) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) state.audio = new AudioContext();
    }
    if (state.audio?.state === 'suspended') state.audio.resume().catch(() => {});
  }

  function tom(frequencia, duracao, atraso = 0, volume = .08) {
    if (state.mudo || !state.audio) return;
    const ctx = state.audio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const inicio = ctx.currentTime + atraso;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequencia, inicio);
    gain.gain.setValueAtTime(0.0001, inicio);
    gain.gain.exponentialRampToValueAtTime(volume, inicio + .015);
    gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
    osc.connect(gain).connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + duracao + .02);
  }

  function som(tipo) {
    iniciarAudio();
    if (tipo === 'sucesso') { tom(880, .12); tom(1175, .14, .12); }
    else if (tipo === 'duplicada') { tom(420, .12); tom(360, .16, .13); }
    else { tom(220, .28); }
    if (navigator.vibrate) navigator.vibrate(tipo === 'sucesso' ? 70 : [90, 45, 90]);
  }

  function feedback(tipo, titulo, detalhe) {
    const mapa = {
      neutro: ['fa-barcode', ''],
      sucesso: ['fa-check', 'is-success'],
      aviso: ['fa-triangle-exclamation', 'is-warning'],
      erro: ['fa-xmark', 'is-error'],
    };
    const [icone, classe] = mapa[tipo] || mapa.neutro;
    el.feedback.className = `bip-feedback ${classe}`.trim();
    el.feedbackIcon.className = `bip-feedback-icon fa-solid ${icone}`;
    el.feedbackTitle.textContent = titulo;
    el.feedbackDetail.textContent = detalhe || '';
  }

  let toastTimer = 0;
  function toast(texto) {
    el.toast.textContent = texto;
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2600);
  }

  function renderTotais() {
    el.total.textContent = String(Number(state.sessao?.total || state.leituras.length || 0));
    const pendentes = state.fila.filter((x) => String(x.sessaoId) === String(state.sessao?.id)).length;
    el.pendentes.textContent = String(pendentes);
    el.pendingBox.hidden = pendentes === 0;
  }

  function renderLeituras() {
    if (!state.leituras.length) {
      el.leituras.innerHTML = '<div class="bip-empty-list"><i class="fa-solid fa-barcode"></i><br>Nenhuma leitura confirmada ainda.</div>';
      return;
    }
    el.leituras.innerHTML = state.leituras.map((item) => `
      <article class="bip-reading">
        <div>
          <strong>${escapeHtml(rotuloLeitura(item))}</strong>
          <div class="bip-reading-meta">
            <span class="bip-reading-origin"><i class="fa-solid ${item.origem === 'camera' ? 'fa-camera' : 'fa-barcode'}"></i> ${escapeHtml(item.origem || 'leitor')}</span>
            ${item.data_referencia ? `<span><i class="fa-regular fa-calendar"></i> ${escapeHtml(String(item.data_referencia).slice(0, 10).split('-').reverse().join('/'))}</span>` : ''}
            <span>${escapeHtml(dataHora(item.lido_em))}</span>
          </div>
        </div>
        ${state.sessao?.status === 'ativa' ? `<button class="bip-btn bip-btn--icon bip-btn--danger" type="button" data-remove-leitura="${item.id}" title="Desfazer esta leitura" aria-label="Desfazer esta leitura"><i class="fa-solid fa-rotate-left"></i></button>` : ''}
      </article>
    `).join('');
  }

  function renderSessao() {
    const ativa = Boolean(state.sessao);
    el.empty.hidden = ativa;
    el.active.hidden = !ativa;
    if (!ativa) {
      renderTotais();
      renderLeituras();
      return;
    }
    el.sessionName.textContent = state.sessao.nome || `Contagem #${state.sessao.id}`;
    el.sessionStatus.textContent = state.sessao.status === 'ativa' ? 'Contagem em andamento' : 'Contagem finalizada';
    el.finalizar.disabled = state.sessao.status !== 'ativa';
    el.scanInput.disabled = state.sessao.status !== 'ativa';
    el.scanButton.disabled = state.sessao.status !== 'ativa';
    el.cameraButton.disabled = state.sessao.status !== 'ativa';
    renderTotais();
    renderLeituras();
  }

  async function carregarSessoes() {
    try {
      const dados = await api('/sessoes?limite=12');
      const sessoes = dados.sessoes || [];
      el.history.innerHTML = sessoes.length ? sessoes.map((s) => `
        <button type="button" class="bip-history-item" data-open-session="${s.id}">
          <span><strong>${escapeHtml(s.nome)}</strong><small>${s.status === 'ativa' ? 'Em andamento' : `Finalizada · ${escapeHtml(dataHora(s.finalizada_em))}`}</small></span>
          <span class="bip-count-pill">${Number(s.total || 0)}</span>
        </button>
      `).join('') : '<div class="bip-empty-list">Nenhuma contagem anterior.</div>';
    } catch (err) {
      el.history.innerHTML = `<div class="bip-empty-list">${escapeHtml(err.message)}</div>`;
    }
  }

  async function abrirSessao(id, focar = true) {
    const dados = await api(`/sessoes/${id}?limite=500`);
    state.sessao = dados.sessao;
    state.leituras = dados.leituras || [];
    if (state.sessao.status === 'ativa') localStorage.setItem(ACTIVE_KEY, String(id));
    else localStorage.removeItem(ACTIVE_KEY);
    renderSessao();
    await sincronizarFila();
    if (focar && state.sessao.status === 'ativa') setTimeout(() => el.scanInput.focus(), 50);
  }

  async function criarSessao() {
    iniciarAudio();
    const nome = el.newName.value.trim();
    el.start.disabled = true;
    try {
      const dados = await api('/sessoes', { method: 'POST', body: JSON.stringify({ nome }) });
      state.sessao = dados.sessao;
      state.leituras = [];
      localStorage.setItem(ACTIVE_KEY, String(state.sessao.id));
      el.newName.value = '';
      renderSessao();
      feedback('neutro', 'Pronto para bipar', 'Use o Netum, digite um código ou abra a câmera.');
      el.scanInput.focus();
      carregarSessoes();
    } catch (err) { toast(err.message); }
    finally { el.start.disabled = false; }
  }

  function itemPendenteExiste(valor) {
    const normal = String(valor || '').normalize('NFKC').replace(/[\s\u0000-\u001f]/g, '').toUpperCase();
    return state.fila.some((item) => String(item.sessaoId) === String(state.sessao?.id) && item.normal === normal);
  }

  function enfileirar(valor, origem) {
    const normal = String(valor || '').normalize('NFKC').replace(/[\s\u0000-\u001f]/g, '').toUpperCase();
    if (!normal || itemPendenteExiste(valor)) return false;
    state.fila.push({ id: `${Date.now()}-${Math.random()}`, sessaoId: state.sessao.id, valor, normal, origem, criadoEm: new Date().toISOString() });
    salvarFila();
    return true;
  }

  async function registrarLeitura(valor, origem = 'leitor', daFila = false) {
    const codigo = String(valor || '').replace(/[\r\n\t]+/g, '').trim();
    if (!state.sessao || state.sessao.status !== 'ativa') {
      feedback('erro', 'Inicie uma contagem', 'É necessário ter uma contagem ativa antes de bipar.');
      som('erro');
      return false;
    }
    if (!codigo) return false;
    if (!daFila && itemPendenteExiste(codigo)) {
      feedback('aviso', 'Código já está aguardando sincronização', codigo);
      som('duplicada');
      return false;
    }
    try {
      const dados = await api(`/sessoes/${state.sessao.id}/leituras`, {
        method: 'POST', body: JSON.stringify({ valor: codigo, origem: daFila ? 'fila_offline' : origem }),
      });
      state.sessao = dados.sessao;
      state.leituras.unshift(dados.leitura);
      feedback('sucesso', `Confirmado · ${state.sessao.total} contado(s)`, rotuloLeitura(dados.leitura));
      som('sucesso');
      renderTotais();
      renderLeituras();
      return true;
    } catch (err) {
      if (err.dados?.duplicada || err.status === 409) {
        if (err.dados?.sessao) state.sessao = err.dados.sessao;
        feedback('aviso', 'Duplicado — não foi somado', codigo);
        som('duplicada');
        renderTotais();
        return true;
      }
      if (!daFila && (!navigator.onLine || !err.status)) {
        if (enfileirar(codigo, origem)) {
          feedback('aviso', 'Sem conexão — leitura guardada', 'Será confirmada automaticamente quando a conexão voltar.');
          som('duplicada');
        }
        return false;
      }
      feedback('erro', 'Leitura não confirmada', err.message);
      som('erro');
      return false;
    }
  }

  async function sincronizarFila() {
    if (state.enviando || !navigator.onLine || !state.sessao) return;
    state.enviando = true;
    try {
      const itens = state.fila.filter((x) => String(x.sessaoId) === String(state.sessao.id));
      for (const item of itens) {
        const processada = await registrarLeitura(item.valor, item.origem, true);
        if (!processada && !navigator.onLine) break;
        state.fila = state.fila.filter((x) => x.id !== item.id);
        salvarFila();
      }
    } finally { state.enviando = false; }
  }

  async function finalizarSessao() {
    if (!state.sessao || !confirm(`Finalizar "${state.sessao.nome}" com ${state.sessao.total || 0} leitura(s)?`)) return;
    const dados = await api(`/sessoes/${state.sessao.id}/finalizar`, { method: 'POST', body: '{}' });
    state.sessao = dados.sessao;
    localStorage.removeItem(ACTIVE_KEY);
    pararCamera();
    renderSessao();
    feedback('sucesso', 'Contagem finalizada', `${state.sessao.total || 0} item(ns) confirmado(s).`);
    som('sucesso');
    carregarSessoes();
  }

  async function removerLeitura(id) {
    if (!state.sessao || !confirm('Desfazer esta leitura da contagem?')) return;
    const dados = await api(`/sessoes/${state.sessao.id}/leituras/${id}`, { method: 'DELETE' });
    state.sessao = dados.sessao;
    state.leituras = state.leituras.filter((x) => String(x.id) !== String(id));
    renderSessao();
    feedback('aviso', 'Leitura desfeita', dados.removida?.valor_bruto || 'O item saiu da contagem.');
  }

  function enviarCampo() {
    const valor = el.scanInput.value;
    el.scanInput.value = '';
    registrarLeitura(valor, 'leitor').finally(() => el.scanInput.focus());
  }

  async function prepararDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const suportados = await BarcodeDetector.getSupportedFormats();
        const desejados = ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'codabar'];
        const formatos = desejados.filter((x) => suportados.includes(x));
        if (formatos.length) {
          state.detector = new BarcodeDetector({ formats: formatos });
          state.cameraMode = 'native';
          return;
        }
      } catch (_) {}
    }
    if (typeof window.jsQR === 'function') {
      state.cameraCanvas ||= document.createElement('canvas');
      state.cameraContext ||= state.cameraCanvas.getContext('2d', { willReadFrequently: true });
      state.cameraMode = 'jsqr';
      return;
    }
    throw new Error('A câmera deste navegador não oferece leitura contínua. Use o Netum ou o campo manual.');
  }

  async function codigosDaCamera() {
    if (state.cameraMode === 'native') return state.detector.detect(el.cameraVideo);
    if (state.cameraMode !== 'jsqr' || !el.cameraVideo.videoWidth || !el.cameraVideo.videoHeight) return [];
    const canvas = state.cameraCanvas;
    const ctx = state.cameraContext;
    canvas.width = el.cameraVideo.videoWidth;
    canvas.height = el.cameraVideo.videoHeight;
    ctx.drawImage(el.cameraVideo, 0, 0, canvas.width, canvas.height);
    const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const resultado = window.jsQR(imagem.data, imagem.width, imagem.height, { inversionAttempts: 'dontInvert' });
    return resultado?.data ? [{ rawValue: resultado.data }] : [];
  }

  async function iniciarCamera() {
    iniciarAudio();
    if (state.cameraStream) return pararCamera();
    try {
      await prepararDetector();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      state.cameraStream = stream;
      el.cameraVideo.srcObject = stream;
      await el.cameraVideo.play();
      el.camera.hidden = false;
      el.cameraButton.innerHTML = '<i class="fa-solid fa-camera-rotate"></i><span>Fechar câmera</span>';
      detectarCamera();
    } catch (err) {
      pararCamera();
      feedback('erro', 'Não foi possível abrir a câmera', err.message);
      som('erro');
    }
  }

  async function detectarCamera() {
    if (!state.cameraStream || !state.cameraMode) return;
    try {
      const codigos = await codigosDaCamera();
      const agora = Date.now();
      for (const codigo of codigos) {
        const valor = String(codigo.rawValue || '').trim();
        if (!valor) continue;
        const anterior = state.cameraUltima.get(valor) || 0;
        if (agora - anterior < 2200) continue;
        state.cameraUltima.set(valor, agora);
        await registrarLeitura(valor, 'camera');
      }
      for (const [valor, instante] of state.cameraUltima) if (agora - instante > 10000) state.cameraUltima.delete(valor);
    } catch (_) {}
    state.cameraLoop = requestAnimationFrame(detectarCamera);
  }

  function pararCamera() {
    if (state.cameraLoop) cancelAnimationFrame(state.cameraLoop);
    state.cameraLoop = 0;
    state.cameraStream?.getTracks().forEach((t) => t.stop());
    state.cameraStream = null;
    state.detector = null;
    state.cameraMode = '';
    el.cameraVideo.srcObject = null;
    el.camera.hidden = true;
    el.cameraButton.innerHTML = '<i class="fa-solid fa-camera"></i><span>Usar câmera</span>';
  }

  function bind() {
    el.menu?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (window.location.hash !== '#bipagem-contagem') history.replaceState(null, '', '#bipagem-contagem');
      document.querySelectorAll('.menu-link').forEach((x) => x.classList.remove('active'));
      el.menu.classList.add('active');
      if (typeof window.showMainTab === 'function') window.showMainTab('bipagemContagemPane');
      else if (typeof window.showOnlyInMain === 'function') window.showOnlyInMain(el.pane);
      else {
        document.querySelectorAll('.main-container > .tab-pane').forEach((x) => { x.style.display = 'none'; });
        el.pane.style.display = 'block';
      }
      carregarSessoes();
      if (state.sessao?.status === 'ativa') setTimeout(() => el.scanInput.focus(), 80);
    });
    el.start.addEventListener('click', criarSessao);
    el.newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') criarSessao(); });
    el.scanButton.addEventListener('click', enviarCampo);
    el.scanInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); enviarCampo(); }
    });
    el.cameraButton.addEventListener('click', iniciarCamera);
    el.cameraClose.addEventListener('click', pararCamera);
    el.finalizar.addEventListener('click', () => finalizarSessao().catch((e) => toast(e.message)));
    el.sound.addEventListener('click', () => {
      state.mudo = !state.mudo;
      el.sound.innerHTML = `<i class="fa-solid ${state.mudo ? 'fa-volume-xmark' : 'fa-volume-high'}"></i><span>${state.mudo ? 'Ativar som' : 'Som ativo'}</span>`;
      if (!state.mudo) { iniciarAudio(); som('sucesso'); }
    });
    el.refresh.addEventListener('click', async () => {
      if (state.sessao) await abrirSessao(state.sessao.id, false);
      await carregarSessoes();
      toast('Contagem atualizada.');
    });
    el.newSession.addEventListener('click', () => {
      pararCamera();
      state.sessao = null; state.leituras = []; localStorage.removeItem(ACTIVE_KEY); renderSessao(); el.newName.focus();
    });
    el.leituras.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-leitura]');
      if (btn) removerLeitura(btn.dataset.removeLeitura).catch((err) => toast(err.message));
    });
    el.history.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-session]');
      if (btn) abrirSessao(btn.dataset.openSession).catch((err) => toast(err.message));
    });
    window.addEventListener('online', sincronizarFila);
    document.addEventListener('click', (e) => {
      if (!el.pane.contains(e.target) && e.target.closest('.menu-link')) pararCamera();
    }, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pararCamera(); });
  }

  function aplicarPermissaoMenu() {
    if (!el.menu) return;
    const logado = Boolean(window.__sessionUser);
    const permissoes = window.__navPermissionsByKey || {};
    const temPermissaoPropria = Object.prototype.hasOwnProperty.call(permissoes, 'side:log:bipagem-contagem');
    const permitido = logado && (temPermissaoPropria
      ? permissoes['side:log:bipagem-contagem'] === true
      : (permissoes['side:log:identificacao-produto'] === true || permissoes['side:log:guardar-materiais'] === true));
    el.menu.classList.toggle('perm-hidden', !permitido);
  }

  async function init() {
    Object.assign(el, {
      pane: $('bipagemContagemPane'), menu: $('menu-bipagem-contagem'), empty: $('bipSessionEmpty'), active: $('bipSessionActive'),
      newName: $('bipSessionNewName'), start: $('bipSessionStart'), sessionName: $('bipSessionName'), sessionStatus: $('bipSessionStatus'),
      finalizar: $('bipSessionFinish'), newSession: $('bipNewSession'), scanInput: $('bipScanInput'), scanButton: $('bipScanSubmit'),
      cameraButton: $('bipCameraToggle'), camera: $('bipCamera'), cameraVideo: $('bipCameraVideo'), cameraClose: $('bipCameraClose'),
      sound: $('bipSoundToggle'), refresh: $('bipRefresh'), feedback: $('bipFeedback'), feedbackIcon: $('bipFeedbackIcon'),
      feedbackTitle: $('bipFeedbackTitle'), feedbackDetail: $('bipFeedbackDetail'), total: $('bipTotal'), pendentes: $('bipPending'),
      pendingBox: $('bipPendingBox'), leituras: $('bipReadings'), history: $('bipHistory'), toast: $('bipToast'),
    });
    if (!el.pane || !el.menu) return;
    bind(); renderSessao(); carregarSessoes(); aplicarPermissaoMenu();
    document.addEventListener('permissions:system-actions-changed', aplicarPermissaoMenu);
    window.addEventListener('auth:changed', () => setTimeout(aplicarPermissaoMenu, 0));
    setTimeout(aplicarPermissaoMenu, 1200);
    const ativa = localStorage.getItem(ACTIVE_KEY);
    if (ativa) abrirSessao(ativa, false).catch(() => localStorage.removeItem(ACTIVE_KEY));
    if (window.location.hash === '#bipagem-contagem') el.menu.click();
    if (window.location.hash === '#bipagem-contagem') setTimeout(() => el.menu.click(), 1800);
    window.addEventListener('load', () => {
      if (window.location.hash === '#bipagem-contagem') setTimeout(() => el.menu.click(), 80);
    }, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
