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

async function syncTransactionActivity(log, user) {
  if (!isSupabaseEnabled() || !log) return null;
  const u = user || (log.user_id ? await User.findById(log.user_id) : null);
  return upsertRow('transaction_activity', {
    id: String(log.id),
    user_id: String(log.user_id),
    user_email: u?.email || log.email || null,
    user_name: u?.name || log.name || null,
    type: log.type || 'other',
    direction: log.direction || 'neutral',
    amount_usd: log.amount_usd != null ? Number(log.amount_usd) : null,
    amount_mmk: log.amount_mmk != null ? Number(log.amount_mmk) : null,
    balance_before: log.balance_before != null ? Number(log.balance_before) : null,
    balance_after: log.balance_after != null ? Number(log.balance_after) : null,
    reference_type: log.reference_type || null,
    reference_id: log.reference_id != null ? String(log.reference_id) : null,
    description: log.description || null,
    metadata: safeJson(log.metadata),
    created_by: log.created_by || null,
    created_at: log.created_at || nowIso(),
  });
}

/**
 * Full historical backfill from Turso/LibSQL (source of truth) → Supabase mirrors.
 * Safe to re-run (upsert). Does not delete or rewrite local DB rows.
 */
async function backfillHistoricalDataToSupabase({
  depositLimit = 5000,
  cardLimit = 5000,
  reloadLimit = 5000,
  activityLimit = 10000,
} = {}) {
  if (!isSupabaseEnabled()) {
    return {
      ok: false,
      error: 'Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    };
  }

  const { getDb } = require('../db');
  const DepositRequest = require('../models/DepositRequest');
  const Card = require('../models/Card');
  const TransactionLog = require('../models/TransactionLog');
  const db = getDb();

  const summary = {
    users: { total: 0, synced: 0, failed: 0 },
    deposits: { total: 0, synced: 0, failed: 0 },
    cards: { total: 0, synced: 0, failed: 0 },
    reloads: { total: 0, synced: 0, failed: 0 },
    activity: { total: 0, synced: 0, failed: 0 },
  };

  const users = await db.all('SELECT * FROM users ORDER BY id ASC');
  summary.users.total = users.length;
  for (const user of users) {
    const row = await upsertUserWallet(user);
    if (row) summary.users.synced += 1;
    else summary.users.failed += 1;
  }

  const deposits = await DepositRequest.listAll({ limit: depositLimit });
  summary.deposits.total = deposits.length;
  for (const deposit of deposits) {
    const row = await syncDeposit(deposit);
    if (row) summary.deposits.synced += 1;
    else summary.deposits.failed += 1;
  }

  const cards = await Card.listAll({ limit: cardLimit });
  summary.cards.total = cards.length;
  for (const card of cards) {
    const row = await syncCardApplication(card);
    if (row) summary.cards.synced += 1;
    else summary.cards.failed += 1;
  }

  const reloads = await db.all(`
    SELECT r.*, u.email AS user_email, u.name AS user_name
    FROM card_reload_requests r
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.id ASC
    LIMIT ?
  `, reloadLimit);
  summary.reloads.total = reloads.length;
  for (const reload of reloads) {
    const row = await syncCardReload(reload);
    if (row) summary.reloads.synced += 1;
    else summary.reloads.failed += 1;
  }

  const activities = await TransactionLog.listAll({ limit: activityLimit });
  summary.activity.total = activities.length;
  for (const log of activities) {
    const row = await syncTransactionActivity(log);
    if (row) summary.activity.synced += 1;
    else summary.activity.failed += 1;
  }

  return { ok: true, summary };
}

module.exports = {
  syncUserWalletById,
  upsertUserWallet,
  syncDeposit,
  syncCardApplication,
  syncCardReload,
  syncTransactionActivity,
  backfillHistoricalDataToSupabase,
  isSupabaseEnabled,
};
