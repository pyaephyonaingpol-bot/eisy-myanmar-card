# Kripicard Deposit API (Master Wallet)

Customer USDT top-ups use Kripicard’s Deposit API. Each request gets a **unique pay-to address**, exact `pay_amount`, and network. On `deposit.completed` (webhook or status poll), the Master Wallet ledger (`users.balance_usdt`) is credited with Kripicard’s `credited_on_completion_usd` / `credited_amount_usd`.

## Provider endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/external/deposits/create` | Create deposit (`amount`, `currency`, `network`, optional `order_id`) |
| `GET`/`POST` | `/api/external/deposits/status?id=` | Poll status / credited flag |
| `GET` | `/api/external/deposits/networks?currency=USDT` | Supported networks |

Default host: `https://appapi.kripicard.com`. Auth: `api_key` in JSON body (create/status POST) or query (GET), plus Bearer / X-API-Key headers.

### Create response (example)

```json
{
  "success": true,
  "data": {
    "id": "E71216FD07D5",
    "status": "pending",
    "amount_usd": 20,
    "fee_usd": 0.2,
    "credited_on_completion_usd": 19.8,
    "pay_address": "T…",
    "pay_amount": "20.00",
    "pay_currency": "USDT",
    "network": "tron",
    "expires_at": "…"
  }
}
```

Network ids: `tron`, `bsc`, `eth`, `arbitrum`, `avalanche`, `ton`, `polygon`, `sol`. Legacy UI labels `TRC20`→`tron`, `BEP20`→`bsc`.

## App endpoints

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/deposit/create` | Primary create |
| `POST` | `/api/deposit/request` | Same create (legacy name) |
| `POST` | `/api/tron/orders` | Instant portal compat → same create |
| `GET` | `/api/tron/orders/:orderId` | Status (+ live Kripicard poll) |
| `GET` | `/api/deposit/kripicard-networks` | Networks list |
| `POST` | `/api/webhook/kripicard/deposits` | `deposit.completed` webhook |

## Credit path

1. Create local `deposit_requests_v2` (`purpose=usdt_topup`, channel `kripicard_deposit`) with provider id + pay address in metadata.
2. Webhook `deposit.completed` **or** background poll (`KRIPICARD_DEPOSIT_POLL_MS`) calls `/deposits/status`.
3. On completed/credited → `creditDepositAndVerify` → Master Wallet balance.

Legacy HD TRON address assignment and TronGrid order polling are off by default (`TRON_ORDER_POLL_ENABLED` defaults false).
