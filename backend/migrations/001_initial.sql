-- 001_initial.sql
-- Baseline schema (compatible with existing Eisy Global installs)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  balance REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_mmk REAL NOT NULL,
  amount_usd REAL NOT NULL,
  ref_code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'PENDING',
  txn_id TEXT,
  payment_method TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_number TEXT NOT NULL,
  exp_date TEXT NOT NULL,
  cvv TEXT NOT NULL,
  card_holder_name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_user_primary_legacy ON cards(user_id);
