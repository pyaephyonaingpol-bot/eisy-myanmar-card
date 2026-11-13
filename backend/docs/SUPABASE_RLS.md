# Supabase RLS (Row Level Security)

## Emergency apply

If the public anon key can read or write other users' rows, run this in the
**Supabase SQL Editor** immediately:

`supabase/security_rls_strict_lockdown.sql`

That script:

1. Enables **and forces** RLS on all known public app tables
2. Drops open policies (`anon_all_*`, mis-scoped `USING (true)` policies)
3. Grants **service_role** full access with explicit `TO service_role`
4. Allows **authenticated** users to **SELECT their own rows only**
   (`auth.uid()` ↔ `user_wallets.auth_user_id` / `user_id`)
5. Leaves **anon** with **no** DML policies on money/support tables
6. Restricts Storage **writes** on `uploads` to service_role (public read kept)
7. Revokes SECURITY DEFINER wallet RPCs from anon/authenticated

## Key usage

| Key | Where | Purpose |
|-----|--------|---------|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser only | Google OAuth / Auth client (`createClient` in SPA) |
| `SUPABASE_SERVICE_ROLE_KEY` | Express / Vercel / Edge only | Dual-write, Storage upload, admin reads — **never** ship to the client |

The web app's financial APIs go through Express with the service role. Do not
query wallets/deposits from the browser with the anon key except for
own-row SELECT after Auth (Realtime optional).

## Verify after apply

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY 1;

SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY 1, 2;
```

Expect no `anon` role on wallet/deposit policies, and authenticated `qual`
expressions that reference `is_own_user_id` / `is_own_wallet_row` / `auth.uid()`.
