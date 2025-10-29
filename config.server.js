// config.server.js
module.exports = {
  
  // authenticate against the OMIE API might not be defined.  In that case we
  // fall back to the same values shipped with the front‑end configuration so
  // the API calls keep working.
  OMIE_APP_KEY:    process.env.OMIE_APP_KEY    || '3917057082939',
  OMIE_APP_SECRET: process.env.OMIE_APP_SECRET || '11e503358e3ae0bee91053faa1323629',
  GITHUB_TOKEN:    process.env.GITHUB_TOKEN,
  GITHUB_BRANCH:   process.env.GITHUB_BRANCH || 'main',
  GITHUB_OWNER:    process.env.GITHUB_OWNER   || 'qualidafromtherm2',
  GITHUB_REPO:     process.env.GITHUB_REPO    || 'Foto-fromtherm',
  GITHUB_PATH:     process.env.GITHUB_PATH    || 'imagens',
  // IAPP credenciais (defina como variáveis de ambiente em produção)
  IAPP_TOKEN:      process.env.IAPP_TOKEN      || 'HwrhcwwuLkXNGtDcluL7MEQn6429LJHxtbfu4ir5Pf7V8SADRIDTS24PKq0ZdNm9',
  IAPP_SECRET:     process.env.IAPP_SECRET     || '8q2lS1uG6UvFFV7yBb2wkU4svyc41ESk3F6mlBSWRtSce8rqT629yVsrBsUx1Nq9',
  // Domínio/tenant padrão da IAPP (opcional). Se definido, será usado
  // quando o cliente não informar ?domain= na rota de proxy.
  IAPP_DOMAIN:     process.env.IAPP_DOMAIN     || '',
  // Em alguns ambientes a cadeia TLS da IAPP pode não estar completa.
  // Para desenvolvimento/local, você pode permitir conexão insegura
  // definindo IAPP_INSECURE=true. Em produção, mantenha false.
  IAPP_INSECURE:   (process.env.IAPP_INSECURE || 'true') === 'true',
};

  
  