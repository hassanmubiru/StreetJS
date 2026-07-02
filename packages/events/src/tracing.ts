// src/tracing.ts
// @streetjs/events — OpenTelemetry-compatible tracing for the application event
// layer. Emits one span per published event and propagates W3C trace context
// through `ctx.metadata` so nested publishes (from inside a listener) become
// child spans.
//
// It reuses the core `OtelTracer` via a STRUCTURAL `TracerLike` interface (the
// core tracer satisfies it), so this module needs no extra dependency and is
// testable with a fake tracer.
//
// Semantics note: a listener failure is *isolated* in this library (it never
// fails the publish), so a span is marked ERROR only when a middleware vetoes
// dispatch. Listener failures are recorded as the `event.failed` span attribute
// (and the `events_failed_total` metric) rather than as a span error.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventContext } from './event.js';
import type { EventMiddleware } from './middleware.js';
import type { EventsTelemetry } from './facade.js';

/** A W3C span context (mirrors the core `SpanContext`). */
export interface SpanContextLike {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

/** The span surface this module uses (mirrors the core `Span`). */
export interface SpanLike {
  context: SpanContextLike;
  attributes: Record<string, string | number | boolean>;
  end(statusCode?: number): void;
}

/** The tracer surface this module needs (the core `OtelTracer` satisfies it). */
export interface TracerLike {
  startSpan(name: string, parent?: SpanContextLike, parentSpanId?: string): SpanLike;
}

/** Options for {@link createEventsTracing}. */
export interface EventsTracingOptions {
  /** Span name prefix. Default `"event"` → span name `"event user.created"`. */
  spanPrefix?: string;
  /**
   * Metadata key holding an inbound/outbound W3C `traceparent` string. Default
   * `"traceparent"`. The middleware reads a parent context from it (if present)
   * and writes the child context back so nested publishes chain correctly.
   */
  traceparentKey?: string;
}

/** The paired tracing wiring returned by {@link createEventsTracing}. */
export interface EventsTracing {
  /** Add via `events.use(tracing.middleware)` — starts/ends the per-event span. */
  middleware: EventMiddleware;
  /** Pass via `createEvents({ telemetry: tracing.telemetry })` — adds counts. */
  telemetry: EventsTelemetry;
}

/** Parse a W3C `traceparent` string into a span context, or null. */
function parseTraceparent(value: unknown): SpanContextLike | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('-');
  if (parts.length < 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== '00') return null;
  if (!traceId || traceId.length !== 32 || !/^[0-9a-f]+$/i.test(traceId)) return null;
  if (!spanId || spanId.length !== 16 || !/^[0-9a-f]+$/i.test(spanId)) return null;
  if (!flags || flags.length !== 2 || !/^[0-9a-f]+$/i.test(flags)) return null;
  return { traceId: traceId.toLowerCase(), spanId: spanId.toLowerCase(), traceFlags: parseInt(flags, 16) };
}

/** Format a span context as a W3C `traceparent` string. */
function formatTraceparent(ctx: SpanContextLike): string {
  const flags = (ctx.traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Create tracing wiring for an events facade.
 *
 * ```ts
 * const tracing = createEventsTracing(new OtelTracer({ serviceName: 'app' }));
 * const events = createEvents<AppEvents>({ telemetry: tracing.telemetry });
 * events.use(tracing.middleware);
 * ```
 *
 * The middleware alone gives per-event spans with context propagation; adding
 * the telemetry annotates each span with `event.delivered` / `event.failed`.
 */
export function createEventsTracing(
  tracer: TracerLike,
  options: EventsTracingOptions = {},
): EventsTracing {
  const spanPrefix = options.spanPrefix ?? 'event';
  const tpKey = options.traceparentKey ?? 'traceparent';

  // Associate the active span with its dispatch context without polluting
  // metadata (which is persisted/forwarded). Entries are collected automatically
  // when the per-dispatch context object is GC'd, so nothing leaks even if the
  // telemetry sink is not wired.
  const spans = new WeakMap<EventContext, SpanLike>();
  // Ambient current-trace propagation: a publish issued from inside a listener
  // (during `next()`) reads the enclosing span's traceparent from here and
  // becomes a child span — true automatic context propagation across awaits.
  const activeTraceparent = new AsyncLocalStorage<string>();

  const middleware: EventMiddleware = async (ctx, _payload, next) => {
    // Parent precedence: an explicit inbound traceparent on the event beats the
    // ambient one (e.g. an event re-published from a distributed bus message).
    const inbound = ctx.metadata[tpKey];
    const parentTraceparent = typeof inbound === 'string' ? inbound : activeTraceparent.getStore();
    const parent = parseTraceparent(parentTraceparent) ?? undefined;

    const span = tracer.startSpan(`${spanPrefix} ${ctx.event}`, parent, parent ? parent.spanId : undefined);

    span.attributes['event.name'] = ctx.event;
    span.attributes['event.id'] = ctx.id;
    if (ctx.tenantId !== undefined) {
      span.attributes['event.tenant_id'] = ctx.tenantId;
    }

    // Expose the child context on metadata (for forwarding/inspection) and make
    // it the ambient parent for the duration of delivery.
    const childTraceparent = formatTraceparent(span.context);
    ctx.metadata[tpKey] = childTraceparent;
    spans.set(ctx, span);

    try {
      await activeTraceparent.run(childTraceparent, () => next());
      span.end(); // dispatch succeeded (listener failures are isolated, not errors)
    } catch (err) {
      // A middleware veto (or a middleware bug) is a real dispatch failure.
      span.attributes['error'] = true;
      span.attributes['error.message'] = err instanceof Error ? err.message : String(err);
      span.end(500);
      throw err;
    }
  };

  const telemetry: EventsTelemetry = {
    onDispatchComplete: (ctx: EventContext, _durationMs, delivered, failed) => {
      const span = spans.get(ctx);
      if (span) {
        // The span is already ended by the middleware; attributes are read at
        // flush time, so annotating post-end is safe and exported correctly.
        span.attributes['event.delivered'] = delivered;
        span.attributes['event.failed'] = failed;
      }
    },
  };

  return { middleware, telemetry };
}
