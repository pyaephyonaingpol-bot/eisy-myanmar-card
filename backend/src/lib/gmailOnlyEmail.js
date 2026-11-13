'use strict';

/**
 * Email OTP signup/login is Gmail-only — block temp/external providers
 * (yahoo, mailinator, fldubai, etc.).
 */

const GMAIL_ONLY_OTP_MESSAGE =
  'Gmail accounts only. Other email providers are not allowed for OTP.';

const GMAIL_ONLY_OTP_CODE = 'GMAIL_ONLY_REQUIRED';

function normalizeEmailLoose(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * @returns {string} normalized email when allowed
 * @throws {Error} with code GMAIL_ONLY_REQUIRED when domain is not gmail.com
 */
function assertGmailOnlyForOtp(email) {
  const normalized = normalizeEmailLoose(email);
  if (!normalized || !normalized.includes('@')) {
    const err = new Error('Email is required');
    err.code = 'EMAIL_REQUIRED';
    throw err;
  }
  if (!normalized.endsWith('@gmail.com')) {
    const err = new Error(GMAIL_ONLY_OTP_MESSAGE);
    err.code = GMAIL_ONLY_OTP_CODE;
    throw err;
  }
  return normalized;
}

function isGmailAddress(email) {
  const normalized = normalizeEmailLoose(email);
  return Boolean(normalized) && normalized.endsWith('@gmail.com');
}

module.exports = {
  GMAIL_ONLY_OTP_MESSAGE,
  GMAIL_ONLY_OTP_CODE,
  assertGmailOnlyForOtp,
  isGmailAddress,
};
