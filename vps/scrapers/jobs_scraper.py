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
from urllib.parse import quote
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen
from datetime import datetime, timezone
from typing import Any

import feedparser

OUT_FILE = "vps/scrapers/output/jobs.json"
MAX_ITEMS_PER_FEED = 120
MAX_ITEMS_PER_QUERY = 80

FEEDS: list[tuple[str, str]] = [
    ("WeWorkRemotely Programming", "https://weworkremotely.com/categories/remote-programming-jobs.rss"),
    ("WeWorkRemotely DevOps", "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss"),
    ("Google News Cyber Jobs", "https://news.google.com/rss/search?q=(%22cybersecurity+analyst%22+OR+%22soc+analyst%22+OR+%22security+engineer%22)+jobs&hl=en-US&gl=US&ceid=US:en"),
]

SEARXNG_QUERIES: list[str] = [
    '("cybersecurity analyst" OR "security analyst" OR "soc analyst") site:linkedin.com/jobs OR site:boards.greenhouse.io OR site:jobs.lever.co',
    '("security engineer" OR "cloud security engineer" OR "threat analyst") site:linkedin.com/jobs OR site:boards.greenhouse.io OR site:jobs.lever.co',
]
SURGICAL_QUERIES: list[str] = [
    '("SOC Analyst" OR "Cybersecurity Analyst") ("hybrid" OR "onsite") ("United States") (site:linkedin.com/jobs OR site:boards.greenhouse.io OR site:jobs.lever.co)',
    '("Security Engineer" OR "Cloud Security Engineer" OR "Threat Analyst") ("hybrid" OR "onsite") ("United States") (site:linkedin.com/jobs OR site:boards.greenhouse.io OR site:jobs.lever.co)',
    '("Incident Response" OR "DFIR" OR "Blue Team") ("hybrid" OR "onsite") ("United States") (site:linkedin.com/jobs OR site:boards.greenhouse.io OR site:jobs.lever.co)',
]

ROLE_RE = re.compile(
    r"\b(cyber|security|soc|threat|incident response|dfir|blue team|siem|iam|cloud security|appsec|security engineer|security analyst)\b",
    re.IGNORECASE,
)
EXCLUDE_REMOTE = os.getenv("JOBS_EXCLUDE_REMOTE", "1").strip().lower() not in {"0", "false", "no"}
ENABLE_SURGICAL = os.getenv("JOBS_ENABLE_SURGICAL", "1").strip().lower() not in {"0", "false", "no"}
ENABLE_GOOGLE_PROXY = os.getenv("JOBS_ENABLE_GOOGLE_PROXY", "1").strip().lower() not in {"0", "false", "no"}


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
    # Common RSS title format: "Company: Role"
    m = re.match(r"^\s*([^:]{2,80})\s*:\s*.+$", title)
    if m:
        candidate = m.group(1).strip()
        if candidate and not candidate.lower().startswith(("a company", "an employer")):
            return candidate[:120]

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


def is_remote_text(*parts: str | None) -> bool:
    text = " ".join([(p or "") for p in parts]).lower()
    return any(k in text for k in ("remote", "work from home", "wfh", "anywhere"))


def parse_feed(source_name: str, url: str, fetched_at: str) -> list[dict[str, Any]]:
    parsed = feedparser.parse(url)
    rows: list[dict[str, Any]] = []
    for entry in parsed.entries[:MAX_ITEMS_PER_FEED]:
        title = str(getattr(entry, "title", "") or "").strip()
        link = str(getattr(entry, "link", "") or "").strip()
        summary = str(getattr(entry, "summary", "") or "")
        if not title or not link:
            continue
        if not ROLE_RE.search(title):
            continue
        if EXCLUDE_REMOTE and is_remote_text(title, summary):
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


