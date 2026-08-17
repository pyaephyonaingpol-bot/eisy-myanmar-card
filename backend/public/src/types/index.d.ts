/**
 * Barrel re-exports for shared SPA types.
 * Runtime JS can reference these via JSDoc `@typedef` / `@type` imports in editors.
 */

export type {
  PublicUser,
  AuthSession,
  DeviceProfile,
  WalletBalances,
} from './user';

export type {
  DepositStatus,
  UsdtNetwork,
  DepositFeeBreakdown,
  DepositRequest,
  UsdtDepositCreateBody,
  UsdtDepositSubmitBody,
} from './deposit';

export type {
  WithdrawalPayoutMethod,
  WithdrawalFeePreview,
  UsdtWithdrawalRequest,
  LinkedUsdtWalletAddress,
} from './wallet';
