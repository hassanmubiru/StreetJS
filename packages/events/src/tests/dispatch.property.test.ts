// src/tests/dispatch.property.test.ts
// Property tests for the dispatch guarantees:
//   - fire-and-forget (publishAsync/emit) preserves publish order regardless of
//     per-handler completion timing;
//   - listener error isolation: every non-throwing listener runs, publish
//     resolves, and stats.failed equals the number of throwing listeners;
//   - wildcard delivery is consistent with the matcher: a pattern listener
//     receives an event iff matchesPattern(name, pattern).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { createEvents } from '../facade.js';
import { matchesPattern } from '../matcher.js';

interface AppEvents {
  'user.created': { n: number };
  'user.updated': { n: number };
  'user.deleted': { n: number };
  'order.shipped': { n: number };
  'order.cancelled': { n: number };
  'payment.captured': { n: number };
}
const ALL_NAMES: Array<keyof AppEvents> = [
  'user.created',
  'user.updated',
  'user.deleted',
  'order.shipped',
  'order.cancelled',
  'payment.captured',
];

/** Yield the event loop a given number of microtasks (jitter without real timers). */
async function microticks(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- intentional microtask jitter
    await Promise.resolve();
  }
}

// ── Property: ordered fire-and-forget delivery ─────────────────────────────────

test('property: publishAsync delivers in strict publish order despite handler jitter', async () => {
  await fc.assert(
    fc.asyncProperty(
      // A sequence of (event index, microtask-jitter) pairs.
      fc.array(
        fc.record({ idx: fc.nat({ max: ALL_NAMES.length - 1 }), jitter: fc.nat({ max: 5 }) }),
        { minLength: 0, maxLength: 12 },
      ),
      async (seq) => {
        const events = createEvents<AppEvents>();
        const delivered: number[] = [];
        // A single handler for every event records the payload's sequence number
        // after a random number of microtasks — earlier events may "finish"
        // after later ones, yet ordered dispatch must preserve publish order.
        events.on('**', async (payload) => {
          const p = payload as { n: number; jitter: number };
          await microticks(p.jitter);
          delivered.push(p.n);
        });

        seq.forEach((s, n) => {
          const name = ALL_NAMES[s.idx]!;
          events.emit(name, { n, jitter: s.jitter } as AppEvents[typeof name]);
        });

        await events.flush();
        // Delivery order equals publish order (0, 1, 2, ...).
        assert.deepEqual(delivered, seq.map((_s, n) => n));
        await events.close();
      },
    ),
    { numRuns: 100 },
  );
});

// ── Property: listener error isolation ─────────────────────────────────────────

test('property: throwing listeners are isolated; siblings run and publish resolves', async () => {
  await fc.assert(
    fc.asyncProperty(
      // A boolean per listener: true = this listener throws.
      fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
      async (throwFlags) => {
        let failedCount = 0;
        const events = createEvents<AppEvents>({ onError: () => (failedCount += 1) });
        const ran: number[] = [];

        throwFlags.forEach((shouldThrow, i) => {
          events.on('user.created', () => {
            ran.push(i);
            if (shouldThrow) {
              throw new Error(`listener ${i} failed`);
            }
          });
        });

        // publish must resolve regardless of how many listeners throw.
        await events.publish('user.created', { n: 1 });

        // Every listener ran exactly once, in registration order.
        assert.deepEqual(ran, throwFlags.map((_f, i) => i));
        // Failed count (via onError and stats) equals the number of throwers.
        const expectedFailures = throwFlags.filter(Boolean).length;
        assert.equal(failedCount, expectedFailures);
        assert.equal(events.stats().failed, expectedFailures);
        assert.equal(events.stats().delivered, throwFlags.length - expectedFailures);
        await events.close();
      },
    ),
    { numRuns: 100 },
  );
});

// ── Property: wildcard delivery is consistent with the matcher ─────────────────

test('property: a pattern listener receives an event iff matchesPattern(name, pattern)', async () => {
  const patternArb = fc.constantFrom(
    'user.*',
    'user.**',
    'order.*',
    'payment.*',
    '**',
    'user.created',
    'order.shipped',
    'nomatch.*',
  );
  await fc.assert(
    fc.asyncProperty(
      patternArb,
      fc.array(fc.constantFrom(...ALL_NAMES), { minLength: 0, maxLength: 12 }),
      async (pattern, published) => {
        const events = createEvents<AppEvents>();
        const received: string[] = [];
        events.on(pattern, (_p, ctx) => {
          received.push(ctx.event);
        });

        for (const name of published) {
          // eslint-disable-next-line no-await-in-loop -- deterministic sequential publish
          await events.publish(name, { n: 0 });
        }

        // The listener must have received exactly the published names that match
        // the pattern, in publish order (matcher is the oracle).
        const expected = published.filter((name) => matchesPattern(name, pattern));
        assert.deepEqual(received, expected);
        await events.close();
      },
    ),
    { numRuns: 100 },
  );
});
