-- 053_user_terms_acceptance.sql
-- Persist Terms & Conditions acceptance at registration.

ALTER TABLE users ADD COLUMN terms_accepted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE users ADD COLUMN terms_version TEXT;
