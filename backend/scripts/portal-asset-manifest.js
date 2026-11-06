'use strict';

/**
 * Portal shell assets that must stay cache-busted together when routing/UI changes.
 * Bump `release` on intentional deploys; each file also gets a content hash suffix.
 */
module.exports = {
  release: '20261011p2pRoute',
  /** Paths under backend/public/ (also used as URL path with leading /). */
  assets: [
    'dashboard.js',
    'nav.js',
    'styles.css',
    'src/lib/p2pEscrowFlow.js',
    'src/services/p2pApi.js',
    'viewport.js',
    'supportChat.js',
  ],
};
