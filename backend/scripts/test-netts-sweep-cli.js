#!/usr/bin/env node
'use strict';

/**
 * Static wiring for scripts/netts-sweep.js
 * Run: node backend/scripts/test-netts-sweep-cli.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const cli = fs.readFileSync(path.join(ROOT, 'scripts/netts-sweep.js'), 'utf8');
const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');

assert.ok(cli.includes('executeAdminAutoSweep'), 'CLI uses admin auto-sweep service');
assert.ok(cli.includes('buildAutoSweepStatus'), 'CLI supports --status');
assert.ok(cli.includes('TRON_NETTS_REAL_IP') || cli.includes('verify-droplet-sweep-env'), 'documents Netts env');
assert.ok(cli.includes('--dry-run'), 'dry-run flag');
assert.ok(cli.includes('cli_netts_sweep'), 'audit source tag');
assert.ok(pkg.includes('"netts-sweep"'), 'root npm script for netts-sweep');

console.log('test-netts-sweep-cli: OK');
