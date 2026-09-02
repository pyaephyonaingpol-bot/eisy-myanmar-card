#!/usr/bin/env node
/**
 * Attribute the ~8 USDT TRC20 withdrawal (hash prefix 15e187bd8db / dest TDcbAK59…).
 *
 * Tries:
 *   1) Supabase (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   2) Turso/LibSQL (DATABASE_URL + DATABASE_AUTH_TOKEN) — primary ledger
 *
 * Usage:
 *   node backend/scripts/forensic-8usdt-who.js
 *   node backend/scripts/forensic-8usdt-who.js --hash 15e187bd8db --dest TDcbAK59 --user 16
 *
 * Prints matching withdrawal rows + linked name/email/user_id.
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return fallback;
}

function looksRealSecret(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s.startsWith('[') || /placeholder|REDACTED|changeme|YOUR_/i.test(s)) return false;
  if (s.startsWith('NEXT_PUBLIC_') || s.includes(' = ')) return false;
  return true;
}

function printRows(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (!rows.length) {
    console.log('(none)');
    return;
  }
  for (const row of rows) {
    console.log(JSON.stringify(row, null, 2));
  }
}

async function querySupabase({ hash, dest, userId }) {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || '';

  if (!looksRealSecret(rawUrl) || !looksRealSecret(rawKey) || !/^https?:\/\//i.test(rawUrl.trim())) {
    console.log('[supabase] skipped — URL/service role key missing or placeholder');
    return { skipped: true, reason: 'credentials' };
  }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(rawUrl.trim(), rawKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const out = { source: 'supabase', withdrawals: [], logs: [], users: [], linked: [] };

  // Discover tables
  const candidates = [
    'usdt_withdrawal_requests',
    'usdt_bank_withdrawals',
    'transaction_logs',
    'transactions',
    'user_wallets',
    'profiles',
    'admin_logs',
    'wallet_transactions',
  ];
  const present = [];
  for (const table of candidates) {
    const { error } = await sb.from(table).select('*', { head: true, count: 'exact' }).limit(1);
    if (!error) present.push(table);
    else if (!/does not exist|Could not find|schema cache/i.test(error.message)) {
      console.log(`[supabase] ${table}: ${error.message}`);
    }
  }
  console.log('[supabase] present tables:', present.join(', ') || '(none of the expected mirrors)');

  if (present.includes('usdt_withdrawal_requests')) {
    const { data, error } = await sb
      .from('usdt_withdrawal_requests')
      .select('*')
      .or(
        [
          `tx_hash.ilike.%${hash}%`,
          `wallet_address.ilike.%${dest}%`,
          'and(net_usdt.gte.7.5,net_usdt.lte.8.5)',
          'and(amount_usdt.gte.7.5,amount_usdt.lte.10.5)',
        ].join(',')
      )
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) console.log('[supabase] withdrawals error:', error.message);
    else out.withdrawals = data || [];
  }

  if (present.includes('transaction_logs')) {
    const { data, error } = await sb
      .from('transaction_logs')
      .select('*')
      .or(
        [
          `description.ilike.%${hash}%`,
          `description.ilike.%${dest}%`,
          `type.ilike.%withdraw%`,
        ].join(',')
      )
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) console.log('[supabase] logs error:', error.message);
    else out.logs = data || [];
  }

  if (present.includes('user_wallets')) {
    const { data } = await sb
      .from('user_wallets')
      .select('user_id, email, name, balance_usdt, updated_at')
      .or(
        [
          `user_id.eq.${userId}`,
          'email.ilike.%talha%',
          'name.ilike.%talha%',
          'name.ilike.%pentest%',
          'name.ilike.%security%',
        ].join(',')
      )
      .limit(50);
    out.users = data || [];
  }

  // Link withdrawal → user details
  for (const w of out.withdrawals) {
    const uid = String(w.user_id);
    let name = null;
    let email = null;
    const fromList = out.users.find((u) => String(u.user_id) === uid);
    if (fromList) {
      name = fromList.name;
      email = fromList.email;
    } else if (present.includes('user_wallets')) {
      const { data } = await sb.from('user_wallets').select('name, email').eq('user_id', uid).maybeSingle();
      name = data?.name || null;
      email = data?.email || null;
    }
    out.linked.push({
      withdrawal_id: w.id,
      ref_code: w.ref_code,
      user_id: w.user_id,
      name,
      email,
      wallet_address: w.wallet_address,
      amount_usdt: w.amount_usdt,
      fee_usdt: w.fee_usdt,
      net_usdt: w.net_usdt,
      status: w.status,
      tx_hash: w.tx_hash,
      admin_note: w.admin_note,
      created_at: w.created_at,
      processed_at: w.processed_at,
    });
  }

  printRows('Supabase withdrawals', out.withdrawals);
  printRows('Supabase linked user details', out.linked);
  printRows('Supabase transaction_logs', out.logs);
  printRows('Supabase users of interest', out.users);
  return out;
}

async function queryTurso({ hash, dest, userId }) {
  const urlRaw = (process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || '').trim();
  const token = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();

  if (!looksRealSecret(urlRaw) || urlRaw.includes('placeholder')) {
    console.log('[turso] skipped — DATABASE_URL missing or placeholder');
    return { skipped: true, reason: 'credentials' };
  }

  const { createClient } = require('@libsql/client');
  const url = /^libsql:|^https?:/i.test(urlRaw) ? urlRaw : `libsql://${urlRaw}`;
  const db = createClient({ url, authToken: token || undefined });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

  const hashLike = `%${hash}%`;
  const destLike = `%${dest}%`;

  const withdrawals = await q(`
    SELECT id, user_id, ref_code, payout_method, network, wallet_address,
           amount_usdt, fee_usdt, net_usdt, status, tx_hash, admin_note,
           processed_by, created_at, processed_at
    FROM usdt_withdrawal_requests
    WHERE lower(coalesce(tx_hash,'')) LIKE lower(?)
       OR wallet_address LIKE ?
       OR net_usdt BETWEEN 7.5 AND 8.5
       OR amount_usdt BETWEEN 7.5 AND 10.5
    ORDER BY id DESC
    LIMIT 100
  `, [hashLike, destLike]);

  const linked = [];
  for (const w of withdrawals) {
    const users = await q(
      `SELECT id, name, email, phone, username, balance_usdt, auth_status, admin_role
       FROM users WHERE id = ?`,
      [w.user_id]
    );
    const u = users[0] || null;
    let admin = null;
    if (w.processed_by) {
      const admins = await q(
        `SELECT id, name, email, admin_role FROM users WHERE id = ?`,
        [w.processed_by]
      );
      admin = admins[0] || null;
    }
    linked.push({
      withdrawal_id: w.id,
      ref_code: w.ref_code,
      user_id: w.user_id,
      name: u?.name || null,
      email: u?.email || null,
      phone: u?.phone || null,
      wallet_address: w.wallet_address,
      amount_usdt: w.amount_usdt,
      fee_usdt: w.fee_usdt,
      net_usdt: w.net_usdt,
      status: w.status,
      tx_hash: w.tx_hash,
      admin_note: w.admin_note,
      created_at: w.created_at,
      processed_at: w.processed_at,
      processed_by: w.processed_by,
      processed_by_name: admin?.name || null,
      processed_by_email: admin?.email || null,
    });
  }

  const logs = await q(`
    SELECT id, user_id, type, direction, amount_usd, amount_mmk, description,
           reference_type, reference_id, metadata, created_at, created_by
    FROM transaction_logs
    WHERE lower(coalesce(description,'')) LIKE lower(?)
       OR lower(coalesce(metadata,'')) LIKE lower(?)
       OR lower(coalesce(description,'')) LIKE lower(?)
       OR lower(coalesce(metadata,'')) LIKE lower(?)
       OR type LIKE '%withdraw%'
    ORDER BY id DESC
    LIMIT 100
  `, [hashLike, hashLike, destLike, destLike]);

  const users = await q(`
    SELECT id, name, email, phone, username, balance_usdt, auth_status, admin_role, created_at, last_login_at
    FROM users
    WHERE id = ?
       OR lower(coalesce(name,'')) LIKE '%talha%'
       OR lower(coalesce(email,'')) LIKE '%talha%'
       OR lower(coalesce(name,'')) LIKE '%pentest%'
       OR lower(coalesce(email,'')) LIKE '%pentest%'
       OR lower(coalesce(name,'')) LIKE '%security%'
       OR lower(coalesce(name,'')) LIKE '%research%'
    ORDER BY id
  `, [Number(userId)]);

  printRows('Turso withdrawals', withdrawals);
  printRows('Turso LINKED user details (who initiated)', linked);
  printRows('Turso transaction_logs', logs);
  printRows('Turso users of interest (16 / Talha / Pentest)', users);

  return { source: 'turso', withdrawals, linked, logs, users };
}

async function main() {
  const hash = arg('hash', '15e187bd8db');
  const dest = arg('dest', 'TDcbAK59');
  const userId = arg('user', '16');

  console.log(JSON.stringify({ hash_prefix: hash, dest_prefix: dest, focus_user_id: userId }, null, 2));
  console.log('\nThere is no admin_logs table in this schema.');
  console.log('Attribution tables: usdt_withdrawal_requests (+ processed_by), transaction_logs, users.');

  const sb = await querySupabase({ hash, dest, userId });
  const turso = await queryTurso({ hash, dest, userId });

  const linked = [
    ...(sb.linked || []),
    ...(turso.linked || []),
  ];

  console.log('\n========== VERDICT ==========');
  if (!linked.length) {
    console.log('No matching withdrawal row found in reachable databases.');
    if (sb.skipped && turso.skipped) {
      console.log('BLOCKER: Both Supabase and Turso credentials are missing/placeholder in this environment.');
      console.log('Paste supabase/forensic_8usdt_withdrawal.sql into Supabase SQL Editor,');
      console.log('or re-run with real NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and/or DATABASE_URL.');
      process.exitCode = 2;
    } else {
      console.log('Credentials worked but no row matched hash/dest/~8 USDT.');
      console.log('Likely causes: dual-write never ran for this tx; only on-chain send with MASTER_PRIVATE_KEY;');
      console.log('or full hash/address differs — pass --hash / --dest with full values from Tronscan.');
      process.exitCode = 1;
    }
  } else {
    for (const row of linked) {
      console.log(
        `user_id=${row.user_id} name=${row.name || '?'} email=${row.email || '?'} `
        + `amount=${row.amount_usdt} net=${row.net_usdt} tx=${row.tx_hash || '(none)'} `
        + `status=${row.status} processed_by=${row.processed_by || 'n/a'}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
