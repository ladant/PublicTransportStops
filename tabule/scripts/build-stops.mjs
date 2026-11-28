// Stáhne seznam zastávek PID a uloží jeho zmenšenou verzi pro telefon.
//   node scripts/build-stops.mjs [--in stops.json] [--out web/public/data/stops-pid.json]
// Zdroj: https://data.pid.cz/stops/json/stops.json (open data PID, aktualizace denně).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PID_STOPS_URL = 'https://data.pid.cz/stops/json/stops.json';
const r5 = (x) => Math.round(x * 1e5) / 1e5;

// Uzel = skupina zastávek se stejným názvem (všechny směry sloučené),
// sloupek = jedno nástupiště / směr s ID pro odjezdy (gtfsIds).
//   { v, region, generatedAt, nodes: [{ id, n, m?, lat, lon, s: [{ g: [gtfsId], p?, t, d: [směry] }] }] }
export function compactPid(raw) {
  const nodes = [];
  for (const g of raw.stopGroups ?? []) {
    const s = (g.stops ?? []).filter((st) => st.gtfsIds?.length).map((st) => {
      const dirs = [...new Set((st.lines ?? []).filter((l) => !l.isNight).map((l) => l.direction).filter(Boolean))];
      const out = { g: st.gtfsIds, t: st.mainTrafficType && st.mainTrafficType !== 'undefined' ? st.mainTrafficType : 'bus', d: dirs.slice(0, 3) };
      if (st.platform) out.p = st.platform;
      return out;
    });
    if (!s.length) continue;
    const node = { id: g.node, n: g.uniqueName || g.name, lat: r5(g.avgLat), lon: r5(g.avgLon), s };
    if (g.municipality && g.municipality !== 'Praha') node.m = g.municipality;
    nodes.push(node);
  }
  nodes.sort((a, b) => a.id - b.id);
  return { v: 1, region: 'pid', generatedAt: raw.generatedAt ?? null, nodes };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
  const here = dirname(fileURLToPath(import.meta.url));
  const out = args.out ?? `${here}/../web/public/data/stops-pid.json`;
  const raw = args.in ? JSON.parse(await readFile(args.in, 'utf8'))
    : await (async () => {
      const res = await fetch(PID_STOPS_URL);
      if (!res.ok) throw new Error(`${PID_STOPS_URL}: HTTP ${res.status}`);
      return res.json();
    })();
  const data = compactPid(raw);
  await mkdir(dirname(out), { recursive: true });
  const text = JSON.stringify(data);
  await writeFile(out, text);
  console.log(`${data.nodes.length} uzlů, ${data.nodes.reduce((n, x) => n + x.s.length, 0)} sloupků, ${(text.length / 1024).toFixed(0)} kB -> ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
