# Frontend components (Step 5)

Reusable UI helpers for the vanilla SPA. Attached to `window.EisyComponents`.

| Module | Role |
|--------|------|
| `toast.js` | Auth + copy toasts |
| `depositFeePreview.js` | Fee preview DOM |
| `usdtAddressBox.js` | Address/QR + deposit tabs |
| `activityLog.js` | Activity feed entries |
| `instantCardView.js` | Non-KYC Instant Card (Master Wallet / Kripicard) — isolated markup + logic |
| `standardCardView.js` | KYC Standard Card (Bitnob wallet) — isolated markup + logic |
| `cardProviderSwitch.js` | Noon-style Instant ↔ Standard pill that mounts the two views |

HTML shells (`index.html` / `admin.html`) stay as layout; Instant/Standard apply UI is owned by the card view modules and switched via the Noon toggle on My Cards (or mounted alone on dedicated Instant / Standard pages).
