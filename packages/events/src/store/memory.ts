// src/store/memory.ts
// @streetjs/events — the default, zero-dependency in-process event store.
//
// Keeps appended envelopes in an insertion-ordered array (which is also `seq`
// order, since `seq` is monotonic per facade). An optional `maxEvents` bound
// makes it a ring buffer that drops the oldest events, so a long-lived process
// with replay enabled never grows without limit. `read`/`count` never throw.

import type { EventEnvelope } from '../event.js';
import { matchesPattern } from '../matcher.js';
import type { EventStore, ReplayFilter } from './store.js';

/** Options for {@link MemoryEventStore}. */
export interface MemoryEventStoreOptions {
  /**
   * Maximum number of events retained. When exceeded, the oldest events are
   * dropped (ring buffer). Omit or set `<= 0` for unbounded retention.
   */
  maxEvents?: number;
}

/** In-process {@link EventStore}. Zero third-party dependencies. */
export class MemoryEventStore implements EventStore {
  private events: EventEnvelope[] = [];
  private readonly maxEvents: number;

  constructor(options: MemoryEventStoreOptions = {}) {
    this.maxEvents = options.maxEvents !== undefined && options.maxEvents > 0 ? options.maxEvents : 0;
  }

  append(envelope: EventEnvelope): Promise<void> {
    this.events.push(envelope);
    if (this.maxEvents > 0 && this.events.length > this.maxEvents) {
      // Drop the oldest overflow (ring buffer). Retained events stay seq-ordered.
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    return Promise.resolve();
  }

  read(filter?: ReplayFilter): Promise<EventEnvelope[]> {
    const selected = this.select(filter);
    // Stored in append (== seq) order already; sort defensively to honor the
    // contract even if a future implementation appends out of order.
    selected.sort((a, b) => a.seq - b.seq);
    const limited =
      filter?.limit !== undefined && filter.limit >= 0 ? selected.slice(0, filter.limit) : selected;
    return Promise.resolve(limited);
  }

  count(filter?: ReplayFilter): Promise<number> {
    return Promise.resolve(this.select(filter).length);
  }

  clear(): Promise<void> {
    this.events = [];
    return Promise.resolve();
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    // In-process store has no backend to lose; always up.
    return { status: 'up', details: { size: this.events.length } };
  }

  /** Apply the filter predicates (never throws). */
  private select(filter?: ReplayFilter): EventEnvelope[] {
    if (!filter) {
      return [...this.events];
    }
    return this.events.filter((e) => {
      if (filter.name !== undefined && e.name !== filter.name) {
        return false;
      }
      if (filter.pattern !== undefined && !matchesPattern(e.name, filter.pattern)) {
        return false;
      }
      if (filter.since !== undefined && e.timestamp < filter.since) {
        return false;
      }
      if (filter.until !== undefined && e.timestamp > filter.until) {
        return false;
      }
      if (filter.fromSeq !== undefined && e.seq < filter.fromSeq) {
        return false;
      }
      return true;
    });
  }
}
