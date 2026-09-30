'use strict';

/**
 * Unit tests for Instant Card maintenance detection + friendly payloads.
 * No live Kripicard call required.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const mod = require(path.join(ROOT, 'lib/kripicardCardMaintenance.js'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('isCardIssuancePaused respects CARD_ISSUANCE_PAUSED');
{
  const prev = process.env.CARD_ISSUANCE_PAUSED;
  process.env.CARD_ISSUANCE_PAUSED = 'true';
  assert.strictEqual(mod.isCardIssuancePaused(), true);
  const payload = mod.cardIssuancePausedPayload();
  assert.strictEqual(payload.maintenance, true);
  assert.strictEqual(payload.retryable, true);
  assert.strictEqual(payload.code, mod.CARD_ISSUANCE_PAUSED);
  assert.ok(payload.retry_after_seconds >= 15);

  let threw = false;
  try {
    mod.assertCardIssuanceNotPaused();
  } catch (err) {
    threw = true;
    assert.strictEqual(err.code, mod.CARD_ISSUANCE_PAUSED);
    assert.strictEqual(err.status, 503);
    assert.strictEqual(err.maintenance, true);
  }
  assert.ok(threw, 'assertCardIssuanceNotPaused should throw when paused');

  process.env.CARD_ISSUANCE_PAUSED = '0';
  assert.strictEqual(mod.isCardIssuancePaused(), false);
  if (prev === undefined) delete process.env.CARD_ISSUANCE_PAUSED;
  else process.env.CARD_ISSUANCE_PAUSED = prev;
}

section('isTemporaryCardProviderOutage detects common downtime signals');
{
  assert.strictEqual(
    mod.isTemporaryCardProviderOutage({ code: 'KRIPICARD_API_ACCESS_DISABLED' }),
    true
  );
  assert.strictEqual(
    mod.isTemporaryCardProviderOutage({ code: 'KRIPICARD_TIMEOUT' }),
    true
  );
  assert.strictEqual(
    mod.isTemporaryCardProviderOutage({ status: 503, message: 'Bad Gateway' }),
    true
  );
  assert.strictEqual(
    mod.isTemporaryCardProviderOutage({
      message: 'API access is disabled for this account. Please contact support.',
      providerCode: 'API_ACCESS_DISABLED',
    }),
    true
  );
  assert.strictEqual(
    mod.isTemporaryCardProviderOutage({
      message: 'Service under maintenance — try again later',
    }),
    true
  );
  assert.strictEqual(
    mod.isTemporaryCardProviderOutage({ code: 'INSUFFICIENT_USDT_BALANCE', status: 400 }),
    false
  );
  assert.strictEqual(
    mod.isTemporaryCardProviderOutage({ code: 'INVALID_BIN', message: 'bad bin' }),
    false
  );
}

section('asCardMaintenanceError shapes friendly retryable 503');
{
  const raw = new Error('API access is disabled for this account');
  raw.code = 'KRIPICARD_API_ACCESS_DISABLED';
  raw.status = 403;
  raw.providerCode = 'API_ACCESS_DISABLED';
  const friendly = mod.asCardMaintenanceError(raw, { refunded: true });
  assert.strictEqual(friendly.code, mod.CARD_PROVIDER_MAINTENANCE);
  assert.strictEqual(friendly.status, 503);
  assert.strictEqual(friendly.retryable, true);
  assert.strictEqual(friendly.maintenance, true);
  assert.strictEqual(friendly.refunded, true);
  assert.ok(/maintenance|temporarily unavailable/i.test(friendly.message));

  const keep = new Error('Cardholder name must be at least 2 characters');
  keep.code = 'INVALID_NAME_ON_CARD';
  assert.strictEqual(mod.asCardMaintenanceError(keep), keep);
}

section('cardIssuanceAvailability');
{
  const prev = process.env.CARD_ISSUANCE_PAUSED;
  process.env.CARD_ISSUANCE_PAUSED = 'false';
  const ok = mod.cardIssuanceAvailability();
  assert.strictEqual(ok.available, true);
  assert.strictEqual(ok.maintenance, false);

  const down = mod.cardIssuanceAvailability({
    providerError: Object.assign(new Error('gateway timeout'), {
      status: 504,
      code: 'KRIPICARD_TIMEOUT',
    }),
  });
  assert.strictEqual(down.available, false);
  assert.strictEqual(down.maintenance, true);
  assert.strictEqual(down.retryable, true);
  assert.ok(down.retry_after_seconds >= 15);

  process.env.CARD_ISSUANCE_PAUSED = 'yes';
  const paused = mod.cardIssuanceAvailability();
  assert.strictEqual(paused.code, mod.CARD_ISSUANCE_PAUSED);
  assert.strictEqual(paused.maintenance, true);

  if (prev === undefined) delete process.env.CARD_ISSUANCE_PAUSED;
  else process.env.CARD_ISSUANCE_PAUSED = prev;
}

section('source wiring checks');
{
  const fs = require('fs');
  const userRoute = fs.readFileSync(
    path.join(ROOT, 'backend/src/routes/user.js'),
    'utf8'
  );
  assert.ok(userRoute.includes('isTemporaryCardProviderOutage'));
  assert.ok(userRoute.includes('cardProviderMaintenancePayload'));

  const instantRoute = fs.readFileSync(
    path.join(ROOT, 'backend/src/routes/instantCard.js'),
    'utf8'
  );
  assert.ok(instantRoute.includes('cardIssuanceAvailability'));
  assert.ok(instantRoute.includes('assertCardIssuanceNotPaused'));

  const wallet = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/kripicardCardWalletService.js'),
    'utf8'
  );
  assert.ok(wallet.includes('assertCardIssuanceNotPaused'));
  assert.ok(wallet.includes('asCardMaintenanceError'));

  const view = fs.readFileSync(
    path.join(ROOT, 'backend/public/src/components/instantCardView.js'),
    'utf8'
  );
  assert.ok(view.includes('kripicardMaintenanceBanner'));
  assert.ok(view.includes('pollIssuanceAvailability'));
  assert.ok(view.includes('CARD_PROVIDER_MAINTENANCE'));
}

console.log('\nAll kripicard card-maintenance checks passed.');
