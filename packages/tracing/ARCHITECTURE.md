# @streetjs/tracing — Architecture

## Goals

- A single, generic tracing foundation every StreetJS package/app can build on.
- Zero runtime dependencies (Node core `crypto` + `async_hooks` only).
- OpenTelemetry-shaped concepts + W3C Trace Context, without the OTel SDK.
- Strongly typed, interface-first; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  types.ts        Public interfaces: Span, Tracer, SpanContext, exporters, sampler.
  ids.ts          Trace/span id generation + validation (node:crypto).
  traceparent.ts  W3C traceparent parse/format + sampled-flag helpers.
  context.ts      Active-span propagation via AsyncLocalStorage.
  sampler.ts      alwaysOn/Off, parentBased, traceIdRatio samplers.
  span.ts         SpanImpl (attributes/events/status, recording flag, idempotent end).
  exporter.ts     InMemory/Console exporters, SimpleSpanProcessor, noop processor.
  tracer.ts       TracerImpl + createTracer (parenting, sampling, active spans).
  index.ts        Curated public API + extract/inject helpers.
```

## Dependency graph (acyclic)

```
types       ← ids, traceparent, context, sampler, span, exporter, tracer
ids         ← traceparent, tracer
traceparent ← sampler, tracer
context     ← tracer
sampler     ← tracer
span        ← tracer
exporter    ← tracer
tracer      ← index
index       → everything public
```

One direction only. `traceparent`, `ids`, and `sampler` are usable independently of the
tracer, so propagation and sampling can be tested and reused in isolation.

## Span lifecycle

`tracer.startSpan(name, options)`:

1. **Resolve parent** — `options.parent` if given (`null` forces a root), else the active
   span's context, else none.
2. **Ids** — child spans inherit the parent trace id; every span gets a fresh span id.
3. **Sample** — `sampler(traceId, parent)` decides; the result sets the sampled bit in
   `traceFlags`. Non-sampled spans are constructed non-recording.
4. **Construct** a `SpanImpl` carrying the context, parent span id, kind, start time,
   and an `onEnd` bound to the processor.

`SpanImpl` collects attributes/events/status while recording. `end()` is idempotent;
on first end it stamps the end time and, if recording, emits an immutable `SpanData`
snapshot to the processor. All mutators are no-ops after end or when non-recording.

`startActiveSpan(name, fn, options)` runs `fn` with the span active (via
`AsyncLocalStorage`), then ends it — handling both synchronous returns/throws and
returned promises. Thrown/rejected errors are recorded as an `exception` event and the
status is set to `error` before the span ends and the error re-propagates.

## Context propagation

Active-span context lives in an `AsyncLocalStorage`, so `startActiveSpan` establishes
parentage across `await` boundaries without manual threading. Cross-process propagation
uses W3C `traceparent`: `extractContext`/`injectContext` read and write the header on a
generic carrier (e.g. HTTP headers), and `parseTraceParent`/`formatTraceParent` are the
underlying codec. Only version `00` is emitted; malformed or forbidden (`ff`) headers
parse to `null`, and unknown future versions are read leniently per the spec.

## Sampling

Samplers are pure `(traceId, parent) => boolean` functions. `traceIdRatioSampler` maps
the high 32 bits of the trace id to `[0, 2^32)` and samples when below `ratio * 2^32`,
giving a deterministic, uniform fraction. `parentBasedSampler` honors a remote parent's
sampled flag and defers to a root sampler otherwise.

## Design boundaries (honest)

- No baggage, metrics, links, or span limits; no OTLP exporter; no full OTel Context API.
- Timing uses an injectable millisecond clock (default `Date.now`), not high-resolution
  `hrtime`. Durations are millisecond-precision — sufficient for typical request tracing.
- `SimpleSpanProcessor` exports synchronously on span end; high-volume batching is left
  to a custom `SpanProcessor`.

## Extension points

- **Exporters** implement `SpanExporter`; **processors** implement `SpanProcessor`.
- **Samplers** are plain functions.
- **Deterministic tests** via injectable `idGenerator` and `clock`.
- **Downstream StreetJS packages** accept a `Tracer` by interface and receive one via the
  `TRACER` DI token; they depend on `@streetjs/tracing`, never the reverse.

## Testing

`node --test` over real behavior with injected ids/clock and an `InMemorySpanExporter`:
root/child parenting, duration, attributes/events/status/exceptions, idempotent end and
post-end no-ops, active-span nesting, sync + async success/failure in `startActiveSpan`,
non-sampled no-export, `parent:null` forcing a root, explicit start time, the full
traceparent codec (valid/malformed/future-version), id validation/generation, every
sampler, and extract/inject. Coverage is enforced at ≥90% (`c8 check-coverage`); the
declaration-only `types.ts` is excluded as it emits no executable code.
