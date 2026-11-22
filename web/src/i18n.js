const dict = {
  cs: {
    title: 'Bus na výlet',
    tagline: 'Klikněte do mapy a uvidíte, odkud kdy něco jede.',
    date: 'Den',
    winA: 'Tam (okno A)',
    winB: 'Zpět (okno B)',
    useB: 'Přidat návrat',
    radius: 'Okruh',
    modes: 'Doprava',
    bus: 'Autobus',
    rail: 'Vlak',
    tram: 'Tram/metro',
    myLocation: 'Moje poloha',
    pickPoint: 'Klikněte nebo dlouze podržte prst na mapě a vyberte místo.',
    loading: 'Načítám…',
    noStops: 'V okruhu nic v zadaných časech nejede.',
    summary: (n, l) => `${n} ${plural(n, 'zastávka', 'zastávky', 'zastávek')}, ${l} ${plural(l, 'linka', 'linky', 'linek')}`,
    onlyA: 'jede tam',
    onlyB: 'jede zpět',
    both: 'tam i zpět',
    lines: 'Linky ve výběru',
    linesHint: 'Klepnutím na linku zvýrazníte její zastávky.',
    dirs: 'Směry',
    stopsServed: 'Zastávky',
    depsA: 'Odjezdy tam',
    depsB: 'Odjezdy zpět',
    none: 'nic',
    more: (n) => `+ ${n} dalších`,
    walk: 'Trasa pěšky',
    alerts: 'Ověřit výluky',
    away: (km) => `${km} od bodu`,
    dataTo: (name, d) => `${name}: data do ${d}`,
    outOfRange: (names) => `Na tento den chybí data: ${names}. Prázdné místo neznamená, že nic nejede.`,
    built: (d) => `Data sestavena ${d}`,
    attribution: 'Jízdní řády: ',
    offline: 'Jste offline a tato oblast není uložená.',
    loadError: 'Data se nepodařilo načíst.',
    mapError: 'Mapový podklad se nenačetl.',
    close: 'Zavřít',
    lang: 'EN',
    clearHl: 'Zrušit zvýraznění',
    legendRail: 'nádraží',
    legendBus: 'zastávka',
  },
  en: {
    title: 'Bus na výlet',
    tagline: 'Tap the map to see where something departs and when.',
    date: 'Day',
    winA: 'Out (window A)',
    winB: 'Back (window B)',
    useB: 'Add return',
    radius: 'Radius',
    modes: 'Transport',
    bus: 'Bus',
    rail: 'Train',
    tram: 'Tram/metro',
    myLocation: 'My location',
    pickPoint: 'Tap or long-press the map to pick a place.',
    loading: 'Loading…',
    noStops: 'Nothing departs within the radius at the chosen times.',
    summary: (n, l) => `${n} stop${n === 1 ? '' : 's'}, ${l} line${l === 1 ? '' : 's'}`,
    onlyA: 'out',
    onlyB: 'back',
    both: 'out & back',
    lines: 'Lines in selection',
    linesHint: 'Tap a line to highlight its stops.',
    dirs: 'Directions',
    stopsServed: 'Stops',
    depsA: 'Departures out',
    depsB: 'Departures back',
    none: 'none',
    more: (n) => `+ ${n} more`,
    walk: 'Walking route',
    alerts: 'Check disruptions',
    away: (km) => `${km} from point`,
    dataTo: (name, d) => `${name}: data until ${d}`,
    outOfRange: (names) => `No data for this day: ${names}. An empty map does not mean nothing runs.`,
    built: (d) => `Data built ${d}`,
    attribution: 'Timetables: ',
    offline: 'You are offline and this area is not saved.',
    loadError: 'Could not load data.',
    mapError: 'The base map failed to load.',
    close: 'Close',
    lang: 'CZ',
    clearHl: 'Clear highlight',
    legendRail: 'station',
    legendBus: 'stop',
  },
};

function plural(n, one, few, many) {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

let lang = 'cs';
try {
  lang = localStorage.getItem('lang') || (navigator.language || 'cs').slice(0, 2);
} catch {
  lang = (navigator.language || 'cs').slice(0, 2);
}
if (!dict[lang]) lang = lang === 'cs' || lang === 'sk' ? 'cs' : 'en';

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = dict[l] ? l : 'cs';
  try {
    localStorage.setItem('lang', lang);
  } catch {
    /* soukromé okno */
  }
}

export function t(key, ...args) {
  const v = dict[lang][key] ?? dict.cs[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

export function fmtDate(iso, opts = { day: 'numeric', month: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(lang === 'cs' ? 'cs-CZ' : 'en-GB', opts);
}

export function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1).replace('.', lang === 'cs' ? ',' : '.')} km`;
}
