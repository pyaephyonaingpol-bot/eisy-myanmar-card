-- =============================================================================
-- Enable RLS on public tables that still have it off
-- =============================================================================
-- Safe to re-run in the Supabase SQL Editor (project rszjihypbzsffjdynmok or
-- any later project that shares this schema).
--
-- What it does
--   1. Reports public base tables whose rowsecurity flag is still false.
--   2. ENABLE + FORCE row level security on those tables only.
--   3. Keeps backend access: GRANT ALL to service_role and a policy
--      explicitly TO service_role (USING true / WITH CHECK true).
--   4. Revokes anon and PUBLIC. The browser anon key is used for Auth only;
--      wallet and ledger reads go through Express with the service role.
--   5. If the table has user_id, authenticated users may SELECT their own
--      rows (user_id::text = auth.uid()::text). No other client writes.
--
-- Does not alter Storage, views, or tables that already have RLS.
-- Does not drop existing policies.
-- =============================================================================

-- Tables that still need RLS (run this first if you only want the list).
SELECT c.relname AS table_name,
       c.relkind AS kind,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relrowsecurity = false
ORDER BY 1;

DO $$
DECLARE
  r record;
  has_user_id boolean;
  service_policy text;
  own_policy text;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _rls_enabled_now (
    table_name text PRIMARY KEY
  );
  TRUNCATE _rls_enabled_now;

  FOR r IN
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = false
    ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.name);

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', r.name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', r.name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', r.name);

    service_policy := left('service_role_all_' || r.name, 63);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = r.name
        AND policyname = service_policy
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        service_policy,
        r.name
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = r.name
        AND column_name = 'user_id'
    ) INTO has_user_id;

    IF has_user_id THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', r.name);
      own_policy := left('authenticated_select_own_' || r.name, 63);
      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = r.name
          AND policyname = own_policy
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id IS NOT NULL AND auth.uid() IS NOT NULL AND user_id::text = auth.uid()::text)',
          own_policy,
          r.name
        );
      END IF;
    ELSE
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', r.name);
    END IF;

    INSERT INTO _rls_enabled_now (table_name) VALUES (r.name);
    RAISE NOTICE 'RLS enabled on public.%', r.name;
  END LOOP;
END $$;

-- Empty result means every public base table now has RLS.
SELECT table_name AS rls_enabled_by_this_script
FROM _rls_enabled_now
ORDER BY 1;

SELECT c.relname AS still_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relrowsecurity = false
ORDER BY 1;
