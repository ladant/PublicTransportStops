const dict = {
  cs: {
    title: 'Co pojede?',
    tagline: 'Klikněte do mapy a uvidíte, odkud kdy něco jede.',
    date: 'Den',
    winA: '1. čas',
    winB: '2. čas',
    useB: 'Přidat návrat',
    radius: 'Okruh',
    modes: 'Doprava',
    bus: 'Bus',
    rail: 'Vlak',
    tram: 'Tram',
    tramTitle: 'Tramvaj a metro',
    myLocation: 'Moje poloha',
    pickPoint: 'Klepněte do mapy a vyberte místo.',
    loading: 'Načítám…',
    noStops: 'V okruhu nic v zadaných časech nejede.',
    needWindow: 'Zapněte aspoň jeden čas.',
    collapse: 'Sbalit',
    edit: 'Upravit',
    allModes: 'vše',
    summary: (n, l) => `${n} ${plural(n, 'zastávka', 'zastávky', 'zastávek')}, ${l} ${plural(l, 'linka', 'linky', 'linek')}`,
    kind_arr: 'Příjezdy',
    kind_dep: 'Odjezdy',
    kindTitle: 'Přepnout příjezdy / odjezdy',
    inArr: (w) => `příjezdy v ${w}`,
    inDep: (w) => `odjezdy v ${w}`,
    from: 'z',
    both: 'v obou časech',
    runsBoth: 'jede v obou časech',
    lines: 'Linky ve výběru',
    linesHint: 'Klepnutím na linku zvýrazníte její zastávky na mapě.',
    dirs: 'Směry',
    stopsServed: 'Zastávky',
    tripTitle: 'Spoj: výchozí zastávka → tato zastávka → cíl',
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
    theme_auto: 'Vzhled: auto',
    theme_light: 'Světlý',
    theme_dark: 'Tmavý',
    themeTitle: 'Přepnout vzhled (automaticky / světlý / tmavý)',
    clearHl: 'Zrušit zvýraznění',
    legendRail: 'nádraží',
    legendBus: 'zastávka',
  },
  en: {
    title: 'Co pojede?',
    tagline: 'Tap the map to see where something departs and when.',
    date: 'Day',
    winA: 'Time 1',
    winB: 'Time 2',
    useB: 'Add return',
    radius: 'Radius',
    modes: 'Transport',
    bus: 'Bus',
    rail: 'Train',
    tram: 'Tram',
    tramTitle: 'Tram and metro',
    myLocation: 'My location',
    pickPoint: 'Tap or long-press the map to pick a place.',
    loading: 'Loading…',
    noStops: 'Nothing departs within the radius at the chosen times.',
    needWindow: 'Turn on at least one time.',
    collapse: 'Collapse',
    edit: 'Edit',
    allModes: 'all',
    summary: (n, l) => `${n} stop${n === 1 ? '' : 's'}, ${l} line${l === 1 ? '' : 's'}`,
    kind_arr: 'Arrivals',
    kind_dep: 'Departures',
    kindTitle: 'Switch arrivals / departures',
    inArr: (w) => `arrivals ${w}`,
    inDep: (w) => `departures ${w}`,
    from: 'from',
    both: 'both times',
    runsBoth: 'runs at both times',
    lines: 'Lines in selection',
    linesHint: 'Tap a line to highlight its stops.',
    dirs: 'Directions',
    stopsServed: 'Stops',
    tripTitle: 'Trip: origin → this stop → destination',
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
    theme_auto: 'Theme: auto',
    theme_light: 'Light',
    theme_dark: 'Dark',
    themeTitle: 'Switch theme (auto / light / dark)',
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
