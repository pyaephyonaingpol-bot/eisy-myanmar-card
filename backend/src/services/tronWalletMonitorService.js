/**
 * Operational monitoring for TRON master wallet gas and HD deposit sweeps.
 * Sends throttled Telegram alerts to the admin chat (see telegram.js).
 */
const { getDb } = require('../db');
const {
  getMasterWalletInfo,
  getTrxLowThreshold,
  checkMasterWalletAddressConsistency,
} = require('./tronMasterWalletService');
const { getSweepGasTrx } = require('./tronSweepService');

const SETTINGS_PREFIX = 'tron_monitor_';

function monitorAlertsEnabled() {
  const raw = process.env.TRON_WALLET_MONITOR_ENABLED;
  if (raw != null && String(raw).trim() !== '') {
    return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
  }
  return process.env.NODE_ENV !== 'test';
}

function alertCooldownMs() {
  const minutes = parseInt(process.env.TRON_MONITOR_ALERT_COOLDOWN_MINUTES || '60', 10);
  const m = Number.isFinite(minutes) && minutes >= 0 ? minutes : 60;
  return m * 60 * 1000;
}

async function readLastAlertMs(key) {
  const db = getDb();
  const row = await db.get(
    "SELECT value FROM app_settings WHERE key = ?",
    `${SETTINGS_PREFIX}${key}`
  );
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function writeLastAlertMs(key, ms = Date.now()) {
  const db = getDb();
  await db.run(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    `${SETTINGS_PREFIX}${key}`,
    String(ms)
  );
}

async function shouldSendAlert(key) {
  if (!monitorAlertsEnabled()) return false;
  const last = await readLastAlertMs(key);
  return Date.now() - last >= alertCooldownMs();
}

async function markAlertSent(key) {
  await writeLastAlertMs(key, Date.now());
}

/**
 * Check master TRX/USDT; alert when TRX is below threshold or address env mismatches key.
 */
async function checkMasterWalletAndAlert() {
  const out = {
    ok: true,
    skipped: false,
    alerts_sent: [],
  };

  if (!monitorAlertsEnabled()) {
    out.skipped = true;
    out.reason = 'monitor_disabled';
    return out;
  }

  const consistency = checkMasterWalletAddressConsistency();
  if (!consistency.match) {
    out.ok = false;
    if (await shouldSendAlert('master_address_mismatch')) {
      const { notifyAdminTronWalletMonitor } = require('./telegram');
      await notifyAdminTronWalletMonitor({
        kind: 'master_address_mismatch',
        configured: consistency.configured_masked,
        derived: consistency.derived_masked,
      });
      await markAlertSent('master_address_mismatch');
      out.alerts_sent.push('master_address_mismatch');
    }
  }

  let info;
  try {
    info = await getMasterWalletInfo();
  } catch (err) {
    out.ok = false;
    out.error = err.message;
    out.code = err.code || 'MASTER_BALANCE_CHECK_FAILED';
    if (await shouldSendAlert('master_balance_unreachable')) {
      const { notifyAdminTronWalletMonitor } = require('./telegram');
      await notifyAdminTronWalletMonitor({
        kind: 'master_balance_unreachable',
        message: err.message,
        code: err.code,
      });
      await markAlertSent('master_balance_unreachable');
      out.alerts_sent.push('master_balance_unreachable');
    }
    return out;
  }

  out.master = {
    address: info.address,
    trx: info.trxBalance,
    usdt: info.usdtBalance,
    trx_low: info.trxLow,
    trx_low_threshold: info.trxLowThreshold,
    source: info.source,
  };

  const gasPerSweep = getSweepGasTrx();
  const estimatedSweepsLeft = gasPerSweep > 0
    ? Math.floor(info.trxBalance / gasPerSweep)
    : null;

  if (info.trxLow && await shouldSendAlert('master_trx_low')) {
    const { notifyAdminTronWalletMonitor } = require('./telegram');
    await notifyAdminTronWalletMonitor({
      kind: 'master_trx_low',
      address: info.address,
      trxBalance: info.trxBalance,
      usdtBalance: info.usdtBalance,
      threshold: info.trxLowThreshold ?? getTrxLowThreshold(),
      gasPerSweep,
      estimatedSweepsLeft,
    });
    await markAlertSent('master_trx_low');
    out.alerts_sent.push('master_trx_low');
    out.ok = false;
  }

  return out;
}

function summarizeSweepFailures(summary) {
  const results = Array.isArray(summary?.results) ? summary.results : [];
  return results.filter((r) => r && (r.ok === false || r.error)).slice(0, 8);
}

/**
 * Alert when a manual sweep finishes with failures (skipped dry-runs).
 */
async function alertSweepFailuresIfNeeded(summary, { dryRun = false } = {}) {
  const failed = Number(summary?.failed || 0);
  if (dryRun || failed <= 0) {
    return { alerted: false, failed: 0 };
  }

  const failures = summarizeSweepFailures(summary);
  const insufficientTrx = failures.some((f) => f.code === 'SWEEP_INSUFFICIENT_MASTER_TRX');

  const alertKey = insufficientTrx ? 'sweep_insufficient_trx' : 'sweep_failures';
  if (!(await shouldSendAlert(alertKey))) {
    return { alerted: false, failed, throttled: true };
  }

  const { notifyAdminTronWalletMonitor } = require('./telegram');
  await notifyAdminTronWalletMonitor({
    kind: insufficientTrx ? 'sweep_insufficient_trx' : 'sweep_failures',
    summary: {
      mode: summary.mode,
      checked: summary.checked,
      swept: summary.swept,
      skipped: summary.skipped,
      failed,
      gasTrx: summary.gasTrx ?? getSweepGasTrx(),
      minUsdt: summary.minUsdt,
    },
    failures,
  });
  await markAlertSent(alertKey);
  return { alerted: true, failed };
}

/**
 * Immediate alert for a single sweep error (e.g. gas top-up failed mid-run).
 */
async function alertSweepErrorIfNeeded(err, context = {}) {
  if (!monitorAlertsEnabled() || !err) return { alerted: false };
  const code = err.code || 'SWEEP_FAILED';
  const urgent = code === 'SWEEP_INSUFFICIENT_MASTER_TRX';
  const key = urgent ? 'sweep_insufficient_trx' : 'sweep_single_error';
  if (!(await shouldSendAlert(key))) return { alerted: false, throttled: true };

  const { notifyAdminTronWalletMonitor } = require('./telegram');
  await notifyAdminTronWalletMonitor({
    kind: key,
    message: err.message,
    code,
    context,
  });
  await markAlertSent(key);
  return { alerted: true };
}

/**
 * Cron hook: master wallet check (deposit poll runs separately).
 */
async function runTronWalletMonitorSafely() {
  try {
    const master = await checkMasterWalletAndAlert();
    return { ok: master.ok !== false, master };
  } catch (err) {
    console.error('[tron/monitor]', err.message);
    return {
      ok: false,
      error: err.message,
      code: err.code || 'TRON_MONITOR_FAILED',
    };
  }
}

module.exports = {
  monitorAlertsEnabled,
  alertCooldownMs,
  checkMasterWalletAndAlert,
  alertSweepFailuresIfNeeded,
  alertSweepErrorIfNeeded,
  runTronWalletMonitorSafely,
};
