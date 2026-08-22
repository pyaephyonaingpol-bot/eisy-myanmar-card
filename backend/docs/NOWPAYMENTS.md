# NOWPayments integration

## Environment

```bash
NOWPAYMENTS_API_KEY=your_api_key          # Dashboard → API keys
NOWPAYMENTS_IPN_SECRET=your_ipn_secret    # Dashboard → Store → IPN / Instant payment notifications
PUBLIC_BASE_URL=https://YOUR_DOMAIN       # Required for IPN + redirect URLs

# Mass payouts (USDT withdrawals via NOWPayments Custody)
NOWPAYMENTS_EMAIL=merchant@example.com    # Dashboard login (JWT /auth)
NOWPAYMENTS_PASSWORD=your_password
NOWPAYMENTS_PAYOUTS_ENABLED=true          # or leave unset when email+password+api key are set
NOWPAYMENTS_REQUIRE_LIVE_PAYOUT=true      # On Vercel/production this defaults on — do not skip silently
# USDT_AUTO_WITHDRAW_MAX_USDT=500         # optional net-USDT auto-payout cap
# NOWPAYMENTS_PAYOUT_2FA_SECRET=BASE32    # if payout 2FA is enabled on the account
# NOWPAYMENTS_PAYOUT_VERIFICATION_CODE=   # static 2FA code (prefer TOTP secret)
```

### Vercel

Set the same vars in **Vercel → Project → Settings → Environment Variables** (Production + Preview),
or run:

```bash
./scripts/sync-nowpayments-env-to-vercel.sh --vercel
npx vercel --prod
```

Admin readiness check (no secrets leaked): `GET /api/admin/nowpayments/payout-config`.

On Vercel/production, live payouts are **required** by default. Missing
`NOWPAYMENTS_API_KEY` / `EMAIL` / `PASSWORD` fails the withdrawal request instead of
returning a fake local success. Set `NOWPAYMENTS_REQUIRE_LIVE_PAYOUT=false` only for
intentional dry-run / manual-admin queues.

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
| `POST` | `/api/nowpayments/webhook` | IPN signature | Deposit (+ payout) IPN callback |
| `POST` | `/api/nowpayments/payout-webhook` | IPN signature | Dedicated payout IPN |
| `POST` | `/api/nowpayments/payout` | Bearer + PIN | Retry payout for own withdrawal |
| `POST` | `/api/withdrawal/usdt` | Bearer + PIN | Create withdrawal; auto-triggers payout when enabled |
| `POST` | `/api/admin/withdrawals/usdt/:id/nowpayments-payout` | Admin | Admin retry payout |

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

## USDT payouts (withdrawals)

When `NOWPAYMENTS_PAYOUTS_ENABLED` is on (or email+password+API key are set), a crypto
`POST /api/withdrawal/usdt` automatically:

1. Debits the user (gross) and records `usdt_withdrawal_requests`
2. Authenticates with `POST /v1/auth` (JWT)
3. Creates `POST /v1/payout` with ticker `usdttrc20` (TRC20) or `usdtbsc` (BEP20)
4. Optionally verifies with 2FA (`POST /v1/payout/:id/verify`)
5. Marks the row `processing` until payout IPN reports `FINISHED` (sets `tx_hash`) or `FAILED` (refunds)

Payout body sent to NOWPayments:

```json
{
  "ipn_callback_url": "https://YOUR_DOMAIN/api/nowpayments/payout-webhook",
  "withdrawals": [
    {
      "address": "T…",
      "currency": "usdttrc20",
      "amount": 49,
      "unique_id": "WD-1234",
      "ipn_callback_url": "https://YOUR_DOMAIN/api/nowpayments/payout-webhook"
    }
  ]
}
```

Disable payout 2FA in the NOWPayments dashboard for fully automated flow, **or** set
`NOWPAYMENTS_PAYOUT_2FA_SECRET` to the account authenticator secret.

Admin complete (`POST /api/admin/withdrawals/usdt/:id/complete`) prefers NOWPayments when
configured, then falls back to the TRON master wallet for TRC20.

## Webhook URL

Register in NOWPayments:

```text
https://YOUR_DOMAIN/api/nowpayments/webhook
https://YOUR_DOMAIN/api/nowpayments/payout-webhook
```

## Deposit flow

1. App creates a pending `deposit_requests_v2` row (and optionally a Supabase `transactions` row) with the NOWPayments invoice / order id.
2. NOWPayments sends IPN `POST` with header `x-nowpayments-sig`.
3. Server verifies HMAC-SHA512 signature (sorted JSON body + `NOWPAYMENTS_IPN_SECRET`).
4. When `payment_status === 'finished'`:
   - Credit the matching local deposit (net USDT after the 2% / $1 fee)
   - Optionally mark the Supabase `transactions` row `status = 'finished'` when dual-write is enabled

## Tests

```bash
cd backend && npm run test:nowpayments-ipn
cd backend && npm run test:nowpayments-payout
```
