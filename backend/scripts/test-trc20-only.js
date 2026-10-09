#!/usr/bin/env node
'use strict';

/**
 * USDT deposits and withdrawals accept TRC20 only.
 * Run: node backend/scripts/test-trc20-only.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `eisy-trc20-only-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
process.env.WITHDRAWALS_PAUSED = 'false';
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|TURSO|PAGO|TELEGRAM/i.test(key)) delete process.env[key];
}
process.env.DATABASE_URL = `file:${dbFile}`;

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function main() {
  section('User and admin HTML omit BEP20');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const instant = fs.readFileSync(path.join(__dirname, '../public/instant.html'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  const adminInstant = fs.readFileSync(path.join(__dirname, '../public/admin-instant.html'), 'utf8');
  for (const [name, text] of [['index', html], ['instant', instant], ['admin', admin], ['admin-instant', adminInstant]]) {
    assert.ok(!/BEP20|BEP-20|bep20/i.test(text), `${name} still mentions BEP20`);
    assert.ok(text.includes('TRC20'), `${name} still offers TRC20`);
  }
  assert.ok(html.includes('id="withdrawNetwork"'));
  assert.ok(html.includes('<option value="TRC20" selected>TRC20 (TRON)</option>'));
  assert.ok(html.includes('id="usdtLinkNetwork"'));
  assert.ok(!html.includes('ERC20'));
  console.log('ok');

  section('Withdrawal fee list and quotes');
  const withdrawalRoute = fs.readFileSync(path.join(__dirname, '../src/routes/withdrawal.js'), 'utf8');
  const depositRoute = fs.readFileSync(path.join(__dirname, '../src/routes/deposit.js'), 'utf8');
  assert.ok(!withdrawalRoute.includes("buildNetworkMeta('BEP20'"));
  assert.ok(withdrawalRoute.includes("buildNetworkMeta('TRC20'"));
  assert.ok(withdrawalRoute.includes("buildNetworkMeta('BANK'"));
  assert.ok(!depositRoute.includes("id: 'BEP20'"));
  assert.ok(depositRoute.includes("id: 'TRC20'"));

  process.chdir(path.join(__dirname, '..'));
  const { initDb } = require('../src/db');
  await initDb();
  const { calculateWithdrawalBreakdown, getPublicRatesAndFees } = require('../src/services/settingsService');
  assert.throws(
    () => calculateWithdrawalBreakdown(25, 'BEP20', {}),
    /TRC20/
  );
  const trc20 = calculateWithdrawalBreakdown(25, 'TRC20', {
    withdrawal_service_fee_mode: 'fixed_plus_percent',
    withdrawal_service_fee_fixed_usdt: 1,
    withdrawal_service_fee_percent: 2,
    withdrawal_service_fee_minimum_usdt: 1,
    minimum_usdt_withdrawal: 5,
  });
  assert.strictEqual(trc20.network, 'TRC20');
  assert.ok(trc20.net_usdt > 0);
  const bank = calculateWithdrawalBreakdown(25, 'BANK', {
    withdrawal_service_fee_mode: 'fixed',
    withdrawal_service_fee_fixed_usdt: 1,
    minimum_usdt_withdrawal: 5,
    mmk_to_usd_rate: 4500,
  });
  assert.strictEqual(bank.network, 'BANK');
  const publicRates = await getPublicRatesAndFees();
  assert.ok(publicRates.pricing.withdrawal_fees.usdt_withdraw_fee_trc20 != null);
  assert.strictEqual(publicRates.pricing.withdrawal_fees.usdt_withdraw_fee_bep20, undefined);
  console.log('ok');

  section('New BEP20 deposit, withdrawal, and wallet link are rejected');
  const { createUsdtDepositRequest } = require('../src/services/depositService');
  const { createUsdtWithdrawalRequest } = require('../src/services/withdrawalService');
  const { linkExternalAddress, SUPPORTED_NETWORKS } = require('../src/services/usdtWalletService');
  const { verifyUsdtTransaction } = require('../src/services/usdtBlockchainService');
  const { parsePaymentQrPayload, validateDestination } = require('../src/services/scanPayService');

  assert.deepStrictEqual(SUPPORTED_NETWORKS, ['TRC20']);
  await assert.rejects(
    () => createUsdtDepositRequest(1, { amount_usdt: 10, network: 'BEP20' }),
    /TRC20/
  );
  await assert.rejects(
    () => createUsdtWithdrawalRequest(1, {
      payout_method: 'crypto',
      network: 'BEP20',
      wallet_address: '0x0000000000000000000000000000000000000001',
      amount_usdt: 20,
    }),
    /TRC20/
  );
  await assert.rejects(
    () => linkExternalAddress(1, {
      network: 'ERC20',
      address: '0x0000000000000000000000000000000000000001',
    }),
    /TRC20/
  );
  const bep = await verifyUsdtTransaction({
    network: 'BEP20',
    txHash: '0xabc123realhashnotmock',
    expectedAddress: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    expectedAmountUsdt: 10,
  });
  assert.strictEqual(bep.ok, false);
  assert.match(bep.message, /TRC20/);
  assert.throws(() => parsePaymentQrPayload('0x0000000000000000000000000000000000000001'), /TRC20/);
  assert.throws(() => validateDestination('TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', 'BEP20'), /TRC20/);
  console.log('ok');

  console.log('\nTRC20-only checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
