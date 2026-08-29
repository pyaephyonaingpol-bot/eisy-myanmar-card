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
  return upsertUserWallet(user);
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
    deposit_currency: deposit.deposit_currency || 'MMK',
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
    wallet_type: reload.wallet_type || 'mmk',
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

module.exports = {
  syncUserWalletById,
  upsertUserWallet,
  syncDeposit,
  syncCardApplication,
  syncCardReload,
  isSupabaseEnabled,
};
