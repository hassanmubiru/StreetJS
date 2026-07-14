/**
 * Built-in samplers.
 *
 * Depends on `types` and `traceparent`.
 */

import type { Sampler } from './types.js';
import { isSampled } from './traceparent.js';

/** Sample every span. */
export const alwaysOnSampler: Sampler = () => true;

/** Sample no spans. */
export const alwaysOffSampler: Sampler = () => false;

/**
 * Respect a remote parent's sampled flag; for root spans, defer to `root`
 * (default {@link alwaysOnSampler}).
 */
export function parentBasedSampler(root: Sampler = alwaysOnSampler): Sampler {
  return (traceId, parent) => (parent ? isSampled(parent.traceFlags) : root(traceId, parent));
}

/**
 * Deterministically sample a fraction of traces by trace id. `ratio <= 0`
 * samples nothing, `ratio >= 1` samples everything.
 */
export function traceIdRatioSampler(ratio: number): Sampler {
  if (ratio >= 1) {
    return alwaysOnSampler;
  }
  if (ratio <= 0) {
    return alwaysOffSampler;
  }
  const bound = ratio * 0x100000000; // 2^32
  return (traceId) => {
    // Use the high 32 bits of the trace id as the sampling value.
    const value = parseInt(traceId.slice(0, 8), 16);
    return value < bound;
  };
}
