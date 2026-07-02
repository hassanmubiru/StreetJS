// src/tests/example-smoke.test.ts
// Task 18.2 — automated smoke test that executes the runnable example so it
// stays working (Req 17.4).
//
// It imports the example's exported `main()` and asserts every demonstrated
// outcome: the immediate job was processed, the delayed job ran after its delay,
// the cron schedule was registered, and the always-failing job exhausted its
// attempts and landed in the dead-letter queue. The example runs over the
// in-process MemoryDriver with a short scheduler tick, so it is deterministic
// and fast and needs no Redis. `main()` calls `queue.close()` before returning,
// so this test also proves the example shuts down cleanly (no leaked timers —
// `node --test` would otherwise hang).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../examples/basic.js';

test('runnable example: dispatch, delayed, cron, and dead-letter all work (Req 17.4)', async () => {
  const result = await main(true /* quiet */);

  // (a) dispatch + worker: the welcome email was processed exactly once.
  assert.deepEqual(result.processedEmails, ['ada@example.com']);

  // (b) delayed job: the reminder ran, and only after its Due_Time.
  assert.equal(result.reminderRan, true);
  assert.ok(result.reminderRanAt !== undefined, 'reminder should record when it ran');
  assert.ok(
    result.reminderRanAt! >= result.reminderDispatchedAt + result.reminderDelayMs,
    `delayed job ran at ${result.reminderRanAt} but was not due until ` +
      `${result.reminderDispatchedAt + result.reminderDelayMs}`,
  );

  // (c) scheduled job: the cron entry registered without a CronParseError.
  assert.equal(result.cronRegistered, true);

  // (d) dead-letter handling: the always-failing job was attempted up to its
  //     ceiling (3) and moved to the DLQ exactly once with a descriptive error.
  assert.equal(result.flakyAttempts, 3);
  assert.equal(result.deadLetteredIds.length, 1);
  assert.equal(result.deadLetterError, 'flaky job always fails');
});
