#!/usr/bin/env node
'use strict';

/**
 * Soft-remove card from My Cards list (metadata / cancel pending).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const assert = require('assert');
const { initDb, closeDb, getDb } = require('../src/db');
const Card = require('../src/models/Card');
const User = require('../src/models/User');

async function getUserCardsPayload(userId) {
  // Mirror filter used by routes/user.js
  let cards = await Card.findByUserId(userId);
  cards = cards.filter((c) => {
    const status = String(c.status || '').toLowerCase();
    if (['cancelled', 'expired'].includes(status)) return false;
    let metadata = {};
    try { metadata = c.metadata ? JSON.parse(c.metadata) : {}; } catch (_) {}
    if (metadata.removed_by_user) return false;
    return true;
  });
  return cards;
}

async function run() {
  await initDb();
  const db = getDb();
  const stamp = Date.now();
  const email = `card-remove-${stamp}@example.com`;

  const user = await User.create({
    name: 'Card Remove Test',
    phone: `e${String(stamp).slice(-10)}`,
    email,
    pinHash: null,
  });
  assert(user?.id, 'user create failed');

  const issued = await Card.issue({
    userId: user.id,
    cardNumber: '4532876543210987',
    expDate: '12/28',
    cvv: '123',
    cardHolderName: 'TEST USER',
    status: 'active',
    isPrimary: true,
    metadata: { balance_usd: 25 },
  });
  assert(issued?.id, 'card issue failed');

  const pending = await Card.requestPending({
    userId: user.id,
    cardHolderName: 'PENDING USER',
  });
  assert(pending?.id, 'pending request failed');

  let list = await getUserCardsPayload(user.id);
  assert.strictEqual(list.length, 2, 'expected issued + pending before remove');

  const removedIssued = await Card.removeFromUserList(issued.id, user.id, { reason: 'test hide' });
  assert(removedIssued, 'remove issued failed');
  let meta = {};
  try { meta = JSON.parse(removedIssued.metadata || '{}'); } catch (_) {}
  assert.strictEqual(meta.removed_by_user, true);
  assert.strictEqual(String(removedIssued.status).toLowerCase(), 'active', 'issued card should stay active');

  list = await getUserCardsPayload(user.id);
  assert.strictEqual(list.length, 1, 'issued card should be hidden from list');
  assert.strictEqual(list[0].id, pending.id);

  const removedPending = await Card.removeFromUserList(pending.id, user.id);
  assert(removedPending);
  assert.strictEqual(String(removedPending.status).toLowerCase(), 'cancelled');

  list = await getUserCardsPayload(user.id);
  assert.strictEqual(list.length, 0, 'all cards removed from list');

  // Wrong owner must fail
  const other = await Card.removeFromUserList(issued.id, user.id + 9999);
  assert.strictEqual(other, null);

  await db.run('DELETE FROM cards_v2 WHERE user_id = ?', user.id);
  await db.run('DELETE FROM users WHERE id = ?', user.id);

  console.log('CARD REMOVE API TESTS PASSED');
  await closeDb();
}

run().catch(async (err) => {
  console.error(err);
  try { await closeDb(); } catch (_) {}
  process.exit(1);
});
