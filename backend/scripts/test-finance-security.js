#!/usr/bin/env node
'use strict';

/**
 * Wallet credit, withdrawal, card issue, and card top-up balance checks.
 * Run: node backend/scripts/test-finance-security.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `eisy-finance-security-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
process.env.WITHDRAWALS_PAUSED = 'false';
process.env.AUTO_ONCHAIN_WITHDRAWALS = 'false';
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|TURSO/i.test(key)) delete process.env[key];
}

const TRC20 = 'TNTU3x2BLuJg3MQCnk6hne43NpgphMK2NJ';

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function balanceOf(db, userId) {
  const row = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  return Number(row?.balance_usdt ?? 0);
}

async function main() {
  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();
  const DepositRequest = require('../src/models/DepositRequest');
  const Card = require('../src/models/Card');
  const { creditDepositAndVerify } = require('../src/services/depositService');
  const { createUsdtWithdrawalRequest } = require('../src/services/withdrawalService');
  const { setSetting } = require('../src/services/settingsService');
  const { issuePagoCardForUser, topUpPagoCard } = require('../src/services/pagoCardService');

  await setSetting('withdrawal_service_fee_mode', 'fixed_plus_percent');
  await setSetting('withdrawal_service_fee_fixed_usdt', '2');
  await setSetting('withdrawal_service_fee_percent', '2');
  await setSetting('withdrawal_service_fee_minimum_usdt', '0');
  await setSetting('card_reload_fee_usd', '2');
  await setSetting('card_reload_fee_percent', '2');
  await setSetting('card_reload_fee_minimum_usd', '0');
  await setSetting('card_issuance_fee_usd', '5');

  const stamp = String(Date.now()).slice(-8);
  const depositor = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt) VALUES (?, ?, ?, 0)`,
    'Deposit Security',
    `093${stamp}`,
    `deposit-${stamp}@example.com`
  );
  const depositorId = Number(depositor.lastID);

  console.log('== Deposit does not credit until verification ==');
  const pending = await DepositRequest.create({
    userId: depositorId,
    amountMmk: 0,
    amountUsd: 100,
    refCode: `REF-SEC-${stamp}`,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    platformProfitUsd: 2,
    metadata: {
      payment_fee: { fee_usdt: 2, net_usdt: 98 },
      pricing: { fee_usdt: 2, net_usdt: 98 },
    },
  });
  assert.strictEqual(await balanceOf(db, depositorId), 0);
  const credited = await creditDepositAndVerify(pending, {
    txnId: `tx-sec-${stamp}`,
    createdBy: 'admin',
    adminNote: 'security test approval',
  });
  assert.strictEqual(credited.alreadyVerified, false);
  assert.strictEqual(credited.net_usdt, 98);
  assert.strictEqual(await balanceOf(db, depositorId), 98);
  const again = await creditDepositAndVerify(credited.deposit, {
    txnId: `tx-sec-${stamp}`,
    createdBy: 'admin',
  });
  assert.strictEqual(again.alreadyVerified, true);
  assert.strictEqual(await balanceOf(db, depositorId), 98);

  const inflated = await DepositRequest.create({
    userId: depositorId,
    amountMmk: 0,
    amountUsd: 20,
    refCode: `REF-INFL-${stamp}`,
    paymentMethod: 'USDT-TRC20',
    purpose: 'usdt_topup',
    depositCurrency: 'USDT',
    usdtNetwork: 'TRC20',
    metadata: {
      payment_fee: { fee_usdt: 0, net_usdt: 5000 },
    },
  });
  const beforeInflated = await balanceOf(db, depositorId);
  const capped = await creditDepositAndVerify(inflated, {
    txnId: `tx-infl-${stamp}`,
    createdBy: 'blockchain',
  });
  assert.ok(capped.net_usdt <= 20, `credited ${capped.net_usdt} above gross 20`);
  assert.ok(await balanceOf(db, depositorId) <= beforeInflated + 20 + 0.001);
  console.log('ok');

  console.log('== Withdrawal rejects a short wallet and keeps $2 + 2% ==');
  const withdrawUser = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt) VALUES (?, ?, ?, 49)`,
    'Withdraw Security',
    `094${stamp}`,
    `withdraw-${stamp}@example.com`
  );
  const withdrawUserId = Number(withdrawUser.lastID);
  await assert.rejects(
    () => createUsdtWithdrawalRequest(withdrawUserId, {
      payout_method: 'crypto',
      network: 'TRC20',
      wallet_address: TRC20,
      amount_usdt: 50,
    }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE' && err.message === 'Insufficient balance'
  );
  assert.strictEqual(await balanceOf(db, withdrawUserId), 49);
  const openRows = await db.get(
    `SELECT COUNT(*) AS c FROM usdt_withdrawal_requests WHERE user_id = ? AND status != 'cancelled'`,
    withdrawUserId
  );
  assert.strictEqual(Number(openRows.c), 0);

  await db.run('UPDATE users SET balance_usdt = 100 WHERE id = ?', withdrawUserId);
  const paid = await createUsdtWithdrawalRequest(withdrawUserId, {
    payout_method: 'crypto',
    network: 'TRC20',
    wallet_address: TRC20,
    amount_usdt: 50,
  });
  assert.strictEqual(paid.breakdown.fee_usdt, 3);
  assert.strictEqual(paid.breakdown.net_usdt, 47);
  assert.strictEqual(round2(paid.breakdown.fee_usdt + paid.breakdown.net_usdt), 50);
  assert.strictEqual(await balanceOf(db, withdrawUserId), 50);
  console.log('ok');

  console.log('== Card issue blocks a wallet below the issuing fee ==');
  const cardUser = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt) VALUES (?, ?, ?, 4)`,
    'Card Security',
    `095${stamp}`,
    `card-${stamp}@example.com`
  );
  const cardUserId = Number(cardUser.lastID);
  await assert.rejects(
    () => issuePagoCardForUser({
      userId: cardUserId,
      productCode: 'us_404_visa_bin',
      email: `card-${stamp}@example.com`,
      firstName: 'Card',
      lastName: 'Security',
    }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE' && err.message === 'Insufficient balance'
  );
  assert.strictEqual(await balanceOf(db, cardUserId), 4);
  const cards = await db.get('SELECT COUNT(*) AS c FROM cards_v2 WHERE user_id = ?', cardUserId);
  assert.strictEqual(Number(cards.c), 0);
  console.log('ok');

  console.log('== Card top-up debits amount plus the reload fee ==');
  await db.run('UPDATE users SET balance_usdt = 12 WHERE id = ?', cardUserId);
  const card = await Card.issue({
    userId: cardUserId,
    cardNumber: '4111111111114048',
    expDate: '12/30',
    cvv: '123',
    cardHolderName: 'Card Security',
    status: 'active',
  });
  await db.run(
    `UPDATE cards_v2 SET pago_card_id = ?, pago_status = 'active', status = 'active' WHERE id = ?`,
    `pago-sec-${stamp}`,
    card.id
  );
  let providerCalls = 0;
  await assert.rejects(
    () => topUpPagoCard({
      userId: cardUserId,
      localCardId: card.id,
      amountUsd: 10,
    }, {
      client: {
        topUpCard: async () => {
          providerCalls += 1;
          return { status: 'active', display_amount: 10, currency: 'USD', transaction_id: 'should-not-run' };
        },
      },
    }),
    (err) => err.code === 'INSUFFICIENT_USDT_BALANCE' && err.message === 'Insufficient balance'
  );
  assert.strictEqual(providerCalls, 0);
  assert.strictEqual(await balanceOf(db, cardUserId), 12);

  await db.run('UPDATE users SET balance_usdt = 20 WHERE id = ?', cardUserId);
  const topped = await topUpPagoCard({
    userId: cardUserId,
    localCardId: card.id,
    amountUsd: 10,
  }, {
    client: {
      topUpCard: async (_id, amount) => {
        providerCalls += 1;
        assert.strictEqual(amount, 10);
        return { status: 'active', display_amount: 10, currency: 'USD', transaction_id: 'tx-topup' };
      },
    },
  });
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(topped.funded_usd, 10);
  assert.strictEqual(topped.reload_fee_usd, 2.2);
  assert.strictEqual(topped.debited_usdt, 12.2);
  assert.strictEqual(await balanceOf(db, cardUserId), 7.8);
  console.log('ok');

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
  console.log('\nFinance security checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
