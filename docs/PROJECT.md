# Co pojede? – popis projektu a plán

Stav k 22. 11. 2026. Aplikace běží na **https://ladant.github.io/PublicTransportStops/**.

## 1. O co jde

„Co pojede?“ je webová aplikace (PWA) pro plánování výletů veřejnou dopravou, primárně na mobilu.
Uživatel klepne do mapy (nebo použije svou polohu, případně celý výřez mapy) a vidí zastávky
autobusů, tramvají, metra a vlaků, kde se ve zvolený den a časech dá **přijet** nebo **odjet**.

Typické použití: ráno hledám, kam se dá dojet (příjezdy a odkud spoj jede), odpoledne hledám,
odkud se vrátit (odjezdy a kam spoj jede). Zastávky, kde se dá v obou časech, jsou zvýrazněné:
hodí se na okružní výlet.

Nejde o vyhledávač spojení A → B. Aplikace odpovídá na otázku „co kde jede“ v okolí zvoleného místa.

Původní pracovní název byl „Bus na výlet“. Přejmenování na „Co pojede?“ odráží rozšíření o vlaky,
tramvaje a metro a o konkrétní příjezdy a odjezdy.

## 2. Co aplikace umí (stav nasazení)

### Výběr oblasti
- **Okruh:** bod v mapě (klepnutí, dlouhý stisk nebo „Moje poloha“) a poloměr 0,5–15 km. Bod
  je černý špendlík, ve tmavém vzhledu světlý.
- **Výřez mapy:** zastávky v celé viditelné části mapy, přepočet po každém posunu či přiblížení.
  Nad ~30 km výšky výřezu výzva k přiblížení.
- **✕ Zrušit výběr:** zruší bod, výřez, kartu i zvýraznění a oddálí na přehled regionu (zoom 9).
- **Hledání obce** v poli nahoře v mapě: ~12 500 belgických obcí, vesnic a osad z GeoNames, i podle
  francouzských, nizozemských, německých, anglických a českých tvarů (Liège / Luik / Lutych) a bez
  diakritiky. Výběr mapu přiblíží (města zoom 12, vesnice 13,5); Enter vezme první výsledek.
  Seznam (`web/public/places.json`, 140 kB gzip) se stáhne až při prvním hledání a funguje offline.

### Nastavení nad mapou
- Den v rozsahu platnosti dat (aktuálně **14 dní dopředu**).
- Dva časy, oba volitelné. U každého přepínač **↘ Příjezdy / ↗ Odjezdy**. Výchozí: 1. čas
  příjezdy 8–11, 2. čas vypnutý; po zapnutí odjezdy 15–19.
- Druh dopravy: Bus / Vlak / Tram (tramvaj a metro).
- Na mobilu jde nastavení **sbalit** do jednoho řádku se shrnutím, mapa se pak zvětší.

### Výsledky
- Barvy zastávek: modrá = 1. čas, oranžová = 2. čas, zelená = oba časy. Nádraží mají čtvercovou
  značku. Legenda ukazuje nastavené časy (●↘8–11 ●↗15–19).
- **Karta zastávky pod mapou** (na desktopu v levém sloupci): příjezdy („z <výchozí zastávka>“) a
  odjezdy (cíl), barevné číslo linky, dopravce. **Klepnutí na spoj** ho rozbalí:
  výchozí zastávka s časem → tato zastávka → cíl s časem.
  Odkazy: trasa pěšky (Google/Apple Maps) a „Ověřit výluky“ u dopravce.
- **Seznam linek** v oblasti s počty spojů v obou časech. Linky se stejným číslem a dopravcem jsou
  sloučené (SNCB má každou trasu IC jako samostatnou linku). Klepnutí na linku zvýrazní její
  zastávky a **vykreslí trasu** barvou linky s tmavým lemem (u SNCB spojnice stanic).

