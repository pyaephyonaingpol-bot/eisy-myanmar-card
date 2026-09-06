# Secure secrets workflow (TRON + Supabase + API keys)

This repo is designed so **secrets never live in Git**. Code only reads
`process.env` (via `backend/src/lib/loadEnv.js` locally, and Vercel/Cursor
platform env in cloud).

## 1. What goes where

| Secret | Env name(s) | Where to set |
|--------|-------------|--------------|
| Supabase URL | `NEXT_PUBLIC_SUPABASE_URL` (alias `SUPABASE_URL`) | Vercel + Cursor Cloud |
| Supabase anon (browser) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + Cursor Cloud |
| Supabase service role | `SUPABASE_SERVICE_ROLE_KEY` | Vercel + Cursor Cloud (**server only**) |
| TRON hot wallet key | `MASTER_PRIVATE_KEY` (aliases: `MASTER_WALLET_PRIVATE_KEY`, `TRON_MASTER_PRIVATE_KEY`) | Vercel + Cursor Cloud |
| TRON hot wallet address (optional) | `MASTER_WALLET_ADDRESS` (aliases: `TRON_MASTER_WALLET`, `MASTER_TRON_ADDRESS`, `TRON_MASTER_ADDRESS`) | Vercel + Cursor Cloud |
| TRON HD deposit mnemonic | `TRON_HD_MNEMONIC` | Vercel + Cursor Cloud |
| TronGrid API key | `TRONGRID_API_KEY` (aliases: `TRON_API_KEY`, `TRON_PRO_API_KEY`) | Vercel + Cursor Cloud |
| Auth HMAC | `AUTH_SECRET` | Vercel + Cursor Cloud |
| Admin bootstrap key | `ADMIN_API_KEY` | Vercel + Cursor Cloud |

Templates (placeholders only): `.env.example`, `backend/.env.example`.

## 2. Local development

```bash
cp backend/.env.example backend/.env   # or root .env
# edit backend/.env with REAL values — file is gitignored
node backend/scripts/check-env-config.js
```

`loadEnv` loads (without overwriting non-empty platform vars):

1. `<repo>/.env`
2. `<backend>/.env`
3. `<cwd>/.env`
4. matching `.env.local` files

## 3. Push code safely (no secrets in GitHub)

1. Confirm ignore rules:
   ```bash
   git check-ignore -v .env backend/.env .env.production
   ```
2. Stage only code/docs/templates:
   ```bash
   git status   # must NOT list .env with real keys
   git add -p   # review hunks
   ```
3. Optional pre-push scan:
   ```bash
   git diff --cached | rg -i 'private_key|mnemonic|service_role|sb_secret_|eyJhbGci'
   ```
   If anything matches, unstage and move it to the secret store.
4. Commit + push the branch / PR as usual. **Do not** paste keys into PR descriptions.

## 4. Update secrets on Vercel (production)

Dashboard → Project → **Settings → Environment Variables** (Production + Preview):

- Paste **bare values only** (not `KEY=value`, not markdown links).
- After saving, **Redeploy** so serverless functions pick up new values.

CLI examples (value from local gitignored file, never echoed to shell history if you use files):

```bash
# after: npx vercel login && npx vercel link
grep '^MASTER_PRIVATE_KEY=' backend/.env | cut -d= -f2- | \
  npx vercel env add MASTER_PRIVATE_KEY production

grep '^SUPABASE_SERVICE_ROLE_KEY=' backend/.env | cut -d= -f2- | \
  npx vercel env add SUPABASE_SERVICE_ROLE_KEY production

npx vercel --prod
```

NOWPayments helper (existing): `./scripts/sync-nowpayments-env-to-vercel.sh --check` then `--vercel`.

## 5. Update secrets in Cursor Cloud

Cloud Agent / Environment secrets UI — same **names** as Vercel, bare values.
Do **not** put secrets in committed `environment.json`.

## 6. Verify without leaking secrets

```bash
node backend/scripts/check-env-config.js
npm run test:tron-wallet-init --prefix backend   # needs local/process env
# or against a running deploy (no private key in response):
curl -sS https://eisymyanmar.com/health/tron
curl -sS https://eisymyanmar.com/api/config/supabase
```

`/health/tron` returns env SET/MISSING flags, a masked address, TronGrid reachability,
balances, and **`address_consistency`** — if `TRON_MASTER_WALLET` is set it must match
the address derived from `MASTER_PRIVATE_KEY` (`code: MASTER_ADDRESS_MISMATCH` otherwise).

Admin checks (authenticated): master wallet balance, NOWPayments payout-config, `admin_api_key_configured`.

## 7. Rotation checklist (wallet / Supabase incident)

1. Generate new TRON key / mnemonic and Supabase keys as needed.
2. Move funds off the old hot wallet before disabling it.
3. Update Vercel + Cursor secrets (bare values).
4. Keep kill switches on until verified:
   `WITHDRAWALS_PAUSED=true`, `AUTO_ONCHAIN_WITHDRAWALS=false`, `MASTER_WALLET_TRANSFERS_PAUSED=true`
5. Redeploy, run `check-env-config.js` / smoke tests, then carefully re-enable.

## Paste hygiene

Supabase client code already sanitizes accidental `KEY = value` / markdown URL pastes.
Still fix the source secret slots — bare values are safer and avoid swap mistakes
(anon vs service role, URL vs key).
