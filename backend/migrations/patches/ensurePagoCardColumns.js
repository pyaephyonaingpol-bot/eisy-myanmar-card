/**
 * Production Turso DBs may have schema_migrations marked for 070 while
 * cards_v2 was rebuilt or only partially altered. CREATE TABLE IF NOT EXISTS
 * and a skipped ALTER leave Pago inserts failing with:
 *   "no such column: pago_card_id"
 * which surfaces as PAGO_CARD_SAVE_FAILED after a successful provider issue.
 */
const PAGO_CARD_COLUMNS = [
  ['pago_card_id', 'TEXT'],
  ['pago_status', 'TEXT'],
  ['product_code', 'TEXT'],
  ['brand', 'TEXT'],
  ['last_four', 'TEXT'],
  ['expiry_month', 'TEXT'],
  ['expiry_year', 'TEXT'],
  ['balance_display_usd', 'REAL'],
  ['balance_amount', 'INTEGER'],
  ['balance_currency', 'TEXT'],
  ['provider', 'TEXT'],
];

async function ensurePagoCardColumns(db, columnExists, tableExists) {
  if (!(await tableExists(db, 'cards_v2'))) {
    return;
  }

  for (const [name, definition] of PAGO_CARD_COLUMNS) {
    if (!(await columnExists(db, 'cards_v2', name))) {
      await db.exec(`ALTER TABLE cards_v2 ADD COLUMN ${name} ${definition}`);
      console.log(`[migrate] Added cards_v2.${name}`);
    }
  }

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_v2_pago_card_id
      ON cards_v2(pago_card_id)
      WHERE pago_card_id IS NOT NULL AND pago_card_id != '';
  `);
}

module.exports = {
  ensurePagoCardColumns,
  PAGO_CARD_COLUMNS,
};
