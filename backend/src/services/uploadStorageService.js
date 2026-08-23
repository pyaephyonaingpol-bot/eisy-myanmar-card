const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getSupabase, isSupabaseEnabled, getSupabaseConfig } = require('../lib/supabase');
const { getUploadRoot, ensureDir } = require('../paths');

const DEFAULT_BUCKET = 'uploads';
const CATEGORIES = new Set(['deposits', 'p2p', 'kyc']);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
};

function getUploadBucket() {
  return String(process.env.SUPABASE_UPLOAD_BUCKET || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
}

/**
 * Persist user uploads to Supabase Storage when configured (recommended on Vercel).
 * Set SUPABASE_UPLOAD_STORAGE=false to force local disk only.
 */
function isUploadStorageEnabled() {
  if (!isSupabaseEnabled()) return false;
  const flag = String(process.env.SUPABASE_UPLOAD_STORAGE || '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off' || flag === 'no') return false;
  return true;
}

function getSupabaseProjectUrl() {
  const { url } = getSupabaseConfig();
  return url ? String(url).replace(/\/$/, '') : '';
}

function buildPublicStorageUrl(objectPath) {
  const base = getSupabaseProjectUrl();
  const bucket = getUploadBucket();
  const encoded = String(objectPath || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}

function resolveExtension(mimeType, originalName) {
  const fromMime = EXT_BY_MIME[mimeType];
  if (fromMime) return fromMime;

  let ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.jpeg') ext = '.jpg';
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.avi'];
  if (allowed.includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;

  if (String(mimeType || '').startsWith('video/')) return '.mp4';
  return '.jpg';
}

function generateFilename(prefix, ext) {
  const safePrefix = String(prefix || 'file').replace(/[^a-z0-9_-]/gi, '');
  return `${safePrefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

async function uploadToSupabase({ category, buffer, mimeType, filename }) {
  const sb = getSupabase();
  if (!sb) {
    const err = new Error('Supabase client unavailable');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  const bucket = getUploadBucket();
  const objectPath = `${category}/${filename}`;
  const { error } = await sb.storage.from(bucket).upload(objectPath, buffer, {
    contentType: mimeType || 'application/octet-stream',
    upsert: false,
    cacheControl: '3600',
  });

  if (error) {
    const err = new Error(`Supabase Storage upload failed: ${error.message}`);
    err.code = 'SUPABASE_UPLOAD_FAILED';
    throw err;
  }

  return {
    publicUrl: buildPublicStorageUrl(objectPath),
    storagePath: objectPath,
    storage: 'supabase',
    filename,
  };
}

function saveToLocalDisk({ category, buffer, filename }) {
  const root = getUploadRoot();
  const dir = path.join(root, category);
  ensureDir(dir);
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buffer);
  const publicUrl = `/uploads/${category}/${filename}`;
  return {
    publicUrl,
    storagePath: publicUrl,
    storage: 'local',
    filename,
  };
}

async function persistBuffer({
  category,
  buffer,
  mimeType,
  originalName,
  prefix,
} = {}) {
  if (!CATEGORIES.has(category)) {
    throw new Error(`Invalid upload category: ${category}`);
  }
  if (!buffer || !buffer.length) {
    throw new Error('Upload buffer is empty');
  }

  const ext = resolveExtension(mimeType, originalName);
  const filename = generateFilename(prefix || category.replace(/s$/, ''), ext);

  if (isUploadStorageEnabled()) {
    try {
      return await uploadToSupabase({ category, buffer, mimeType, filename });
    } catch (err) {
      console.warn('[upload-storage] Supabase upload failed, falling back to local disk:', err.message);
    }
  }

  return saveToLocalDisk({ category, buffer, filename });
}

async function persistMulterFile(file, category, { prefix } = {}) {
  if (!file) return null;

  const buffer = file.buffer || (file.path ? fs.readFileSync(file.path) : null);
  if (!buffer?.length) {
    throw new Error('Upload file is empty');
  }

  const result = await persistBuffer({
    category,
    buffer,
    mimeType: file.mimetype,
    originalName: file.originalname,
    prefix,
  });

  if (file.path) {
    fs.unlink(file.path, () => {});
  }

  return result;
}

function parseBase64Payload(base64Data) {
  const trimmed = String(base64Data || '').trim();
  const match = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  return {
    mime: match ? match[1] : 'image/jpeg',
    payload: match ? match[2] : trimmed,
  };
}

module.exports = {
  DEFAULT_BUCKET,
  CATEGORIES,
  getUploadBucket,
  isUploadStorageEnabled,
  buildPublicStorageUrl,
  resolveExtension,
  persistBuffer,
  persistMulterFile,
  parseBase64Payload,
};
