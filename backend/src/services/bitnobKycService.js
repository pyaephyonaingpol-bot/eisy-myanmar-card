/**
 * Bitnob Card KYC — maps platform KYC submissions to Bitnob POST /api/cards/kyc
 * and persists customer_id for Standard Card issuance.
 *
 * Flow:
 *   1. User submits platform KYC (docs + identity profile)
 *   2. Admin approves → submitBitnobCardKycForUser
 *   3. Bitnob returns customer_id (+ pending/approved)
 *   4. Webhook virtualcard.user.kyc.complete → mark approved / ready
 *   5. Standard Card issue uses users.bitnob_customer_id
 */

'use strict';

const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const KycSubmission = require('../models/KycSubmission');
const { getDb } = require('../db');
const { getUploadRoot } = require('../paths');
const { decryptFieldSafe } = require('./sensitiveDataCrypto');
const bitnob = require(path.join(__dirname, '../../../lib/bitnob'));

const TERMINAL_APPROVED = new Set(['approved']);
const TERMINAL_REJECTED = new Set(['rejected', 'failed', 'denied']);

function mapPlatformIdType(idType) {
  const raw = String(idType || '').trim().toUpperCase();
  if (raw === 'PASSPORT') return 'passport';
  // Myanmar NRC → Bitnob national_id document type
  if (raw === 'NRC' || raw === 'NATIONAL_ID' || raw === 'NATIONAL ID') return 'national_id';
  const lower = String(idType || '').trim().toLowerCase();
  const allowed = new Set([
    'passport',
    'national_id',
    'drivers_license',
    'voters_card',
    'ghana_card',
    'vnin',
    'nin',
    'bvn',
  ]);
  if (allowed.has(lower)) return lower;
  return 'national_id';
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: 'User', last_name: 'Verified' };
  if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(' '),
  };
}

function kycWebhookUrl() {
  return String(
    process.env.BITNOB_KYC_WEBHOOK_URL
    || process.env.BITNOB_CARD_WEBHOOK_URL
    || process.env.BITNOB_WEBHOOK_URL
    || ''
  ).trim() || null;
}

