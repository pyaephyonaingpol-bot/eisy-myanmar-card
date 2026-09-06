#!/usr/bin/env node
/**
 * Regression: admin Transaction History MMK tab must survive drifted
 * mmk_withdrawal_requests schemas (missing fee_percent / processed_at).
 *
 * Run: node backend/scripts/test-admin-mmk-tx-schema-drift.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-admin-mmk-tx-drift-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  const { listMmkWithdrawalAdminTransactions } = require('../src/services/adminLedgerTransactionService');
  const { ensureMmkWithdrawalColumns } = require('../migrations/patches/ensureMmkWithdrawalColumns');
  const { columnExists, tableExists } = require('../migrations/runner');

  await initDb();
  const db = getDb();

  // Simulate an older production table missing newer columns.
  await db.exec('DROP TABLE IF EXISTS mmk_withdrawal_requests');
  await db.exec(`
    CREATE TABLE mmk_withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ref_code TEXT UNIQUE NOT NULL,
      amount_mmk REAL NOT NULL,
      fee_mmk REAL NOT NULL DEFAULT 0,
      net_mmk REAL NOT NULL,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  assert.strictEqual(await columnExists(db, 'mmk_withdrawal_requests', 'fee_percent'), false);
  assert.strictEqual(await columnExists(db, 'mmk_withdrawal_requests', 'processed_at'), false);

  // Seed a row before columns are patched.
  const earlyUser = await db.run(
    `INSERT INTO users (name, phone, email) VALUES (?, ?, ?)`,
    'Early MMK User',
    '0999000222',
    'mmk-early@example.com'
  );
  await db.run(
    `INSERT INTO mmk_withdrawal_requests
      (user_id, ref_code, amount_mmk, fee_mmk, net_mmk,
       bank_name, account_name, account_number, status, created_at)
     VALUES (?, 'WM-EARLY-1', 10000, 0, 10000,
       'CB', 'Early User', '0999888777', 'pending', datetime('now'))`,
    earlyUser.lastID
  );

  // Resilient SELECT w.* query must succeed even before the schema patch.
  const earlyRows = await listMmkWithdrawalAdminTransactions({ limit: 50 });
  assert.ok(earlyRows.some((r) => r.ref_code === 'WM-EARLY-1'), 'pre-patch list should work');

  // Explicit-column query (old code) must fail on this schema.
  let explicitFailed = false;
  try {
    await db.all(`
      SELECT w.id, w.fee_percent, w.processed_at, w.admin_note
      FROM mmk_withdrawal_requests w
      ORDER BY COALESCE(w.processed_at, w.created_at) DESC
      LIMIT 5
    `);
  } catch (err) {
    explicitFailed = true;
    assert.match(String(err.message), /no such column/i);
  }
  assert.ok(explicitFailed, 'expected explicit-column query to fail on drifted schema');

  // Boot-time patch should add missing columns.
  await ensureMmkWithdrawalColumns(db, columnExists, tableExists);
  assert.strictEqual(await columnExists(db, 'mmk_withdrawal_requests', 'fee_percent'), true);
  assert.strictEqual(await columnExists(db, 'mmk_withdrawal_requests', 'processed_at'), true);
  assert.strictEqual(await columnExists(db, 'mmk_withdrawal_requests', 'admin_note'), true);

  const user = await db.run(
    `INSERT INTO users (name, phone, email) VALUES (?, ?, ?)`,
    'MMK Drift User',
    '0999000111',
    'mmk-drift@example.com'
  );
  const userId = user.lastID;

  await db.run(
    `INSERT INTO mmk_withdrawal_requests
      (user_id, ref_code, amount_mmk, fee_mmk, net_mmk, fee_percent,
       bank_name, account_name, account_number, status, admin_note, created_at)
     VALUES (?, 'WM-DRIFT-1', 50000, 1000, 49000, 2,
       'KBZ', 'Drift User', '0912345678', 'pending', 'note', datetime('now'))`,
    userId
  );

  const rows = await listMmkWithdrawalAdminTransactions({ userId, limit: 50 });
  assert.ok(rows.length >= 1, 'expected MMK withdrawal row');
  const row = rows.find((r) => r.ref_code === 'WM-DRIFT-1');
  assert.ok(row, 'WM-DRIFT-1 missing');
  assert.strictEqual(row.category, 'mmk_withdrawal');
  assert.strictEqual(row.amount_mmk, 50000);
  assert.strictEqual(row.fee_mmk, 1000);
  assert.strictEqual(row.net_mmk, 49000);
  assert.strictEqual(row.fee_percent, 2);
  assert.strictEqual(row.bank_name, 'KBZ');

  // Even if processed_at were somehow absent again, SELECT w.* + created_at order must work.
  const resilient = await db.all(`
    SELECT w.*, u.name AS user_name
    FROM mmk_withdrawal_requests w
    LEFT JOIN users u ON u.id = w.user_id
    ORDER BY w.created_at DESC
    LIMIT 5
  `);
  assert.ok(resilient.length >= 1);

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) {}
  console.log('ADMIN MMK TX SCHEMA DRIFT GUARD PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
