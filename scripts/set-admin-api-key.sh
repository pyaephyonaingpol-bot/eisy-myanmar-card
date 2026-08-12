#!/usr/bin/env bash
# Ensure ADMIN_API_KEY exists locally and (optionally) push it to Vercel.
#
# Usage:
#   ./scripts/set-admin-api-key.sh              # generate/load key into .env, print next steps
#   ./scripts/set-admin-api-key.sh --vercel     # also push to Vercel (requires `vercel login`)
#   ./scripts/set-admin-api-key.sh --show       # print the current key (local only)
#   ADMIN_API_KEY=my-secret ./scripts/set-admin-api-key.sh --vercel
#
# One-liners (after `npx vercel login` + `npx vercel link`):
#   grep '^ADMIN_API_KEY=' .env | cut -d= -f2- | \
#     npx vercel env add ADMIN_API_KEY production --force
#   grep '^ADMIN_API_KEY=' .env | cut -d= -f2- | \
#     npx vercel env add ADMIN_API_KEY preview --force
#   npx vercel --prod

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
SHOW=0
PUSH_VERCEL=0

for arg in "$@"; do
  case "$arg" in
    --show) SHOW=1 ;;
    --vercel) PUSH_VERCEL=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

ensure_local_key() {
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"

  if [[ -n "${ADMIN_API_KEY:-}" ]]; then
    KEY="$ADMIN_API_KEY"
  elif grep -q '^ADMIN_API_KEY=' "$ENV_FILE" 2>/dev/null; then
    KEY="$(grep '^ADMIN_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  else
    KEY="$(openssl rand -hex 32)"
  fi

  if [[ -z "$KEY" || "$KEY" == "optional-admin-key-for-testing" || "$KEY" == "eisy-admin-dev-key" ]]; then
    KEY="$(openssl rand -hex 32)"
  fi

  # Rewrite ADMIN_API_KEY line (preserve other vars)
  if grep -q '^ADMIN_API_KEY=' "$ENV_FILE"; then
    grep -v '^ADMIN_API_KEY=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  fi
  if [[ -s "$ENV_FILE" ]] && [[ "$(tail -c1 "$ENV_FILE" | wc -l)" -eq 0 ]]; then
    printf '\n' >> "$ENV_FILE"
  fi
  printf '# Admin bootstrap / emergency API key (keep secret — never commit)\nADMIN_API_KEY=%s\n' "$KEY" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "$KEY"
}

push_vercel() {
  local key="$1"
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx not found — install Node.js first." >&2
    exit 1
  fi

  if ! npx vercel whoami >/dev/null 2>&1; then
    echo "Not logged into Vercel. Run: npx vercel login" >&2
    exit 1
  fi

  if [[ ! -f "$ROOT/.vercel/project.json" && ! -f "$ROOT/backend/.vercel/project.json" ]]; then
    echo "Project not linked. Run from repo root: npx vercel link" >&2
    exit 1
  fi

  for env_name in production preview development; do
    echo "→ Setting ADMIN_API_KEY on Vercel ($env_name)..."
    # Remove existing value if present (ignore failure), then add.
    printf '%s' "$key" | npx vercel env rm ADMIN_API_KEY "$env_name" -y >/dev/null 2>&1 || true
    printf '%s' "$key" | npx vercel env add ADMIN_API_KEY "$env_name"
  done

  echo
  echo "Done. Redeploy production so the new env var is live:"
  echo "  npx vercel --prod"
}

KEY="$(ensure_local_key)"

echo "ADMIN_API_KEY is set in .env (gitignored)."
if [[ "$SHOW" -eq 1 ]]; then
  echo
  echo "ADMIN_API_KEY=$KEY"
fi

if [[ "$PUSH_VERCEL" -eq 1 ]]; then
  push_vercel "$KEY"
else
  echo
  echo "Next — push to Vercel (requires login + linked project):"
  echo "  ./scripts/set-admin-api-key.sh --vercel"
  echo
  echo "Or manually:"
  echo "  npx vercel login"
  echo "  npx vercel link"
  echo "  grep '^ADMIN_API_KEY=' .env | cut -d= -f2- | npx vercel env add ADMIN_API_KEY production"
  echo "  grep '^ADMIN_API_KEY=' .env | cut -d= -f2- | npx vercel env add ADMIN_API_KEY preview"
  echo "  npx vercel --prod"
  echo
  echo "Then open /admin.html → Create Super Admin and paste the same ADMIN_API_KEY."
fi
