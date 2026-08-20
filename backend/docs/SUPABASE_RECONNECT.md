# Reconnect original Supabase (without data loss)

## Architecture (important)

| Store | Role |
|-------|------|
| **Turso / LibSQL** (`DATABASE_URL`) | **Source of truth** for users, wallets, deposits, cards, P2P, transaction logs |
| **Supabase** | Optional dual-write / Realtime mirror (`user_wallets`, deposits, cards, activity) |

Historical user profiles and transactions live in Turso. Reconnecting Supabase does **not** replace Turso — it re-enables cloud sync and backfills mirrors.

## Current production check

```bash
curl -sS https://eisymyanmar.com/health
curl -sS https://eisymyanmar.com/api/config/supabase
```

Expected after reconnect:

- `database.url` → `libsql://eisymyanmar-pyaephyonaingpol-bot.aws-ap-northeast-1.turso.io` (`persistent: true`)
- `supabase.enabled` → `true`
- `/api/config/supabase` → `{ "enabled": true, "url": "https://YOUR_PROJECT.supabase.co", ... }`

## Steps

1. **Vercel → Environment Variables (Production)**  
   Set from the **original** Supabase project (Settings → API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`  
   Keep existing Turso vars:
   - `DATABASE_URL=libsql://eisymyanmar-pyaephyonaingpol-bot.aws-ap-northeast-1.turso.io`
   - `DATABASE_AUTH_TOKEN=…`

2. **Supabase SQL Editor** — run:
   - `supabase/schema.sql`
   - `supabase/auth_profiles.sql`  
   Enable Realtime for the listed tables.

3. **Redeploy** the Vercel production deployment.

4. **Backfill** historical Turso → Supabase (safe upsert, no Turso deletes):

```bash
# Locally / agent (with same env vars):
node backend/scripts/sync-historical-to-supabase.js --dry-check
node backend/scripts/sync-historical-to-supabase.js
```

Or via admin API (settings write permission):

```http
POST /api/admin/supabase/backfill
```

## Verify

- Demo / existing users still log in (Turso unchanged)
- Admin → users list shows historical accounts
- Supabase Table Editor shows matching `user_wallets` / `deposit_requests` / `transaction_activity` rows after backfill
