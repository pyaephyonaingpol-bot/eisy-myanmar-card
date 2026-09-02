/**
 * Incident / production security feature flags.
 *
 * CRITICAL (2026-09 incident): withdrawals and master-wallet on-chain sends
 * default to PAUSED until operators explicitly re-enable after key rotation.
 *
 * Env:
 *   WITHDRAWALS_PAUSED=true|false   (default: true)
 *   AUTO_ONCHAIN_WITHDRAWALS=true|false  (default: false — admin must approve)
 *   MASTER_WALLET_TRANSFERS_PAUSED=true|false  (default: follows WITHDRAWALS_PAUSED)
 */

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return defaultValue;
}

function isProductionRuntime() {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production') return true;
  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV === 'production') return true;
  return false;
}

/** User + admin withdrawal mutation routes are blocked while paused. */
function areWithdrawalsPaused() {
  // Production/Vercel defaults to paused after the wallet incident.
  // Local/test defaults to open so existing scripts keep working unless set.
  return envFlag('WITHDRAWALS_PAUSED', isProductionRuntime());
}

/**
 * Immediate master-wallet TRC20 broadcast on user withdraw request.
 * Default OFF — requests stay pending for admin review.
 */
function isAutoOnchainWithdrawalEnabled() {
  if (areWithdrawalsPaused()) return false;
  return envFlag('AUTO_ONCHAIN_WITHDRAWALS', false);
}

/** Blocks transferUsdtTrc20 / sweep broadcasts while paused. */
function areMasterWalletTransfersPaused() {
  if (areWithdrawalsPaused()) return true;
  return envFlag('MASTER_WALLET_TRANSFERS_PAUSED', isProductionRuntime());
}

function withdrawalsPausedPayload(extra = {}) {
  return {
    success: false,
    error:
      'Withdrawals are temporarily paused due to a security incident. '
      + 'Funds in your app wallet remain recorded; on-chain sends are disabled until further notice.',
    code: 'WITHDRAWALS_PAUSED',
    paused: true,
    ...extra,
  };
}

function assertWithdrawalsNotPaused() {
  if (!areWithdrawalsPaused()) return;
  const err = new Error(withdrawalsPausedPayload().error);
  err.code = 'WITHDRAWALS_PAUSED';
  err.status = 503;
  throw err;
}

function assertMasterWalletTransfersAllowed(action = 'transfer') {
  if (!areMasterWalletTransfersPaused()) return;
  const err = new Error(
    `Master wallet ${action} is paused (WITHDRAWALS_PAUSED / MASTER_WALLET_TRANSFERS_PAUSED). `
    + 'Rotate MASTER_PRIVATE_KEY / TRON_HD_MNEMONIC, move remaining funds to a new cold wallet, '
    + 'then set WITHDRAWALS_PAUSED=false and MASTER_WALLET_TRANSFERS_PAUSED=false.'
  );
  err.code = 'MASTER_WALLET_TRANSFERS_PAUSED';
  err.status = 503;
  throw err;
}

function getSecurityStatus() {
  return {
    production: isProductionRuntime(),
    withdrawals_paused: areWithdrawalsPaused(),
    auto_onchain_withdrawals: isAutoOnchainWithdrawalEnabled(),
    master_wallet_transfers_paused: areMasterWalletTransfersPaused(),
  };
}

module.exports = {
  envFlag,
  isProductionRuntime,
  areWithdrawalsPaused,
  isAutoOnchainWithdrawalEnabled,
  areMasterWalletTransfersPaused,
  withdrawalsPausedPayload,
  assertWithdrawalsNotPaused,
  assertMasterWalletTransfersAllowed,
  getSecurityStatus,
};
