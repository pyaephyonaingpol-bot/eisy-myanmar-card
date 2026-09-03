# Vercel Deployment

Pushing to `main` triggers Vercel automatic deployment when the GitHub repo is linked in the Vercel project.

## How it works

| File | Role |
|------|------|
| `vercel.json` (repo root) | Serverless Express + static `public/` output |
| `api/index.js` | Thin Vercel entry → `backend/api/index.js` |
| `backend/api/index.js` | Boots DB + serves the Express `app` |
| `backend/src/index.js` | Full Express app (Binance Pay routes included) |
| `backend/public/` | Source static UI (HTML/JS/CSS) |

`vercel.json` sets `"framework": null` and `"outputDirectory": "public"`. The build
command copies `backend/public` → root `public/` so Vercel’s required output
directory exists (avoids `No Output Directory named "public" found`).

Static files (`.js`, `.css`, `/assets/**`) are served from `public/` by Vercel CDN.
Extensionless routes (`/`, `/admin`, `/dashboard`) rewrite to the Express function.
Deposit QR images use `GET /api/qr?data=…` (PNG) so they do not rely on third-party hosts.

User-uploaded deposit receipts, P2P payment proofs, and KYC images are stored in
**Supabase Storage** when `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
are set (see `supabase/upload_storage.sql`). Public URLs look like:

`https://YOUR_PROJECT.supabase.co/storage/v1/object/public/uploads/deposits/...`

Legacy `/uploads/*` paths are still served by Express for local dev and older rows;
`vercel.json` rewrites `/uploads/*` to the API function for same-origin fallback.

## Required Vercel Environment Variables

| Variable | Purpose |
|----------|---------|
| `BINANCE_API_KEY` | Binance Pay Certificate SN / API key |
| `BINANCE_SECRET_KEY` | HMAC-SHA512 secret |
| `BINANCE_MERCHANT_ID` | Merchant id (stored on deposit metadata) |
| `DATABASE_URL` | **Turso / LibSQL URL** (`libsql://…`) — required for persistent production data |
| `DATABASE_AUTH_TOKEN` | Turso auth token |
| `PUBLIC_BASE_URL` | Canonical site URL (e.g. `https://eisymyanmar.com`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (bare `https://….supabase.co` only — no `KEY=` prefix / markdown) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required for the browser bridge** (`createClient` via `GET /api/config/supabase`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for server-side Storage uploads + Turso→Supabase dual-write |
| `SUPABASE_UPLOAD_BUCKET` | Storage bucket name (default `uploads`; run `supabase/upload_storage.sql`) |
| `SUPABASE_UPLOAD_STORAGE` | Set `false` to force local `/uploads` disk only |
| `AUTH_SECRET` | Session signing secret |
| `MASTER_PRIVATE_KEY` | TRON hex key for USDT TRC20 withdrawal payouts (fallback) |
| `NOWPAYMENTS_API_KEY` | NOWPayments API key (deposits + payouts) |
| `NOWPAYMENTS_IPN_SECRET` | IPN HMAC secret |
| `NOWPAYMENTS_EMAIL` | Dashboard login email for payout JWT (`POST /v1/auth`) |
| `NOWPAYMENTS_PASSWORD` | Dashboard login password for payout JWT |
| `NOWPAYMENTS_PAYOUTS_ENABLED` | Set `true` to enable mass payouts |
| `NOWPAYMENTS_REQUIRE_LIVE_PAYOUT` | Defaults to required on Vercel; set `false` only for dry-run |

Optional payout 2FA (required if enabled on the NOWPayments account):

| Variable | Purpose |
|----------|---------|
| `NOWPAYMENTS_PAYOUT_2FA_SECRET` | Authenticator BASE32 secret (preferred) |
| `NOWPAYMENTS_PAYOUT_VERIFICATION_CODE` | Static 2FA code (less ideal) |

Sync from local `.env` (after `npx vercel login` + `npx vercel link`):

```bash
./scripts/sync-nowpayments-env-to-vercel.sh --check
./scripts/sync-nowpayments-env-to-vercel.sh --vercel
npx vercel --prod
```

Verify (admin session): `GET /api/admin/nowpayments/payout-config` — `ready` must be `true`.

Aliases accepted: `BINANCE_PAY_API_KEY`, `BINANCE_PAY_API_SECRET`, `BINANCE_PAY_MERCHANT_ID`.

## Database (Vercel-compatible)

The app uses **`@libsql/client` only** on Vercel — **not** native `sqlite3`.

| Environment | Driver | Connection |
|-------------|--------|------------|
| Vercel + `DATABASE_URL` | LibSQL / Turso | Persistent remote DB (**recommended**) |
| Vercel without `DATABASE_URL` | LibSQL `file:/tmp/…` | Ephemeral (preview only) |
| Local default | LibSQL `file:backend/data/eisy.db` | Persistent on disk |
| Local override | Native `sqlite3` | `SQLITE_DRIVER=sqlite3` + optional deps |

Root `package.json` lists serverless runtime deps (**no `sqlite3`**). Install:

```bash
npm install
```

Native `sqlite3` is an **optional** backend dependency for local legacy mode only and is excluded from the Vercel function bundle. `@libsql/linux-x64-gnu` is listed explicitly so Vercel’s Linux runtime can open LibSQL file/remote clients.

### Turso setup (production)

1. Create a DB at [turso.tech](https://turso.tech)
2. Set in Vercel → Project → Environment Variables:
   - `DATABASE_URL=libsql://your-db-name-org.turso.io`
   - `DATABASE_AUTH_TOKEN=…`
3. Redeploy

## Fee logic (deposit create + webhook credit)

```js
fee = Math.max(amount * 0.02, 1)
net = amount - fee
```

- `POST /api/deposit/create` — creates Binance Pay order for **gross** amount
- `POST /api/webhook/binance` — on `PAY_SUCCESS`, credits **net** USDT

## Webhook URL to register in Binance Merchant

```
https://YOUR_DOMAIN/api/webhook/binance
```

## Local vs Vercel

- **Vercel:** `VERCEL=1` → Express is exported; `api/index.js` handles requests
- **Local/PM2:** `cd backend && npm start` (or `npm run dev`) listens on `PORT`
- **Local DB:** LibSQL file under `backend/data/eisy.db` by default (same SQL schema/migrations)
