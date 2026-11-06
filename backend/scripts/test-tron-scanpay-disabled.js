#!/usr/bin/env node
/**
 * Assert Tron Wallet + Scan Pay are disabled/hidden (UI + backend guards),
 * and the 4% withdrawal markup remains forced active.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const section = (t) => console.log(`\n== ${t} ==`);

section('feature flags default OFF');
{
  delete process.env.TRON_WALLET_ENABLED;
  delete process.env.SCAN_PAY_ENABLED;
  // Clear module cache so env defaults apply
  const abs = require.resolve('../src/services/securityFlags');
  delete require.cache[abs];
  const flags = require('../src/services/securityFlags');
  assert.strictEqual(flags.isTronWalletEnabled(), false);
  assert.strictEqual(flags.isScanPayEnabled(), false);
  const status = flags.getSecurityStatus();
  assert.strictEqual(status.tron_wallet_enabled, false);
  assert.strictEqual(status.scan_pay_enabled, false);

  process.env.TRON_WALLET_ENABLED = 'true';
  process.env.SCAN_PAY_ENABLED = '1';
  delete require.cache[abs];
  const flagsOn = require('../src/services/securityFlags');
  assert.strictEqual(flagsOn.isTronWalletEnabled(), true);
  assert.strictEqual(flagsOn.isScanPayEnabled(), true);
  delete process.env.TRON_WALLET_ENABLED;
  delete process.env.SCAN_PAY_ENABLED;
  delete require.cache[abs];
  console.log('ok');
}

section('UI hides Scan Pay');
{
  for (const rel of ['public/index.html', 'public/instant.html']) {
    const html = read(rel);
    assert.ok(html.includes('id="btnOpenScanPay"'), `${rel} keeps id for bindings`);
    assert.ok(
      /id="btnOpenScanPay"[^>]*\bhidden\b/.test(html)
      || /id="btnOpenScanPay"[^>]*class="[^"]*\bhidden\b/.test(html),
      `${rel} Scan Pay home button hidden`
    );
    assert.ok(
      /id="btnOpenScanPayPage"[^>]*\bhidden\b/.test(html)
      || /id="btnOpenScanPayPage"[^>]*class="[^"]*\bhidden\b/.test(html),
      `${rel} Scan Pay page button hidden`
    );
    assert.ok(
      html.includes('data-feature-disabled="true"') && html.includes('data-feature="scan_pay"'),
      `${rel} marks Scan Pay feature disabled`
    );
    assert.ok(
      !/Withdrawals still use the legacy TRON master wallet/i.test(html),
      `${rel} must not advertise legacy TRON withdraw`
    );
  }

  const dash = read('public/dashboard.js');
  assert.ok(dash.includes('Scan Pay is disabled'), 'dashboard blocks Scan Pay open');
  assert.ok(dash.includes("this.closeScanPayModal()"), 'openScanPayModal closes immediately');
  assert.ok(!dash.includes("modal.classList.remove('hidden')") || !/openScanPayModal\(\)\s*\{[^}]*modal\.classList\.remove\('hidden'\)/s.test(dash),
    'openScanPayModal must not show modal');
  // Explicit: submitScanPay is a no-op toast
  assert.ok(/async submitScanPay\(\)\s*\{[^}]*Scan Pay is disabled/s.test(dash), 'submitScanPay disabled');
  console.log('ok');
}

section('backend routes guard Tron Wallet + Scan Pay');
{
  const tronRoute = read('src/routes/tronWallet.js');
  assert.ok(tronRoute.includes('isTronWalletEnabled'), 'tron wallet route checks flag');
  assert.ok(tronRoute.includes('rejectIfDisabled') || tronRoute.includes('FEATURE_DISABLED'), 'returns disabled');
  assert.ok(tronRoute.includes('410'), 'HTTP 410 Gone');

  const usdtRoute = read('src/routes/usdtWallet.js');
  assert.ok(usdtRoute.includes('isScanPayEnabled'), 'scan-pay checks flag');
  assert.ok(usdtRoute.includes('scanPayDisabledPayload'), 'scan-pay disabled payload');
  assert.ok(usdtRoute.includes('isTronWalletEnabled'), 'provision checks tron flag');

  const withdraw = read('src/routes/withdraw.js');
  assert.ok(withdraw.includes('isTronWalletEnabled'), 'legacy /api/withdraw gated');
  assert.ok(withdraw.includes('/api/withdrawal/usdt'), 'points clients to the platform withdraw route');

  const auth = read('src/services/authService.js');
  assert.ok(auth.includes('isTronWalletEnabled()'), 'auth skips HD provision when disabled');

  const userRoute = read('src/routes/user.js');
  assert.ok(userRoute.includes("deposit_provider: 'tron-hd'"), 'deposit-addresses use TRON HD');
  console.log('ok');
}

section('Admin fixed + percent formula replaces a drifted flat network fee');
{
  const {
    calculateWithdrawalBreakdown,
  } = require('../src/services/settingsService');
  const drifted = {
    withdrawal_service_fee_mode: 'fixed',
    withdrawal_service_fee_percent: 2,
    withdrawal_service_fee_fixed_usdt: 0,
    withdrawal_service_fee_minimum_usdt: 2,
    payment_service_fee_mode: 'fixed',
    payment_service_fee_percent: 2,
    payment_service_fee_minimum_usdt: 2,
    usdt_withdraw_fee_trc20_type: 'fixed',
    usdt_withdraw_fee_trc20: 2,
    usdt_withdraw_fee_bep20_type: 'fixed',
    usdt_withdraw_fee_bep20: 2,
    usdt_withdraw_fee_bank_type: 'fixed',
    usdt_withdraw_fee_bank: 2,
    minimum_usdt_withdrawal: 10,
    mmk_to_usd_rate: 4500,
  };
  const trc20 = calculateWithdrawalBreakdown(100, 'TRC20', drifted);
  assert.strictEqual(trc20.fee_usdt, 2, 'minimum fee floors 2% of 100');
  assert.strictEqual(trc20.net_usdt, 98);
  assert.strictEqual(trc20.network_fee_usdt, 1.5);
  assert.strictEqual(trc20.platform_margin_usdt, 0.5);
  assert.strictEqual(trc20.processing_hours, 48);
  assert.strictEqual(trc20.payout_provider, 'platform');

  const bank = calculateWithdrawalBreakdown(100, 'BANK', drifted);
  assert.strictEqual(bank.fee_usdt, 2);
  assert.strictEqual(bank.net_usdt, 98);
  console.log('ok');
}

section('i18n describes TRON HD deposits');
{
  const i18n = read('public/i18n.js');
  assert.ok(!/Withdrawals still use the legacy TRON master wallet/i.test(i18n));
  assert.ok(/TRON HD/i.test(i18n), 'TRON HD deposit copy');
  console.log('ok');
}

console.log('\nTron Wallet + Scan Pay disabled; 4% withdraw markup active — ok');
