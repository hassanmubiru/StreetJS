// src/drivers/memory.ts
// @streetjs/queue — the default, zero-third-party-dependency in-process driver
// (Req 1.2, 3.3, 3.4, 8.1, 8.2, 12.5, 13.1).
//
// Implements the `QueueDriver` contract with in-process priority + delay heaps,
// a reserved-lease map, and per-queue dead-letter lists. The full data
// structures and reservation/promotion logic are implemented in task 4.1; the
// class below is a compiling scaffold that reports `health()` as always `up`.

import type { JobEnvelope, DeadLetterRecord, SerializedError } from '../job.js';
import type { QueueDriver, Reservation, QueueStats } from './driver.js';

/** In-process `QueueDriver`. Default backend; pulls in zero runtime deps. */
export class MemoryDriver implements QueueDriver {
  async init(): Promise<void> {
    // No backend to reach; ready immediately.
  }

  enqueue(_queue: string, _envelope: JobEnvelope): Promise<void> {
    return Promise.reject(new Error('MemoryDriver.enqueue not implemented (task 4.1)'));
  }

  enqueueDelayed(_queue: string, _envelope: JobEnvelope, _runAt: number): Promise<void> {
    return Promise.reject(new Error('MemoryDriver.enqueueDelayed not implemented (task 4.1)'));
  }

  reserve(_queues: string[], _visibilityMs: number, _now: number): Promise<Reservation | null> {
    return Promise.reject(new Error('MemoryDriver.reserve not implemented (task 4.1)'));
  }

  ack(_reservation: Reservation): Promise<void> {
    return Promise.reject(new Error('MemoryDriver.ack not implemented (task 4.1)'));
  }

  nack(_reservation: Reservation, _runAt?: number): Promise<void> {
    return Promise.reject(new Error('MemoryDriver.nack not implemented (task 4.1)'));
  }

  promoteDue(_now: number): Promise<number> {
    return Promise.reject(new Error('MemoryDriver.promoteDue not implemented (task 4.1)'));
  }

  moveToDeadLetter(_reservation: Reservation, _error: SerializedError): Promise<void> {
    return Promise.reject(new Error('MemoryDriver.moveToDeadLetter not implemented (task 4.1)'));
  }

  listDeadLetters(_queue: string | undefined, _limit: number): Promise<DeadLetterRecord[]> {
    return Promise.reject(new Error('MemoryDriver.listDeadLetters not implemented (task 4.1)'));
  }

  removeDeadLetter(_jobId: string): Promise<DeadLetterRecord | null> {
    return Promise.reject(new Error('MemoryDriver.removeDeadLetter not implemented (task 4.1)'));
  }

  flushDeadLetters(_queue?: string): Promise<number> {
    return Promise.reject(new Error('MemoryDriver.flushDeadLetters not implemented (task 4.1)'));
  }

  stats(_queue?: string): Promise<QueueStats> {
    return Promise.resolve({ ready: 0, delayed: 0, deadLettered: 0, reserved: 0 });
  }

  purge(_queue?: string): Promise<number> {
    return Promise.reject(new Error('MemoryDriver.purge not implemented (task 4.1)'));
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return { status: 'up' };
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}
