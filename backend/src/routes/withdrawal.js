const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const {
  getWithdrawalFeeSettings,
  calculateWithdrawalBreakdown,
  calculateMmkWithdrawalBreakdown,
} = require('../services/settingsService');
const {
  createUsdtWithdrawalRequest,
  createMmkBankWithdrawalRequest,
  assertMmkToUsdtForbidden,
} = require('../services/withdrawalService');
const UsdtWithdrawal = require('../models/UsdtWithdrawal');
const MmkWithdrawal = require('../models/MmkWithdrawal');
const { walletPayload } = require('../services/walletService');
const User = require('../models/User');

const router = express.Router();

function mapUsdtWithdrawal(row) {
  if (!row) return null;
  return {
    id: row.id,
    ref_code: row.ref_code,
    payout_method: row.payout_method || 'crypto',
    payout_provider: row.payout_provider || null,
    payout_currency: row.payout_currency || null,
    network: row.network,
    wallet_address: row.wallet_address,
    amount_usdt: row.amount_usdt,
    fee_usdt: row.fee_usdt,
    net_usdt: row.net_usdt,
    exchange_rate: row.exchange_rate,
    amount_mmk: row.amount_mmk,
    bank_name: row.bank_name,
    account_name: row.account_name,
    account_number: row.account_number,
    status: row.status,
    admin_note: row.admin_note,
    tx_hash: row.tx_hash,
    nowpayments_payout_id: row.nowpayments_payout_id || null,
    nowpayments_withdrawal_id: row.nowpayments_withdrawal_id || null,
    created_at: row.created_at,
    processed_at: row.processed_at,
  };
}

function mapMmkWithdrawal(row) {
  if (!row) return null;
  return {
    id: row.id,
    ref_code: row.ref_code,
    amount_mmk: row.amount_mmk,
    fee_mmk: row.fee_mmk,
    net_mmk: row.net_mmk,
    fee_percent: row.fee_percent,
    bank_name: row.bank_name,
    account_name: row.account_name,
    account_number: row.account_number,
    status: row.status,
    admin_note: row.admin_note,
    created_at: row.created_at,
    processed_at: row.processed_at,
  };
}

