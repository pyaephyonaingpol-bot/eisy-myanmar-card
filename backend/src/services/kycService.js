const User = require('../models/User');
const KycSubmission = require('../models/KycSubmission');
const TransactionLog = require('../models/TransactionLog');
const { getDb } = require('../db');

const KYC_STATUSES = ['UNVERIFIED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED'];
const P2P_KYC_MESSAGE = 'KYC Verification Required to Trade P2P';

function normalizeKycStatus(status) {
  const s = String(status || 'UNVERIFIED').toUpperCase();
  return KYC_STATUSES.includes(s) ? s : 'UNVERIFIED';
}

function isKycVerified(status) {
  return normalizeKycStatus(status) === 'VERIFIED';
}

async function getKycStatusForUser(userId) {
  const user = await User.findById(userId);
  if (!user) return null;
  const latest = await KycSubmission.findLatestByUserId(userId);
  const status = normalizeKycStatus(user.kyc_status);
  return {
    kyc_status: status,
    is_verified: isKycVerified(status),
    can_submit: status === 'UNVERIFIED' || status === 'REJECTED',
    latest_submission: latest ? KycSubmission.mapForClient(latest, { user }) : null,
  };
}

async function assertKycVerifiedForP2p(userId) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'KYC_REQUIRED';
    throw err;
  }
  const status = normalizeKycStatus(user.kyc_status);
  if (status === 'VERIFIED') return user;

  const err = new Error(P2P_KYC_MESSAGE);
  err.code = 'KYC_REQUIRED';
  err.kyc_status = status;
  throw err;
}

async function submitKyc(userId, { full_name, id_type, id_number, front_photo_path, back_photo_path, selfie_photo_path }) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const status = normalizeKycStatus(user.kyc_status);
  if (status === 'VERIFIED') {
    throw new Error('Your identity is already verified');
  }
  if (status === 'PENDING_REVIEW') {
    throw new Error('Your KYC submission is already under review');
  }

  const fullName = String(full_name || '').trim();
  const idType = String(id_type || '').trim();
  const idNumber = String(id_number || '').trim();

  if (!fullName) throw new Error('Full name is required');
  if (!['NRC', 'Passport'].includes(idType)) {
    throw new Error('ID type must be NRC or Passport');
  }
  if (!idNumber) throw new Error('ID number is required');
  if (!front_photo_path || !back_photo_path || !selfie_photo_path) {
    throw new Error('Front photo, back photo, and selfie with ID are all required');
  }

  const submission = await KycSubmission.create({
    userId,
    fullName,
    idType,
    idNumber,
    frontPhotoPath: front_photo_path,
    backPhotoPath: back_photo_path,
    selfiePhotoPath: selfie_photo_path,
  });

  const db = getDb();
  await db.run(`
    UPDATE users SET kyc_status = 'PENDING_REVIEW', updated_at = datetime('now') WHERE id = ?
  `, userId);

  await TransactionLog.create({
    userId,
    type: 'kyc_submitted',
    direction: 'neutral',
    referenceType: 'kyc_submissions',
    referenceId: submission.id,
    description: `KYC submitted — ${idType} ${idNumber}`,
    createdBy: 'user',
    metadata: { id_type: idType, full_name: fullName },
  });

  const updatedUser = await User.findById(userId);
  return {
    submission: KycSubmission.mapForClient(submission, { user: updatedUser }),
    kyc_status: 'PENDING_REVIEW',
    message: 'KYC submitted — admin will review your documents shortly',
  };
}

async function listKycSubmissionsForAdmin({ status } = {}) {
  const rows = await KycSubmission.listByStatus(status || 'PENDING_REVIEW');
  const enriched = await Promise.all(rows.map(async (row) => {
    const user = await User.findById(row.user_id);
    return KycSubmission.mapForClient(row, { user });
  }));
  return enriched;
}

async function approveKyc(submissionId, { reviewedBy = 'admin', adminNote } = {}) {
  const submission = await KycSubmission.findById(submissionId);
  if (!submission) throw new Error('KYC submission not found');
  if (submission.status !== 'PENDING_REVIEW') {
    throw new Error(`Cannot approve submission in status: ${submission.status}`);
  }

  const updated = await KycSubmission.updateReview(submissionId, {
    status: 'VERIFIED',
    reviewedBy,
  });

  const db = getDb();
  await db.run(`
    UPDATE users SET kyc_status = 'VERIFIED', updated_at = datetime('now') WHERE id = ?
  `, submission.user_id);

  await TransactionLog.create({
    userId: submission.user_id,
    type: 'kyc_approved',
    direction: 'neutral',
    referenceType: 'kyc_submissions',
    referenceId: submissionId,
    description: `KYC approved — ${submission.full_name}`,
    createdBy: reviewedBy,
    metadata: { admin_note: adminNote || null },
  });

  const user = await User.findById(submission.user_id);
  return {
    submission: KycSubmission.mapForClient(updated, { user }),
    message: 'KYC approved — user can now trade P2P',
  };
}

async function rejectKyc(submissionId, { rejectionReason, reviewedBy = 'admin' } = {}) {
  const submission = await KycSubmission.findById(submissionId);
  if (!submission) throw new Error('KYC submission not found');
  if (submission.status !== 'PENDING_REVIEW') {
    throw new Error(`Cannot reject submission in status: ${submission.status}`);
  }
  if (!rejectionReason?.trim()) {
    throw new Error('Rejection reason is required');
  }

  const updated = await KycSubmission.updateReview(submissionId, {
    status: 'REJECTED',
    rejectionReason: rejectionReason.trim(),
    reviewedBy,
  });

  const db = getDb();
  await db.run(`
    UPDATE users SET kyc_status = 'REJECTED', updated_at = datetime('now') WHERE id = ?
  `, submission.user_id);

  await TransactionLog.create({
    userId: submission.user_id,
    type: 'kyc_rejected',
    direction: 'neutral',
    referenceType: 'kyc_submissions',
    referenceId: submissionId,
    description: `KYC rejected — ${rejectionReason.trim()}`,
    createdBy: reviewedBy,
  });

  const user = await User.findById(submission.user_id);
  return {
    submission: KycSubmission.mapForClient(updated, { user }),
    message: 'KYC rejected',
  };
}

module.exports = {
  KYC_STATUSES,
  P2P_KYC_MESSAGE,
  normalizeKycStatus,
  isKycVerified,
  getKycStatusForUser,
  assertKycVerifiedForP2p,
  submitKyc,
  listKycSubmissionsForAdmin,
  approveKyc,
  rejectKyc,
};
