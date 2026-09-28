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
| `appModeSwitcher.js` | Hub-only Instant ↔ Standard exclusive mount |
| `cardProviderSwitch.js` | Legacy card-only Noon pill (fallback) |

## Portals

Dedicated URLs (enterprise-style split):

- `/instant` → Instant portal (Master USDT Wallet + Kripicard only)
- `/standard` → Standard portal (Bitnob wallet + KYC only)
- `/` hub → portal chooser after login; optional in-app Noon switch on My Cards

Generated shells: `instant.html` / `standard.html` via `npm run write-portal-html`.
Each portal removes the other flow's pages from the DOM so wallets never overlap.
