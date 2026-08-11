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

See `backend/.env.example` for `BINANCE_PAY_*` variables.

## PM2

```bash
cd backend
pm2 start server.js --name eisy-backend
```

Deploy to production is automated via `.github/workflows/deploy.yml` on push to `main`.
