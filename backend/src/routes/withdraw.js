/**
 * POST /api/withdraw — automated TRC20 USDT withdrawal (master wallet, manual energy).
 *
 * Body: { customerAddress, withdrawAmount }
 * Fee: fixed 2.0 USDT → Net Payout = withdrawAmount - 2.0
 */
const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const {
  calculateFixedFeeWithdraw,
  executeFixedFeeTrc20Withdraw,
  getFixedWithdrawFeeUsdt,
} = require('../services/withdrawCryptoService');
const { walletPayload } = require('../services/walletService');
const User = require('../models/User');

const router = express.Router();

router.post('/', requireAuth, requireSensitive, async (req, res) => {
  try {
    const customerAddress = req.body?.customerAddress ?? req.body?.customer_address;
    const withdrawAmount = req.body?.withdrawAmount ?? req.body?.withdraw_amount ?? req.body?.amount_usdt;

    // Cheap validation pass so clients get 400 before wallet debit.
    calculateFixedFeeWithdraw({ customerAddress, withdrawAmount });

    const result = await executeFixedFeeTrc20Withdraw(req.user.id, {
      customerAddress,
      withdrawAmount,
    });

    const user = await User.findById(req.user.id);
    return res.status(200).json({
      success: true,
      message: result.message,
      txId: result.txId,
      feeCollected: result.fee_collected,
      netPayout: result.netPayout,
      withdrawAmount: result.withdrawAmount,
      customerAddress: result.customerAddress,
      network: result.network,
      token: result.token,
      fromAddress: result.fromAddress,
      withdrawal: result.withdrawal,
      wallet: walletPayload(user),
      fee: {
        type: 'fixed',
        amount_usdt: getFixedWithdrawFeeUsdt(),
      },
    });
  } catch (err) {
    console.error('[withdraw POST]', err.message, err.code || '');
    const status = (() => {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') return 401;
      if ([
        'WITHDRAW_ADDRESS_REQUIRED',
        'WITHDRAW_ADDRESS_INVALID',
        'WITHDRAW_AMOUNT_INVALID',
        'WITHDRAW_AMOUNT_TOO_LOW',
        'WITHDRAW_NET_INVALID',
        'INVALID_DESTINATION',
      ].includes(err.code)) {
        return 400;
      }
      if (['INSUFFICIENT_USDT', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_FUNDS'].includes(err.code)) {
        return 400;
      }
      if (['MASTER_KEY_MISSING', 'MASTER_KEY_INVALID', 'MASTER_ADDRESS_INVALID'].includes(err.code)) {
        return 503;
      }
      return 500;
    })();

    return res.status(status).json({
      success: false,
      error: err.message || 'Withdrawal failed',
      code: err.code || 'WITHDRAW_FAILED',
      feeCollected: getFixedWithdrawFeeUsdt(),
    });
  }
});

module.exports = router;
