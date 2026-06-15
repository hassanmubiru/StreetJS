// Live API-stability probe: boot a real streetApp on an ephemeral port using the
// public middleware pipeline, fire real HTTP requests, and verify route handling,
// middleware chaining, JSON serialization, header injection, 404, and clean close.
import { streetApp, securityHeaders, corsMiddleware } from 'streetjs';

const app = streetApp({ port: 0 });

// Middleware chain: security headers + CORS + a custom header (proves ordering).
app.use(securityHeaders);
app.use(corsMiddleware(['*']));
app.use(async (ctx, next) => { ctx.setHeader('x-audit', 'on'); await next(); });

// "Routes" via middleware (no decorators needed for this probe).
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/ping') { ctx.json({ pong: true }); return; }
  if (ctx.method === 'POST' && ctx.path === '/echo') { ctx.json({ received: ctx.body }, 201); return; }
  await next(); // fall through → framework 404
});

await app.listen(31987, '127.0.0.1');
const base = `http://127.0.0.1:31987`;

let pass = true;
const expect = (label, cond) => { console.log(`${label}: ${cond ? 'OK' : 'FAIL'}`); pass = pass && cond; };

// 1. Route + serialization + middleware header
const r1 = await fetch(`${base}/ping`);
const j1 = await r1.json();
expect('route+json', r1.status === 200 && j1.pong === true);
expect('middleware-header', r1.headers.get('x-audit') === 'on');
expect('security-headers', !!r1.headers.get('x-content-type-options'));

// 2. POST body parse + serialization + status code
const r2 = await fetch(`${base}/echo`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ a: 1 }),
});
const j2 = await r2.json();
expect('post-body+status', r2.status === 201 && j2.received?.a === 1);

// 3. 404 handling
const r3 = await fetch(`${base}/nope`);
expect('404-handling', r3.status === 404);

await app.close();
console.log(pass ? 'RESULT: API stability OK' : 'RESULT: API stability FAIL');
process.exit(pass ? 0 : 1);
