#!/usr/bin/env node
/**
 * TRON gateway order service smoke tests (no live Supabase / TronGrid required).
 * Run: node backend/scripts/test-tron-orders.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');

process.chdir(require('path').join(__dirname, '..'));

const tronOrders = require('../src/services/tronOrderService');

function section(title) {
  console.log(`\n== ${title} ==`);
}

function makeSupabaseMock(rows) {
  const state = { rows: [...rows] };
  return {
    state,
    from(table) {
      assert.strictEqual(table, 'orders');
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
              if (row && payload.status) row.status = payload.status;
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

  section('createTronOrder writes master deposit address');
  const supabase = require('../src/lib/supabase');
  const originalEnabled = supabase.isSupabaseEnabled;
  const originalGet = supabase.getSupabase;

  supabase.isSupabaseEnabled = () => true;
  const mock = makeSupabaseMock([]);
  supabase.getSupabase = () => mock;

  process.env.TRON_GATEWAY_DEPOSIT_ADDRESS = 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH';
  const created = await tronOrders.createTronOrder({ amount_usdt: 50 });
  assert.strictEqual(created.order.deposit_address, 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH');
  assert.strictEqual(created.order.status, 'PENDING');
  assert.strictEqual(created.order.amount, 50);
  assert.ok(created.order.order_id.startsWith('TRON'));
  console.log('ok');

  section('verifyPendingTronOrders completes matching inbound transfer');
  const orderCreatedAt = new Date(Date.now() - 60_000).toISOString();
  mock.state.rows.push({
    id: '11111111-1111-1111-1111-111111111111',
    order_id: 'TRONTESTORDER001',
    amount: 10,
    deposit_address: 'TM8LqqR6Tz8qbvGRYAMbHv2PQgw3biPgqH',
    status: 'PENDING',
    created_at: orderCreatedAt,
  });

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
  const completedRow = mock.state.rows.find((row) => row.order_id === 'TRONTESTORDER001');
  assert.strictEqual(completedRow.status, 'COMPLETED');

  global.fetch = originalFetch;
  supabase.isSupabaseEnabled = originalEnabled;
  supabase.getSupabase = originalGet;
  delete process.env.TRON_GATEWAY_DEPOSIT_ADDRESS;
  console.log('ok');

  console.log('\nTRON order service checks passed.');
}

main().catch((err) => {
  console.error('\nTRON order checks FAILED:', err);
  process.exit(1);
});
