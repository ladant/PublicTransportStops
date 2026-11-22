"""CLI: python -m busnavylet [--config feeds.yaml] [--out out/data] [--cache cache/feeds]

Ve složce s výstupem vznikne manifest.json, routes.json a tiles/*.json.
Když běží v GitHub Actions, zapíše do $GITHUB_OUTPUT `changed=true|false`
(změnil se aspoň jeden feed nebo počáteční den oproti minulému sestavení).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import config as config_mod
from .build import build
from .download import fetch_feed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="busnavylet")
    ap.add_argument("--config", default="feeds.yaml")
    ap.add_argument("--out", default="out/data")
    ap.add_argument("--cache", default="cache/feeds")
    ap.add_argument("--local", action="append", default=[], metavar="CODE=ZIP",
                    help="místo stahování použít lokální zip (lze opakovat)")
    ap.add_argument("--only", action="append", default=[], help="zpracovat jen tyto feedy")
    ap.add_argument("--today", help="datum YYYY-MM-DD (výchozí: dnešek v časové zóně konfigurace)")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    log = logging.getLogger("busnavylet")
    cfg = config_mod.load(args.config)
    tz = ZoneInfo(cfg.timezone)
    today = date.fromisoformat(args.today) if args.today else datetime.now(tz).date()
    cache = Path(args.cache)

    local = dict(item.split("=", 1) for item in args.local)
    selected = [f for f in cfg.feeds if not args.only or f.code in args.only]
    inputs, state = [], {}
    for feed in selected:
        if feed.code in local:
            inputs.append((feed, Path(local[feed.code]), None))
            state[feed.code] = "local"
            continue
        ff = fetch_feed(feed, cache, today=today)
        if ff is None:
            continue
        inputs.append((feed, ff.path, ff.prev))
        state[feed.code] = ff.sha256
    if not inputs:
        log.error("žádná vstupní data")
        return 1

    manifest = build(cfg, inputs, Path(args.out), today)

    state["start"] = manifest["start"]
    state_path = cache / "last_build.json"
    previous = json.loads(state_path.read_text()) if state_path.exists() else None
    changed = previous != state
    cache.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, indent=1, sort_keys=True))
    log.info("build %s, změna oproti minulému sestavení: %s", manifest["build"], changed)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\nbuild={manifest['build']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
