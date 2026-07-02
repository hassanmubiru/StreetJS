// src/store/store.ts
// @streetjs/events — the pluggable event-store contract for optional
// persistence and replay.
//
// This is an ABSTRACT storage seam. The package ships `MemoryEventStore`
// (zero-dependency, in-process); future adapters (Postgres, Redis, Kafka) can
// implement the same contract without touching the facade. It is intentionally
// small: append one envelope, read a filtered/ordered slice, count, clear, and
// report health. Ordering is by the envelope's monotonic `seq` so replay
// reproduces publish order.

import type { EventEnvelope } from '../event.js';

/**
 * Filter applied by {@link EventStore.read} / {@link EventStore.count} and by
 * `Events.replay`. All fields are optional; an empty filter selects everything.
 */
export interface ReplayFilter {
  /** Exact event name to select. */
  name?: string;
  /** Wildcard pattern (`user.*`, `order.**`) to select, matched like subscriptions. */
  pattern?: string;
  /** Select events with `timestamp >= since` (epoch ms, inclusive). */
  since?: number;
  /** Select events with `timestamp <= until` (epoch ms, inclusive). */
  until?: number;
  /** Select events with `seq >= fromSeq` (inclusive). */
  fromSeq?: number;
  /** Cap the number of returned events (after ordering by `seq`). */
  limit?: number;
}

/**
 * Storage abstraction for application events. Implementations MUST preserve and
 * return events ordered by ascending `seq`, and MUST NOT throw from `read` /
 * `count` for a well-formed filter.
 */
export interface EventStore {
  /** Persist one event envelope. */
  append(envelope: EventEnvelope): Promise<void>;
  /** Return the stored events matching `filter`, ordered by ascending `seq`. */
  read(filter?: ReplayFilter): Promise<EventEnvelope[]>;
  /** Count the stored events matching `filter`. */
  count(filter?: ReplayFilter): Promise<number>;
  /** Remove all stored events. */
  clear(): Promise<void>;
  /** Connectivity/health for the observability check. */
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> };
}
