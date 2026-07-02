// src/drivers/driver.ts
// @streetjs/queue — the pluggable QueueDriver contract (Req 13.1, 13.3).
//
// The driver is the single interchangeable seam every backend implements. It
// knows NOTHING about retries, priority policy, middleware, or events — those
// are pure facade logic. It only stores envelopes, reserves them respecting a
// caller-provided ordering key (descending priority, FIFO by enqueue sequence
// on ties), acknowledges/negatively-acknowledges reservations, promotes due
// delayed jobs, and holds the dead-letter store. Keeping the contract
// semantics-free is what lets Memory and Redis (and any future backend) stay
// behaviorally interchangeable and validated against the same property suite.

import type { JobEnvelope, DeadLetterRecord, SerializedError } from '../job.js';

/** A leased reservation. `token` lets the driver validate ack/nack ownership. */
export interface Reservation<TPayload = unknown> {
  readonly envelope: JobEnvelope<TPayload>;
  readonly token: string;
  readonly queue: string;
  readonly leaseExpiresAt: number;
}

/** Best-effort live counts for observability. */
export interface QueueStats {
  ready: number;
  delayed: number;
  deadLettered: number;
  /** Currently leased/in-flight. */
  reserved: number;
}

export interface QueueDriver {
  /** One-time init; MUST reject if the backend cannot be reached (Req 13.3). */
  init(): Promise<void>;

  /** Append a ready-to-run envelope to `queue`. */
  enqueue(queue: string, envelope: JobEnvelope): Promise<void>;

  /** Store an envelope that becomes eligible only at `runAt` (delayed/scheduled). */
  enqueueDelayed(queue: string, envelope: JobEnvelope, runAt: number): Promise<void>;

  /**
   * Reserve the next eligible envelope from the highest-priority non-empty
   * queue in `queues`, or null if none are ready. Reservation grants a
   * visibility lease of `visibilityMs`: an un-acked reservation becomes
   * eligible again after the lease (crash recovery). Ordering: strictly by
   * descending priority, ties FIFO by enqueue sequence.
   */
  reserve(queues: string[], visibilityMs: number, now: number): Promise<Reservation | null>;

  /** Acknowledge successful processing; permanently removes the reserved job. */
  ack(reservation: Reservation): Promise<void>;

  /** Negative-ack: return the job to the queue (optionally after `runAt`). */
  nack(reservation: Reservation, runAt?: number): Promise<void>;

  /** Promote delayed jobs whose runAt <= now into their ready queue; returns count. */
  promoteDue(now: number): Promise<number>;

  /** Move a reserved/failed envelope to the dead-letter store. */
  moveToDeadLetter(reservation: Reservation, error: SerializedError): Promise<void>;

  /** List dead-letter records for a queue (or all queues when undefined). */
  listDeadLetters(queue: string | undefined, limit: number): Promise<DeadLetterRecord[]>;

  /** Remove and return a single dead-letter record by job id, or null. */
  removeDeadLetter(jobId: string): Promise<DeadLetterRecord | null>;

  /** Remove dead-letter records (for a queue or all); returns the count removed. */
  flushDeadLetters(queue?: string): Promise<number>;

  /** Live counts for observability (never throws; returns best-effort snapshot). */
  stats(queue?: string): Promise<QueueStats>;

  /** Remove all jobs (ready + delayed) for a queue; used by tests/queue:flush. */
  purge(queue?: string): Promise<number>;

  /** Connectivity for the health check (up/down + details). */
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> };

  /** Optional push notification: invoke `handler` when new work may be ready. */
  onWake?(handler: (queue: string) => void): void;

  /** Release backend resources. */
  close(): Promise<void>;
}
