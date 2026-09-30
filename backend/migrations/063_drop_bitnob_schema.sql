-- Retire Bitnob dual-wallet / Standard Card schema (061/062 artifacts).
-- Card creation and crypto deposits are Kripicard API only after this migration.
-- Keeps general KYC profile columns from 062 (date_of_birth, address, occupation, etc.).
-- SQLite supports DROP COLUMN (3.35+) but not "DROP COLUMN IF EXISTS".

DROP TABLE IF EXISTS bitnob_wallet_ledger;
DROP TABLE IF EXISTS bitnob_deposit_events;

ALTER TABLE users DROP COLUMN balance_bitnob_usdt;
ALTER TABLE users DROP COLUMN bitnob_customer_id;
ALTER TABLE users DROP COLUMN bitnob_deposit_address;
ALTER TABLE users DROP COLUMN bitnob_deposit_chain;
ALTER TABLE users DROP COLUMN bitnob_deposit_address_id;
ALTER TABLE users DROP COLUMN bitnob_deposit_reference;
ALTER TABLE users DROP COLUMN bitnob_kyc_status;
ALTER TABLE users DROP COLUMN bitnob_kyc_reason;
ALTER TABLE users DROP COLUMN bitnob_kyc_submitted_at;
ALTER TABLE users DROP COLUMN bitnob_kyc_completion_link;

ALTER TABLE kyc_submissions DROP COLUMN bitnob_customer_id;
ALTER TABLE kyc_submissions DROP COLUMN bitnob_kyc_status;
