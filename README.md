# Co pojede?

Webová aplikace (PWA) pro plánování výletů veřejnou dopravou, primárně na mobilu:
**https://ladant.github.io/PublicTransportStops/**. Po klepnutí do mapy (nebo pro celý výřez
mapy) ukáže zastávky autobusů, tramvají, metra a vlaků v Belgii, kde se ve zvolený den a
dvou časech dá přijet nebo odjet. Zastávky dostupné v obou časech jsou zvýrazněné.

**Podrobný popis projektu, rozhodnutí, otevřené body a plán: [`docs/PROJECT.md`](docs/PROJECT.md).**

Data se jednou denně předpočítají z GTFS do statických dlaždic (varianta B ze zadání).
Za běhu aplikace nezatěžuje žádný zdroj dat a nepotřebuje server.

```
feeds.yaml ──► pipeline (Python, GitHub Actions 1× denně) ──► manifest.json, routes.json, tiles/*.json, lines/*.json
                                                                      │
                                                     statický hosting (GitHub Pages)
                                                                      │
                                     PWA (MapLibre) stáhne jen dlaždice kolem bodu a počítá v prohlížeči
```

## Struktura

| Cesta | Obsah |
| --- | --- |
| `feeds.yaml` | zdroje GTFS, klíče přes `${PROMENNA}`, hodina sestavení, mřížka dlaždic |
| `pipeline/busnavylet/` | stažení (ETag/If-Modified-Since, záložní zdroje, poslední platná verze), zpracování GTFS, dlaždice |
| `web/` | PWA: Vite + MapLibre GL bez frameworku, `src/core.js` = výpočet bez DOM |
| `tests/` | pytest nad malým testovacím GTFS (`tests/fixtures/`) |
| `web/tests/` | testy klientské logiky (`node --test`), používají výstup pipeline |
| `scripts/synth_gtfs.py` | syntetický GTFS velikosti regionální sítě pro zátěžové testy |
| `docs/data-format.md` | formát výstupních souborů |
| `.github/workflows/build.yml` | testy, denní sestavení dat, nasazení na GitHub Pages |

## Lokální vývoj

```bash
pip install -r requirements.txt pytest
python -m pytest tests                       # testy pipeline

# data pro vývoj z testovacích feedů (nebo z libovolného GTFS zipu)
python scripts/synth_gtfs.py out/synth.zip
PYTHONPATH=pipeline python -m busnavylet --config tests/fixtures/feeds.yaml \
  --only synth --only mini --local synth=out/synth.zip --local mini=tests/fixtures/mini \
  --out web/public/data --cache out/cache --today 2026-11-22

cd web
npm install
npm test                                     # testy klientské logiky
npm run dev                                  # http://localhost:5173
```

Se skutečnými daty: `PYTHONPATH=pipeline python -m busnavylet --out web/public/data`
(stáhne feedy podle `feeds.yaml`, klíče bere z proměnných prostředí).

## Nasazení

1. V nastavení repozitáře **Settings → Pages** zvolit *Source: GitHub Actions*.
2. Data se stahují z [Belgian Mobility Open Data Portal](https://data.belgianmobility.io/en/data.html),
   který nabízí GTFS všech čtyř dopravců. Bez klíče platí limit 100 stažení denně; doporučený
   secret **`BMC_API_KEY`** (Primary key z developer portálu) se posílá v hlavičce
   `bmc-partner-key`. Secrets `DELIJN_API_KEY`, `STIB_API_KEY`, `SNCB_GTFS_URL`
   a `TEC_GTFS_URL` jsou volitelné a slouží jen pro záložní zdroje.
3. Workflow běží při pushi do `main`, ručně (*Run workflow*) a denně od 4:00 belgického času.

Provozní pojistky:

- Když zdroj selže, použije se jeho poslední platná verze z cache Actions. Celé sestavení
  spadne jen tehdy, když není k dispozici žádný feed; na webu pak zůstanou poslední dlaždice
  a GitHub pošle e-mail o selhání.
- Plánovaný běh commitne `data-build.txt`, aby GitHub workflow po 60 dnech nevypnul.
- Výstup je deterministický: stejná data = stejné bajty a stejné `build` v manifestu.
- Manifest nese platnost dat každého dopravce. Když zvolený den leží mimo ni, aplikace to
  oznámí, aby prázdná mapa nevypadala jako „nic nejede“.

## Stav

Fáze 1 a 2 zadání jsou hotové a nasazené, včetně dat všech čtyř belgických dopravců
(SNCB, De Lijn, TEC, STIB) na 14 dní dopředu. Co aplikace umí, otevřené body a možnosti
dalšího vývoje (mimořádnosti a výluky, Česko) popisuje [`docs/PROJECT.md`](docs/PROJECT.md).

## Licence

Kód: MIT. Data jízdních řádů patří dopravcům (CC-BY-4.0 nebo podobná licence),
mapové podklady © OpenFreeMap, © přispěvatelé OpenStreetMap.
