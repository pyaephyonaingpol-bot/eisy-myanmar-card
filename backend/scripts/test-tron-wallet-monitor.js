#!/usr/bin/env node
/**
 * TRON wallet monitor: master TRX alerts + sweep failure alerts (Telegram mocked).
 * Run: node backend/scripts/test-tron-wallet-monitor.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

process.chdir(path.join(__dirname, '..'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `eisy-tron-monitor-${Date.now()}.db`)}`;
process.env.TRON_WALLET_MONITOR_ENABLED = 'true';
process.env.TRON_MONITOR_ALERT_COOLDOWN_MINUTES = '60';
process.env.MASTER_PRIVATE_KEY = process.env.MASTER_PRIVATE_KEY
  || 'a'.repeat(64);

const alerts = [];

async function main() {
  const telegram = require('../src/services/telegram');
  telegram.notifyAdminTronWalletMonitor = async (payload) => {
    alerts.push(payload);
  };

  const tronMaster = require('../src/services/tronMasterWalletService');
  const originalInfo = tronMaster.getMasterWalletInfo;
  tronMaster.getMasterWalletInfo = async () => ({
    address: 'TMasterExample1111111111111111111111',
    usdtBalance: 1000,
    trxBalance: 5,
    trxLowThreshold: 30,
    trxLow: true,
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    source: 'test',
  });

  const { initDb } = require('../src/db');
  await initDb();

  delete require.cache[require.resolve('../src/services/tronWalletMonitorService')];
  const monitor = require('../src/services/tronWalletMonitorService');

  const first = await monitor.checkMasterWalletAndAlert();
  assert.strictEqual(first.alerts_sent.includes('master_trx_low'), true);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].kind, 'master_trx_low');

  const second = await monitor.checkMasterWalletAndAlert();
  assert.strictEqual(second.alerts_sent.length, 0, 'cooldown suppresses duplicate TRX low alert');

  const sweepAlert = await monitor.alertSweepFailuresIfNeeded({
    mode: 'all',
    checked: 3,
    swept: 1,
    skipped: 1,
    failed: 1,
    gasTrx: 1.1,
    minUsdt: 25,
    results: [{
      ok: false,
      userId: 7,
      depositAddress: 'TDeposit1111111111111111111111111111',
      error: 'USDT sweep failed',
      code: 'SWEEP_USDT_TRANSFER_FAILED',
    }],
  }, { dryRun: false });
  assert.strictEqual(sweepAlert.alerted, true);
  assert.ok(alerts.some((a) => a.kind === 'sweep_failures'));

  tronMaster.getMasterWalletInfo = originalInfo;
  console.log('test-tron-wallet-monitor: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
