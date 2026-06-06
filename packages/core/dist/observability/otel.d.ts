import type { MiddlewareFn } from '../core/types.js';
import type { DbResult } from '../database/types.js';
export interface SpanContext {
    traceId: string;
    spanId: string;
    traceFlags: number;
}
export interface Span {
    name: string;
    context: SpanContext;
    parentSpanId?: string;
    startNs: bigint;
    endNs?: bigint;
    attributes: Record<string, string | number | boolean>;
    statusCode?: number;
    end(statusCode?: number): void;
}
export declare class OtelTracer {
    private readonly endpoint;
    private readonly serviceName;
    private readonly maxBuffer;
    private readonly buffer;
    private readonly flushTimer;
    private _dropWarningPending;
    constructor(opts: {
        endpoint?: string;
        serviceName: string;
        maxBuffer?: number;
    });
    startSpan(name: string, parent?: SpanContext, parentSpanId?: string): Span;
    private _onSpanEnd;
    /**
     * Extract W3C traceparent context from request headers.
     * Format: 00-{32hex traceId}-{16hex spanId}-{2hex flags}
     */
    extractContext(headers: Record<string, string | string[] | undefined>): SpanContext | null;
    /**
     * Inject W3C traceparent into outgoing headers.
     */
    injectContext(ctx: SpanContext, headers: Record<string, string>): void;
    /** Flush current buffer immediately. */
    flush(): Promise<void>;
    /** Stop background flush timer. Call flush() before shutdown if needed. */
    shutdown(): void;
    private _randomHex;
    private _backgroundFlush;
}
/**
 * Middleware factory: extracts W3C traceparent, starts an HTTP span,
 * calls next(), then ends the span with the response status code.
 * Stores the span in ctx.state['otelSpan'].
 */
export declare function otelMiddleware(tracer: OtelTracer): MiddlewareFn;
/**
 * Minimal pool surface required to instrument database queries.
 * Satisfied by `PgPool`, `ProfiledPool`, `MysqlPool`, and `SqlitePool` — the
 * same duck-typed `query()` shape used by `QueryablePool`/`ProfileablePool`.
 */
export interface OtelInstrumentablePool {
    query(sql: string, params?: unknown[]): Promise<DbResult>;
}
/**
 * Resolves the currently-active parent span, or `undefined` when no span is
 * active. Typically wired to `() => ctx.state['otelSpan'] as Span | undefined`
 * so that DB spans are only emitted within an instrumented HTTP request.
 */
export type ActiveSpanResolver = () => Span | undefined;
/**
 * A pool wrapper that creates an OpenTelemetry child span for every `query()`
 * call — but only when an active parent span is present (mirroring "when
 * `ctx.state['otelSpan']` is present"). The child span inherits the parent's
 * trace, carries `db.system='postgresql'` and `db.statement=<sql>` attributes,
 * and is ended (recording duration) after the query resolves or rejects.
 *
 * Composition only — no prototype patching. All other access goes through the
 * underlying pool via the `inner` accessor.
 */
export declare class OtelInstrumentedPool implements OtelInstrumentablePool {
    private readonly _inner;
    private readonly _tracer;
    private readonly _getActiveSpan;
    constructor(_inner: OtelInstrumentablePool, _tracer: OtelTracer, _getActiveSpan: ActiveSpanResolver);
    query(sql: string, params?: unknown[]): Promise<DbResult>;
    /** Access the underlying (unwrapped) pool. */
    get inner(): OtelInstrumentablePool;
}
/**
 * Wrap `pool` so each `query()` emits an OTel child span when `getActiveSpan()`
 * returns an active parent span. Least-invasive composition wrapper that avoids
 * a breaking change to `PgPool.query()`.
 *
 * @param pool          The pool to instrument.
 * @param tracer        The `OtelTracer` used to create child spans.
 * @param getActiveSpan Resolver returning the active parent span, or `undefined`.
 * @returns             An `OtelInstrumentedPool` delegating to `pool`.
 */
export declare function instrumentPoolWithOtel(pool: OtelInstrumentablePool, tracer: OtelTracer, getActiveSpan: ActiveSpanResolver): OtelInstrumentedPool;
//# sourceMappingURL=otel.d.ts.map