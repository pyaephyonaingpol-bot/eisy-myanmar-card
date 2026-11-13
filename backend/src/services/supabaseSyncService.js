const User = require('../models/User');
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { parseRecordMetadata } = require('./settingsService');

function safeJson(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function upsertRow(table, row) {
  const sb = getSupabase();
  if (!sb) return null;
  const { error } = await sb.from(table).upsert(row, { onConflict: 'id' });
  if (error) {
    console.error(`[supabase/sync] ${table} upsert failed:`, error.message);
    return null;
  }
  return row;
}

/**
 * Columns confirmed present on production `user_wallets` (2026-09).
 * Omit everything else on the first write so backfill does not burn retries
 * on known-missing fields (the original 15-of-19 stall).
 */
const PROD_USER_WALLET_COLUMNS = new Set([
  'user_id',
  'email',
  'name',
  'balance_usdt',
  'updated_at',
  'tron_deposit_address',
  'tron_derivation_index',
  'tron_derivation_path',
]);

function pickProdUserWalletColumns(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (PROD_USER_WALLET_COLUMNS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Upsert into user_wallets, stripping columns the live schema does not have.
 * Production currently lacks balance_mmk / auth_status / is_blocked — a hard
 * upsert of those fields silently blocked sync for users 16+ (mirror stuck at 15).
 */
async function upsertUserWalletAdaptive(sb, row) {
  // Prefer the known-good production shape first; fall back to adaptive strip.
  let payload = pickProdUserWalletColumns(row);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await sb.from('user_wallets').upsert(payload, { onConflict: 'user_id' });
    if (!error) return { ok: true, row: payload, error: null };

    const msg = String(error.message || '');
    const missing =
      msg.match(/'([^']+)' column/i)
      || msg.match(/column\s+user_wallets\.([a-z0-9_]+)/i)
      || msg.match(/Could not find the '([^']+)' column/i);
    const col = missing?.[1];
    if (!col || !Object.prototype.hasOwnProperty.call(payload, col)) {
      // Last resort: columns known to exist in production today.
      const minimal = {
        user_id: row.user_id,
        email: row.email ?? null,
        name: row.name ?? null,
        balance_usdt: Number(row.balance_usdt ?? 0),
        updated_at: row.updated_at,
      };
      if (row.tron_deposit_address) {
        minimal.tron_deposit_address = row.tron_deposit_address;
        minimal.tron_derivation_index = row.tron_derivation_index ?? null;
        minimal.tron_derivation_path = row.tron_derivation_path ?? null;
      }
      const { error: minErr } = await sb.from('user_wallets').upsert(minimal, { onConflict: 'user_id' });
      if (minErr) {
        console.error('[supabase/sync] user_wallets upsert failed:', minErr.message);
        return { ok: false, row: null, error: minErr.message };
      }
      if (col) {
        console.warn(`[supabase/sync] user_wallets missing column ${col} — wrote core fields only`);
      }
      return { ok: true, row: minimal, error: null };
    }
    delete payload[col];
    console.warn(`[supabase/sync] stripping unavailable user_wallets column: ${col}`);
  }
  return { ok: false, row: null, error: 'user_wallets upsert retries exhausted' };
}

async function upsertUserWallet(user) {
  if (!isSupabaseEnabled() || !user) return null;
  // Do not send balance_mmk / auth_status / is_blocked — production schema
  // rejects them and previously stalled the mirror at 15 of 19 users.
  const row = {
    user_id: String(user.id),
    email: user.email || null,
    name: user.name || null,
    balance_usdt: Number(user.balance_usdt ?? 0),
    updated_at: nowIso(),
  };
  if (user.auth_user_id) row.auth_user_id = String(user.auth_user_id);

  // Include HD deposit address when already provisioned locally.
  try {
    const { UserUsdtWalletAddress } = require('../models/UserUsdtWalletAddress');
    const custodial = await UserUsdtWalletAddress.findCustodial(user.id, 'TRC20');
    if (custodial?.address && custodial.derivation_index != null) {
      row.tron_deposit_address = custodial.address;
      row.tron_derivation_index = Number(custodial.derivation_index);
      row.tron_derivation_path = custodial.derivation_path || null;
    }
  } catch (_) {
    // Non-fatal — wallet sync should still update balances.
  }

  const sb = getSupabase();
  if (!sb) return null;
  const result = await upsertUserWalletAdaptive(sb, row);
  return result.ok ? result.row : null;
}

async function syncUserWalletById(userId) {
  if (!isSupabaseEnabled()) return null;
  const user = await User.findById(userId);
  if (!user) return null;
  const row = await upsertUserWallet(user);
  try {
    const { invalidateUserWalletCache } = require('./supabaseWalletReadService');
    invalidateUserWalletCache(userId);
  } catch (_) {
    // Cache module may be unavailable in some test harnesses.
  }
  return row;
}

