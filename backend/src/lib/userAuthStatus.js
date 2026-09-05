/**
 * Account gate helpers.
 *
 * Turso `users.auth_status` is the source of truth.
 * - active: normal access
 * - blocked: admin-blocked (login + authenticated actions denied)
 * - suspended: legacy synonym for blocked (still enforced)
 */

const BLOCKED_STATUSES = new Set(['blocked', 'suspended']);

function normalizeAuthStatus(value) {
  const status = String(value || 'active').trim().toLowerCase();
  return status || 'active';
}

function isUserBlocked(userOrStatus) {
  if (userOrStatus == null) return false;
  const status = typeof userOrStatus === 'string' || typeof userOrStatus === 'number'
    ? userOrStatus
    : userOrStatus.auth_status;
  return BLOCKED_STATUSES.has(normalizeAuthStatus(status));
}

function assertUserNotBlocked(user, { action = 'use this account' } = {}) {
  if (!isUserBlocked(user)) return user;
  const err = new Error(`Your account has been blocked and cannot ${action}. Contact support.`);
  err.code = 'ACCOUNT_BLOCKED';
  err.status = 403;
  throw err;
}

module.exports = {
  BLOCKED_STATUSES,
  normalizeAuthStatus,
  isUserBlocked,
  assertUserNotBlocked,
};
