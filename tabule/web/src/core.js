// Výpočty bez DOM: nejbližší uzly, hledání, seskupení odjezdů, odpočet. Testy: tests/core.test.js

export function distance(aLat, aLon, bLat, bLon) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Vzdálenost k uzlu a název v záhlaví: uzel s víc názvy se měří k nejbližší z jeho částí (node.x).
export function nodeNearest(node, lat, lon) {
  if (!node.x) return { dist: distance(lat, lon, node.lat, node.lon), name: node.n };
  let best = null;
  for (const [a, b, name] of node.x) {
    const dist = distance(lat, lon, a, b);
    if (!best || dist < best.dist) best = { dist, name };
  }
  return best;
}

// k nejbližších uzlů k bodu: [{ node, dist, name }], name = název nejbližší části uzlu.
export function nearestNodes(nodes, lat, lon, k = 4) {
  const best = [];
  for (const node of nodes) {
    const { dist, name } = nodeNearest(node, lat, lon);
    if (best.length < k || dist < best[best.length - 1].dist) {
      best.push({ node, dist, name });
      best.sort((a, b) => a.dist - b.dist);
      if (best.length > k) best.pop();
    }
  }
  return best;
}

// Upřesnění sloupku pod názvem v záhlaví: "Anděl (ul. Plzeňská)" pod "Anděl" -> "ul. Plzeňská",
// jiný název (Tyršův dům pod Pražským Jezulátkem) zůstane celý, stejný název nic.
export function subLabel(label, title) {
  if (!label || label === title) return '';
  if (label.startsWith(title)) return label.slice(title.length).trim().replace(/^\(|\)$/g, '');
  return label;
}

