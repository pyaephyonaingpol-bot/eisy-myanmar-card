-- Dual-currency wallet: USDT balance on users
ALTER TABLE users ADD COLUMN balance_usdt REAL NOT NULL DEFAULT 0;
