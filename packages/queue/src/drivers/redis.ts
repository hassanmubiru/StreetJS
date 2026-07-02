// src/drivers/redis.ts
// @streetjs/queue — the durable, multi-worker Redis driver (Req 1.3, 3.3, 3.4,
// 8.1, 8.2, 12.4, 12.6, 13.1, 13.3, 14.1).
//
// IMPORTANT: `RedisDriver` / `RedisDriverOptions` are exported ONLY from this
// module and reached exclusively through the opt-in `@streetjs/queue/redis`
// submodule export. They are intentionally NOT re-exported from `src/index.ts`
// so Memory-driver users pull in no extra runtime dependencies (Req 1.3).
//
// The driver is built on the core zero-dependency `RedisClient` (`command(args)`
// + pub/sub). Its full implementation (ready list + priority ZSET, delayed ZSET
// scored by runAt, processing list with lease reclaim, dead-letter list,
// pub/sub wake-ups, connection-loss health reporting) lands in task 15.1; the
// class below is a compiling scaffold.

import type { RedisLike } from 'streetjs';
import type { JobEnvelope, DeadLetterRecord, SerializedError } from '../job.js';
import type { QueueDriver, Reservation, QueueStats } from './driver.js';

/** Options for the opt-in Redis-backed queue driver. */
export interface RedisDriverOptions {
  /** The core `RedisClient` (or compatible) used for storage and pub/sub. */
  client: RedisLike;
  /** Key prefix namespacing all queue keys. Default "streetjs:queue". */
  keyPrefix?: string;
  /** Visibility lease (ms) for reservations before crash-reclaim. Default 30000. */
  visibilityMs?: number;
}

/** Durable, multi-worker `QueueDriver` shipped behind `@streetjs/queue/redis`. */
export class RedisDriver implements QueueDriver {
  protected readonly client: RedisLike;
  protected readonly keyPrefix: string;
  protected readonly visibilityMs: number;

  constructor(options: RedisDriverOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'streetjs:queue';
    this.visibilityMs = options.visibilityMs ?? 30_000;
  }

  init(): Promise<void> {
    return Promise.reject(new Error('RedisDriver.init not implemented (task 15.1)'));
  }

  enqueue(_queue: string, _envelope: JobEnvelope): Promise<void> {
    return Promise.reject(new Error('RedisDriver.enqueue not implemented (task 15.1)'));
  }

  enqueueDelayed(_queue: string, _envelope: JobEnvelope, _runAt: number): Promise<void> {
    return Promise.reject(new Error('RedisDriver.enqueueDelayed not implemented (task 15.1)'));
  }

  reserve(_queues: string[], _visibilityMs: number, _now: number): Promise<Reservation | null> {
    return Promise.reject(new Error('RedisDriver.reserve not implemented (task 15.1)'));
  }

  ack(_reservation: Reservation): Promise<void> {
    return Promise.reject(new Error('RedisDriver.ack not implemented (task 15.1)'));
  }

  nack(_reservation: Reservation, _runAt?: number): Promise<void> {
    return Promise.reject(new Error('RedisDriver.nack not implemented (task 15.1)'));
  }

  promoteDue(_now: number): Promise<number> {
    return Promise.reject(new Error('RedisDriver.promoteDue not implemented (task 15.1)'));
  }

  moveToDeadLetter(_reservation: Reservation, _error: SerializedError): Promise<void> {
    return Promise.reject(new Error('RedisDriver.moveToDeadLetter not implemented (task 15.1)'));
  }

  listDeadLetters(_queue: string | undefined, _limit: number): Promise<DeadLetterRecord[]> {
    return Promise.reject(new Error('RedisDriver.listDeadLetters not implemented (task 15.1)'));
  }

  removeDeadLetter(_jobId: string): Promise<DeadLetterRecord | null> {
    return Promise.reject(new Error('RedisDriver.removeDeadLetter not implemented (task 15.1)'));
  }

  flushDeadLetters(_queue?: string): Promise<number> {
    return Promise.reject(new Error('RedisDriver.flushDeadLetters not implemented (task 15.1)'));
  }

  stats(_queue?: string): Promise<QueueStats> {
    return Promise.reject(new Error('RedisDriver.stats not implemented (task 15.1)'));
  }

  purge(_queue?: string): Promise<number> {
    return Promise.reject(new Error('RedisDriver.purge not implemented (task 15.1)'));
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return { status: 'down', details: { reason: 'not implemented (task 15.1)' } };
  }

  close(): Promise<void> {
    return Promise.reject(new Error('RedisDriver.close not implemented (task 15.1)'));
  }
}
