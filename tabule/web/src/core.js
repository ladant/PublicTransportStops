// Výpočty bez DOM: nejbližší uzly, hledání, seskupení odjezdů, odpočet. Testy: tests/core.test.js

export function distance(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// k nejbližších uzlů k bodu, každý s .dist v metrech.
export function nearestNodes(nodes, lat, lon, k = 4) {
  const best = [];
  for (const node of nodes) {
    const dist = distance(lat, lon, node.lat, node.lon);
    if (best.length < k || dist < best[best.length - 1].dist) {
      best.push({ node, dist });
      best.sort((a, b) => a.dist - b.dist);
      if (best.length > k) best.pop();
    }
  }
  return best;
}

export function normalize(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Hledání uzlu podle názvu bez ohledu na diakritiku; začátek názvu má přednost před slovem uvnitř.
export function searchNodes(nodes, query, limit = 12) {
  const q = normalize(query);
  if (!q) return [];
  const hits = [];
  for (const node of nodes) {
    const key = node._key ??= normalize(`${node.n} ${node.m ?? ''}`);
    const rank = key.startsWith(q) ? 0 : key.includes(` ${q}`) ? 1 : key.includes(q) ? 2 : -1;
    if (rank >= 0) hits.push({ node, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.node.n.length - b.node.n.length || a.node.n.localeCompare(b.node.n, 'cs'));
  return hits.slice(0, limit).map((h) => h.node);
}

export const stopKey = (stop) => stop.g[0];
export const lineKey = (stop, line) => `${stopKey(stop)}|${line}`;
export const depTime = (d) => Date.parse(d.predicted ?? d.scheduled);

// Odjezdy uzlu rozdělené po sloupcích (směrech). Oblíbené směry a v nich oblíbené linky jdou nahoru.
// favs = { stops: Set<stopKey>, lines: Set<lineKey> }
export function groupDepartures(node, departures, favs, { now = Date.now(), onlyFavs = false, perStop = 6 } = {}) {
  const byId = new Map();
  node.s.forEach((stop) => stop.g.forEach((id) => byId.set(id, stop)));
  const groups = new Map(node.s.map((stop) => [stop, []]));
  for (const d of departures) {
    const stop = byId.get(d.stop);
    if (!stop) continue;
    const t = depTime(d);
    if (!(t >= now - 30_000)) continue; // už odjel
    groups.get(stop).push({ ...d, t, favLine: favs.lines.has(lineKey(stop, d.line)) });
  }
  const out = [];
  for (const [stop, rows] of groups) {
    const fav = favs.stops.has(stopKey(stop));
    const favRows = rows.filter((r) => r.favLine);
    if (onlyFavs && !fav && !favRows.length) continue;
    const shown = onlyFavs && !fav ? favRows : rows;
    shown.sort((a, b) => b.favLine - a.favLine || a.t - b.t);
    const fl = shown.filter((r) => r.favLine);
    const rest = shown.filter((r) => !r.favLine).slice(0, Math.max(perStop - fl.length, 2));
    out.push({ stop, fav, hasFavLine: favRows.length > 0, rows: [...fl, ...rest] });
  }
  out.sort((a, b) => (b.fav || b.hasFavLine) - (a.fav || a.hasFavLine)
    || (a.rows.length ? 0 : 1) - (b.rows.length ? 0 : 1)
    || (a.rows[0]?.t ?? Infinity) - (b.rows[0]?.t ?? Infinity));
  return out;
}

// "teď", "za 3 min", "za 1 h 5 min"
export function countdown(t, now = Date.now()) {
  const min = Math.floor((t - now) / 60_000);
  if (min < 1) return 'teď';
  if (min < 60) return `za ${min} min`;
  return `za ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

export function age(at, now = Date.now()) {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'právě teď';
  if (min < 60) return `před ${min} min`;
  return `před ${Math.floor(min / 60)} h`;
}

export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export const clock = (t) => new Date(t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' });

// ID sloupků uzlu po dávkách, které proxy přijme.
export function stopBatches(node, max = 30) {
  const ids = [...new Set(node.s.flatMap((s) => s.g))];
  const out = [];
  for (let i = 0; i < ids.length; i += max) out.push(ids.slice(i, i + max));
  return out;
}
