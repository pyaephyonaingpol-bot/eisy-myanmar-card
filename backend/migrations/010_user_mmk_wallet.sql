-- Main user wallet balance in MMK (Myanmar Kyat)
ALTER TABLE users ADD COLUMN balance_mmk REAL NOT NULL DEFAULT 0;
