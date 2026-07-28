const USUARIOS_GESTAO_ENDERECOS = Object.freeze([
  'Jair.R',
  'leandro.S',
  'Denis.M',
  'alexsandro.j'
]);

function normalizarUsuarioGestaoEnderecos(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

const USUARIOS_NORMALIZADOS = new Set(
  USUARIOS_GESTAO_ENDERECOS.map(normalizarUsuarioGestaoEnderecos)
);

function usuarioPodeGerenciarEnderecos(valor) {
  return USUARIOS_NORMALIZADOS.has(normalizarUsuarioGestaoEnderecos(valor));
}

function obterUsuarioSessao(req) {
  const user = req?.session?.user || {};
  return user.username || user.login || null;
}

function exigirGestaoEnderecos(req, res, next) {
  const username = obterUsuarioSessao(req);
  if (!username) return res.status(401).json({ ok: false, error: 'Não autenticado.' });
  if (!usuarioPodeGerenciarEnderecos(username)) {
    return res.status(403).json({ ok: false, error: 'Seu usuário não possui permissão para gerenciar endereços de produtos.' });
  }
  return next();
}

module.exports = {
  USUARIOS_GESTAO_ENDERECOS,
  normalizarUsuarioGestaoEnderecos,
  usuarioPodeGerenciarEnderecos,
  obterUsuarioSessao,
  exigirGestaoEnderecos
};
