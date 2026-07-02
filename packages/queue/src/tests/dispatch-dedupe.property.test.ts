// src/tests/dispatch-dedupe.property.test.ts
// Property test for idempotent dispatch dedupe.
//
// Feature: queue-framework, Property 10: Dispatch dedupe is idempotent
// Validates: Requirements 14.5, 14.7
//
// Req 14.5: WHEN two dispatches carry the same `dedupeKey` to the same queue
//   while the first is still pending or ready, THE Queue_Facade SHALL enqueue
//   at most one envelope and drop the duplicate.
// Req 14.7: WHEN a duplicate dispatch is dropped because its `dedupeKey`
//   matches a still-pending or ready job in the same queue, THE Queue_Facade
//   SHALL enqueue exactly one envelope AND SHALL count both the original
//   dispatch and the dropped duplicate toward queue dispatch metrics.
//
// Strategy: through the real facade (via the TestHarness with an injected,
// advanceable clock and no Redis), issue N (>= 2) dispatches that all share the
// same `dedupeKey` on the same queue *before* anything is reserved (so the
// first is still pending/ready). We then assert the two observable
// consequences of idempotent dedupe:
//
//   (1) "at most one envelope enqueued" — draining every ready reservation with
//       `reserveAll()` yields exactly ONE reservation (Req 14.5), and that
//       envelope carries the shared dedupe key and queue.
//   (2) "both dispatches count / idempotent" — every one of the N `dispatch()`
//       calls resolves to the SAME job id (the id of the single enqueued
//       envelope). A dropped duplicate therefore still travels the full
//       dispatch path and is recognized (counted) rather than erroring or being
//       silently ignored differently (Req 14.7). The facade's internal
//       `dispatchCount` (which is incremented on EVERY dispatch, including the
//       dropped duplicate) is a protected field not exposed on the public
//       `Queue` surface, so the same-id + single-envelope observations are the
//       faithful public-API witnesses of "both counted".
//
// Control cases guard against over-deduping: distinct dedupe keys on one queue
// each produce their own envelope, and the SAME dedupe key on DIFFERENT queues
// is NOT deduped (dedupe is scoped per queue), so both envelopes survive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { Job } from '../job.js';
import { TestHarness } from '../testing.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A minimal concrete Job used solely to exercise dispatch/dedupe behavior. */
class TestJob extends Job<{ index: number }> {
  readonly type = 'test';
}

/** A small set of queue names so ties/scoping are exercised without \u0000 clashes. */
const QUEUE_NAMES = ['default', 'emails', 'reports', 'q-1'] as const;

// ── Property 10: idempotent dedupe on the same queue ──────────────────────────

test('Feature: queue-framework, Property 10 — N dispatches sharing a dedupeKey on one queue enqueue exactly one envelope and all return the same id', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...QUEUE_NAMES),
      // Any string is a valid dedupe key (including the empty string, which the
      // facade treats as defined and therefore dedupe-eligible).
      fc.string(),
      // At least two dispatches so there is a duplicate to drop.
      fc.integer({ min: 2, max: 8 }),
      async (queue, dedupeKey, count) => {
        const harness = new TestHarness({ queues: [queue] });
        try {
          // Issue all N dispatches sharing the same dedupeKey + queue BEFORE any
          // reservation, so the first stays pending/ready for every duplicate.
          const ids: string[] = [];
          for (let i = 0; i < count; i += 1) {
            // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
            const id = await harness.enqueue(new TestJob({ index: i }), { queue, dedupeKey });
            ids.push(id);
          }

          // (2) Idempotency: every dispatch resolved to the same job id — the
          // duplicates were recognized and counted, not errored (Req 14.7).
          const firstId = ids[0]!;
          for (let i = 1; i < ids.length; i += 1) {
            assert.equal(
              ids[i],
              firstId,
              `dispatch #${i} returned id ${ids[i]} but expected the deduped id ${firstId}`,
            );
          }

          // (1) At most one envelope enqueued: exactly one ready reservation
          // exists for all N duplicate dispatches (Req 14.5).
          const reservations = await harness.reserveAll();
          assert.equal(
            reservations.length,
            1,
            `expected exactly 1 enqueued envelope for ${count} duplicate dispatches, got ${reservations.length}`,
          );

          const only = reservations[0]!.envelope;
          assert.equal(only.id, firstId, 'the single reserved envelope must be the deduped job');
          assert.equal(only.queue, queue, 'the reserved envelope must land on the dispatched queue');
          assert.equal(only.dedupeKey, dedupeKey, 'the reserved envelope must carry the shared dedupe key');
        } finally {
          await harness.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ── Control: distinct dedupe keys are NOT deduped ─────────────────────────────

test('Feature: queue-framework, Property 10 (control) — distinct dedupeKeys on one queue each enqueue their own envelope', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...QUEUE_NAMES),
      // A set of pairwise-distinct dedupe keys.
      fc.uniqueArray(fc.string(), { minLength: 1, maxLength: 8 }),
      async (queue, keys) => {
        const harness = new TestHarness({ queues: [queue] });
        try {
          const ids: string[] = [];
          for (const key of keys) {
            // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
            const id = await harness.enqueue(new TestJob({ index: ids.length }), { queue, dedupeKey: key });
            ids.push(id);
          }

          // Distinct keys must produce distinct ids (no dedupe across keys).
          assert.equal(new Set(ids).size, keys.length, 'distinct dedupe keys must produce distinct job ids');

          // One envelope per distinct key.
          const reservations = await harness.reserveAll();
          assert.equal(
            reservations.length,
            keys.length,
            `expected ${keys.length} envelopes for ${keys.length} distinct dedupe keys, got ${reservations.length}`,
          );
        } finally {
          await harness.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ── Control: dedupe is scoped per queue ───────────────────────────────────────

test('Feature: queue-framework, Property 10 (control) — the same dedupeKey on different queues is not deduped (queue-scoped)', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string(),
      // Two distinct queue names drawn from the fixed set.
      fc
        .uniqueArray(fc.constantFrom(...QUEUE_NAMES), { minLength: 2, maxLength: 2 })
        .map(([a, b]) => [a!, b!] as const),
      async (dedupeKey, [queueA, queueB]) => {
        const harness = new TestHarness({ queues: [queueA, queueB] });
        try {
          const idA = await harness.enqueue(new TestJob({ index: 0 }), { queue: queueA, dedupeKey });
          const idB = await harness.enqueue(new TestJob({ index: 1 }), { queue: queueB, dedupeKey });

          // Same key on different queues is a different scope — no dedupe.
          assert.notEqual(idA, idB, 'the same dedupeKey on different queues must not be deduped');

          const reservations = await harness.reserveAll();
          assert.equal(
            reservations.length,
            2,
            `expected 2 envelopes across two queues sharing a dedupeKey, got ${reservations.length}`,
          );
        } finally {
          await harness.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
