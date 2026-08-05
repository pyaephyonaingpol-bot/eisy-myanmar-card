-- 005_support_chat.sql
-- In-app support chatroom (threads + messages)

CREATE TABLE IF NOT EXISTS support_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  subject TEXT DEFAULT 'General Support',
  category TEXT DEFAULT 'general' CHECK(category IN ('general', 'deposit', 'card', 'account', 'technical')),
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'pending', 'closed')),
  priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
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

CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads(status);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'admin', 'system')),
  sender_id INTEGER,
  message TEXT NOT NULL,
  attachment_path TEXT,
  attachment_original_name TEXT,
  attachment_mime_type TEXT,
  read_by_user_at TEXT,
  read_by_admin_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (thread_id) REFERENCES support_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at);