/**
 * Ensure a Supabase user_wallets row exists for this Turso user.
 * Creates the mirror row on first login / dashboard load when missing.
 * Non-fatal when Supabase is disabled or unreachable.
 */
async function ensureSupabaseUserWallet(userId, { syncIfExists = false } = {}) {
  if (!isSupabaseEnabled()) {
    return { ensured: false, skipped: true, reason: 'supabase_disabled' };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { ensured: false, skipped: true, reason: 'user_not_found' };
  }

  const { fetchFreshUserWalletRow, invalidateUserWalletCache } = require('./supabaseWalletReadService');
  const existing = await fetchFreshUserWalletRow(userId, {
    email: user.email,
    bypassCache: true,
  });

  if (existing && !syncIfExists) {
    return { ensured: true, created: false, row: existing };
  }

  const row = await upsertUserWallet(user);
  invalidateUserWalletCache(userId);

  let freshRow = existing;
  if (!existing || syncIfExists) {
    freshRow = await fetchFreshUserWalletRow(userId, {
      email: user.email,
      bypassCache: true,
    });
  }

  return {
    ensured: Boolean(row || freshRow),
    created: !existing,
    row: freshRow || row,
  };
}

function ensureSupabaseUserWalletInBackground(userId, options = {}) {
  ensureSupabaseUserWallet(userId, options).catch((err) => {
    console.warn('[supabase] ensure user wallet:', err.message);
  });
}

const BACKFILL_CHUNK_SIZE = Math.max(
  10,
  Math.min(200, parseInt(process.env.SUPABASE_BACKFILL_CHUNK_SIZE || '50', 10) || 50)
);
const BACKFILL_UPSERT_CONCURRENCY = Math.max(
  1,
  Math.min(20, parseInt(process.env.SUPABASE_BACKFILL_CONCURRENCY || '8', 10) || 8)
);
/** Soft budget per serverless continuation so the gateway never emits opaque 504. */
const BACKFILL_SLICE_BUDGET_MS = Math.max(
  2000,
  parseInt(process.env.SUPABASE_BACKFILL_SLICE_BUDGET_MS || '12000', 10) || 12000
);

let _backfillJob = null; // { status, ...progress }
let _backfillInFlight = null;

function emptyBackfillJob(overrides = {}) {
  return {
    status: 'idle',
    source: null,
    total: 0,
    offset: 0,
    synced: 0,
    failed: 0,
    chunks: 0,
    chunk_size: BACKFILL_CHUNK_SIZE,
    concurrency: BACKFILL_UPSERT_CONCURRENCY,
    started_at: null,
    updated_at: null,
    finished_at: null,
    error: null,
    ...overrides,
  };
}

function getBackfillJobStatus() {
  return _backfillJob ? { ..._backfillJob, in_flight: Boolean(_backfillInFlight) } : emptyBackfillJob();
}

function tryWaitUntil(promise) {
  try {
    // Optional on Vercel Node runtimes.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const mod = require('@vercel/functions');
    if (mod && typeof mod.waitUntil === 'function') {
      mod.waitUntil(promise);
      return true;
    }
  } catch (_) {
    /* not installed / not on Vercel */
  }
  return false;
}

function walletPayloadFromJoinedRow(row) {
  const payload = {
    user_id: String(row.id),
    email: row.email || null,
    name: row.name || null,
    balance_usdt: Number(row.balance_usdt ?? 0),
    updated_at: nowIso(),
  };
  if (row.auth_user_id) payload.auth_user_id = String(row.auth_user_id);
  if (row.tron_deposit_address && row.tron_derivation_index != null) {
    payload.tron_deposit_address = row.tron_deposit_address;
    payload.tron_derivation_index = Number(row.tron_derivation_index);
    payload.tron_derivation_path = row.tron_derivation_path || null;
  }
  return payload;
}

/**
 * Load one Turso page of users + custodial TRC20 address in a single query
 * (avoids N+1 findById / findCustodial round-trips that caused sync 504s).
 */
async function loadBackfillChunk(db, { limit, offset }) {
  return db.all(
    `SELECT
        u.id,
        u.email,
        u.name,
        u.balance_usdt,
        u.auth_user_id,
        a.address AS tron_deposit_address,
        a.derivation_index AS tron_derivation_index,
        a.derivation_path AS tron_derivation_path
      FROM users u
      LEFT JOIN user_usdt_wallet_addresses a
        ON a.user_id = u.id
       AND a.network = 'TRC20'
       AND a.address_type = 'custodial'
      ORDER BY u.id ASC
      LIMIT ? OFFSET ?`,
    limit,
    offset
  );
}

async function mapPool(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(list.length);
  let cursor = 0;

  async function runOne() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(limit, list.length); i += 1) {
    runners.push(runOne());
  }
  await Promise.all(runners);
  return results;
}

