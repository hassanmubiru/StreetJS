// src/tests/waiting.property.test.ts
// Property 5: Waiting resumes exactly once per wait.
// Feature: workflow-engine, Property 5
//
// Validates: Requirements 26.6, 9.1, 9.2, 17.2
//
// For any Workflow_Run parked as `waiting` on a Signal/event (Req 17.2) or a
// Timer (Req 9.1, 9.2), the SignalTimerCoordinator resumes the run EXACTLY ONCE
// when the wait is satisfied — no matter how many times the resume trigger is
// fired. The property drives the coordinator through the `onResume` callback and
// asserts the callback is invoked exactly one time (Req 26.6 single-resume):
//
//   - Signal/event wait: after parking on `events.waitFor(name)`, an arbitrary
//     number N of duplicate `deliverSignal(name)` calls plus extra direct
//     `resume()` calls still resume the run once.
//   - Timer wait: after parking on a timer whose absolute expiry is in the
//     future, no resume happens before expiry; once the injected fake Clock is
//     advanced past the expiry, an arbitrary number of `resumeDueTimers()`
//     passes (both store-scanning and explicit-list forms) plus extra direct
//     `resume()` calls still resume the run once.
//
// Everything runs against the zero-dependency MemoryWorkflowStore and a
// deterministic injectable fake Clock, so the test needs no external services.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { SignalTimerCoordinator } from "../coordinator.js";
import { MemoryWorkflowStore } from "../store.js";
import type { WorkflowRun } from "../types.js";

/**
 * Build a minimal valid `running` WorkflowRun. `park()` will transition it to
 * `waiting` and record the parking command under `seq`. All fields are JSON-safe
 * / structured-clone-friendly so the MemoryWorkflowStore can persist them.
 */
function makeRun(runId: string, seq: number): WorkflowRun {
  return {
    runId,
    definition: "wait-under-test",
    status: "running",
    input: null,
    commands: [],
    nextSeq: seq,
    state: {},
    pendingSignals: [],
    history: [{ type: "run.started", at: 0, input: null }],
    createdAt: 0,
    updatedAt: 0,
  };
}

// ── Property 5 — signal/event wait ───────────────────────────────────────────────

test("Feature: workflow-engine, Property 5 — a run waiting on a signal/event resumes exactly once regardless of duplicate deliveries", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 16 }), // awaited signal/event name
      fc.integer({ min: 0, max: 10_000 }), // parking command seq
      fc.integer({ min: 1, max: 12 }), // number of duplicate signal deliveries
      fc.integer({ min: 0, max: 20 }), // extra direct resume() calls
      async (name, seq, deliveries, directResumes) => {
        const store = new MemoryWorkflowStore();
        const now = 1_000;
        const clock: Clock = () => now;

        let resumeCount = 0;
        const coordinator = new SignalTimerCoordinator({
          store,
          clock,
          onResume: () => {
            resumeCount += 1;
          },
        });

        const run = makeRun("run-signal", seq);
        await store.save(run);
        await coordinator.park(run, { type: "signal", kind: "events.waitFor", seq, name });

        // Deliver the awaited signal an arbitrary number of times.
        for (let i = 0; i < deliveries; i += 1) {
          await coordinator.deliverSignal("run-signal", name, { attempt: i });
        }
        // And hammer the resume primitive directly on top of the deliveries.
        for (let i = 0; i < directResumes; i += 1) {
          await coordinator.resume("run-signal", seq);
        }

        assert.equal(
          resumeCount,
          1,
          `waiting run resumed ${resumeCount} time(s) after ${deliveries} deliveries + ${directResumes} direct resumes; expected exactly 1`,
        );
        assert.equal(coordinator.hasResumed("run-signal", seq), true, "wait was not marked resumed");
      },
    ),
    { numRuns: 100 },
  );
});

// ── Property 5 — timer wait ──────────────────────────────────────────────────────

test("Feature: workflow-engine, Property 5 — a run waiting on a timer resumes exactly once regardless of repeated expiry checks", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 0, max: 10_000 }), // parking command seq
      fc.integer({ min: 1, max: 100_000 }), // future timer duration (ms)
      fc.integer({ min: 1, max: 12 }), // number of resumeDueTimers passes after expiry
      fc.integer({ min: 0, max: 20 }), // extra direct resume() calls
      async (seq, duration, passes, directResumes) => {
        const store = new MemoryWorkflowStore();
        let now = 1_000;
        const clock: Clock = () => now;

        let resumeCount = 0;
        const coordinator = new SignalTimerCoordinator({
          store,
          clock,
          onResume: () => {
            resumeCount += 1;
          },
        });

        const run = makeRun("run-timer", seq);
        await store.save(run);
        const expiresAt = now + duration;
        const parked = await coordinator.park(run, { type: "timer", kind: "sleep", seq, expiresAt });

        // Before the Clock reaches the absolute expiry, nothing resumes (Req 9.1/9.2).
        await coordinator.resumeDueTimers([parked]);
        assert.equal(resumeCount, 0, "timer resumed before its expiry time");

        // Advance the injected Clock past the absolute expiry.
        now = expiresAt + 1;

        // Fire the resume trigger repeatedly: alternate the explicit-list form and
        // the store-scanning form of resumeDueTimers.
        for (let i = 0; i < passes; i += 1) {
          if (i % 2 === 0) {
            const current = await store.load("run-timer");
            await coordinator.resumeDueTimers([current as WorkflowRun]);
          } else {
            await coordinator.resumeDueTimers();
          }
        }
        // And hammer the resume primitive directly on top of the timer checks.
        for (let i = 0; i < directResumes; i += 1) {
          await coordinator.resume("run-timer", seq);
        }

        assert.equal(
          resumeCount,
          1,
          `waiting run resumed ${resumeCount} time(s) after ${passes} timer passes + ${directResumes} direct resumes; expected exactly 1`,
        );
        assert.equal(coordinator.hasResumed("run-timer", seq), true, "timer wait was not marked resumed");
      },
    ),
    { numRuns: 100 },
  );
});
