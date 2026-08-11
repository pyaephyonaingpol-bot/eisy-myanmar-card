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
When no admins exist, open `/admin.html` and use **Create Super Admin** with `ADMIN_API_KEY` (or default `eisy-admin-dev-key` in local/dev).

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
