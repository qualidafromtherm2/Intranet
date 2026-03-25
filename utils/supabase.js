// utils/supabase.js
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE; // server-side ONLY
const missingMsg = '[supabase] SUPABASE_URL/SUPABASE_SERVICE_ROLE ausentes. Uploads via Supabase foram desativados neste ambiente.';

let supabase;
if (!url || !key) {
  console.warn(missingMsg);
  // Retorna um proxy para manter o servidor de pé em dev local.
  // As rotas que realmente precisarem de upload vão falhar com erro explícito em tempo de execução.
  supabase = new Proxy({}, {
    get() {
      throw new Error(missingMsg);
    }
  });
} else {
  supabase = createClient(url, key, { auth: { persistSession: false } });
}

module.exports = supabase;
