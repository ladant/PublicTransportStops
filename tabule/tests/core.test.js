import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distance, nearestNodes, normalize, searchNodes, groupDepartures, formatTimes, subLabel, age, formatDistance, stopBatches,
  lineKey, stopKey, nodeHasFavs,
} from '../web/src/core.js';

const st = (id, p, t, d, n) => ({ g: [id], p, t, d, ...(n ? { n } : {}) });
// Bulovka: A = do centra (Braník/Spořilov), B = ven (Kobylisy), C = bus
const bulovka = {
  id: 54, n: 'Bulovka', lat: 50.1166, lon: 14.4678,
  s: [st('U54Z1P', 'A', 'tram', ['Nádraží Braník', 'Spořilov']), st('U54Z2P', 'B', 'tram', ['Kobylisy', 'Vozovna Kobylisy']), st('U54Z3P', 'C', 'bus', ['Černý Most'])],
};
// Hellichova: jedno místo, dva názvy podle strany
const hellichova = {
  id: 138, n: 'Pražské Jezulátko', o: ['Tyršův dům'], lat: 50.0857, lon: 14.4042,
  x: [[50.0857, 14.4042, 'Pražské Jezulátko'], [50.0842, 14.4045, 'Tyršův dům']],
  s: [st('U138Z1P', 'A', 'tram', ['Nádraží Hostivař'], 'Pražské Jezulátko'), st('U138Z2P', 'B', 'tram', ['Bílá Hora'], 'Tyršův dům')],
};
const nodes = [
  bulovka, hellichova,
  { id: 1, n: 'Na Knížecí', lat: 50.0676, lon: 14.4031, s: [] },
  { id: 3, n: 'Malostranské náměstí', lat: 50.0880, lon: 14.4040, s: [] },
  { id: 4, n: 'Náves', m: 'Lety', lat: 49.9, lon: 14.25, s: [] },
];

test('nejbližší uzel se jménem podle strany (Hellichova)', () => {
  assert.ok(Math.abs(distance(50, 14, 50.001, 14) - 111.2) < 0.5);
  const north = nearestNodes(nodes, 50.0856, 14.4042, 1)[0];
  assert.equal(north.node.id, 138);
  assert.equal(north.name, 'Pražské Jezulátko');
  const south = nearestNodes(nodes, 50.0843, 14.4045, 1)[0];
  assert.equal(south.node.id, 138);
  assert.equal(south.name, 'Tyršův dům');
  assert.ok(south.dist < 30);
});

test('hledání bez diakritiky, i podle dalšího názvu uzlu a obce', () => {
  assert.equal(normalize('Malostranské  Náměstí!'), 'malostranske namesti');
  assert.deepEqual(searchNodes(nodes, 'namesti').map((h) => h.node.id), [3]);
  assert.deepEqual(searchNodes(nodes, 'lety').map((h) => h.node.id), [4]);
  assert.deepEqual(searchNodes(nodes, '  '), []);
  // uzel s víc názvy: najde se podle kteréhokoli a výsledek nese souřadnice té části
  const [tyrs] = searchNodes(nodes, 'tyrsuv');
  assert.deepEqual([tyrs.node.id, tyrs.name, tyrs.lat, tyrs.lon], [138, 'Tyršův dům', 50.0842, 14.4045]);
  const [jez] = searchNodes(nodes, 'jezulatko');
  assert.deepEqual([jez.name, jez.lat], ['Pražské Jezulátko', 50.0857]);
  assert.equal(nearestNodes(nodes, tyrs.lat, tyrs.lon, 1)[0].name, 'Tyršův dům', 'špendlík u hledané části dá její název v záhlaví');
});

test('subLabel: upřesnění sloupku pod názvem v záhlaví', () => {
  assert.equal(subLabel('Anděl (ul. Plzeňská)', 'Anděl'), 'ul. Plzeňská');
  assert.equal(subLabel('Anděl', 'Anděl'), '');
  assert.equal(subLabel('Tyršův dům', 'Pražské Jezulátko'), 'Tyršův dům');
  assert.equal(subLabel('Vinohradská - východ', 'Želivského'), 'Vinohradská - východ');
  assert.equal(subLabel(undefined, 'Anděl'), '');
});

