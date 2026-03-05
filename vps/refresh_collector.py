#!/usr/bin/env python3
"""
MCC Refresh Collector

Lightweight Python scheduler/orchestrator for non-chat data refresh jobs.
Runs without OpenClaw token usage.

Environment variables:
  MCC_APP_BASE_URL               e.g. https://my-control-center.pages.dev
  INTERNAL_SHARED_SECRET         preferred token
  CRON_SECRET                    fallback token
  INTERNAL_USER_ID               defaults to owner
  SPORTS_LEAGUES                 comma list, default nba,nfl,mlb,nhl
  REQUEST_TIMEOUT_SEC            default 30
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class RefreshResult:
    name: str
    ok: bool
    status_code: int
    body: dict[str, Any]
    took_ms: int


def env(name: str, default: str | None = None) -> str | None:
    v = os.getenv(name)
    return v if v is not None and v != "" else default


def get_token() -> str:
    token = env("INTERNAL_SHARED_SECRET") or env("CRON_SECRET")
    if not token:
        raise RuntimeError("Missing INTERNAL_SHARED_SECRET/CRON_SECRET in environment")
    return token


def post_json(url: str, payload: dict[str, Any], timeout_sec: int) -> tuple[int, dict[str, Any]]:
    req = urllib.request.Request(
        url=url,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Internal-Token": get_token(),
            "X-Internal-User-Id": env("INTERNAL_USER_ID", "owner") or "owner",
        },
        data=json.dumps(payload).encode("utf-8"),
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, {"ok": False, "error": "Non-JSON response", "raw": raw[:400]}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"ok": False, "error": f"HTTP {e.code}", "raw": raw[:400]}
        return e.code, body


def run_once(base_url: str, timeout_sec: int, leagues: list[str]) -> list[RefreshResult]:
    base_url = base_url.rstrip("/")
    tasks = [
        ("stocks", f"{base_url}/api/stocks/refresh", {}),
        ("jobs", f"{base_url}/api/jobs/refresh", {}),
        ("home", f"{base_url}/api/home/refresh", {}),
    ]
    for lg in leagues:
        tasks.append((f"sports:{lg}", f"{base_url}/api/sports/refresh", {"league": lg}))

    results: list[RefreshResult] = []
    for name, url, payload in tasks:
        start = time.time()
        code, body = post_json(url, payload, timeout_sec=timeout_sec)
        took_ms = int((time.time() - start) * 1000)
        ok = (200 <= code < 300) and (body.get("ok", True) is not False)
        results.append(RefreshResult(name=name, ok=ok, status_code=code, body=body, took_ms=took_ms))
    return results


def print_summary(results: list[RefreshResult]) -> None:
    print("=" * 80)
    print("MCC Refresh Collector Summary")
    print("=" * 80)
    for r in results:
        status = "OK" if r.ok else "FAIL"
        top_error = r.body.get("error") if isinstance(r.body, dict) else None
        suffix = f" error={top_error}" if top_error else ""
        print(f"[{status}] {r.name:<12} http={r.status_code:<3} tookMs={r.took_ms:<5}{suffix}")
    print("-" * 80)
    print(json.dumps([{"name": r.name, "status": r.status_code, "ok": r.ok, "body": r.body} for r in results], indent=2))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run MCC refresh jobs from a VPS/cron host.")
    p.add_argument("--base-url", default=env("MCC_APP_BASE_URL", "https://my-control-center.pages.dev"))
    p.add_argument("--interval-sec", type=int, default=0, help="If >0, run forever every N seconds")
    p.add_argument("--timeout-sec", type=int, default=int(env("REQUEST_TIMEOUT_SEC", "30") or "30"))
    p.add_argument("--sports-leagues", default=env("SPORTS_LEAGUES", "nba,nfl,mlb,nhl"))
    return p.parse_args()


def main() -> None:
    args = parse_args()
    leagues = [x.strip().lower() for x in (args.sports_leagues or "").split(",") if x.strip()]
    if not leagues:
        leagues = ["nba"]

    if args.interval_sec <= 0:
        print_summary(run_once(args.base_url, args.timeout_sec, leagues))
        return

    while True:
        started = time.strftime("%Y-%m-%d %H:%M:%S")
        print(f"\n[{started}] Running refresh cycle...")
        results = run_once(args.base_url, args.timeout_sec, leagues)
        print_summary(results)
        print(f"Sleeping {args.interval_sec}s...")
        time.sleep(args.interval_sec)


if __name__ == "__main__":
    main()

