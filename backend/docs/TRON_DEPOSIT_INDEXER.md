# TRON USDT TRC20 Deposit Indexer

Automated crediting for platform USDT deposits sent to the shared **master wallet** on TRON (TRC20).

## Current state (before indexer)

| Flow | Mechanism |
|------|-----------|
| MMK deposits | Android `deposit_listener` → `POST /api/deposit/verify` |
| USDT deposits | User creates request → sends on-chain → submits TxHash → `verifyUsdtTransaction()` → credit |
| Admin fallback | Manual approve in admin panel |

There was **no** background listener watching the master wallet for inbound USDT.

## How the indexer works

1. On server start, `startTronDepositIndexer()` runs (see `backend/src/index.js`).
2. Every `TRON_DEPOSIT_POLL_MS` (default 30s), it calls TronGrid:
   `GET /v1/accounts/{MASTER_WALLET}/transactions/trc20?contract_address={USDT}&only_to=true`
3. For each unseen transfer:
   - Validates USDT TRC20, positive amount, recipient = master wallet
   - Re-verifies via `verifyUsdtTransaction()` (confirmations, success, amount)
   - Finds a matching open deposit (`PENDING` / `SUBMITTED`, TRC20, platform direct)
   - Matches **gross** `amount_usd` within tolerance (0.5% or $0.01)
   - FIFO among ambiguous same-amount requests (shared deposit address limitation)
   - Credits via existing `creditDepositAndVerify()` + `claimForCredit()` (no double-credit)

## Duplicate protection

| Layer | Location |
|-------|----------|
| `tron_indexed_transfers.tx_hash` PRIMARY KEY | migration `040_tron_deposit_indexer.sql` |
| `deposit_requests_v2.tx_hash` partial unique index | migration `037` |
| `assertTxHashAvailable()` | `depositService.js` |
| `DepositRequest.claimForCredit()` | atomic status transition |

## Orphan transfers

Inbound USDT with **no matching pending request** is stored as `status = orphan` in `tron_indexed_transfers` for admin review (not retried every poll).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TRON_DEPOSIT_INDEXER` | enabled | Set `false` to disable |
| `TRON_DEPOSIT_POLL_MS` | `30000` | Poll interval |
| `TRON_DEPOSIT_LOOKBACK_MS` | 7 days | First-run lookback if no cursor |
| `TRON_DEPOSIT_MATCH_WINDOW_MS` | 48 hours | Max age of deposit request vs transfer time |
| `TRONGRID_API_KEY` | — | Recommended for TronGrid rate limits |
| `USDT_MIN_CONFIRMATIONS` | `1` | Blocks credit until confirmed |

Cursor stored in `app_settings.tron_deposit_indexer_last_ms`.

## Admin API

- `GET /api/admin/tron-deposit-indexer` — status + indexed counts
- `POST /api/admin/tron-deposit-indexer/poll` — manual poll cycle

Requires `deposits` permission.

## Manual / cron poll

```bash
cd backend && npm run poll:tron-deposits
```

Useful when running the API on serverless (no long-lived interval) — schedule externally.

## User experience

Users should still **create a deposit request first** (amount + fees shown). Sending USDT without a request creates an **orphan** transfer.

Optional future improvement: per-user deposit addresses via `user_usdt_wallet_addresses`.

## Related files

- `backend/src/services/tronDepositIndexerService.js` — indexer
- `backend/src/services/tronMasterWalletService.js` — master wallet / TronGrid client
- `backend/src/services/usdtBlockchainService.js` — on-chain verification
- `backend/src/services/depositService.js` — credit + fee split
