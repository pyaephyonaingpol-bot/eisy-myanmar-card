#!/usr/bin/env node
/**
 * Reveal/refresh must retry and soft-fail "Unable to retrieve card."
 * Run: node backend/scripts/test-pago-reveal-retrieve.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-pago-reveal-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) {
    if (/SUPABASE/i.test(key)) delete process.env[key];
  }

  const { initDb, closeDb } = require('../src/db');
  const User = require('../src/models/User');
  const Card = require('../src/models/Card');
  const {
    refreshPagoCard,
    isPagoRetrieveFailure,
    isCardProviderSoftError,
  } = require('../src/services/pagoCardService');

  await initDb();
  const stamp = Date.now();
  const user = await User.create({
    name: 'Reveal Tester',
    phone: `9${String(stamp).slice(-9)}`,
    email: `reveal-${stamp}@gmail.com`,
    pinHash: null,
  });

  const row = await Card.createFromPago({
    userId: user.id,
    pagoCardId: 'card_reveal_retry_1',
    productCode: 'us_404_visa_bin',
    brand: '404BIN',
    status: 'active',
    pagoStatus: 'normal',
    cardNumber: null,
    cvv: null,
    lastFour: '4242',
    expiryMonth: '08',
    expiryYear: '2030',
    cardHolderName: 'Reveal Tester',
    email: user.email,
    balanceDisplayUsd: 10,
  });

  let attempts = 0;
  const client = {
    async getCardDetails() {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('Unable to retrieve card.');
        err.code = 'PAGO_REQUEST_FAILED';
        err.status = 404;
        throw err;
      }
      return {
        card_id: 'card_reveal_retry_1',
        product_code: 'us_404_visa_bin',
        status: 'normal',
        card_number: '4111111111111111',
        cvv: '123',
        last_four: '1111',
        expiry_month: '08',
        expiry_year: '2030',
        balance: { amount: 10_000_000, display_amount: 10, currency: 'USD' },
      };
    },
  };

  assert.strictEqual(isPagoRetrieveFailure({ message: 'Unable to retrieve card.' }), true);
  assert.strictEqual(isCardProviderSoftError({ message: 'Unable to retrieve card.', status: 404 }), true);

  const updated = await refreshPagoCard(user.id, row.id, { client, refreshAttempts: 3 });
  assert.strictEqual(attempts, 3, 'should retry retrieve failures');
  assert.ok(String(updated.card_number || '').includes('4111111111111111')
    || String(updated.card_number || '').replace(/\D/g, '').length >= 12);

  const clientSrc = fs.readFileSync(path.join(__dirname, '../../lib/pagocard.ts'), 'utf8');
  assert.ok(clientSrc.includes('withJsonContentType'));
  assert.ok(clientSrc.includes('Only set Content-Type when sending a JSON body'));

  console.log('test-pago-reveal-retrieve: OK');
  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch (_) {}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
