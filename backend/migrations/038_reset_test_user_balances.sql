-- One-shot wipe of internal test balances after master-wallet cutover.
-- Master wallet USDT/TRX themselves are on-chain (not stored here) and are
-- read live by getMasterWalletInfo() — this migration only clears ledger copies.
--
-- Safe to re-apply: all statements set values to 0 / cancelled.
-- Note: do not touch users.updated_at here — that column is added by a post-migrate patch.

-- 1) User wallets (available + locked USDT, MMK, legacy balance)
UPDATE users
SET
  balance = 0,
  balance_mmk = 0,
  balance_usdt = 0,
  balance_usdt_locked = 0
WHERE COALESCE(balance, 0) != 0
   OR COALESCE(balance_mmk, 0) != 0
   OR COALESCE(balance_usdt, 0) != 0
   OR COALESCE(balance_usdt_locked, 0) != 0;

-- 2) Platform fee / revenue ledger balance (app setting)
INSERT INTO app_settings (key, value, updated_at)
VALUES ('platform_usdt_revenue_balance', '0', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = '0',
  updated_at = datetime('now');

-- 3) P2P merchant liquidity pools + user-ad escrow locks
UPDATE p2p_sellers
SET escrow_balance_usdt = 0
WHERE COALESCE(escrow_balance_usdt, 0) != 0;

UPDATE p2p_ads
SET
  escrow_locked_usdt = 0,
  updated_at = datetime('now')
WHERE COALESCE(escrow_locked_usdt, 0) != 0;

-- 4) Cancel open USDT escrow holds (no refund — balances already zeroed)
UPDATE usdt_escrow_holds
SET
  status = 'cancelled',
  remaining_usdt = 0,
  released_at = datetime('now')
WHERE status = 'active';

-- 5) Cancel pending withdrawals without refund (test ledger wipe)
UPDATE usdt_withdrawal_requests
SET
  status = 'cancelled',
  admin_note = COALESCE(admin_note || ' | ', '') || 'Cancelled by test balance reset',
  processed_at = datetime('now'),
  updated_at = datetime('now')
WHERE status IN ('pending', 'processing');

UPDATE mmk_withdrawal_requests
SET
  status = 'cancelled',
  admin_note = COALESCE(admin_note || ' | ', '') || 'Cancelled by test balance reset',
  processed_at = datetime('now'),
  updated_at = datetime('now')
WHERE status IN ('pending', 'processing');

-- 6) Reject open ledger payment transactions that are still pending
UPDATE transactions
SET status = 'rejected'
WHERE status = 'pending';
