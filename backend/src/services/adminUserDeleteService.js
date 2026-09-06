'use strict';

const { getDb } = require('../db');
const User = require('../models/User');
const UserSession = require('../models/UserSession');
const TransactionLog = require('../models/TransactionLog');
const { isSupabaseEnabled, getSupabase } = require('../lib/supabase');

async function tableExists(db, name) {
  const row = await db.get(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
    name
  );
  return Boolean(row);
}

async function safeDelete(db, label, sql, ...params) {
  const tableMatch = String(sql).match(/DELETE FROM\s+(\w+)/i);
  const table = tableMatch ? tableMatch[1] : null;
  if (table && !(await tableExists(db, table))) {
    return { label, changes: 0, skipped: true };
  }
  try {
    const result = await db.run(sql, ...params);
    return { label, changes: Number(result?.changes || 0) };
  } catch (err) {
    console.warn(`[admin/user-delete] ${label}:`, err.message);
    return { label, changes: 0, error: err.message };
  }
}

async function deleteUserMirrors(userId) {
  if (!isSupabaseEnabled()) {
    return { skipped: true, reason: 'supabase_disabled' };
  }
  const sb = getSupabase();
  if (!sb) return { skipped: true, reason: 'supabase_unavailable' };

  const id = String(userId);
  const results = {};

  for (const table of ['user_wallets', 'user_cards']) {
    try {
      const { error } = await sb.from(table).delete().eq('user_id', id);
      results[table] = error ? { ok: false, error: error.message } : { ok: true };
    } catch (err) {
      results[table] = { ok: false, error: err.message || String(err) };
    }
  }

  // Best-effort: clear card pool assignment if that column exists.
  try {
    const { error } = await sb
      .from('card_pools')
      .update({ assigned_to_user_id: null })
      .eq('assigned_to_user_id', id);
    results.card_pools = error ? { ok: false, error: error.message } : { ok: true };
  } catch (err) {
    results.card_pools = { ok: false, error: err.message || String(err) };
  }

  return { skipped: false, results };
}

/**
 * Permanently delete a user account and related rows.
 * Intended for removing test / unwanted accounts from the admin Users panel.
 */
