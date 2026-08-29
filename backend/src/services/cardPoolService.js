/**
 * Express-facing wrapper around shared Kripicard pool helpers (`/lib/cardPool.js`).
 */
const path = require('path');

const cardPool = require(path.join(__dirname, '../../../lib/cardPool'));
const supabaseAdmin = require(path.join(__dirname, '../../../lib/supabaseAdmin'));

module.exports = {
  fetchAndStorePoolCards: cardPool.fetchAndStorePoolCards,
  assignCardToUser: cardPool.assignCardToUser,
  assignCardToUserFallback: cardPool.assignCardToUserFallback,
  getPoolStats: cardPool.getPoolStats,
  upsertCardsIntoPool: cardPool.upsertCardsIntoPool,
  isSupabaseAdminEnabled: supabaseAdmin.isSupabaseAdminEnabled,
};
