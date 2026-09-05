const User = require('../models/User');
const UserSession = require('../models/UserSession');
const TransactionLog = require('../models/TransactionLog');
const { normalizeAuthStatus, isUserBlocked } = require('../lib/userAuthStatus');
const { syncUserWalletById } = require('./supabaseSyncService');

const ALLOWED_STATUSES = new Set(['active', 'blocked']);

/**
 * Admin block / unblock a user.
 * Sets Turso users.auth_status, revokes sessions on block, mirrors to Supabase.
 */
async function setUserBlockStatus(userId, {
  status,
  reason = null,
  adminId = null,
  adminEmail = null,
} = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    throw Object.assign(new Error('Invalid user id'), { status: 400, code: 'INVALID_USER_ID' });
  }

  const next = normalizeAuthStatus(status);
  if (!ALLOWED_STATUSES.has(next)) {
    throw Object.assign(
      new Error(`status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`),
      { status: 400, code: 'INVALID_STATUS' }
    );
  }

  const user = await User.findById(id);
  if (!user) {
    throw Object.assign(new Error('User not found'), { status: 404, code: 'USER_NOT_FOUND' });
  }

  if (adminId != null && Number(adminId) === id) {
    throw Object.assign(new Error('You cannot block your own admin account'), {
      status: 400,
      code: 'CANNOT_BLOCK_SELF',
    });
  }

  const previous = normalizeAuthStatus(user.auth_status);
  const alreadyBlocked = isUserBlocked(previous);
  const willBlock = next === 'blocked';

  // Treat legacy "suspended" as already blocked for idempotent Block clicks.
  if ((willBlock && alreadyBlocked) || (!willBlock && previous === 'active')) {
    return {
      unchanged: true,
      user,
      previous_status: previous,
      new_status: willBlock ? (previous === 'suspended' ? 'blocked' : previous) : previous,
      sessions_revoked: 0,
      is_blocked: alreadyBlocked,
    };
  }

  // Normalize legacy suspended → blocked when admin clicks Block again after code deploy.
  const updated = await User.setAuthStatus(id, next);
  let sessionsRevoked = 0;
  if (willBlock) {
    sessionsRevoked = await UserSession.revokeAllForUser(id);
  }

  await TransactionLog.create({
    userId: id,
    // Allowed ledger type; block details live in description + metadata.
    type: 'admin_adjustment',
    direction: 'neutral',
    referenceType: 'user',
    referenceId: id,
    description: willBlock
      ? `User blocked by admin${reason ? `: ${reason}` : ''}`
      : `User unblocked by admin${reason ? `: ${reason}` : ''}`,
    metadata: {
      action: willBlock ? 'user_blocked' : 'user_unblocked',
      previous_status: previous,
      new_status: next,
      reason: reason || null,
      admin_id: adminId || null,
      admin_email: adminEmail || null,
      sessions_revoked: sessionsRevoked,
      is_blocked: willBlock,
    },
    createdBy: 'admin',
  }).catch((err) => {
    console.warn('[admin/user-block] audit log skipped:', err.message);
  });

  try {
    await syncUserWalletById(id);
  } catch (err) {
    console.warn('[admin/user-block] supabase sync skipped:', err.message);
  }

  return {
    unchanged: false,
    user: updated,
    previous_status: previous,
    new_status: next,
    sessions_revoked: sessionsRevoked,
    is_blocked: willBlock,
  };
}

async function blockUser(userId, opts = {}) {
  return setUserBlockStatus(userId, { ...opts, status: 'blocked' });
}

async function unblockUser(userId, opts = {}) {
  return setUserBlockStatus(userId, { ...opts, status: 'active' });
}

module.exports = {
  setUserBlockStatus,
  blockUser,
  unblockUser,
  ALLOWED_STATUSES,
};
