#!/usr/bin/env python3
"""
Free props scraper scaffold.

This writes a normalized JSON payload to:
  vps/scrapers/output/props.json

You can add source-specific parsers later (only for allowed pages/feeds).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

OUT_FILE = "vps/scrapers/output/props.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    fetched_at = now_iso()

    # Placeholder rows. Add parser logic per legal/allowed source.
    # Required schema for each row:
    # player, market, line, odds, book, event_id, edge_score, status, fetched_at
    items: list[dict[str, Any]] = []

    payload = {
        "generated_at": fetched_at,
        "count": len(items),
        "items": items,
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"[props_scraper] wrote {len(items)} items -> {OUT_FILE}")


if __name__ == "__main__":
    main()

