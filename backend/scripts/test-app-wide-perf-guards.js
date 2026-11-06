#!/usr/bin/env node
'use strict';

/**
 * App-wide performance guardrails (admin + user + server).
 * Run: node backend/scripts/test-app-wide-perf-guards.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const admin = read('backend/public/admin.js');
const dash = read('backend/public/dashboard.js');
const auth = read('backend/public/auth.js');
const indexJs = read('backend/src/index.js');
const vercel = JSON.parse(read('vercel.json'));

assert.ok(admin.includes('scheduleBackgroundAdminWarm'), 'admin defers full loadAll warm');
assert.ok(!/loadActiveTabData\(\);\s*\n\s*this\.loadAll\(\)/.test(admin), 'admin login/restore does not immediately loadAll');
assert.ok(admin.includes('_apiInflight'), 'admin GET in-flight dedupe');
assert.ok(admin.includes('document.visibilityState'), 'admin support poll respects visibility');
assert.ok(read('backend/public/admin.html').includes('submitBusy.js'), 'admin loads submitBusy hook');

assert.ok(dash.includes('_walletDeepScanTimer'), 'wallet HD scan deferred after fast paint');
assert.ok(dash.includes('document.hidden'), 'p2p chat poll pauses when tab hidden');

assert.ok(auth.includes('_apiInflight'), 'Auth.api GET in-flight dedupe');

assert.ok(indexJs.includes("require('compression')"), 'server uses compression middleware');

const staticCache = (vercel.headers || []).find((h) => h.source && h.source.includes('js|css'));
const cacheHeader = staticCache?.headers?.find((x) => x.key === 'Cache-Control');
assert.ok(cacheHeader && cacheHeader.value.includes('3600'), 'vercel static assets cached longer');

assert.ok(fs.existsSync(path.join(ROOT, 'backend/migrations/075_admin_list_perf_indexes.sql')), 'admin list indexes migration');

console.log('test-app-wide-perf-guards: OK');
