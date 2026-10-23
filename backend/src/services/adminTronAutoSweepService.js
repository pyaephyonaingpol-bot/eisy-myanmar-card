'use strict';

/**
 * Admin-triggered TRON HD deposit auto-sweep (Netts energy + USDT → master).
 * Used by POST /api/admin/tron/auto-sweep and legacy POST /api/admin/sweep-deposits.
 */
const { evaluateSweepEnv } = require('./tronSweepEnvCheck');
const {
  assertSweepBodyHasNoPrivateKey,
  assertSweepPreflightOrThrow,
  buildSweepPreflightReport,
  runManualSweep,
  isSweepInFlight,
  listSweepableDepositAddresses,
  getSweepGasTrx,
  getNettsEnergyPerSweep,
  getMinSweepUsdt,
  summarizeSweepTransferTotals,
} = require('./tronSweepService');
const { areMasterWalletTransfersPaused } = require('./securityFlags');
const TransactionLog = require('../models/TransactionLog');

async function buildAutoSweepStatus({ limit = 500, verifyAddresses = true } = {}) {
  const env = await evaluateSweepEnv({
    verifyAddresses: false,
    preflightLimit: 1,
  });
  const preflight = await buildSweepPreflightReport({
    verifyAddresses,
    limit,
  });
  const addresses = await listSweepableDepositAddresses({ limit });
  return {
    ready: env.ok && preflight.ready && !areMasterWalletTransfersPaused(),
    env_ok: env.ok,
    env_checks: env.checks.results,
    preflight,
    transfers_paused: areMasterWalletTransfersPaused(),
    in_flight: isSweepInFlight(),
    netts: preflight.netts,
    min_usdt: getMinSweepUsdt(),
    netts_energy: getNettsEnergyPerSweep(),
    gas_trx: getSweepGasTrx(),
    address_count: addresses.length,
    manual: true,
    scheduled: false,
    source: 'admin_ui',
  };
}

/**
 * @param {object} body Request body
 * @param {{ adminUserId?: number|null, source?: string }} meta
 */
async function executeAdminAutoSweep(body = {}, { adminUserId = null, source = 'admin_ui' } = {}) {
  const dryRun = Boolean(body.dry_run ?? body.dryRun);

  if (!dryRun && areMasterWalletTransfersPaused()) {
    const err = new Error(
      'Master wallet transfers are paused. Set MASTER_WALLET_TRANSFERS_PAUSED=false '
      + 'and WITHDRAWALS_PAUSED=false after key rotation, or run a dry_run sweep.'
    );
    err.code = 'MASTER_WALLET_TRANSFERS_PAUSED';
    err.status = 503;
    throw err;
  }

  if (isSweepInFlight()) {
    const err = new Error('A TRON deposit sweep is already in progress');
    err.code = 'SWEEP_IN_PROGRESS';
    err.status = 409;
    throw err;
  }

  assertSweepBodyHasNoPrivateKey(body);

  const envReport = await evaluateSweepEnv({ verifyAddresses: false, preflightLimit: 1 });
  if (!envReport.ok) {
    const err = new Error(
      `Sweep environment not ready: ${
        envReport.checks.failed.map((f) => f.id).join(', ')
        || envReport.preflight?.blockers?.join(', ')
        || 'unknown'
      }`
    );
    err.code = 'SWEEP_ENV_NOT_READY';
    err.status = 503;
    err.envReport = envReport;
    throw err;
  }

  const forceGas = Boolean(body.force_gas ?? body.forceGas);
  const userId = body.user_id ?? body.userId ?? null;
  const limit = body.limit != null ? Number(body.limit) : 500;
  const skipPreflight = Boolean(body.skip_preflight ?? body.skipPreflight);

  if (!dryRun && !skipPreflight) {
    await assertSweepPreflightOrThrow({ verifyAddresses: true, limit });
  }

  const summary = await runManualSweep({
    userId,
    dryRun,
    forceGas,
    limit,
    scheduled: false,
  });

  const totals = summarizeSweepTransferTotals(summary);

  TransactionLog.create({
    userId: adminUserId,
    type: 'other',
    direction: 'neutral',
    description: dryRun
      ? `Admin dry-run TRON auto-sweep (${summary.mode})`
      : `Admin TRON auto-sweep via Netts (${summary.mode})`,
    createdBy: 'admin',
    metadata: {
      action: 'tron_auto_sweep',
      source,
      dry_run: dryRun,
      mode: summary.mode,
      checked: summary.checked,
      swept: summary.swept,
      skipped: summary.skipped,
      failed: summary.failed,
      total_usdt: totals.total_usdt,
      transfer_count: totals.transfer_count,
      user_id: userId,
    },
  }).catch((err) => {
    console.warn('[admin/tron/auto-sweep] audit log skipped:', err.message);
  });

  return {
    httpStatus: summary.failed > 0 ? 207 : 200,
    payload: {
      success: summary.ok,
      message: dryRun
        ? 'Dry-run complete — no on-chain transfers were broadcast'
        : 'TRON auto-sweep finished (Netts energy + USDT to master)',
      source,
      dry_run: dryRun,
      manual: true,
      scheduled: false,
      gas_trx: summary.gasTrx ?? getSweepGasTrx(),
      netts_energy: summary.nettsEnergy ?? getNettsEnergyPerSweep(),
      min_usdt: summary.minUsdt ?? getMinSweepUsdt(),
      total_usdt: totals.total_usdt,
      transfer_count: totals.transfer_count,
      transfers: totals.transfers,
      sweep: summary,
    },
  };
}

module.exports = {
  buildAutoSweepStatus,
  executeAdminAutoSweep,
};
