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
| `instantAppView.js` | Full Instant page — wallet + deposit CTAs + Instant Card |
| `standardAppView.js` | Full Standard page — Bitnob wallet/deposit + Standard Card |
| `appModeSwitcher.js` | Compact Instant ↔ Standard toggle; exclusive single-view mount |
| `cardProviderSwitch.js` | Legacy card-only Noon pill (fallback) |

HTML shells stay as layout. `appModeSwitcher` clears the active host and mounts either InstantAppView or StandardAppView — never both — so wallet UI, descriptions, and API handlers never overlap.
