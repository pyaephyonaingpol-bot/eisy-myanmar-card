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

/**
 * Bitnob stablecoin / address deposit webhooks.
 * Credits Standard Card ledger (balance_bitnob_usdt) — never Master Wallet.
 * Register: BITNOB_DEPOSIT_WEBHOOK_URL=https://YOUR_DOMAIN/api/webhook/bitnob/deposits
 */
router.post('/bitnob/deposits', async (req, res) => {
  try {
    const {
      creditStandardWalletFromDeposit,
      findUserIdByBitnobDepositAddress,
    } = require('../services/bitnobWalletService');
    const { verifyBitnobWebhookSignature } = require('../services/bitnobCardWebhookService');

    // Reuse card webhook HMAC when a secret is configured.
    if (typeof verifyBitnobWebhookSignature === 'function') {
      try {
        verifyBitnobWebhookSignature(req);
      } catch (sigErr) {
        // Some deployments share one secret; if helper throws, surface 401.
        if (sigErr.code === 'BITNOB_WEBHOOK_INVALID_SIGNATURE') {
          return res.status(401).json({ received: false, error: sigErr.message, code: sigErr.code });
        }
        // If not configured, continue (same pattern as optional secrets).
        if (sigErr.code !== 'BITNOB_WEBHOOK_NOT_CONFIGURED') throw sigErr;
      }
    }

    const body = req.body || {};
    const data = body.data && typeof body.data === 'object' ? body.data : body;
    const address = String(
      data.address || data.deposit_address || data.to_address || data.toAddress || ''
    ).trim();
    const amountRaw = data.amount_usdt ?? data.amount ?? data.value ?? data.amountUsd;
    let amountUsdt = Number(amountRaw);
    // Bitnob often sends micro-units for USD-ish stables (1e6 = $1).
    if (Number.isFinite(amountUsdt) && amountUsdt >= 1000 && !data.amount_usdt && !data.amountUsd) {
      amountUsdt = amountUsdt / 1e6;
    }
    const eventId = String(
      data.id || data.event_id || data.reference || data.tx_hash || data.txHash || body.id || ''
    ).trim();
    const txHash = String(data.tx_hash || data.txHash || data.hash || '').trim() || null;
    const chain = String(data.chain || data.network || '').trim() || null;

    let userId = data.eisy_user_id || data.user_id || null;
    if (!userId && address) {
      userId = await findUserIdByBitnobDepositAddress(address);
    }
    if (!userId) {
      console.warn('[webhook/bitnob/deposits] unmatched address', address || '(none)');
      return res.status(200).json({ received: true, unmatched: true, address: address || null });
    }
    if (!Number.isFinite(amountUsdt) || amountUsdt <= 0) {
      return res.status(200).json({ received: true, ignored: true, reason: 'invalid_amount' });
    }

    const result = await creditStandardWalletFromDeposit(userId, {
      amountUsdt,
      eventId: eventId || `dep-${userId}-${Date.now()}`,
      address,
      chain,
      txHash,
      rawPayload: body,
      createdBy: 'bitnob_deposit_webhook',
    });

    console.log('[webhook/bitnob/deposits]', {
      user_id: userId,
      amount_usdt: amountUsdt,
      already_credited: result.already_credited,
    });
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    console.error('[webhook/bitnob/deposits]', err.message, err.code || '');
    return res.status(500).json({
      received: false,
      error: err.message || 'Webhook error',
      code: err.code || 'BITNOB_DEPOSIT_WEBHOOK_ERROR',
    });
  }
});

module.exports = router;
