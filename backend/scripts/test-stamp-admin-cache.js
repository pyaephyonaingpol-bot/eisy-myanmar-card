#!/usr/bin/env node
'use strict';

/**
 * Ensures admin shell cache bust runs and updates stale admin.js query strings.
 * Run: node backend/scripts/test-stamp-admin-cache.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN_HTML = path.join(ROOT, 'public/admin.html');

require('./stamp-admin-cache.js');

const html = fs.readFileSync(ADMIN_HTML, 'utf8');
assert.ok(/name="eisy-admin-assets" content="20261023nettsSweep"/.test(html), 'admin asset release meta');
assert.ok(/admin\.js\?v=20261023nettsSweep-[a-f0-9]{10}/.test(html), 'content-hashed admin.js');
assert.ok(/adminUserDetail\.js\?v=20261023nettsSweep-[a-f0-9]{10}/.test(html), 'content-hashed adminUserDetail.js');
assert.ok(!html.includes('admin.js?v=20261011userDetailUx'), 'removed stale admin.js cache token');

console.log('test-stamp-admin-cache: OK');
