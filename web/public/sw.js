// Service worker: aplikace a navštívené dlaždice offline.
// - app-*: HTML, JS, CSS (síť napřed u navigace, jinak cache napřed)
// - data: dlaždice a linky; při novém sestavení (jiné manifest.build) se zahodí
// - map: mapové podklady OpenFreeMap (stale-while-revalidate, omezený počet)
const VERSION = 'v1';
const APP = `app-${VERSION}`;
const DATA = 'data';
const MAP = 'map';
const MAP_MAX = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(['./', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('app-') && k !== APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req, cacheName, cacheKey = req) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(cacheKey, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function manifestRequest(req) {
  const cache = await caches.open(DATA);
  const key = new URL('data/manifest.json', self.registration.scope).href;
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) {
      const fresh = await res.clone().json();
      const old = await cache.match(key);
      const oldBuild = old ? (await old.json()).build : null;
      if (oldBuild && oldBuild !== fresh.build) {
        await caches.delete(DATA); // nové sestavení: staré dlaždice pryč
      }
      await (await caches.open(DATA)).put(key, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(networkFirst(req, APP, new URL('./', self.registration.scope).href));
    } else if (url.pathname.endsWith('/data/manifest.json')) {
      e.respondWith(manifestRequest(req));
    } else if (url.pathname.includes('/data/')) {
      e.respondWith(cacheFirst(req, DATA));
    } else if (url.pathname.endsWith('sw.js')) {
      // nech prohlížeč řešit aktualizaci SW
    } else {
      e.respondWith(cacheFirst(req, APP));
    }
    return;
  }

  if (url.hostname === 'tiles.openfreemap.org') {
    e.respondWith((async () => {
      const cache = await caches.open(MAP);
      const hit = await cache.match(req);
      const net = fetch(req).then(async (res) => {
        if (res.ok) {
          await cache.put(req, res.clone());
          trim(MAP, MAP_MAX);
        }
        return res;
      });
      if (hit) {
        e.waitUntil(net.catch(() => {}));
        return hit;
      }
      return net;
    })());
  }
});
