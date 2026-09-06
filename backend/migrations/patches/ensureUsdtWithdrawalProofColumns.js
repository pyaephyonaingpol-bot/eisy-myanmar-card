/**
 * Backfill payment-proof columns on usdt_withdrawal_requests for bank payouts.
 */
const USDT_WITHDRAWAL_PROOF_COLUMNS = [
  ['proof_path', 'TEXT'],
  ['proof_url', 'TEXT'],
  ['proof_mime_type', 'TEXT'],
  ['proof_original_name', 'TEXT'],
  ['proof_uploaded_at', 'TEXT'],
  ['proof_uploaded_by', 'INTEGER'],
];

async function ensureUsdtWithdrawalProofColumns(db, columnExists, tableExists) {
  if (!(await tableExists(db, 'usdt_withdrawal_requests'))) {
    return;
  }

  for (const [name, definition] of USDT_WITHDRAWAL_PROOF_COLUMNS) {
    if (!(await columnExists(db, 'usdt_withdrawal_requests', name))) {
      await db.exec(`ALTER TABLE usdt_withdrawal_requests ADD COLUMN ${name} ${definition}`);
      console.log(`[migrate] Added usdt_withdrawal_requests.${name}`);
    }
  }
}

module.exports = {
  ensureUsdtWithdrawalProofColumns,
  USDT_WITHDRAWAL_PROOF_COLUMNS,
};
