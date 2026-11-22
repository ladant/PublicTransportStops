# Bus na výlet

Webová aplikace (PWA) pro plánování výletů veřejnou dopravou. Po kliknutí do mapy ukáže
zastávky autobusů a vlaků v okruhu, odkud ve zvolený den a časovém okně něco jede.
Okno **A** (tam) a volitelné okno **B** (zpět) se barevně odliší a zastávky, odkud se dá
jet tam i zpět, jsou zvýrazněné.

Data se jednou denně předpočítají z GTFS do statických dlaždic (varianta B ze zadání).
Za běhu aplikace nezatěžuje žádný zdroj dat a nepotřebuje server.

```
feeds.yaml ──► pipeline (Python, GitHub Actions 1× denně) ──► manifest.json, routes.json, tiles/*.json
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
   který nabízí GTFS všech čtyř dopravců bez klíče. Secrets `DELIJN_API_KEY`, `STIB_API_KEY`,
   `SNCB_GTFS_URL` a `TEC_GTFS_URL` jsou volitelné a slouží jen pro záložní zdroje.
3. Workflow běží při pushi do `main`, ručně (*Run workflow*) a denně v 17:00 belgického času.

Provozní pojistky:

- Když zdroj selže, použije se jeho poslední platná verze z cache Actions. Celé sestavení
  spadne jen tehdy, když není k dispozici žádný feed; na webu pak zůstanou poslední dlaždice
  a GitHub pošle e-mail o selhání.
- Plánovaný běh commitne `data-build.txt`, aby GitHub workflow po 60 dnech nevypnul.
- Výstup je deterministický: stejná data = stejné bajty a stejné `build` v manifestu.
- Manifest nese platnost dat každého dopravce. Když zvolený den leží mimo ni, aplikace to
  oznámí, aby prázdná mapa nevypadala jako „nic nejede“.

## Stav vůči zadání

Hotovo (fáze 1 a 2): mapa s kliknutím i dlouhým stiskem, „moje poloha“, okruh 0,5–15 km,
datum v rámci platnosti, okna A a B (i přes půlnoc), filtr druhu dopravy, barvy A / B / A i B,
jiná značka pro nádraží, popup s odjezdy, trasou pěšky a odkazem na výluky, seznam linek
se zvýrazněním zastávek, stav v URL, čeština a angličtina, tmavý režim, offline režim
(service worker ukládá aplikaci, navštívené dlaždice a mapové podklady).

Zbývá:

- **Ověřit URL zdrojů v `feeds.yaml` při prvním běhu.** Z vývojového prostředí nebyly
  belgické zdroje dostupné, pipeline je otestovaná na testovacím a syntetickém GTFS.
- Ruční kontrola 5 zastávek proti webu dopravce (akceptační kritérium) – po prvním
  sestavení se skutečnými daty.
- Lighthouse audit PWA na nasazené verzi.
- Fáze 3: Česko (další feedy do `feeds.yaml`, `default_view`), pozdější GTFS-RT Service Alerts.

## Licence

Kód: MIT. Data jízdních řádů patří dopravcům (CC-BY-4.0 nebo podobná licence),
mapové podklady © OpenFreeMap, © přispěvatelé OpenStreetMap.
