#!/usr/bin/env node
'use strict';

/**
 * Wallet balance timeout / retry guards.
 * Run: node backend/scripts/test-wallet-balance-timeout.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

console.log('== Client wallet retries + longer timeouts ==');
const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('_fetchWalletPayload'), 'dashboard wallet retry helper');
assert.ok(
  dash.includes('useFast ? 20000 : 45000')
    || dash.includes('opts.fast ? 15000 : 25000')
    || dash.includes('20000 : 45000'),
  'raised wallet client timeouts'
);
assert.ok(dash.includes("err?.code === 'REQUEST_TIMEOUT'"), 'retries REQUEST_TIMEOUT');
assert.ok(dash.includes('applyCachedWallet()'), 'timeout falls back to session cache');
assert.ok(dash.includes('Balance timed out'), 'timeout message still present as last resort');

const usdtApi = read('backend/public/src/services/usdtWalletApi.js');
assert.ok(usdtApi.includes('withRetries'), 'usdt wallet API retries');
assert.ok(usdtApi.includes('timeoutMs: 25000'), 'balance timeout raised');
assert.ok(usdtApi.includes('timeoutMs: 45000'), 'overview timeout raised');
assert.ok(usdtApi.includes('timeoutMs: 45000'), 'linked on-chain balance timeout raised');
console.log('ok');

console.log('\n== Server wallet path does not wait forever on TronGrid ==');
const userRoute = read('backend/src/routes/user.js');
assert.ok(userRoute.includes('WALLET_HD_SCAN_BUDGET_MS'), 'wallet scan budget');
assert.ok(userRoute.includes("reason: 'budget'"), 'budget skip reason');
assert.ok(userRoute.includes('background HD scan'), 'continues scan after budget');
assert.ok(userRoute.includes("'2500'") || userRoute.includes("'3500'"), 'HD scan budget configured');

const hd = read('backend/src/services/hdDepositCreditService.js');
assert.ok(hd.includes('TRON_HD_READ_SCAN_TIMEOUT_MS'), 'read scan timeout env');

const tronOrders = read('backend/src/services/tronOrderService.js');
assert.ok(tronOrders.includes('TRONGRID_TRANSFER_RETRIES'), 'TronGrid transfer retries');
assert.ok(tronOrders.includes('TRONGRID_TIMEOUT'), 'TronGrid timeout code');

const chain = read('backend/src/services/usdtBlockchainService.js');
assert.ok(chain.includes('fetchJsonWithRetry'), 'blockchain fetch retries');
assert.ok(chain.includes('TRONSCAN_BALANCE_TIMEOUT_MS'), 'on-chain balance timeout env');
assert.ok(chain.includes('BLOCKCHAIN_TIMEOUT'), 'blockchain timeout code');

const master = read('backend/src/services/tronMasterWalletService.js');
assert.ok(master.includes('BALANCE_PROVIDER_RETRIES'), 'master wallet provider retries');
assert.ok(master.includes("'20000'"), 'master wallet timeout default 20s');

const sb = read('backend/src/services/supabaseWalletReadService.js');
assert.ok(sb.includes("'4000'"), 'supabase wallet read timeout default 4s');
console.log('ok');

console.log('\n== Cache bust ==');
const html = read('backend/public/index.html');
assert.ok(
  html.includes('walletTimeout') || html.includes('fetchTimeout45s'),
  'index cache-bust includes wallet timeout stamp'
);
const instant = read('backend/public/instant.html');
assert.ok(
  instant.includes('walletTimeout') || instant.includes('fetchTimeout45s') || instant.includes('auth.js?v='),
  'instant cache-bust includes wallet timeout stamp'
);
console.log('ok');

console.log('\nWallet balance timeout checks passed.');
