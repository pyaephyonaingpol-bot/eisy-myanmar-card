#!/usr/bin/env node
'use strict';

/**
 * Guard: refreshAuthUI must not reference undeclared `acctInfo`
 * (settings account line is owned by updateProfileFormUI).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dashboardPath = path.join(__dirname, '..', 'public', 'dashboard.js');
const src = fs.readFileSync(dashboardPath, 'utf8');

const start = src.indexOf('refreshAuthUI() {');
assert(start >= 0, 'refreshAuthUI not found');

// Find matching closing of the method at the Dashboard object indent level ("  },")
let depth = 0;
let i = src.indexOf('{', start);
let end = -1;
for (; i < src.length; i += 1) {
  const ch = src[i];
  if (ch === '{') depth += 1;
  else if (ch === '}') {
    depth -= 1;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}
assert(end > start, 'could not parse refreshAuthUI body');
const body = src.slice(start, end + 1);

assert(
  !/\bacctInfo\b/.test(body),
  'refreshAuthUI must not reference undeclared acctInfo — use updateProfileFormUI()'
);
assert(
  /updateProfileFormUI\s*\(/.test(body),
  'refreshAuthUI should call updateProfileFormUI() for settings account info'
);

// updateProfileFormUI must declare and guard acctInfo
const profileStart = src.indexOf('updateProfileFormUI() {');
assert(profileStart >= 0, 'updateProfileFormUI not found');
const profileSnippet = src.slice(profileStart, profileStart + 800);
assert(
  /const acctInfo = \$\(['"]settingsAccountInfo['"]\)/.test(profileSnippet),
  'updateProfileFormUI must declare acctInfo from #settingsAccountInfo'
);
assert(
  /if\s*\(\s*acctInfo\s*\)/.test(profileSnippet),
  'updateProfileFormUI must guard acctInfo before use'
);

console.log('ACCTINFO GUARD TESTS PASSED');
