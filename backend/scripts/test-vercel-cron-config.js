#!/usr/bin/env node
/**
 * Vercel must not define scheduled crons (Hobby limits) — use Droplet crontab
 * calling GET /api/cron/tron-deposit-ops with Bearer CRON_SECRET instead.
 * Run: node backend/scripts/test-vercel-cron-config.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const vercelPath = path.join(__dirname, '..', '..', 'vercel.json');
const config = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
const crons = config.crons || [];

assert.strictEqual(
  crons.length,
  0,
  'vercel.json must not define crons (schedule on DigitalOcean instead)',
);

const indexJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
assert.ok(indexJs.includes("app.use('/api/cron'"), 'index.js mounts /api/cron for external cron HTTP');

const cronRoute = path.join(__dirname, '..', 'src', 'routes', 'cron.js');
assert.ok(fs.existsSync(cronRoute), 'cron.js route must exist');

const legacyTronCron = path.join(__dirname, '..', 'src', 'routes', 'tronCron.js');
assert.ok(!fs.existsSync(legacyTronCron), 'legacy tronCron route file must not exist');

console.log('test-vercel-cron-config: OK');
