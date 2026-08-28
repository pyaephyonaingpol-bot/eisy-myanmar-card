# USDT withdrawals

## Crypto TRC20 (master wallet + Feee.io energy rental)

`POST /api/withdrawal/usdt` with `payout_method=crypto` and `network=TRC20`
sends USDT immediately from the platform master wallet:

1. User creates withdrawal → USDT balance debited
2. Fixed **2.0 USDT** fee collected (`WITHDRAW_FIXED_FEE_USDT`)
3. Feee.io rents ~65,000 energy for the master wallet
4. Wait ~2s for delegation
5. TronWeb `transferUsdtTrc20` sends **net** USDT (`amount * 10^6` base units)
6. Row marked `completed` with `tx_hash` (wallet refunded if the send fails)

Also available as `POST /api/withdraw` with body
`{ customerAddress, withdrawAmount }` (same fee / energy / transfer stack).

| Variable | Required | Notes |
|----------|----------|--------|
| `MASTER_PRIVATE_KEY` | yes | 64-char hex, no `0x` |
| `ENERGY_RENTAL_API_KEY` | recommended | Feee.io API key |
| `ENERGY_RENTAL_AMOUNT` | no | default `65000` |
| `ENERGY_RENTAL_WAIT_MS` | no | default `2000` |
| `WITHDRAW_FIXED_FEE_USDT` | no | default `2` |
| `USDT_TRC20_CONTRACT` | no | defaults to mainnet USDT |
| `TRON_FULL_HOST` | no | default `https://api.trongrid.io` |
| `TRONGRID_API_KEY` | no | recommended for rate limits |

## Crypto BEP20

BEP20 withdrawals stay **pending** for admin manual completion (no auto on-chain send).

## Admin complete

`POST /api/admin/withdrawals/usdt/:id/complete` for pending TRC20 rows still
calls `processUsdtTrc20Withdrawal` → `transferUsdtTrc20` (with energy rental).
If a manual `tx_hash` is provided, the on-chain send is skipped.

## Admin balance check

`GET /api/admin/master-wallet-balance` returns TRX + USDT for the master address.

## MMK / balance policy (unchanged)

- **MMK → USDT conversion is forbidden** (`assertMmkToUsdtForbidden`, debit purpose guard)
- MMK wallet debits only for: card issuance, card reload, MMK bank withdrawal
- TRC20 payouts never debit/credit MMK
- USDT→bank and MMK bank withdrawals stay manual/admin bank rails

## Legacy NOWPayments payouts

NOWPayments mass-payout code remains in the repo for historical IPN / admin
tools, but **user-facing withdrawals no longer use it**. Prefer master-wallet
TRC20 + energy rental.

## Key files

- `backend/src/services/tronMasterWalletService.js` — TronWeb transfer + energy rental hook
- `backend/src/services/energyRentalService.js` — Feee.io energy rental
- `backend/src/services/withdrawCryptoService.js` — fixed-fee `/api/withdraw` flow
- `backend/src/services/withdrawalService.js` — create / complete / reject (TRC20 auto-send)
- `backend/src/routes/withdraw.js` — `POST /api/withdraw`
- `backend/src/routes/withdrawal.js` — `POST /api/withdrawal/usdt`
- `backend/src/services/walletService.js` — MMK debit allow-list
