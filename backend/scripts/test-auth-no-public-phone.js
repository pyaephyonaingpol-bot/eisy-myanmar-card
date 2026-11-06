#!/usr/bin/env node
'use strict';

/**
 * Login/signup UI must not show company support phone numbers.
 * Run: node backend/scripts/test-auth-no-public-phone.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const banned = [
  /971505176334/,
  /wa\.me\/971/,
  /tel:\+?971/,
  /Phone \/ WhatsApp/i,
  /517 6334/,
];

for (const file of ['index.html', 'instant.html']) {
  const html = read(file);
  const authStart = html.indexOf('id="authScreen"');
  const authEnd = html.indexOf('id="dashboardScreen"');
  assert.ok(authStart >= 0 && authEnd > authStart, `${file} auth block`);
  const auth = html.slice(authStart, authEnd);
  assert.ok(auth.includes('authOfficialSupport'), `${file} auth support mount`);
  assert.ok(!auth.includes('data-contact-modal-open'), `${file} auth must not open contact modal`);
  for (const pattern of banned) {
    assert.ok(!pattern.test(auth), `${file} auth must not match ${pattern}`);
  }
}

const contactJs = read('contactInfo.js');
assert.ok(contactJs.includes('renderAuthSupportLinks'), 'contactInfo auth links');
for (const pattern of banned) {
  assert.ok(!pattern.test(contactJs), `contactInfo must not match ${pattern}`);
}

console.log('Auth UI — no public phone — ok');
