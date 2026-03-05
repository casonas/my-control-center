#!/usr/bin/env python3
"""
Direct API scraper for stocks, sports, and jobs.

This script does NOT call the existing /api/*/refresh routes.
It pulls from external providers directly:
  - Stocks: yfinance (optional), Tiingo, Massive/Polygon, Finnhub, TwelveData
  - Sports: ESPN scoreboards + The Odds API (optional)
  - Jobs: RSS feeds

No secrets are stored in code; use environment variables only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

try:
    import yfinance as yf  # type: ignore
except Exception:
    yf = None

try:
    from sportsipy.nba.boxscore import Boxscores as NbaBoxscores  # type: ignore
    from sportsipy.nfl.boxscore import Boxscores as NflBoxscores  # type: ignore
    from sportsipy.mlb.boxscore import Boxscores as MlbBoxscores  # type: ignore
    from sportsipy.nhl.boxscore import Boxscores as NhlBoxscores  # type: ignore
except Exception:
    NbaBoxscores = None
    NflBoxscores = None
    MlbBoxscores = None
    NhlBoxscores = None


DEFAULT_WATCHLIST = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA"]
DEFAULT_JOB_FEEDS = [
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "https://remoteok.com/remote-dev-jobs.rss",
    "https://stackoverflow.blog/jobs/feed/",
]
LEAGUES = ("nba", "nfl", "mlb", "nhl")
ODDS_SPORT_KEYS = {
    "nba": "basketball_nba",
    "nfl": "americanfootball_nfl",
    "mlb": "baseball_mlb",
    "nhl": "icehockey_nhl",
}


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def env_csv(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name, "")
    if not raw.strip():
        return default
    return [x.strip() for x in raw.split(",") if x.strip()]


def http_json(url: str, timeout: int = 20) -> dict[str, Any] | list[Any] | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MCC-Scraper/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None


def http_json_auth(
    url: str,
    token: str,
    auth_scheme: str = "Bearer",
    timeout: int = 20,
) -> dict[str, Any] | list[Any] | None:
    try:
        headers = {"User-Agent": "MCC-Scraper/1.0"}
        if token:
            headers["Authorization"] = f"{auth_scheme} {token}".strip()
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None


def http_text(url: str, timeout: int = 20) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "MCC-Scraper/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")
    except urllib.error.URLError:
        return None


def key_pool(*names: str) -> list[str]:
    keys: list[str] = []
    for name in names:
        raw = os.getenv(name, "")
        if not raw.strip():
            continue
        keys.extend([k.strip() for k in raw.split(",") if k.strip()])
    return keys


def pick_key(keys: list[str], slot: int) -> str | None:
    return keys[slot % len(keys)] if keys else None


@dataclass
class Quote:
    ticker: str
    price: float
    change_pct: float
    source: str
    volume: int | None = None


class StockScraper:
    def __init__(self) -> None:
        self.tiingo_keys = key_pool("TIINGO_API_KEYS", "TIINGO_API_KEY")
        self.massive_keys = key_pool("MASSIVE_API_KEYS", "POLYGON_API_KEYS", "MASSIVE_API_KEY", "POLYGON_API_KEY")
        self.finnhub_keys = key_pool("FINNHUB_API_KEYS", "FINNHUB_API_KEY")
        self.twelve_keys = key_pool("TWELVEDATA_API_KEYS", "TWELVEDATA_API_KEY")

    def scrape_quotes(self, tickers: list[str]) -> dict[str, Any]:
        out: dict[str, Quote] = {}
        errors: list[str] = []

        # 1) yfinance batch (if installed)
        if yf is not None and tickers:
            try:
                hist = yf.download(
                    tickers=tickers,
                    period="2d",
                    interval="1d",
                    auto_adjust=False,
                    progress=False,
                    threads=True,
                    group_by="ticker",
                )
                for t in tickers:
                    if t in out:
                        continue
                    try:
                        # Multi-ticker dataframe: columns are 2-level (ticker, field)
                        if hasattr(hist, "columns") and len(getattr(hist, "columns")) > 0 and hasattr(hist.columns, "nlevels") and hist.columns.nlevels == 2:
                            close_series = hist[(t, "Close")].dropna()
                            vol_series = hist[(t, "Volume")].dropna() if (t, "Volume") in hist.columns else None
                        else:
                            # Single ticker dataframe
                            close_series = hist["Close"].dropna()
                            vol_series = hist["Volume"].dropna() if "Volume" in hist else None
                        if len(close_series) == 0:
                            continue
                        close = float(close_series.iloc[-1])
                        prev = float(close_series.iloc[-2]) if len(close_series) > 1 else close
                        if close <= 0:
                            continue
                        out[t] = Quote(
                            ticker=t,
                            price=close,
                            change_pct=((close - prev) / prev * 100) if prev > 0 else 0.0,
                            source="yfinance",
                            volume=int(vol_series.iloc[-1]) if vol_series is not None and len(vol_series) > 0 else None,
                        )
                    except Exception:
                        continue
            except Exception as e:
                errors.append(f"yfinance failed: {e}")
        else:
            errors.append("yfinance not installed")

        # 2) Tiingo daily prices
        slot = 0
        for t in tickers:
            if t in out:
                continue
            key = pick_key(self.tiingo_keys, slot)
            slot += 1
            if not key:
                break
            q = fetch_tiingo_quote(t, key)
            if not q:
                continue
            out[t] = Quote(
                ticker=t,
                price=q["price"],
                change_pct=q["change_pct"],
                source="tiingo",
                volume=q["volume"],
            )
        if not self.tiingo_keys:
            errors.append("tiingo key missing")

        # 3) Massive/Polygon
        slot = 0
        for t in tickers:
            if t in out:
                continue
            key = pick_key(self.massive_keys, slot)
            slot += 1
            if not key:
                break
            u = f"https://api.polygon.io/v2/aggs/ticker/{urllib.parse.quote(t)}/prev?adjusted=true&apiKey={urllib.parse.quote(key)}"
            data = http_json(u)
            row = (data or {}).get("results", [{}])[0] if isinstance(data, dict) else {}
            c = float(row.get("c", 0) or 0)
            o = float(row.get("o", 0) or 0)
            v = row.get("v")
            if c > 0:
                out[t] = Quote(
                    ticker=t, price=c, change_pct=((c - o) / o * 100) if o > 0 else 0.0,
                    source="polygon", volume=int(v) if isinstance(v, (int, float)) else None,
                )
        if not self.massive_keys:
            errors.append("polygon key missing")

        # 4) Finnhub
        slot = 0
        for t in tickers:
            if t in out:
                continue
            key = pick_key(self.finnhub_keys, slot)
            slot += 1
            if not key:
                break
            u = f"https://finnhub.io/api/v1/quote?symbol={urllib.parse.quote(t)}&token={urllib.parse.quote(key)}"
            data = http_json(u)
            if not isinstance(data, dict):
                continue
            c = float(data.get("c", 0) or 0)
            dp = float(data.get("dp", 0) or 0)
            if c > 0:
                out[t] = Quote(ticker=t, price=c, change_pct=dp, source="finnhub")
        if not self.finnhub_keys:
            errors.append("finnhub key missing")

        # 5) TwelveData
        slot = 0
        for t in tickers:
            if t in out:
                continue
            key = pick_key(self.twelve_keys, slot)
            slot += 1
            if not key:
                break
            u = f"https://api.twelvedata.com/quote?symbol={urllib.parse.quote(t)}&apikey={urllib.parse.quote(key)}"
            data = http_json(u)
            if not isinstance(data, dict) or data.get("status") == "error":
                continue
            c = float(data.get("close", 0) or 0)
            pc = str(data.get("percent_change", "0")).replace("%", "")
            if c > 0:
                out[t] = Quote(
                    ticker=t, price=c, change_pct=float(pc or 0),
                    source="twelvedata",
                    volume=int(float(data.get("volume", 0) or 0)) if data.get("volume") else None,
                )
        if not self.twelve_keys:
            errors.append("twelvedata key missing")

        return {
            "asof": now_iso(),
            "quotes": [q.__dict__ for q in out.values()],
            "missing": [t for t in tickers if t not in out],
            "sourceHealth": [
                {"name": "yfinance", "status": "ok" if any(q.source == "yfinance" for q in out.values()) else "error"},
                {"name": "tiingo", "status": "ok" if any(q.source == "tiingo" for q in out.values()) else "error"},
                {"name": "polygon", "status": "ok" if any(q.source == "polygon" for q in out.values()) else "error"},
                {"name": "finnhub", "status": "ok" if any(q.source == "finnhub" for q in out.values()) else "error"},
                {"name": "twelvedata", "status": "ok" if any(q.source == "twelvedata" for q in out.values()) else "error"},
            ],
            "errors": errors,
        }


def scrape_sports(leagues: list[str]) -> dict[str, Any]:
    by_league: dict[str, Any] = {}
    source_health: list[dict[str, Any]] = []
    api_pages_urls = env_csv(
        "SPORTS_DATA_API_URLS",
        ["https://casonas.github.io/sports-data-api/live-scores.json"],
    )

    # Optional external sports-data-api feeds (GitHub Pages JSON)
    for feed_url in api_pages_urls:
        data = http_json(feed_url, timeout=20)
        if not isinstance(data, dict):
            source_health.append({"name": f"sports-data-api:{feed_url}", "status": "error", "error": "unreachable or non-json"})
            continue
        matches = data.get("matches")
        if not isinstance(matches, list):
            source_health.append({"name": f"sports-data-api:{feed_url}", "status": "error", "error": "missing matches array"})
            continue
        # Keep this feed under pseudo-league bucket; ESPN/sportsipy still fill nba/nfl/mlb/nhl.
        feed_games = []
        for m in matches[:100]:
            if not isinstance(m, dict):
                continue
            feed_games.append(
                {
                    "id": m.get("id") or m.get("fixtureId") or f"{m.get('homeTeam','')}-{m.get('awayTeam','')}",
                    "start": m.get("time"),
                    "status": m.get("status"),
                    "home": m.get("homeTeam"),
                    "away": m.get("awayTeam"),
                    "homeScore": m.get("homeScore"),
                    "awayScore": m.get("awayScore"),
                    "league": m.get("league"),
                }
            )
        by_league["soccer"] = {
            "games": feed_games,
            "count": len(feed_games),
            "source": "sports-data-api",
            "url": feed_url,
        }
        source_health.append({"name": f"sports-data-api:{feed_url}", "status": "ok", "items": len(feed_games)})
        break

    # Optional sportsipy source first (off by default due frequent parsing breakage).
    use_sportsipy = os.getenv("SPORTSIPY_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    sportsipy_map = {
        "nba": NbaBoxscores,
        "nfl": NflBoxscores,
        "mlb": MlbBoxscores,
        "nhl": NhlBoxscores,
    }
    today = dt.date.today()
    date_key = f"{today.month:02d}-{today.day:02d}-{today.year}"

    if use_sportsipy:
        for lg in leagues:
            box_cls = sportsipy_map.get(lg)
            if box_cls is None:
                source_health.append({"name": f"sportsipy/{lg}", "status": "error", "error": "sportsipy missing for league or not installed"})
                continue
            try:
                box = box_cls(date_key, date_key)
                raw_games = getattr(box, "games", {}).get(date_key, [])
                games = []
                for g in raw_games[:25]:
                    games.append({
                        "id": g.get("boxscore"),
                        "start": g.get("date"),
                        "status": g.get("status"),
                        "home": g.get("home_name"),
                        "away": g.get("away_name"),
                        "homeScore": g.get("home_score"),
                        "awayScore": g.get("away_score"),
                    })
                by_league[lg] = {"games": games, "count": len(games), "source": "sportsipy"}
                source_health.append({"name": f"sportsipy/{lg}", "status": "ok", "items": len(games)})
            except Exception as e:
                source_health.append({"name": f"sportsipy/{lg}", "status": "error", "error": str(e)})

    mapping = {
        "nba": "basketball/nba",
        "nfl": "football/nfl",
        "mlb": "baseball/mlb",
        "nhl": "hockey/nhl",
    }
    for lg in leagues:
        if lg in by_league and by_league[lg].get("count", 0) > 0:
            continue
        path = mapping.get(lg)
        if not path:
            continue
        u = f"https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard"
        data = http_json(u)
        events = []
        fetch_ok = isinstance(data, dict)
        if fetch_ok:
            for ev in data.get("events", [])[:25]:
                comp = (ev.get("competitions") or [{}])[0]
                home = None
                away = None
                for c in comp.get("competitors", []):
                    if c.get("homeAway") == "home":
                        home = c
                    elif c.get("homeAway") == "away":
                        away = c
                events.append({
                    "id": ev.get("id"),
                    "start": ev.get("date"),
                    "status": (((comp.get("status") or {}).get("type") or {}).get("description")),
                    "home": (home or {}).get("team", {}).get("displayName"),
                    "away": (away or {}).get("team", {}).get("displayName"),
                    "homeScore": (home or {}).get("score"),
                    "awayScore": (away or {}).get("score"),
                })
        by_league[lg] = {"games": events, "count": len(events), "source": "espn"}
        source_health.append({
            "name": f"espn/{lg}",
            "status": "ok" if fetch_ok else "error",
            "items": len(events),
            "error": None if fetch_ok else "espn fetch failed",
        })

    # Optional odds from The Odds API.
    odds_keys = key_pool("THE_ODDS_API_KEYS", "THE_ODDS_API_KEY")
    odds_regions = os.getenv("THE_ODDS_REGIONS", "us").strip() or "us"
    odds_markets = os.getenv("THE_ODDS_MARKETS", "h2h,spreads,totals").strip() or "h2h,spreads,totals"
    odds_bookmakers = os.getenv("THE_ODDS_BOOKMAKERS", "").strip()
    if not odds_keys:
        source_health.append({
            "name": "the-odds-api",
            "status": "error",
            "error": "THE_ODDS_API_KEY(S) not configured",
        })
        return {"asof": now_iso(), "leagues": by_league, "sourceHealth": source_health}

    slot = 0
    for lg in leagues:
        sport_key = ODDS_SPORT_KEYS.get(lg)
        if not sport_key:
            continue
        key = pick_key(odds_keys, slot)
        slot += 1
        if not key:
            source_health.append({"name": f"the-odds-api/{lg}", "status": "error", "error": "missing api key"})
            continue

        params = {
            "apiKey": key,
            "regions": odds_regions,
            "markets": odds_markets,
            "oddsFormat": "american",
        }
        if odds_bookmakers:
            params["bookmakers"] = odds_bookmakers
        url = f"https://api.the-odds-api.com/v4/sports/{sport_key}/odds?{urllib.parse.urlencode(params)}"

        t0 = time.time()
        data = http_json(url, timeout=20)
        latency_ms = int((time.time() - t0) * 1000)
        if not isinstance(data, list):
            source_health.append({
                "name": f"the-odds-api/{lg}",
                "status": "error",
                "latencyMs": latency_ms,
                "error": "non-list response or blocked request",
            })
            # Preserve scoreboard games even when odds fail.
            if lg in by_league and "odds" not in by_league[lg]:
                by_league[lg]["odds"] = []
                by_league[lg]["oddsCount"] = 0
            continue

        odds_rows: list[dict[str, Any]] = []
        for ev in data[:80]:
            if not isinstance(ev, dict):
                continue
            ev_id = ev.get("id")
            home_team = ev.get("home_team")
            away_team = ev.get("away_team")
            commence = ev.get("commence_time")
            books: list[dict[str, Any]] = []
            for bk in ev.get("bookmakers", [])[:20]:
                if not isinstance(bk, dict):
                    continue
                book = {"name": bk.get("title"), "markets": {}}
                for mk in bk.get("markets", [])[:10]:
                    if not isinstance(mk, dict):
                        continue
                    mk_key = mk.get("key")
                    outcomes = mk.get("outcomes", [])
                    if not isinstance(outcomes, list):
                        continue
                    parsed_outcomes = []
                    for oc in outcomes[:10]:
                        if not isinstance(oc, dict):
                            continue
                        parsed_outcomes.append(
                            {
                                "name": oc.get("name"),
                                "price": oc.get("price"),
                                "point": oc.get("point"),
                            }
                        )
                    if mk_key:
                        book["markets"][mk_key] = parsed_outcomes
                books.append(book)

            odds_rows.append(
                {
                    "id": ev_id,
                    "commenceTime": commence,
                    "home": home_team,
                    "away": away_team,
                    "bookmakers": books,
                }
            )

        if lg not in by_league:
            by_league[lg] = {"games": [], "count": 0, "source": "none"}
        by_league[lg]["odds"] = odds_rows
        by_league[lg]["oddsCount"] = len(odds_rows)
        source_health.append({
            "name": f"the-odds-api/{lg}",
            "status": "ok",
            "latencyMs": latency_ms,
            "items": len(odds_rows),
            "note": "no upcoming events" if len(odds_rows) == 0 else None,
        })
    return {"asof": now_iso(), "leagues": by_league, "sourceHealth": source_health}


def scrape_jobs(feeds: list[str]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    errors: list[str] = []

    # Optional API-backed jobs source
    job_api_urls = env_csv("JOB_API_URLS", [])
    job_api_token = os.getenv("JOB_API_TOKEN", "").strip()
    job_api_scheme = os.getenv("JOB_API_AUTH_SCHEME", "Bearer").strip() or "Bearer"
    for api_url in job_api_urls:
        data = http_json_auth(api_url, job_api_token, auth_scheme=job_api_scheme, timeout=25) if job_api_token else http_json(api_url, timeout=25)
        if data is None:
            errors.append(f"job-api failed: {api_url}")
            continue
        rows: list[dict[str, Any]] = []
        if isinstance(data, list):
            rows = [r for r in data if isinstance(r, dict)]
        elif isinstance(data, dict):
            for key in ("jobs", "results", "data", "items"):
                if isinstance(data.get(key), list):
                    rows = [r for r in data[key] if isinstance(r, dict)]  # type: ignore[index]
                    break
            if not rows:
                # Some APIs wrap one object
                rows = [data]

        for row in rows[:500]:
            title = str(row.get("title") or row.get("job_title") or row.get("position") or "").strip()
            url = str(row.get("url") or row.get("apply_url") or row.get("job_url") or row.get("link") or "").strip()
            company = str(row.get("company") or row.get("company_name") or "").strip()
            location = str(row.get("location") or row.get("candidate_required_location") or "").strip()
            pub = str(row.get("published_at") or row.get("date") or row.get("created_at") or "").strip()
            desc = str(row.get("description") or row.get("summary") or "").strip()
            if not title and not url:
                continue
            stable = url or f"{title}|{company}|{location}"
            dedupe = hashlib.sha1(stable.encode("utf-8")).hexdigest()
            items.append({
                "title": title[:280] if title else "Untitled job",
                "url": url,
                "company": company or None,
                "location": location or None,
                "publishedAt": pub or None,
                "summary": desc[:500] if desc else None,
                "sourceFeed": api_url,
                "dedupeKey": dedupe,
            })

    # RSS-backed jobs source
    for url in feeds:
        xml = http_text(url, timeout=25)
        if not xml:
            errors.append(f"rss failed: {url}")
            continue
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            continue
        for item in root.findall(".//item")[:50]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            desc = (item.findtext("description") or "").strip()
            if not title or not link:
                continue
            dedupe = hashlib.sha1(link.encode("utf-8")).hexdigest()
            items.append({
                "title": title[:280],
                "url": link,
                "publishedAt": pub,
                "summary": desc[:500],
                "sourceFeed": url,
                "dedupeKey": dedupe,
            })
    # de-dup
    seen = set()
    uniq = []
    for it in items:
        if it["dedupeKey"] in seen:
            continue
        seen.add(it["dedupeKey"])
        uniq.append(it)
    return {"asof": now_iso(), "count": len(uniq), "items": uniq[:400], "errors": errors}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Direct stock/sports/jobs scraper")
    p.add_argument("--watchlist", default=",".join(DEFAULT_WATCHLIST))
    p.add_argument("--leagues", default="nba,nfl,mlb,nhl")
    p.add_argument("--job-feeds", default=",".join(DEFAULT_JOB_FEEDS))
    p.add_argument("--output", default="")
    p.add_argument("--output-market", default="")
    p.add_argument("--output-sports", default="")
    p.add_argument("--output-jobs", default="")
    p.add_argument("--pretty", action="store_true")
    return p.parse_args()


def fetch_tiingo_quote(symbol: str, api_key: str) -> dict[str, Any] | None:
    # Tiingo daily endpoint provides close and prevClose for change calculations.
    # Use a short window to keep payload small.
    end_date = dt.datetime.utcnow().date()
    start_date = end_date - dt.timedelta(days=7)
    params = urllib.parse.urlencode(
        {
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "resampleFreq": "daily",
            "token": api_key,
        }
    )
    url = f"https://api.tiingo.com/tiingo/daily/{urllib.parse.quote(symbol)}/prices?{params}"
    data = http_json(url, timeout=20)
    if not isinstance(data, list) or len(data) == 0:
        return None
    latest = data[-1] if isinstance(data[-1], dict) else None
    if not latest:
        return None
    close = float(latest.get("close", 0) or 0)
    prev_close = float(latest.get("prevClose", 0) or 0)
    volume = latest.get("volume")
    if close <= 0:
        return None
    return {
        "price": close,
        "change_pct": ((close - prev_close) / prev_close * 100) if prev_close > 0 else 0.0,
        "volume": int(volume) if isinstance(volume, (int, float)) else None,
    }


def main() -> int:
    args = parse_args()
    watchlist = [x.strip().upper() for x in args.watchlist.split(",") if x.strip()]
    leagues = [x.strip().lower() for x in args.leagues.split(",") if x.strip() and x.strip().lower() in LEAGUES]
    job_feeds = [x.strip() for x in args.job_feeds.split(",") if x.strip()]

    start = time.time()
    stocks = StockScraper().scrape_quotes(watchlist)
    sports = scrape_sports(leagues)
    jobs = scrape_jobs(job_feeds)
    market = {
        "asof": stocks.get("asof"),
        "quotes": stocks.get("quotes", []),
        "missing": stocks.get("missing", []),
        "sourceHealth": stocks.get("sourceHealth", []),
        "errors": stocks.get("errors", []),
    }
    payload = {
        "ok": True,
        "tookMs": int((time.time() - start) * 1000),
        "market": market,
        "stocks": stocks,
        "sports": sports,
        "jobs": jobs,
    }
    text = json.dumps(payload, indent=2 if args.pretty else None)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        print(text)

    indent = 2 if args.pretty else None
    if args.output_market:
        with open(args.output_market, "w", encoding="utf-8") as f:
            f.write(json.dumps({"ok": True, "market": market, "generatedAt": now_iso()}, indent=indent))
    if args.output_sports:
        with open(args.output_sports, "w", encoding="utf-8") as f:
            f.write(json.dumps({"ok": True, "sports": sports, "generatedAt": now_iso()}, indent=indent))
    if args.output_jobs:
        with open(args.output_jobs, "w", encoding="utf-8") as f:
            f.write(json.dumps({"ok": True, "jobs": jobs, "generatedAt": now_iso()}, indent=indent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
