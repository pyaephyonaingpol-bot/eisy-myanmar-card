# Binance Pay Integration

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/deposit/create` | Bearer + PIN | Create Binance Pay order (2% fee, min $1) |
| `POST` | `/api/webhook/binance` | Binance signature | `PAY_SUCCESS` → credit **net** USDT |

## Fee rule

```js
fee = Math.max(amount * 0.02, 1)
net = amount - fee
```

User pays `amount` on Binance Pay; wallet is credited `net` after webhook success.

## Request example

```http
POST /api/deposit/create
Authorization: Bearer <session>
X-Pin-Token: <pin-token>
Content-Type: application/json

{ "amount_usdt": 50, "terminalType": "WEB" }
```

Response includes `checkout_url`, `qrcode_link`, and `fee_breakdown`.

## Environment

Set on **Vercel → Settings → Environment Variables**:

| Key | Required |
|-----|----------|
| `BINANCE_API_KEY` | yes |
| `BINANCE_SECRET_KEY` | yes |
| `BINANCE_MERCHANT_ID` | recommended |
| `PUBLIC_BASE_URL` | recommended |
| `DATABASE_URL` | yes (production) |

Aliases: `BINANCE_PAY_API_KEY`, `BINANCE_PAY_API_SECRET`, `BINANCE_PAY_MERCHANT_ID`.

See `backend/.env.example` and `backend/docs/VERCEL.md`.

## PM2

```bash
cd backend
pm2 start server.js --name eisy-backend
```

Primary production path is **Vercel auto-deploy on `main`**. Optional PM2 SSH deploy is in `.github/workflows/deploy.yml` (runs only when SSH secrets exist).
