# Reset test balances (master wallet cutover)

After switching the TRON master wallet, wipe **internal** test ledger
balances so user wallets no longer show fake USDT/MMK funds.

The master wallet itself is **on-chain** — `GET /api/admin/master-wallet-balance`
always reads live TRX/USDT from TronGrid/Tronscan. This reset does not move
or store master-wallet funds; it only clears SQLite/Turso ledger copies.

## What gets zeroed

| Store | Action |
|-------|--------|
| `users.balance_usdt` / `balance_usdt_locked` / `balance_mmk` / `balance` | → `0` |
| `app_settings.platform_usdt_revenue_balance` | → `0` |
| `p2p_sellers.escrow_balance_usdt` | → `0` |
| `p2p_ads.escrow_locked_usdt` | → `0` |
| `usdt_escrow_holds` (active) | → `cancelled` |
| Pending USDT/MMK withdrawals | → `cancelled` (no refund) |
| Pending `transactions` rows | → `rejected` |
| `cards_v2.metadata.balance_usd` (script/API) | → `0` |
| Supabase `user_wallets` (if configured) | re-synced to `0` |

## Option A — Auto migration (on next deploy / `npm run migrate`)

`backend/migrations/038_reset_test_user_balances.sql` runs once via the
normal migration runner.

## Option B — CLI (Turso / local)

```bash
cd backend
# Preview totals only:
DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run reset:test-balances -- --dry-run

# Apply (USDT + MMK + cards):
DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run reset:test-balances

# USDT-related only (leave MMK):
DATABASE_URL=libsql://… DATABASE_AUTH_TOKEN=… npm run reset:test-balances -- --usdt-only
```

## Option C — Super Admin API

```http
POST /api/admin/maintenance/reset-test-balances
Authorization: Bearer <admin session>
# or X-Admin-Key: <ADMIN_API_KEY>

{ "confirm": "RESET_TEST_BALANCES" }
```

Optional body flags: `include_mmk`, `include_cards`, `cancel_pending_withdrawals`,
`sync_supabase` (all default `true`).

Response includes `before` / `after` totals plus a live `master_wallet`
snapshot so you can confirm the new on-chain wallet state.
