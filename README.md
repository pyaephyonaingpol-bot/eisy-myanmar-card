# Eisy Global — Virtual Card Issuance with Automated Myanmar Payment Deposits

Complete system with three components:

| Component | Tech | Purpose |
|-----------|------|---------|
| `backend/` | Node.js + Express + SQLite | API, deposits, cards, Telegram alerts |
| `deposit_listener/` | Android (Kotlin) | Listens to KBZPay/WavePay notifications |
| `user_app/` | Flutter | User wallet, deposits, virtual card UI |

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run seed    # Creates demo user (id=1) with sample card
npm start       # http://localhost:3000
```

**Optional Telegram alerts:** Edit `.env` with your bot token and admin chat ID.

**API endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/deposit/request` | Create pending deposit, get ref code |
| POST | `/api/deposit/verify` | Verify deposit (Android listener) |
| GET | `/api/deposit/status/:ref_code` | Poll deposit status |
| POST | `/api/admin/issue-card` | Issue/update virtual card |
| GET | `/api/user/:user_id` | Get user profile & balance |
| GET | `/api/user/card/:user_id` | Get user's virtual card |

### 2. Flutter User App

```bash
cd user_app
flutter pub get
flutter run
```

Edit `lib/config/app_config.dart` to set your backend URL:
- **Android emulator:** `http://10.0.2.2:3000`
- **Physical device:** `http://<YOUR_LAN_IP>:3000`

### 3. Android Deposit Listener

Open `deposit_listener/` in **Android Studio** and run on a physical Android device (notification access requires a real device).

1. Update `SERVER_URL` in `app/build.gradle.kts` if needed (default: `http://10.0.2.2:3000` for emulator).
2. Build & install the APK.
3. Tap **Enable Notification Access** and grant permission to "Eisy Payment Listener".
4. When KBZPay or WavePay posts a payment notification containing `REF-XXXX`, the app parses it and calls `/api/deposit/verify`.

## End-to-End Test Flow

1. Start backend: `cd backend && npm start`
2. Run Flutter app on emulator/device
3. Go to **Deposit** → enter amount (e.g. `50000` MMK) → **Generate Payment Code**
4. Copy the ref code (e.g. `REF-8492`)
5. Simulate verification via curl:

```bash
curl -X POST http://localhost:3000/api/deposit/verify \
  -H "Content-Type: application/json" \
  -d "{\"ref_code\":\"REF-8492\",\"amount\":50000,\"txn_id\":\"TXN123\",\"sender_phone\":\"+959123456789\"}"
```

6. Flutter app polls status and shows **Payment Verified**; home screen balance updates.

## Architecture

```
┌─────────────┐     POST /deposit/request      ┌──────────────┐
│ Flutter App │ ─────────────────────────────► │   Backend    │
│  (user_app) │ ◄── poll /deposit/status ───── │  (Express)   │
└─────────────┘                                └──────┬───────┘
                                                      │
┌─────────────┐     POST /deposit/verify              │ Telegram
│   Android   │ ─────────────────────────────────────►│ Bot Alert
│  Listener   │   (parses KBZPay/WavePay notifs)      ▼
└─────────────┘                                ┌──────────────┐
                                               │    Admin     │
                                               └──────────────┘
```

## Configuration

| Setting | Location | Default |
|---------|----------|---------|
| Server port | `backend/.env` | `3000` |
| MMK→USD rate | `backend/.env` | `4500` |
| Flutter API URL | `user_app/lib/config/app_config.dart` | `http://10.0.2.2:3000` |
| Listener server URL | `deposit_listener/app/build.gradle.kts` | `http://10.0.2.2:3000` |

## Issue a Card (Admin)

```bash
curl -X POST http://localhost:3000/api/admin/issue-card \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":1,\"card_number\":\"4532 8765 4321 0987\",\"exp_date\":\"12/28\",\"cvv\":\"456\",\"card_holder_name\":\"JOHN DOE\"}"
```

## Notes

- SQLite database is stored at `backend/data/eisy.db`.
- The Android listener targets package IDs: `com.kbzbank.kpay` (KBZPay) and `mm.com.wavemoney.wavepay` (WavePay).
- Reference codes match pattern `REF-\d{4}` in notification text.
- For production, use HTTPS, authentication, and PostgreSQL.
