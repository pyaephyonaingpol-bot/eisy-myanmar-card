# Frontend hooks (Step 4)

Business-logic helpers (not React hooks — vanilla SPA). Attached to `window.EisyHooks`.

| Module | Role |
|--------|------|
| `submitBusy.js` | Button spinner / in-flight guards |
| `depositFees.js` | Client fee preview math |
| `depositPolling.js` | Deposit status polling |

Dashboard methods should delegate here instead of owning the logic inline.
