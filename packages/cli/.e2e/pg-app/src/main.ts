// src/main.ts
// Street application entry point.

import 'reflect-metadata';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  streetApp,
  container,
  securityHeaders,
  corsMiddleware,
  xssMiddleware,
  telemetryMiddleware,
  TelemetryTracker,
  RateLimiter,
  StreetWebSocketServer,
  PgPool,
  StreetMigrationRunner,
  JwtService,
  SessionManager,
  WebhookDispatcher,
  LruCache,
} from 'streetjs';
import { HealthController } from './controllers/health.controller.js';
import { ExampleController } from './controllers/example.controller.js';

async function bootstrap(): Promise<void> {
  // ── Configuration ────────────────────────────────────────────────────
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const uploadsDir = resolve(process.env['UPLOADS_DIR'] ?? './uploads');
  // Note: MIGRATIONS_DIR env var is used by the migration runner internally

  // ── Secrets ──────────────────────────────────────────────────────────
  // JwtService requires a secret ≥32 chars; SessionManager requires a 64-char
  // hex key. In development we generate a valid ephemeral key when one isn't
  // provided (so first run works with zero config). In production these MUST be
  // set explicitly — we fail fast rather than start with throwaway keys.
  const isProd = (process.env['NODE_ENV'] ?? 'development') === 'production';
  const resolveSecret = (name: string, bytes: number): string => {
    const provided = process.env[name];
    if (provided && provided.length > 0) return provided;
    if (isProd) {
      throw new Error(`${name} must be set in production. Generate one with: openssl rand -hex ${bytes}`);
    }
    console.warn(`[street] ${name} not set — using an ephemeral development key. Set it in .env for stable sessions/tokens and for production.`);
    return randomBytes(bytes).toString('hex');
  };
  const jwtSecret = resolveSecret('JWT_SECRET', 24);   // 48 hex chars (≥32)
  const sessionKey = resolveSecret('SESSION_KEY', 32);  // 64 hex chars

  // ── Database ─────────────────────────────────────────────────────────
  // PostgreSQL: validate credentials BEFORE opening a connection. We never
  // guess a username/password — missing credentials are a configuration error,
  // not something to paper over with 'postgres'/'postgres'.
  function requireEnv(name: string): string | null {
    const v = process.env[name];
    return v && v.length > 0 ? v : null;
  }
  const pgUser = requireEnv('PG_USER');
  const pgPassword = requireEnv('PG_PASSWORD');
  const pgDatabase = requireEnv('PG_DATABASE');

  let pool: PgPool | null = null;
  if (!pgUser || !pgPassword || !pgDatabase) {
    const missing = [
      !pgUser ? 'PG_USER' : null,
      !pgPassword ? 'PG_PASSWORD' : null,
      !pgDatabase ? 'PG_DATABASE' : null,
    ].filter(Boolean).join(', ');
    console.warn(
      `[street] Database not configured: missing ${missing}.\n` +
      '[street] Copy .env.example to .env and set your PostgreSQL credentials,\n' +
      '[street] or recreate the project with: street create <name> --database sqlite\n' +
      '[street] The server will start, but database-backed routes will return 503 until configured.'
    );
  } else {
    pool = new PgPool({
      host: process.env['PG_HOST'] ?? 'localhost',
      port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      minConnections: 2,
      maxConnections: 10,
      idleTimeoutMs: 30_000,
      acquireTimeoutMs: 5_000,
    });
    try {
      await pool.initialize();
      container.register(PgPool, pool);
      container.register(StreetMigrationRunner, new StreetMigrationRunner(pool));
      console.log('[street] Database ready (postgres).');
    } catch (err) {
      // Do not crash the dev server on a database connection failure — surface a
      // clear, actionable message and keep serving (health + non-DB routes work).
      console.warn(
        `[street] Could not connect to PostgreSQL: ${err instanceof Error ? err.message : String(err)}\n` +
        '[street] Check PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE in your .env.\n' +
        '[street] The server will start, but database-backed routes will return 503 until the database is reachable.'
      );
      await pool.close().catch(() => {});
      pool = null;
    }
  }

  // ── Services ─────────────────────────────────────────────────────────
  const telemetry = new TelemetryTracker(60_000);
  container.register(TelemetryTracker, telemetry);

  const wsServer = new StreetWebSocketServer({
    heartbeatIntervalMs: 30_000,
    maxConnections: 10_000,
  });
  container.register(StreetWebSocketServer, wsServer);

  container.register(JwtService, new JwtService(jwtSecret));
  container.register(SessionManager, new SessionManager(sessionKey));
  container.register(WebhookDispatcher, new WebhookDispatcher());
  container.register(LruCache, new LruCache({ maxEntries: 1000, ttlMs: 60_000 }));

  // ── HTTP server ──────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });

  const app = streetApp({
    port,
    host,
    uploadsDir,
    requestTimeoutMs: 30_000,
    maxBodyBytes: 1_048_576,
  });

  // Global middleware
  app.use(securityHeaders);
  app.use(corsMiddleware(['*']));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());

  // Register controllers
  app.registerController(HealthController);
  app.registerController(ExampleController);

  // ── OpenAPI spec ──────────────────────────────────────────────────────
  const openApiSpec = app.openApiSpec();
  app.use(async (ctx, next) => {
    if (ctx.path === '/openapi.json' && ctx.method === 'GET') {
      ctx.json(openApiSpec);
      return;
    }
    await next();
  });

  // ── Start server ─────────────────────────────────────────────────────
  await app.listen(port, host);

  // ── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[street] Received ${signal}. Shutting down...`);
    try {
      await app.close();
      await wsServer.close();
      if (pool) await pool.close();
      telemetry.destroy();
      rateLimiter.destroy();
    } catch (err) {
      console.error('[street] Shutdown error:', err);
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[street] Fatal error:', err);
  process.exit(1);
});
