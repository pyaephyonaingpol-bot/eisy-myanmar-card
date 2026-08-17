# Frontend modular source (`/src`)

Served statically from `backend/public/src` → browser path `/src/...`.

## Layout

| Folder | Purpose | Status |
|--------|---------|--------|
| `lib/` | Config, storage keys, shared constants | **Step 1–2 (now)** |
| `types/` | Shared type definitions (JSDoc / `.d.ts`) | **Step 1–2 (now)** |
| `services/` | API / Supabase clients extracted from UI | Step 3 |
| `hooks/` | Complex state / business logic helpers | Step 4 |
| `components/` | Reusable UI pieces | Step 5 |

## Runtime note

There is no bundler yet. Lib modules load as classic scripts and attach to
`window.Eisy` so existing `auth.js` / `dashboard.js` / `admin.js` keep working.
Later steps can switch consumers to ES `import` without changing paths.
