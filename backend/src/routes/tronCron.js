/**
 * Scheduled TRON HD deposit scan.
 * Vercel does not run the in-process poller, so a cron hit (or the deposit
 * listener secret) walks custodial addresses and credits confirmed USDT.
 */
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function cronAuthorized(req) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const header = String(req.get('authorization') || '');
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (cronSecret && timingSafeEqualString(bearer, cronSecret)) return true;

  const listener = String(process.env.DEPOSIT_LISTENER_SECRET || '').trim();
  const provided = String(
    req.get('x-deposit-listener-secret')
    || req.get('X-Deposit-Listener-Secret')
    || ''
  ).trim();
  if (listener && timingSafeEqualString(provided, listener)) return true;

  if (process.env.VERCEL && String(req.get('x-vercel-cron') || '') === '1') return true;
  return false;
}

async function handleTronDepositCron(_req, res) {
  try {
    const { runTronOrderPollSafely } = require('../services/tronOrderService');
    const result = await runTronOrderPollSafely();
    return res.json({ success: true, provider: 'tron-hd', ...result });
  } catch (err) {
    console.error('[cron/tron-deposits]', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'TRON deposit cron failed',
      code: err.code || 'TRON_DEPOSIT_CRON_FAILED',
    });
  }
}

router.all('/tron-deposits', (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      code: 'CRON_UNAUTHORIZED',
    });
  }
  return handleTronDepositCron(req, res);
});

module.exports = router;
