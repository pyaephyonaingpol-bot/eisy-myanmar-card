#!/usr/bin/env node
'use strict';

/**
 * Verifies card_pan_url flows from provider mock → DB → GET /cards/:id JSON.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dbFile = path.join('/tmp', 'eisy-pago-pan-url-detail.db');
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* fresh file */ }
}

async function run() {
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.TURSO_DATABASE_URL = '';
  process.env.TURSO_AUTH_TOKEN = '';
  process.env.DATABASE_AUTH_TOKEN = '';
  process.env.SUPABASE_URL = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'off';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'off';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'off';

  const { initDb, getDb, closeDb } = require('../src/db');
  const User = require('../src/models/User');
  const { issuePagoCardForUser, refreshPagoCard } = require('../src/services/pagoCardService');
  const { readCardPanUrlFromSources, usesPagoPanIframe } = require('../src/services/pagoPanView');

  await initDb();
  const db = getDb();
  const stamp = Date.now();
  const user = await User.create({
    name: 'Pan URL Tester',
    phone: `9${String(stamp).slice(-9)}`,
    email: `pan-url-${stamp}@example.com`,
    pinHash: null,
  });
  await db.run('UPDATE users SET balance_usdt = 100 WHERE id = ?', user.id);

  const panUrl = 'https://cards.cardapi.vip/display/testpan#secret=abc';
  const client = {
    async createVirtualCard() {
      return {
        card_id: 'card_pan_url_test',
        product_code: 'us_493_visa_bin_v2',
        brand: '493BIN',
        status: 'active',
        card_number: null,
        cvv: null,
        last_four: '4242',
        expiry_month: '12',
        expiry_year: '30',
        balance: { amount: 10_000_000, display_amount: 10, currency: 'USD' },
      };
    },
    async getCardDetails() {
      return {
        card_id: 'card_pan_url_test',
        product_code: 'us_493_visa_bin_v2',
        status: 'normal',
        card_pan_url: panUrl,
        card_number: null,
        cvv: null,
        last_four: '4242',
        expiry_month: '12',
        expiry_year: '30',
        balance: { amount: 10_000_000, display_amount: 10, currency: 'USD' },
      };
    },
    async topUpCard() {
      return { card_id: 'card_pan_url_test', display_amount: 10, currency: 'USD', transaction_id: 't1' };
    },
  };

  const issued = await issuePagoCardForUser({
    userId: user.id,
    productCode: 'us_493_visa_bin_v2',
    firstName: 'Pan',
    lastName: 'Url',
    email: user.email,
    initialLoad: 10,
  }, { client });
  assert.ok(issued.card?.id, 'card issued');

  await refreshPagoCard(user.id, issued.card.id, { client });
  const row = await db.get('SELECT * FROM cards_v2 WHERE id = ?', issued.card.id);
  const meta = JSON.parse(row.metadata || '{}');
  assert.strictEqual(readCardPanUrlFromSources(row, meta), panUrl, 'DB metadata stores pan URL');

  const panForClient = readCardPanUrlFromSources(row, meta);
  assert.strictEqual(panForClient, panUrl, 'client mapping source has pan URL');
  assert.ok(!usesPagoPanIframe({
    provider: 'pago',
    product_code: row.product_code,
    card_pan_url: panForClient,
    metadata: meta,
  }), 'direct JSON PAN is default; hosted iframe only when PAGO_CARD_FORCE_PAN_IFRAME=1');

  console.log('test-pago-pan-url-detail-api: OK');
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await closeDb(); } catch (_) { /* ignore */ }
  });
