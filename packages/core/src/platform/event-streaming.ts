// src/platform/event-streaming.ts
// Event streaming primitives: transport abstraction, consumer, and realtime aggregator.

// ---------------------------------------------------------------------------
// StreamTransport interface
// ---------------------------------------------------------------------------

export interface StreamTransport {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(
    topic: string,
    groupId: string,
    handler: (msg: unknown) => Promise<void>
  ): () => void;
}

// ---------------------------------------------------------------------------
// InProcessStreamTransport  (default for testing / single-node usage)
// ---------------------------------------------------------------------------

export class InProcessStreamTransport implements StreamTransport {
  private readonly subs = new Map<string, Map<string, (msg: unknown) => Promise<void>>>();

  async publish(topic: string, payload: unknown): Promise<void> {
    const groups = this.subs.get(topic);
    if (!groups) return;
    for (const handler of groups.values()) {
      setImmediate(() => void handler(payload));
    }
  }

  subscribe(
    topic: string,
    groupId: string,
    handler: (msg: unknown) => Promise<void>
  ): () => void {
    if (!this.subs.has(topic)) this.subs.set(topic, new Map());
    this.subs.get(topic)!.set(groupId, handler);
    return () => {
      this.subs.get(topic)?.delete(groupId);
    };
  }
}

// ---------------------------------------------------------------------------
// EventStreamPublisher
// ---------------------------------------------------------------------------

export class EventStreamPublisher {
  private readonly transport: StreamTransport;

  constructor(transport: StreamTransport) {
    this.transport = transport;
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    await this.transport.publish(topic, payload);
  }
}

// ---------------------------------------------------------------------------
// EventStreamConsumer
// ---------------------------------------------------------------------------

export interface LagMonitorOptions {
  /** Emit `stream:lag` when lag (latest - committed) exceeds this threshold. */
  maxLagThreshold: number;
  /** Poll interval in ms. Default 5000. */
  intervalMs?: number;
}

/** Per-partition lag sample emitted on the `stream:lag` event. */
export interface LagEvent {
  partition: number;
  committedOffset: bigint;
  latestOffset: bigint;
  lag: bigint;
}

export class EventStreamConsumer extends EventEmitter {
  private readonly transport: StreamTransport;
  private lagTimer: NodeJS.Timeout | null = null;

  constructor(transport: StreamTransport) {
    super();
    this.transport = transport;
  }

  async subscribe(
    topic: string,
    groupId: string,
    handler: (msg: unknown) => Promise<void>
  ): Promise<() => void> {
    return this.transport.subscribe(topic, groupId, handler);
  }

  /**
   * Monitor consumer lag by periodically comparing the committed offset to the
   * latest partition offset. Emits a `stream:lag` event ({@link LagEvent}) for
   * every partition whose lag exceeds `maxLagThreshold`. The offset sources are
   * supplied by the caller so this works with any transport (e.g. the Kafka
   * client's `fetchOffset` / `listOffset`).
   *
   * Returns a stop function; the timer is `unref()`-ed so it never blocks exit.
   */
  monitorLag(
    partitions: number[],
    getCommittedOffset: (partition: number) => Promise<bigint>,
    getLatestOffset: (partition: number) => Promise<bigint>,
    opts: LagMonitorOptions,
  ): () => void {
    const threshold = BigInt(opts.maxLagThreshold);
    const check = async (): Promise<void> => {
      for (const partition of partitions) {
        try {
          const [committed, latest] = await Promise.all([
            getCommittedOffset(partition),
            getLatestOffset(partition),
          ]);
          const lag = latest - committed;
          if (lag > threshold) {
            const evt: LagEvent = { partition, committedOffset: committed, latestOffset: latest, lag };
            this.emit('stream:lag', evt);
          }
        } catch (err) {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
      }
    };
    this.lagTimer = setInterval(() => { void check(); }, opts.intervalMs ?? 5000);
    this.lagTimer.unref();
    // Kick off an immediate check so callers (and tests) don't wait a full interval.
    void check();
    return () => { if (this.lagTimer) { clearInterval(this.lagTimer); this.lagTimer = null; } };
  }

  /** Run a single lag check immediately (used for on-demand checks and tests). */
  async checkLagOnce(
    partitions: number[],
    getCommittedOffset: (partition: number) => Promise<bigint>,
    getLatestOffset: (partition: number) => Promise<bigint>,
    maxLagThreshold: number,
  ): Promise<void> {
    const threshold = BigInt(maxLagThreshold);
    for (const partition of partitions) {
      const [committed, latest] = await Promise.all([
        getCommittedOffset(partition),
        getLatestOffset(partition),
      ]);
      const lag = latest - committed;
      if (lag > threshold) {
        this.emit('stream:lag', { partition, committedOffset: committed, latestOffset: latest, lag } as LagEvent);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// RealtimeAggregator
// ---------------------------------------------------------------------------

interface AggregatorRegistration {
  fn: (values: number[]) => number;
  windowMs: number;
  values: { value: number; ts: number }[];
  lastResult: number | undefined;
  timer: NodeJS.Timeout;
}

export class RealtimeAggregator {
  private readonly regs = new Map<string, AggregatorRegistration>();

  register(name: string, fn: (values: number[]) => number, windowMs: number): void {
    if (this.regs.has(name)) {
      // Replace existing registration
      const old = this.regs.get(name)!;
      clearInterval(old.timer);
    }

    const reg: AggregatorRegistration = {
      fn,
      windowMs,
      values: [],
      lastResult: undefined,
      timer: setInterval(() => {
        // Compute result from within-window values
        const now = Date.now();
        reg.values = reg.values.filter((v) => now - v.ts < reg.windowMs);
        if (reg.values.length > 0) {
          reg.lastResult = reg.fn(reg.values.map((v) => v.value));
        }
      }, Math.min(windowMs, 1_000)),
    };
    reg.timer.unref();
    this.regs.set(name, reg);
  }

  push(name: string, value: number): void {
    const reg = this.regs.get(name);
    if (!reg) return;
    reg.values.push({ value, ts: Date.now() });
  }

  getResult(name: string): number | undefined {
    return this.regs.get(name)?.lastResult;
  }

  destroy(): void {
    for (const reg of this.regs.values()) {
      clearInterval(reg.timer);
    }
    this.regs.clear();
  }
}
