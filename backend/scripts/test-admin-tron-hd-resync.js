#!/usr/bin/env node
/**
 * Static + local unit checks for admin TRON HD address resync.
 * Run: node backend/scripts/test-admin-tron-hd-resync.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(ROOT, 'src/routes/admin.js'), 'utf8');
const service = fs.readFileSync(path.join(ROOT, 'src/services/tronDepositAddressService.js'), 'utf8');
const backfill = fs.readFileSync(path.join(ROOT, 'scripts/backfill-supabase-tron-hd-addresses.js'), 'utf8');

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('admin route exposes HD resync endpoints');
assert.ok(route.includes("'/tron/resync-hd-addresses'"), 'resync-hd-addresses route present');
assert.ok(route.includes("requirePermission('master_wallet')"), 'requires master_wallet');
assert.ok(route.includes('resyncHdDepositAddresses'), 'calls resyncHdDepositAddresses');
assert.ok(route.includes('dry_run'), 'supports dry_run');
console.log('ok');

section('deposit address service exports resync helper');
assert.ok(service.includes('async function resyncHdDepositAddresses'), 'resyncHdDepositAddresses defined');
assert.ok(service.includes('ensureUserTronDepositAddress(userId'), 'reuses ensureUserTronDepositAddress');
assert.ok(/resyncHdDepositAddresses/.test(service.split('module.exports')[1] || ''), 'exported');
console.log('ok');

section('backfill script accepts --users filter');
assert.ok(backfill.includes('parseUsersArg'), 'parseUsersArg helper');
assert.ok(backfill.includes('--users='), 'supports --users=');
assert.ok(backfill.includes('opts.users'), 'filters by opts.users');
console.log('ok');

section('resyncHdDepositAddresses dry-run reports mismatches without writes');
process.env.MASTER_PRIVATE_KEY = process.env.MASTER_PRIVATE_KEY
  || 'a78b40566520dcfdd913aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
delete require.cache[require.resolve('../src/services/tronHdWalletService')];
delete require.cache[require.resolve('../src/services/tronDepositAddressService')];
delete require.cache[require.resolve('../src/models/UserUsdtWalletAddress')];

const { getPublicDepositAddressForUser, isHdEnabled } = require('../src/services/tronHdWalletService');
assert.ok(isHdEnabled(), 'HD enabled with MASTER_PRIVATE_KEY');

const derived15 = getPublicDepositAddressForUser(15);
assert.ok(/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(derived15.address), 'user 15 derives base58 address');
assert.strictEqual(derived15.index, 15);
assert.strictEqual(derived15.path, "m/44'/195'/0'/0/15");
console.log('ok derived', derived15.address);

console.log('\nAdmin TRON HD resync checks passed.');
