#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const index = fs.readFileSync(path.join(ROOT, 'backend/public/index.html'), 'utf8');
const contactJs = fs.readFileSync(path.join(ROOT, 'backend/public/contactInfo.js'), 'utf8');
const supportChat = fs.readFileSync(path.join(ROOT, 'backend/public/supportChat.js'), 'utf8');
const about = fs.readFileSync(path.join(ROOT, 'backend/public/about.html'), 'utf8');

const email = 'pyaephyo.naing@eisymyanmar.com';
const phone = '971505176334';
const telegram = 'eisymyanmar';

assert.ok(contactJs.includes(email), 'contact module email');
assert.ok(contactJs.includes(phone), 'contact module phone');
assert.ok(contactJs.includes('@eisymyanmar'), 'contact module telegram');
assert.ok(contactJs.includes('Al Batal building 302'), 'contact module address');
assert.ok(contactJs.includes('official-contact-icon'), 'contact icons');

assert.ok(index.includes('contactInfo.js?v=20261010contact'), 'index loads contactInfo');
assert.ok(index.includes('data-official-contact="compact"'), 'footer contact mount');
assert.ok(index.includes('data-official-contact="default"'), 'settings contact section');

assert.ok(supportChat.includes('supportChatContact'), 'live chat contact footer');
assert.ok(about.includes('data-official-contact="legal"'), 'about contact block');

console.log('Official contact details — ok');
