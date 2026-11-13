/**
 * Admin user directory.
 *
 * Fast path (default): Turso SQL LIMIT/OFFSET pagination + indexed filters.
 * Never scan 10k users or every Supabase wallet on each page click — that
 * path blew the Vercel gateway and returned opaque HTTP 504.
 *
 * Opt-in union (`includeOrphans: true`): merge Turso + Supabase orphan
 * wallets (time-budgeted + cached) for mirror-completeness tooling/tests.
 */

const User = require('../models/User');
const {
  listSupabaseUserWallets,
  listSupabaseWalletsByUserIds,
} = require('./supabaseSyncService');
const { normalizeEmail, attachMirrorWallet } = require('../lib/userIdentity');

const DIRECTORY_SCAN_LIMIT = 10000;
const PAGE_ENRICH_TIMEOUT_MS = Math.max(
  250,
  parseInt(process.env.ADMIN_DIRECTORY_ENRICH_TIMEOUT_MS || '1200', 10) || 1200
);

function parsePageLimit(limit) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, DIRECTORY_SCAN_LIMIT);
}

function parseOffset(offset) {
  const n = parseInt(offset, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function timeValue(row) {
  const raw = row?.created_at || row?.updated_at || '';
  const parsed = Date.parse(String(raw).includes('T') ? raw : String(raw).replace(' ', 'T'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesQuery(row, query) {
  if (!query) return true;
  const id = String(row.id ?? '');
  if (id === query) return true;
  const authId = String(row.auth_user_id || '');
  const mirrorId = String(row.mirror_user_id || '');
  if (authId && authId.toLowerCase() === query.toLowerCase()) return true;
  if (mirrorId && mirrorId === query) return true;
  const hay = `${row.email || ''} ${row.name || ''}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}

function matchesStatus(row, status) {
  if (!status) return true;
  const auth = String(row.auth_status || 'active').toLowerCase();
  if (status === 'blocked') return auth === 'blocked' || auth === 'suspended';
  if (status === 'active') return auth === 'active' || auth === '';
  return auth === status;
}

function sortRows(rows, sort) {
  const dir = sort === 'created_at_asc' ? 1 : -1;
  rows.sort((a, b) => {
    const delta = timeValue(a) - timeValue(b);
    if (delta !== 0) return delta * dir;
    const aNum = Number(a.id);
    const bNum = Number(b.id);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) {
      return (aNum - bNum) * dir;
    }
    return String(a.id).localeCompare(String(b.id)) * dir;
  });
  return rows;
}

function walletToUser(row) {
  return {
    id: row.user_id,
    email: row.email || null,
    name: row.name || null,
    balance_usdt: Number(row.balance_usdt ?? 0),
    auth_status: row.auth_status || 'active',
    created_at: row.created_at || row.updated_at || null,
    updated_at: row.updated_at || null,
    source: 'supabase',
  };
}

function scheduleAuthUserIdLinks(links) {
  if (!Array.isArray(links) || !links.length) return;
  const batch = links.slice(0, 10);
  setImmediate(() => {
    Promise.allSettled(
      batch.map((link) => User.rememberAuthUserId(link.id, link.auth_user_id))
    ).catch(() => {});
  });
}

function withTimeout(promise, ms, label) {
  const timeoutMs = Math.max(1, Number(ms) || 1);
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timed out after ${timeoutMs}ms`);
        err.code = 'DIRECTORY_TIMEOUT';
        reject(err);
      }, timeoutMs);
    }),
  ]);
}

/**
 * Full Turso∪Supabase union (budgeted). Used only when explicitly requested.
 */
