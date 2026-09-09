-- Supabase mirror of Turso support_threads for Admin Realtime alerts.
-- Run in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS support_threads (
  id BIGINT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  user_name TEXT,
  subject TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  last_message_preview TEXT,
  unread_by_admin INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_support_threads_priority_status
  ON support_threads (priority, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_threads_category
  ON support_threads (category);

ALTER TABLE support_threads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'support_threads' AND policyname = 'service_role_all_support_threads'
  ) THEN
    CREATE POLICY service_role_all_support_threads
      ON support_threads
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Enable Realtime for urgent admin popups (ignore if already added).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE support_threads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
