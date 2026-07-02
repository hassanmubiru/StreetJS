// src/tests/redis.integration.test.ts
// Task 15.3 — Redis integration tests against a REAL broker, with an honest
// BLOCKED-when-unavailable outcome (Req 13.2, 12.4, 12.5, 12.6, 14.1).
//
// These are true integration tests: when a real Redis is reachable (from
// `REDIS_URL`, or the default 127.0.0.1:6379) they exercise the opt-in
// `RedisDriver` end-to-end over a genuine connection — reserve/ack, delayed
// promotion, the full dead-letter API, pub/sub wake-up, crash-lease reclaim, and
// the health check flipping to `down` on connection loss while a Memory driver
// stays `up` and a reconnect resumes processing. Nothing is mocked.
//
// HONEST BLOCKED OUTCOME (Req: never fabricate). Most CI/dev environments here
// have NO Redis. When the broker is unreachable this file does NOT fail and does
// NOT rewrite itself to pass without a broker — every test is SKIPPED via
// node:test's `skip` mechanism with an explicit unreachable-dependency message,
// which is the correct honest result. Availability is probed once at load with a
// hard timeout so the skip path can never hang or leak a socket/timer.
//
// Isolation: every test namespaces its keys under a unique `keyPrefix` derived
// from a per-run token, and purges/flushes + closes its clients in a `finally`,
// so a shared broker is never polluted across runs or tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { RedisClient } from 'streetjs';
import { HealthCheckRegistry } from 'streetjs';

import { RedisDriver } from '../drivers/redis.js';
import { MemoryDriver } from '../drivers/memory.js';
import {
  registerQueueObservability,
  QUEUE_HEALTH_CHECK_NAME,
} from '../observability.js';
import type { JobEnvelope, SerializedError } from '../job.js';
import type { Reservation } from '../drivers/driver.js';

// ── Connection config ──────────────────────────────────────────────────────────

interface RedisConfig {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly password: string | undefined;
}

/**
 * Resolve the broker location from `REDIS_URL` (e.g.
 * `redis://[:password@]host:port`), falling back to the conventional local
 * default. Parsing failures degrade to the default so detection still runs.
 */
function resolveRedisConfig(): RedisConfig {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  try {
    const u = new URL(url);
    return {
      url,
      host: u.hostname || '127.0.0.1',
      port: u.port ? Number(u.port) : 6379,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return { url, host: '127.0.0.1', port: 6379, password: undefined };
  }
}

/** Reject with `label` if `promise` does not settle within `ms` (never hangs). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    // Do not keep the event loop alive solely for this guard.
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
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

const CONFIG = resolveRedisConfig();
/** Unique per-run token so parallel/repeat runs never collide on a shared broker. */
const RUN_TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Build a fresh (unconnected) core RedisClient for the resolved broker. */
function makeClient(): RedisClient {
  return new RedisClient({ host: CONFIG.host, port: CONFIG.port, password: CONFIG.password });
}

interface Availability {
  readonly available: boolean;
  readonly reason: string;
}

/**
 * Probe the broker ONCE with a hard timeout: connect, then PING. Any failure
 * (connection refused, timeout, auth rejection) yields `available: false` with a
 * human reason used as the skip message. The probe client is always closed.
 */
async function probeRedis(): Promise<Availability> {
  const client = makeClient();
  try {
    await withTimeout(client.connect(), 1500, `connect to ${CONFIG.host}:${CONFIG.port} timed out`);
    const pong = await withTimeout(client.command(['PING']), 1500, 'PING timed out');
    if (typeof pong === 'string' && pong.startsWith('ERR:')) {
      return { available: false, reason: `PING rejected: ${pong.slice(4)}` };
    }
    return { available: true, reason: 'connected' };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      client.close();
    } catch {
      // best-effort
    }
  }
}

// Probe once at module load (ESM top-level await). Guarded by withTimeout inside,
// so this can neither hang nor throw an unhandled rejection.
const AVAILABILITY = await probeRedis();

/**
 * node:test options that SKIP with an explicit unreachable-dependency message
 * when the broker is absent (BLOCKED), or run normally when it is present.
 */
const RUN: { skip?: string } = AVAILABILITY.available
  ? {}
  : { skip: `Redis unavailable: ${AVAILABILITY.reason} (BLOCKED: unreachable dependency; set REDIS_URL or start a broker to run)` };

