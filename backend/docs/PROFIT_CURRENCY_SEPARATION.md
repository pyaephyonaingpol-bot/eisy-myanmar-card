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

Legacy `USD` card fee rows (if any) are attributed by `metadata.wallet_type`
and converted only for the MMK bucket when needed — they are not added into
USDT totals.

## Card profit routing

`recordCardProfitByWallet()`:
- `wallet_type=usdt` → credits **USDT** ledger (`net_profit_usd` as USDT)
- `wallet_type=mmk` (default) → credits **MMK** ledger (`net_profit_usd × mmk_rate`)

## Admin UI

Revenue & Profit shows:
- **MMK Profit (Today / All-time)** in MMK
- **USDT Profit (Today / All-time)** in USDT
- Period chips and daily table with **separate** MMK and USDT columns

Settings / Ledger Summary shows both booked balances side by side.

## API

`GET /api/admin/revenue/dashboard` summary fields:

- `today_mmk_profit_mmk`, `all_time_mmk_profit_mmk`
- `today_usdt_profit_usdt`, `all_time_usdt_profit_usdt`
- `platform_mmk_revenue_balance`, `platform_usdt_revenue_balance`
- Component fields: `today_card_reload_profit_mmk`, `today_card_reload_profit_usdt`, …

`GET /api/admin/settings` → `ledger_summary.platform_revenue_mmk`
