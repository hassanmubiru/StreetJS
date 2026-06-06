import { EventEmitter } from 'node:events';
export interface StreamTransport {
    publish(topic: string, payload: unknown): Promise<void>;
    subscribe(topic: string, groupId: string, handler: (msg: unknown) => Promise<void>): () => void;
}
export declare class InProcessStreamTransport implements StreamTransport {
    private readonly subs;
    publish(topic: string, payload: unknown): Promise<void>;
    subscribe(topic: string, groupId: string, handler: (msg: unknown) => Promise<void>): () => void;
}
export declare class EventStreamPublisher {
    private readonly transport;
    constructor(transport: StreamTransport);
    publish(topic: string, payload: unknown): Promise<void>;
}
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
export declare class EventStreamConsumer extends EventEmitter {
    private readonly transport;
    private lagTimer;
    constructor(transport: StreamTransport);
    subscribe(topic: string, groupId: string, handler: (msg: unknown) => Promise<void>): Promise<() => void>;
    /**
     * Monitor consumer lag by periodically comparing the committed offset to the
     * latest partition offset. Emits a `stream:lag` event ({@link LagEvent}) for
     * every partition whose lag exceeds `maxLagThreshold`. The offset sources are
     * supplied by the caller so this works with any transport (e.g. the Kafka
     * client's `fetchOffset` / `listOffset`).
     *
     * Returns a stop function; the timer is `unref()`-ed so it never blocks exit.
     */
    monitorLag(partitions: number[], getCommittedOffset: (partition: number) => Promise<bigint>, getLatestOffset: (partition: number) => Promise<bigint>, opts: LagMonitorOptions): () => void;
    /** Run a single lag check immediately (used for on-demand checks and tests). */
    checkLagOnce(partitions: number[], getCommittedOffset: (partition: number) => Promise<bigint>, getLatestOffset: (partition: number) => Promise<bigint>, maxLagThreshold: number): Promise<void>;
}
export declare class RealtimeAggregator {
    private readonly regs;
    register(name: string, fn: (values: number[]) => number, windowMs: number): void;
    push(name: string, value: number): void;
    getResult(name: string): number | undefined;
    destroy(): void;
}
//# sourceMappingURL=event-streaming.d.ts.map