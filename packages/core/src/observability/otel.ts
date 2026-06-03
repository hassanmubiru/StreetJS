// src/observability/otel.ts
// OpenTelemetry-compatible tracer: span lifecycle, W3C traceparent, OTLP HTTP export.

import { createRequire } from 'node:module';
import * as https from 'node:https';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import type { MiddlewareFn } from '../core/types.js';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface SpanContext {
  traceId: string;    // 32-char hex
  spanId: string;     // 16-char hex
  traceFlags: number; // 0 or 1
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

// ── Internal span implementation ──────────────────────────────────────────────

class SpanImpl implements Span {
  name: string;
  context: SpanContext;
  parentSpanId?: string;
  startNs: bigint;
  endNs?: bigint;
  attributes: Record<string, string | number | boolean>;
  statusCode?: number;

  private readonly _onEnd: (span: SpanImpl) => void;

  constructor(
    name: string,
    context: SpanContext,
    onEnd: (span: SpanImpl) => void,
    parentSpanId?: string,
  ) {
    this.name = name;
    this.context = context;
    this.parentSpanId = parentSpanId;
    this.startNs = process.hrtime.bigint();
    this.attributes = {};
    this._onEnd = onEnd;
  }

  end(statusCode?: number): void {
    if (this.endNs !== undefined) return; // idempotent
    this.endNs = process.hrtime.bigint();
    if (statusCode !== undefined) this.statusCode = statusCode;
    this._onEnd(this);
  }
}

// ── OTLP helpers ──────────────────────────────────────────────────────────────

interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean; doubleValue?: number };
}

function toOtlpAttributes(attrs: Record<string, string | number | boolean>): OtlpAttribute[] {
  return Object.entries(attrs).map(([key, val]) => {
    if (typeof val === 'string') {
      return { key, value: { stringValue: val } };
    } else if (typeof val === 'boolean') {
      return { key, value: { boolValue: val } };
    } else if (Number.isInteger(val)) {
      return { key, value: { intValue: String(val) } };
    } else {
      return { key, value: { doubleValue: val } };
    }
  });
}

function serializeSpans(spans: SpanImpl[], serviceName: string): string {
  const otlpSpans = spans.map((s) => {
    const obj: Record<string, unknown> = {
      traceId: s.context.traceId,
      spanId: s.context.spanId,
      name: s.name,
      startTimeUnixNano: s.startNs.toString(),
      endTimeUnixNano: (s.endNs ?? s.startNs).toString(),
      attributes: toOtlpAttributes(s.attributes),
    };
    if (s.parentSpanId) obj['parentSpanId'] = s.parentSpanId;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function postOtlp(
  endpoint: string,
  body: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

    const req = (lib as typeof https).request(options, (res) => {
      // Drain response body to free socket
      res.resume();
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`OTLP export failed: HTTP ${res.statusCode ?? 'unknown'}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

async function exportWithRetry(
  endpoint: string,
  body: string,
  maxRetries = 3,
): Promise<void> {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await postOtlp(endpoint, body);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await sleep(Math.min(delay, 30_000));
      delay *= 2;
    }
  }
}

// ── OtelTracer ────────────────────────────────────────────────────────────────

export class OtelTracer {
  private readonly endpoint: string;
  private readonly serviceName: string;
  private readonly maxBuffer: number;
  private readonly buffer: SpanImpl[] = [];
  private readonly flushTimer: NodeJS.Timeout;
  private _dropWarningPending = false;

  constructor(opts: { endpoint?: string; serviceName: string; maxBuffer?: number }) {
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

  startSpan(name: string, parent?: SpanContext, parentSpanId?: string): Span {
    const traceId = parent?.traceId ?? this._randomHex(16);
    const spanId = this._randomHex(8);
    const traceFlags = parent?.traceFlags ?? 1;

    const ctx: SpanContext = { traceId, spanId, traceFlags };
    const span = new SpanImpl(name, ctx, (s) => this._onSpanEnd(s), parentSpanId);
    return span;
  }

  private _onSpanEnd(span: SpanImpl): void {
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
  extractContext(headers: Record<string, string | string[] | undefined>): SpanContext | null {
    const raw = headers['traceparent'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) return null;

    const parts = value.trim().split('-');
    if (parts.length < 4) return null;

    const [version, traceId, spanId, flags] = parts;
    if (version !== '00') return null;
    if (!traceId || traceId.length !== 32 || !/^[0-9a-f]+$/i.test(traceId)) return null;
    if (!spanId || spanId.length !== 16 || !/^[0-9a-f]+$/i.test(spanId)) return null;
    if (!flags || flags.length !== 2 || !/^[0-9a-f]+$/i.test(flags)) return null;

    return {
      traceId: traceId.toLowerCase(),
      spanId: spanId.toLowerCase(),
      traceFlags: parseInt(flags, 16),
    };
  }

  /**
   * Inject W3C traceparent into outgoing headers.
   */
  injectContext(ctx: SpanContext, headers: Record<string, string>): void {
    const flags = ctx.traceFlags.toString(16).padStart(2, '0');
    headers['traceparent'] = `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
  }

  // ── Flush / Shutdown ────────────────────────────────────────────────────────

  /** Flush current buffer immediately. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const spans = this.buffer.splice(0);
    const body = serializeSpans(spans, this.serviceName);

    try {
      await exportWithRetry(this.endpoint, body);
    } catch (err) {
      console.warn('[otel] Failed to export spans after retries:', (err as Error).message);
    }
  }

  /** Stop background flush timer. Call flush() before shutdown if needed. */
  shutdown(): void {
    clearInterval(this.flushTimer);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _randomHex(bytes: number): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  private _backgroundFlush(): void {
    if (this.buffer.length === 0) return;
    this.flush().catch((err) => {
      console.warn('[otel] Background flush error:', (err as Error).message);
    });
  }
}

// ── otelMiddleware ────────────────────────────────────────────────────────────

/**
 * Middleware factory: extracts W3C traceparent, starts an HTTP span,
 * calls next(), then ends the span with the response status code.
 * Stores the span in ctx.state['otelSpan'].
 */
export function otelMiddleware(tracer: OtelTracer): MiddlewareFn {
  return async (ctx, next) => {
    const parent = tracer.extractContext(ctx.headers as Record<string, string | string[] | undefined>);
    const span = tracer.startSpan(
      `${ctx.method} ${ctx.path}`,
      parent ?? undefined,
      parent?.spanId,
    );

    span.attributes['http.method'] = ctx.method;
    span.attributes['http.target'] = ctx.path;

    ctx.state['otelSpan'] = span;

    try {
      await next();
    } finally {
      const statusCode = ctx.res.statusCode ?? 0;
      span.end(statusCode);
    }
  };
}
