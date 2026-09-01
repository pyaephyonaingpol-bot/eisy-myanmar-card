#!/usr/bin/env node
/**
 * Backend: deposits and card reloads accept USDT/crypto only.
 * MMK is restricted to withdrawal requests.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '../..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

function testRouteSources() {
  section('Route sources reject MMK deposit/reload');
  const userRoute = read('backend/src/routes/user.js');
  const depositRoute = read('backend/src/routes/deposit.js');

  assert.ok(userRoute.includes('USDT_ONLY_CARD_RELOAD'));
  assert.ok(!userRoute.includes('reloadCardFromWallet'));
  assert.ok(!userRoute.includes('calculateCardReloadPricing('));
  assert.ok(!userRoute.includes('createDepositRequest'));

  const reloadIdx = userRoute.indexOf("router.post('/card/reload'");
  assert.ok(reloadIdx >= 0);
  const reloadBlock = userRoute.slice(reloadIdx, reloadIdx + 2500);
  assert.ok(reloadBlock.includes("wallet_type: 'usdt'"));
  assert.ok(!reloadBlock.includes("wallet_type: 'mmk'"));
  assert.ok(!reloadBlock.includes('parseFloat(req.body.amount_mmk)'));
  assert.ok(!reloadBlock.includes('reloadCardFromWallet'));

  assert.ok(depositRoute.includes('USDT_ONLY_DEPOSIT'));
  assert.ok(!depositRoute.includes('createDepositRequest('));
  assert.ok(depositRoute.includes("deposit_type || 'usdt'"));
  assert.ok(depositRoute.includes('MMK bank deposits are no longer supported'));

  const verifyIdx = depositRoute.indexOf("router.post('/verify'");
  const verifyBlock = depositRoute.slice(verifyIdx, verifyIdx + 500);
  assert.ok(verifyBlock.includes('USDT_ONLY_DEPOSIT'));
  assert.ok(!verifyBlock.includes('verifyByListener'));

  console.log('ok');
}

function testServicesAndModels() {
  section('Services and models enforce USDT-only');
  const depositSvc = read('backend/src/services/depositService.js');
  const walletSvc = read('backend/src/services/walletService.js');
  const cardWallet = read('backend/src/services/cardWalletService.js');
  const reloadModel = read('backend/src/models/CardReloadRequest.js');
  const depositModel = read('backend/src/models/DepositRequest.js');
  const migration049 = read('backend/migrations/049_usdt_only_deposits_reloads.sql');
  const migration050 = read('backend/migrations/050_schema_usdt_only_currency.sql');

  assert.ok(depositSvc.includes('USDT_ONLY_DEPOSIT'));
  assert.ok(depositSvc.includes('USDT_ONLY_CARD_RELOAD'));
  assert.ok(!cardWallet.includes('reloadCardFromWallet'));
  assert.ok(!cardWallet.includes('debitMmk'));

  const allowList = walletSvc.slice(
    walletSvc.indexOf('MMK_WALLET_ALLOWED_DEBIT_PURPOSES'),
    walletSvc.indexOf('function assertMmkDebitAllowed')
  );
  assert.ok(!allowList.includes("'card_reload'"));
  assert.ok(allowList.includes("'mmk_bank_withdrawal'"));
  assert.ok(walletSvc.includes('USDT_ONLY_CARD_RELOAD'));

  assert.ok(reloadModel.includes('USDT_ONLY_CARD_RELOAD'));
  assert.ok(depositModel.includes('USDT_ONLY_DEPOSIT'));
  assert.ok(depositModel.includes("depositCurrency || 'USDT'"));
  assert.ok(!depositModel.includes("'MMK'"));
  assert.ok(migration049.includes('trg_card_reload_reject_mmk_insert'));
  assert.ok(migration049.includes('trg_deposit_reject_mmk_insert'));
  assert.ok(migration050.includes("CHECK(deposit_currency IN ('USDT'))"));
  assert.ok(migration050.includes("CHECK(wallet_type IN ('usdt'))"));
  assert.ok(migration050.includes('minimum_card_reload_mmk'));

  console.log('ok');
}

async function testRuntimeGuards() {
  section('Runtime guards reject MMK deposit/reload attempts');
  process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `eisy-usdt-only-${Date.now()}.db`)}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';

  delete require.cache[require.resolve('../src/db')];
  delete require.cache[require.resolve('../src/services/depositService')];
  delete require.cache[require.resolve('../src/models/CardReloadRequest')];
  delete require.cache[require.resolve('../src/models/DepositRequest')];

  const { initDb, closeDb } = require('../src/db');
  await initDb();

  const { createDepositRequest } = require('../src/services/depositService');
  const CardReloadRequest = require('../src/models/CardReloadRequest');
  const DepositRequest = require('../src/models/DepositRequest');

  let depositErr = null;
  try {
    await createDepositRequest(1, { amount_mmk: 50000, payment_method: 'kbzpay', purpose: 'topup' });
  } catch (e) {
    depositErr = e;
  }
  assert.ok(depositErr);
  assert.strictEqual(depositErr.code, 'USDT_ONLY_DEPOSIT');

  let reloadErr = null;
  try {
    await CardReloadRequest.create({
      userId: 1,
      cardId: 1,
      walletType: 'mmk',
      amountMmk: 50000,
      netUsdToCard: 10,
      reloadFeeUsd: 1,
      grossUsd: 10,
    });
  } catch (e) {
    reloadErr = e;
  }
  assert.ok(reloadErr);
  assert.strictEqual(reloadErr.code, 'USDT_ONLY_CARD_RELOAD');

  let mmkDepositErr = null;
  try {
    await DepositRequest.create({
      userId: 1,
      amountMmk: 50000,
      amountUsd: 10,
      refCode: 'REF-TEST',
      paymentMethod: 'KBZPay',
      purpose: 'topup',
      depositCurrency: 'MMK',
    });
  } catch (e) {
    mmkDepositErr = e;
  }
  assert.ok(mmkDepositErr);
  assert.strictEqual(mmkDepositErr.code, 'USDT_ONLY_DEPOSIT');

  await closeDb();
  console.log('ok');
}

async function main() {
  testRouteSources();
  testServicesAndModels();
  await testRuntimeGuards();
  console.log('\nUSDT-only deposit/reload backend — ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
