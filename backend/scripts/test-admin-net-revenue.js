#!/usr/bin/env node
'use strict';

/**
 * Net revenue from Tron deposits, withdrawals, card issue, and card top-ups.
 * Run: node backend/scripts/test-admin-net-revenue.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `eisy-net-revenue-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.NODE_ENV = 'test';
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|TURSO|PAGO/i.test(key)) delete process.env[key];
}

function utcDay(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function previousMonthDay() {
  const d = new Date();
  d.setUTCDate(15);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function at(day) {
  return `${day} 12:00:00`;
}

async function main() {
  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();
  const { setSetting } = require('../src/services/settingsService');
  const { getNetRevenueReport } = require('../src/services/revenueAnalyticsService');
  const { PLATFORM_FEE_TYPES } = require('../src/constants/platformFeeTypes');

  await setSetting('card_issuance_fee_usd', '5');
  await setSetting('card_issue_provider_cost_usd', '1.50');
  await setSetting('card_reload_provider_cost_usd', '1.50');

  const today = utcDay(0);
  const earlier = utcDay(-Math.min(6, Math.max(1, new Date().getUTCDate() - 1)));
  const older = previousMonthDay();
  assert.notStrictEqual(earlier, older);

  const user = await db.run(
    `INSERT INTO users (name, phone, email, balance_usdt) VALUES (?, ?, ?, 0)`,
    'Revenue Fixture',
    `096${String(Date.now()).slice(-8)}`,
    `revenue-${Date.now()}@example.com`
  );
  const userId = Number(user.lastID);
  const card = await db.run(
    `INSERT INTO cards_v2 (user_id, card_number, exp_date, cvv, card_holder_name, status)
     VALUES (?, '4111111111111111', '12/30', '123', 'Revenue Fixture', 'active')`,
    userId
  );
  const cardId = Number(card.lastID);

  async function deposit({ ref, network, status, profit, metadata, when }) {
    await db.run(
      `INSERT INTO deposit_requests_v2 (
         user_id, amount_usd, ref_code, payment_method, deposit_currency, usdt_network,
         status, platform_profit_usd, metadata, verified_at, created_at, updated_at
       ) VALUES (?, 100, ?, ?, 'USDT', ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      ref,
      network === 'TRC20' ? 'USDT-TRC20' : 'USDT-BEP20',
      network,
      status,
      profit,
      metadata ? JSON.stringify(metadata) : null,
      status === 'VERIFIED' ? when : null,
      when,
      when
    );
  }

  async function withdrawal({ ref, fee, status, when }) {
    await db.run(
      `INSERT INTO usdt_withdrawal_requests (
         user_id, ref_code, network, wallet_address, amount_usdt, fee_usdt, net_usdt, status, created_at, updated_at
       ) VALUES (?, ?, 'TRC20', 'TNTU3x2BLuJg3MQCnk6hne43NpgphMK2NJ', 50, ?, ?, ?, ?, ?)`,
      userId,
      ref,
      fee,
      Math.round((50 - fee) * 100) / 100,
      status,
      when,
      when
    );
  }

  await deposit({ ref: 'REV-TRON-TODAY', network: 'TRC20', status: 'VERIFIED', profit: 2, when: at(today) });
  await deposit({
    ref: 'REV-TRON-META',
    network: 'TRC20',
    status: 'VERIFIED',
    profit: 0,
    metadata: { fee_usdt: 1.25 },
    when: at(today),
  });
  await deposit({ ref: 'REV-BEP', network: 'BEP20', status: 'VERIFIED', profit: 9, when: at(today) });
  await deposit({ ref: 'REV-PENDING', network: 'TRC20', status: 'PENDING', profit: 5, when: at(today) });
  await deposit({ ref: 'REV-MONTH', network: 'TRC20', status: 'VERIFIED', profit: 4, when: at(earlier) });
  await deposit({ ref: 'REV-OLD', network: 'TRC20', status: 'VERIFIED', profit: 10, when: at(older) });

  await withdrawal({ ref: 'REV-WD-OK', fee: 3, status: 'completed', when: at(today) });
  await withdrawal({ ref: 'REV-WD-PEND', fee: 1.5, status: 'pending', when: at(today) });
  await withdrawal({ ref: 'REV-WD-CANCEL', fee: 8, status: 'cancelled', when: at(today) });
  await withdrawal({ ref: 'REV-WD-MONTH', fee: 2, status: 'completed', when: at(earlier) });
  await withdrawal({ ref: 'REV-WD-OLD', fee: 6, status: 'completed', when: at(older) });

  await db.run(
    `INSERT INTO platform_fee_events (fee_type, amount, currency, metadata, collected_at)
     VALUES (?, 6.5, 'USD', ?, ?)`,
    PLATFORM_FEE_TYPES.CARD_ISSUE,
    JSON.stringify({ card_issuance_fee_usd: 5, card_processing_fee_usd: 1.5 }),
    at(today)
  );
  await db.run(
    `INSERT INTO platform_fee_events (fee_type, amount, currency, collected_at)
     VALUES (?, 8, 'USD', ?)`,
    PLATFORM_FEE_TYPES.CARD_ISSUE,
    at(today)
  );
  await db.run(
    `INSERT INTO platform_fee_events (fee_type, amount, currency, metadata, collected_at)
     VALUES (?, 7, 'USD', ?, ?)`,
    PLATFORM_FEE_TYPES.CARD_ISSUE,
    JSON.stringify({ card_issuance_fee_usd: 7 }),
    at(older)
  );

  await db.run(
    `INSERT INTO transaction_logs (user_id, type, description, reference_type, reference_id, metadata, created_at)
     VALUES (?, 'card_topup', 'top-up', 'cards_v2', ?, ?, ?)`,
    userId,
    cardId,
    JSON.stringify({ reload_fee_usd: 3.5 }),
    at(today)
  );
  await db.run(
    `INSERT INTO transaction_logs (user_id, type, description, reference_type, reference_id, metadata, created_at)
     VALUES (?, 'card_topup', 'top-up', 'cards_v2', ?, ?, ?)`,
    userId,
    cardId,
    JSON.stringify({ reload_fee_usd: 2.2 }),
    at(today)
  );
  await db.run(
    `INSERT INTO card_reload_requests (
       user_id, card_id, wallet_type, net_usd_to_card, reload_fee_usd, status, pricing_json, created_at, reviewed_at
     ) VALUES (?, ?, 'usdt', 10, 3.5, 'approved', '{}', ?, ?)`,
    userId,
    cardId,
    at(today),
    at(today)
  );
  await db.run(
    `INSERT INTO card_reload_requests (
       user_id, card_id, wallet_type, net_usd_to_card, reload_fee_usd, status, pricing_json, created_at, reviewed_at
     ) VALUES (?, ?, 'usdt', 20, 5.5, 'approved', ?, ?, ?)`,
    userId,
    cardId,
    JSON.stringify({ net_profit_usd: 4 }),
    at(today),
    at(today)
  );
  await db.run(
    `INSERT INTO card_reload_requests (
       user_id, card_id, wallet_type, net_usd_to_card, reload_fee_usd, status, created_at
     ) VALUES (?, ?, 'usdt', 10, 9, 'pending', ?)`,
    userId,
    cardId,
    at(today)
  );

  const report = await getNetRevenueReport();
  const todayRow = report.periods.today;
  const monthRow = report.periods.this_month;
  const allRow = report.periods.all_time;

  assert.strictEqual(todayRow.tron_deposit_fees_usd, 3.25);
  assert.strictEqual(todayRow.withdrawal_fees_usd, 4.5);
  assert.strictEqual(todayRow.card_issue_profit_usd, 7);
  assert.strictEqual(todayRow.card_topup_markup_usd, 6.7);
  assert.strictEqual(todayRow.total_net_usd, 21.45);
  assert.strictEqual(todayRow.counts.tron_deposits, 2);
  assert.strictEqual(todayRow.counts.withdrawals, 2);
  assert.strictEqual(todayRow.counts.card_issues, 2);
  assert.strictEqual(todayRow.counts.card_topups, 3);

  const monthIncludesEarlier = earlier.slice(0, 7) === today.slice(0, 7);
  if (monthIncludesEarlier) {
    assert.strictEqual(monthRow.tron_deposit_fees_usd, 7.25);
    assert.strictEqual(monthRow.withdrawal_fees_usd, 6.5);
    assert.strictEqual(monthRow.total_net_usd, 27.45);
  }
  assert.ok(monthRow.tron_deposit_fees_usd < allRow.tron_deposit_fees_usd);

  assert.strictEqual(allRow.tron_deposit_fees_usd, 17.25);
  assert.strictEqual(allRow.withdrawal_fees_usd, 12.5);
  assert.strictEqual(allRow.card_issue_profit_usd, 12.5);
  assert.strictEqual(allRow.card_topup_markup_usd, 6.7);
  assert.strictEqual(allRow.total_net_usd, 48.95);
  assert.strictEqual(report.total_net_usd, allRow.total_net_usd);
  assert.strictEqual(report.formula.card_issue_provider_cost_usd, 1.5);
  assert.strictEqual(report.breakdown.length, 4);
  assert.strictEqual(report.breakdown[2].all_time, 12.5);

  console.log(JSON.stringify({
    today: todayRow.total_net_usd,
    this_month: monthRow.total_net_usd,
    all_time: allRow.total_net_usd,
  }));
  console.log('Admin net revenue checks passed.');

  await closeDb();
  try { fs.unlinkSync(dbFile); } catch (_) { /* ignore */ }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
