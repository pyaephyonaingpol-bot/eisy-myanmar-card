# Admin Multi-Role RBAC

## Roles
- `super_admin` — full access: rates/fees, MMK payment methods, master wallet, balance adjust, admin management, withdrawal rates
- `finance_admin` — deposits, withdrawals, ledger/revenue, rates (read), **withdrawal rate management** (read/write), users/transactions/cards
- `support_admin` — support chat, KYC, users/transactions/cards

## Withdrawal Rate Management
Super Admin and Finance Admin can open **Withdrawal Rates** to update:
- USDT→MMK exchange rate (`mmk_to_usd_rate`)
- Service fee % + minimum USDT fee (`payment_service_fee_*`)
- Minimum USDT / MMK withdrawal amounts

Stored in `app_settings`. User withdrawals always load the latest values via `getWithdrawalFeeSettings()`.

## First Super Admin
When no admins exist, open `/admin.html` and use **Create Super Admin**. While bootstrap is open, `GET /api/admin/auth/status` returns `bootstrap_api_key` (the exact value the server will accept). If `ADMIN_API_KEY` is unset, that value is the default `eisy-admin-dev-key`. A wrong key also returns/logs the expected value until the first admin exists.

### Set / sync `ADMIN_API_KEY` (local + Vercel)

```bash
# Ensure a strong key exists in .env (generates one if missing)
./scripts/set-admin-api-key.sh

# Print the key (for pasting into Create Super Admin)
./scripts/set-admin-api-key.sh --show

# Push the same key to Vercel Production (requires: npx vercel login && npx vercel link)
./scripts/set-admin-api-key.sh --vercel

# Then redeploy so the new env is live
npx vercel --prod
```

One-liner (after `vercel login` + `vercel link`):

```bash
grep '^ADMIN_API_KEY=' .env | cut -d= -f2- | npx vercel env add ADMIN_API_KEY production
```

Or:
```bash
curl -X POST /api/admin/auth/bootstrap \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d '{"email":"admin@example.com","password":"your-password","name":"Super Admin"}'
```

## Login
`POST /api/admin/auth/login` with email + password (or PIN if password not set). Returns a session token; send `Authorization: Bearer <token>` on admin APIs.

Legacy `X-Admin-Key` still works as synthetic `super_admin` for emergency/automation.