router.get('/fees', requireAuth, async (_req, res) => {
  try {
    const settings = await getWithdrawalFeeSettings();
    const mode = settings.payment_service_fee_mode || 'max_percent_or_min';
    const feeRule = mode === 'off'
      ? 'fee = 0'
      : mode === 'percent'
        ? 'fee = amount * percent/100'
        : mode === 'fixed'
          ? 'fee = fixedUsdt'
          : 'Math.max(amount * percent/100, minimum)';
    const pct = settings.payment_service_fee_percent ?? 2;
    const minUsdt = settings.payment_service_fee_minimum_usdt ?? 1;
    const feeLabel = mode === 'off'
      ? 'No service fee'
      : mode === 'fixed'
        ? `fixed $${Number(minUsdt).toFixed(2)}`
        : mode === 'percent'
          ? `${pct}%`
          : `${pct}% (min $${Number(minUsdt).toFixed(2)})`;
    res.json({
      fees: settings,
      policy: {
        mmk_to_usdt_allowed: false,
        mmk_bank_withdraw_allowed: true,
        usdt_crypto_withdraw_allowed: true,
        usdt_bank_withdraw_allowed: true,
        service_fee_rule: feeRule,
        service_fee_mode: mode,
        service_fee_percent: pct,
        service_fee_minimum_usdt: minUsdt,
      },
      networks: [
        {
          network: 'TRC20',
          payout_method: 'nowpayments',
          label: 'NOWPayments (USDT TRC20)',
          fee_rule: feeRule,
          fee_mode: mode,
          fee_percent: pct,
          minimum_fee_usdt: minUsdt,
          fee_label: feeLabel,
        },
        {
          network: 'TRC20',
          payout_method: 'crypto',
          label: 'TRC20 (TRON Network)',
          fee_rule: feeRule,
          fee_mode: mode,
          fee_percent: pct,
          minimum_fee_usdt: minUsdt,
          fee_label: feeLabel,
        },
        {
          network: 'BEP20',
          payout_method: 'crypto',
          label: 'BEP20 (BSC Network)',
          fee_rule: feeRule,
          fee_mode: mode,
          fee_percent: pct,
          minimum_fee_usdt: minUsdt,
          fee_label: feeLabel,
        },
        {
          network: 'BANK',
          payout_method: 'bank',
          label: 'Bank Account (USDT → MMK)',
          fee_rule: feeRule,
          fee_mode: mode,
          fee_percent: pct,
          minimum_fee_usdt: minUsdt,
          fee_label: feeLabel,
          exchange_rate: settings.mmk_to_usd_rate,
        },
      ],
      minimum_usdt_withdrawal: settings.minimum_usdt_withdrawal,
      minimum_mmk_withdrawal: settings.minimum_mmk_withdrawal,
      mmk_withdraw_fee_percent: settings.payment_service_fee_percent ?? 2,
      payment_service_fee_percent: settings.payment_service_fee_percent ?? 2,
      payment_service_fee_minimum_usdt: settings.payment_service_fee_minimum_usdt ?? 1,
      payment_service_fee_mode: mode,
      mmk_to_usd_rate: settings.mmk_to_usd_rate,
    });
  } catch (err) {
    console.error('[withdrawal/fees GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/preview', requireAuth, async (req, res) => {
  try {
    const settings = await getWithdrawalFeeSettings();
    const payoutMethod = String(req.body.payout_method || 'crypto').toLowerCase();
    if (payoutMethod === 'mmk' || req.body.currency === 'MMK') {
      const breakdown = calculateMmkWithdrawalBreakdown(req.body.amount_mmk, settings);
      return res.json({ breakdown, settings, payout_method: 'mmk_bank' });
    }
    const network = payoutMethod === 'bank'
      ? 'BANK'
      : String(req.body.network || 'TRC20').toUpperCase();
    const breakdown = calculateWithdrawalBreakdown(req.body.amount_usdt, network, settings);
    res.json({ breakdown, settings });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid preview request' });
  }
});

/** Hard block — MMK → USDT exchange is never permitted. */
router.post('/convert/mmk-to-usdt', requireAuth, async (_req, res) => {
  try {
    assertMmkToUsdtForbidden();
  } catch (err) {
    return res.status(403).json({
      error: err.message,
      code: err.code || 'MMK_TO_USDT_FORBIDDEN',
      allowed: {
        mmk_bank_withdraw: true,
        usdt_crypto_withdraw: true,
        usdt_bank_withdraw: true,
        mmk_to_usdt_exchange: false,
      },
    });
  }
});

router.post('/exchange/mmk-to-usdt', requireAuth, async (_req, res) => {
  try {
    assertMmkToUsdtForbidden();
  } catch (err) {
    return res.status(403).json({
      error: err.message,
      code: err.code || 'MMK_TO_USDT_FORBIDDEN',
    });
  }
});

router.post('/usdt', requireAuth, requireSensitive, async (req, res) => {
  try {
    const result = await createUsdtWithdrawalRequest(req.user.id, req.body || {});
    const user = await User.findById(req.user.id);
    res.status(201).json({
      success: true,
      ref_code: result.withdrawal.ref_code,
      withdrawal: mapUsdtWithdrawal(result.withdrawal),
      breakdown: result.breakdown,
      payout: result.payout
        ? {
            provider: 'nowpayments',
            payout_id: result.payout.payout_id,
            status: result.payout.status,
            currency: result.payout.currency,
            message: result.payout.message,
          }
        : null,
      message: result.message,
      wallet: walletPayload(user),
    });
  } catch (err) {
    console.error('[withdrawal/usdt POST]', err);
    const status = err.code === 'INSUFFICIENT_USDT_BALANCE' ? 402 : 400;
    res.status(status).json({
      error: err.message || 'Withdrawal failed',
      code: err.code,
      required_usdt: err.required_usdt,
      available_usdt: err.available_usdt,
    });
  }
});

router.post('/mmk', requireAuth, requireSensitive, async (req, res) => {
  try {
    const result = await createMmkBankWithdrawalRequest(req.user.id, req.body || {});
    const user = await User.findById(req.user.id);
    res.status(201).json({
      success: true,
      ref_code: result.withdrawal.ref_code,
      withdrawal: mapMmkWithdrawal(result.withdrawal),
      breakdown: result.breakdown,
      message: result.message,
      wallet: walletPayload(user),
    });
  } catch (err) {
    console.error('[withdrawal/mmk POST]', err);
    const status = err.code === 'INSUFFICIENT_MMK_BALANCE'
      ? 402
      : (err.code === 'MMK_TO_USDT_FORBIDDEN' || err.code === 'MMK_WALLET_RESTRICTED' ? 403 : 400);
    res.status(status).json({
      error: err.message || 'MMK withdrawal failed',
      code: err.code,
      required_mmk: err.required_mmk,
      available_mmk: err.available_mmk,
    });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const [usdtRows, mmkRows] = await Promise.all([
      UsdtWithdrawal.findByUserId(req.user.id, { limit }),
      MmkWithdrawal.findByUserId(req.user.id, { limit }),
    ]);
    res.json({
      withdrawals: usdtRows.map(mapUsdtWithdrawal),
      usdt_withdrawals: usdtRows.map(mapUsdtWithdrawal),
      mmk_withdrawals: mmkRows.map(mapMmkWithdrawal),
    });
  } catch (err) {
    console.error('[withdrawal/history GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
