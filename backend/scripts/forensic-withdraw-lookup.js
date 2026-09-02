#!/usr/bin/env node
/**
 * Forensic lookup for a suspected unauthorized TRC20 withdrawal.
 *
 * Usage (against production Turso):
 *   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... \
 *     node backend/scripts/forensic-withdraw-lookup.js \
 *       --hash 15e187bd8db... \
 *       --dest TDcbAK59... \
 *       --user 16
 *
 * Prints matching usdt_withdrawal_requests, transaction_logs, users, sessions.
 */
'use strict';

const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('../src/lib/loadEnv');
const { createClient } = require('@libsql/client');

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return String(process.argv[idx + 1]).trim();
  return fallback;
}

async function main() {
  const hash = arg('hash', '15e187bd8db');
  const dest = arg('dest', 'TDcbAK59');
  const userId = arg('user', '16');

  const url = (process.env.DATABASE_URL || '').trim();
  const authToken = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();
  if (!url || url.includes('placeholder') || url.startsWith('[')) {
    console.error('Set a real DATABASE_URL (libsql://...) — placeholders cannot be queried.');
    process.exit(2);
  }

  const db = createClient({
    url: /^libsql:|^https?:/i.test(url) ? url : `libsql://${url}`,
    authToken: authToken || undefined,
  });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;

  const hashLike = `%${hash}%`;
  const destLike = `%${dest}%`;

  console.log(JSON.stringify({
    hash_prefix: hash,
    dest_prefix: dest,
    user_id: userId,
  }, null, 2));

  const withdrawals = await q(`
    SELECT id, user_id, ref_code, payout_method, network, wallet_address,
           amount_usdt, fee_usdt, net_usdt, status, tx_hash, admin_note,
           payout_provider, processed_by, created_at, processed_at
    FROM usdt_withdrawal_requests
    WHERE lower(coalesce(tx_hash,'')) LIKE lower(?)
       OR wallet_address LIKE ?
       OR lower(coalesce(admin_note,'')) LIKE lower(?)
       OR amount_usdt BETWEEN 7.5 AND 12.5
       OR net_usdt BETWEEN 7.5 AND 12.5
    ORDER BY id DESC
    LIMIT 100
  `, [hashLike, destLike, hashLike]);

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

  const sessions = users.length
    ? await q(`
        SELECT id, user_id, device_name, device_platform, ip_address, created_at, expires_at, last_seen_at
        FROM user_sessions
        WHERE user_id IN (${users.map(() => '?').join(',')})
        ORDER BY id DESC LIMIT 50
      `, users.map((u) => u.id))
    : [];

  const userWd = await q(`SELECT * FROM usdt_withdrawal_requests WHERE user_id = ? ORDER BY id DESC`, [Number(userId)]);
  const userLogs = await q(`
    SELECT id, type, direction, description, amount_usd, amount_mmk, metadata, created_at, created_by
    FROM transaction_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50
  `, [Number(userId)]);

  console.log(JSON.stringify({
    withdrawals,
    transaction_logs: logs,
    users,
    sessions,
    user_16_withdrawals: userWd,
    user_16_logs: userLogs,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
