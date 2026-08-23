const crypto = require('crypto');

/**
 * Internal placeholder stored when the user has not provided a phone number.
 * Matches auth registration synthetic phones (e + 12 hex chars).
 */
function isSyntheticPhone(phone) {
  return /^e[0-9a-f]{12}$/i.test(String(phone || '').trim());
}

function syntheticPhone(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const digest = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `e${digest}`;
}

function formatDisplayPhone(phone) {
  const value = String(phone || '').trim();
  if (!value || isSyntheticPhone(value)) return null;
  return value;
}

/**
 * Normalize user-entered phone for storage. Returns null when empty.
 */
function normalizePhoneInput(phone) {
  const trimmed = String(phone ?? '').trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]{6,20}$/.test(compact)) {
    const err = new Error('Enter a valid phone number (6–20 digits, optional + prefix)');
    err.code = 'INVALID_PHONE';
    throw err;
  }
  return compact;
}

module.exports = {
  isSyntheticPhone,
  syntheticPhone,
  formatDisplayPhone,
  normalizePhoneInput,
};
