// src/tests/redis-integration.test.ts
// Task 10.4 — Redis integration tests against a REAL broker, with an honest
// BLOCKED-when-unavailable posture.
//
// These tests exercise two `RedisAdapter`-backed facades ("instance A" and
// "instance B") sharing the same `keyPrefix` against a real Redis reached via
// `REDIS_URL` (default `redis://127.0.0.1:6379`) using the core `RedisClient`
// pub/sub. They assert the multi-instance behaviors that cannot be meaningfully
// randomized in-process (Properties 6/7 already cover the pure fan-out logic
// over an in-memory bus):
//
//   - Req 13.1 / 7.6: a broadcast published on instance A reaches an eligible
//     connection on instance B EXACTLY ONCE.
//   - Req 13.2:       a presence change on A is reflected by a presence query
//     on B (cross-instance presence union).
//   - Req 13.3 / 17.4: dropping the Redis connection flips the adapter health
//     (surfaced through the realtime health check) to `down` while LOCAL
//     single-instance broadcasts keep working.
//   - Req 13.4:       reconnecting the Redis connection RESUMES cross-instance
//     propagation.
//
// HONEST BLOCKED CONTRACT: if Redis/Docker is unavailable, every test in this
// file is reported as SKIPPED with an explicit unreachable-dependency message
// naming `REDIS_URL`. The suite is NEVER rewritten to pass without a real
// broker, and results are NEVER fabricated — a skipped test is reported as
// BLOCKED, not passed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { RedisClient, StreetWebSocketServer } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';
import type { Member, Realtime } from '../index.js';
import { RedisAdapter } from '../cluster/redis.js';

/** Redis endpoint under test; overridable via `REDIS_URL` or docker-compose. */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';

/** How long to wait for a connect/PING probe before declaring Redis unreachable. */
const PROBE_TIMEOUT_MS = 2000;

