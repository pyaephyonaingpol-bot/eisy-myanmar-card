#!/usr/bin/env node
/**
 * Backfill public.user_tron_hd_addresses (+ legacy alias + user_wallets TRON columns)
 * from MASTER_PRIVATE_KEY / TRON_HD_* for every known user.
 *
 * Usage:
 *   node scripts/backfill-supabase-tron-hd-addresses.js
 *   node scripts/backfill-supabase-tron-hd-addresses.js --dry-run
 *   node scripts/backfill-supabase-tron-hd-addresses.js --skip-local
 *   node scripts/backfill-supabase-tron-hd-addresses.js --users=15,16,17 --skip-local
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

const { createClient } = require('@supabase/supabase-js');
const { firstEnv } = require('../src/lib/envAliases');
const {
  isHdEnabled,
  getPublicDepositAddressForUser,
} = require('../src/services/tronHdWalletService');
const { UserUsdtWalletAddress } = require('../src/models/UserUsdtWalletAddress');
const { initDb, getDb, closeDb } = require('../src/db');

function parseUsersArg(argv) {
  const eq = argv.find((a) => a.startsWith('--users='));
  if (eq) {
    return eq.slice('--users='.length)
      .split(',')
      .map((v) => Number(String(v).trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
  }
  const idx = argv.indexOf('--users');
  if (idx >= 0 && argv[idx + 1]) {
    return String(argv[idx + 1])
      .split(',')
      .map((v) => Number(String(v).trim()))
      .filter((id) => Number.isInteger(id) && id > 0);
  }
  return null;
}

const opts = {
  dryRun: process.argv.includes('--dry-run') || process.argv.includes('-n'),
  skipLocal: process.argv.includes('--skip-local'),
  users: parseUsersArg(process.argv),
};

function resolveSupabase() {
  const urlCandidates = [
    firstEnv('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'),
    firstEnv('DATABASE_URL'),
  ].map((v) => String(v || '').trim().replace(/\/$/, ''));

  const url = urlCandidates.find((v) => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(v)) || '';

  const key = [
    firstEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'),
    firstEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'),
    firstEnv('NEXT_PUBLIC_SUPABASE_URL'), // often mis-slotted publishable key
  ].map((v) => String(v || '').trim()).find((s) => {
    if (!s || s.length < 20) return false;
    if (/^postgresql:/i.test(s)) return false;
    if (/YOUR-PASSWORD/i.test(s)) return false;
    if (/^https?:\/\//i.test(s)) return false;
    if (/supabase login/i.test(s)) return false;
    return true;
  }) || '';

  return { url, key };
}

function stripRemoteDbEnv() {
  const saved = {
    url: process.env.DATABASE_URL,
    token: process.env.DATABASE_AUTH_TOKEN,
  };
  if (saved.url && /supabase\.co|postgresql:/i.test(saved.url)) {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_AUTH_TOKEN;
  }
  return saved;
}

function restoreDbEnv(saved) {
  if (saved.url != null) process.env.DATABASE_URL = saved.url;
  else delete process.env.DATABASE_URL;
  if (saved.token != null) process.env.DATABASE_AUTH_TOKEN = saved.token;
  else delete process.env.DATABASE_AUTH_TOKEN;
}

async function loadLocalUserIds() {
  const saved = stripRemoteDbEnv();
  try {
    await initDb();
    const rows = await getDb().all('SELECT id FROM users ORDER BY id ASC');
    await closeDb().catch(() => {});
    return rows.map((r) => Number(r.id)).filter((id) => Number.isInteger(id) && id > 0);
  } finally {
    restoreDbEnv(saved);
  }
}

async function loadSupabaseUserIds(sb) {
  const ids = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const to = from + page - 1;
    const { data, error } = await sb
      .from('user_wallets')
      .select('user_id')
      .order('user_id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(`user_wallets read failed: ${error.message}`);
    const batch = data || [];
    for (const row of batch) {
      const id = Number(row.user_id);
      if (Number.isInteger(id) && id > 0) ids.push(id);
    }
    if (batch.length < page) break;
    from += page;
  }
  return ids;
}

async function upsertHdTables(sb, row) {
  const tables = ['user_tron_hd_addresses', 'user_tron_deposit_addresses'];
  const results = {};
  for (const table of tables) {
    const { error } = await sb.from(table).upsert(row, { onConflict: 'user_id' });
    results[table] = error ? error.message : 'ok';
  }
  return results;
}

async function upsertUserWalletTronColumns(sb, { userId, address, index, path: derivationPath }) {
  const patch = {
    user_id: String(userId),
    tron_deposit_address: address,
    tron_derivation_index: index,
    tron_derivation_path: derivationPath,
    updated_at: new Date().toISOString(),
  };
  let payload = { ...patch };
  for (let i = 0; i < 6; i += 1) {
    const { error } = await sb.from('user_wallets').upsert(payload, { onConflict: 'user_id' });
    if (!error) return { ok: true };
    const col = (error.message.match(/'([^']+)' column/i) || [])[1];
    if (!col || !Object.prototype.hasOwnProperty.call(payload, col)) {
      return { ok: false, error: error.message };
    }
    delete payload[col];
  }
  return { ok: false, error: 'retries exhausted' };
}

async function ensureLocalCustodial(userId, derived) {
  const row = await UserUsdtWalletAddress.findCustodial(userId, 'TRC20');
  if (row && row.address === derived.address && row.derivation_index != null) {
    return { created: false, updated: false };
  }
  if (row) {
    await UserUsdtWalletAddress.updateCustodialTrc20(userId, {
      address: derived.address,
      derivationIndex: derived.index,
      derivationPath: derived.path,
      depositReference: row.deposit_reference || `EISY-HD-U${userId}`,
      label: row.label || 'TRC20 HD deposit',
    });
    return { created: false, updated: true };
  }
  await UserUsdtWalletAddress.create({
    userId,
    network: 'TRC20',
    address: derived.address,
    addressType: 'custodial',
    depositReference: `EISY-HD-U${userId}`,
    label: 'TRC20 HD deposit',
    isPrimary: 1,
    derivationIndex: derived.index,
    derivationPath: derived.path,
  });
  return { created: true, updated: false };
}

async function main() {
  if (!isHdEnabled()) {
    console.error('HD wallet not configured — set MASTER_PRIVATE_KEY / TRON_HD_MNEMONIC / TRON_HD_SEED_HEX');
    process.exit(1);
  }

  const { url, key } = resolveSupabase();
  if (!url || !key) {
    console.error('Supabase URL/key unavailable (need https://PROJECT.supabase.co + anon/service key)');
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  console.log(`[backfill-hd] supabase=${url} keyLen=${key.length}`);

  let userIds;
  if (opts.users && opts.users.length > 0) {
    userIds = [...new Set(opts.users)].sort((a, b) => a - b);
    console.log(`[backfill-hd] filtering to --users=${userIds.join(',')}`);
  } else {
    const localIds = await loadLocalUserIds();
    const remoteIds = await loadSupabaseUserIds(sb);
    userIds = [...new Set([...localIds, ...remoteIds])].sort((a, b) => a - b);
  }
  console.log(`[backfill-hd] users=${userIds.length} dryRun=${opts.dryRun}`);
  console.log(`[backfill-hd] ids=${userIds.join(',')}`);

  if (!opts.dryRun) {
    await sb.from('user_tron_hd_addresses').delete().eq('user_id', '999999');
    await sb.from('user_tron_deposit_addresses').delete().eq('user_id', '999999');
  }

  let localDbReady = false;
  let savedDbEnv = null;
  if (!opts.skipLocal) {
    savedDbEnv = stripRemoteDbEnv();
    await initDb();
    localDbReady = true;
  }

  let ok = 0;
  let failed = 0;

  for (const userId of userIds) {
    const derived = getPublicDepositAddressForUser(userId);
    const record = {
      user_id: String(userId),
      address: derived.address,
      derivation_index: derived.index,
      derivation_path: derived.path,
      network: 'TRC20',
      updated_at: new Date().toISOString(),
    };

    if (opts.dryRun) {
      console.log(`DRY user=${userId} ${derived.address} ${derived.path}`);
      ok += 1;
      continue;
    }

    try {
      if (localDbReady) {
        await ensureLocalCustodial(userId, derived);
      }
      const tableRes = await upsertHdTables(sb, record);
      const walletRes = await upsertUserWalletTronColumns(sb, {
        userId,
        address: derived.address,
        index: derived.index,
        path: derived.path,
      });
      const tableOk = Object.values(tableRes).some((v) => v === 'ok');
      if (!tableOk) {
        failed += 1;
        console.error(`FAIL user=${userId} tables`, tableRes);
        continue;
      }
      if (!walletRes.ok) {
        console.warn(`WARN user=${userId} user_wallets:`, walletRes.error);
      }
      console.log(`OK user=${userId} ${derived.address}`);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`FAIL user=${userId}`, err.message);
    }
  }

  if (!opts.dryRun) {
    const { data, error, count } = await sb
      .from('user_tron_hd_addresses')
      .select('user_id,address,derivation_index', { count: 'exact' })
      .order('derivation_index', { ascending: true });
    console.log('[backfill-hd] count=', count, error?.message || '');
    if (data) {
      console.log('[backfill-hd] rows=', data.map((r) => `${r.user_id}:${r.address}`).join(', '));
    }
  }

  if (savedDbEnv) restoreDbEnv(savedDbEnv);
  await closeDb().catch(() => {});

  console.log(JSON.stringify({ ok, failed, total: userIds.length, dryRun: opts.dryRun }, null, 2));
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
