#!/usr/bin/env python3
"""
Quick source test for search engines used by jobs_scraper.py.

Usage:
  source .venv/bin/activate
  export SEARXNG_BASE_URL="https://search.yourdomain.com"
  export GOOGLE_PROXY_TEMPLATE="https://r.jina.ai/http://www.google.com/search?q={q}&hl=en&gl=us"
  python vps/scrapers/test_search_sources.py
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from jobs_scraper import (
    parse_google_proxy,
    parse_searxng,
    SURGICAL_QUERIES,
    DEFAULT_GOOGLE_PROXY_TEMPLATES,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    fetched_at = now_iso()
    q = SURGICAL_QUERIES[0]

    print("[test] query:", q)

    searx = os.getenv("SEARXNG_BASE_URL", "").strip()
    if searx:
        try:
            rows = parse_searxng(searx, q, fetched_at)
            print(f"[test] searxng count={len(rows)} sample={(rows[0]['url'] if rows else 'none')}")
        except Exception as e:
            print(f"[test] searxng failed: {e}")
    else:
        print("[test] searxng skipped (SEARXNG_BASE_URL not set)")

    templates_env = os.getenv("GOOGLE_PROXY_TEMPLATES", "").strip()
    if templates_env:
        templates = [t.strip() for t in templates_env.split(",") if t.strip()]
    else:
        single = os.getenv("GOOGLE_PROXY_TEMPLATE", "").strip()
        templates = [single] if single else DEFAULT_GOOGLE_PROXY_TEMPLATES

    for idx, proxy in enumerate(templates, start=1):
        try:
            rows = parse_google_proxy(proxy, q, fetched_at)
            print(f"[test] google-proxy[{idx}] count={len(rows)} sample={(rows[0]['url'] if rows else 'none')} template={proxy}")
            if rows:
                break
        except Exception as e:
            print(f"[test] google-proxy[{idx}] failed: {e} template={proxy}")


if __name__ == "__main__":
    main()
