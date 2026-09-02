const User = require('../models/User');
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { parseRecordMetadata } = require('./settingsService');

function safeJson(value) {
  if (value == null) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function upsertRow(table, row) {
  const sb = getSupabase();
  if (!sb) return null;
  const { error } = await sb.from(table).upsert(row, { onConflict: 'id' });
  if (error) {
    console.error(`[supabase/sync] ${table} upsert failed:`, error.message);
    return null;
  }
  return row;
}

async function upsertUserWallet(user) {
  if (!isSupabaseEnabled() || !user) return null;
  const row = {
    user_id: String(user.id),
    email: user.email || null,
    name: user.name || null,
    balance_mmk: Number(user.balance_mmk ?? 0),
    balance_usdt: Number(user.balance_usdt ?? 0),
    updated_at: nowIso(),
  };

  // Include HD deposit address when already provisioned locally.
  try {
    const { UserUsdtWalletAddress } = require('../models/UserUsdtWalletAddress');
    const custodial = await UserUsdtWalletAddress.findCustodial(user.id, 'TRC20');
    if (custodial?.address && custodial.derivation_index != null) {
      row.tron_deposit_address = custodial.address;
      row.tron_derivation_index = Number(custodial.derivation_index);
      row.tron_derivation_path = custodial.derivation_path || null;
    }
  } catch (_) {
    // Non-fatal — wallet sync should still update balances.
  }

  const sb = getSupabase();
  const { error } = await sb.from('user_wallets').upsert(row, { onConflict: 'user_id' });
  if (error) console.error('[supabase/sync] user_wallets upsert failed:', error.message);
  return row;
}

async function syncUserWalletById(userId) {
  if (!isSupabaseEnabled()) return null;
  const user = await User.findById(userId);
  if (!user) return null;
  const row = await upsertUserWallet(user);
  try {
    const { invalidateUserWalletCache } = require('./supabaseWalletReadService');
    invalidateUserWalletCache(userId);
  } catch (_) {
    // Cache module may be unavailable in some test harnesses.
  }
  return row;
}

/**
 * Ensure a Supabase user_wallets row exists for this Turso user.
 * Creates the mirror row on first login / dashboard load when missing.
 * Non-fatal when Supabase is disabled or unreachable.
 */
async function ensureSupabaseUserWallet(userId, { syncIfExists = false } = {}) {
  if (!isSupabaseEnabled()) {
    return { ensured: false, skipped: true, reason: 'supabase_disabled' };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { ensured: false, skipped: true, reason: 'user_not_found' };
  }

  const { fetchFreshUserWalletRow, invalidateUserWalletCache } = require('./supabaseWalletReadService');
  const existing = await fetchFreshUserWalletRow(userId, {
    email: user.email,
    bypassCache: true,
  });

  if (existing && !syncIfExists) {
    return { ensured: true, created: false, row: existing };
  }

  const row = await upsertUserWallet(user);
  invalidateUserWalletCache(userId);

  let freshRow = existing;
  if (!existing || syncIfExists) {
    freshRow = await fetchFreshUserWalletRow(userId, {
      email: user.email,
      bypassCache: true,
    });
  }

  return {
    ensured: Boolean(row || freshRow),
    created: !existing,
    row: freshRow || row,
  };
}

function ensureSupabaseUserWalletInBackground(userId, options = {}) {
  ensureSupabaseUserWallet(userId, options).catch((err) => {
    console.warn('[supabase] ensure user wallet:', err.message);
  });
}

async function syncDeposit(deposit, user) {
  if (!isSupabaseEnabled() || !deposit) return null;
  const u = user || (deposit.user_id ? await User.findById(deposit.user_id) : null);
  return upsertRow('deposit_requests', {
    id: String(deposit.id),
    user_id: String(deposit.user_id),
    user_email: u?.email || null,
    user_name: u?.name || null,
    amount_mmk: Number(deposit.amount_mmk ?? 0),
    amount_usd: Number(deposit.amount_usd ?? 0),
    ref_code: deposit.ref_code || null,
    payment_method: deposit.payment_method || null,
    deposit_currency: deposit.deposit_currency || 'USDT',
    status: deposit.status || 'PENDING',
    purpose: deposit.purpose || 'topup',
    metadata: safeJson(deposit.metadata),
    created_at: deposit.created_at || nowIso(),
    updated_at: deposit.updated_at || nowIso(),
  });
}

async function syncCardApplication(card, user, extra = {}) {
  if (!isSupabaseEnabled() || !card) return null;
  const u = user || (card.user_id ? await User.findById(card.user_id) : null);
  const metadata = safeJson(card.metadata);
  const pricing = metadata.pricing || extra.pricing || safeJson(extra.pricing);
  const displayStatus = extra.display_status
    || (card.status === 'pending' ? 'PENDING_ISSUANCE' : String(card.status || '').toUpperCase());

  return upsertRow('card_applications', {
    id: String(card.id),
    user_id: String(card.user_id),
    user_email: u?.email || null,
    user_name: u?.name || null,
    card_holder_name: card.card_holder_name || u?.name || null,
    status: card.status || 'pending',
    display_status: displayStatus,
    pricing,
    metadata,
    deposit_id: extra.deposit_id ? String(extra.deposit_id) : (metadata.deposit_id ? String(metadata.deposit_id) : null),
    created_at: card.created_at || nowIso(),
    updated_at: card.updated_at || nowIso(),
  });
}

async function syncCardReload(reload, user) {
  if (!isSupabaseEnabled() || !reload) return null;
  const u = user || (reload.user_id ? await User.findById(reload.user_id) : null);
  let metadata = safeJson(reload.metadata);
  if (reload.card_id && !metadata.card_last4) {
    try {
      const Card = require('../models/Card');
      const card = await Card.findById(reload.card_id);
      if (card?.card_number) {
        const num = String(card.card_number).replace(/\s/g, '');
        metadata = { ...metadata, card_last4: num.slice(-4) };
      }
    } catch (_) { /* ignore */ }
  }
  return upsertRow('card_reload_requests', {
    id: String(reload.id),
    user_id: String(reload.user_id),
    user_email: u?.email || reload.user_email || null,
    user_name: u?.name || reload.user_name || null,
    card_id: reload.card_id ? String(reload.card_id) : null,
    wallet_type: reload.wallet_type || 'usdt',
    amount_mmk: reload.amount_mmk != null ? Number(reload.amount_mmk) : null,
    amount_usdt: reload.amount_usdt != null ? Number(reload.amount_usdt) : null,
    net_usd_to_card: reload.net_usd_to_card != null ? Number(reload.net_usd_to_card) : null,
    status: reload.status || 'pending',
    pricing: safeJson(reload.pricing_json || reload.pricing),
    metadata,
    created_at: reload.created_at || nowIso(),
    updated_at: reload.updated_at || nowIso(),
  });
}

async function syncUsdtBankWithdrawal(withdrawal, user) {
  if (!isSupabaseEnabled() || !withdrawal) return null;
  const u = user || (withdrawal.user_id ? await User.findById(withdrawal.user_id) : null);
  return upsertRow('usdt_bank_withdrawals', {
    id: String(withdrawal.id),
    user_id: String(withdrawal.user_id),
    user_email: u?.email || null,
    user_name: u?.name || null,
    ref_code: withdrawal.ref_code || null,
    payout_method: withdrawal.payout_method || 'bank',
    amount_usdt: withdrawal.amount_usdt != null ? Number(withdrawal.amount_usdt) : null,
    fee_usdt: withdrawal.fee_usdt != null ? Number(withdrawal.fee_usdt) : null,
    net_usdt: withdrawal.net_usdt != null ? Number(withdrawal.net_usdt) : null,
    exchange_rate: withdrawal.exchange_rate != null ? Number(withdrawal.exchange_rate) : null,
    amount_mmk: withdrawal.amount_mmk != null ? Number(withdrawal.amount_mmk) : null,
    bank_name: withdrawal.bank_name || null,
    account_name: withdrawal.account_name || null,
    account_number: withdrawal.account_number || null,
    status: withdrawal.status || 'pending',
    admin_note: withdrawal.admin_note || null,
    created_at: withdrawal.created_at || nowIso(),
    updated_at: withdrawal.updated_at || nowIso(),
  });
}

/** Mirror Turso transaction_logs → Supabase (fixes "missing transactions" in Table Editor). */
async function syncTransactionLog(row) {
  if (!isSupabaseEnabled() || !row?.id) return null;
  const meta = safeJson(row.metadata);
  const amountUsdt = row.amount_usdt != null
    ? Number(row.amount_usdt)
    : (meta.amount_usdt != null ? Number(meta.amount_usdt) : null);
  return upsertRow('transaction_logs', {
    id: String(row.id),
    user_id: row.user_id != null ? String(row.user_id) : null,
    type: row.type || null,
    direction: row.direction || null,
    amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
    amount_mmk: row.amount_mmk != null ? Number(row.amount_mmk) : null,
    amount_usdt: amountUsdt,
    balance_before: row.balance_before != null ? Number(row.balance_before) : null,
    balance_after: row.balance_after != null ? Number(row.balance_after) : null,
    reference_type: row.reference_type || null,
    reference_id: row.reference_id != null ? String(row.reference_id) : null,
    description: row.description || null,
    metadata: meta,
    created_by: row.created_by || null,
    created_at: row.created_at || nowIso(),
  });
}

/** Mirror all USDT withdrawal requests (crypto + bank) for admin visibility. */
async function syncUsdtWithdrawalRequest(withdrawal) {
  if (!isSupabaseEnabled() || !withdrawal?.id) return null;
  return upsertRow('usdt_withdrawal_requests', {
    id: String(withdrawal.id),
    user_id: String(withdrawal.user_id),
    ref_code: withdrawal.ref_code || null,
    payout_method: withdrawal.payout_method || null,
    network: withdrawal.network || null,
    wallet_address: withdrawal.wallet_address || null,
    amount_usdt: withdrawal.amount_usdt != null ? Number(withdrawal.amount_usdt) : null,
    fee_usdt: withdrawal.fee_usdt != null ? Number(withdrawal.fee_usdt) : null,
    net_usdt: withdrawal.net_usdt != null ? Number(withdrawal.net_usdt) : null,
    status: withdrawal.status || 'pending',
    tx_hash: withdrawal.tx_hash || null,
    admin_note: withdrawal.admin_note || null,
    created_at: withdrawal.created_at || nowIso(),
    processed_at: withdrawal.processed_at || null,
  });
}

module.exports = {
  syncUserWalletById,
  ensureSupabaseUserWallet,
  ensureSupabaseUserWalletInBackground,
  upsertUserWallet,
  syncDeposit,
  syncCardApplication,
  syncCardReload,
  syncUsdtBankWithdrawal,
  syncTransactionLog,
  syncUsdtWithdrawalRequest,
  isSupabaseEnabled,
};
