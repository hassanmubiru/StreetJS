// src/tests/driver-interchangeability.property.test.ts
// Property test for driver interchangeability (behavioral equivalence).
//
// Feature: queue-framework, Property 8: Driver interchangeability (behavioral
//   equivalence)
// Validates: Requirements 13.2
//
// Req 13.2: For any sequence of dispatch/reserve/ack/nack/promote/dead-letter
//   operations and any injected clock schedule, the observable outcomes —
//   which jobs are delivered, in what priority/FIFO order, how many attempts
//   each receives, and which land in the DLQ — are identical whether the
//   operations run against the `MemoryDriver` or the (simulated) `RedisDriver`,
//   up to the documented at-least-once semantics.
//
// Strategy: generate (a) a batch of jobs with random queue/priority/maxAttempts
// and an optional delay, and (b) a random interleaving of reserve / ack / nack /
// promote / move-to-dead-letter / advance-clock operations. The SAME logical
// script is applied step-by-step to BOTH drivers under a SINGLE shared injected
// clock (`now`), and the observable projections are compared:
//
//   • delivery order + per-reserve attempt count — asserted at EVERY reserve
//     (the i-th reserve must return the same job id and the same consumed
//     `attempts` on both drivers);
//   • promotion counts — asserted at every `promoteDue`;
//   • final live stats (ready / delayed / reserved / dead-lettered);
//   • final DLQ membership (multiset of {id, queue, attempts, maxAttempts}).
//
// The two drivers get INDEPENDENT envelope copies (Memory mutates the shared
// envelope object in place; Redis round-trips JSON), so cross-driver state never
// leaks. Reservations carry driver-specific opaque tokens, so we never assert on
// tokens — only on the well-defined observable projections above.
//
// "Up to at-least-once semantics": a reservation whose visibility lease expires
// may be reclaimed and re-delivered. Because `moveToDeadLetter` is intentionally
// ownership-unchecked in both drivers, dead-lettering an ALREADY-SUPERSEDED
// (reclaimed + re-delivered) reservation is undefined w.r.t. the recorded
// attempt count; the harness therefore only applies ack/nack/DLQ operations to
// reservations that have not been superseded by a later re-delivery, keeping the
// compared outcomes well-defined and identical across drivers.
//
// No real Redis and no wall-clock timing: the RedisDriver is backed by the
// in-process `SimulatedRedis` (see ./sim-redis.ts) and all timing flows through
// the shared `now` variable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import type { JobEnvelope, SerializedError } from '../job.js';
import type { QueueDriver, Reservation } from '../drivers/driver.js';
import { MemoryDriver } from '../drivers/memory.js';
import { RedisDriver } from '../drivers/redis.js';
import { SimulatedRedis } from './sim-redis.js';

// ── Generated model ───────────────────────────────────────────────────────────

/** The two queues used; reserve always scans them in this cross-queue order. */
const QUEUES = ['qA', 'qB'] as const;

/** Visibility lease (ms) granted on every reservation. */
const VISIBILITY_MS = 500;

/** A generated job to enqueue up-front (seq is its index in the batch). */
interface JobSpec {
  readonly queueIndex: number; // 0 | 1 → QUEUES[queueIndex]
  readonly priority: number;
  readonly maxAttempts: number;
  /** Delay in ms (relative to clock start). 0 ⇒ enqueue ready; > 0 ⇒ delayed. */
  readonly delayMs: number;
}

/** One operation in the interleaved script. */
type Op =
  | { readonly kind: 'reserve' }
  | { readonly kind: 'ack'; readonly idx: number }
  | { readonly kind: 'nack'; readonly idx: number; readonly delayMs: number }
  | { readonly kind: 'deadletter'; readonly idx: number }
  | { readonly kind: 'promote' }
  | { readonly kind: 'advance'; readonly ms: number };

