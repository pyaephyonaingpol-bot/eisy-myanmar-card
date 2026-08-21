/**
 * Regression: USDT wallet Available/Locked/Total must resolve from Supabase
 * even when Turso user_id and user_wallets.user_id have drifted (email match).
 *
 * Usage: node backend/scripts/test-usdt-wallet-balance-display.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { initDb } = require('../src/db');

async function main() {
  await initDb();
  const User = require('../src/models/User');
  const {
    fetchFreshUserWalletRow,
    overlayWalletPayloadFromSupabase,
  } = require('../src/services/supabaseWalletReadService');
  const { getWalletOverview, getWalletBalance } = require('../src/services/usdtWalletService');

  const email = 'pyaephyonaing.pol@gmail.com';
  const user = await User.findByEmail(email);
  if (!user) {
    console.error('FAIL: user not found for', email);
    process.exit(1);
  }

  console.log('Turso user', { id: user.id, email: user.email, balance_usdt: user.balance_usdt });

  const byIdOnly = await fetchFreshUserWalletRow(user.id);
  const byEmail = await fetchFreshUserWalletRow(user.id, { email: user.email });
  console.log('Supabase by id only', byIdOnly && {
    user_id: byIdOnly.user_id,
    email: byIdOnly.email,
    balance_usdt: byIdOnly.balance_usdt,
  });
  console.log('Supabase by id+email', byEmail && {
    user_id: byEmail.user_id,
    email: byEmail.email,
    balance_usdt: byEmail.balance_usdt,
  });

  const overlay = await overlayWalletPayloadFromSupabase(user.id, {
    balance_usdt: Number(user.balance_usdt || 0),
    balance_usdt_locked: Number(user.balance_usdt_locked || 0),
    email: user.email,
  });
  console.log('overlay', {
    source: overlay.source,
    balance_usdt: overlay.balance_usdt,
    usdt_formatted: overlay.usdt_formatted,
    supabase_user_id: overlay.supabase_user_id,
  });

  const overview = await getWalletOverview(user.id);
  const balance = await getWalletBalance(user.id);

  const checks = [
    ['overview.balance_formatted', overview.balance_formatted],
    ['overview.locked_formatted', overview.locked_formatted],
    ['overview.total_formatted', overview.total_formatted],
    ['balance.available_formatted', balance.available_formatted],
  ];

  let failed = false;
  for (const [name, value] of checks) {
    if (!value || String(value).includes('—')) {
      console.error('FAIL:', name, 'missing or dash:', value);
      failed = true;
    } else {
      console.log('OK:', name, '=', value);
    }
  }

  // Email-aware lookup should surface the Supabase mirror for this account (1000 USDT)
  // when Turso id has drifted from user_wallets.user_id.
  if (byEmail && Number(byEmail.balance_usdt) >= 1000) {
    if (Number(overview.balance_usdt) < 1000) {
      console.error('FAIL: overview did not pick up Supabase 1000 USDT via email fallback');
      failed = true;
    } else {
      console.log('OK: overview reflects Supabase available USDT', overview.balance_usdt);
    }
  } else {
    console.log('SKIP: no high Supabase balance for email fallback assertion');
  }

  if (failed) process.exit(1);
  console.log('PASS: USDT wallet balance display payload is complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
