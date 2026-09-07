/**
 * Field-level encryption for PII / passport / NRC at rest (AES-256-GCM).
 *
 * UK/fintech-aligned pattern:
 * - Encrypt before INSERT/UPDATE; decrypt only in authorized read paths
 * - Never log plaintext ID numbers
 * - Fail closed in production when the key is missing
 *
 * Ciphertext format: enc:v1:<iv_b64url>:<tag_b64url>:<ct_b64url>
 *
 * Env:
 *   SENSITIVE_DATA_ENCRYPTION_KEY — 32-byte key as 64 hex chars, or standard/url-safe base64
 *   Alias: FIELD_ENCRYPTION_KEY
 *
 * Generate: openssl rand -hex 32
 */

'use strict';

const crypto = require('crypto');
const { isProductionRuntime } = require('./securityFlags');

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getRawKeyMaterial() {
  return String(
    process.env.SENSITIVE_DATA_ENCRYPTION_KEY
    || process.env.FIELD_ENCRYPTION_KEY
    || ''
  ).trim();
}

function isEncryptionConfigured() {
  try {
    return Boolean(resolveKeyBytes(getRawKeyMaterial()));
  } catch {
    return false;
  }
}

/**
 * Parse a 32-byte key from hex (64 chars) or base64.
 * @param {string} raw
 * @returns {Buffer|null}
 */
function resolveKeyBytes(raw) {
  if (!raw) return null;

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  // Try standard base64, then url-safe
  const candidates = [
    raw,
    raw.replace(/-/g, '+').replace(/_/g, '/'),
  ];
  for (const candidate of candidates) {
    try {
      const buf = Buffer.from(candidate, 'base64');
      if (buf.length === KEY_BYTES) return buf;
    } catch {
      // continue
    }
  }

  throw new Error(
    'SENSITIVE_DATA_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64). '
    + 'Generate with: openssl rand -hex 32'
  );
}

function getKeyOrThrow() {
  const raw = getRawKeyMaterial();
  if (!raw) {
    const err = new Error(
      'SENSITIVE_DATA_ENCRYPTION_KEY is not set. '
      + 'Passport/NRC and other sensitive fields cannot be encrypted at rest.'
    );
    err.code = 'SENSITIVE_ENCRYPTION_KEY_MISSING';
    throw err;
  }
  return resolveKeyBytes(raw);
}

function toB64Url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromB64Url(str) {
  return Buffer.from(String(str), 'base64url');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a UTF-8 string for database storage.
 * Returns plaintext unchanged only in non-production when key is unset (dev/test escape hatch).
 */
function encryptField(plaintext) {
  if (plaintext == null) return plaintext;
  const text = String(plaintext);
  if (text === '') return text;
  if (isEncrypted(text)) return text;

  let key;
  try {
    key = getKeyOrThrow();
  } catch (err) {
    if (isProductionRuntime()) throw err;
    console.warn(
      '[sensitiveDataCrypto] encryption key unset — storing plaintext (non-production only)'
    );
    return text;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${toB64Url(iv)}:${toB64Url(tag)}:${toB64Url(ciphertext)}`;
}

/**
 * Decrypt a field. Legacy plaintext rows (pre-encryption) are returned as-is.
 */
function decryptField(stored) {
  if (stored == null) return stored;
  const text = String(stored);
  if (!isEncrypted(text)) return text;

  const parts = text.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    const err = new Error('Invalid encrypted field format');
    err.code = 'SENSITIVE_DECRYPT_INVALID';
    throw err;
  }

  const [ivB64, tagB64, ctB64] = parts;
  const key = getKeyOrThrow();
  const iv = fromB64Url(ivB64);
  const tag = fromB64Url(tagB64);
  const ciphertext = fromB64Url(ctB64);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

/**
 * Decrypt for API responses — never throws into the HTTP path for corrupt legacy rows.
 */
function decryptFieldSafe(stored, { fallback = null } = {}) {
  try {
    return decryptField(stored);
  } catch (err) {
    console.warn('[sensitiveDataCrypto] decrypt failed:', err.code || err.message);
    return fallback;
  }
}

/**
 * Mask for logs / non-privileged UI (keep last 4 when long enough).
 */
function maskSensitive(value) {
  if (value == null || value === '') return '';
  let plain = String(value);
  if (isEncrypted(plain)) {
    plain = decryptFieldSafe(plain, { fallback: '****' }) || '****';
  }
  const cleaned = plain.replace(/\s+/g, '');
  if (cleaned.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, cleaned.length - 4))}${cleaned.slice(-4)}`;
}

module.exports = {
  PREFIX,
  isEncryptionConfigured,
  isEncrypted,
  encryptField,
  decryptField,
  decryptFieldSafe,
  maskSensitive,
  getRawKeyMaterial,
};
