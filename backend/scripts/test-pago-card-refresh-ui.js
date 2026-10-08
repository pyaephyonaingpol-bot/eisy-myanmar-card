#!/usr/bin/env node
'use strict';

/**
 * Static guards: after Pago create/top-up the dashboard must invalidate TTL,
 * update localStorage cache, force-refresh, and ignore stale in-flight GETs.
 * Run: node backend/scripts/test-pago-card-refresh-ui.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const dash = fs.readFileSync(path.join(root, 'backend/public/dashboard.js'), 'utf8');
const userRoutes = fs.readFileSync(path.join(root, 'backend/src/routes/user.js'), 'utf8');

assert.ok(dash.includes('refreshCardsAfterMutation'), 'mutation helper exists');
assert.ok(dash.includes('applyCardsPayload'), 'payload apply helper exists');
assert.ok(dash.includes('_cardsEpoch'), 'cards epoch guards stale GETs');
assert.ok(
  dash.includes("await this.refreshCardsAfterMutation(data, { selectCardId: selectId })"),
  'submitPagoCardRequest force-refreshes after create'
);
assert.ok(
  dash.includes("await this.refreshCardsAfterMutation(data, { selectCardId: cardId })"),
  'submitPagoCardTopup force-refreshes after top-up'
);
assert.ok(
  dash.includes("if ((this._cardsEpoch || 0) > epochAtStart)"),
  'loadAllCards discards superseded responses'
);
assert.ok(dash.includes("this.invalidateFetch('cards'"), 'cards TTL is invalidated on mutation');
assert.ok(dash.includes('this.saveCardsCache(this.allCards)'), 'localStorage cache updated');
assert.ok(dash.includes("forceRefresh: true"), 'forced network refresh after mutation');

assert.ok(userRoutes.includes('function setCardsNoStore'), 'API no-store helper');
assert.ok(
  /router\.get\('\/cards'[\s\S]*?setCardsNoStore\(res\)/.test(userRoutes),
  'GET /cards sets no-store'
);
assert.ok(
  /router\.post\('\/cards\/request'[\s\S]*?setCardsNoStore\(res\)/.test(userRoutes),
  'POST /cards/request sets no-store'
);
assert.ok(
  /router\.get\('\/cards\/:id'[\s\S]*?setCardsNoStore\(res\)/.test(userRoutes),
  'GET /cards/:id sets no-store'
);

console.log('pago card refresh UI checks passed');
