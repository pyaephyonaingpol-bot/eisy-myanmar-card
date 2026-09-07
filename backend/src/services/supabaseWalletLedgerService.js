const crypto = require('crypto');
const { getSupabase, isSupabaseEnabled } = require('../lib/supabase');
const { getSupabaseAdmin, isSupabaseAdminEnabled } = require('../../../lib/supabaseAdmin');
const { invalidateUserWalletCache } = require('./supabaseWalletReadService');

function roundUsdt(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildJournalId(prefix = 'CARD') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function getRpcClient() {
  if (isSupabaseAdminEnabled()) return getSupabaseAdmin();
  if (isSupabaseEnabled()) return getSupabase();
  return null;
}

function mapRpcError(result, fallbackCode = 'SUPABASE_RPC_ERROR') {
  const err = new Error(result?.error || 'Supabase wallet operation failed');
  err.code = result?.code || fallbackCode;
  if (result?.required_usdt != null) err.required_usdt = Number(result.required_usdt);
  if (result?.available_usdt != null) err.available_usdt = Number(result.available_usdt);
  return err;
}

function assertRpcOk(data, fallbackCode) {
  if (!data || data.ok !== true) {
    throw mapRpcError(data, fallbackCode);
  }
  return data;
}

/**
 * PostgREST PGRST202 / missing relation — SQL in supabase/wallet_card_purchase.sql
 * has not been applied to this project yet.
 */
function isMissingCardPurchaseRpcError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42883') return true;
  if (code === 'SUPABASE_CARD_PURCHASE_RPC_MISSING') return true;
  if (/Could not find the function/i.test(message)) return true;
  if (/Could not find the table .*wallet_transactions/i.test(message)) return true;
  if (/debit_usdt_for_card_purchase/i.test(message) && /schema cache|does not exist/i.test(message)) {
    return true;
  }
  if (/finalize_card_purchase_wallet/i.test(message) && /schema cache|does not exist/i.test(message)) {
    return true;
  }
  return false;
}

function missingRpcError(underlying) {
  const err = new Error(
    'Card purchase wallet RPC is not installed on Supabase. '
    + 'Apply supabase/wallet_card_purchase.sql (debit_usdt_for_card_purchase / '
    + 'finalize_card_purchase_wallet), or the server will use the Turso debit fallback.'
  );
  err.code = 'SUPABASE_CARD_PURCHASE_RPC_MISSING';
  err.cause = underlying || null;
  err.provider_code = underlying?.code || null;
  return err;
}

/**
 * Atomic Supabase debit: balance check + deduct + pending wallet_transactions row.
 */
async function debitUsdtForCardPurchase(userId, {
  totalAmountUsdt,
  kripicardCostUsd,
  platformMarkupUsd,
  idempotencyKey,
  description,
  metadata,
} = {}) {
  const sb = getRpcClient();
  if (!sb) {
    const err = new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  const amount = roundUsdt(totalAmountUsdt);
  if (amount <= 0) {
    const err = new Error('Debit amount must be a positive number');
    err.code = 'INVALID_AMOUNT';
    throw err;
  }

  const journalId = String(idempotencyKey || buildJournalId('CARD-DEBIT')).trim();

  const { data, error } = await sb.rpc('debit_usdt_for_card_purchase', {
    p_user_id: String(userId),
    p_total_amount: amount,
    p_kripicard_cost: kripicardCostUsd != null ? roundUsdt(kripicardCostUsd) : null,
    p_platform_markup: platformMarkupUsd != null ? roundUsdt(platformMarkupUsd) : null,
    p_idempotency_key: journalId,
    p_description: description || null,
    p_metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });

  if (error) {
    if (isMissingCardPurchaseRpcError(error)) {
      throw missingRpcError(error);
    }
    const err = new Error(error.message || 'Supabase debit RPC failed');
    err.code = error.code || 'SUPABASE_RPC_ERROR';
    throw err;
  }

  const result = assertRpcOk(data, 'DEBIT_FAILED');
  invalidateUserWalletCache(userId);

  return {
    journal_id: result.journal_id || journalId,
    transaction_id: result.transaction_id || null,
    amount_usdt: roundUsdt(result.amount_usdt ?? amount),
    balance_before: roundUsdt(result.balance_before),
    balance_after: roundUsdt(result.balance_after),
    status: result.status || 'pending',
    duplicate: Boolean(result.duplicate),
    mode: 'rpc',
  };
}

/**
 * Complete pending debit after Kripicard succeeds, or refund on provider failure.
 */
async function finalizeCardPurchaseWallet(journalId, {
  outcome,
  referenceId = null,
  failureReason = null,
  metadata,
} = {}) {
  const sb = getRpcClient();
  if (!sb) {
    const err = new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  const normalizedOutcome = String(outcome || '').toLowerCase();
  if (!['completed', 'refunded'].includes(normalizedOutcome)) {
    const err = new Error('outcome must be completed or refunded');
    err.code = 'INVALID_OUTCOME';
    throw err;
  }

  const { data, error } = await sb.rpc('finalize_card_purchase_wallet', {
    p_journal_id: String(journalId),
    p_outcome: normalizedOutcome,
    p_reference_id: referenceId != null ? String(referenceId) : null,
    p_failure_reason: failureReason || null,
    p_metadata: metadata && typeof metadata === 'object' ? metadata : {},
  });

  if (error) {
    if (isMissingCardPurchaseRpcError(error)) {
      throw missingRpcError(error);
    }
    const err = new Error(error.message || 'Supabase finalize RPC failed');
    err.code = error.code || 'SUPABASE_RPC_ERROR';
    throw err;
  }

  const result = assertRpcOk(data, 'FINALIZE_FAILED');

  return {
    outcome: result.outcome || normalizedOutcome,
    journal_id: result.journal_id || journalId,
    refund_journal_id: result.refund_journal_id || null,
    balance_after: result.balance_after != null ? roundUsdt(result.balance_after) : null,
    amount_usdt: result.amount_usdt != null ? roundUsdt(result.amount_usdt) : null,
    refunded: Boolean(result.refunded),
    duplicate: Boolean(result.duplicate),
    reference_id: result.reference_id || referenceId || null,
    mode: 'rpc',
  };
}

module.exports = {
  buildJournalId,
  debitUsdtForCardPurchase,
  finalizeCardPurchaseWallet,
  isMissingCardPurchaseRpcError,
};
