---
layout:      default
title:       "OpenTelemetry Quickstart"
parent:      "Observability"
nav_order:   1
permalink:   /observability/opentelemetry/
description: "Add distributed tracing to a StreetJS app in minutes — W3C traceparent propagation, OTLP export, DB query spans, and Jaeger/Grafana Tempo setup."
---

# OpenTelemetry Quickstart

StreetJS ships a zero-dependency OTel implementation: `OtelTracer` + `otelMiddleware`.
No `@opentelemetry/*` packages required. One span per HTTP request, W3C
`traceparent` propagation, and OTLP/HTTP export to any collector.

---

## 1. Wire the tracer

```ts
// src/main.ts
import { streetApp, OtelTracer, otelMiddleware } from 'streetjs';

const app = streetApp({ port: 3000 });

const tracer = new OtelTracer({
  serviceName: 'my-api',
  // Reads OTEL_EXPORTER_OTLP_ENDPOINT from env; defaults to http://localhost:4318
  endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
});

// Must be registered before your controllers so every request is traced.
app.use(otelMiddleware(tracer));

// Flush buffered spans on shutdown — never skip this or spans are lost.
process.once('SIGTERM', async () => {
  await tracer.flush();
  tracer.shutdown();
  await app.close();
});
```

That's it. Every request now produces a span named `"<METHOD> <path>"` with
`http.method` and `http.target` attributes, exported in batches every 5 seconds
(and on `tracer.flush()`).

---

## 2. Constructor options

```ts
new OtelTracer({
  serviceName: string;       // Required. Appears as service.name in your collector.
  endpoint?:   string;       // OTLP/HTTP base URL. Default: OTEL_EXPORTER_OTLP_ENDPOINT env var
                             // or 'http://localhost:4318'.
  maxBuffer?:  number;       // Max buffered spans before oldest are dropped. Default: 1000.
})
```

The tracer exports to `<endpoint>/v1/traces` as OTLP JSON with exponential-backoff
retry (up to 3 attempts, starting at 1 s).

---

## 3. Read the active span in a handler

The middleware stores the span on `ctx.state['otelSpan']`. Use it to add
business-level attributes or create child spans:

```ts
import { OtelTracer, Span } from 'streetjs';
import { Get, Controller } from 'streetjs';

@Controller('/orders')
class OrderController {
  @Get('/:id')
  async getOrder(ctx: StreetContext): Promise<void> {
    // Add custom attributes to the request span.
    const span = ctx.state['otelSpan'] as Span | undefined;
    span?.attributes['order.id'] = ctx.params.id;

    const order = await orderService.find(ctx.params.id);

    span?.attributes['order.status'] = order.status;
    ctx.json(order);
  }
}
```

---

## 4. Manual child spans

Create child spans for any async work within a request:

```ts
import { OtelTracer, Span } from 'streetjs';

async function processPayment(tracer: OtelTracer, parentSpan: Span, amount: number) {
  // Child span inherits the parent's traceId and links via parentSpanId.
  const span = tracer.startSpan(
    'payment.process',
    parentSpan.context,   // parent context → same traceId
    parentSpan.context.spanId, // parentSpanId for the hierarchy
  );

  span.attributes['payment.amount'] = amount;
  span.attributes['payment.currency'] = 'USD';

  try {
    const result = await gateway.charge(amount);
    span.attributes['payment.id'] = result.id;
    span.end(200);
    return result;
  } catch (err) {
    span.attributes['error'] = true;
    span.attributes['error.message'] = (err as Error).message;
    span.end(500);
    throw err;
  }
}
```

---

## 5. Instrument database queries

Wrap your pool with `instrumentPoolWithOtel` to get a `db.query` child span for
every SQL statement — only when an HTTP request span is active:

```ts
import {
  PgPool,
  OtelTracer,
  instrumentPoolWithOtel,
  Span,
} from 'streetjs';

const pool = new PgPool({ host: 'localhost', database: 'mydb', user: 'street', password: '...' });

const tracer = new OtelTracer({ serviceName: 'my-api' });

// Wrap the pool. DB spans are only created when an active HTTP span exists.
const instrumentedPool = instrumentPoolWithOtel(
  pool,
  tracer,
  // Resolver: return the active span for the current request.
  // In a real controller this would be () => ctx.state['otelSpan'] as Span | undefined
  () => undefined,
);

// In a controller, wire it per-request:
app.use(async (ctx, next) => {
  const activePool = instrumentPoolWithOtel(
    pool,
    tracer,
    () => ctx.state['otelSpan'] as Span | undefined,
  );
  ctx.state['pool'] = activePool;
  await next();
});
```

Each query emits a span like:

```
db.query
  db.system = "postgresql"
  db.statement = "SELECT * FROM orders WHERE id = $1"
  duration: 3.2ms
```

---

## 6. W3C `traceparent` propagation

