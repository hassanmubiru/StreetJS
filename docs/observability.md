---
layout:      default
title:       "Observability in 5 Minutes"
permalink:   /observability-guide/
nav_exclude: true
description:  "Task-oriented guide: make a StreetJS app observable — Prometheus /metrics, Kubernetes liveness/readiness probes, and OpenTelemetry tracing with W3C context propagation — using built-in primitives, no extra dependencies."
---

# Observability in 5 Minutes

Goal: make a running StreetJS app answer the three operator questions — *is it
up?* (health), *how is it behaving?* (metrics), and *where did this request go?*
(traces) — using built-in primitives. New apps scaffolded with `street create`
already wire health and metrics; this guide shows what you get and how to add
tracing.

## 1. Health probes (already wired)

A scaffolded app serves two endpoints that match the probe paths emitted by
`street deploy:init` (Kubernetes/Cloud Run):

- `GET /health/live` — liveness. Never depends on external services; answers 200
  as long as the process is alive.
- `GET /health/ready` — readiness. Gate on real dependencies by adding checks.

```ts
import { HealthCheckRegistry, registerHealthRoutes } from 'streetjs';

const health = new HealthCheckRegistry();
// Add a readiness check that must pass before the pod receives traffic:
health.addCheck('database', async () => {
  await pool.query('SELECT 1');
  return { status: 'up' };
}, { type: 'readiness', timeoutMs: 4000 });

registerHealthRoutes(app, health); // GET /health/live + /health/ready
```

Liveness stays green even when the DB is down (so Kubernetes doesn't kill a pod
during a transient outage); readiness flips to 503 so traffic drains until the
dependency recovers.

## 2. Prometheus metrics (already wired)

Scaffolded apps expose `GET /metrics` in the standard exposition format:

```ts
import { MetricsRegistry, registerMetricsRoute } from 'streetjs';

const metrics = new MetricsRegistry();
registerMetricsRoute(app, metrics); // records http_requests_total,
                                     // http_request_duration_seconds, process_heap_bytes
```

Point Prometheus at it:

```yaml
scrape_configs:
  - job_name: my-app
    static_configs:
      - targets: ['my-app:3000']
    metrics_path: /metrics
```

Add your own business metrics on the same registry:

```ts
const signups = metrics.counter('signups_total', 'User signups', ['plan']);
signups.inc({ plan: 'pro' });
```

## 3. Distributed tracing (OpenTelemetry)

Add `otelMiddleware` to emit one span per request, with **W3C `traceparent`
propagation** (incoming trace context is honored, so spans link across services)
and OTLP export to any collector:

```ts
import { OtelTracer, otelMiddleware } from 'streetjs';

const tracer = new OtelTracer({
  serviceName: 'my-app',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
});

app.use(otelMiddleware(tracer)); // span "GET /path" with http.method / http.target

// On shutdown, flush buffered spans:
process.once('SIGTERM', async () => { await tracer.flush(); tracer.shutdown(); });
```

Each request produces a span named `"<METHOD> <path>"`; a request arriving with a
`traceparent` header continues that trace (same `traceId`), and spans are batched
and exported to your collector's `/v1/traces` endpoint as OTLP JSON. The active
span is on `ctx.state.otelSpan` if you want to add attributes or child spans in a
handler.

## Put it together

```ts
const app = streetApp({ port, host });

registerHealthRoutes(app, healthRegistry);   // /health/live, /health/ready
registerMetricsRoute(app, metricsRegistry);  // /metrics
app.use(otelMiddleware(tracer));             // traces

// ...your controllers...
await app.listen(port, host);
```

Health and metrics are unauthenticated and cheap by design (probes and scrapes
must never be gated or rate-limited). In production, expose `/metrics` only on
your internal network or scrape port, not the public ingress.

---

*Every snippet here reflects the real `HealthCheckRegistry` / `MetricsRegistry` /
`OtelTracer` API and was exercised end-to-end against a running app: `/metrics`
counters increment per request, `/health/live` + `/health/ready` return 200, and
OTel spans export via OTLP with W3C `traceparent` propagation confirmed.*
