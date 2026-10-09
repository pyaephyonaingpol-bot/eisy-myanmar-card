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

/**
 * Telegram support webhook.
 * Live URL: https://eisymyanmar.com/api/webhook/telegram
 * setWebhook must use that HTTPS path. A GET/HEAD probe has to return HTTP 200
 * or Telegram answers { ok: false }.
 * Optional: TELEGRAM_WEBHOOK_SECRET via header x-telegram-bot-api-secret-token.
 * Empty probes are accepted without the secret so registration can succeed.
 */
function readTelegramBody(req) {
  const body = req.body;
  const hasObject = body
    && typeof body === 'object'
    && !Buffer.isBuffer(body)
    && !Array.isArray(body)
    && Object.keys(body).length > 0;
  if (hasObject) return body;
  if (typeof body === 'string' && body.trim()) return body;
  if (Buffer.isBuffer(req.rawBodyBuffer) && req.rawBodyBuffer.length) return req.rawBodyBuffer;
  if (typeof req.rawBody === 'string' && req.rawBody.trim()) return req.rawBody;
  if (Buffer.isBuffer(body)) return body;
  return body && typeof body === 'object' ? body : {};
}

function telegramWebhookInfo() {
  const { canonicalTelegramWebhookUrl } = require('../services/supportTelegramService');
  return {
    ok: true,
    service: 'telegram-support-webhook',
    method: 'POST',
    path: '/api/webhook/telegram',
    url: canonicalTelegramWebhookUrl(),
  };
}

router.get('/telegram', (_req, res) => {
  res.json(telegramWebhookInfo());
});

router.head('/telegram', (_req, res) => {
  res.status(200).end();
});

