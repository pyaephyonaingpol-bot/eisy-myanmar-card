/**
 * Smoke test for safe SQL transaction rollback (no "cannot rollback" leak).
 */
require('../src/lib/loadEnv');
const { initDb, getDb, closeDb } = require('../src/db');
const { runInTransaction } = require('../src/lib/dbTransaction');

async function main() {
  await initDb();
  const db = getDb();

  try {
    await runInTransaction(db, async (conn) => {
      await conn.run('SELECT 1');
      throw new Error('forced rollback');
    });
    throw new Error('expected transaction to fail');
  } catch (err) {
    if (err.message !== 'forced rollback') {
      throw err;
    }
  }

  if (typeof db.isInTransaction === 'function' && db.isInTransaction()) {
    throw new Error('transaction depth was not cleared after rollback');
  }

  // Second explicit rollback must not throw when nothing is active.
  if (typeof db.safeRollback === 'function') {
    await db.safeRollback();
  }

  console.log('db-transaction-rollback: ok');
  await closeDb();
}

main().catch(async (err) => {
  console.error('db-transaction-rollback: FAIL', err.message || err);
  try { await closeDb(); } catch (_) { /* ignore */ }
  process.exit(1);
});
