import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {
  buildPlaceIndex, searchPlaces,
  tilesForBbox,
  computeSelection, dateRange, decodePolyline, passesBbox, passesCircle, dayIndex, decodeState, encodeState, feedsOutOfRange, fmtHm,
  parseHm, parseTile, tilesForCircle,
} from './core.js';
import { fmtDate, fmtKm, getLang, setLang, t } from './i18n.js';

maplibregl.setWorkerUrl(workerUrl);

const DATA = 'data/';
const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const COLORS = { a: '#2563eb', b: '#ea580c', ab: '#15803d' };
const MAX_DEPS = 40;
const DEFAULTS = { lat: null, lon: null, r: 3, d: null, a: [480, 660], b: null, ak: 'arr', bk: 'dep', modes: ['bus', 'rail', 'tram'] };
const KIND_ICON = { arr: '↘', dep: '↗' };

const $ = (id) => document.getElementById(id);
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const THEMES = ['auto', 'light', 'dark'];
let theme = 'auto';
try {
  theme = THEMES.includes(localStorage.getItem('theme')) ? localStorage.getItem('theme') : 'auto';
} catch {
  /* soukromé okno */
}

function isDark() {
  return theme === 'dark' || (theme === 'auto' && darkQuery.matches);
}

function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('theme');
  if (btn) {
    btn.textContent = t(`theme_${theme}`);
    btn.title = t('themeTitle');
  }
}

let lastMapDark = null;
let styleFailed = false; // podklad OpenFreeMap se nenačetl -> záložní prázdný styl
function syncMapStyle() {
  if (!map) return;
  const dark = isDark();
  if (dark === lastMapDark) return;
  lastMapDark = dark;
  mapReady = false;
  map.setStyle(styleFailed ? fallbackStyle() : dark ? STYLE_DARK : STYLE_LIGHT);
}

let manifest = null;
let routes = [];
let map = null;
let mapReady = false;
let state = null;
let selection = null;
let highlight = null; // klíč linky (l.k)
let popup = null; // malý štítek vybrané zastávky na mapě
let selectedId = null; // vybraná zastávka (detail pod mapou)
const desktopQuery = window.matchMedia('(min-width: 900px)');
let collapsed = false; // sbalené nastavení nad mapou (jen mobil)
try {
  collapsed = localStorage.getItem('ctlCollapsed') === '1';
} catch {
  /* soukromé okno */
}
let computeSeq = 0;
const tileCache = new Map();

// ---------- pomocné

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clampDate(iso) {
  const { min, max } = dateRange(manifest);
  if (!iso || iso < min) return min;
  if (iso > max) return max;
  return iso;
}

function applyI18n() {
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  $('lang').textContent = t('lang');
  applyTheme();
  if (state) renderKinds();
  renderSummary();
  $('tramChip').title = t('tramTitle');
  $('locate').title = t('myLocation');
  $('q').placeholder = t('searchPlace');
  $('q').setAttribute('aria-label', t('searchPlace'));
  $('reset').title = t('reset');
  $('reset').setAttribute('aria-label', t('reset'));
  $('locate').setAttribute('aria-label', t('myLocation'));
  renderLegend();
  renderFoot();
}

function badge(route) {
  return `<span class="badge" style="background:#${esc(route[3])};color:#${esc(route[4])}">${esc(route[0])}</span>`;
}

function feedOf(stopId) {
  const code = stopId.split(':')[0];
  return manifest.feeds.find((f) => f.code === code);
}

