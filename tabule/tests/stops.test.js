import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactPid } from '../scripts/build-stops.mjs';

const raw = JSON.parse(readFileSync(new URL('./fixtures/pid-stops-sample.json', import.meta.url)));

test('compactPid: uzly se sloupky, bez prázdných a bez nočních směrů', () => {
  const d = compactPid(raw);
  assert.equal(d.region, 'pid');
  assert.deepEqual(d.nodes.map((n) => n.id), [1040, 9001]);
  const andel = d.nodes[0];
  assert.equal(andel.m, undefined, 'Praha se neuvádí');
  assert.equal(andel.s.length, 2, 'sloupek bez gtfsIds vypadne');
  assert.deepEqual(andel.s[0], { g: ['U1040Z1P'], t: 'tram', d: ['Čechovo náměstí', 'Bílá labuť'], p: 'A' });
  assert.equal(andel.s[1].t, 'metroB');
  const naves = d.nodes[1];
  assert.equal(naves.n, 'Lety,Náves');
  assert.equal(naves.m, 'Lety');
  assert.equal(naves.s[0].t, 'bus', 'undefined -> bus');
  assert.equal(naves.s[0].p, undefined);
});
