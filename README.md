# Eisy Myanmar

**Eisy Myanmar** is a virtual card and digital wallet platform for Myanmar users. It combines MMK local payments (KBZPay / WavePay / bank), USDT crypto rails (TRC20 / BEP20), Binance Pay, a P2P marketplace, KYC, and an admin console for card issuance and payouts.

Production site: [eisymyanmar.com](https://eisymyanmar.com)

---

## Project overview

Eisy Myanmar lets users:

- Top up a platform **MMK** and **USDT** wallet
- Request and manage **virtual cards**
- Deposit via **platform USDT wallets**, **Binance Pay**, or local bank methods
- Withdraw USDT (TRC20 hot-wallet automation with safety thresholds) or MMK to bank
- Trade peer-to-peer on the **P2P Express** market
- Complete **KYC** and manage account security (PIN / biometrics)

Operators use the **Admin portal** (`/admin`) for deposits, card issuance, withdrawals, KYC, P2P disputes, settings, and ledger views.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **Backend API** | Node.js (≥18), Express |
| **Database** | LibSQL / Turso (`@libsql/client`); local file DB by default; optional legacy `sqlite3` |
| **Realtime / sync** | Supabase (optional — wallet/deposit sync + Realtime) |
| **Auth** | Session + PIN tokens, OTP email (Resend), admin RBAC |
| **Payments** | Binance Pay, TRON (TronWeb / TronGrid), BEP20 RPC / explorers |
| **Web UI** | Vanilla HTML / JS / CSS SPA served from `backend/public` |
| **Styling** | Custom CSS design system (`styles.css`) — CSS variables, responsive layout (**not Tailwind**) |
| **Native shells** | Capacitor (`mobile/`), Flutter app (`user_app/`) |
| **MMK listener** | Android Kotlin app (`deposit_listener/`) |
| **Deploy** | Vercel serverless (`api/index.js` → Express) |
| **Alerts** | Telegram bot (optional) |

---

## Repository layout

```
eisy-myanmar-card/
├── api/                    # Vercel serverless entry
├── backend/
│   ├── src/                # Express API (routes, services, models)
│   ├── public/             # Primary web SPA + admin UI
│   │   └── src/            # Modular frontend (see below)
│   ├── docs/               # Vercel, Binance Pay, deposit security, USDT
│   ├── migrations/         # DB migrations
│   └── scripts/            # Tests & ops scripts
├── deposit_listener/       # Android KBZPay/WavePay notification listener
├── user_app/               # Flutter client
├── mobile/                 # Capacitor wrapper around the web UI
├── supabase/               # Supabase-related assets (if present)
└── vercel.json             # Production deploy config
```

### Backend API structure (`backend/src`)

```
backend/src/
├── routes/         # HTTP routers (deposit, withdrawal, user, admin, p2p, …)
├── services/       # Domain logic (deposits, USDT, P2P, cards, fees, …)
├── models/         # DB access
├── middleware/     # Auth, upload
├── lib/            # DB drivers, admin roles, helpers
└── constants/      # Shared enums / fee types
```

---

## Modular frontend (`backend/public/src`)

The web SPA was refactored into a clean modular tree. Files are served statically as **`/src/...`** (from `backend/public/src`).

Classic scripts attach to global namespaces so the app runs **without a bundler**:

| Namespace | Role |
|-----------|------|
| `window.Eisy` | Config, storage keys, constants |
| `window.EisyServices` | Domain API clients + Supabase bridge |
| `window.EisyHooks` | Fee math, submit busy guards, polling |
| `window.EisyComponents` | Reusable UI helpers |
| `window.SupabaseBridge` | Supabase client (ES module) |

### Breakdown

```
backend/public/src/
├── components/          # Reusable UI helpers
│   ├── toast.js
│   ├── depositFeePreview.js
│   ├── usdtAddressBox.js
│   └── activityLog.js
├── hooks/               # Business logic helpers (vanilla, not React)
│   ├── submitBusy.js
│   ├── depositFees.js
│   └── depositPolling.js
├── services/            # API & data layer
│   ├── apiClient.js
│   ├── depositApi.js
│   ├── usdtWalletApi.js
│   ├── withdrawalApi.js
│   ├── cardsApi.js
│   ├── accountApi.js
│   ├── p2pApi.js
│   └── supabaseService.js
├── lib/                 # Config & shared constants
│   ├── config.js
│   ├── storageKeys.js
│   ├── constants.js
│   ├── apiConfig.js
│   └── helpers.js
└── types/               # TypeScript declaration files (.d.ts)
    ├── user.d.ts
    ├── deposit.d.ts
    ├── wallet.d.ts
    └── index.d.ts
```

`dashboard.js` and `admin.js` remain thin orchestrators and progressively delegate into these modules.

---

## Features (high level)

- **USDT deposits** — TxHash verification (TronGrid / explorers), auto-credit when confirmed
- **USDT withdrawals** — hot-wallet TRC20 payout under a safety threshold; larger amounts → admin
- **Duplicate deposit protection** — UI submit locks + backend rapid-duplicate window
- **Binance Pay** — create order + webhook credit (net after fee)
- **P2P** — buy/sell ads, escrow, chat, disputes
- **Admin RBAC** — role-based pages and permissions

More detail: [`backend/docs/`](backend/docs/) (`DEPOSIT_SECURITY.md`, `USDT_TRC20_WITHDRAWALS.md`, `BINANCE_PAY.md`, `ADMIN_RBAC.md`).

---

## Setup (local development)

### Prerequisites

- Node.js **18+**
- npm
- (Optional) Flutter / Android Studio for `user_app` and `deposit_listener`

### 1. Backend + web UI

```bash
git clone https://github.com/pyaephyonaingpol-bot/eisy-myanmar-card.git
cd eisy-myanmar-card

# Install root deps (Vercel / shared) and backend deps
npm install
cd backend && npm install && cd ..

# Environment
cp backend/.env.example backend/.env
# Edit backend/.env — at minimum set AUTH_SECRET

# Optional: seed demo data
cd backend && npm run seed && cd ..

# Start API + static SPA
npm run dev
# → http://localhost:3000
# → Admin: http://localhost:3000/admin
```

Useful scripts (from `backend/`):

```bash
npm run migrate
npm run test:deposit-security
npm run test:usdt-deposit-duplicate
npm run test:frontend-lib
npm run test:frontend-modular
```

### 2. Environment variables (common)

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | Session signing |
| `PUBLIC_BASE_URL` | Canonical site URL |
| `DATABASE_URL` / `DATABASE_AUTH_TOKEN` | Turso in production |
| `MASTER_PRIVATE_KEY` | TRON hot wallet for TRC20 payouts |
| `TRONGRID_API_KEY` | TronGrid rate limits (optional) |
| `BINANCE_API_KEY` / `BINANCE_SECRET_KEY` / `BINANCE_MERCHANT_ID` | Binance Pay |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional Supabase |
| `USDT_AUTO_WITHDRAW_ENABLED` / `USDT_AUTO_WITHDRAW_MAX_USDT` | Auto-payout policy |
| `USDT_DEPOSIT_DUPLICATE_WINDOW_SEC` | Rapid duplicate deposit window (default 90) |

Full template: [`backend/.env.example`](backend/.env.example) and [`.env.example`](.env.example).

### 3. Flutter user app (optional)

```bash
cd user_app
flutter pub get
# Set API URL in lib/config/app_config.dart
flutter run
```

- Android emulator → `http://10.0.2.2:3000`
- Physical device → `http://<YOUR_LAN_IP>:3000`

### 4. Android deposit listener (optional)

1. Open `deposit_listener/` in Android Studio
2. Set `SERVER_URL` if needed
3. Install on a **physical** device and grant notification access
4. Listener posts to `POST /api/deposit/verify` when KBZPay / WavePay notifications contain a deposit ref

### 5. Capacitor mobile shell (optional)

```bash
cd mobile
npm install
npm run prepare-web   # if script present — syncs web assets
npx cap open android
```

---

## Deployment (Vercel)

Pushing to `main` deploys when the GitHub repo is linked to a Vercel project.

| Piece | Role |
|-------|------|
| Root `vercel.json` | Build copies `backend/public` → `public/`; API rewrites |
| `api/index.js` | Serverless entry into Express |
| `backend/public/` | Static SPA + modular `/src` |

**Required production env (minimum):**

- `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (Turso — required for persistent data on Vercel)
- `AUTH_SECRET`
- `PUBLIC_BASE_URL`
- Binance Pay keys (if using Binance deposits)
- `MASTER_PRIVATE_KEY` (if using TRC20 auto-withdrawals)

See [`backend/docs/VERCEL.md`](backend/docs/VERCEL.md) and [`backend/docs/BINANCE_PAY.md`](backend/docs/BINANCE_PAY.md).

Binance webhook URL:

```text
https://YOUR_DOMAIN/api/webhook/binance
```

---

## Key API routes (sample)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/deposit/request` | Create MMK or USDT deposit request |
| `POST` | `/api/deposit/submit` | Submit TxHash / payment proof |
| `GET` | `/api/deposit/status/:ref_code` | Poll deposit status (USDT re-verify) |
| `POST` | `/api/deposit/create` | Binance Pay order |
| `POST` | `/api/withdrawal/usdt` | USDT withdrawal (may auto-pay) |
| `GET` | `/api/user/usdt-wallet` | USDT wallet overview |
| `GET` / `POST` | `/api/p2p/...` | P2P market & orders |
| `POST` | `/api/admin/...` | Admin operations (RBAC) |

---

## Architecture (simplified)

```
┌──────────────────┐     HTTPS /api/*      ┌─────────────────────┐
│  Web SPA (/)     │ ───────────────────────► │  Express (Vercel)   │
│  Admin (/admin)  │ ◄── JSON + static ─── │  + LibSQL / Turso   │
│  /src modular JS │                        └─────────┬───────────┘
└──────────────────┘                                  │
┌──────────────────┐     optional sync                │ on-chain /
│  Supabase        │ ◄────────────────────────────────┤ Binance /
└──────────────────┘                                  │ Telegram
┌──────────────────┐     POST /deposit/verify         │
│ Android listener │ ─────────────────────────────────►│
└──────────────────┘                                  ▼
                                               Master wallet (TRC20)
```

---

## Testing checklist (web)

After a hard refresh (`?v=` cache bust on scripts):

1. Login / session restore works
2. Console: `window.Eisy`, `EisyServices.ready`, `EisyHooks.ready`, `EisyComponents.ready`
3. USDT deposit request + fee preview
4. Submit TxHash (busy spinner; no double submit)
5. Wallet balances load

---

## Documentation index

| Doc | Topic |
|-----|--------|
| [`backend/docs/VERCEL.md`](backend/docs/VERCEL.md) | Vercel + Turso |
| [`backend/docs/BINANCE_PAY.md`](backend/docs/BINANCE_PAY.md) | Binance Pay |
| [`backend/docs/DEPOSIT_SECURITY.md`](backend/docs/DEPOSIT_SECURITY.md) | Deposit hardening |
| [`backend/docs/USDT_TRC20_WITHDRAWALS.md`](backend/docs/USDT_TRC20_WITHDRAWALS.md) | TRC20 withdrawals |
| [`backend/docs/ADMIN_RBAC.md`](backend/docs/ADMIN_RBAC.md) | Admin roles |
| [`backend/public/src/README.md`](backend/public/src/README.md) | Frontend modular map |

---

## License

ISC — see `package.json`.
