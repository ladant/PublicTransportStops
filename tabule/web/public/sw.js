// Offline: aplikace a seznam zastávek z cache, odjezdy vždy ze sítě (aplikace si poslední ukládá sama).
const CACHE = 'tabule-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'manifest.webmanifest', 'icons/icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/v1/')) return;

  const save = (res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  };

  // Stránka: síť, při výpadku cache.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(save).catch(() => caches.match(e.request).then((r) => r ?? caches.match('./'))));
    return;
  }

  // Seznam zastávek (~0,3 MB gzip): hned z cache, na pozadí se stáhne novější pro příští otevření.
  if (url.pathname.endsWith('.json')) {
    const network = fetch(e.request).then(save);
    e.waitUntil(network.catch(() => {}));
    e.respondWith(caches.match(e.request).then((hit) => hit ?? network));
    return;
  }

  // Soubory s hashem v názvu se nemění: cache, jinak síť.
  e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request).then(save)));
});
