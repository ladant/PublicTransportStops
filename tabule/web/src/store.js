// Vše, co se ukládá v telefonu (localStorage). Bez účtu; při nedostupném úložišti aplikace jen nic nepamatuje.
const KEY = 'tabule:v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}

let state = read();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* plné nebo blokované úložiště */ }
}

export const store = {
  favs() {
    return { stops: new Set(state.favStops ?? []), lines: new Set(state.favLines ?? []) };
  },
  toggleFav(kind, key) {
    const field = kind === 'stop' ? 'favStops' : 'favLines';
    const set = new Set(state[field] ?? []);
    set.has(key) ? set.delete(key) : set.add(key);
    state[field] = [...set];
    save();
  },
  get onlyFavs() { return Boolean(state.onlyFavs); },
  set onlyFavs(v) { state.onlyFavs = v; save(); },
  get view() { return state.view === 'list' ? 'list' : 'groups'; },
  set view(v) { state.view = v; save(); },
  // Poslední poloha z GPS. Ručně vybrané místo (hledání, uložené místo) se nepamatuje:
  // po dalším otevření aplikace se zase začne tam, kde stojíš.
  get position() { return state.position && !state.position.manual ? state.position : null; }, // { lat, lon, at, manual: false }
  set position(p) { if (!p.manual) { state.position = p; save(); } },
  // Uložená místa (celé zastávky), ke kterým se dá přepnout, i když u nich ještě nejsi: [{ id, name, lat, lon }]
  get places() { return state.places ?? []; },
  togglePlace(place) {
    const rest = this.places.filter((p) => p.id !== place.id);
    state.places = rest.length === this.places.length ? [...rest, place] : rest;
    save();
  },
  get lastNode() { return state.lastNode ?? null; },
  set lastNode(id) { state.lastNode = id; save(); },
  // Poslední odjezdy pro 4 naposledy zobrazené uzly – offline zobrazení.
  departures(nodeId) { return state.deps?.[`n${nodeId}`] ?? null; },
  saveDepartures(nodeId, data) {
    // klíč s písmenem: číselné klíče by objekt seřadil podle čísla a pokazil pořadí
    const deps = { ...(state.deps ?? {}) };
    delete deps[`n${nodeId}`];
    deps[`n${nodeId}`] = data;
    const keys = Object.keys(deps);
    while (keys.length > 4) delete deps[keys.shift()];
    state.deps = deps;
    save();
  },
};
