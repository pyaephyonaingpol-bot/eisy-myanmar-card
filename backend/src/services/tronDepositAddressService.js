/**
 * Assign and persist per-user TRON HD deposit addresses (local + Supabase).
 */
const { UserUsdtWalletAddress } = require('../models/UserUsdtWalletAddress');
const User = require('../models/User');
const {
  isHdEnabled,
  getPublicDepositAddressForUser,
} = require('./tronHdWalletService');
const supabaseLib = require('../lib/supabase');

function nowIso() {
  return new Date().toISOString();
}

/**
 * Upsert the derived address onto Supabase user_wallets + user_tron_deposit_addresses.
 */
async function syncTronDepositAddressToSupabase({
  userId,
  address,
  index,
  path,
  email = null,
  name = null,
  balanceMmk = null,
  balanceUsdt = null,
}) {
  if (!supabaseLib.isSupabaseEnabled()) {
    return { ok: false, skipped: true, reason: 'supabase_disabled' };
  }
  const sb = supabaseLib.getSupabase();
  if (!sb) {
    return { ok: false, skipped: true, reason: 'supabase_unavailable' };
  }

  const userIdStr = String(userId);
  const walletPatch = {
    user_id: userIdStr,
    tron_deposit_address: address,
    tron_derivation_index: index,
    tron_derivation_path: path,
    updated_at: nowIso(),
  };
  if (email != null) walletPatch.email = email;
  if (name != null) walletPatch.name = name;
  if (balanceMmk != null) walletPatch.balance_mmk = Number(balanceMmk);
  if (balanceUsdt != null) walletPatch.balance_usdt = Number(balanceUsdt);

  const { error: walletErr } = await sb
    .from('user_wallets')
    .upsert(walletPatch, { onConflict: 'user_id' });

  if (walletErr) {
    // Columns may not exist until supabase/user_tron_hd_addresses.sql is applied.
    console.warn('[tron/hd] user_wallets upsert failed:', walletErr.message);
  }

  const { error: addrErr } = await sb
    .from('user_tron_deposit_addresses')
    .upsert({
      user_id: userIdStr,
      address,
      derivation_index: index,
      derivation_path: path,
      network: 'TRC20',
      updated_at: nowIso(),
    }, { onConflict: 'user_id' });

  if (addrErr) {
    console.warn('[tron/hd] user_tron_deposit_addresses upsert failed:', addrErr.message);
  }

  return {
    ok: !walletErr || !addrErr,
    walletError: walletErr?.message || null,
    addressError: addrErr?.message || null,
  };
}

/**
 * Ensure the user has a unique custodial TRC20 deposit address.
 * Creates or upgrades from a shared platform address when HD is enabled.
 */
async function ensureUserTronDepositAddress(userId, { syncSupabase = true } = {}) {
  if (!userId) {
    const err = new Error('userId is required');
    err.code = 'TRON_HD_USER_REQUIRED';
    throw err;
  }

  if (!isHdEnabled()) {
    return null;
  }

  const derived = getPublicDepositAddressForUser(userId);
  let row = await UserUsdtWalletAddress.findCustodial(userId, 'TRC20');

  if (row && row.address === derived.address && row.derivation_index != null) {
    if (syncSupabase) {
      const user = await User.findById(userId).catch(() => null);
      await syncTronDepositAddressToSupabase({
        userId,
        address: derived.address,
        index: derived.index,
        path: derived.path,
        email: user?.email,
        name: user?.name,
        balanceMmk: user?.balance_mmk,
        balanceUsdt: user?.balance_usdt,
      });
    }
    return {
      address: row.address,
      index: Number(row.derivation_index),
      path: row.derivation_path || derived.path,
      network: 'TRC20',
      userId: Number(userId),
      row,
      created: false,
    };
  }

  if (row) {
    // Upgrade shared / stale custodial row to the HD address.
    row = await UserUsdtWalletAddress.updateCustodialTrc20(userId, {
      address: derived.address,
      derivationIndex: derived.index,
      derivationPath: derived.path,
      depositReference: row.deposit_reference || `EISY-HD-U${userId}`,
      label: row.label || 'TRC20 HD deposit',
    });
  } else {
    row = await UserUsdtWalletAddress.create({
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
  }

  if (syncSupabase) {
    const user = await User.findById(userId).catch(() => null);
    await syncTronDepositAddressToSupabase({
      userId,
      address: derived.address,
      index: derived.index,
      path: derived.path,
      email: user?.email,
      name: user?.name,
      balanceMmk: user?.balance_mmk,
      balanceUsdt: user?.balance_usdt,
    });
  }

  return {
    address: derived.address,
    index: derived.index,
    path: derived.path,
    network: 'TRC20',
    userId: Number(userId),
    row,
    created: true,
  };
}

/**
 * Resolve the TRC20 deposit address for a user.
 * Prefers HD; falls back to sharedGatewayFn() when HD is disabled/unavailable.
 */
async function resolveUserTrc20DepositAddress(userId, sharedGatewayFn) {
  try {
    const assigned = await ensureUserTronDepositAddress(userId);
    if (assigned?.address) {
      return {
        address: assigned.address,
        source: 'hd',
        index: assigned.index,
        path: assigned.path,
      };
    }
  } catch (err) {
    if (err.code === 'TRON_HD_NOT_CONFIGURED' || err.code === 'TRON_HD_MNEMONIC_INVALID') {
      console.warn('[tron/hd] falling back to shared gateway:', err.message);
    } else {
      throw err;
    }
  }

  const shared = typeof sharedGatewayFn === 'function'
    ? sharedGatewayFn()
    : String(sharedGatewayFn || '').trim();
  if (!shared) {
    const err = new Error('No TRC20 deposit address available (HD disabled and no shared gateway)');
    err.code = 'TRON_DEPOSIT_ADDRESS_MISSING';
    throw err;
  }
  return { address: shared, source: 'shared', index: null, path: null };
}

module.exports = {
  ensureUserTronDepositAddress,
  resolveUserTrc20DepositAddress,
  syncTronDepositAddressToSupabase,
};
