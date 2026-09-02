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
const { isCardVisibleInUserList } = require('../src/constants/cardStatuses');

async function getUserCardsPayload(userId) {
  const db = getDb();
  const allV2 = await Card.findByUserId(userId);
  let cards = allV2.filter(isCardVisibleInUserList);

  if (!cards.length) {
    const countRow = await db.get(
      'SELECT COUNT(*) AS c FROM cards_v2 WHERE user_id = ?',
      userId
    );
    const hasV2Rows = Number(countRow?.c || 0) > 0;
    if (!hasV2Rows) {
      const legacy = await db.get('SELECT * FROM cards WHERE user_id = ?', userId);
      if (legacy) {
        const legacyCard = {
          ...legacy,
          status: 'active',
          is_primary: 1,
          metadata: null,
        };
        if (isCardVisibleInUserList(legacyCard)) {
          cards = [legacyCard];
        }
      }
    }
  }

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

  // Terminated cards must not appear in My Cards
  const terminated = await Card.issue({
    userId: user.id,
    cardNumber: '4111111111111111',
    expDate: '01/29',
    cvv: '999',
    cardHolderName: 'TERMINATED USER',
    status: 'terminated',
    isPrimary: false,
  });
  assert(terminated?.id, 'terminated card issue failed');
  list = await getUserCardsPayload(user.id);
  assert.strictEqual(list.length, 0, 'terminated card must be hidden');

  // Legacy fallback must not resurrect when cards_v2 rows exist but are all hidden
  await db.run(
    `INSERT INTO cards (user_id, card_number, exp_date, cvv, card_holder_name, created_at)
     VALUES (?, '4000000000000002', '06/30', '321', 'LEGACY GHOST', datetime('now'))`,
    user.id
  );
  list = await getUserCardsPayload(user.id);
  assert.strictEqual(list.length, 0, 'legacy card must not appear when cards_v2 rows exist');

  // Wrong owner must fail
  const other = await Card.removeFromUserList(issued.id, user.id + 9999);
  assert.strictEqual(other, null);

  await db.run('DELETE FROM cards WHERE user_id = ?', user.id);
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
