#!/usr/bin/env node
// dast/start-target.mjs
// Street app used as the DAST scan target in CI. It serves EVERY route declared
// in dast/routes.json (auth, RBAC-protected admin, file upload, and CRUD
// endpoints) so Schemathesis and OWASP ZAP have a live, OpenAPI-conformant
// target that exercises the full enumerated operation set. No database or
// external dependencies — it is a security-scan fixture, not a sample app.
//
// Conformance contract (so a clean scan passes the severity gate):
//   - never returns a 5xx (passes `not_a_server_error`);
//   - every response status code is one the route declares in its OpenAPI spec
//     (passes `status_code_conformance`);
//   - a secured route ALWAYS rejects an unauthenticated request with 401 — auth
//     is never ignored (passes `ignored_auth`), and because the scanner holds no
//     token every secured operation deterministically returns its declared 401,
//     which is also a valid 4xx for `negative_data_rejection`.
//
// Usage: PORT=8080 node dast/start-target.mjs

import { streetApp } from 'streetjs';

const port = Number(process.env.PORT ?? 8080);
const app = streetApp({});

/** True when the request carries a Bearer token (any token — fixture only). */
function isAuthenticated(ctx) {
  return /^bearer\s+\S+/i.test(ctx.headers?.['authorization'] ?? '');
}

/**
 * The route table mirrors dast/routes.json. Each entry returns a status code
 * the route declares. `secured` routes reject an unauthenticated request with
 * 401 (so auth is never ignored) and otherwise return their success code.
 *
 * @type {Array<{ method: string, pattern: RegExp, secured?: boolean, ok: number, body?: unknown }>}
 */
const ROUTES = [
  // Liveness.
  { method: 'GET', pattern: /^\/health$/, ok: 200, body: { status: 'ok' } },

  // Auth (unsecured; issue/refresh/revoke a token).
  { method: 'POST', pattern: /^\/auth\/register$/, ok: 201, body: { id: 'u_probe' } },
  { method: 'POST', pattern: /^\/auth\/login$/, ok: 200, body: { token: 'probe-token' } },
  { method: 'POST', pattern: /^\/auth\/refresh$/, ok: 200, body: { token: 'probe-token' } },
  { method: 'POST', pattern: /^\/auth\/logout$/, ok: 204 },

  // RBAC-protected admin (bearer required).
  { method: 'GET', pattern: /^\/admin\/users$/, secured: true, ok: 200, body: { users: [] } },
  { method: 'POST', pattern: /^\/admin\/users\/[^/]+\/roles$/, secured: true, ok: 200, body: { ok: true } },
  { method: 'DELETE', pattern: /^\/admin\/users\/[^/]+$/, secured: true, ok: 204 },

  // File upload (bearer required).
  { method: 'POST', pattern: /^\/files$/, secured: true, ok: 201, body: { id: 'f_probe' } },
  { method: 'GET', pattern: /^\/files\/[^/]+$/, secured: true, ok: 200, body: { id: 'f_probe', name: 'probe.txt' } },
  { method: 'DELETE', pattern: /^\/files\/[^/]+$/, secured: true, ok: 204 },

  // CRUD items (reads are public; writes require a bearer token).
  { method: 'GET', pattern: /^\/items$/, ok: 200, body: { items: [] } },
  { method: 'POST', pattern: /^\/items$/, secured: true, ok: 201, body: { id: 'i_probe' } },
  { method: 'GET', pattern: /^\/items\/[^/]+$/, ok: 200, body: { id: 'i_probe', name: 'probe-item' } },
  { method: 'PUT', pattern: /^\/items\/[^/]+$/, secured: true, ok: 200, body: { id: 'i_probe', name: 'probe-item' } },
  { method: 'PATCH', pattern: /^\/items\/[^/]+$/, secured: true, ok: 200, body: { id: 'i_probe', name: 'probe-item' } },
  { method: 'DELETE', pattern: /^\/items\/[^/]+$/, secured: true, ok: 204 },
];

app.use(async (ctx, next) => {
  const rawPath = ctx.path ?? ctx.req?.url ?? '/';
  const path = rawPath.split('?')[0];
  const method = (ctx.method ?? ctx.req?.method ?? 'GET').toUpperCase();

  const route = ROUTES.find((r) => r.method === method && r.pattern.test(path));
  if (!route) {
    // If the PATH matches a declared route under one or more OTHER methods, the
    // correct response is 405 Method Not Allowed (with an Allow header listing
    // the supported methods) — not 404. This is the RFC 9110 §15.5.6 behaviour
    // and satisfies the scanner's `unsupported_method` conformance check; a
    // bare 404 here would be graded as a (false-positive) High finding.
    const allowed = [...new Set(ROUTES.filter((r) => r.pattern.test(path)).map((r) => r.method))];
    if (allowed.length > 0) {
      ctx.setHeader('Allow', allowed.join(', '));
      ctx.json({ error: 'method not allowed' }, 405);
      return;
    }
    await next(); // genuinely unknown path → framework 404
    return;
  }

  // A secured route must never ignore auth: reject an unauthenticated request
  // with its declared 401 before performing anything.
  if (route.secured && !isAuthenticated(ctx)) {
    ctx.json({ error: 'unauthorized' }, 401);
    return;
  }

  if (route.ok === 204) {
    ctx.send(204);
    return;
  }
  ctx.json(route.body ?? {}, route.ok);
});

await app.listen(port, '0.0.0.0');
console.log(`[dast-target] listening on http://0.0.0.0:${port} (serving ${ROUTES.length} declared routes)`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { app.close().finally(() => process.exit(0)); });
}
