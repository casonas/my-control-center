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
python vps/scrapers/jobs_scraper.py
python vps/scrapers/props_scraper.py
```

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