if (!AVAILABILITY.available) {
  // Emit a single, explicit BLOCKED line so the honest outcome is visible in logs
  // without failing the suite or fabricating a result.
  // eslint-disable-next-line no-console
  console.log(
    `[queue][redis.integration] BLOCKED — real Redis broker is unreachable at ${CONFIG.url}: ${AVAILABILITY.reason}. ` +
      `These integration tests are skipped (not failed) because they refuse to run without a real broker.`,
  );
}

// ── Test helpers (only reached when Redis is available) ─────────────────────────

let subCounter = 0;

/** A namespaced RedisDriver + its backing client for one isolated test. */
interface DriverBundle {
  readonly driver: RedisDriver;
  readonly client: RedisClient;
  readonly keyPrefix: string;
}

/**
 * Connect a fresh RedisDriver under a unique keyPrefix (derived from the run
 * token + a per-call counter) with the given visibility lease. The caller MUST
 * `cleanup(bundle)` in a finally.
 */
async function connectDriver(label: string, visibilityMs = 30_000): Promise<DriverBundle> {
  const keyPrefix = `streetjs:qtest:${RUN_TOKEN}:${label}:${subCounter++}`;
  const client = makeClient();
  const driver = new RedisDriver({ client, keyPrefix, visibilityMs });
  await driver.init();
  return { driver, client, keyPrefix };
}

/** Purge ready/delayed jobs, flush dead letters, and close the client. */
async function cleanup(bundle: DriverBundle): Promise<void> {
  try {
    await bundle.driver.purge();
  } catch {
    // best-effort
  }
  try {
    await bundle.driver.flushDeadLetters();
  } catch {
    // best-effort
  }
  try {
    await bundle.driver.close();
  } catch {
    // best-effort
  }
}

let envSeq = 0;

/** Construct a minimal, valid JobEnvelope for driver-level tests. */
function makeEnvelope(
  overrides: Partial<JobEnvelope> & { type: string } = { type: 'test' },
): JobEnvelope {
  const seq = envSeq++;
  return {
    id: `job-${RUN_TOKEN}-${seq}`,
    type: overrides.type,
    queue: overrides.queue ?? 'default',
    payload: overrides.payload ?? { n: seq },
    priority: overrides.priority ?? 0,
    attempts: overrides.attempts ?? 0,
    maxAttempts: overrides.maxAttempts ?? 3,
    backoff: overrides.backoff,
    timeoutMs: overrides.timeoutMs,
    enqueuedAt: overrides.enqueuedAt ?? Date.now(),
    seq: overrides.seq ?? seq,
    dedupeKey: overrides.dedupeKey,
    tenantId: overrides.tenantId,
  };
}

const AN_ERROR: SerializedError = { name: 'Error', message: 'boom', stack: 'Error: boom' };

// ── Tests ───────────────────────────────────────────────────────────────────────

test('reserve → ack removes the job durably against a real broker (Req 14.1)', RUN, async () => {
  const bundle = await connectDriver('reserve-ack');
  try {
    const env = makeEnvelope({ type: 'reserve-ack' });
    await bundle.driver.enqueue('default', env);

    const reservation = await bundle.driver.reserve(['default'], 30_000, Date.now());
    assert.ok(reservation, 'a ready job is reserved from the real broker');
    assert.equal(reservation!.envelope.id, env.id, 'the reserved job is the one enqueued');
    assert.equal(reservation!.envelope.attempts, 1, 'attempt is consumed at reserve');

    await bundle.driver.ack(reservation!);

    // After ack the job is gone: nothing else reservable and stats show empty.
    const again = await bundle.driver.reserve(['default'], 30_000, Date.now());
    assert.equal(again, null, 'an acked job is not re-delivered');
    const stats = await bundle.driver.stats('default');
    assert.equal(stats.ready, 0, 'no ready jobs remain');
    assert.equal(stats.reserved, 0, 'no reservation lingers after ack');
  } finally {
    await cleanup(bundle);
  }
});

