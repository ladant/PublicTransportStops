"""Vygeneruje syntetický GTFS velikosti belgické regionální sítě (pro zátěžové testy).

python scripts/synth_gtfs.py out/synth.zip [--stops 12000] [--routes 900] [--start 20261101]
Deterministický (pevné semínko). Data jsou smyšlená.
"""
from __future__ import annotations

import argparse
import csv
import io
import math
import random
import zipfile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--stops", type=int, default=12000)
    ap.add_argument("--routes", type=int, default=900)
    ap.add_argument("--start", default="20261101")
    ap.add_argument("--end", default="20270131")
    a = ap.parse_args()
    rnd = random.Random(42)

    # zastávky: shluky kolem "měst" (víc v Bruselu, Antverpách, Gentu, Lutychu, Charleroi)
    cities = [(50.846, 4.352, 0.12, 4), (51.219, 4.402, 0.08, 2), (51.054, 3.717, 0.07, 1.5),
              (50.633, 5.567, 0.07, 1.5), (50.411, 4.444, 0.06, 1.2)]
    stops = []
    for i in range(a.stops):
        if rnd.random() < 0.45:
            lat0, lon0, sp, _ = rnd.choices(cities, weights=[c[3] for c in cities])[0]
            lat, lon = rnd.gauss(lat0, sp / 2), rnd.gauss(lon0, sp / 1.4)
        else:
            lat, lon = rnd.uniform(49.6, 51.45), rnd.uniform(2.6, 6.3)
        stops.append((f"S{i}", f"Zastavka {i}", round(lat, 6), round(lon, 6)))

    def near(lat, lon, k=60):
        cand = rnd.sample(stops, k)
        return min(cand, key=lambda s: (s[2] - lat) ** 2 + (s[3] - lon) ** 2)

    routes, trips, st, freq = [], [], [], []
    tid = 0
    for r in range(a.routes):
        rail = r < 60
        rtype = 2 if rail else (0 if r < 120 else 3)
        n = rnd.randint(8, 22) if rail else rnd.randint(10, 35)
        s0 = rnd.choice(stops)
        ang = rnd.uniform(0, 2 * math.pi)
        step = 0.06 if rail else 0.012
        path, lat, lon = [], s0[2], s0[3]
        for _ in range(n):
            s = near(lat, lon)
            if s not in path:
                path.append(s)
            ang += rnd.gauss(0, 0.3)
            lat += step * math.sin(ang)
            lon += step * 1.5 * math.cos(ang)
        if len(path) < 3:
            continue
        rid = f"R{r}"
        color = "%02X%02X%02X" % (rnd.randint(0, 200), rnd.randint(0, 200), rnd.randint(0, 200))
        routes.append((rid, "IC" + str(r) if rail else str(r), "", rtype, color))
        headway = rnd.choice([15, 20, 30, 60, 60, 120]) if not rail else rnd.choice([30, 60])
        first, last = rnd.randint(300, 420), rnd.randint(1260, 1470)
        for direction, seq in ((0, path), (1, path[::-1])):
            for svc in ("WK", "SA", "SU"):
                hw = headway if svc == "WK" else headway * 2
                t = first + rnd.randint(0, hw - 1)
                while t < last:
                    tid += 1
                    trips.append((rid, svc, f"T{tid}", seq[-1][1], direction))
                    tt = t
                    for k, s in enumerate(seq):
                        hh = f"{tt // 60:02d}:{tt % 60:02d}:00"
                        st.append((f"T{tid}", hh, hh, s[0], k + 1))
                        tt += rnd.randint(1, 4) if not rail else rnd.randint(4, 12)
                    t += hw

    def table(header, rows):
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
        return buf.getvalue()

    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("agency.txt", table(["agency_id", "agency_name", "agency_url", "agency_timezone"],
                                       [("SY", "Synth", "https://example.org", "Europe/Brussels")]))
        z.writestr("stops.txt", table(["stop_id", "stop_name", "stop_lat", "stop_lon"], stops))
        z.writestr("routes.txt", table(["route_id", "route_short_name", "route_long_name", "route_type", "route_color"], routes))
        z.writestr("calendar.txt", table(
            ["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
            [("WK", 1, 1, 1, 1, 1, 0, 0, a.start, a.end), ("SA", 0, 0, 0, 0, 0, 1, 0, a.start, a.end),
             ("SU", 0, 0, 0, 0, 0, 0, 1, a.start, a.end)]))
        z.writestr("trips.txt", table(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], trips))
        z.writestr("stop_times.txt", table(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], st))
    print(f"{len(stops)} zastávek, {len(routes)} linek, {len(trips)} spojů, {len(st)} zastavení")


if __name__ == "__main__":
    main()
