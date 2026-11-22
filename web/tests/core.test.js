// node --test tests/  (spouští Python pipeline nad testovacím GTFS)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildPlaceIndex, cell, computeSelection, searchPlaces, dateRange, dayIndex, decodeState, encodeState, feedsOutOfRange,
  decodePolyline, normWindow, parseTile, passesBbox, passesCircle, tileBbox, tilesForBbox, tilesForCircle,
} from '../src/core.js';

const ROOT = resolve(import.meta.dirname, '../..');
let manifest, routes, out;

function loadTiles(keys) {
  return keys.flatMap((k) => parseTile(JSON.parse(readFileSync(join(out, 'tiles', `${k}.json`), 'utf8'))));
}

function select(lat, lon, r, date, a, b = null, modes = ['bus', 'rail', 'tram'], ak = 'dep', bk = 'dep') {
  const keys = tilesForCircle(manifest, lat, lon, r);
  return computeSelection(loadTiles(keys), routes, {
    lat, lon, r, day: dayIndex(manifest.start, date), a, b, modes: new Set(modes), ak, bk,
  });
}

before(() => {
  out = join(mkdtempSync(join(tmpdir(), 'bnv-')), 'data');
  execFileSync('python3', ['-m', 'busnavylet', '--config', 'tests/fixtures/feeds.yaml',
    '--only', 'mini', '--only', 'cdonly',
    '--local', 'mini=tests/fixtures/mini', '--local', 'cdonly=tests/fixtures/cdonly',
    '--out', out, '--cache', join(out, '..', 'cache'), '--today', '2026-11-22'],
  { cwd: ROOT, env: { ...process.env, PYTHONPATH: join(ROOT, 'pipeline') }, stdio: 'pipe' });
  manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  routes = JSON.parse(readFileSync(join(out, 'routes.json'), 'utf8'));
});

test('mřížka a hranice dlaždic', () => {
  assert.equal(cell(4.35, 0.15), 29);
  assert.equal(cell(4.3499, 0.15), 28);
  const [s, w, n, e] = tileBbox('508_29_3', [0.1, 0.15]);
  assert.ok(Math.abs(s - 50.85) < 1e-9 && Math.abs(w - 4.425) < 1e-9 && Math.abs(n - 50.9) < 1e-9 && Math.abs(e - 4.5) < 1e-9);
});

test('kruh přes hranici dlaždic najde obě zastávky Centrum', () => {
  const keys = tilesForCircle(manifest, 50.85, 4.35, 0.5);
  assert.ok(keys.length >= 2);
  const sel = select(50.85, 4.35, 0.5, '2026-11-23', [480, 600]);
  const ids = sel.stops.map((s) => s.id).sort();
  assert.deepEqual(ids, ['mini:S1', 'mini:S1b']);
});

test('okna A/B a stavy zastávek', () => {
  // pondělí: S1 08:00 (A), S1b 09:25 (B), S3 07:00/07:30/08:20
  const sel = select(50.87, 4.42, 15, '2026-11-23', [470, 500], [560, 570]);
  const byId = Object.fromEntries(sel.stops.map((s) => [s.id, s]));
  assert.equal(byId['mini:S1'].state, 'a');
  assert.equal(byId['mini:S1b'].state, 'b');
  assert.equal(byId['mini:S3'].state, 'a');
  assert.deepEqual(byId['mini:S3'].depsA.map((d) => d.t), [500]);
  assert.equal(byId['mini:S4'], undefined); // 09:00 mimo obě okna
  const ab = select(50.87, 4.42, 15, '2026-11-23', [415, 425], [445, 455]);
  assert.equal(ab.stops.find((s) => s.id === 'mini:S3').state, 'ab');
});

test('nádraží (parent_station) a filtr druhu dopravy', () => {
  const sel = select(50.8, 4.4, 1, '2026-11-22', [0, 1439]);
  assert.equal(sel.stops.length, 1);
  assert.equal(sel.stops[0].id, 'mini:STA');
  assert.equal(sel.stops[0].rail, true);
  assert.equal(select(50.8, 4.4, 1, '2026-11-22', [0, 1439], null, ['bus']).stops.length, 0);
});

test('spoj po půlnoci patří k následujícímu dni', () => {
  // T4 25:10 jede v pracovní dny -> úterý 01:10, ne pondělí 01:10
  const tue = select(50.85, 4.35, 0.2, '2026-11-24', [60, 80]);
  assert.deepEqual(tue.stops.find((s) => s.id === 'mini:S1').depsA.map((d) => [d.t, d.h]), [[70, 'Noc']]);
  const mon = select(50.85, 4.35, 0.2, '2026-11-23', [60, 80]);
  assert.equal(mon.stops.length, 0);
  // okno přes půlnoc: pondělí 23:00–02:00 zachytí týž spoj jako t = 1510
  const night = select(50.85, 4.35, 0.2, '2026-11-23', [1380, 120]);
  assert.deepEqual(night.stops.find((s) => s.id === 'mini:S1').depsA.map((d) => d.t), [1510]);
});