### Ostatní
- Celé nastavení je v URL, odkaz jde sdílet a uložit do záložek.
- Čeština a angličtina, vzhled automaticky / světlý / tmavý (mění i mapový podklad).
- PWA: instalace na plochu, offline pro navštívená místa (service worker ukládá aplikaci, dlaždice
  dat i mapové podklady; při novém sestavení data zahodí).
- Upozornění, když zvolený den leží mimo platnost dat některého dopravce.

## 3. Architektura

```
Belgian Mobility Open Data Portal (GTFS 4 dopravců, klíč BMC_API_KEY)
        │  1× denně v 17:00 belgického času (GitHub Actions)
        ▼
pipeline/busnavylet (Python)
  stažení (ETag, záložní zdroje, poslední platná verze, přeskočení zastaralých feedů)
  → kalendáře na bitové masky (14 dní + včerejšek kvůli spojům po půlnoci)
  → události na zastávkách (příjezd/odjezd, výchozí, cíl, nástup/výstup)
  → dlaždice ~11×11 km, automatické dělení nad 300 kB gzip
  → trasy linek (shapes.txt / spojnice stanic, zjednodušené, encoded polyline)
        │
        ▼
statické soubory na GitHub Pages: manifest.json, routes.json, tiles/*.json, lines/*.json
        │
        ▼
web/ (Vite + MapLibre GL, bez frameworku)
  stáhne jen dlaždice kolem bodu/výřezu, výpočet v prohlížeči (src/core.js)
```

Podrobný formát dat: [`docs/data-format.md`](data-format.md).

| Část | Soubor | Poznámka |
| --- | --- | --- |
| Konfigurace zdrojů | `feeds.yaml` | URL, hlavičky s `${SECRET}`, počet dní, mřížka, hodina sestavení |
| Stažení | `pipeline/busnavylet/download.py` | podmíněné stažení, retry jen u síťových chyb, kontrola platnosti |
| Zpracování GTFS | `pipeline/busnavylet/gtfs.py` | kalendáře, stanice, interpolace časů, frequencies, trasy |
| Dlaždice, manifest | `pipeline/busnavylet/build.py` | deterministický výstup, formát v2 |
| Výpočet v prohlížeči | `web/src/core.js` | výběr zastávek, okna, příjezdy/odjezdy, URL stav |
| Rozhraní | `web/src/main.js`, `style.css`, `i18n.js` | mapa, karta, seznam linek |
| Offline | `web/public/sw.js` | cache aplikace, dat a mapových podkladů |
| Seznam obcí | `scripts/build_places.py` → `web/public/places.json` | jednorázově z GeoNames, v repozitáři; po přegenerování zvýšit `PLACES_VERSION` v `main.js` |
| CI/CD | `.github/workflows/build.yml` | testy, denní sestavení, nasazení na Pages |

### Testy
- `python -m pytest tests`: pipeline nad malým testovacím GTFS (`tests/fixtures/`): kalendáře,
  svátky, feed jen s `calendar_dates`, spoje po půlnoci, hranice dlaždic, konečné, nástup/výstup,
  příjezdy, trasy linek, determinismus, záložní zdroje, zastaralé feedy.
- `cd web && npm test`: klientská logika nad výstupem pipeline.
- Ruční kontrola v headless Chromiu (Pixel 7 / šířka S24 384 px a 360 px) nad skutečnými daty.

## 4. Data a provoz

| Dopravce | Oblast | Zdroj | Poznámka |
| --- | --- | --- | --- |
| SNCB/NMBS | vlaky, celá Belgie | Belgian Mobility | bez `shapes.txt` – trasy jako spojnice stanic |
| De Lijn | bus, tram – Flandry | Belgian Mobility | záloha: API De Lijn s `DELIJN_API_KEY` |
| TEC | bus – Valonsko | Belgian Mobility | |
| STIB/MIVB | bus, tram, metro – Brusel | Belgian Mobility | data často jen ~4 týdny dopředu |

