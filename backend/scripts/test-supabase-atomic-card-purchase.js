#!/usr/bin/env node
/**
 * Atomic Supabase card purchase wallet flow:
 * debit RPC → Kripicard (external) → finalize completed/refunded RPC.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testSupabaseSqlRpc() {
  section('Supabase SQL defines atomic debit + finalize RPCs');
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/wallet_card_purchase.sql'), 'utf8');

  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS wallet_transactions'));
  assert.ok(sql.includes('debit_usdt_for_card_purchase'));
  assert.ok(sql.includes('finalize_card_purchase_wallet'));
  assert.ok(sql.includes("FOR UPDATE"), 'wallet row locked during debit/refund');
  assert.ok(sql.includes("'card_purchase_refund'"), 'compensating refund tx type');
  assert.ok(sql.includes('INSUFFICIENT_USDT_BALANCE'));
  assert.ok(sql.includes("status IN ('pending', 'completed', 'refunded'"));
  console.log('ok');
}

function testLedgerService() {
  section('supabaseWalletLedgerService wraps RPC calls');
  const src = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/supabaseWalletLedgerService.js'),
    'utf8'
  );

  assert.ok(src.includes("rpc('debit_usdt_for_card_purchase'"));
  assert.ok(src.includes("rpc('finalize_card_purchase_wallet'"));
  assert.ok(src.includes('invalidateUserWalletCache'));
  assert.ok(src.includes('required_usdt'));
  assert.ok(src.includes("outcome must be completed or refunded"));
  console.log('ok');
}

function testCardWalletIntegration() {
  section('purchaseCardFromUsdtWallet uses Supabase atomic flow');
  const src = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/cardWalletService.js'),
    'utf8'
  );

  const fnStart = src.indexOf('async function purchaseCardFromUsdtWallet');
  const fnEnd = src.indexOf('async function reloadCardFromUsdtWallet');
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const block = src.slice(fnStart, fnEnd);

  assert.ok(block.includes('debitUsdtForCardPurchase'), 'Supabase atomic debit first');
  assert.ok(block.indexOf('debitUsdtForCardPurchase') < block.indexOf('issueCardForUser'), 'debit before Kripicard');
  assert.ok(block.includes("outcome: 'refunded'"), 'refund on provider failure');
  assert.ok(block.includes("outcome: 'completed'"), 'finalize after successful issue');
  assert.ok(block.includes('supabase_journal_id'), 'journal id stored on card metadata');
  assert.ok(block.includes('tursoDebited'), 'Turso mirror with compensating credit');
  assert.ok(block.includes('stage: \'kripicard_issue\''), 'failure reason tagged');
  console.log('ok');
}

function testModuleExports() {
  section('Ledger service exports');
  const svc = require('../src/services/supabaseWalletLedgerService');
  assert.strictEqual(typeof svc.debitUsdtForCardPurchase, 'function');
  assert.strictEqual(typeof svc.finalizeCardPurchaseWallet, 'function');
  assert.strictEqual(typeof svc.buildJournalId, 'function');
  console.log('ok');
}

async function main() {
  testSupabaseSqlRpc();
  testLedgerService();
  testCardWalletIntegration();
  testModuleExports();
  console.log('\nAll Supabase atomic card purchase tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
