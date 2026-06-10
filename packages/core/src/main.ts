// src/main.ts
// Dual-mode entry: CLI if argv has a command, otherwise boot clustered HTTP server.

import 'reflect-metadata';
import cluster from 'node:cluster';
import { resolve } from 'node:path';

import { container } from './core/container.js';
import { AppConfig } from './config/index.js';
import { PgPool } from './database/pool.js';
import { TelemetryTracker } from './telemetry/tracker.js';
import { StreetWebSocketServer } from './websocket/server.js';
import { RateLimiter } from './security/ratelimit.js';
import { streetApp } from './http/server.js';
import { HealthCheckRegistry, registerHealthRoutes, createDbReadinessCheck } from './observability/health.js';
import { StreetMigrationRunner } from './database/migrations.js';
import { UserRepository } from './services/user.repository.js';
import { UserService } from './services/user.service.js';
import { UserController } from './controllers/user.controller.js';
import { HealthController } from './controllers/health.controller.js';
import { ClusterCoordinator, workerHeartbeat, signalReady } from './cluster/coordinator.js';
import { CliKernel, parseArgv } from './cli/kernel.js';
import { MigrateCommand, UserCommand } from './cli/commands.js';
import { securityHeaders, corsMiddleware, csrfMiddleware } from './http/auth.middleware.js';
import { xssMiddleware } from './security/xss.js';
import { telemetryMiddleware } from './telemetry/tracker.js';
import { OtelTracer, otelMiddleware } from './observability/otel.js';
import { JwtService } from './security/jwt.js';
import { SessionManager } from './security/session.js';
import { WebhookDispatcher } from './webhook/dispatcher.js';
import { LruCache } from './cache/lru.js';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // 1. Load configuration
  const config = new AppConfig();
  config.load(process.env['KEK']);
  container.register(AppConfig, config);

  // 2. Build database pool.
  //
  // DB_INIT_MODE controls whether the pool is warmed up at bootstrap (Requirement 2.12):
  //   - 'lazy' (default): register the pool but do NOT initialize it here. The pool
  //     warms up on first acquire/query via pool.ensureInitialized(), so the app boots
  //     and serves health without a provisioned PostgreSQL instance.
  //   - 'eager': initialize the pool now (legacy behavior); a missing DB blocks startup.
  //   - 'provisioned': the platform guarantees the DB; bootstrap does not block on it and
  //     readiness gates on first successful connection.
  const pool = new PgPool({
    host: config.pgHost,
    port: config.pgPortNumber,
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
    minConnections: 2,
    maxConnections: 10,
    idleTimeoutMs: 30_000,
    acquireTimeoutMs: 5_000,
  });
  container.register(PgPool, pool);

  if (config.dbInitMode === 'eager') {
    await pool.initialize();
  }
  // 'lazy' and 'provisioned' defer warm-up to first database use.

  // 3. Register services
  const telemetry = new TelemetryTracker(60_000);
  container.register(TelemetryTracker, telemetry);

  const wsServer = new StreetWebSocketServer({ heartbeatIntervalMs: 30_000, maxConnections: 10_000 });
  container.register(StreetWebSocketServer, wsServer);

  const userRepo = container.resolve(UserRepository);
  container.register(UserRepository, userRepo);

  const userService = container.resolve(UserService);
  container.register(UserService, userService);

  container.register(StreetMigrationRunner, container.resolve(StreetMigrationRunner));

  // Supplemental singletons (not injected via constructor here, registered for completeness)
  container.register(JwtService, new JwtService(config.jwtSecret));
  container.register(SessionManager, new SessionManager(config.sessionKey));
  container.register(WebhookDispatcher, new WebhookDispatcher());
  container.register(LruCache, new LruCache({ maxEntries: 1000, ttlMs: 60_000 }));

  // ─── CLI mode ────────────────────────────────────────────────────────────────
  const args = parseArgv(process.argv);
  if (args.command !== null) {
    const cli = new CliKernel({ appName: 'street', version: '1.0.0' });
    cli.register(MigrateCommand);
    cli.register(UserCommand);
    await cli.run(args);
    await pool.close();
    telemetry.destroy();
    return;
  }

  // ─── HTTP server mode ─────────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });

  // OpenTelemetry tracer: endpoint from OTEL_EXPORTER_OTLP_ENDPOINT (falls back
  // to the constructor default when unset). Flushed before pool close on shutdown.
  const tracer = new OtelTracer({
    serviceName: 'street',
    endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
  });

  const app = streetApp({
    port: config.httpPort,
    host: config.host,
    uploadsDir: resolve(config.uploadsDir),
    requestTimeoutMs: 30_000,
    maxBodyBytes: 1024 * 1024,
  });

  // Global middleware stack
  app.use(securityHeaders);
  // Finding A fix: use config-driven origins instead of hardcoded wildcard.
  // In production, ALLOWED_ORIGINS env var must be set (corsOrigins getter enforces this).
  // In development/test, falls back to ['*'] automatically.
  app.use(corsMiddleware(config.corsOrigins));
  app.use(xssMiddleware);
  app.use(otelMiddleware(tracer));
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());
  // Finding C fix: wire CSRF protection for all state-changing requests.
  // Requires session middleware to populate ctx.state['session'] with a csrf field.
  // Safe methods (GET, HEAD, OPTIONS) are automatically exempt.
  app.use(csrfMiddleware());

  // Register controllers
  const healthCtrl = container.resolve(HealthController);
  container.register(HealthController, healthCtrl);
  app.registerController(HealthController);
  app.registerController(UserController);

  // Kubernetes/orchestrator probe endpoints: GET /health/live and /health/ready
  // (match the liveness/readiness probe paths emitted by generateManifest()).
  //
  // Liveness MUST never depend on the database: no DB check is registered for it,
  // so /health/live reports the process is alive regardless of DB state (Req 2.12).
  //
  // Readiness treats the database as a *declared provisioned dependency*: it is
  // `up` when no DB is configured/expected, and `down` only when a configured DB
  // is unreachable. A no-DB deployment therefore serves both endpoints 200 within
  // 5s. We never probe the DB when it is not configured, so readiness stays fast.
  const healthRegistry = new HealthCheckRegistry();
  const dbExpected = config.pgHost.trim().length > 0;
  healthRegistry.addCheck(
    'database',
    createDbReadinessCheck({
      expected: dbExpected,
      // Reachability probe: a trivial round-trip that warms/validates the pool.
      probe: () => pool.query('SELECT 1').then(() => undefined),
    }),
    { type: 'readiness', timeoutMs: 5000 },
  );
  registerHealthRoutes(app, healthRegistry);

  // Inject OpenAPI spec into health controller's context via state
  const spec = app.openApiSpec();

  // Patch health controller to include spec in state
  app.use(async (ctx, next) => {
    ctx.state['openApiSpec'] = spec;
    await next();
  });

  // Start HTTP server
  await app.listen(config.httpPort, config.host);

  // Attach WebSocket
  // Note: app.listen returns void; we use the raw server via Node's http internals
  // The wsServer is available for manual attachment; for full integration, expose server handle.

  // Signal ready to primary (worker mode)
  signalReady();
  const heartbeatTimer = workerHeartbeat(5_000);

  // ─── Graceful shutdown ────────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[street] Received ${signal}. Shutting down gracefully...`);
    clearInterval(heartbeatTimer);

    try {
      await app.close();
      await wsServer.close();
      // Drain buffered spans before connections drop, then stop the flush timer.
      await tracer.flush();
      tracer.shutdown();
      await pool.close();
      telemetry.destroy();
      rateLimiter.destroy();
      console.log('[street] Clean shutdown complete.');
    } catch (err) {
      console.error('[street] Shutdown error:', err);
    }

    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

// ─── Cluster entry ─────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgv(process.argv);
  const isCli = args.command !== null;
  const workerMode = Boolean(process.env['CLUSTER_WORKER']);

  // CLI commands always run in single-process mode
  if (isCli || workerMode || process.env['NODE_ENV'] === 'test') {
    bootstrap().catch((err) => {
      console.error('[street] Fatal bootstrap error:', err);
      process.exit(1);
    });
    return;
  }

  // Production: cluster primary spawns workers
  if (cluster.isPrimary && process.env['NODE_ENV'] === 'production') {
    const coordinator = new ClusterCoordinator({
      workers: parseInt(process.env['WORKERS'] ?? '0', 10) || undefined,
      heartbeatIntervalMs: 10_000,
      heartbeatTimeoutMs: 30_000,
    });
    coordinator.start();

    process.once('SIGTERM', () => {
      coordinator.shutdown();
      process.exit(0);
    });
    process.once('SIGINT', () => {
      coordinator.shutdown();
      process.exit(0);
    });
    return;
  }

  // Development or explicit single-process
  bootstrap().catch((err) => {
    console.error('[street] Fatal bootstrap error:', err);
    process.exit(1);
  });
}

main();
