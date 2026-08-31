#!/usr/bin/env node
'use strict';

/**
 * Guard: Card purchase form exposes only the Kripicard BIN <select>,
 * with no redundant free-text BIN input.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'public', 'dashboard.js'), 'utf8');

const formStart = html.indexOf('id="cardRequestForm"');
assert(formStart >= 0, 'cardRequestForm missing');
const formEnd = html.indexOf('</form>', formStart);
const form = html.slice(formStart, formEnd);

assert(/id="cardBinSelect"/.test(form), 'cardBinSelect dropdown required');
assert(!/id="cardBinInput"/.test(form), 'cardBinInput text field must be removed');
assert(!/id="cardBinInput"/.test(html), 'cardBinInput must not exist anywhere in index.html');
assert(!/cardBinInput/.test(dash), 'dashboard.js must not reference cardBinInput');
assert(/getSelectedCardBin\(\)\s*\{[\s\S]*?cardBinSelect/.test(dash), 'getSelectedCardBin must read from select');

console.log('CARD BIN DROPDOWN GUARD PASSED');
