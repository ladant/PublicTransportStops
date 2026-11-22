"""Čtení GTFS a převod na odjezdy se zastávek.

Výstupem jednoho feedu je `FeedData`: zastávky (seskupené pod parent_station),
linky, platnost dat a pro každou zastávku pole odjezdů
(minuta služebního dne, index linky, index směru, index kalendáře).
"""
from __future__ import annotations

import csv
import io
import logging
import zipfile
from array import array
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Iterator

log = logging.getLogger(__name__)

# Kategorie dopravy používané klientem
MODE_TRAM = 0
MODE_METRO = 1
MODE_RAIL = 2
MODE_BUS = 3
MODE_FERRY = 4
MODE_OTHER = 5

# bitové příznaky pro zastávku (které druhy dopravy ji obsluhují)
MODE_BIT = {MODE_BUS: 1, MODE_RAIL: 2, MODE_TRAM: 4, MODE_METRO: 4, MODE_FERRY: 8, MODE_OTHER: 8}

DEFAULT_COLOR = {MODE_BUS: "1565C0", MODE_RAIL: "424242", MODE_TRAM: "C62828", MODE_METRO: "6A1B9A",
                 MODE_FERRY: "00838F", MODE_OTHER: "555555"}


def normalize_route_type(t: str) -> int:
    try:
        v = int(t)
    except (TypeError, ValueError):
        return MODE_BUS
    if v == 0 or 900 <= v < 1000:
        return MODE_TRAM
    if v == 1 or 400 <= v < 500:
        return MODE_METRO
    if v == 2 or 100 <= v < 200:
        return MODE_RAIL
    if v in (3, 11) or 200 <= v < 300 or 700 <= v < 800 or v == 800:
        return MODE_BUS
    if v == 4 or 1000 <= v < 1100 or v == 1200:
        return MODE_FERRY
    return MODE_OTHER


def find_member(names: list[str], filename: str) -> str | None:
    """Najde soubor i ve vnořené složce zipu."""
    for n in names:
        if n == filename or n.endswith("/" + filename):
            return n
    return None


class GtfsZip:
    """GTFS ze zipu nebo z rozbalené složky."""

    def __init__(self, path):
        p = Path(path)
        if p.is_dir():
            self.dir, self.z = p, None
            self.names = sorted(str(f.relative_to(p)) for f in p.rglob("*.txt"))
        else:
            self.dir, self.z = None, zipfile.ZipFile(p)
            self.names = self.z.namelist()

    def _open(self, member: str):
        return open(self.dir / member, "rb") if self.dir else self.z.open(member)

    def has(self, filename: str) -> bool:
        return find_member(self.names, filename) is not None

    def rows(self, filename: str) -> Iterator[dict[str, str]]:
        member = find_member(self.names, filename)
        if member is None:
            return iter(())
        return self._rows(member)

    def _rows(self, member: str) -> Iterator[dict[str, str]]:
        with self._open(member) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            reader = csv.reader(text)
            try:
                header = [h.strip() for h in next(reader)]
            except StopIteration:
                return
            n = len(header)
            for row in reader:
                if not row:
                    continue
                if len(row) < n:
                    row = row + [""] * (n - len(row))
                yield {header[i]: row[i].strip() for i in range(n)}

    def raw_rows(self, filename: str, columns: list[str]) -> Iterator[list[str]]:
        """Rychlé čtení vybraných sloupců (pro stop_times)."""
        member = find_member(self.names, filename)
        if member is None:
            return
        with self._open(member) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            reader = csv.reader(text)
            header = [h.strip() for h in next(reader)]
            idx = [header.index(c) if c in header else -1 for c in columns]
            for row in reader:
                if not row:
                    continue
                yield [row[i].strip() if 0 <= i < len(row) else "" for i in idx]


def parse_time(s: str) -> int | None:
    """'25:10:00' -> 1510 (minuty od půlnoci služebního dne). Sekundy se zaokrouhlí dolů."""
    if not s:
        return None
    parts = s.split(":")
    try:
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        sec = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        return None
    return h * 60 + m + sec // 60


def parse_seconds(s: str) -> int | None:
    if not s:
        return None
    parts = s.split(":")
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + (int(parts[2]) if len(parts) > 2 else 0)
    except (ValueError, IndexError):
        return None


def parse_date(s: str) -> date | None:
    s = s.strip()
    if len(s) != 8 or not s.isdigit():
        return None
    return date(int(s[:4]), int(s[4:6]), int(s[6:]))


@dataclass
class Stop:
    key: str          # globální id "feed:stop"
    name: str
    lat: float
    lon: float
    modes: int = 0    # bitové příznaky MODE_BIT


