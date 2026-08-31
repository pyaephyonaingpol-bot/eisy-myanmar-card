#!/usr/bin/env node
/**
 * Admin transaction history / CSV export filters — USDT card flows only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testAdminHtmlFilters() {
  section('Admin HTML transaction filters');
  const html = fs.readFileSync(path.join(ROOT, 'backend/public/admin.html'), 'utf8');
  const txStart = html.indexOf('id="tabTransactions"');
  const txEnd = html.indexOf('id="tabRevenue"');
  assert.ok(txStart >= 0 && txEnd > txStart);
  const block = html.slice(txStart, txEnd);

  assert.ok(block.includes('data-tx-category="card_issuance"'));
  assert.ok(block.includes('data-tx-category="card_reload"'));
  assert.ok(block.includes('data-tx-category="mmk_withdrawal"'));
  assert.ok(!block.includes('data-tx-category="p2p"'));
  assert.ok(block.includes('value="card_issuance"'));
  assert.ok(block.includes('value="card_reload"'));
  assert.ok(block.includes('value="mmk_withdrawal"'));
  assert.ok(!block.includes('NOWPayments (Supabase)'));
  assert.ok(!block.includes('value="p2p"'));
  assert.ok(!block.includes('value="ledger"'));
  assert.ok(!block.includes('P2P Transactions'));
  console.log('ok');
}

function testAdminJsHandlers() {
  section('Admin JS transaction handlers');
  const js = fs.readFileSync(path.join(ROOT, 'backend/public/admin.js'), 'utf8');

  assert.ok(js.includes("this.txCategory = this.txCategory || 'card_issuance'"));
  assert.ok(js.includes("category === 'card_issuance'"));
  assert.ok(js.includes("category === 'mmk_withdrawal'"));
  assert.ok(js.includes("'card_issuance'"));
  assert.ok(!js.includes("data-tx-category=\"p2p\""));
  assert.ok(!js.includes("category === 'p2p'"));
  assert.ok(js.includes("|| 'card_issuance'"));
  console.log('ok');
}

function testBackendCategories() {
  section('Backend admin transaction categories');
  const route = fs.readFileSync(path.join(ROOT, 'backend/src/routes/admin.js'), 'utf8');
  const svc = fs.readFileSync(path.join(ROOT, 'backend/src/services/adminLedgerTransactionService.js'), 'utf8');
  const csv = fs.readFileSync(path.join(ROOT, 'backend/src/services/transactionCsvExportService.js'), 'utf8');

  assert.ok(route.includes("category === 'card_issuance'"));
  assert.ok(route.includes("category === 'mmk_withdrawal'"));
  assert.ok(route.includes('card_issuance|card_reload|mmk_withdrawal'));
  assert.ok(svc.includes('listCardIssuanceAdminTransactions'));
  assert.ok(svc.includes('listMmkWithdrawalAdminTransactions'));
  assert.ok(csv.includes("src === 'card_issuance'"));
  assert.ok(csv.includes("src === 'mmk_withdrawal'"));
  assert.ok(!csv.includes("src === 'nowpayments'"));
  assert.ok(!csv.includes("src === 'p2p'"));
  assert.ok(!csv.includes("src === 'ledger'"));
  console.log('ok');
}

async function main() {
  testAdminHtmlFilters();
  testAdminJsHandlers();
  testBackendCategories();
  console.log('\nAll admin ledger filter cleanup tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
