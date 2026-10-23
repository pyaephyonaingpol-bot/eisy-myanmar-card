#!/usr/bin/env bash
# Daily (or cron) TRON HD deposit sweep on the DigitalOcean Droplet.
# Uses Netts energy rental — run verify-droplet-sweep-env.js once before enabling live cron.
#
# Env (optional, in backend/.env or exported):
#   TRON_SWEEP_CRON_DRY_RUN=1     — append --dry-run (test cron without broadcasting)
#   TRON_SWEEP_CRON_LIMIT=500     — max custodial addresses per run
#   TRON_SWEEP_CRON_LOG_DIR=...   — default: $APP_DIR/logs
#
# Crontab example (live sweep daily at 03:15 UTC):
#   15 3 * * * /home/deploy/eisy-myanmar-card/backend/scripts/run-scheduled-sweep.sh >> /home/deploy/eisy-myanmar-card/logs/sweep-cron.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="$(cd "${BACKEND_DIR}/.." && pwd)"

cd "${BACKEND_DIR}"

if [[ -f "${BACKEND_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${BACKEND_DIR}/.env"
  set +a
elif [[ -f "${APP_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${APP_DIR}/.env"
  set +a
fi

LOG_DIR="${TRON_SWEEP_CRON_LOG_DIR:-${APP_DIR}/logs}"
mkdir -p "${LOG_DIR}"
LOCK_FILE="${LOG_DIR}/tron-sweep-cron.lock"
LIMIT="${TRON_SWEEP_CRON_LIMIT:-500}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date -Is)] sweep cron skipped — another sweep is already running"
  exit 0
fi

echo "[$(date -Is)] sweep cron start APP_DIR=${APP_DIR} limit=${LIMIT}"

node "${SCRIPT_DIR}/verify-droplet-sweep-env.js" || {
  echo "[$(date -Is)] env verification failed — aborting sweep"
  exit 1
}

ARGS=(--scheduled --all "--limit=${LIMIT}")
if [[ "${TRON_SWEEP_CRON_DRY_RUN:-}" == "1" || "${TRON_SWEEP_CRON_DRY_RUN:-}" == "true" ]]; then
  ARGS=(--dry-run "${ARGS[@]}")
  echo "[$(date -Is)] TRON_SWEEP_CRON_DRY_RUN set — dry-run only"
fi

node "${SCRIPT_DIR}/sweep-tron-deposits.js" "${ARGS[@]}"
EXIT=$?
echo "[$(date -Is)] sweep cron finished exit=${EXIT}"
exit "${EXIT}"
