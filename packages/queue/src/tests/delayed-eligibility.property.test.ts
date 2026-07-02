// src/tests/delayed-eligibility.property.test.ts
// Property test for delayed-job eligibility.
//
// Feature: queue-framework, Property 1: Delayed jobs never run before their due time
// Validates: Requirements 3.3, 3.4
//
// Req 3.3: WHILE the clock time is strictly before a delayed job's Due_Time,
//   THE Queue_Driver SHALL NOT make that job eligible for reservation.
// Req 3.4: WHEN the clock time reaches or passes a delayed job's Due_Time and
//   the Scheduler promotes due jobs, THE Queue_Driver SHALL make that job
//   eligible for reservation.
//
// Strategy: generate a random Due_Time — either via a `delay` (ms) or an
// absolute `runAt` Date — then enqueue a single job through the real facade via
// the TestHarness. Due_Time is computed exactly as production does:
//   - delay mode: Due_Time = (clock captured right before enqueue) + delayMs
//   - runAt mode: Due_Time = runAt.getTime()
// A random sequence of interleaved `advance(step)` (which moves the mutable
// clock and calls driver.promoteDue(now)) and `reserveAll()` operations is then
// applied.
//
// SAFETY invariant (Req 3.3): the job is never present in a reservation while
// `clockNow` is strictly before Due_Time — every reservation of the job is
// checked to occur only at `clockNow >= DueTime`.
//
// LIVENESS invariant (Req 3.4): if the random interleaving never reserved the
// job, advancing the clock to exactly Due_Time (so a promote runs at
// `now === DueTime`, exercising the "reaches or passes" boundary) makes the job
// reservable. No Redis and no wall-clock timing are used — the harness injects
// an advanceable clock and drives the MemoryDriver directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { Job } from '../job.js';
import { TestHarness } from '../testing.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A minimal concrete Job used solely to exercise delayed eligibility. */
class DelayedJob extends Job<{ tag: number }> {
  readonly type = 'delayed';
}

/** One interleaved harness operation: advance the clock, or reserve ready jobs. */
type HarnessOp = { kind: 'advance'; step: number } | { kind: 'reserve' };

// ── Generators ────────────────────────────────────────────────────────────────

// A small non-negative start clock so both "delay" and "runAt" Due_Times land in
// a range that the small advance steps can plausibly reach (and sometimes miss).
const startClockArb = fc.integer({ min: 0, max: 1_000 });

// Due_Time source. `delay` uses a small non-negative delay (0 exercises the
// immediately-eligible boundary); `runAt` spans a little before/after the start
// clock so past (immediate) and future (delayed) absolute times are both drawn.
const dueSourceArb = fc.oneof(
  fc.record({ mode: fc.constant('delay' as const), delayMs: fc.integer({ min: 0, max: 500 }) }),
  fc.record({ mode: fc.constant('runAt' as const), offset: fc.integer({ min: -100, max: 500 }) }),
);

// Interleaved advance/reserve operations, with small advance steps so the clock
// frequently sits strictly before Due_Time (the region Req 3.3 constrains).
const opsArb = fc.array(
  fc.oneof(
    fc.record({ kind: fc.constant('advance' as const), step: fc.integer({ min: 0, max: 200 }) }),
    fc.record({ kind: fc.constant('reserve' as const) }),
  ),
  { minLength: 0, maxLength: 15 },
);

// ── Property 1 ────────────────────────────────────────────────────────────────

test('Feature: queue-framework, Property 1 — a delayed job is never reserved before its Due_Time and becomes eligible once the clock reaches/passes it', async () => {
  await fc.assert(
    fc.asyncProperty(
      startClockArb,
      dueSourceArb,
      opsArb,
      async (startClock, dueSource, ops: HarnessOp[]) => {
        const harness = new TestHarness({ now: startClock });
        try {
          // Capture the enqueue clock right before dispatch — the facade resolves
          // a `delay` against the clock value at enqueue time.
          const enqueueClock = harness.clockNow;

          let dueTime: number;
          let jobId: string;
          if (dueSource.mode === 'delay') {
            dueTime = enqueueClock + dueSource.delayMs;
            jobId = await harness.enqueue(new DelayedJob({ tag: 1 }), { delay: dueSource.delayMs });
          } else {
            const runAtMs = enqueueClock + dueSource.offset;
            dueTime = runAtMs;
            jobId = await harness.enqueue(new DelayedJob({ tag: 1 }), { runAt: new Date(runAtMs) });
          }

          let reserved = false;

          // Interleaved advances and reservations. SAFETY: any time the job shows
          // up in a reservation, the clock must be at or past its Due_Time.
          for (const op of ops) {
            if (op.kind === 'advance') {
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              await harness.advance(op.step);
            } else {
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              const reservations = await harness.reserveAll();
              const found = reservations.some((r) => r.envelope.id === jobId);
              if (found) {
                assert.ok(
                  harness.clockNow >= dueTime,
                  `Req 3.3 violated: job reserved at clock ${harness.clockNow} ` +
                    `strictly before Due_Time ${dueTime}`,
                );
                reserved = true;
              }
            }
          }

          // LIVENESS (Req 3.4): if the random interleaving never reserved the job,
          // advancing to exactly Due_Time must promote it (boundary: reaches or
          // passes) so a subsequent reserve returns it.
          if (!reserved) {
            if (harness.clockNow < dueTime) {
              await harness.advance(dueTime - harness.clockNow);
            }
            // At/after Due_Time now; advance(...) above (or an earlier advance) ran
            // promoteDue at now >= Due_Time. If we are already exactly at Due_Time
            // with no prior promote at this instant, run one more zero-advance to
            // guarantee a promote fired at now === Due_Time.
            await harness.advance(0);

            const reservations = await harness.reserveAll();
            const found = reservations.some((r) => r.envelope.id === jobId);
            assert.ok(
              found,
              `Req 3.4 violated: job not eligible at clock ${harness.clockNow} ` +
                `despite reaching Due_Time ${dueTime}`,
            );
            // Re-affirm the safety bound holds at the eligibility instant.
            assert.ok(harness.clockNow >= dueTime, 'eligibility must not precede Due_Time');
          }
        } finally {
          await harness.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
