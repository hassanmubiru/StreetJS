// src/testing.ts
// @streetjs/queue — Redis-free testing utilities (Req 16.1–16.4).
//
// `FakeQueue` records dispatch/schedule/events and drives execution
// synchronously; `MemoryQueue` runs a real Queue over the MemoryDriver with a
// real Worker; `TestHarness` builds a Queue with an injected Clock and helpers
// to advance the clock, promote due jobs, reserve, force failures, and assert
// events. Implemented in tasks 2.1 and 2.2; the declarations below are compiling
// scaffolds.

import type { Clock } from 'streetjs';
import type { Job, JobOptions } from './job.js';
import type { Queue } from './facade.js';

/** Records dispatch/schedule calls and events, driving execution synchronously. */
export class FakeQueue {
  constructor() {
    throw new Error('FakeQueue not implemented (task 2.1)');
  }
}

/** Runs a real Queue over the MemoryDriver with a real Worker (no Redis). */
export class MemoryQueue {
  constructor() {
    throw new Error('MemoryQueue not implemented (task 2.2)');
  }
}

export interface TestHarnessOptions {
  clock?: Clock;
}

/** Builds a Queue with an injected Clock plus advance/reserve/assert helpers. */
export class TestHarness {
  constructor(_options: TestHarnessOptions = {}) {
    throw new Error('TestHarness not implemented (task 2.2)');
  }

  /** The queue under test. */
  get queue(): Queue {
    throw new Error('TestHarness.queue not implemented (task 2.2)');
  }

  /** Enqueue a job. */
  enqueue(_job: Job<unknown>, _options?: JobOptions): Promise<string> {
    throw new Error('TestHarness.enqueue not implemented (task 2.2)');
  }

  /** Advance the injected clock, running delayed promotion and rate windows. */
  advance(_ms: number): Promise<void> {
    throw new Error('TestHarness.advance not implemented (task 2.2)');
  }
}
