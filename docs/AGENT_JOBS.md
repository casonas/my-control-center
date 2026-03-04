# Agent Jobs — VPS Runner / Bridge Contract

## Overview

MCC uses a D1-backed job queue so the UI and cron can trigger agent work without blocking requests. VPS agents poll for jobs, execute them, and post results back.

## Flow

1. **UI/Cron creates a job**: `POST /api/agents/jobs` → status `queued`
2. **Runner polls for work**: `POST /api/internal/agents/jobs/claim` → status `claimed`
3. **Runner starts work**: `POST /api/internal/agents/jobs/[id]/start` → status `running`
4. **Runner sends heartbeats**: `POST /api/internal/agents/jobs/[id]/heartbeat` (every 60s)
5. **Runner logs progress**: `POST /api/internal/agents/jobs/[id]/log`
6. **Runner completes**: `POST /api/internal/agents/jobs/[id]/complete` → status `succeeded` or `failed`

## Authentication

All internal endpoints require:
```
X-Internal-Token: <INTERNAL_SHARED_SECRET or CRON_SECRET>
```

Set one of these in both Cloudflare Pages and your VPS env:
- `INTERNAL_SHARED_SECRET` (preferred)
- `CRON_SECRET` (accepted fallback)

Optional header for internal refresh routes:
```
X-Internal-User-Id: owner
```
If omitted, routes default to `owner`.

Set the shared secret in both:
- Cloudflare Pages environment variables
- VPS bridge `.env`

## Endpoint Reference

### Claim a Job
```bash
curl -X POST https://mcc.example.com/api/internal/agents/jobs/claim \
  -H "X-Internal-Token: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":"vps-1","agentId":"stocks"}'
```
Response:
```json
{"ok":true,"job":{"id":"uuid","userId":"..","agentId":"stocks","type":"stocks_briefing","payload":{...}}}
```

### Start a Job
```bash
curl -X POST https://mcc.example.com/api/internal/agents/jobs/$JOB_ID/start \
  -H "X-Internal-Token: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":"vps-1"}'
```

### Send Heartbeat
```bash
curl -X POST https://mcc.example.com/api/internal/agents/jobs/$JOB_ID/heartbeat \
  -H "X-Internal-Token: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":"vps-1"}'
```

### Append Log
```bash
curl -X POST https://mcc.example.com/api/internal/agents/jobs/$JOB_ID/log \
  -H "X-Internal-Token: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":"vps-1","level":"info","message":"Processing 15 tickers..."}'
```

### Complete a Job
```bash
# Success
curl -X POST https://mcc.example.com/api/internal/agents/jobs/$JOB_ID/complete \
  -H "X-Internal-Token: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":"vps-1","status":"succeeded"}'

# Failure
curl -X POST https://mcc.example.com/api/internal/agents/jobs/$JOB_ID/complete \
  -H "X-Internal-Token: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"runnerId":"vps-1","status":"failed","error":"API rate limited"}'
```

## Job Types

| Type | Agent | Description |
|---|---|---|
| `stocks_briefing` | stocks | Generate market analysis |
| `sports_predictions` | sports | Run prediction models |
| `research_deep_dive` | research | Deep analysis of research items |
| `jobs_enrich` | job-search | Enrich job postings with details |
| `daily_briefing` | main | Generate daily overview |

## Stale Job Recovery

Jobs with `heartbeat_at` older than 10 minutes are considered stale. Query:
```bash
curl https://mcc.example.com/api/internal/agents/jobs/stale?agentId=stocks \
  -H "X-Internal-Token: $SECRET"
```

## Python Runner Example (bridge.py)

```python
import requests, time

BASE = "https://mcc.example.com"
HEADERS = {"X-Internal-Token": SECRET, "Content-Type": "application/json"}

while True:
    # Poll for work
    r = requests.post(f"{BASE}/api/internal/agents/jobs/claim",
        json={"runnerId": "vps-1", "agentId": "stocks"}, headers=HEADERS)
    job = r.json().get("job")
    if not job:
        time.sleep(30)
        continue

    job_id = job["id"]
    # Start
    requests.post(f"{BASE}/api/internal/agents/jobs/{job_id}/start",
        json={"runnerId": "vps-1"}, headers=HEADERS)

    try:
        # Do work...
        result = process_job(job["type"], job["payload"])

        # Heartbeat during long work
        requests.post(f"{BASE}/api/internal/agents/jobs/{job_id}/heartbeat",
            json={"runnerId": "vps-1"}, headers=HEADERS)

        # Complete
        requests.post(f"{BASE}/api/internal/agents/jobs/{job_id}/complete",
            json={"runnerId": "vps-1", "status": "succeeded"}, headers=HEADERS)
    except Exception as e:
        requests.post(f"{BASE}/api/internal/agents/jobs/{job_id}/complete",
            json={"runnerId": "vps-1", "status": "failed", "error": str(e)}, headers=HEADERS)
```
