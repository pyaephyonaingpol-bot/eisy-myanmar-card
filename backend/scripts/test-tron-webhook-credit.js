#!/usr/bin/env node
/**
 * Shared TRC20 credit path: webhook + unified createUsdtDepositRequest → createTronOrder.
 * Run: node backend/scripts/test-tron-webhook-credit.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

function makeSupabaseMock(rows) {
  const state = { rows: [...rows] };
  return {
    state,
    from(table) {
      if (table !== 'orders') {
        return {
          upsert: async () => ({ error: null }),
          insert: async () => ({ error: null }),
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: null }),
        };
      }
      const api = {
        _filters: [],
        _orderAsc: false,
        select() { return api; },
        eq(field, value) {
          api._filters.push({ field, value });
          return api;
        },
        order(_field, { ascending } = {}) {
          api._orderAsc = ascending !== false;
          return api;
        },
        insert(payload) {
          const row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...payload,
          };
          state.rows.push(row);
          return {
            select() {
              return {
                single: async () => ({ data: row, error: null }),
              };
            },
          };
        },
        update(payload) {
          const filters = [];
          const updater = {
            eq(field, value) {
              filters.push([field, value]);
              return updater;
            },
            select() {
              return updater;
            },
            maybeSingle: async () => {
              const row = state.rows.find((candidate) => (
                filters.every(([field, value]) => candidate[field] === value)
              ));
              if (row) Object.assign(row, payload);
              return { data: row || null, error: null };
            },
          };
          return updater;
        },
        async then(resolve, reject) {
          try {
            let result = [...state.rows];
            for (const f of api._filters) {
              result = result.filter((row) => row[f.field] === f.value);
            }
            if (api._orderAsc) {
              result.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
            }
            resolve({ data: result, error: null });
          } catch (err) {
            reject(err);
          }
        },
      };
      return api;
    },
  };
}

async function withTempDb(fn) {
  const dbFile = path.join(os.tmpdir(), `eisy-tron-webhook-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';

  const { initDb, closeDb } = require('../src/db');
  await initDb();

  try {
    await fn();
  } finally {
    await closeDb?.();
    try { fs.unlinkSync(dbFile); } catch (_) {}
  }
}

async function main() {
  const credit = require('../src/services/tronDepositCreditService');
  const tronOrders = require('../src/services/tronOrderService');
  const { createUsdtDepositRequest } = require('../src/services/depositService');
  const supabase = require('../src/lib/supabase');

  section('normalizeWebhookTransfers');
  const events = credit.normalizeWebhookTransfers({
    transaction_id: 'tx-norm-1',
    to: 'TDestination111111111111111111111',
    value: '15000000',
    token_info: { decimals: 6, symbol: 'USDT' },
    block_timestamp: 1_700_000_000_000,
  });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].amountUsdt, 15);
  assert.strictEqual(events[0].txHash, 'tx-norm-1');
  console.log('ok');

  section('createUsdtDepositRequest delegates to createTronOrder + webhook credits');
  const originalEnabled = supabase.isSupabaseEnabled;
  const originalGet = supabase.getSupabase;
  const previousHdEnabled = process.env.TRON_HD_ENABLED;
  const previousMnemonic = process.env.TRON_HD_MNEMONIC;
  process.env.TRON_HD_ENABLED = 'false';
  delete process.env.TRON_HD_MNEMONIC;

  await withTempDb(async () => {
    const { getDb } = require('../src/db');
    const db = getDb();
    const phone = `09${String(Date.now()).slice(-8)}`;
    const userIns = await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 0)`,
      'Webhook Credit Test',
      phone
    );
    const userId = Number(userIns.lastID);

    supabase.isSupabaseEnabled = () => true;
    const mock = makeSupabaseMock([]);
    supabase.getSupabase = () => mock;
    process.env.TRON_GATEWAY_DEPOSIT_ADDRESS = 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH';

    const created = await createUsdtDepositRequest(userId, {
      amount_usdt: 10,
      network: 'TRC20',
      metadata: { deposit_channel: 'platform_direct' },
    });

    assert.ok(created.order, 'order must be created');
    assert.strictEqual(created.provider, 'tron_trc20');
    assert.strictEqual(created.network, 'TRC20');
    assert.strictEqual(created.depositAddress, 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH');
    assert.ok(created.deposit?.id);
    assert.strictEqual(created.order.status, 'PENDING');
    assert.ok(
      mock.state.rows.some((row) => row.order_id === created.order.order_id),
      'Supabase orders row missing'
    );

    const webhookResult = await credit.handleTronDepositWebhook({
      to_address: 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH',
      amount_usdt: 10,
      tx_hash: 'webhook-tx-abc',
      block_timestamp: Date.now(),
    });

    assert.strictEqual(webhookResult.completed, 1);
    assert.strictEqual(webhookResult.credited, 1);

    const completedRow = mock.state.rows.find((row) => row.order_id === created.order.order_id);
    assert.strictEqual(completedRow.status, 'COMPLETED');
    assert.strictEqual(completedRow.tx_hash, 'webhook-tx-abc');

    const deposit = await db.get(
      'SELECT * FROM deposit_requests_v2 WHERE id = ?',
      created.deposit.id
    );
    assert.strictEqual(deposit.status, 'VERIFIED');
    assert.strictEqual(deposit.tx_hash, 'webhook-tx-abc');

    const user = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
    assert.strictEqual(Number(user.balance_usdt), 9);

    // Idempotent replay
    const replay = await credit.handleTronDepositWebhook({
      to_address: 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH',
      amount_usdt: 10,
      tx_hash: 'webhook-tx-abc',
      block_timestamp: Date.now(),
    });
    assert.ok(replay.ok);
    const userAfter = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
    assert.strictEqual(Number(userAfter.balance_usdt), 9);

    // BEP20 rejected
    let rejected = false;
    try {
      await createUsdtDepositRequest(userId, { amount_usdt: 10, network: 'BEP20' });
    } catch (err) {
      rejected = true;
      assert.strictEqual(err.code, 'USDT_TRC20_ONLY');
    }
    assert.ok(rejected, 'BEP20 must be rejected');

    // Poller still works via re-export
    assert.strictEqual(typeof tronOrders.verifyPendingTronOrders, 'function');
    assert.strictEqual(typeof tronOrders.runTronOrderPollSafely, 'function');
  });

  supabase.isSupabaseEnabled = originalEnabled;
  supabase.getSupabase = originalGet;
  delete process.env.TRON_GATEWAY_DEPOSIT_ADDRESS;
  if (previousHdEnabled == null) delete process.env.TRON_HD_ENABLED;
  else process.env.TRON_HD_ENABLED = previousHdEnabled;
  if (previousMnemonic == null) delete process.env.TRON_HD_MNEMONIC;
  else process.env.TRON_HD_MNEMONIC = previousMnemonic;

  console.log('\nAll tron webhook/credit tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