async function readUploadAsBase64(publicOrRelativePath) {
  const raw = String(publicOrRelativePath || '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    const res = await fetch(raw);
    if (!res.ok) {
      const err = new Error(`Failed to fetch KYC photo (${res.status})`);
      err.code = 'KYC_PHOTO_FETCH_FAILED';
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return buf.toString('base64');
  }

  let rel = raw;
  if (rel.startsWith('/uploads/')) rel = rel.slice('/uploads/'.length);
  else if (rel.startsWith('uploads/')) rel = rel.slice('uploads/'.length);

  const full = path.join(getUploadRoot(), rel);
  if (!fs.existsSync(full)) {
    const err = new Error(`KYC photo missing on disk: ${rel}`);
    err.code = 'KYC_PHOTO_MISSING';
    throw err;
  }
  const buf = fs.readFileSync(full);
  return buf.toString('base64');
}

async function persistUserBitnobKyc(userId, {
  customerId,
  status,
  reason = null,
  completionLink = null,
} = {}) {
  const db = getDb();
  const normalized = String(status || '').trim().toLowerCase() || null;
  await db.run(
    `UPDATE users SET
      bitnob_customer_id = COALESCE(?, bitnob_customer_id),
      bitnob_kyc_status = COALESCE(?, bitnob_kyc_status),
      bitnob_kyc_reason = ?,
      bitnob_kyc_completion_link = ?,
      bitnob_kyc_submitted_at = COALESCE(bitnob_kyc_submitted_at, datetime('now')),
      updated_at = datetime('now')
     WHERE id = ?`,
    customerId ? String(customerId).trim() : null,
    normalized,
    reason || null,
    completionLink || null,
    userId
  );
}

async function persistSubmissionBitnobKyc(submissionId, { customerId, status } = {}) {
  if (!submissionId) return;
  const db = getDb();
  await db.run(
    `UPDATE kyc_submissions SET
      bitnob_customer_id = COALESCE(?, bitnob_customer_id),
      bitnob_kyc_status = COALESCE(?, bitnob_kyc_status),
      updated_at = datetime('now')
     WHERE id = ?`,
    customerId ? String(customerId).trim() : null,
    status ? String(status).trim().toLowerCase() : null,
    submissionId
  );
}

/**
 * Submit (or re-submit) Bitnob Card KYC for a platform-verified user.
 */
async function submitBitnobCardKycForUser(userId, { submissionId = null, force = false } = {}) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const existingStatus = String(user.bitnob_kyc_status || '').toLowerCase();
  if (!force && user.bitnob_customer_id && TERMINAL_APPROVED.has(existingStatus)) {
    return {
      already_ready: true,
      customer_id: user.bitnob_customer_id,
      normalized_status: existingStatus,
      message: 'Bitnob Card KYC already approved',
    };
  }

  const submission = submissionId
    ? await KycSubmission.findById(submissionId)
    : await KycSubmission.findLatestByUserId(userId);
  if (!submission) {
    const err = new Error('No KYC submission found to send to Bitnob');
    err.code = 'KYC_SUBMISSION_REQUIRED';
    throw err;
  }

  const fullName = decryptFieldSafe(submission.full_name, { fallback: user.name || 'User' });
  const idNumber = decryptFieldSafe(submission.id_number, { fallback: '' });
  const { first_name, last_name } = splitFullName(fullName);
  const bitnobIdType = mapPlatformIdType(submission.id_type);

  const dob = String(
    submission.date_of_birth
    || process.env.BITNOB_KYC_DEFAULT_DOB
    || ''
  ).trim();
  if (!dob) {
    const err = new Error('Date of birth is required for Bitnob Card KYC (YYYY-MM-DD)');
    err.code = 'BITNOB_KYC_DOB_REQUIRED';
    throw err;
  }

  const line1 = String(submission.address_line1 || process.env.BITNOB_KYC_DEFAULT_LINE1 || '').trim();
  const city = String(submission.address_city || process.env.BITNOB_KYC_DEFAULT_CITY || '').trim();
  const state = String(submission.address_state || process.env.BITNOB_KYC_DEFAULT_STATE || '').trim();
  const postal = String(submission.address_postal || process.env.BITNOB_KYC_DEFAULT_POSTAL || '').trim();
  const country = String(
    submission.address_country || process.env.BITNOB_KYC_DEFAULT_COUNTRY || 'MMR'
  ).trim().toUpperCase();

  if (!line1 || !city || !state || !postal) {
    const err = new Error(
      'Address (line1, city, state, postal code) is required for Bitnob Card KYC'
    );
    err.code = 'BITNOB_KYC_ADDRESS_REQUIRED';
    throw err;
  }

  let idFrontImage = null;
  if (!['bvn', 'nin'].includes(bitnobIdType)) {
    idFrontImage = await readUploadAsBase64(submission.front_photo_path);
    if (!idFrontImage) {
      const err = new Error('Front ID photo is required for Bitnob Card KYC');
      err.code = 'BITNOB_KYC_IMAGE_REQUIRED';
      throw err;
    }
  }

  const email = String(user.email || '').trim().toLowerCase();
  if (!email) {
    const err = new Error('User email is required for Bitnob Card KYC');
    err.code = 'BITNOB_KYC_EMAIL_REQUIRED';
    throw err;
  }

  const phoneRaw = String(user.phone || user.phone_display || '').trim();
  let phone_number;
  let dial_code;
  if (phoneRaw) {
    const digits = phoneRaw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+95')) {
      dial_code = '+95';
      phone_number = digits.slice(3);
    } else if (digits.startsWith('95') && digits.length > 8) {
      dial_code = '+95';
      phone_number = digits.slice(2);
    } else {
      phone_number = digits.replace(/^\+/, '');
      dial_code = process.env.BITNOB_KYC_DEFAULT_DIAL_CODE || '+95';
    }
  }

  const result = await bitnob.submitCardKyc({
    customer: {
      customer_type: 'individual',
      first_name,
      last_name,
      email,
      date_of_birth: dob,
      id_type: bitnobIdType,
      id_number: idNumber,
      phone_number,
      dial_code,
      line1,
      line2: submission.address_line2 || undefined,
      city,
      state,
      postal_code: postal,
      country,
    },
    occupation: submission.occupation || process.env.BITNOB_KYC_DEFAULT_OCCUPATION || 'other',
    employment_status:
      submission.employment_status || process.env.BITNOB_KYC_DEFAULT_EMPLOYMENT || 'employed',
    account_purpose:
      submission.account_purpose || process.env.BITNOB_KYC_DEFAULT_PURPOSE || 'payments',
    annual_salary: submission.annual_salary || process.env.BITNOB_KYC_DEFAULT_SALARY || '12000',
    expected_monthly_volume:
      submission.expected_monthly_volume || process.env.BITNOB_KYC_DEFAULT_VOLUME || '500',
    terms_of_service_accepted: true,
    webhook_url: kycWebhookUrl(),
    id_front_image: idFrontImage,
  });

  const customerId = result.customer_id || user.bitnob_customer_id || null;
  const status = result.normalized_status || 'initiated';

  await persistUserBitnobKyc(userId, {
    customerId,
    status,
    reason: null,
    completionLink: result.completion_link || null,
  });
  await persistSubmissionBitnobKyc(submission.id, { customerId, status });

  return {
    already_ready: TERMINAL_APPROVED.has(status),
    customer_id: customerId,
    normalized_status: status,
    completion_link: result.completion_link || null,
    message: TERMINAL_APPROVED.has(status)
      ? 'Bitnob Card KYC approved — Standard Cards can be issued'
      : 'Bitnob Card KYC submitted — waiting for verification webhook',
    raw: result.raw,
  };
}