const member = (id: string): Member => ({ id });
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Human-readable description of a caught error. */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** Parse `REDIS_URL` into the connection options accepted by the core `RedisClient`. */
function parseRedisUrl(raw: string): { host: string; port: number; password?: string } {
  try {
    const u = new URL(raw);
    const out: { host: string; port: number; password?: string } = {
      host: u.hostname || '127.0.0.1',
      port: u.port ? Number(u.port) : 6379,
    };
    if (u.password) out.password = decodeURIComponent(u.password);
    return out;
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
}

/** Reject `p` if it does not settle within `ms` (used to bound the connect probe). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Poll `predicate` until it is truthy or `timeoutMs` elapses. Returns success. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
  stepMs = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await delay(stepMs);
  }
}

/**
 * Probe Redis once at load time. Returns `null` when the broker is reachable
 * (so tests RUN), or an explicit BLOCKED message naming the unreachable
 * dependency when it is not (so every test SKIPS cleanly rather than failing).
 */
async function probeRedis(): Promise<string | null> {
  const client = new RedisClient(parseRedisUrl(REDIS_URL));
  try {
    await withTimeout(client.connect(), PROBE_TIMEOUT_MS, 'Redis connect');
    const pong = await withTimeout(client.command(['PING']), PROBE_TIMEOUT_MS, 'Redis PING');
    if (pong !== 'PONG') {
      return `BLOCKED: Redis at ${REDIS_URL} did not answer PING (got ${JSON.stringify(pong)}).`;
    }
    return null;
  } catch (err) {
    return (
      `BLOCKED: real Redis broker unreachable at ${REDIS_URL} (${describe(err)}). ` +
      `These integration tests require a real Redis — set REDIS_URL or start the ` +
      `docker-compose Redis service, then re-run. Skipping without fabricating results.`
    );
  } finally {
    client.close();
  }
}

// Decide reachability BEFORE any test is registered so the skip reason is known.
const skipReason = await probeRedis();
if (skipReason) {
  // Surface the BLOCKED reason prominently in the run output.
  console.warn(`[redis-integration] ${skipReason}`);
}
/** node:test `skip` option: a string reason skips the test; `false` runs it. */
const SKIP: string | false = skipReason ?? false;

/** A fully wired instance: its facade, adapter, connected client, and teardown. */
interface Instance {
  readonly realtime: Realtime;
  readonly adapter: RedisAdapter;
  readonly client: RedisClient;
  readonly cleanup: () => Promise<void>;
}

/** A unique key/topic prefix per test so a shared broker never cross-pollinates. */
function uniquePrefix(): string {
  return `streetjs:rt:it:${randomUUID()}:`;
}

/**
 * Build a `RedisAdapter`-backed facade bound to a freshly connected core
 * `RedisClient`. Instances sharing `keyPrefix` but carrying distinct
 * `instanceId`s behave as separate cluster peers over the same broker.
 */
async function createInstance(keyPrefix: string, instanceId: string): Promise<Instance> {
  const client = new RedisClient(parseRedisUrl(REDIS_URL));
  await client.connect();
  const adapter = new RedisAdapter({ client, keyPrefix, instanceId, presenceTtlMs: 60_000 });
  const server = new StreetWebSocketServer();
  const realtime = createRealtime({ server, adapter });
  // Await adapter initialization (subscribe + mark connected) via a public
  // operation that internally awaits the facade's readiness, so callers never
  // race `init()` — e.g. a synchronous `health()` probe or a connection drop
  // performed immediately after construction (Req 13.3).
  await realtime.room(`${keyPrefix}__ready__`).presence();
  return {
    realtime,
    adapter,
    client,
    cleanup: async () => {
      await realtime.close();
      client.close();
    },
  };
}

test(
  'broadcast on instance A reaches an eligible connection on B exactly once (Req 13.1, 7.6)',
  { skip: SKIP },
  async () => {
    const prefix = uniquePrefix();
    const a = await createInstance(prefix, 'A');
    const b = await createInstance(prefix, 'B');
    try {
      // An eligible connection joins the room on instance B.
      const roomB = b.realtime.room('chat');
      const connB = new FakeConnection({ id: 'b-conn' });
      await roomB.join(member('bob'), connB);

      // Instance A publishes to the same room.
      const roomA = a.realtime.room('chat');
      await roomA.broadcast({ type: 'message', payload: { text: 'hello from A' } });

      // B's connection receives it across the broker…
      const delivered = await waitFor(() => connB.eventsOfType('message').length >= 1);
      assert.ok(delivered, 'expected B connection to receive the cross-instance broadcast');

      // …and after a settle window it is delivered EXACTLY ONCE (Req 7.6).
      await delay(250);
      assert.equal(
        connB.eventsOfType('message').length,
        1,
        'cross-instance broadcast must deliver exactly once per connection',
      );
      assert.deepEqual(connB.lastEvent()?.payload, { text: 'hello from A' });
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  },
);

test(
  'a presence change on A is reflected by a presence query on B (Req 13.2)',
  { skip: SKIP },
  async () => {
    const prefix = uniquePrefix();
    const a = await createInstance(prefix, 'A');
    const b = await createInstance(prefix, 'B');
    try {
      // A member becomes present on instance A.
      const roomA = a.realtime.room('presence-room');
      const connA = new FakeConnection({ id: 'a-conn' });
      await roomA.join(member('alice'), connA);

      // A presence query on instance B reflects the change (distributed union).
      const roomB = b.realtime.room('presence-room');
      const seen = await waitFor(async () => (await roomB.presence()).includes('alice'));
      assert.ok(seen, 'expected instance B to observe alice present via cross-instance presence');

      // And a leave on A eventually clears it from B's view.
      await roomA.leave(member('alice'), connA);
      const gone = await waitFor(async () => !(await roomB.presence()).includes('alice'));
      assert.ok(gone, 'expected instance B to observe alice absent after she leaves on A');
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  },
);

test(
  'dropping the Redis connection flips health to down while local broadcasts keep working (Req 13.3, 17.4)',
  { skip: SKIP },
  async () => {
    const prefix = uniquePrefix();
    const a = await createInstance(prefix, 'A');
    try {
      // Healthy while connected.
      assert.equal(a.adapter.health().status, 'up', 'adapter should start healthy');

      const room = a.realtime.room('local-room');
      const local = new FakeConnection({ id: 'local' });
      await room.join(member('carol'), local);

      // Drop the underlying Redis connection.
      a.client.close();

      // A local broadcast still delivers to local connections even though the
      // cross-instance fan-out now fails (best-effort, swallowed) — Req 13.3.
      await room.broadcast({ type: 'message', payload: { text: 'still local' } });
      assert.equal(
        local.eventsOfType('message').length,
        1,
        'local single-instance delivery must keep working during a Redis outage',
      );
      assert.deepEqual(local.lastEvent()?.payload, { text: 'still local' });

      // The connectivity loss surfaces as `down` through the adapter health that
      // feeds the realtime health check (Req 17.4).
      assert.equal(
        a.adapter.health().status,
        'down',
        'adapter health must flip to down on connection loss',
      );
    } finally {
      // The client is already closed; realtime.close() tolerates it.
      await a.realtime.close();
    }
  },
);

test(
  'reconnecting the Redis connection resumes cross-instance propagation (Req 13.4)',
  { skip: SKIP },
  async () => {
    const prefix = uniquePrefix();
    const a = await createInstance(prefix, 'A');
    const b = await createInstance(prefix, 'B');
    try {
      const roomB = b.realtime.room('resume-room');
      const connB = new FakeConnection({ id: 'b-conn' });
      await roomB.join(member('bob'), connB);

      const roomA = a.realtime.room('resume-room');

      // Drop A's connection; while down its fan-out is a best-effort no-op, so
      // B receives nothing.
      a.client.close();
      await roomA.broadcast({ type: 'message', payload: { text: 'while-down' } });
      assert.equal(a.adapter.health().status, 'down');
      await delay(300);
      assert.equal(
        connB.eventsOfType('message').length,
        0,
        'no cross-instance propagation while A is disconnected',
      );

      // Reconnect A and broadcast again; propagation resumes (Req 13.4).
      await a.client.connect();
      await roomA.broadcast({ type: 'message', payload: { text: 'after-reconnect' } });

      const delivered = await waitFor(() => connB.eventsOfType('message').length >= 1);
      assert.ok(delivered, 'expected cross-instance propagation to resume after reconnect');
      await delay(250);
      assert.equal(
        connB.eventsOfType('message').length,
        1,
        'exactly one message should arrive on B after reconnect',
      );
      assert.deepEqual(connB.lastEvent()?.payload, { text: 'after-reconnect' });
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  },
);
