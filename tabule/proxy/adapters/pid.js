import { routeType, UpstreamError } from '../format.js';

// Praha (PID) přes Golemio API: GET /v2/pid/departureboards, hlavička X-Access-Token.
// Dokumentace: https://api.golemio.cz/pid/docs/openapi/ (ověřit limity, viz otevřené otázky).
export function pidAdapter({ apiKey, base = 'https://api.golemio.cz', fetch: doFetch = globalThis.fetch }) {
  return {
    maxStops: 30, // největší uzel PID má 30 sloupků
    async departures(stops) {
      const u = new URL('/v2/pid/departureboards', base);
      for (const id of stops) u.searchParams.append('ids[]', id);
      u.searchParams.set('mode', 'departures'); // bez spojů, které tu končí
      u.searchParams.set('order', 'real');
      u.searchParams.set('minutesAfter', '90');
      u.searchParams.set('limit', String(Math.min(200, 8 * stops.length + 10)));
      u.searchParams.set('preferredTimezone', 'Europe/Prague');
      const res = await doFetch(u, { headers: { 'X-Access-Token': apiKey, Accept: 'application/json' } });
      if (!res.ok) throw new UpstreamError(res.status);
      return normalizePid(await res.json());
    },
  };
}

export function normalizePid(body) {
  return (body?.departures ?? []).map((d) => {
    const realtime = Boolean(d.delay?.is_available);
    return {
      stop: d.stop?.id ?? null,
      platform: d.stop?.platform_code ?? null,
      line: String(d.route?.short_name ?? '?'),
      type: routeType(d.route?.type),
      headsign: d.trip?.headsign ?? '',
      scheduled: d.departure_timestamp?.scheduled ?? null,
      predicted: realtime ? d.departure_timestamp?.predicted ?? null : null,
      delay: realtime ? d.delay.seconds ?? (d.delay.minutes ?? 0) * 60 : null,
      realtime,
      canceled: Boolean(d.trip?.is_canceled),
      night: Boolean(d.route?.is_night),
    };
  }).filter((d) => d.stop && d.scheduled);
}
