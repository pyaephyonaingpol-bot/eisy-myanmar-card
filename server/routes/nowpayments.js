/**
 * NOWPayments routes — IPN webhook for crypto payment notifications.
 *
 * Mount: POST /api/nowpayments/webhook
 * Register this URL in NOWPayments dashboard → IPN callback URL.
 */
const express = require('express');
const { handleNowPaymentsWebhook } = require('../../backend/src/services/nowPaymentsService');

const router = express.Router();

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
