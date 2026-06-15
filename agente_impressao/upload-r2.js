/**
 * Upload do agente de impressão para Cloudflare R2
 * Nome do arquivo inclui a versão: agente-impressao-vX.X.exe
 * Uso: node agente_impressao/upload-r2.js
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { uploadPublicFile } = require('../utils/storage');

const _indexSrc    = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const _verMatch    = _indexSrc.match(/const AGENT_VERSION\s*=\s*'([^']+)'/);
const AGENT_VER    = _verMatch ? _verMatch[1] : 'X.X';

const BUCKET   = 'agente-impressao';
const FILE_KEY = `agente-impressao-v${AGENT_VER}.exe`;
const EXE_PATH = path.join(__dirname, 'agente-impressao.exe');

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error(`Arquivo não encontrado: ${EXE_PATH}`);
    console.error('Execute: npx pkg agente_impressao/index.js --targets node18-win-x64 --output agente_impressao/agente-impressao.exe');
    process.exit(1);
  }

  const fileData = fs.readFileSync(EXE_PATH);
  const sizeKB = (fileData.length / 1024).toFixed(0);
  console.log(`Fazendo upload de ${FILE_KEY} (${sizeKB} KB) para R2...`);

  const { url } = await uploadPublicFile(BUCKET, FILE_KEY, fileData, {
    contentType: 'application/octet-stream',
    upsert: true,
  });

  console.log('\n✅ Upload concluído!');
  console.log(`📦 URL pública: ${url}\n`);
  console.log('Adicione ao Render (.env):');
  console.log(`AGENTE_EXE_URL=${url}\n`);
}

main().catch((err) => {
  console.error('Erro:', err.message || err);
  process.exit(1);
});
