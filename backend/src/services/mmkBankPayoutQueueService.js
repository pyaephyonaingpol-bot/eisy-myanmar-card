/**
 * Unified admin queue for manual MMK bank payouts.
 *
 * Includes:
 * - MMK wallet → bank (WM-*, mmk_withdrawal_requests)
 * - USDT → MMK bank (WB-*, usdt_withdrawal_requests.payout_method = bank)
 *
 * Sell USDT / Convert to MMK creates WB-* rows; the dedicated MMK Withdrawals
 * admin tab must surface those alongside pure MMK wallet withdrawals.
 */

const MmkWithdrawal = require('../models/MmkWithdrawal');
const UsdtWithdrawal = require('../models/UsdtWithdrawal');

function sortByCreatedDesc(a, b) {
  const ta = Date.parse(a.created_at || '') || 0;
  const tb = Date.parse(b.created_at || '') || 0;
  return tb - ta;
}

function mapMmkWalletRow(row) {
  const amountMmk = Number(row.amount_mmk) || 0;
  const feeMmk = Number(row.fee_mmk) || 0;
  const netMmk = row.net_mmk != null ? Number(row.net_mmk) : amountMmk - feeMmk;
  return {
    id: row.id,
    source: 'mmk_wallet',
    source_label: 'MMK wallet',
    ref_code: row.ref_code,
    status: row.status,
    user_id: row.user_id,
    user_name: row.user_name || null,
    user_email: row.user_email || null,
    user_phone: row.user_phone || null,
    user_balance_mmk: row.user_balance_mmk != null ? Number(row.user_balance_mmk) : null,
    bank_name: row.bank_name || null,
    account_name: row.account_name || null,
    account_number: row.account_number || null,
    amount_mmk: amountMmk,
    fee_mmk: feeMmk,
    net_mmk: netMmk,
    amount_usdt: null,
    fee_usdt: null,
    net_usdt: null,
    exchange_rate: null,
    admin_note: row.admin_note || null,
    proof_path: row.proof_path || null,
    proof_url: row.proof_url || null,
    proof_mime_type: row.proof_mime_type || null,
    proof_original_name: row.proof_original_name || null,
    created_at: row.created_at,
    processed_at: row.processed_at || null,
  };
}

function mapUsdtBankRow(row) {
  const amountMmk = Number(row.amount_mmk) || 0;
  return {
    id: row.id,
    source: 'usdt_bank',
    source_label: 'USDT → MMK bank',
    ref_code: row.ref_code,
    status: row.status,
    user_id: row.user_id,
    user_name: row.user_name || null,
    user_email: row.user_email || null,
    user_phone: row.user_phone || null,
    user_balance_mmk: row.user_balance_mmk != null ? Number(row.user_balance_mmk) : null,
    bank_name: row.bank_name || null,
    account_name: row.account_name || null,
    account_number: row.account_number || null,
    // Net MMK to send offline is amount_mmk on USDT→bank rows
    amount_mmk: amountMmk,
    fee_mmk: 0,
    net_mmk: amountMmk,
    amount_usdt: row.amount_usdt != null ? Number(row.amount_usdt) : null,
    fee_usdt: row.fee_usdt != null ? Number(row.fee_usdt) : null,
    net_usdt: row.net_usdt != null ? Number(row.net_usdt) : null,
    exchange_rate: row.exchange_rate != null ? Number(row.exchange_rate) : null,
    admin_note: row.admin_note || null,
    proof_path: row.proof_path || null,
    proof_url: row.proof_url || null,
    proof_mime_type: row.proof_mime_type || null,
    proof_original_name: row.proof_original_name || null,
    created_at: row.created_at,
    processed_at: row.processed_at || null,
  };
}

/**
 * List all manual MMK bank payout requests for the admin tab.
 * @param {{ status?: string, limit?: number }} opts
 */
async function listMmkBankPayoutQueue({ status, limit = 500 } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 500);
  // Fetch enough from each source then merge/sort (status filters applied in models)
  const perSource = lim;

  const [mmkRows, usdtBankRows] = await Promise.all([
    MmkWithdrawal.listAll({ status, limit: perSource }),
    UsdtWithdrawal.listAll({ status, limit: perSource, payoutMethod: 'bank' }),
  ]);

  const merged = [
    ...mmkRows.map(mapMmkWalletRow),
    ...usdtBankRows.map(mapUsdtBankRow),
  ].sort(sortByCreatedDesc);

  return merged.slice(0, lim);
}

module.exports = {
  listMmkBankPayoutQueue,
  mapMmkWalletRow,
  mapUsdtBankRow,
};
