const express = require('express');
const crypto = require('crypto');
const { requireAuth, requireSensitive } = require('../middleware/auth');
const {
  createTronOrder,
  findTronOrderByOrderId,
  verifyPendingTronOrders,
} = require('../services/tronOrderService');

const router = express.Router();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * POST /api/tron/orders/check/pending
 * Manual / cron trigger for TronGrid verification (same as background poll).
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
      const result = await verifyPendingTronOrders();
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error('[tron/orders/check]', err.message);
      return res.status(500).json({
        success: false,
        error: err.message || 'TRON order verification failed',
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
 * Create a TRON USDT (TRC20) deposit order in Supabase.
 * Body: { amount_usdt | amount }
 */
router.post('/', requireAuth, requireSensitive, async (req, res) => {
  try {
    const result = await createTronOrder(req.body || {});
    return res.status(201).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[tron/orders POST]', err.message, err.code || '');
    const status = err.code === 'SUPABASE_NOT_CONFIGURED'
      ? 503
      : (err.code === 'TRON_ORDER_INVALID_AMOUNT' ? 400 : 500);
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to create TRON order',
      code: err.code,
    });
  }
});

/**
 * GET /api/tron/orders/:orderId
 * Fetch order status for frontend polling.
 */
router.get('/:orderId', requireAuth, async (req, res) => {
  try {
    const order = await findTronOrderByOrderId(req.params.orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found',
        code: 'TRON_ORDER_NOT_FOUND',
      });
    }
    return res.json({ success: true, order });
  } catch (err) {
    console.error('[tron/orders GET]', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to load order',
    });
  }
});

module.exports = router;
