-- Payment proof slip for completed bank withdrawals (admin upload → user email/receipt)

ALTER TABLE mmk_withdrawal_requests ADD COLUMN proof_path TEXT;
ALTER TABLE mmk_withdrawal_requests ADD COLUMN proof_url TEXT;
ALTER TABLE mmk_withdrawal_requests ADD COLUMN proof_mime_type TEXT;
ALTER TABLE mmk_withdrawal_requests ADD COLUMN proof_original_name TEXT;
ALTER TABLE mmk_withdrawal_requests ADD COLUMN proof_uploaded_at TEXT;
ALTER TABLE mmk_withdrawal_requests ADD COLUMN proof_uploaded_by INTEGER;

ALTER TABLE usdt_withdrawal_requests ADD COLUMN proof_path TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN proof_url TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN proof_mime_type TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN proof_original_name TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN proof_uploaded_at TEXT;
ALTER TABLE usdt_withdrawal_requests ADD COLUMN proof_uploaded_by INTEGER;
