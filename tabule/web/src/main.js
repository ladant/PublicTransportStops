import './style.css';
import {
  nearestNodes, searchNodes, groupDepartures, countdown, age, formatDistance, clock,
  stopKey, lineKey, stopBatches,
} from './core.js';
import { store } from './store.js';

const API = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const REFRESH_MS = 25_000;
const NEAREST = 4;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const app = {
  nodes: [],
  position: store.position, // { lat, lon, at, manual }
  candidates: [], // [{ node, dist }]
  index: 0,
  data: null, // { nodeId, departures, fetchedAt (ms), live: bool, error }
  loading: false,
  gpsError: null,
};

// ---------- data ----------

async function loadStops() {
  const res = await fetch('data/stops-pid.json');
  if (!res.ok) throw new Error(`zastávky: HTTP ${res.status}`);
  app.nodes = (await res.json()).nodes;
}

function current() {
  return app.candidates[app.index]?.node ?? null;
}

async function refresh() {
  const node = current();
  if (!node || app.loading) return;
  app.loading = true;
  renderStatus();
  try {
    const parts = await Promise.all(stopBatches(node).map(async (ids) => {
      const res = await fetch(`${API}/v1/departures?region=pid&stops=${ids.map(encodeURIComponent).join(',')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }));
    if (current() !== node) return;
    const fetchedAt = Math.min(...parts.map((p) => Date.parse(p.fetchedAt)));
    app.data = { nodeId: node.id, departures: parts.flatMap((p) => p.departures), fetchedAt, live: !parts.some((p) => p.stale) };
    store.saveDepartures(node.id, { departures: app.data.departures, fetchedAt });
  } catch (err) {
    if (current() !== node) return;
    const saved = app.data?.nodeId === node.id ? app.data : store.departures(node.id);
    app.data = { nodeId: node.id, departures: saved?.departures ?? [], fetchedAt: saved?.fetchedAt ?? null, live: false, error: navigator.onLine ? 'error' : 'offline' };
  } finally {
    app.loading = false;
    render();
  }
}

function showNode(i) {
  if (!app.candidates.length) return;
  app.index = (i + app.candidates.length) % app.candidates.length;
  const node = current();
  store.lastNode = node.id;
  const saved = store.departures(node.id);
  app.data = saved ? { nodeId: node.id, ...saved, live: false } : null;
  render();
  refresh();
}

function setPosition(pos, { keepNode = false } = {}) {
  app.position = pos;
  store.position = pos;
  const prev = current();
  app.candidates = nearestNodes(app.nodes, pos.lat, pos.lon, NEAREST);
  const same = keepNode && prev ? app.candidates.findIndex((c) => c.node.id === prev.id) : -1;
  showNode(same >= 0 ? same : 0);
}

function locate() {
  if (!('geolocation' in navigator)) { app.gpsError = 'unsupported'; render(); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      app.gpsError = null;
      const first = !app.position || app.position.manual;
      setPosition({ lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now(), manual: false }, { keepNode: !first });
    },
    (err) => {
      app.gpsError = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
      if (!app.position) openSearch();
      render();
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
  );
}

// ---------- vykreslení ----------

const TYPE_LABEL = { tram: 'Tram', bus: 'Bus', trolleybus: 'Trolejbus', train: 'Vlak', ferry: 'Přívoz', funicular: 'Lanovka', metro: 'Metro' };

function badge(d) {
  const metro = d.type === 'metro' ? ` metro-${esc(d.line)}` : '';
  return `<span class="line t-${esc(d.type)}${metro}${d.night ? ' night' : ''}">${esc(d.line)}</span>`;
}

function stopTitle(stop) {
  const type = stop.t.startsWith('metro') ? 'Metro' : TYPE_LABEL[stop.t] ?? '';
  const plat = stop.p ? ` ${esc(stop.p)}` : '';
  const dirs = stop.d.length ? ` · směr ${stop.d.map(esc).join(', ')}` : '';
  return `${type}${plat}${dirs}`;
}

function renderBoard() {
  const node = current();
  const board = $('board');
  if (!node) {
    board.innerHTML = app.nodes.length
      ? '<p class="empty">Povolte polohu nebo vyhledejte zastávku.</p>'
      : '<p class="empty">Načítám zastávky…</p>';
    return;
  }
  if (!app.data) { board.innerHTML = '<p class="empty">Načítám odjezdy…</p>'; return; }

  const now = Date.now();
  const favs = store.favs();
  const groups = groupDepartures(node, app.data.departures, favs, { now, onlyFavs: store.onlyFavs });
  const withRows = groups.filter((g) => g.rows.length);
  if (!withRows.length && app.data.error && !app.data.fetchedAt) {
    board.innerHTML = `<p class="empty">${app.data.error === 'offline' ? 'Jste offline a pro tuto zastávku nejsou uložená data.' : 'Odjezdy se nepodařilo načíst. Zkusím to znovu za chvíli.'}</p>`;
    return;
  }
  if (!withRows.length) {
    board.innerHTML = store.onlyFavs && groups.length === 0
      ? '<p class="empty">Na této zastávce nemáte oblíbené. Vypněte „Jen oblíbené“ nebo přidejte hvězdičku.</p>'
      : '<p class="empty">V příštích 90 minutách odtud nic neodjíždí.</p>';
    return;
  }
  board.innerHTML = withRows.map((g) => `
    <section class="group${g.fav ? ' fav' : ''}">
      <h2><span>${stopTitle(g.stop)}</span>
        <button class="star${g.fav ? ' on' : ''}" data-fav="stop" data-key="${esc(stopKey(g.stop))}" aria-label="Oblíbený směr" aria-pressed="${g.fav}">${g.fav ? '★' : '☆'}</button>
      </h2>
      <ul>${g.rows.map((d) => `
        <li class="dep${d.favLine ? ' fav' : ''}${d.canceled ? ' canceled' : ''}">
          ${badge(d)}
          <span class="head">${esc(d.headsign)}</span>
          <span class="when${d.realtime ? ' live' : ' plan'}" title="${d.realtime ? 'živě' : 'podle jízdního řádu'}">
            <b>${d.canceled ? 'odřeknuto' : countdown(d.t, now)}</b>
            <small>${clock(d.t)}${d.realtime ? (d.delay >= 60 ? ` <em class="late">+${Math.round(d.delay / 60)}</em>` : '') : ' řád'}</small>
          </span>
          <button class="star${d.favLine ? ' on' : ''}" data-fav="line" data-key="${esc(lineKey(g.stop, d.line))}" aria-label="Oblíbená linka ${esc(d.line)}" aria-pressed="${d.favLine}">${d.favLine ? '★' : '☆'}</button>
        </li>`).join('')}
      </ul>
    </section>`).join('');
}

function renderStatus() {
  const d = app.data;
  let text = '';
  if (app.loading) text = 'aktualizuji…';
  else if (d?.error === 'offline') text = `offline · data ${d.fetchedAt ? `z ${clock(d.fetchedAt)} (${age(d.fetchedAt)})` : 'nejsou'}`;
  else if (d?.error) text = `chyba spojení · data ${d.fetchedAt ? `z ${clock(d.fetchedAt)}` : 'nejsou'}`;
  else if (d?.fetchedAt) text = `aktualizováno ${clock(d.fetchedAt)}`;
  $('status').textContent = text;
  $('status').className = d?.error ? 'warn' : '';
}

function render() {
  const c = app.candidates[app.index];
  $('name').textContent = c ? c.node.n : 'Odjezdy';
  $('meta').textContent = c
    ? [c.node.m, formatDistance(c.dist), app.position?.manual ? 'vybráno ručně' : null].filter(Boolean).join(' · ')
    : '';
  $('prev').disabled = $('next').disabled = app.candidates.length < 2;
  $('dots').innerHTML = app.candidates.map((x, i) =>
    `<button class="dot${i === app.index ? ' on' : ''}" data-i="${i}" aria-label="${i + 1}. nejbližší: ${esc(x.node.n)}"></button>`).join('');
  $('only-favs').setAttribute('aria-pressed', store.onlyFavs);

  const notice = $('notice');
  const gps = { denied: 'Poloha je zakázaná – vyhledejte zastávku ručně.', unavailable: 'Polohu se nepodařilo zjistit.', unsupported: 'Prohlížeč neumí zjistit polohu.' }[app.gpsError];
  notice.hidden = !gps;
  notice.textContent = gps ?? '';

  renderBoard();
  renderStatus();
}

// ---------- hledání ----------

function openSearch(open = true) {
  $('search').hidden = !open;
  $('search-btn').setAttribute('aria-expanded', open);
  if (open) $('q').focus();
}

$('q').addEventListener('input', () => {
  const hits = searchNodes(app.nodes, $('q').value);
  $('results').innerHTML = hits.map((n) =>
    `<li><button data-node="${n.id}">${esc(n.n)}${n.m ? ` <small>${esc(n.m)}</small>` : ''}</button></li>`).join('');
});
$('q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('results').querySelector('button')?.click();
});
$('results').addEventListener('click', (e) => {
  const id = Number(e.target.closest('[data-node]')?.dataset.node);
  const node = app.nodes.find((n) => n.id === id);
  if (!node) return;
  openSearch(false);
  $('q').value = '';
  $('results').innerHTML = '';
  setPosition({ lat: node.lat, lon: node.lon, at: Date.now(), manual: true });
});

// ---------- ovládání ----------

$('search-btn').addEventListener('click', () => openSearch($('search').hidden));
$('locate').addEventListener('click', locate);
$('reload').addEventListener('click', refresh);
$('prev').addEventListener('click', () => showNode(app.index - 1));
$('next').addEventListener('click', () => showNode(app.index + 1));
$('only-favs').addEventListener('click', () => { store.onlyFavs = !store.onlyFavs; render(); });
$('dots').addEventListener('click', (e) => {
  const i = e.target.closest('[data-i]')?.dataset.i;
  if (i !== undefined) showNode(Number(i));
});
$('board').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fav]');
  if (!b) return;
  store.toggleFav(b.dataset.fav, b.dataset.key);
  renderBoard();
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if (e.key === 'ArrowLeft') showNode(app.index - 1);
  if (e.key === 'ArrowRight') showNode(app.index + 1);
});

// Swipe vlevo/vpravo přepíná zastávky.
let touch = null;
$('board').addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
$('board').addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) showNode(app.index + (dx < 0 ? 1 : -1));
});

// Obnovení jen při otevřené aplikaci; po návratu hned obnovit a znovu zjistit polohu.
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
setInterval(() => { if (document.visibilityState === 'visible') { renderBoard(); renderStatus(); } }, 10_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (app.position && !app.position.manual) locate();
  refresh();
});
window.addEventListener('online', refresh);

// ---------- start ----------

(async () => {
  render();
  try {
    await loadStops();
  } catch {
    $('board').innerHTML = '<p class="empty">Seznam zastávek se nepodařilo načíst. Zkontrolujte připojení.</p>';
    return;
  }
  if (app.position) {
    // Hned ukázat poslední známé místo, GPS ho pak upřesní.
    app.candidates = nearestNodes(app.nodes, app.position.lat, app.position.lon, NEAREST);
    const last = app.candidates.findIndex((c) => c.node.id === store.lastNode);
    showNode(Math.max(last, 0));
  } else {
    render();
  }
  if (!app.position?.manual) locate();
})();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
