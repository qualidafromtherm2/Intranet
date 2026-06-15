// utils/supabase.js — fachada de compatibilidade (R2 ou Supabase Storage)
// Mantém a API .storage.from() usada em todo o projeto.
const { createStorageFacade } = require('./storage');

module.exports = createStorageFacade();
