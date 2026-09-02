#!/usr/bin/env node
/**
 * Regression checks for Tron wallet security incident hardening.
 * Run: node backend/scripts/test-wallet-security-incident.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

async function main() {
  const dbFile = path.join(os.tmpdir(), `eisy-wallet-sec-${Date.now()}.db`);
  process.env.DATABASE_URL = `file:${dbFile}`;
  process.env.NODE_ENV = 'test';
  process.env.WITHDRAWALS_PAUSED = 'true';
  process.env.AUTO_ONCHAIN_WITHDRAWALS = 'false';
  process.env.MASTER_WALLET_TRANSFERS_PAUSED = 'true';
  process.env.AUTH_SECRET = 'test-auth-secret-for-security-suite';
  process.env.ADMIN_API_KEY = 'test-admin-key-not-default';
  delete process.env.ADMIN_DEV_BYPASS;
  for (const key of Object.keys(process.env)) {
    if (/supabase/i.test(key)) delete process.env[key];
  }

  // Fresh require after env
  delete require.cache[require.resolve('../src/services/securityFlags')];
  const flags = require('../src/services/securityFlags');
  assert.strictEqual(flags.areWithdrawalsPaused(), true, 'withdrawals paused by default');
  assert.strictEqual(flags.isAutoOnchainWithdrawalEnabled(), false, 'auto onchain off');
  assert.strictEqual(flags.areMasterWalletTransfersPaused(), true, 'master transfers paused');

  const { initDb, closeDb, getDb } = require('../src/db');
  await initDb();
  const db = getDb();

  const phone = `09${String(Date.now()).slice(-8)}`;
  const userIns = await db.run(
    `INSERT INTO users (name, phone, balance_usdt, pin_hash) VALUES (?, ?, 100, ?)`,
    'Sec Test',
    phone,
    'salt:hash'
  );
  const userId = Number(userIns.lastID);

  const { TronWeb } = require('tronweb');
  const sampleAccount = await TronWeb.createAccount();
  const validTrc20 = sampleAccount.address.base58;

  // Withdrawal service must refuse while paused
  const { createUsdtWithdrawalRequest } = require('../src/services/withdrawalService');
  let pausedErr = null;
  try {
    await createUsdtWithdrawalRequest(userId, {
      payout_method: 'crypto',
      network: 'TRC20',
      wallet_address: validTrc20,
      amount_usdt: 25,
    });
  } catch (err) {
    pausedErr = err;
  }
  assert.ok(pausedErr, 'expected pause error');
  assert.strictEqual(pausedErr.code, 'WITHDRAWALS_PAUSED');

  // Master transfer assert
  try {
    flags.assertMasterWalletTransfersAllowed('test');
    assert.fail('expected master pause');
  } catch (err) {
    assert.strictEqual(err.code, 'MASTER_WALLET_TRANSFERS_PAUSED');
  }

  // Admin middleware must not use default key when ADMIN_API_KEY is set
  const auth = require('../src/middleware/auth');
  assert.strictEqual(auth.configuredAdminApiKey(), 'test-admin-key-not-default');
  assert.strictEqual(auth.isDefaultAdminApiKey(), false);

  // Production-like: no ADMIN_API_KEY → empty key (not hardcoded default)
  const prevKey = process.env.ADMIN_API_KEY;
  const prevNode = process.env.NODE_ENV;
  const prevVercel = process.env.VERCEL;
  delete process.env.ADMIN_API_KEY;
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL;
  delete require.cache[require.resolve('../src/services/securityFlags')];
  delete require.cache[require.resolve('../src/middleware/auth')];
  require('../src/services/securityFlags');
  const authProd = require('../src/middleware/auth');
  assert.strictEqual(authProd.configuredAdminApiKey(), '', 'no default admin key in production');
  assert.strictEqual(authProd.adminDevBypassEnabled(), false, 'no admin bypass in production');
  process.env.ADMIN_API_KEY = prevKey;
  process.env.NODE_ENV = prevNode;
  if (prevVercel == null) delete process.env.VERCEL;
  else process.env.VERCEL = prevVercel;

  // Unpause and disable auto-onchain: request should queue without chain send
  process.env.WITHDRAWALS_PAUSED = 'false';
  process.env.AUTO_ONCHAIN_WITHDRAWALS = 'false';
  process.env.MASTER_WALLET_TRANSFERS_PAUSED = 'true';
  // Clear modules that cache env-dependent flag helpers
  for (const rel of [
    '../src/services/securityFlags',
    '../src/services/withdrawalService',
    '../src/services/tronMasterWalletService',
    '../src/models/UsdtWithdrawal',
  ]) {
    delete require.cache[require.resolve(rel)];
  }
  const flags2 = require('../src/services/securityFlags');
  assert.strictEqual(flags2.areWithdrawalsPaused(), false);
  assert.strictEqual(flags2.isAutoOnchainWithdrawalEnabled(), false);

  const { createUsdtWithdrawalRequest: createWd } = require('../src/services/withdrawalService');
  const created = await createWd(userId, {
    payout_method: 'crypto',
    network: 'TRC20',
    wallet_address: validTrc20,
    amount_usdt: 25,
  });
  assert.ok(created.withdrawal?.id, 'withdrawal created');
  assert.strictEqual(created.withdrawal.status, 'pending', 'must stay pending without auto send');
  assert.strictEqual(created.payout, null, 'no payout when auto off');

  // Route guard
  process.env.WITHDRAWALS_PAUSED = 'true';
  delete require.cache[require.resolve('../src/services/securityFlags')];
  delete require.cache[require.resolve('../src/middleware/withdrawalGuard')];
  const { requireWithdrawalsEnabled: guard } = require('../src/middleware/withdrawalGuard');
  let statusCode = null;
  let body = null;
  await new Promise((resolve) => {
    guard(
      { originalUrl: '/api/withdraw', path: '/' },
      {
        status(code) { statusCode = code; return this; },
        json(payload) { body = payload; resolve(); },
      },
      () => resolve()
    );
  });
  assert.strictEqual(statusCode, 503);
  assert.strictEqual(body.code, 'WITHDRAWALS_PAUSED');

  // Static source checks
  const authSrc = fs.readFileSync(path.join(__dirname, '../src/middleware/auth.js'), 'utf8');
  assert.ok(authSrc.includes('isProductionRuntime'), 'auth hardens production admin key');
  const schema = fs.readFileSync(path.join(__dirname, '../../supabase/security_rls_lockdown.sql'), 'utf8');
  assert.ok(schema.includes('DROP POLICY IF EXISTS "anon_all_user_wallets"'), 'RLS lockdown present');

  console.log('wallet-security-incident: ok');
  await closeDb().catch(() => {});
  try { fs.unlinkSync(dbFile); } catch { /* ignore */ }
}

main().catch(async (err) => {
  console.error('wallet-security-incident: FAIL', err);
  process.exit(1);
});
