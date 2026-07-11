// src/tests/resilience.test.ts
// Tests for the consolidated resilience primitives (RFC 0004):
// computeBackoff, withRetry, and the re-exported CircuitBreaker.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBackoff,
  withRetry,
  CircuitBreaker,
  CircuitOpenError,
} from '../resilience/index.js';
import { CircuitBreaker as MicroCircuitBreaker } from '../microservices/circuit-breaker.js';

describe('computeBackoff', () => {
  it('reproduces the classic 1s..10s ladder (base 1000, ×2, cap 10000)', () => {
    const policy = { baseDelayMs: 1000, multiplier: 2, maxDelayMs: 10_000 };
    const ladder = [1, 2, 3, 4, 5].map((n) => computeBackoff(policy, n));
    assert.deepEqual(ladder, [1000, 2000, 4000, 8000, 10_000]);
  });

  it('defaults: base 0 → always 0', () => {
    assert.equal(computeBackoff({}, 1), 0);
    assert.equal(computeBackoff({}, 9), 0);
  });

  it('is non-negative, monotonic non-decreasing, and honors the cap', () => {
    const policy = { baseDelayMs: 50, multiplier: 3, maxDelayMs: 5000 };
    let prev = -1;
    for (let attempt = 1; attempt <= 25; attempt++) {
      const d = computeBackoff(policy, attempt);
      assert.ok(d >= 0, 'non-negative');
      assert.ok(d >= prev, 'monotonic non-decreasing');
      assert.ok(d <= 5000, 'capped');
      prev = d;
    }
  });
});

describe('withRetry', () => {
  const immediate = async (): Promise<void> => {};

  it('returns on first success without retrying', async () => {
    let calls = 0;
    const r = await withRetry(async () => { calls++; return 'ok'; }, { delay: immediate });
    assert.equal(r, 'ok');
    assert.equal(calls, 1);
  });

  it('invokes fn exactly once when maxAttempts is 1', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => { calls++; throw new Error('boom'); }, { maxAttempts: 1, delay: immediate }),
      /boom/,
    );
    assert.equal(calls, 1);
  });

  it('retries up to maxAttempts then throws the last error', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(async () => { calls++; throw new Error(`fail-${calls}`); }, { maxAttempts: 3, delay: immediate }),
      /fail-3/,
    );
    assert.equal(calls, 3);
  });

  it('stops immediately when isRetryable returns false', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => { calls++; throw new Error('nope'); },
        { maxAttempts: 5, isRetryable: () => false, delay: immediate },
      ),
      /nope/,
    );
    assert.equal(calls, 1);
  });

  it('eventually succeeds after transient failures', async () => {
    let calls = 0;
    const r = await withRetry(
      async () => { calls++; if (calls < 3) throw new Error('transient'); return calls; },
      { maxAttempts: 5, delay: immediate },
    );
    assert.equal(r, 3);
    assert.equal(calls, 3);
  });

  it('respects a deadline that the next backoff would exceed', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        async () => { calls++; throw new Error('slow'); },
        { maxAttempts: 5, backoff: { baseDelayMs: 10_000 }, deadlineMs: Date.now() + 1, delay: immediate },
      ),
      /slow/,
    );
    assert.equal(calls, 1, 'no retry once the next delay would pass the deadline');
  });
});

describe('CircuitBreaker (re-exported canonical primitive)', () => {
  it('is the same class as the microservices path (single canonical impl)', () => {
    assert.equal(CircuitBreaker, MicroCircuitBreaker);
  });

  it('opens after the failure threshold and blocks calls', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, timeout: 60_000, name: 't' });
    const fail = async (): Promise<never> => { throw new Error('x'); };
    await assert.rejects(cb.execute(fail));
    await assert.rejects(cb.execute(fail));
    assert.equal(cb.state, 'open');
    await assert.rejects(cb.execute(async () => 'unused'), CircuitOpenError);
  });
});
