const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getUploadRoot } = require('../paths');
const {
  isUploadStorageEnabled,
  persistBuffer,
  persistMulterFile,
  parseBase64Payload,
} = require('../services/uploadStorageService');

const UPLOAD_ROOT = getUploadRoot();
const DEPOSIT_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'deposits');
const P2P_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'p2p');
const KYC_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'kyc');

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']);
const ALLOWED_MIME = new Set([...IMAGE_MIME, ...VIDEO_MIME]);

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

const EXT_ALIASES = {
  '.jpeg': '.jpg',
  '.mpeg': '.mp4',
};

function resolveExtension(file) {
  const fromMime = EXT_BY_MIME[file.mimetype];
  if (fromMime) return fromMime;

  let ext = path.extname(file.originalname || '').toLowerCase();
  if (EXT_ALIASES[ext]) ext = EXT_ALIASES[ext];

  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.avi'];
  if (allowed.includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;

  return IMAGE_MIME.has(file.mimetype) ? '.jpg' : '.mp4';
}

function createDiskStorage(categoryDir, prefix) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, categoryDir),
    filename: (_req, file, cb) => {
      const ext = resolveExtension(file);
      const name = `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      cb(null, name);
    },
  });
}

function createCategoryStorage(categoryDir, prefix) {
  if (isUploadStorageEnabled()) {
    return multer.memoryStorage();
  }
  return createDiskStorage(categoryDir, prefix);
}

const uploadDepositScreenshot = multer({
  storage: createCategoryStorage(DEPOSIT_UPLOAD_DIR, 'deposit'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only images (JPEG, PNG, WebP, GIF) or videos (MP4, WebM, MOV) are allowed'));
    }
    cb(null, true);
  },
});

const uploadP2pAttachment = multer({
  storage: createCategoryStorage(P2P_UPLOAD_DIR, 'p2p'),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only images (JPEG, PNG, WebP, GIF) or videos (MP4, WebM, MOV) are allowed'));
    }
    cb(null, true);
  },
});

const uploadKycDocuments = multer({
  storage: createCategoryStorage(KYC_UPLOAD_DIR, 'kyc'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error('KYC documents must be images (JPEG, PNG, WebP, GIF)'));
    }
    cb(null, true);
  },
});

const uploadKycFields = uploadKycDocuments.fields([
  { name: 'front_photo', maxCount: 1 },
  { name: 'back_photo', maxCount: 1 },
  { name: 'selfie_photo', maxCount: 1 },
]);

function publicUploadPath(filename) {
  return `/uploads/deposits/${filename}`;
}

function publicP2pUploadPath(filename) {
  return `/uploads/p2p/${filename}`;
}

function publicKycUploadPath(filename) {
  return `/uploads/kyc/${filename}`;
}

async function persistDepositUpload(file) {
  const result = await persistMulterFile(file, 'deposits', { prefix: 'deposit' });
  return result?.publicUrl || null;
}

async function persistP2pUpload(file) {
  const result = await persistMulterFile(file, 'p2p', { prefix: 'p2p' });
  return result?.publicUrl || null;
}

async function persistKycUpload(file) {
  const result = await persistMulterFile(file, 'kyc', { prefix: 'kyc' });
  return result?.publicUrl || null;
}

function getProofType(mimeType) {
  if (!mimeType) return null;
  if (String(mimeType).startsWith('video/')) return 'video';
  if (String(mimeType).startsWith('image/')) return 'image';
  return null;
}

async function saveP2pProofFromBase64(base64Data, { originalName = 'receipt.jpg' } = {}) {
  if (!base64Data || typeof base64Data !== 'string') {
    throw new Error('Invalid payment proof image data');
  }

  const { mime, payload } = parseBase64Payload(base64Data);
  if (!IMAGE_MIME.has(mime)) {
    throw new Error('Payment proof must be an image (JPEG, PNG, WebP, or GIF)');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) {
    throw new Error('Payment proof image data is empty');
  }
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error('Payment proof image is too large (max 50 MB)');
  }

  const saved = await persistBuffer({
    category: 'p2p',
    buffer,
    mimeType: mime,
    originalName,
    prefix: 'p2p',
  });

  return {
    filename: saved.filename,
    proofPath: saved.publicUrl,
    mimeType: mime,
    originalName: originalName || `receipt${path.extname(saved.filename) || '.jpg'}`,
    storage: saved.storage,
  };
}

async function saveDepositScreenshotFromBase64(base64Data, { originalName = 'receipt.jpg' } = {}) {
  if (!base64Data || typeof base64Data !== 'string') {
    throw new Error('Invalid deposit receipt image data');
  }

  const { mime, payload } = parseBase64Payload(base64Data);
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error('Receipt must be an image (JPEG, PNG, WebP, GIF) or video (MP4, WebM, MOV)');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length) {
    throw new Error('Deposit receipt image data is empty');
  }
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error('Deposit receipt is too large (max 50 MB)');
  }

  const saved = await persistBuffer({
    category: 'deposits',
    buffer,
    mimeType: mime,
    originalName,
    prefix: 'deposit',
  });

  return {
    filename: saved.filename,
    screenshotPath: saved.publicUrl,
    mimeType: mime,
    originalName: originalName || `receipt${path.extname(saved.filename) || '.jpg'}`,
    storage: saved.storage,
  };
}

const { enrichDeposit } = require('../services/depositEnrichment');

module.exports = {
  uploadDepositScreenshot,
  uploadP2pAttachment,
  uploadKycFields,
  DEPOSIT_UPLOAD_DIR,
  P2P_UPLOAD_DIR,
  KYC_UPLOAD_DIR,
  UPLOAD_ROOT,
  publicUploadPath,
  publicP2pUploadPath,
  publicKycUploadPath,
  persistDepositUpload,
  persistP2pUpload,
  persistKycUpload,
  getProofType,
  saveP2pProofFromBase64,
  saveDepositScreenshotFromBase64,
  enrichDeposit,
};
