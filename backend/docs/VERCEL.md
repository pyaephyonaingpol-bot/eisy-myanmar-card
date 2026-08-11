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
| `DATABASE_URL` | Persistent LibSQL/Turso URL (**required in production** — avoid ephemeral `/tmp`) |
| `DATABASE_AUTH_TOKEN` | Turso auth token |
| `PUBLIC_BASE_URL` | Canonical site URL (e.g. `https://eisymyanmar.com`) |
| `AUTH_SECRET` | Session signing secret |
| `MASTER_PRIVATE_KEY` | TRON hex key for USDT TRC20 withdrawal payouts |

Aliases accepted: `BINANCE_PAY_API_KEY`, `BINANCE_PAY_API_SECRET`, `BINANCE_PAY_MERCHANT_ID`.

## Database on Vercel

Native `sqlite3` is **not** used on Vercel. The app:

1. Uses **Turso / LibSQL** when `DATABASE_URL` is `libsql://…` or `https://…`
2. Otherwise falls back to an **ephemeral** `@libsql/client` `file:/tmp/…` DB (no native addon)

Root `package.json` lists all serverless runtime dependencies (including `sqlite3` for local use and `@libsql/client` for Vercel). `vercel.json` runs:

```bash
npm install && npm install --prefix backend
```

so modules resolve from both the repo root and `backend/`.

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
- **Local/PM2:** `node server.js` (or `npm start`) listens on `PORT`
