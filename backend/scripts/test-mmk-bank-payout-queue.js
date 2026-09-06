#!/usr/bin/env node
/**
 * Regression: WB-* (USDT→MMK bank) and WM-* (MMK wallet) both appear in
 * the admin MMK withdrawals queue after user submission.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '../..');

// Static wiring checks
const adminJs = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');
const queueSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/mmkBankPayoutQueueService.js'), 'utf8');
const ledgerSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/adminLedgerTransactionService.js'), 'utf8');
const usdtModel = fs.readFileSync(path.join(ROOT, 'backend/src/models/UsdtWithdrawal.js'), 'utf8');

assert.ok(adminRoutes.includes('listMmkBankPayoutQueue'), 'admin GET mmk uses unified queue');
assert.ok(queueSvc.includes("source: 'usdt_bank'"), 'queue maps usdt bank source');
assert.ok(queueSvc.includes("source: 'mmk_wallet'"), 'queue maps mmk wallet source');
assert.ok(queueSvc.includes("payoutMethod: 'bank'"), 'queue filters USDT bank payouts');
assert.ok(usdtModel.includes('payoutMethod'), 'UsdtWithdrawal.listAll supports payoutMethod');
assert.ok(adminJs.includes("source === 'usdt_bank'"), 'admin UI routes usdt_bank actions');
assert.ok(adminJs.includes('data-source='), 'admin UI stamps data-source on actions');
assert.ok(adminHtml.includes('WB-*'), 'admin HTML documents WB refs');
assert.ok(ledgerSvc.includes("LOWER(COALESCE(w.payout_method, '')) = 'bank'"), 'ledger history includes USDT bank');

async function runDbIntegration() {
  const tmpDb = path.join(os.tmpdir(), `eisy-mmk-queue-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${tmpDb}`;
  process.env.DATABASE_AUTH_TOKEN = '';
  // Avoid colliding with a running server's env
  delete require.cache[require.resolve('../src/db')];

  const { initDb, getDb, closeDb } = require('../src/db');
  await initDb();

  const db = getDb();
  // Minimal user
  const userResult = await db.run(
    `INSERT INTO users (name, email, phone, balance_mmk, balance_usdt, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    'Queue Test User',
    `queue-test-${Date.now()}@example.com`,
    '0999000111',
    500000,
    100,
    'x'
  );
  const userId = userResult.lastID;

  // Seed a WB-* USDT bank withdrawal (Sell USDT → MMK bank)
  await db.run(
    `INSERT INTO usdt_withdrawal_requests (
      user_id, ref_code, payout_method, amount_usdt, fee_usdt, net_usdt, fee_type,
      exchange_rate, amount_mmk, bank_name, account_name, account_number,
      status, created_at, updated_at
    ) VALUES (?, 'WB-4946', 'bank', 20, 1, 19, 'fixed', 4500, 85500,
      'KBZ Bank', 'Test Holder', '09123456789', 'pending', datetime('now'), datetime('now'))`,
    userId
  );

  // Seed a WM-* MMK wallet withdrawal
  await db.run(
    `INSERT INTO mmk_withdrawal_requests (
      user_id, ref_code, amount_mmk, fee_mmk, net_mmk, fee_percent,
      bank_name, account_name, account_number, status, created_at, updated_at
    ) VALUES (?, 'WM-1001', 50000, 0, 50000, 0,
      'WavePay', 'Wave User', '0999888777', 'pending', datetime('now'), datetime('now'))`,
    userId
  );

  delete require.cache[require.resolve('../src/services/mmkBankPayoutQueueService')];
  delete require.cache[require.resolve('../src/models/MmkWithdrawal')];
  delete require.cache[require.resolve('../src/models/UsdtWithdrawal')];

  const { listMmkBankPayoutQueue } = require('../src/services/mmkBankPayoutQueueService');
  const open = await listMmkBankPayoutQueue({ status: 'open', limit: 100 });
  const refs = open.map((r) => r.ref_code);
  assert.ok(refs.includes('WB-4946'), 'open queue includes WB-4946 USDT→bank');
  assert.ok(refs.includes('WM-1001'), 'open queue includes WM-1001 MMK wallet');

  const wb = open.find((r) => r.ref_code === 'WB-4946');
  assert.strictEqual(wb.source, 'usdt_bank');
  assert.strictEqual(wb.net_mmk, 85500);
  assert.strictEqual(wb.bank_name, 'KBZ Bank');
  assert.ok(wb.user_name);

  const { listMmkWithdrawalAdminTransactions } = require('../src/services/adminLedgerTransactionService');
  const history = await listMmkWithdrawalAdminTransactions({ limit: 100 });
  const histRefs = history.map((r) => r.ref_code);
  assert.ok(histRefs.includes('WB-4946'), 'tx history includes WB-4946');
  assert.ok(histRefs.includes('WM-1001'), 'tx history includes WM-1001');

  await closeDb();
  try { fs.unlinkSync(tmpDb); } catch (_) {}
  console.log('MMK bank payout queue includes WB-* + WM-* — ok');
}

runDbIntegration().catch((err) => {
  console.error(err);
  process.exit(1);
});