const jobSpecArb: fc.Arbitrary<JobSpec> = fc.record({
  queueIndex: fc.integer({ min: 0, max: 1 }),
  priority: fc.integer({ min: -3, max: 3 }),
  maxAttempts: fc.integer({ min: 1, max: 3 }),
  delayMs: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 300 })),
});

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('reserve' as const) }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('ack' as const), idx: fc.nat({ max: 1000 }) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('nack' as const),
      idx: fc.nat({ max: 1000 }),
      delayMs: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 300 })),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('deadletter' as const), idx: fc.nat({ max: 1000 }) }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('promote' as const) }) },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant('advance' as const), ms: fc.integer({ min: 1, max: 700 }) }),
  },
);

// ── Harness helpers ─────────────────────────────────────────────────────────

/** Build a fresh envelope. Each driver gets its OWN copy (no shared mutation). */
function makeEnvelope(spec: JobSpec, seq: number): JobEnvelope {
  return {
    id: `job-${seq}`,
    type: 'sim-job',
    queue: QUEUES[spec.queueIndex]!,
    payload: { n: seq },
    priority: spec.priority,
    attempts: 0,
    maxAttempts: spec.maxAttempts,
    enqueuedAt: 0,
    seq,
  };
}

/** A paired reservation held simultaneously on both drivers for one logical pop. */
interface HeldPair {
  readonly id: string;
  readonly mem: Reservation;
  readonly redis: Reservation;
  /** True once a later re-delivery of the same id has superseded this holding. */
  superseded: boolean;
  /** True once ack/nack/DLQ has consumed this holding. */
  resolved: boolean;
}

/** Canonical, timestamp-free projection of a dead-letter record for comparison. */
function dlqKey(record: {
  id: string;
  queue: string;
  attempts: number;
  maxAttempts: number;
  type: string;
}): string {
  return `${record.id}|${record.queue}|${record.type}|${record.attempts}/${record.maxAttempts}`;
}

const SERIALIZED_ERROR: SerializedError = { name: 'SimFailure', message: 'boom' };

// ── Property 8 ────────────────────────────────────────────────────────────────

