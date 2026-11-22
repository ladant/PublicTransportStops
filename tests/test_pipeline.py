import base64
import json
import sys
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

from busnavylet.build import build, cell, tile_bbox  # noqa: E402
from busnavylet.config import Config, Feed, MissingVariable, expand  # noqa: E402
from busnavylet.download import is_valid_gtfs_zip  # noqa: E402
from busnavylet.gtfs import parse_time  # noqa: E402

FIX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 11, 22)  # neděle; start masky = sobota 21. 11.


def make_zip(src: Path, dest: Path, subdir: str = "") -> Path:
    with zipfile.ZipFile(dest, "w") as z:
        for f in sorted(src.iterdir()):
            z.write(f, subdir + f.name)
    return dest


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("b")
    mini = make_zip(FIX / "mini", tmp / "mini.zip")
    cdonly = make_zip(FIX / "cdonly", tmp / "cdonly.zip", subdir="gtfs/")  # vnořená složka v zipu
    cfg = Config(feeds=[Feed("mini", "Mini", []), Feed("cdonly", "Jen kalendar_dates", [])])
    out = tmp / "data"
    now = datetime(2026, 11, 22, 16, 0, tzinfo=timezone.utc)
    manifest = build(cfg, [(cfg.feeds[0], mini, None), (cfg.feeds[1], cdonly, None)], out, TODAY, now)
    return cfg, out, manifest


def load_all(out: Path, manifest):
    routes = json.loads((out / "routes.json").read_text())
    stops = {}
    for key in manifest["tiles"]:
        t = json.loads((out / "tiles" / f"{key}.json").read_text())
        for i, s in enumerate(t["s"]):
            assert s[0] not in stops, f"zastávka {s[0]} je ve více dlaždicích"
            deps = []
            d = t["d"][i]
            for j in range(0, len(d), 4):
                m, r, h, c = d[j:j + 4]
                deps.append((m, routes[r][0], t["h"][h], base64.b64decode(t["c"][c])))
            stops[s[0]] = {"tile": key, "name": s[1], "lat": s[2], "lon": s[3], "modes": s[4], "deps": deps}
    return stops, routes


def runs_on(mask: bytes, day: int) -> bool:
    return day >= 0 and (day >> 3) < len(mask) and bool(mask[day >> 3] & (1 << (day & 7)))


def departures_on(stop, manifest, d: date, a: int = 0, b: int = 1440):
    """Stejná logika jako klient (web/src/core.js)."""
    day = (d - date.fromisoformat(manifest["start"])).days
    out = []
    for m, r, h, mask in stop["deps"]:
        k = m // 1440
        t = m - 1440 * k
        if runs_on(mask, day - k) and a <= t <= b:
            out.append((t, r, h))
    return sorted(out)


def test_parse_time():
    assert parse_time("25:10:00") == 1510
    assert parse_time("8:05:59") == 485
    assert parse_time("") is None


def test_manifest(built):
    _, _, m = built
    assert m["start"] == "2026-11-21" and m["days"] == 11
    feeds = {f["code"]: f for f in m["feeds"]}
    assert feeds["mini"]["from"] == "2026-11-01" and feeds["mini"]["to"] == "2026-12-31"
    assert feeds["cdonly"]["from"] == "2026-11-23" and feeds["cdonly"]["to"] == "2027-03-01"
    assert len(m["build"]) == 16


def test_parent_station_grouping(built):
    _, out, m = built
    stops, _ = load_all(out, m)
    assert "mini:STA" in stops and "mini:P1" not in stops and "mini:P2" not in stops
    assert stops["mini:STA"]["name"] == "Gare"
    assert stops["mini:STA"]["modes"] & 2  # vlak


def test_no_boarding_departures_skipped(built):
    _, out, m = built
    stops, _ = load_all(out, m)
    # S3: T2 má pickup_type=1, T3 a T4 tam končí; zůstává T1 a dva spoje T5 z frequencies
    times = sorted((d[0], d[1]) for d in stops["mini:S3"]["deps"])
    assert times == [(420, "101"), (450, "101"), (500, "12")]
    # S4 = konečná T1 a T5, zůstane jen odjezd T2
    assert [d[0] for d in stops["mini:S4"]["deps"]] == [540]


def test_headsign_default_and_interpolation(built):
    _, out, m = built
    stops, _ = load_all(out, m)
    assert stops["mini:S1b"]["deps"][0][2] == "Centrum"   # trip bez headsign -> poslední zastávka
    assert stops["mini:S5"]["deps"][0][0] == 490          # 08:10 dopočítáno mezi 08:00 a 08:20


