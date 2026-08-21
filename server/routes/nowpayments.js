/**
 * NOWPayments routes — IPN webhook + payment creation.
 *
 * Mount:
 *   POST /api/nowpayments/webhook
 *   POST /api/create-payment (registered separately in backend/src/index.js)
 */
const express = require('express');
const {
  handleNowPaymentsWebhook,
  createNowPaymentsPayment,
} = require('../../backend/src/services/nowPaymentsService');

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

/**
 * NOWPayments IPN webhook.
 * Verifies x-nowpayments-sig, credits the matching local deposit, and
 * optionally updates a Supabase transactions row when configured.
 */
router.post('/webhook', async (req, res) => {
  try {
    const result = await handleNowPaymentsWebhook(req);
    console.log('[nowpayments/webhook]', result.message || 'ok', {
      payment_id: result.payment_id,
      finished: result.finished,
      ignored: result.ignored,
      alreadyFinished: result.alreadyFinished,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
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
});

module.exports = router;
module.exports.createPaymentHandler = createPaymentHandler;
