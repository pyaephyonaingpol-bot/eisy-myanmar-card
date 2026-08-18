/** Deposit / payment request shapes used by the browser SPA. */

export type DepositStatus =
  | 'PENDING'
  | 'AWAITING_SCREENSHOT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FAILED'
  | 'EXPIRED';

export type UsdtNetwork = 'TRC20' | 'BEP20' | 'ERC20';

export interface DepositFeeBreakdown {
  amount_usdt?: number;
  fee_usdt?: number;
  net_usdt?: number;
  fee_percent?: number;
  minimum_fee_usdt?: number;
  fee_label?: string;
  used_minimum_fee?: boolean;
}

export interface DepositRequest {
  id: number;
  ref_code: string;
  user_id: number;
  status: DepositStatus;
  purpose?: string;
  deposit_currency?: 'USDT' | 'MMK' | string;
  usdt_network?: UsdtNetwork | string | null;
  amount_usd?: number;
  amount_mmk?: number;
  tx_hash?: string | null;
  txn_id?: string | null;
  kpay_transaction_id?: string | null;
  payment_method?: string | null;
  created_at?: string;
  updated_at?: string;
  fee_breakdown?: DepositFeeBreakdown | null;
  is_p2p?: boolean;
}

export interface UsdtDepositCreateBody {
  deposit_type: 'usdt';
  amount_usdt: number;
  network: UsdtNetwork;
  deposit_channel?: string;
}

export interface UsdtDepositSubmitBody {
  deposit_id: number;
  tx_hash: string;
  txn_id?: string;
  user_note?: string;
}
