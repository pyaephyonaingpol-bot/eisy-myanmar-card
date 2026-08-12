# USDT balance audit (master wallet vs ledger)

Validates whether the **TRON master wallet** on-chain USDT balance correlates with
internal user / platform USDT balances.

## Quick start

```bash
cd backend
npm run audit:usdt-balances
```

Options:

```bash
npm run audit:usdt-balances -- --json
npm run audit:usdt-balances -- --skip-chain          # DB totals only
npm run audit:usdt-balances -- --tolerance 0.10      # default 0.05 USDT
```

Or:

```bash
node scripts/audit-usdt-balances.js
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Synced within tolerance (or `--skip-chain` with DB-only run) |
| `1` | Discrepancy above tolerance |
| `2` | On-chain master wallet query failed |

## Formula

```
expected_master =
    Σ(user.balance_usdt + user.balance_usdt_locked)
  + platform_usdt_revenue_balance
  + pending/processing crypto withdrawal nets   # still on-chain until sent
  + bank withdrawal nets (pending/completed)    # USDT stays; MMK paid off-chain
  + USDT spent on cards from USDT wallet         # still on master until provider pay

discrepancy = master_on_chain − expected_master
```

| Discrepancy | Meaning |
|-------------|---------|
| ≈ `0` | Synced |
| `> 0` | Master surplus (external top-up, uncredited deposit, understated ledger) |
| `< 0` | Master shortfall (external spend, inflated balances, admin credits without deposit) |

**Booked net profit** in the report is `platform_usdt_revenue_balance` (fee account),
not the raw chain surplus. Use `discrepancy` for sync health; use
`chain − user balances` as a coarse float view.

## Admin API

```
GET /api/admin/usdt-balance-audit
```

Requires `master_wallet` or `ledger` permission.

Query params:

- `skip_chain=1` — skip TRON RPC
- `tolerance=0.05` — sync tolerance in USDT

## Required env

- `DATABASE_URL` (+ `DATABASE_AUTH_TOKEN` for Turso)
- For on-chain check: `MASTER_WALLET_ADDRESS` and/or `MASTER_PRIVATE_KEY`
- Recommended: `TRONGRID_API_KEY`
