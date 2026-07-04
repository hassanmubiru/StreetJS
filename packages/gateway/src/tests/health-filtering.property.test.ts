import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { HealthRegistry } from "../health.js";
import { RoundRobinBalancer } from "../balancer.js";
import type { HealthState, UpstreamTarget } from "../types.js";

/**
 * Feature: gateway, Property: health-filtering
 *
 * For an arbitrary upstream pool with each target assigned an arbitrary recorded
 * health state, {@link HealthRegistry.filterHealthy} must return EXACTLY the
 * targets whose state is not "unhealthy" (healthy/unknown/unrecorded all pass —
 * fail-open), preserving order and never inventing a target. Downstream, a
 * balancer picking from the filtered pool must never return an unhealthy target.
 */

const stateArb: fc.Arbitrary<HealthState | "unset"> = fc.constantFrom(
  "healthy",
  "unhealthy",
  "unknown",
  "unset",
);

interface Item {
  readonly target: UpstreamTarget;
  readonly state: HealthState | "unset";
}

const poolArb: fc.Arbitrary<Item[]> = fc
  .array(stateArb, { minLength: 1, maxLength: 30 })
  .map((states) =>
    states.map((state, i) => ({ target: { id: `t${i}`, url: `http://127.0.0.1/${i}` }, state })),
  );

test("Feature: gateway, Property: health-filtering — filterHealthy keeps exactly the non-unhealthy targets", () => {
  fc.assert(
    fc.property(poolArb, (items) => {
      const registry = new HealthRegistry({ clock: () => 0 });
      for (const { target, state } of items) {
        if (state !== "unset") registry.setState(target.id, state);
      }
      const targets = items.map((i) => i.target);
      const filtered = registry.filterHealthy(targets);

      const expected = items.filter((i) => i.state !== "unhealthy").map((i) => i.target.id);
      assert.deepEqual(filtered.map((t) => t.id), expected);

      // Never invents a target; result is a subsequence of the input pool.
      const inputIds = new Set(targets.map((t) => t.id));
      for (const t of filtered) assert.ok(inputIds.has(t.id));
    }),
    { numRuns: 100 },
  );
});

test("Feature: gateway, Property: health-filtering — a balancer over the filtered pool never picks an unhealthy target", () => {
  fc.assert(
    fc.property(poolArb, fc.integer({ min: 1, max: 20 }), (items, picks) => {
      const registry = new HealthRegistry({ clock: () => 0 });
      for (const { target, state } of items) {
        if (state !== "unset") registry.setState(target.id, state);
      }
      const unhealthyIds = new Set(
        items.filter((i) => i.state === "unhealthy").map((i) => i.target.id),
      );
      const healthy = registry.filterHealthy(items.map((i) => i.target));
      const balancer = new RoundRobinBalancer();

      for (let i = 0; i < picks; i++) {
        const chosen = balancer.pick(healthy, new Map());
        if (healthy.length === 0) {
          assert.equal(chosen, undefined);
        } else {
          assert.ok(chosen !== undefined);
          assert.ok(!unhealthyIds.has(chosen.id), "must never pick an unhealthy target");
        }
      }
    }),
    { numRuns: 100 },
  );
});
