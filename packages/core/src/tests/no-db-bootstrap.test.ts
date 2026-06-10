// src/tests/no-db-bootstrap.test.ts
// Integration test for no-DB bootstrap (Requirement 2.12).
//
// Verifies that when the application bootstraps in a deployment environment with
// NO provisioned PostgreSQL instance, the framework:
//   1. completes startup within 30 seconds, and
//   2. serves BOTH Health Endpoints (/health/live and /health/ready) with HTTP 200
//      within 5 seconds per request — without requiring a database connection at
//      bootstrap (DB pool initialization is deferred to first use, DB_INIT_MODE=lazy).
//
// The test reproduces the no-DB bootstrap path from packages/core/src/main.ts in
// process: it builds the real PgPool (never initialized), wires the real global
// middleware stack, registers the real health routes via createDbReadinessCheck
// treating the database as a declared provisioned dependency, and starts a real
// HTTP server. Uses ONLY node:test and node:assert/strict.

import 'reflect-metadata';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

import { streetApp, type StreetApp } from '../http/server.js';
import { PgPool } from '../database/pool.js';
import { TelemetryTracker, telemetryMiddleware } from '../telemetry/tracker.js';
import { RateLimiter } from '../security/ratelimit.js';
import { securityHeaders, corsMiddleware, csrfMiddleware } from '../http/auth.middleware.js';
import { xssMiddleware } from '../security/xss.js';
import {
  HealthCheckRegistry,
  registerHealthRoutes,
  createDbReadinessCheck,
} from '../observability/health.js';

// ── HTTP helper ─────────────────────────────────────────────────────────────

interface TimedResponse {
  status: number;
  body: string;
  elapsedMs: number;
}

function get(port: number, path: string, attempt = 0): Promise<TimedResponse> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            elapsedMs: Date.now() - start,
          }),
        );
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      // Retry only transient connection-level errors (server bind race under
      // heavy parallel test load); HTTP-status/timing assertions are unaffected.
      if ((err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') && attempt < 5) {
        setTimeout(() => { get(port, path, attempt + 1).then(resolve, reject); }, 25 * (attempt + 1));
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

// Randomize the base port per run to avoid colliding with sockets left in
// TIME_WAIT by a previous run on the same machine.
let testPort = 54900 + Math.floor(Math.random() * 500);
function nextPort(): number { return testPort++; }

// ── No-DB bootstrap harness ───────────────────────────────────────────────────

interface BootedApp {
  app: StreetApp;
  pool: PgPool;
  telemetry: TelemetryTracker;
  rateLimiter: RateLimiter;
  /** Wall-clock time from the start of bootstrap until the server is listening. */
  startupMs: number;
}

/**
 * Reproduce the no-DB bootstrap path from main.ts.
 *
 * @param pgHost  The configured PostgreSQL host. An empty string models a
 *                deployment with NO provisioned PostgreSQL (the DB is an
 *                undeclared dependency, so readiness reports `up`). A non-empty
 *                but unreachable host models a configured-but-unprovisioned DB.
 */
async function bootstrapNoDb(port: number, pgHost: string): Promise<BootedApp> {
  const startedAt = Date.now();

  // 1. Build the database pool WITHOUT initializing it (DB_INIT_MODE=lazy).
  //    The pool warms up on first acquire/query via ensureInitialized(), so
  //    bootstrap never attempts a database connection.
  const pool = new PgPool({
    host: pgHost,
    port: 5432,
    user: 'street',
    password: 'street',
    database: 'street',
    minConnections: 2,
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    acquireTimeoutMs: 5_000,
  });
  // NOTE: pool.initialize() is intentionally NOT called (lazy mode).

  // 2. Real services that the bootstrap wires up.
  const telemetry = new TelemetryTracker(60_000);
  const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });

  // 3. Build the HTTP app with the global middleware stack (as in main.ts).
  const app = streetApp({
    port,
    host: '127.0.0.1',
    requestTimeoutMs: 30_000,
    maxBodyBytes: 1024 * 1024,
  });
  app.use(securityHeaders);
  app.use(corsMiddleware(['*']));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());
  app.use(csrfMiddleware());

  // 4. Health endpoints. Liveness never depends on the DB; readiness treats the
  //    DB as a declared provisioned dependency: `up` when no DB is configured,
  //    `down` only when a configured DB is unreachable.
  const registry = new HealthCheckRegistry();
  const dbExpected = pgHost.trim().length > 0;
  registry.addCheck(
    'database',
    createDbReadinessCheck({
      expected: dbExpected,
      probe: () => pool.query('SELECT 1').then(() => undefined),
    }),
    { type: 'readiness', timeoutMs: 5000 },
  );
  registerHealthRoutes(app, registry);

  // 5. Start the server. With no provisioned PostgreSQL this must not block.
  await app.listen(port, '127.0.0.1');

  return { app, pool, telemetry, rateLimiter, startupMs: Date.now() - startedAt };
}

