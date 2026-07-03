// src/tests/unique-run-ids.property.test.ts
// Property 7: Workflow run identifiers are unique.
// Feature: workflow-engine, Property 7
//
// Validates: Requirements 26.8, 2.1, 20.4
//
// For any sequence of started Workflow_Runs, every assigned Workflow_Run_Id is
// unique across all runs recorded by the configured Persistence_Store (design
// Property 7). This mirrors the acceptance criteria:
//
//   - Req 2.1:  `run` creates a Workflow_Run with a UNIQUE Workflow_Run_Id.
//   - Req 20.4: THE Workflow_Engine SHALL assign a Workflow_Run_Id that is unique
//               across all Workflow_Runs recorded by the configured
//               Persistence_Store.
//   - Req 26.8: THE property tests SHALL assert that every assigned
//               Workflow_Run_Id is unique (unique-id property).
//
// The property starts an arbitrary count N (1..50) of runs from the same
// registered definition, collects every `handle.runId`, and asserts:
//   1. every runId is a non-empty string, and
//   2. all N runIds are distinct (new Set(ids).size === ids.length).
//
// A trivial workflow (returns its input) plus an injected fake Clock make every
// run complete deterministically against the zero-dependency
// MemoryWorkflowStore — no external services and no wall-clock dependence.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";

// ── Property 7: unique Workflow_Run identifiers ──────────────────────────────────

test("Feature: workflow-engine, Property 7 — every assigned Workflow_Run_Id is a non-empty string and unique across all runs", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 50 }), // number of runs to start from one definition
      async (runCount) => {
        // A deterministic fake Clock: every timestamp the engine mints comes from
        // here, so run completion is fully deterministic and never touches the
        // wall clock. A constant instant deliberately makes createdAt/updatedAt
        // identical across runs — the runId uniqueness must not depend on time.
        const clock: Clock = () => 1_000;

        // Default MemoryWorkflowStore (Req 1.2) — the configured Persistence_Store
        // across which every Workflow_Run_Id must be unique (Req 20.4).
        const engine = createWorkflow({ clock });

        // A trivial workflow that simply returns its input, so each run completes
        // immediately and deterministically.
        engine.define<number, number>("echo", (_ctx, input) => input);

        const ids: string[] = [];
        for (let i = 0; i < runCount; i += 1) {
          const handle = await engine.run<number, number>("echo", i);
          ids.push(handle.runId);
        }

        await engine.close();

        // (1) Every assigned Workflow_Run_Id is a non-empty string.
        for (const id of ids) {
          assert.equal(typeof id, "string", `runId ${JSON.stringify(id)} is not a string`);
          assert.ok(id.length > 0, "assigned runId is an empty string");
        }

        // (2) All assigned Workflow_Run_Ids are distinct (unique-id property).
        assert.equal(
          new Set(ids).size,
          ids.length,
          `expected ${ids.length} unique runIds, saw ${new Set(ids).size} distinct`,
        );
      },
    ),
    { numRuns: 100 },
  );
});
