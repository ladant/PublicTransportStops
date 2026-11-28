import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage v paměti, ještě před načtením store.js (ten čte stav při importu)
const mem = new Map([['tabule:v1', JSON.stringify({ position: { lat: 1, lon: 2, manual: true }, favLines: ['a|3'] })]]);
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
const { store } = await import('../web/src/store.js');
const saved = () => JSON.parse(mem.get('tabule:v1'));

test('ručně vybraná poloha se nepamatuje (ani ze starší verze)', () => {
  assert.equal(store.position, null);
  store.position = { lat: 50, lon: 14, at: 1, manual: true };
  assert.equal(store.position, null);
  assert.equal(saved().position.manual, true, 'stará hodnota zůstala, ale nečte se');
  store.position = { lat: 50.1, lon: 14.4, at: 2, manual: false };
  assert.deepEqual([store.position.lat, saved().position.lat], [50.1, 50.1]);
});

test('uložená místa: přidat, nepřidat dvakrát, odebrat', () => {
  const a = { id: 54, name: 'Bulovka', lat: 50.1, lon: 14.4 };
  const b = { id: 1072, name: 'Václavské náměstí', lat: 50.08, lon: 14.42 };
  assert.deepEqual(store.places, []);
  store.togglePlace(a); store.togglePlace(b);
  assert.deepEqual(store.places.map((p) => p.name), ['Bulovka', 'Václavské náměstí']);
  store.togglePlace({ ...a, name: 'jiný název' });
  assert.deepEqual(store.places.map((p) => p.id), [1072], 'stejné ID uzlu = odebrat');
  assert.deepEqual(saved().places.map((p) => p.id), [1072]);
});

test('oblíbené a režim zobrazení přežijí', () => {
  assert.deepEqual([...store.favs().lines], ['a|3']);
  store.toggleFav('line', 'a|24'); store.toggleFav('line', 'a|3');
  assert.deepEqual([...store.favs().lines], ['a|24']);
  assert.equal(store.view, 'groups');
  store.view = 'list';
  assert.equal(JSON.parse(mem.get('tabule:v1')).view, 'list');
});