function walkUrl(from, to) {
  // bez výchozího bodu (výřez mapy) vede trasa z aktuální polohy telefonu
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return `https://maps.apple.com/?${from ? `saddr=${from.lat},${from.lon}&` : ''}daddr=${to.lat},${to.lon}&dirflg=w`;
  return `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lon}` : ''}&destination=${to.lat},${to.lon}&travelmode=walking`;
}

// ---------- data

async function loadJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function loadTile(key) {
  let p = tileCache.get(key);
  if (!p) {
    p = fetch(`${DATA}tiles/${key}.json?b=${manifest.build}`)
      .then((r) => {
        if (!r.ok) throw new Error(`tile ${key}: ${r.status}`);
        return r.json();
      })
      .then(parseTile)
      .catch((e) => {
        tileCache.delete(key);
        throw e;
      });
    tileCache.set(key, p);
  }
  return p;
}

// ---------- stav a ovládání

function readWindow(use, from, to) {
  if (!$(use).checked) return null;
  const w = [parseHm($(from).value), parseHm($(to).value)];
  return w[0] != null && w[1] != null ? w : null;
}

function readControls() {
  const modes = new Set([...document.querySelectorAll('input[name=mode]:checked')].map((i) => i.value));
  state.d = clampDate($('date').value);
  state.a = readWindow('useA', 'a1', 'a2');
  state.b = readWindow('useB', 'b1', 'b2');
  state.r = Number($('radius').value);
  state.modes = modes;
}

function markWindows() {
  $('winA').classList.toggle('off', !$('useA').checked);
  $('winB').classList.toggle('off', !$('useB').checked);
}

function writeControls() {
  const { min, max } = dateRange(manifest);
  $('date').min = min;
  $('date').max = max;
  $('date').value = state.d;
  $('useA').checked = !!state.a;
  if (state.a) {
    $('a1').value = fmtHm(state.a[0]);
    $('a2').value = fmtHm(state.a[1]);
  }
  renderKinds();
  $('useB').checked = !!state.b;
  if (state.b) {
    $('b1').value = fmtHm(state.b[0]);
    $('b2').value = fmtHm(state.b[1]);
  }
  markWindows();
  $('radius').value = String(state.r);
  $('rOut').textContent = fmtKm(state.r);
  for (const i of document.querySelectorAll('input[name=mode]')) i.checked = state.modes.has(i.value);
}

function saveState() {
  history.replaceState(null, '', `#${encodeState(state)}`);
}

function renderKinds() {
  for (const w of ['a', 'b']) {
    const btn = $(w === 'a' ? 'kindA' : 'kindB');
    const k = state[`${w}k`];
    btn.textContent = `${KIND_ICON[k]} ${t(`kind_${k}`)}`;
    btn.title = t('kindTitle');
    btn.dataset.kind = k;
  }
}

function toggleKind(w) {
  state[`${w}k`] = state[`${w}k`] === 'arr' ? 'dep' : 'arr';
  renderKinds();
  saveState();
  renderSummary();
  renderLegend();
  recompute();
}

function renderSummary() {
  if (!state) return;
  const day = fmtDate(state.d, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const wins = [[state.a, 'a'], [state.b, 'b']].filter(([w]) => w)
    .map(([w, c]) => `<span class="w"><i class="dot ${c}"></i>${KIND_ICON[state[`${c}k`]]}${winShort(w)}</span>`).join('');
  const modes = state.modes.size === 3 ? '' : ` · ${['bus', 'rail', 'tram'].filter((m) => state.modes.has(m)).map((m) => t(m)).join(', ') || '–'}`;
  $('ctlSummary').innerHTML = collapsed ? `<b>${esc(day)}</b>${wins}<span class="m">${esc(modes)}</span>` : '';
  $('ctlAction').textContent = collapsed ? `${t('edit')} ▾` : `${t('collapse')} ▴`;
}

function setCollapsed(v) {
  collapsed = v;
  try {
    localStorage.setItem('ctlCollapsed', v ? '1' : '0');
  } catch {
    /* soukromé okno */
  }
  $('controls').classList.toggle('collapsed', v);
  $('ctlToggle').setAttribute('aria-expanded', String(!v));
  document.body.classList.toggle('ctl-collapsed', v);
  renderSummary();
  // mapa změnila velikost
  if (map) requestAnimationFrame(() => map.resize());
}

function onControlsChange() {
  readControls();
  markWindows();
  renderSummary();
  renderLegend();
  $('rOut').textContent = fmtKm(state.r);
  saveState();
  drawCircle();
  recompute();
}

// ---------- mapa

function makeIcon(color, square, big) {
  const ratio = 2;
  const size = (big ? 22 : 16) * ratio;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const pad = 2 * ratio;
  g.fillStyle = color;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2 * ratio;
  g.beginPath();
  if (square) {
    const r = 3 * ratio;
    const x = pad, y = pad, w = size - 2 * pad;
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + w, r);
    g.arcTo(x + w, y + w, x, y + w, r);
    g.arcTo(x, y + w, x, y, r);
    g.arcTo(x, y, x + w, y, r);
  } else {
    g.arc(size / 2, size / 2, size / 2 - pad, 0, Math.PI * 2);
  }
  g.closePath();
  g.fill();
  g.stroke();
  if (square) {
    // kolejnice – vodorovné pruhy jako značka nádraží
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5 * ratio;
    g.beginPath();
    g.moveTo(size * 0.3, size * 0.42);
    g.lineTo(size * 0.7, size * 0.42);
    g.moveTo(size * 0.3, size * 0.58);
    g.lineTo(size * 0.7, size * 0.58);
    g.stroke();
  }
  return { image: g.getImageData(0, 0, size, size), ratio };
}

