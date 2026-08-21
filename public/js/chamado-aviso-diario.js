/* Aviso na 1ª abertura do dia: chamado aguardando aprovação ou necessário revisão (só do próprio usuário). */
(function () {
  if (window.__chamadoAvisoDiarioInit) return;
  window.__chamadoAvisoDiarioInit = true;

  let rodando = false;

  function usuarioAtual() {
    try {
      const u = window.__sessionUser;
      if (u) {
        const nome = String(u.username || u.id || '').trim();
        if (nome) return nome;
      }
      // fallback legado (lembrar usuário no login)
      return String(localStorage.getItem('user') || '').trim();
    } catch (_) {
      return '';
    }
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
    if (!usuario) return true;
    try { return !!localStorage.getItem(chaveAviso(usuario)); } catch (_) { return true; }
  }

  function marcarAvisado(usuario) {
    if (!usuario) return;
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
    const alvo = aba === 'aguardando' ? 'aguardando' : 'revisao';
    if (typeof window.__abrirChamadoAba === 'function') {
      await window.__abrirChamadoAba(alvo);
      const tab = document.getElementById(alvo === 'aguardando' ? 'chamadoTabAguardando' : 'chamadoTabRevisao');
      return modalAberto() && !!tab?.classList.contains('chamado-tab-active');
    }

    const icon = document.getElementById('chamado-icon');
    const tab = document.getElementById(alvo === 'aguardando' ? 'chamadoTabAguardando' : 'chamadoTabRevisao');
    if (!icon || !tab) return false;
    if (!modalAberto()) icon.click();
    const ate = Date.now() + 8000;
    while (Date.now() < ate) {
      if (modalAberto() && !tab.classList.contains('chamado-tab-active')) {
        tab.click();
      } else if (modalAberto() && tab.classList.contains('chamado-tab-active')) {
        await new Promise((r) => setTimeout(r, 300));
        if (tab.classList.contains('chamado-tab-active')) return true;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return tab.classList.contains('chamado-tab-active');
  }

  async function verificar() {
    if (rodando) return;
    const userHint = usuarioAtual();
    if (!userHint) return;
    if (jaAvisado(userHint)) return;

    rodando = true;
    try {
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
      if (!usuario || jaAvisado(usuario)) return;

      const lista = Array.isArray(payload.chamados) ? payload.chamados : [];
      const temAguardando = lista.some((c) => statusNorm(c) === 'aguardando_aprovacao');
      const temRevisao = lista.some((c) => statusNorm(c) === 'necessario_revisao');
      // Sem pendência: não marca o dia — se entrar chamado depois, ainda avisa nesta abertura futura.
      if (!temAguardando && !temRevisao) return;

      const aba = temAguardando ? 'aguardando' : 'revisao';
      if (modalAberto()) {
        document.getElementById(aba === 'aguardando' ? 'chamadoTabAguardando' : 'chamadoTabRevisao')?.click();
        marcarAvisado(usuario);
        return;
      }
      const abriu = await abrirModalNaAba(aba);
      if (!abriu) return;
      marcarAvisado(usuario);
    } finally {
      rodando = false;
    }
  }

  function tentar(n) {
    const logado = !!usuarioAtual();
    const pronto = document.getElementById('chamado-icon')
      && document.getElementById('chamadoTabAguardando')
      && document.getElementById('chamadoTabRevisao')
      && (typeof window.__abrirChamadoAba === 'function'
        || typeof window.abrirChamadoSuporteComBotao === 'function');
    if (!logado || !pronto) {
      if (n < 60) setTimeout(() => tentar(n + 1), 250);
      return;
    }
    verificar();
  }

  function agendar() {
    setTimeout(() => tentar(0), 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', agendar);
  } else {
    agendar();
  }
  document.addEventListener('auth:loggedIn', agendar);
  window.addEventListener('auth:changed', agendar);
})();
