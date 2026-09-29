const express = require('express');
const crypto = require('crypto');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const {
  createKripicardCryptoDeposit,
  findOrderByOrderId,
  pollPendingKripicardDeposits,
} = require('../services/kripicardDepositService');

const router = express.Router();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * POST /api/tron/orders/check/pending
 * Poll Kripicard deposit status for pending Master Wallet top-ups.
 */
router.post('/check/pending', async (req, res) => {
  const expected = String(process.env.DEPOSIT_LISTENER_SECRET || '').trim();
  const provided = String(
    req.headers['x-deposit-listener-secret']
    || req.headers['x-listener-secret']
    || ''
  ).trim();

  if (expected && provided && timingSafeEqualString(provided, expected)) {
    try {
      const result = await pollPendingKripicardDeposits();
      return res.json({ success: true, provider: 'kripicard', ...result });
    } catch (err) {
      console.error('[tron/orders/check]', err.message);
      return res.status(500).json({
        success: false,
        error: err.message || 'Kripicard deposit verification failed',
        code: err.code,
      });
    }
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized',
    code: 'LISTENER_UNAUTHORIZED',
  });
});

/**
 * POST /api/tron/orders
 * Create a Kripicard crypto deposit (unique pay-to address + exact amount).
 * Kept under /api/tron/orders for Instant portal compatibility.
 * Body: { amount_usdt | amount, network?, order_id? }
 */
router.post('/', requireAuth, requireSensitive, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await createKripicardCryptoDeposit(req.user.id, {
      amount_usdt: body.amount_usdt ?? body.amount,
      network: body.network || body.kripicard_network || 'tron',
      currency: body.currency || 'USDT',
      order_id: body.order_id || null,
    });
    return res.status(201).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[tron/orders POST]', err.message, err.code || '');
    const status = err.code === 'KRIPICARD_NOT_CONFIGURED'
      ? 503
      : ([
        'KRIPICARD_DEPOSIT_INVALID_AMOUNT',
        'KRIPICARD_DEPOSIT_AMOUNT_TOO_LOW',
        'KRIPICARD_API_ERROR',
        'INVALID_AMOUNT',
      ].includes(err.code) ? 400 : 500);
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to create Kripicard deposit',
      code: err.code,
    });
  }
});

/**
 * GET /api/tron/orders/:orderId
 * Fetch order status (polls Kripicard deposits/status when still pending).
 */
router.get('/:orderId', requireAuth, async (req, res) => {
  try {
    const order = await findOrderByOrderId(req.params.orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        code: 'TRON_ORDER_NOT_FOUND',
      });
    }
    if (order.user_id != null && Number(order.user_id) !== Number(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        code: 'TRON_ORDER_FORBIDDEN',
      });
    }
    return res.json({ success: true, order, provider: 'kripicard' });
  } catch (err) {
    console.error('[tron/orders GET]', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to load order',
    });
  }
});

module.exports = router;
