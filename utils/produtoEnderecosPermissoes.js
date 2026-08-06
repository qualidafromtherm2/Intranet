const {
  usuarioEhMembroLogistica,
  exigirMembroLogistica
} = require('./permissoesOperacionaisProduto');

module.exports = {
  usuarioPodeGerenciarEnderecos: usuarioEhMembroLogistica,
  exigirGestaoEnderecos: exigirMembroLogistica
};
