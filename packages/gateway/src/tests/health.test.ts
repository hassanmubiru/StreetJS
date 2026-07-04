import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import {
  HealthRegistry,
  customChecker,
  tcpChecker,
  httpChecker,
} from "../health.js";
import type { HealthChecker, UpstreamTarget } from "../types.js";

/** A fake, hand-cranked clock so `checkedAt` values are deterministic. */
function fakeClock(start = 1_000): { clock: Clock; advance: (ms: number) => void } {
  let now = start;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function target(id: string, url = `http://127.0.0.1/${id}`): UpstreamTarget {
  return { id, url };
}

test("setState + get round-trip stamps checkedAt from the injected clock", () => {
  const { clock, advance } = fakeClock(5_000);
  const registry = new HealthRegistry({ clock });

  const written = registry.setState("a", "healthy", "ok");
  assert.deepEqual(written, { targetId: "a", state: "healthy", checkedAt: 5_000, detail: "ok" });

  const read = registry.get("a");
  assert.deepEqual(read, written);

  // A later write reflects the advanced clock and omits detail when not given.
  advance(250);
  const next = registry.setState("a", "unhealthy");
  assert.deepEqual(next, { targetId: "a", state: "unhealthy", checkedAt: 5_250 });
  assert.equal(next.detail, undefined);
  assert.deepEqual(registry.get("a"), next);
});

test("get returns undefined for an unknown target id", () => {
  const registry = new HealthRegistry({ clock: fakeClock().clock });
  assert.equal(registry.get("nope"), undefined);
});

test("filterHealthy excludes only unhealthy (keeps healthy AND unknown)", () => {
  const registry = new HealthRegistry({ clock: fakeClock().clock });
  const good = target("good");
  const bad = target("bad");
  const maybe = target("maybe");
  const never = target("never"); // no record at all → treated as unknown

  registry.setState("good", "healthy");
  registry.setState("bad", "unhealthy");
  registry.setState("maybe", "unknown");

  const eligible = registry.filterHealthy([good, bad, maybe, never]);
  assert.deepEqual(
    eligible.map((t) => t.id),
    ["good", "maybe", "never"],
  );
});

test("a never-probed pool is fully eligible (fail-open)", () => {
  const registry = new HealthRegistry({ clock: fakeClock().clock });
  const pool = [target("x"), target("y"), target("z")];
  assert.deepEqual(registry.filterHealthy(pool), pool);
});

test("probe with a synchronous custom checker flips state to healthy/unhealthy", async () => {
  const { clock } = fakeClock(42);
  const registry = new HealthRegistry({ clock });

  const up = target("up");
  const down = target("down");

  // Synchronous, in-process checker: no network involved.
  const checker: HealthChecker = customChecker((t) => t.id === "up");

  await registry.probe([up, down], checker, 1_000);

  assert.equal(registry.get("up")?.state, "healthy");
  assert.equal(registry.get("up")?.checkedAt, 42);
  assert.equal(registry.get("down")?.state, "unhealthy");
  assert.equal(registry.get("down")?.detail, "checker reported unhealthy");
});

test("probe marks a target unhealthy when the checker throws", async () => {
  const registry = new HealthRegistry({ clock: fakeClock().clock });
  const t = target("boom");
  const checker: HealthChecker = () => {
    throw new Error("kaboom");
  };
  await registry.probe([t], checker, 1_000);
  assert.equal(registry.get("boom")?.state, "unhealthy");
  assert.equal(registry.get("boom")?.detail, "kaboom");
});

test("probe times out via the injected delay and aborts the signal", async () => {
  // Injected delay resolves immediately → the timeout branch always wins the race.
  const registry = new HealthRegistry({
    clock: fakeClock().clock,
    delay: () => Promise.resolve(),
  });
  const t = target("slow");
  let sawAbort = false;
  const checker: HealthChecker = (_t, signal) =>
    new Promise<boolean>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          sawAbort = true;
          resolve(false);
        },
        { once: true },
      );
      // Never resolves on its own; only the timeout can settle it.
    });

  await registry.probe([t], checker, 5);
  assert.equal(registry.get("slow")?.state, "unhealthy");
  assert.equal(registry.get("slow")?.detail, "probe exceeded 5ms timeout");
  assert.equal(sawAbort, true);
});

test("healthy-only routing returns the expected subset of a mixed set", () => {
  const registry = new HealthRegistry({ clock: fakeClock().clock });
  const a = target("a");
  const b = target("b");
  const c = target("c");
  const d = target("d");

  registry.setState("a", "healthy");
  registry.setState("b", "unhealthy");
  registry.setState("c", "healthy");
  registry.setState("d", "unhealthy");

  const routable = registry.filterHealthy([a, b, c, d]);
  assert.deepEqual(
    routable.map((t) => t.id),
    ["a", "c"],
  );
});

test("built-in tcp/http checker factories construct without connecting", () => {
  // Compile/smoke coverage only — no live sockets are opened here.
  const tcp = tcpChecker({ connectTimeoutMs: 50 });
  const http = httpChecker("/healthz", 204);
  assert.equal(typeof tcp, "function");
  assert.equal(typeof http, "function");
  assert.equal(tcp.length, 2, "checker takes (target, signal)");
  assert.equal(http.length, 2, "checker takes (target, signal)");
});

// Live tcp/http probe coverage against real in-process loopback servers lives in
// `health-live.test.ts` (no internet: everything binds to 127.0.0.1).
