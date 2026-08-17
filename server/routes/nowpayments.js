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
 * Create NOWPayments invoice, save pending Supabase transaction, return checkout URL.
 * Body: { amount_usdt | amount, pay_currency?, success_url?, cancel_url?, order_description? }
 */
async function createPaymentHandler(req, res) {
  try {
    const result = await createNowPaymentsPayment(req.user.id, req.body || {});
    return res.status(201).json({
      success: true,
      provider: result.provider,
      message: result.message,
      checkout_url: result.checkout_url,
      invoice_url: result.invoice_url,
      payment_id: result.payment_id,
      order_id: result.order_id,
      fee_breakdown: result.fee_breakdown,
      fee_rule: 'Math.max(amount * 0.02, 1)',
      transaction: result.transaction,
    });
  } catch (err) {
    console.error('[create-payment]', err.message, err.code || '');
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
 * Verifies x-nowpayments-sig, updates Supabase transactions, credits user balance.
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
