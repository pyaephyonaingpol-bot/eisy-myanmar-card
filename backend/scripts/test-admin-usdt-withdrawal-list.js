#!/usr/bin/env node
/**
 * Admin USDT withdrawal list: default "pending" filter must include processing
 * (NOWPayments in-flight) so refs like WD-3723 remain visible.
 * Run: node backend/scripts/test-admin-usdt-withdrawal-list.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-admin-wd-list-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  const UsdtWithdrawal = require('../src/models/UsdtWithdrawal');

  await initDb();
  const db = getDb();

  const user = await db.run(
    `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 100)`,
    'Test User',
    '09123456789'
  );
  const userId = user.lastID;

  await db.run(`
    INSERT INTO usdt_withdrawal_requests (
      user_id, ref_code, payout_method, network, wallet_address,
      amount_usdt, fee_usdt, net_usdt, fee_type, status,
      payout_provider, nowpayments_payout_id
    ) VALUES
    (?, 'WD-PENDING', 'crypto', 'TRC20', 'Tpending', 10, 1, 9, 'fixed', 'pending', NULL, NULL),
    (?, 'WD-3723', 'crypto', 'TRC20', 'Tproc', 20, 1, 19, 'fixed', 'processing', 'nowpayments', 'np-batch-3723'),
    (?, 'WD-DONE', 'crypto', 'TRC20', 'Tdone', 5, 1, 4, 'fixed', 'completed', NULL, NULL)
  `, userId, userId, userId);

  const open = await UsdtWithdrawal.listAll({ status: 'pending' });
  const only = await UsdtWithdrawal.listAll({ status: 'pending_only' });
  const processing = await UsdtWithdrawal.listAll({ status: 'processing' });
  const all = await UsdtWithdrawal.listAll({ status: 'all' });

  assert.deepStrictEqual(
    open.map((r) => r.ref_code).sort(),
    ['WD-3723', 'WD-PENDING'],
    'default pending filter should include processing'
  );
  assert.deepStrictEqual(only.map((r) => r.ref_code), ['WD-PENDING']);
  assert.strictEqual(processing.length, 1);
  assert.strictEqual(processing[0].ref_code, 'WD-3723');
  assert.strictEqual(processing[0].nowpayments_payout_id, 'np-batch-3723');
  assert.strictEqual(all.length, 3);

  await closeDb().catch(() => {});
  console.log('test-admin-usdt-withdrawal-list: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
