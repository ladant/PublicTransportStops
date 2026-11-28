import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePid, pidAdapter } from '../proxy/adapters/pid.js';
import { mockAdapter } from '../proxy/adapters/mock.js';
import { createHandler } from '../proxy/handler.js';
import { createCache } from '../proxy/cache.js';
import { UpstreamError } from '../proxy/format.js';

const golemio = JSON.parse(readFileSync(new URL('./fixtures/golemio-departures.json', import.meta.url)));

test('normalizePid: sjednocený formát, živě vs. podle řádu, odřeknuté', () => {
  const d = normalizePid(golemio);
  assert.equal(d.length, 3, 'odjezd bez času vypadne');
  assert.deepEqual(d[0], {
    stop: 'U1040Z1P', platform: 'A', line: '9', type: 'tram', headsign: 'Nákladové nádraží Žižkov',
    scheduled: '2026-11-28T12:02:00+01:00', predicted: '2026-11-28T12:03:30+01:00',
    delay: 90, realtime: true, canceled: false, night: false,
  });
  assert.equal(d[1].type, 'metro');
  assert.equal(d[1].realtime, false);
  assert.equal(d[1].predicted, null);
  assert.equal(d[1].delay, null);
  assert.equal(d[2].canceled, true);
  assert.equal(d[2].night, true);
});

test('pidAdapter: URL a hlavička s klíčem', async () => {
  let seen;
  const a = pidAdapter({
    apiKey: 'K', base: 'https://example.test',
    fetch: async (url, init) => { seen = { url: new URL(url), init }; return new Response(JSON.stringify(golemio)); },
  });
  const d = await a.departures(['U1040Z1P', 'U1040Z102P']);
  assert.equal(d.length, 3);
  assert.equal(seen.url.pathname, '/v2/pid/departureboards');
  assert.deepEqual(seen.url.searchParams.getAll('ids[]'), ['U1040Z1P', 'U1040Z102P']);
  assert.equal(seen.url.searchParams.get('mode'), 'departures');
  assert.equal(seen.init.headers['X-Access-Token'], 'K');
});

test('pidAdapter: chyba dopravce -> UpstreamError se stavem', async () => {
  const a = pidAdapter({ apiKey: 'K', fetch: async () => new Response('', { status: 429 }) });
  await assert.rejects(a.departures(['U1']), (e) => e instanceof UpstreamError && e.status === 429);
});

function fakeAdapter() {
  const calls = [];
  let fail = null;
  return {
    calls,
    failWith(status) { fail = status; },
    maxStops: 3,
    async departures(stops) {
      calls.push(stops);
      if (fail) throw new UpstreamError(fail);
      return [{ stop: stops[0], line: '1' }];
    },
  };
}

const get = (h, path, headers = {}) => h(new Request(`https://proxy.test${path}`, { headers }));

test('handler: validace, neznámá oblast, health', async () => {
  const h = createHandler({ adapters: { pid: fakeAdapter(), be: null } });
  assert.equal((await get(h, '/v1/departures?region=pid')).status, 400);
  assert.equal((await get(h, '/v1/departures?stops=a,b,c,d')).status, 400, 'nad maxStops');
  assert.equal((await get(h, '/v1/departures?stops=a%20b')).status, 400);
  assert.equal((await get(h, '/v1/departures?region=xx&stops=a')).status, 404);
  assert.equal((await get(h, '/nic')).status, 404);
  assert.deepEqual(await (await get(h, '/v1/health')).json(), { ok: true, regions: ['pid'] });
});

test('handler: cache sdílená mezi pořadím zastávek, stará data při chybě', async () => {
  let t = 0;
  const adapter = fakeAdapter();
  const h = createHandler({ adapters: { pid: adapter }, cache: createCache({ ttl: 30_000, staleTtl: 300_000, now: () => t }) });

  const r1 = await get(h, '/v1/departures?stops=B,A');
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('X-Cache'), 'MISS');
  const body = await r1.json();
  assert.deepEqual(body.stops, ['A', 'B']);
  assert.equal(body.region, 'pid');

  const r2 = await get(h, '/v1/departures?stops=A,B,A');
  assert.equal(r2.headers.get('X-Cache'), 'HIT');
  assert.equal(adapter.calls.length, 1);

  t = 60_000;
  adapter.failWith(500);
  const r3 = await get(h, '/v1/departures?stops=A,B');
  assert.equal(r3.status, 200);
  assert.equal(r3.headers.get('X-Cache'), 'STALE');
  assert.equal((await r3.json()).stale, true);

  t = 10 * 60_000;
  assert.equal((await get(h, '/v1/departures?stops=A,B')).status, 502);
  adapter.failWith(429);
  const r5 = await get(h, '/v1/departures?stops=C');
  assert.equal(r5.status, 503);
  assert.equal(r5.headers.get('Retry-After'), '30');
});

test('handler: souběžné dotazy = jedno volání dopravce', async () => {
  const adapter = fakeAdapter();
  const h = createHandler({ adapters: { pid: adapter } });
  await Promise.all([1, 2, 3].map(() => get(h, '/v1/departures?stops=A')));
  assert.equal(adapter.calls.length, 1);
});

test('handler: CORS jen pro povolený origin', async () => {
  const h = createHandler({ adapters: { pid: fakeAdapter() }, allowedOrigin: 'https://ladant.github.io' });
  const ok = await get(h, '/v1/health', { Origin: 'https://ladant.github.io' });
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://ladant.github.io');
  const bad = await get(h, '/v1/health', { Origin: 'https://evil.test' });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('mockAdapter: odjezdy v budoucnosti, seřazené, stabilní linky', async () => {
  const now = Date.parse('2026-11-28T12:00:00Z');
  const a = mockAdapter({ now: () => now });
  const d = await a.departures(['U1040Z1P']);
  assert.equal(d.length, 12);
  assert.ok(d.every((x) => Date.parse(x.scheduled) >= now - 60_000));
  const times = d.map((x) => x.predicted ?? x.scheduled);
  assert.deepEqual(times, [...times].sort());
  assert.deepEqual((await a.departures(['U1040Z1P'])).map((x) => x.line), d.map((x) => x.line));
});

test('mockAdapter: platné časy pro libovolná ID', async () => {
  const a = mockAdapter();
  const ids = Array.from({ length: 300 }, (_, i) => `U${i}Z${i % 7}P`);
  for (let i = 0; i < ids.length; i += 30) {
    const d = await a.departures(ids.slice(i, i + 30));
    assert.ok(d.every((x) => x.headsign && Number(x.line) > 0 && !Number.isNaN(Date.parse(x.scheduled))));
  }
});
