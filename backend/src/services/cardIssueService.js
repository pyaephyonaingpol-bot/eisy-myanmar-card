/**
 * Express-facing wrapper for real-time Kripicard issuance.
 */
const path = require('path');

const cardIssue = require(path.join(__dirname, '../../../lib/cardIssue'));
const supabaseAdmin = require(path.join(__dirname, '../../../lib/supabaseAdmin'));

module.exports = {
  issueCardForUser: cardIssue.issueCardForUser,
  validateIssueInput: cardIssue.validateIssueInput,
  storeIssuedCard: cardIssue.storeIssuedCard,
  publicUserCard: cardIssue.publicUserCard,
  isSupabaseAdminEnabled: supabaseAdmin.isSupabaseAdminEnabled,
};