/**
 * Apply Bitnob Card KYC webhook payloads.
 * Events: virtualcard.user.kyc.pending|complete|failed
 */
async function applyBitnobKycWebhook(payload = {}) {
  const event = String(
    payload.event || payload.type || payload.name || payload.eventName || ''
  ).trim().toLowerCase();
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;

  const customerId = String(
    data.customerId
    || data.customer_id
    || data.id
    || payload.customerId
    || payload.customer_id
    || ''
  ).trim() || null;
  const email = String(
    data.customerEmail || data.customer_email || data.email || payload.customerEmail || ''
  ).trim().toLowerCase() || null;

  let status = 'pending';
  if (event.includes('complete') || data.kycPassed === true) status = 'approved';
  else if (event.includes('failed') || data.kycPassed === false) status = 'rejected';
  else if (event.includes('pending')) status = 'pending';

  const reason = data.reason
    || (Array.isArray(data.rejectionDetails) && data.rejectionDetails[0]?.message)
    || null;

  const db = getDb();
  let user = null;
  if (customerId) {
    user = await db.get(
      'SELECT * FROM users WHERE bitnob_customer_id = ? LIMIT 1',
      customerId
    );
  }
  if (!user && email) {
    user = await db.get(
      'SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      email
    );
  }
  if (!user) {
    return { matched: false, customer_id: customerId, email, status, event };
  }

  await persistUserBitnobKyc(user.id, {
    customerId: customerId || user.bitnob_customer_id,
    status,
    reason,
    completionLink: data.completion_link || data.completionLink || null,
  });

  const latest = await KycSubmission.findLatestByUserId(user.id);
  if (latest) {
    await persistSubmissionBitnobKyc(latest.id, {
      customerId: customerId || user.bitnob_customer_id,
      status,
    });
  }

  return {
    matched: true,
    user_id: user.id,
    customer_id: customerId || user.bitnob_customer_id || null,
    status,
    event,
    ready: TERMINAL_APPROVED.has(status),
  };
}

function getBitnobKycPublicStatus(user) {
  if (!user) {
    return {
      customer_id: null,
      customer_ready: false,
      bitnob_kyc_status: null,
      bitnob_kyc_reason: null,
      bitnob_kyc_completion_link: null,
      can_issue_standard_card: false,
    };
  }
  const status = String(user.bitnob_kyc_status || '').toLowerCase() || null;
  const customerId = String(user.bitnob_customer_id || '').trim() || null;
  // Sandbox shared customer still unlocks issue when env is set.
  const envCustomer = String(process.env.BITNOB_DEFAULT_CUSTOMER_ID || '').trim() || null;
  const effectiveCustomer = customerId || envCustomer;
  const approved = Boolean(customerId && TERMINAL_APPROVED.has(status))
    || Boolean(envCustomer && !customerId);
  return {
    customer_id: effectiveCustomer,
    customer_ready: approved || Boolean(effectiveCustomer && (!status || TERMINAL_APPROVED.has(status))),
    bitnob_kyc_status: status,
    bitnob_kyc_reason: user.bitnob_kyc_reason || null,
    bitnob_kyc_completion_link: user.bitnob_kyc_completion_link || null,
    can_issue_standard_card: Boolean(effectiveCustomer)
      && (approved || Boolean(envCustomer)),
  };
}

module.exports = {
  mapPlatformIdType,
  splitFullName,
  submitBitnobCardKycForUser,
  applyBitnobKycWebhook,
  getBitnobKycPublicStatus,
  persistUserBitnobKyc,
  readUploadAsBase64,
  TERMINAL_APPROVED,
  TERMINAL_REJECTED,
};
