#!/usr/bin/env node
'use strict';

/**
 * Droplet sweep cron wiring (static + env script smoke).
 * Run: node backend/scripts/test-droplet-sweep-cron.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backend = path.join(__dirname, '..');
const sweepJs = fs.readFileSync(path.join(backend, 'scripts/sweep-tron-deposits.js'), 'utf8');
const cronSh = fs.readFileSync(path.join(backend, 'scripts/run-scheduled-sweep.sh'), 'utf8');
const envCheckJs = fs.readFileSync(path.join(backend, 'src/services/tronSweepEnvCheck.js'), 'utf8');
const setupJs = fs.readFileSync(path.join(backend, 'scripts/setup-droplet-sweep-automation.js'), 'utf8');
const doc = fs.readFileSync(path.join(backend, 'docs/DROPLET_SWEEP_CRON.md'), 'utf8');

assert.ok(sweepJs.includes('--limit='), 'sweep CLI supports --limit');
assert.ok(sweepJs.includes('--scheduled'), 'sweep CLI supports --scheduled for cron');
assert.ok(sweepJs.includes('evaluateSweepEnv'), 'sweep CLI validates env programmatically');

assert.ok(cronSh.includes('verify-droplet-sweep-env.js'), 'cron wrapper runs env verify');
assert.ok(cronSh.includes('flock'), 'cron wrapper uses flock');
assert.ok(cronSh.includes('--scheduled'), 'cron wrapper passes --scheduled');
assert.ok(cronSh.includes('TRON_SWEEP_CRON_DRY_RUN'), 'cron supports dry-run env');

assert.ok(envCheckJs.includes('TRON_ENERGY_API_URL'), 'env check covers Netts URL');
assert.ok(envCheckJs.includes('TRON_NETTS_REAL_IP'), 'env check covers whitelist IP');
assert.ok(setupJs.includes('setup-droplet-sweep-automation'), 'setup script present');

assert.ok(doc.includes('setup-droplet-sweep-automation'), 'runbook documents one-command setup');
assert.ok(doc.includes('--dry-run --all --limit=1'), 'runbook documents dry-run');

console.log('test-droplet-sweep-cron: OK');
