#!/usr/bin/env bash
# Sync NOWPayments payout env vars from local .env → Vercel.
#
# Usage:
#   ./scripts/sync-nowpayments-env-to-vercel.sh           # check local + print missing
#   ./scripts/sync-nowpayments-env-to-vercel.sh --vercel  # push present vars to Vercel
#   ./scripts/sync-nowpayments-env-to-vercel.sh --check   # exit 1 if required vars missing locally
#
# Prerequisites for --vercel:
#   npx vercel login
#   npx vercel link
#
# Required for live USDT payouts:
#   NOWPAYMENTS_API_KEY
#   NOWPAYMENTS_EMAIL
#   NOWPAYMENTS_PASSWORD
#   NOWPAYMENTS_IPN_SECRET
#   PUBLIC_BASE_URL
#   NOWPAYMENTS_PAYOUTS_ENABLED=true
# Optional (if account has payout 2FA):
#   NOWPAYMENTS_PAYOUT_2FA_SECRET  (preferred) or NOWPAYMENTS_PAYOUT_VERIFICATION_CODE
# Recommended:
#   NOWPAYMENTS_REQUIRE_LIVE_PAYOUT=true

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
BACKEND_ENV="$ROOT/backend/.env"
PUSH_VERCEL=0
CHECK_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --vercel) PUSH_VERCEL=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

REQUIRED=(
  NOWPAYMENTS_API_KEY
  NOWPAYMENTS_EMAIL
  NOWPAYMENTS_PASSWORD
  NOWPAYMENTS_IPN_SECRET
  PUBLIC_BASE_URL
)

OPTIONAL=(
  NOWPAYMENTS_PAYOUTS_ENABLED
  NOWPAYMENTS_REQUIRE_LIVE_PAYOUT
  NOWPAYMENTS_PAYOUT_2FA_SECRET
  NOWPAYMENTS_PAYOUT_VERIFICATION_CODE
  USDT_AUTO_WITHDRAW_MAX_USDT
  NOWPAYMENTS_PAYOUT_IPN_CALLBACK_URL
  NOWPAYMENTS_API_BASE_URL
)

read_env_value() {
  local key="$1"
  local val=""
  if [[ -n "${!key:-}" ]]; then
    val="${!key}"
  else
    for f in "$ENV_FILE" "$BACKEND_ENV"; do
      if [[ -f "$f" ]] && grep -q "^${key}=" "$f" 2>/dev/null; then
        val="$(grep "^${key}=" "$f" | head -1 | cut -d= -f2-)"
        # strip surrounding quotes
        val="${val%\"}"
        val="${val#\"}"
        val="${val%\'}"
        val="${val#\'}"
        break
      fi
    done
  fi
  printf '%s' "$val"
}

echo "NOWPayments payout env check"
echo "============================"
MISSING=()
for key in "${REQUIRED[@]}"; do
  val="$(read_env_value "$key")"
  if [[ -z "$val" ]]; then
    echo "  ✗ $key  (missing)"
    MISSING+=("$key")
  else
    echo "  ✓ $key  (set, ${#val} chars)"
  fi
done

echo
echo "Optional / recommended:"
for key in "${OPTIONAL[@]}"; do
  val="$(read_env_value "$key")"
  if [[ -z "$val" ]]; then
    echo "  · $key  (unset)"
  else
    echo "  ✓ $key  (set)"
  fi
done

# Ensure payouts enabled flag when pushing
PAYOUTS_ENABLED="$(read_env_value NOWPAYMENTS_PAYOUTS_ENABLED)"
REQUIRE_LIVE="$(read_env_value NOWPAYMENTS_REQUIRE_LIVE_PAYOUT)"

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo
  echo "Missing required vars: ${MISSING[*]}"
  echo "Add them to .env (or Vercel dashboard), then re-run with --vercel."
  if [[ "$CHECK_ONLY" -eq 1 || "$PUSH_VERCEL" -eq 1 ]]; then
    exit 1
  fi
fi

push_one() {
  local key="$1"
  local val="$2"
  local env_name="$3"
  if [[ -z "$val" ]]; then
    return 0
  fi
  echo "→ Setting $key on Vercel ($env_name)..."
  printf '%s' "$val" | npx vercel env rm "$key" "$env_name" -y >/dev/null 2>&1 || true
  printf '%s' "$val" | npx vercel env add "$key" "$env_name"
}

if [[ "$PUSH_VERCEL" -eq 1 ]]; then
  if ! npx vercel whoami >/dev/null 2>&1; then
    echo "Not logged into Vercel. Run: npx vercel login" >&2
    exit 1
  fi
  if [[ ! -f "$ROOT/.vercel/project.json" && ! -f "$ROOT/backend/.vercel/project.json" ]]; then
    echo "Project not linked. Run from repo root: npx vercel link" >&2
    exit 1
  fi

  # Default flags if not present locally
  if [[ -z "$PAYOUTS_ENABLED" ]]; then
    PAYOUTS_ENABLED=true
  fi
  if [[ -z "$REQUIRE_LIVE" ]]; then
    REQUIRE_LIVE=true
  fi

  ALL_KEYS=(
    "${REQUIRED[@]}"
    NOWPAYMENTS_PAYOUTS_ENABLED
    NOWPAYMENTS_REQUIRE_LIVE_PAYOUT
    NOWPAYMENTS_PAYOUT_2FA_SECRET
    NOWPAYMENTS_PAYOUT_VERIFICATION_CODE
    USDT_AUTO_WITHDRAW_MAX_USDT
    NOWPAYMENTS_PAYOUT_IPN_CALLBACK_URL
  )

  for env_name in production preview; do
    for key in "${ALL_KEYS[@]}"; do
      if [[ "$key" == "NOWPAYMENTS_PAYOUTS_ENABLED" ]]; then
        push_one "$key" "$PAYOUTS_ENABLED" "$env_name"
      elif [[ "$key" == "NOWPAYMENTS_REQUIRE_LIVE_PAYOUT" ]]; then
        push_one "$key" "$REQUIRE_LIVE" "$env_name"
      else
        push_one "$key" "$(read_env_value "$key")" "$env_name"
      fi
    done
  done

  echo
  echo "Done. Redeploy so env vars are live:"
  echo "  npx vercel --prod"
  echo
  echo "Then verify in admin: GET /api/admin/nowpayments/payout-config"
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  echo "All required NOWPayments payout vars are present locally."
fi
