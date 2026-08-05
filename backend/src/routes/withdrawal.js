const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const { getWithdrawalFeeSettings, calculateWithdrawalBreakdown } = require('../services/settingsService');
const { createUsdtWithdrawalRequest } = require('../services/withdrawalService');
const UsdtWithdrawal = require('../models/UsdtWithdrawal');
const { walletPayload } = require('../services/walletService');
const User = require('../models/User');

const router = express.Router();

router.get('/fees', requireAuth, async (_req, res) => {
  try {
    const settings = await getWithdrawalFeeSettings();
    res.json({
      fees: settings,
      networks: [
        {
          network: 'TRC20',
          label: 'TRC20 (TRON Network)',
          fee: settings.usdt_withdraw_fee_trc20,
          fee_type: settings.usdt_withdraw_fee_trc20_type,
          fee_label: settings.usdt_withdraw_fee_trc20_type === 'percent'
            ? `${settings.usdt_withdraw_fee_trc20}%`
            : `${settings.usdt_withdraw_fee_trc20.toFixed(2)} USDT`,
        },
        {
          network: 'BEP20',
          label: 'BEP20 (BSC Network)',
          fee: settings.usdt_withdraw_fee_bep20,
          fee_type: settings.usdt_withdraw_fee_bep20_type,
          fee_label: settings.usdt_withdraw_fee_bep20_type === 'percent'
            ? `${settings.usdt_withdraw_fee_bep20}%`
            : `${settings.usdt_withdraw_fee_bep20.toFixed(2)} USDT`,
        },
      ],
      minimum_usdt_withdrawal: settings.minimum_usdt_withdrawal,
    });
  } catch (err) {
    console.error('[withdrawal/fees GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/preview', requireAuth, async (req, res) => {
  try {
    const settings = await getWithdrawalFeeSettings();
    const network = String(req.body.network || 'TRC20').toUpperCase();
    const amount = parseFloat(req.body.amount_usdt);
    const breakdown = calculateWithdrawalBreakdown(amount, network, settings);
    res.json({ breakdown, settings });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid preview request' });
  }
});

router.post('/usdt', requireAuth, requireSensitive, async (req, res) => {
  try {
    const result = await createUsdtWithdrawalRequest(req.user.id, req.body || {});
    const user = await User.findById(req.user.id);
    res.status(201).json({
      success: true,
      ref_code: result.withdrawal.ref_code,
      withdrawal: {
        id: result.withdrawal.id,
        ref_code: result.withdrawal.ref_code,
        network: result.withdrawal.network,
        wallet_address: result.withdrawal.wallet_address,
        amount_usdt: result.withdrawal.amount_usdt,
        fee_usdt: result.withdrawal.fee_usdt,
        net_usdt: result.withdrawal.net_usdt,
        status: result.withdrawal.status,
        created_at: result.withdrawal.created_at,
      },
      breakdown: result.breakdown,
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

router.get('/history', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const rows = await UsdtWithdrawal.findByUserId(req.user.id, { limit });
    res.json({ withdrawals: rows });
  } catch (err) {
    console.error('[withdrawal/history GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
