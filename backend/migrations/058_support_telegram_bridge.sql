-- 058_support_telegram_bridge.sql
-- Telegram 2-way bridge metadata for support threads/messages.

ALTER TABLE support_threads ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE support_threads ADD COLUMN telegram_root_message_id INTEGER;
ALTER TABLE support_threads ADD COLUMN telegram_last_outbound_id INTEGER;

ALTER TABLE support_messages ADD COLUMN source TEXT DEFAULT 'web';
ALTER TABLE support_messages ADD COLUMN telegram_message_id INTEGER;
ALTER TABLE support_messages ADD COLUMN telegram_chat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_support_threads_telegram_root
  ON support_threads(telegram_chat_id, telegram_root_message_id);

CREATE INDEX IF NOT EXISTS idx_support_messages_telegram
  ON support_messages(telegram_chat_id, telegram_message_id);