// špendlík vybraného bodu: tvarem i barvou jiný než kulaté barevné zastávky
function makePin(fill, inner) {
  const ratio = 2;
  const w = 20 * ratio, h = 28 * ratio; // menší než dřív, ať nezakrývá okolní zastávky
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const r = w / 2 - 2 * ratio;
  const cx = w / 2, cy = r + 2 * ratio;
  g.beginPath();
  g.moveTo(cx, h - 1 * ratio);
  g.bezierCurveTo(cx - r * 0.35, h - 9 * ratio, cx - r, cy + r * 0.6, cx - r, cy);
  g.arc(cx, cy, r, Math.PI, 0);
  g.bezierCurveTo(cx + r, cy + r * 0.6, cx + r * 0.35, h - 9 * ratio, cx, h - 1 * ratio);
  g.closePath();
  g.fillStyle = fill;
  g.strokeStyle = inner;
  g.lineWidth = 1.5 * ratio;
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
  g.fillStyle = inner;
  g.fill();
  return { image: g.getImageData(0, 0, w, h), ratio };
}

function addIcons() {
  if (!map.hasImage('pin')) {
    const { image, ratio } = isDark() ? makePin('#f9fafb', '#111827') : makePin('#111827', '#ffffff');
    map.addImage('pin', image, { pixelRatio: ratio });
  }
  for (const st of ['a', 'b', 'ab']) {
    for (const rail of [false, true]) {
      const name = `stop-${st}-${rail ? 'rail' : 'bus'}`;
      if (map.hasImage(name)) continue;
      const { image, ratio } = makeIcon(COLORS[st], rail, st === 'ab');
      map.addImage(name, image, { pixelRatio: ratio });
    }
  }
}

function emptyFc() {
  return { type: 'FeatureCollection', features: [] };
}

function circlePolygon(lat, lon, rKm, n = 96) {
  const coords = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dLat = (rKm / 110.574) * Math.sin(a);
    const dLon = (rKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a);
    coords.push([lon + dLon, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

function setupLayers() {
  addIcons();
  const accent = isDark() ? '#5eead4' : '#0f766e';
  map.addSource('circle', { type: 'geojson', data: emptyFc() });
  map.addSource('point', { type: 'geojson', data: emptyFc() });
  map.addSource('stops', { type: 'geojson', data: emptyFc() });
  map.addLayer({ id: 'circle-fill', type: 'fill', source: 'circle', paint: { 'fill-color': accent, 'fill-opacity': 0.07 } });
  map.addLayer({ id: 'circle-line', type: 'line', source: 'circle', paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  map.addSource('route', { type: 'geojson', data: emptyFc() });
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    // tmavý lem odliší trasu od silnic v podkladu (žlutá linka na žluté silnici)
    paint: { 'line-color': isDark() ? '#ffffff' : '#111827', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 10] },
  });
  map.addLayer({
    id: 'route-line', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 5.5] },
  });
  map.addLayer({
    id: 'stops', type: 'symbol', source: 'stops',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'order'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 14, 1.1],
    },
    paint: { 'icon-opacity': ['case', ['get', 'dim'], 0.18, 1] },
  });
  map.addLayer({
    id: 'stop-labels', type: 'symbol', source: 'stops', minzoom: 13,
    filter: ['!', ['get', 'dim']],
    layout: {
      'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top',
      'text-optional': true, 'text-font': ['Noto Sans Regular'],
    },
    paint: {
      'text-color': isDark() ? '#e5e7eb' : '#1f2937',
      'text-halo-color': isDark() ? '#111827' : '#ffffff', 'text-halo-width': 1.5,
    },
  });
  map.addLayer({
    id: 'point', type: 'symbol', source: 'point',
    layout: { 'icon-image': 'pin', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  });
  mapReady = true;
  drawCircle();
  renderStops();
}

const fallbackStyle = () => ({
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': isDark() ? '#1f2937' : '#e5e7eb' } }],
});

