// config.server.js
module.exports = {
  // When running on platforms like Render the environment variables used to
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
};

  
  