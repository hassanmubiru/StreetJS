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
  SqlitePool,
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

  // ── CORS ─────────────────────────────────────────────────────────────
  // SECURITY: the default ['*'] allows requests from ANY origin, which is fine
  // for local development but UNSAFE in production — it lets any website call
  // your API with the user's credentials. Set CORS_ORIGINS to a comma-separated
  // allowlist (e.g. "https://app.example.com,https://admin.example.com") before
  // deploying. In production we refuse to fall back to the wildcard.
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (corsOrigins.length === 0) {
    if (isProd) {
      throw new Error('CORS_ORIGINS must be set in production (comma-separated allowlist of trusted origins).');
    }
    console.warn('[street] CORS_ORIGINS not set — allowing all origins (*) for development only. Set an allowlist before deploying.');
    corsOrigins.push('*');
  }

  // ── Database ─────────────────────────────────────────────────────────
  // SQLite: zero-config, no server or credentials required. The default
  // ':memory:' database is ephemeral (resets on restart). Set SQLITE_PATH to a
  // file for local persistence, or recreate with \`--database postgres\` for
  // production.
  const pool = new SqlitePool({ filePath: process.env['SQLITE_PATH'] ?? ':memory:' });
  // Bootstrap the example schema so the app works out of the box.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  container.register(SqlitePool, pool);
  console.log('[street] Database ready (sqlite).');

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
  app.use(corsMiddleware(corsOrigins));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());

  // Register controllers
  // WARNING: The example routes below are UNAUTHENTICATED and must be protected
  // before public exposure. Use JwtService or SessionManager (see src/middleware/auth.ts)
  // to add authentication guards before deploying to production.
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
      await pool.close();
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
