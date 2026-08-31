#!/usr/bin/env node
'use strict';

/**
 * Guard: Sell USDT / Convert to MMK opens a dedicated modal with bank dropdown,
 * account fields, 5-day notice, and rate preview — not P2P navigation.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'public', 'dashboard.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public', 'i18n.js'), 'utf8');
const svc = fs.readFileSync(path.join(root, 'src', 'services', 'withdrawalService.js'), 'utf8');

assert(/id="sellUsdtMmkModal"/.test(html), 'sellUsdtMmkModal required');
assert(/id="sellUsdtBankMethod"/.test(html), 'bank/wallet select required');
for (const method of ['KPay', 'KBZ Bank', 'CB Pay', 'CB Bank', 'AYA Pay', 'AYA Bank', 'WavePay']) {
  assert(html.includes(`value="${method}"`), `missing bank option ${method}`);
}
assert(/id="sellUsdtAccountName"/.test(html), 'account name field required');
assert(/id="sellUsdtAccountNumber"/.test(html), 'account number/phone field required');
assert(/Withdrawals will be processed within 5 working days/.test(html), '5 working days notice required');
assert(/id="sellUsdtPreviewMmk"/.test(html), 'MMK preview required');

assert(/openSellUsdtMmkModal/.test(dash), 'openSellUsdtMmkModal required');
assert(/bindSellUsdtMmkModal/.test(dash), 'bindSellUsdtMmkModal required');
assert(/openSellConvertUsdt\(\)[\s\S]*openSellUsdtMmkModal/.test(dash), 'Sell button must open convert modal');
assert(!/openSellConvertUsdt\(\)[\s\S]{0,400}navigate\('p2p'/.test(dash), 'Sell button must not navigate to P2P');
assert(/payout_method:\s*'bank'/.test(dash), 'submit must use bank payout_method');
assert(/sell_usdt_mmk_notice/.test(i18n), 'i18n notice key required');

assert(/ALLOWED\.has\(bankName\)|ALLOWED\.includes\(bankName\)/.test(svc) || /'KPay'[\s\S]*'WavePay'/.test(svc), 'backend validates bank methods');
assert(/syncUsdtBankWithdrawal/.test(fs.readFileSync(path.join(root, 'src', 'services', 'supabaseSyncService.js'), 'utf8')), 'supabase sync helper required');
assert(fs.existsSync(path.join(root, '..', 'supabase', 'usdt_bank_withdrawals.sql')), 'supabase SQL schema required');

console.log('SELL USDT MMK MODAL GUARD PASSED');
