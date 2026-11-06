/**
 * Permanently remove a registered user and the rows that belong to them.
 * The signed-in admin and the protected owner account are refused.
 * Confirmation must be the exact word DELETE.
 *
 * The previous implementation walked every table's foreign-key list
 * once per child row. On remote LibSQL that is one network round trip per
 * table per row, which blows the Vercel gateway limit and returns HTTP 504.
 * Cleanup is now a fixed batch of indexed statements. SQLite ON DELETE CASCADE
 * removes the rest when the users row is deleted. There is no worker queue:
 * a detached job on this serverless runtime is frozen when the response ends,
 * so the account is removed before the handler returns.
 */

const { getDb } = require('../db');
const { runInTransaction } = require('../lib/dbTransaction');
const User = require('../models/User');

const CONFIRM_WORD = 'DELETE';
const MIRROR_TIMEOUT_MS = 3000;

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/**
 * Statements that SQLite will not cascade or null for us.
 * Order matters: detach ads, then delete owning rows, then the user.
 * Each statement uses an indexed user_id / maker_user_id / ad_id column.
 */
function cleanupStatements(userId) {
  const id = userId;
  return [
    {
      sql: `UPDATE p2p_buy_orders SET ad_id = NULL
            WHERE ad_id IN (SELECT id FROM p2p_ads WHERE user_id = ?)`,
      args: [id],
    },
    {
      sql: `UPDATE p2p_sell_orders SET ad_id = NULL
            WHERE ad_id IN (SELECT id FROM p2p_ads WHERE user_id = ?)`,
      args: [id],
    },
    {
      sql: 'UPDATE p2p_buy_orders SET maker_user_id = NULL WHERE maker_user_id = ?',
      args: [id],
    },
    {
      sql: 'UPDATE p2p_sell_orders SET maker_user_id = NULL WHERE maker_user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM p2p_order_messages WHERE sender_user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM p2p_buy_orders WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM p2p_sell_orders WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM p2p_ads WHERE user_id = ?',
      args: [id],
    },
    {
      sql: `DELETE FROM card_reload_requests
            WHERE user_id = ?
               OR card_id IN (SELECT id FROM cards_v2 WHERE user_id = ?)`,
      args: [id, id],
    },
    {
      sql: 'DELETE FROM kyc_submissions WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM usdt_scan_payments WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM deposit_requests WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM cards WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM pago_3ds_events WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM push_subscriptions WHERE user_id = ?',
      args: [id],
    },
    {
      sql: 'DELETE FROM users WHERE id = ?',
      args: [id],
    },
  ];
}

function rowsAffected(result) {
  if (!result) return 0;
  if (result.rowsAffected != null) return Number(result.rowsAffected);
  if (result.changes != null) return Number(result.changes);
  return 0;
}

async function deleteUserRow(db, userId) {
  const statements = cleanupStatements(userId);
  if (db.client && typeof db.client.batch === 'function') {
    const results = await db.client.batch(
      statements.map((statement) => ({ sql: statement.sql, args: statement.args })),
      'write'
    );
    const last = Array.isArray(results) ? results[results.length - 1] : null;
    return rowsAffected(last) === 1;
  }

  let removed = false;
  await runInTransaction(db, async () => {
    for (const statement of statements) {
      const result = await db.run(statement.sql, ...statement.args);
      if (statement.sql.startsWith('DELETE FROM users')) {
        removed = rowsAffected(result) === 1;
      }
    }
  });
  return removed;
}

async function deleteSupabaseUserWallet(userId) {
  let getSupabase;
  let isSupabaseEnabled;
  try {
    ({ getSupabase, isSupabaseEnabled } = require('../lib/supabase'));
  } catch (_) {
    return { skipped: true };
  }
  if (!isSupabaseEnabled()) return { skipped: true };
  const sb = getSupabase();
  if (!sb || typeof sb.from !== 'function') return { skipped: true };
  try {
    const query = sb.from('user_wallets').delete();
    const { error } = await query.eq('user_id', String(userId));
    if (error) {
      console.warn('[admin/users/delete] supabase wallet delete skipped:', error.message);
      return { skipped: true, error: error.message };
    }
    return { deleted: true };
  } catch (err) {
    console.warn('[admin/users/delete] supabase wallet delete skipped:', err.message);
    return { skipped: true, error: err.message };
  }
}

function mirrorWithTimeout(userId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ skipped: true, pending: true });
    }, MIRROR_TIMEOUT_MS);
    deleteSupabaseUserWallet(userId).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve({ skipped: true });
      }
    );
  });
}

async function deleteAdminUser(userId, {
  confirm,
  adminId = null,
  adminEmail = null,
} = {}) {
  if (String(confirm || '') !== CONFIRM_WORD) {
    throw httpError('Type DELETE to confirm user removal', 'CONFIRMATION_REQUIRED', 400);
  }

  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    throw httpError('Invalid user id', 'INVALID_USER_ID', 400);
  }
  if (adminId != null && Number(adminId) === id) {
    throw httpError('You cannot delete your own admin account', 'CANNOT_DELETE_SELF', 400);
  }

  const user = await User.findById(id);
  if (!user) {
    const mirror = await mirrorWithTimeout(id);
    if (mirror.deleted) {
      return {
        removed: true,
        source: 'supabase',
        user: { id, email: null, name: null },
      };
    }
    throw httpError('User not found', 'USER_NOT_FOUND', 404);
  }

  const { isProtectedSuperAdminEmail } = require('./adminAuthService');
  if (isProtectedSuperAdminEmail(user.email)) {
    throw httpError('The protected owner account cannot be deleted', 'CANNOT_DELETE_OWNER', 400);
  }
  if (user.admin_role && String(user.admin_role).trim()) {
    throw httpError('Admin accounts cannot be deleted from the user list', 'CANNOT_DELETE_ADMIN', 400);
  }

  const started = Date.now();
  const db = getDb();
  const removed = await deleteUserRow(db, id);
  if (!removed) {
    throw httpError('User was not deleted', 'USER_DELETE_FAILED', 500);
  }

  const mirror = await mirrorWithTimeout(id);
  const supabase = mirror.deleted ? 'deleted' : (mirror.pending ? 'pending' : 'skipped');
  console.info('[admin/users/delete] removed user', {
    id,
    email: user.email || null,
    by: adminEmail || adminId || null,
    supabase,
    ms: Date.now() - started,
  });

  return {
    removed: true,
    source: 'registry',
    user: {
      id: user.id,
      email: user.email || null,
      name: user.name || null,
    },
    supabase_wallet: supabase,
  };
}

module.exports = {
  deleteAdminUser,
  CONFIRM_WORD,
  cleanupStatements,
};
