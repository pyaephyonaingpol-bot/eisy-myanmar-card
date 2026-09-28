# Frontend components (Step 5)

Reusable UI helpers for the vanilla SPA. Attached to `window.EisyComponents`.

| Module | Role |
|--------|------|
| `toast.js` | Auth + copy toasts |
| `depositFeePreview.js` | Fee preview DOM |
| `usdtAddressBox.js` | Address/QR + deposit tabs |
| `activityLog.js` | Activity feed entries |
| `instantCardView.js` | Non-KYC Instant Card page — internal USDT Wallet + Kripicard only |
| `standardCardView.js` | KYC Standard Card page — Bitnob wallet + deposit address only |
| `cardProviderSwitch.js` | Noon pill that **exclusively** mounts one view at a time (page swap) |

HTML shells (`index.html` / `admin.html`) stay as layout. The Noon toggle clears the active host and mounts either Instant or Standard — never both — so wallet UI, descriptions, and API handlers never overlap.
