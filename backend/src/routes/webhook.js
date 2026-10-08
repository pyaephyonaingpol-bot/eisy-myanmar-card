const express = require('express');
const {
  handleBinancePayWebhook,
} = require('../services/binanceDepositService');
const {
  webhookSuccessResponse,
  webhookFailureResponse,
} = require('../services/binancePayService');
const {
  handleStripeWebhook,
} = require('../services/stripeWebhookService');
const router = express.Router();

/**
 * Binance Pay webhook — notify on PAY_SUCCESS and credit user wallet (net after fee).
 * Responds with Binance-required { returnCode: "SUCCESS" }.
 * @deprecated New deposits use the per-user TRON HD address.
 */
router.post('/binance', async (req, res) => {
  try {
    const result = await handleBinancePayWebhook(req);
    console.log('[webhook/binance]', result.message || result.bizStatus || 'ok', {
      credited: result.credited,
      alreadyVerified: result.alreadyVerified,
      ignored: result.ignored,
    });
    return res.json(webhookSuccessResponse());
  } catch (err) {
    console.error('[webhook/binance]', err.message, err.code || '');
    // Always ACK with SUCCESS for unknown deposits to avoid endless retries when we choose;
    // return FAIL only for signature failures so Binance retries.
    if (err.code === 'BINANCE_WEBHOOK_INVALID_SIGNATURE') {
      return res.status(401).json(webhookFailureResponse('INVALID_SIGNATURE'));
    }
    if (err.code === 'DEPOSIT_NOT_FOUND') {
      return res.json(webhookSuccessResponse());
    }
    return res.status(500).json(webhookFailureResponse(err.message || 'FAIL'));
  }
});

/**
 * Stripe webhook — signature verified via stripe.webhooks.constructEvent + whsec_...
 * Unverified / forged requests are rejected with 401.
 * Register in Stripe Dashboard: https://YOUR_DOMAIN/api/webhook/stripe
 */
router.post('/stripe', async (req, res) => {
  try {
    const result = await handleStripeWebhook(req);
    return res.status(200).json({ received: true, id: result.id, type: result.type });
  } catch (err) {
    const code = err.code || 'STRIPE_WEBHOOK_ERROR';
    const status = err.status || (code === 'STRIPE_WEBHOOK_INVALID_SIGNATURE' ? 401 : 500);
    console.error('[webhook/stripe]', err.message, code);
    return res.status(status).json({
      error: err.message || 'Webhook error',
      code,
      received: false,
    });
  }
});

router.post('/telegram', async (req, res) => {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
    if (secret) {
      const header = req.get('x-telegram-bot-api-secret-token') || '';
      if (header !== secret) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }
    }

    const { handleTelegramUpdate } = require('../services/supportTelegramService');
    const result = await handleTelegramUpdate(req.body || {});
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('[webhook/telegram]', err.message);
    // Always ACK so Telegram does not retry endlessly on app bugs.
    return res.json({ ok: false, error: err.message });
  }
});

/**
 * Pagocards webhook — 3DS OTP / card events.
 * Register: https://YOUR_DOMAIN/api/webhook/pagocards
 * Optional: PAGO_CARD_WEBHOOK_SECRET via header x-pago-webhook-secret.
 */
router.post('/pagocards', async (req, res) => {
  try {
    const { handlePagocardsWebhook } = require('../services/pago3dsWebhookService');
    const result = await handlePagocardsWebhook(req.body || {}, req);
    return res.status(200).json({
      ok: true,
      received: true,
      eventId: result.event?.eventId || null,
      eventType: result.event?.eventType || null,
      is3ds: Boolean(result.event?.is3ds),
      hasOtp: Boolean(result.event?.otp),
      // Echo otp so operators can confirm extraction in Pagocards delivery logs.
      // Dashboard still loads codes from pago_3ds_events via /api/user/cards/:id/3ds.
      otp: result.event?.otp || null,
      cardId: result.event?.cardId || null,
      cardStatus: result.event?.localStatus || null,
      pagoStatus: result.event?.cardStatus || null,
      cardUpdated: Boolean(result.cardUpdated),
      linked: Boolean(result.row?.user_id && result.row?.local_card_id),
      saved: result.saved,
      duplicate: result.duplicate,
      ignored: Boolean(result.ignored),
      id: result.row?.id ?? null,
    });
  } catch (err) {
    const status = err.status || (err.code === 'PAGO_WEBHOOK_UNAUTHORIZED' ? 401 : 500);
    console.error('[webhook/pagocards]', err.message, err.code || '');
    if (status === 401) {
      return res.status(401).json({
        ok: false,
        error: err.message || 'Unauthorized',
        code: err.code || 'PAGO_WEBHOOK_UNAUTHORIZED',
      });
    }
    // ACK most failures so Pagocards does not hammer retries on app bugs.
    return res.status(200).json({
      ok: false,
      received: true,
      error: err.message || 'Webhook error',
      code: err.code || 'PAGO_WEBHOOK_ERROR',
    });
  }
});

router.get('/pagocards', (_req, res) => {
  res.json({
    ok: true,
    service: 'pagocards-webhook',
    accepts: ['3ds', 'card_status'],
    path: '/api/webhook/pagocards',
  });
});

module.exports = router;
