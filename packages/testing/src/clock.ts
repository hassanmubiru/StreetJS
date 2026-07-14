/**
 * A controllable fake clock.
 *
 * Plugs directly into every StreetJS package that accepts a `clock: () => number`
 * (config, logging, metrics, health, tracing, webhooks): pass `clock.fn`.
 *
 * Depends on `types` only.
 */

import type { FakeClock } from './types.js';

/** Create a fake clock starting at `startMs` (default `0`). */
export function fakeClock(startMs = 0): FakeClock {
  let current = startMs;
  const now = (): number => current;
  return {
    now,
    fn: now,
    tick(ms: number): void {
      if (ms < 0) {
        throw new Error('fakeClock.tick cannot move time backwards');
      }
      current += ms;
    },
    set(ms: number): void {
      current = ms;
    },
  };
}
