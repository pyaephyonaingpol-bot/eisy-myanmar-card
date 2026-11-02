'use strict';

/**
 * GET|POST /api/cron/tron-deposit-ops — external scheduler (e.g. DigitalOcean crontab; not Vercel platform crons).
 * Bearer CRON_SECRET. Production traffic: vercel.json rewrites /api/* → Express (api/index.js).
 */
const express = require('express');
const { authorizeCronBearer } = require('../lib/cronAuth');
const { runTronDepositOpsCron } = require('../services/tronDepositOpsCronService');

const router = express.Router();

/** Express res.json cannot serialize BigInt — sweep results may include chain amounts. */
function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

async function handleTronDepositOps(req, res) {
  const auth = authorizeCronBearer(req.headers.authorization);
  if (!auth.authorized) {
    return res.status(auth.status || 401).json({
      ok: false,
      success: false,
      error: auth.code === 'CRON_NOT_CONFIGURED'
        ? 'CRON_SECRET is not configured on the server'
        : 'Unauthorized',
      code: auth.code || 'CRON_UNAUTHORIZED',
    });
  }

  try {
    const { initDb, getDb } = require('../db');
    try {
      getDb();
    } catch (_) {
      await initDb();
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const dryRun = body.dry_run ?? body.dryRun ?? req.query?.dry_run ?? req.query?.dryRun;
    const parsedDryRun = dryRun === 'true' || dryRun === '1' || dryRun === true;

    const result = await runTronDepositOpsCron({
      dryRun: dryRun != null && dryRun !== '' ? parsedDryRun : null,
      skipPreflight: Boolean(body.skip_preflight ?? body.skipPreflight),
    });

    const status = result.skipped ? 200 : (result.sweep_ok === false ? 207 : 200);
    return res.status(status).json(jsonSafe({
      success: true,
      ok: true,
      ...result,
    }));
  } catch (err) {
    console.error('[cron/tron-deposit-ops]', err.code || '', err.message);
    const code = err.code || 'CRON_DEPOSIT_OPS_FAILED';
    let status = 500;
    if (code === 'SWEEP_IN_PROGRESS') status = 409;
    else if (code === 'SWEEP_PREFLIGHT_FAILED' || code === 'SWEEP_ADDRESS_MISMATCH') status = 503;
    return res.status(status).json(jsonSafe({
      ok: false,
      success: false,
      error: err.message || String(err),
      code,
      preflight: err.preflight,
    }));
  }
}

router.get('/tron-deposit-ops', handleTronDepositOps);
router.post('/tron-deposit-ops', handleTronDepositOps);

module.exports = router;
