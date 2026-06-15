// utils/supabase.js — compatibilidade (.storage.from) → Cloudflare R2
const { createStorageFacade } = require('./storage');

module.exports = createStorageFacade();
