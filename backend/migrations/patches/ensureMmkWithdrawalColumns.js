/**
 * Production Turso DBs may have an older mmk_withdrawal_requests table that was
 * created before migration 032's full column set. CREATE TABLE IF NOT EXISTS
 * does not add missing columns, which breaks admin Transaction History queries
 * that SELECT fee_percent / processed_at explicitly.
 */
const MMK_WITHDRAWAL_COLUMNS = [
  ['fee_mmk', 'REAL NOT NULL DEFAULT 0'],
  ['net_mmk', 'REAL'],
  ['fee_percent', 'REAL NOT NULL DEFAULT 0'],
  ['bank_name', 'TEXT'],
  ['account_name', 'TEXT'],
  ['account_number', 'TEXT'],
  ['admin_note', 'TEXT'],
  ['processed_by', 'INTEGER'],
  ['processed_at', 'TEXT'],
  // SQLite/LibSQL disallow non-constant defaults on ADD COLUMN.
  ['updated_at', 'TEXT'],
];

async function ensureMmkWithdrawalColumns(db, columnExists, tableExists) {
  if (!(await tableExists(db, 'mmk_withdrawal_requests'))) {
    return;
  }

  for (const [name, definition] of MMK_WITHDRAWAL_COLUMNS) {
    if (!(await columnExists(db, 'mmk_withdrawal_requests', name))) {
      await db.exec(`ALTER TABLE mmk_withdrawal_requests ADD COLUMN ${name} ${definition}`);
      console.log(`[migrate] Added mmk_withdrawal_requests.${name}`);
    }
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mmk_withdrawals_user
    ON mmk_withdrawal_requests(user_id);
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mmk_withdrawals_status
    ON mmk_withdrawal_requests(status);
  `);
}

module.exports = {
  ensureMmkWithdrawalColumns,
  MMK_WITHDRAWAL_COLUMNS,
};
