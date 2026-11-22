# Formát dat (verze 1)

Všechny soubory jsou JSON bez mezer, s seřazenými klíči (deterministický výstup).
Kompresi (gzip/brotli) dělá hosting.

## `lines/{linka}.json`

Varianty trasy linky (index z `routes.json`): `{"v": [[počet spojů, encoded polyline], …]}`,
Google encoded polyline s přesností 1e-5, zjednodušeno Douglas–Peucker ~8 m. Z `shapes.txt`, jinak
spojnice stanic (SNCB). Klient načítá až po klepnutí na linku.

## `manifest.json`

```json
{
  "v": 2,
  "build": "6174092a97af6e4c",          // hash obsahu; mění se jen se změnou dat
  "built": "2026-11-22T16:00:00+00:00",
  "start": "2026-11-21",                // den 0 bitových masek (včerejšek kvůli spojům po půlnoci)
  "days": 11,                           // počet dní v maskách (days z feeds.yaml + včerejšek)
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

## `tiles/{y}_{x}.json` (formát v2)

`y = floor(lat / 0.1)`, `x = floor(lon / 0.15)` (s zaokrouhlením na 9 desetinných míst kvůli
chybám plovoucí čárky). Zastávka leží v právě jedné dlaždici. Když je dlaždice po gzip větší
než `tile_max_gzip_bytes`, rozdělí se na čtvrtiny s příponou `_q` (0 = JZ, 1 = JV, 2 = SZ, 3 = SV),
případně opakovaně (`508_29_3_1`).

```json
{
  "v": 2,
  "s": [["delijn:301234", "Gent Sint-Pieters", 51.03581, 3.71023, 3]],  // id, název, lat, lon, druhy (bity: 1 bus, 2 vlak, 4 tram/metro, 8 jiné)
  "h": ["Gent Zuid", "Mariakerke Post", …],  // názvy cílů a výchozích zastávek (lokální tabulka)
  "c": ["/////w8=", …],           // kalendáře: base64, bit i = den start + i (little-endian)
  "d": [[481, 0, 12, 0, 1, 0, 3, 18, 9, …]]  // pro každou zastávku devítice událostí
}
```

Jedna událost = zastavení spoje na zastávce, 9 čísel:

| Pole | Význam |
| --- | --- |
| `m` | odjezd ze zastávky, minuta služebního dne (může být ≥ 1440) |
| `a` | `m` − příjezd (obvykle 0) |
| `r` | index linky v `routes.json` |
| `h` | cíl spoje (index do `h`) |
| `o` | výchozí zastávka spoje (index do `h`) |
| `c` | kalendář (index do `c`) |
| `f` | příznaky: 1 = lze nastoupit (odjezd), 2 = lze vystoupit (příjezd) |
| `s` | `m` − odjezd z výchozí zastávky |
| `e` | příjezd do cílové zastávky − `m` |

Událost v minutě `m` ze služebního dne `s` je vůči půlnoci dne `D` v čase `m + (s − D) · 1440`;
klient zkouší `s = D − 2 … D + 1`. Odjezdy použijí `m`, příjezdy `m − a`.

Do dlaždic se nedostanou: zastavení, kde nejde nastoupit ani vystoupit (`pickup_type=1` a
`drop_off_type=1`, první zastávka bez nástupu, poslední bez výstupu),
spoje, které v období nejedou, a zastávky bez odjezdů. Nástupiště jsou seskupená pod
`parent_station`. Chybějící časy se dopočítají lineárně, `frequencies.txt` se rozvine.
