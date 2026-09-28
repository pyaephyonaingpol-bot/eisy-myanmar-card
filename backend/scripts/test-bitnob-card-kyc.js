#!/usr/bin/env node
/**
 * Bitnob Card KYC finalize checks for the Standard pipeline:
 *   - client + service + migration + routes
 *   - platform KYC → Bitnob customer_id wiring
 *   - Standard FE readiness (no mock toast/demo leftovers)
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function testModulesExist() {
  section('Bitnob Card KYC modules present');
  const files = [
    'lib/bitnob.js',
    'backend/src/services/bitnobKycService.js',
    'backend/migrations/062_bitnob_card_kyc.sql',
    'backend/src/routes/standardCard.js',
    'backend/public/src/services/standardCardApi.js',
    'backend/public/src/components/standardCardView.js',
    'backend/public/src/components/standardAppView.js',
  ];
  for (const rel of files) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`);
  }
  console.log('ok');
}

function testBitnobClientExports() {
  section('bitnob client exports Card KYC helpers');
  const bitnob = require(path.join(ROOT, 'lib/bitnob'));
  assert.equal(typeof bitnob.submitCardKyc, 'function');
  assert.equal(typeof bitnob.getCardKycStatus, 'function');
  console.log('ok');
}

function testKycServiceMapping() {
  section('bitnobKycService maps NRC/Passport and public status');
  const svc = require(path.join(ROOT, 'backend/src/services/bitnobKycService'));
  assert.equal(svc.mapPlatformIdType('NRC'), 'national_id');
  assert.equal(svc.mapPlatformIdType('Passport'), 'passport');
  assert.equal(svc.mapPlatformIdType('PASSPORT'), 'passport');
  assert.deepEqual(svc.splitFullName('Aung Min'), { first_name: 'Aung', last_name: 'Min' });

  const ready = svc.getBitnobKycPublicStatus({
    bitnob_customer_id: 'cust_1',
    bitnob_kyc_status: 'approved',
  });
  assert.equal(ready.can_issue_standard_card, true);
  assert.equal(ready.customer_ready, true);

  const pending = svc.getBitnobKycPublicStatus({
    bitnob_customer_id: 'cust_2',
    bitnob_kyc_status: 'pending',
  });
  assert.equal(pending.can_issue_standard_card, false);

  delete process.env.BITNOB_DEFAULT_CUSTOMER_ID;
  const bare = svc.getBitnobKycPublicStatus({});
  assert.equal(bare.can_issue_standard_card, false);
  console.log('ok');
}

function testMigrationColumns() {
  section('062 migration adds Bitnob KYC + address columns');
  const sql = read('backend/migrations/062_bitnob_card_kyc.sql');
  for (const col of [
    'bitnob_kyc_status',
    'bitnob_kyc_reason',
    'date_of_birth',
    'address_line1',
    'address_city',
    'address_postal',
    'bitnob_customer_id',
  ]) {
    assert.ok(sql.includes(col), `migration should add ${col}`);
  }
  console.log('ok');
}

function testRoutesAndApproveWiring() {
  section('routes + approve → Bitnob submit wiring');
  const standard = read('backend/src/routes/standardCard.js');
  assert.ok(standard.includes('/wallets/standard/bitnob-kyc'));
  assert.ok(standard.includes('submitBitnobCardKycForUser'));
  assert.ok(standard.includes('bitnob_eligible'));

  const kycService = read('backend/src/services/kycService.js');
  assert.ok(kycService.includes('submitBitnobCardKycForUser'));
  assert.ok(kycService.includes('date_of_birth'));
  assert.ok(kycService.includes('address_line1'));

  const kycRoute = read('backend/src/routes/kyc.js');
  assert.ok(kycRoute.includes('date_of_birth'));
  assert.ok(kycRoute.includes('address_line1'));

  const webhook = read('backend/src/services/bitnobCardWebhookService.js');
  assert.ok(webhook.includes('virtualcard.user.kyc.complete'));
  assert.ok(webhook.includes('applyBitnobKycWebhook'));
  console.log('ok');
}

function testFrontendWiring() {
  section('Standard FE Bitnob KYC + form fields + mock cleanup');
  const html = read('backend/public/index.html');
  assert.ok(html.includes('id="kycDateOfBirth"'), 'DOB field');
  assert.ok(html.includes('id="kycAddressLine1"'), 'address line1');
  assert.ok(html.includes('id="kycAddressPostal"'), 'postal');
  assert.ok(/data-instant-only[^>]*>[\s\S]*Demo: self-issue|Demo: self-issue[\s\S]*data-instant-only/.test(html)
    || html.includes('data-instant-only>\n                  <summary>Demo: self-issue')
    || /class="hint" data-instant-only/.test(html), 'demo issue marked instant-only');
  assert.ok(html.includes('data-instant-only'), 'instant-only markers present');

  const api = read('backend/public/src/services/standardCardApi.js');
  assert.ok(api.includes('getBitnobKyc'));
  assert.ok(api.includes('submitBitnobKyc'));
  assert.ok(api.includes('/wallets/standard/bitnob-kyc'));

  const cardView = read('backend/public/src/components/standardCardView.js');
  assert.ok(cardView.includes('id="pbProcessingFee"'), 'processing fee row');
  assert.ok(cardView.includes('btnRetryBitnobKyc'));
  assert.ok(cardView.includes('loadBitnobKyc'));
  assert.ok(cardView.includes('isBitnobCustomerReady'));
  assert.ok(!/DEMO USER|4532 8765/.test(cardView), 'no mock card numbers in Standard view');

  const appView = read('backend/public/src/components/standardAppView.js');
  assert.ok(appView.includes('loadBitnobKyc'));
  assert.ok(appView.includes('kyc_verified_bitnob_ready') || appView.includes('Bitnob Card KYC ready'));

  const dash = read('backend/public/dashboard.js');
  assert.ok(dash.includes('date_of_birth'));
  assert.ok(dash.includes('address_line1'));
  assert.ok(dash.includes('isBitnobCustomerReady'));
  assert.ok(dash.includes('onBitnobKycLoaded'));
  // Must not spam toast on every pricing load for missing Bitnob customer
  assert.ok(
    !/bitnob_customer_ready === false && this\.isKycVerified\(\)[\s\S]{0,120}this\.toast/.test(dash),
    'pricing load should not toast Bitnob KYC errors'
  );
  console.log('ok');
}

function testPortalShellsSynced() {
  section('instant/standard portal shells include KYC address fields');
  for (const portal of ['instant.html', 'standard.html']) {
    const html = read(`backend/public/${portal}`);
    assert.ok(html.includes('id="kycDateOfBirth"'), `${portal} DOB`);
    assert.ok(html.includes('id="kycAddressLine1"'), `${portal} address`);
  }
  console.log('ok');
}

async function testWebhookKycApply() {
  section('applyBitnobKycWebhook updates user customer status');
  process.env.BITNOB_WEBHOOK_SECRET = process.env.BITNOB_WEBHOOK_SECRET || 'whsec-test';
  const { initDb, closeDb, getDb } = require(path.join(ROOT, 'backend/src/db'));
  await initDb();
  const db = getDb();
  const User = require(path.join(ROOT, 'backend/src/models/User'));

  const stamp = Date.now();
  const email = `bitnob-kyc-${stamp}@example.com`;
  const phone = `+959${String(stamp).slice(-8)}`;
  const customerId = `cust_wh_${stamp}`;
  const user = await User.create({
    name: 'KYC Webhook User',
    phone,
    email,
    pinHash: 'test-pin-hash',
  });
  await db.run(
    `UPDATE users SET kyc_status = 'VERIFIED', bitnob_customer_id = ?, updated_at = datetime('now') WHERE id = ?`,
    customerId,
    user.id
  );

  delete require.cache[require.resolve(path.join(ROOT, 'backend/src/services/bitnobKycService'))];
  const { applyBitnobKycWebhook } = require(path.join(ROOT, 'backend/src/services/bitnobKycService'));
  const result = await applyBitnobKycWebhook({
    event: 'virtualcard.user.kyc.complete',
    data: {
      customerId,
      customerEmail: email,
      kycPassed: true,
    },
  });
  assert.equal(result.matched, true);
  assert.equal(result.status, 'approved');
  assert.equal(result.ready, true);
  assert.equal(result.user_id, user.id);

  const updated = await db.get(
    'SELECT bitnob_kyc_status, bitnob_customer_id FROM users WHERE id = ?',
    user.id
  );
  assert.equal(updated.bitnob_kyc_status, 'approved');
  assert.equal(updated.bitnob_customer_id, customerId);

  await closeDb().catch(() => {});
  console.log('ok');
}

async function main() {
  testModulesExist();
  testBitnobClientExports();
  testKycServiceMapping();
  testMigrationColumns();
  testRoutesAndApproveWiring();
  testFrontendWiring();
  testPortalShellsSynced();
  await testWebhookKycApply();
  console.log('\nBitnob Card KYC finalize checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
