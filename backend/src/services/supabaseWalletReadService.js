/**
 * Fresh (uncached) wallet reads from Supabase for balance display.
 * Used when operators edit balances in the Supabase Table Editor so the
 * live site reflects those values without Realtime replication.
 *
 * Looks up by Turso user_id first, then falls back to email when IDs
 * have drifted between Turso and the user_wallets mirror.
 *
 * Short in-process TTL cache avoids repeated PostgREST RTTs when the
 * SPA polls wallet / USDT overview within a few seconds.
 */
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');

const ROW_CACHE_TTL_MS = parseInt(process.env.SUPABASE_WALLET_CACHE_TTL_MS || '4000', 10);
const SUPABASE_READ_TIMEOUT_MS = parseInt(process.env.SUPABASE_WALLET_READ_TIMEOUT_MS || '4000', 10);
const _rowCache = new Map(); // key → { expiresAt, row }

function withTimeout(promise, ms, label = 'operation') {
  const timeoutMs = Math.max(500, Number(ms) || 4000);
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${timeoutMs}ms`);
        err.code = 'SUPABASE_READ_TIMEOUT';
        reject(err);
      }, timeoutMs);
    }),
  ]);
}

function formatMmk(amount) {
  const n = Number(amount) || 0;
  return `Ks ${Math.round(n).toLocaleString()} MMK`;
}

function formatUsdt(amount) {
  const n = Number(amount) || 0;
  return `$ ${n.toFixed(2)} USDT`;
}

function normalizeEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return s || null;
}

function cacheKey(userId, email) {
  return `${String(userId)}|${normalizeEmail(email) || ''}`;
}

function readRowCache(key) {
  const hit = _rowCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    _rowCache.delete(key);
    return undefined;
  }
  return hit.row;
}

function writeRowCache(key, row) {
  _rowCache.set(key, { row, expiresAt: Date.now() + ROW_CACHE_TTL_MS });
  if (_rowCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of _rowCache) {
      if (v.expiresAt < now) _rowCache.delete(k);
    }
  }
}

function invalidateUserWalletCache(userId) {
  const prefix = `${String(userId)}|`;
  for (const key of _rowCache.keys()) {
    if (key === String(userId) || key.startsWith(prefix)) _rowCache.delete(key);
  }
}

/** Parse SQLite datetime / ISO timestamps for freshness comparison. */
function parseTimestampMs(value) {
  if (!value) return 0;
  const s = String(value).trim();
  if (!s) return 0;
  // SQLite datetime('now') → YYYY-MM-DD HH:MM:SS (treat as UTC)
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s.replace(' ', 'T') + 'Z');
    return Number.isFinite(t) ? t : 0;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Query user_wallets once per call (with short TTL cache).
 * Prefer user_id; if missing or email mismatches, resolve by email.
 * @returns {Promise<object|null>}
 */
async function fetchFreshUserWalletRow(userId, { email, bypassCache = false } = {}) {
  if (!isSupabaseEnabled() || userId == null || userId === '') return null;

  const key = cacheKey(userId, email);
  if (!bypassCache) {
    const cached = readRowCache(key);
    if (cached !== undefined) return cached;
  }

  const sb = getSupabase();
  if (!sb) return null;

  try {
    return await withTimeout(
      (async () => {
        const selectCols = 'user_id, email, name, balance_mmk, balance_usdt, updated_at';
        const wantedEmail = normalizeEmail(email);

        const { data, error } = await sb
          .from('user_wallets')
          .select(selectCols)
          .eq('user_id', String(userId))
          .maybeSingle();

        if (error) {
          console.warn('[supabase/wallet-read]', error.message);
        }

        let row = (!error && data) ? data : null;
        const rowEmail = normalizeEmail(row?.email);
        const idMiss = !row;
        const emailMismatch = Boolean(wantedEmail && rowEmail && rowEmail !== wantedEmail);

        if ((idMiss || emailMismatch) && wantedEmail) {
          const byEmail = await sb
            .from('user_wallets')
            .select(selectCols)
            .ilike('email', wantedEmail)
            .maybeSingle();

          if (byEmail.error) {
            console.warn('[supabase/wallet-read] email lookup:', byEmail.error.message);
          } else if (byEmail.data) {
            if (emailMismatch || idMiss) {
              console.info(
                `[supabase/wallet-read] Resolved user ${userId} via email ${wantedEmail}`
                + ` (mirror user_id=${byEmail.data.user_id})`
              );
            }
            row = byEmail.data;
          }
        }

        // If caller did not pass email and id lookup missed, try Turso email.
        if (!row && !wantedEmail) {
          try {
            const User = require('../models/User');
            const user = await User.findById(userId);
            const fallbackEmail = normalizeEmail(user?.email);
            if (fallbackEmail) {
              return fetchFreshUserWalletRow(userId, { email: fallbackEmail, bypassCache });
            }
          } catch (err) {
            console.warn('[supabase/wallet-read] turso email fallback:', err.message);
          }
        }

        writeRowCache(key, row || null);
        return row || null;
      })(),
      SUPABASE_READ_TIMEOUT_MS,
      'Supabase wallet read'
    );
  } catch (err) {
    console.warn('[supabase/wallet-read] skipped:', err.message);
    return null;
  }
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
    supabase_user_id: row.user_id != null ? String(row.user_id) : null,
  };
}

/**
 * Prefer live Supabase balances for display when a row exists.
 * Falls back to the Turso/local payload when Supabase is off or empty.
 * If Turso was updated more recently (e.g. Admin Adjust USDT), keep Turso
 * so the dashboard does not show a stale mirrored balance.
 */
async function overlayWalletPayloadFromSupabase(userId, basePayload = {}) {
  let email = basePayload.email;
  if (!email) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      email = user?.email || null;
    } catch (_) {
      email = null;
    }
  }

  const row = await fetchFreshUserWalletRow(userId, {
    email,
    bypassCache: Boolean(basePayload.bypass_cache || basePayload.fresh),
  });
  if (!row) {
    return { ...basePayload, source: basePayload.source || 'turso' };
  }

  const localUpdatedMs = parseTimestampMs(basePayload.updated_at);
  const supabaseUpdatedMs = parseTimestampMs(row.updated_at);
  if (localUpdatedMs > 0 && localUpdatedMs > supabaseUpdatedMs) {
    return {
      ...basePayload,
      source: 'turso',
      supabase_stale: true,
      supabase_updated_at: row.updated_at || null,
      supabase_user_id: row.user_id != null ? String(row.user_id) : null,
    };
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

module.exports = {
  fetchFreshUserWalletRow,
  supabaseWalletToPayload,
  overlayWalletPayloadFromSupabase,
  invalidateUserWalletCache,
  parseTimestampMs,
};
