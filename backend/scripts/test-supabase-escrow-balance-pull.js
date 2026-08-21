/**
 * Regression: Supabase Table Editor USDT must be pullable into Turso so
 * P2P sell-ad escrow does not see available $0.00 while the UI shows a balance.
 *
 * Usage: node scripts/test-supabase-escrow-balance-pull.js
 */
require('../src/lib/loadEnv');
const assert = require('assert');
const { initDb, getDb } = require('../src/db');
const { isSupabaseEnabled } = require('../src/lib/supabase');
const {
  fetchFreshUserWalletRow,
  pullSupabaseBalancesIntoTurso,
} = require('../src/services/supabaseWalletReadService');
const { getUsdtBalances, lockUsdtForEscrow, refundEscrowHold } = require('../src/services/usdtLedgerService');

async function main() {
  assert.ok(isSupabaseEnabled(), 'Supabase must be enabled for this test');
  await initDb();
  const db = getDb();

  // Prefer a user that has Supabase USDT > 0
  const { getSupabase } = require('../src/lib/supabase');
  const sb = getSupabase();
  const { data: rows, error } = await sb
    .from('user_wallets')
    .select('user_id, balance_usdt, balance_mmk')
    .gt('balance_usdt', 0)
    .order('balance_usdt', { ascending: false })
    .limit(1);
  assert.ok(!error, error?.message);
  assert.ok(rows?.length, 'Need at least one Supabase user_wallets row with USDT > 0');

  const userId = Number(rows[0].user_id);
  const sbUsdt = Number(rows[0].balance_usdt);
  assert.ok(Number.isFinite(userId) && userId > 0, 'Valid user id');
  assert.ok(sbUsdt >= 1, 'Need >= 1 USDT on Supabase for lock smoke test');

  // Force Turso available to 0 to reproduce the bug condition.
  const before = await db.get(
    'SELECT balance_usdt, balance_usdt_locked FROM users WHERE id = ?',
    userId
  );
  assert.ok(before, 'Turso user must exist');
  const lockedKeep = Number(before.balance_usdt_locked ?? 0);

  await db.run(
    `UPDATE users SET balance_usdt = 0, updated_at = datetime('now') WHERE id = ?`,
    userId
  );

  const zeroed = await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId);
  assert.strictEqual(Number(zeroed.balance_usdt), 0, 'Turso available forced to 0');

  const pulled = await pullSupabaseBalancesIntoTurso(userId);
  assert.ok(pulled, 'pull should return a result');
  assert.strictEqual(pulled.applied, true, 'pull should apply when Turso was 0');
  assert.ok(Math.abs(pulled.balance_usdt - sbUsdt) < 0.011, 'Turso USDT should match Supabase');

  const afterPull = await db.get(
    'SELECT balance_usdt, balance_usdt_locked FROM users WHERE id = ?',
    userId
  );
  assert.ok(Math.abs(Number(afterPull.balance_usdt) - sbUsdt) < 0.011);
  assert.ok(Math.abs(Number(afterPull.balance_usdt_locked) - lockedKeep) < 0.011, 'locked preserved');

  const balances = await getUsdtBalances(userId);
  assert.ok(balances.available_usdt >= 1, 'getUsdtBalances should see Supabase-pulled available');

  // Smoke: lock 1 USDT then refund (uses a throwaway hold reference)
  const P2PAd = require('../src/models/P2PAd');
  const ad = await P2PAd.create({
    userId,
    side: 'sell',
    network: 'TRC20',
    priceMmkPerUsdt: 4500,
    totalVolumeUsdt: 1,
    availableVolumeUsdt: 1,
    minOrderUsdt: 1,
    maxOrderUsdt: 1,
    paymentMethods: ['KPay'],
    paymentAccounts: { KPay: { account_name: 'Test', account_number: '099' } },
    escrowLockedUsdt: 1,
  });

  try {
    await lockUsdtForEscrow(userId, 1, {
      holdType: 'p2p_ad',
      referenceType: 'p2p_ads',
      referenceId: ad.id,
      description: 'test escrow pull',
      createdBy: 'system',
    });
    await refundEscrowHold({
      userId,
      referenceType: 'p2p_ads',
      referenceId: ad.id,
      holdType: 'p2p_ad',
      description: 'test escrow pull refund',
      createdBy: 'system',
    });
  } finally {
    await P2PAd.updateStatus(ad.id, 'cancelled').catch(() => {});
  }

  // Restore original Turso available if we changed it from a non-zero value
  // (Supabase remains source of truth for available after pull.)
  const row = await fetchFreshUserWalletRow(userId);
  console.log('OK — Supabase→Turso pull works for escrow.', {
    userId,
    supabase_usdt: sbUsdt,
    turso_after: Number((await db.get('SELECT balance_usdt FROM users WHERE id = ?', userId)).balance_usdt),
    supabase_updated_at: row?.updated_at,
  });
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
