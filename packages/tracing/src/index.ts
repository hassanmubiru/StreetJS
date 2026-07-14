/**
 * @streetjs/tracing — the StreetJS tracing foundation.
 *
 * Lightweight distributed tracing: spans with attributes/events/status, W3C
 * `traceparent` propagation, async-context active spans, samplers, and pluggable
 * exporters. Zero runtime dependencies. Public API only.
 *
 * ```ts
 * import { createTracer, SimpleSpanProcessor, InMemorySpanExporter } from '@streetjs/tracing';
 *
 * const exporter = new InMemorySpanExporter();
 * const tracer = createTracer({ processor: new SimpleSpanProcessor(exporter) });
 *
 * await tracer.startActiveSpan('handle-request', async (span) => {
 *   span.setAttribute('http.method', 'GET');
 *   await doWork();
 * });
 * exporter.getFinishedSpans(); // one finished span
 * ```
 */

import type { SpanContext } from './types.js';
import { parseTraceParent, formatTraceParent } from './traceparent.js';

export { createTracer, type TracerConfig } from './tracer.js';

export {
  InMemorySpanExporter,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  noopSpanProcessor,
} from './exporter.js';

export {
  alwaysOnSampler,
  alwaysOffSampler,
  parentBasedSampler,
  traceIdRatioSampler,
} from './sampler.js';

export {
  parseTraceParent,
  formatTraceParent,
  isSampled,
  withSampled,
} from './traceparent.js';

export {
  randomIdGenerator,
  isValidTraceId,
  isValidSpanId,
  INVALID_TRACE_ID,
  INVALID_SPAN_ID,
} from './ids.js';

export { activeSpan, withActiveSpan } from './context.js';

export type {
  Span,
  SpanContext,
  SpanData,
  SpanOptions,
  SpanKind,
  SpanStatus,
  SpanStatusCode,
  Attributes,
  AttributeValue,
  TimedEvent,
  SpanExporter,
  SpanProcessor,
  Sampler,
  IdGenerator,
  Tracer,
} from './types.js';

/** A carrier that can hold/provide propagation headers (e.g. HTTP headers). */
export type PropagationCarrier = Record<string, string | string[] | undefined>;

/** Extract a remote {@link SpanContext} from a carrier's `traceparent`, if present. */
export function extractContext(carrier: PropagationCarrier): SpanContext | null {
  const raw = carrier.traceparent;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseTraceParent(value);
}

/** Inject a {@link SpanContext} into a carrier as a `traceparent` header. */
export function injectContext(context: SpanContext, carrier: PropagationCarrier): void {
  carrier.traceparent = formatTraceParent(context);
}

/**
 * Dependency-injection token for a {@link Tracer}. `@streetjs/tracing` depends
 * on no container, so the token is a plain unique symbol.
 */
export const TRACER: unique symbol = Symbol.for('@streetjs/tracing:Tracer');
