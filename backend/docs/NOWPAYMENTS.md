# NOWPayments integration

## Environment

```bash
NOWPAYMENTS_API_KEY=your_api_key          # Dashboard → API keys
NOWPAYMENTS_IPN_SECRET=your_ipn_secret    # Dashboard → Store → IPN / Instant payment notifications
PUBLIC_BASE_URL=https://YOUR_DOMAIN       # Required for IPN + redirect URLs
```

Also configure Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and run
[`supabase/nowpayments_transactions.sql`](../../supabase/nowpayments_transactions.sql).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/create-payment` | Bearer session | Create invoice + pending `transactions` row |
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

Response includes `checkout_url` (hosted NOWPayments page), `payment_id`, `order_id`, and `fee_breakdown`.

Fee rule matches Binance Pay deposits: `Math.max(amount * 0.02, 1)`.

## Webhook URL

Register in NOWPayments:

```text
https://YOUR_DOMAIN/api/nowpayments/webhook
```

## Flow

1. App creates a row in Supabase `transactions` with `payment_id` from NOWPayments when checkout starts.
2. NOWPayments sends IPN `POST` with header `x-nowpayments-sig`.
3. Server verifies HMAC-SHA512 signature (sorted JSON body + `NOWPAYMENTS_IPN_SECRET`).
4. When `payment_status === 'finished'`:
   - Update matching `transactions.payment_id` → `status = 'finished'`
   - Credit `user_wallets.balance_usdt` in Supabase
   - Credit local LibSQL USDT wallet when `user_id` matches a platform user

## Test signature helper

```bash
cd backend && npm run test:nowpayments-ipn
```
