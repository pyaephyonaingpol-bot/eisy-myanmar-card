/**
 * Shared SQL transaction helper with safe rollback for LibSQL/SQLite adapters.
 */

function isNoActiveTransactionError(err) {
  const parts = [];
  let current = err;
  while (current) {
    parts.push(String(current.message || current || ''));
    if (current.code) parts.push(String(current.code));
    current = current.cause;
  }
  const msg = parts.join(' | ');
  return /no transaction is active/i.test(msg)
    || /cannot rollback/i.test(msg)
    || /SQLITE_UNKNOWN/i.test(msg);
}

async function safeCommit(db) {
  if (typeof db.isInTransaction === 'function' && !db.isInTransaction()) {
    return;
  }
  try {
    await db.run('COMMIT');
  } catch (err) {
    if (!isNoActiveTransactionError(err)) {
      throw err;
    }
  }
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
      await safeCommit(db);
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
  safeCommit,
  isNoActiveTransactionError,
};
