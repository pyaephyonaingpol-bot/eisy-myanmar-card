/**
 * NOWPayments routes — IPN webhook + payment creation + USDT payouts.
 *
 * Mount:
 *   POST /api/nowpayments/webhook
 *   POST /api/nowpayments/payout-webhook
 *   POST /api/nowpayments/payout
 *   POST /api/create-payment (registered separately in backend/src/index.js)
 */
const express = require('express');
const {
  handleNowPaymentsWebhook,
  createNowPaymentsPayment,
} = require('../../backend/src/services/nowPaymentsService');
const {
  handleNowPaymentsPayoutWebhook,
  triggerNowPaymentsPayoutForWithdrawal,
  isNowPaymentsPayoutsEnabled,
} = require('../../backend/src/services/nowPaymentsPayoutService');
const UsdtWithdrawal = require('../../backend/src/models/UsdtWithdrawal');
const { requireAuth, requireSensitive } = require('../../backend/src/middleware/auth');

const router = express.Router();

/**
 * POST /api/create-payment (mounted in backend/src/index.js)
 * Create NOWPayments invoice, save pending local deposit, return checkout URL.
 * Supabase dual-write is optional and is not required for checkout.
 * Body: { amount_usdt | amount, success_url?, cancel_url?, order_description? }
 * Invoice pay_currency sent to NOWPayments is always `usdttrc20` (USDT on Tron).
 */
async function createPaymentHandler(req, res) {
  try {
    console.log('[create-payment] Received request from user:', req.user?.id, req.body);
    const result = await createNowPaymentsPayment(req.user.id, req.body || {});
    console.log('[create-payment] Invoice created successfully:', {
      payment_id: result.payment_id,
      order_id: result.order_id,
      invoice_url: result.invoice_url,
      pay_currency: 'usdttrc20',
    });
    return res.status(201).json({
      success: true,
      provider: result.provider,
      message: result.message,
      checkout_url: result.checkout_url,
      invoice_url: result.invoice_url,
      payment_id: result.payment_id,
      order_id: result.order_id,
      ref_code: result.ref_code,
      fee_breakdown: result.fee_breakdown,
      fee_rule: 'Math.max(amount * 0.02, 1)',
      transaction: result.transaction || null,
    });
  } catch (err) {
    console.error('[create-payment] Error creating payment:', err.message, err.code || '', err.nowpayments || '');
    const status = err.code === 'NOWPAYMENTS_NOT_CONFIGURED' || err.code === 'SUPABASE_NOT_CONFIGURED'
      ? 503
      : (err.code === 'NOWPAYMENTS_AMOUNT_TOO_LOW' || err.code === 'PAYMENT_FEE_EXCEEDS_AMOUNT' ? 400 : 400);
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to create NOWPayments checkout',
      code: err.code,
      nowpayments: err.nowpayments || undefined,
    });
  }
}

function sendWebhookResult(res, result) {
  return res.json({ success: true, ...result });
}

function sendWebhookError(res, err) {
  console.error('[nowpayments/webhook]', err.message, err.code || '');
  if (err.code === 'NOWPAYMENTS_INVALID_SIGNATURE') {
    return res.status(401).json({ success: false, error: err.message, code: err.code });
  }
  if (err.code === 'NOWPAYMENTS_INVALID_PAYLOAD') {
    return res.status(400).json({ success: false, error: err.message, code: err.code });
  }
  return res.status(500).json({
    success: false,
    error: err.message || 'NOWPayments webhook failed',
    code: err.code || 'NOWPAYMENTS_WEBHOOK_ERROR',
  });
}

/**
 * NOWPayments IPN webhook (deposits + payouts; payouts detected by payload shape).
 * Verifies x-nowpayments-sig.
 */
router.post('/webhook', async (req, res) => {
  try {
    const result = await handleNowPaymentsWebhook(req);
    console.log('[nowpayments/webhook]', result.message || 'ok', {
      payment_id: result.payment_id,
      payout_id: result.payout_id,
      finished: result.finished,
      ignored: result.ignored,
      alreadyFinished: result.alreadyFinished,
      kind: result.kind,
    });
    return sendWebhookResult(res, result);
  } catch (err) {
    return sendWebhookError(res, err);
  }
});

/**
 * Dedicated payout IPN URL (optional; /webhook also accepts payout payloads).
 */
router.post('/payout-webhook', async (req, res) => {
  try {
    const result = await handleNowPaymentsPayoutWebhook(req);
    console.log('[nowpayments/payout-webhook]', result.message || 'ok', {
      payout_id: result.payout_id,
      withdrawal_id: result.withdrawal_id,
      finished: result.finished,
      failed: result.failed,
    });
    return sendWebhookResult(res, result);
  } catch (err) {
    return sendWebhookError(res, err);
  }
});

/**
 * POST /api/nowpayments/payout
 * Trigger (or retry) a NOWPayments mass payout for an existing crypto USDT withdrawal.
 * Body: { withdrawal_id } — must belong to the authenticated user (or use admin complete).
 */
router.post('/payout', requireAuth, requireSensitive, async (req, res) => {
  try {
    if (!isNowPaymentsPayoutsEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'NOWPayments payouts are not enabled',
        code: 'NOWPAYMENTS_PAYOUTS_DISABLED',
      });
    }

    const withdrawalId = parseInt(req.body?.withdrawal_id ?? req.body?.id, 10);
    if (!Number.isFinite(withdrawalId) || withdrawalId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'withdrawal_id is required',
        code: 'NOWPAYMENTS_PAYOUT_MISSING_ID',
      });
    }

    const row = await UsdtWithdrawal.findById(withdrawalId);
    if (!row || Number(row.user_id) !== Number(req.user.id)) {
      return res.status(404).json({
        success: false,
        error: 'USDT withdrawal not found',
        code: 'WITHDRAWAL_NOT_FOUND',
      });
    }

    const result = await triggerNowPaymentsPayoutForWithdrawal(row, { force: true });
    return res.status(201).json({
      success: true,
      provider: 'nowpayments',
      message: result.message,
      payout_id: result.payout_id,
      nowpayments_withdrawal_id: result.nowpayments_withdrawal_id,
      status: result.status,
      currency: result.currency,
      withdrawal: {
        id: result.withdrawal?.id,
        ref_code: result.withdrawal?.ref_code,
        status: result.withdrawal?.status,
        network: result.withdrawal?.network,
        wallet_address: result.withdrawal?.wallet_address,
        net_usdt: result.withdrawal?.net_usdt,
        nowpayments_payout_id: result.withdrawal?.nowpayments_payout_id,
        tx_hash: result.withdrawal?.tx_hash,
      },
    });
  } catch (err) {
    console.error('[nowpayments/payout]', err.message, err.code || '', err.nowpayments || '');
    const status = err.code === 'NOWPAYMENTS_NOT_CONFIGURED'
      || err.code === 'NOWPAYMENTS_PAYOUT_AUTH_MISSING'
      || err.code === 'NOWPAYMENTS_PAYOUTS_DISABLED'
      ? 503
      : (err.code === 'NOWPAYMENTS_PAYOUT_INVALID_STATUS' ? 409 : 400);
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to create NOWPayments payout',
      code: err.code,
      nowpayments: err.nowpayments || undefined,
    });
  }
});

module.exports = router;
module.exports.createPaymentHandler = createPaymentHandler;
