'use strict';

/**
 * In-process daily TRON deposit sweep for long-running Droplet/PM2 hosts.
 * Disabled on Vercel serverless — set TRON_SWEEP_SCHEDULER_ENABLED=true on the Droplet.
 */
const { areMasterWalletTransfersPaused } = require('./securityFlags');
const { evaluateSweepEnv } = require('./tronSweepEnvCheck');

let timer = null;
let running = false;

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

function isVercelServerless() {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
}

function isSweepSchedulerEnabled() {
  if (process.env.NODE_ENV === 'test') return false;
  if (isVercelServerless()) return false;
  return envFlag('TRON_SWEEP_SCHEDULER_ENABLED', false);
}

function getSweepSchedulerLimit() {
  const n = parseInt(process.env.TRON_SWEEP_SCHEDULER_LIMIT || '500', 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 500, 1), 5000);
}

function getSweepIntervalMs() {
  const hours = parseFloat(process.env.TRON_SWEEP_INTERVAL_HOURS || '24');
  if (Number.isFinite(hours) && hours > 0) {
    return Math.round(hours * 60 * 60 * 1000);
  }
  const ms = parseInt(process.env.TRON_SWEEP_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10);
  return Math.max(Number.isFinite(ms) ? ms : 24 * 60 * 60 * 1000, 60_000);
}

function getInitialDelayMs() {
  const n = parseInt(process.env.TRON_SWEEP_SCHEDULER_INITIAL_DELAY_MS || '120000', 10);
  return Math.max(Number.isFinite(n) ? n : 120_000, 0);
}

function schedulerDryRunForced() {
  return envFlag('TRON_SWEEP_SCHEDULER_DRY_RUN', false);
}

function whenPausedBehavior() {
  const raw = String(process.env.TRON_SWEEP_WHEN_PAUSED || 'skip').trim().toLowerCase();
  if (raw === 'dry_run' || raw === 'dry-run') return 'dry_run';
  return 'skip';
}

/**
 * @returns {Promise<{ skipped: boolean, reason?: string, summary?: object }>}
 */
async function runScheduledSweepTick({ dryRun = null, limit = null } = {}) {
  if (running) {
    console.log('[tron/sweep/scheduler] tick skipped — previous run still in flight');
    return { skipped: true, reason: 'in_flight' };
  }

  running = true;
  const started = new Date().toISOString();
  try {
    const envReport = await evaluateSweepEnv({ verifyAddresses: false, preflightLimit: 1 });
    if (!envReport.ok) {
      const missing = envReport.checks.failed.map((f) => f.id).join(', ')
        || envReport.preflight?.blockers?.join(', ')
        || 'unknown';
      console.warn('[tron/sweep/scheduler] env not ready — skipping tick:', missing);
      return { skipped: true, reason: 'env_not_ready', envReport };
    }

    let effectiveDryRun = dryRun != null ? Boolean(dryRun) : schedulerDryRunForced();
    if (!effectiveDryRun && areMasterWalletTransfersPaused()) {
      const behavior = whenPausedBehavior();
      if (behavior === 'dry_run') {
        effectiveDryRun = true;
        console.warn(
          '[tron/sweep/scheduler] MASTER_WALLET_TRANSFERS_PAUSED — running dry-run only '
          + '(set TRON_SWEEP_WHEN_PAUSED=skip to skip entirely)'
        );
      } else {
        console.warn(
          '[tron/sweep/scheduler] skipped — MASTER_WALLET_TRANSFERS_PAUSED / WITHDRAWALS_PAUSED '
          + '(live USDT sweep disabled until flags cleared)'
        );
        return { skipped: true, reason: 'master_transfers_paused' };
      }
    }

    const sweep = require('./tronSweepService');
    const summary = await sweep.runManualSweep({
      dryRun: effectiveDryRun,
      limit: limit != null ? limit : getSweepSchedulerLimit(),
      scheduled: true,
    });

    console.log(
      '[tron/sweep/scheduler] finished',
      JSON.stringify({
        started,
        finished: summary.finished_at,
        dryRun: summary.dryRun,
        checked: summary.checked,
        swept: summary.swept,
        skipped: summary.skipped,
        failed: summary.failed,
        ok: summary.ok,
      })
    );

    return { skipped: false, summary };
  } catch (err) {
    console.error('[tron/sweep/scheduler] tick failed:', err.code || '', err.message);
    return { skipped: true, reason: 'error', error: err.message, code: err.code };
  } finally {
    running = false;
  }
}

function startTronSweepScheduler() {
  if (timer) return { started: false, reason: 'already_started' };
  if (!isSweepSchedulerEnabled()) {
    return { started: false, reason: 'disabled' };
  }

  const intervalMs = getSweepIntervalMs();
  const initialMs = getInitialDelayMs();

  console.log(
    '[tron/sweep/scheduler] enabled — first run in',
    Math.round(initialMs / 1000),
    's, then every',
    Math.round(intervalMs / 1000 / 60),
    'minutes',
    `(limit=${getSweepSchedulerLimit()}, dryRun=${schedulerDryRunForced()})`
  );

  const scheduleNext = () => {
    timer = setTimeout(async () => {
      await runScheduledSweepTick();
      scheduleNext();
    }, intervalMs);
    timer.unref?.();
  };

  setTimeout(async () => {
    await runScheduledSweepTick();
    scheduleNext();
  }, initialMs).unref?.();

  return { started: true, intervalMs, initialMs };
}

function stopTronSweepScheduler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

module.exports = {
  isSweepSchedulerEnabled,
  isVercelServerless,
  getSweepIntervalMs,
  runScheduledSweepTick,
  startTronSweepScheduler,
  stopTronSweepScheduler,
};
