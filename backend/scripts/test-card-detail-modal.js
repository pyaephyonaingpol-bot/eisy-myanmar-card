#!/usr/bin/env node
'use strict';

/**
 * Virtual card management UI is removed from the customer app.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

assert(!/id="cardDetailModal"/.test(html), 'card detail modal removed');
assert(!/id="pageCards"/.test(html), 'my cards page removed');
assert(!/id="issueCardForm"/.test(html), 'demo issue form removed');
assert(!/cardsApi\.js/.test(html), 'cards API script removed');
assert(!/instantCardView\.js/.test(html), 'card issue view script removed');
assert(!fs.existsSync(path.join(root, 'public/src/services/cardsApi.js')));
assert(!fs.existsSync(path.join(root, 'public/src/components/instantCardView.js')));

console.log('Card management UI removed — ok');
