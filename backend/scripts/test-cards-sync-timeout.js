#!/usr/bin/env node
'use strict';

/**
 * Guards: login card list stays local-first; Pago sync is soft-budget / background.
 * Run: node backend/scripts/test-cards-sync-timeout.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('Server soft budget + background sync');
const svc = read('backend/src/services/pagoCardService.js');
assert.ok(svc.includes('withCardApiSoftBudget'), 'soft budget helper');
assert.ok(svc.includes("CARD_SYNC_BUDGET_MS || '6000'"), 'sync budget default 6s');
assert.ok(svc.includes("CARD_FETCH_TIMEOUT_MS || '8000'"), 'fetch timeout default 8s');

const routes = read('backend/src/routes/user.js');
assert.ok(routes.includes('withCardApiSoftBudget'), 'cards routes use soft budget');
assert.ok(routes.includes('background === true'), 'POST /cards/sync supports background');
assert.ok(routes.includes('sync_deferred'), 'GET /cards reports deferred sync');
assert.ok(routes.includes('Showing saved cards'), 'sync failure falls back to local cards');
console.log('ok');

section('Dashboard never awaits Pago before local GET');
const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('background: true'), 'background sync mode');
assert.ok(dash.includes('timeoutMs: 20000'), 'GET /cards client timeout raised');
assert.ok(
  !/if \(reconcilePago[\s\S]{0,120}await this\.syncPagoCardsFromProvider/.test(dash),
  'does not await sync before listing'
);
assert.ok(
  dash.includes('Local Turso list only') || dash.includes('never await Pago before paint'),
  'local-first comment/path'
);
assert.ok(dash.includes("body?.background") || dash.includes('background: true'), 'posts background flag');
console.log('ok');

section('Cache bust');
const html = read('backend/public/index.html');
assert.ok(html.includes('cardsSyncBg') || html.includes('dashboard.js?v='), 'dashboard cache bust');
console.log('ok');

async function testSoftBudget() {
  section('Soft budget behavior smoke');
  delete require.cache[require.resolve('../src/services/pagoCardService')];
  const { withCardApiSoftBudget } = require('../src/services/pagoCardService');
  const started = Date.now();
  const slow = new Promise((resolve) => {
    setTimeout(() => resolve({ imported: 2, updated: 0 }), 200);
  });
  const result = await withCardApiSoftBudget(slow, 50, 'unit-sync');
  assert.strictEqual(result.timed_out, true);
  assert.strictEqual(result.deferred, true);
  assert.ok(Date.now() - started < 150, 'soft budget returns quickly');
  await new Promise((r) => setTimeout(r, 250));
  console.log('ok');
}

testSoftBudget()
  .then(() => {
    console.log('\nCards sync timeout checks passed.');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
