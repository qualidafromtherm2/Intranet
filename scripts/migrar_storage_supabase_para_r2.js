#!/usr/bin/env node
/**
 * Copia arquivos do Supabase Storage → Cloudflare R2.
 *
 * Requisitos (.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE  (origem)
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL  (destino)
 *
 * Uso:
 *   node scripts/migrar_storage_supabase_para_r2.js              # copia tudo
 *   DRY_RUN=1 node scripts/migrar_storage_supabase_para_r2.js    # só lista
 *   BUCKET=produtos node scripts/migrar_storage_supabase_para_r2.js  # um bucket
 */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const {
  isR2Configured,
  isSupabaseConfigured,
  LEGACY_BUCKETS,
  r2ObjectKey,
  R2_BUCKET,
} = require('../utils/storage');

const DRY_RUN = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());
const ONLY_BUCKET = String(process.env.BUCKET || '').trim();

async function listSupabaseFiles(supabase, bucketName, prefix = '', acc = []) {
  const { data, error } = await supabase.storage.from(bucketName).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;

  for (const item of data || []) {
    if (!item?.name) continue;
    const path = prefix ? `${prefix}/${item.name}` : item.name;

    if (item.metadata == null) {
      await listSupabaseFiles(supabase, bucketName, path, acc);
      continue;
    }

    acc.push({ bucket: bucketName, path, size: item.metadata?.size || 0 });
  }
  return acc;
}

async function downloadSupabaseFile(supabase, bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  const buf = Buffer.from(await data.arrayBuffer());
  return buf;
}

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function r2Exists(client, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE.');
    process.exit(1);
  }
  if (!isR2Configured()) {
    console.error('Configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.');
    process.exit(1);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
  const r2 = getR2Client();
  const buckets = ONLY_BUCKET ? [ONLY_BUCKET] : LEGACY_BUCKETS;

  console.log(`[migrar] dry_run=${DRY_RUN} buckets=${buckets.join(', ')} → R2/${R2_BUCKET}`);

  let copied = 0;
  let skipped = 0;
  let errors = 0;

  for (const bucket of buckets) {
    console.log(`\n[migrar] Listando bucket Supabase "${bucket}"...`);
    let files = [];
    try {
      files = await listSupabaseFiles(supabase, bucket);
    } catch (err) {
      console.warn(`[migrar] Bucket "${bucket}" ignorado: ${err.message}`);
      continue;
    }
    console.log(`[migrar] ${files.length} arquivo(s) em "${bucket}"`);

    for (const file of files) {
      const key = r2ObjectKey(file.bucket, file.path);
      try {
        if (!DRY_RUN && await r2Exists(r2, key)) {
          skipped++;
          continue;
        }
        if (DRY_RUN) {
          console.log(`  [dry-run] ${key} (${file.size || '?'} bytes)`);
          copied++;
          continue;
        }
        const buf = await downloadSupabaseFile(supabase, file.bucket, file.path);
        await r2.send(new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: buf,
          ContentLength: buf.length,
        }));
        copied++;
        if (copied % 50 === 0) console.log(`  ... ${copied} copiados`);
      } catch (err) {
        errors++;
        console.error(`  ERRO ${key}: ${err.message}`);
      }
    }
  }

  console.log(`\n[migrar] Concluído: copiados=${copied} ignorados(já existiam)=${skipped} erros=${errors}`);
  if (!DRY_RUN && copied > 0) {
    console.log('[migrar] Próximo passo: rodar scripts/atualizar_urls_storage_no_banco.js (quando disponível) e configurar R2 no Render.');
  }
}

main().catch((err) => {
  console.error('[migrar] Falha fatal:', err);
  process.exit(1);
});