test('seznam linek', () => {
  const sel = select(50.87, 4.42, 15, '2026-11-23', [0, 1439]);
  const l12 = sel.lines.find((l) => l.route[0] === '12');
  assert.ok(l12.nA >= 3);
  assert.ok(l12.heads.has('Les') && l12.heads.has('Centrum'));
  assert.ok(l12.stops.has('mini:S1'));
});

test('platnost dat podle dopravce', () => {
  assert.deepEqual(feedsOutOfRange(manifest, '2026-11-22').map((f) => f.code), ['cdonly']);
  assert.deepEqual(feedsOutOfRange(manifest, '2026-11-24'), []);
  assert.deepEqual(dateRange(manifest), { min: '2026-11-22', max: '2026-12-01' });
});

test('stav v URL', () => {
  const st = {
    lat: 50.85, lon: 4.35, r: 3.5, d: '2026-11-24', a: [480, 660], b: [900, 1140], modes: new Set(['bus', 'rail']),
  };
  const back = decodeState(`#${encodeState(st)}`, { r: 3, a: [0, 1], b: null, modes: ['bus', 'rail', 'tram'] });
  assert.equal(back.lat, 50.85);
  assert.equal(back.r, 3.5);
  assert.equal(back.d, '2026-11-24');
  assert.deepEqual(back.a, [480, 660]);
  assert.deepEqual(back.b, [900, 1140]);
  assert.deepEqual([...back.modes].sort(), ['bus', 'rail']);
  assert.deepEqual(normWindow([1380, 120]), [1380, 1560]);
});

test('linky se stejným číslem a dopravcem se v seznamu slučují', () => {
  const routes = [['IC', 'A', 2, '000000', 'FFFFFF', 'SNCB', 'sncb'], ['IC', 'B', 2, '000000', 'FFFFFF', 'SNCB', 'sncb'], ['IC', 'C', 3, '000000', 'FFFFFF', 'Bus', 'bus']];
  const mask = new Uint8Array([0xff]);
  const stop = (id, lat) => ({ id, name: id, lat, lon: 4, modes: 2, heads: ['X', 'Y'], masks: [mask], deps: [480, 0, 0, 0, 1, 0, 3, 0, 10, 490, 0, 1, 1, 0, 0, 3, 0, 10, 500, 0, 2, 0, 1, 0, 3, 0, 10] });
  const sel = computeSelection([stop('s1', 50), stop('s2', 50.001)], routes, { lat: 50, lon: 4, r: 1, day: 1, a: [0, 1439], b: null, modes: new Set(['bus', 'rail', 'tram']) });
  assert.equal(sel.lines.length, 2);
  const ic = sel.lines.find((l) => l.route[6] === 'sncb');
  assert.equal(ic.nA, 4);
  assert.deepEqual([...ic.heads].sort(), ['X', 'Y']);
  assert.equal(ic.stops.size, 2);
});

test('okno Tam je volitelné (a=off v URL)', () => {
  const st = { lat: 50, lon: 4, r: 3, d: '2026-11-24', a: null, b: [900, 1140], modes: new Set(['bus', 'rail', 'tram']) };
  const hash = encodeState(st);
  assert.match(hash, /a=off/);
  const back = decodeState(`#${hash}`, { r: 3, a: [480, 660], b: null, modes: ['bus', 'rail', 'tram'] });
  assert.equal(back.a, null);
  assert.deepEqual(back.b, [900, 1140]);
  const sel = select(50.87, 4.42, 15, '2026-11-23', null, [560, 570]);
  assert.ok(sel.stops.every((s) => s.state === 'b' && s.depsA.length === 0));
});

test('trasy linek: dekódování polyline a průchod okruhem', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  const pts = [[50.8, 4.4], [50.9, 4.5]];
  assert.equal(passesCircle(pts, 50.8, 4.4, 1), true);
  assert.equal(passesCircle(pts, 51.5, 4.4, 5), false);
  const sel = select(50.87, 4.42, 15, '2026-11-23', [0, 1439]);
  assert.ok(sel.lines.every((l) => l.rs.size >= 1 && l.rs.has(l.r)));
});

