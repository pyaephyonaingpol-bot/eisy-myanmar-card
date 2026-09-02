/**
 * Blocks withdrawal / master-wallet mutation routes while the incident kill-switch is on.
 */
const {
  areWithdrawalsPaused,
  withdrawalsPausedPayload,
  getSecurityStatus,
} = require('../services/securityFlags');

function requireWithdrawalsEnabled(req, res, next) {
  if (!areWithdrawalsPaused()) return next();
  return res.status(503).json(withdrawalsPausedPayload({
    path: req.originalUrl || req.path,
    security: getSecurityStatus(),
  }));
}

module.exports = {
  requireWithdrawalsEnabled,
};