export function normalize(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Hledání podle názvu bez ohledu na diakritiku; začátek názvu má přednost před slovem uvnitř.
// Uzel s víc názvy se hledá po částech: "Václavské náměstí" najde část uzlu Můstek a vrátí její
// souřadnice, takže se špendlík zapíchne tam a v záhlaví zůstane hledaný název.
// Výsledek: [{ node, name, lat, lon }]
export function searchNodes(nodes, query, limit = 12) {
  const q = normalize(query);
  if (!q) return [];
  const hits = [];
  for (const node of nodes) {
    node._parts ??= (node.x ?? [[node.lat, node.lon, node.n]]).map(([lat, lon, name]) => ({ lat, lon, name, key: normalize(`${name} ${node.m ?? ''}`) }));
    let best = null;
    for (const part of node._parts) {
      const rank = part.key.startsWith(q) ? 0 : part.key.includes(` ${q}`) ? 1 : part.key.includes(q) ? 2 : -1;
      if (rank >= 0 && (!best || rank < best.rank)) best = { rank, part };
    }
    if (best) hits.push({ node, name: best.part.name, lat: best.part.lat, lon: best.part.lon, rank: best.rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name, 'cs'));
  return hits.slice(0, limit).map(({ rank, ...h }) => h);
}

export const stopKey = (stop) => stop.g[0];
export const lineKey = (stop, line) => `${stopKey(stop)}|${line}`;
export const depTime = (d) => Date.parse(d.predicted ?? d.scheduled);

// Oblíbené platí jen pro konkrétní sloupek (zastávku v daném směru), nikdy pro celý uzel ani celou linku:
// favs.stops = Set<stopKey> (všechny linky ve sloupku), favs.lines = Set<lineKey> (linka v tomto sloupku).
export function nodeHasFavs(node, favs) {
  return node.s.some((stop) => favs.stops.has(stopKey(stop)) || [...favs.lines].some((k) => k.startsWith(`${stopKey(stop)}|`)));
}

const TIMES = 3; // časů na řádek: víc by na úzkém displeji ořezávalo název cíle
const ROWS_LIMIT = 5; // řádků ve sloupku, který není oblíbený, než se zbytek sbalí

// Spojí odjezdy stejné linky a cíle do jednoho řádku s několika nejbližšími časy.
function mergeRows(deps, stop, favs, now) {
  const rows = new Map();
  for (const d of deps) {
    const t = depTime(d);
    if (!(t >= now - 30_000)) continue; // už odjel
    const key = `${d.line}|${d.headsign}`;
    let row = rows.get(key);
    if (!row) {
      row = { line: d.line, type: d.type, headsign: d.headsign, night: d.night, favLine: favs.lines.has(lineKey(stop, d.line)), times: [] };
      rows.set(key, row);
    }
    row.times.push({ t, realtime: d.realtime, delay: d.delay, canceled: d.canceled });
  }
  const out = [...rows.values()];
  for (const row of out) {
    row.times.sort((a, b) => a.t - b.t);
    row.times = row.times.slice(0, TIMES);
    row.t = row.times[0].t;
  }
  return out.sort((a, b) => b.favLine - a.favLine || a.t - b.t);
}

// Odjezdy uzlu po sloupcích (směrech), hotové k vykreslení. Každá skupina má režim:
//   full      všechny linky (oblíbený sloupek, nebo uzel bez oblíbených)
//   favs      jen oblíbené linky, zbytek je `more` řádků pod tlačítkem
//   collapsed sloupek bez oblíbených v uzlu, kde oblíbené jsou: jen `summary` nejbližších odjezdů
// `expanded` = Set<stopKey>, které uživatel rozbalil (platí jen v této relaci).
export function groupDepartures(node, departures, favs, { now = Date.now(), onlyFavs = false, expanded = new Set() } = {}) {
  const byId = new Map();
  node.s.forEach((stop) => stop.g.forEach((id) => byId.set(id, stop)));
  const deps = new Map(node.s.map((stop) => [stop, []]));
  for (const d of departures) byId.has(d.stop) && deps.get(byId.get(d.stop)).push(d);
  const anyFav = nodeHasFavs(node, favs);

  const out = [];
  for (const stop of node.s) {
    const key = stopKey(stop);
    const fav = favs.stops.has(key);
    const rows = mergeRows(deps.get(stop), stop, favs, now);
    const favRows = rows.filter((r) => r.favLine);
    const hasFavLine = [...favs.lines].some((k) => k.startsWith(`${key}|`));
    if (onlyFavs && !fav && !hasFavLine) continue;

    const open = expanded.has(key);
    let mode;
    if (fav || open || (!anyFav && rows.length <= ROWS_LIMIT)) mode = 'full';
    else if (hasFavLine) mode = 'favs';
    else mode = anyFav ? 'collapsed' : 'full';

    let shown = rows;
    if (onlyFavs && !fav) { shown = favRows; mode = 'favs'; }
    else if (mode === 'favs') shown = favRows;
    else if (mode === 'collapsed') shown = [];
    else if (!fav && !open) shown = rows.slice(0, Math.max(ROWS_LIMIT, favRows.length));
    out.push({
      stop, key, fav, hasFavLine, mode, expanded: open,
      rows: shown,
      more: Math.max(0, rows.length - shown.length),
      summary: rows.slice(0, 4),
      empty: rows.length === 0,
      next: (hasFavLine ? favRows[0]?.t : rows[0]?.t) ?? Infinity, // pro řazení
    });
  }
  const isFav = (g) => g.fav || g.hasFavLine;
  out.sort((a, b) => isFav(b) - isFav(a) || (a.next === b.next ? 0 : a.next < b.next ? -1 : 1));
  return out;
}

// Časy jednoho řádku k zobrazení: první "2 min" (nebo hodina odjezdu, když je za víc než hodinu),
// další jen čísla: "9 · 17".
export function formatTimes(times, now = Date.now()) {
  return times.map((x, i) => {
    const min = Math.floor((x.t - now) / 60_000);
    const text = min >= 60 ? clock(x.t) : min < 1 ? 'teď' : i === 0 ? `${min} min` : String(min);
    const late = x.realtime && x.delay >= 60 ? Math.round(x.delay / 60) : 0;
    return { text, live: x.realtime, late, canceled: x.canceled, clock: clock(x.t) };
  });
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
