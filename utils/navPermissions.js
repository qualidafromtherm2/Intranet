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

async function exigirPermissaoNav(req, res, navKey, mensagem, queryable = null) {
  const internalToken = String(req.get?.('x-internal-api-token') || '');
  if (internalToken && internalToken === process.env.INTERNAL_API_TOKEN) return true;
  const userId = req.session?.user?.id;
  if (!userId) {
    res.status(401).json({ ok: false, error: 'Não autenticado.' });
    return false;
  }
  if (await usuarioTemPermissaoNav(userId, navKey, queryable)) return true;
  res.status(403).json({ ok: false, error: mensagem });
  return false;
}

module.exports = { usuarioTemPermissaoNav, exigirPermissaoNav };
