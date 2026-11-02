#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'backend/public');
const index = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const contactJs = fs.readFileSync(path.join(PUBLIC, 'contactInfo.js'), 'utf8');
const supportChat = fs.readFileSync(path.join(PUBLIC, 'supportChat.js'), 'utf8');
const about = fs.readFileSync(path.join(PUBLIC, 'about.html'), 'utf8');

const email = 'pyaephyo.naing@eisymyanmar.com';
const telegram = 'eisymyanmar';
const bannedPublicPatterns = [
  /971505176334/,
  /wa\.me\/971/,
  /tel:\+?971/,
  /Phone \/ WhatsApp/i,
  /phoneLabel/,
  /whatsappUrl/,
];

assert.ok(contactJs.includes(email), 'contact module email');
assert.ok(contactJs.includes('@eisymyanmar'), 'contact module telegram');
assert.ok(contactJs.includes('Al Batal building 302'), 'contact module address');
assert.ok(contactJs.includes('official-contact-icon'), 'contact icons');
assert.ok(!contactJs.includes('971505176334'), 'contact module must not expose phone');

assert.ok(index.includes('contactInfo.js?v=20261013noPhone'), 'index loads contactInfo (cache bust)');
assert.ok(index.includes('id="authOfficialSupport"'), 'auth mounts support links container');
assert.ok(index.includes('data-contact-modal-open'), 'logged-in sidebar contact modal remains');
assert.ok(!index.includes('sidebar-footer') || !index.match(/sidebar-footer[\s\S]*data-official-contact="compact"/), 'sidebar inline contact removed');
assert.ok(index.includes('data-official-contact="default"'), 'settings contact section');
assert.ok(contactJs.includes('renderAuthSupportLinks'), 'auth support link renderer');
assert.ok(contactJs.includes('authOfficialSupport'), 'auth support mount hook');
assert.ok(contactJs.includes('openContactModal'), 'contact modal API');
assert.ok(contactJs.includes('officialContactModal'), 'contact modal shell');

const authStart = index.indexOf('id="authScreen"');
const authEnd = index.indexOf('id="dashboardScreen"');
assert.ok(authStart >= 0 && authEnd > authStart, 'auth screen block');
const authBlock = index.slice(authStart, authEnd);
assert.ok(!authBlock.includes('data-contact-modal-open'), 'auth card must not use contact modal');
for (const pattern of bannedPublicPatterns) {
  assert.ok(!pattern.test(authBlock), `auth UI must not match public phone pattern ${pattern}`);
}

assert.ok(supportChat.includes('supportChatContact'), 'live chat contact footer');
assert.ok(about.includes('data-official-contact="legal"'), 'about contact block');

const htmlFiles = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  const text = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  for (const pattern of bannedPublicPatterns) {
    assert.ok(!pattern.test(text), `${file} must not match public phone pattern ${pattern}`);
  }
}

for (const pattern of bannedPublicPatterns) {
  assert.ok(!pattern.test(contactJs), `contactInfo.js must not match ${pattern}`);
}

console.log('Official contact details — ok');
