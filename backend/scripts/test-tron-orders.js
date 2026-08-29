#!/usr/bin/env node
/**
 * TRON gateway order service smoke tests (Supabase mock + local wallet credit).
 * Run: node backend/scripts/test-tron-orders.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const tronOrders = require('../src/services/tronOrderService');

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
        _pendingOnly: false,
        _orderAsc: false,
        select() { return api; },
        eq(field, value) {
          api._filters.push({ field, value });
          if (field === 'status' && value === 'PENDING') api._pendingOnly = true;
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
  const dbFile = path.join(os.tmpdir(), `eisy-tron-orders-${Date.now()}.db`);
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
  section('parseTrc20TransferAmount');
  assert.strictEqual(
    tronOrders.parseTrc20TransferAmount({
      value: '25000000',
      token_info: { decimals: 6 },
    }),
    25
  );
  console.log('ok');

  section('amountWithinTolerance');
  assert.ok(tronOrders.amountWithinTolerance(25, 25));
  assert.ok(tronOrders.amountWithinTolerance(25.01, 25));
  assert.ok(!tronOrders.amountWithinTolerance(26, 25));
  console.log('ok');

  section('createTronOrder + verifyPendingTronOrders credits wallet');
  const supabase = require('../src/lib/supabase');
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
      'TRON Order Test',
      phone
    );
    const userId = Number(userIns.lastID);

    supabase.isSupabaseEnabled = () => true;
    const mock = makeSupabaseMock([]);
    supabase.getSupabase = () => mock;

    process.env.TRON_GATEWAY_DEPOSIT_ADDRESS = 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH';
    const created = await tronOrders.createTronOrder(userId, { amount_usdt: 10 });
    assert.strictEqual(created.order.deposit_address, 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH');
    assert.strictEqual(created.order.status, 'PENDING');
    assert.strictEqual(created.order.amount, 10);
    assert.strictEqual(created.order.user_id, userId);
    assert.ok(created.order.local_deposit_id);
    assert.ok(created.order.order_id.startsWith('TRON'));
    assert.ok(created.deposit?.id);

    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      assert.match(String(url), /transactions\/trc20/);
      assert.match(String(url), /only_to=true/);
      assert.match(String(url), /contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t/);
      return {
        ok: true,
        json: async () => ({
          data: [{
            transaction_id: 'abc123txhash',
            type: 'Transfer',
            to: 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH',
            from: 'TSenderExample111111111111111111111',
            value: '10000000',
            block_timestamp: Date.now(),
            token_info: { decimals: 6, symbol: 'USDT' },
          }],
        }),
      };
    };

    const verifyResult = await tronOrders.verifyPendingTronOrders();
    assert.strictEqual(verifyResult.completed, 1);
    assert.strictEqual(verifyResult.credited, 1);
    assert.strictEqual(verifyResult.matches[0].wallet_credited, true);
    assert.strictEqual(verifyResult.matches[0].net_usdt, 9);

    const completedRow = mock.state.rows.find((row) => row.order_id === created.order.order_id);
    assert.strictEqual(completedRow.status, 'COMPLETED');
    assert.strictEqual(completedRow.tx_hash, 'abc123txhash');
    assert.ok(completedRow.credited_at);

    const creditedDeposit = await db.get(
      'SELECT * FROM deposit_requests_v2 WHERE id = ?',
      created.deposit.id
    );
    assert.strictEqual(creditedDeposit.status, 'VERIFIED');
    assert.strictEqual(creditedDeposit.tx_hash, 'abc123txhash');

    const user = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
    assert.strictEqual(Number(user.balance_usdt), 9);

    global.fetch = originalFetch;
    supabase.isSupabaseEnabled = originalEnabled;
    supabase.getSupabase = originalGet;
    delete process.env.TRON_GATEWAY_DEPOSIT_ADDRESS;
    if (previousHdEnabled == null) delete process.env.TRON_HD_ENABLED;
    else process.env.TRON_HD_ENABLED = previousHdEnabled;
    if (previousMnemonic == null) delete process.env.TRON_HD_MNEMONIC;
    else process.env.TRON_HD_MNEMONIC = previousMnemonic;
    console.log('ok');
  });

  console.log('\nTRON order service checks passed.');
}

main().catch((err) => {
  console.error('\nTRON order checks FAILED:', err);
  process.exit(1);
});
