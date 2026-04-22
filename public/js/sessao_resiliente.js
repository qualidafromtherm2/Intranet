/* =========================================================================
 * sessao_resiliente.js
 * Objetivo: tornar a perda de sessão (raríssima após persistência no Postgres)
 *           transparente para o usuário em fluxos críticos.
 *
 * Como funciona:
 *  - Intercepta TODAS as chamadas window.fetch() para endpoints internos.
 *  - Se uma resposta vier com 401 e houver um body/método sensível
 *    (POST/PUT/PATCH/DELETE), abre um modal de "Sessão expirou" pedindo
 *    para o usuário re-autenticar SEM recarregar a página, preservando
 *    todo o estado em memória (textareas, carrinho, formulários).
 *  - Após o login, a requisição original é re-executada automaticamente
 *    e o promise original devolve a resposta nova → o fluxo do usuário
 *    continua exatamente do ponto onde parou.
 *
 * Notas:
 *  - GETs com 401 são deixados passar (caller decide).
 *  - Se o usuário cancelar o relogin, a Promise resolve com a resposta 401
 *    original → o fluxo cai no tratamento de erro existente.
 * ========================================================================= */
(function () {
  if (window.__sessaoResilienteInstalado) return;
  window.__sessaoResilienteInstalado = true;

  const METODOS_SENSIVEIS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  // Endpoints onde NÃO queremos abrir modal (login/logout/status fazem 401 esperado)
  const ENDPOINTS_IGNORADOS = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/status',
    '/api/auth/first-password',
    '/api/check-version'
  ];

  function ehUrlInterna(url) {
    try {
      if (!url) return false;
      if (typeof url !== 'string') url = String(url);
      if (url.startsWith('/')) return true;
      const u = new URL(url, window.location.origin);
      return u.origin === window.location.origin;
    } catch (_) { return false; }
  }

  function ehEndpointIgnorado(url) {
    return ENDPOINTS_IGNORADOS.some((p) => url.includes(p));
  }

  function obterMetodo(input, init) {
    const m = (init && init.method) || (typeof input === 'object' && input?.method) || 'GET';
    return String(m || 'GET').toUpperCase();
  }

  // Fila para evitar abrir vários modais simultâneos
  let promessaReautenticacao = null;

  function pedirReautenticacao() {
    if (promessaReautenticacao) return promessaReautenticacao;
    promessaReautenticacao = new Promise((resolve) => {
      abrirModalReauth((sucesso) => {
        promessaReautenticacao = null;
        resolve(sucesso);
      });
    });
    return promessaReautenticacao;
  }

  function abrirModalReauth(onClose) {
    // Se o overlay já existe, reaproveita
    let overlay = document.getElementById('reauthOverlay');
    if (overlay) { overlay.style.display = 'flex'; return; }

    overlay = document.createElement('div');
    overlay.id = 'reauthOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'background:rgba(15,23,42,0.55)', 'backdrop-filter:blur(2px)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif'
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:420px;width:92%;
                  box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);overflow:hidden;">
        <div style="padding:18px 22px;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;">
          <div style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;">
            <span style="font-size:20px;">🔒</span>
            <span>Sessão expirou</span>
          </div>
          <div style="font-size:12px;opacity:0.9;margin-top:4px;">
            Confirme seus dados para continuar de onde parou.
            <br>Nada do que você digitou será perdido.
          </div>
        </div>
        <form id="reauthForm" style="padding:20px 22px;display:flex;flex-direction:column;gap:12px;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#334155;font-weight:600;">
            Usuário
            <input id="reauthUser" type="text" autocomplete="username" required
              style="padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;"/>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#334155;font-weight:600;">
            Senha
            <input id="reauthPass" type="password" autocomplete="current-password" required
              style="padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none;"/>
          </label>
          <div id="reauthErro" style="display:none;color:#b91c1c;font-size:12px;font-weight:600;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
            <button type="button" id="reauthCancelar"
              style="padding:9px 14px;border:1px solid #cbd5e1;background:#f8fafc;border-radius:8px;
                     font-weight:600;cursor:pointer;color:#475569;font-size:13px;">
              Cancelar
            </button>
            <button type="submit" id="reauthEntrar"
              style="padding:9px 14px;border:none;background:linear-gradient(135deg,#0ea5e9,#0284c7);
                     color:#fff;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
              Entrar e continuar
            </button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    // Pré-preenche username se disponível na sessão anterior
    try {
      const possivel = (window.__sessionUser && (window.__sessionUser.username || window.__sessionUser.id))
                    || document.getElementById('userNameDisplay')?.textContent?.trim();
      if (possivel && possivel !== '—') {
        const inp = overlay.querySelector('#reauthUser');
        if (inp) inp.value = possivel;
      }
    } catch (_) { /* ignore */ }

    setTimeout(() => {
      const f = overlay.querySelector('#reauthUser');
      if (f) (f.value ? overlay.querySelector('#reauthPass') : f).focus();
    }, 50);

    function fechar(sucesso) {
      try { overlay.remove(); } catch (_) {}
      onClose(!!sucesso);
    }

    overlay.querySelector('#reauthCancelar').addEventListener('click', () => fechar(false));

    overlay.querySelector('#reauthForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const userI = overlay.querySelector('#reauthUser');
      const passI = overlay.querySelector('#reauthPass');
      const errEl = overlay.querySelector('#reauthErro');
      const btn   = overlay.querySelector('#reauthEntrar');
      if (!userI.value.trim() || !passI.value) return;

      btn.disabled = true;
      const txtOriginal = btn.textContent;
      btn.textContent = 'Entrando...';
      errEl.style.display = 'none';

      try {
        const resp = await window.__fetchOriginal('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: userI.value.trim(), senha: passI.value })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data?.ok) {
          throw new Error(data?.error || 'Falha no login');
        }
        // Atualiza estado conhecido do front
        window.__sessionUser = data.user || window.__sessionUser;
        fechar(true);
      } catch (err) {
        errEl.textContent = err?.message || 'Não foi possível entrar';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = txtOriginal;
      }
    });
  }

  // ----- Wrapper do fetch -------------------------------------------------
  const fetchOriginal = window.fetch.bind(window);
  window.__fetchOriginal = fetchOriginal;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const metodo = obterMetodo(input, init);

    let resp;
    try {
      resp = await fetchOriginal(input, init);
    } catch (err) {
      throw err;
    }

    if (resp.status !== 401) return resp;
    if (!ehUrlInterna(url)) return resp;
    if (ehEndpointIgnorado(url)) return resp;

    // Para GETs e métodos seguros, devolve 401 normalmente (caller decide)
    if (!METODOS_SENSIVEIS.has(metodo)) return resp;

    // Pede reautenticação preservando o estado da página
    const okLogin = await pedirReautenticacao();
    if (!okLogin) return resp; // usuário cancelou → mantém comportamento original

    // Re-executa a requisição original.
    // Importante: se input for Request, ele já foi consumido; reconstruímos a partir de init.
    try {
      let novoInput = input;
      let novoInit  = init;
      if (typeof input !== 'string' && input && typeof input.clone === 'function') {
        novoInput = input.clone();
      }
      const respRetry = await fetchOriginal(novoInput, novoInit);
      return respRetry;
    } catch (err) {
      console.warn('[sessao-resiliente] retry falhou:', err);
      return resp;
    }
  };

  console.log('[sessao-resiliente] interceptor de fetch instalado');
})();
