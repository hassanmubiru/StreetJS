// src/tests/job-envelope.test.ts
// Unit tests for envelope build and attempt-ceiling resolution (Task 3.3).
//
// Validates:
//   - Req 2.1: `dispatch` builds an envelope with `attempts` initialized to 0.
//   - Req 2.5: a job dispatched without an explicit queue lands on "default".
//   - Req 8.3: a job dispatched without an explicit priority gets priority 0.
//   - Req 5.6: with `maxAttempts` omitted, the ceiling is `retries + 1` when
//     `retries` is set, and defaults to 1 (no retry) when both are omitted.
//   - Req 5.8: when both `retries` and `maxAttempts` are provided, the ceiling
//     is `retries + 1` and the provided `maxAttempts` is ignored.
//
// These exercise the pure `buildEnvelope`/`resolveMaxAttempts` functions with an
// injected fixed clock for determinism; they require no Redis and no wall clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEnvelope,
  resolveMaxAttempts,
  Job,
  DEFAULT_QUEUE,
  DEFAULT_PRIORITY,
  DEFAULT_MAX_ATTEMPTS,
  type JobOptions,
} from '../job.js';
import type { Clock } from 'streetjs';

// ── Test fixtures ────────────────────────────────────────────────────────────

interface GreetPayload {
  name: string;
}

/** A minimal concrete Job subclass used to exercise the envelope builder. */
class GreetJob extends Job<GreetPayload> {
  readonly type = 'greet';
}

/** A fixed, deterministic clock so `enqueuedAt` is reproducible. */
const FIXED_NOW = 1000;
const fixedClock: Clock = () => FIXED_NOW;

// ── buildEnvelope: defaults (Req 2.1, 2.5, 8.3) ──────────────────────────────

test('buildEnvelope initializes attempts to 0', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), undefined, fixedClock, 0);
  assert.equal(envelope.attempts, 0);
});

test('buildEnvelope defaults the queue to "default" when omitted', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), undefined, fixedClock, 0);
  assert.equal(envelope.queue, 'default');
  assert.equal(envelope.queue, DEFAULT_QUEUE);
});

test('buildEnvelope defaults the priority to 0 when omitted', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), undefined, fixedClock, 0);
  assert.equal(envelope.priority, 0);
  assert.equal(envelope.priority, DEFAULT_PRIORITY);
});

test('buildEnvelope carries id, type, payload, seq and enqueuedAt from the clock', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), undefined, fixedClock, 7);
  assert.equal(typeof envelope.id, 'string');
  assert.ok(envelope.id.length > 0);
  assert.equal(envelope.type, 'greet');
  assert.deepEqual(envelope.payload, { name: 'ada' });
  assert.equal(envelope.seq, 7);
  assert.equal(envelope.enqueuedAt, FIXED_NOW);
});

test('buildEnvelope honors an explicit queue and priority from dispatch options', () => {
  const envelope = buildEnvelope(
    new GreetJob({ name: 'ada' }),
    { queue: 'greetings', priority: 5 },
    fixedClock,
    0,
  );
  assert.equal(envelope.queue, 'greetings');
  assert.equal(envelope.priority, 5);
});

test('buildEnvelope lets dispatch-time options override per-instance job options', () => {
  const job = new GreetJob({ name: 'ada' }, { queue: 'instance-queue', priority: 1 });
  const envelope = buildEnvelope(job, { queue: 'dispatch-queue', priority: 9 }, fixedClock, 0);
  assert.equal(envelope.queue, 'dispatch-queue');
  assert.equal(envelope.priority, 9);
});

// ── buildEnvelope: timeout human-string resolution (Req 8.3 context) ─────────

test('buildEnvelope resolves a numeric timeout to timeoutMs verbatim', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), { timeout: 5000 }, fixedClock, 0);
  assert.equal(envelope.timeoutMs, 5000);
});

test('buildEnvelope resolves a human-string timeout to timeoutMs', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), { timeout: '5s' }, fixedClock, 0);
  assert.equal(envelope.timeoutMs, 5000);
});

test('buildEnvelope resolves a human-string timeout in minutes to timeoutMs', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), { timeout: '2m' }, fixedClock, 0);
  assert.equal(envelope.timeoutMs, 120000);
});

test('buildEnvelope leaves timeoutMs undefined when no timeout is provided', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), undefined, fixedClock, 0);
  assert.equal(envelope.timeoutMs, undefined);
});

// ── Attempt-ceiling resolution via buildEnvelope.maxAttempts (Req 5.6, 5.8) ──

test('buildEnvelope defaults maxAttempts to 1 (no retry) when both retries and maxAttempts are omitted', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), undefined, fixedClock, 0);
  assert.equal(envelope.maxAttempts, 1);
  assert.equal(envelope.maxAttempts, DEFAULT_MAX_ATTEMPTS);
});

test('buildEnvelope resolves maxAttempts to retries + 1 when only retries is set', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), { retries: 3 }, fixedClock, 0);
  assert.equal(envelope.maxAttempts, 4);
});

test('buildEnvelope resolves maxAttempts to the maxAttempts value when only maxAttempts is set', () => {
  const envelope = buildEnvelope(new GreetJob({ name: 'ada' }), { maxAttempts: 5 }, fixedClock, 0);
  assert.equal(envelope.maxAttempts, 5);
});

test('buildEnvelope prefers retries + 1 and ignores maxAttempts when both are provided', () => {
  const envelope = buildEnvelope(
    new GreetJob({ name: 'ada' }),
    { retries: 2, maxAttempts: 10 },
    fixedClock,
    0,
  );
  // retries (2) + 1 = 3, ignoring the provided maxAttempts of 10.
  assert.equal(envelope.maxAttempts, 3);
});

// ── resolveMaxAttempts: direct attempt-ceiling unit tests (Req 5.6, 5.8) ─────

test('resolveMaxAttempts defaults to 1 when options are omitted entirely', () => {
  assert.equal(resolveMaxAttempts(undefined), 1);
  assert.equal(resolveMaxAttempts({}), 1);
});

test('resolveMaxAttempts returns retries + 1 when only retries is provided', () => {
  assert.equal(resolveMaxAttempts({ retries: 0 }), 1);
  assert.equal(resolveMaxAttempts({ retries: 1 }), 2);
  assert.equal(resolveMaxAttempts({ retries: 4 }), 5);
});

test('resolveMaxAttempts returns maxAttempts when only maxAttempts is provided', () => {
  assert.equal(resolveMaxAttempts({ maxAttempts: 1 }), 1);
  assert.equal(resolveMaxAttempts({ maxAttempts: 7 }), 7);
});

test('resolveMaxAttempts prefers retries + 1 and ignores maxAttempts when both are set', () => {
  const options: JobOptions = { retries: 3, maxAttempts: 99 };
  assert.equal(resolveMaxAttempts(options), 4);
});

test('resolveMaxAttempts prefers retries even when retries is 0, ignoring maxAttempts', () => {
  // retries: 0 is provided (defined), so the ceiling is 0 + 1 = 1, not maxAttempts.
  assert.equal(resolveMaxAttempts({ retries: 0, maxAttempts: 5 }), 1);
});
