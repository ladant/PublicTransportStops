# Formát dat (verze 1)

Všechny soubory jsou JSON bez mezer, s seřazenými klíči (deterministický výstup).
Kompresi (gzip/brotli) dělá hosting.

## `manifest.json`

```json
{
  "v": 1,
  "build": "6174092a97af6e4c",          // hash obsahu; mění se jen se změnou dat
  "built": "2026-11-22T16:00:00+00:00",
  "start": "2026-11-21",                // den 0 bitových masek (včerejšek kvůli spojům po půlnoci)
  "days": 29,                           // počet dní v maskách
  "grid": [0.1, 0.15],                  // výška a šířka základní dlaždice ve stupních
  "bbox": [lonMin, latMin, lonMax, latMax],
  "view": {"center": [4.47, 50.64], "zoom": 7.3},
  "feeds": [{"code": "delijn", "name": "De Lijn", "from": "2026-11-01", "to": "2026-12-20",
             "license": "CC-BY-4.0", "alerts": "https://…"}],
  "tiles": ["505_29", "508_29_3", …]    // existující dlaždice
}
```

Klient nabízí dny `start + 1` až `start + days - 1`.

## `routes.json`

Pole linek, index = číslo linky v dlaždicích:
`[krátký název, dlouhý název, druh, barva, barva textu, dopravce, kód feedu]`.

Druh: 0 tramvaj, 1 metro, 2 vlak, 3 autobus, 4 loď, 5 jiné (rozšířené GTFS typy jsou převedené).

## `tiles/{y}_{x}.json`

`y = floor(lat / 0.1)`, `x = floor(lon / 0.15)` (s zaokrouhlením na 9 desetinných míst kvůli
chybám plovoucí čárky). Zastávka leží v právě jedné dlaždici. Když je dlaždice po gzip větší
než `tile_max_gzip_bytes`, rozdělí se na čtvrtiny s příponou `_q` (0 = JZ, 1 = JV, 2 = SZ, 3 = SV),
případně opakovaně (`508_29_3_1`).

```json
{
  "v": 1,
  "s": [["delijn:301234", "Gent Sint-Pieters", 51.03581, 3.71023, 3]],  // id, název, lat, lon, druhy (bity: 1 bus, 2 vlak, 4 tram/metro, 8 jiné)
  "h": ["Gent Zuid", …],          // směry (lokální tabulka)
  "c": ["/////w8=", …],           // kalendáře: base64, bit i = den start + i (little-endian)
  "d": [[485, 12, 0, 0, 1510, 12, 1, 0]]  // pro každou zastávku čtveřice: minuta, linka, směr, kalendář
}
```

Minuta je od půlnoci služebního dne a může být ≥ 1440 (spoje po půlnoci). Odjezd v minutě `m`
ze služebního dne `s` je vůči půlnoci dne `D` v čase `m + (s − D) · 1440`; klient zkouší
`s = D − 2 … D + 1`.

Do dlaždic se nedostanou: poslední zastávka spoje, zastavení s `pickup_type=1`,
spoje, které v období nejedou, a zastávky bez odjezdů. Nástupiště jsou seskupená pod
`parent_station`. Chybějící časy se dopočítají lineárně, `frequencies.txt` se rozvine.
