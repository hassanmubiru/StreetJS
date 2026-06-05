import type { MiddlewareFn } from '../core/types.js';
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
//# sourceMappingURL=otel.d.ts.map