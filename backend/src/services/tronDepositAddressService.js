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

function isMissingSchemaError(message) {
  const msg = String(message || '').toLowerCase();
  return msg.includes('could not find') || msg.includes('does not exist') || msg.includes('schema cache');
}

/**
 * Upsert with progressive column stripping when Supabase schema is behind.
 * Live projects often only have user_id/email/name/balance_usdt until
 * supabase/user_tron_hd_addresses.sql is applied.
 */
async function upsertUserWalletAdaptive(sb, patch) {
  let payload = { ...patch };
  const stripped = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { error } = await sb.from('user_wallets').upsert(payload, { onConflict: 'user_id' });
    if (!error) {
      return { ok: true, stripped, error: null };
    }
    if (!isMissingSchemaError(error.message)) {
      return { ok: false, stripped, error: error.message };
    }
    const colMatch = error.message.match(/'([^']+)' column/i)
      || error.message.match(/column\s+user_wallets\.([a-z0-9_]+)/i);
    const missingCol = colMatch?.[1];
    if (!missingCol || !Object.prototype.hasOwnProperty.call(payload, missingCol)) {
      const minimal = {
        user_id: patch.user_id,
        updated_at: patch.updated_at || nowIso(),
      };
      if (patch.email != null) minimal.email = patch.email;
      if (patch.name != null) minimal.name = patch.name;
      if (patch.balance_usdt != null) minimal.balance_usdt = patch.balance_usdt;
      const { error: minErr } = await sb.from('user_wallets').upsert(minimal, { onConflict: 'user_id' });
      return {
        ok: !minErr,
        stripped: [...stripped, ...(missingCol ? [missingCol] : []), 'non_core_columns'],
        error: minErr?.message || error.message,
        schemaBehind: true,
      };
    }
    delete payload[missingCol];
    stripped.push(missingCol);
  }
  return { ok: false, stripped, error: 'user_wallets upsert retries exhausted' };
}

async function upsertHdAddressTable(sb, row) {
  // Prefer the name referenced by ops (`user_tron_hd_addresses`);
  // also try the legacy alias created by older SQL.
  const tables = ['user_tron_hd_addresses', 'user_tron_deposit_addresses'];
  const errors = [];
  for (const table of tables) {
    const { error } = await sb.from(table).upsert(row, { onConflict: 'user_id' });
    if (!error) return { ok: true, table, error: null };
    errors.push(`${table}: ${error.message}`);
    if (!isMissingSchemaError(error.message)) {
      return { ok: false, table, error: error.message };
    }
  }
  return { ok: false, table: null, error: errors.join(' | '), schemaBehind: true };
}

/**
 * Upsert the derived address onto Supabase user_wallets + HD address table.
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

  const walletResult = await upsertUserWalletAdaptive(sb, walletPatch);
  if (!walletResult.ok || walletResult.schemaBehind) {
    console.warn(
      '[tron/hd] user_wallets upsert:',
      walletResult.error || 'ok with stripped columns',
      walletResult.stripped?.length ? `(stripped: ${walletResult.stripped.join(', ')})` : ''
    );
  }

  const addrResult = await upsertHdAddressTable(sb, {
    user_id: userIdStr,
    address,
    derivation_index: index,
    derivation_path: path,
    network: 'TRC20',
    updated_at: nowIso(),
  });
  if (!addrResult.ok) {
    console.warn(
      '[tron/hd] HD address table upsert failed:',
      addrResult.error,
      '— apply supabase/user_tron_hd_addresses.sql in the Supabase SQL editor'
    );
  }

  return {
    ok: Boolean(walletResult.ok || addrResult.ok),
    walletError: walletResult.ok ? null : walletResult.error,
    addressError: addrResult.ok ? null : addrResult.error,
    addressTable: addrResult.table || null,
    schemaBehind: Boolean(walletResult.schemaBehind || addrResult.schemaBehind),
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

/**
 * Re-derive custodial TRC20 deposit addresses from the production HD seed and
 * overwrite mismatched local rows (optionally syncing Supabase mirrors).
 *
 * @param {{ userIds?: number[], dryRun?: boolean, syncSupabase?: boolean, limit?: number }} opts
 */
async function resyncHdDepositAddresses({
  userIds = null,
  dryRun = false,
  syncSupabase = true,
  limit = 500,
} = {}) {
  if (!isHdEnabled()) {
    const err = new Error('TRON HD is not configured — cannot resync deposit addresses');
    err.code = 'TRON_HD_NOT_CONFIGURED';
    throw err;
  }

  let ids = Array.isArray(userIds)
    ? userIds.map((v) => Number(v)).filter((id) => Number.isInteger(id) && id > 0)
    : null;

  if (!ids || ids.length === 0) {
    const { getDb } = require('../db');
    const rows = await getDb().all(`
      SELECT DISTINCT user_id
      FROM user_usdt_wallet_addresses
      WHERE network = 'TRC20' AND address_type = 'custodial'
      ORDER BY user_id ASC
      LIMIT ?
    `, Math.min(Math.max(Number(limit) || 500, 1), 5000));
    ids = (rows || []).map((r) => Number(r.user_id)).filter((id) => Number.isInteger(id) && id > 0);
  }

  const results = [];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const userId of ids) {
    try {
      const derived = getPublicDepositAddressForUser(userId);
      const existing = await UserUsdtWalletAddress.findCustodial(userId, 'TRC20');
      const previousAddress = existing?.address || null;
      const matches = Boolean(
        previousAddress
        && previousAddress === derived.address
        && existing?.derivation_index != null
      );

      if (dryRun) {
        results.push({
          ok: true,
          dry_run: true,
          user_id: userId,
          previous_address: previousAddress,
          address: derived.address,
          derivation_index: derived.index,
          derivation_path: derived.path,
          changed: !matches,
        });
        if (matches) unchanged += 1;
        else updated += 1;
        continue;
      }

      const assigned = await ensureUserTronDepositAddress(userId, { syncSupabase });
      const changed = !matches;
      if (changed) updated += 1;
      else unchanged += 1;
      results.push({
        ok: true,
        dry_run: false,
        user_id: userId,
        previous_address: previousAddress,
        address: assigned.address,
        derivation_index: assigned.index,
        derivation_path: assigned.path,
        changed,
        created: Boolean(assigned.created),
      });
    } catch (err) {
      failed += 1;
      results.push({
        ok: false,
        user_id: userId,
        error: err.message || 'resync failed',
        code: err.code || 'TRON_HD_RESYNC_FAILED',
      });
    }
  }

  return {
    ok: failed === 0,
    dry_run: Boolean(dryRun),
    checked: ids.length,
    updated,
    unchanged,
    failed,
    results,
  };
}

module.exports = {
  ensureUserTronDepositAddress,
  resolveUserTrc20DepositAddress,
  syncTronDepositAddressToSupabase,
  resyncHdDepositAddresses,
};