test('Feature: queue-framework, Property 8 — MemoryDriver and simulated RedisDriver produce identical observable outcomes under the same script and clock', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(jobSpecArb, { minLength: 1, maxLength: 12 }),
      fc.array(opArb, { minLength: 1, maxLength: 60 }),
      async (specs, ops) => {
        const mem: QueueDriver = new MemoryDriver();
        const redis: QueueDriver = new RedisDriver({
          client: new SimulatedRedis(),
          keyPrefix: 'sim',
          visibilityMs: VISIBILITY_MS,
        });

        await mem.init();
        await redis.init();

        try {
          // ── Enqueue the whole batch identically on both drivers ────────────
          // seq == enqueue index (assigned in batch order), so FIFO tie-break is
          // well-defined and identical for both backends.
          for (let seq = 0; seq < specs.length; seq += 1) {
            const spec = specs[seq]!;
            const queue = QUEUES[spec.queueIndex]!;
            const envMem = makeEnvelope(spec, seq);
            const envRedis = makeEnvelope(spec, seq);
            if (spec.delayMs > 0) {
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              await mem.enqueueDelayed(queue, envMem, spec.delayMs);
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              await redis.enqueueDelayed(queue, envRedis, spec.delayMs);
            } else {
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              await mem.enqueue(queue, envMem);
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              await redis.enqueue(queue, envRedis);
            }
          }

          const queues = [...QUEUES];
          const held: HeldPair[] = [];
          let now = 0;

          /** Reservations that can still be validly acted upon (in seq order). */
          const activeHoldings = (): HeldPair[] => held.filter((h) => !h.resolved && !h.superseded);

          // ── Replay the interleaved operation script on BOTH drivers ────────
          for (const op of ops) {
            switch (op.kind) {
              case 'reserve': {
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                const rMem = await mem.reserve(queues, VISIBILITY_MS, now);
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                const rRedis = await redis.reserve(queues, VISIBILITY_MS, now);

                // Both drivers must agree on emptiness at this exact step.
                assert.equal(
                  rMem === null,
                  rRedis === null,
                  `reserve emptiness diverged (now=${now}): mem=${rMem === null ? 'null' : rMem.envelope.id}, redis=${rRedis === null ? 'null' : rRedis.envelope.id}`,
                );

                if (rMem !== null && rRedis !== null) {
                  // Delivery order: identical job id at this reserve step.
                  assert.equal(
                    rMem.envelope.id,
                    rRedis.envelope.id,
                    `delivery order diverged (now=${now}): mem=${rMem.envelope.id} vs redis=${rRedis.envelope.id}`,
                  );
                  // Per-job attempt count consumed at reserve: identical.
                  assert.equal(
                    rMem.envelope.attempts,
                    rRedis.envelope.attempts,
                    `attempt count diverged for ${rMem.envelope.id} (now=${now}): mem=${rMem.envelope.attempts} vs redis=${rRedis.envelope.attempts}`,
                  );

                  // A re-delivery of an id supersedes any earlier live holding.
                  for (const h of held) {
                    if (!h.resolved && h.id === rMem.envelope.id) {
                      h.superseded = true;
                    }
                  }
                  held.push({
                    id: rMem.envelope.id,
                    mem: rMem,
                    redis: rRedis,
                    superseded: false,
                    resolved: false,
                  });
                }
                break;
              }

              case 'ack': {
                const candidates = activeHoldings();
                if (candidates.length === 0) {
                  break;
                }
                const chosen = candidates[op.idx % candidates.length]!;
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                await mem.ack(chosen.mem);
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                await redis.ack(chosen.redis);
                chosen.resolved = true;
                break;
              }

              case 'nack': {
                const candidates = activeHoldings();
                if (candidates.length === 0) {
                  break;
                }
                const chosen = candidates[op.idx % candidates.length]!;
                const runAt = op.delayMs > 0 ? now + op.delayMs : undefined;
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                await mem.nack(chosen.mem, runAt);
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                await redis.nack(chosen.redis, runAt);
                chosen.resolved = true;
                break;
              }

              case 'deadletter': {
                const candidates = activeHoldings();
                if (candidates.length === 0) {
                  break;
                }
                const chosen = candidates[op.idx % candidates.length]!;
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                await mem.moveToDeadLetter(chosen.mem, SERIALIZED_ERROR);
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                await redis.moveToDeadLetter(chosen.redis, SERIALIZED_ERROR);
                chosen.resolved = true;
                break;
              }

              case 'promote': {
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                const pMem = await mem.promoteDue(now);
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                const pRedis = await redis.promoteDue(now);
                assert.equal(
                  pMem,
                  pRedis,
                  `promoteDue count diverged (now=${now}): mem=${pMem} vs redis=${pRedis}`,
                );
                break;
              }

              case 'advance': {
                now += op.ms;
                break;
              }

              default: {
                // Exhaustiveness guard.
                const _never: never = op;
                throw new Error(`unhandled op ${JSON.stringify(_never)}`);
              }
            }
          }

          // ── Final observable projections must match ────────────────────────

          const statsMem = await mem.stats();
          const statsRedis = await redis.stats();
          assert.deepEqual(
            statsRedis,
            statsMem,
            `final stats diverged: mem=${JSON.stringify(statsMem)} vs redis=${JSON.stringify(statsRedis)}`,
          );

          const deadMem = await mem.listDeadLetters(undefined, -1);
          const deadRedis = await redis.listDeadLetters(undefined, -1);
          const keysMem = deadMem.map(dlqKey).sort();
          const keysRedis = deadRedis.map(dlqKey).sort();
          assert.deepEqual(
            keysRedis,
            keysMem,
            `DLQ membership diverged:\n mem=${JSON.stringify(keysMem)}\n redis=${JSON.stringify(keysRedis)}`,
          );
        } finally {
          await mem.close();
          await redis.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
