import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactPid } from '../scripts/build-stops.mjs';

const raw = JSON.parse(readFileSync(new URL('./fixtures/pid-stops-sample.json', import.meta.url)));

test('compactPid: uzly se sloupky, bez prázdných a bez nočních směrů', () => {
  const d = compactPid(raw);
  assert.equal(d.region, 'pid');
  assert.deepEqual(d.nodes.map((n) => n.id), [138, 1040, 9001]);
  const andel = d.nodes.find((n) => n.id === 1040);
  assert.equal(andel.m, undefined, 'Praha se neuvádí');
  assert.equal(andel.x, undefined, 'jedna skupina = bez souřadnic částí');
  assert.equal(andel.s.length, 2, 'sloupek bez gtfsIds vypadne');
  assert.deepEqual(andel.s[0], { g: ['U1040Z1P'], t: 'tram', d: ['Čechovo náměstí', 'Bílá labuť'], p: 'A' });
  assert.equal(andel.s[1].t, 'metroB');
  const naves = d.nodes.find((n) => n.id === 9001);
  assert.equal(naves.n, 'Lety,Náves');
  assert.equal(naves.m, 'Lety');
  assert.equal(naves.s[0].t, 'bus', 'undefined -> bus');
  assert.equal(naves.s[0].p, undefined);
});

test('compactPid: uzel s víc názvy je jedno místo (Hellichova)', () => {
  const d = compactPid(raw);
  assert.equal(new Set(d.nodes.map((n) => n.id)).size, d.nodes.length, 'každé ID uzlu jednou');
  const n = d.nodes.find((x) => x.id === 138);
  assert.equal(n.s.length, 2);
  assert.deepEqual(n.o, ['Tyršův dům'].filter((x) => x !== n.n).concat(n.n === 'Tyršův dům' ? ['Pražské Jezulátko'] : []));
  assert.deepEqual(n.x.map((p) => p[2]).sort(), ['Pražské Jezulátko', 'Tyršův dům']);
  assert.deepEqual(n.s.map((s) => s.n).sort(), ['Pražské Jezulátko', 'Tyršův dům']);
});
