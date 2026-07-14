/**
 * W3C Trace Context `traceparent` parsing and formatting.
 *
 * Format: `version(2)-traceId(32)-spanId(16)-flags(2)`, all lowercase hex.
 * Only version `00` is emitted; unknown future versions are parsed leniently
 * per the spec (the first four fields are read, the rest ignored).
 *
 * Depends on `types` and `ids`.
 */

import type { SpanContext } from './types.js';
import { isValidSpanId, isValidTraceId } from './ids.js';

const TRACE_FLAG_SAMPLED = 0x01;

/** True when the sampled bit is set. */
export function isSampled(traceFlags: number): boolean {
  return (traceFlags & TRACE_FLAG_SAMPLED) === TRACE_FLAG_SAMPLED;
}

/** Set or clear the sampled bit, returning the new flags byte. */
export function withSampled(traceFlags: number, sampled: boolean): number {
  return sampled ? traceFlags | TRACE_FLAG_SAMPLED : traceFlags & ~TRACE_FLAG_SAMPLED;
}

/**
 * Parse a `traceparent` header value into a remote {@link SpanContext}, or
 * return `null` when it is missing/malformed.
 */
export function parseTraceParent(header: string | undefined | null): SpanContext | null {
  if (typeof header !== 'string') {
    return null;
  }
  const parts = header.trim().split('-');
  if (parts.length < 4) {
    return null;
  }
  const [version, traceId, spanId, flags] = parts;
  if (!/^[0-9a-f]{2}$/.test(version) || version === 'ff') {
    return null; // invalid or forbidden version
  }
  if (!isValidTraceId(traceId) || !isValidSpanId(spanId) || !/^[0-9a-f]{2}$/.test(flags)) {
    return null;
  }
  return {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16),
    remote: true,
  };
}

/** Format a {@link SpanContext} as a version-`00` `traceparent` header value. */
export function formatTraceParent(context: SpanContext): string {
  const flags = (context.traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${context.traceId}-${context.spanId}-${flags}`;
}
