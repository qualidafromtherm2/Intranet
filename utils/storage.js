// utils/storage.js — Cloudflare R2 (armazenamento de arquivos)
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

function assertStorageConfigured() {
  if (!isR2Configured()) {
    console.error('[storage] Configure R2: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL');
    process.exit(1);
  }
  return 'r2';
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

function normalizeLegacyBucket(name) {
  return String(name || 'produtos').replace(/^\/+|\/+$/g, '') || 'produtos';
}

function normalizePath(path) {
  return String(path || '').replace(/^\/+/, '');
}

function r2ObjectKey(legacyBucket, path) {
  const bucket = normalizeLegacyBucket(legacyBucket);
  const p = normalizePath(path);
  return p ? `${bucket}/${p}` : `${bucket}/`;
}

function encodePublicUrlPath(key) {
  return key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

function buildPublicUrl(legacyBucket, path) {
  const key = r2ObjectKey(legacyBucket, path);
  return `${R2_PUBLIC_BASE_URL}/${encodePublicUrlPath(key)}`;
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
      return r2Upload(bucketName, path, buffer, options);
    },
    getPublicUrl(path) {
      return { data: { publicUrl: buildPublicUrl(bucketName, path) } };
    },
    remove(paths) {
      return r2Remove(bucketName, paths);
    },
    list(prefix, options) {
      return r2List(bucketName, prefix, options);
    },
  };
}

async function uploadPublicFile(legacyBucket, filePath, buffer, { contentType, upsert = false } = {}) {
  const ref = storageFrom(legacyBucket);
  const { error } = await ref.upload(filePath, buffer, { contentType, upsert });
  if (error) {
    const err = new Error(error.message || String(error));
    err.storageError = error;
    throw err;
  }
  const { data } = ref.getPublicUrl(filePath);
  return { path: filePath, url: data.publicUrl };
}

async function removePublicFiles(legacyBucket, paths) {
  const { error } = await storageFrom(legacyBucket).remove(paths);
  if (error) throw new Error(error.message || String(error));
}

function createStorageFacade() {
  assertStorageConfigured();
  console.log(`[storage] Backend: Cloudflare R2 (bucket=${R2_BUCKET})`);

  return {
    storage: {
      from: storageFrom,
      listBuckets: async () => ({
        data: LEGACY_BUCKETS.map((name) => ({ name, public: true })),
        error: null,
      }),
      createBucket: async (name) => {
        console.log(`[storage] R2: prefixo lógico "${name}" em ${R2_BUCKET}`);
        return { data: { name }, error: null };
      },
      updateBucket: async (name) => ({ data: { name }, error: null }),
    },
  };
}

module.exports = {
  createStorageFacade,
  storageFrom,
  buildPublicUrl,
  uploadPublicFile,
  removePublicFiles,
  r2ObjectKey,
  isR2Configured,
  assertStorageConfigured,
  r2ListAllKeys,
  LEGACY_BUCKETS,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
};