Velikost při 14 dnech je mezi naměřenými hodnotami pro 10 a 28 dní:

| Období | Dlaždice gzip | Na disku | Největší dlaždice |
| --- | --- | --- | --- |
| 10 dní | 27,5 MB | 199 MB | 292 kB |
| 28 dní | 42,4 MB | 341 MB | 298 kB |

Trasy linek přidávají ~1,9 MB gzip (3 300+ souborů po max. ~6 kB, načítají se až po klepnutí).
Limity GitHubu zdarma: Pages web ≤ 1 GB, přenos měkký limit 100 GB/měsíc, Actions u veřejného
repozitáře zdarma. Sestavení trvá ~4 min a potřebuje ~1 GB RAM.

### Secrets (Settings → Secrets and variables → Actions)
- `BMC_API_KEY` – klíč z developer portálu Belgian Mobility, posílá se v hlavičce `bmc-partner-key`
  (bez klíče platí anonymní limit 100 stažení/den).
- `DELIJN_API_KEY` – záložní zdroj De Lijn (volitelné).
- `SNCB_GTFS_URL`, `TEC_GTFS_URL`, `STIB_API_KEY` – volitelné záložní zdroje.

### Provozní pojistky
- Plánované sestavení běží v 15:00 i 16:00 UTC; projde jen první, kdy je v Bruselu ≥ 17:00 a dnes
  se ještě nesestavovalo (funguje v letním i zimním čase).
- Commit `data-build.txt` drží plánovaný workflow aktivní (GitHub ho jinak po 60 dnech vypne).
- Když zdroj selže nebo vrátí zastaralý feed, použije se další zdroj, případně poslední platná verze.
- Když sestavení selže, na webu zůstanou poslední platná data a GitHub pošle e-mail.
- Licence dat CC BY 4.0: patička uvádí dopravce, datum dat, GeoNames (obce) a OpenStreetMap / OpenFreeMap.

## 5. Rozhodnutí v průběhu

| Rozhodnutí | Proč |
| --- | --- |
| Předpočet do statických dlaždic místo živého API (Transitous) | žádný server, zdroje zatíží 1 stažení denně, offline |
| GitHub Pages místo Netlify/Cloudflare | zdarma, bez dalšího účtu, nasazení přímo z Actions |
| Belgian Mobility jako hlavní zdroj | jediný funkční zdroj všech 4 dopravců; zrcadla iRail/Mobility Database byla nefunkční nebo zastaralá |
| 14 dní dopředu | kompromis mezi plánováním na 2 víkendy a velikostí dat (10 dní bylo málo, 28 dní +54 % dat) |
| „1. čas / 2. čas“ místo „Tam / Zpět“ | aplikace nezná směr cesty, jen čas; zpáteční cesta může začít jinde |
| Příjezdy/odjezdy volitelně u každého času | ráno zajímá odkud a kdy přijedu, odpoledne kam a kdy odjedu |
| Karta zastávky pod mapou místo popupu | popup se na mobilu schovával; na mapě zůstal jen malý štítek |
| Hledání obcí ze statického seznamu (GeoNames) místo online geokodéru | funguje offline, bez limitů a cizí zátěže; stačí obce, ne adresy |
| Mobil jako primární design | nastavení úsporné a sbalitelné, testováno na 384 a 360 px |
| `main` chráněn jen proti smazání a force-push | povinné PR by blokovalo denní commit `data-build.txt` |

## 6. Otevřené body

- **Akceptační kritérium „5 zastávek proti webu dopravce“** – ruční kontrola zatím neproběhla.
- **Lighthouse audit PWA** na nasazené verzi zatím neproběhl.
- **STIB** zveřejňuje data jen na pár týdnů dopředu (teď do 16. 12.); aplikace na to upozorní.
- **Ochrana `main`:** zatím jen restrict deletions + block force pushes. Pro povinné PR je potřeba
  nahradit commit `data-build.txt` udržováním workflow přes GitHub API (malá změna).
