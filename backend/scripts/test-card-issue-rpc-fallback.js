#!/usr/bin/env node
/**
 * Regression: Issue Card Instantly must not 500 when Supabase
 * wallet_card_purchase.sql RPCs are missing (PGRST202).
 *
 * Run: node backend/scripts/test-card-issue-rpc-fallback.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testSourceFallback() {
  section('purchaseCardFromUsdtWallet falls back when RPC missing');
  const src = fs.readFileSync(
    path.join(ROOT, 'backend/src/services/cardWalletService.js'),
    'utf8'
  );
  const fnStart = src.indexOf('async function purchaseCardFromUsdtWallet');
  const fnEnd = src.indexOf('async function reloadCardFromUsdtWallet');
  const block = src.slice(fnStart, fnEnd);
  assert.ok(block.includes('SUPABASE_CARD_PURCHASE_RPC_MISSING'));
  assert.ok(block.includes('Turso debit fallback') || block.includes('using Turso debit'));
  assert.ok(block.includes('supabaseAtomicDebit'));
  assert.ok(block.includes("if (supabaseAtomicDebit)"));
  console.log('ok');
}

function testErrorMapping() {
  section('respondCardPurchaseError maps schema-cache failures');
  const src = fs.readFileSync(path.join(ROOT, 'backend/src/routes/user.js'), 'utf8');
  assert.ok(src.includes('SUPABASE_CARD_PURCHASE_RPC_MISSING'));
  assert.ok(src.includes('PGRST202'));
  assert.ok(src.includes("String(err?.message"));
  console.log('ok');
}

async function testLiveRpcDetection() {
  section('Live Supabase reports missing card-purchase RPC clearly');
  require(path.join(ROOT, 'backend/src/lib/loadEnv'));
  const {
    debitUsdtForCardPurchase,
    isMissingCardPurchaseRpcError,
  } = require('../src/services/supabaseWalletLedgerService');

  let threw = null;
  try {
    await debitUsdtForCardPurchase('__rpc_probe__', {
      totalAmountUsdt: 1,
      kripicardCostUsd: 1,
      platformMarkupUsd: 0,
      idempotencyKey: `probe-${Date.now()}`,
    });
  } catch (err) {
    threw = err;
  }

  assert.ok(threw, 'expected debit RPC to throw when function missing or wallet missing');
  if (threw.code === 'SUPABASE_NOT_CONFIGURED') {
    console.log('skip — Supabase not configured in this environment');
    return;
  }

  // Production today: function missing → SUPABASE_CARD_PURCHASE_RPC_MISSING
  // After SQL applied: may return DEBIT_FAILED / INSUFFICIENT / wallet not found
  if (threw.code === 'SUPABASE_CARD_PURCHASE_RPC_MISSING') {
    assert.ok(isMissingCardPurchaseRpcError(threw) || isMissingCardPurchaseRpcError(threw.cause));
    console.log('ok — missing RPC detected as', threw.code);
    return;
  }

  console.log('ok — RPC present; debit returned business error', threw.code || threw.message);
}

async function testFallbackPurchasePath() {
  section('Missing RPC → Turso debit path (mocked provider)');
  require(path.join(ROOT, 'backend/src/lib/loadEnv'));

  const ledgerPath = require.resolve('../src/services/supabaseWalletLedgerService');
  const walletPath = require.resolve('../src/services/walletService');
  const issuePath = require.resolve('../src/services/cardIssueService');
  const cardWalletPath = require.resolve('../src/services/cardWalletService');
  const syncPath = require.resolve('../src/services/supabaseSyncService');
  const cardModelPath = require.resolve('../src/models/Card');
  const userModelPath = require.resolve('../src/models/User');

  // Load modules first so require.cache entries exist, then overwrite exports.
  const realLedger = require('../src/services/supabaseWalletLedgerService');
  const realWallet = require('../src/services/walletService');
  require('../src/services/cardIssueService');
  require('../src/services/supabaseSyncService');

  const missing = new Error('RPC missing');
  missing.code = 'SUPABASE_CARD_PURCHASE_RPC_MISSING';

  let debitUsdtCalls = 0;
  let finalizeCalls = 0;
  let issueCalls = 0;

  require.cache[ledgerPath].exports = {
    ...realLedger,
    async debitUsdtForCardPurchase() {
      throw missing;
    },
    async finalizeCardPurchaseWallet() {
      finalizeCalls += 1;
      throw new Error('finalize should not run in fallback mode');
    },
  };

  require.cache[walletPath].exports = {
    ...realWallet,
    async debitUsdt() {
      debitUsdtCalls += 1;
      return { balance_usdt: 50 };
    },
    async creditUsdt() {
      return { balance_usdt: 60 };
    },
    formatUsdt: realWallet.formatUsdt,
  };

  require.cache[issuePath].exports = {
    isSupabaseAdminEnabled: () => true,
    async issueCardForUser() {
      issueCalls += 1;
      return {
        provider_card: {
          card_id: 'kc_test_1',
          card_number: '4111111111111111',
          exp_date: '12/30',
          cvv: '123',
          balance: 10,
        },
        user_card: { id: 'uc_1', card_id: 'kc_test_1' },
        reused: false,
      };
    },
  };

  process.env.KRIPICARD_API_KEY = process.env.KRIPICARD_API_KEY || 'test-key';
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.KRIPICARD_DEFAULT_BIN = '441357';
  process.env.KRIPICARD_ALLOWED_BINS = '441357';

  const { initDb, getDb, closeDb } = require('../src/db');
  await initDb();
  const User = require('../src/models/User');

  const email = `card-rpc-fallback-${Date.now()}@example.com`;
  const phone = `09${String(Date.now()).slice(-9)}`;
  let user = await User.create({
    name: 'Fallback Tester',
    email,
    phone,
    pinHash: null,
  });
  const db = getDb();
  await db.run(`UPDATE users SET balance_usdt = 100 WHERE id = ?`, user.id);
  user = await User.findById(user.id);

  // Stub ensureSupabaseUserWallet to avoid live network coupling
  const realSync = require('../src/services/supabaseSyncService');
  require.cache[syncPath].exports = {
    ...realSync,
    async ensureSupabaseUserWallet() {
      return { ensured: true, skipped: true, reason: 'test_stub' };
    },
  };

  delete require.cache[cardWalletPath];
  // Also clear dependents that may have cached the unmocked graph
  delete require.cache[require.resolve('../src/services/settingsService')];

  const {
    purchaseCardFromUsdtWallet,
    resetKripicardBinCacheForTests,
  } = require('../src/services/cardWalletService');
  resetKripicardBinCacheForTests();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        success: true,
        data: [{ bin: '441357', status: 'active' }],
      });
    },
  });

  try {
    const result = await purchaseCardFromUsdtWallet(user.id, {
      initialLoadUsd: 10,
      cardHolderName: 'Fallback Tester',
      bin: '441357',
      paymentRef: `test-fallback-${Date.now()}`,
    });

    assert.strictEqual(debitUsdtCalls, 1, 'Turso debit should run once');
    assert.strictEqual(finalizeCalls, 0, 'finalize RPC must be skipped on fallback');
    assert.strictEqual(issueCalls, 1, 'Kripicard issue path should run');
    assert.ok(result.card, 'should return card result');
    console.log('ok — fallback issued/pending', {
      issued: result.issued,
      pending: result.pending,
      cardId: result.card?.id,
    });
  } finally {
    global.fetch = originalFetch;
    for (const p of [
      ledgerPath, walletPath, issuePath, cardWalletPath, syncPath,
    ]) {
      delete require.cache[p];
    }
    try {
      await closeDb();
    } catch (_) { /* ignore */ }
  }
}

async function main() {
  testSourceFallback();
  testErrorMapping();
  await testLiveRpcDetection();
  await testFallbackPurchasePath();
  console.log('\nCard issue RPC fallback checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

