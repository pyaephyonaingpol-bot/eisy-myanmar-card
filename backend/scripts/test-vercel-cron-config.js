#!/usr/bin/env node
/**
 * Vercel Hobby does not rely on scheduled crons — vercel.json must not define them.
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
  'vercel.json must not define crons (use admin Trigger Deposit Credit Scan instead)'
);

const indexJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
assert.ok(!indexJs.includes("'/api/cron'"), 'index.js must not mount /api/cron');
assert.ok(!indexJs.includes('tronCron'), 'index.js must not reference tronCron');

const tronCronPath = path.join(__dirname, '..', 'src', 'routes', 'tronCron.js');
assert.ok(!fs.existsSync(tronCronPath), 'tronCron route file must be removed');

console.log('test-vercel-cron-config: OK');
