# Frontend components (Step 5)

Reusable UI helpers for the vanilla SPA. Attached to `window.EisyComponents`.

| Module | Role |
|--------|------|
| `toast.js` | Auth + copy toasts |
| `depositFeePreview.js` | Fee preview DOM |
| `usdtAddressBox.js` | Address/QR + deposit tabs |
| `activityLog.js` | Activity feed entries |
| `instantCardView.js` | Non-KYC Instant Card form — USDT Wallet + Kripicard only |
| `standardCardView.js` | KYC Standard Card form — Bitnob wallet + deposit only |
| `instantAppView.js` | Full Instant portal page — Master USDT + TRC20 + Instant Card |
| `standardAppView.js` | Full Standard portal page — Bitnob wallet + KYC + Standard Card |
| `appModeSwitcher.js` | Legacy helper (route portals preferred; not mounted inside My Cards) |
| `cardProviderSwitch.js` | Legacy card-only Noon pill (fallback) |

## Portals

Dedicated URLs (enterprise-style split):

- `/instant` → Instant portal (Master USDT Wallet + Kripicard + P2P only)
- `/standard` → Standard portal (Bitnob wallet + KYC + Standard Card only — no P2P / master USDT)
- `/` hub → portal chooser after login; header links to `/instant` and `/standard`

**My Cards** shows card management + route CTAs only. It never nests an Instant↔Standard toggle — apply flows live on dedicated portal pages (`#instant-card` / `#standard-card` or `/instant` / `/standard`).

Generated shells: `instant.html` / `standard.html` via `npm run write-portal-html`.
Each portal removes the other flow's pages from the DOM so wallets never overlap.
On `/standard`, Instant-only modules marked `data-instant-only` (P2P, Master USDT top-up/withdraw/Scan Pay, deposits history) are removed entirely.
