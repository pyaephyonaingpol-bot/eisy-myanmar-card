#!/usr/bin/env node
/**
 * Ensure root vercel.json schedules TRON deposit cron every 15 minutes.
 * Run: node backend/scripts/test-vercel-cron-config.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const vercelPath = path.join(__dirname, '..', '..', 'vercel.json');
const raw = fs.readFileSync(vercelPath, 'utf8');
const config = JSON.parse(raw);
const crons = config.crons || [];
const tron = crons.find((c) => String(c.path || '').includes('tron-deposits'));

assert.ok(tron, 'vercel.json must define /api/cron/tron-deposits cron');
assert.strictEqual(
  tron.schedule,
  '*/15 * * * *',
  'TRON deposit cron should run every 15 minutes'
);

console.log('test-vercel-cron-config: OK');
