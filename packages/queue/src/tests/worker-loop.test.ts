// src/tests/worker-loop.test.ts
// Task 6.1 — smoke tests for the worker reservation loop: lifecycle
// (start idempotent / stop graceful drain / status), end-to-end consumption of
// the active driver (ack on success), and the concurrency bound.
// (Req 7.1, 7.2, 7.3, 7.4, 7.5, 8.4, 14.1)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../facade.js';
import { Job } from '../job.js';

class NoopJob extends Job<{ n: number }> {
  readonly type = 'noop';
  constructor(n: number) {
    super({ n });
  }
}

/** Await until `predicate` holds or the deadline passes; polls the microtask/timer queue. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('worker consumes ready jobs from the active driver and acks on success (Req 14.1)', async () => {
  const queue = createQueue();
  const processed: number[] = [];
  queue.register<{ n: number }>('noop', (payload) => {
    processed.push(payload.n);
  });

  await queue.dispatch(new NoopJob(1));
  await queue.dispatch(new NoopJob(2));
  await queue.dispatch(new NoopJob(3));

  const worker = queue.work({ pollIntervalMs: 10 });
  worker.start();

  await waitFor(() => processed.length === 3);
  await queue.close();

  assert.deepEqual([...processed].sort(), [1, 2, 3]);
  const stats = await queue.driver.stats('default');
  assert.equal(stats.ready, 0);
  assert.equal(stats.reserved, 0);

  const status = worker.status();
  assert.equal(status.running, false);
  assert.equal(status.inFlight, 0);
  assert.equal(status.processed, 3);
});

test('start is idempotent — repeated start calls do not double-process (Req 7.4)', async () => {
  const queue = createQueue();
  let count = 0;
  queue.register('noop', () => {
    count += 1;
  });
  await queue.dispatch(new NoopJob(1));

  const worker = queue.work({ pollIntervalMs: 10 });
  worker.start();
  worker.start();
  worker.start();

  await waitFor(() => count === 1);
  // Give any erroneous extra loops a chance to double-process.
  await new Promise((resolve) => setTimeout(resolve, 30));
  await queue.close();

  assert.equal(count, 1);
});

test('worker never exceeds its concurrency bound (Req 7.1, 7.2)', async () => {
  const queue = createQueue();
  const concurrency = 2;
  let current = 0;
  let peak = 0;
  const gate: Array<() => void> = [];

  queue.register('noop', async () => {
    current += 1;
    peak = Math.max(peak, current);
    // Hold the slot until released so we can observe simultaneous execution.
    await new Promise<void>((resolve) => gate.push(resolve));
    current -= 1;
  });

  for (let i = 0; i < 6; i += 1) {
    await queue.dispatch(new NoopJob(i));
  }

  const worker = queue.work({ concurrency, pollIntervalMs: 10 });
  worker.start();

  // Wait until the bound is saturated, then release jobs in waves.
  await waitFor(() => gate.length >= concurrency);
  assert.equal(worker.status().inFlight, concurrency);
  assert.ok(peak <= concurrency, `peak ${peak} exceeded concurrency ${concurrency}`);

  // Release everything, feeding the release as new slots open.
  const release = async () => {
    while (gate.length > 0) {
      gate.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  };

  const stats = queue.driver.stats('default');
  const drain = (async () => {
    while ((await queue.driver.stats('default')).ready + current > 0 || gate.length > 0) {
      await release();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  void stats;
  await drain;
  await queue.close();

  assert.ok(peak <= concurrency, `peak ${peak} exceeded concurrency ${concurrency}`);
});

test('stop drains in-flight work and reports a stopped, idle status', async () => {
  const queue = createQueue();
  let started = 0;
  let finished = 0;
  let releaseJob!: () => void;
  const jobStarted = new Promise<void>((resolve) => {
    queue.register('noop', async () => {
      started += 1;
      resolve();
      await new Promise<void>((r) => {
        releaseJob = r;
      });
      finished += 1;
    });
  });

  await queue.dispatch(new NoopJob(1));
  const worker = queue.work({ pollIntervalMs: 10 });
  worker.start();

  await jobStarted;
  assert.equal(worker.status().inFlight, 1);

  const stopPromise = worker.stop();
  // Release the in-flight job so the graceful drain can complete.
  releaseJob();
  await stopPromise;

  assert.equal(started, 1);
  assert.equal(finished, 1);
  const status = worker.status();
  assert.equal(status.running, false);
  assert.equal(status.inFlight, 0);
  await queue.close();
});
