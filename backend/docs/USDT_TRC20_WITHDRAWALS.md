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

## Admin / CLI balance check

`GET /api/admin/master-wallet-balance` returns TRX + USDT for the master address.
The admin Deposits/Withdrawals tab has a **Check Master Wallet Balance** button that calls this endpoint.

Quick CLI check (loads `MASTER_PRIVATE_KEY` from `.env`):

```bash
npm run check-master-wallet
# or
node backend/scripts/check-master-wallet.js
# JSON output:
node backend/scripts/check-master-wallet.js --json
```

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
