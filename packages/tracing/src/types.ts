/**
 * Public types for @streetjs/tracing.
 *
 * Interface-first: spans, the tracer, samplers, and exporters are described here
 * so applications can substitute implementations and wire through DI.
 */

/** Attribute values permitted on spans and events (OTel-compatible subset). */
export type AttributeValue = string | number | boolean | string[] | number[] | boolean[];

/** A bag of span/event attributes. */
export type Attributes = Record<string, AttributeValue>;

/** Span kinds, mirroring the OpenTelemetry span kinds. */
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';

/** Status codes for a span. */
export type SpanStatusCode = 'unset' | 'ok' | 'error';

/** A span's status. */
export interface SpanStatus {
  readonly code: SpanStatusCode;
  readonly message?: string;
}

/**
 * The immutable identity of a span, propagated across process boundaries via
 * W3C `traceparent`.
 */
export interface SpanContext {
  /** 32-hex-char (16-byte) trace id. */
  readonly traceId: string;
  /** 16-hex-char (8-byte) span id. */
  readonly spanId: string;
  /** 1-byte trace flags; bit 0 is "sampled". */
  readonly traceFlags: number;
  /** True when reconstructed from an incoming header (a remote parent). */
  readonly remote?: boolean;
}

/** A timestamped event recorded on a span. */
export interface TimedEvent {
  readonly name: string;
  readonly time: number;
  readonly attributes?: Attributes;
}

/** Options when starting a span. */
export interface SpanOptions {
  readonly kind?: SpanKind;
  readonly attributes?: Attributes;
  /**
   * Explicit parent context. When omitted, the tracer uses the active span (if
   * any); pass `null` to force a new root span.
   */
  readonly parent?: SpanContext | null;
  /** Override the start time (epoch ms). Defaults to the tracer clock. */
  readonly startTime?: number;
}

/** A single unit of work in a trace. */
export interface Span {
  /** This span's context (identity). */
  spanContext(): SpanContext;
  /** True until `end()` is called. */
  isRecording(): boolean;
  setAttribute(key: string, value: AttributeValue): this;
  setAttributes(attributes: Attributes): this;
  addEvent(name: string, attributes?: Attributes): this;
  setStatus(status: SpanStatus): this;
  /** Record an exception as an event and (unless suppressed) set status to error. */
  recordException(error: unknown): this;
  updateName(name: string): this;
  /** Finish the span. Idempotent — subsequent calls are ignored. */
  end(endTime?: number): void;
}

/** The exported, read-only snapshot of a finished span. */
export interface SpanData {
  readonly name: string;
  readonly context: SpanContext;
  readonly parentSpanId?: string;
  readonly kind: SpanKind;
  readonly startTime: number;
  readonly endTime: number;
  readonly durationMs: number;
  readonly attributes: Readonly<Attributes>;
  readonly events: readonly TimedEvent[];
  readonly status: SpanStatus;
}

/** Receives finished spans for export. */
export interface SpanExporter {
  export(spans: readonly SpanData[]): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

/** Observes span lifecycle; the bridge between spans and exporters. */
export interface SpanProcessor {
  onEnd(span: SpanData): void;
  forceFlush?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

/** Decides whether a new span is sampled, given the (proposed) trace id. */
export type Sampler = (traceId: string, parent: SpanContext | null) => boolean;

/** Generates trace/span ids (injectable for deterministic tests). */
export interface IdGenerator {
  traceId(): string;
  spanId(): string;
}

/** Starts spans and manages active context. */
export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span;
  /** Run `fn` with `span` active; ends the span automatically and records thrown errors. */
  startActiveSpan<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T;
  /** The currently active span, if any. */
  activeSpan(): Span | undefined;
  /** Run `fn` with `span` set as the active span. */
  withSpan<T>(span: Span, fn: () => T): T;
}
