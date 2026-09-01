#!/usr/bin/env node
/**
 * Schema: deposits/reloads are USDT-only at DB level; MMK remains on withdrawals.
 * Run: node backend/scripts/test-schema-usdt-only-currency.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testMigrationArtifacts() {
  section('Migration 050 tightens deposit/reload currency enums');
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/050_schema_usdt_only_currency.sql'), 'utf8');
  assert.ok(sql.includes("CHECK(deposit_currency IN ('USDT'))"));
  assert.ok(sql.includes("CHECK(wallet_type IN ('usdt'))"));
  assert.ok(sql.includes("DELETE FROM app_settings WHERE key = 'minimum_card_reload_mmk'"));
  assert.ok(sql.includes('legacy_mmk_deposit'));
  assert.ok(sql.includes('legacy_mmk_reload'));
  console.log('ok');
}

async function testDatabaseConstraints() {
  section('SQLite CHECK constraints and triggers reject MMK deposit/reload rows');
  const dbFile = path.join(os.tmpdir(), `eisy-schema-usdt-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const applied = await db.get(
    "SELECT name FROM schema_migrations WHERE name = '050_schema_usdt_only_currency.sql'"
  );
  assert.ok(applied, 'migration 050 must be applied');

  const minReload = await db.get(
    "SELECT 1 AS ok FROM app_settings WHERE key = 'minimum_card_reload_mmk'"
  );
  assert.strictEqual(minReload, undefined, 'minimum_card_reload_mmk setting removed');

  const user = await db.run(
    'INSERT INTO users (name, phone, balance_mmk, balance_usdt) VALUES (?, ?, 0, 100)',
    'Schema Test',
    `09${String(Date.now()).slice(-8)}`
  );
  const userId = Number(user.lastID);

  const card = await db.run(
    `INSERT INTO cards_v2 (
      user_id, card_number, exp_date, cvv, card_holder_name, status
    ) VALUES (?, ?, '12/30', '123', 'Schema Test', 'active')`,
    userId,
    `4111${String(Date.now()).slice(-12)}`
  );
  const cardId = Number(card.lastID);

  let mmkDepositErr = null;
  try {
    await db.run(
      `INSERT INTO deposit_requests_v2 (
        user_id, amount_mmk, amount_usd, ref_code, payment_method, deposit_currency, purpose
      ) VALUES (?, 50000, 10, ?, 'KBZPay', 'MMK', 'topup')`,
      userId,
      `REF-MMK-${Date.now()}`
    );
  } catch (err) {
    mmkDepositErr = err;
  }
  assert.ok(mmkDepositErr, 'MMK deposit_currency insert must fail');
  assert.match(String(mmkDepositErr.message), /CHECK constraint failed|USDT_ONLY_DEPOSIT/i);

  let mmkReloadErr = null;
  try {
    await db.run(
      `INSERT INTO card_reload_requests (
        user_id, card_id, wallet_type, amount_mmk, net_usd_to_card
      ) VALUES (?, ?, 'mmk', 50000, 10)`,
      userId,
      cardId
    );
  } catch (err) {
    mmkReloadErr = err;
  }
  assert.ok(mmkReloadErr, 'mmk wallet_type insert must fail');
  assert.match(String(mmkReloadErr.message), /CHECK constraint failed|USDT_ONLY_CARD_RELOAD/i);

  const refCode = `REF-USDT-${Date.now()}`;
  const deposit = await db.run(
    `INSERT INTO deposit_requests_v2 (
      user_id, amount_mmk, amount_usd, ref_code, payment_method, deposit_currency, purpose
    ) VALUES (?, 0, 25, ?, 'USDT-TRC20', 'USDT', 'usdt_topup')`,
    userId,
    refCode
  );
  assert.ok(deposit.lastID, 'USDT deposit insert succeeds');

  const reload = await db.run(
    `INSERT INTO card_reload_requests (
      user_id, card_id, wallet_type, amount_usdt, net_usd_to_card, gross_usd
    ) VALUES (?, ?, 'usdt', 20, 20, 20)`,
    userId,
    cardId
  );
  assert.ok(reload.lastID, 'USDT card reload insert succeeds');

  const depositRow = await db.get('SELECT deposit_currency FROM deposit_requests_v2 WHERE id = ?', deposit.lastID);
  assert.strictEqual(depositRow.deposit_currency, 'USDT');

  const reloadRow = await db.get('SELECT wallet_type FROM card_reload_requests WHERE id = ?', reload.lastID);
  assert.strictEqual(reloadRow.wallet_type, 'usdt');

  const mmkWithdraw = await db.run(
    `INSERT INTO mmk_withdrawal_requests (
      user_id, ref_code, amount_mmk, fee_mmk, net_mmk, bank_name, account_number, account_name, status
    ) VALUES (?, ?, 10000, 500, 9500, 'KBZ', '123456', 'Schema Test', 'pending')`,
    userId,
    `WD-MMK-${Date.now()}`
  );
  assert.ok(mmkWithdraw.lastID, 'MMK withdrawal table still accepts MMK amounts');

  await closeDb();
  console.log('ok');
}

async function main() {
  testMigrationArtifacts();
  await testDatabaseConstraints();
  console.log('\nSchema USDT-only currency — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
