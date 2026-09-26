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
const {
  handleBitnobCardWebhook,
} = require('../services/bitnobCardWebhookService');

const router = express.Router();

/**
 * Binance Pay webhook — notify on PAY_SUCCESS and credit user wallet (net after fee).
 * Responds with Binance-required { returnCode: "SUCCESS" }.
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
 * Bitnob virtual-card webhooks (create / fund async outcomes).
 * Verify HMAC-SHA512(raw body) vs x-bitnob-signature, then update cards_v2.
 * Register: BITNOB_CARD_WEBHOOK_URL=https://YOUR_DOMAIN/api/webhook/bitnob/cards
 */
router.post('/bitnob/cards', async (req, res) => {
  try {
    const result = await handleBitnobCardWebhook(req);
    console.log('[webhook/bitnob/cards]', result.event || result.reason || 'ok', {
      duplicate: result.duplicate,
      unmatched: result.unmatched,
      card_id: result.card_id,
    });
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    const code = err.code || 'BITNOB_WEBHOOK_ERROR';
    const status = err.status
      || (code === 'BITNOB_WEBHOOK_INVALID_SIGNATURE' ? 401
        : code === 'BITNOB_WEBHOOK_NOT_CONFIGURED' ? 503
          : 500);
    console.error('[webhook/bitnob/cards]', err.message, code);
    return res.status(status).json({
      received: false,
      error: err.message || 'Webhook error',
      code,
    });
  }
});

module.exports = router;
