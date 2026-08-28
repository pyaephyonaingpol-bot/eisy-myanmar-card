# USDT withdrawals

## Crypto TRC20 (master wallet, manual energy)

`POST /api/withdrawal/usdt` with `payout_method=crypto` and `network=TRC20`
sends USDT immediately from the platform master wallet:

1. User creates withdrawal → USDT balance debited
2. Fixed **2.0 USDT** fee collected (`WITHDRAW_FIXED_FEE_USDT`)
3. TronWeb `transferUsdtTrc20` sends **net** USDT (`amount * 10^6` base units)
4. Row marked `completed` with `tx_hash` (wallet refunded if the send fails)

**Manual energy mode:** no Feee.io or other external energy rental APIs.
Pre-delegate energy (or keep enough TRX) on the master wallet yourself.

Also available as `POST /api/withdraw` with body
`{ customerAddress, withdrawAmount }` (same fee + transfer stack).

| Variable | Required | Notes |
|----------|----------|--------|
| `MASTER_PRIVATE_KEY` | yes | 64-char hex, no `0x` |
| `WITHDRAW_FIXED_FEE_USDT` | no | default `2` |
| `USDT_TRC20_CONTRACT` | no | defaults to mainnet USDT |
| `TRON_FULL_HOST` | no | default `https://api.trongrid.io` |
| `TRONGRID_API_KEY` | no | recommended for rate limits |
| `TRON_USDT_FEE_LIMIT_SUN` | no | default `100000000` (100 TRX) |

## Crypto BEP20

BEP20 withdrawals stay **pending** for admin manual completion (no auto on-chain send).

## Admin complete

`POST /api/admin/withdrawals/usdt/:id/complete` for pending TRC20 rows still
calls `processUsdtTrc20Withdrawal` → `transferUsdtTrc20`.
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
tools, but **user-facing withdrawals no longer use it**. Prefer master-wallet TRC20.

## Key files

- `backend/src/services/tronMasterWalletService.js` — TronWeb USDT transfer
- `backend/src/services/withdrawCryptoService.js` — fixed-fee `/api/withdraw` flow
- `backend/src/services/withdrawalService.js` — create / complete / reject (TRC20 auto-send)
- `backend/src/routes/withdraw.js` — `POST /api/withdraw`
- `backend/src/routes/withdrawal.js` — `POST /api/withdrawal/usdt`
- `backend/src/services/walletService.js` — MMK debit allow-list
