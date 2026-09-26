/**
 * Express-facing wrapper for real-time Bitnob virtual-card issuance.
 */
const path = require('path');

const cardIssue = require(path.join(__dirname, '../../../lib/cardIssue'));
const bitnobService = require('./bitnobService');
const supabaseAdmin = require(path.join(__dirname, '../../../lib/supabaseAdmin'));

module.exports = {
  issueCardForUser: cardIssue.issueCardForUser,
  validateIssueInput: cardIssue.validateIssueInput,
  storeIssuedCard: cardIssue.storeIssuedCard,
  publicUserCard: cardIssue.publicUserCard,
  createAndPersistBitnobCard: cardIssue.createAndPersistBitnobCard,
  resolveBitnobCustomerId: cardIssue.resolveBitnobCustomerId,
  assertBitnobConfigured: cardIssue.assertBitnobConfigured,
  getCardDetails: bitnobService.getCardDetails,
  getSecureCardDetails: bitnobService.getSecureCardDetails,
  fundCard: bitnobService.fundCard,
  createVirtualCardFromUsdt: bitnobService.createVirtualCardFromUsdt,
  fundVirtualCardFromUsdt: bitnobService.fundVirtualCardFromUsdt,
  isSupabaseAdminEnabled: supabaseAdmin.isSupabaseAdminEnabled,
};
