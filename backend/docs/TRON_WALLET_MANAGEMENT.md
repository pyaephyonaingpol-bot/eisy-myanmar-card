# Per-user TRON wallet management

Backend façade for unique TRC-20 deposit addresses, deposit credit, and
master-wallet withdrawals.

## Service

`backend/src/services/tronWalletService.js`

| Function | Role |
|----------|------|
| `generateUserDepositAddress(userId)` | Deterministic HD TRC-20 address + Supabase sync |
| `provisionDepositAddressInBackground(userId)` | Called after registration |
| `getTronWalletSummary(userId)` | Address + internal USDT balances |
| `createDepositIntent(userId, { amount_usdt })` | Order bound to unique address |
| `creditDetectedDeposits()` / `detectAndCreditDeposits()` | Poller: match transfers → credit ledger |
| `withdrawFromMasterWallet(userId, { toAddress, amountUsdt })` | Debit user → send from master wallet |

## HTTP API (`/api/tron/wallet`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tron/wallet` | session + sensitive | Summary |
| GET/POST | `/api/tron/wallet/address` | session | Ensure unique deposit address |
| POST | `/api/tron/wallet/deposits` | session + sensitive | Create deposit intent |
| GET | `/api/tron/wallet/deposits/:orderId` | session | Deposit status |
| POST | `/api/tron/wallet/withdraw` | session + sensitive | Withdraw via master wallet |
| POST | `/api/tron/wallet/sync-deposits` | `X-Deposit-Listener-Secret` | Worker credit pass |

Existing routes remain: `/api/tron/orders`, `/api/withdraw`, `/api/withdrawal/usdt`.

## Flow

1. **Register** → background HD address provision → Supabase `user_wallets` / `user_tron_deposit_addresses`
2. **Deposit** → `POST /deposits` → user pays unique address → poller / `sync-deposits` credits `balance_usdt`
3. **Withdraw** → `POST /withdraw` → debit ledger → `transferUsdtTrc20` from `MASTER_PRIVATE_KEY`
4. **Sweep (ops)** → master sends a little TRX for gas → deposit address sends all USDT back to master

## Sweep (manual only — no cron)

Trigger when you want to collect USDT from HD deposit addresses into the master wallet:

```http
POST /api/admin/sweep-deposits
Authorization: admin session / X-Admin-Key
Permission: master_wallet (super_admin)

{ "dry_run": true }
{ "user_id": 42 }
{ "force_gas": true, "limit": 100 }
```

```bash
# Optional CLI (also manual — not scheduled)
npm run sweep:tron-deposits -- --dry-run --all
npm run sweep:tron-deposits -- --user-id=42
npm run sweep:tron-deposits -- --all
```

Service: `backend/src/services/tronSweepService.js`  
CLI: `backend/scripts/sweep-tron-deposits.js`

Env: `TRON_SWEEP_GAS_TRX` (default `1.1`), `TRON_SWEEP_GAS_WAIT_MS`, `TRON_SWEEP_MIN_USDT`.

## Env

See `.env.example`: `TRON_HD_MNEMONIC`, `MASTER_PRIVATE_KEY`, `DEPOSIT_LISTENER_SECRET`.
Apply `supabase/user_tron_hd_addresses.sql`.
