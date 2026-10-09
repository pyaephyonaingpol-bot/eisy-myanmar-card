#!/usr/bin/env node
'use strict';

/**
 * Dashboard balance/cards paint from local data, then refresh.
 * Idle sessions end after 20 minutes and do not survive a closed tab.
 * Run: node backend/scripts/test-fast-load-idle-logout.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const userRoute = read('backend/src/routes/user.js');
const auth = read('backend/public/auth.js');
const dash = read('backend/public/dashboard.js');
const html = read('backend/public/index.html');
const instant = read('backend/public/instant.html');
const css = read('backend/public/styles.css');
const i18n = read('backend/public/i18n.js');

const cardsHandler = userRoute.slice(
  userRoute.indexOf("router.get('/cards'"),
  userRoute.indexOf("router.post('/cards/:id/remove'")
);
assert.ok(cardsHandler.includes('if (wantSync)'), 'card list syncs only when asked');
assert.ok(!cardsHandler.includes('payload.cards.length === 0'), 'an empty card list does not wait on the provider');

const walletHandler = userRoute.slice(
  userRoute.indexOf("router.get('/wallet'"),
  userRoute.indexOf("router.get('/card',")
);
assert.ok(walletHandler.includes("req.query.fast === '1'"), 'wallet has a fast local read');
assert.ok(walletHandler.includes('if (!fast)'), 'Tron scan stays off the fast balance read');
assert.ok(walletHandler.includes('scan_deferred'), 'client can tell a scan was deferred');

assert.ok(dash.includes("loadWallet({ force: true, fast: true })"), 'home balance uses the fast read');
assert.ok(dash.includes('loadAllCards({ preserveSelection: true, silent: true })'), 'cards load beside the balance');
assert.ok(dash.includes('Promise.allSettled'), 'balance and cards settle together');
assert.ok(dash.includes('reconcilePago: true'), 'empty card lists import from the provider after paint');
assert.ok(dash.includes('setBalanceLoading'), 'balance skeleton while the first read is in flight');
assert.ok(dash.includes('setCardsLoading'), 'card skeleton while the first read is in flight');
assert.ok(dash.includes('applyCachedWallet'), 'a tab can show the last balance immediately');

assert.ok(auth.includes('IDLE_LIMIT_MS: 20 * 60 * 1000'), 'idle limit is 20 minutes');
assert.ok(auth.includes('mousemove') && auth.includes('keydown') && auth.includes('click'), 'mouse and keyboard reset the idle timer');
assert.ok(auth.includes('logoutForInactivity'), 'idle timeout logs the user out');
assert.ok(auth.includes("sessionStorage.setItem(this.STORAGE_KEY"), 'session lives in sessionStorage');
assert.ok(auth.includes('localStorage.removeItem(this.STORAGE_KEY)'), 'closing storage does not keep the live session in localStorage');
assert.ok(auth.includes('/api/auth/logout'), 'idle logout revokes the server session');

for (const doc of [html, instant]) {
  assert.ok(doc.includes('sessionStorage.getItem(authKey)'), 'first paint reads the tab session');
  assert.ok(doc.includes('id="authSessionNotice"'), 'login page can show the idle notice');
  assert.ok(doc.includes('id="pagoCardSkeleton"'), 'card skeleton markup is present');
  assert.ok(doc.includes('auth.js?v=20261009idleLogout'), 'auth cache bust');
  assert.ok(doc.includes('dashboard.js?v=20261009otpResend'), 'dashboard cache bust');
}

assert.ok(css.includes('html.balance-loading #sumBalanceUsdt'), 'balance skeleton style');
assert.ok(css.includes('.pago-card-skeleton-face'), 'card skeleton style');
assert.ok(css.includes('.auth-session-notice'), 'idle notice style');
assert.ok(i18n.includes('session_idle_notice:'), 'idle notice copy');
assert.ok(i18n.includes('မိနစ် ၂၀'), 'Burmese idle notice');

console.log('fast load and idle logout checks passed');
