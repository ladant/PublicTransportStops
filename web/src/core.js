// Čistá logika bez DOM: dlaždice, kalendáře, výběr zastávek a linek.
// Formát dat popisuje docs/data-format.md.

export const MODE = { TRAM: 0, METRO: 1, RAIL: 2, BUS: 3, FERRY: 4, OTHER: 5 };

/** Skupina filtru "druh dopravy" pro route mode. */
export function modeGroup(mode) {
  if (mode === MODE.RAIL) return 'rail';
  if (mode === MODE.TRAM || mode === MODE.METRO) return 'tram';
  return 'bus';
}

export const DAY = 1440;

export function cell(v, step) {
  return Math.floor(Number((v / step).toFixed(9)));
}

/** [jih, západ, sever, východ] pro klíč dlaždice 'y_x' nebo 'y_x_q…'. */
export function tileBbox(key, grid) {
  const [dlat, dlon] = grid;
  const p = key.split('_').map(Number);
  let s = p[0] * dlat, w = p[1] * dlon, h = dlat, wd = dlon;
  for (const q of p.slice(2)) {
    h /= 2; wd /= 2;
    if (q >= 2) s += h;
    if (q % 2 === 1) w += wd;
  }
  return [s, w, s + h, w + wd];
}

/** Ohraničení kruhu (lat, lon, poloměr v km) ve stupních. */
export function circleBbox(lat, lon, rKm) {
  const dlat = rKm / 110.574;
  const dlon = rKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lat - dlat, lon - dlon, lat + dlat, lon + dlon];
}