test('enqueueDelayed + promoteDue gates eligibility on the due time (Req 14.1)', RUN, async () => {
  const bundle = await connectDriver('promote');
  try {
    const now = Date.now();
    const env = makeEnvelope({ type: 'delayed' });
    await bundle.driver.enqueueDelayed('default', env, now + 60_000);

    // Before the due time: not promoted, nothing reservable.
    const promotedEarly = await bundle.driver.promoteDue(now);
    assert.equal(promotedEarly, 0, 'nothing is promoted before the due time');
    assert.equal(
      await bundle.driver.reserve(['default'], 30_000, now),
      null,
      'a delayed job is not reservable before its due time',
    );

    // At/after the due time: promoted and reservable.
    const promoted = await bundle.driver.promoteDue(now + 60_000);
    assert.equal(promoted, 1, 'the due job is promoted exactly once');
    const reservation = await bundle.driver.reserve(['default'], 30_000, now + 60_000);
    assert.ok(reservation, 'the promoted job is reservable');
    assert.equal(reservation!.envelope.id, env.id, 'the promoted job is the delayed one');
    await bundle.driver.ack(reservation!);
  } finally {
    await cleanup(bundle);
  }
});

test('dead-letter lifecycle: move → list → remove → flush (Req 14.1)', RUN, async () => {
  const bundle = await connectDriver('dlq');
  try {
    const env = makeEnvelope({ type: 'dlq', maxAttempts: 1 });
    await bundle.driver.enqueue('default', env);
    const reservation = await bundle.driver.reserve(['default'], 30_000, Date.now());
    assert.ok(reservation, 'the job is reserved before dead-lettering');

    await bundle.driver.moveToDeadLetter(reservation!, AN_ERROR);

    const listed = await bundle.driver.listDeadLetters('default', 100);
    assert.equal(listed.length, 1, 'one dead-letter record is stored');
    assert.equal(listed[0]!.id, env.id, 'the record carries the job id');
    assert.equal(listed[0]!.type, 'dlq', 'the record carries the job type');
    assert.equal(listed[0]!.error.message, 'boom', 'the record carries the serialized error');

    const removed = await bundle.driver.removeDeadLetter(env.id);
    assert.ok(removed, 'the record is removed by id');
    assert.equal(removed!.id, env.id, 'the removed record matches');
    assert.equal(
      (await bundle.driver.listDeadLetters('default', 100)).length,
      0,
      'the dead-letter list is empty after removal',
    );

    // flush removes remaining records without re-enqueuing.
    const env2 = makeEnvelope({ type: 'dlq', maxAttempts: 1 });
    await bundle.driver.enqueue('default', env2);
    const r2 = await bundle.driver.reserve(['default'], 30_000, Date.now());
    await bundle.driver.moveToDeadLetter(r2!, AN_ERROR);
    const flushed = await bundle.driver.flushDeadLetters('default');
    assert.equal(flushed, 1, 'flush reports the number of records removed');
    assert.equal(
      (await bundle.driver.listDeadLetters('default', 100)).length,
      0,
      'no dead letters remain after flush',
    );
  } finally {
    await cleanup(bundle);
  }
});

test('pub/sub wake-up fires onWake when a job is enqueued (Req 14.1)', RUN, async () => {
  const bundle = await connectDriver('wake');
  try {
    const woken = new Promise<string>((resolve) => {
      bundle.driver.onWake((queue) => resolve(queue));
    });
    // Give the dedicated subscription connection a moment to establish before
    // publishing (pub/sub is a best-effort latency wake-up, not correctness).
    await delay(150);

    await bundle.driver.enqueue('default', makeEnvelope({ type: 'wake' }));

    const queue = await withTimeout(woken, 3000, 'no wake message received within 3s');
    assert.equal(queue, 'default', 'the wake message carries the woken queue name');
  } finally {
    await cleanup(bundle);
  }
});

test('crash-lease reclaim: an un-acked reservation is redelivered after the lease expires (Req 14.1)', RUN, async () => {
  // A SHORT visibility lease so a "crashed" (un-acked) reservation is reclaimed
  // after real time passes it — genuine at-least-once redelivery.
  const bundle = await connectDriver('reclaim', 200);
  try {
    const env = makeEnvelope({ type: 'reclaim', maxAttempts: 5 });
    await bundle.driver.enqueue('default', env);

    const t0 = Date.now();
    const first = await bundle.driver.reserve(['default'], 200, t0);
    assert.ok(first, 'the job is reserved (simulating a worker that then crashes)');
    assert.equal(first!.envelope.attempts, 1, 'first reserve consumes attempt 1');
    // Simulate a crash: never ack/nack. Wait real time past the lease.
    await delay(350);

    const t1 = Date.now();
    const second = await bundle.driver.reserve(['default'], 200, t1);
    assert.ok(second, 'the un-acked job is reclaimed and re-delivered after the lease');
    assert.equal(second!.envelope.id, env.id, 'the same job is redelivered');
    assert.equal(second!.envelope.attempts, 2, 'the redelivered attempt is consumed (at-least-once)');
    await bundle.driver.ack(second!);
  } finally {
    await cleanup(bundle);
  }
});

