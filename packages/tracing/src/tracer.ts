/**
 * The Tracer implementation and `createTracer` factory.
 *
 * Depends on `types`, `ids`, `traceparent`, `sampler`, `span`, `exporter`,
 * and `context`.
 */

import type {
  IdGenerator,
  Sampler,
  Span,
  SpanContext,
  SpanOptions,
  SpanProcessor,
  Tracer,
} from './types.js';
import { randomIdGenerator } from './ids.js';
import { withSampled } from './traceparent.js';
import { alwaysOnSampler } from './sampler.js';
import { SpanImpl } from './span.js';
import { noopSpanProcessor } from './exporter.js';
import { activeSpan, withActiveSpan } from './context.js';

/** Configuration for {@link createTracer}. */
export interface TracerConfig {
  /** Where finished spans go. Default: discard (noop). */
  readonly processor?: SpanProcessor;
  /** Sampling decision. Default: sample everything. */
  readonly sampler?: Sampler;
  /** Id generation. Default: cryptographically random. */
  readonly idGenerator?: IdGenerator;
  /** Time source (epoch ms). Default `Date.now`. */
  readonly clock?: () => number;
}

class TracerImpl implements Tracer {
  private readonly processor: SpanProcessor;
  private readonly sampler: Sampler;
  private readonly idGen: IdGenerator;
  private readonly clock: () => number;

  constructor(config: TracerConfig) {
    this.processor = config.processor ?? noopSpanProcessor;
    this.sampler = config.sampler ?? alwaysOnSampler;
    this.idGen = config.idGenerator ?? randomIdGenerator;
    this.clock = config.clock ?? Date.now;
  }

  activeSpan(): Span | undefined {
    return activeSpan();
  }

  withSpan<T>(span: Span, fn: () => T): T {
    return withActiveSpan(span, fn);
  }

  startSpan(name: string, options: SpanOptions = {}): Span {
    const parent: SpanContext | null =
      options.parent === null
        ? null
        : options.parent ?? this.activeSpan()?.spanContext() ?? null;

    const traceId = parent ? parent.traceId : this.idGen.traceId();
    const spanId = this.idGen.spanId();
    const sampled = this.sampler(traceId, parent);
    const traceFlags = withSampled(parent ? parent.traceFlags : 0, sampled);

    return new SpanImpl({
      name,
      context: { traceId, spanId, traceFlags, remote: false },
      parentSpanId: parent?.spanId,
      kind: options.kind ?? 'internal',
      startTime: options.startTime ?? this.clock(),
      attributes: options.attributes,
      recording: sampled,
      clock: this.clock,
      onEnd: (data) => this.processor.onEnd(data),
    });
  }

  startActiveSpan<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T {
    const span = this.startSpan(name, options);
    try {
      const result = this.withSpan(span, () => fn(span));
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        return (result as unknown as Promise<unknown>).then(
          (value) => {
            span.end();
            return value;
          },
          (error) => {
            this.fail(span, error);
            throw error;
          },
        ) as unknown as T;
      }
      span.end();
      return result;
    } catch (error) {
      this.fail(span, error);
      throw error;
    }
  }

  private fail(span: Span, error: unknown): void {
    span.recordException(error);
    span.setStatus({ code: 'error', message: error instanceof Error ? error.message : String(error) });
    span.end();
  }
}

/** Create a {@link Tracer}. */
export function createTracer(config: TracerConfig = {}): Tracer {
  return new TracerImpl(config);
}
