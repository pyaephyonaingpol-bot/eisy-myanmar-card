# Pagocards proxy on DigitalOcean

Production **never** calls Pagocards directly from Vercel. All Business API traffic goes through a **DigitalOcean Droplet proxy** so Pagocards sees a **fixed whitelisted IPv4**.

## Request path

```
Browser → Vercel (Express) → HTTP PAGO_CARD_API_BASE_URL → Droplet /api/pago → Pagocards API
```

On the **Droplet**, the Express app mounts **`/api/pago`** in `backend/src/index.js` and forwards to Pagocards. You do **not** need nginx for path routing unless you prefer it.

| Env | Role |
|-----|------|
| `PAGO_PROXY_UPSTREAM_ORIGIN` | Pagocards site origin (default `https://pagocards.com`). Override if your contract uses another host. |
| `PAGO_PROXY_TIMEOUT_MS` | Optional upstream timeout (default 60000, clamped 5s–120s). |

The client builds paths with `PAGO_CARD_BUSINESS_API_PREFIX` (default `/api/v1`).  
**Automatic dedup:** if `PAGO_CARD_API_BASE_URL` ends with `/api/pago` and the path starts with `/api/v1`, the client **drops the duplicate** `/api/v1` so the request is `{base}/cards/...`, not `{base}/api/v1/cards/...`.

You can still set `PAGO_CARD_BUSINESS_API_PREFIX=` to send `{base}/cards/...` explicitly when the base has no `/api/pago` suffix.

Headers on upstream calls (set by `lib/pagocard.ts`):

| Header | Env var |
|--------|---------|
| `publickey` | `PAGO_CARD_API_KEY` |
| `secretkey` | `PAGO_CARD_SECRET_KEY` |

Pagocards validates the **Droplet egress IP**, not the Vercel serverless IP.

## After migrating to a new Droplet

1. **Pagocards dashboard** — add the **new public IPv4** to the IP whitelist; remove the old IP when safe.
2. **Vercel** (Production + Preview if used):
   - `PAGO_CARD_API_BASE_URL=http://NEW_IP/api/pago`  
     **or**
   - `PAGO_CARD_PROXY_HOST=NEW_IP` (optional `PAGO_CARD_PROXY_SCHEME=http`, `PAGO_CARD_PROXY_PATH=/api/pago`)
   - `PAGO_CARD_WHITELIST_IP=NEW_IP` (recommended — used by verify scripts only)
   - `PAGO_CARD_DEPRECATED_PROXY_HOSTS=OLD_IP` (optional — fails verify if base URL still points at old host)
3. **Droplet** — deploy backend with the built-in `/api/pago` proxy (or nginx) so `http://DROPLET:3000/api/pago/...` is not Express JSON `404 Not found`. Headers (`publickey`, `secretkey`, `Content-Type`) are forwarded to upstream.
4. **Firewall** — allow Vercel (or `0.0.0.0/0` if only key-protected) to reach the Droplet on port 80/443 for `/api/pago`.

## Verify

```bash
cd backend
node scripts/check-env-config.js
node scripts/verify-pago-proxy-env.js
node scripts/verify-pago-proxy-env.js --probe   # live getAdminBalance via proxy
```

Admin UI: `GET /api/admin/pagocards/proxy-check` (cards permission).

## Reading Vercel / server logs (`Could not reach Pagocards`)

On transport failures the server logs one JSON line per attempt (no secrets):

```
[pago] transport_fail {"host":"167.x.x.x","method":"GET","path":"/api/v1/cards/{id}","timeoutMs":12000,"timedOut":false,"code":"PAGO_NETWORK","errName":"TypeError","errCode":"UND_ERR_CONNECT_TIMEOUT","message":"fetch failed"}
```

| Field | Meaning |
|--------|---------|
| `timedOut` true | Upstream did not respond within `timeoutMs` (or AbortSignal timeout) |
| `errCode` e.g. `ECONNREFUSED` | Nothing listening on that host:port (wrong URL or service down) |
| `errCode` `ENOTFOUND` | DNS / hostname typo in `PAGO_CARD_API_BASE_URL` |
| `UND_ERR_*` (undici) | Low-level connection failure from Node’s fetch (often firewall or TLS) |

Set `PAGO_CARD_SILENCE_TRANSPORT_LOG=true` only if you must mute these lines.

## Symptoms

| Symptom | Likely cause |
|---------|----------------|
| `fetch failed` / `PAGO_NETWORK` | Wrong `PAGO_CARD_API_BASE_URL`, Droplet down, or firewall |
| HTTP 401/403 from Pagocards | API keys wrong or **new IP not whitelisted** |
| Card list works, reveal fails | Same as above on `getCardDetails` refresh |

See also `backend/docs/DROPLET_SWEEP_CRON.md` for **Netts** IP whitelist (`TRON_NETTS_REAL_IP`) — separate from Pagocards.
