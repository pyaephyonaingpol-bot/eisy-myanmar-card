/**
 * Fresh (uncached) wallet reads from Supabase for balance display.
 * Used when operators edit balances in the Supabase Table Editor so the
 * live site reflects those values without Realtime replication.
 *
 * Also pulls those balances into Turso before ledger debit/escrow so
 * money-moving APIs see the same available USDT the UI shows.
 */
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { getDb } = require('../db');

function formatMmk(amount) {
  const n = Number(amount) || 0;
  return `Ks ${Math.round(n).toLocaleString()} MMK`;
}

function formatUsdt(amount) {
  const n = Number(amount) || 0;
  return `$ ${n.toFixed(2)} USDT`;
}

function roundUsdt(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Query user_wallets once per call — no in-process cache.
 * @returns {Promise<object|null>}
 */
async function fetchFreshUserWalletRow(userId) {
  if (!isSupabaseEnabled() || userId == null || userId === '') return null;
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from('user_wallets')
    .select('user_id, email, name, balance_mmk, balance_usdt, updated_at')
    .eq('user_id', String(userId))
    .maybeSingle();

  if (error) {
    console.warn('[supabase/wallet-read]', error.message);
    return null;
  }
  return data || null;
}

/**
 * Map a Supabase user_wallets row into the same shape as walletPayload(),
 * plus source metadata. Locked USDT is not stored in Supabase schema —
 * callers should keep Turso locked amounts when merging.
 */
function supabaseWalletToPayload(row, { lockedUsdt = 0 } = {}) {
  if (!row) return null;
  const mmk = Number(row.balance_mmk ?? 0);
  const usdtAvailable = Number(row.balance_usdt ?? 0);
  const usdtLocked = Number(lockedUsdt ?? 0);
  const usdtTotal = Math.round((usdtAvailable + usdtLocked) * 100) / 100;
  return {
    balance_mmk: mmk,
    balance_usdt: usdtAvailable,
    balance_usdt_locked: usdtLocked,
    balance_usdt_total: usdtTotal,
    currency_primary: 'MMK',
    mmk_formatted: formatMmk(mmk),
    usdt_formatted: formatUsdt(usdtAvailable),
    usdt_locked_formatted: formatUsdt(usdtLocked),
    usdt_total_formatted: formatUsdt(usdtTotal),
    source: 'supabase',
    supabase_updated_at: row.updated_at || null,
  };
}

/**
 * Prefer live Supabase balances for display when a row exists.
 * Falls back to the Turso/local payload when Supabase is off or empty.
 */
async function overlayWalletPayloadFromSupabase(userId, basePayload = {}) {
  const row = await fetchFreshUserWalletRow(userId);
  if (!row) {
    return { ...basePayload, source: basePayload.source || 'turso' };
  }
  const locked = Number(
    basePayload.balance_usdt_locked
      ?? basePayload.locked_usdt
      ?? 0
  );
  return {
    ...basePayload,
    ...supabaseWalletToPayload(row, { lockedUsdt: locked }),
  };
}

/**
 * Copy available balances from Supabase `user_wallets` into Turso `users`
 * so escrow/debit checks match what the UI shows after Table Editor edits.
 *
 * Preserves Turso `balance_usdt_locked` (escrow state lives only in Turso).
 * No-ops when Supabase is disabled or no mirrored row exists.
 *
 * @returns {Promise<{applied:boolean, balance_usdt?:number, balance_mmk?:number}|null>}
 */
async function pullSupabaseBalancesIntoTurso(userId, dbConn = null) {
  const row = await fetchFreshUserWalletRow(userId);
  if (!row) return null;

  const sbUsdt = roundUsdt(row.balance_usdt);
  const sbMmk = Number(row.balance_mmk ?? 0);
  const db = dbConn || getDb();

  const current = await db.get(
    'SELECT id, balance_usdt, balance_usdt_locked, balance_mmk FROM users WHERE id = ?',
    userId
  );
  if (!current) return null;

  const tursoUsdt = roundUsdt(current.balance_usdt ?? 0);
  const tursoMmk = Number(current.balance_mmk ?? 0);
  const usdtChanged = Math.abs(tursoUsdt - sbUsdt) > 0.005;
  const mmkChanged = Math.abs(tursoMmk - sbMmk) > 0.005;

  if (!usdtChanged && !mmkChanged) {
    return {
      applied: false,
      balance_usdt: tursoUsdt,
      balance_mmk: tursoMmk,
      balance_usdt_locked: roundUsdt(current.balance_usdt_locked ?? 0),
    };
  }

  await db.run(
    `UPDATE users
     SET balance_usdt = ?,
         balance_mmk = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
    sbUsdt,
    sbMmk,
    userId
  );

  console.info(
    `[supabase/wallet-read] Pulled balances into Turso for user ${userId}: `
    + `USDT ${tursoUsdt}→${sbUsdt}, MMK ${tursoMmk}→${sbMmk} `
    + `(locked USDT kept at ${roundUsdt(current.balance_usdt_locked ?? 0)})`
  );

  return {
    applied: true,
    balance_usdt: sbUsdt,
    balance_mmk: sbMmk,
    balance_usdt_locked: roundUsdt(current.balance_usdt_locked ?? 0),
    previous_balance_usdt: tursoUsdt,
    previous_balance_mmk: tursoMmk,
  };
}

module.exports = {
  fetchFreshUserWalletRow,
  supabaseWalletToPayload,
  overlayWalletPayloadFromSupabase,
  pullSupabaseBalancesIntoTurso,
};
