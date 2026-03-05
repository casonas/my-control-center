#!/usr/bin/env python3
"""
Free jobs scraper: pulls multi-source RSS feeds and writes normalized JSON.
Output file:
  vps/scrapers/output/jobs.json
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import feedparser

OUT_FILE = "vps/scrapers/output/jobs.json"
MAX_ITEMS_PER_FEED = 120

FEEDS: list[tuple[str, str]] = [
    ("Indeed Cybersecurity Analyst", "https://www.indeed.com/rss?q=cybersecurity+analyst&sort=date"),
    ("Indeed SOC Analyst", "https://www.indeed.com/rss?q=soc+analyst&sort=date"),
    ("Indeed Security Analyst", "https://www.indeed.com/rss?q=security+analyst&sort=date"),
    ("Indeed Threat Analyst", "https://www.indeed.com/rss?q=threat+analyst&sort=date"),
    ("WeWorkRemotely Programming", "https://weworkremotely.com/categories/remote-programming-jobs.rss"),
    ("WeWorkRemotely DevOps", "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss"),
    ("Google News Cyber Jobs", "https://news.google.com/rss/search?q=cybersecurity+jobs+analyst&hl=en-US&gl=US&ceid=US:en"),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def canonical_url(url: str) -> str:
    clean = (url or "").strip()
    if not clean:
        return ""
    clean = clean.split("#", 1)[0]
    clean = clean.split("?", 1)[0]
    return clean.lower()


def dedupe_key(url: str, title: str, company: str) -> str:
    raw = f"{canonical_url(url)}|{normalize_text(title)}|{normalize_text(company)}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def extract_company(title: str, summary: str) -> str:
    text = f"{title} {summary}"
    patterns = [
        r"(?:\bat\b|\@)\s+([A-Z][\w&.,' -]{1,80})",
        r"\bcompany\s*:\s*([A-Z][\w&.,' -]{1,80})",
        r"\bemployer\s*:\s*([A-Z][\w&.,' -]{1,80})",
    ]
    for p in patterns:
        m = re.search(p, text, flags=re.IGNORECASE)
        if m:
            name = m.group(1).strip()
            if name:
                return name[:120]
    return "Unknown"


def extract_location(title: str, summary: str) -> str | None:
    text = f"{title} {summary}".lower()
    if "remote" in text:
        return "remote"
    m = re.search(r"(?:location|loc)\s*:\s*([^,\n\r|<]{2,80})", summary, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def parse_feed(source_name: str, url: str, fetched_at: str) -> list[dict[str, Any]]:
    parsed = feedparser.parse(url)
    rows: list[dict[str, Any]] = []
    for entry in parsed.entries[:MAX_ITEMS_PER_FEED]:
        title = str(getattr(entry, "title", "") or "").strip()
        link = str(getattr(entry, "link", "") or "").strip()
        summary = str(getattr(entry, "summary", "") or "")
        if not title or not link:
            continue

        company = extract_company(title, summary)
        location = extract_location(title, summary)
        posted_at = str(getattr(entry, "published", "") or "") or None
        key = dedupe_key(link, title, company)
        rows.append(
            {
                "title": title[:220],
                "company": company,
                "location": location,
                "url": link,
                "source": source_name,
                "posted_at": posted_at,
                "fetched_at": fetched_at,
                "dedupe_key": key,
            }
        )
    return rows


def main() -> None:
    fetched_at = now_iso()
    all_rows: list[dict[str, Any]] = []
    feed_stats: dict[str, int] = {}

    for source_name, url in FEEDS:
        try:
            rows = parse_feed(source_name, url, fetched_at)
            feed_stats[source_name] = len(rows)
            all_rows.extend(rows)
        except Exception:
            feed_stats[source_name] = 0

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in all_rows:
        key = row["dedupe_key"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    payload = {
        "generated_at": fetched_at,
        "feeds": feed_stats,
        "count_raw": len(all_rows),
        "count_deduped": len(deduped),
        "items": deduped,
    }
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"[jobs_scraper] wrote {len(deduped)} items -> {OUT_FILE}")


if __name__ == "__main__":
    main()

