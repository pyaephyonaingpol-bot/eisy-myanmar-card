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

console.log('test-vercel-cron-config: OK');
