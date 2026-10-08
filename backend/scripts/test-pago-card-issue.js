#!/usr/bin/env node
'use strict';

/**
 * Pago Card issue, refund, and top-up against a temporary sqlite file.
 * Run: node backend/scripts/test-pago-card-issue.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dbFile = path.join('/tmp', 'eisy-pago-card-issue.db');
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* fresh file */ }
}

process.env.DATABASE_URL = `file:${dbFile}`;
process.env.TURSO_DATABASE_URL = '';
process.env.TURSO_AUTH_TOKEN = '';
process.env.DATABASE_AUTH_TOKEN = '';
process.env.SUPABASE_URL = 'off';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';

const root = path.join(__dirname, '../..');
const { initDb, closeDb, getDb } = require('../src/db');
const User = require('../src/models/User');
const {
  issuePagoCardForUser,
  topUpPagoCard,
} = require('../src/services/pagoCardService');

function sampleCard(overrides = {}) {
  return {
    card_id: 'card_pago_1',
    product_code: 'us_493_visa_bin_v2',
    brand: 'visa',
    type: 'virtual',
    currency: 'USD',
    status: 'active',
    name_on_card: 'Test User',
    email: 'pago-issue@example.com',
    last_four: '4242',
    expiry_month: '12',
    expiry_year: '30',
    balance: { amount: 10_000_000, display_amount: 10, currency: 'USD' },
    card_number: '4111111111114242',
    cvv: '123',
    created_at: '2026-10-07T00:00:00Z',
    ...overrides,
  };
}

async function balanceOf(userId) {
  const row = await getDb().get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  return Number(row.balance_usdt || 0);
}

