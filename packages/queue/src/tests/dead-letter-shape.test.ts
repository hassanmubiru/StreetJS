// src/tests/dead-letter-shape.test.ts
// Unit test for the dead-letter record shape (Task 9.3).
//
// Validates:
//   - Req 6.3: WHEN a developer lists dead letters through the DeadLetterApi,
//     THE Dead_Letter_Queue SHALL return DeadLetterRecords carrying the job id,
//     type, queue, payload, consumed attempts, serialized error, and timestamps.
//
// This drives the production `queue.deadLetters.list` surface through the
// `TestHarness` with an injected, advanceable clock and no real Redis. A job is
// dead-lettered deterministically by registering an always-throwing handler and
// enqueuing with `maxAttempts: 1`, so a single failed run dead-letters it
// immediately (attempts 1 >= maxAttempts 1). The test then asserts the returned
// record carries every field promised by Req 6.3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Job } from '../job.js';
import { TestHarness } from '../testing.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

interface ReportPayload {
  readonly reportId: number;
  readonly recipients: string[];
}

/** A job whose registered handler always throws, so its only attempt fails. */
class GenerateReportJob extends Job<ReportPayload> {
  readonly type = 'generate-report';
}

const REPORT_TYPE = 'generate-report';
const THROWN_MESSAGE = 'report generation exploded';

// ── Req 6.3: dead-letter record shape ─────────────────────────────────────────

test('deadLetters.list returns records carrying id, type, queue, payload, consumed attempts, serialized error, and timestamps', async () => {
  // Seed the harness clock to a non-zero value so we can assert enqueuedAt
  // matches the clock at enqueue time (not merely a default of 0).
  const START = 5_000;
  const harness = new TestHarness({ now: START });

  // Always-throwing handler → the single permitted attempt fails.
  harness.register(REPORT_TYPE, () => {
    throw new Error(THROWN_MESSAGE);
  });

  const payload: ReportPayload = { reportId: 42, recipients: ['ada@example.com', 'grace@example.com'] };

  // maxAttempts: 1 → a single failed run dead-letters the job immediately.
  const jobId = await harness.enqueue(new GenerateReportJob(payload), { maxAttempts: 1 });

  // Advance the clock before running so failedAt is strictly greater than
  // enqueuedAt and we can assert the ordering of timestamps meaningfully.
  await harness.advance(250);
  const ran = await harness.runReady();
  assert.equal(ran, 1, 'exactly one job should run');

  // ── List the dead-letter records for the default queue. ───────────────────
  const records = await harness.queue.deadLetters.list('default');
  assert.equal(records.length, 1, 'exactly one dead-letter record after the failed run');

  const record = records[0]!;

  // Job id matches the id returned by enqueue.
  assert.equal(record.id, jobId, 'record carries the dispatched job id');

  // Type and queue.
  assert.equal(record.type, REPORT_TYPE, 'record carries the job type');
  assert.equal(record.queue, 'default', 'record carries the (default) queue');

  // Payload is deep-equal to what was dispatched.
  assert.deepEqual(record.payload, payload, 'record carries the dispatched payload verbatim');

  // Consumed attempts == maxAttempts (the single attempt was consumed).
  assert.equal(record.attempts, 1, 'record records the consumed attempts (=== maxAttempts)');
  assert.equal(record.maxAttempts, 1, 'record carries the resolved attempt ceiling');

  // Serialized error carries a name and the thrown message.
  assert.ok(record.error, 'record carries a serialized error');
  assert.equal(typeof record.error.name, 'string', 'serialized error has a string name');
  assert.ok(record.error.name.length > 0, 'serialized error name is non-empty');
  assert.equal(record.error.message, THROWN_MESSAGE, 'serialized error message matches the thrown error');

  // Timestamps: enqueuedAt is a number equal to the injected clock at enqueue;
  // failedAt is a number stamped at/after the enqueue time.
  assert.equal(typeof record.enqueuedAt, 'number', 'enqueuedAt is a number');
  assert.equal(record.enqueuedAt, START, 'enqueuedAt matches the harness clock at enqueue time');
  assert.equal(typeof record.failedAt, 'number', 'failedAt is a number');
  assert.ok(
    record.failedAt >= record.enqueuedAt,
    `failedAt (${record.failedAt}) should be >= enqueuedAt (${record.enqueuedAt})`,
  );

  await harness.close();
});

test('deadLetters.list() with no queue argument returns the same record across all queues', async () => {
  const harness = new TestHarness({ now: 1_000 });

  harness.register(REPORT_TYPE, () => {
    throw new Error(THROWN_MESSAGE);
  });

  const payload: ReportPayload = { reportId: 7, recipients: [] };
  const jobId = await harness.enqueue(new GenerateReportJob(payload), { maxAttempts: 1 });

  await harness.runReady();

  const all = await harness.queue.deadLetters.list();
  assert.equal(all.length, 1, 'the record is visible when listing all queues');
  assert.equal(all[0]!.id, jobId, 'record carries the dispatched job id');
  assert.equal(all[0]!.type, REPORT_TYPE, 'record carries the job type');
  assert.deepEqual(all[0]!.payload, payload, 'record carries the dispatched payload');

  await harness.close();
});
