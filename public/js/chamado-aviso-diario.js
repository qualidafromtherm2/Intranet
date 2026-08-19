/* Aviso na 1ª abertura do dia: chamado aguardando aprovação ou necessário revisão (só do próprio usuário). */
(function () {
  if (window.__chamadoAvisoDiarioInit) return;
  window.__chamadoAvisoDiarioInit = true;

  function usuarioAtual() {
    try { return String(localStorage.getItem('auth_user') || '').trim(); } catch (_) { return ''; }
  }

  function dataHojeLocal() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function chaveAviso(usuario) {
    return `chamadoAvisoDiario:${String(usuario || '').trim() || 'anon'}:${dataHojeLocal()}`;
  }

  function jaAvisado(usuario) {
    try { return !!localStorage.getItem(chaveAviso(usuario)); } catch (_) { return true; }
  }

  function marcarAvisado(usuario) {
    try { localStorage.setItem(chaveAviso(usuario), '1'); } catch (_) {}
  }

  function statusNorm(c) {
    return String(c?.status || '').toLowerCase().trim().replace(/\s+/g, '_');
  }

  function modalAberto() {
    const el = document.getElementById('chamadoSuporteModal');
    return !!el && String(el.style.display || '') === 'flex';
  }

  async function abrirModalNaAba(aba) {
    const icon = document.getElementById('chamado-icon');
    const tab = document.getElementById(aba === 'aguardando' ? 'chamadoTabAguardando' : 'chamadoTabRevisao');
    if (!icon || !tab) return false;
    if (!modalAberto()) icon.click();
    const ate = Date.now() + 8000;
    while (Date.now() < ate) {
      if (modalAberto() && !tab.classList.contains('chamado-tab-active')) {
        tab.click();
      } else if (modalAberto() && tab.classList.contains('chamado-tab-active')) {
        await new Promise((r) => setTimeout(r, 400));
        if (tab.classList.contains('chamado-tab-active')) return true;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return tab.classList.contains('chamado-tab-active');
  }

  async function verificar() {
    const userHint = usuarioAtual();
    if (userHint && jaAvisado(userHint)) return;

    let payload = {};
    try {
      const resp = await fetch('/api/suporte/chamados?meus=1', { credentials: 'include' });
      payload = await resp.json().catch(() => ({}));
      if (!resp.ok) return;
    } catch (err) {
      console.warn('[CHAMADO] Aviso diário:', err);
      return;
    }

    const usuario = String(payload.usuario || userHint || '').trim();
    if (jaAvisado(usuario)) return;

    const lista = Array.isArray(payload.chamados) ? payload.chamados : [];
    const temAguardando = lista.some((c) => statusNorm(c) === 'aguardando_aprovacao');
    const temRevisao = lista.some((c) => statusNorm(c) === 'necessario_revisao');
    if (!temAguardando && !temRevisao) {
      marcarAvisado(usuario);
      return;
    }
    const aba = temAguardando ? 'aguardando' : 'revisao';
    if (modalAberto()) {
      document.getElementById(aba === 'aguardando' ? 'chamadoTabAguardando' : 'chamadoTabRevisao')?.click();
      marcarAvisado(usuario);
      return;
    }
    const abriu = await abrirModalNaAba(aba);
    if (!abriu) return;
    marcarAvisado(usuario);
  }

  function tentar(n) {
    if (!usuarioAtual() && n < 40) {
      setTimeout(() => tentar(n + 1), 250);
      return;
    }
    if (!usuarioAtual()) return;
    const pronto = document.getElementById('chamado-icon')
      && document.getElementById('chamadoTabAguardando')
      && typeof window.abrirChamadoSuporteComBotao === 'function';
    if (!pronto) {
      if (n < 40) setTimeout(() => tentar(n + 1), 250);
      return;
    }
    verificar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => tentar(0), 400));
  } else {
    setTimeout(() => tentar(0), 400);
  }
  document.addEventListener('auth:loggedIn', () => setTimeout(() => tentar(0), 400));
})();