test('health flips to down on connection loss while Memory stays up; reconnect resumes processing (Req 12.4, 12.5, 12.6, 14.1)', RUN, async () => {
  const keyPrefix = `streetjs:qtest:${RUN_TOKEN}:health:${subCounter++}`;
  const client = makeClient();
  const driver = new RedisDriver({ client, keyPrefix, visibilityMs: 30_000 });
  await driver.init();

  const memory = new MemoryDriver();
  await memory.init();

  // Register the queue health check for BOTH drivers against separate registries.
  const redisHealth = new HealthCheckRegistry();
  const memoryHealth = new HealthCheckRegistry();
  const redisHandle = registerQueueObservability({ driver, health: redisHealth });
  const memoryHandle = registerQueueObservability({ driver: memory, health: memoryHealth });

  try {
    // Enqueue two jobs; reserve/ack one so a second remains for post-reconnect.
    await driver.enqueue('default', makeEnvelope({ type: 'health', maxAttempts: 3 }));
    const remaining = makeEnvelope({ type: 'health', maxAttempts: 3 });
    await driver.enqueue('default', remaining);

    const first = await driver.reserve(['default'], 30_000, Date.now());
    assert.ok(first, 'a job is reserved over the live connection');
    await driver.ack(first!);

    // While connected: Redis reports up, Memory reports up (Req 12.5, 12.6).
    let redisLive = await redisHealth.runLiveness();
    assert.equal(redisLive.checks[QUEUE_HEALTH_CHECK_NAME]!.status, 'up', 'Redis is up while connected');
    const memoryLive = await memoryHealth.runLiveness();
    assert.equal(
      memoryLive.checks[QUEUE_HEALTH_CHECK_NAME]!.status,
      'up',
      'the Memory driver is always up (Req 12.5)',
    );

    // Drop the connection. `driver.health()` must flip to `down` (Req 12.4) while
    // the independent Memory driver stays `up` (Req 12.5).
    await driver.close();
    assert.equal(driver.health().status, 'down', 'Redis health is down after connection loss (Req 12.4)');
    redisLive = await redisHealth.runLiveness();
    assert.equal(
      redisLive.checks[QUEUE_HEALTH_CHECK_NAME]!.status,
      'down',
      'the health check reports down on connection loss (Req 12.4)',
    );
    assert.equal(memory.health().status, 'up', 'the Memory driver stays up while Redis is down (Req 12.5)');

    // Reconnect with a fresh client on the SAME keyPrefix: processing resumes and
    // the still-pending job is reservable (durable state survived the drop).
    const client2 = makeClient();
    const driver2 = new RedisDriver({ client: client2, keyPrefix, visibilityMs: 30_000 });
    await driver2.init();
    assert.equal(driver2.health().status, 'up', 'health is up again after reconnect (Req 12.4)');
    try {
      const resumed = await driver2.reserve(['default'], 30_000, Date.now());
      assert.ok(resumed, 'the pending job is reservable after reconnect (processing resumes)');
      assert.equal(resumed!.envelope.id, remaining.id, 'the durable pending job survived the drop');
      await driver2.ack(resumed!);
    } finally {
      try {
        await driver2.purge();
        await driver2.flushDeadLetters();
      } catch {
        // best-effort
      }
      await driver2.close();
    }
  } finally {
    redisHandle.close();
    memoryHandle.close();
    // driver is already closed; guard a double-close and clean Memory.
    try {
      await driver.close();
    } catch {
      // already closed
    }
    await memory.close();
  }
});

// Reference the imported Reservation type so `noUnusedLocals` is satisfied even
// if a future edit drops its only use above; it documents the reserve contract.
export type _ReservationRef = Reservation;
