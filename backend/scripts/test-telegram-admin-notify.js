#!/usr/bin/env node
'use strict';

/**
 * Admin Telegram alerts for deposit requests, card creation, and withdrawals.
 * Run: node backend/scripts/test-telegram-admin-notify.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const { loadTelegramClient } = require('../src/services/loadTelegramClient');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const lib = loadTelegramClient();
assert.strictEqual(typeof lib.sendAdminMessage, 'function');
assert.strictEqual(typeof lib.notifyAdminDepositRequest, 'function');
assert.strictEqual(typeof lib.notifyAdminCardCreated, 'function');
assert.strictEqual(typeof lib.notifyAdminWithdrawalRequest, 'function');

const source = read('lib/telegram.ts');
assert.ok(!/export\s+function/.test(source), 'telegram lib stays CommonJS-loadable');
assert.ok(source.includes('module.exports'), 'telegram lib assigns module.exports');

const depositSvc = read('backend/src/services/depositService.js');
const tronOrders = read('backend/src/services/tronOrderService.js');
const cards = read('backend/src/services/pagoCardService.js');
const withdrawals = read('backend/src/services/withdrawalService.js');
const cryptoWithdraw = read('backend/src/services/withdrawCryptoService.js');
const telegramSvc = read('backend/src/services/telegram.js');

assert.ok(depositSvc.includes('notifyAdminDepositForUser'), 'USDT deposit request notifies admin');
assert.ok(tronOrders.includes('notifyAdminDepositForUser'), 'TRON deposit request notifies admin');
assert.ok(cards.includes('notifyAdminCardCreated'), 'card creation notifies admin');
assert.ok(withdrawals.includes('notifyAdminWithdrawalForUser'), 'withdrawal requests notify admin');
assert.ok(cryptoWithdraw.includes('notifyAdminWithdrawalForUser'), 'master-wallet withdrawal notifies admin');
assert.ok(telegramSvc.includes('loadTelegramClient'), 'service uses lib/telegram.ts');
assert.ok(telegramSvc.includes('sendAdminMessage'), 'existing send helper remains');

function mockFetch(calls, failFirst = false) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    if (failFirst && calls.length === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: 'Bad Request: can\'t parse entities' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 41 } }),
    };
  };
}

async function run() {
  const skipped = await lib.notifyAdminDepositRequest({
    user: { name: 'Skip User', email: 'skip@example.com' },
    amountUsdt: 10,
    refCode: 'DEP-SKIP',
    token: '',
    chatId: '',
  });
  assert.strictEqual(skipped.ok, false);
  assert.strictEqual(skipped.skipped, true);

  const depositCalls = [];
  const deposit = await lib.notifyAdminDepositRequest({
    user: { name: 'Ada', email: 'ada@example.com' },
    amountUsdt: 100,
    feeUsdt: 2,
    netUsdt: 98,
    network: 'TRC20',
    refCode: 'DEP-100',
    address: 'TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    token: 'test-token',
    chatId: '555',
    fetchImpl: mockFetch(depositCalls),
  });
  assert.strictEqual(deposit.ok, true);
  assert.strictEqual(deposit.message.message_id, 41);
  assert.strictEqual(depositCalls[0].chat_id, '555');
  assert.ok(depositCalls[0].text.includes('Deposit request'));
  assert.ok(depositCalls[0].text.includes('$100.00'));
  assert.ok(depositCalls[0].text.includes('DEP-100'));
  assert.ok(depositCalls[0].text.includes('ada@example.com'));

  const cardCalls = [];
  const card = await lib.notifyAdminCardCreated({
    user: { name: 'Ada', email: 'ada@example.com' },
    card: { last_four: '4048', product_code: 'us_404_visa_bin' },
    pricing: { card_issuance_fee_usd: 7.25, initial_load_usd: 0 },
    debitedUsdt: 8.75,
    token: 'test-token',
    chatId: '555',
    fetchImpl: mockFetch(cardCalls),
  });
  assert.strictEqual(card.ok, true);
  assert.ok(cardCalls[0].text.includes('Card created'));
  assert.ok(cardCalls[0].text.includes('4048'));
  assert.ok(cardCalls[0].text.includes('$7.25'));
  assert.ok(cardCalls[0].text.includes('$8.75'));
  assert.ok(!cardCalls[0].text.includes('4111'), 'card number stays out of the admin message');

  const withdrawCalls = [];
  const withdrawal = await lib.notifyAdminWithdrawalRequest({
    user: { name: 'Ada', email: 'ada@example.com' },
    kind: 'USDT',
    network: 'TRC20',
    amountUsdt: 50,
    feeUsdt: 2,
    netUsdt: 48,
    destination: 'TDESTXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    refCode: 'WD-50',
    status: 'pending',
    token: 'test-token',
    chatId: '555',
    fetchImpl: mockFetch(withdrawCalls),
  });
  assert.strictEqual(withdrawal.ok, true);
  assert.ok(withdrawCalls[0].text.includes('Withdrawal request'));
  assert.ok(withdrawCalls[0].text.includes('$50.00'));
  assert.ok(withdrawCalls[0].text.includes('WD-50'));
  assert.ok(withdrawCalls[0].text.includes('pending'));

  const mmkCalls = [];
  await lib.notifyAdminWithdrawalRequest({
    user: { name: 'Ada' },
    kind: 'MMK',
    currency: 'MMK',
    amountMmk: 100000,
    feeMmk: 2000,
    netMmk: 98000,
    destination: 'KBZ 123456',
    refCode: 'WM-1',
    status: 'pending',
    token: 'test-token',
    chatId: '555',
    fetchImpl: mockFetch(mmkCalls),
  });
  assert.ok(mmkCalls[0].text.includes('100,000 MMK'));
  assert.ok(mmkCalls[0].text.includes('98,000 MMK'));

  const retryCalls = [];
  const retried = await lib.sendAdminMessage('Hello *Ada*', {
    token: 'test-token',
    chatId: '555',
    fetchImpl: mockFetch(retryCalls, true),
  });
  assert.strictEqual(retried.ok, true);
  assert.strictEqual(retried.plain, true);
  assert.strictEqual(retryCalls.length, 2);
  assert.ok(!retryCalls[1].parse_mode);

  console.log('telegram admin notify checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