/**
 * Upsert one pre-loaded Turso row into Supabase (no extra Turso reads).
 */
async function upsertPreloadedUserWallet(sb, row) {
  const payload = walletPayloadFromJoinedRow(row);
  const result = await upsertUserWalletAdaptive(sb, payload);
  return Boolean(result?.ok);
}

/**
 * Process as many chunks as fit in `budgetMs`, starting at `offset`.
 * Designed for serverless: never run unbounded until gateway 504.
 */
async function backfillUserWalletsSlice({
  pageSize = BACKFILL_CHUNK_SIZE,
  offset = 0,
  budgetMs = BACKFILL_SLICE_BUDGET_MS,
  concurrency = BACKFILL_UPSERT_CONCURRENCY,
} = {}) {
  if (!isSupabaseEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: 'supabase_disabled',
      synced: 0,
      failed: 0,
      total: 0,
      offset: 0,
      done: true,
    };
  }

  const sb = getSupabase();
  if (!sb) {
    return {
      ok: false,
      skipped: true,
      reason: 'supabase_client_unavailable',
      synced: 0,
      failed: 0,
      total: 0,
      offset: 0,
      done: true,
    };
  }

  const db = require('../db').getDb();
  const size = Math.max(10, Math.min(200, Number(pageSize) || BACKFILL_CHUNK_SIZE));
  const startOffset = Math.max(0, Number(offset) || 0);
  const started = Date.now();

  const countRow = await db.get('SELECT COUNT(*) AS c FROM users');
  const total = Number(countRow?.c || 0);

  let cursor = startOffset;
  let synced = 0;
  let failed = 0;
  let chunks = 0;
  let timedOut = false;

  while (cursor < total) {
    if (Date.now() - started >= budgetMs) {
      timedOut = true;
      break;
    }

    const batch = await loadBackfillChunk(db, { limit: size, offset: cursor });
    if (!batch.length) break;

    const outcomes = await mapPool(batch, concurrency, async (row) => {
      try {
        return await upsertPreloadedUserWallet(sb, row);
      } catch (err) {
        console.warn(`[supabase] backfill user ${row.id}:`, err.message);
        return false;
      }
    });

    for (const ok of outcomes) {
      if (ok) synced += 1;
      else failed += 1;
    }

    chunks += 1;
    cursor += batch.length;
    if (batch.length < size) break;
  }

  const done = !timedOut && cursor >= total;
  return {
    ok: failed === 0 && done,
    skipped: false,
    synced,
    failed,
    total,
    offset: cursor,
    chunks,
    chunk_size: size,
    concurrency,
    done,
    timed_out: timedOut,
    ms: Date.now() - started,
  };
}

/**
 * Full sync — runs slice loops until complete. Prefer the background starter
 * on HTTP routes so the response returns before the gateway timeout.
 */
async function backfillAllUserWallets(options = {}) {
  const pageSize = options.pageSize || BACKFILL_CHUNK_SIZE;
  let offset = Math.max(0, Number(options.offset) || 0);
  let synced = 0;
  let failed = 0;
  let total = 0;
  let chunks = 0;

  for (;;) {
    const slice = await backfillUserWalletsSlice({
      ...options,
      pageSize,
      offset,
      budgetMs: options.budgetMs || BACKFILL_SLICE_BUDGET_MS,
    });
    if (slice.skipped) return slice;

    synced += slice.synced;
    failed += slice.failed;
    total = slice.total;
    chunks += slice.chunks || 0;
    offset = slice.offset;

    if (slice.done) {
      return {
        ok: failed === 0,
        skipped: false,
        synced,
        created: 0,
        failed,
        total,
        chunks,
        offset,
        done: true,
      };
    }
  }
}

function updateBackfillJob(patch) {
  _backfillJob = {
    ...(_backfillJob || emptyBackfillJob()),
    ...patch,
    updated_at: new Date().toISOString(),
  };
  return _backfillJob;
}

async function runBackfillJobLoop(options = {}) {
  const source = options.source || 'api';
  updateBackfillJob({
    status: 'running',
    source,
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
    synced: 0,
    failed: 0,
    offset: 0,
    chunks: 0,
  });

  try {
    let offset = 0;
    for (;;) {
      const slice = await backfillUserWalletsSlice({
        ...options,
        offset,
        pageSize: options.pageSize || BACKFILL_CHUNK_SIZE,
        budgetMs: options.budgetMs || BACKFILL_SLICE_BUDGET_MS,
      });

      if (slice.skipped) {
        updateBackfillJob({
          status: 'skipped',
          error: slice.reason || 'skipped',
          finished_at: new Date().toISOString(),
          total: slice.total || 0,
        });
        return slice;
      }

      const prev = _backfillJob || emptyBackfillJob();
      updateBackfillJob({
        status: slice.done ? 'completed' : 'running',
        total: slice.total,
        offset: slice.offset,
        synced: (prev.synced || 0) + slice.synced,
        failed: (prev.failed || 0) + slice.failed,
        chunks: (prev.chunks || 0) + (slice.chunks || 0),
        finished_at: slice.done ? new Date().toISOString() : null,
      });

      offset = slice.offset;
      if (slice.done) {
        console.info(
          `[supabase] user_wallets backfill: synced=${_backfillJob.synced}/${_backfillJob.total}`
          + ` failed=${_backfillJob.failed} chunks=${_backfillJob.chunks}`
        );
        return {
          ok: _backfillJob.failed === 0,
          skipped: false,
          ..._backfillJob,
          done: true,
        };
      }
    }
  } catch (err) {
    updateBackfillJob({
      status: 'failed',
      error: err.message || String(err),
      finished_at: new Date().toISOString(),
    });
    console.warn('[supabase] user_wallets backfill failed:', err.message);
    throw err;
  }
}

