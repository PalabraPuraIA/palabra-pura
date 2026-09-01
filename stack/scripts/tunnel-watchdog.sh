#!/usr/bin/env bash
# Keep palabra-pura Cloudflare quick-tunnel healthy and publish a STABLE public entry.
#
# Quick tunnels CHANGE hostname on every cloudflared restart.
# This script:
#  1) checks LAN web + public tunnel
#  2) restarts tunnel only if the public URL is dead / missing
#  3) writes runtime/public-url.json
#  4) upserts public_base_url into Supabase so the permanent redirect
#     https://…supabase.co/functions/v1/enciclopedia keeps working
set -euo pipefail

CONTAINER="${TUNNEL_CONTAINER:-palabra-pura-tunnel}"
WEB_LAN="${WEB_LAN_URL:-http://192.168.1.129:8088}"
RUNTIME_DIR="${RUNTIME_DIR:-/home/fintek-1/palabra-pura/stack/runtime}"
OUT_FILE="${OUT_FILE:-$RUNTIME_DIR/public-url.json}"
SYNC_ENV="${SYNC_ENV:-$RUNTIME_DIR/supabase-sync.env}"
LOCK_FILE="${LOCK_FILE:-/tmp/palabra-pura-tunnel-watchdog.lock}"
LOG_TAG="[pp-tunnel-watchdog]"

STABLE_CHAT="${STABLE_CHAT_URL:-https://palabrapuraia.github.io/palabra-pura/}"
STABLE_DASH="${STABLE_DASH_URL:-https://palabrapuraia.github.io/palabra-pura/dashboard.html}"

mkdir -p "$RUNTIME_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$LOG_TAG already running"
  exit 0
fi

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w "%{http_code}" --max-time 12 "$url" 2>/dev/null || echo "000"
}

extract_url() {
  docker logs "$CONTAINER" 2>&1 \
    | grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' \
    | grep -v 'api\.trycloudflare\.com' \
    | tail -1 || true
}

publish_supabase() {
  local base="$1"
  [[ -n "$base" ]] || return 0
  if [[ ! -f "$SYNC_ENV" ]]; then
    echo "$LOG_TAG no $SYNC_ENV — skip Supabase publish"
    return 0
  fi
  # shellcheck disable=SC1090
  source "$SYNC_ENV"
  if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    echo "$LOG_TAG incomplete supabase-sync.env"
    return 0
  fi
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"key":"public_base_url","value":sys.argv[1]}))' "$base")
  local code
  code=$(curl -sS -o /tmp/pp_sb_upsert.json -w "%{http_code}" --max-time 20 \
    -X POST "${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates,return=minimal" \
    -d "$payload" || echo "000")
  echo "$LOG_TAG supabase upsert http=$code base=$base"
}

write_status() {
  local base="$1"
  local status="$2"
  local note="$3"
  local chat="" dash=""
  if [[ -n "$base" ]]; then
    chat="${base%/}/"
    dash="${base%/}/dashboard/"
  fi
  cat >"$OUT_FILE.tmp" <<EOF
{
  "ok": $([[ "$status" == "up" ]] && echo true || echo false),
  "status": "$status",
  "baseUrl": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$base"),
  "chatUrl": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$chat"),
  "dashboardUrl": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$dash"),
  "stableChatUrl": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$STABLE_CHAT"),
  "stableDashboardUrl": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$STABLE_DASH"),
  "note": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$note"),
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  mv -f "$OUT_FILE.tmp" "$OUT_FILE"

  if [[ "$status" == "up" && -n "$base" ]]; then
    publish_supabase "$base" || true
  fi
}

# 1) Local web must be up
lan_code=$(http_code "$WEB_LAN/")
if [[ "$lan_code" != "200" ]]; then
  echo "$LOG_TAG LAN web down ($lan_code) — not restarting tunnel"
  write_status "" "lan_down" "El servidor web local no responde; el túnel no se reinicia."
  exit 0
fi

# 2) Ensure tunnel container is running
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "$LOG_TAG tunnel container not running — starting"
  (cd /home/fintek-1/palabra-pura/stack && docker compose up -d tunnel) || docker start "$CONTAINER" || true
  sleep 8
fi

url=$(extract_url)
public_code="000"
if [[ -n "$url" ]]; then
  public_code=$(http_code "$url/")
fi

if [[ "$public_code" == "200" ]]; then
  echo "$LOG_TAG ok $url"
  write_status "$url" "up" "Usa los links ESTABLES de Supabase; el hostname trycloudflare puede cambiar."
  exit 0
fi

echo "$LOG_TAG public down (url=${url:-none} code=$public_code) — restarting tunnel"
docker restart "$CONTAINER" >/dev/null
sleep 10

url=$(extract_url)
for _ in 1 2 3 4 5 6; do
  [[ -n "$url" ]] || url=$(extract_url)
  if [[ -n "$url" ]]; then
    public_code=$(http_code "$url/")
    [[ "$public_code" == "200" ]] && break
  fi
  sleep 5
  url=$(extract_url)
done

if [[ -n "$url" && "$public_code" == "200" ]]; then
  echo "$LOG_TAG recovered $url"
  write_status "$url" "up" "Túnel recuperado y publicado en el redirect estable de Supabase."
  exit 0
fi

echo "$LOG_TAG still down"
write_status "${url:-}" "down" "No se pudo recuperar el túnel público. Revisa docker logs $CONTAINER."
exit 1
