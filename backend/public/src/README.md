# Frontend modular source (`/src`)

Served statically from `backend/public/src` → browser path `/src/...`.

## Layout

| Folder | Purpose | Status |
|--------|---------|--------|
| `lib/` | Config, storage keys, shared constants | Step 1–2 ✅ |
| `types/` | Shared type definitions (JSDoc / `.d.ts`) | Step 1–2 ✅ |
| `services/` | API clients + Supabase bridge | Step 3 ✅ |
| `hooks/` | Fee math, busy guards, polling | Step 4 ✅ |
| `components/` | Toast, fee preview, address box, log | Step 5 ✅ |

## Runtime

Classic scripts attach to:

- `window.Eisy` — config / storageKeys / constants
- `window.EisyServices` — domain APIs
- `window.EisyHooks` — business helpers
- `window.EisyComponents` — UI helpers
- `window.SupabaseBridge` — from `src/services/supabaseService.js`

`dashboard.js` / `admin.js` remain orchestrators and progressively delegate into these modules.