function initMap() {
  const v = manifest.view || { center: [4.47, 50.64], zoom: 7.3 };
  const hasPoint = state.lat != null;
  map = new maplibregl.Map({
    container: 'map',
    style: isDark() ? STYLE_DARK : STYLE_LIGHT,
    center: hasPoint ? [state.lon, state.lat] : v.center,
    zoom: hasPoint ? (state.area === 'v' && state.z ? state.z : zoomForRadius(state.r)) : v.zoom,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  map.on('error', (e) => {
    const msg = String(e?.error?.message || '');
    if (!mapReady && !styleFailed && /style|Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      styleFailed = true;
      showNotice(t('mapError'));
      map.setStyle(fallbackStyle());
    }
  });
  map.on('style.load', () => {
    mapReady = false;
    setupLayers();
  });

  map.on('click', (e) => {
    const hit = mapReady && map.queryRenderedFeatures(e.point, { layers: ['stops'] })
      .filter((f) => !f.properties.dim)[0];
    if (hit) selectStop(hit.properties.id);
    else if (state.area !== 'v') setPoint(e.lngLat.lat, e.lngLat.lng);
  });
  // dlouhý stisk na mobilu (contextmenu ho v mobilních prohlížečích nahrazuje)
  map.on('contextmenu', (e) => setPoint(e.lngLat.lat, e.lngLat.lng));
  map.on('moveend', onMapMove);
  map.once('load', () => {
    if (state.area === 'v') recompute();
  });
  map.on('mousemove', (e) => {
    if (!mapReady) return;
    const hit = map.queryRenderedFeatures(e.point, { layers: ['stops'] }).length;
    map.getCanvas().style.cursor = hit ? 'pointer' : 'crosshair';
  });
  lastMapDark = isDark();
  darkQuery.addEventListener('change', syncMapStyle);
}

function zoomForRadius(r) {
  return Math.max(8, Math.min(15, 13.3 - Math.log2(r)));
}

function drawCircle() {
  if (!mapReady) return;
  updateResetButton();
  if (state.lat == null || state.area === 'v') {
    map.getSource('circle').setData(emptyFc());
    map.getSource('point').setData(emptyFc());
    return;
  }
  map.getSource('circle').setData(circlePolygon(state.lat, state.lon, state.r));
  map.getSource('point').setData({
    type: 'Feature', geometry: { type: 'Point', coordinates: [state.lon, state.lat] }, properties: {},
  });
}

function setPoint(lat, lon, fly = false) {
  state.area = 'c';
  renderArea();
  state.lat = lat;
  state.lon = lon;
  highlight = null;
  clearStop();
  saveState();
  drawCircle();
  if (fly) map.flyTo({ center: [lon, lat], zoom: zoomForRadius(state.r) });
  recompute();
}

// ---------- oblast: okruh kolem bodu, nebo výřez mapy

const MAX_VIEW_DEG = 0.3; // větší výřez (~30 km) se nepočítá, stahovalo by se moc dat

function viewBbox() {
  const b = map.getBounds();
  return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
}

function renderArea() {
  for (const b of document.querySelectorAll('.seg button')) {
    const on = b.dataset.area === state.area;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  $('radiusRow').hidden = state.area === 'v';
}

function setArea(area) {
  if (state.area === area) return;
  state.area = area;
  highlight = null;
  clearStop();
  if (area === 'v') {
    const c = map.getCenter();
    state.lat = c.lat;
    state.lon = c.lng;
    state.z = map.getZoom();
  } else {
    // z výřezu do okruhu: bod uprostřed mapy
    const c = map.getCenter();
    state.lat = c.lat;
    state.lon = c.lng;
    state.z = undefined;
  }
  renderArea();
  saveState();
  drawCircle();
  recompute();
}

let moveTimer = null;
function onMapMove() {
  if (state.area !== 'v') return;
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    const c = map.getCenter();
    state.lat = c.lat;
    state.lon = c.lng;
    state.z = map.getZoom();
    saveState();
    recompute();
  }, 250);
}

function updateResetButton() {
  $('reset').hidden = !(state && (state.lat != null || state.area === 'v'));
}

/** Zavřít vše: zrušit bod, výřez, kartu i zvýraznění a mírně oddálit na přehled regionu. */
function resetAll() {
  state.area = 'c';
  state.lat = null;
  state.lon = null;
  state.z = undefined;
  highlight = null;
  clearStop();
  renderArea();
  saveState();
  drawCircle();
  recompute();
  if (map.getZoom() > 9) map.easeTo({ zoom: 9, duration: 500 });
}

// ---------- hledání obcí

const PLACES_VERSION = 1; // zvýšit při přegenerování places.json (scripts/build_places.py)
let placeIndex = null;
let placeLoad = null;
let placeHits = [];

function loadPlaces() {
  if (!placeLoad) {
    placeLoad = fetch(`places.json?v=${PLACES_VERSION}`)
      .then((r) => r.json())
      .then((d) => { placeIndex = buildPlaceIndex(d); })
      .catch((e) => {
        console.warn('places', e);
        placeLoad = null;
      });
  }
  return placeLoad;
}

async function onSearchInput() {
  const q = $('q').value;
  await loadPlaces();
  if (q !== $('q').value) return; // mezitím se psalo dál
  placeHits = placeIndex ? searchPlaces(placeIndex, q) : [];
  const ul = $('qres');
  if (q.trim().length < 2) {
    ul.hidden = true;
    return;
  }
  ul.innerHTML = placeHits.length
    ? placeHits.map((h, i) => `<li role="option"><button type="button" data-i="${i}"><b>${esc(h.label)}</b>${h.label !== h.name ? ` <span>(${esc(h.name)})</span>` : ''}<small>${esc(h.prov)}</small></button></li>`).join('')
    : `<li class="none">${esc(t('noPlace'))}</li>`;
  ul.hidden = false;
}

function goToPlace(h) {
  $('q').value = h.label;
  $('qres').hidden = true;
  $('q').blur();
  // větší města trochu dál, vesnice blíž
  map.flyTo({ center: [h.lon, h.lat], zoom: h.w >= 4 ? 12 : 13.5, duration: 900 });
}

// ---------- trasa zvýrazněné linky

const lineCache = new Map();
let routeSeq = 0;

function loadLine(gi) {
  let p = lineCache.get(gi);
  if (!p) {
    p = fetch(`${DATA}lines/${gi}.json?b=${manifest.build}`)
      .then((r) => (r.ok ? r.json() : { v: [] }))
      .then((j) => j.v.map(([n, enc]) => ({ n, pts: decodePolyline(enc) })))
      .catch(() => {
        lineCache.delete(gi);
        return [];
      });
    lineCache.set(gi, p);
  }
  return p;
}

async function drawRoute() {
  const seq = ++routeSeq;
  if (!mapReady) return;
  const l = highlight != null && selection?.lines.find((x) => x.k === highlight);
  if (!l || !manifest.lines) {
    map.getSource('route').setData(emptyFc());
    return;
  }
  const gis = [...l.rs];
  const all = await Promise.all(gis.map(loadLine));
  if (seq !== routeSeq || !mapReady) return;
  const features = [];
  gis.forEach((gi, i) => {
    for (const v of all[i]) {
      // jen varianty, které vedou přes zvolený okruh
      const inside = state.area === 'v' ? passesBbox(v.pts, viewBbox()) : passesCircle(v.pts, state.lat, state.lon, state.r * 1.05);
      if (!inside) continue;
      features.push({
        type: 'Feature',
        properties: { color: `#${routes[gi][3]}` },
        geometry: { type: 'LineString', coordinates: v.pts.map(([a, b]) => [b, a]) },
      });
    }
  });
  map.getSource('route').setData({ type: 'FeatureCollection', features });
}

function renderStops() {
  if (!mapReady) return;
  const src = map.getSource('stops');
  drawRoute();
  if (!selection) {
    src.setData(emptyFc());
    return;
  }
  const hlStops = highlight != null ? selection.lines.find((l) => l.k === highlight)?.stops : null;
  const order = { a: 1, b: 1, ab: 2 };
  src.setData({
    type: 'FeatureCollection',
    features: selection.stops.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id, name: s.name, icon: `stop-${s.state}-${s.rail ? 'rail' : 'bus'}`,
        order: order[s.state] + (s.rail ? 1 : 0), dim: hlStops ? !hlStops.has(s.id) : false,
      },
    })),
  });
}

