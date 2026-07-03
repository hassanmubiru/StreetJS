import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import {
  RoundRobinBalancer,
  LeastConnectionsBalancer,
  WeightedRoundRobinBalancer,
} from "../balancer.js";
import type { UpstreamTarget } from "../types.js";

const RUNS = { numRuns: 100 } as const;

/** Distinct candidates of a given size. */
function candidatesArb(minLen = 1, maxLen = 8) {
  return fc
    .integer({ min: minLen, max: maxLen })
    .map((n) =>
      Array.from({ length: n }, (_, i): UpstreamTarget => ({
        id: `t${i}`,
        url: `http://t${i}`,
      })),
    );
}

test("Feature: gateway, Property: load-balancing — round-robin distributes fairly (floor/ceil)", () => {
  fc.assert(
    fc.property(
      candidatesArb(),
      fc.integer({ min: 0, max: 500 }),
      (candidates, picks) => {
        const lb = new RoundRobinBalancer();
        const k = candidates.length;
        const counts = new Map<string, number>();
        for (const c of candidates) counts.set(c.id, 0);
        for (let i = 0; i < picks; i++) {
          const chosen = lb.pick(candidates)!;
          counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
        }
        const floor = Math.floor(picks / k);
        const ceil = Math.ceil(picks / k);
        for (const c of candidates) {
          const count = counts.get(c.id)!;
          assert.ok(
            count === floor || count === ceil,
            `id=${c.id} count=${count} not in {${floor},${ceil}} (picks=${picks}, k=${k})`,
          );
        }
      },
    ),
    RUNS,
  );
});

test("Feature: gateway, Property: load-balancing — weighted-RR yields exactly weight over a full cycle", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 8 }),
      (weights) => {
        const candidates: UpstreamTarget[] = weights.map((w, i) => ({
          id: `t${i}`,
          url: `http://t${i}`,
          weight: w,
        }));
        const lb = new WeightedRoundRobinBalancer();
        const total = weights.reduce((a, b) => a + b, 0);
        const counts = new Map<string, number>();
        for (let i = 0; i < total; i++) {
          const chosen = lb.pick(candidates)!;
          counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
        }
        candidates.forEach((c, i) => {
          assert.equal(
            counts.get(c.id) ?? 0,
            weights[i],
            `id=${c.id} expected ${weights[i]} got ${counts.get(c.id) ?? 0}`,
          );
        });
      },
    ),
    RUNS,
  );
});

test("Feature: gateway, Property: load-balancing — least-connections picks a global minimum", () => {
  fc.assert(
    fc.property(
      candidatesArb().chain((candidates) =>
        fc.record({
          candidates: fc.constant(candidates),
          conns: fc.array(fc.integer({ min: 0, max: 1000 }), {
            minLength: candidates.length,
            maxLength: candidates.length,
          }),
        }),
      ),
      ({ candidates, conns }) => {
        const live = new Map<string, number>();
        candidates.forEach((c, i) => live.set(c.id, conns[i]!));
        const lb = new LeastConnectionsBalancer();
        const chosen = lb.pick(candidates, live)!;
        const chosenCount = live.get(chosen.id)!;
        for (const c of candidates) {
          assert.ok(
            chosenCount <= live.get(c.id)!,
            `chosen ${chosen.id}(${chosenCount}) > ${c.id}(${live.get(c.id)})`,
          );
        }
      },
    ),
    RUNS,
  );
});
