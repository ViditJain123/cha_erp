#!/usr/bin/env bash
#
# Pushes production environment variables to the Vercel project from .env.local.
#
#   ./deploy/push-vercel-env.sh https://cha-erp-web.vercel.app
#
# Values are piped to `vercel env add` on stdin and never printed, so no secret
# is echoed to the terminal, a log, or a transcript. Only variable NAMES appear.
#
# Prerequisites:
#   npm i -g vercel
#   vercel login
#   vercel link --project cha-erp-web
#
set -euo pipefail

TARGET="${2:-production}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO/.env.local"

APP_URL="${1:-}"
if [[ -z "$APP_URL" ]]; then
  echo "usage: $0 <production-url> [target]" >&2
  echo "  e.g. $0 https://cha-erp-web.vercel.app" >&2
  exit 1
fi
APP_URL="${APP_URL%/}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: vercel CLI not found. Install with: npm i -g vercel" >&2
  exit 1
fi

if [[ ! -d "$REPO/.vercel" ]]; then
  echo "ERROR: this repo is not linked to a Vercel project." >&2
  echo "Run: vercel link --project cha-erp-web" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# --- values that must DIFFER from the dev .env.local --------------------------

# Your dev file has GRAPH_TRANSPORT=console, which prints outgoing Outlook mail
# instead of sending it. In production that must be `graph`.
GRAPH_TRANSPORT=graph

# Kept as `common` by explicit decision -- it also admits personal Microsoft
# accounts. Must stay in sync with the worker box's .env.local.
MS_TENANT_ID=common

MAIL_TRANSPORT=resend
NEXT_PUBLIC_APP_URL="$APP_URL"
MS_REDIRECT_URI="$APP_URL/api/integrations/microsoft/callback"

# --- the set the web app actually reads ---------------------------------------
# Deliberately excluded: WORKER_* (worker box only) and SEED_ADMIN_* (one-off
# seeding script, not read by the deployed app).

VARS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  NEXT_PUBLIC_APP_URL
  SUPABASE_SERVICE_ROLE_KEY
  MS_CLIENT_ID
  MS_CLIENT_SECRET
  MS_REDIRECT_URI
  MS_TENANT_ID
  TOKEN_ENCRYPTION_KEY
  GRAPH_TRANSPORT
  OPENAI_API_KEY
  RESEND_API_KEY
  MAIL_FROM
  MAIL_TRANSPORT
)

echo "Project : $(basename "$REPO")  ->  target '$TARGET'"
echo "App URL : $APP_URL"
echo

missing=()
for name in "${VARS[@]}"; do
  [[ -z "${!name:-}" ]] && missing+=("$name")
done
if (( ${#missing[@]} )); then
  echo "ERROR: these are empty in $ENV_FILE:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi

for name in "${VARS[@]}"; do
  # Remove first so re-runs are idempotent. `vercel env add` errors on an
  # existing key rather than replacing it. Failure here is fine: it just means
  # the key was not set yet.
  vercel env rm "$name" "$TARGET" --yes >/dev/null 2>&1 || true

  # printf, not echo -n: no trailing newline gets baked into the value.
  if printf '%s' "${!name}" | vercel env add "$name" "$TARGET" >/dev/null 2>&1; then
    echo "  set  $name"
  else
    echo "  FAIL $name" >&2
  fi
done

echo
echo "Done. Verify with:  vercel env ls $TARGET"
echo
echo "NEXT_PUBLIC_* are inlined at BUILD time, so this does not affect the"
echo "running deployment. Redeploy to pick them up:  vercel --prod"