/**
 * Start (or attach to) a background wallet mirror backfill.
 * Returns immediately with job status — never awaits the full sync on the
 * HTTP request path (that was returning HTTP 504 on Vercel).
 */
function backfillAllUserWalletsInBackground(options = {}) {
  if (!isSupabaseEnabled()) {
    updateBackfillJob({
      status: 'skipped',
      error: 'supabase_disabled',
      finished_at: new Date().toISOString(),
    });
    return _backfillJob;
  }
  if (_backfillInFlight) {
    return getBackfillJobStatus();
  }

  updateBackfillJob({
    status: 'starting',
    source: options.source || 'background',
    started_at: new Date().toISOString(),
  });

  const work = runBackfillJobLoop(options)
    .catch((err) => {
      console.warn('[supabase] background backfill failed:', err.message);
      return null;
    })
    .finally(() => {
      _backfillInFlight = null;
    });

  _backfillInFlight = work;
  tryWaitUntil(work);
  return getBackfillJobStatus();
}

function resetBackfillJobForTests() {
  _backfillJob = null;
  _backfillInFlight = null;
}

let _directoryWalletCache = null; // { expiresAt, payload }

function directoryWalletCacheTtlMs() {
  const n = parseInt(process.env.ADMIN_DIRECTORY_SUPABASE_CACHE_TTL_MS || '20000', 10);
  return Number.isFinite(n) ? Math.max(0, n) : 20000;
}

function directoryWalletFetchBudgetMs() {
  const raw = process.env.ADMIN_DIRECTORY_SUPABASE_BUDGET_MS;
  if (raw == null || String(raw).trim() === '') return 8000;
  const n = parseInt(raw, 10);
  // Allow low values in tests; production default stays 8s when unset.
  return Number.isFinite(n) ? Math.max(250, n) : 8000;
}

function directoryWalletMaxRows() {
  const n = parseInt(process.env.ADMIN_DIRECTORY_SUPABASE_MAX_ROWS || '5000', 10);
  return Number.isFinite(n) ? Math.max(100, n) : 5000;
}

function resetDirectoryWalletCacheForTests() {
  _directoryWalletCache = null;
}

/**
 * Read every row from a Supabase table.
 * PostgREST db-max-rows (sometimes 15) truncates a single .range() even when
 * a higher end index is requested. Advance by the rows actually returned and
 * keep going until `count` is covered or the next page is empty.
 *
 * `deadlineMs` stops pagination early so admin list handlers stay under the
 * Vercel gateway limit instead of returning opaque HTTP 504.
 */
async function fetchAllSupabaseRows(sb, {
  table,
  columnsList,
  orderColumn = 'user_id',
  ascending = true,
  pageSize = 1000,
  maxRows = 20000,
  deadlineMs = null,
} = {}) {
  const selects = (Array.isArray(columnsList) ? columnsList : [columnsList]).filter(Boolean);
  let lastError = null;
  const startedAt = Date.now();
  const budgetMs = deadlineMs == null ? null : Math.max(1, Number(deadlineMs) || 0);

  for (const columns of selects) {
    const rows = [];
    let from = 0;
    let total = null;
    let previousFirstKey = undefined;
    let failed = false;
    let truncated = false;

    for (;;) {
      if (budgetMs != null && Date.now() - startedAt >= budgetMs) {
        truncated = true;
        break;
      }

      const to = from + pageSize - 1;
      const { data, error, count } = await sb
        .from(table)
        .select(columns, { count: total == null ? 'exact' : undefined })
        .order(orderColumn, { ascending })
        .range(from, to);

      if (error) {
        lastError = error;
        failed = true;
        break;
      }

      if (total == null && typeof count === 'number') total = count;
      const batch = data || [];
      if (!batch.length) break;

      const firstKey = batch[0]?.user_id ?? batch[0]?.id ?? null;
      if (previousFirstKey != null && firstKey != null && String(firstKey) === String(previousFirstKey)) {
        break;
      }
      previousFirstKey = firstKey;

      rows.push(...batch);
      from += batch.length;
      if (total != null && rows.length >= total) break;
      if (rows.length >= maxRows) {
        truncated = true;
        break;
      }
    }

    if (!failed) {
      return {
        rows,
        total: truncated ? rows.length : (total ?? rows.length),
        error: null,
        truncated,
      };
    }
  }

  return { rows: [], total: null, error: lastError, truncated: false };
}

