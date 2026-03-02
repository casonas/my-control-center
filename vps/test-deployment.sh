#!/usr/bin/env bash
# test-deployment.sh — Verify Caddy reverse proxy, CORS, and SSE streaming.
#
# Usage:
#   ./vps/test-deployment.sh                          # uses default domains
#   ./vps/test-deployment.sh api.example.com bridge.example.com
#
# Requirements: curl (with --max-time support)

set -euo pipefail

API_HOST="${1:-api.my-control-center.com}"
BRIDGE_HOST="${2:-bridge.my-control-center.com}"
ORIGIN="https://my-control-center.pages.dev"
PASS=0
FAIL=0

green() { printf '\033[32m✔ %s\033[0m\n' "$1"; }
red()   { printf '\033[31m✘ %s\033[0m\n' "$1"; }

check() {
    local label="$1"; shift
    if "$@"; then
        green "$label"; ((PASS++))
    else
        red "$label"; ((FAIL++))
    fi
}

# ── 1. HTTPS reachability ────────────────────────────────────────────────────

echo ""
echo "=== 1. HTTPS reachability ==="

check "API endpoint returns HTTP 200 or 3xx over HTTPS" \
    bash -c "curl -fsS --max-time 10 -o /dev/null -w '' https://${API_HOST}/ 2>/dev/null || \
             curl -sSI --max-time 10 https://${API_HOST}/ 2>/dev/null | head -1 | grep -qE 'HTTP/[0-9.]+ [23]'"

check "Bridge /status returns HTTP 200 over HTTPS" \
    bash -c "curl -fsS --max-time 10 -o /dev/null -w '' \
             -X POST -H 'Content-Type: application/json' -d '{\"agentId\":\"main\"}' \
             https://${BRIDGE_HOST}/status 2>/dev/null || \
             curl -sSI --max-time 10 https://${BRIDGE_HOST}/status 2>/dev/null | head -1 | grep -qE 'HTTP/[0-9.]+ [23]'"

# ── 2. CORS headers ─────────────────────────────────────────────────────────

echo ""
echo "=== 2. CORS headers (Origin: ${ORIGIN}) ==="

CORS_HEADERS=$(curl -sS --max-time 10 -I \
    -H "Origin: ${ORIGIN}" \
    "https://${API_HOST}/" 2>/dev/null || true)

check "Access-Control-Allow-Origin matches pages.dev" \
    bash -c "echo '${CORS_HEADERS}' | grep -qi 'access-control-allow-origin.*my-control-center.pages.dev'"

check "Access-Control-Allow-Credentials is true" \
    bash -c "echo '${CORS_HEADERS}' | grep -qi 'access-control-allow-credentials.*true'"

# Preflight
PREFLIGHT=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" \
    -X OPTIONS \
    -H "Origin: ${ORIGIN}" \
    -H "Access-Control-Request-Method: POST" \
    "https://${API_HOST}/" 2>/dev/null || echo "000")

check "OPTIONS preflight returns 204" \
    [ "$PREFLIGHT" = "204" ]

# ── 3. /auth/me with correct origin ─────────────────────────────────────────

echo ""
echo "=== 3. /auth/me with correct origin ==="

AUTH_CODE=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" \
    -H "Origin: ${ORIGIN}" \
    "https://${API_HOST}/api/auth/me" 2>/dev/null || echo "000")

check "/api/auth/me responds (HTTP ${AUTH_CODE}, expect 200 or 401)" \
    bash -c "[[ '${AUTH_CODE}' == '200' || '${AUTH_CODE}' == '401' ]]"

# ── 4. SSE streaming ────────────────────────────────────────────────────────

echo ""
echo "=== 4. SSE streaming (/chat/stream) ==="

SSE_TMPFILE=$(mktemp)
# Send a chat request and capture output for up to 15 seconds.
# --no-buffer ensures curl writes each chunk as it arrives.
curl -sS -N --max-time 15 \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN}" \
    -d '{"agentId":"main","message":"ping"}' \
    "https://${BRIDGE_HOST}/chat/stream" \
    >"$SSE_TMPFILE" 2>/dev/null || true

SSE_LINES=$(wc -l < "$SSE_TMPFILE" | tr -d ' ')

check "SSE stream returned data (${SSE_LINES} lines)" \
    [ "$SSE_LINES" -gt 0 ]

check "SSE stream contains 'data:' events" \
    grep -q "^data:" "$SSE_TMPFILE"

rm -f "$SSE_TMPFILE"

# ── 5. SSE survives beyond 100 s (Cloudflare orange-cloud timeout) ──────────

echo ""
echo "=== 5. Long-lived SSE (>100 s timeout check) ==="
echo "   Sending a request and waiting 120 s to verify no premature cutoff."
echo "   (Skip with Ctrl+C if you only need quick checks.)"

LONG_TMPFILE=$(mktemp)
START_TS=$(date +%s)
curl -sS -N --max-time 130 \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN}" \
    -d '{"agentId":"main","message":"Tell me a very long story"}' \
    "https://${BRIDGE_HOST}/chat/stream" \
    >"$LONG_TMPFILE" 2>/dev/null || true
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

# If the connection lasted at least 100 s OR the stream completed naturally
# with a "done" event before 100 s, there's no premature cutoff.
DONE_EVENT=$(grep -c "^event: done" "$LONG_TMPFILE" 2>/dev/null || echo 0)

if [ "$ELAPSED" -ge 100 ] || [ "$DONE_EVENT" -gt 0 ]; then
    check "No premature cutoff (${ELAPSED}s elapsed, done_events=${DONE_EVENT})" true
else
    check "No premature cutoff (${ELAPSED}s elapsed — connection dropped early)" false
fi

rm -f "$LONG_TMPFILE"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "==============================="
echo " Passed: ${PASS}   Failed: ${FAIL}"
echo "==============================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
