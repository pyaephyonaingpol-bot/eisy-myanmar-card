-- Bitnob Card KYC profile fields for Standard pipeline.
-- Platform KYC docs feed Bitnob POST /api/cards/kyc → customer_id for card issue.

ALTER TABLE users ADD COLUMN bitnob_kyc_status TEXT;
ALTER TABLE users ADD COLUMN bitnob_kyc_reason TEXT;
ALTER TABLE users ADD COLUMN bitnob_kyc_submitted_at TEXT;
ALTER TABLE users ADD COLUMN bitnob_kyc_completion_link TEXT;

ALTER TABLE kyc_submissions ADD COLUMN date_of_birth TEXT;
ALTER TABLE kyc_submissions ADD COLUMN address_line1 TEXT;
ALTER TABLE kyc_submissions ADD COLUMN address_line2 TEXT;
ALTER TABLE kyc_submissions ADD COLUMN address_city TEXT;
ALTER TABLE kyc_submissions ADD COLUMN address_state TEXT;
ALTER TABLE kyc_submissions ADD COLUMN address_postal TEXT;
ALTER TABLE kyc_submissions ADD COLUMN address_country TEXT DEFAULT 'MMR';
ALTER TABLE kyc_submissions ADD COLUMN occupation TEXT;
ALTER TABLE kyc_submissions ADD COLUMN employment_status TEXT;
ALTER TABLE kyc_submissions ADD COLUMN account_purpose TEXT;
ALTER TABLE kyc_submissions ADD COLUMN annual_salary TEXT;
ALTER TABLE kyc_submissions ADD COLUMN expected_monthly_volume TEXT;
ALTER TABLE kyc_submissions ADD COLUMN bitnob_customer_id TEXT;
ALTER TABLE kyc_submissions ADD COLUMN bitnob_kyc_status TEXT;