// ---------- výpočet

async function recompute() {
  const seq = ++computeSeq;
  updateResetButton();
  if (state.area === 'v' && !map) {
    setStatus(t('loading'));
    return; // dopočítá se po načtení mapy
  }
  if (state.lat == null) {
    selection = null;
    renderStops();
    renderLines();
    setStatus(t('pickPoint'));
    return;
  }
  if (!state.a && !state.b) {
    selection = null;
    renderStops();
    renderLines();
    clearStop();
    setStatus(t('needWindow'));
    return;
  }
  const outOfRange = feedsOutOfRange(manifest, state.d);
  if (outOfRange.length) showNotice(t('outOfRange', outOfRange.map((f) => f.name).join(', ')));
  else hideNotice();

  let bbox = null;
  if (state.area === 'v') {
    bbox = viewBbox();
    if (bbox[2] - bbox[0] > MAX_VIEW_DEG) {
      selection = null;
      renderStops();
      renderLines();
      clearStop();
      setStatus(t('zoomIn'));
      return;
    }
  }
  const keys = bbox ? tilesForBbox(manifest, bbox) : tilesForCircle(manifest, state.lat, state.lon, state.r);
  if (keys.some((k) => !tileCache.has(k))) setStatus(t('loading'));
  let tiles;
  try {
    tiles = await Promise.all(keys.map(loadTile));
  } catch (e) {
    console.error(e);
    if (seq === computeSeq) setStatus(navigator.onLine ? t('loadError') : t('offline'));
    return;
  }
  if (seq !== computeSeq) return;
  const params = {
    lat: state.lat, lon: state.lon, r: state.r, bbox,
    day: dayIndex(manifest.start, state.d), a: state.a, b: state.b, ak: state.ak, bk: state.bk, modes: state.modes,
  };
  selection = computeSelection(tiles.flat(), routes, params);
  if (highlight != null && !selection.lines.some((l) => l.k === highlight)) highlight = null;
  renderStops();
  renderLines();
  if (selectedId && !selection.stops.some((x) => x.id === selectedId)) clearStop();
  else renderStopCard();
  setStatus(selection.stops.length ? t('summary', selection.stops.length, selection.lines.length) : t('noStops'));
}

