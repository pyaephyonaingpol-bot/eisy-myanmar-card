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
const assetVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'backend/public/asset-version.json'), 'utf8'),
);
const supportChatBust = assetVersion.assets['/supportChat.js'];
const stylesBust = assetVersion.assets['/styles.css'];
assert.ok(supportChatBust && stylesBust, 'asset-version lists support chat and styles');

assert.ok(chat.includes('lockBackgroundScroll'), 'opening the chat locks the page');
assert.ok(chat.includes('unlockBackgroundScroll'), 'closing the chat restores the page');
assert.ok(chat.includes("setProperty('overflow-y', 'hidden', 'important')"), 'lock beats the mobile inline overflow');
assert.ok(chat.includes("setProperty('position', 'fixed', 'important')"), 'body is fixed while chat is open');
assert.ok(chat.includes('overscroll-behavior') || css.includes('overscroll-behavior: contain'), 'chat uses overscroll containment');
assert.ok(css.includes('html.support-chat-scroll-lock'), 'scroll-lock class freezes the document');
assert.ok(css.includes('.support-chat-scroll-region'), 'panel uses a dedicated scroll region');
assert.ok(css.includes('.support-chat-messages'), 'message list is the chat scroller');
assert.ok(/\.support-chat-messages[\s\S]{0,220}overflow-y:\s*auto/.test(css), 'message list scrolls vertically');
assert.ok(/@media \(max-width: 640px\)[\s\S]{0,1600}env\(safe-area-inset-bottom\)/.test(css), 'mobile drawer respects safe-area insets');
assert.ok(/\.support-chat-panel[\s\S]{0,400}z-index:\s*10050/.test(css), 'panel stacks above card chrome');
assert.ok(!/supportChatContact[\s\S]{0,80}<\/div>\s*'<\/section>/.test(chat), 'contact footer is outside scroll region');
assert.ok(
  /supportChatScrollRegion[\s\S]{0,400}supportChatContact/.test(chat) &&
    /id=\"supportChatContact\"/.test(chat) &&
    /class=\"support-chat-contact\"/.test(chat),
  'contact footer is panel sibling (outside scroll region)',
);
assert.ok(chat.includes('is-panel-open'), 'fab hides while panel is open');
assert.ok(css.includes('overscroll-behavior: contain'), 'chat scroll does not chain');
assert.ok(mobile.includes('html.doc-scroll.support-chat-scroll-lock'), 'mobile sheet keeps the lock');
assert.ok(mobile.includes('touch-action: pan-y !important'), 'chat list still pans on touch');
assert.ok(html.includes('support-chat-scroll-lock'), 'boot script does not unlock an open chat');
assert.ok(html.includes(`supportChat.js?v=${supportChatBust}`), 'chat script cache bust');
assert.ok(html.includes(`styles.css?v=${stylesBust}`), 'styles cache bust');
assert.ok(/android-scroll-fix\.css\?v=/.test(html), 'mobile sheet cache bust');
assert.ok(instant.includes(`supportChat.js?v=${supportChatBust}`), 'instant portal chat cache bust');
{
  const scrollIdx = chat.indexOf('supportChatScrollRegion');
  const scrollClose = chat.indexOf("'  </div>'", scrollIdx);
  assert.ok(scrollIdx > 0 && scrollClose > scrollIdx, 'scroll region markup present');
  const scrollBlock = chat.slice(scrollIdx, scrollClose);
  assert.ok(scrollBlock.includes('supportChatBody'), 'scroll region wraps chat body');
  assert.ok(!scrollBlock.includes('support-chat-contact'), 'contact footer is not inside scroll region');
}

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
