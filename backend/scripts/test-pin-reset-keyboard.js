#!/usr/bin/env node
'use strict';

/**
 * Mobile PIN-reset keyboard: viewport resizes-content + modal scroll / --kb-inset.
 * Run: node scripts/test-pin-reset-keyboard.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertIncludes(haystack, needle, msg) {
  assert.ok(haystack.includes(needle), msg || `expected: ${needle}`);
}

const indexHtml = read('public/index.html');
const adminHtml = read('public/admin.html');
const viewportJs = read('public/viewport.js');
const stylesCss = read('public/styles.css');
const dashboardJs = read('public/dashboard.js');

assertIncludes(
  indexHtml,
  'interactive-widget=resizes-content',
  'index viewport must resize with soft keyboard'
);
assert.ok(
  !indexHtml.includes('interactive-widget=overlays-content'),
  'index must not overlay keyboard on content'
);
assertIncludes(
  adminHtml,
  'interactive-widget=resizes-content',
  'admin viewport must resize with soft keyboard'
);

assertIncludes(indexHtml, 'id="pinResetEmailSection"', 'PIN reset section present');
assertIncludes(indexHtml, 'id="pinResetConfirmForm"', 'PIN reset confirm form present');
assertIncludes(indexHtml, 'viewport.js?v=20260909pinKb', 'viewport cache bust');
assertIncludes(indexHtml, 'styles.css?v=20260909pinKb', 'styles cache bust');

assertIncludes(viewportJs, 'visualViewport', 'tracks visualViewport');
assertIncludes(viewportJs, '--kb-inset', 'sets keyboard inset CSS var');
assertIncludes(viewportJs, 'ensureVisible', 'expose ensureVisible helper');
assertIncludes(viewportJs, "closest('.modal')", 'scrolls within modal first');

assertIncludes(stylesCss, '--kb-inset', 'CSS keyboard inset variable');
assertIncludes(stylesCss, 'html.kb-open .modal', 'kb-open modal padding');
assertIncludes(stylesCss, 'padding-bottom: max(1rem, var(--safe-bottom), calc(var(--kb-inset, 0px) + 1rem))', 'modal bottom pad for keyboard');
assertIncludes(stylesCss, '#pinResetConfirmForm', 'PIN reset form scroll-margin');

assertIncludes(dashboardJs, 'EisyScroll?.ensureVisible', 'PIN reset focuses use ensureVisible');
assertIncludes(dashboardJs, "confirmForm?.scrollIntoView", 'confirm form scrolled into view');

console.log('PIN reset mobile keyboard viewport/layout — ok');
