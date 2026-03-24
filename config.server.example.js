// config.server.js
module.exports = {
  OMIE_APP_KEY:    process.env.OMIE_APP_KEY,
  OMIE_APP_SECRET: process.env.OMIE_APP_SECRET,
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  GOOGLE_SHEETS_WEBHOOK_URL: process.env.GOOGLE_SHEETS_WEBHOOK_URL,
  GITHUB_TOKEN:    process.env.GITHUB_TOKEN,
  GITHUB_BRANCH:   process.env.GITHUB_BRANCH || 'main',
  GITHUB_OWNER:    process.env.GITHUB_OWNER   || 'qualidafromtherm2',
  GITHUB_REPO:     process.env.GITHUB_REPO    || 'Foto-fromtherm',
  GITHUB_PATH:     process.env.GITHUB_PATH    || 'imagens',
};

  
  