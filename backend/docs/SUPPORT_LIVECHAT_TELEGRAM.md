# Unified Live Chat & Support Tickets (Telegram 2-way)

## Overview

Customers open categorized tickets (**MMK Payouts**, **Card Issuing Issues**) from a floating live-chat widget. Admins manage the same threads in **Admin → Support** with filters (category / priority / status) and live updates. Every customer message also notifies the admin Telegram group; admin replies in that Telegram thread sync back into the web chat in real time.

## Categories / Priority / Status

| Field | Values |
|-------|--------|
| Category | `mmk_payouts` (MMK Payouts), `card_issuing` (Card Issuing Issues) |
| Priority | `high`, `medium`, `low` |
| Status (DB) | `pending`, `in_progress`, `completed`, `failed` |
| Status (UI) | Open, In Progress, Resolved, Failed |

## Setup

### 1) Env vars

```bash
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_ADMIN_CHAT_ID=-100xxxxxxxxxx   # admin group/supergroup
# optional forum topic:
# TELEGRAM_SUPPORT_TOPIC_ID=123
TELEGRAM_WEBHOOK_SECRET=long-random-secret
```

### 2) Telegram webhook

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://YOUR_DOMAIN/api/webhook/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Reply to a ticket message in the group (messages contain `#T123`), or use:

```text
/reply #T123 Your answer to the customer
```

### 3) Supabase Realtime SQL

Run in Supabase SQL editor (after `support_threads_realtime.sql`):

- `supabase/support_messages_realtime.sql`

### 4) DB migration

Migration `058_support_telegram_bridge.sql` adds Telegram link columns on Turso/SQLite (`telegram_chat_id`, `telegram_root_message_id`, `telegram_last_outbound_id`, message `source` / `telegram_message_id`).

## API surface

Customer (`Authorization` session):

- `GET /api/support/threads`
- `POST /api/support/threads` `{ category, priority, subject, message }`
- `GET /api/support/threads/:id/messages?after_id=`
- `POST /api/support/threads/:id/messages` `{ message }`

Admin (`support` permission):

- existing `/api/admin/support/threads*` routes (list / messages / patch / reply / close)

Telegram:

- `POST /api/webhook/telegram` (Bot API updates)

## Tests

```bash
npm run test:admin-support-tasks --prefix backend
npm run test:support-livechat-telegram --prefix backend
```
