// Sdílená cache odjezdů v paměti (jedna instance proxy / jeden Worker isolate).
// Čerstvá data do ttl, při chybě dopravce se smí vrátit starší data do staleTtl.
// Souběžné dotazy na stejný klíč čekají na jedno volání dopravce.
export function createCache({ ttl = 30_000, staleTtl = 5 * 60_000, max = 2000, now = Date.now } = {}) {
  const entries = new Map(); // key -> { value, at }
  const inflight = new Map(); // key -> Promise

  function put(key, value) {
    entries.delete(key);
    entries.set(key, { value, at: now() });
    while (entries.size > max) entries.delete(entries.keys().next().value);
  }

  async function get(key, load) {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttl) return { value: hit.value, cached: true, stale: false };
    if (!inflight.has(key)) {
      inflight.set(key, (async () => {
        try {
          const value = await load();
          put(key, value);
          return value;
        } finally {
          inflight.delete(key);
        }
      })());
    }
    try {
      return { value: await inflight.get(key), cached: false, stale: false };
    } catch (err) {
      if (hit && now() - hit.at < staleTtl) return { value: hit.value, cached: true, stale: true, error: err };
      throw err;
    }
  }

  return { get, size: () => entries.size };
}
