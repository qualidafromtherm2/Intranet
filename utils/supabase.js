// utils/supabase.js
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE; // server-side ONLY

if (!url || !key) {
  console.error('[supabase] Faltando SUPABASE_URL ou SUPABASE_SERVICE_ROLE no .env');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
module.exports = supabase;
