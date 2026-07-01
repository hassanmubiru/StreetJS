// src/testing.ts
// Realtime testing utilities (Req 16): a `FakeConnection` that records emitted
// events, a `createHarness()` in-memory driver, and `simulateClose(conn)`.
//
// Task 2.1 implements `FakeConnection`. `createHarness()` and
// `simulateClose(conn)` land in task 2.2; this file reserves those exports.

import { randomUUID } from 'node:crypto';
import type { RealtimeConnection, WsEvent } from 'streetjs';

/** Construction options for {@link FakeConnection}. */
export interface FakeConnectionOptions {
  /** Stable connection id. Defaults to a random uuid. */
  readonly id?: string;
  /**
   * When true, {@link FakeConnection.emit} throws on every call so tests can
   * exercise the hub's per-connection send-failure resilience (Req 7.4). The
   * throwing emit still records nothing (the send never completed).
   */
  readonly throwOnEmit?: boolean;
  /**
   * Injectable clock used to stamp the `ts` field of recorded events. Defaults
   * to `Date.now`. Supplying a deterministic clock keeps assertions stable.
   */
  readonly now?: () => number;
}

/**
 * In-memory {@link RealtimeConnection} for tests. It records every emitted
 * {@link WsEvent} (`{ type, payload, ts }`) in emission order so tests can
 * assert exactly which events each connection received (Req 16.1, 16.2), and
 * it mirrors the `id` / `emit` / `closed` / `onClose` / `close` surface of the
 * live `StreetSocket` so it satisfies the same contract used by `ChannelHub`
 * (`bind` / `disconnect`).
 *
 * Construct with `{ throwOnEmit: true }` to make `emit` throw and exercise the
 * hub's send-failure isolation (Req 7.4).
 */
export class FakeConnection implements RealtimeConnection {
  /** Stable, unique id for this connection. */
  readonly id: string;

  private readonly throwOnEmit: boolean;
  private readonly now: () => number;
  private readonly closeHandlers = new Set<() => void>();
  private readonly recorded: WsEvent[] = [];
  private _closed = false;

  constructor(options: FakeConnectionOptions = {}) {
    this.id = options.id ?? randomUUID();
    this.throwOnEmit = options.throwOnEmit ?? false;
    this.now = options.now ?? Date.now;
  }

  /**
   * Record and "send" an event. When constructed with `throwOnEmit`, this
   * throws without recording, simulating a failed send. A closed connection
   * silently drops the event, mirroring `StreetSocket.emit`.
   */
  emit(type: string, payload: unknown): void {
    if (this.throwOnEmit) {
      throw new Error(`FakeConnection ${this.id}: emit failed (throwOnEmit)`);
    }
    if (this._closed) return;
    this.recorded.push({ type, payload, ts: this.now() });
  }

  /** Whether this connection is closed (the hub skips closed connections). */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Register a callback fired once when this connection closes. If already
   * closed, the callback runs immediately. Mirrors `StreetSocket.onClose`.
   */
  onClose(handler: () => void): this {
    if (this._closed) {
      handler();
    } else {
      this.closeHandlers.add(handler);
    }
    return this;
  }

  /**
   * Close the connection, firing every registered close handler exactly once.
   * Idempotent. Signature mirrors `StreetSocket.close(code?, reason?)`.
   */
  close(_code = 1000, _reason = ''): void {
    if (this._closed) return;
    this._closed = true;
    for (const cb of this.closeHandlers) {
      try {
        cb();
      } catch {
        // Isolate handler errors, matching StreetSocket.
      }
    }
    this.closeHandlers.clear();
  }

  // ── Test assertion helpers ──────────────────────────────────────────────────

  /** All events emitted to this connection, in order. Returns a copy. */
  events(): readonly WsEvent[] {
    return [...this.recorded];
  }

  /** Events of a given `type` emitted to this connection, in order. */
  eventsOfType(type: string): readonly WsEvent[] {
    return this.recorded.filter((e) => e.type === type);
  }

  /** The most recently emitted event, or `undefined` if none. */
  lastEvent(): WsEvent | undefined {
    return this.recorded[this.recorded.length - 1];
  }

  /** Number of events recorded on this connection. */
  get eventCount(): number {
    return this.recorded.length;
  }

  /** Discard all recorded events (does not affect closed state). */
  clear(): void {
    this.recorded.length = 0;
  }
}