async function run() {
  const indexHtml = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
  const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'supabase/pago_card_columns.sql'), 'utf8');
  const appSchema = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
  assert.ok(schema.includes('pago_card_id'), 'supabase alter adds pago_card_id');
  assert.ok(schema.includes('pago_status'), 'supabase alter adds pago_status');
  assert.ok(appSchema.includes('pago_card_id TEXT'), 'fresh schema includes pago_card_id');
  assert.ok(indexHtml.includes('id="pagoCardRequestForm"'), 'request form exists');
  assert.ok(indexHtml.includes('data-page="cards"'), 'cards page exists');
  assert.ok(dash.includes("'/api/user/cards/request'"), 'request calls the Pago route');
  assert.ok(dash.includes('/api/user/cards/${cardId}/topup') || dash.includes('/api/user/cards/${cardId}/topup'.replace('cardId', 'cardId')), 'top-up route');
  assert.ok(dash.includes('`/api/user/cards/${cardId}/topup`'), 'reload and top-up use the Pago route');
  assert.ok(!dash.includes("page === 'cards'") || dash.includes('prefillPagoCardRequest'), 'cards page stays open');

  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  process.env.SUPABASE_URL = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';
  resetSupabaseClientForTests();

  await initDb();
  process.env.SUPABASE_URL = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';
  resetSupabaseClientForTests();
  const db = getDb();
  const cols = await db.all('PRAGMA table_info(cards_v2)');
  const names = new Set(cols.map((col) => col.name));
  for (const name of ['pago_card_id', 'pago_status', 'product_code', 'brand', 'last_four', 'balance_display_usd']) {
    assert.ok(names.has(name), `cards_v2.${name} exists`);
  }

  const stamp = Date.now();
  const user = await User.create({
    name: 'Pago Tester',
    phone: `9${String(stamp).slice(-9)}`,
    email: `pago-issue-${stamp}@example.com`,
    pinHash: null,
  });
  await db.run('UPDATE users SET balance_usdt = 100 WHERE id = ?', user.id);

  let calls = 0;
  let detailCalls = 0;
  const client = {
    async createVirtualCard(input) {
      calls += 1;
      assert.strictEqual(input.product_code, 'us_493_visa_bin_v2');
      assert.strictEqual(input.initial_load, 10.12);
      // Provider create often omits PAN/CVV — local save must enrich via getCardDetails.
      return sampleCard({ card_number: null, cvv: null, status: 'active' });
    },
    async getCardDetails(cardId) {
      detailCalls += 1;
      assert.strictEqual(cardId, 'card_pago_1');
      return sampleCard({
        status: 'normal',
        card_number: '4111111111114242',
        cardnumber: '4111111111114242',
        cvv: '123',
        expiredate: '12/30',
      });
    },
    async topUpCard(cardId, amount) {
      assert.strictEqual(cardId, 'card_pago_1');
      assert.ok(amount >= 5);
      return {
        card_id: 'card_pago_1',
        amount: 5_000_000,
        display_amount: 15,
        currency: 'USD',
        status: 'active',
        transaction_id: 'txn_pago_1',
      };
    },
  };

  const issued = await issuePagoCardForUser({
    userId: user.id,
    productCode: 'us_493_visa_bin_v2',
    firstName: 'Pago',
    lastName: 'Tester',
    email: user.email,
    initialLoad: 10.129,
  }, { client });
  assert.strictEqual(calls, 1);
  assert.strictEqual(detailCalls, 1, 'create without PAN/CVV must call getCardDetails');
  assert.strictEqual(issued.card.pago_card_id, 'card_pago_1');
  assert.strictEqual(issued.card.provider, 'pago');
  assert.strictEqual(issued.card.status, 'active');
  assert.strictEqual(issued.card.last_four, '4242');
  assert.strictEqual(issued.card.product_code, 'us_493_visa_bin_v2');
  assert.strictEqual(issued.card.card_number, '4111111111114242');
  assert.strictEqual(issued.card.cvv, '123');
  assert.strictEqual(issued.card.exp_date, '12/30');
  assert.strictEqual(issued.card.expiry_month, '12');
  assert.strictEqual(issued.card.expiry_year, '30');
  assert.strictEqual(Number(issued.card.balance_display_usd), 10);
  assert.strictEqual(issued.debited_usdt, 10.12);
  assert.strictEqual(await balanceOf(user.id), 89.88);

  const failing = {
    async createVirtualCard() {
      const err = new Error('provider down');
      err.code = 'PAGO_REQUEST_FAILED';
      err.status = 502;
      throw err;
    },
  };
  await assert.rejects(
    () => issuePagoCardForUser({
      userId: user.id,
      productCode: '536_master',
      firstName: 'Pago',
      lastName: 'Tester',
      email: user.email,
      initialLoad: 10,
    }, { client: failing }),
    (err) => err.code === 'PAGO_REQUEST_FAILED'
  );
  assert.strictEqual(await balanceOf(user.id), 89.88, 'failed issue refunds the wallet');

  await assert.rejects(
    () => issuePagoCardForUser({
      userId: user.id,
      productCode: 'us_493_visa_atm',
      firstName: 'Pago',
      lastName: 'Tester',
      email: user.email,
      initialLoad: 10,
    }, { client }),
    (err) => err.code === 'VALIDATION_ERROR'
  );
  assert.strictEqual(await balanceOf(user.id), 89.88, 'rejected ATM load does not debit');

  const topped = await topUpPagoCard({
    userId: user.id,
    localCardId: issued.card.id,
    amountUsd: 10,
  }, { client });
  assert.strictEqual(topped.funded_usd, 10);
  assert.ok(topped.debited_usdt >= 10);
  assert.strictEqual(topped.transaction_id, 'txn_pago_1');
  assert.strictEqual(Number(topped.card.balance_display_usd), 15);
  assert.strictEqual(await balanceOf(user.id), Math.round((89.88 - topped.debited_usdt) * 100) / 100);

  // Missing Pago columns (prod Turso drift) must be repaired by the ensure patch.
  const { ensurePagoCardColumns, PAGO_CARD_COLUMNS } = require('../migrations/patches/ensurePagoCardColumns');
  const { columnExists, tableExists } = require('../migrations/runner');
  await db.exec('DROP VIEW IF EXISTS active_cards');
  await db.exec('DROP TABLE cards_v2');
  await db.exec(`
    CREATE TABLE cards_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_number TEXT NOT NULL,
      exp_date TEXT NOT NULL,
      cvv TEXT NOT NULL,
      card_holder_name TEXT NOT NULL,
      card_type TEXT DEFAULT 'virtual',
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'pending',
      is_primary INTEGER DEFAULT 0,
      issued_by_admin_id INTEGER,
      admin_notes TEXT,
      daily_limit_usd REAL,
      metadata TEXT,
      activated_at TEXT,
      cancelled_at TEXT,
      suspended_at TEXT,
      status_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  assert.strictEqual(await columnExists(db, 'cards_v2', 'pago_card_id'), false);
  await ensurePagoCardColumns(db, columnExists, tableExists);
  for (const [name] of PAGO_CARD_COLUMNS) {
    assert.ok(await columnExists(db, 'cards_v2', name), `ensure adds cards_v2.${name}`);
  }

  const repairedClient = {
    async createVirtualCard() {
      return sampleCard({
        card_id: 'card_pago_repaired',
        card_number: '4937241043245430',
        cvv: '298',
        status: 'normal',
      });
    },
    async getCardDetails() {
      throw new Error('should not be called when PAN/CVV already present');
    },
  };
  const repaired = await issuePagoCardForUser({
    userId: user.id,
    productCode: 'us_404_visa_bin',
    firstName: 'Pago',
    lastName: 'Tester',
    email: user.email,
    initialLoad: 10,
  }, { client: repairedClient });
  assert.strictEqual(repaired.card.pago_card_id, 'card_pago_repaired');
  assert.strictEqual(repaired.card.status, 'active', 'Pago status normal maps to active');
  assert.strictEqual(repaired.card.card_number, '4937241043245430');
  assert.strictEqual(repaired.card.cvv, '298');
  assert.strictEqual(Number(repaired.card.balance_display_usd), 10);

  console.log('pago card issue checks passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await closeDb(); } catch (_) { /* ignore */ }
  });
