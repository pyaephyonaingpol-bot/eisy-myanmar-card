/**
 * Per-user TRON wallet API — address, deposits, withdraw.
 *
 * Mounted at /api/tron/wallet
 */
const express = require('express');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const { requireWithdrawalsEnabled } = require('../middleware/withdrawalGuard');
const {
  generateUserDepositAddress,
  getTronWalletSummary,
  createDepositIntent,
  getDepositIntent,
  creditDetectedDeposits,
  withdrawFromMasterWallet,
} = require('../services/tronWalletService');
const { getFixedWithdrawFeeUsdt } = require('../services/withdrawCryptoService');

const router = express.Router();

/** GET /api/tron/wallet — address + internal balances */
router.get('/', requireAuth, requireSensitive, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const summary = await getTronWalletSummary(req.user.id);
    res.json({ success: true, ...summary });
  } catch (err) {
    console.error('[tron/wallet GET]', err.message);
    res.status(err.code === 'USER_NOT_FOUND' ? 404 : 500).json({
      success: false,
      error: err.message || 'Failed to load TRON wallet',
      code: err.code || 'TRON_WALLET_ERROR',
    });
  }
});

/** GET /api/tron/wallet/address — ensure unique TRC-20 deposit address */
router.get('/address', requireAuth, async (req, res) => {
  try {
    const address = await generateUserDepositAddress(req.user.id);
    res.json({ success: true, ...address });
  } catch (err) {
    console.error('[tron/wallet/address GET]', err.message);
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to resolve deposit address',
      code: err.code || 'TRON_ADDRESS_ERROR',
    });
  }
});

/** POST /api/tron/wallet/address — generate / refresh unique TRC-20 deposit address */
router.post('/address', requireAuth, async (req, res) => {
  try {
    const address = await generateUserDepositAddress(req.user.id);
    res.status(address.created ? 201 : 200).json({ success: true, ...address });
  } catch (err) {
    console.error('[tron/wallet/address POST]', err.message);
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to generate deposit address',
      code: err.code || 'TRON_ADDRESS_ERROR',
    });
  }
});

/**
 * POST /api/tron/wallet/deposits
 * Body: { amount_usdt }
 * Creates a deposit intent bound to the user's unique address.
 */
router.post('/deposits', requireAuth, requireSensitive, async (req, res) => {
  try {
    const result = await createDepositIntent(req.user.id, req.body || {});
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('[tron/wallet/deposits POST]', err.message, err.code || '');
    const status = [
      'TRON_ORDER_INVALID_AMOUNT',
      'TRON_ORDER_AMOUNT_TOO_LOW',
      'TRON_ORDER_USER_REQUIRED',
      'TRON_HD_NOT_CONFIGURED',
      'TRON_DEPOSIT_ADDRESS_MISSING',
    ].includes(err.code) ? 400
      : err.code === 'SUPABASE_NOT_CONFIGURED' ? 503
        : 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Failed to create deposit',
      code: err.code || 'TRON_DEPOSIT_ERROR',
    });
  }
});

/** GET /api/tron/wallet/deposits/:orderId */
router.get('/deposits/:orderId', requireAuth, async (req, res) => {
  try {
    const order = await getDepositIntent(req.params.orderId, req.user.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found', code: 'TRON_ORDER_NOT_FOUND' });
    }
    res.json({ success: true, order });
  } catch (err) {
    const status = err.code === 'TRON_ORDER_NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Failed to load deposit',
      code: err.code || 'TRON_DEPOSIT_ERROR',
    });
  }
});

/**
 * POST /api/tron/wallet/withdraw
 * Body: { toAddress | customerAddress, amountUsdt | withdrawAmount }
 * Debits internal balance; sends USDT from master wallet.
 */
router.post('/withdraw', requireAuth, requireSensitive, requireWithdrawalsEnabled, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await withdrawFromMasterWallet(req.user.id, {
      toAddress: body.toAddress || body.to_address || body.customerAddress || body.customer_address,
      amountUsdt: body.amountUsdt ?? body.amount_usdt ?? body.withdrawAmount ?? body.withdraw_amount,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[tron/wallet/withdraw]', err.message, err.code || '');
    const status = (() => {
      if (err.code === 'SENSITIVE_AUTH_REQUIRED') return 401;
      if ([
        'WITHDRAW_ADDRESS_REQUIRED',
        'WITHDRAW_ADDRESS_INVALID',
        'WITHDRAW_AMOUNT_INVALID',
        'WITHDRAW_AMOUNT_TOO_LOW',
        'WITHDRAW_NET_INVALID',
        'INVALID_DESTINATION',
        'INSUFFICIENT_USDT',
        'INSUFFICIENT_BALANCE',
        'INSUFFICIENT_FUNDS',
      ].includes(err.code)) return 400;
      if (['MASTER_KEY_MISSING', 'MASTER_KEY_INVALID', 'MASTER_ADDRESS_INVALID'].includes(err.code)) {
        return 503;
      }
      return err.status && Number.isFinite(err.status) ? err.status : 500;
    })();
    res.status(status).json({
      success: false,
      error: err.message || 'Withdrawal failed',
      code: err.code || 'WITHDRAW_FAILED',
      feeCollected: getFixedWithdrawFeeUsdt(),
    });
  }
});

/**
 * POST /api/tron/wallet/sync-deposits
 * Worker hook: poll unique addresses and credit internal wallets.
 * Auth: DEPOSIT_LISTENER_SECRET (same as /api/tron/orders/check/pending).
 */
router.post('/sync-deposits', async (req, res) => {
  const expected = String(process.env.DEPOSIT_LISTENER_SECRET || '').trim();
  const provided = String(
    req.get('X-Deposit-Listener-Secret')
    || req.get('x-deposit-listener-secret')
    || req.body?.secret
    || ''
  ).trim();

  if (!expected || provided !== expected) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'DEPOSIT_LISTENER_UNAUTHORIZED',
    });
  }

  try {
    const result = await creditDetectedDeposits();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[tron/wallet/sync-deposits]', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Deposit sync failed',
      code: err.code || 'TRON_SYNC_FAILED',
    });
  }
});

module.exports = router;
