// src/tests/timer-order.property.test.ts
// Property 6: Timers preserve relative firing order.
// Feature: workflow-engine, Property 6
//
// Validates:
//   - Req 26.7: The property tests SHALL assert that Timers preserve their
//     relative firing order (timer-ordering property).
//   - Req 9.5: WHEN a Workflow_Run with an unexpired Timer is resumed after a
//     process restart, THE Workflow_Engine SHALL preserve the original Timer
//     expiry time.
//
// For any set of runs each parked on a timer with an arbitrary ABSOLUTE expiry,
// the order in which the timers fire matches ascending expiry order regardless
// of the order in which the timers were set. The `SignalTimerCoordinator`
// resumes every run whose absolute expiry is at or before the current Clock
// time, exactly once each. By advancing an injectable fake Clock progressively
// through each distinct expiry in ascending order and concatenating the firings
// each step produces, the observed firing order is asserted to be
// non-decreasing by expiry — i.e. a timer with an earlier expiry never fires
// after one with a later expiry. Ties (equal expiries) may be broken
// deterministically and are allowed by the non-decreasing assertion.
//
// Because the expiry recorded on each CommandRecord is ABSOLUTE, it survives a
// simulated process restart: a fresh coordinator reconstructed over the same
// persisted runs (with a freshly reset Clock) reproduces the identical firing
// order, demonstrating the original expiry time is preserved (Req 9.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { SignalTimerCoordinator } from '../coordinator.js';
import { MemoryWorkflowStore } from '../store.js';
import type { WorkflowRun } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A mutable, injectable fake Clock: `tick.now` drives every timer decision. */
interface FakeClock {
  now: number;
  readonly clock: () => number;
}

function makeClock(start = 0): FakeClock {
  const state = { now: start } as { now: number };
  return {
    get now(): number {
      return state.now;
    },
    set now(value: number) {
      state.now = value;
    },
    clock: () => state.now,
  };
}

/** A minimal `running` run to be parked on a timer. */
function baseRun(runId: string, createdAt: number): WorkflowRun {
  return {
    runId,
    definition: 'timer-order-spec',
    status: 'running',
    input: undefined,
    commands: [],
    nextSeq: 0,
    state: {},
    pendingSignals: [],
    history: [],
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Advance `clock` progressively through each distinct expiry in ascending order,
 * resuming due timers at each step and concatenating the firings in the order
 * the coordinator reports them. The returned list is the observed firing order.
 */
async function fireProgressively(
  coordinator: SignalTimerCoordinator,
  clock: FakeClock,
  distinctExpiriesAscending: readonly number[],
): Promise<number[]> {
  const firedExpiries: number[] = [];
  for (const expiry of distinctExpiriesAscending) {
    clock.now = expiry;
    const firings = await coordinator.resumeDueTimers();
    for (const firing of firings) {
      firedExpiries.push(firing.expiresAt);
    }
  }
  return firedExpiries;
}

/** `true` when every element is >= its predecessor (non-decreasing). */
function isNonDecreasing(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if ((values[i] as number) < (values[i - 1] as number)) {
      return false;
    }
  }
  return true;
}

// ── Generators ─────────────────────────────────────────────────────────────────

// A set of absolute expiries (Clock epoch ms), each strictly in the future of the
// Clock's start (0) so every run genuinely parks as `waiting`. Order is arbitrary
// so the "regardless of the order in which they were set" clause is exercised;
// duplicates are permitted so the deterministic tie-breaking path is covered.
const expiriesArb = fc.array(fc.integer({ min: 1, max: 1_000_000 }), {
  minLength: 1,
  maxLength: 12,
});

// ── Property 6: timers fire in ascending expiry order, preserved across restart ─

test('Feature: workflow-engine, Property 6 — timers fire in non-decreasing expiry order regardless of set order, preserved across a simulated restart', async () => {
  await fc.assert(
    fc.asyncProperty(expiriesArb, async (expiries) => {
      // A fresh store + fake Clock (started at 0) per case.
      const store = new MemoryWorkflowStore();
      const clock = makeClock(0);
      const coordinator = new SignalTimerCoordinator({ store, clock: clock.clock });

      // Park one run per expiry. The park order follows the arbitrary array
      // order, so the firing order must be independent of it.
      for (let i = 0; i < expiries.length; i += 1) {
        const expiresAt = expiries[i] as number;
        const run = baseRun(`run-${i}`, 0);
        await coordinator.park(run, { type: 'timer', kind: 'sleep', seq: 0, expiresAt });
      }

      const distinctAscending = [...new Set(expiries)].sort((a, b) => a - b);

      // ── First lifetime: advance the Clock progressively and observe firings. ──
      const order = await fireProgressively(coordinator, clock, distinctAscending);

      // Every parked timer fires exactly once.
      assert.equal(
        order.length,
        expiries.length,
        `expected all ${expiries.length} timers to fire exactly once, saw ${order.length}`,
      );
      // Relative firing order respects ascending expiry: an earlier expiry never
      // fires after a later one (ties allowed).
      assert.ok(
        isNonDecreasing(order),
        `firing order was not non-decreasing by expiry: ${JSON.stringify(order)}`,
      );

      // ── Simulated restart: a NEW coordinator over the SAME persisted runs. ──
      // The absolute expiries recorded on each CommandRecord are preserved, so a
      // fresh coordinator with a reset Clock reproduces the identical order.
      const clockAfterRestart = makeClock(0);
      const coordinatorAfterRestart = new SignalTimerCoordinator({
        store,
        clock: clockAfterRestart.clock,
      });

      // Sanity: the persisted runs are still parked on their original expiries.
      const persisted = await store.listIncomplete();
      assert.equal(
        persisted.length,
        expiries.length,
        'all parked runs must survive the simulated restart in the persisted store',
      );

      const orderAfterRestart = await fireProgressively(
        coordinatorAfterRestart,
        clockAfterRestart,
        distinctAscending,
      );

      // The restarted firing order is likewise non-decreasing by expiry and
      // identical to the pre-restart order — the original expiry times were
      // preserved across the restart (Req 9.5).
      assert.ok(
        isNonDecreasing(orderAfterRestart),
        `post-restart firing order was not non-decreasing: ${JSON.stringify(orderAfterRestart)}`,
      );
      assert.deepEqual(
        orderAfterRestart,
        order,
        'firing order must be identical across a simulated restart (absolute expiry preserved)',
      );
    }),
    { numRuns: 100 },
  );
});
