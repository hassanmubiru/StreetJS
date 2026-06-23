// HTMX Dashboard — StreetJS reference application.
// A server-rendered, live-updating dashboard built on @streetjs/plugin-htmx's
// dependency-free ViewEngine — no SPA, no client build step. Tiles refresh via
// HTMX polling (GET /tiles → HTML fragment) and a Server-Sent Events stream
// (GET /events). Exported as createDashboard(); run directly for HTTP.

import { createServer as createHttp } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ViewEngine } from '@streetjs/plugin-htmx';

const viewsDir = join(dirname(fileURLToPath(import.meta.url)), 'views');

export function createDashboard(opts = {}) {
  const engine = new ViewEngine({ viewsDir, layout: 'main' });
  const started = Date.now();
  // Deterministic-but-lively metrics: a counter + a seeded pseudo-random walk so
  // the demo "moves" without any external dependency.
  let requests = 0;
  let seed = opts.seed ?? 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  function snapshot() {
    requests += 1;
    return {
      requests,
      activeUsers: 40 + Math.floor(rnd() * 60),
      p99: 8 + Math.floor(rnd() * 25),
      errorRate: (rnd() * 0.9).toFixed(2),
    };
  }
  const pageData = () => ({
    title: 'Live Dashboard',
    uptime: Math.round((Date.now() - started) / 1000),
    metrics: snapshot(),
  });

  const sseClients = new Set();
  const interval = setInterval(() => {
    if (sseClients.size === 0) return;
    const frame = `event: tiles\ndata: ${engine.partial('tiles', { metrics: snapshot() }).replace(/\n/g, ' ')}\n\n`;
    for (const res of sseClients) res.write(frame);
  }, opts.intervalMs ?? 2000);
  if (interval.unref) interval.unref();

  const http = createHttp((req, res) => {
    try {
      const url = (req.url ?? '/').split('?')[0];
      if (url === '/health/live' || url === '/health/ready') return json(res, 200, { status: 'ok' });

      if (req.method === 'GET' && url === '/') {
        const isHtmx = String(req.headers['hx-request'] ?? '') === 'true';
        const html = engine.view('dashboard', pageData(), { wrap: !isHtmx });
        return send(res, 200, 'text/html; charset=utf-8', html);
      }
      if (req.method === 'GET' && url === '/tiles') {
        return send(res, 200, 'text/html; charset=utf-8', engine.partial('tiles', { metrics: snapshot() }));
      }
      if (req.method === 'GET' && url === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(':' + ' '.repeat(2048) + '\n\n'); // padding to defeat proxy buffering
        res.write(`event: tiles\ndata: ${engine.partial('tiles', { metrics: snapshot() }).replace(/\n/g, ' ')}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[htmx-dashboard] request error:', err);
      json(res, 500, { error: 'Internal Server Error' });
    }
  });

  return {
    engine,
    http,
    snapshot,
    listen(p = 0) { return new Promise((r) => http.listen(p, () => r(http.address().port))); },
    close() {
      clearInterval(interval);
      for (const res of sseClients) { try { res.end(); } catch { /* ignore */ } }
      sseClients.clear();
      return new Promise((r) => http.close(r));
    },
  };
}

function json(res, code, body) { send(res, code, 'application/json', JSON.stringify(body)); }
function send(res, code, type, body) { res.writeHead(code, { 'content-type': type }); res.end(body); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createDashboard();
  const port = await app.listen(Number(process.env.PORT) || 3000);
  console.log(`[htmx-dashboard] listening on http://0.0.0.0:${port}`);
}
