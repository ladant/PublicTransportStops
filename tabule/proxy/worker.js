import { createHandler } from './handler.js';
import { buildConfig } from './config.js';

// Cloudflare Workers. Klíč: `npx wrangler secret put GOLEMIO_API_KEY`.
let handler;
export default {
  fetch(request, env) {
    handler ??= createHandler(buildConfig(env));
    return handler(request);
  },
};
