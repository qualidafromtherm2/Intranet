const { dbQuery } = require('../src/db');

function normalizarTextoPermissao(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function usuarioEhMembroLogistica(perfil = {}) {
  return normalizarTextoPermissao(perfil.setor || perfil.setor_nome).includes('logistica');
}

function usuarioEhSupervisorMovimentacao(perfil = {}) {
  const funcao = normalizarTextoPermissao(perfil.funcao_nome || perfil.funcao);
  const setor = normalizarTextoPermissao(perfil.setor || perfil.setor_nome);
  const areaPermitida = funcao.includes('logistica')
    || funcao.includes('qualidade')
    || setor.includes('logistica')
    || setor.includes('qualidade');
  return funcao.includes('supervisor') && areaPermitida;
}

async function carregarPerfilOperacional(req) {
  const user = req?.session?.user || {};
  if (!user.id) return null;
  const { rows } = await dbQuery(`
    SELECT s.name AS setor, f.name AS funcao_nome
      FROM public.auth_user u
      LEFT JOIN public.auth_user_profile up ON up.user_id = u.id
      LEFT JOIN public.auth_sector s ON s.id = up.sector_id
      LEFT JOIN public.auth_funcao f ON f.id = up.funcao_id
     WHERE u.id = $1
     LIMIT 1
  `, [user.id]);
  return rows[0] || null;
}

async function autorizarPerfil(req, res, verificador, mensagem) {
  if (!req?.session?.user?.id) {
    res.status(401).json({ ok: false, error: 'Nao autenticado.' });
    return false;
  }
  try {
    const perfil = await carregarPerfilOperacional(req);
    if (!perfil || !verificador(perfil)) {
      res.status(403).json({ ok: false, error: mensagem });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[permissoes-operacionais-produto]', err);
    res.status(500).json({ ok: false, error: 'Nao foi possivel validar a permissao do usuario.' });
    return false;
  }
}

function autorizarMembroLogistica(req, res) {
  return autorizarPerfil(req, res, usuarioEhMembroLogistica,
    'Somente membros da Logistica podem gerenciar enderecos de produtos.');
}

function autorizarSupervisorMovimentacao(req, res) {
  return autorizarPerfil(req, res, usuarioEhSupervisorMovimentacao,
    'Somente os supervisores de Logistica e Qualidade podem movimentar produtos.');
}

async function exigirMembroLogistica(req, res, next) {
  if (await autorizarMembroLogistica(req, res)) return next();
}

async function exigirSupervisorMovimentacao(req, res, next) {
  if (await autorizarSupervisorMovimentacao(req, res)) return next();
}

module.exports = {
  normalizarTextoPermissao,
  usuarioEhMembroLogistica,
  usuarioEhSupervisorMovimentacao,
  carregarPerfilOperacional,
  autorizarMembroLogistica,
  autorizarSupervisorMovimentacao,
  exigirMembroLogistica,
  exigirSupervisorMovimentacao
};
