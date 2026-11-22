"""Seznam obcí pro hledání v mapě (web/public/places.json) z GeoNames.

Jednorázově (obce se mění zřídka); výsledek je v repozitáři:

    curl -O https://download.geonames.org/export/dump/BE.zip
    curl -o altBE.zip https://download.geonames.org/export/dump/alternatenames/BE.zip
    curl -O https://download.geonames.org/export/dump/admin2Codes.txt
    python scripts/build_places.py BE.zip altBE.zip admin2Codes.txt web/public/places.json

Data: GeoNames (https://www.geonames.org), licence CC BY 4.0.
Formát: {"src", "p": [provincie], "d": [[název, lat, lon, provincie, váha, "alt1|alt2"], ...]}
"""
from __future__ import annotations

import json
import math
import sys
import unicodedata
import zipfile

# obydlená místa: obce, vesnice, osady; ne zaniklá (PPLH, PPLQ, PPLW) ani části měst (PPLX)
KEEP = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC", "PPLL", "PPLF", "PPLS", "PPLG", "PPLR"}
LANGS = {"fr", "nl", "de", "en", "cs"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c)).replace("-", " ").replace("'", " ").strip()


def short_province(name: str) -> str:
    for p in ("Provincie ", "Province de ", "Province du ", "Province de la "):
        if name.startswith(p):
            return name[len(p):]
    return "Bruxelles / Brussel" if name.startswith("Bruxelles") else name


def weight(code: str, pop: int) -> int:
    if code == "PPLC" or pop >= 100_000:
        return 5
    if code in ("PPLA", "PPLA2") or pop >= 20_000:
        return 4
    if code in ("PPLA3", "PPLA4") or pop >= 5_000:
        return 3
    if pop >= 1_000:
        return 2
    return 1 if pop > 0 else 0


def main(be_zip, alt_zip, admin2_path, out_path):
    provinces = {}
    for line in open(admin2_path, encoding="utf-8"):
        f = line.rstrip("\n").split("\t")
        if f[0].startswith("BE."):
            provinces[f[0]] = short_province(f[1])
    prov_list = sorted(set(provinces.values()))
    prov_idx = {p: i for i, p in enumerate(prov_list)}

    places = {}
    with zipfile.ZipFile(be_zip) as z:
        for line in z.open("BE.txt"):
            f = line.decode("utf-8").rstrip("\n").split("\t")
            if f[6] != "P" or f[7] not in KEEP:
                continue
            gid, name, lat, lon = int(f[0]), f[1], float(f[4]), float(f[5])
            prov = provinces.get(f"BE.{f[10]}.{f[11]}", "")
            pop = int(f[14] or 0)
            places[gid] = {"name": name, "lat": lat, "lon": lon, "prov": prov, "w": weight(f[7], pop), "alt": []}

    with zipfile.ZipFile(alt_zip) as z:
        for line in z.open("BE.txt"):
            f = line.decode("utf-8").rstrip("\n").split("\t")
            gid, lang, alt = int(f[1]), f[2], f[3]
            p = places.get(gid)
            if p is None or lang not in LANGS:
                continue
            historic = len(f) > 7 and f[7] == "1"
            colloquial = len(f) > 6 and f[6] == "1"
            if historic or colloquial or norm(alt) == norm(p["name"]) or len(alt) > 40:
                continue
            if all(norm(alt) != norm(a) for a in p["alt"]) and len(p["alt"]) < 5:
                p["alt"].append(alt)

    # duplicity (stejný název do 2 km, např. PPLA i PPL) -> nechat významnější
    out = []
    by_name = {}
    for p in sorted(places.values(), key=lambda p: (-p["w"], p["name"])):
        key = norm(p["name"])
        dup = False
        for q in by_name.get(key, []):
            if abs(q["lat"] - p["lat"]) < 0.02 and abs(q["lon"] - p["lon"]) < 0.03:
                dup = True
                break
        if dup:
            continue
        by_name.setdefault(key, []).append(p)
        out.append([p["name"], round(p["lat"], 4), round(p["lon"], 4), prov_idx.get(p["prov"], -1), p["w"],
                    "|".join(p["alt"])])

    data = {"src": "GeoNames (geonames.org), CC BY 4.0", "p": prov_list, "d": out}
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} míst, {len(prov_list)} provincií")


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    main(*sys.argv[1:])
