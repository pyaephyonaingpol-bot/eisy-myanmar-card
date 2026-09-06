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

const withdrawalSvc = fs.readFileSync(path.join(ROOT, 'backend/src/services/withdrawalService.js'), 'utf8');

assert.ok(adminRoutes.includes('listMmkBankPayoutQueue'), 'admin GET mmk uses unified queue');
assert.ok(adminRoutes.includes('completeMmkBankPayout'), 'admin complete uses source-aware helper');
assert.ok(adminRoutes.includes('rejectMmkBankPayout'), 'admin reject uses source-aware helper');
assert.ok(queueSvc.includes("source: 'usdt_bank'"), 'queue maps usdt bank source');
assert.ok(queueSvc.includes("source: 'mmk_wallet'"), 'queue maps mmk wallet source');
assert.ok(queueSvc.includes('queue_key:'), 'queue stamps composite queue_key');
assert.ok(queueSvc.includes("payoutMethod: 'bank'"), 'queue filters USDT bank payouts');
assert.ok(usdtModel.includes('payoutMethod'), 'UsdtWithdrawal.listAll supports payoutMethod');
assert.ok(withdrawalSvc.includes('async function completeMmkBankPayout'), 'completeMmkBankPayout exists');
assert.ok(withdrawalSvc.includes('async function rejectMmkBankPayout'), 'rejectMmkBankPayout exists');
assert.ok(adminJs.includes("source === 'usdt_bank'"), 'admin UI routes usdt_bank actions');
assert.ok(adminJs.includes('data-source='), 'admin UI stamps data-source on actions');
assert.ok(adminJs.includes('data-queue-key='), 'admin UI stamps data-queue-key on actions');
assert.ok(adminJs.includes("formData.append('source'"), 'proof modal sends source');
assert.ok(adminJs.includes("formData.append('queue_key'"), 'proof modal sends queue_key');
assert.ok(adminHtml.includes('wdProofSource'), 'proof modal has source field');
assert.ok(adminHtml.includes('wdProofQueueKey'), 'proof modal has queue_key field');
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
  assert.strictEqual(wb.queue_key, `usdt_bank:${wb.id}`);
  assert.strictEqual(wb.net_mmk, 85500);
  assert.strictEqual(wb.bank_name, 'KBZ Bank');
  assert.ok(wb.user_name);

  const wm = open.find((r) => r.ref_code === 'WM-1001');
  assert.strictEqual(wm.source, 'mmk_wallet');
  assert.strictEqual(wm.queue_key, `mmk_wallet:${wm.id}`);

  const { listMmkWithdrawalAdminTransactions } = require('../src/services/adminLedgerTransactionService');
  const history = await listMmkWithdrawalAdminTransactions({ limit: 100 });
  const histRefs = history.map((r) => r.ref_code);
  assert.ok(histRefs.includes('WB-4946'), 'tx history includes WB-4946');
  assert.ok(histRefs.includes('WM-1001'), 'tx history includes WM-1001');

  // Complete/reject must route by source — numeric IDs collide across tables.
  delete require.cache[require.resolve('../src/services/withdrawalService')];
  const {
    completeMmkBankPayout,
    rejectMmkBankPayout,
    completeMmkWithdrawal,
    parseMmkBankQueueKey,
    normalizeMmkBankPayoutSource,
  } = require('../src/services/withdrawalService');

  assert.deepStrictEqual(parseMmkBankQueueKey('usdt_bank:42'), { source: 'usdt_bank', id: 42 });
  assert.strictEqual(normalizeMmkBankPayoutSource('wb'), 'usdt_bank');
  assert.strictEqual(normalizeMmkBankPayoutSource('wm'), 'mmk_wallet');

  // Bug class A: numeric ID collision — WB id often equals an unrelated WM id.
  // ID-only completeMmkWithdrawal would mutate the wrong table/row.
  assert.strictEqual(wb.id, wm.id, 'seed uses colliding autoincrement ids across tables');
  const collided = await completeMmkWithdrawal(wb.id, { adminNote: 'WRONG ROW if used for WB' });
  assert.strictEqual(collided.ref_code, 'WM-1001', 'ID-only path hits mmk table, not WB');
  // Reset WM so the source-aware path can complete it later.
  await db.run(
    `UPDATE mmk_withdrawal_requests SET status = 'pending', admin_note = NULL, processed_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    wm.id
  );

  // Bug class B: WB id with no twin in mmk_withdrawal_requests → "MMK withdrawal not found".
  const wbOnly = await db.run(
    `INSERT INTO usdt_withdrawal_requests (
      user_id, ref_code, payout_method, amount_usdt, fee_usdt, net_usdt, fee_type,
      exchange_rate, amount_mmk, bank_name, account_name, account_number,
      status, created_at, updated_at
    ) VALUES (?, 'WB-ORPHAN', 'bank', 5, 0.5, 4.5, 'fixed', 4500, 20250,
      'KBZ Bank', 'Orphan', '0911111111', 'pending', datetime('now'), datetime('now'))`,
    userId
  );
  let threw = false;
  try {
    await completeMmkWithdrawal(wbOnly.lastID, { adminNote: 'should fail' });
  } catch (err) {
    threw = true;
    assert.ok(
      /MMK withdrawal not found/i.test(err.message),
      `expected MMK not-found, got: ${err.message}`
    );
  }
  assert.ok(threw, 'ID-only MMK complete must fail when WB id has no mmk twin');

  // Fixed path: source/queue_key selects usdt_withdrawal_requests.
  const completedWb = await completeMmkBankPayout({
    id: wb.id,
    source: 'usdt_bank',
    queueKey: wb.queue_key,
    adminNote: 'Paid via KBZ',
  });
  assert.strictEqual(completedWb.ref_code, 'WB-4946');
  assert.strictEqual(String(completedWb.status).toLowerCase(), 'completed');

  const completedOrphan = await completeMmkBankPayout({
    id: wbOnly.lastID,
    source: 'usdt_bank',
    queueKey: `usdt_bank:${wbOnly.lastID}`,
    adminNote: 'Paid orphan WB',
  });
  assert.strictEqual(completedOrphan.ref_code, 'WB-ORPHAN');
  assert.strictEqual(String(completedOrphan.status).toLowerCase(), 'completed');

  // Seed another WB row to exercise reject routing.
  const wb2 = await db.run(
    `INSERT INTO usdt_withdrawal_requests (
      user_id, ref_code, payout_method, amount_usdt, fee_usdt, net_usdt, fee_type,
      exchange_rate, amount_mmk, bank_name, account_name, account_number,
      status, created_at, updated_at
    ) VALUES (?, 'WB-4947', 'bank', 10, 1, 9, 'fixed', 4500, 40500,
      'KPay', 'Reject Me', '0999111222', 'pending', datetime('now'), datetime('now'))`,
    userId
  );
  const rejectedWb = await rejectMmkBankPayout({
    id: wb2.lastID,
    source: 'usdt_bank',
    queueKey: `usdt_bank:${wb2.lastID}`,
    adminNote: 'Bad account',
  });
  assert.strictEqual(rejectedWb.ref_code, 'WB-4947');
  assert.ok(/reject/i.test(String(rejectedWb.status)), `expected rejected, got ${rejectedWb.status}`);

  const completedWm = await completeMmkBankPayout({
    id: wm.id,
    source: 'mmk_wallet',
    queueKey: wm.queue_key,
    adminNote: 'WavePay sent',
  });
  assert.strictEqual(completedWm.ref_code, 'WM-1001');
  assert.strictEqual(String(completedWm.status).toLowerCase(), 'completed');

  await closeDb();
  try { fs.unlinkSync(tmpDb); } catch (_) {}
  console.log('MMK bank payout queue + source-aware complete/reject — ok');
}

runDbIntegration().catch((err) => {
  console.error(err);
  process.exit(1);
});
