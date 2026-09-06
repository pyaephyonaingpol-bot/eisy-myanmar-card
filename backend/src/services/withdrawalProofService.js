/**
 * Persist payout proof slips and email them to users (Resend) when bank withdrawals complete.
 */
const path = require('path');
const fs = require('fs');
const { getUploadRoot } = require('../paths');
const { joinPublicUrl, getPublicBaseUrl } = require('../lib/publicUrl');
const {
  persistWithdrawalUpload,
  saveWithdrawalProofFromBase64,
} = require('../middleware/upload');
const { sendWithdrawalProofEmail } = require('./emailService');
const User = require('../models/User');

function absoluteProofUrl(publicOrAbsoluteUrl) {
  const raw = String(publicOrAbsoluteUrl || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return joinPublicUrl(raw) || raw;
}

async function persistProofFromRequest({ file, proofBase64, proofOriginalName } = {}) {
  if (file) {
    const saved = await persistWithdrawalUpload(file);
    if (!saved?.publicUrl) {
      throw new Error('Failed to store payment proof');
    }
    return {
      proofPath: saved.publicUrl,
      proofUrl: absoluteProofUrl(saved.publicUrl),
      proofMimeType: saved.mimeType || file.mimetype || null,
      proofOriginalName: saved.originalName || file.originalname || 'payout-slip.jpg',
      buffer: file.buffer || (file.path ? fs.readFileSync(file.path) : null),
    };
  }

  if (proofBase64) {
    const saved = await saveWithdrawalProofFromBase64(proofBase64, {
      originalName: proofOriginalName || 'payout-slip.jpg',
    });
    return {
      proofPath: saved.proofPath,
      proofUrl: absoluteProofUrl(saved.proofUrl || saved.proofPath),
      proofMimeType: saved.mimeType || null,
      proofOriginalName: saved.originalName || 'payout-slip.jpg',
      buffer: null,
    };
  }

  return null;
}

function proofUpdateFields(proof, adminId) {
  if (!proof) return {};
  return {
    proofPath: proof.proofPath || null,
    proofUrl: proof.proofUrl || proof.proofPath || null,
    proofMimeType: proof.proofMimeType || null,
    proofOriginalName: proof.proofOriginalName || null,
    proofUploadedAt: new Date().toISOString(),
    proofUploadedBy: adminId || null,
  };
}

async function loadProofBuffer(proof) {
  if (proof?.buffer && Buffer.isBuffer(proof.buffer) && proof.buffer.length) {
    return proof.buffer;
  }

  const candidate = String(proof?.proofPath || proof?.proofUrl || '').trim();
  if (!candidate) return null;

  if (candidate.startsWith('/uploads/')) {
    const full = path.join(getUploadRoot(), candidate.replace(/^\/uploads\/?/, ''));
    if (fs.existsSync(full)) {
      return fs.readFileSync(full);
    }
  }

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.warn('[withdrawal-proof] Failed to fetch proof for email attachment:', err.message);
      return null;
    }
  }

  return null;
}

async function notifyUserOfPayoutProof({
  userId,
  withdrawal,
  proof,
  kind = 'mmk',
} = {}) {
  const user = await User.findById(userId);
  const email = user?.email;
  if (!email) {
    return { sent: false, reason: 'no_email' };
  }

  const amountLabel = kind === 'usdt_bank'
    ? `${Number(withdrawal.amount_mmk || 0).toLocaleString()} MMK`
      + (withdrawal.net_usdt != null ? ` (from ${Number(withdrawal.net_usdt).toFixed(2)} USDT)` : '')
    : `${Math.round(Number(withdrawal.net_mmk || withdrawal.amount_mmk || 0)).toLocaleString()} MMK`;

  const proofUrl = absoluteProofUrl(
    proof?.proofUrl || proof?.proofPath || withdrawal.proof_url || withdrawal.proof_path
  );

  let attachment = null;
  if (proof) {
    const content = await loadProofBuffer(proof);
    if (content?.length) {
      attachment = {
        filename: proof.proofOriginalName || 'payout-slip.jpg',
        content,
        contentType: proof.proofMimeType || undefined,
      };
    }
  }

  try {
    return await sendWithdrawalProofEmail({
      email,
      userName: user.name || null,
      refCode: withdrawal.ref_code,
      amountLabel,
      bankName: withdrawal.bank_name || null,
      accountName: withdrawal.account_name || null,
      accountNumber: withdrawal.account_number || null,
      proofUrl,
      attachment,
      kind,
    });
  } catch (err) {
    console.error('[withdrawal-proof] email failed:', err.message || err);
    return { sent: false, reason: err.message || 'email_failed' };
  }
}

module.exports = {
  persistProofFromRequest,
  proofUpdateFields,
  absoluteProofUrl,
  notifyUserOfPayoutProof,
  loadProofBuffer,
};
