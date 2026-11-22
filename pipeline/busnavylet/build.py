"""Sestavení dlaždic, tabulky linek a manifestu z načtených feedů."""
from __future__ import annotations

import base64
import gzip
import hashlib
import json
import logging
import math
import shutil
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .config import Config, Feed
from .gtfs import FeedData, Interner, Stop, encode_polyline, load_feed

log = logging.getLogger(__name__)

FORMAT_VERSION = 1


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def gz_size(text: str) -> int:
    return len(gzip.compress(text.encode("utf-8"), compresslevel=6, mtime=0))


def cell(v: float, step: float) -> int:
    """Index buňky mřížky; zaokrouhlení potlačí chyby plovoucí čárky (4.35/0.15)."""
    return math.floor(round(v / step, 9))


def mask_b64(mask: int, nbytes: int) -> str:
    return base64.b64encode(mask.to_bytes(nbytes, "little")).decode("ascii")


def tile_bbox(key: str, dlat: float, dlon: float) -> tuple[float, float, float, float]:
    """(jih, západ, sever, východ) pro klíč 'y_x' nebo 'y_x_q_q…'."""
    parts = [int(p) for p in key.split("_")]
    y, x, quads = parts[0], parts[1], parts[2:]
    s, w, h, wd = y * dlat, x * dlon, dlat, dlon
    for q in quads:
        h, wd = h / 2, wd / 2
        if q >= 2:
            s += h
        if q % 2 == 1:
            w += wd
    return s, w, s + h, w + wd


def _quadrant(st: Stop, key: str, dlat: float, dlon: float) -> int:
    s, w, n, e = tile_bbox(key, dlat, dlon)
    row = 1 if st.lat >= (s + n) / 2 else 0
    col = 1 if st.lon >= (w + e) / 2 else 0
    return row * 2 + col


