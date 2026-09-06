#!/usr/bin/env node
/**
 * Non-secret env readiness check.
 * Prints which critical keys are SET / MISSING without printing values.
 *
 * Usage (from repo root or backend/):
 *   node backend/scripts/check-env-config.js
 */
'use strict';

try {
  require('../src/lib/loadEnv');
} catch (_) {
  try { require('../src/lib/loadEnv.js'); } catch (_) { /* optional */ }
}

const { envIsSet, firstEnv } = require('../src/lib/envAliases');

const GROUPS = [
  {
    title: 'Auth / Admin',
    keys: [
      ['AUTH_SECRET', ['AUTH_SECRET', 'JWT_SECRET']],
      ['ADMIN_API_KEY', ['ADMIN_API_KEY']],
    ],
  },
  {
    title: 'Supabase',
    keys: [
      ['NEXT_PUBLIC_SUPABASE_URL', ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']],
      ['NEXT_PUBLIC_SUPABASE_ANON_KEY', ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY']],
      ['SUPABASE_SERVICE_ROLE_KEY', ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY']],
    ],
  },
  {
    title: 'TRON wallet',
    keys: [
      ['MASTER_PRIVATE_KEY', ['MASTER_PRIVATE_KEY', 'MASTER_WALLET_PRIVATE_KEY', 'TRON_MASTER_PRIVATE_KEY']],
      ['MASTER_WALLET_ADDRESS', ['MASTER_WALLET_ADDRESS', 'MASTER_TRON_ADDRESS', 'TRON_MASTER_ADDRESS']],
      ['TRONGRID_API_KEY', ['TRONGRID_API_KEY', 'TRON_PRO_API_KEY', 'TRON_API_KEY']],
      ['TRON_HD_MNEMONIC', ['TRON_HD_MNEMONIC']],
      ['TRON_HD_SEED_HEX', ['TRON_HD_SEED_HEX']],
    ],
  },
  {
    title: 'Database',
    keys: [
      ['DATABASE_URL', ['DATABASE_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL']],
      ['DATABASE_AUTH_TOKEN', ['DATABASE_AUTH_TOKEN', 'TURSO_AUTH_TOKEN', 'LIBSQL_AUTH_TOKEN']],
    ],
  },
];

function statusFor(aliases) {
  return envIsSet(...aliases) ? 'SET' : 'MISSING';
}

function hintValue(aliases) {
  const v = firstEnv(...aliases);
  if (!v) return '';
  // Show only shape — never the secret.
  if (/^https?:\/\//i.test(v)) return ` (url host ${(() => { try { return new URL(v).host; } catch { return 'ok'; } })()})`;
  if (/^[0-9a-fA-F]{64}$/i.test(v.replace(/^0x/i, ''))) return ' (64-hex shape ok)';
  if (v.split(/\s+/).length >= 12) return ` (mnemonic ~${v.split(/\s+/).length} words)`;
  if (v.startsWith('eyJ') || v.startsWith('sb_')) return ` (len ${v.length})`;
  return ` (len ${v.length})`;
}

console.log('Eisy env readiness (values never printed)\n');
let missingCritical = 0;
for (const group of GROUPS) {
  console.log(`== ${group.title} ==`);
  for (const [label, aliases] of group.keys) {
    const st = statusFor(aliases);
    const critical = [
      'AUTH_SECRET',
      'ADMIN_API_KEY',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'MASTER_PRIVATE_KEY',
    ].includes(label);
    if (st === 'MISSING' && critical) missingCritical += 1;
    const mark = st === 'SET' ? '✓' : (critical ? '✗' : '·');
    console.log(`  ${mark} ${label}: ${st}${st === 'SET' ? hintValue(aliases) : ''}`);
  }
  console.log('');
}

console.log('Notes:');
console.log('- Put secrets in Vercel / Cursor Cloud env UIs — never commit .env files.');
console.log('- Paste BARE values only (no KEY=value text, no markdown links).');
console.log('- Prefer a dedicated TRON_HD_MNEMONIC; do not reuse MASTER_PRIVATE_KEY as HD seed long-term.');
console.log('- Re-check after updating secrets: node backend/scripts/check-env-config.js');

process.exit(missingCritical ? 1 : 0);
