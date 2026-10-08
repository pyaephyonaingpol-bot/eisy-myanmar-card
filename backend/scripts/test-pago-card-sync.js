#!/usr/bin/env node
'use strict';

/**
 * Orphaned Pago card import: provider create succeeded, local row missing.
 * Run: node backend/scripts/test-pago-card-sync.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dbFile = path.join('/tmp', 'eisy-pago-card-sync.db');
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* fresh */ }
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
const Card = require('../src/models/Card');
const {
  issuePagoCardForUser,
  syncPagoCardsForUser,
  importPagoCardById,
} = require('../src/services/pagoCardService');

function sampleCard(overrides = {}) {
  return {
    card_id: 'card_01m47rt362cdphxm58vpjsnrx3',
    product_code: 'us_493_visa_bin_v2',
    brand: '493BIN',
    type: 'virtual',
    currency: 'USD',
    status: 'normal',
    name_on_card: 'Sync User',
    email: 'pago-sync@example.com',
    last_four: '1434',
    expiry_month: '08',
    expiry_year: '30',
    balance: { amount: 10_000_000, display_amount: 10, currency: 'USD' },
    card_number: '4937241043245430',
    cvv: '298',
    created_at: '2026-10-08T00:00:00Z',
    ...overrides,
  };
}

async function run() {
  const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');
  const clientSrc = fs.readFileSync(path.join(root, 'lib/pagocard.ts'), 'utf8');
  assert.ok(clientSrc.includes('listCardsByEmail'), 'client lists cards by email');
  assert.ok(clientSrc.includes('/api/v1/cards/getallcards'), 'uses getallcards endpoint');
  assert.ok(routes.includes("router.post('/cards/sync'"), 'sync route exists');
  assert.ok(dash.includes('syncPagoCardsFromProvider'), 'dashboard can sync orphans');
  assert.ok(dash.includes('reconcilePago: true'), 'cards page reconciles on open');
  assert.ok(dash.includes("err.code === 'PAGO_CARD_SAVE_FAILED'"), 'create failure imports orphan');

  const { resetSupabaseClientForTests } = require('../src/lib/supabase');
  resetSupabaseClientForTests();
  await initDb();
  resetSupabaseClientForTests();

  const stamp = Date.now();
  const user = await User.create({
    name: 'Sync User',
    phone: `9${String(stamp).slice(-9)}`,
    email: `pago-sync-${stamp}@example.com`,
    pinHash: null,
  });
  await getDb().run('UPDATE users SET balance_usdt = 50, email = ? WHERE id = ?', 'pago-sync@example.com', user.id);

  // Provider has the card; local DB does not.
  const orphanId = 'card_01m47rt362cdphxm58vpjsnrx3';
  const client = {
    async listCardsByEmail({ email, product_code }) {
      assert.strictEqual(email, 'pago-sync@example.com');
      if (product_code !== 'us_493_visa_bin_v2') return [];
      return [{
        cardid: orphanId,
        useremail: email,
        lastfour: '1434',
        brand: 'visa',
        type: 'virtual',
      }];
    },
    async getCardDetails(cardId) {
      assert.strictEqual(cardId, orphanId);
      return sampleCard();
    },
    async createVirtualCard() {
      throw new Error('should not create during sync');
    },
  };

  assert.ok(!(await Card.findByPagoCardId(orphanId)), 'orphan not local yet');

  const synced = await syncPagoCardsForUser(user.id, {}, { client });
  assert.strictEqual(synced.imported, 1);
  const row = await Card.findByPagoCardId(orphanId);
  assert.ok(row, 'orphaned Pago card saved locally');
  assert.strictEqual(Number(row.user_id), Number(user.id));
  assert.strictEqual(row.card_number, '4937241043245430');
  assert.strictEqual(row.cvv, '298');
  assert.strictEqual(row.status, 'active');
  assert.strictEqual(row.last_four, '1434');
  assert.strictEqual(Number(row.balance_display_usd), 10);

  // Idempotent re-sync updates, does not duplicate.
  const again = await syncPagoCardsForUser(user.id, {}, { client });
  assert.strictEqual(again.imported, 0);
  assert.ok(again.updated >= 1);
  const all = await Card.findByUserId(user.id);
  assert.strictEqual(all.filter((c) => c.pago_card_id === orphanId).length, 1);

  // Explicit import by id
  const otherId = 'card_01m47rt362cdphxm58vpjsnrx9';
  const importClient = {
    async getCardDetails(cardId) {
      assert.strictEqual(cardId, otherId);
      return sampleCard({ card_id: otherId, last_four: '9999', card_number: '4111111111119999' });
    },
  };
  const imported = await importPagoCardById(user.id, otherId, { client: importClient });
  assert.strictEqual(imported.pago_card_id, otherId);
  assert.strictEqual(imported.last_four, '9999');

  // Create path retries save after ensure columns + import fallback
  let createCalls = 0;
  const failingSaveClient = {
    async createVirtualCard() {
      createCalls += 1;
      return sampleCard({
        card_id: 'card_create_retry_1',
        card_number: null,
        cvv: null,
        status: 'active',
      });
    },
    async getCardDetails(cardId) {
      return sampleCard({
        card_id: cardId,
        card_number: '4111111111114242',
        cvv: '321',
        status: 'normal',
      });
    },
  };
  await getDb().run('UPDATE users SET balance_usdt = 50 WHERE id = ?', user.id);
  const issued = await issuePagoCardForUser({
    userId: user.id,
    productCode: 'us_404_visa_bin',
    firstName: 'Sync',
    lastName: 'User',
    email: 'pago-sync@example.com',
    initialLoad: 10,
  }, { client: failingSaveClient });
  assert.strictEqual(createCalls, 1);
  assert.strictEqual(issued.card.pago_card_id, 'card_create_retry_1');
  assert.strictEqual(issued.card.card_number, '4111111111114242');
  assert.strictEqual(issued.card.cvv, '321');

  console.log('pago card sync checks passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await closeDb(); } catch (_) { /* ignore */ }
  });
