# DigitalOcean Droplet — scheduled TRON USDT sweep

Use this when the **Droplet** runs daily Netts-powered sweeps (`backend/scripts/sweep-tron-deposits.js`). Production web/API may still live on Vercel; sweeps should originate from the Droplet so Netts sees your whitelisted IP (`TRON_NETTS_REAL_IP` + TCP egress).

## 1. Prerequisites

- Repo cloned on the Droplet (e.g. `~/eisy-myanmar-card`)
- Node.js **18+** and `npm install` at repo root and `cd backend && npm install`
- PM2 or systemd keeping **nothing extra** required for cron — only Node + env files
- Netts dashboard: whitelist the Droplet **public IPv4**
- Turso/libSQL credentials so the script can list custodial HD addresses

## 2. Environment (`backend/.env`)

| Variable | Required | Notes |
|----------|----------|--------|
| `TRON_ENERGY_API_URL` | Yes | e.g. `https://netts.io/apiv2/order1h` |
| `TRON_ENERGY_API_KEY` | Yes | Netts API key |
| `TRON_NETTS_REAL_IP` | Yes | Same IPv4 as whitelisted in Netts (`X-Real-IP`) |
| `TRON_FULL_HOST` | Yes | e.g. `https://api.trongrid.io` |
| `CENTRAL_WALLET_ADDRESS` | Yes* | Sweep destination (*or `MASTER_WALLET_ADDRESS`) |
| `MASTER_PRIVATE_KEY` | Yes | HD + master ops |
| `TRON_HD_MNEMONIC` or seed | Yes | Prefer dedicated mnemonic |
| `TRONGRID_API_KEY` | Strongly recommended | Avoid 429 on balance reads |
| `DATABASE_URL` + `DATABASE_AUTH_TOKEN` | Yes (Turso) | Address list |

Confirm on the server:

```bash
curl -s https://ifconfig.me
# Must match TRON_NETTS_REAL_IP
```

## 3. Verify env (no secrets printed)

```bash
cd ~/eisy-myanmar-card/backend
node scripts/verify-droplet-sweep-env.js
```

## 4. Dry-run test (one address)

```bash
cd ~/eisy-myanmar-card/backend
node scripts/sweep-tron-deposits.js --dry-run --all --limit=1
```

Expect JSON summary with `"dryRun": true`, `"checked": 1`, and no on-chain txs.

## 5. Manual live sweep (optional)

```bash
node scripts/sweep-tron-deposits.js --all --limit=50
```

Ensure `MASTER_WALLET_TRANSFERS_PAUSED` is not blocking live transfers.

## 6. Cron — daily automated sweep

Make the wrapper executable once:

```bash
chmod +x ~/eisy-myanmar-card/backend/scripts/run-scheduled-sweep.sh
mkdir -p ~/eisy-myanmar-card/logs
```

**Test cron path (dry-run, no broadcast):**

```bash
TRON_SWEEP_CRON_DRY_RUN=1 ~/eisy-myanmar-card/backend/scripts/run-scheduled-sweep.sh
```

**Crontab** (`crontab -e` as the deploy user):

```cron
# Live sweep daily at 03:15 UTC (adjust timezone as needed)
15 3 * * * /home/deploy/eisy-myanmar-card/backend/scripts/run-scheduled-sweep.sh >> /home/deploy/eisy-myanmar-card/logs/sweep-cron.log 2>&1
```

Optional env in `backend/.env`:

```bash
TRON_SWEEP_CRON_LIMIT=500
# TRON_SWEEP_CRON_DRY_RUN=1   # only for testing; remove for production
```

The wrapper:

- Loads `backend/.env`
- Runs `verify-droplet-sweep-env.js`
- Uses `flock` so overlapping runs skip safely
- Invokes `sweep-tron-deposits.js --scheduled --all`

## 7. Keep the Droplet running 24/7

- Enable DigitalOcean monitoring / alerts on the Droplet
- If PM2 runs the API on the same host: `pm2 startup` + `pm2 save`
- Cron only needs the OS scheduler; reboots re-load crontab automatically

## 8. Logs and failures

- Cron log: `~/eisy-myanmar-card/logs/sweep-cron.log`
- Telegram sweep alerts (if configured) fire via `tronWalletMonitorService` after each run
- Non-zero exit if any address fails — inspect log and re-run with `--dry-run` first
