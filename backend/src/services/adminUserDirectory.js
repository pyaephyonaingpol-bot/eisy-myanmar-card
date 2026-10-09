/**
 * Admin user directory.
 * Turso `users` is the registry. Supabase `user_wallets` can contain wallets
 * that never landed in that registry. The list is the union of both, sorted
 * by created_at, then paged with limit/offset so a PostgREST 15-row cap
 * cannot hide the rest.
 */

const User = require('../models/User');
const { listSupabaseUserWallets } = require('./supabaseSyncService');
const { normalizeEmail, attachMirrorWallet } = require('../lib/userIdentity');

const DIRECTORY_SCAN_LIMIT = 10000;

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

async function listAdminUserDirectory({
  limit = 50,
  offset = 0,
  q = '',
  status = '',
  sort = 'created_at_desc',
} = {}) {
  const pageLimit = parsePageLimit(limit);
  const pageOffset = parseOffset(offset);
  const query = String(q || '').trim();
  const authStatus = String(status || '').trim().toLowerCase();
  const sortKey = sort === 'created_at_asc' ? 'created_at_asc' : 'created_at_desc';

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
  try {
    const wallets = await listSupabaseUserWallets();
    if (wallets.error) supabaseError = wallets.error;
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
    for (const link of links) {
      await User.rememberAuthUserId(link.id, link.auth_user_id);
    }
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
    supabase_error: supabaseError,
  };
}

module.exports = {
  listAdminUserDirectory,
  parsePageLimit,
};
