const { dbQuery } = require('../src/db');

async function usuarioTemPermissaoNav(userId, navKey, queryable = null) {
  if (!userId || !navKey) return false;
  const executar = queryable?.query
    ? queryable.query.bind(queryable)
    : dbQuery;
  const { rows } = await executar(
    `SELECT COALESCE((
       SELECT t.allowed
         FROM public.auth_user_permissions_tree($1) t
        WHERE t.key = $2
        LIMIT 1
     ), false) AS allowed`,
    [userId, navKey]
  );
  return rows[0]?.allowed === true;
}

function sessionEhAdmin(req) {
  const roles = req.session?.user?.roles;
  const list = Array.isArray(roles) ? roles : String(roles || '').split(',');
  return list.some((r) => String(r || '').trim().toLowerCase() === 'admin');
}

function sessionEhRh(req) {
  const setor = String(req.session?.user?.setor || req.session?.user?.sector || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!setor) return false;
  return setor === 'rh' || setor.includes('recursos humanos') || /(^|[^a-z])rh([^a-z]|$)/.test(setor);
}

/** top:produto, botão EPI do RH, setor RH ou admin */
async function usuarioPodeEditarProduto(req, queryable = null) {
  if (sessionEhAdmin(req) || sessionEhRh(req)) return true;
  const userId = req.session?.user?.id;
  if (!userId) return false;
  if (await usuarioTemPermissaoNav(userId, 'top:produto', queryable)) return true;
  if (await usuarioTemPermissaoNav(userId, 'side:rh:epi', queryable)) return true;
  return false;
}

async function exigirPermissaoNav(req, res, navKey, mensagem, queryable = null) {
  const internalToken = String(req.get?.('x-internal-api-token') || '');
  if (internalToken && internalToken === process.env.INTERNAL_API_TOKEN) return true;
  const userId = req.session?.user?.id;
  if (!userId) {
    res.status(401).json({ ok: false, error: 'Não autenticado.' });
    return false;
  }
  const keys = Array.isArray(navKey) ? navKey : [navKey];
  for (const key of keys) {
    if (await usuarioTemPermissaoNav(userId, key, queryable)) return true;
  }
  res.status(403).json({ ok: false, error: mensagem });
  return false;
}

async function exigirPermissaoEditarProduto(req, res, queryable = null) {
  const internalToken = String(req.get?.('x-internal-api-token') || '');
  if (internalToken && internalToken === process.env.INTERNAL_API_TOKEN) return true;
  const userId = req.session?.user?.id;
  if (!userId) {
    res.status(401).json({ ok: false, error: 'Não autenticado.' });
    return false;
  }
  if (await usuarioPodeEditarProduto(req, queryable)) return true;
  res.status(403).json({
    ok: false,
    error: 'Seu usuário não possui permissão para editar produtos.',
  });
  return false;
}

module.exports = {
  usuarioTemPermissaoNav,
  exigirPermissaoNav,
  usuarioPodeEditarProduto,
  exigirPermissaoEditarProduto,
  sessionEhAdmin,
  sessionEhRh,
};
