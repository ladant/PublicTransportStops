// Vymyšlené odjezdy pro vývoj bez API klíče. Stejný sloupek dává stále stejné linky.
const HEADSIGNS = ['Sídliště Barrandov', 'Nádraží Holešovice', 'Kotlářka', 'Spojovací', 'Lehovec', 'Radlická', 'Bílá Hora', 'Ústřední dílny DP'];

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function mockAdapter({ now = Date.now } = {}) {
  return {
    maxStops: 30,
    async departures(stops) {
      const t0 = now();
      const out = [];
      for (const stop of stops) {
        const h = hash(stop);
        const lines = [0, 1, 2].map((i) => ({
          line: String(((h >>> (i * 5)) % 40) + (i === 2 ? 100 : 1)),
          type: i === 2 ? 'bus' : 'tram',
          headsign: HEADSIGNS[(h >>> (i * 3)) % HEADSIGNS.length],
          every: 6 + ((h >>> (i * 7)) % 9),
        }));
        for (const l of lines) {
          const period = l.every * 60_000;
          let t = Math.ceil(t0 / period) * period + (h % 60) * 1000;
          for (let k = 0; k < 4; k++, t += period) {
            const realtime = (k + h) % 3 !== 0;
            const delay = realtime ? ((h + k * 37) % 5) * 60 - 30 : null;
            out.push({
              stop, platform: null, line: l.line, type: l.type, headsign: l.headsign,
              scheduled: new Date(t).toISOString(),
              predicted: realtime ? new Date(t + delay * 1000).toISOString() : null,
              delay, realtime, canceled: false, night: false,
            });
          }
        }
      }
      return out.sort((a, b) => (a.predicted ?? a.scheduled).localeCompare(b.predicted ?? b.scheduled));
    },
  };
}
