const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const {
  findTronOrderByOrderId,
} = require('../services/tronOrderService');

const router = express.Router();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function depositRetired(res) {
  return res.status(410).json({
    success: false,
    error: 'Send USDT (TRC20) to your TRON HD deposit address.',
    code: 'DEPOSIT_USE_TRON_HD',
  });
}

/**
 * POST /api/tron/orders/check/pending
 * Listener hook: credit pending TRON HD deposits already seen on-chain.
 */
router.post('/check/pending', async (req, res) => {
  const expected = String(process.env.DEPOSIT_LISTENER_SECRET || '').trim();
  const provided = String(
    req.headers['x-deposit-listener-secret']
    || req.headers['x-listener-secret']
    || ''
  ).trim();

  if (!(expected && provided && timingSafeEqualString(provided, expected))) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'LISTENER_UNAUTHORIZED',
    });
  }

  try {
    const { runTronOrderPollSafely } = require('../services/tronOrderService');
    const result = await runTronOrderPollSafely();
    return res.json({ success: true, provider: 'tron-hd', ...result });
  } catch (err) {
    console.error('[tron/orders/check]', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'TRON deposit verification failed',
      code: err.code,
    });
  }
});

/** POST /api/tron/orders — unique pay-address orders are retired. */
router.post('/', requireAuth, (_req, res) => depositRetired(res));

/**
 * GET /api/tron/orders/:orderId
 * Local TRON HD order status. Does not call an external card provider.
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
    if (order.user_id != null && Number(order.user_id) !== Number(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        code: 'TRON_ORDER_FORBIDDEN',
      });
    }
    return res.json({ success: true, order, provider: 'tron-hd' });
  } catch (err) {
    console.error('[tron/orders GET]', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to load order',
    });
  }
});

module.exports = router;
