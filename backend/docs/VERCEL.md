# Vercel Deployment

Pushing to `main` triggers Vercel automatic deployment when the GitHub repo is linked in the Vercel project.

## How it works

| File | Role |
|------|------|
| `vercel.json` (repo root) | Rewrites all traffic to the Express serverless function |
| `api/index.js` | Thin Vercel entry → `backend/api/index.js` |
| `backend/api/index.js` | Boots DB + serves the Express `app` |
| `backend/src/index.js` | Full Express app (Binance Pay routes included) |

## Required Vercel Environment Variables

| Variable | Purpose |
|----------|---------|
| `BINANCE_API_KEY` | Binance Pay Certificate SN / API key |
| `BINANCE_SECRET_KEY` | HMAC-SHA512 secret |
| `BINANCE_MERCHANT_ID` | Merchant id (stored on deposit metadata) |
| `DATABASE_URL` | **Turso / LibSQL URL** (`libsql://…`) — required for persistent production data |
| `DATABASE_AUTH_TOKEN` | Turso auth token |
| `PUBLIC_BASE_URL` | Canonical site URL (e.g. `https://eisymyanmar.com`) |
| `AUTH_SECRET` | Session signing secret |
| `MASTER_PRIVATE_KEY` | TRON hex key for USDT TRC20 withdrawal payouts |

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
