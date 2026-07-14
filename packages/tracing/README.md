# @streetjs/tracing

The tracing foundation for StreetJS: **lightweight distributed tracing** with spans,
attributes, events, status, **W3C `traceparent`** propagation, async-context active
spans, samplers, and pluggable exporters.

**Zero runtime dependencies.** Built on Node.js core (`crypto`, `async_hooks`) only,
matching the StreetJS minimal, carefully curated dependency footprint. Generic and
reusable by any application — not tied to any particular StreetJS package.

```bash
npm install @streetjs/tracing
```

## Why

Understanding latency and failures across services requires traces: causally-linked
spans that share a trace id and propagate across process boundaries. `@streetjs/tracing`
provides a small, OpenTelemetry-shaped API (spans, context, samplers, exporters) with
W3C Trace Context propagation — without pulling in the full OpenTelemetry SDK — so any
package or app can instrument code and export spans wherever it likes.

## Quick start

```ts
import { createTracer, SimpleSpanProcessor, ConsoleSpanExporter } from '@streetjs/tracing';

const tracer = createTracer({
  processor: new SimpleSpanProcessor(new ConsoleSpanExporter()),
});

await tracer.startActiveSpan('handle-request', async (span) => {
  span.setAttributes({ 'http.method': 'GET', 'http.route': '/users' });

  await tracer.startActiveSpan('db.query', async (db) => {
    db.setAttribute('db.statement', 'SELECT * FROM users');
    // ... run the query ...
  });

  span.setStatus({ code: 'ok' });
}); // spans end automatically; thrown errors are recorded and status set to error
```

`startActiveSpan` sets the span as active for its (async) callback, so nested spans pick
it up as their parent with no manual plumbing.

## Spans

```ts
const span = tracer.startSpan('work', { kind: 'server', attributes: { region: 'eu' } });
span.setAttribute('user.id', 42);
span.addEvent('cache-miss', { key: 'k' });
span.recordException(err);                 // adds an "exception" event
span.setStatus({ code: 'error', message: 'boom' });
span.updateName('work:variant');
span.end();                                 // idempotent
span.spanContext();                         // { traceId, spanId, traceFlags, remote? }
span.isRecording();
```

A span that isn't sampled is non-recording: its mutators are no-ops and it is never
exported, but it still carries a valid context for propagation.

## Context propagation (W3C Trace Context)

```ts
import { extractContext, injectContext, parseTraceParent, formatTraceParent } from '@streetjs/tracing';

// Inbound: continue a remote trace.
const parent = extractContext(req.headers);            // reads `traceparent`
const span = tracer.startSpan('GET /users', { kind: 'server', parent });

// Outbound: propagate downstream.
const headers: Record<string, string | string[] | undefined> = {};
injectContext(span.spanContext(), headers);            // sets `traceparent`
```

`parseTraceParent` / `formatTraceParent` expose the raw header codec
(`00-<traceId>-<spanId>-<flags>`); malformed and forbidden (`ff`) versions parse to
`null`, and future versions are read leniently.

## Sampling

```ts
import { alwaysOnSampler, alwaysOffSampler, parentBasedSampler, traceIdRatioSampler } from '@streetjs/tracing';

createTracer({ sampler: alwaysOnSampler });               // default
createTracer({ sampler: traceIdRatioSampler(0.1) });      // ~10% of traces
createTracer({ sampler: parentBasedSampler(traceIdRatioSampler(0.1)) }); // follow remote parent, else 10%
```

A sampler is just `(traceId, parent) => boolean`, so custom policies are trivial.

## Exporters & processors

```ts
import { InMemorySpanExporter, ConsoleSpanExporter, SimpleSpanProcessor } from '@streetjs/tracing';

const exporter = new InMemorySpanExporter();              // tests: getFinishedSpans()/reset()
const tracer = createTracer({ processor: new SimpleSpanProcessor(exporter) });
```

Implement `SpanExporter` (`export(spans)`) to send spans to a collector, and/or
`SpanProcessor` (`onEnd(span)`) to batch or transform. Without a processor, spans are
discarded (`noopSpanProcessor`).

## Dependency injection

Depends on no container. Exports a `TRACER` token (a global `Symbol`):

```ts
import { TRACER, createTracer, type Tracer } from '@streetjs/tracing';
container.register(TRACER, createTracer({ processor }));
```

## Public API

`createTracer` · `Tracer` (`startSpan`/`startActiveSpan`/`activeSpan`/`withSpan`) ·
`Span` · exporters (`InMemorySpanExporter`, `ConsoleSpanExporter`, `SimpleSpanProcessor`,
`noopSpanProcessor`) · samplers (`alwaysOnSampler`, `alwaysOffSampler`,
`parentBasedSampler`, `traceIdRatioSampler`) · propagation (`extractContext`,
`injectContext`, `parseTraceParent`, `formatTraceParent`, `isSampled`, `withSampled`) ·
ids (`randomIdGenerator`, `isValidTraceId`, `isValidSpanId`) · `activeSpan` /
`withActiveSpan` · `TRACER` token · types.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a runnable end-to-end example.

## Relationship to OpenTelemetry

This is a compact, dependency-free implementation of the common tracing concepts and W3C
Trace Context, not the full OpenTelemetry SDK. It intentionally omits baggage, metrics,
the OTLP exporter, and the full context API. Applications that need those can adopt the
OpenTelemetry SDK; this package covers the common case with zero dependencies.

## License

MIT © street contributors
