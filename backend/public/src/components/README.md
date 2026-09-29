# Frontend components (Step 5)

Reusable UI helpers for the vanilla SPA. Attached to `window.EisyComponents`.

| Module | Role |
|--------|------|
| `toast.js` | Auth + copy toasts |
| `depositFeePreview.js` | Fee preview DOM |
| `usdtAddressBox.js` | Address/QR + deposit tabs |
| `activityLog.js` | Activity feed entries |
| `instantCardView.js` | Non-KYC Instant Card form — USDT Wallet + Kripicard only |
| `instantAppView.js` | Full Instant portal page — Master USDT + TRC20 + Instant Card |

## Portals

Dedicated URL:

- `/instant` → Instant portal (Master USDT Wallet + Kripicard + P2P)
- `/` hub → portal gateway with Instant CTA; header links to `/instant`

**My Cards** shows card management + route CTAs only. Apply flows live on the Instant portal (`#instant-card` or `/instant`).

Generated shell: `instant.html` via `npm run write-portal-html`.
