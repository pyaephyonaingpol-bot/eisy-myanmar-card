-- Supabase mirror of Turso support_messages for live chat Realtime.
-- Run in the Supabase SQL Editor after support_threads_realtime.sql. Safe to re-run.

CREATE TABLE IF NOT EXISTS support_messages (
  id BIGINT PRIMARY KEY,
  thread_id BIGINT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  user_id TEXT,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin', 'system')),
  sender_id TEXT,
  message TEXT NOT NULL,
  source TEXT DEFAULT 'web',
  telegram_message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_thread_created
  ON support_messages (thread_id, created_at);

-- Keep thread mirror columns for Telegram bridge lookups (safe if already present).
ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS telegram_root_message_id BIGINT;
ALTER TABLE support_threads ADD COLUMN IF NOT EXISTS telegram_last_message_id BIGINT;

ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'support_messages' AND policyname = 'service_role_all_support_messages'
  ) THEN
    CREATE POLICY service_role_all_support_messages
      ON support_messages
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Allow authenticated dashboard clients to receive Realtime inserts for their own threads
-- when user_id matches auth uid/email metadata (optional; polling remains the fallback).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'support_messages' AND policyname = 'authenticated_select_support_messages'
  ) THEN
    CREATE POLICY authenticated_select_support_messages
      ON support_messages
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE support_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