export function tilesForCircle(manifest, lat, lon, rKm) {
  const [s, w, n, e] = circleBbox(lat, lon, rKm);
  return manifest.tiles.filter((k) => {
    const [ts, tw, tn, te] = tileBbox(k, manifest.grid);
    return ts <= n && tn >= s && tw <= e && te >= w;
  });
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function decodeMask(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function runsOn(mask, day) {
  if (day < 0) return false;
  const byte = day >> 3;
  return byte < mask.length && (mask[byte] & (1 << (day & 7))) !== 0;
}

/** Převede surový JSON dlaždice na pole zastávek s dekódovanými maskami. */
export function parseTile(t) {
  const masks = t.c.map(decodeMask);
  return t.s.map((s, i) => ({
    id: s[0], name: s[1], lat: s[2], lon: s[3], modes: s[4],
    deps: t.d[i], heads: t.h, masks,
  }));
}

/** Datum ISO -> číslo dne od data `start` z manifestu. */
export function dayIndex(startIso, dateIso) {
  const a = Date.UTC(...isoParts(startIso));
  const b = Date.UTC(...isoParts(dateIso));
  return Math.round((b - a) / 86400000);
}

function isoParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

export function addDays(iso, n) {
  const t = new Date(Date.UTC(...isoParts(iso)) + n * 86400000);
  return t.toISOString().slice(0, 10);
}

/** Rozsah dat, která lze vybrat: den po `start` až konec masky. */
export function dateRange(manifest) {
  return { min: addDays(manifest.start, 1), max: addDays(manifest.start, manifest.days - 1) };
}

/** 'HH:MM' -> minuty */
export function parseHm(s) {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s || '');
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v <= DAY ? v : null;
}

export function fmtHm(min) {
  const t = ((min % DAY) + DAY) % DAY;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * Normalizované okno [od, do] v minutách od půlnoci zvoleného dne.
 * Když je `do` < `od`, okno přechází přes půlnoc (do = do + 1440).
 */
export function normWindow(w) {
  if (!w) return null;
  let [a, b] = w;
  if (a == null || b == null) return null;
  if (b < a) b += DAY;
  return [a, b];
}

// pole jedné události v dlaždici (docs/data-format.md)
const EV = 9; // m, a, r, h, o, c, f, s, e

/**
 * Odjezdy (kind 'dep': lze nastoupit, čas odjezdu, cíl) nebo příjezdy (kind 'arr': lze vystoupit,
 * čas příjezdu, výchozí zastávka) zastávky ve zvoleném dni a okně.
 * Událost s minutou m služebního dne s je v čase m + (s - D) * 1440 vůči půlnoci dne D.
 * Vrací [{t, r, h (cíl), o (výchozí), arr, dep, t0 (odjezd z výchozí), t1 (příjezd do cíle)}].
 */
export function stopDepartures(stop, day, win, routes, modes, kind = 'dep') {
  const out = [];
  const d = stop.deps;
  const need = kind === 'arr' ? 2 : 1;
  for (let i = 0; i < d.length; i += EV) {
    if (!(d[i + 6] & need)) continue;
    const r = d[i + 2];
    if (modes && !modes.has(modeGroup(routes[r][2]))) continue;
    const m = d[i];
    const arr = m - d[i + 1];
    const base = kind === 'arr' ? arr : m;
    const mask = stop.masks[d[i + 5]];
    // služební den D + j, j = -2 … 1 (minuty GTFS mohou přesáhnout 48:00 jen výjimečně)
    for (let j = -2; j <= 1; j++) {
      const t = base + j * DAY;
      if (t < win[0] || t > win[1]) continue;
      if (!runsOn(mask, day + j)) continue;
      const sh = j * DAY;
      out.push({
        t, r, h: stop.heads[d[i + 3]], o: stop.heads[d[i + 4]], kind,
        arr: arr + sh, dep: m + sh, t0: m - d[i + 7] + sh, t1: m + d[i + 8] + sh,
      });
    }
  }
  out.sort((x, y) => x.t - y.t || x.r - y.r);
  return out;
}

export function computeSelection(stops, routes, params) {
  const winA = normWindow(params.a);
  const winB = normWindow(params.b);
  const res = [];
  const lines = new Map();
  for (const s of stops) {
    const dist = haversineKm(params.lat, params.lon, s.lat, s.lon);
    if (dist > params.r) continue;
    const depsA = winA ? stopDepartures(s, params.day, winA, routes, params.modes, params.ak || 'dep') : [];
    const depsB = winB ? stopDepartures(s, params.day, winB, routes, params.modes, params.bk || 'dep') : [];
    if (!depsA.length && !depsB.length) continue;
    const state = depsA.length && depsB.length ? 'ab' : depsA.length ? 'a' : 'b';
    let rail = false;
    for (const x of depsA.concat(depsB)) if (routes[x.r][2] === MODE.RAIL) { rail = true; break; }
    const item = { ...s, dist, depsA, depsB, state, rail };
    res.push(item);
    for (const [list, key] of [[depsA, 'nA'], [depsB, 'nB']]) {
      for (const x of list) {
        // linky se stejným číslem, druhem a dopravcem (např. více tras „IC“ u SNCB) = jedna položka
        const rt = routes[x.r];
        const k = `${rt[6]}|${rt[2]}|${rt[0]}`;
        let l = lines.get(k);
        if (!l) {
          l = { k, r: x.r, rs: new Set(), route: rt, nA: 0, nB: 0, heads: new Set(), stops: new Map() };
          lines.set(k, l);
        }
        l[key]++;
        l.rs.add(x.r);
        if (x.h) l.heads.add(x.h);
        l.stops.set(s.id, s.name);
      }
    }
  }
  res.sort((x, y) => x.dist - y.dist);
  const lineList = [...lines.values()].sort(compareLines);
  return { stops: res, lines: lineList };
}

const MODE_ORDER = { [MODE.RAIL]: 0, [MODE.METRO]: 1, [MODE.TRAM]: 2, [MODE.BUS]: 3, [MODE.FERRY]: 4, [MODE.OTHER]: 5 };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareLines(a, b) {
  return (MODE_ORDER[a.route[2]] - MODE_ORDER[b.route[2]])
    || collator.compare(a.route[6], b.route[6])
    || collator.compare(a.route[0], b.route[0])
    || a.r - b.r;  // r = první index linky ve skupině
}

/** Dopravci (feedy), pro které zvolený den leží mimo platnost dat. */
export function feedsOutOfRange(manifest, dateIso) {
  return manifest.feeds.filter((f) => (f.from && dateIso < f.from) || (f.to && dateIso > f.to));
}

// ---- trasy linek

/** Google encoded polyline (přesnost 1e-5) -> [[lat, lon], ...] */
export function decodePolyline(s) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    const v = [0, 0];
    for (let k = 0; k < 2; k++) {
      let shift = 0, res = 0, b;
      do {
        b = s.charCodeAt(i++) - 63;
        res |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      v[k] = res & 1 ? ~(res >> 1) : res >> 1;
    }
    lat += v[0];
    lon += v[1];
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}

/** Varianta trasy vede přes okruh (aspoň jeden bod uvnitř). */
export function passesCircle(pts, lat, lon, rKm) {
  return pts.some(([a, b]) => haversineKm(lat, lon, a, b) <= rKm);
}

// ---- stav v URL (#lat=…&lon=…&r=…&d=…&a=0800-1100&b=…&m=bus,rail)

const ALL_MODES = ['bus', 'rail', 'tram'];

export function encodeState(st) {
  const p = new URLSearchParams();
  if (st.lat != null) {
    p.set('lat', st.lat.toFixed(5));
    p.set('lon', st.lon.toFixed(5));
  }
  p.set('r', String(st.r));
  if (st.d) p.set('d', st.d);
  const w = (x) => `${fmtHm(x[0]).replace(':', '')}-${fmtHm(x[1]).replace(':', '')}`;
  p.set('a', st.a ? w(st.a) : 'off');
  if (st.b) p.set('b', w(st.b));
  if (st.ak) p.set('ak', st.ak);
  if (st.bk) p.set('bk', st.bk);
  if (st.modes && st.modes.size !== ALL_MODES.length) p.set('m', ALL_MODES.filter((m) => st.modes.has(m)).join(','));
  return p.toString();
}

export function decodeState(hash, defaults) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const st = { ...defaults, modes: new Set(defaults.modes) };
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  if (p.has('lat') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    st.lat = lat;
    st.lon = lon;
  }
  const r = Number(p.get('r'));
  if (Number.isFinite(r) && r >= 0.5 && r <= 15) st.r = r;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get('d') || '')) st.d = p.get('d');
  const win = (s) => {
    const m = /^(\d{4})-(\d{4})$/.exec(s || '');
    if (!m) return null;
    const a = parseHm(m[1]);
    const b = parseHm(m[2]);
    return a == null || b == null ? null : [a, b];
  };
  if (p.get('a') === 'off') st.a = null;
  else if (p.has('a') && win(p.get('a'))) st.a = win(p.get('a'));
  if (p.has('b')) st.b = win(p.get('b'));
  for (const k of ['ak', 'bk']) if (['arr', 'dep'].includes(p.get(k))) st[k] = p.get(k);
  if (p.has('m')) {
    const ms = p.get('m').split(',').filter((x) => ALL_MODES.includes(x));
    if (ms.length) st.modes = new Set(ms);
  }
  return st;
}
