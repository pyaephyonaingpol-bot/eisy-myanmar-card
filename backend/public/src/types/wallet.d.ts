/** Withdrawal / USDT wallet shapes used by the browser SPA. */

import type { UsdtNetwork } from './deposit';

export type WithdrawalPayoutMethod = 'crypto' | 'bank';

export interface WithdrawalFeePreview {
  amount_usdt: number;
  fee_usdt: number;
  net_usdt: number;
  fee_percent: number;
  fee_label?: string;
  minimum_usdt_withdrawal?: number;
  below_minimum?: boolean;
  network?: UsdtNetwork | 'BANK' | string;
}

export interface UsdtWithdrawalRequest {
  id: number;
  ref_code: string;
  status: string;
  amount_usdt: number;
  net_usdt?: number;
  network?: string | null;
  payout_method?: WithdrawalPayoutMethod | string;
  wallet_address?: string | null;
  tx_hash?: string | null;
}

export interface LinkedUsdtWalletAddress {
  id?: number;
  network: UsdtNetwork | string;
  address: string;
  label?: string | null;
}
