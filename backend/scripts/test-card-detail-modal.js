#!/usr/bin/env node
'use strict';

/**
 * Guard: My Cards click-to-view detail modal + soft-remove API wiring.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const dash = fs.readFileSync(path.join(root, 'public', 'dashboard.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const api = fs.readFileSync(path.join(root, 'public', 'src', 'services', 'cardsApi.js'), 'utf8');
const userRoutes = fs.readFileSync(path.join(root, 'src', 'routes', 'user.js'), 'utf8');
const cardModel = fs.readFileSync(path.join(root, 'src', 'models', 'Card.js'), 'utf8');

assert(/id="cardDetailModal"/.test(html), 'cardDetailModal markup required');
assert(/id="cardDetailModalClose"/.test(html), 'modal close X required');
assert(/id="cardDetailDeleteBtn"/.test(html), 'Delete Card button required');
assert(/id="cardDetailReloadBtn"/.test(html), 'Reload button in modal required');
assert(/id="cardDetailRevealBtn"/.test(html), 'Reveal details button required');

assert(/openCardDetailModal/.test(dash), 'openCardDetailModal required');
assert(/closeCardDetailModal/.test(dash), 'closeCardDetailModal required');
assert(/bindCardDetailModal/.test(dash), 'bindCardDetailModal required');
assert(/removeCardFromDetailModal/.test(dash), 'remove handler required');
assert(/this\.openCardDetailModal\(idx\)/.test(dash), 'thumb click must open modal');
assert(/e\.key !== 'Escape'/.test(dash) || /e\.key === 'Escape'/.test(dash), 'Escape closes modal');

assert(/card-detail-modal-box/.test(css), 'modal styles required');
assert(/backdrop-filter:\s*blur/.test(css), 'backdrop blur still present on .modal');

assert(/remove\(cardId/.test(api), 'cardsApi.remove required');
assert(/\/cards\/\$\{cardId\}\/remove/.test(api) || /\/cards\/\${cardId}\/remove/.test(api), 'remove endpoint path');

assert(/\/cards\/:id\/remove/.test(userRoutes), 'user remove route required');
assert(/removed_by_user/.test(userRoutes), 'payload must filter removed_by_user');
assert(/removeFromUserList/.test(cardModel), 'Card.removeFromUserList required');

console.log('CARD DETAIL MODAL GUARD PASSED');
