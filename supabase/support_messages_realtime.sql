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

-- Authenticated clients may SELECT only their own thread messages (never USING true).
DROP POLICY IF EXISTS authenticated_select_support_messages ON support_messages;
DROP POLICY IF EXISTS "authenticated_select_own_support_messages" ON support_messages;
CREATE POLICY "authenticated_select_own_support_messages"
  ON support_messages
  FOR SELECT
  TO authenticated
  USING (
    (
      user_id IS NOT NULL
      AND auth.uid() IS NOT NULL
      AND (
        user_id = auth.uid()::text
        OR EXISTS (
          SELECT 1 FROM public.user_wallets w
          WHERE w.user_id = support_messages.user_id
            AND w.auth_user_id = auth.uid()::text
        )
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.support_threads t
      WHERE t.id = support_messages.thread_id
        AND t.user_id IS NOT NULL
        AND auth.uid() IS NOT NULL
        AND (
          t.user_id = auth.uid()::text
          OR EXISTS (
            SELECT 1 FROM public.user_wallets w
            WHERE w.user_id = t.user_id
              AND w.auth_user_id = auth.uid()::text
          )
        )
    )
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE support_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
