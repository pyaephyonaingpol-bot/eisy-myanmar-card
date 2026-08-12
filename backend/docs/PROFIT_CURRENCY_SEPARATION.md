# Separate MMK vs USDT profit ledgers

Platform earnings are tracked in **two independent ledgers**. They are never
combined into a single mixed USD/MMK total on the admin Revenue dashboard.

## Ledgers

| Ledger | Setting key | Written by |
|--------|-------------|------------|
| **USDT profit** | `platform_usdt_revenue_balance` | P2P fees, USDT deposit/withdraw fees, card reload/issue paid from USDT wallet |
| **MMK profit** | `platform_mmk_revenue_balance` | MMK deposit/withdraw fees, card reload/issue paid from MMK wallet |

Fee events in `platform_fee_events` use native `currency`:
- `USDT` for USDT-rail profit
- `MMK` for MMK-rail profit

## Withdrawable net profit (pool − liabilities)

Separately from booked fee totals, admin can see **how much can actually be
withdrawn** after covering user balances:

| Currency | Total pool | Liabilities | Withdrawable net profit |
|----------|------------|-------------|-------------------------|
| **USDT** | TRON master wallet USDT | Σ `balance_usdt + balance_usdt_locked` | `pool − liabilities − pending crypto nets` |
| **MMK** | `platform_mmk_cash_float` if set (>0), else `liabilities + booked MMK fees` | Σ `balance_mmk` | With cash float: `pool − liabilities − pending MMK nets`. Without: booked MMK fee revenue |

API: `GET /api/admin/withdrawable-profit`  
Also embedded in `GET /api/admin/revenue/dashboard` → `withdrawable_net_profit`.

Optional setting: **MMK cash float** (`platform_mmk_cash_float`) — total MMK held
in bank/payment accounts. Leave empty/0 to use the accounting pool.

## Card profit routing

`recordCardProfitByWallet()`:
- `wallet_type=usdt` → credits **USDT** ledger
- `wallet_type=mmk` (default) → credits **MMK** ledger (`net_profit_usd × mmk_rate`)

## Admin UI

Revenue & Profit shows:
- **Withdrawable MMK / USDT Net Profit** (pool − liabilities)
- **MMK / USDT Fee Profit** (today / all-time booked fees)

Settings / Ledger Summary show withdrawable amounts and both booked balances.
