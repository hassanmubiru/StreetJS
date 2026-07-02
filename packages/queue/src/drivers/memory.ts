// src/drivers/memory.ts
// @streetjs/queue — the default, zero-third-party-dependency in-process driver
// (Req 1.2, 3.3, 3.4, 8.1, 8.2, 12.5, 13.1).
//
// Implements the `QueueDriver` contract with in-process priority + delay heaps,
// a reserved-lease map, and per-queue dead-letter lists. Because it relies only
// on plain data structures and the Node builtin `node:crypto`, a Memory user
// pulls in zero third-party runtime dependencies (Req 1.2). The facade uses this
// class as its default driver.

import { randomUUID } from 'node:crypto';
import type { JobEnvelope, DeadLetterRecord, SerializedError } from '../job.js';
import type { QueueDriver, Reservation, QueueStats } from './driver.js';

/**
 * A minimal binary heap parameterised by a comparator. `compare(a, b) < 0`
 * means `a` should be popped before `b`. Used for both the priority-ordered
 * ready heap and the runAt-ordered delayed heap. Pure in-process, zero-dep.
 */
class BinaryHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(items[i]!, items[parent]!) < 0) {
        [items[i], items[parent]] = [items[parent]!, items[i]!];
        i = parent;
      } else {
        break;
      }
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const top = items[0];
    if (top === undefined) {
      return undefined;
    }
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Drain and return every item whose predicate holds, sifting as needed. */
  drainWhile(predicate: (top: T) => boolean): T[] {
    const drained: T[] = [];
    while (this.items.length > 0 && predicate(this.items[0]!)) {
      drained.push(this.pop()!);
    }
    return drained;
  }

  private siftDown(start: number): void {
    const items = this.items;
    const n = items.length;
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && this.compare(items[left]!, items[smallest]!) < 0) {
        smallest = left;
      }
      if (right < n && this.compare(items[right]!, items[smallest]!) < 0) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      [items[i], items[smallest]] = [items[smallest]!, items[i]!];
      i = smallest;
    }
  }
}

/** A delayed entry: an envelope paired with the epoch ms at which it is due. */
interface DelayedEntry {
  readonly envelope: JobEnvelope;
  readonly runAt: number;
}

/** A leased reservation record kept in-process keyed by its token. */
interface LeaseRecord {
  readonly envelope: JobEnvelope;
  readonly queue: string;
  readonly leaseExpiresAt: number;
}

/**
 * Ready ordering: strictly descending priority; ties broken FIFO by ascending
 * enqueue `seq`. Returns < 0 when `a` should be reserved before `b`.
 */
function compareReady(a: JobEnvelope, b: JobEnvelope): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority; // higher priority first
  }
  return a.seq - b.seq; // FIFO on ties
}

/** Delayed ordering: earliest `runAt` first; ties by ascending `seq`. */
function compareDelayed(a: DelayedEntry, b: DelayedEntry): number {
  if (a.runAt !== b.runAt) {
    return a.runAt - b.runAt;
  }
  return a.envelope.seq - b.envelope.seq;
}

/** In-process `QueueDriver`. Default backend; pulls in zero runtime deps. */
export class MemoryDriver implements QueueDriver {
  /** Ready jobs per queue: max-heap by descending priority, FIFO by seq on ties. */
  private readonly ready = new Map<string, BinaryHeap<JobEnvelope>>();
  /** Delayed jobs per queue: min-heap by runAt. */
  private readonly delayed = new Map<string, BinaryHeap<DelayedEntry>>();
  /** Currently leased jobs, keyed by reservation token. */
  private readonly reserved = new Map<string, LeaseRecord>();
  /** Dead-letter records per queue, in failure order. */
  private readonly dead = new Map<string, DeadLetterRecord[]>();

  async init(): Promise<void> {
    // No backend to reach; ready immediately.
  }

  enqueue(queue: string, envelope: JobEnvelope): Promise<void> {
    this.readyHeap(queue).push(envelope);
    return Promise.resolve();
  }

  enqueueDelayed(queue: string, envelope: JobEnvelope, runAt: number): Promise<void> {
    this.delayedHeap(queue).push({ envelope, runAt });
    return Promise.resolve();
  }

  reserve(queues: string[], visibilityMs: number, now: number): Promise<Reservation | null> {
    // 1) Reclaim any expired leases back to ready before choosing new work.
    this.reclaimExpiredLeases(now);

    // 2) Pop the highest-priority ready job from the first non-empty queue,
    //    iterating queues in the provided (cross-queue priority) order.
    for (const queue of queues) {
      const heap = this.ready.get(queue);
      if (heap && heap.size > 0) {
        const envelope = heap.pop()!;
        // Attempt is consumed at reserve (envelope.attempts incremented here).
        envelope.attempts += 1;
        const token = randomUUID();
        const leaseExpiresAt = now + visibilityMs;
        this.reserved.set(token, { envelope, queue, leaseExpiresAt });
        const reservation: Reservation = { envelope, token, queue, leaseExpiresAt };
        return Promise.resolve(reservation);
      }
    }
    return Promise.resolve(null);
  }

  ack(reservation: Reservation): Promise<void> {
    // Permanently remove the reserved job.
    this.reserved.delete(reservation.token);
    return Promise.resolve();
  }

