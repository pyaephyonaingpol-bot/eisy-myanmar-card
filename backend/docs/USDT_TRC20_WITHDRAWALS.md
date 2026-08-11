# USDT TRC20 withdrawals (master wallet)

When an admin processes a pending **TRC20 crypto** USDT withdrawal, the backend
sends `net_usdt` from the platform master wallet via TronWeb.

## Flow

1. User creates `POST /api/withdrawal/usdt` with `network=TRC20` → USDT balance debited, row `pending`
2. Admin completes `POST /api/admin/withdrawals/usdt/:id/complete`
3. `processUsdtTrc20Withdrawal` → `transferUsdtTrc20`:
   - Reads `process.env.MASTER_PRIVATE_KEY` (never hardcoded)
   - Checks master USDT balance (≥ net amount) and TRX for fees
   - Transfers TRC20 USDT to `wallet_address`
   - Stores returned `txId` and marks withdrawal `completed`

If a manual `tx_hash` is provided, the on-chain send is skipped.

## Admin balance check

`GET /api/admin/master-wallet-balance` returns TRX + USDT for the master address, plus:

- `trx_low_threshold` — default **30 TRX** (override with `MASTER_TRX_LOW_THRESHOLD`)
- `trx_low` — `true` when TRX balance is below that threshold (admin UI shows a warning)

The Super Admin **Master Wallet** page auto-loads balances and has a one-click **Refresh**.
The admin Deposits/Withdrawals tab has a **Check Master Wallet Balance** button that calls this endpoint.

## Env

| Variable | Required | Notes |
|----------|----------|--------|
| `MASTER_PRIVATE_KEY` | yes (for auto send) | 64-char hex, no `0x` |
| `USDT_TRC20_CONTRACT` | no | defaults to mainnet USDT |
| `TRON_FULL_HOST` | no | default `https://api.trongrid.io` |
| `TRONGRID_API_KEY` | no | recommended for rate limits |

## MMK / balance policy (unchanged)

- **MMK → USDT conversion is forbidden** (`assertMmkToUsdtForbidden`, debit purpose guard)
- MMK wallet debits only for: card issuance, card reload, MMK bank withdrawal
- TRC20 master-wallet payouts never debit/credit MMK
- USDT→bank and MMK bank withdrawals stay manual/admin bank rails (not Tron)

## Key files

- `backend/src/services/tronMasterWalletService.js` — TronWeb transfer + balance checks
- `backend/src/services/withdrawalService.js` — `processUsdtTrc20Withdrawal`, `completeUsdtWithdrawal`
- `backend/src/services/walletService.js` — MMK debit allow-list
