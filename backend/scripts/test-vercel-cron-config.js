#!/usr/bin/env node
/**
 * Vercel cron wiring for TRON deposit ops (hourly sweep + credit scan).
 * Run: node backend/scripts/test-vercel-cron-config.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const vercelPath = path.join(__dirname, '..', '..', 'vercel.json');
const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
const crons = config.crons || [];

const depositOpsCron = crons.find((c) => c.path === '/api/cron/tron-deposit-ops');
assert.ok(depositOpsCron, 'vercel.json must schedule /api/cron/tron-deposit-ops');
assert.ok(depositOpsCron.schedule, 'tron-deposit-ops cron must have a schedule');

const indexJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
assert.ok(indexJs.includes("app.use('/api/cron'"), 'index.js must mount /api/cron');

const cronRoute = path.join(__dirname, '..', 'src', 'routes', 'cron.js');
assert.ok(fs.existsSync(cronRoute), 'cron.js route must exist');

const legacyTronCron = path.join(__dirname, '..', 'src', 'routes', 'tronCron.js');
assert.ok(!fs.existsSync(legacyTronCron), 'legacy tronCron route file must not exist');

console.log('test-vercel-cron-config: OK');
