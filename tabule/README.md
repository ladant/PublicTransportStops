# Odjezdy MHD (tabule)

PWA, která po otevření ukáže odjezdy z nejbližšího zastávkového uzlu a odpočet do odjezdu.
Návrh a rozsah: dokument „MHD tabule odjezdů – návrh v1“. Pilot je Praha (PID), Belgie přijde později.
Se zbytkem repozitáře („Co pojede?“) nesdílí kód ani nasazení.

```
telefon (PWA)  ──/v1/departures──►  proxy (serverless, cache 30 s)  ──►  Golemio API (PID)
     │                                 jediné místo s API klíči           později STIB, De Lijn, TEC…
     └── data/stops-pid.json (uzly a sloupky, 0,3 MB gzip, z data.pid.cz)
```

| Cesta | Obsah |
| --- | --- |
| `proxy/handler.js` | obecný fetch handler: `/v1/departures`, `/v1/health`, validace, CORS |
| `proxy/cache.js` | sdílená cache (TTL 30 s), jedno volání dopravce pro souběžné dotazy, při chybě starší data do 5 min |
| `proxy/format.js` | sjednocený formát odjezdů pro všechny dopravce |
| `proxy/adapters/pid.js` | Praha přes Golemio `/v2/pid/departureboards` |
| `proxy/adapters/mock.js` | vymyšlené odjezdy pro vývoj bez klíče |
| `proxy/worker.js`, `wrangler.toml` | nasazení na Cloudflare Workers: všechny dotazy jdou do jedné instance (Durable Object), takže cache sdílí všechny telefony |
| `proxy/dev-server.js` | lokální proxy na Node |
| `scripts/build-stops.mjs` | seznam zastávek PID → `web/public/data/stops-pid.json` |
| `web/src/core.js` | výpočty bez DOM: nejbližší uzly, hledání, seskupení po směrech, oblíbené, odpočet |
| `web/src/store.js` | co se ukládá v telefonu (oblíbené, poloha, poslední odjezdy) |
| `web/src/main.js` | obrazovka, přepínání swipem/šipkami, obnovení 25 s při otevřené aplikaci |
| `web/public/sw.js` | offline: aplikace a zastávky z cache, odjezdy vždy ze sítě |

## Zátěž Golemia

Golemio se neptá každý telefon. Proxy drží odjezdy 30 s a souběžné dotazy na stejný uzel spojí,
takže na Golemio jdou nejvýš 2 dotazy za minutu na uzel, který má někdo právě otevřený – ať ho
sleduje jeden člověk nebo tisíc. Zátěž tedy roste s počtem různých sledovaných zastávek, ne s počtem
telefonů. Na Cloudflare to zajišťuje jedna globální instance proxy (Durable Object); Cache API by
sdílelo jen v rámci datacentra a na `*.workers.dev` nefunguje vůbec.

Kdyby uživatelů byly stovky a rozptýlených zastávek moc, další krok je celosíťový feed:
proxy jednou za 20–30 s stáhne GTFS Realtime celé PID a odjezdy spočítá sama z jízdního řádu
(~3 dotazy za minutu bez ohledu na počet uživatelů, formát pro telefon se nemění).

Limity bezplatného Cloudflare: 100 000 dotazů denně na Worker i na Durable Object, tj. zhruba
20 000 otevření aplikace na pár minut.

## Vývoj

```bash
cd tabule
npm install
npm run stops        # stáhne zastávky PID (data.pid.cz)
npm run dev:proxy    # proxy na :8787; bez GOLEMIO_API_KEY s vymyšlenými daty
npm run dev          # aplikace na :5173, /v1 jde na proxy
npm test
```

Se skutečnými daty: `GOLEMIO_API_KEY=… npm run dev:proxy` (klíč zdarma po registraci na api.golemio.cz).

## Nasazení (zatím neproběhlo)

1. Proxy: `cd tabule/proxy && npx wrangler deploy` (lokálně `npx wrangler dev --var MOCK:1`), klíč `npx wrangler secret put GOLEMIO_API_KEY`,
   v `wrangler.toml` zúžit `ALLOWED_ORIGIN` na origin aplikace.
2. Aplikace: `VITE_API_BASE=https://<proxy>.workers.dev npm run stops && npm run build` → statický `dist/`
   (relativní cesty, funguje i v podsložce GitHub Pages).

## Hotovo v základu

- nejbližší uzel podle GPS, 2.–4. nejbližší šipkami / swipem / tečkami
- hlavička: název uzlu, vzdálenost, čas aktualizace, ruční obnovení
- místo = přestupní uzel PID se všemi sloupky (nástupišti); uzel s víc názvy (Pražské Jezulátko / Tyršův dům,
  Václavské náměstí / Můstek) je jedno místo, v záhlaví je název části, ke které jsi nejblíž
- odjezdy po sloupcích (směrech); jeden řádek na linku a cíl s třemi nejbližšími časy
  (`3 min · 11 · 19`), živě (●) vs. podle řádu (kurzíva), zpoždění
- oblíbené platí jen pro konkrétní sloupek: hvězdička u linky = „tahle linka z tohoto nástupiště“
  (nepřenáší se na jiný sloupek ani jinou zastávku, výluková varianta se stejným číslem se chytí);
  hvězdička v záhlaví sloupku = všechny linky z něj
- sloupky s oblíbenými jsou nahoře, ostatní sbalené do jednoho řádku s nejbližšími odjezdy (klepnutím
  se rozbalí); uzel bez oblíbených je rozbalený; „Jen oblíbené“ skryje zbytek
- bez sítě poslední data s časem; zakázaná poloha → hledání zastávky; prázdný stav „nic neodjíždí“
- poslední poloha a zastávka se ukáže hned při otevření, GPS ji pak upřesní

## Další kroky

- klíč Golemio, ověřit skutečný tvar odpovědi a limity (adaptér je napsaný podle dokumentace, netestovaný naživo)
- nasadit proxy a aplikaci, test na iPhonu a Androidu (poloha, ukládání, návrat do aplikace)
- denní obnova `stops-pid.json` v CI
- při stovkách uživatelů: celosíťový GTFS Realtime feed místo dotazů po zastávkách (viz Zátěž Golemia)
- Belgie: adaptéry za stejným formátem (`region=be`), seznam zastávek z GTFS