router.post('/telegram', async (req, res) => {
  try {
    const {
      handleTelegramUpdate,
      parseTelegramWebhookPayload,
      isWebhookSecret,
    } = require('../services/supportTelegramService');
    const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    const header = req.get('x-telegram-bot-api-secret-token') || '';
    const raw = readTelegramBody(req);
    const parsed = parseTelegramWebhookPayload(raw);
    const isProbe = !parsed.message && (parsed.update == null || parsed.update.update_id == null);
    if (isWebhookSecret(secret) && header !== secret && !isProbe) {
      return res.status(401).json({ ok: false, error: 'Invalid webhook secret' });
    }

    const result = await handleTelegramUpdate(parsed.update || {});
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('[webhook/telegram]', err.message);
    // HTTP 200 so Telegram does not report setWebhook ok:false or retry forever.
    return res.status(200).json({ ok: true, received: true, error: err.message });
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

function depositWebhookUnauthorized(req) {
  const secret = process.env.DEPOSIT_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const header = req.get('x-deposit-webhook-secret') || '';
  return header !== secret;
}

function chainVerifier() {
  const { verifyUsdtTransaction } = require('../services/usdtBlockchainService');
  return (params) => verifyUsdtTransaction({
    network: params.network,
    txHash: params.txHash,
    expectedAddress: params.expectedAddress,
    expectedAmountUsdt: params.expectedAmountUsdt,
  });
}

function depositCreditResponse(result) {
  return {
    ok: true,
    credited: result.credited,
    alreadyVerified: result.alreadyVerified,
    balance_usdt: result.balance_usdt,
    net_usdt: result.net_usdt ?? null,
    fee_usdt: result.fee_usdt ?? null,
    deposit_id: result.deposit?.id ?? null,
    ref_code: result.deposit?.ref_code ?? null,
  };
}

/**
 * Incoming USDT deposit webhook.
 * Register: https://YOUR_DOMAIN/api/webhook/deposit
 * TronGrid-style bodies are accepted: transaction_id, to, value, token_info.
 * Optional secret: DEPOSIT_WEBHOOK_SECRET via header x-deposit-webhook-secret.
 * The transfer is always checked on-chain. Body flags cannot skip that check.
 * A confirmed transfer credits the custodial-address owner once (net after fee).
 */
router.post('/deposit', async (req, res) => {
  try {
    if (depositWebhookUnauthorized(req)) {
      return res.status(401).json({
        ok: false,
        credited: false,
        error: 'Invalid webhook secret',
        code: 'DEPOSIT_WEBHOOK_UNAUTHORIZED',
      });
    }

    const { parseTronDepositNotices, creditDepositNotice } = require('../services/hdDepositCreditService');
    const notices = parseTronDepositNotices(req.body || {});
    if (!notices.length) {
      return res.status(400).json({
        ok: false,
        credited: false,
        error: 'tx_hash is required',
        code: 'MISSING_TX_HASH',
      });
    }

    const verifyTransfer = chainVerifier();
    if (notices.length === 1) {
      const result = await creditDepositNotice(notices[0], { verifyTransfer });
      return res.status(200).json(depositCreditResponse(result));
    }

    const results = [];
    for (const notice of notices) {
      try {
        const result = await creditDepositNotice(notice, { verifyTransfer });
        results.push({ tx_hash: notice.txHash, ...depositCreditResponse(result) });
      } catch (err) {
        results.push({
          ok: false,
          tx_hash: notice.txHash,
          credited: false,
          error: err.message || 'Deposit webhook failed',
          code: err.code || 'DEPOSIT_WEBHOOK_ERROR',
        });
      }
    }
    const credited = results.filter((row) => row.credited).length;
    return res.status(200).json({
      ok: true,
      credited: credited > 0,
      count: results.length,
      results,
    });
  } catch (err) {
    const code = err.code || 'DEPOSIT_WEBHOOK_ERROR';
    const status = err.status
      || (code === 'DEPOSIT_WEBHOOK_UNAUTHORIZED' ? 401 : 400);
    console.error('[webhook/deposit]', err.message, code);
    return res.status(status).json({
      ok: false,
      credited: false,
      error: err.message || 'Deposit webhook failed',
      code,
    });
  }
});

/**
 * Tron push webhook. Same credit path as /api/webhook/deposit.
 * Register: https://YOUR_DOMAIN/api/webhook/tron
 * On-chain verification is required. DEPOSIT_WEBHOOK_SECRET is not required
 * here so a TronGrid callback can post; set TRON_WEBHOOK_SECRET to require
 * header x-tron-webhook-secret.
 */
router.post('/tron', async (req, res) => {
  try {
    const secret = String(process.env.TRON_WEBHOOK_SECRET || '').trim();
    if (secret) {
      const header = req.get('x-tron-webhook-secret') || '';
      if (header !== secret) {
        return res.status(401).json({
          ok: false,
          credited: false,
          error: 'Invalid webhook secret',
          code: 'TRON_WEBHOOK_UNAUTHORIZED',
        });
      }
    }

    const { parseTronDepositNotices, creditDepositNotice } = require('../services/hdDepositCreditService');
    const notices = parseTronDepositNotices(req.body || {});
    if (!notices.length) {
      return res.status(200).json({
        ok: true,
        credited: false,
        ignored: true,
        reason: 'no_usdt_transfer',
      });
    }

    const verifyTransfer = chainVerifier();
    const results = [];
    for (const notice of notices) {
      try {
        const result = await creditDepositNotice(notice, { verifyTransfer });
        results.push({ tx_hash: notice.txHash, ...depositCreditResponse(result) });
      } catch (err) {
        results.push({
          ok: false,
          tx_hash: notice.txHash,
          credited: false,
          error: err.message || 'Deposit webhook failed',
          code: err.code || 'DEPOSIT_WEBHOOK_ERROR',
        });
      }
    }
    const credited = results.filter((row) => row.credited).length;
    return res.status(200).json({
      ok: true,
      credited: credited > 0,
      count: results.length,
      results: results.length === 1 ? undefined : results,
      ...(results.length === 1 ? results[0] : {}),
    });
  } catch (err) {
    console.error('[webhook/tron]', err.message, err.code || '');
    return res.status(200).json({
      ok: false,
      received: true,
      credited: false,
      error: err.message || 'Tron webhook failed',
      code: err.code || 'TRON_WEBHOOK_ERROR',
    });
  }
});

module.exports = router;
