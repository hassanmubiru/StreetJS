// src/tests/cron-scheduler.test.ts
// Task 8.3 — unit tests for cron dispatch and error handling in the Scheduler
// (src/scheduler.ts) and its facade wiring (src/facade.ts).
//
// The core `CronScheduler` fires on real wall-clock minute boundaries via real
// timers, so waiting for an actual timed fire is impractical in a unit test
// (it would block up to a minute). These tests therefore drive the cron path
// DETERMINISTICALLY through the one seam the Scheduler exposes: `schedule`
// registers its per-fire closure on a core `CronScheduler` via
// `CronScheduler.prototype.register(expr, name, fn)`. By briefly wrapping that
// prototype method we capture the exact `fn` the Scheduler wired up and invoke
// it ourselves — exercising the real fire → factory → dispatch path with no
// timers and no wall-clock waiting.
//
// Validates:
//   - Req 4.2: a fired cron entry dispatches a FRESH instance of the scheduled
//     job through the facade (constructor form re-instantiates per fire; an
//     instance form re-dispatches the same instance).
//   - Req 4.3: a malformed cron expression throws `CronParseError` SYNCHRONOUSLY
//     at registration with NO partial registration left behind.
//   - Req 4.4: single-instance re-entrancy is guarded — the Scheduler delegates
//     overlap prevention to the core `CronScheduler` re-entrancy guard, which
//     skips an overlapping fire of the same entry.
//   - Req 4.6: without a distributed lock, each running instance fires the cron
//     job once per tick (once per instance).
//   - Req 4.5 (bonus, for contrast): with a shared distributed lock, exactly one
//     instance dispatches per tick.
//
// What is NOT covered here (and why): an actual timer-driven fire on a real
// minute boundary is intentionally not exercised — it is non-deterministic and
// slow. The wiring that turns a fire into a fresh dispatch, the synchronous
// parse-error contract, the re-entrancy guard, and the per-instance/locked fire
// semantics are all asserted deterministically via the captured fire closure
// and the lock seam instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CronScheduler } from 'streetjs';
import type { Clock } from 'streetjs';

import { Scheduler, CronParseError, type SchedulerLock } from '../scheduler.js';
import { Job } from '../job.js';
import { createQueue } from '../facade.js';
import { MemoryDriver } from '../drivers/memory.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A zero-arg Job subclass (satisfies `new () => Job<unknown>`) for scheduling. */
class CleanupJob extends Job<{ ran: boolean }> {
  readonly type = 'cleanup';
  constructor() {
    super({ ran: true });
  }
}

/** A fixed clock so lock tick-keys are deterministic across instances. */
const fixedClock: Clock = () => 1000;

/** A large visibility lease so reservations never expire mid-test. */
const VISIBILITY_MS = 60_000;

/** A dispatch stub that records every job handed to it and returns a fake id. */
function recordingDispatch(sink: Array<Job<unknown>>): (job: Job<unknown>) => Promise<string> {
  let n = 0;
  return async (job) => {
    sink.push(job);
    return `job-${n++}`;
  };
}

/**
 * Run `fn` while capturing every fire closure the Scheduler registers on a core
 * `CronScheduler` via `register(expr, name, fn)`. Returns the captured closures
 * in registration order. The original `register` is always invoked (so a
 * malformed expression still throws) and always restored afterward.
 */
function withCapturedFires(fn: () => void): Array<() => Promise<void>> {
  const fires: Array<() => Promise<void>> = [];
  const original = CronScheduler.prototype.register;
  CronScheduler.prototype.register = function (
    this: CronScheduler,
    expr: string,
    name: string,
    f: () => Promise<void>,
  ): void {
    fires.push(f);
    original.call(this, expr, name, f);
  };
  try {
    fn();
  } finally {
    CronScheduler.prototype.register = original;
  }
  return fires;
}

// ── Req 4.2: a fired cron entry dispatches a fresh job instance ──────────────

