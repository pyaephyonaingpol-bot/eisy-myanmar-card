#!/usr/bin/env node
/**
 * Per-user TRON HD deposit address tests.
 * Run: node backend/scripts/test-tron-hd-addresses.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');

process.chdir(path.join(__dirname, '..'));

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function withTempDb(fn) {
  const dbFile = path.join(os.tmpdir(), `eisy-tron-hd-${Date.now()}.db`);
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
  const mnemonic = generateMnemonic(wordlist, 128);
  process.env.TRON_HD_ENABLED = 'true';
  process.env.TRON_HD_MNEMONIC = mnemonic;
  delete process.env.TRON_HD_SEED_HEX;

  section('deterministic unique addresses per user');
  // Clear module caches so env is picked up.
  delete require.cache[require.resolve('../src/services/tronHdWalletService')];
  const hd = require('../src/services/tronHdWalletService');
  assert.strictEqual(hd.isHdEnabled(), true);

  const a1 = hd.getPublicDepositAddressForUser(1);
  const a1b = hd.getPublicDepositAddressForUser(1);
  const a2 = hd.getPublicDepositAddressForUser(2);

  assert.strictEqual(a1.address, a1b.address);
  assert.strictEqual(a1.path, "m/44'/195'/0'/0/1");
  assert.strictEqual(a2.path, "m/44'/195'/0'/0/2");
  assert.notStrictEqual(a1.address, a2.address);
  assert.ok(/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a1.address));
  console.log('ok', a1.address, 'vs', a2.address);

  section('ensureUserTronDepositAddress persists + supabase sync hooks');
  await withTempDb(async () => {
    delete require.cache[require.resolve('../src/services/tronDepositAddressService')];
    delete require.cache[require.resolve('../src/models/UserUsdtWalletAddress')];
    const { ensureUserTronDepositAddress } = require('../src/services/tronDepositAddressService');
    const { UserUsdtWalletAddress } = require('../src/models/UserUsdtWalletAddress');
    const { getDb } = require('../src/db');
    const db = getDb();

    const userIns = await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 0)`,
      'HD User',
      `09${String(Date.now()).slice(-8)}`
    );
    const userId = Number(userIns.lastID);

    const supabase = require('../src/lib/supabase');
    const upserts = [];
    supabase.isSupabaseEnabled = () => true;
    supabase.getSupabase = () => ({
      from(table) {
        return {
          upsert(row) {
            upserts.push({ table, row });
            return Promise.resolve({ error: null });
          },
        };
      },
    });

    const first = await ensureUserTronDepositAddress(userId);
    assert.strictEqual(first.created, true);
    assert.strictEqual(first.address, hd.getPublicDepositAddressForUser(userId).address);
    assert.strictEqual(first.index, userId);

    const row = await UserUsdtWalletAddress.findCustodial(userId, 'TRC20');
    assert.strictEqual(row.address, first.address);
    assert.strictEqual(Number(row.derivation_index), userId);
    assert.ok(String(row.derivation_path).includes("/195'/"));

    const second = await ensureUserTronDepositAddress(userId);
    assert.strictEqual(second.created, false);
    assert.strictEqual(second.address, first.address);

    assert.ok(upserts.some((u) => u.table === 'user_wallets' && u.row.tron_deposit_address === first.address));
    assert.ok(upserts.some((u) => u.table === 'user_tron_deposit_addresses' && u.row.address === first.address));
    console.log('ok');
  });

  section('createTronOrder uses HD address; poller watches it');
  await withTempDb(async () => {
    delete require.cache[require.resolve('../src/services/tronOrderService')];
    delete require.cache[require.resolve('../src/services/tronDepositAddressService')];
    const tronOrders = require('../src/services/tronOrderService');
    const hdLocal = require('../src/services/tronHdWalletService');
    const crypto = require('crypto');
    const { getDb } = require('../src/db');
    const db = getDb();

    const userIns = await db.run(
      `INSERT INTO users (name, phone, balance_usdt) VALUES (?, ?, 0)`,
      'HD Order User',
      `09${String(Date.now()).slice(-8)}`
    );
    const userId = Number(userIns.lastID);
    const expectedAddr = hdLocal.getPublicDepositAddressForUser(userId).address;

    const supabase = require('../src/lib/supabase');
    const state = { rows: [] };
    supabase.isSupabaseEnabled = () => true;
    supabase.getSupabase = () => ({
      from(table) {
        if (table !== 'orders') {
          return {
            upsert: async () => ({ error: null }),
          };
        }
        const api = {
          _filters: [],
          select() { return api; },
          eq(field, value) {
            api._filters.push({ field, value });
            return api;
          },
          order() { return api; },
          insert(payload) {
            const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...payload };
            state.rows.push(row);
            return { select() { return { single: async () => ({ data: row, error: null }) }; } };
          },
          update(payload) {
            const filters = [];
            const updater = {
              eq(field, value) { filters.push([field, value]); return updater; },
              select() { return updater; },
              maybeSingle: async () => {
                const row = state.rows.find((c) => filters.every(([f, v]) => c[f] === v));
                if (row) Object.assign(row, payload);
                return { data: row || null, error: null };
              },
            };
            return updater;
          },
          async then(resolve, reject) {
            try {
              let result = [...state.rows];
              for (const f of api._filters) result = result.filter((r) => r[f.field] === f.value);
              resolve({ data: result, error: null });
            } catch (err) { reject(err); }
          },
        };
        return api;
      },
    });

    const created = await tronOrders.createTronOrder(userId, { amount_usdt: 10 });
    assert.strictEqual(created.payment.deposit_address_source, 'hd');
    assert.strictEqual(created.order.deposit_address, expectedAddr);
    assert.strictEqual(created.payment.deposit_address, expectedAddr);

    const originalFetch = global.fetch;
    let fetchedUrl = '';
    global.fetch = async (url) => {
      fetchedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          data: [{
            transaction_id: 'hd-tx-1',
            type: 'Transfer',
            to: expectedAddr,
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
    assert.strictEqual(verifyResult.addresses_watched, 1);
    assert.match(fetchedUrl, new RegExp(encodeURIComponent(expectedAddr)));
    assert.strictEqual(verifyResult.matches[0].deposit_address, expectedAddr);

    global.fetch = originalFetch;
    console.log('ok');
  });

  delete process.env.TRON_HD_MNEMONIC;
  delete process.env.TRON_HD_ENABLED;
  console.log('\nTRON HD address checks passed.');
}

main().catch((err) => {
  console.error('\nTRON HD checks FAILED:', err);
  process.exit(1);
});
