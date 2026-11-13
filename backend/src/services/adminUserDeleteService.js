/**
 * Permanently remove a registered user and the rows that belong to them.
 * The signed-in admin and the protected owner account are refused.
 * Confirmation must be the exact word DELETE.
 *
 * Turso: fixed indexed batch (LibSQL `client.batch`) — never walk FK lists
 * per child row (that path caused HTTP 504 on remote LibSQL).
 *
 * Supabase mirror: one RPC (preferred) or parallel bulk DELETEs per table.
 * Mirror work is time-budgeted so the HTTP response returns before the
 * Vercel gateway limit; leftover purge continues via waitUntil when available.
 */

const { getDb } = require('../db');
const { runInTransaction } = require('../lib/dbTransaction');

const CONFIRM_WORD = 'DELETE';

/** Soft budget for awaiting Supabase purge before responding (ms). */
const MIRROR_AWAIT_BUDGET_MS = Math.max(
  250,
  parseInt(process.env.ADMIN_USER_DELETE_MIRROR_BUDGET_MS || '1500', 10) || 1500
);

/** Hard abort for the full mirror purge job (ms). */
const MIRROR_JOB_TIMEOUT_MS = Math.max(
  MIRROR_AWAIT_BUDGET_MS,
  parseInt(process.env.ADMIN_USER_DELETE_MIRROR_TIMEOUT_MS || '20000', 10) || 20000
);

/** Soft budget for the Turso batch (ms) — fail fast instead of gateway 504. */
const TURSO_DELETE_BUDGET_MS = Math.max(
  1000,
  parseInt(process.env.ADMIN_USER_DELETE_TURSO_BUDGET_MS || '20000', 10) || 20000
);

/**
 * Supabase tables that mirror user-owned rows (user_id text / bigint).
 * One DELETE per table — never N+1 row loops.
 */
