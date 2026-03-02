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
echo "   Keeping an SSE connection open for 120 s to verify no premature cutoff."
echo "   (Skip with Ctrl+C if you only need quick checks.)"

LONG_TMPFILE=$(mktemp)
# Use 'timeout' to enforce a hard 120 s wall clock.  If the connection is
# still alive at 120 s, timeout kills curl with exit code 124 — that's a pass.
# If curl exits on its own before 100 s (exit 0 from a natural "done" event
# is OK; anything else means the stream was cut).
START_TS=$(date +%s)
timeout 120 curl -sS -N \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN}" \
    -d '{"agentId":"main","message":"stream test keepalive"}' \
    "https://${BRIDGE_HOST}/chat/stream" \
    >"$LONG_TMPFILE" 2>/dev/null
CURL_EXIT=$?
END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))

# exit 124 = timeout killed curl after 120 s (connection stayed open — pass)
# exit 0   = stream finished naturally with a "done" event (pass)
# anything else before 100 s = premature cutoff (fail)
DONE_EVENT=$(grep -c "^event: done" "$LONG_TMPFILE" 2>/dev/null || echo 0)

if [ "$CURL_EXIT" -eq 124 ]; then
    check "SSE stayed open for full 120 s (timeout killed curl — pass)" true
elif [ "$DONE_EVENT" -gt 0 ]; then
    check "SSE completed naturally with done event after ${ELAPSED}s (pass)" true
elif [ "$ELAPSED" -ge 100 ]; then
    check "SSE lasted ${ELAPSED}s (≥100 s — no premature cutoff)" true
else
    check "SSE died after only ${ELAPSED}s (expected ≥100 s or done event)" false
fi

rm -f "$LONG_TMPFILE"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "==============================="
echo " Passed: ${PASS}   Failed: ${FAIL}"
echo "==============================="

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
