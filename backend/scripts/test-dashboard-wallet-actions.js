#!/usr/bin/env node
'use strict';

/**
 * Dashboard wallet actions must not duplicate the My Cards CTA.
 * Run: node backend/scripts/test-dashboard-wallet-actions.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');

function walletActionsBlock(html) {
  const marker = 'class="wallet-hero-actions-row"';
  const start = html.indexOf(marker);
  assert.ok(start > 0, 'wallet-hero-actions-row present');
  const end = html.indexOf('</div>', start);
  assert.ok(end > start, 'wallet actions row closes');
  return html.slice(start, end);
}

for (const file of ['backend/public/index.html', 'backend/public/instant.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const block = walletActionsBlock(html);
  const myCards = (block.match(/data-i18n="nav_my_cards"/g) || []).length;
  assert.strictEqual(myCards, 1, `${file}: exactly one My Cards button in wallet actions`);
  assert.ok(block.includes('btn_manage_usdt_wallet'), `${file}: Manage Wallet`);
  assert.ok(block.includes('btn_top_up_usdt'), `${file}: Top Up USDT`);
  assert.ok(block.includes('btn_withdraw_usdt'), `${file}: Withdraw USDT`);
  assert.ok(!block.includes('Virtual Cards'), `${file}: no duplicate Virtual Cards CTA`);
}

console.log('Dashboard wallet actions — ok');