async function deleteUserById(userId, {
  adminId = null,
  adminEmail = null,
  reason = null,
  confirmed = false,
  confirmEmail = null,
} = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    throw Object.assign(new Error('Invalid user id'), { status: 400, code: 'INVALID_USER_ID' });
  }

  const user = await User.findById(id);
  if (!user) {
    throw Object.assign(new Error('User not found'), { status: 404, code: 'USER_NOT_FOUND' });
  }

  if (adminId != null && Number(adminId) === id) {
    throw Object.assign(new Error('You cannot delete your own admin account'), {
      status: 400,
      code: 'CANNOT_DELETE_SELF',
    });
  }

  if (String(user.admin_role || '').trim()) {
    throw Object.assign(
      new Error('This account has an admin role. Remove admin access first, then delete the user.'),
      { status: 400, code: 'CANNOT_DELETE_ADMIN' }
    );
  }

  // Prefer explicit modal confirmation (`confirmed: true`).
  // Legacy callers may still pass matching confirmEmail.
  const expectedEmail = String(user.email || '').trim().toLowerCase();
  const typed = String(confirmEmail || '').trim().toLowerCase();
  const emailConfirmed = Boolean(expectedEmail && typed && typed === expectedEmail);
  const isConfirmed = confirmed === true
    || confirmed === 1
    || confirmed === '1'
    || String(confirmed || '').trim().toLowerCase() === 'true'
    || emailConfirmed;
  if (!isConfirmed) {
    throw Object.assign(
      new Error('Deletion was not confirmed. Click Confirm Delete in the admin dialog to proceed.'),
      { status: 400, code: 'DELETE_NOT_CONFIRMED' }
    );
  }

  const snapshot = {
    id: user.id,
    email: user.email || null,
    name: user.name || null,
    phone: user.phone || null,
    balance_usdt: user.balance_usdt != null ? Number(user.balance_usdt) : null,
    auth_status: user.auth_status || null,
  };

  // Prefer logging on the admin so the audit row is not CASCADE-deleted with the user.
  const auditUserId = adminId != null && Number(adminId) > 0 ? Number(adminId) : id;
  await TransactionLog.create({
    userId: auditUserId,
    type: 'admin_adjustment',
    direction: 'neutral',
    referenceType: 'user',
    referenceId: id,
    description: `User #${id} (${snapshot.email || 'no-email'}) deleted by admin${reason ? `: ${reason}` : ''}`,
    metadata: {
      action: 'user_deleted',
      deleted_user: snapshot,
      reason: reason || null,
      admin_id: adminId || null,
      admin_email: adminEmail || null,
    },
    createdBy: 'admin',
  }).catch((err) => {
    console.warn('[admin/user-delete] audit log skipped:', err.message);
  });

  const sessionsRevoked = await UserSession.revokeAllForUser(id).catch(() => 0);
  const db = getDb();
  const related = [];

  // Remove non-CASCADE dependents first so DELETE FROM users succeeds.
  related.push(await safeDelete(
    db,
    'p2p_order_messages_sender',
    'DELETE FROM p2p_order_messages WHERE sender_user_id = ?',
    id
  ));
  related.push(await safeDelete(
    db,
    'p2p_order_messages_buy_orders',
    `DELETE FROM p2p_order_messages
     WHERE order_type = 'buy'
       AND order_id IN (SELECT id FROM p2p_buy_orders WHERE user_id = ? OR maker_user_id = ?)`,
    id,
    id
  ));
  related.push(await safeDelete(
    db,
    'p2p_order_messages_sell_orders',
    `DELETE FROM p2p_order_messages
     WHERE order_type = 'sell'
       AND order_id IN (SELECT id FROM p2p_sell_orders WHERE user_id = ? OR maker_user_id = ?)`,
    id,
    id
  ));
  related.push(await safeDelete(
    db,
    'p2p_buy_orders',
    'DELETE FROM p2p_buy_orders WHERE user_id = ? OR maker_user_id = ?',
    id,
    id
  ));
  related.push(await safeDelete(
    db,
    'p2p_sell_orders',
    'DELETE FROM p2p_sell_orders WHERE user_id = ? OR maker_user_id = ?',
    id,
    id
  ));
  related.push(await safeDelete(db, 'p2p_ads', 'DELETE FROM p2p_ads WHERE user_id = ?', id));
  related.push(await safeDelete(db, 'kyc_submissions', 'DELETE FROM kyc_submissions WHERE user_id = ?', id));
  related.push(await safeDelete(db, 'card_reload_requests', 'DELETE FROM card_reload_requests WHERE user_id = ?', id));
  related.push(await safeDelete(db, 'cards', 'DELETE FROM cards WHERE user_id = ?', id));
  related.push(await safeDelete(db, 'deposit_requests', 'DELETE FROM deposit_requests WHERE user_id = ?', id));

  let userDelete;
  try {
    userDelete = await db.run('DELETE FROM users WHERE id = ?', id);
  } catch (err) {
    throw Object.assign(new Error(`Failed to delete user: ${err.message}`), {
      status: 500,
      code: 'USER_DELETE_FAILED',
      cause: err,
    });
  }

  if (!userDelete || Number(userDelete.changes || 0) < 1) {
    throw Object.assign(new Error('User delete did not remove any row'), {
      status: 500,
      code: 'USER_DELETE_NOOP',
    });
  }

  let supabase = null;
  try {
    supabase = await deleteUserMirrors(id);
  } catch (err) {
    console.warn('[admin/user-delete] supabase cleanup skipped:', err.message);
    supabase = { skipped: true, reason: err.message };
  }

  return {
    deleted: true,
    user: snapshot,
    sessions_revoked: sessionsRevoked,
    related_deleted: related,
    supabase,
  };
}

module.exports = {
  deleteUserById,
  deleteUserMirrors,
};
