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
| `proxy/worker.js`, `wrangler.toml` | nasazení na Cloudflare Workers |
| `proxy/dev-server.js` | lokální proxy na Node |
| `scripts/build-stops.mjs` | seznam zastávek PID → `web/public/data/stops-pid.json` |
| `web/src/core.js` | výpočty bez DOM: nejbližší uzly, hledání, seskupení po směrech, oblíbené, odpočet |
| `web/src/store.js` | co se ukládá v telefonu (oblíbené, poloha, poslední odjezdy) |
| `web/src/main.js` | obrazovka, přepínání swipem/šipkami, obnovení 25 s při otevřené aplikaci |
| `web/public/sw.js` | offline: aplikace a zastávky z cache, odjezdy vždy ze sítě |

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

1. Proxy: `cd tabule/proxy && npx wrangler deploy`, klíč `npx wrangler secret put GOLEMIO_API_KEY`,
   v `wrangler.toml` zúžit `ALLOWED_ORIGIN` na origin aplikace.
2. Aplikace: `VITE_API_BASE=https://<proxy>.workers.dev npm run stops && npm run build` → statický `dist/`
   (relativní cesty, funguje i v podsložce GitHub Pages).

## Hotovo v základu

- nejbližší uzel podle GPS, 2.–4. nejbližší šipkami / swipem / tečkami
- hlavička: název uzlu, vzdálenost, čas aktualizace, ruční obnovení
- odjezdy po směrech (sloupcích): linka, cíl, odpočet, čas, zpoždění, živě (●) vs. podle řádu
- oblíbené směry a linky ve směru: zvýraznění, řazení nahoru, přepínač „jen oblíbené“
- bez sítě poslední data s časem; zakázaná poloha → hledání zastávky; prázdný stav „nic neodjíždí“
- poslední poloha a zastávka se ukáže hned při otevření, GPS ji pak upřesní

## Další kroky

- klíč Golemio, ověřit skutečný tvar odpovědi a limity (adaptér je napsaný podle dokumentace, netestovaný naživo)
- nasadit proxy a aplikaci, test na iPhonu a Androidu (poloha, ukládání, návrat do aplikace)
- denní obnova `stops-pid.json` v CI
- Belgie: adaptéry za stejným formátem (`region=be`), seznam zastávek z GTFS
