'use strict';

/**
 * Hourly TRON deposit ops: credit pending deposits, then Netts-backed HD sweeps.
 * Invoked by GET/POST /api/cron/tron-deposit-ops (Vercel Cron + Bearer CRON_SECRET).
 */
const { areMasterWalletTransfersPaused } = require('./securityFlags');
const { creditDetectedDeposits } = require('./tronWalletService');

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

function getCronSweepLimit() {
  const n = parseInt(process.env.TRON_SWEEP_CRON_LIMIT || process.env.TRON_SWEEP_SCHEDULER_LIMIT || '500', 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 500, 1), 5000);
}

/**
 * @param {{ dryRun?: boolean | null, skipPreflight?: boolean }} [options]
 */
async function runTronDepositOpsCron(options = {}) {
  const startedAt = new Date().toISOString();
  let credit = null;
  try {
    credit = await creditDetectedDeposits();
  } catch (err) {
    credit = { error: err.message || String(err), code: err.code || 'CREDIT_FAILED' };
  }

  const {
    assertSweepPreflightOrThrow,
    runManualSweep,
    isSweepInFlight,
  } = require('./tronSweepService');

  if (isSweepInFlight()) {
    return {
      ok: true,
      success: true,
      skipped: true,
      reason: 'sweep_in_flight',
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      credit,
    };
  }

  let dryRun = options.dryRun != null ? Boolean(options.dryRun) : envFlag('TRON_CRON_DRY_RUN', false);
  if (!dryRun && areMasterWalletTransfersPaused()) {
    const whenPaused = String(process.env.TRON_SWEEP_WHEN_PAUSED || 'skip').trim().toLowerCase();
    if (whenPaused === 'dry_run' || whenPaused === 'dry-run') {
      dryRun = true;
    } else {
      return {
        ok: true,
        success: true,
        skipped: true,
        reason: 'master_transfers_paused',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        credit,
        sweep: { skipped: true, reason: 'master_transfers_paused' },
      };
    }
  }

  if (!options.skipPreflight && !dryRun) {
    await assertSweepPreflightOrThrow({ verifyAddresses: true, limit: getCronSweepLimit() });
  }

  const summary = await runManualSweep({
    dryRun,
    limit: getCronSweepLimit(),
    scheduled: true,
  });

  const finishedAt = new Date().toISOString();
  const sweepOk = summary.ok !== false && Number(summary.failed || 0) === 0;

  return {
    ok: true,
    success: true,
    started_at: startedAt,
    finished_at: finishedAt,
    credit,
    sweep: summary,
    sweep_ok: sweepOk,
  };
}

module.exports = {
  runTronDepositOpsCron,
  getCronSweepLimit,
};
