// src/observability/otel.ts
// OpenTelemetry-compatible tracer: span lifecycle, W3C traceparent, OTLP HTTP export.
import * as https from 'node:https';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
// ── Internal span implementation ──────────────────────────────────────────────
class SpanImpl {
    name;
    context;
    parentSpanId;
    startNs;
    endNs;
    attributes;
    statusCode;
    _onEnd;
    constructor(name, context, onEnd, parentSpanId) {
        this.name = name;
        this.context = context;
        this.parentSpanId = parentSpanId;
        this.startNs = process.hrtime.bigint();
        this.attributes = {};
        this._onEnd = onEnd;
    }
    end(statusCode) {
        if (this.endNs !== undefined)
            return; // idempotent
        this.endNs = process.hrtime.bigint();
        if (statusCode !== undefined)
            this.statusCode = statusCode;
        this._onEnd(this);
    }
}
function toOtlpAttributes(attrs) {
    return Object.entries(attrs).map(([key, val]) => {
        if (typeof val === 'string') {
            return { key, value: { stringValue: val } };
        }
        else if (typeof val === 'boolean') {
            return { key, value: { boolValue: val } };
        }
        else if (Number.isInteger(val)) {
            return { key, value: { intValue: String(val) } };
        }
        else {
            return { key, value: { doubleValue: val } };
        }
    });
}
function serializeSpans(spans, serviceName) {
    const otlpSpans = spans.map((s) => {
        const obj = {
            traceId: s.context.traceId,
            spanId: s.context.spanId,
            name: s.name,
            startTimeUnixNano: s.startNs.toString(),
            endTimeUnixNano: (s.endNs ?? s.startNs).toString(),
            attributes: toOtlpAttributes(s.attributes),
        };
        if (s.parentSpanId)
            obj['parentSpanId'] = s.parentSpanId;
        if (s.statusCode !== undefined) {
            obj['status'] = { code: s.statusCode >= 400 ? 2 : 1 };
        }
        return obj;
    });
    return JSON.stringify({
        resourceSpans: [{
                resource: {
                    attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
                },
                scopeSpans: [{ spans: otlpSpans }],
            }],
    });
}
// ── Retry helper ──────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
function postOtlp(endpoint, body) {
    return new Promise((resolve, reject) => {
        const url = new URL('/v1/traces', endpoint);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body, 'utf8'),
            },
        };
        const req = lib.request(options, (res) => {
            // Drain response body to free socket
            res.resume();
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve();
                }
                else {
                    reject(new Error(`OTLP export failed: HTTP ${res.statusCode ?? 'unknown'}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body, 'utf8');
        req.end();
    });
}
async function exportWithRetry(endpoint, body, maxRetries = 3) {
    let delay = 1000;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await postOtlp(endpoint, body);
            return;
        }
        catch (err) {
            if (attempt === maxRetries)
                throw err;
            await sleep(Math.min(delay, 30_000));
            delay *= 2;
        }
    }
}
// ── OtelTracer ────────────────────────────────────────────────────────────────
export class OtelTracer {
    endpoint;
    serviceName;
    maxBuffer;
    buffer = [];
    flushTimer;
    _dropWarningPending = false;
    constructor(opts) {
        this.endpoint = opts.endpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
        this.serviceName = opts.serviceName;
        this.maxBuffer = opts.maxBuffer ?? 1000;
        // Background flush every 5 seconds; unref so it doesn't block shutdown
        this.flushTimer = setInterval(() => {
            this._backgroundFlush();
        }, 5000);
        this.flushTimer.unref();
    }
    // ── Span factory ────────────────────────────────────────────────────────────
    startSpan(name, parent, parentSpanId) {
        const traceId = parent?.traceId ?? this._randomHex(16);
        const spanId = this._randomHex(8);
        const traceFlags = parent?.traceFlags ?? 1;
        const ctx = { traceId, spanId, traceFlags };
        const span = new SpanImpl(name, ctx, (s) => this._onSpanEnd(s), parentSpanId);
        return span;
    }
    _onSpanEnd(span) {
        if (this.buffer.length >= this.maxBuffer) {
            // Drop oldest and emit a single warn per drop event
            this.buffer.shift();
            if (!this._dropWarningPending) {
                this._dropWarningPending = true;
                console.warn('[otel] Span buffer overflow — dropping oldest span. Consider increasing throughput or flush rate.');
                // Reset flag after current tick so next drop event also warns
                setImmediate(() => { this._dropWarningPending = false; });
            }
        }
        this.buffer.push(span);
    }
    // ── W3C traceparent ─────────────────────────────────────────────────────────
    /**
     * Extract W3C traceparent context from request headers.
     * Format: 00-{32hex traceId}-{16hex spanId}-{2hex flags}
     */
    extractContext(headers) {
        const raw = headers['traceparent'];
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (!value)
            return null;
        const parts = value.trim().split('-');
        if (parts.length < 4)
            return null;
        const [version, traceId, spanId, flags] = parts;
        if (version !== '00')
            return null;
        if (!traceId || traceId.length !== 32 || !/^[0-9a-f]+$/i.test(traceId))
            return null;
        if (!spanId || spanId.length !== 16 || !/^[0-9a-f]+$/i.test(spanId))
            return null;
        if (!flags || flags.length !== 2 || !/^[0-9a-f]+$/i.test(flags))
            return null;
        return {
            traceId: traceId.toLowerCase(),
            spanId: spanId.toLowerCase(),
            traceFlags: parseInt(flags, 16),
        };
    }
    /**
     * Inject W3C traceparent into outgoing headers.
     */
    injectContext(ctx, headers) {
        const flags = ctx.traceFlags.toString(16).padStart(2, '0');
        headers['traceparent'] = `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
    }
    // ── Flush / Shutdown ────────────────────────────────────────────────────────
    /** Flush current buffer immediately. */
    async flush() {
        if (this.buffer.length === 0)
            return;
        const spans = this.buffer.splice(0);
        const body = serializeSpans(spans, this.serviceName);
        try {
            await exportWithRetry(this.endpoint, body);
        }
        catch (err) {
            console.warn('[otel] Failed to export spans after retries:', err.message);
        }
    }
    /** Stop background flush timer. Call flush() before shutdown if needed. */
    shutdown() {
        clearInterval(this.flushTimer);
    }
    // ── Private helpers ─────────────────────────────────────────────────────────
    _randomHex(bytes) {
        return crypto.randomBytes(bytes).toString('hex');
    }
    _backgroundFlush() {
        if (this.buffer.length === 0)
            return;
        this.flush().catch((err) => {
            console.warn('[otel] Background flush error:', err.message);
        });
    }
}
// ── otelMiddleware ────────────────────────────────────────────────────────────
/**
 * Middleware factory: extracts W3C traceparent, starts an HTTP span,
 * calls next(), then ends the span with the response status code.
 * Stores the span in ctx.state['otelSpan'].
 */
export function otelMiddleware(tracer) {
    return async (ctx, next) => {
        const parent = tracer.extractContext(ctx.headers);
        const span = tracer.startSpan(`${ctx.method} ${ctx.path}`, parent ?? undefined, parent?.spanId);
        span.attributes['http.method'] = ctx.method;
        span.attributes['http.target'] = ctx.path;
        ctx.state['otelSpan'] = span;
        try {
            await next();
        }
        finally {
            const statusCode = ctx.res.statusCode ?? 0;
            span.end(statusCode);
        }
    };
}
//# sourceMappingURL=otel.js.map