test('a fired cron entry dispatches a fresh, distinct job instance on each fire (Req 4.2)', async () => {
  const dispatched: Array<Job<unknown>> = [];
  const scheduler = new Scheduler(new MemoryDriver(), recordingDispatch(dispatched));

  // Register a constructor-form schedule and capture its fire closure. `schedule`
  // never starts timers here (the scheduler is not started), so nothing leaks.
  const fires = withCapturedFires(() => scheduler.schedule('* * * * *', CleanupJob));
  assert.equal(fires.length, 1, 'schedule registered exactly one cron fire closure');

  // Fire twice: each fire re-instantiates the constructor (`new CleanupJob()`).
  await fires[0]!();
  await fires[0]!();

  assert.equal(dispatched.length, 2, 'each fire dispatched exactly one job');
  assert.ok(dispatched[0] instanceof CleanupJob, 'first fire dispatched a CleanupJob');
  assert.ok(dispatched[1] instanceof CleanupJob, 'second fire dispatched a CleanupJob');
  assert.notEqual(
    dispatched[0],
    dispatched[1],
    'each fire dispatches a FRESH, distinct instance (not a shared one)',
  );

  await scheduler.stop();
});

test('scheduling a job INSTANCE re-dispatches that same instance on each fire (Req 4.2)', async () => {
  const dispatched: Array<Job<unknown>> = [];
  const scheduler = new Scheduler(new MemoryDriver(), recordingDispatch(dispatched));
  const instance = new CleanupJob();

  const fires = withCapturedFires(() => scheduler.schedule('* * * * *', instance));
  await fires[0]!();
  await fires[0]!();

  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0], instance, 'instance-form re-dispatches the same instance');
  assert.equal(dispatched[1], instance, 'instance-form re-dispatches the same instance');

  await scheduler.stop();
});

test('a fired cron entry flows a fresh instance through the real facade dispatch path (Req 4.2)', async () => {
  // End-to-end wiring: schedule through the real `createQueue` facade so a fire
  // runs the production dispatch path (envelope build + enqueue). Two fires must
  // enqueue two distinct envelopes of the scheduled job's type.
  const driver = new MemoryDriver();
  const queue = createQueue({ driver, clock: fixedClock });

  const fires = withCapturedFires(() => queue.schedule('* * * * *', CleanupJob));
  assert.equal(fires.length, 1, 'facade.schedule registered exactly one cron fire closure');

  await fires[0]!();
  await fires[0]!();

  const r1 = await driver.reserve(['default'], VISIBILITY_MS, fixedClock());
  const r2 = await driver.reserve(['default'], VISIBILITY_MS, fixedClock());
  assert.ok(r1, 'first fire enqueued a reservable envelope');
  assert.ok(r2, 'second fire enqueued a reservable envelope');
  assert.equal(r1!.envelope.type, 'cleanup');
  assert.equal(r2!.envelope.type, 'cleanup');
  assert.notEqual(
    r1!.envelope.id,
    r2!.envelope.id,
    'each fire built a distinct envelope (a fresh instance per fire)',
  );

  await queue.close();
});

// ── Req 4.3: malformed cron throws synchronously with no partial registration ─

test('a malformed cron expression throws CronParseError synchronously with no partial registration (Req 4.3)', async () => {
  const dispatched: Array<Job<unknown>> = [];
  const scheduler = new Scheduler(new MemoryDriver(), recordingDispatch(dispatched));

  // The throw is synchronous (not a rejected promise): assert.throws proves it.
  assert.throws(
    () => scheduler.schedule('not a valid cron', CleanupJob),
    CronParseError,
    'a malformed expression throws CronParseError synchronously at registration',
  );

  // No partial registration: the Scheduler's internal cron list stays empty.
  const crons = (scheduler as unknown as { crons: unknown[] }).crons;
  assert.equal(crons.length, 0, 'a failed schedule left no partially-registered cron entry');

  // A subsequent VALID schedule still registers cleanly — the failure did not
  // corrupt the scheduler's state.
  scheduler.schedule('* * * * *', CleanupJob);
  assert.equal(crons.length, 1, 'a valid schedule registers normally after the failed one');

  await scheduler.stop();
});

test('queue.schedule surfaces CronParseError synchronously through the facade (Req 4.3)', async () => {
  const queue = createQueue();
  // Minute 61 is out of range → the core parser throws CronParseError, surfaced
  // synchronously by the facade at registration.
  assert.throws(() => queue.schedule('61 * * * *', CleanupJob), CronParseError);
  await queue.close();
});

// ── Req 4.4: single-instance re-entrancy guard ───────────────────────────────

