import { createCache } from './cache.js';

const STOP_ID = /^[A-Za-z0-9_.:-]{1,40}$/;

// Obecný fetch handler (Request -> Response): běží v Cloudflare Workers, Deno i Node 18+.
export function createHandler({ adapters, cache = createCache(), allowedOrigin = '*' }) {
  function cors(origin) {
    const allow = allowedOrigin === '*' ? '*'
      : allowedOrigin.split(',').map((s) => s.trim()).includes(origin) ? origin : null;
    const h = { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    if (allow) h['Access-Control-Allow-Origin'] = allow;
    return h;
  }

  function json(status, body, origin, extra = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin), ...extra },
    });
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, origin);

    if (url.pathname === '/v1/health') {
      return json(200, { ok: true, regions: Object.keys(adapters).filter((k) => adapters[k]) }, origin);
    }

    if (url.pathname === '/v1/departures') {
      const region = url.searchParams.get('region') ?? 'pid';
      const adapter = adapters[region];
      if (!adapter) return json(404, { error: 'unknown_region', region }, origin);

      const stops = [...new Set((url.searchParams.get('stops') ?? '').split(',').map((s) => s.trim()).filter(Boolean))].sort();
      if (!stops.length || stops.length > adapter.maxStops || !stops.every((s) => STOP_ID.test(s))) {
        return json(400, { error: 'bad_stops', max: adapter.maxStops }, origin);
      }

      try {
        const key = `${region}:${stops.join(',')}`;
        const r = await cache.get(key, async () => ({
          region, stops, fetchedAt: new Date().toISOString(), departures: await adapter.departures(stops),
        }));
        return json(200, r.stale ? { ...r.value, stale: true } : r.value, origin, {
          'Cache-Control': 'public, max-age=15',
          'X-Cache': r.stale ? 'STALE' : r.cached ? 'HIT' : 'MISS',
        });
      } catch (err) {
        const status = err.status === 429 ? 503 : 502;
        return json(status, { error: 'upstream', upstreamStatus: err.status ?? null }, origin,
          status === 503 ? { 'Retry-After': '30' } : {});
      }
    }

    return json(404, { error: 'not_found' }, origin);
  };
}
