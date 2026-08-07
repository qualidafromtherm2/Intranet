const USUARIOS_AUDITORIA_PRODUTO = new Set([
  'denis.m',
  'alexsandro.j',
  'eduardo6760',
  'jair.r',
  'leandro.s'
]);

function normalizarUsuarioAuditoria(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function usuarioPodeAuditarProduto(usuario = {}) {
  return USUARIOS_AUDITORIA_PRODUTO.has(normalizarUsuarioAuditoria(usuario.username));
}

function exigirAuditoriaProduto(req, res, next) {
  if (!req?.session?.user?.id) {
    return res.status(401).json({ ok: false, error: 'Nao autenticado.' });
  }
  if (!usuarioPodeAuditarProduto(req.session.user)) {
    return res.status(403).json({
      ok: false,
      error: 'Seu usuario nao possui permissao para auditar movimentacoes e saldos enderecados.'
    });
  }
  return next();
}

module.exports = {
  USUARIOS_AUDITORIA_PRODUTO,
  normalizarUsuarioAuditoria,
  usuarioPodeAuditarProduto,
  exigirAuditoriaProduto
};
