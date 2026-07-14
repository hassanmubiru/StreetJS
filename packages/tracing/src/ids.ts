/**
 * Trace/span id generation and validation.
 *
 * Leaf module — depends only on `node:crypto` and `types`.
 */

import { randomBytes } from 'node:crypto';
import type { IdGenerator } from './types.js';

/** The all-zero trace id (invalid per W3C trace-context). */
export const INVALID_TRACE_ID = '00000000000000000000000000000000';
/** The all-zero span id (invalid per W3C trace-context). */
export const INVALID_SPAN_ID = '0000000000000000';

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;

/** True for a well-formed, non-zero trace id. */
export function isValidTraceId(id: string): boolean {
  return TRACE_ID_RE.test(id) && id !== INVALID_TRACE_ID;
}

/** True for a well-formed, non-zero span id. */
export function isValidSpanId(id: string): boolean {
  return SPAN_ID_RE.test(id) && id !== INVALID_SPAN_ID;
}

/** The default cryptographically-random id generator. */
export const randomIdGenerator: IdGenerator = {
  traceId(): string {
    return randomBytes(16).toString('hex');
  },
  spanId(): string {
    return randomBytes(8).toString('hex');
  },
};
