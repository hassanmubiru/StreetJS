// SaaS Platform — StreetJS reference application.
// A multi-tenant-style admin backend over @streetjs/admin: users, RBAC roles,
// authorization, and an audit log. Exported as createSaas(); run for HTTP.

import { createServer as createHttp } from 'node:http';
import { AdminService } from '@streetjs/admin';

export function createSaas(opts = {}) {
  const admin = new AdminService(opts.adminOptions);

  const http = createHttp(async (req, res) => {
    try {
      if (req.url === '/health/live' || req.url === '/health/ready') return json(res, 200, { status: 'ok' });
      if (req.method === 'GET' && req.url === '/users') return json(res, 200, { users: await admin.listUsers() });
      if (req.method === 'GET' && req.url === '/audit') return json(res, 200, { events: await admin.auditLog({ limit: 50 }) });
      json(res, 404, { error: 'not found' });
    } catch (err) { json(res, 400, { error: String(err?.message ?? err) }); }
  });

  return { admin, http, listen(p = 0) { return new Promise((r) => http.listen(p, () => r(http.address().port))); }, close() { return new Promise((r) => http.close(r)); } };
}

function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createSaas();
  const port = await app.listen(Number(process.env.PORT) || 3000);
  console.log(`[saas] listening on http://0.0.0.0:${port}`);
}
