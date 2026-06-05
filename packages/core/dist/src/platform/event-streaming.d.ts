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
export declare class EventStreamConsumer {
    private readonly transport;
    constructor(transport: StreamTransport);
    subscribe(topic: string, groupId: string, handler: (msg: unknown) => Promise<void>): Promise<() => void>;
}
export declare class RealtimeAggregator {
    private readonly regs;
    register(name: string, fn: (values: number[]) => number, windowMs: number): void;
    push(name: string, value: number): void;
    getResult(name: string): number | undefined;
    destroy(): void;
}
//# sourceMappingURL=event-streaming.d.ts.map