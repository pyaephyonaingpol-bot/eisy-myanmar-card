# Bitnob fixed-IP egress proxy

Bitnob production API keys require **outbound IP allowlisting**. Vercel Hobby (and Pro without Static IPs) uses rotating egress IPs, so direct calls from the serverless function get `403 IP address not whitelisted`.

This repo includes a **lightweight reverse proxy** you run on any VPS with a static public IP. Only Bitnob API traffic goes through it; webhooks stay inbound to Vercel as usual.

```
Vercel (eisymyanmar.com)
  └─ lib/bitnob.js  ──HMAC + X-Eisy-Bitnob-Proxy-Key──►  VPS static IP
                                                          └─ bitnob-egress-proxy.js
                                                               └─ https://api.bitnob.com
```

## 1. Deploy the proxy (VPS)

On a small Linux VPS (Hetzner, DigitalOcean, Lightsail, etc.) with a **fixed public IP**:

```bash
# copy this repo (or just the script), then:
export BITNOB_EGRESS_PROXY_SECRET='generate-a-long-random-secret'
export BITNOB_EGRESS_UPSTREAM_URL=https://api.bitnob.com
export PORT=8787
node backend/scripts/bitnob-egress-proxy.js
```

Put it behind HTTPS (Caddy / nginx / Traefik) so the public URL is e.g. `https://bitnob-egress.yourdomain.com`.

Example systemd unit sketch:

```ini
[Service]
Environment=BITNOB_EGRESS_PROXY_SECRET=…
Environment=BITNOB_EGRESS_UPSTREAM_URL=https://api.bitnob.com
Environment=PORT=8787
ExecStart=/usr/bin/node /opt/eisy/backend/scripts/bitnob-egress-proxy.js
Restart=always
```

Confirm health: `curl -sS https://bitnob-egress.yourdomain.com/health`

## 2. Whitelist the VPS IP in Bitnob

In the Bitnob dashboard IP allowlist, add the VPS **public** IP (the one Bitnob will see on `/api/whoami`).

```bash
curl -fsS https://api.ipify.org   # run on the VPS
```

## 3. Point the Vercel app at the proxy

Set these **Vercel Production** env vars (do not commit secrets):

| Variable | Value |
|----------|--------|
| `BITNOB_EGRESS_PROXY_URL` | `https://bitnob-egress.yourdomain.com` |
| `BITNOB_EGRESS_PROXY_SECRET` | same secret as on the VPS |
| `BITNOB_CLIENT_ID` / `BITNOB_CLIENT_SECRET` | unchanged Bitnob HMAC keys |
| `BITNOB_API_BASE_URL` | leave as `https://api.bitnob.com` (used only if proxy URL is unset) |

`lib/bitnob.js` will:

1. Sign requests with Bitnob HMAC as usual  
2. Send them to `BITNOB_EGRESS_PROXY_URL`  
3. Attach `X-Eisy-Bitnob-Proxy-Key`  

The proxy strips that key and forwards HMAC headers + body to Bitnob.

## 4. Verify

From any machine with the secret:

```bash
# health (no secret)
curl -sS "$BITNOB_EGRESS_PROXY_URL/health"

# full stack (uses proxy + real Bitnob once IP is whitelisted)
BITNOB_LIVE_TEST=1 npm run test:bitnob-virtual-cards
```

Local unit tests (mock upstream, no Bitnob):

```bash
npm run test:bitnob-egress-proxy
```

## Security notes

- Proxy requires the shared key on every `/api/*` request (not an open relay).
- Only `/api/*` is forwarded.
- Prefer TLS termination on the VPS; keep the secret in Vercel env + VPS env only.
- Rotate `BITNOB_EGRESS_PROXY_SECRET` if leaked; Bitnob credentials stay separate.
- Inbound Bitnob **webhooks** (`/api/webhook/bitnob/cards`) do **not** use this proxy.
