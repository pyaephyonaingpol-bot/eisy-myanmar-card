/**
 * Durable cron endpoints (Vercel Cron / external schedulers).
 * Mounted at /api/cron
 */
const express = require('express');
const crypto = require('crypto');
const { runTronOrderPollSafely } = require('../services/tronDepositCreditService');

const router = express.Router();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Auth for Vercel Cron (Authorization: Bearer CRON_SECRET) or the existing
 * deposit listener secret used by manual / worker hooks.
 */
function requireCronOrListener(req, res, next) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const listenerSecret = String(process.env.DEPOSIT_LISTENER_SECRET || '').trim();
  const authHeader = String(req.headers.authorization || '').trim();
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerSecret = String(
    req.headers['x-deposit-listener-secret']
    || req.headers['x-listener-secret']
    || req.headers['x-cron-secret']
    || ''
  ).trim();
  const querySecret = String(req.query?.secret || '').trim();
  const provided = bearer || headerSecret || querySecret;

  if (cronSecret && provided && timingSafeEqualString(provided, cronSecret)) {
    req.cronAuth = 'cron_secret';
    return next();
  }
  if (listenerSecret && provided && timingSafeEqualString(provided, listenerSecret)) {
    req.cronAuth = 'listener_secret';
    return next();
  }

  // Vercel Cron always sends CRON_SECRET when configured. Fail closed otherwise.
  return res.status(401).json({
    success: false,
    error: 'Unauthorized',
    code: 'CRON_UNAUTHORIZED',
  });
}

/**
 * GET|POST /api/cron/tron-deposits
 * Durable poller fallback for pending TRC20 orders (TronGrid scan → credit).
 * Schedule via vercel.json crons (every minute) or an external worker.
 */
async function runTronDepositCron(req, res) {
  try {
    const result = await runTronOrderPollSafely();
    console.log('[cron/tron-deposits]', {
      auth: req.cronAuth,
      skipped: result.skipped,
      checked: result.checked,
      completed: result.completed,
      credited: result.credited,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[cron/tron-deposits]', err.message, err.code || '');
    return res.status(500).json({
      success: false,
      error: err.message || 'TRON deposit cron failed',
      code: err.code || 'TRON_CRON_FAILED',
    });
  }
}

router.get('/tron-deposits', requireCronOrListener, runTronDepositCron);
router.post('/tron-deposits', requireCronOrListener, runTronDepositCron);

module.exports = router;