- **Mapové podklady OpenFreeMap** jsou bez záruky dostupnosti; při výpadku aplikace přepne na
  prázdný podklad a upozorní.
- **Názvy zastávek** jsou v jazyce dopravce (NL/FR); STIB a SNCB mají překlady v `translations.txt`.

## 7. Možnosti dalšího vývoje

Seřazeno podle přínosu pro plánování výletu.

### 7.1 Mimořádnosti a výluky (zvažováno, odloženo)
Portál nabízí hlášení o mimořádnostech, která jdou stahovat jednou denně se sestavením:

| Zdroj | Obsah | Využití |
| --- | --- | --- |
| TEC GTFS-RT Service Alerts | konkrétní **zrušené spoje** na další dny (ID sedí s jízdním řádem), objížďky, přesunuté zastávky | zrušené spoje vyřadit, zastávku bez spojů **přeškrtnout**, jinak výstražná značka |
| De Lijn GTFS-RT Service Alerts | omezení vázaná na zastávky a linky | výstražná značka a text v kartě |
| STIB Travellers Information (JSON) | práce a omezení na linkách a zastávkách (EN/FR/NL) | výstražná značka a text v kartě |
| SNCB GTFS-RT Service Alerts | jen obecná hlášení bez vazby na stanice | nanejvýš obecné upozornění |

U SNCB je potřeba ověřit, zda plánované výluky už nejsou přímo v jízdním řádu (vlak pak v datech
chybí). Hlášení vyhlášená po 17:00 se projeví až další den – odkaz „Ověřit výluky“ zůstává.

### 7.2 Česko (fáze 3 původního zadání)
- Kraje vydávají GTFS samostatně (např. PID jen na 14 dní dopředu); celostátní JDF nemá souřadnice.
- Prakticky: GTFS přečištěné Transitous nebo projekt JrUtil; pipeline umí libovolný počet feedů.
- Potřeba: zdroje do `feeds.yaml`, výchozí výřez mapy podle země, ověřit velikost dat.

### 7.3 Menší vylepšení
- Celý seznam zastávek spoje po rozbalení (načítat až po klepnutí, podobně jako trasy linek).
- Překlady názvů zastávek (`translations.txt`) podle jazyka aplikace.
- Filtrovat seznam linek podle druhu dopravy nebo dopravce.
- Odkaz „Ověřit výluky“ přímo na stránku linky, kde ji dopravce má.
- Lighthouse a přístupnost (kontrast barev legendy, čtečky obrazovky).
- Zrychlení pipeline (dnes ~4 min): paralelní zpracování feedů.

### 7.4 Co se zatím nedoporučuje
- Živé polohy vozidel, zpoždění a čekací doby – smysl dávají jen živě, aplikace sestavuje 1× denně.
- NeTEx – stejná data jako GTFS v jiném formátu, nic navíc.
- Vlastní server – zbytečný, statické dlaždice stačí a jsou zdarma.

## 8. Historie (pull requesty)

| PR | Obsah |
| --- | --- |
| #1 | pipeline, PWA, denní sestavení, testy |
| #2 | opravy zdrojů, nasazení jen z `main` |
| #3 | přeskakování zastaralých feedů |
| #4 | přepínač vzhledu |
| #5 | data ze všech 4 dopravců z Belgian Mobility, slučování linek |
| #6 | mobilní rozložení, karta pod mapou, „1./2. čas“, název „Co pojede?“ |
| #7 | úsporné a sbalitelné nastavení, trasa linky, klíč `BMC_API_KEY` |
| #8 | tmavý lem trasy linky |
| #9 | příjezdy/odjezdy u každého času, rozbalení spoje, formát dat v2 |
| #10 | špendlík, výřez mapy, ✕ zrušit vše, 14 dní dat, tento dokument |
| #11 | hledání obcí v mapě (GeoNames) |
