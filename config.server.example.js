// config.server.js
module.exports = {
  OMIE_APP_KEY:    process.env.OMIE_APP_KEY,
  OMIE_APP_SECRET: process.env.OMIE_APP_SECRET,
  GITHUB_TOKEN:    process.env.GITHUB_TOKEN,
  GITHUB_BRANCH:   process.env.GITHUB_BRANCH || 'main',
  GITHUB_OWNER:    process.env.GITHUB_OWNER   || 'qualidafromtherm2',
  GITHUB_REPO:     process.env.GITHUB_REPO    || 'Foto-fromtherm',
  GITHUB_PATH:     process.env.GITHUB_PATH    || 'imagens',
};

  
  