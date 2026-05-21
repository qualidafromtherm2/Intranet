/**
 * Upload do agente-impressao-setup.exe para Supabase Storage
 * Uso: node agente_impressao/upload-supabase.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const BUCKET   = 'agente-impressao';
const FILE_KEY = 'agente-impressao-setup.exe';
const EXE_PATH = path.join(__dirname, FILE_KEY);

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE
  );

  // 1. Criar bucket público (ignora erro se já existir)
  console.log(`Criando bucket "${BUCKET}"...`);
  const { error: bucketErr } = await supabase.storage.createBucket(BUCKET, {
    public: true,
  });
  if (bucketErr && !bucketErr.message.includes('already exists') && !bucketErr.message.includes('duplicate')) {
    console.warn('Aviso ao criar bucket:', bucketErr.message);
  } else {
    console.log('Bucket OK');
  }

  // 2. Ler arquivo
  if (!fs.existsSync(EXE_PATH)) {
    console.error(`Arquivo não encontrado: ${EXE_PATH}`);
    console.error('Execute: npx pkg agente_impressao/index.js --targets node18-win-x64 --output agente_impressao/agente-impressao-setup.exe --compress GZip');
    process.exit(1);
  }

  const fileData = fs.readFileSync(EXE_PATH);
  const sizeKB = (fileData.length / 1024).toFixed(0);
  console.log(`Fazendo upload de ${FILE_KEY} (${sizeKB} KB)...`);

  // 3. Upload (upsert = sobrescreve se já existir)
  const { data, error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(FILE_KEY, fileData, {
      contentType: 'application/octet-stream',
      upsert: true,
    });

  if (uploadErr) {
    console.error('Erro no upload:', uploadErr.message);
    process.exit(1);
  }

  // 4. Pegar URL pública
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(FILE_KEY);
  const publicUrl = urlData.publicUrl;

  console.log('\n✅ Upload concluído!');
  console.log(`📦 URL pública: ${publicUrl}\n`);
  console.log('Adicione ao .env:');
  console.log(`AGENTE_EXE_URL=${publicUrl}\n`);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
