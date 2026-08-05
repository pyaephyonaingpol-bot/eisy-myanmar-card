-- 029_user_password.sql — optional account password (separate from 6-digit PIN)

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_set_at TEXT;
