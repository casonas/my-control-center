# VPS Scrapers

## Files
- `jobs_scraper.py` -> writes `vps/scrapers/output/jobs.json`
- `props_scraper.py` -> writes `vps/scrapers/output/props.json`

## VPS Setup
```bash
cd ~/my-control-center
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install feedparser
```

## Manual Run
```bash
cd ~/my-control-center
source .venv/bin/activate
# Optional: turn on browser-style meta search (SearXNG)
# export SEARXNG_BASE_URL="https://your-searxng-host"
# export JOBS_EXCLUDE_REMOTE=1
python vps/scrapers/jobs_scraper.py
python vps/scrapers/props_scraper.py
```

## SearXNG Mode (browser-style scraping)
`jobs_scraper.py` now supports pulling search results from your own SearXNG instance.

Environment variables:
- `SEARXNG_BASE_URL` (required to enable this source), example: `https://search.yourdomain.com`
- `JOBS_EXCLUDE_REMOTE` (optional, default `1`), set to `0` to include remote jobs

Quick verification:
```bash
cd ~/my-control-center
source .venv/bin/activate
export SEARXNG_BASE_URL="https://search.yourdomain.com"
export JOBS_EXCLUDE_REMOTE=1
python vps/scrapers/jobs_scraper.py
cat vps/scrapers/output/jobs.json | jq '.feeds, .count_deduped'
```

Expected:
- `feeds` includes at least one `SearXNG ...` source key
- `count_deduped` increases vs RSS-only runs

## Surgical + Google Proxy Search
Two additional search modes are supported:
- `Surgical` (focused queries for onsite/hybrid cyber roles)
- `GoogleProxy` fallback via a proxy template

Environment variables:
- `JOBS_ENABLE_SURGICAL=1` (default on)
- `JOBS_ENABLE_GOOGLE_PROXY=1` (default on)
- `GOOGLE_PROXY_TEMPLATE` default:
  `https://r.jina.ai/http://www.google.com/search?q={q}&hl=en&gl=us`

Source-only test (without full ingestion):
```bash
cd ~/my-control-center
source .venv/bin/activate
export SEARXNG_BASE_URL="https://search.yourdomain.com"
export GOOGLE_PROXY_TEMPLATE="https://r.jina.ai/http://www.google.com/search?q={q}&hl=en&gl=us"
python vps/scrapers/test_search_sources.py
```

Expected test output:
- `searxng count=...`
- `google-proxy count=...`

## Cron (every 30 minutes)
```cron
*/30 * * * * cd /home/openclaw/my-control-center && . .venv/bin/activate && python vps/scrapers/jobs_scraper.py >> /home/openclaw/scraper-jobs.log 2>&1
*/30 * * * * cd /home/openclaw/my-control-center && . .venv/bin/activate && python vps/scrapers/props_scraper.py >> /home/openclaw/scraper-props.log 2>&1
```

## Output Contract
Jobs item:
```json
{
  "title": "SOC Analyst",
  "company": "Example Co",
  "location": "remote",
  "url": "https://...",
  "source": "Indeed SOC Analyst",
  "posted_at": "...",
  "fetched_at": "...",
  "dedupe_key": "..."
}
```

Props item:
```json
{
  "player": "Player Name",
  "market": "points",
  "line": 24.5,
  "odds": -115,
  "book": "book-name",
  "event_id": "nba_x",
  "edge_score": 5,
  "status": "active",
  "fetched_at": "..."
}
```
