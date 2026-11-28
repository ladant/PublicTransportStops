// Sjednocený výstup proxy, stejný pro všechny dopravce (Praha teď, Belgie později).
//
// GET /v1/departures?region=pid&stops=U1040Z1P,U1040Z2P
// {
//   region: "pid",
//   stops: ["U1040Z1P", ...],          // dotazované zastávky (sloupky)
//   fetchedAt: "2026-11-28T12:00:00Z", // kdy proxy data získala od dopravce
//   departures: [{
//     stop: "U1040Z1P",                // ID sloupku, ze kterého spoj jede
//     platform: "A" | null,
//     line: "4",
//     type: "tram" | "metro" | "bus" | "train" | "trolleybus" | "ferry" | "funicular" | "other",
//     headsign: "Čechovo náměstí",
//     scheduled: ISO,                  // odjezd podle jízdního řádu
//     predicted: ISO | null,           // odhad s ohledem na zpoždění
//     delay: sekundy | null,           // null = není živá informace
//     realtime: boolean,               // true = živě, false = jen podle řádu
//     canceled: boolean,
//     night: boolean
//   }]
// }

const GTFS_ROUTE_TYPES = {
  0: 'tram', 1: 'metro', 2: 'train', 3: 'bus', 4: 'ferry', 7: 'funicular', 11: 'trolleybus',
};

export function routeType(n) {
  return GTFS_ROUTE_TYPES[n] ?? 'other';
}

export class UpstreamError extends Error {
  constructor(status, message) {
    super(message ?? `upstream ${status}`);
    this.status = status;
  }
}
