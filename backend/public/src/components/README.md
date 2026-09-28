# Frontend components (Step 5)

Reusable UI helpers for the vanilla SPA. Attached to `window.EisyComponents`.

| Module | Role |
|--------|------|
| `toast.js` | Auth + copy toasts |
| `depositFeePreview.js` | Fee preview DOM |
| `usdtAddressBox.js` | Address/QR + deposit tabs |
| `activityLog.js` | Activity feed entries |
| `instantCardView.js` | Non-KYC Instant Card form — USDT Wallet + Kripicard only |
| `standardCardView.js` | KYC Business Card form — Bitnob wallet + deposit only |
| `instantAppView.js` | Full Instant portal page — Master USDT + TRC20 + Instant Card |
| `standardAppView.js` | Full Business portal page — Bitnob wallet + KYC + Business Card |
| `appModeSwitcher.js` | Legacy helper (route portals preferred; not mounted inside My Cards) |
| `cardProviderSwitch.js` | Legacy card-only Noon pill (fallback) |

## Portals

Dedicated URLs (enterprise-style split):

- `/instant` → Instant portal (Master USDT Wallet + Kripicard + P2P only)
- `/business` → Business portal (Bitnob wallet + KYC + Business Card only — no P2P / master USDT); `/standard` is kept as an alias
- `/` hub → portal chooser after login; header links to `/instant` and `/business`

**My Cards** shows card management + route CTAs only. It never nests an Instant↔Business toggle — apply flows live on dedicated portal pages (`#instant-card` / `#standard-card` or `/instant` / `/business`).

Generated shells: `instant.html` / `standard.html` via `npm run write-portal-html` (titles use Instant / Business).
Each portal removes the other flow's pages from the DOM so wallets never overlap.
On `/business`, Instant-only modules marked `data-instant-only` (P2P, Master USDT top-up/withdraw/Scan Pay, deposits history) are removed entirely.
