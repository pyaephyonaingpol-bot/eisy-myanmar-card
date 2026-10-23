#!/usr/bin/env node
'use strict';

/**
 * In-process TRON sweep scheduler wiring.
 * Run: node backend/scripts/test-tron-sweep-scheduler.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backend = path.join(__dirname, '..');
const indexJs = fs.readFileSync(path.join(backend, 'src/index.js'), 'utf8');
const scheduler = fs.readFileSync(path.join(backend, 'src/services/tronSweepSchedulerService.js'), 'utf8');
const envCheck = fs.readFileSync(path.join(backend, 'src/services/tronSweepEnvCheck.js'), 'utf8');
const setup = fs.readFileSync(path.join(backend, 'scripts/setup-droplet-sweep-automation.js'), 'utf8');
const sweepCli = fs.readFileSync(path.join(backend, 'scripts/sweep-tron-deposits.js'), 'utf8');

assert.ok(indexJs.includes('startTronSweepScheduler'), 'server starts sweep scheduler');
assert.ok(scheduler.includes('areMasterWalletTransfersPaused'), 'scheduler respects pause flags');
assert.ok(scheduler.includes('evaluateSweepEnv'), 'scheduler checks env programmatically');
assert.ok(envCheck.includes('TRON_ENERGY_API_URL'), 'env check covers Netts URL');
assert.ok(setup.includes('--apply'), 'setup script supports --apply');
assert.ok(setup.includes('TRON_SWEEP_SCHEDULER_ENABLED'), 'setup enables scheduler env');
assert.ok(sweepCli.includes('evaluateSweepEnv'), 'CLI validates env before sweep');
assert.ok(sweepCli.includes('assertMasterWalletTransfersAllowed'), 'CLI uses securityFlags for pause');

const svc = require('../src/services/tronSweepSchedulerService');
process.env.VERCEL = '1';
assert.strictEqual(svc.isSweepSchedulerEnabled(), false, 'disabled on Vercel');
delete process.env.VERCEL;
process.env.TRON_SWEEP_SCHEDULER_ENABLED = 'true';
assert.strictEqual(svc.isSweepSchedulerEnabled(), true, 'enabled when env set');
delete process.env.TRON_SWEEP_SCHEDULER_ENABLED;

console.log('test-tron-sweep-scheduler: OK');