/**
 * Every Supabase user_wallets row, past a 15-row PostgREST cap.
 * Cached briefly so repeated admin /users pages do not re-scan PostgREST.
 */
async function listSupabaseUserWallets(options = {}) {
  if (!isSupabaseEnabled()) {
    return { enabled: false, rows: [], total: 0, error: null, truncated: false };
  }
  const sb = getSupabase();
  if (!sb) {
    return { enabled: false, rows: [], total: 0, error: 'supabase_client_unavailable', truncated: false };
  }

  const bypassCache = options.bypassCache === true;
  const now = Date.now();
  if (!bypassCache && _directoryWalletCache && _directoryWalletCache.expiresAt > now) {
    return _directoryWalletCache.payload;
  }

  const cacheTtlMs = directoryWalletCacheTtlMs();
  const budgetMs = options.deadlineMs != null
    ? Number(options.deadlineMs)
    : directoryWalletFetchBudgetMs();
  const maxRows = options.maxRows != null ? Number(options.maxRows) : directoryWalletMaxRows();

  const result = await fetchAllSupabaseRows(sb, {
    table: 'user_wallets',
    columnsList: [
      'user_id, email, name, balance_usdt, updated_at, created_at, auth_status',
      'user_id, email, name, balance_usdt, updated_at, created_at',
      'user_id, email, name, balance_usdt, updated_at',
    ],
    orderColumn: 'user_id',
    ascending: true,
    // PostgREST often caps near 15–1000; smaller pages keep each RTT short.
    pageSize: Math.min(1000, Math.max(50, Number(options.pageSize) || 200)),
    maxRows,
    deadlineMs: budgetMs,
  });

  if (result.error) {
    const payload = {
      enabled: true,
      rows: [],
      total: null,
      error: result.error.message || String(result.error),
      truncated: false,
    };
    return payload;
  }

  const payload = {
    enabled: true,
    rows: result.rows,
    total: result.total,
    error: result.truncated
      ? `supabase_scan_truncated_after_${result.rows.length}_rows`
      : null,
    truncated: Boolean(result.truncated),
  };

  if (cacheTtlMs > 0 && !result.truncated) {
    _directoryWalletCache = {
      expiresAt: now + cacheTtlMs,
      payload,
    };
  }

  return payload;
}

/**
 * Fetch a small set of user_wallets by id (admin page enrich).
 * One PostgREST round-trip — never paginate the whole table for a page view.
 */
async function listSupabaseWalletsByUserIds(userIds = []) {
  const ids = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) {
    return { enabled: false, rows: [], error: null };
  }
  if (!isSupabaseEnabled()) {
    return { enabled: false, rows: [], error: null };
  }
  const sb = getSupabase();
  if (!sb) {
    return { enabled: false, rows: [], error: 'supabase_client_unavailable' };
  }

  const columnsList = [
    'user_id, email, name, balance_usdt, updated_at, created_at, auth_status',
    'user_id, email, name, balance_usdt, updated_at, created_at',
    'user_id, email, name, balance_usdt, updated_at',
  ];

  let lastError = null;
  for (const columns of columnsList) {
    const { data, error } = await sb
      .from('user_wallets')
      .select(columns)
      .in('user_id', ids.slice(0, 200));
    if (error) {
      lastError = error;
      continue;
    }
    return { enabled: true, rows: data || [], error: null };
  }

  return {
    enabled: true,
    rows: [],
    error: lastError ? (lastError.message || String(lastError)) : null,
  };
}

/**
 * Compare Turso users vs Supabase user_wallets (paginated) so admins can see
 * whether the mirror is complete — not stuck on PostgREST's default page size.
 */
