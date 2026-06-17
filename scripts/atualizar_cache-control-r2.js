#!/usr/bin/env node
/**
 * Atualiza Cache-Control de todos os objetos no R2.
 *
 * Uso:
 *   DRY_RUN=1 node scripts/atualizar_cache-control-r2.js        # só conta, não altera
 *   node scripts/atualizar_cache-control-r2.js                   # aplica em todos
 *   PREFIXO=produtos/Fotos_produto node scripts/...              # só um prefixo
 *
 * O Cache-Control padrão é: public, max-age=31536000, immutable
 * Para sobrescrever: CACHE_CONTROL="public, max-age=86400" node scripts/...
 */
require('dotenv').config();

const {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} = require('@aws-sdk/client-s3');

const {
  R2_BUCKET,
  R2_ACCOUNT_ID,
  DEFAULT_CACHE_CONTROL,
} = require('../utils/storage');

const DRY_RUN = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());
const PREFIXO = process.env.PREFIXO || '';
const CACHE_CONTROL = process.env.CACHE_CONTROL || DEFAULT_CACHE_CONTROL;
const CONCORRENCIA = 10;

const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', mp4: 'video/mp4',
  js: 'application/javascript', css: 'text/css',
  exe: 'application/octet-stream',
};

function mimeFromKey(key) {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  return EXT_MIME[ext] || 'application/octet-stream';
}

async function listarTodos(s3) {
  const keys = [];
  let token;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: PREFIXO,
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const obj of resp.Contents || []) {
      if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key);
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function jaTemCacheCorreto(s3, key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return (head.CacheControl || '') === CACHE_CONTROL;
  } catch {
    return false;
  }
}

async function atualizarObjeto(s3, key) {
  const ct = mimeFromKey(key);
  await s3.send(new CopyObjectCommand({
    Bucket: R2_BUCKET,
    CopySource: encodeURIComponent(R2_BUCKET) + '/' + key.split('/').map(encodeURIComponent).join('/'),
    Key: key,
    ContentType: ct,
    CacheControl: CACHE_CONTROL,
    MetadataDirective: 'REPLACE',
  }));
}

async function processarEmLotes(s3, keys) {
  let ok = 0, skip = 0, err = 0;
  for (let i = 0; i < keys.length; i += CONCORRENCIA) {
    const lote = keys.slice(i, i + CONCORRENCIA);
    await Promise.all(lote.map(async (key) => {
      try {
        const jaOk = await jaTemCacheCorreto(s3, key);
        if (jaOk) { skip++; return; }
        if (!DRY_RUN) await atualizarObjeto(s3, key);
        ok++;
      } catch (e) {
        err++;
        console.error(`  ERRO ${key}: ${e.message}`);
      }
    }));
    const pct = Math.round(((i + lote.length) / keys.length) * 100);
    process.stdout.write(`\r  ${i + lote.length}/${keys.length} (${pct}%) — ok:${ok} skip:${skip} err:${err}   `);
  }
  console.log('');
  return { ok, skip, err };
}

async function main() {
  if (!R2_BUCKET || !R2_ACCOUNT_ID) {
    console.error('[cache-r2] Configure R2_BUCKET e R2_ACCOUNT_ID no .env');
    process.exit(1);
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
  });

  console.log(`[cache-r2] ${DRY_RUN ? '== DRY RUN ==' : 'APLICANDO'}`);
  console.log(`[cache-r2] Bucket : ${R2_BUCKET}`);
  console.log(`[cache-r2] Prefixo: ${PREFIXO || '(todos)'}`);
  console.log(`[cache-r2] Header : ${CACHE_CONTROL}`);
  console.log('');
  console.log('[cache-r2] Listando objetos...');

  const keys = await listarTodos(s3);
  console.log(`[cache-r2] ${keys.length} objeto(s) encontrado(s)\n`);

  if (keys.length === 0) {
    console.log('[cache-r2] Nada a fazer.');
    process.exit(0);
  }

  const { ok, skip, err } = await processarEmLotes(s3, keys);

  console.log('');
  console.log('[cache-r2] Concluído:');
  console.log(`  Atualizados : ${ok}`);
  console.log(`  Já corretos : ${skip}`);
  console.log(`  Erros       : ${err}`);
  if (DRY_RUN) console.log('\n  (DRY_RUN=1 — nenhum arquivo foi alterado)');
  process.exit(err > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[cache-r2]', e.message); process.exit(1); });
