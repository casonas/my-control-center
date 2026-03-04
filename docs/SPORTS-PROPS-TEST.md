# Sports Props + Picks — Acceptance Tests

## Overview

This document covers the acceptance tests for the NBA props board and AI-generated pick cards system.

### Architecture

1. **Props Board** — Player prop lines ingested via POST, stored in D1 with board_hash for change detection
2. **Pick Cards** — AI-generated (Workers AI) picks cached per board_hash; 3 card types: top_plays, safe_slip, aggressive_slip
3. **Cache Logic** — board_hash computed from active props; if unchanged, cached cards returned (no LLM call)
4. **Rate Limit** — Generation rate-limited to once per 10 minutes per user+league

---

## Test A — Ingest

**Goal:** Verify props ingest normalizes data, computes board_hash, and upserts correctly.

```bash
# POST 10 mock props rows
curl -X POST https://<your-domain>/api/sports/props/ingest \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -H "X-CSRF: <csrf-token>" \
  -d '{
    "league": "nba",
    "source": "vegasinsider",
    "props": [
      {"eventId":"g1","homeTeam":"Lakers","awayTeam":"Celtics","player":"LeBron James","market":"pts","line":25.5,"odds":-110,"book":"draftkings"},
      {"eventId":"g1","homeTeam":"Lakers","awayTeam":"Celtics","player":"Jayson Tatum","market":"points","line":27.5,"odds":-115,"book":"fanduel"},
      {"eventId":"g1","homeTeam":"Lakers","awayTeam":"Celtics","player":"Anthony Davis","market":"reb","line":10.5,"odds":100,"book":"draftkings"},
      {"eventId":"g2","homeTeam":"Warriors","awayTeam":"Suns","player":"Stephen Curry","market":"3pm","line":4.5,"odds":-120,"book":"betmgm"},
      {"eventId":"g2","homeTeam":"Warriors","awayTeam":"Suns","player":"Kevin Durant","market":"pts","line":28.5,"odds":-105,"book":"caesars"},
      {"eventId":"g2","homeTeam":"Warriors","awayTeam":"Suns","player":"Devin Booker","market":"ast","line":5.5,"odds":110,"book":"fanduel"},
      {"eventId":"g3","homeTeam":"Bucks","awayTeam":"76ers","player":"Giannis Antetokounmpo","market":"points","line":30.5,"odds":-130,"book":"draftkings"},
      {"eventId":"g3","homeTeam":"Bucks","awayTeam":"76ers","player":"Joel Embiid","market":"rebounds","line":11.5,"odds":-110,"book":"fanduel"},
      {"eventId":"g3","homeTeam":"Bucks","awayTeam":"76ers","player":"Tyrese Maxey","market":"assists","line":6.5,"odds":105,"book":"betmgm"},
      {"eventId":"g1","homeTeam":"Lakers","awayTeam":"Celtics","player":"Derrick White","market":"threes","line":2.5,"odds":120,"book":"draftkings","uncertain":true,"reason":"injury questionable"}
    ]
  }'
```

**Expected Response:**
```json
{
  "ok": true,
  "inserted": 10,
  "updated": 0,
  "passed": 1,
  "board_hash": "<16-char hex>",
  "total_active": 9
}
```

**Assertions:**
- `inserted` + `updated` = 10
- `passed` = 1 (Derrick White marked uncertain)
- `board_hash` is a non-empty hex string
- `total_active` = 9 (10 - 1 pass)

---

## Test B — Cache Behavior

**Goal:** Verify that generating picks twice with no data change returns cached results on the second call.

```bash
# 1st call — should generate fresh picks
curl -X POST https://<your-domain>/api/sports/picks/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -H "X-CSRF: <csrf-token>" \
  -d '{"league":"nba"}'
```

**Expected 1st Response:**
```json
{
  "ok": true,
  "cached": false,
  "board_hash": "<hash>",
  "duration_ms": <number>,
  "cards": {
    "top_plays": [...],
    "safe_slip": [...],
    "aggressive_slip": [...]
  }
}
```

```bash
# 2nd call (same board_hash) — should return cached
curl -X POST https://<your-domain>/api/sports/picks/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -H "X-CSRF: <csrf-token>" \
  -d '{"league":"nba"}'
```

**Expected 2nd Response:**
```json
{
  "ok": true,
  "cached": true,
  "board_hash": "<same hash>",
  "cards": { ... }
}
```

**Assertions:**
- 1st call: `cached` = false
- 2nd call: `cached` = true, same `board_hash`
- No new `generated` action in `sports_generation_log` for 2nd call

---

## Test C — Board Change

**Goal:** Verify that changing a prop line produces a new board_hash and triggers fresh generation.

```bash
# Change LeBron's line from 25.5 to 26.5
curl -X POST https://<your-domain>/api/sports/props/ingest \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -H "X-CSRF: <csrf-token>" \
  -d '{
    "league": "nba",
    "source": "vegasinsider",
    "props": [
      {"eventId":"g1","homeTeam":"Lakers","awayTeam":"Celtics","player":"LeBron James","market":"pts","line":26.5,"odds":-110,"book":"draftkings"}
    ]
  }'
```

**Expected:** New `board_hash` differs from previous.

```bash
# Generate picks — should produce new generation (wait 10 min or use force)
curl -X POST https://<your-domain>/api/sports/picks/generate \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -H "X-CSRF: <csrf-token>" \
  -d '{"league":"nba","force":true}'
```

**Expected:**
```json
{
  "ok": true,
  "cached": false,
  "board_hash": "<new hash>",
  "cards": { ... }
}
```

**Assertions:**
- `board_hash` from ingest differs from Test B
- `cached` = false (new board)
- `cards` contains all 3 types with valid leg structures

---

## Test D — UI Verification

**Steps:**
1. Navigate to the Sports tab in the dashboard
2. Select **NBA** league tab
3. Verify the following sections are visible:

| Section | Expected |
|---------|----------|
| **Props Board** | Shows list of props with player, market, line, odds, edge_score |
| **Top Plays** | Shows up to 3 pick cards (or empty state with reason) |
| **Best 5 Safe** | Shows 5 safe parlay legs (or empty state) |
| **Best 5 Aggressive** | Shows 5 aggressive parlay legs (or empty state) |
| **Generation Diagnostics** | Shows board_hash, cached flag, status, last generation time |
| **Test Checklist** | Shows pass/fail for each test criterion |

**Diagnostics Checks:**
- `board_hash` shows a hex string after props are loaded
- `cached` shows "yes" or "no"
- `status` shows generation result or reason
- `last generation` shows timestamp after generating

**Error Handling:**
- If generation fails, the reason is displayed in diagnostics (not silent)
- If AI is unavailable, `ai_unavailable` reason shown
- PASS badge appears on uncertain props in the board

**Test Checklist Section:**
- All items should show ✓ when system is working
- Failed items show ✗ with red "TEST FAIL" badge listing failed check names

---

## Rate Limiting

- Generation is limited to once per 10 minutes per user+league
- Use `force: true` to bypass during testing
- Rate limit response includes `retry_after_ms`
