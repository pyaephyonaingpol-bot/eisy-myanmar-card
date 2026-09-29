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
  handleKripicardPaymentWebhook,
} = require('../services/kripicardPaymentCollectionService');

const router = express.Router();

/**
 * Kripicard payment-collection webhooks → verify + credit Master Wallet (balance_usdt).
 * Register: KRIPICARD_WEBHOOK_URL=https://YOUR_DOMAIN/api/webhook/kripicard/collections
 */
async function kripicardPaymentWebhookHandler(req, res) {
  try {
    const result = await handleKripicardPaymentWebhook(req);
    console.log('[webhook/kripicard]', result.message || result.status || 'ok', {
      credited: result.credited,
      alreadyVerified: result.alreadyVerified,
      ignored: result.ignored,
      event_id: result.event_id,
      collection_id: result.collection_id,
    });
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    const code = err.code || 'KRIPICARD_WEBHOOK_ERROR';
    console.error('[webhook/kripicard]', err.message, code);

    if (code === 'KRIPICARD_WEBHOOK_INVALID_SIGNATURE') {
      return res.status(401).json({
        received: false,
        error: err.message || 'Invalid signature',
        code,
      });
    }
    if (code === 'KRIPICARD_WEBHOOK_NOT_CONFIGURED') {
      return res.status(503).json({
        received: false,
        error: err.message || 'Webhook not configured',
        code,
      });
    }
    if (code === 'DEPOSIT_NOT_FOUND') {
      // ACK so provider does not retry forever for unknown refs.
      return res.status(200).json({
        received: true,
        unmatched: true,
        error: err.message,
        code,
      });
    }
    if (code === 'KRIPICARD_AMOUNT_MISMATCH' || code === 'KRIPICARD_COLLECTION_UNPAID') {
      return res.status(err.status || 409).json({
        received: false,
        error: err.message,
        code,
      });
    }
    return res.status(err.status || 500).json({
      received: false,
      error: err.message || 'Webhook error',
      code,
    });
  }
}

router.post('/kripicard', kripicardPaymentWebhookHandler);
router.post('/kripicard/collections', kripicardPaymentWebhookHandler);
router.post('/kripicard/payments', kripicardPaymentWebhookHandler);

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

module.exports = router;
