# @streetjs/metrics

The metrics foundation for StreetJS: a **Prometheus-compatible** metrics library with
**Counter**, **Gauge**, and **Histogram** types, labels, a registry, the text
exposition format, and optional default process metrics.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS
minimal, carefully curated dependency footprint. Generic and reusable by any
application — not tied to any particular StreetJS package.

```bash
npm install @streetjs/metrics
```

## Why

Every StreetJS package (runtime-http, jobs, database, cache, …) and every application
needs to count events, track gauges, and time operations, then expose them for
scraping. `@streetjs/metrics` provides the three standard metric types and a registry
that renders the Prometheus exposition format — once, behind small interfaces — so any
package can declare metrics and any app can expose them at `/metrics`.

## Quick start

```ts
import { MetricsRegistry, Counter, Histogram } from '@streetjs/metrics';

const registry = new MetricsRegistry();

const requests = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests.',
  labelNames: ['method', 'status'],
});
const latency = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['route'],
});
registry.register(requests);
registry.register(latency);

requests.inc({ method: 'GET', status: '200' });
const done = latency.startTimer({ route: '/users' });
// ... handle request ...
done(); // observes elapsed seconds

// Serve the exposition format:
res.setHeader('Content-Type', registry.contentType);
res.end(registry.render());
```

## Metric types

### Counter — monotonically increasing

```ts
const c = new Counter({ name: 'events_total', help: 'events', labelNames: ['kind'] });
c.inc();                       // unlabeled counters only
c.inc({ kind: 'login' });      // +1
c.inc({ kind: 'login' }, 5);   // +5
c.value({ kind: 'login' });    // read
```

Incrementing by a negative amount throws.

### Gauge — goes up and down

```ts
const g = new Gauge({ name: 'queue_depth', help: 'depth', labelNames: ['queue'] });
g.set({ queue: 'a' }, 10);
g.inc({ queue: 'a' });
g.dec({ queue: 'a' }, 2);
g.setToCurrentTime();          // seconds since epoch
const done = g.startTimer();   // sets the gauge to elapsed seconds when called
done();
```

### Histogram — distributions (latencies, sizes)

```ts
const h = new Histogram({
  name: 'request_bytes',
  help: 'request size',
  buckets: [100, 1_000, 10_000], // ascending; +Inf is implicit
});
h.observe(512);
h.startTimer()();               // observe elapsed seconds
```

Renders cumulative `_bucket{le="…"}` series plus `_sum` and `_count`. Default buckets
(`DEFAULT_BUCKETS`) are latency-oriented seconds. Following Prometheus guidance, this
library provides histograms (aggregatable) rather than summaries with client-side
quantiles.

## Labels

Declare `labelNames` up front; every observation must supply **exactly** those labels
(missing or extra labels throw). Values may be strings, numbers, or booleans and are
coerced to strings. Label order at the call site does not matter — series are keyed
deterministically.

```ts
requests.inc({ status: 200, method: 'GET' }); // 200 → "200"
```

Names follow Prometheus rules (`[a-zA-Z_][a-zA-Z0-9_]*`); names starting with `__` are
reserved, and `le` is reserved for histograms.

## Registry & exposition

```ts
const registry = new MetricsRegistry();
registry.register(metric);
registry.get('http_requests_total');
registry.unregister('http_requests_total');
registry.collect();     // structured snapshots
registry.render();      // Prometheus text exposition (trailing newline)
registry.contentType;   // "text/plain; version=0.0.4; charset=utf-8"
registry.clear();
```

A process-wide `defaultRegistry` is exported for convenience; libraries and tests
should prefer an explicit instance.

## Default process metrics

```ts
import { collectDefaultMetrics } from '@streetjs/metrics';

collectDefaultMetrics(registry);
// process_resident_memory_bytes, nodejs_heap_size_total_bytes,
// nodejs_heap_size_used_bytes, nodejs_external_memory_bytes,
// process_cpu_seconds_total, process_start_time_seconds, process_uptime_seconds
```

These are pull-based — values are read at render time, so there is no background timer.
The process source is injectable for deterministic tests.

## Dependency injection

This package depends on no container. It exports a `METRICS_REGISTRY` token (a global
`Symbol`) for interface-first wiring:

```ts
import { METRICS_REGISTRY, MetricsRegistry, type Registry } from '@streetjs/metrics';

container.register(METRICS_REGISTRY, new MetricsRegistry());
const registry = container.resolve<Registry>(METRICS_REGISTRY);
```

## Public API

`MetricsRegistry` · `defaultRegistry` · `Counter` · `Gauge` · `Histogram` /
`DEFAULT_BUCKETS` · `collectDefaultMetrics` · exposition helpers (`CONTENT_TYPE`,
`formatValue`, `escapeHelp`, `escapeLabelValue`, `renderSample`, `renderSnapshot`) ·
name helpers (`assertValidMetricName`, `assertValidLabelName`, `normalizeLabels`,
`seriesKey`) · `METRICS_REGISTRY` token · types (`Registry`, `Collectable`,
`MetricSnapshot`, `Sample`, `Labels`, …).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a runnable end-to-end example.

## License

MIT © street contributors
