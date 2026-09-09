-- Expand support threads into an admin task queue for MMK Payouts + Card Issuing.
-- Remap legacy status/priority values and widen CHECK constraints.
-- FK off: support_messages references support_threads during table rebuild.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS support_threads__v056 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT DEFAULT 'General Support',
  category TEXT DEFAULT 'general' CHECK(category IN (
    'general', 'deposit', 'card', 'account', 'technical',
    'mmk_payouts', 'card_issuing'
  )),
  status TEXT DEFAULT 'pending' CHECK(status IN (
    'pending', 'in_progress', 'completed', 'failed',
    'open', 'closed'
  )),
  priority TEXT DEFAULT 'medium' CHECK(priority IN (
    'low', 'medium', 'high',
    'normal', 'urgent'
  )),
  assigned_admin_id INTEGER,
  last_message_at TEXT,
  last_message_preview TEXT,
  unread_by_user INTEGER DEFAULT 0,
  unread_by_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO support_threads__v056 (
  id, user_id, subject, category, status, priority, assigned_admin_id,
  last_message_at, last_message_preview, unread_by_user, unread_by_admin,
  created_at, updated_at, closed_at
)
SELECT
  id,
  user_id,
  subject,
  CASE
    WHEN category = 'card' THEN 'card_issuing'
    ELSE COALESCE(category, 'general')
  END,
  CASE
    WHEN status = 'open' THEN 'pending'
    WHEN status = 'closed' THEN 'completed'
    WHEN status IN ('pending', 'in_progress', 'completed', 'failed') THEN status
    ELSE 'pending'
  END,
  CASE
    WHEN priority IN ('urgent', 'high') THEN 'high'
    WHEN priority = 'low' THEN 'low'
    ELSE 'medium'
  END,
  assigned_admin_id,
  last_message_at,
  last_message_preview,
  unread_by_user,
  unread_by_admin,
  created_at,
  updated_at,
  closed_at
FROM support_threads;

DROP TABLE support_threads;
ALTER TABLE support_threads__v056 RENAME TO support_threads;

CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads(status);
CREATE INDEX IF NOT EXISTS idx_support_threads_category ON support_threads(category);
CREATE INDEX IF NOT EXISTS idx_support_threads_priority ON support_threads(priority);
CREATE INDEX IF NOT EXISTS idx_support_threads_priority_status_updated
  ON support_threads(priority, status, updated_at DESC);

PRAGMA foreign_keys = ON;