const now = Date.parse('2026-11-28T12:00:00+01:00');
const at = (min) => new Date(now + min * 60_000).toISOString();
const dep = (stop, line, min, headsign, extra = {}) => ({ stop, line, type: 'tram', headsign, scheduled: at(min), predicted: null, realtime: false, canceled: false, ...extra });
const deps = [
  // sloupek A (do centra): 3 a 24, linka 3 jede i krácená (jiný cíl)
  dep('U54Z1P', '3', 4, 'Nádraží Braník'), dep('U54Z1P', '3', 12, 'Nádraží Braník', { predicted: at(14), realtime: true, delay: 120 }),
  dep('U54Z1P', '3', 20, 'Nádraží Braník'), dep('U54Z1P', '3', 30, 'Nádraží Braník'), dep('U54Z1P', '3', 40, 'Nádraží Braník'),
  dep('U54Z1P', '3', 6, 'Sídliště Barrandov'), // výluková varianta, stejné číslo
  dep('U54Z1P', '24', 7, 'Spořilov'), dep('U54Z1P', '24', 17, 'Spořilov'),
  dep('U54Z1P', '30', 3, 'Spojovací'),
  // sloupek B (ven): 3 a 24 také jezdí
  dep('U54Z2P', '3', 2, 'Kobylisy'), dep('U54Z2P', '24', 5, 'Vozovna Kobylisy'),
  dep('U54Z2P', '30', 8, 'Sídliště Ďáblice'),
  dep('U54Z3P', '201', 1, 'Černý Most', { type: 'bus' }),
  dep('U54Z1P', '3', -5, 'Nádraží Braník'), // už odjel
  dep('U999', '1', 1, 'cizí'),
];
const noFavs = { stops: new Set(), lines: new Set() };
// Ráno do centra: 3 a 24 ze sloupku A. Sloupek B (ven) není oblíbený.
const toCenter = { stops: new Set(), lines: new Set([lineKey(bulovka.s[0], '3'), lineKey(bulovka.s[0], '24')]) };

test('řádky: stejná linka a cíl = jeden řádek s několika časy, výluková varianta zvlášť', () => {
  const g = groupDepartures(bulovka, deps, noFavs, { now });
  const a = g.find((x) => x.key === 'U54Z1P');
  const braník = a.rows.find((r) => r.line === '3' && r.headsign === 'Nádraží Braník');
  assert.deepEqual(braník.times.map((t) => Math.round((t.t - now) / 60_000)), [4, 14, 20], 'nejvýš 3 časy, odjetý pryč, živý čas');
  assert.equal(braník.times[1].realtime, true);
  assert.ok(a.rows.some((r) => r.line === '3' && r.headsign === 'Sídliště Barrandov'));
  assert.ok(!a.rows.some((r) => r.headsign === 'cizí'));
});

test('oblíbené platí jen pro sloupek: linka 3 ve směru do centra se nepřenese na směr ven', () => {
  assert.equal(nodeHasFavs(bulovka, toCenter), true);
  const g = groupDepartures(bulovka, deps, toCenter, { now });
  assert.deepEqual(g.map((x) => x.key), ['U54Z1P', 'U54Z3P', 'U54Z2P'], 'sloupek s oblíbenými první, ostatní podle odjezdu');

  const a = g[0];
  assert.equal(a.mode, 'favs');
  assert.deepEqual(a.rows.map((r) => `${r.line}>${r.headsign}`).sort(), ['24>Spořilov', '3>Nádraží Braník', '3>Sídliště Barrandov'], 'jen 3 a 24, včetně výlukové 3');
  assert.ok(a.rows.every((r) => r.favLine));
  assert.equal(a.rows.find((r) => r.headsign === 'Nádraží Braník').times.length, 3, 'nejvýš 3 časy na řádek');
  assert.equal(a.more, 1, 'linka 30 je pod "+ dalších"');

  const b = g[2];
  assert.equal(b.key, 'U54Z2P');
  assert.equal(b.mode, 'collapsed', 'směr ven je sbalený');
  assert.equal(b.rows.length, 0);
  assert.ok(b.summary.every((r) => !r.favLine), 'linka 3 ve směru ven není oblíbená');
  assert.deepEqual(b.summary.map((r) => r.line), ['3', '24', '30']);
  assert.equal(g[1].mode, 'collapsed');
});

