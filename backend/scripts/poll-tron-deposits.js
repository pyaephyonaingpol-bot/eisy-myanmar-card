#!/usr/bin/env node
/**
 * Run one TRON USDT deposit indexer poll cycle (for cron / manual ops).
 *
 * Usage: npm run poll:tron-deposits
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const { initDb, closeDb } = require('../src/db');
const {
  pollMasterWalletDeposits,
  getIndexerStatus,
  isIndexerEnabled,
} = require('../src/services/tronDepositIndexerService');

async function main() {
  await initDb();

  if (!isIndexerEnabled()) {
    console.error('[poll-tron-deposits] Indexer disabled — configure MASTER_WALLET_ADDRESS or MASTER_PRIVATE_KEY');
    process.exit(1);
  }

  const before = await getIndexerStatus();
  console.log('[poll-tron-deposits] Status before:', JSON.stringify(before, null, 2));

  const result = await pollMasterWalletDeposits();
  console.log('[poll-tron-deposits] Result:', JSON.stringify(result, null, 2));

  const after = await getIndexerStatus();
  console.log('[poll-tron-deposits] Status after:', JSON.stringify(after, null, 2));

  await closeDb();
}

main().catch(async (err) => {
  console.error('[poll-tron-deposits] Fatal:', err.message || err);
  try {
    await closeDb();
  } catch (_) { /* ignore */ }
  process.exit(1);
});
