const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const DEPOSIT_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'deposits');
const P2P_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'p2p');
const KYC_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'kyc');

fs.mkdirSync(DEPOSIT_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(P2P_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(KYC_UPLOAD_DIR, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DEPOSIT_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = resolveExtension(file);
    const name = `deposit-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const uploadDepositScreenshot = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only images (JPEG, PNG, WebP, GIF) or videos (MP4, WebM, MOV) are allowed'));
    }
    cb(null, true);
  },
});

const p2pStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, P2P_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = resolveExtension(file);
    const name = `p2p-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const uploadP2pAttachment = multer({
  storage: p2pStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Only images (JPEG, PNG, WebP, GIF) or videos (MP4, WebM, MOV) are allowed'));
    }
    cb(null, true);
  },
});

function publicUploadPath(filename) {
  return `/uploads/deposits/${filename}`;
}

function publicP2pUploadPath(filename) {
  return `/uploads/p2p/${filename}`;
}

function publicKycUploadPath(filename) {
  return `/uploads/kyc/${filename}`;
}

const kycStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KYC_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = resolveExtension(file);
    const name = `kyc-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const uploadKycDocuments = multer({
  storage: kycStorage,
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

function getProofType(mimeType) {
  if (!mimeType) return null;
  if (String(mimeType).startsWith('video/')) return 'video';
  if (String(mimeType).startsWith('image/')) return 'image';
  return null;
}

function saveP2pProofFromBase64(base64Data, { originalName = 'receipt.jpg' } = {}) {
  if (!base64Data || typeof base64Data !== 'string') {
    throw new Error('Invalid payment proof image data');
  }

  const trimmed = base64Data.trim();
  const match = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  const mime = match ? match[1] : 'image/jpeg';
  const payload = match ? match[2] : trimmed;

  if (!IMAGE_MIME.has(mime)) {
    throw new Error('Payment proof must be an image (JPEG, PNG, WebP, or GIF)');
  }

  const ext = EXT_BY_MIME[mime] || '.jpg';
  const filename = `p2p-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const fullPath = path.join(P2P_UPLOAD_DIR, filename);
  const buffer = Buffer.from(payload, 'base64');

  if (!buffer.length) {
    throw new Error('Payment proof image data is empty');
  }
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error('Payment proof image is too large (max 50 MB)');
  }

  fs.writeFileSync(fullPath, buffer);

  return {
    filename,
    proofPath: publicP2pUploadPath(filename),
    mimeType: mime,
    originalName: originalName || `receipt${ext}`,
  };
}

function saveDepositScreenshotFromBase64(base64Data, { originalName = 'receipt.jpg' } = {}) {
  if (!base64Data || typeof base64Data !== 'string') {
    throw new Error('Invalid deposit receipt image data');
  }

  const trimmed = base64Data.trim();
  const match = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  const mime = match ? match[1] : 'image/jpeg';
  const payload = match ? match[2] : trimmed;

  if (!ALLOWED_MIME.has(mime)) {
    throw new Error('Receipt must be an image (JPEG, PNG, WebP, GIF) or video (MP4, WebM, MOV)');
  }

  const ext = EXT_BY_MIME[mime] || (String(mime).startsWith('video/') ? '.mp4' : '.jpg');
  const filename = `deposit-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const fullPath = path.join(DEPOSIT_UPLOAD_DIR, filename);
  const buffer = Buffer.from(payload, 'base64');

  if (!buffer.length) {
    throw new Error('Deposit receipt image data is empty');
  }
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error('Deposit receipt is too large (max 50 MB)');
  }

  fs.writeFileSync(fullPath, buffer);

  return {
    filename,
    screenshotPath: publicUploadPath(filename),
    mimeType: mime,
    originalName: originalName || `receipt${ext}`,
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
  getProofType,
  saveP2pProofFromBase64,
  saveDepositScreenshotFromBase64,
  enrichDeposit,
};