def build(cfg: Config, feeds: list[tuple[Feed, Path, Path | None]], out_dir: Path, today: date,
          now: datetime | None = None) -> dict:
    """feeds: (konfigurace, aktuální zip, předchozí zip). Vrací manifest."""
    start = today - timedelta(days=1)        # včerejšek kvůli spojům po půlnoci
    ndays = cfg.days + 1
    nbytes = (ndays + 7) // 8
    heads = Interner()
    masks = Interner()

    loaded: list[tuple[Feed, FeedData]] = []
    for feed, path, prev in feeds:
        fd = None
        for p in [path, prev]:
            if p is None:
                continue
            try:
                fd = load_feed(feed.code, p, start, ndays, heads, masks)
                if not fd.departures:
                    raise ValueError("feed neobsahuje žádné odjezdy v období")
                break
            except Exception as e:  # noqa: BLE001
                log.error("%s: nelze zpracovat %s: %s", feed.code, p.name, e)
                fd = None
        if fd is None:
            log.error("%s: vynechán", feed.code)
            continue
        log.info("%s: %d zastávek, %d linek, %d spojů, platnost %s – %s", feed.code, len(fd.stops),
                 len(fd.routes), fd.trips_used, fd.valid_from, fd.valid_to)
        loaded.append((feed, fd))
    if not loaded:
        raise RuntimeError("žádný feed se nepodařilo zpracovat")

    # --- globální tabulka linek (jen použité), stabilní pořadí
    routes_out: list[list] = []
    route_map: dict[tuple[str, int], int] = {}
    for feed, fd in loaded:
        used = sorted({fd.departures[k][i + 1] for k in fd.departures for i in range(0, len(fd.departures[k]), 4)})
        for ri in used:
            r = fd.routes[ri]
            route_map[(feed.code, ri)] = len(routes_out)
            routes_out.append([r.short, r.long, r.mode, r.color, r.text_color, r.agency, feed.code])

    # --- rozdělení zastávek do dlaždic
    all_stops: dict[str, tuple[Stop, str]] = {}
    for feed, fd in loaded:
        for k, st in fd.stops.items():
            all_stops[k] = (st, feed.code)
    stop_deps = {k: (code, fd.departures[k]) for (feed, fd) in loaded for k in fd.departures for code in [feed.code]}

    def tile_json(keys: list[str]) -> str:
        h_local, c_local = Interner(), Interner()
        s_out, d_out = [], []
        for k in sorted(keys):
            st, code = all_stops[k]
            s_out.append([k, st.name, round(st.lat, 5), round(st.lon, 5), st.modes])
            _, arr = stop_deps[k]
            rows = []
            for i in range(0, len(arr), 4):
                m, r, h, c = arr[i:i + 4]
                rows.append((m, route_map[(code, r)], heads.items[h], masks.items[c]))
            rows.sort(key=lambda t: (t[0], t[1], t[2], t[3]))
            flat = []
            for m, r, h, c in rows:
                flat.extend((m, r, h_local(h), c_local(c)))
            d_out.append(flat)
        return dumps({"v": FORMAT_VERSION, "s": s_out, "h": h_local.items,
                      "c": [mask_b64(c, nbytes) for c in c_local.items], "d": d_out})

    base: dict[str, list[str]] = {}
    for k, (st, _) in all_stops.items():
        base.setdefault(f"{cell(st.lat, cfg.dlat)}_{cell(st.lon, cfg.dlon)}", []).append(k)

    tiles_dir = out_dir / "tiles"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    tiles_dir.mkdir(parents=True)

    written: dict[str, int] = {}
    digest = hashlib.sha256()

    def emit(key: str, keys: list[str], depth: int):
        text = tile_json(keys)
        size = gz_size(text)
        if size > cfg.tile_max_gzip_bytes and depth < cfg.tile_max_depth and len(keys) > 1:
            parts: dict[int, list[str]] = {}
            for k in keys:
                parts.setdefault(_quadrant(all_stops[k][0], key, cfg.dlat, cfg.dlon), []).append(k)
            if len(parts) > 1 or depth + 1 < cfg.tile_max_depth:
                for q in sorted(parts):
                    emit(f"{key}_{q}", parts[q], depth + 1)
                return
        if size > cfg.tile_max_gzip_bytes:
            log.warning("dlaždice %s má %d B gzip i po rozdělení", key, size)
        (tiles_dir / f"{key}.json").write_text(text, encoding="utf-8")
        written[key] = size
        digest.update(key.encode() + b"\0" + text.encode("utf-8"))

    for key in sorted(base, key=lambda k: tuple(int(p) for p in k.split("_"))):
        emit(key, base[key], 0)

    # trasy linek: lines/{index linky}.json, načítá se až po klepnutí na linku
    lines_dir = out_dir / "lines"
    lines_dir.mkdir()
    line_bytes = 0
    for feed, fd in loaded:
        for ri, variants in fd.lines.items():
            gi = route_map.get((feed.code, ri))
            if gi is None:
                continue
            text = dumps({"v": [[n, encode_polyline(pts)] for n, pts in variants]})
            (lines_dir / f"{gi}.json").write_text(text, encoding="utf-8")
            line_bytes += gz_size(text)
            digest.update(f"L{gi}".encode() + b"\0" + text.encode("utf-8"))

    routes_text = dumps(routes_out)
    (out_dir / "routes.json").write_text(routes_text, encoding="utf-8")
    digest.update(routes_text.encode("utf-8"))

    lats = [st.lat for st, _ in all_stops.values()]
    lons = [st.lon for st, _ in all_stops.values()]
    feeds_out = []
    for feed, fd in loaded:
        feeds_out.append({
            "code": feed.code, "name": feed.name, "license": feed.license, "alerts": feed.alerts_url,
            "from": fd.valid_from.isoformat() if fd.valid_from else None,
            "to": fd.valid_to.isoformat() if fd.valid_to else None,
        })
    content = {
        "v": FORMAT_VERSION,
        "start": start.isoformat(),
        "days": ndays,
        "grid": [cfg.dlat, cfg.dlon],
        "bbox": [round(min(lons), 4), round(min(lats), 4), round(max(lons), 4), round(max(lats), 4)],
        "view": cfg.default_view,
        "feeds": feeds_out,
        "tiles": sorted(written, key=lambda k: tuple(int(p) for p in k.split("_"))),
        "lines": True,
    }
    digest.update(dumps(content).encode("utf-8"))
    manifest = dict(content)
    manifest["build"] = digest.hexdigest()[:16]
    manifest["built"] = (now or datetime.now(timezone.utc)).replace(microsecond=0).isoformat()
    (out_dir / "manifest.json").write_text(dumps(manifest), encoding="utf-8")

    sizes = sorted(written.values())
    biggest = max(written, key=written.get)
    log.info("dlaždic: %d, celkem %.1f MB gzip, největší %s (%d kB), zastávek %d, linek %d, trasy linek %.1f MB gzip",
             len(written), sum(sizes) / 1e6, biggest, written[biggest] // 1000, len(all_stops), len(routes_out),
             line_bytes / 1e6)
    return manifest
