#!/usr/bin/env node
'use strict';

/**
 * Cron route JSON safety + auth (no live sweep).
 * Run: node backend/scripts/test-cron-deposit-ops-json.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cronSrc = fs.readFileSync(path.join(__dirname, '../src/routes/cron.js'), 'utf8');
assert.ok(cronSrc.includes('jsonSafe'), 'cron route sanitizes JSON');
assert.ok(cronSrc.includes('initDb'), 'cron ensures database before sweep');

const { authorizeCronBearer } = require('../src/lib/cronAuth');
process.env.CRON_SECRET = 'test-secret';
assert.strictEqual(authorizeCronBearer('Bearer test-secret').authorized, true);
assert.strictEqual(authorizeCronBearer('Bearer wrong').authorized, false);

console.log('test-cron-deposit-ops-json: OK');