test('oblíbené v obou směrech: oba nahoře, řazení podle nejbližšího oblíbeného odjezdu', () => {
  const both = { stops: new Set(), lines: new Set([lineKey(bulovka.s[0], '3'), lineKey(bulovka.s[1], '3')]) };
  const g = groupDepartures(bulovka, deps, both, { now });
  assert.deepEqual(g.map((x) => x.key), ['U54Z2P', 'U54Z1P', 'U54Z3P'], 'linka 3 ven jede za 2 min, do centra za 4');
  assert.deepEqual(g.map((x) => x.mode), ['favs', 'favs', 'collapsed']);
});

test('oblíbený sloupek (hvězdička u směru) ukáže všechny linky; rozbalení sbaleného', () => {
  const stopFav = { stops: new Set(['U54Z2P']), lines: new Set() };
  const g = groupDepartures(bulovka, deps, stopFav, { now });
  assert.equal(g[0].key, 'U54Z2P');
  assert.equal(g[0].mode, 'full');
  assert.deepEqual(g[0].rows.map((r) => r.line), ['3', '24', '30']);
  assert.equal(g[1].mode, 'collapsed');
  const open = groupDepartures(bulovka, deps, stopFav, { now, expanded: new Set(['U54Z1P']) });
  assert.equal(open.find((x) => x.key === 'U54Z1P').mode, 'full');
  assert.equal(open.find((x) => x.key === 'U54Z1P').rows.length, 4);
});

test('bez oblíbených: všechny sloupky rozbalené, dlouhé sloupky oříznuté', () => {
  const g = groupDepartures(bulovka, deps, noFavs, { now });
  assert.ok(g.every((x) => x.mode === 'full'));
  assert.deepEqual(g.map((x) => x.key), ['U54Z3P', 'U54Z2P', 'U54Z1P'], 'podle nejbližšího odjezdu');
  const many = Array.from({ length: 8 }, (_, i) => dep('U54Z3P', String(100 + i), i + 1, `Cíl ${i}`));
  const c = groupDepartures(bulovka, many, noFavs, { now }).find((x) => x.key === 'U54Z3P');
  assert.equal(c.rows.length, 5);
  assert.equal(c.more, 3);
});

test('jen oblíbené: sloupky bez oblíbených zmizí, u oblíbené linky jen ona', () => {
  const g = groupDepartures(bulovka, deps, toCenter, { now, onlyFavs: true });
  assert.deepEqual(g.map((x) => x.key), ['U54Z1P']);
  assert.ok(g[0].rows.every((r) => r.favLine));
  assert.deepEqual(groupDepartures(bulovka, deps, noFavs, { now, onlyFavs: true }), []);
});

test('prázdný oblíbený sloupek zůstane', () => {
  const g = groupDepartures(bulovka, [], toCenter, { now });
  assert.equal(g.length, 3);
  assert.ok(g.every((x) => x.empty));
  assert.equal(g[0].rows.length, 0);
});

test('formatTimes: minuty, "teď", hodina odjezdu za víc než hodinu, zpoždění', () => {
  const t = (min, extra = {}) => ({ t: now + min * 60_000 + 5_000, realtime: false, delay: null, canceled: false, ...extra });
  const f = formatTimes([t(0), t(9), t(17, { realtime: true, delay: 150 })], now);
  assert.deepEqual(f.map((x) => x.text), ['teď', '9', '17']);
  assert.equal(f[2].late, 3);
  assert.equal(formatTimes([t(3), t(15)], now)[0].text, '3 min');
  assert.equal(formatTimes([t(75)], now)[0].text, '13:15');
});

test('stáří dat, vzdálenost, dávky ID', () => {
  assert.equal(age(now - 10_000, now), 'právě teď');
  assert.equal(age(now - 7 * 60_000, now), 'před 7 min');
  assert.equal(formatDistance(137), '140 m');
  assert.equal(formatDistance(1530), '1,5 km');
  assert.deepEqual(stopBatches(hellichova), [['U138Z1P', 'U138Z2P']]);
  assert.deepEqual(stopBatches(bulovka, 2).map((b) => b.length), [2, 1]);
  assert.equal(stopKey(bulovka.s[1]), 'U54Z2P');
});
