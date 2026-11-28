import { pidAdapter } from './adapters/pid.js';
import { mockAdapter } from './adapters/mock.js';

// Z proměnných prostředí sestaví adaptéry. Klíče zná jen proxy, nikdy telefon.
//   GOLEMIO_API_KEY  klíč z api.golemio.cz (Praha, PID)
//   MOCK=1           bez klíče: vymyšlené odjezdy pro vývoj
//   ALLOWED_ORIGIN   povolené originy aplikace (čárkou), výchozí *
export function buildConfig(env = {}) {
  const pid = env.GOLEMIO_API_KEY ? pidAdapter({ apiKey: env.GOLEMIO_API_KEY })
    : env.MOCK === '1' ? mockAdapter() : null;
  return { adapters: { pid }, allowedOrigin: env.ALLOWED_ORIGIN || '*' };
}
