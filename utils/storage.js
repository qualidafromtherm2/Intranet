// utils/storage.js — armazenamento unificado (Cloudflare R2 ou Supabase Storage)
require('dotenv').config();

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_PUBLIC_BASE_URL = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || '';

/** Buckets legados do Supabase → prefixos dentro do bucket R2 único */
const LEGACY_BUCKETS = [
  'produtos',
  'compras-anexos',
  'Funcionarios',
  'Manuais',
  'Engenharia',
  'agente-impressao',
];

function isR2Configured() {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_BASE_URL);
}

function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE);
}

function getStorageBackend() {
  if (isR2Configured()) return 'r2';
  if (isSupabaseConfigured()) return 'supabase';
  return null;
}

function assertStorageConfigured() {
  const backend = getStorageBackend();
  if (!backend) {
    console.error('[storage] Configure R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL) ou Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE).');
    process.exit(1);
  }
  return backend;
}

let _s3 = null;
function getS3Client() {
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

let _supabaseClient = null;
function getSupabaseClient() {
  if (!_supabaseClient) {
    const { createClient } = require('@supabase/supabase-js');
    _supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });
  }
  return _supabaseClient;
}

function normalizeLegacyBucket(name) {
  return String(name || 'produtos').replace(/^\/+|\/+$/g, '') || 'produtos';
}

function normalizePath(path) {
  return String(path || '').replace(/^\/+/, '');
}

/** Chave S3 no R2: {bucketLegado}/{caminho} */
function r2ObjectKey(legacyBucket, path) {
  const bucket = normalizeLegacyBucket(legacyBucket);
  const p = normalizePath(path);
  return p ? `${bucket}/${p}` : `${bucket}/`;
}

function encodePublicUrlPath(key) {
  return key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

function buildPublicUrl(legacyBucket, path) {
  if (isR2Configured()) {
    const key = r2ObjectKey(legacyBucket, path);
    return `${R2_PUBLIC_BASE_URL}/${encodePublicUrlPath(key)}`;
  }
  const sb = getSupabaseClient();
  const { data } = sb.storage.from(normalizeLegacyBucket(legacyBucket)).getPublicUrl(normalizePath(path));
  return data?.publicUrl || '';
}

async function r2Upload(legacyBucket, path, buffer, options = {}) {
  const key = r2ObjectKey(legacyBucket, path);
  const upsert = options.upsert === true;

  if (!upsert) {
    try {
      await getS3Client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
    } catch (err) {
      const notFound = err?.name === 'NotFound'
        || err?.Code === 'NotFound'
        || err?.$metadata?.httpStatusCode === 404;
      if (!notFound) return { data: null, error: err };
    }
  }

  try {
    await getS3Client().send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: options.contentType || 'application/octet-stream',
    }));
    return { data: { path: normalizePath(path), Key: key }, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

async function r2Remove(legacyBucket, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  try {
    await Promise.all(list.map(async (p) => {
      const key = r2ObjectKey(legacyBucket, p);
      await getS3Client().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    }));
    return { data: list, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

async function r2List(legacyBucket, prefix = '', options = {}) {
  const bucket = normalizeLegacyBucket(legacyBucket);
  const relPrefix = normalizePath(prefix);
  const listPrefix = relPrefix ? `${bucket}/${relPrefix}/` : `${bucket}/`;
  const limit = Math.min(Number(options.limit) || 1000, 1000);

  try {
    const resp = await getS3Client().send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: listPrefix,
      Delimiter: '/',
      MaxKeys: limit,
    }));

    const items = [];
    for (const obj of resp.Contents || []) {
      if (!obj.Key || obj.Key === listPrefix) continue;
      const name = obj.Key.slice(listPrefix.length);
      if (!name || name.includes('/')) continue;
      items.push({
        name,
        id: obj.Key,
        updated_at: obj.LastModified ? obj.LastModified.toISOString() : null,
        created_at: obj.LastModified ? obj.LastModified.toISOString() : null,
        metadata: { size: obj.Size || 0 },
      });
    }

    const sortBy = options.sortBy;
    if (sortBy?.column === 'name') {
      items.sort((a, b) => {
        const cmp = String(a.name).localeCompare(String(b.name), 'pt-BR');
        return sortBy.order === 'desc' ? -cmp : cmp;
      });
    }

    return { data: items, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

async function r2ListAllKeys(legacyBucket, prefix = '') {
  const bucket = normalizeLegacyBucket(legacyBucket);
  const relPrefix = normalizePath(prefix);
  const listPrefix = relPrefix ? `${bucket}/${relPrefix}/` : `${bucket}/`;
  const keys = [];
  let token;

  do {
    const resp = await getS3Client().send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: listPrefix,
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

function storageFrom(legacyBucket) {
  const bucketName = normalizeLegacyBucket(legacyBucket);

  return {
    upload(path, buffer, options = {}) {
      if (isR2Configured()) return r2Upload(bucketName, path, buffer, options);
      return getSupabaseClient().storage.from(bucketName).upload(normalizePath(path), buffer, options);
    },

    getPublicUrl(path) {
      if (isR2Configured()) {
        return { data: { publicUrl: buildPublicUrl(bucketName, path) } };
      }
      return getSupabaseClient().storage.from(bucketName).getPublicUrl(normalizePath(path));
    },

    remove(paths) {
      if (isR2Configured()) return r2Remove(bucketName, paths);
      return getSupabaseClient().storage.from(bucketName).remove(paths);
    },

    list(prefix, options) {
      if (isR2Configured()) return r2List(bucketName, prefix, options);
      return getSupabaseClient().storage.from(bucketName).list(prefix, options);
    },
  };
}

function createStorageFacade() {
  assertStorageConfigured();
  const backend = getStorageBackend();
  if (backend === 'r2') {
    console.log(`[storage] Backend: Cloudflare R2 (bucket=${R2_BUCKET})`);
  } else {
    console.log('[storage] Backend: Supabase Storage (legado — configure R2 para migrar)');
  }

  return {
    storage: {
      from: storageFrom,
      listBuckets: async () => {
        if (isR2Configured()) {
          return { data: LEGACY_BUCKETS.map((name) => ({ name, public: true })), error: null };
        }
        return getSupabaseClient().storage.listBuckets();
      },
      createBucket: async (name, options) => {
        if (isR2Configured()) {
          console.log(`[storage] R2: bucket lógico "${name}" (prefixo no bucket ${R2_BUCKET}) — createBucket ignorado`);
          return { data: { name }, error: null };
        }
        return getSupabaseClient().storage.createBucket(name, options);
      },
      updateBucket: async (name, options) => {
        if (isR2Configured()) return { data: { name }, error: null };
        return getSupabaseClient().storage.updateBucket(name, options);
      },
    },
  };
}

module.exports = {
  createStorageFacade,
  storageFrom,
  buildPublicUrl,
  r2ObjectKey,
  getStorageBackend,
  isR2Configured,
  isSupabaseConfigured,
  assertStorageConfigured,
  r2ListAllKeys,
  LEGACY_BUCKETS,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
};