// ---------- výstupy

function setStatus(text) {
  $('status').textContent = text;
}

function showNotice(text) {
  $('notice').textContent = text;
  $('notice').hidden = false;
}

function hideNotice() {
  $('notice').hidden = true;
}

const dayMark = (m) => (m >= 1440 ? '<sup>+1</sup>' : m < 0 ? '<sup>−1</sup>' : '');

function depRows(list, stop) {
  if (!list.length) return `<p class="muted">${t('none')}</p>`;
  const rows = list.slice(0, MAX_DEPS).map((d) => {
    const r = routes[d.r];
    // příjezd: odkud spoj jede; odjezd: kam jede
    const label = d.kind === 'arr' ? `${t('from')} ${d.o}` : d.h;
    const here = d.arr === d.dep ? `${fmtHm(d.arr)}${dayMark(d.arr)}` : `${fmtHm(d.arr)}–${fmtHm(d.dep)}${dayMark(d.dep)}`;
    return `<li><details><summary title="${esc(t('tripTitle'))}"><time>${fmtHm(d.t)}${dayMark(d.t)}</time>${badge(r)}<span class="head">${esc(label)}</span><span class="ag">${esc(r[5])}</span></summary>
      <p class="trip"><span>${esc(d.o)} <time>${fmtHm(d.t0)}${dayMark(d.t0)}</time></span><span class="arrow">→</span><b>${esc(stop.name)} <time>${here}</time></b><span class="arrow">→</span><span>${esc(d.h)} <time>${fmtHm(d.t1)}${dayMark(d.t1)}</time></span></p></details></li>`;
  });
  if (list.length > MAX_DEPS) rows.push(`<li class="muted">${t('more', list.length - MAX_DEPS)}</li>`);
  return `<ul class="deps">${rows.join('')}</ul>`;
}

const winLabel = (w) => `${fmtHm(w[0])}–${fmtHm(w[1])}`;
// krátký popisek okna pro legendu: 8–11, 7:30–9
const hShort = (m) => { const v = fmtHm(m); return v.endsWith(':00') ? String(Number(v.slice(0, 2))) : v.replace(/^0/, ''); };
const winShort = (w) => `${hShort(w[0])}–${hShort(w[1])}`;

function clearStop() {
  selectedId = null;
  if (popup) popup.remove();
  popup = null;
  $('stop').hidden = true;
  $('stop').innerHTML = '';
}

