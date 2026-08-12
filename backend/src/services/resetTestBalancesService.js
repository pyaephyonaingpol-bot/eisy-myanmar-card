/**
 * Reset all internal test wallet balances to zero after a master-wallet cutover.
 *
 * On-chain master wallet funds are NOT stored in SQLite — they are fetched live.
 * This module only clears user/platform ledger copies and related escrow holds.
 */

const { getDb } = require('../db');
const { columnExists, tableExists } = require('../../migrations/runner');
const TransactionLog = require('../models/TransactionLog');
const { syncUserWalletById } = require('./supabaseSyncService');

const RESET_NOTE = 'Test balance reset — synced with new master wallet';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function snapshotBalances(db) {
  const users = await db.get(`
    SELECT
      COUNT(*) AS user_count,
      COALESCE(SUM(COALESCE(balance_usdt, 0)), 0) AS total_usdt,
      COALESCE(SUM(COALESCE(balance_usdt_locked, 0)), 0) AS total_usdt_locked,
      COALESCE(SUM(COALESCE(balance_mmk, 0)), 0) AS total_mmk,
      COALESCE(SUM(COALESCE(balance, 0)), 0) AS total_legacy
    FROM users
  `);

  let platformRevenue = 0;
  try {
    const row = await db.get(
      "SELECT value FROM app_settings WHERE key = 'platform_usdt_revenue_balance'"
    );
    platformRevenue = parseFloat(row?.value) || 0;
  } catch (_) { /* ignore */ }

  let sellerEscrow = 0;
  let adEscrow = 0;
  let activeHolds = 0;
  if (await tableExists(db, 'p2p_sellers')) {
    const r = await db.get(
      'SELECT COALESCE(SUM(COALESCE(escrow_balance_usdt, 0)), 0) AS t FROM p2p_sellers'
    );
    sellerEscrow = Number(r?.t || 0);
  }
  if (await tableExists(db, 'p2p_ads')) {
    const r = await db.get(
      'SELECT COALESCE(SUM(COALESCE(escrow_locked_usdt, 0)), 0) AS t FROM p2p_ads'
    );
    adEscrow = Number(r?.t || 0);
  }
  if (await tableExists(db, 'usdt_escrow_holds')) {
    const r = await db.get(
      "SELECT COUNT(*) AS c FROM usdt_escrow_holds WHERE status = 'active'"
    );
    activeHolds = Number(r?.c || 0);
  }

  return {
    user_count: Number(users?.user_count || 0),
    total_usdt: round2(users?.total_usdt),
    total_usdt_locked: round2(users?.total_usdt_locked),
    total_mmk: Math.round(Number(users?.total_mmk || 0)),
    total_legacy: round2(users?.total_legacy),
    platform_usdt_revenue_balance: round2(platformRevenue),
    p2p_seller_escrow_usdt: round2(sellerEscrow),
    p2p_ad_escrow_usdt: round2(adEscrow),
    active_usdt_escrow_holds: activeHolds,
  };
}

async function zeroCardMetadataBalances(db) {
  if (!(await tableExists(db, 'cards_v2'))) {
    return { cards_cleared: 0 };
  }
  const cards = await db.all('SELECT id, metadata FROM cards_v2');
  let cleared = 0;
  for (const card of cards) {
    let meta = {};
    try {
      meta = card.metadata ? JSON.parse(card.metadata) : {};
    } catch (_) {
      meta = {};
    }
    const prev = Number(meta.balance_usd ?? 0);
    if (!Number.isFinite(prev) || prev === 0) continue;
    meta.balance_usd = 0;
    meta.test_balance_reset_at = new Date().toISOString();
    await db.run(
      `UPDATE cards_v2 SET metadata = ?, updated_at = datetime('now') WHERE id = ?`,
      JSON.stringify(meta),
      card.id
    );
    cleared += 1;
  }
  return { cards_cleared: cleared };
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.includeMmk=true] - also zero MMK wallets
 * @param {boolean} [opts.includeCards=true] - zero cards_v2 metadata.balance_usd
 * @param {boolean} [opts.cancelPendingWithdrawals=true]
 * @param {boolean} [opts.syncSupabase=true]
 * @param {string} [opts.createdBy='admin']
 * @param {string} [opts.reason]
 */
