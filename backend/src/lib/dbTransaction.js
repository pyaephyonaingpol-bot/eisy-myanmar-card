/**
 * Shared SQL transaction helper with safe rollback for LibSQL/SQLite adapters.
 */

function isNoActiveTransactionError(err) {
  const msg = String(err?.message || err || '');
  return /no transaction is active/i.test(msg)
    || /cannot rollback/i.test(msg);
}

async function safeRollback(db) {
  if (typeof db.safeRollback === 'function') {
    await db.safeRollback();
    return;
  }
  if (typeof db.isInTransaction === 'function' && !db.isInTransaction()) {
    return;
  }
  try {
    await db.run('ROLLBACK');
  } catch (err) {
    if (!isNoActiveTransactionError(err)) {
      throw err;
    }
  }
}

async function runInTransaction(db, fn) {
  let began = false;
  try {
    await db.run('BEGIN');
    began = typeof db.isInTransaction === 'function' ? db.isInTransaction() : true;
    const result = await fn(db);
    if (began) {
      await db.run('COMMIT');
      began = false;
    }
    return result;
  } catch (err) {
    if (began) {
      await safeRollback(db);
    }
    throw err;
  }
}

module.exports = {
  runInTransaction,
  safeRollback,
  isNoActiveTransactionError,
};