function selectStop(id) {
  const s = selection?.stops.find((x) => x.id === id);
  if (!s) return;
  selectedId = id;
  if (popup) popup.remove();
  // na mapě jen úsporný štítek, detaily jsou pod mapou
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 12, className: 'stop-tip' })
    .setLngLat([s.lon, s.lat])
    .setHTML(`<i class="dot ${s.state}"></i><span>${esc(s.name)}</span>`)
    .addTo(map);
  renderStopCard();
  revealStopCard();
}

function revealStopCard() {
  const card = $('stop');
  if (card.hidden) return;
  if (desktopQuery.matches) {
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  // mobil: posunout stránku tak, aby byl vidět začátek detailu a pořád kus mapy
  const top = card.getBoundingClientRect().top;
  if (top > window.innerHeight * 0.7 || top < 0) {
    window.scrollBy({ top: top - window.innerHeight * 0.55, behavior: 'smooth' });
  }
}

function renderStopCard() {
  const card = $('stop');
  const s = selectedId && selection?.stops.find((x) => x.id === selectedId);
  if (!s) {
    card.hidden = true;
    return;
  }
  const feed = feedOf(s.id);
  const inLabel = (w) => t(state[`${w}k`] === 'arr' ? 'inArr' : 'inDep', winShort(state[w]));
  const stateLabel = s.state === 'ab' ? t('runsBoth') : inLabel(s.state);
  const section = (w, cls, list) => (state[w]
    ? `<h4><i class="dot ${cls}"></i>${KIND_ICON[state[`${w}k`]]} ${t(`kind_${state[`${w}k`]}`)} ${winLabel(state[w])}</h4>${depRows(list, s)}` : '');
  card.innerHTML = `
    <header>
      <h3>${esc(s.name)}</h3>
      <button type="button" class="x" aria-label="${esc(t('close'))}">×</button>
    </header>
    <p class="meta"><span class="dot ${s.state}"></span>${esc(stateLabel)}${state.area === 'v' ? '' : ` · ${esc(t('away', fmtKm(s.dist)))}`}</p>
    ${section('a', 'a', s.depsA)}
    ${section('b', 'b', s.depsB)}
    <p class="links">
      <a href="${esc(walkUrl(state.area === 'v' ? null : state, s))}" target="_blank" rel="noopener">${t('walk')}</a>
      ${feed?.alerts ? `<a href="${esc(feed.alerts)}" target="_blank" rel="noopener">${t('alerts')} (${esc(feed.name)})</a>` : ''}
    </p>`;
  card.hidden = false;
}

function renderLines() {
  const box = $('lines');
  const ul = $('lineList');
  if (!selection || !selection.lines.length) {
    box.hidden = true;
    ul.innerHTML = '';
    return;
  }
  box.hidden = false;
  ul.innerHTML = selection.lines.map((l) => {
    const stops = [...l.stops.values()];
    const heads = [...l.heads];
    const cnt = (w, n) => (state[w] ? `<span class="cnt ${w}" title="${esc(`${t(`kind_${state[`${w}k`]}`)} ${winLabel(state[w])}`)}">${n}</span>` : '');
    const counts = cnt('a', l.nA) + cnt('b', l.nB);
    return `<li><button type="button" class="line${l.k === highlight ? ' on' : ''}" data-k="${esc(l.k)}" aria-pressed="${l.k === highlight}">
      <span class="top">${badge(l.route)}<span class="ag">${esc(l.route[5])}</span>${counts}</span>
      <span class="sub"><b>${t('dirs')}:</b> ${esc(heads.slice(0, 4).join(' · '))}${heads.length > 4 ? ' …' : ''}</span>
      <span class="sub"><b>${t('stopsServed')}:</b> ${esc(stops.slice(0, 6).join(', '))}${stops.length > 6 ? ` ${t('more', stops.length - 6)}` : ''}</span>
    </button></li>`;
  }).join('');
}

function renderLegend() {
  const item = (st, label) => `<span><i class="dot ${st}"></i>${esc(label)}</span>`;
  const a = !state || state.a;
  const b = state && state.b;
  $('legend').innerHTML = (a ? item('a', state ? `${KIND_ICON[state.ak]}${winShort(state.a)}` : t('winA')) : '') + (b ? item('b', `${KIND_ICON[state.bk]}${winShort(state.b)}`) : '')
    + (a && b ? item('ab', t('both')) : '') + `<span><i class="sq"></i>${esc(t('legendRail'))}</span>`;
}

function renderFoot() {
  if (!manifest) return;
  const feeds = manifest.feeds.map((f) => (f.to ? t('dataTo', f.name, fmtDate(f.to)) : f.name)).join(' · ');
  const built = new Date(manifest.built).toLocaleString(getLang() === 'cs' ? 'cs-CZ' : 'en-GB', {
    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  $('foot').innerHTML = `<p>${esc(t('attribution'))}${esc(feeds)}.</p>
    <p>${esc(t('built', built))} · ${manifest.feeds.map((f) => esc(f.license)).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
    · Obce © <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a>
    · Map © <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
    © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>`;
}

// ---------- start

async function main() {
  applyI18n();
  setStatus(t('loading'));
  try {
    manifest = await loadJson(`${DATA}manifest.json`);
    routes = await loadJson(`${DATA}routes.json?b=${manifest.build}`);
  } catch (e) {
    console.error(e);
    setStatus(navigator.onLine ? t('loadError') : t('offline'));
    return;
  }
  state = decodeState(location.hash, DEFAULTS);
  state.d = clampDate(state.d || todayIso());
  writeControls();
  applyI18n();
  initMap();

  $('ctlToggle').addEventListener('click', () => setCollapsed(!collapsed));
  $('kindA').addEventListener('click', () => toggleKind('a'));
  $('kindB').addEventListener('click', () => toggleKind('b'));
  setCollapsed(collapsed);
  $('controls').addEventListener('input', onControlsChange);
  $('controls').addEventListener('change', onControlsChange);
  $('radius').addEventListener('input', onControlsChange);
  for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => setArea(b.dataset.area));
  $('reset').addEventListener('click', resetAll);
  $('q').addEventListener('focus', loadPlaces, { once: true });
  $('q').addEventListener('input', onSearchInput);
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && placeHits.length) goToPlace(placeHits[0]);
    if (e.key === 'Escape') {
      $('qres').hidden = true;
      $('q').blur();
    }
  });
  $('qres').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) goToPlace(placeHits[Number(b.dataset.i)]);
  });
  // klepnutí mimo hledání seznam zavře
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#search')) $('qres').hidden = true;
  });
  renderArea();
  $('stop').addEventListener('click', (e) => {
    if (e.target.closest('.x')) clearStop();
  });
  $('theme').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* soukromé okno */
    }
    applyTheme();
    syncMapStyle();
  });
  $('lang').addEventListener('click', () => {
    setLang(getLang() === 'cs' ? 'en' : 'cs');
    applyI18n();
    if (selection) {
      renderLines();
      renderStopCard();
      setStatus(selection.stops.length ? t('summary', selection.stops.length, selection.lines.length) : t('noStops'));
    } else if (state.lat == null) setStatus(t('pickPoint'));
  });
  $('locate').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setPoint(p.coords.latitude, p.coords.longitude, true),
      (err) => console.warn(err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  $('lineList').addEventListener('click', (e) => {
    const btn = e.target.closest('button.line');
    if (!btn) return;
    const k = btn.dataset.k;
    highlight = highlight === k ? null : k;
    renderStops();
    renderLines();
    if (highlight != null && map) {
      const l = selection.lines.find((x) => x.k === k);
      const pts = selection.stops.filter((s) => l.stops.has(s.id));
      if (pts.length) {
        const b = new maplibregl.LngLatBounds();
        pts.forEach((s) => b.extend([s.lon, s.lat]));
        map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 400 });
      }
      // mobil: ukázat mapu, ať je zvýraznění vidět
      if (!desktopQuery.matches) {
        const top = $('mapwrap').getBoundingClientRect().top;
        if (top < 0) window.scrollBy({ top: top - 4, behavior: 'smooth' });
      }
    }
  });
  window.addEventListener('hashchange', () => {
    const next = decodeState(location.hash, DEFAULTS);
    const moved = next.lat !== state.lat || next.lon !== state.lon;
    state = next;
    state.d = clampDate(state.d);
    if (moved) {
      clearStop();
      highlight = null;
    }
    renderLegend();
    renderSummary();
    writeControls();
    drawCircle();
    if (moved && state.lat != null) map.flyTo({ center: [state.lon, state.lat], zoom: state.area === 'v' && state.z ? state.z : zoomForRadius(state.r) });
    renderArea();
    recompute();
  });
  recompute();
  // pro ladění a end-to-end testy
  window.busNaVylet = { get map() { return map; }, get selection() { return selection; }, selectStop };

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}

main();