async function teardown(b: BootedApp): Promise<void> {
  await b.app.close();
  b.telemetry.destroy();
  b.rateLimiter.destroy();
  await b.pool.close();
}

// Requirement 2.12 time bounds.
const STARTUP_BUDGET_MS = 30_000;
const HEALTH_BUDGET_MS = 5_000;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('no-DB bootstrap (Requirement 2.12)', () => {
  const booted: BootedApp[] = [];
  after(async () => { for (const b of booted) await teardown(b); });

  it('completes startup within 30s with no provisioned PostgreSQL', async () => {
    const b = await bootstrapNoDb(nextPort(), '');
    booted.push(b);
    assert.ok(
      b.startupMs < STARTUP_BUDGET_MS,
      `startup took ${b.startupMs}ms, expected < ${STARTUP_BUDGET_MS}ms`,
    );
  });

  it('serves /health/live with 200 within 5s when no DB is provisioned', async () => {
    const port = nextPort();
    const b = await bootstrapNoDb(port, '');
    booted.push(b);

    const res = await get(port, '/health/live');
    assert.equal(res.status, 200, 'liveness must return 200 without a database');
    assert.ok(res.elapsedMs < HEALTH_BUDGET_MS, `liveness took ${res.elapsedMs}ms, expected < ${HEALTH_BUDGET_MS}ms`);
    const parsed = JSON.parse(res.body) as { status: string };
    assert.equal(parsed.status, 'ok');
  });

  it('serves /health/ready with 200 within 5s when no DB is provisioned', async () => {
    const port = nextPort();
    const b = await bootstrapNoDb(port, '');
    booted.push(b);

    const res = await get(port, '/health/ready');
    assert.equal(res.status, 200, 'readiness must return 200 when no DB is configured/expected');
    assert.ok(res.elapsedMs < HEALTH_BUDGET_MS, `readiness took ${res.elapsedMs}ms, expected < ${HEALTH_BUDGET_MS}ms`);
    const parsed = JSON.parse(res.body) as { status: string; checks: Record<string, { status: string }> };
    assert.equal(parsed.status, 'ok');
    // The DB is reported up as an undeclared (not-configured) dependency without probing.
    assert.equal(parsed.checks['database']?.status, 'up');
  });

  it('both health endpoints return 200 within the 5s budget in a single boot', async () => {
    const port = nextPort();
    const b = await bootstrapNoDb(port, '');
    booted.push(b);

    // Startup is bounded by Req 2.12 as well.
    assert.ok(b.startupMs < STARTUP_BUDGET_MS, `startup took ${b.startupMs}ms`);

    const live = await get(port, '/health/live');
    const ready = await get(port, '/health/ready');

    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.ok(live.elapsedMs < HEALTH_BUDGET_MS, `liveness took ${live.elapsedMs}ms`);
    assert.ok(ready.elapsedMs < HEALTH_BUDGET_MS, `readiness took ${ready.elapsedMs}ms`);
  });

  it('boots fast and keeps liveness 200 even when a configured DB is unreachable (lazy)', async () => {
    // Models DB_INIT_MODE=lazy with a configured but UNPROVISIONED PostgreSQL:
    // bootstrap must not block on the unreachable DB. 203.0.113.0/24 is TEST-NET-3
    // (reserved, non-routable) so any connection attempt would hang/refuse — proving
    // bootstrap never connected.
    const port = nextPort();
    const b = await bootstrapNoDb(port, '203.0.113.1');
    booted.push(b);

    assert.ok(
      b.startupMs < STARTUP_BUDGET_MS,
      `startup took ${b.startupMs}ms with an unreachable DB, expected < ${STARTUP_BUDGET_MS}ms`,
    );

    // Liveness never depends on the DB, so it stays 200 within budget.
    const live = await get(port, '/health/live');
    assert.equal(live.status, 200, 'liveness must stay 200 regardless of DB reachability');
    assert.ok(live.elapsedMs < HEALTH_BUDGET_MS, `liveness took ${live.elapsedMs}ms`);
  });
});
