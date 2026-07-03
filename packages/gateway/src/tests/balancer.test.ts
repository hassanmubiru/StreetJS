import test from "node:test";
import assert from "node:assert/strict";

import {
  RoundRobinBalancer,
  LeastConnectionsBalancer,
  RandomBalancer,
  WeightedRoundRobinBalancer,
  createBalancer,
} from "../balancer.js";
import type { UpstreamTarget } from "../types.js";

function target(id: string, weight?: number): UpstreamTarget {
  return weight === undefined
    ? { id, url: `http://${id}` }
    : { id, url: `http://${id}`, weight };
}

test("round-robin cycles in order and wraps", () => {
  const lb = new RoundRobinBalancer();
  const c = [target("a"), target("b"), target("c")];
  const picks = Array.from({ length: 7 }, () => lb.pick(c)?.id);
  assert.deepEqual(picks, ["a", "b", "c", "a", "b", "c", "a"]);
});

test("least-connections picks the minimum, ties by order", () => {
  const lb = new LeastConnectionsBalancer();
  const c = [target("a"), target("b"), target("c")];
  const live = new Map([
    ["a", 5],
    ["b", 2],
    ["c", 9],
  ]);
  assert.equal(lb.pick(c, live)?.id, "b");

  // Missing entries default to 0; first of the zero-count targets wins.
  const live2 = new Map([["b", 3]]);
  assert.equal(lb.pick(c, live2)?.id, "a");

  // No map at all: everyone is 0, first wins.
  assert.equal(lb.pick(c)?.id, "a");
});

test("random with a fixed rng is deterministic", () => {
  const seq = [0.0, 0.99, 0.5, 0.34];
  let i = 0;
  const rng = () => seq[i++ % seq.length]!;
  const lb = new RandomBalancer(rng);
  const c = [target("a"), target("b"), target("c")];
  // 0.0*3=0 -> a ; 0.99*3=2.97 -> c ; 0.5*3=1.5 -> b ; 0.34*3=1.02 -> b
  assert.deepEqual(
    [lb.pick(c)?.id, lb.pick(c)?.id, lb.pick(c)?.id, lb.pick(c)?.id],
    ["a", "c", "b", "b"],
  );
});

test("weighted round robin over one full cycle yields each target exactly weight times", () => {
  const lb = new WeightedRoundRobinBalancer();
  const c = [target("a", 5), target("b", 1), target("c", 2)];
  const total = 5 + 1 + 2;
  const counts = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const id = lb.pick(c)!.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  assert.equal(counts.get("a"), 5);
  assert.equal(counts.get("b"), 1);
  assert.equal(counts.get("c"), 2);
});

test("weighted round robin defaults missing/invalid weight to 1", () => {
  const lb = new WeightedRoundRobinBalancer();
  const c = [target("a"), target("b", 0), target("c", -3)];
  const total = 3; // all clamp to 1
  const counts = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const id = lb.pick(c)!.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  assert.equal(counts.get("a"), 1);
  assert.equal(counts.get("b"), 1);
  assert.equal(counts.get("c"), 1);
});

test("all balancers return undefined for empty candidates", () => {
  const empty: UpstreamTarget[] = [];
  assert.equal(new RoundRobinBalancer().pick(empty), undefined);
  assert.equal(new LeastConnectionsBalancer().pick(empty), undefined);
  assert.equal(new RandomBalancer(() => 0).pick(empty), undefined);
  assert.equal(new WeightedRoundRobinBalancer().pick(empty), undefined);
});

test("createBalancer builds each strategy with the right name", () => {
  assert.equal(createBalancer("round-robin").name, "round-robin");
  assert.equal(createBalancer("least-connections").name, "least-connections");
  assert.equal(createBalancer("random").name, "random");
  assert.equal(
    createBalancer("weighted-round-robin").name,
    "weighted-round-robin",
  );
});

test("createBalancer wires the injected rng into random", () => {
  const lb = createBalancer("random", { rng: () => 0.99 });
  const c = [target("a"), target("b"), target("c")];
  assert.equal(lb.pick(c)?.id, "c");
});