async function getUserWalletsMirrorStatus({ includeMissingIds = false, missingSample = 20 } = {}) {
  const db = require('../db').getDb();
  const tursoRow = await db.get('SELECT COUNT(*) AS c FROM users');
  const tursoTotal = Number(tursoRow?.c || 0);
  const wantIds = includeMissingIds === true;
  const sampleLimit = Math.min(Math.max(parseInt(missingSample, 10) || 20, 0), 200);

  if (!isSupabaseEnabled()) {
    const out = {
      enabled: false,
      turso_total: tursoTotal,
      supabase_total: null,
      missing_count: tursoTotal,
      in_sync: false,
      reason: 'supabase_disabled',
    };
    if (wantIds) {
      const tursoIds = (await db.all('SELECT id FROM users ORDER BY id ASC')).map((r) => String(r.id));
      out.missing_user_ids = tursoIds;
    }
    return out;
  }

  const sb = getSupabase();
  if (!sb) {
    const out = {
      enabled: false,
      turso_total: tursoTotal,
      supabase_total: null,
      missing_count: tursoTotal,
      in_sync: false,
      reason: 'supabase_client_unavailable',
    };
    if (wantIds) {
      const tursoIds = (await db.all('SELECT id FROM users ORDER BY id ASC')).map((r) => String(r.id));
      out.missing_user_ids = tursoIds;
    }
    return out;
  }

  // Count-only fast path — never scan every wallet id on the hot mirror-status
  // request (that full scan was another 504 source during sync checks).
  let supabaseTotal = null;
  try {
    const { count, error: countErr } = await sb
      .from('user_wallets')
      .select('user_id', { count: 'exact', head: true });
    if (!countErr && typeof count === 'number') supabaseTotal = count;
  } catch (_) {
    /* fall through */
  }

  if (supabaseTotal != null && supabaseTotal >= tursoTotal && tursoTotal >= 0) {
    return {
      enabled: true,
      turso_total: tursoTotal,
      supabase_total: supabaseTotal,
      missing_count: 0,
      missing_user_ids: wantIds ? [] : undefined,
      in_sync: true,
    };
  }

  // Default: estimate missing from counts only (O(1) PostgREST head).
  if (!wantIds) {
    const estimatedMissing = supabaseTotal == null
      ? tursoTotal
      : Math.max(0, tursoTotal - supabaseTotal);
    return {
      enabled: true,
      turso_total: tursoTotal,
      supabase_total: supabaseTotal,
      missing_count: estimatedMissing,
      missing_user_ids_sample: undefined,
      in_sync: estimatedMissing === 0 && supabaseTotal != null,
      estimate: true,
    };
  }

  // Exact missing ids — budgeted scan (admin tooling only).
  const tursoIds = (await db.all('SELECT id FROM users ORDER BY id ASC')).map((r) => String(r.id));
  const scanned = await fetchAllSupabaseRows(sb, {
    table: 'user_wallets',
    columnsList: ['user_id'],
    orderColumn: 'user_id',
    ascending: true,
    deadlineMs: Math.max(2000, parseInt(process.env.ADMIN_DIRECTORY_SUPABASE_BUDGET_MS || '8000', 10) || 8000),
    maxRows: Math.max(tursoTotal + 100, 5000),
  });
  if (scanned.error) {
    return {
      enabled: true,
      turso_total: tursoTotal,
      supabase_total: supabaseTotal,
      missing_count: tursoTotal,
      missing_user_ids: tursoIds,
      in_sync: false,
      reason: scanned.error.message || String(scanned.error),
    };
  }
  const supabaseSet = new Set(scanned.rows.map((row) => String(row.user_id)));
  const missing = tursoIds.filter((id) => !supabaseSet.has(id));
  const exactCount = typeof scanned.total === 'number' ? scanned.total : (supabaseTotal ?? supabaseSet.size);

  return {
    enabled: true,
    turso_total: tursoTotal,
    supabase_total: exactCount,
    missing_count: missing.length,
    missing_user_ids: missing.slice(0, Math.max(sampleLimit, missing.length)),
    in_sync: missing.length === 0 && exactCount >= tursoTotal,
    truncated: Boolean(scanned.truncated),
  };
}

async function syncDeposit(deposit, user) {
  if (!isSupabaseEnabled() || !deposit) return null;
  const u = user || (deposit.user_id ? await User.findById(deposit.user_id) : null);
  return upsertRow('deposit_requests', {
    id: String(deposit.id),
    user_id: String(deposit.user_id),
    user_email: u?.email || null,
    user_name: u?.name || null,
    amount_mmk: Number(deposit.amount_mmk ?? 0),
    amount_usd: Number(deposit.amount_usd ?? 0),
    ref_code: deposit.ref_code || null,
    payment_method: deposit.payment_method || null,
    deposit_currency: deposit.deposit_currency || 'USDT',
    status: deposit.status || 'PENDING',
    purpose: deposit.purpose || 'topup',
    metadata: safeJson(deposit.metadata),
    created_at: deposit.created_at || nowIso(),
    updated_at: deposit.updated_at || nowIso(),
  });
}