def test_calendar_and_exceptions(built):
    _, out, m = built
    stops, _ = load_all(out, m)
    s1, sta = stops["mini:S1"], stops["mini:STA"]
    mon, wed, sun = date(2026, 11, 23), date(2026, 11, 25), date(2026, 11, 22)
    assert (480, "12", "Les") in departures_on(s1, m, mon)
    # svátek: WK zrušeno; zbývá jen noční spoj z úterý (25:10 = středa 01:10)
    assert departures_on(s1, m, wed, 0, 1439) == [(70, "12", "Noc")]
    assert departures_on(s1, m, date(2026, 11, 26), 0, 1439) == [(480, "12", "Les")]  # středeční noční nejede
    assert departures_on(sta, m, wed) == [(600, "IC", "Les")]  # WE přidáno
    assert departures_on(sta, m, sun) == [(600, "IC", "Les")]
    assert departures_on(sta, m, mon) == []


def test_calendar_dates_only_feed(built):
    _, out, m = built
    stops, _ = load_all(out, m)
    x = stops["cdonly:X"]
    assert departures_on(x, m, date(2026, 11, 23)) == [(720, "7", "Mesto")]
    assert departures_on(x, m, date(2026, 11, 24)) == []
    assert "cdonly:Y" not in stops  # jen konečná, žádný odjezd


def test_after_midnight(built):
    _, out, m = built
    stops, _ = load_all(out, m)
    s1 = stops["mini:S1"]
    # T4 25:10 v pondělí (WK) = úterý 01:10; v neděli ráno nic, protože sobota není WK
    assert (70, "12", "Noc") in departures_on(s1, m, date(2026, 11, 24))
    assert all(t != 70 for t, *_ in departures_on(s1, m, date(2026, 11, 23)))
    assert all(t != 70 for t, *_ in departures_on(s1, m, date(2026, 11, 22)))
    # spoj z pátku 20. 11. (před začátkem masky) se nehledá; sobota 21. 11. ráno nemá T4
    assert all(t != 70 for t, *_ in departures_on(s1, m, date(2026, 11, 21)))


def test_tile_boundary(built):
    cfg, out, m = built
    stops, _ = load_all(out, m)
    # 4.35 / 0.15 = 28.999999… v plovoucí čárce, musí padnout do buňky 29
    assert cell(4.35, 0.15) == 29 and cell(4.3499, 0.15) == 28
    assert stops["mini:S1"]["tile"].split("_")[1] == "29"
    assert stops["mini:S1b"]["tile"].split("_")[1] == "28"
    for sid, s in stops.items():
        so, we, no, ea = tile_bbox(s["tile"], cfg.dlat, cfg.dlon)
        assert so - 1e-9 <= s["lat"] <= no + 1e-9 and we - 1e-9 <= s["lon"] <= ea + 1e-9, sid


def test_deterministic(built, tmp_path):
    cfg, out, m = built
    mini = make_zip(FIX / "mini", tmp_path / "mini.zip")
    cdonly = make_zip(FIX / "cdonly", tmp_path / "cdonly.zip", subdir="gtfs/")
    m2 = build(cfg, [(cfg.feeds[0], mini, None), (cfg.feeds[1], cdonly, None)], tmp_path / "d", TODAY,
               datetime(2026, 11, 22, 16, 0, tzinfo=timezone.utc))
    assert m2["build"] == m["build"]
    for key in m["tiles"]:
        assert (out / "tiles" / f"{key}.json").read_bytes() == (tmp_path / "d" / "tiles" / f"{key}.json").read_bytes()


def test_tile_split(tmp_path):
    mini = make_zip(FIX / "mini", tmp_path / "mini.zip")
    cfg = Config(feeds=[Feed("mini", "Mini", [])], tile_max_gzip_bytes=50)
    m = build(cfg, [(cfg.feeds[0], mini, None)], tmp_path / "d", TODAY)
    assert any(k.count("_") > 1 for k in m["tiles"])
    stops, _ = load_all(tmp_path / "d", m)
    assert len(stops) == 6  # S1, S1b, STA, S3, S4, S5


def test_broken_feed_falls_back_to_previous(tmp_path):
    good = make_zip(FIX / "mini", tmp_path / "good.zip")
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("stops.txt", "stop_id\n")
    cfg = Config(feeds=[Feed("mini", "Mini", [])])
    m = build(cfg, [(cfg.feeds[0], bad, good)], tmp_path / "d", TODAY)
    assert [f["code"] for f in m["feeds"]] == ["mini"]
    assert not is_valid_gtfs_zip(bad) and is_valid_gtfs_zip(good)


def test_expand_env():
    assert expand("https://x/${K}", {"K": "abc"}) == "https://x/abc"
    with pytest.raises(MissingVariable):
        expand("${K}", {})