  nack(reservation: Reservation, runAt?: number): Promise<void> {
    const existed = this.reserved.delete(reservation.token);
    // If the lease was already reclaimed/acked, do not resurrect the job.
    if (!existed) {
      return Promise.resolve();
    }
    if (runAt !== undefined) {
      this.delayedHeap(reservation.queue).push({ envelope: reservation.envelope, runAt });
    } else {
      this.readyHeap(reservation.queue).push(reservation.envelope);
    }
    return Promise.resolve();
  }

  promoteDue(now: number): Promise<number> {
    let promoted = 0;
    for (const [queue, heap] of this.delayed) {
      const due = heap.drainWhile((top) => top.runAt <= now);
      if (due.length > 0) {
        const readyHeap = this.readyHeap(queue);
        for (const entry of due) {
          readyHeap.push(entry.envelope);
        }
        promoted += due.length;
      }
    }
    return Promise.resolve(promoted);
  }

  moveToDeadLetter(reservation: Reservation, error: SerializedError): Promise<void> {
    this.reserved.delete(reservation.token);
    const envelope = reservation.envelope;
    const record: DeadLetterRecord = {
      id: envelope.id,
      type: envelope.type,
      queue: reservation.queue,
      payload: envelope.payload,
      attempts: envelope.attempts,
      maxAttempts: envelope.maxAttempts,
      backoff: envelope.backoff,
      error,
      enqueuedAt: envelope.enqueuedAt,
      failedAt: Date.now(),
    };
    this.deadList(reservation.queue).push(record);
    return Promise.resolve();
  }

  listDeadLetters(queue: string | undefined, limit: number): Promise<DeadLetterRecord[]> {
    const records: DeadLetterRecord[] = [];
    if (queue !== undefined) {
      records.push(...(this.dead.get(queue) ?? []));
    } else {
      for (const list of this.dead.values()) {
        records.push(...list);
      }
    }
    return Promise.resolve(limit >= 0 ? records.slice(0, limit) : records);
  }

  removeDeadLetter(jobId: string): Promise<DeadLetterRecord | null> {
    for (const list of this.dead.values()) {
      const index = list.findIndex((record) => record.id === jobId);
      if (index !== -1) {
        const [removed] = list.splice(index, 1);
        return Promise.resolve(removed!);
      }
    }
    return Promise.resolve(null);
  }

  flushDeadLetters(queue?: string): Promise<number> {
    if (queue !== undefined) {
      const list = this.dead.get(queue);
      const removed = list?.length ?? 0;
      if (list) {
        list.length = 0;
      }
      return Promise.resolve(removed);
    }
    let removed = 0;
    for (const list of this.dead.values()) {
      removed += list.length;
      list.length = 0;
    }
    return Promise.resolve(removed);
  }

  stats(queue?: string): Promise<QueueStats> {
    if (queue !== undefined) {
      const stats: QueueStats = {
        ready: this.ready.get(queue)?.size ?? 0,
        delayed: this.delayed.get(queue)?.size ?? 0,
        deadLettered: this.dead.get(queue)?.length ?? 0,
        reserved: this.countReserved(queue),
      };
      return Promise.resolve(stats);
    }
    let ready = 0;
    for (const heap of this.ready.values()) {
      ready += heap.size;
    }
    let delayed = 0;
    for (const heap of this.delayed.values()) {
      delayed += heap.size;
    }
    let deadLettered = 0;
    for (const list of this.dead.values()) {
      deadLettered += list.length;
    }
    return Promise.resolve({ ready, delayed, deadLettered, reserved: this.reserved.size });
  }

  purge(queue?: string): Promise<number> {
    // Remove all ready + delayed jobs (leaves reserved/in-flight and DLQ intact).
    if (queue !== undefined) {
      const removed = (this.ready.get(queue)?.size ?? 0) + (this.delayed.get(queue)?.size ?? 0);
      this.ready.delete(queue);
      this.delayed.delete(queue);
      return Promise.resolve(removed);
    }
    let removed = 0;
    for (const heap of this.ready.values()) {
      removed += heap.size;
    }
    for (const heap of this.delayed.values()) {
      removed += heap.size;
    }
    this.ready.clear();
    this.delayed.clear();
    return Promise.resolve(removed);
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    // In-process driver has no backend to lose; always up (Req 12.5).
    return { status: 'up' };
  }

  async close(): Promise<void> {
    // Nothing to release.
  }

  /** Move every lease whose expiry has passed (<= now) back to its ready heap. */
  private reclaimExpiredLeases(now: number): void {
    for (const [token, lease] of this.reserved) {
      if (lease.leaseExpiresAt <= now) {
        this.reserved.delete(token);
        this.readyHeap(lease.queue).push(lease.envelope);
      }
    }
  }

  private countReserved(queue: string): number {
    let count = 0;
    for (const lease of this.reserved.values()) {
      if (lease.queue === queue) {
        count += 1;
      }
    }
    return count;
  }

  private readyHeap(queue: string): BinaryHeap<JobEnvelope> {
    let heap = this.ready.get(queue);
    if (!heap) {
      heap = new BinaryHeap<JobEnvelope>(compareReady);
      this.ready.set(queue, heap);
    }
    return heap;
  }

  private delayedHeap(queue: string): BinaryHeap<DelayedEntry> {
    let heap = this.delayed.get(queue);
    if (!heap) {
      heap = new BinaryHeap<DelayedEntry>(compareDelayed);
      this.delayed.set(queue, heap);
    }
    return heap;
  }

  private deadList(queue: string): DeadLetterRecord[] {
    let list = this.dead.get(queue);
    if (!list) {
      list = [];
      this.dead.set(queue, list);
    }
    return list;
  }
}
