// src/tests/priority-ordering.property.test.ts
// Property test for priority ordering with FIFO tie-break.
//
// Feature: queue-framework, Property 2: Priority ordering within a queue
// Validates: Requirements 8.1, 8.2
//
// Req 8.1: WHEN successive reservations are made from one queue, THE
//   Queue_Driver SHALL return jobs in non-increasing priority order.
// Req 8.2: WHEN multiple ready jobs in one queue share the same priority, THE
//   Queue_Driver SHALL return them in FIFO order by enqueue sequence.
//
// Strategy: generate a random array of priorities, dispatch a job per priority
// (in array order, so each dispatch takes the next enqueue `seq`) through the
// real facade via the TestHarness, then drain every ready reservation with
// `reserveAll()`. The reserved order must be non-increasing in
// `envelope.priority`, and within any run of equal priority must be strictly
// ascending in `envelope.seq` (FIFO). No Redis and no wall-clock timing are
// used — the harness injects an advanceable clock and drives the MemoryDriver
// directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { Job } from '../job.js';
import { TestHarness } from '../testing.js';
import type { Reservation } from '../drivers/driver.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A minimal concrete Job used solely to exercise enqueue/reserve ordering. */
class TestJob extends Job<{ index: number }> {
  readonly type = 'test';
}

/**
 * Assert the reserved sequence obeys priority ordering (Req 8.1) and FIFO
 * tie-break within equal priority (Req 8.2). Throws (via node:assert) on the
 * first violation so fast-check can shrink to a minimal counterexample.
 */
function assertPriorityFifo(reservations: Reservation[]): void {
  for (let i = 1; i < reservations.length; i += 1) {
    const prev = reservations[i - 1]!.envelope;
    const curr = reservations[i]!.envelope;

    // Req 8.1: non-increasing priority across successive reservations.
    assert.ok(
      prev.priority >= curr.priority,
      `priority ordering violated at #${i}: ${prev.priority} then ${curr.priority}`,
    );

    // Req 8.2: within equal priority, FIFO by ascending enqueue `seq`.
    if (prev.priority === curr.priority) {
      assert.ok(
        prev.seq < curr.seq,
        `FIFO tie-break violated at #${i} (priority ${curr.priority}): ` +
          `seq ${prev.seq} then ${curr.seq}`,
      );
    }
  }
}

// ── Property 2 ────────────────────────────────────────────────────────────────

test('Feature: queue-framework, Property 2 — reservations are non-increasing in priority and FIFO by seq within equal priority', async () => {
  await fc.assert(
    fc.asyncProperty(
      // A non-empty list of priorities, deliberately drawn from a small range so
      // ties are common and the FIFO tie-break is exercised often.
      fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 1, maxLength: 40 }),
      async (priorities) => {
        const harness = new TestHarness();
        try {
          // Enqueue in array order; each dispatch consumes the next `seq`.
          for (let i = 0; i < priorities.length; i += 1) {
            // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
            await harness.enqueue(new TestJob({ index: i }), { priority: priorities[i]! });
          }

          const reservations = await harness.reserveAll();

          // Every enqueued job must be reservable exactly once.
          assert.equal(
            reservations.length,
            priorities.length,
            `expected ${priorities.length} reservations, got ${reservations.length}`,
          );

          assertPriorityFifo(reservations);
        } finally {
          await harness.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
