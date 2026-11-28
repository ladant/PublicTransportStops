import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distance, nearestNodes, normalize, searchNodes, groupDepartures, countdown, age, formatDistance, stopBatches, lineKey,
} from '../web/src/core.js';

const andel = {
  id: 1040, n: 'Anděl', lat: 50.07116, lon: 14.40347,
  s: [
    { g: ['U1040Z1P'], t: 'tram', p: 'A', d: ['Čechovo náměstí'] },
    { g: ['U1040Z2P'], t: 'tram', p: 'B', d: ['Sídliště Barrandov'] },
    { g: ['U1040Z101P', 'U1040Z102P'], t: 'metroB', d: ['Černý Most'] },
  ],
};
const nodes = [
  andel,
  { id: 1, n: 'Na Knížecí', lat: 50.0676, lon: 14.4031, s: [] },
  { id: 2, n: 'Lihovar', lat: 50.0600, lon: 14.4080, s: [] },
  { id: 3, n: 'Malostranské náměstí', lat: 50.0880, lon: 14.4040, s: [] },
  { id: 4, n: 'Náves', m: 'Lety', lat: 49.9, lon: 14.25, s: [] },
  { id: 5, n: 'Anděl (Beroun)', lat: 49.96, lon: 14.07, s: [] },
];

test('distance a nearestNodes', () => {
  assert.ok(Math.abs(distance(50, 14, 50.001, 14) - 111.2) < 0.5);
  const near = nearestNodes(nodes, 50.0705, 14.4033, 4);
  assert.deepEqual(near.map((x) => x.node.id), [1040, 1, 2, 3]);
  assert.ok(near[0].dist < near[1].dist);
});

test('hledání bez diakritiky, začátek názvu první', () => {
  assert.equal(normalize('Malostranské  Náměstí!'), 'malostranske namesti');
  assert.deepEqual(searchNodes(nodes, 'andel').map((n) => n.id), [1040, 5]);
  assert.deepEqual(searchNodes(nodes, 'namesti').map((n) => n.id), [3]);
  assert.deepEqual(searchNodes(nodes, 'lety').map((n) => n.id), [4], 'i podle obce');
  assert.deepEqual(searchNodes(nodes, '  '), []);
});

const now = Date.parse('2026-11-28T12:00:00+01:00');
const at = (min) => new Date(now + min * 60_000).toISOString();
const dep = (stop, line, min, extra = {}) => ({ stop, line, type: 'tram', headsign: 'X', scheduled: at(min), predicted: null, realtime: false, ...extra });
const deps = [
  dep('U1040Z1P', '4', 5),
  dep('U1040Z1P', '9', 2, { predicted: at(3), realtime: true }),
  dep('U1040Z1P', '7', -2), // už odjel
  dep('U1040Z2P', '4', 1),
  dep('U1040Z102P', 'B', 4),
  dep('U9999Z1P', '1', 1), // cizí sloupek
];
const noFavs = { stops: new Set(), lines: new Set() };

test('groupDepartures: po sloupcích, odjeté pryč, živý čas', () => {
  const g = groupDepartures(andel, deps, noFavs, { now });
  assert.deepEqual(g.map((x) => x.stop.g[0]), ['U1040Z2P', 'U1040Z1P', 'U1040Z101P'], 'podle nejbližšího odjezdu');
  assert.deepEqual(g[1].rows.map((r) => r.line), ['9', '4']);
  assert.equal(g[1].rows[0].t, Date.parse(at(3)), 'předpověď má přednost');
  assert.equal(g[2].rows[0].line, 'B', 'druhé ID sloupku patří do stejné skupiny');
});

test('groupDepartures: oblíbené nahoře a filtr jen oblíbené', () => {
  const favs = { stops: new Set(['U1040Z101P']), lines: new Set([lineKey(andel.s[0], '4')]) };
  const g = groupDepartures(andel, deps, favs, { now });
  // oba oblíbené nahoře (mezi sebou podle nejbližšího odjezdu), neoblíbený na konci
  assert.deepEqual(g.map((x) => x.stop.g[0]), ['U1040Z101P', 'U1040Z1P', 'U1040Z2P']);
  assert.equal(g[0].fav, true);
  assert.deepEqual(g[1].rows.map((r) => [r.line, r.favLine]), [['4', true], ['9', false]], 'oblíbená linka první, i když jede později');

  const only = groupDepartures(andel, deps, favs, { now, onlyFavs: true });
  assert.deepEqual(only.map((x) => x.stop.g[0]), ['U1040Z101P', 'U1040Z1P']);
  assert.deepEqual(only[1].rows.map((r) => r.line), ['4'], 'u oblíbené linky jen ona');
});

test('groupDepartures: prázdný sloupek zůstane, ale bez řádků', () => {
  const g = groupDepartures(andel, [], noFavs, { now });
  assert.equal(g.length, 3);
  assert.ok(g.every((x) => x.rows.length === 0));
});

test('odpočet, stáří dat, vzdálenost', () => {
  assert.equal(countdown(now + 20_000, now), 'teď');
  assert.equal(countdown(now + 3 * 60_000 + 5_000, now), 'za 3 min');
  assert.equal(countdown(now + 65 * 60_000, now), 'za 1 h 5 min');
  assert.equal(countdown(now + 120 * 60_000, now), 'za 2 h');
  assert.equal(age(now - 10_000, now), 'právě teď');
  assert.equal(age(now - 7 * 60_000, now), 'před 7 min');
  assert.equal(formatDistance(137), '140 m');
  assert.equal(formatDistance(1530), '1,5 km');
});

test('stopBatches: všechna ID uzlu po dávkách', () => {
  assert.deepEqual(stopBatches(andel), [['U1040Z1P', 'U1040Z2P', 'U1040Z101P', 'U1040Z102P']]);
  assert.deepEqual(stopBatches(andel, 3).map((b) => b.length), [3, 1]);
});