test('single-instance re-entrancy is guarded: an overlapping fire of the same entry is skipped (Req 4.4)', async () => {
  // The Scheduler adds no guard of its own — it registers each schedule's fire
  // on a core `CronScheduler` and relies on that scheduler's re-entrancy guard
  // (Req 4.4). This asserts that guard directly: while one fire is still
  // running, a second concurrent fire of the same entry is skipped rather than
  // running concurrently. Driven via the core scheduler's internals to stay
  // deterministic (no wall-clock timer waiting).
  const cron = new CronScheduler();
  let fireCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  cron.register('* * * * *', 'entry', async () => {
    fireCount += 1;
    await gate; // park the fire so it stays "running"
  });

  const internals = cron as unknown as {
    started: boolean;
    jobs: Map<string, unknown>;
    _fire: (entry: unknown) => Promise<void>;
    stop: () => void;
  };
  // Mark the scheduler started (the guard is only active while started) without
  // scheduling a real wall-clock timer.
  internals.started = true;
  const entry = internals.jobs.get('entry');

  const first = internals._fire(entry); // begins the fn; it parks on the gate
  const second = internals._fire(entry); // overlapping fire — must be skipped
  await Promise.resolve(); // let both synchronous fire-bodies run

  assert.equal(fireCount, 1, 're-entrancy guard prevented the overlapping fire');

  // Stop before releasing so the post-await re-schedule sees `started === false`
  // and schedules no new timer; also clears any timer the skipped fire queued.
  internals.stop();
  release();
  await Promise.all([first, second]);
});

// ── Req 4.6: multi-instance without a lock fires once per instance ───────────

test('multi-instance without a distributed lock fires the cron job once per instance (Req 4.6)', async () => {
  const dispatchedA: Array<Job<unknown>> = [];
  const dispatchedB: Array<Job<unknown>> = [];
  const schedulerA = new Scheduler(new MemoryDriver(), recordingDispatch(dispatchedA));
  const schedulerB = new Scheduler(new MemoryDriver(), recordingDispatch(dispatchedB));

  // No `lock` configured on either scheduler → each fires independently.
  const fires = withCapturedFires(() => {
    schedulerA.schedule('* * * * *', CleanupJob);
    schedulerB.schedule('* * * * *', CleanupJob);
  });
  assert.equal(fires.length, 2, 'each instance registered its own cron fire closure');

  // The same tick reaching both instances: each dispatches once.
  await fires[0]!(); // instance A
  await fires[1]!(); // instance B

  assert.equal(dispatchedA.length, 1, 'instance A fired exactly once');
  assert.equal(dispatchedB.length, 1, 'instance B fired exactly once');

  await schedulerA.stop();
  await schedulerB.stop();
});

// ── Req 4.5 (bonus, for contrast): with a shared lock, exactly one fires ──────

test('multi-instance WITH a shared distributed lock dispatches exactly once per tick (Req 4.5)', async () => {
  // A shared lock that grants the first acquire of a key and rejects the rest,
  // modeling the core DistributedLock guarding a per-tick key. Fires are started
  // "concurrently" (the loser's acquire happens before the winner releases) to
  // model two instances contending on the same tick.
  const held = new Set<string>();
  const lock: SchedulerLock = {
    async tryAcquire(key: string) {
      if (held.has(key)) {
        return null;
      }
      held.add(key);
      return {
        async release() {
          held.delete(key);
        },
      };
    },
  };

  const dispatchedA: Array<Job<unknown>> = [];
  const dispatchedB: Array<Job<unknown>> = [];
  // A fixed shared clock makes both instances compute the SAME per-tick lock key.
  const schedulerA = new Scheduler(new MemoryDriver(), recordingDispatch(dispatchedA), {
    clock: fixedClock,
    lock,
  });
  const schedulerB = new Scheduler(new MemoryDriver(), recordingDispatch(dispatchedB), {
    clock: fixedClock,
    lock,
  });

  const fires = withCapturedFires(() => {
    schedulerA.schedule('* * * * *', CleanupJob);
    schedulerB.schedule('* * * * *', CleanupJob);
  });
  assert.equal(fires.length, 2);

  // Start both fires before awaiting either: the winner acquires the key, and
  // the loser's acquire (before release) returns null and skips.
  const pA = fires[0]!();
  const pB = fires[1]!();
  await Promise.all([pA, pB]);

  const total = dispatchedA.length + dispatchedB.length;
  assert.equal(total, 1, 'exactly one instance dispatched for the shared tick');

  await schedulerA.stop();
  await schedulerB.stop();
});
