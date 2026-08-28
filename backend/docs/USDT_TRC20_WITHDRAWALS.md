# USDT withdrawals

## Crypto (NOWPayments mass payouts)

When NOWPayments payouts are configured, `POST /api/withdrawal/usdt` with
`payout_method=crypto` automatically submits a Custody payout:

1. User creates withdrawal → USDT balance debited, row `pending`/`processing`
2. Server `POST /v1/auth` → JWT, then `POST /v1/payout` with:
   - TRC20 → `currency: "usdttrc20"`
   - BEP20 → `currency: "usdtbsc"`
3. Optional `POST /v1/payout/:id/verify` when 2FA is enabled
4. IPN marks the row `completed` (stores `tx_hash`) or `rejected` (refunds)

Env: see [`NOWPAYMENTS.md`](./NOWPAYMENTS.md). Feature flag:
`NOWPAYMENTS_PAYOUTS_ENABLED` / `USDT_AUTO_WITHDRAW_ENABLED`, optional cap
`USDT_AUTO_WITHDRAW_MAX_USDT`.

Retry endpoints:

- User: `POST /api/nowpayments/payout` `{ "withdrawal_id": 123 }`
- Admin: `POST /api/admin/withdrawals/usdt/:id/nowpayments-payout`

## Crypto fallback (TRON master wallet)

When NOWPayments payouts are **not** configured, admin complete still sends
TRC20 via TronWeb from `MASTER_PRIVATE_KEY`:

1. User creates `POST /api/withdrawal/usdt` with `network=TRC20` → row `pending`
2. Admin completes `POST /api/admin/withdrawals/usdt/:id/complete`
3. `processUsdtTrc20Withdrawal` → `transferUsdtTrc20`
4. Stores `txId`, marks `completed`

If a manual `tx_hash` is provided, the on-chain / NOWPayments send is skipped.

## Admin balance check

`GET /api/admin/master-wallet-balance` returns TRX + USDT for the master address
(used when falling back to hot-wallet sends).

## Env (master wallet fallback)

| Variable | Required | Notes |
|----------|----------|--------|
| `MASTER_PRIVATE_KEY` | yes (for auto send) | 64-char hex, no `0x` |
| `USDT_TRC20_CONTRACT` | no | defaults to mainnet USDT |
| `TRON_FULL_HOST` | no | default `https://api.trongrid.io` |
| `TRONGRID_API_KEY` | no | recommended for rate limits |

## MMK / balance policy (unchanged)

- **MMK → USDT conversion is forbidden** (`assertMmkToUsdtForbidden`, debit purpose guard)
- MMK wallet debits only for: card issuance, card reload, MMK bank withdrawal
- TRC20 / NOWPayments payouts never debit/credit MMK
- USDT→bank and MMK bank withdrawals stay manual/admin bank rails

## Automated withdraw API (energy rental)

`POST /api/withdraw` (auth + PIN) accepts:

```json
{ "customerAddress": "T…", "withdrawAmount": 25 }
```

Flow:

1. Validate `withdrawAmount > 2.0` (fixed fee)
2. Debit full amount from the user’s in-app USDT wallet
3. Rent ~65,000 energy for the master wallet via Feee.io
4. Wait ~2s for delegation
5. Transfer **net** USDT (`withdrawAmount - 2`) via TronWeb (`amount * 10^6` base units)
6. Return `txId`, `netPayout`, `feeCollected`

| Variable | Required | Notes |
|----------|----------|--------|
| `ENERGY_RENTAL_API_KEY` | for rental | Feee.io API key (`key` header) |
| `ENERGY_RENTAL_API_BASE` | no | default `https://feee.io/open` |
| `ENERGY_RENTAL_AMOUNT` | no | default `65000` |
| `ENERGY_RENTAL_WAIT_MS` | no | default `2000` |
| `ENERGY_RENTAL_REQUIRED` | no | if `true`, abort transfer when rental fails |
| `WITHDRAW_FIXED_FEE_USDT` | no | default `2` |

Energy rental also runs automatically inside `transferUsdtTrc20` (admin master-wallet completes).

## Key files

- `backend/src/services/nowPaymentsPayoutService.js` — auth, create/verify payout, IPN
- `backend/src/services/tronMasterWalletService.js` — TronWeb transfer + balance checks + energy rental hook
- `backend/src/services/energyRentalService.js` — Feee.io energy rental
- `backend/src/services/withdrawCryptoService.js` — fixed-fee `/api/withdraw` flow
- `backend/src/routes/withdraw.js` — `POST /api/withdraw`
- `backend/src/services/withdrawalService.js` — create / complete / reject
- `backend/src/services/walletService.js` — MMK debit allow-list
- `server/routes/nowpayments.js` — `/payout`, `/payout-webhook`
