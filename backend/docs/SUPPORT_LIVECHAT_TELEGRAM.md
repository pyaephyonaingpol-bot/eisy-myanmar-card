# Unified Live Chat & Support Tickets (Telegram 2-way)

## Overview

Customers open categorized tickets (**MMK Payouts**, **Card Issuing Issues**) from a floating live-chat widget. Admins manage the same threads in **Admin → Support** with filters (category / priority / status) and live updates. Every customer Support message is delivered to the admin Telegram chat by the same connected bot (`TELEGRAM_BOT_TOKEN`, @eisyadminbot) and `TELEGRAM_ADMIN_CHAT_ID`. Admin replies in that Telegram thread sync back into the web chat in real time.

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

Production delivers `POST` (and answers `GET`) at:

`https://eisymyanmar.com/api/webhook/telegram`

That path is the Express route `backend/src/routes/webhook.js` (`router.post('/telegram')`). Vercel rewrites `/api/*` to the Express function. `app/api/webhook/telegram/route.ts` is the same handler for a Next server; it is not a different URL.

`setWebhook` returns `{ "ok": false }` when the URL is not public HTTPS, the host is a protected `*.vercel.app` deployment, the secret contains characters other than `A-Z a-z 0-9 _ -`, or the endpoint answers with a non-2xx status. `GET` and an empty `POST` both return HTTP 200.

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d '{"url":"https://eisymyanmar.com/api/webhook/telegram","secret_token":"'"$TELEGRAM_WEBHOOK_SECRET"'","allowed_updates":["message","edited_message","channel_post","edited_channel_post"]}'
```

On Vercel, boot calls that same `setWebhook` unless `TELEGRAM_WEBHOOK_AUTOREGISTER=false`.

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

- `POST /api/webhook/telegram` parses an incoming Bot API update (`message`, `edited_message`, or channel post). When an admin hits Reply, the handler matches the ticket by the replied message id or by `#T123` in the quoted text, saves `sender_type=admin` / `source=telegram` on `support_messages`, and the customer live-chat inbox shows it on the next poll.

## Tests

```bash
npm run test:admin-support-tasks --prefix backend
npm run test:support-livechat-telegram --prefix backend
```