const SUPABASE_MIRROR_TABLES = [
  'user_wallets',
  'deposit_requests',
  'card_applications',
  'card_reload_requests',
  'transaction_logs',
  'usdt_withdrawal_requests',
  'usdt_bank_withdrawals',
  'wallet_transactions',
  'usdt_scan_payments',
  'user_tron_hd_addresses',
  'user_tron_deposit_addresses',
  'support_threads',
  'support_messages',
  'orders',
  'card_pools',
  'user_cards',
];

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function withTimeout(promise, ms, label) {
  const timeoutMs = Math.max(1, Number(ms) || 1);
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${timeoutMs}ms`);
        err.code = 'DELETE_TIMEOUT';
        reject(err);
      }, timeoutMs);
    }),
  ]);
}

/**
 * Statements that SQLite will not cascade or null for us.
 * Order matters: detach ads, then delete owning rows, then the user.
 * CASCADE-backed tables are still cleared explicitly so remote LibSQL
 * does not spend time on deferred FK walks during DELETE users.
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
  const work = (async () => {
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
  })();

  return withTimeout(work, TURSO_DELETE_BUDGET_MS, 'Turso user delete');
}

function tryWaitUntil(promise) {
  try {
    // Optional — present on Vercel Node runtimes; absent locally.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const mod = require('@vercel/functions');
    if (mod && typeof mod.waitUntil === 'function') {
      mod.waitUntil(promise);
      return true;
    }
  } catch (_) {
    /* package not installed / not on Vercel */
  }
  return false;
}

async function deleteSupabaseTableRows(sb, table, userId) {
  const { error } = await sb.from(table).delete().eq('user_id', String(userId));
  if (error) {
    const msg = String(error.message || error);
    // Missing / mismatched tables are fine — projects differ in which mirrors exist.
    if (/does not exist|42P01|PGRST205|schema cache|invalid input syntax|column .* does not exist/i.test(msg)) {
      return { table, ok: true, skipped: true, error: msg };
    }
    return { table, ok: false, error: msg };
  }
  return { table, ok: true };
}

/**
 * Preferred path: single Postgres RPC (see supabase/user_delete_cascade.sql).
 * Fallback: parallel bulk DELETE per mirror table.
 */
async function purgeSupabaseUserMirror(userId) {
  let getSupabase;
  let isSupabaseEnabled;
  try {
    ({ getSupabase, isSupabaseEnabled } = require('../lib/supabase'));
  } catch (_) {
    return { skipped: true, reason: 'supabase_module_unavailable' };
  }
  if (!isSupabaseEnabled()) return { skipped: true, reason: 'supabase_disabled' };
  const sb = getSupabase();
  if (!sb || typeof sb.from !== 'function') {
    return { skipped: true, reason: 'supabase_client_unavailable' };
  }

  const id = String(userId);
  const started = Date.now();

  // One round-trip when the SQL helper is installed.
  if (typeof sb.rpc === 'function') {
    try {
      const { data, error } = await sb.rpc('admin_purge_user_mirror', { p_user_id: id });
      if (!error) {
        return {
          deleted: true,
          mode: 'rpc',
          details: data || null,
          ms: Date.now() - started,
        };
      }
      const msg = String(error.message || error);
      if (!/function|does not exist|PGRST202|42883/i.test(msg)) {
        console.warn('[admin/users/delete] supabase rpc purge failed:', msg);
        return { skipped: true, error: msg, mode: 'rpc', ms: Date.now() - started };
      }
      console.info('[admin/users/delete] supabase rpc missing — using bulk table deletes');
    } catch (err) {
      console.warn('[admin/users/delete] supabase rpc purge threw:', err.message);
    }
  }

  const results = await Promise.allSettled(
    SUPABASE_MIRROR_TABLES.map((table) => deleteSupabaseTableRows(sb, table, id))
  );

  const tables = [];
  let failures = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      tables.push(result.value);
      if (result.value && result.value.ok === false) failures += 1;
    } else {
      failures += 1;
      tables.push({ ok: false, error: String(result.reason?.message || result.reason) });
    }
  }

  return {
    deleted: failures === 0,
    mode: 'bulk',
    failures,
    tables,
    ms: Date.now() - started,
  };
}

/**
 * Start mirror purge without blocking the HTTP response past `budgetMs`.
 * Remaining work is attached via waitUntil when available.
 */
function scheduleMirrorPurge(userId, { budgetMs = MIRROR_AWAIT_BUDGET_MS } = {}) {
  const job = withTimeout(
    purgeSupabaseUserMirror(userId),
    MIRROR_JOB_TIMEOUT_MS,
    'Supabase mirror purge'
  ).then(
    (value) => {
      console.info('[admin/users/delete] supabase mirror purge done', {
        id: userId,
        ...value,
      });
      return value;
    },
    (err) => {
      console.warn('[admin/users/delete] supabase mirror purge failed:', err.message || err);
      return { skipped: true, error: err.message || String(err) };
    }
  );

  const waitedViaPlatform = tryWaitUntil(job);

  return Promise.race([
    job.then((value) => ({ ...value, awaited: true, background: waitedViaPlatform })),
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          pending: true,
          background: true,
          wait_until: waitedViaPlatform,
          budget_ms: budgetMs,
        });
      }, budgetMs);
    }),
  ]);
}

function supabaseStatusFromMirror(mirror) {
  if (!mirror) return 'skipped';
  if (mirror.pending) return 'pending';
  if (mirror.deleted) return 'deleted';
  if (mirror.skipped) return 'skipped';
  return 'skipped';
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

  const User = require('../models/User');
  const user = await User.findById(id);
  if (!user) {
    // Orphan Supabase-only row: await a short purge. Only report removed when
    // the mirror confirms deletes — never treat "pending" as success (that
    // would hide USER_NOT_FOUND for random ids).
    let mirror;
    try {
      mirror = await withTimeout(
        purgeSupabaseUserMirror(id),
        MIRROR_AWAIT_BUDGET_MS,
        'Supabase orphan purge'
      );
    } catch (err) {
      console.warn('[admin/users/delete] orphan mirror purge skipped:', err.message || err);
      mirror = { skipped: true, error: err.message || String(err) };
    }
    if (mirror && mirror.deleted) {
      return {
        removed: true,
        source: 'supabase',
        user: { id, email: null, name: null },
        supabase_wallet: 'deleted',
        supabase_mirror: { status: 'deleted', mode: mirror.mode || null },
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

  let removed;
  try {
    removed = await deleteUserRow(db, id);
  } catch (err) {
    console.error('[admin/users/delete] turso delete failed', {
      id,
      code: err.code || null,
      message: err.message,
      ms: Date.now() - started,
    });
    if (err.code === 'DELETE_TIMEOUT') {
      throw httpError(
        'User delete timed out on the primary database — retry shortly',
        'USER_DELETE_TIMEOUT',
        504
      );
    }
    throw httpError(err.message || 'User was not deleted', 'USER_DELETE_FAILED', 500);
  }

  if (!removed) {
    throw httpError('User was not deleted', 'USER_DELETE_FAILED', 500);
  }

  // Respond without waiting for a slow Supabase mirror purge (504 root cause).
  const mirror = await scheduleMirrorPurge(id);
  const supabase = supabaseStatusFromMirror(mirror);

  console.info('[admin/users/delete] removed user', {
    id,
    email: user.email || null,
    by: adminEmail || adminId || null,
    supabase,
    mirror_mode: mirror.mode || (mirror.pending ? 'deferred' : null),
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
    supabase_mirror: {
      status: supabase,
      pending: Boolean(mirror.pending),
      background: Boolean(mirror.background || mirror.wait_until),
      mode: mirror.mode || null,
    },
  };
}

module.exports = {
  deleteAdminUser,
  CONFIRM_WORD,
  cleanupStatements,
  SUPABASE_MIRROR_TABLES,
  purgeSupabaseUserMirror,
  scheduleMirrorPurge,
  MIRROR_AWAIT_BUDGET_MS,
};
