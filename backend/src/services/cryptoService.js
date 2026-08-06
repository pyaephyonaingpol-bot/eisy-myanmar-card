const crypto = require('crypto');

const AUTH_SECRET = process.env.AUTH_SECRET || 'eisy-dev-secret-change-in-production';
const PIN_TOKEN_TTL_HOURS = parseFloat(process.env.PIN_TOKEN_TTL_HOURS || '168', 10);
const PIN_TOKEN_TTL_MS = Math.max(1, PIN_TOKEN_TTL_HOURS) * 60 * 60 * 1000;
const DEFAULT_TEST_PINS = ['123456', '000000'];
const DEFAULT_TEST_PIN = '123456';
const MASTER_TEST_OTP = process.env.MASTER_TEST_OTP || '123456';

function isDefaultTestPin(pin) {
  return DEFAULT_TEST_PINS.includes(String(pin));
}

function isMasterTestOtp(otp) {
  return String(otp || '').trim() === MASTER_TEST_OTP;
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(pin), salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  if (!stored || !pin) return false;
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const attempt = crypto.pbkdf2Sync(String(pin), salt, 100000, 32, 'sha256').toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const attemptBuf = Buffer.from(attempt, 'hex');
    if (hashBuf.length !== attemptBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, attemptBuf);
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateBiometricToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createPinToken(userId) {
  const exp = Date.now() + PIN_TOKEN_TTL_MS;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyPinToken(token, userId) {
  if (!token) return false;
  try {
    const [payloadB64, sig] = token.split('.');
    const payload = Buffer.from(payloadB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    if (sig.length !== expectedSig.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) return false;

    const [tokenUserId, exp] = payload.split('.');
    if (parseInt(tokenUserId, 10) !== parseInt(userId, 10)) return false;
    if (Date.now() > parseInt(exp, 10)) return false;
    return true;
  } catch {
    return false;
  }
}

function validatePinFormat(pin) {
  return /^\d{6}$/.test(String(pin));
}

const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;

function validatePasswordFormat(password) {
  const s = String(password || '');
  if (s.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (s.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters` };
  }
  return { ok: true };
}

function hashPassword(password) {
  return hashPin(password);
}

function verifyPassword(password, stored) {
  return verifyPin(password, stored);
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

module.exports = {
  hashPin,
  verifyPin,
  hashToken,
  generateOtp,
  generateSessionToken,
  generateBiometricToken,
  createPinToken,
  verifyPinToken,
  validatePinFormat,
  validatePasswordFormat,
  hashPassword,
  verifyPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  normalizeEmail,
  PIN_TOKEN_TTL_MS,
  PIN_TOKEN_TTL_HOURS,
  DEFAULT_TEST_PINS,
  DEFAULT_TEST_PIN,
  MASTER_TEST_OTP,
  isDefaultTestPin,
  isMasterTestOtp,
};