@dataclass
class Route:
    short: str
    long: str
    mode: int
    color: str
    text_color: str
    agency: str
    url: str = ""


@dataclass
class FeedData:
    code: str
    stops: dict[str, Stop] = field(default_factory=dict)
    routes: list[Route] = field(default_factory=list)
    # zastávka -> array('i') s čtveřicemi (minuta, linka(lokální), směr(globální intern), maska(globální intern))
    departures: dict[str, array] = field(default_factory=dict)
    valid_from: date | None = None
    valid_to: date | None = None
    trips_used: int = 0
    # trasy linek: lokální index linky -> [(počet spojů, [(lat, lon), ...]), ...]
    lines: dict[int, list[tuple[int, list[tuple[float, float]]]]] = field(default_factory=dict)


class Interner:
    def __init__(self):
        self.items: list = []
        self.index: dict = {}

    def __call__(self, v) -> int:
        i = self.index.get(v)
        if i is None:
            i = len(self.items)
            self.items.append(v)
            self.index[v] = i
        return i


def service_masks(g: GtfsZip, start: date, ndays: int) -> tuple[dict[str, int], date | None, date | None]:
    """service_id -> bitová maska (bit i = den start+i). Vrací i celkový rozsah platnosti feedu."""
    end = start + timedelta(days=ndays - 1)
    masks: dict[str, int] = {}
    vmin: date | None = None
    vmax: date | None = None

    def widen(d0: date, d1: date):
        nonlocal vmin, vmax
        vmin = d0 if vmin is None or d0 < vmin else vmin
        vmax = d1 if vmax is None or d1 > vmax else vmax

    for r in g.rows("calendar.txt"):
        sid = r.get("service_id", "")
        d0, d1 = parse_date(r.get("start_date", "")), parse_date(r.get("end_date", ""))
        if not sid or d0 is None or d1 is None:
            continue
        days = [r.get(k, "0") == "1" for k in
                ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")]
        if any(days):
            widen(d0, d1)
        m = masks.get(sid, 0)
        lo, hi = max(d0, start), min(d1, end)
        d = lo
        while d <= hi:
            if days[d.weekday()]:
                m |= 1 << (d - start).days
            d += timedelta(days=1)
        masks[sid] = m

    for r in g.rows("calendar_dates.txt"):
        sid = r.get("service_id", "")
        d = parse_date(r.get("date", ""))
        et = r.get("exception_type", "")
        if not sid or d is None:
            continue
        if et == "1":
            widen(d, d)
        if not (start <= d <= end):
            masks.setdefault(sid, 0)
            continue
        bit = 1 << (d - start).days
        if et == "1":
            masks[sid] = masks.get(sid, 0) | bit
        elif et == "2":
            masks[sid] = masks.get(sid, 0) & ~bit

    for r in g.rows("feed_info.txt"):
        fs, fe = parse_date(r.get("feed_start_date", "")), parse_date(r.get("feed_end_date", ""))
        if fe is not None:
            vmax = fe if vmax is None else min(vmax, fe)
        if fs is not None:
            vmin = fs if vmin is None else max(vmin, fs)
        break
    return masks, vmin, vmax


def _interpolate(times: list[int | None], seqs: list[int]) -> list[int | None]:
    """Doplní chybějící časy lineárně mezi známými (podle pořadí zastávek)."""
    n = len(times)
    out = list(times)
    i = 0
    while i < n:
        if out[i] is None:
            j = i
            while j < n and out[j] is None:
                j += 1
            if i > 0 and j < n:
                a, b = out[i - 1], out[j]
                span = j - (i - 1)
                for k in range(i, j):
                    out[k] = a + (b - a) * (k - (i - 1)) // span
            i = j
        else:
            i += 1
    return out


def load_feed(code: str, path, start: date, ndays: int,
              heads: Interner, masks_intern: Interner) -> FeedData:
    g = GtfsZip(path)
    fd = FeedData(code=code)

    # --- agentury a linky
    agencies: dict[str, tuple[str, str]] = {}
    for r in g.rows("agency.txt"):
        agencies[r.get("agency_id", "")] = (r.get("agency_name", "") or code, r.get("agency_url", ""))
    default_agency = next(iter(agencies.values()), (code, ""))
    route_idx: dict[str, int] = {}
    for r in sorted(g.rows("routes.txt"), key=lambda r: r.get("route_id", "")):
        rid = r.get("route_id", "")
        if not rid:
            continue
        mode = normalize_route_type(r.get("route_type", "3"))
        color = (r.get("route_color") or "").lstrip("#").upper() or DEFAULT_COLOR[mode]
        text = (r.get("route_text_color") or "").lstrip("#").upper()
        if not text:
            text = "FFFFFF" if _is_dark(color) else "000000"
        ag = agencies.get(r.get("agency_id", ""), default_agency)
        route_idx[rid] = len(fd.routes)
        fd.routes.append(Route(
            short=r.get("route_short_name", "") or r.get("route_long_name", "") or rid,
            long=r.get("route_long_name", ""),
            mode=mode, color=color, text_color=text, agency=ag[0], url=r.get("route_url", "") or ag[1],
        ))

    # --- zastávky (seskupení nástupišť pod stanici)
    raw_stops: dict[str, dict] = {}
    for r in g.rows("stops.txt"):
        sid = r.get("stop_id", "")
        if sid:
            raw_stops[sid] = r
    group_of: dict[str, str] = {}
    for sid, r in raw_stops.items():
        lt = r.get("location_type", "") or "0"
        if lt not in ("0", "1"):
            continue
        parent = r.get("parent_station", "")
        gid = parent if parent and parent in raw_stops else sid
        if lt == "1":
            gid = sid
        base = raw_stops[gid]
        try:
            lat, lon = float(base.get("stop_lat", "")), float(base.get("stop_lon", ""))
        except ValueError:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
            continue
        group_of[sid] = gid
        key = f"{code}:{gid}"
        if key not in fd.stops:
            fd.stops[key] = Stop(key, base.get("stop_name", "") or gid, lat, lon)
    stop_name = {sid: r.get("stop_name", "") for sid, r in raw_stops.items()}

    # --- kalendáře
    smasks, vmin, vmax = service_masks(g, start, ndays)
    fd.valid_from, fd.valid_to = vmin, vmax

    # --- spoje
    trips: dict[str, tuple[int, int, str, str]] = {}
    for r in g.rows("trips.txt"):
        tid, rid, sid = r.get("trip_id", ""), r.get("route_id", ""), r.get("service_id", "")
        m = smasks.get(sid, 0)
        if not tid or rid not in route_idx or m == 0:
            continue
        trips[tid] = (route_idx[rid], m, r.get("trip_headsign", ""), r.get("shape_id", ""))

    freqs: dict[str, list[tuple[int, int, int]]] = {}
    for r in g.rows("frequencies.txt"):
        tid = r.get("trip_id", "")
        s, e = parse_seconds(r.get("start_time", "")), parse_seconds(r.get("end_time", ""))
        try:
            hw = int(r.get("headway_secs", "0"))
        except ValueError:
            continue
        if tid in trips and s is not None and e is not None and hw > 0:
            freqs.setdefault(tid, []).append((s, e, hw))

    # --- stop_times: sběr po spojích do kompaktních polí
    # pro každý spoj: array('i') [seq, stop_ref, arr, dep, pickup, ...] (None jako -1)
    stop_ref = Interner()
    per_trip: dict[str, array] = {}
    cols = ["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time", "pickup_type", "stop_headsign"]
    stop_heads: dict[tuple[str, int], str] = {}
    for tid, sid, seq, arr, dep, pick, sh in g.raw_rows("stop_times.txt", cols):
        if tid not in trips:
            continue
        try:
            q = int(seq)
        except ValueError:
            continue
        a = parse_time(arr)
        d = parse_time(dep)
        if d is None:
            d = a
        if a is None:
            a = d
        buf = per_trip.get(tid)
        if buf is None:
            buf = per_trip[tid] = array("i")
        buf.extend((q, stop_ref(sid), -1 if a is None else a, -1 if d is None else d,
                    1 if pick == "1" else 0))
        if sh:
            stop_heads[(tid, q)] = sh

    deps: dict[str, list[tuple[int, int, int, int]]] = {}
    # varianty tras: (linka, ('s', shape_id) | ('q', posloupnost stanic)) -> počet spojů
    variants: dict[tuple[int, tuple], int] = {}
    for tid in sorted(per_trip):
        buf = per_trip[tid]
        rows = sorted((tuple(buf[i:i + 5]) for i in range(0, len(buf), 5)), key=lambda t: t[0])
        if len(rows) < 2:
            continue
        ridx, mask, head, shape_id = trips[tid]
        mode = fd.routes[ridx].mode
        seqs = [r[0] for r in rows]
        dtimes = _interpolate([None if r[3] < 0 else r[3] for r in rows], seqs)
        last_sid = stop_ref.items[rows[-1][1]]
        if not head:
            head = stop_name.get(last_sid, "")
        mask_i = masks_intern(mask)
        offsets = [0]
        if tid in freqs:
            first = dtimes[0] if dtimes[0] is not None else 0
            offsets = []
            for s, e, hw in freqs[tid]:
                t = s
                while t < e:
                    offsets.append(t // 60 - first)
                    t += hw
        fd.trips_used += len(offsets)
        if shape_id:
            vkey = ("s", shape_id)
        else:  # bez shapes.txt (např. SNCB): stanice spojené rovnou čarou
            seq_g = []
            for r in rows:
                gid = group_of.get(stop_ref.items[r[1]])
                if gid is not None and (not seq_g or seq_g[-1] != gid):
                    seq_g.append(gid)
            vkey = ("q", tuple(seq_g))
        variants[(ridx, vkey)] = variants.get((ridx, vkey), 0) + len(offsets)
        prev_gid = None
        for i, r in enumerate(rows[:-1]):  # poslední zastávka: jen výstup
            sid = stop_ref.items[r[1]]
            gid = group_of.get(sid)
            if gid is None or r[4] == 1 or dtimes[i] is None:
                continue
            if gid == prev_gid:
                continue
            prev_gid = gid
            h = stop_heads.get((tid, r[0]), head)
            hi = heads(h)
            key = f"{code}:{gid}"
            st = fd.stops.get(key)
            if st is None:
                continue
            st.modes |= MODE_BIT[mode]
            lst = deps.setdefault(key, [])
            for off in offsets:
                lst.append((dtimes[i] + off, ridx, hi, mask_i))
        del per_trip[tid]

    for key, lst in deps.items():
        uniq = sorted(set(lst))
        a = array("i")
        for t in uniq:
            a.extend(t)
        fd.departures[key] = a
    fd.lines = _line_shapes(g, code, variants, fd.stops)
    # zastávky bez odjezdů se do dlaždic nedávají
    fd.stops = {k: v for k, v in fd.stops.items() if k in fd.departures}
    return fd


SIMPLIFY_DEG = 0.00008  # ~8 m: tolerance zjednodušení tras


def _line_shapes(g: GtfsZip, code: str, variants: dict, stops: dict[str, Stop]) -> dict:
    """Polyline každé varianty trasy (shapes.txt, jinak spojnice stanic), zjednodušené."""
    need = {v[1] for (_, v) in variants if v[0] == "s"}
    raw: dict[str, array] = {}
    if need:
        cols = ["shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"]
        for sh, seq, lat, lon in g.raw_rows("shapes.txt", cols):
            if sh not in need:
                continue
            try:
                t = (float(seq), float(lat), float(lon))
            except ValueError:
                continue
            buf = raw.get(sh)
            if buf is None:
                buf = raw[sh] = array("d")
            buf.extend(t)
    pts_s: dict[str, list[tuple[float, float]]] = {}
    for sh, buf in raw.items():
        pts = sorted((buf[i], buf[i + 1], buf[i + 2]) for i in range(0, len(buf), 3))
        pts_s[sh] = simplify([(la, lo) for _, la, lo in pts], SIMPLIFY_DEG)
    raw.clear()
    out: dict[int, dict[tuple, int]] = {}
    for (ridx, vkey), n in variants.items():
        if vkey[0] == "s":
            pts = pts_s.get(vkey[1])
        else:
            pts = [(st.lat, st.lon) for gid in vkey[1] if (st := stops.get(f"{code}:{gid}"))]
        if not pts or len(pts) < 2:
            continue
        key = tuple((round(la, 5), round(lo, 5)) for la, lo in pts)
        d = out.setdefault(ridx, {})
        d[key] = d.get(key, 0) + n  # stejná geometrie z více shape_id = jedna varianta
    return {ridx: sorted(((n, list(k)) for k, n in d.items()), key=lambda t: (-t[0], t[1])) for ridx, d in out.items()}


def simplify(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas–Peucker (iterativně), souřadnice ve stupních."""
    n = len(pts)
    if n < 3:
        return list(pts)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        dd = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if dd == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / dd))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, i
        if best > tol2:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def encode_polyline(pts: list[tuple[float, float]]) -> str:
    """Google encoded polyline, přesnost 1e-5."""
    out = []
    plat = plon = 0
    for lat, lon in pts:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def _is_dark(hex6: str) -> bool:
    try:
        r, g, b = int(hex6[0:2], 16), int(hex6[2:4], 16), int(hex6[4:6], 16)
    except (ValueError, IndexError):
        return True
    return (0.299 * r + 0.587 * g + 0.114 * b) < 150
