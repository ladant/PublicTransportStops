import http from 'node:http';
import { createHandler } from './handler.js';
import { buildConfig } from './config.js';

// Lokální proxy pro vývoj: node proxy/dev-server.js
// Bez GOLEMIO_API_KEY běží s vymyšlenými daty (MOCK=1).
const env = { ...process.env };
if (!env.GOLEMIO_API_KEY && env.MOCK === undefined) env.MOCK = '1';
const handle = createHandler(buildConfig(env));
const port = Number(env.PORT ?? 8787);

http.createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !k.startsWith(':')) headers.set(k, v);
    const response = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(req.method, req.url, err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('internal error');
  }
}).listen(port, () => {
  console.log(`proxy http://localhost:${port}  (${env.GOLEMIO_API_KEY ? 'Golemio' : 'MOCK data'})`);
});
