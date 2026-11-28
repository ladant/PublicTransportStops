import { DurableObject } from 'cloudflare:workers';
import { createHandler } from './handler.js';
import { buildConfig } from './config.js';

// Cloudflare Workers. Klíč: `npx wrangler secret put GOLEMIO_API_KEY`.
//
// Všechny dotazy jdou do JEDNÉ instance Durable Objectu, takže cache odjezdů a spojování
// souběžných dotazů platí pro všechny telefony dohromady: na Golemio jde nejvýš 1 dotaz
// za 30 s na zastávku, ať ji sleduje kolik chce lidí. (Cache API by to umělo jen po
// datacentrech a na *.workers.dev vůbec nefunguje.)
export class DepartureCache extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.handle = createHandler(buildConfig(env));
  }

  fetch(request) {
    return this.handle(request);
  }
}

export default {
  fetch(request, env) {
    return env.CACHE.get(env.CACHE.idFromName('departures')).fetch(request);
  },
};
