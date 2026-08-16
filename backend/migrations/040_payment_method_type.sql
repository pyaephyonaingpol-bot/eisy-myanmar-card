-- Extend deposit payment methods with type/notes for admin bank settings UI.
-- Also seed starter MMK accounts when the table is empty.

ALTER TABLE deposit_payment_methods ADD COLUMN method_type TEXT NOT NULL DEFAULT 'bank_transfer';
ALTER TABLE deposit_payment_methods ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_deposit_payment_methods_type
  ON deposit_payment_methods (method_type, is_active, sort_order);

-- Starter accounts (only when none exist yet)
INSERT INTO deposit_payment_methods (
  bank_name, account_name, account_number, method_type, is_active, sort_order, notes, updated_at
)
SELECT
  'KBZPay', 'Eisy Myanmar', '09XXXXXXXX', 'kbzpay', 1, 10,
  'Replace with your real KBZPay phone number', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM deposit_payment_methods LIMIT 1);

INSERT INTO deposit_payment_methods (
  bank_name, account_name, account_number, method_type, is_active, sort_order, notes, updated_at
)
SELECT
  'WavePay', 'Eisy Myanmar', '09YYYYYYYY', 'wavepay', 1, 20,
  'Replace with your real WavePay phone number', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM deposit_payment_methods WHERE bank_name = 'WavePay')
  AND EXISTS (SELECT 1 FROM deposit_payment_methods WHERE bank_name = 'KBZPay');