async function listAdminUserDirectoryUnion({
  pageLimit,
  pageOffset,
  query,
  authStatus,
  sortKey,
}) {
  const turso = await User.listForAdmin({
    limit: DIRECTORY_SCAN_LIMIT,
    offset: 0,
  });

  const byId = new Map();
  for (const user of turso.users) {
    byId.set(String(user.id), {
      id: user.id,
      email: user.email || null,
      name: user.name || null,
      balance_usdt: Number(user.balance_usdt ?? 0),
      auth_status: user.auth_status || 'active',
      auth_user_id: user.auth_user_id || null,
      created_at: user.created_at || null,
      source: 'registry',
    });
  }

  const byEmail = new Map();
  for (const row of byId.values()) {
    const email = normalizeEmail(row.email);
    if (email && !byEmail.has(email)) byEmail.set(email, row);
  }

  let supabaseError = null;
  let supabaseTruncated = false;
  try {
    const wallets = await listSupabaseUserWallets();
    if (wallets.error) supabaseError = wallets.error;
    supabaseTruncated = Boolean(wallets.truncated);
    const links = [];
    for (const row of wallets.rows || []) {
      const id = row?.user_id == null ? '' : String(row.user_id);
      if (!id || byId.has(id)) continue;
      const email = normalizeEmail(row.email);
      const linked = email ? byEmail.get(email) : null;
      if (linked && attachMirrorWallet(linked, row)) {
        if (linked.auth_user_id_linked && linked.source === 'registry') {
          links.push({ id: linked.id, auth_user_id: linked.auth_user_id });
        }
        delete linked.auth_user_id_linked;
        continue;
      }
      const created = walletToUser(row);
      byId.set(id, created);
      if (email && !byEmail.has(email)) byEmail.set(email, created);
    }
    scheduleAuthUserIdLinks(links);
  } catch (err) {
    supabaseError = err.message || String(err);
  }

  const filtered = sortRows(
    [...byId.values()].filter((row) => matchesQuery(row, query) && matchesStatus(row, authStatus)),
    sortKey
  );
  const total = filtered.length;
  const users = filtered.slice(pageOffset, pageOffset + pageLimit);

  return {
    users,
    total,
    count: users.length,
    limit: pageLimit,
    offset: pageOffset,
    has_more: pageOffset + users.length < total,
    sort: sortKey,
    mode: 'union',
    supabase_error: supabaseError,
    supabase_truncated: supabaseTruncated || undefined,
  };
}

/**
 * Enrich the current Turso page with fresh Supabase wallet fields (one IN query).
 */
async function enrichPageFromSupabase(users) {
  if (!Array.isArray(users) || !users.length) {
    return { users, enriched: false };
  }
  const ids = users.map((u) => String(u.id)).filter(Boolean);
  try {
    const wallets = await withTimeout(
      listSupabaseWalletsByUserIds(ids),
      PAGE_ENRICH_TIMEOUT_MS,
      'Supabase page enrich'
    );
    if (!wallets?.rows?.length) return { users, enriched: false, error: wallets?.error || null };

    const byId = new Map(wallets.rows.map((row) => [String(row.user_id), row]));
    const links = [];
    const next = users.map((user) => {
      const row = byId.get(String(user.id));
      if (!row) return user;
      const copy = { ...user, source: user.source || 'registry' };
      if (attachMirrorWallet(copy, row)) {
        if (copy.auth_user_id_linked) {
          links.push({ id: copy.id, auth_user_id: copy.auth_user_id });
        }
        delete copy.auth_user_id_linked;
      }
      if (row.balance_usdt != null && Number.isFinite(Number(row.balance_usdt))) {
        copy.balance_usdt = Number(row.balance_usdt);
      }
      if (row.auth_status) copy.auth_status = row.auth_status;
      return copy;
    });
    scheduleAuthUserIdLinks(links);
    return { users: next, enriched: true };
  } catch (err) {
    return { users, enriched: false, error: err.message || String(err) };
  }
}

/**
 * Default: indexed Turso pagination. Opt-in union for orphan wallets.
 */
async function listAdminUserDirectory({
  limit = 50,
  offset = 0,
  q = '',
  status = '',
  sort = 'created_at_desc',
  includeOrphans = false,
} = {}) {
  const pageLimit = parsePageLimit(limit);
  const pageOffset = parseOffset(offset);
  const query = String(q || '').trim();
  const authStatus = String(status || '').trim().toLowerCase();
  const sortKey = sort === 'created_at_asc' ? 'created_at_asc' : 'created_at_desc';
  const wantUnion = includeOrphans === true
    || includeOrphans === 1
    || String(includeOrphans).toLowerCase() === '1'
    || String(includeOrphans).toLowerCase() === 'true';

  if (wantUnion) {
    return listAdminUserDirectoryUnion({
      pageLimit,
      pageOffset,
      query,
      authStatus,
      sortKey,
    });
  }

  const turso = await User.listForAdmin({
    limit: pageLimit,
    offset: pageOffset,
    q: query,
    status: authStatus,
    sort: sortKey,
  });

  const users = (turso.users || []).map((user) => ({
    id: user.id,
    email: user.email || null,
    name: user.name || null,
    balance_usdt: Number(user.balance_usdt ?? 0),
    auth_status: user.auth_status || 'active',
    auth_user_id: user.auth_user_id || null,
    created_at: user.created_at || null,
    source: 'registry',
  }));

  const enriched = await enrichPageFromSupabase(users);

  return {
    users: enriched.users,
    total: turso.total,
    count: enriched.users.length,
    limit: pageLimit,
    offset: pageOffset,
    has_more: turso.has_more,
    sort: sortKey,
    mode: 'registry',
    supabase_error: enriched.error || null,
    supabase_enriched: Boolean(enriched.enriched),
  };
}

module.exports = {
  listAdminUserDirectory,
  parsePageLimit,
};
