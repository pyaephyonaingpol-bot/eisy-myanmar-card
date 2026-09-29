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
const {
  handleKripicardDepositWebhook,
} = require('../services/kripicardDepositService');

const router = express.Router();

/**
 * Kripicard Deposit API + payment-collection webhooks.
 * Prefer deposit.completed → Master Wallet credit via Deposit API.
 * Register: KRIPICARD_WEBHOOK_URL=https://YOUR_DOMAIN/api/webhook/kripicard
 */
async function kripicardWebhookHandler(req, res) {
  try {
    const body = req.body || {};
    const eventType = String(
      body.type || body.event || body.event_type || ''
    ).trim().toLowerCase();
    const data = body.data && typeof body.data === 'object' ? body.data : body;
    const looksLikeDeposit = eventType.includes('deposit')
      || Boolean(data.pay_address || data.payAddress)
      || Boolean(data.deposit_id || data.kripicard_deposit_id)
      || (data.network && data.pay_amount);

    const result = looksLikeDeposit
      ? await handleKripicardDepositWebhook(req)
      : await handleKripicardPaymentWebhook(req);

    // If payment-collection handler ignored a deposit-shaped event, try deposit path.
    if (result?.ignored && result.reason === 'not_deposit_event' && !looksLikeDeposit) {
      /* already payment path */
    } else if (result?.ignored && !looksLikeDeposit && eventType.includes('deposit')) {
      const depositResult = await handleKripicardDepositWebhook(req);
      console.log('[webhook/kripicard]', depositResult.message || depositResult.reason || 'ok', {
        credited: depositResult.credited,
        alreadyVerified: depositResult.alreadyVerified,
        ignored: depositResult.ignored,
      });
      return res.status(200).json({ received: true, ...depositResult });
    }

    console.log('[webhook/kripicard]', result.message || result.reason || result.status || 'ok', {
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

router.post('/kripicard', kripicardWebhookHandler);
router.post('/kripicard/collections', kripicardWebhookHandler);
router.post('/kripicard/payments', kripicardWebhookHandler);
router.post('/kripicard/deposits', kripicardWebhookHandler);

/**
 * Binance Pay webhook — notify on PAY_SUCCESS and credit user wallet (net after fee).
 * Responds with Binance-required { returnCode: "SUCCESS" }.
 * @deprecated Prefer Kripicard Deposit API for new deposits.
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
