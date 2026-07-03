// Property-based test for the storage facade's lifecycle engine (task 15.2).
//
// Property 14: Lifecycle action applies exactly once. For an arbitrary set of
// objects (each placed at a controllable age) and a `delete-after-days` rule
// with an arbitrary day threshold, evaluating the rule via
// `storage.applyLifecycle(rule)` at a fixed clock instant actions each
// qualifying object EXACTLY ONCE:
//
//   - the first evaluation's outcomes are exactly the set of objects whose age
//     meets the threshold (one `deleted` outcome per qualifying object), and
//   - a second evaluation of the same rule at the same clock instant produces
//     no further outcomes, because every actioned object has been removed from
//     the space a subsequent scan enumerates.
//
// A controllable clock makes object ages deterministic: each object is written
// at `now - ageDays` so its age at evaluation time is exactly `ageDays`. Backed
// by the zero-dependency in-memory provider (no native `lifecycle` capability,
// so the engine simulates evaluation over the driver primitives). Exercised
// with fast-check at { numRuns: 100 }; executed via the Node.js built-in test
// runner (`node --test dist/tests/*.test.js`).
//
// Feature: unified-storage-framework, Property 14
// Validates: Requirements 13.2, 26.6

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";
import { MemoryStorageDriver } from "../drivers/memory.js";

const DAY = 24 * 60 * 60 * 1000;
// A fixed evaluation instant, chosen large enough that every object's write
// time (`NOW - ageDays * DAY`) stays positive for the age ranges used here.
const NOW = 1_700_000_000_000;

test(
  "Feature: unified-storage-framework, Property 14 — lifecycle action applies exactly once",
  { concurrency: false },
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // An arbitrary set of objects with unique, application-visible keys
        // (never a reserved bookkeeping prefix, which age-based rules skip),
        // each with a deterministic age in days and arbitrary byte content.
        fc.uniqueArray(
          fc.record({
            key: fc
              .string({ minLength: 1 })
              .filter((k) => !k.startsWith(".") && k.trim().length > 0),
            ageDays: fc.integer({ min: 0, max: 60 }),
            content: fc.uint8Array(),
          }),
          { selector: (o) => o.key, maxLength: 12 },
        ),
        // An arbitrary day threshold for the delete-after-days rule.
        fc.integer({ min: 1, max: 30 }),
        async (objects, thresholdDays) => {
          // A controllable clock shared by the driver and the facade so both
          // object creation time and lifecycle age are deterministic.
          let clockValue = NOW;
          const clock = () => clockValue;
          const driver = new MemoryStorageDriver({ clock });
          const storage = createStorage({ provider: "memory", driver, clock });

          // Place each object so its age at NOW is exactly `ageDays`.
          for (const { key, ageDays, content } of objects) {
            clockValue = NOW - ageDays * DAY;
            await storage.put(key, content);
          }

          // Evaluate the rule at the fixed instant NOW.
          clockValue = NOW;
          const rule = { type: "delete-after-days", days: thresholdDays };

          // The qualifying set: objects at least `thresholdDays` old.
          const expectedKeys = objects
            .filter((o) => o.ageDays >= thresholdDays)
            .map((o) => o.key)
            .sort();

          const first = await storage.applyLifecycle(rule);

          // Every outcome is a delete, and the actioned keys are exactly the
          // qualifying set — each qualifying object actioned exactly once.
          assert.ok(first.every((o) => o.action === "deleted"));
          assert.deepEqual(
            first.map((o) => o.key).sort(),
            expectedKeys,
          );
          // No duplicate outcomes within a single evaluation.
          assert.equal(new Set(first.map((o) => o.key)).size, first.length);

          // A second evaluation at the same instant produces no further
          // outcomes: already-actioned objects are not re-actioned.
          const second = await storage.applyLifecycle(rule);
          assert.deepEqual(second, []);

          // Qualifying objects are gone; non-qualifying objects remain.
          for (const { key, ageDays } of objects) {
            assert.equal(await storage.exists(key), ageDays < thresholdDays);
          }
        },
      ),
      { numRuns: 100 },
    );
  },
);