def parse_searxng(base_url: str, query: str, fetched_at: str) -> list[dict[str, Any]]:
    clean_base = base_url.rstrip("/")
    # SearXNG JSON endpoint.
    url = (
        f"{clean_base}/search?q={quote(query)}&format=json"
        "&language=en-US&safesearch=0&categories=general"
    )
    req = Request(
        url,
        headers={
            "User-Agent": "MCC-Jobs-Scraper/1.0",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urlopen(req, timeout=20) as res:
        data = json.loads(res.read().decode("utf-8", errors="replace"))

    results = data.get("results", []) if isinstance(data, dict) else []
    rows: list[dict[str, Any]] = []
    for item in results[:MAX_ITEMS_PER_QUERY]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "") or "").strip()
        link = str(item.get("url", "") or "").strip()
        summary = str(item.get("content", "") or "")
        if not title or not link:
            continue
        if not ROLE_RE.search(title):
            continue
        if EXCLUDE_REMOTE and is_remote_text(title, summary, link):
            continue

        company = extract_company(title, summary)
        location = extract_location(title, summary)
        posted_at = str(item.get("publishedDate", "") or "") or None
        source_name = f"SearXNG: {query[:40]}..."
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


def parse_google_proxy(proxy_template: str, query: str, fetched_at: str) -> list[dict[str, Any]]:
    # Example template:
    #   https://r.jina.ai/http://www.google.com/search?q={q}&hl=en&gl=us
    q = quote(query)
    try:
        url = proxy_template.format(q=q, query=q)
    except Exception:
        return []
    req = Request(
        url,
        headers={
            "User-Agent": "MCC-Jobs-Scraper/1.0",
            "Accept": "text/plain, text/html",
        },
        method="GET",
    )
    with urlopen(req, timeout=25) as res:
        body = res.read().decode("utf-8", errors="replace")

    rows: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    # Extract raw links from proxied text/html.
    raw_links = re.findall(r"https?://[^\s<>\"]+", body)
    for raw in raw_links:
        link = raw.strip().rstrip(").,]")
        # Handle Google redirect links.
        if "google.com/url?" in link:
            try:
                qs = parse_qs(urlparse(link).query)
                target = qs.get("q", [None])[0]
                if target:
                    link = unquote(target)
            except Exception:
                pass
        host = urlparse(link).netloc.lower()
        if not host or "google." in host:
            continue
        if host.startswith("webcache.") or host.startswith("translate."):
            continue
        if link in seen_urls:
            continue
        seen_urls.add(link)

        title = re.sub(r"\s+", " ", link.split("/")[-1].replace("-", " ")).strip() or "Job posting"
        if not ROLE_RE.search(f"{title} {query}"):
            continue
        if EXCLUDE_REMOTE and is_remote_text(title, query, link):
            continue

        company = extract_company(title, "")
        location = extract_location(title, query)
        key = dedupe_key(link, title, company)
        rows.append(
            {
                "title": title[:220],
                "company": company,
                "location": location,
                "url": link,
                "source": "GoogleProxy",
                "posted_at": None,
                "fetched_at": fetched_at,
                "dedupe_key": key,
            }
        )
        if len(rows) >= MAX_ITEMS_PER_QUERY:
            break
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

    searx_url = os.getenv("SEARXNG_BASE_URL", "").strip()
    if searx_url:
        for q in SEARXNG_QUERIES:
            source_name = f"SearXNG {q[:28]}..."
            try:
                rows = parse_searxng(searx_url, q, fetched_at)
                feed_stats[source_name] = len(rows)
                all_rows.extend(rows)
            except Exception:
                feed_stats[source_name] = 0
        if ENABLE_SURGICAL:
            for q in SURGICAL_QUERIES:
                source_name = f"Surgical {q[:28]}..."
                try:
                    rows = parse_searxng(searx_url, q, fetched_at)
                    feed_stats[source_name] = len(rows)
                    all_rows.extend(rows)
                except Exception:
                    feed_stats[source_name] = 0

    if ENABLE_GOOGLE_PROXY:
        proxy_template = os.getenv(
            "GOOGLE_PROXY_TEMPLATE",
            "https://r.jina.ai/http://www.google.com/search?q={q}&hl=en&gl=us",
        ).strip()
        # Reuse targeted query pack for proxy pulls.
        for q in SURGICAL_QUERIES[:2]:
            source_name = f"GoogleProxy {q[:24]}..."
            try:
                rows = parse_google_proxy(proxy_template, q, fetched_at)
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
