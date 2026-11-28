// Stáhne seznam zastávek PID a uloží jeho zmenšenou verzi pro telefon.
//   node scripts/build-stops.mjs [--in stops.json] [--out web/public/data/stops-pid.json]
// Zdroj: https://data.pid.cz/stops/json/stops.json (open data PID, aktualizace denně).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PID_STOPS_URL = 'https://data.pid.cz/stops/json/stops.json';
const r5 = (x) => Math.round(x * 1e5) / 1e5;

// Uzel = přestupní uzel PID (stejné `node`, může mít víc názvů, např. Pražské Jezulátko / Tyršův dům
// nebo Karlovo náměstí / Palackého náměstí), sloupek = jedno nástupiště s ID pro odjezdy (gtfsIds).
//   { v:2, region, generatedAt, nodes: [{ id, n, o?, m?, lat, lon, x?, s: [
//       { g: [gtfsId], p?, t, d: [směry], n?: jiný název / upřesnění sloupku } ] }] }
//   n = výchozí název (skupina s nejvíc sloupky), o = ostatní názvy uzlu (pro hledání),
//   x = jen u uzlů s víc názvy: [lat, lon, název] každé skupiny. Vzdálenost se měří k nejbližší
//   skupině a ta dává i název v záhlaví (Hellichova: podle strany, na které stojíš).
export function compactPid(raw) {
  const byNode = new Map();
  for (const g of raw.stopGroups ?? []) {
    if (!(g.stops ?? []).some((st) => st.gtfsIds?.length)) continue;
    if (!byNode.has(g.node)) byNode.set(g.node, []);
    byNode.get(g.node).push(g);
  }
  const nodes = [];
  for (const [id, groups] of byNode) {
    const count = (g) => g.stops.filter((st) => st.gtfsIds?.length).length;
    groups.sort((a, b) => count(b) - count(a) || a.name.localeCompare(b.name, 'cs'));
    const main = groups[0];
    const s = [];
    for (const g of groups) {
      for (const st of g.stops) {
        if (!st.gtfsIds?.length) continue;
        const dirs = [...new Set((st.lines ?? []).filter((l) => !l.isNight).map((l) => l.direction).filter(Boolean))];
        const out = { g: st.gtfsIds, t: st.mainTrafficType && st.mainTrafficType !== 'undefined' ? st.mainTrafficType : 'bus', d: dirs.slice(0, 3) };
        if (st.platform) out.p = st.platform;
        const sub = groups.length > 1 ? (st.altIdosName || g.name) : subLabel(st.altIdosName, g.name);
        if (sub) out.n = sub;
        s.push(out);
      }
    }
    const node = { id, n: main.uniqueName || main.name, lat: r5(main.avgLat), lon: r5(main.avgLon), s };
    const others = [...new Set(groups.slice(1).map((g) => g.name).filter((n) => n !== main.name))];
    if (others.length) node.o = others;
    if (groups.length > 1) node.x = groups.map((g) => [r5(g.avgLat), r5(g.avgLon), g.name]);
    if (main.municipality && main.municipality !== 'Praha') node.m = main.municipality;
    nodes.push(node);
  }
  nodes.sort((a, b) => a.id - b.id);
  return { v: 2, region: 'pid', generatedAt: raw.generatedAt ?? null, nodes };
}

// "Želivského (Vinohradská - východ)" + "Želivského" -> "Vinohradská - východ"
function subLabel(alt, name) {
  if (!alt || alt === name) return null;
  if (alt.startsWith(name)) return alt.slice(name.length).trim().replace(/^\(|\)$/g, '') || null;
  return alt;
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
