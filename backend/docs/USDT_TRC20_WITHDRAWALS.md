# USDT TRC20 withdrawals (master wallet)

When a user creates a **TRC20 crypto** USDT withdrawal, the backend may pay it
automatically from the platform master (hot) wallet — or leave it pending for
admin review when safety checks require it.

## Flow

1. User creates `POST /api/withdrawal/usdt` with `network=TRC20` → USDT balance debited, row `pending`
2. **Auto-payout** (when enabled and amount ≤ `USDT_AUTO_WITHDRAW_MAX_USDT`):
   - `maybeAutoProcessUsdtWithdrawal` → `processUsdtTrc20Withdrawal` → `transferUsdtTrc20`
   - Marks withdrawal `completed` and stores the on-chain `txId`
3. **Manual / large withdrawals** stay `pending` for admin:
   - Admin completes `POST /api/admin/withdrawals/usdt/:id/complete`
   - Same on-chain send path as auto-payout when no `tx_hash` is provided

If a manual `tx_hash` is provided on admin complete, the on-chain send is skipped.

## Safety thresholds

| Variable | Default | Notes |
|----------|---------|--------|
| `USDT_AUTO_WITHDRAW_ENABLED` | `true` | Set `false` to require admin for all |
| `USDT_AUTO_WITHDRAW_MAX_USDT` | `100` | Gross requested USDT; above → admin queue |
| `MASTER_PRIVATE_KEY` | required for send | Never commit real keys |

BEP20 / bank USDT withdrawals always require admin (no auto hot-wallet send).

## Admin balance check

`GET /api/admin/master-wallet-balance` returns TRX + USDT for the master address.
The admin Deposits/Withdrawals tab has a **Check Master Wallet Balance** button that calls this endpoint.

## Env

| Variable | Required | Notes |
|----------|----------|--------|
| `MASTER_PRIVATE_KEY` | yes (for auto send) | 64-char hex, no `0x` |
| `USDT_TRC20_CONTRACT` | no | defaults to mainnet USDT |
| `TRON_FULL_HOST` | no | default `https://api.trongrid.io` |
| `TRONGRID_API_KEY` | no | recommended for rate limits |
| `USDT_AUTO_WITHDRAW_ENABLED` | no | default true |
| `USDT_AUTO_WITHDRAW_MAX_USDT` | no | default 100 |

## MMK / balance policy (unchanged)

- **MMK → USDT conversion is forbidden** (`assertMmkToUsdtForbidden`, debit purpose guard)
- MMK wallet debits only for: card issuance, card reload, MMK bank withdrawal
- TRC20 master-wallet payouts never debit/credit MMK
- USDT→bank and MMK bank withdrawals stay manual/admin bank rails (not Tron)

## Key files

- `backend/src/services/tronMasterWalletService.js` — TronWeb transfer + balance checks
- `backend/src/services/withdrawalService.js` — `maybeAutoProcessUsdtWithdrawal`, `processUsdtTrc20Withdrawal`, `completeUsdtWithdrawal`
- `backend/src/services/usdtBlockchainService.js` — deposit TxHash verification (TronGrid + Tronscan)
- `backend/src/services/walletService.js` — MMK debit allow-list
