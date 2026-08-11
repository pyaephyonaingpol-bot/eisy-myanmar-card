# Static assets (served from /assets/…)

Source of truth: `backend/public/assets/`
Vercel build copies this tree into root `public/assets/`.

| Path | Purpose |
|------|---------|
| `/assets/images/` | Logos / marketing images |
| `/assets/qr/` | Optional static QR PNGs (merchant posters, etc.) |

Dynamic deposit QRs are generated at `/api/qr?data=…` (PNG).
