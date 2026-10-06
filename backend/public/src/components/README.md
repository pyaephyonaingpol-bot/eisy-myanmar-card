# Frontend components

Reusable UI helpers for the vanilla SPA. Attached to `window.EisyComponents`.

| Module | Role |
|--------|------|
| `toast.js` | Auth + copy toasts |
| `depositFeePreview.js` | Fee preview DOM |
| `usdtAddressBox.js` | Address/QR + deposit tabs |
| `activityLog.js` | Activity feed entries |
| `instantAppView.js` | Instant page — Master USDT wallet and TRON HD deposit address |

## Portals

- `/` and `/instant` show the Instant wallet (TRON HD deposit address + QR).

Generated shell: `instant.html` via `npm run write-portal-html`.
