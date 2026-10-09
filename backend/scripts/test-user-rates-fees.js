#!/usr/bin/env node
'use strict';

/**
 * Admin-saved exchange rates and fees must reach the user Rates page.
 * Run: node backend/scripts/test-user-rates-fees.js
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');

const dbFile = path.join(os.tmpdir(), `eisy-user-rates-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|TURSO|PAGO|DATABASE_URL/i.test(key) && key !== 'DATABASE_URL') delete process.env[key];
}
process.env.DATABASE_URL = `file:${dbFile}`;

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testDashboardSource() {
  section('Rates page fetches /api/user/pricing and renders live fees');
  const dash = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const instant = fs.readFileSync(path.join(__dirname, '../public/instant.html'), 'utf8');
  assert.ok(dash.includes("Auth.api('GET', '/api/user/pricing')"), 'loadCardPricing calls user pricing');
  assert.ok(!dash.includes('platform profit per reload'), 'reload card must not hardcode platform profit');
  assert.ok(dash.includes('formatRatesFeeLabel'), 'shared fee label formatter');
  assert.ok(dash.includes('loadCardPricing({ force: true })'), 'rates page refreshes pricing');
  assert.ok(html.includes('id="ratesExchangeValue"'), 'today rate card');
  assert.ok(html.includes('id="ratesCardFee"'), 'issuance fee card');
  assert.ok(html.includes('id="ratesWithdrawFeeTrc20"'), 'trc20 fee card');
  assert.ok(html.includes('id="ratesReloadFee">—'), 'reload placeholder is empty until fetch');
  assert.ok(html.includes('dashboard.js?v=20261009otpResend'), 'user portal cache bust');
  assert.ok(instant.includes('dashboard.js?v=20261009otpResend'), 'instant portal cache bust');
  assert.ok(!html.includes('BEP20'), 'user portal has no BEP20 option');
  assert.ok(!instant.includes('BEP20'), 'instant portal has no BEP20 option');

  const start = dash.indexOf('formatRatesFeeLabel({ mode, fixed, percent, minimum } = {})');
  const end = dash.indexOf('\n  renderRatesPage()', start);
  assert.ok(start > 0 && end > start, 'formatter source');
  const fnSrc = dash.slice(start, end);
  const sandbox = { Number, String, Math };
  const result = vm.runInNewContext(`
    const Dashboard = { ${fnSrc} };
    ({
      reload: Dashboard.formatRatesFeeLabel({ mode: 'fixed_plus_percent', fixed: 1.25, percent: 3, minimum: 0.5 }),
      withdraw: Dashboard.formatRatesFeeLabel({ mode: 'fixed_plus_percent', fixed: 2, percent: 2.5, minimum: 1.1 }),
      fixedOnly: Dashboard.formatRatesFeeLabel({ mode: 'fixed_plus_percent', fixed: 3.5, percent: 0, minimum: 0 }),
      zero: Dashboard.formatRatesFeeLabel({ mode: 'fixed_plus_percent', fixed: 0, percent: 0, minimum: 0 }),
    });
  `, sandbox);
  assert.strictEqual(result.reload, '$1.25 + 3% (min $0.50)');
  assert.strictEqual(result.withdraw, '$2.00 + 2.5% (min $1.10)');
  assert.strictEqual(result.fixedOnly, '$3.50 fixed');
  assert.strictEqual(result.zero, '$0.00');
  console.log('ok');
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function requestJson(port, urlPath, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = JSON.parse(text); } catch (_) { body = { raw: text }; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  testDashboardSource();

  section('Database settings flow to user pricing endpoints');
  const { initDb, closeDb } = require('../src/db');
  await initDb();
  const { updateSettings } = require('../src/services/settingsService');
  const User = require('../src/models/User');
  const { createSession } = require('../src/services/authService');
  const express = require('express');

  await updateSettings({
    mmk_to_usd_rate: 6123,
    card_issuance_fee_usd: 7.25,
    minimum_initial_deposit_usd: 20,
    card_reload_fee_usd: 1.25,
    card_reload_fee_percent: 3,
    card_reload_fee_minimum_usd: 0.5,
    withdrawal_service_fee_fixed_usdt: 2,
    withdrawal_service_fee_percent: 2.5,
    withdrawal_service_fee_minimum_usdt: 1.1,
    withdrawal_service_fee_mode: 'fixed_plus_percent',
    minimum_usdt_withdrawal: 15,
    effective_date: '2026-10-09',
    updated_by: 'rates-test',
  });

  const user = await User.create({
    name: 'Rates Viewer',
    phone: `097${String(Date.now()).slice(-8)}`,
    email: `rates-viewer-${Date.now()}@example.com`,
  });
  const { sessionToken } = await createSession({ userId: user.id, deviceName: 'rates-test' });

  const app = express();
  app.use('/api/user', require('../src/routes/user'));
  app.use('/api/settings', require('../src/routes/publicSettings'));
  const server = http.createServer(app);
  const port = await listen(server);

  const anon = await requestJson(port, '/api/user/pricing');
  assert.strictEqual(anon.status, 401);

  const userRes = await requestJson(port, '/api/user/pricing', sessionToken);
  assert.strictEqual(userRes.status, 200, JSON.stringify(userRes.body));
  const settingsRes = await requestJson(port, '/api/settings', sessionToken);
  assert.strictEqual(settingsRes.status, 200, JSON.stringify(settingsRes.body));

  for (const body of [userRes.body, settingsRes.body]) {
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.pricing.mmk_to_usd_rate, 6123);
    assert.strictEqual(body.pricing.rate_effective_date, '2026-10-09');
    assert.strictEqual(body.pricing.card_issuance_fee_usd, 7.25);
    assert.strictEqual(body.pricing.minimum_initial_deposit_usd, 20);
    assert.strictEqual(body.pricing.card_reload_fee_usd, 1.25);
    assert.strictEqual(body.pricing.card_reload_fee_percent, 3);
    assert.strictEqual(body.pricing.card_reload_fee_minimum_usd, 0.5);
    assert.strictEqual(body.pricing.withdrawal_fees.withdrawal_service_fee_fixed_usdt, 2);
    assert.strictEqual(body.pricing.withdrawal_fees.withdrawal_service_fee_percent, 2.5);
    assert.strictEqual(body.pricing.withdrawal_fees.withdrawal_service_fee_minimum_usdt, 1.1);
    assert.strictEqual(body.pricing.withdrawal_fees.minimum_usdt_withdrawal, 15);
    assert.strictEqual(body.current_rate.effective_date, '2026-10-09');
    const encoded = JSON.stringify(body);
    assert.ok(!encoded.includes('usdt_trc20_address'), 'deposit address stays private');
    assert.ok(!encoded.includes('card_issue_provider_cost_usd'), 'provider cost stays private');
    assert.ok(!encoded.includes('card_reload_net_profit_usd'), 'platform profit stays private');
    assert.ok(!encoded.includes('platform_usdt_revenue_balance'), 'revenue balance stays private');
  }

  server.close();
  await closeDb();
  console.log('ok');
  console.log('\nUser rates and fees — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
