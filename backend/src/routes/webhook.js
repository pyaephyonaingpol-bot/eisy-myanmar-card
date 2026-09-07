const express = require('express');
const crypto = require('crypto');
const {
  handleBinancePayWebhook,
} = require('../services/binanceDepositService');
const {
  webhookSuccessResponse,
  webhookFailureResponse,
} = require('../services/binancePayService');
const {
  handleTronDepositWebhook,
} = require('../services/tronDepositCreditService');

const router = express.Router();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractTronWebhookSecret(req) {
  return String(
    req.headers['x-tron-webhook-secret']
    || req.headers['x-deposit-listener-secret']
    || req.headers['x-listener-secret']
    || req.query?.secret
    || req.body?.secret
    || ''
  ).trim();
}

function isAuthorizedTronWebhook(req) {
  const provided = extractTronWebhookSecret(req);
  const expected = String(
    process.env.TRON_WEBHOOK_SECRET
    || process.env.DEPOSIT_LISTENER_SECRET
    || ''
  ).trim();

  if (!expected) {
    // Refuse open webhooks in any environment — misconfig must fail closed.
    return false;
  }
  if (!provided) return false;
  return timingSafeEqualString(provided, expected);
}

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
 * TRON USDT (TRC20) deposit webhook — real-time transfer notify.
 * Auth: TRON_WEBHOOK_SECRET or DEPOSIT_LISTENER_SECRET via
 *   X-Tron-Webhook-Secret / X-Deposit-Listener-Secret / body.secret
 *
 * Accepts normalized transfer objects or TronGrid-style event payloads.
 * Poller / cron remains the durable fallback.
 */
router.post('/tron', async (req, res) => {
  if (!isAuthorizedTronWebhook(req)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'TRON_WEBHOOK_UNAUTHORIZED',
    });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    delete body.secret;
    const result = await handleTronDepositWebhook(body, { createdBy: 'tron-indexer' });
    console.log('[webhook/tron]', {
      processed: result.processed,
      completed: result.completed,
      credited: result.credited,
      ignored: result.ignored,
      reason: result.reason,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[webhook/tron]', err.message, err.code || '');
    return res.status(500).json({
      success: false,
      error: err.message || 'TRON webhook failed',
      code: err.code || 'TRON_WEBHOOK_FAILED',
    });
  }
});

module.exports = router;
