#!/usr/bin/env node
'use strict';

/**
 * Backend TRON services must not call `new TronWeb` directly — use createTronWeb from lib/tronWeb.js.
 */
const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '../src/services'),
  path.join(__dirname, '../../lib'),
];
const pattern = /\bnew TronWeb\s*\(/;

const violations = [];
for (const root of roots) {
  for (const file of walk(root)) {
    if (!file.endsWith('.js')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (pattern.test(text)) {
      violations.push(path.relative(path.join(__dirname, '..'), file));
    }
  }
}

if (violations.length) {
  console.error('Direct new TronWeb() found (use createTronWeb from src/lib/tronWeb.js):');
  for (const v of violations) console.error('  -', v);
  process.exit(1);
}
console.log('test-tron-web-factory-only: OK');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
