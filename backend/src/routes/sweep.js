/**
 * POST /api/sweep — Netts energy + USDT sweep (admin-only).
 * Production traffic reaches this via Express (see root vercel.json rewrites).
 */
const express = require('express');
const path = require('path');
const { requireAdminAuth, requirePermission } = require('../middleware/auth');

const sweepLibPath = path.join(__dirname, '../../../lib/nettsUsdtSweep.js');
const { sweepUsdtWithNettsEnergy } = require(sweepLibPath);

const router = express.Router();

function mapSweepError(err) {
  const code = err?.code || 'SWEEP_FAILED';
  const message = err?.message || String(err);
  let status = 400;
  if (code === 'SWEEP_CONFIG') status = 500;
  else if (code === 'SWEEP_NETTS_FAILED' || code === 'SWEEP_NO_TXID') status = 502;
  else if (code === 'SWEEP_BAD_REQUEST' || code === 'SWEEP_INVALID_AMOUNT') status = 400;
  else if (code === 'SWEEP_KEY_MISMATCH' || code === 'SWEEP_INVALID_ADDRESS') status = 400;
  return { status, body: { ok: false, error: message, code } };
}

router.post('/', requireAdminAuth, requirePermission('master_wallet'), async (req, res) => {
  try {
    const { childAddress, childPrivateKey, amountToSweep } = req.body || {};
    const result = await sweepUsdtWithNettsEnergy({
      childAddress,
      childPrivateKey,
      amountToSweep,
    });
    return res.json(result);
  } catch (err) {
    const mapped = mapSweepError(err);
    if (err?.code === 'SWEEP_NO_TXID') {
      return res.status(mapped.status).json({
        ...mapped.body,
        energyOrder: err.energyOrder,
      });
    }
    console.error('[api/sweep]', err.code || '', err.message);
    return res.status(mapped.status).json(mapped.body);
  }
});

module.exports = router;
