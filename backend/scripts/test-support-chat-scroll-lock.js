#!/usr/bin/env node
'use strict';

/**
 * Support chat scrolls inside the drawer and does not move the page behind it.
 * Run: node backend/scripts/test-support-chat-scroll-lock.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const chat = fs.readFileSync(path.join(root, 'backend/public/supportChat.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'backend/public/styles.css'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'backend/public/android-scroll-fix.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'backend/public/index.html'), 'utf8');
const instant = fs.readFileSync(path.join(root, 'backend/public/instant.html'), 'utf8');

assert.ok(chat.includes('lockBackgroundScroll'), 'opening the chat locks the page');
assert.ok(chat.includes('unlockBackgroundScroll'), 'closing the chat restores the page');
assert.ok(chat.includes("setProperty('overflow-y', 'hidden', 'important')"), 'lock beats the mobile inline overflow');
assert.ok(chat.includes("setProperty('position', 'fixed', 'important')"), 'body is fixed while chat is open');
assert.ok(chat.includes('overscroll-behavior') || css.includes('overscroll-behavior: contain'), 'chat uses overscroll containment');
assert.ok(css.includes('html.support-chat-scroll-lock'), 'scroll-lock class freezes the document');
assert.ok(css.includes('.support-chat-messages'), 'message list is the chat scroller');
assert.ok(/\.support-chat-messages[\s\S]{0,220}overflow-y:\s*auto/.test(css), 'message list scrolls vertically');
assert.ok(css.includes('overscroll-behavior: contain'), 'chat scroll does not chain');
assert.ok(mobile.includes('html.doc-scroll.support-chat-scroll-lock'), 'mobile sheet keeps the lock');
assert.ok(mobile.includes('touch-action: pan-y !important'), 'chat list still pans on touch');
assert.ok(html.includes('support-chat-scroll-lock'), 'boot script does not unlock an open chat');
assert.ok(html.includes('supportChat.js?v=20261009supportClosed'), 'chat script cache bust');
assert.ok(html.includes('styles.css?v=20261009supportScroll'), 'styles cache bust');
assert.ok(html.includes('android-scroll-fix.css?v=20261009supportScroll'), 'mobile sheet cache bust');
assert.ok(instant.includes('supportChat.js?v=20261009supportClosed'), 'instant portal chat cache bust');

const start = chat.indexOf('function shouldBlockNestedScroll');
const end = chat.indexOf('function chatScroller');
assert.ok(start > 0 && end > start, 'nested scroll guard present');
const fn = chat.slice(start, end);
const sandbox = { Number: Number };
const result = vm.runInNewContext(`
  ${fn}
  const tall = { scrollTop: 40, clientHeight: 100, scrollHeight: 400 };
  const edge = { scrollTop: 0, clientHeight: 100, scrollHeight: 400 };
  const short = { scrollTop: 0, clientHeight: 100, scrollHeight: 80 };
  ({
    middle: shouldBlockNestedScroll(tall, 20),
    top: shouldBlockNestedScroll(edge, -10),
    bottom: shouldBlockNestedScroll({ scrollTop: 300, clientHeight: 100, scrollHeight: 400 }, 12),
    short: shouldBlockNestedScroll(short, 8),
    outside: shouldBlockNestedScroll(null, 8),
  });
`, sandbox);
assert.strictEqual(result.middle, false, 'a scrolling message list keeps the gesture');
assert.strictEqual(result.top, true, 'pulling past the top does not move the page');
assert.strictEqual(result.bottom, true, 'pushing past the bottom does not move the page');
assert.strictEqual(result.short, true, 'a short list does not scroll the page');
assert.strictEqual(result.outside, true, 'a gesture outside the list does not scroll the page');

console.log('Support chat scroll lock — ok');