async function syncCardApplication(card, user, extra = {}) {
  if (!isSupabaseEnabled() || !card) return null;
  const u = user || (card.user_id ? await User.findById(card.user_id) : null);
  const metadata = safeJson(card.metadata);
  const pricing = metadata.pricing || extra.pricing || safeJson(extra.pricing);
  const displayStatus = extra.display_status
    || (card.status === 'pending' ? 'PENDING_ISSUANCE' : String(card.status || '').toUpperCase());

  const base = {
    id: String(card.id),
    user_id: String(card.user_id),
    user_email: u?.email || null,
    user_name: u?.name || null,
    card_holder_name: card.card_holder_name || u?.name || null,
    status: card.status || 'pending',
    display_status: displayStatus,
    pricing,
    metadata,
    deposit_id: extra.deposit_id ? String(extra.deposit_id) : (metadata.deposit_id ? String(metadata.deposit_id) : null),
    created_at: card.created_at || nowIso(),
    updated_at: card.updated_at || nowIso(),
  };
  const withPago = {
    ...base,
    pago_card_id: card.pago_card_id || metadata.pago_card_id || null,
    pago_status: card.pago_status || metadata.pago_status || null,
    product_code: card.product_code || metadata.product_code || null,
    brand: card.brand || metadata.brand || null,
    last_four: card.last_four || null,
    expiry_month: card.expiry_month || null,
    expiry_year: card.expiry_year || null,
    currency: card.currency || 'USD',
    balance_display_usd: card.balance_display_usd != null ? Number(card.balance_display_usd) : null,
    balance_amount: card.balance_amount != null ? Number(card.balance_amount) : null,
    balance_currency: card.balance_currency || null,
    provider: card.provider || (card.pago_card_id ? 'pago' : null),
  };
  const synced = await upsertRow('card_applications', withPago);
  if (synced) return synced;
  // Older projects have not run supabase/pago_card_columns.sql yet.
  return upsertRow('card_applications', base);
}

async function syncCardReload(reload, user) {
  if (!isSupabaseEnabled() || !reload) return null;
  const u = user || (reload.user_id ? await User.findById(reload.user_id) : null);
  let metadata = safeJson(reload.metadata);
  if (reload.card_id && !metadata.card_last4) {
    try {
      const Card = require('../models/Card');
      const card = await Card.findById(reload.card_id);
      if (card?.card_number) {
        const num = String(card.card_number).replace(/\s/g, '');
        metadata = { ...metadata, card_last4: num.slice(-4) };
      }
    } catch (_) { /* ignore */ }
  }
  return upsertRow('card_reload_requests', {
    id: String(reload.id),
    user_id: String(reload.user_id),
    user_email: u?.email || reload.user_email || null,
    user_name: u?.name || reload.user_name || null,
    card_id: reload.card_id ? String(reload.card_id) : null,
    wallet_type: reload.wallet_type || 'usdt',
    amount_mmk: reload.amount_mmk != null ? Number(reload.amount_mmk) : null,
    amount_usdt: reload.amount_usdt != null ? Number(reload.amount_usdt) : null,
    net_usd_to_card: reload.net_usd_to_card != null ? Number(reload.net_usd_to_card) : null,
    status: reload.status || 'pending',
    pricing: safeJson(reload.pricing_json || reload.pricing),
    metadata,
    created_at: reload.created_at || nowIso(),
    updated_at: reload.updated_at || nowIso(),
  });
}

async function syncUsdtBankWithdrawal(withdrawal, user) {
  if (!isSupabaseEnabled() || !withdrawal) return null;
  const u = user || (withdrawal.user_id ? await User.findById(withdrawal.user_id) : null);
  return upsertRow('usdt_bank_withdrawals', {
    id: String(withdrawal.id),
    user_id: String(withdrawal.user_id),
    user_email: u?.email || null,
    user_name: u?.name || null,
    ref_code: withdrawal.ref_code || null,
    payout_method: withdrawal.payout_method || 'bank',
    amount_usdt: withdrawal.amount_usdt != null ? Number(withdrawal.amount_usdt) : null,
    fee_usdt: withdrawal.fee_usdt != null ? Number(withdrawal.fee_usdt) : null,
    net_usdt: withdrawal.net_usdt != null ? Number(withdrawal.net_usdt) : null,
    exchange_rate: withdrawal.exchange_rate != null ? Number(withdrawal.exchange_rate) : null,
    amount_mmk: withdrawal.amount_mmk != null ? Number(withdrawal.amount_mmk) : null,
    bank_name: withdrawal.bank_name || null,
    account_name: withdrawal.account_name || null,
    account_number: withdrawal.account_number || null,
    status: withdrawal.status || 'pending',
    admin_note: withdrawal.admin_note || null,
    created_at: withdrawal.created_at || nowIso(),
    updated_at: withdrawal.updated_at || nowIso(),
  });
}

