#!/usr/bin/env node
/**
 * List every user with ID, name, email, phone, balances, and TRON/wallet addresses.
 *
 * Primary source: Turso/LibSQL (`users` + `user_usdt_wallet_addresses`).
 * Optional mirror: Supabase (`user_wallets`, `profiles`, `user_tron_deposit_addresses`).
 *
 * Usage:
 *   node backend/scripts/list-all-users-with-wallets.js
 *   node backend/scripts/list-all-users-with-wallets.js --json
 *   node backend/scripts/list-all-users-with-wallets.js --csv
 *
 * Env (Turso — required for the 19 production users):
 *   DATABASE_URL=libsql://…
 *   DATABASE_AUTH_TOKEN=…
 *
 * Env (Supabase — optional second pass):
 *   NEXT_PUBLIC_SUPABASE_URL=https://….supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=…
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

function arg(name) {
  return process.argv.includes(`--${name}`);
}

function looksRealSecret(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s.startsWith('[') || /placeholder|REDACTED|changeme|YOUR_/i.test(s)) return false;
  if (s.startsWith('NEXT_PUBLIC_') || s.includes(' = ')) return false;
  return true;
}

function escapeCsv(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function queryTurso() {
  const urlRaw = (process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || '').trim();
  const token = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();

  if (!looksRealSecret(urlRaw) || urlRaw.includes('placeholder')) {
    console.error('[turso] DATABASE_URL missing or placeholder — cannot list production users.');
    return null;
  }

  const { createClient } = require('@libsql/client');
  const url = /^libsql:|^https?:/i.test(urlRaw) ? urlRaw : `libsql://${urlRaw}`;
  const db = createClient({ url, authToken: token || undefined });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

  const countRow = await q('SELECT COUNT(*) AS c FROM users');
  const total = Number(countRow[0]?.c ?? 0);

  const rows = await q(`
    SELECT
      u.id,
      u.name,
      u.email,
      u.phone,
      u.username,
      u.balance_usdt,
      u.balance_mmk,
      u.auth_status,
      u.admin_role,
      u.kyc_status,
      u.created_at,
      u.last_login_at,
      GROUP_CONCAT(
        a.network || ' [' || a.address_type || '] ' || a.address
          || COALESCE(' path=' || a.derivation_path, ''),
        ' | '
      ) AS wallet_addresses,
      MAX(CASE WHEN a.network = 'TRC20' AND a.address_type = 'custodial' THEN a.address END)
        AS tron_deposit_address,
      MAX(CASE WHEN a.network = 'TRC20' AND a.address_type = 'custodial' THEN a.derivation_path END)
        AS tron_derivation_path,
      MAX(CASE WHEN a.network = 'TRC20' AND a.address_type = 'custodial' THEN a.derivation_index END)
        AS tron_derivation_index
    FROM users u
    LEFT JOIN user_usdt_wallet_addresses a ON a.user_id = u.id
    GROUP BY u.id
    ORDER BY u.id ASC
  `);

  return { source: 'turso', total, rows };
}

async function querySupabase() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

  if (!looksRealSecret(rawUrl) || !looksRealSecret(rawKey) || !/^https?:\/\//i.test(rawUrl.trim())) {
    console.error('[supabase] skipped — URL or service role key missing/placeholder');
    return null;
  }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(rawUrl.trim(), rawKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: wallets, error: wErr, count } = await sb
    .from('user_wallets')
    .select('user_id, email, name, balance_usdt, balance_mmk, tron_deposit_address, tron_derivation_path, tron_derivation_index, updated_at', { count: 'exact' })
    .order('user_id', { ascending: true });

  if (wErr) {
    console.error('[supabase] user_wallets error:', wErr.message);
    return null;
  }

  let hd = [];
  const { data: hdData, error: hdErr } = await sb.from('user_tron_deposit_addresses').select('*');
  if (!hdErr && hdData) hd = hdData;

  const rows = (wallets || []).map((w) => {
    const extra = hd.find((h) => String(h.user_id) === String(w.user_id));
    return {
      id: w.user_id,
      name: w.name,
      email: w.email,
      balance_usdt: w.balance_usdt,
      balance_mmk: w.balance_mmk,
      tron_deposit_address: w.tron_deposit_address || extra?.address || null,
      tron_derivation_path: w.tron_derivation_path || extra?.derivation_path || null,
      tron_derivation_index: w.tron_derivation_index ?? extra?.derivation_index ?? null,
      wallet_updated_at: w.updated_at,
    };
  });

  return { source: 'supabase', total: count ?? rows.length, rows };
}

function printTable(rows, source) {
  console.log(`\n=== ${source.toUpperCase()} — ${rows.length} user(s) ===\n`);
  const header = [
    'id', 'name', 'email', 'phone', 'balance_usdt', 'balance_mmk',
    'tron_deposit_address', 'wallet_addresses', 'auth_status', 'admin_role',
  ];
  console.log(header.join('\t'));
  for (const r of rows) {
    console.log([
      r.id,
      r.name || '',
      r.email || '',
      r.phone || '',
      r.balance_usdt ?? '',
      r.balance_mmk ?? '',
      r.tron_deposit_address || '',
      r.wallet_addresses || '',
      r.auth_status || '',
      r.admin_role || '',
    ].join('\t'));
  }
}

function printCsv(rows) {
  const cols = ['id', 'name', 'email', 'phone', 'username', 'balance_usdt', 'balance_mmk',
    'tron_deposit_address', 'tron_derivation_path', 'wallet_addresses', 'auth_status', 'admin_role', 'created_at'];
  console.log(cols.join(','));
  for (const r of rows) {
    console.log(cols.map((c) => escapeCsv(r[c])).join(','));
  }
}

async function main() {
  const turso = await queryTurso();
  const supabase = await querySupabase();

  const primary = turso || supabase;
  if (!primary) {
    console.error('\nNo database reachable. Set DATABASE_URL + DATABASE_AUTH_TOKEN (Turso),');
    console.error('or paste supabase/list_all_users_with_wallets.sql into Supabase SQL Editor.');
    process.exit(2);
  }

  if (turso && supabase && turso.total !== supabase.total) {
    console.warn(`\nNote: Turso has ${turso.total} users; Supabase user_wallets has ${supabase.total}.`);
    console.warn('Use Turso output as authoritative for the 19 production users.\n');
  }

  const rows = (turso || supabase).rows;

  if (arg('json')) {
    console.log(JSON.stringify({ total: rows.length, users: rows }, null, 2));
    return;
  }

  if (arg('csv')) {
    printCsv(rows);
    return;
  }

  printTable(rows, primary.source);

  if (turso && supabase) {
    console.log('\n--- Supabase mirror (for comparison) ---');
    printTable(supabase.rows, 'supabase');
  }

  console.log(`\nTotal: ${rows.length} user(s)`);
  if (rows.length !== 19) {
    console.log(`(Expected 19 — if count differs, verify DATABASE_URL points at production Turso.)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