async function resetAllTestBalances(opts = {}) {
  const {
    includeMmk = true,
    includeCards = true,
    cancelPendingWithdrawals = true,
    syncSupabase = true,
    createdBy = 'admin',
    reason = RESET_NOTE,
  } = opts;

  const db = getDb();
  const before = await snapshotBalances(db);
  const changes = {
    users_zeroed: 0,
    escrow_holds_cancelled: 0,
    usdt_withdrawals_cancelled: 0,
    mmk_withdrawals_cancelled: 0,
    pending_transactions_rejected: 0,
    cards_cleared: 0,
    p2p_sellers_cleared: 0,
    p2p_ads_cleared: 0,
  };

  const hasLocked = await columnExists(db, 'users', 'balance_usdt_locked');
  const hasMmk = await columnExists(db, 'users', 'balance_mmk');
  const hasUsdt = await columnExists(db, 'users', 'balance_usdt');

  await db.run('BEGIN');
  try {
    const userSet = ['balance = 0'];
    if (await columnExists(db, 'users', 'updated_at')) {
      userSet.push("updated_at = datetime('now')");
    }
    if (hasUsdt) userSet.push('balance_usdt = 0');
    if (hasLocked) userSet.push('balance_usdt_locked = 0');
    if (includeMmk && hasMmk) userSet.push('balance_mmk = 0');

    const whereParts = ['COALESCE(balance, 0) != 0'];
    if (hasUsdt) whereParts.push('COALESCE(balance_usdt, 0) != 0');
    if (hasLocked) whereParts.push('COALESCE(balance_usdt_locked, 0) != 0');
    if (includeMmk && hasMmk) whereParts.push('COALESCE(balance_mmk, 0) != 0');

    const userResult = await db.run(`
      UPDATE users
      SET ${userSet.join(', ')}
      WHERE ${whereParts.join(' OR ')}
    `);
    changes.users_zeroed = Number(userResult?.changes || 0);

    await db.run(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('platform_usdt_revenue_balance', '0', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = '0',
        updated_at = datetime('now')
    `);

    if (await tableExists(db, 'p2p_sellers')) {
      const r = await db.run(`
        UPDATE p2p_sellers
        SET escrow_balance_usdt = 0, updated_at = datetime('now')
        WHERE COALESCE(escrow_balance_usdt, 0) != 0
      `);
      changes.p2p_sellers_cleared = Number(r?.changes || 0);
    }

    if (await tableExists(db, 'p2p_ads')) {
      const r = await db.run(`
        UPDATE p2p_ads
        SET escrow_locked_usdt = 0, updated_at = datetime('now')
        WHERE COALESCE(escrow_locked_usdt, 0) != 0
      `);
      changes.p2p_ads_cleared = Number(r?.changes || 0);
    }

    if (await tableExists(db, 'usdt_escrow_holds')) {
      const r = await db.run(`
        UPDATE usdt_escrow_holds
        SET status = 'cancelled',
            remaining_usdt = 0,
            released_at = datetime('now')
        WHERE status = 'active'
      `);
      changes.escrow_holds_cancelled = Number(r?.changes || 0);
    }

    if (cancelPendingWithdrawals) {
      if (await tableExists(db, 'usdt_withdrawal_requests')) {
        const r = await db.run(`
          UPDATE usdt_withdrawal_requests
          SET status = 'cancelled',
              admin_note = TRIM(COALESCE(admin_note, '') || ' | ' || ?),
              processed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE status IN ('pending', 'processing')
        `, reason);
        changes.usdt_withdrawals_cancelled = Number(r?.changes || 0);
      }
      if (includeMmk && (await tableExists(db, 'mmk_withdrawal_requests'))) {
        const r = await db.run(`
          UPDATE mmk_withdrawal_requests
          SET status = 'cancelled',
              admin_note = TRIM(COALESCE(admin_note, '') || ' | ' || ?),
              processed_at = datetime('now'),
              updated_at = datetime('now')
          WHERE status IN ('pending', 'processing')
        `, reason);
        changes.mmk_withdrawals_cancelled = Number(r?.changes || 0);
      }
    }

    if (await tableExists(db, 'transactions')) {
      const r = await db.run(`
        UPDATE transactions SET status = 'rejected' WHERE status = 'pending'
      `);
      changes.pending_transactions_rejected = Number(r?.changes || 0);
    }

    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  if (includeCards) {
    const cardResult = await zeroCardMetadataBalances(db);
    changes.cards_cleared = cardResult.cards_cleared;
  }

  // Audit trail (outside the big txn so logging failures don't undo the wipe)
  try {
    const actorId = Number(opts.actorUserId);
    if (Number.isFinite(actorId) && actorId > 0) {
      await TransactionLog.create({
        userId: actorId,
        type: 'admin_adjustment',
        direction: 'neutral',
        amountUsd: before.total_usdt,
        amountMmk: before.total_mmk,
        description: reason,
        createdBy,
        metadata: { before, changes, include_mmk: includeMmk, include_cards: includeCards, global_reset: true },
      });
    }
  } catch (err) {
    console.warn('[reset-test-balances] audit log skipped:', err.message);
  }

  let supabaseSynced = 0;
  if (syncSupabase) {
    try {
      const ids = await db.all('SELECT id FROM users ORDER BY id ASC');
      for (const row of ids) {
        try {
          await syncUserWalletById(row.id);
          supabaseSynced += 1;
        } catch (err) {
          console.warn('[reset-test-balances] supabase sync user', row.id, err.message);
        }
      }
    } catch (err) {
      console.warn('[reset-test-balances] supabase sync skipped:', err.message);
    }
  }

  const after = await snapshotBalances(db);

  let masterWallet = null;
  try {
    const { getMasterWalletInfo } = require('./tronMasterWalletService');
    masterWallet = await getMasterWalletInfo();
  } catch (err) {
    masterWallet = {
      error: err.message,
      code: err.code || 'MASTER_WALLET_UNAVAILABLE',
    };
  }

  return {
    success: true,
    message: 'All internal test balances reset to 0',
    before,
    after,
    changes: { ...changes, supabase_wallets_synced: supabaseSynced },
    master_wallet: masterWallet && !masterWallet.error
      ? {
          address: masterWallet.address,
          usdt_balance: masterWallet.usdtBalance,
          trx_balance: masterWallet.trxBalance,
          source: masterWallet.source,
          note: 'On-chain balances (not stored in DB) — live after wallet change',
        }
      : masterWallet,
  };
}

module.exports = {
  resetAllTestBalances,
  snapshotBalances,
  RESET_NOTE,
};
