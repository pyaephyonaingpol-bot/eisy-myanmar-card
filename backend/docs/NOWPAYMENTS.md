# NOWPayments integration

## Environment

```bash
NOWPAYMENTS_API_KEY=your_api_key          # Dashboard → API keys
NOWPAYMENTS_IPN_SECRET=your_ipn_secret    # Dashboard → Store → IPN / Instant payment notifications
PUBLIC_BASE_URL=https://YOUR_DOMAIN       # Required for IPN + redirect URLs
```

Keys are read from `process.env` at request time (not cached at `require()`).
Local/PM2 loads `<repo>/.env`, `backend/.env`, then `.env.local` overlays. Non-empty
platform/Vercel env vars always win. Supabase is **not required**.
`deposit_requests_v2` row (same path as Binance Pay). If Supabase is configured
(`SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, plus `SUPABASE_SERVICE_ROLE_KEY`
or a full anon key), the server also dual-writes to `transactions` — run
[`supabase/nowpayments_transactions.sql`](../../supabase/nowpayments_transactions.sql).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/create-payment` | Bearer session | Create invoice + pending local deposit |
| `POST` | `/api/nowpayments/webhook` | IPN signature | NOWPayments IPN callback |

### Create payment

```http
POST /api/create-payment
Authorization: Bearer <session_token>
Content-Type: application/json

{
  "amount_usdt": 50,
  "pay_currency": "usdttrc20"
}
```

Server always sends this NOWPayments `/v1/invoice` body (`pay_currency` is hardcoded to `usdttrc20`):

```json
{
  "price_amount": 50,
  "price_currency": "usd",
  "pay_currency": "usdttrc20",
  "order_id": "NP…",
  "order_description": "…",
  "ipn_callback_url": "…",
  "success_url": "…",
  "cancel_url": "…"
}
```

The NOWPayments `/v1/invoice` body must use the Tron USDT ticker `usdttrc20`. Dashboard "USDT" is a display name; generic `pay_currency: "usdt"` returns **Currency USDT is currently unavailable**. Network is encoded in the ticker — do **not** send `usdt_network`, `network`, or `pay_amount` on the invoice (invoice prices in fiat via `price_amount` + `price_currency: "usd"`). Local deposits still record `usdt_network: TRC20` for our own bookkeeping only.

Response includes `checkout_url` (hosted NOWPayments page), `payment_id`, `order_id`, and `fee_breakdown`.

Fee rule matches Binance Pay deposits: `Math.max(amount * 0.02, 1)`.

## Webhook URL

Register in NOWPayments:

```text
https://YOUR_DOMAIN/api/nowpayments/webhook
```

## Flow

1. App creates a pending `deposit_requests_v2` row (and optionally a Supabase `transactions` row) with the NOWPayments invoice / order id.
2. NOWPayments sends IPN `POST` with header `x-nowpayments-sig`.
3. Server verifies HMAC-SHA512 signature (sorted JSON body + `NOWPAYMENTS_IPN_SECRET`).
4. When `payment_status === 'finished'`:
   - Credit the matching local deposit (net USDT after the 2% / $1 fee)
   - Optionally mark the Supabase `transactions` row `status = 'finished'` when dual-write is enabled

## Test signature helper

```bash
cd backend && npm run test:nowpayments-ipn
```
