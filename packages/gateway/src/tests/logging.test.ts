import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import { RequestLogger, newRequestId } from "../logging.js";
import type { AccessLogRecord } from "../types.js";

/** A fake, hand-cranked clock so latency is deterministic. */
function fakeClock(start = 1_000): { clock: Clock; advance: (ms: number) => void } {
  let now = start;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("start returns the current clock value", () => {
  const { clock, advance } = fakeClock(500);
  const logger = new RequestLogger({ clock });
  assert.equal(logger.start(), 500);
  advance(25);
  assert.equal(logger.start(), 525);
});

test("finish computes latencyMs from the clock and emits exactly one full record", () => {
  const { clock, advance } = fakeClock(1_000);
  const emitted: AccessLogRecord[] = [];
  const logger = new RequestLogger({ clock, sink: (r) => emitted.push(r) });

  const started = logger.start();
  advance(42);
  const returned = logger.finish(
    { requestId: "req-1", method: "GET", path: "/users/7", status: 200, service: "users", targetId: "u1", version: "v2" },
    started,
  );

  const expected: AccessLogRecord = {
    requestId: "req-1",
    method: "GET",
    path: "/users/7",
    status: 200,
    service: "users",
    targetId: "u1",
    version: "v2",
    latencyMs: 42,
  };

  assert.deepEqual(returned, expected);
  assert.equal(emitted.length, 1, "sink called exactly once");
  assert.deepEqual(emitted[0], expected);
});

test("finish tolerates a zero-latency window", () => {
  const { clock } = fakeClock(7_000);
  const emitted: AccessLogRecord[] = [];
  const logger = new RequestLogger({ clock, sink: (r) => emitted.push(r) });

  const started = logger.start();
  const record = logger.finish(
    { requestId: "req-2", method: "POST", path: "/x", status: 500 },
    started,
  );
  assert.equal(record.latencyMs, 0);
  assert.equal(emitted.length, 1);
});

test("default sink is a no-op and finish still returns the record", () => {
  const { clock, advance } = fakeClock(0);
  const logger = new RequestLogger({ clock });
  const started = logger.start();
  advance(5);
  const record = logger.finish(
    { requestId: "req-3", method: "GET", path: "/", status: 204 },
    started,
  );
  assert.equal(record.latencyMs, 5);
  assert.equal(record.requestId, "req-3");
});

test("newRequestId with a fixed rng is deterministic and non-empty", () => {
  const a = newRequestId(() => 0.5);
  const b = newRequestId(() => 0.5);
  assert.equal(a, b, "same rng yields the same id within the same ms tick");
  assert.ok(a.length > 0, "id is non-empty");
  assert.match(a, /^[0-9a-z]+-[0-9a-z]+$/, "id has a timestamp-random shape");
});

test("newRequestId with different rng values differ", () => {
  const a = newRequestId(() => 0.1);
  const b = newRequestId(() => 0.9);
  assert.notEqual(a, b);
});
