-- NOWPayments mass-payout tracking on USDT withdrawals
ALTER TABLE usdt_withdrawal_requests ADD COLUMN payout_provider TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN payout_currency TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN nowpayments_payout_id TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN nowpayments_withdrawal_id TEXT;

CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_np_payout
  ON usdt_withdrawal_requests(nowpayments_payout_id);
CREATE INDEX IF NOT EXISTS idx_usdt_withdrawals_np_withdrawal
  ON usdt_withdrawal_requests(nowpayments_withdrawal_id);
