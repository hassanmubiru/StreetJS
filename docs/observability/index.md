---
title: Observability
nav_order: 7
has_children: true
---

# Observability

Street ships with a complete observability stack: structured logging, Prometheus metrics, OpenTelemetry tracing, health checks, and a route performance profiler. All components are zero-dependency and self-contained.

## Components

| Component | Export | Purpose |
|-----------|--------|---------|
| Logger | `Logger`, `correlationMiddleware` | Structured JSON logging with child loggers and GCP Cloud Run support |
| Prometheus | `MetricsRegistry`, `prometheusMiddleware`, `metricsHandler` | Prometheus text exposition with request counters, latency histograms, and DB pool gauges |
| OpenTelemetry | `OtelTracer`, `otelMiddleware` | OTel-compatible spans for request tracing |
| Health Checks | `HealthCheckRegistry`, `registerHealthRoutes` | Liveness and readiness probes with timeout and delay support |
| Route Profiler | `RouteProfiler` | Per-route latency sampling and percentile reporting |

---

## Logger

```typescript
import { Logger, correlationMiddleware } from '@streetjs/core';

const logger = new Logger({ service: 'my-api', level: 'info' });

// Basic usage
logger.info('Server started', { port: 3000 });
logger.error('Database connection failed', { error: new Error('ECONNREFUSED') });

// Child logger with bound fields
const reqLogger = logger.child({ requestId: '...', userId: '...' });
reqLogger.info('Processing request');

// Add correlation IDs to every request automatically
app.use(correlationMiddleware(logger));
// ctx.state['logger'] is now a child logger bound to the correlation ID
// ctx.state['correlationId'] contains the X-Correlation-ID header value
```

### Cloud Run Logging

When the `K_SERVICE` environment variable is set (automatically set by Cloud Run), the logger switches to **GCP structured logging format**:

```json
{
  "severity": "INFO",
  "message": "Server started",
  "service": "my-api",
  "port": 3000,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

GCP's log explorer interprets `severity` for filtering and alerting. The `severity` values are: `DEBUG`, `INFO`, `WARNING`, `ERROR`.

---

## Prometheus Metrics

```typescript
import {
  MetricsRegistry, prometheusMiddleware, metricsHandler,
} from '@streetjs/core';
import { PgPool } from '@streetjs/core';

const pool = new PgPool({ host: 'localhost', database: 'mydb', ... });
const metrics = new MetricsRegistry();

// Register default metrics + DB pool gauge
app.use(prometheusMiddleware(metrics, pool));

// Expose /metrics endpoint
app.use(async (ctx, next) => {
  if (ctx.path === '/metrics') {
    return metricsHandler(metrics)(ctx, next);
  }
  await next();
});
```

Default metrics registered automatically:

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | Counter | `method`, `route`, `status` |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` |
| `process_heap_bytes` | Gauge | — |
| `db_pool_connections` | Gauge | `state` (idle/active/waiting) |

**Heap metric optimization:** `process_heap_bytes` is sampled on a 5-second background interval rather than per-request, avoiding `memoryUsage()` overhead on high-traffic servers.

### Custom Metrics

```typescript
const loginCounter = metrics.counter('auth_logins_total', 'Total login attempts', ['result']);
loginCounter.inc({ result: 'success' });
loginCounter.inc({ result: 'failure' });

const dbQueryDuration = metrics.histogram(
  'db_query_duration_seconds', 'Query latency',
  [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  ['operation'],
);
dbQueryDuration.observe(0.023, { operation: 'SELECT' });
```

---

## OpenTelemetry

```typescript
import { OtelTracer, otelMiddleware } from '@streetjs/core';

const tracer = new OtelTracer({ serviceName: 'my-api' });
app.use(otelMiddleware(tracer));

// Manual spans
const span = tracer.startSpan('db.query', { sql: 'SELECT ...' });
try {
  const result = await pool.query('SELECT ...');
  span.end({ rowCount: result.rowCount });
} catch (err) {
  span.error(err as Error);
  throw err;
}
```

OTel spans are emitted as OTLP-compatible records. Connect a collector like Jaeger, Tempo, or OpenTelemetry Collector via the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable.

---

## Health Checks

```typescript
import { HealthCheckRegistry, registerHealthRoutes } from '@streetjs/core';

const health = new HealthCheckRegistry();

// Liveness check — is the process alive?
health.addCheck('heartbeat', async () => ({ status: 'up' }), { type: 'liveness' });

// Readiness check — can the app serve traffic?
health.addCheck(
  'postgres',
  async () => {
    await pool.query('SELECT 1');
    return { status: 'up' };
  },
  { type: 'readiness', timeoutMs: 3000 },
);

registerHealthRoutes(app, health);
// GET /health/live  → { status: 'ok', checks: { heartbeat: { status: 'up', durationMs: 0 } } }
// GET /health/ready → 503 during startup delay or if postgres is down
```

### Startup Readiness Delay

Set `STREET_READINESS_DELAY_MS` to delay the readiness probe during startup (e.g. waiting for cache warm-up):

```bash
STREET_READINESS_DELAY_MS=10000  # 10 seconds
```

During the delay period, `/health/ready` returns `503 degraded` with the remaining milliseconds.

---

## Route Profiler

```typescript
import { RouteProfiler } from '@streetjs/core';

const profiler = new RouteProfiler();

app.use(async (ctx, next) => {
  const start = process.hrtime.bigint();
  await next();
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  profiler.record(ctx.method + ' ' + ctx.path, durationMs);
});

// Get stats for any route
const stats = profiler.stats('GET /api/users');
console.log(stats);
// { p50: 3.2, p95: 12.1, p99: 45.0, count: 1024, mean: 4.1 }
```
