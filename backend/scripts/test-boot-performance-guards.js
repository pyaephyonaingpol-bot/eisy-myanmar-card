#!/usr/bin/env node
'use strict';

/**
 * Guards for snappier boot: no Supabase TLA, cached-session paint, slim home bootstrap.
 * Run: node backend/scripts/test-boot-performance-guards.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('== Supabase bridge ==');
const svc = read('backend/public/src/services/supabaseService.js');
assert.ok(!/await\s+SupabaseBridge\.init\s*\(\s*\)\s*;?\s*$/m.test(svc)
  && !svc.includes('await SupabaseBridge.init();'),
  'no top-level await SupabaseBridge.init()');
assert.ok(svc.includes('window.SupabaseBridge = SupabaseBridge'), 'bridge still exported');
console.log('ok');

console.log('\n== Auth session cache ==');
const auth = read('backend/public/auth.js');
assert.ok(auth.includes('_mem'), 'in-memory session mirror');
assert.ok(/load\s*\(\s*\)\s*\{[\s\S]*_mem/.test(auth), 'load uses memory cache');
assert.ok(/save\s*\([^)]*\)\s*\{[\s\S]*_mem\s*=/.test(auth), 'save updates memory cache');
console.log('ok');

console.log('\n== Dashboard boot / bootstrap ==');
const dash = read('backend/public/dashboard.js');
assert.ok(dash.includes('Paint immediately from cached session')
  || dash.includes('finishBoot();\n          await Auth.restoreSession'),
  'cached session paints before /me revalidate');
assert.ok(dash.includes('ensureImageCompression'), 'lazy KYC compressor loader');
assert.ok(
  /Promise\.allSettled\(\[\s*this\.loadWallet\(\{\s*force:\s*true\s*\}\),\s*this\.loadDepositHistory\(\)/.test(dash),
  'home bootstrap limited to wallet + deposits'
);
assert.ok(!/Promise\.allSettled\(\[[\s\S]*loadTransactions\(\)[\s\S]*loadKycStatus\(\)/.test(dash),
  'boot no longer awaits full pricing/KYC/methods waterfall');
console.log('ok');

console.log('\nBoot performance guards passed.');
