#!/usr/bin/env node
/**
 * Dashboard wallet/session hydration must not leave permanent dashes or skeletons.
 * Run: node backend/scripts/test-dashboard-wallet-hydration.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dash = fs.readFileSync(path.join(root, 'public', 'dashboard.js'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'public', 'auth.js'), 'utf8');

assert.ok(dash.includes('ensureSessionUser'), 'ensureSessionUser helper required');
assert.ok(dash.includes('applySessionUserToUI'), 'applySessionUserToUI helper required');
assert.ok(dash.includes('setHomeWalletBalanceDisplay'), 'home wallet display helper required');
assert.ok(dash.includes('renderWalletBalancesFromCache'), 'cached wallet render required');
assert.ok(dash.includes("setHomeWalletBalanceDisplay('Loading…')"), 'loading state before wallet fetch');
assert.ok(dash.includes('Balance timed out'), 'timeout fallback message required');
assert.ok(dash.includes('clearTimeout(hydrationSafety)'), 'hydration safety timeout required');
assert.ok(dash.includes('if (Auth.needsPinUnlock())'), 'PIN gate before wallet fetch');
assert.ok(!/if \(Auth\.user\) \{[\s\S]{0,400}loadWallet/.test(dash), 'wallet load must not require Auth.user block');

assert.ok(auth.includes('cached?.sessionToken && cached?.user'), 'restoreSession keeps cached user on transient errors');

console.log('DASHBOARD WALLET HYDRATION GUARD PASSED');
