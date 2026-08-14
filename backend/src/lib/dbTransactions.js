/**
 * Safe transaction helpers for sqlite3 + LibSQL adapters.
 *
 * LibSQL's default execute() auto-commits each statement, so raw
 * BEGIN/COMMIT/ROLLBACK via db.run() often throws
 * "cannot rollback - no transaction is active" after the work already succeeded.
 */

function isInactiveTransactionError(err) {
  const msg = String(err?.message || err || '');
  return /no transaction is active/i.test(msg)
    || /cannot rollback/i.test(msg)
    || /cannot commit/i.test(msg);
}

async function safeRollback(db) {
  if (!db || typeof db.run !== 'function') return;
  try {
    await db.run('ROLLBACK');
  } catch (err) {
    if (!isInactiveTransactionError(err)) {
      console.warn('[db] ROLLBACK failed:', err.message || err);
    }
  }
}

async function safeCommit(db) {
  if (!db || typeof db.run !== 'function') return;
  try {
    await db.run('COMMIT');
  } catch (err) {
    if (!isInactiveTransactionError(err)) throw err;
    // LibSQL may have already auto-committed individual statements.
  }
}

/**
 * Run work inside a write transaction when the adapter supports it.
 * Falls back to sequential statements (no BEGIN) for LibSQL without tx API.
 */
async function withWriteTransaction(db, work) {
  if (!db) throw new Error('Database required');

  // Prefer native LibSQL interactive transactions when available
  if (db.isLibsql && typeof db.withTransaction === 'function') {
    return db.withTransaction(work);
  }

  // Legacy sqlite3 / adapters that honor BEGIN across statements
  if (!db.isLibsql) {
    await db.run('BEGIN');
    try {
      const result = await work(db);
      await safeCommit(db);
      return result;
    } catch (err) {
      await safeRollback(db);
      throw err;
    }
  }

  // LibSQL without interactive tx — run statements directly (auto-commit).
  // Avoid BEGIN/COMMIT so a later ROLLBACK cannot mask success.
  return work(db);
}

module.exports = {
  isInactiveTransactionError,
  safeRollback,
  safeCommit,
  withWriteTransaction,
};
