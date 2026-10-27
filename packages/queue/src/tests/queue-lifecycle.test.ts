import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQueue } from '../facade.js';
import { MemoryDriver } from '../drivers/memory.js';
import { Job } from '../job.js';

test('queue close is memoized and preserves a driver cleanup failure', async () => {
  class FailingCloseDriver extends MemoryDriver {
    closeCalls = 0;

    override async close(): Promise<void> {
      this.closeCalls += 1;
      throw new Error('driver close failed');
    }
  }

  const driver = new FailingCloseDriver();
  const queue = createQueue({ driver });
  const firstClose = queue.close();
  const secondClose = queue.close();

  assert.strictEqual(firstClose, secondClose);
  await assert.rejects(firstClose, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 1);
    assert.equal((error.errors[0] as Error).message, 'driver close failed');
    return true;
  });
  assert.equal(driver.closeCalls, 1);
  await assert.rejects(queue.close(), /Queue resource cleanup failed/);
  assert.equal(driver.closeCalls, 1);
});

test('failed deduplicated enqueue releases its reservation for a later retry', async () => {
  class FailingEnqueueDriver extends MemoryDriver {
    enqueueCalls = 0;

    override async enqueue(
      queue: string,
      envelope: Parameters<MemoryDriver['enqueue']>[1],
    ): Promise<void> {
      this.enqueueCalls += 1;
      if (this.enqueueCalls === 1) {
        throw new Error('enqueue failed');
      }
      await super.enqueue(queue, envelope);
    }
  }

  const driver = new FailingEnqueueDriver();
  const queue = createQueue({ driver });
  const job = new class extends Job<{ value: number }> {
    readonly type = 'queue.lifecycle.retry';
  }({ value: 1 });

  await assert.rejects(
    queue.dispatch(job, { dedupeKey: 'same-request' }),
    /enqueue failed/,
  );

  const retryId = await queue.dispatch(job, { dedupeKey: 'same-request' });
  assert.equal(driver.enqueueCalls, 2);
  assert.equal(typeof retryId, 'string');
  assert.equal((await driver.stats()).ready, 1);
});
