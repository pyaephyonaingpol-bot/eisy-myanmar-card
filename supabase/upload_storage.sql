-- Supabase Storage for deposit receipts, P2P proofs, and KYC images.
-- Run in Supabase SQL Editor after creating the project.
--
-- Server env (Vercel / backend):
--   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY=...
--   SUPABASE_UPLOAD_BUCKET=uploads   (optional, default: uploads)
--   SUPABASE_UPLOAD_STORAGE=true     (optional; defaults on when Supabase is configured)

INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

-- Public read for proof/receipt images (same as legacy /uploads static URLs).
DROP POLICY IF EXISTS "Public read uploads bucket" ON storage.objects;
CREATE POLICY "Public read uploads bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'uploads');

-- Service role uploads bypass RLS; anon/authenticated insert is denied by default.
DROP POLICY IF EXISTS "Service role manage uploads bucket" ON storage.objects;
CREATE POLICY "Service role manage uploads bucket"
ON storage.objects FOR ALL
USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');