test('pipeline zapisuje trasy linek', () => {
  assert.equal(manifest.lines, true);
  const ic = routes.findIndex((r) => r[0] === 'IC');
  const v = JSON.parse(readFileSync(join(out, 'lines', `${ic}.json`), 'utf8')).v;
  assert.deepEqual(decodePolyline(v[0][1]), [[50.8, 4.4], [50.9, 4.5]]);
});


test('příjezdy: čas příjezdu a výchozí zastávka', () => {
  // S4 je konečná T1 (příjezd 08:30 z Centra) a T5 (07:05, 07:35 z Lesa)
  const sel = select(50.95, 4.55, 0.2, '2026-11-23', [400, 520], null, undefined, 'arr');
  const s4 = sel.stops.find((s) => s.id === 'mini:S4');
  assert.deepEqual(s4.depsA.map((d) => [d.t, d.o]), [[425, 'Les'], [455, 'Les'], [510, 'Centrum']]);
  // stejné okno jako odjezdy: z S4 v 6:40–8:40 nic neodjíždí
  assert.equal(select(50.95, 4.55, 0.2, '2026-11-23', [400, 520]).stops.length, 0);
  // rozbalení spoje: Centrum 08:00 -> S5 08:10 -> cíl 08:30
  const s5 = select(50.875, 4.425, 0.2, '2026-11-23', [480, 500], null, undefined, 'arr').stops[0];
  assert.deepEqual([s5.depsA[0].t0, s5.depsA[0].arr, s5.depsA[0].t1, s5.depsA[0].o, s5.depsA[0].h], [480, 490, 510, 'Centrum', 'Les']);
});

test('druh okna (příjezdy/odjezdy) v URL', () => {
  const st = { lat: 50, lon: 4, r: 3, d: '2026-11-24', a: [480, 660], b: [900, 1140], ak: 'arr', bk: 'dep', modes: new Set(['bus', 'rail', 'tram']) };
  const back = decodeState(`#${encodeState(st)}`, { r: 3, a: [0, 1], b: null, ak: 'dep', bk: 'dep', modes: ['bus', 'rail', 'tram'] });
  assert.equal(back.ak, 'arr');
  assert.equal(back.bk, 'dep');
});

test('výřez mapy místo okruhu', () => {
  const bbox = [50.84, 4.34, 50.86, 4.36];
  const keys = tilesForBbox(manifest, bbox);
  const sel = computeSelection(loadTiles(keys), routes, {
    lat: 50.85, lon: 4.35, r: 0, bbox, day: dayIndex(manifest.start, '2026-11-23'), a: [0, 1439], b: null, modes: new Set(['bus', 'rail', 'tram']),
  });
  assert.deepEqual(sel.stops.map((s) => s.id).sort(), ['mini:S1', 'mini:S1b']);
  assert.equal(passesBbox([[50.85, 4.35]], bbox), true);
  assert.equal(passesBbox([[51, 5]], bbox), false);
  const st = { lat: 50.85, lon: 4.35, r: 3, d: '2026-11-24', a: [480, 660], b: null, area: 'v', z: 13.5, modes: new Set(['bus', 'rail', 'tram']) };
  const back = decodeState(`#${encodeState(st)}`, { r: 3, a: [0, 1], b: null, modes: ['bus', 'rail', 'tram'] });
  assert.equal(back.area, 'v');
  assert.equal(back.z, 13.5);
  assert.equal(decodeState('#lat=50&lon=4', { r: 3, a: [0, 1], b: null, modes: ['bus'] }).area, 'c');
});

test('hledání obcí', () => {
  const data = {
    p: ['Liège', 'Oost-Vlaanderen'],
    d: [
      ['Liège', 50.63, 5.57, 0, 5, 'Lüttich|Luik|Lutych'],
      ['Gent', 51.05, 3.72, 1, 5, 'Ghent|Gand'],
      ['Lierneux', 50.28, 5.79, 0, 2, ''],
      ['Sint-Martens-Leerne', 51.01, 3.58, 1, 0, ''],
    ],
  };
  const idx = buildPlaceIndex(data);
  assert.deepEqual(searchPlaces(idx, 'lie').map((h) => h.name), ['Liège', 'Lierneux']);
  assert.equal(searchPlaces(idx, 'luik')[0].label, 'Luik');
  assert.equal(searchPlaces(idx, 'luik')[0].name, 'Liège');
  assert.equal(searchPlaces(idx, 'liege')[0].prov, 'Liège');          // bez diakritiky
  assert.equal(searchPlaces(idx, 'leerne')[0].name, 'Sint-Martens-Leerne'); // začátek slova
  assert.equal(searchPlaces(idx, 'gand')[0].name, 'Gent');
  assert.deepEqual(searchPlaces(idx, 'g'), []);
});
