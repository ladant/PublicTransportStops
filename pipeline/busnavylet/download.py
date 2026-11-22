"""Stažení feedů s podmíněnými požadavky a návratem k poslední platné verzi."""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path

from .config import Feed, MissingVariable, expand
from .gtfs import find_member

log = logging.getLogger(__name__)

REQUIRED = ("stops.txt", "trips.txt", "stop_times.txt", "routes.txt")
USER_AGENT = "bus-na-vylet-pipeline/1.0 (+open-source; daily GTFS download)"


@dataclass
class FeedFile:
    code: str
    path: Path            # aktuální zip
    prev: Path | None     # předchozí platný zip (pro případ, že aktuální nejde zpracovat)
    sha256: str
    changed: bool
    source: str


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_valid_gtfs_zip(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            return all(find_member(names, n) for n in REQUIRED)
    except (zipfile.BadZipFile, OSError):
        return False


def _fetch(url: str, headers: dict[str, str], meta: dict, dest: Path, timeout: int = 300) -> str:
    """Vrátí 'downloaded' nebo 'not-modified'. Vyhodí výjimku při chybě."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
    if meta.get("url") == url:
        if meta.get("etag"):
            req.add_header("If-None-Match", meta["etag"])
        if meta.get("last_modified"):
            req.add_header("If-Modified-Since", meta["last_modified"])
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            tmp = dest.with_suffix(".part")
            with open(tmp, "wb") as f:
                shutil.copyfileobj(resp, f, 1 << 20)
            meta.update(url=url, etag=resp.headers.get("ETag"), last_modified=resp.headers.get("Last-Modified"))
            tmp.replace(dest)
            return "downloaded"
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return "not-modified"
        raise


def fetch_feed(feed: Feed, cache_dir: Path, retries: int = 2) -> FeedFile | None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    current = cache_dir / f"{feed.code}.zip"
    prev = cache_dir / f"{feed.code}.prev.zip"
    meta_path = cache_dir / f"{feed.code}.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    old_hash = meta.get("sha256")

    for src in feed.sources:
        try:
            url = expand(src.url)
            headers = {k: expand(v) for k, v in src.headers.items()}
        except MissingVariable as e:
            log.info("%s: přeskakuji zdroj (chybí proměnná %s)", feed.code, e)
            continue
        shown = src.url  # neloguj rozbalené klíče
        for attempt in range(retries + 1):
            try:
                tmp = cache_dir / f"{feed.code}.new.zip"
                status = _fetch(url, headers, meta, tmp)
                if status == "not-modified" and current.exists():
                    log.info("%s: beze změny (%s)", feed.code, shown)
                    meta_path.write_text(json.dumps(meta, indent=1))
                    return FeedFile(feed.code, current, prev if prev.exists() else None, old_hash or sha256(current), False, shown)
                if status == "not-modified":
                    meta.pop("etag", None)
                    meta.pop("last_modified", None)
                    continue
                if not is_valid_gtfs_zip(tmp):
                    tmp.unlink(missing_ok=True)
                    raise ValueError("stažený soubor není platný GTFS zip")
                new_hash = sha256(tmp)
                if current.exists() and new_hash != old_hash:
                    current.replace(prev)
                tmp.replace(current)
                meta["sha256"] = new_hash
                meta["fetched"] = int(time.time())
                meta_path.write_text(json.dumps(meta, indent=1))
                changed = new_hash != old_hash
                log.info("%s: staženo z %s (%s)", feed.code, shown, "změna" if changed else "stejný obsah")
                return FeedFile(feed.code, current, prev if prev.exists() else None, new_hash, changed, shown)
            except Exception as e:  # noqa: BLE001 – každá chyba zdroje = zkusit další
                log.warning("%s: %s selhal (pokus %d): %s", feed.code, shown, attempt + 1, e)
                if attempt < retries:
                    time.sleep(2 * (attempt + 1))

    if current.exists() and is_valid_gtfs_zip(current):
        log.warning("%s: všechny zdroje selhaly, používám poslední platnou verzi", feed.code)
        return FeedFile(feed.code, current, prev if prev.exists() else None, old_hash or sha256(current), False, "cache")
    log.error("%s: žádná data k dispozici", feed.code)
    return None
