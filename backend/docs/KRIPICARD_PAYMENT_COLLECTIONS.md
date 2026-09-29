# Kripicard payment collections (Master Wallet)

When a customer completes a Kripicard payment collection, this backend verifies the signed webhook, updates the deposit + event tables, and credits the Instant Card **Master Wallet** ledger (`users.balance_usdt`).

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/deposit/kripicard-collection` | User session | Create pending USDT top-up (fee applied) |
| `POST` | `/api/deposit/create` | User session | Same when `provider=kripicard` / `kripicard_collection` |
| `POST` | `/api/webhook/kripicard` | HMAC signature | Payment collection webhook |
| `POST` | `/api/webhook/kripicard/collections` | HMAC signature | Alias (preferred register URL) |
| `POST` | `/api/webhook/kripicard/payments` | HMAC signature | Alias |

Register with Kripicard:

```text
https://YOUR_DOMAIN/api/webhook/kripicard/collections
```

## Env

| Variable | Required | Notes |
|----------|----------|-------|
| `KRIPICARD_WEBHOOK_SECRET` | Production | HMAC-SHA256 of raw body |
| `KRIPICARD_WEBHOOK_URL` | Optional | Documented public URL |
| `KRIPICARD_API_KEY` | Optional | Live re-verify of collection status |
| `KRIPICARD_PUBLISHABLE_KEY` | Optional | `X-Publishable-Key` for `/api/v1/payment-collections` |
| `KRIPICARD_PAYMENT_COLLECTIONS_URL` | Optional | Default `https://appapi.kripicard.com/api/v1/payment-collections` |
| `KRIPICARD_QUERY_BEFORE_CREDIT` | Optional | Default `true` — skip with `false` in tests |
| `KRIPICARD_WEBHOOK_ALGO` | Optional | `sha256` (default) or `sha512` |

Signature headers accepted: `x-kripicard-signature`, `x-kripicard-webhook-signature`, `x-webhook-signature`, `x-signature` (supports `sha256=<hex>`).

## Fee + credit

Same USDT deposit fee rule as other Master Wallet top-ups (`Math.max(amount * fee%, minimum)`). User pays gross; wallet receives **net**. Credits go only to `users.balance_usdt` (Master Wallet) — Kripicard Instant Card path.

## Idempotency

Events are stored in `kripicard_payment_events` keyed by `event_id`. Replays return `alreadyVerified` and do not double-credit.
