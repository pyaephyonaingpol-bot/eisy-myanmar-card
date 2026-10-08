/**
 * Permanently remove a registered user and the rows that belong to them.
 * The signed-in admin and the protected owner account are refused.
 * Confirmation must be the exact word DELETE.
 */

const { getDb } = require('../db');
const { runInTransaction } = require('../lib/dbTransaction');
const User = require('../models/User');

const CONFIRM_WORD = 'DELETE';

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function ident(name) {
  const value = String(name || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw httpError('Unsafe SQL identifier', 'UNSAFE_IDENTIFIER', 500);
  }
  return `"${value}"`;
}

async function foreignKeysPointingAt(db, parentTable) {
  const tables = await db.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  );
  const refs = [];
  for (const table of tables) {
    const fks = await db.all(`PRAGMA foreign_key_list(${ident(table.name)})`);
    for (const fk of fks) {
      if (String(fk.table || '').toLowerCase() !== String(parentTable).toLowerCase()) continue;
      refs.push({
        table: table.name,
        from: fk.from,
        to: fk.to || 'id',
        onDelete: String(fk.on_delete || 'NO ACTION').toUpperCase(),
      });
    }
  }
  return refs;
}

async function columnInfo(db, table, column) {
  const cols = await db.all(`PRAGMA table_info(${ident(table)})`);
  return cols.find((col) => col.name === column) || null;
}

async function primaryKeyColumns(db, table) {
  const cols = await db.all(`PRAGMA table_info(${ident(table)})`);
  const pk = cols.filter((col) => Number(col.pk) > 0).sort((a, b) => a.pk - b.pk);
  if (pk.length) return pk.map((col) => col.name);
  return cols.some((col) => col.name === 'id') ? ['id'] : [];
}

async function deleteWhere(db, table, column, value, depth, seen) {
  if (depth > 8) return;
  const sig = `${table}|${column}|${value}`;
  if (seen.has(sig)) return;
  seen.add(sig);

  const pk = await primaryKeyColumns(db, table);
  const selectPk = pk.length ? pk.map((name) => ident(name)).join(', ') : 'rowid';
  const rows = pk.length
    ? await db.all(
      `SELECT ${selectPk} FROM ${ident(table)} WHERE ${ident(column)} = ?`,
      value
    )
    : [];
  const incoming = await foreignKeysPointingAt(db, table);
  for (const row of rows) {
    for (const fk of incoming) {
      if (fk.onDelete === 'CASCADE' || fk.onDelete === 'SET NULL') continue;
      const parentColumn = fk.to && row[fk.to] != null ? fk.to : (pk[0] || null);
      if (!parentColumn || row[parentColumn] == null) continue;
      await deleteWhere(db, fk.table, fk.from, row[parentColumn], depth + 1, seen);
    }
  }
  await db.run(`DELETE FROM ${ident(table)} WHERE ${ident(column)} = ?`, value);
}

async function deleteUserRow(db, userId) {
  const refs = await foreignKeysPointingAt(db, 'users');
  const seen = new Set();
  for (const fk of refs) {
    if (fk.onDelete === 'CASCADE' || fk.onDelete === 'SET NULL') continue;
    const column = await columnInfo(db, fk.table, fk.from);
    if (column && Number(column.notnull) === 0 && fk.from !== 'user_id') {
      await db.run(
        `UPDATE ${ident(fk.table)} SET ${ident(fk.from)} = NULL WHERE ${ident(fk.from)} = ?`,
        userId
      );
      continue;
    }
    await deleteWhere(db, fk.table, fk.from, userId, 0, seen);
  }
  const result = await db.run('DELETE FROM users WHERE id = ?', userId);
  return Number(result?.changes || 0) === 1;
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
    const mirror = await deleteSupabaseUserWallet(id);
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

  const db = getDb();
  const removed = await runInTransaction(db, async () => deleteUserRow(db, id));
  if (!removed) {
    throw httpError('User was not deleted', 'USER_DELETE_FAILED', 500);
  }

  const mirror = await deleteSupabaseUserWallet(id);
  console.info('[admin/users/delete] removed user', {
    id,
    email: user.email || null,
    by: adminEmail || adminId || null,
    supabase: mirror.deleted ? 'deleted' : (mirror.skipped ? 'skipped' : 'unknown'),
  });

  return {
    removed: true,
    source: 'registry',
    user: {
      id: user.id,
      email: user.email || null,
      name: user.name || null,
    },
    supabase_wallet: mirror.deleted ? 'deleted' : 'skipped',
  };
}

module.exports = {
  deleteAdminUser,
  CONFIRM_WORD,
};