`otelMiddleware` automatically reads the `traceparent` header from incoming
requests and continues that trace (same `traceId`, new `spanId`). This links
spans across services in Jaeger / Grafana Tempo without any extra config.

To propagate context to downstream services from a handler:

```ts
import { OtelTracer, Span } from 'streetjs';

async function callDownstream(tracer: OtelTracer, parentSpan: Span, url: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Inject traceparent → "00-<traceId>-<spanId>-01"
  tracer.injectContext(parentSpan.context, headers);

  const res = await fetch(url, { headers });
  return res.json();
}
```

---

## 7. Collector setup

### Jaeger (all-in-one, local dev)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then set:
```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Open **http://localhost:16686** and search for your `serviceName`.

### Grafana Tempo

```yaml
# docker-compose.yml
services:
  tempo:
    image: grafana/tempo:latest
    command: ["-config.file=/etc/tempo.yaml"]
    volumes:
      - ./tempo.yaml:/etc/tempo.yaml
    ports:
      - "4318:4318"   # OTLP HTTP
      - "3200:3200"   # Tempo query API
```

```yaml
# tempo.yaml
server:
  http_listen_port: 3200
distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: 0.0.0.0:4318
storage:
  trace:
    backend: local
    local:
      path: /tmp/tempo
```

### OpenTelemetry Collector (production)

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true
  # or tempo, datadog, honeycomb, etc.

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [jaeger]
```

---

## 8. Full wiring example

```ts
// src/main.ts
import 'reflect-metadata';
import {
  streetApp,
  OtelTracer,
  otelMiddleware,
  instrumentPoolWithOtel,
  PgPool,
  HealthCheckRegistry,
  registerHealthRoutes,
  MetricsRegistry,
  registerMetricsRoute,
  type Span,
} from 'streetjs';

const port = parseInt(process.env['PORT'] ?? '3000', 10);

// ── Tracing ───────────────────────────────────────────────────────────────────
const tracer = new OtelTracer({ serviceName: 'my-api' });

// ── Database ──────────────────────────────────────────────────────────────────
const pool = new PgPool({
  host:     process.env['PG_HOST']     ?? 'localhost',
  database: process.env['PG_DATABASE'] ?? 'mydb',
  user:     process.env['PG_USER']     ?? 'street',
  password: process.env['PG_PASSWORD'] ?? '',
});

// ── App ───────────────────────────────────────────────────────────────────────
const app = streetApp({ port });

// Tracing middleware — must come first
app.use(otelMiddleware(tracer));

// Attach an instrumented pool to every request context
app.use(async (ctx, next) => {
  ctx.state['pool'] = instrumentPoolWithOtel(
    pool,
    tracer,
    () => ctx.state['otelSpan'] as Span | undefined,
  );
  await next();
});

// Health + metrics
const health = new HealthCheckRegistry();
health.addCheck('postgres', async () => {
  await pool.query('SELECT 1');
  return { status: 'up' };
}, { type: 'readiness', timeoutMs: 3000 });

const metrics = new MetricsRegistry();
registerHealthRoutes(app, health);
registerMetricsRoute(app, metrics);

// ── Shutdown ──────────────────────────────────────────────────────────────────
process.once('SIGTERM', async () => {
  await tracer.flush();   // export remaining buffered spans
  tracer.shutdown();      // stop background flush timer
  await pool.end();
  await app.close();
});

await app.listen(port);
console.log(`[street] Listening on http://0.0.0.0:${port}`);
```

---

## API reference

### `OtelTracer`

| Method | Description |
|--------|-------------|
| `startSpan(name, parentCtx?, parentSpanId?)` | Create a new span. Pass parent context to continue a trace. |
| `extractContext(headers)` | Parse W3C `traceparent` from request headers. Returns `SpanContext \| null`. |
| `injectContext(ctx, headers)` | Write W3C `traceparent` into an outgoing headers object. |
| `flush()` | Immediately export all buffered spans. Returns a `Promise`. |
| `shutdown()` | Stop the background flush timer. Call after `flush()` on shutdown. |

### `Span`

| Property / Method | Description |
|-------------------|-------------|
| `context` | `{ traceId, spanId, traceFlags }` |
| `attributes` | `Record<string, string \| number \| boolean>` — set before calling `end()`. |
| `end(statusCode?)` | Mark the span complete. Idempotent. |
| `parentSpanId` | Set when the span was created as a child. |

### `instrumentPoolWithOtel(pool, tracer, getActiveSpan)`

Returns an `OtelInstrumentedPool` that wraps `pool.query()` — emitting a
`db.query` child span whenever `getActiveSpan()` returns a live parent span.

### `otelMiddleware(tracer)`

StreetJS middleware that:
1. Reads `traceparent` from the request headers.
2. Starts a span named `"<METHOD> <path>"` with `http.method` + `http.target` attributes.
3. Stores it on `ctx.state['otelSpan']`.
4. Ends the span with the HTTP response status code after `next()` resolves.