/** Mirror Turso transaction_logs → Supabase (fixes "missing transactions" in Table Editor). */
async function syncTransactionLog(row) {
  if (!isSupabaseEnabled() || !row?.id) return null;
  const meta = safeJson(row.metadata);
  const amountUsdt = row.amount_usdt != null
    ? Number(row.amount_usdt)
    : (meta.amount_usdt != null ? Number(meta.amount_usdt) : null);
  return upsertRow('transaction_logs', {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : null,
    type: row.type || null,
    direction: row.direction || null,
    amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
    amount_mmk: row.amount_mmk != null ? Number(row.amount_mmk) : null,
    amount_usdt: amountUsdt,
    balance_before: row.balance_before != null ? Number(row.balance_before) : null,
    balance_after: row.balance_after != null ? Number(row.balance_after) : null,
    reference_type: row.reference_type || null,
    reference_id: row.reference_id != null ? String(row.reference_id) : null,
    description: row.description || null,
    metadata: meta,
    created_by: row.created_by || null,
    created_at: row.created_at || nowIso(),
  });
}

/** Mirror all USDT withdrawal requests (crypto + bank) for admin visibility. */
async function syncUsdtWithdrawalRequest(withdrawal) {
  if (!isSupabaseEnabled() || !withdrawal?.id) return null;
  return upsertRow('usdt_withdrawal_requests', {
    id: String(withdrawal.id),
    user_id: String(withdrawal.user_id),
    ref_code: withdrawal.ref_code || null,
    payout_method: withdrawal.payout_method || null,
    network: withdrawal.network || null,
    wallet_address: withdrawal.wallet_address || null,
    amount_usdt: withdrawal.amount_usdt != null ? Number(withdrawal.amount_usdt) : null,
    fee_usdt: withdrawal.fee_usdt != null ? Number(withdrawal.fee_usdt) : null,
    net_usdt: withdrawal.net_usdt != null ? Number(withdrawal.net_usdt) : null,
    status: withdrawal.status || 'pending',
    tx_hash: withdrawal.tx_hash || null,
    admin_note: withdrawal.admin_note || null,
    created_at: withdrawal.created_at || nowIso(),
    processed_at: withdrawal.processed_at || null,
  });
}

/** Mirror Turso support_threads into Supabase for Admin Realtime (High priority popups). */
async function syncSupportThread(thread, user = null) {
  if (!isSupabaseEnabled() || !thread?.id) return null;
  let email = user?.email || thread.email || null;
  let name = user?.name || thread.name || null;
  if ((!email || !name) && thread.user_id != null) {
    try {
      const u = await User.findById(thread.user_id);
      email = email || u?.email || null;
      name = name || u?.name || null;
    } catch (_) { /* ignore */ }
  }

  return upsertRow('support_threads', {
    id: Number(thread.id),
    user_id: thread.user_id != null ? String(thread.user_id) : null,
    user_email: email,
    user_name: name,
    subject: thread.subject || null,
    category: thread.category || 'general',
    status: thread.status || 'pending',
    priority: thread.priority || 'medium',
    last_message_preview: thread.last_message_preview || null,
    unread_by_admin: Number(thread.unread_by_admin ?? 0),
    telegram_chat_id: thread.telegram_chat_id != null ? String(thread.telegram_chat_id) : null,
    telegram_root_message_id: thread.telegram_root_message_id != null
      ? Number(thread.telegram_root_message_id)
      : null,
    telegram_last_outbound_id: thread.telegram_last_outbound_id != null
      ? Number(thread.telegram_last_outbound_id)
      : null,
    created_at: thread.created_at || nowIso(),
    updated_at: thread.updated_at || nowIso(),
    closed_at: thread.closed_at || null,
  });
}

/** Mirror Turso support_messages into Supabase for live chat Realtime. */
async function syncSupportMessage(message, thread = null) {
  if (!isSupabaseEnabled() || !message?.id) return null;
  return upsertRow('support_messages', {
    id: Number(message.id),
    thread_id: Number(message.thread_id || thread?.id),
    user_id: thread?.user_id != null ? String(thread.user_id) : null,
    sender_type: message.sender_type || 'user',
    sender_id: message.sender_id != null ? String(message.sender_id) : null,
    message: message.message || '',
    source: message.source || 'web',
    telegram_message_id: message.telegram_message_id != null
      ? Number(message.telegram_message_id)
      : null,
    created_at: message.created_at || nowIso(),
  });
}

module.exports = {
  syncUserWalletById,
  ensureSupabaseUserWallet,
  ensureSupabaseUserWalletInBackground,
  backfillAllUserWallets,
  backfillAllUserWalletsInBackground,
  backfillUserWalletsSlice,
  getBackfillJobStatus,
  resetBackfillJobForTests,
  getUserWalletsMirrorStatus,
  upsertUserWallet,
  syncDeposit,
  syncCardApplication,
  syncCardReload,
  syncUsdtBankWithdrawal,
  syncTransactionLog,
  syncUsdtWithdrawalRequest,
  syncSupportThread,
  syncSupportMessage,
  isSupabaseEnabled,
  fetchAllSupabaseRows,
  listSupabaseUserWallets,
  listSupabaseWalletsByUserIds,
  resetDirectoryWalletCacheForTests,
  BACKFILL_CHUNK_SIZE,
  BACKFILL_UPSERT_CONCURRENCY,
};
