/**
 * Express-facing wrapper for real-time Kripicard virtual-card issuance (Non-KYC).
 */
const path = require('path');

const kripicardIssue = require(path.join(__dirname, '../../../lib/kripicardCardIssue'));
const supabaseAdmin = require(path.join(__dirname, '../../../lib/supabaseAdmin'));

module.exports = {
  issueKripicardForUser: kripicardIssue.issueCardForUser,
  validateIssueInput: kripicardIssue.validateIssueInput,
  storeIssuedCard: kripicardIssue.storeIssuedCard,
  publicUserCard: kripicardIssue.publicUserCard,
  createAndPersistKripicardCard: kripicardIssue.createAndPersistKripicardCard,
  isSupabaseAdminEnabled: supabaseAdmin.isSupabaseAdminEnabled,
};
