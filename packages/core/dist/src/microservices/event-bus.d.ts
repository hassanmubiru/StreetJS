export interface EventEnvelope {
    id: string;
    topic: string;
    timestamp: string;
    version: number;
    payload: unknown;
}
export interface EventBusTransport {
    publish(topic: string, envelope: EventEnvelope): Promise<void>;
    subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void;
}
export declare class InProcessTransport implements EventBusTransport {
    private readonly _emitter;
    constructor();
    publish(topic: string, envelope: EventEnvelope): Promise<void>;
    subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void;
}
export declare class EventBus {
    private readonly _transport;
    constructor(transport?: EventBusTransport);
    /**
     * Wrap `payload` in an `EventEnvelope` and publish it to the given topic.
     */
    publish(topic: string, payload: unknown): Promise<void>;
    /**
     * Subscribe to a topic. Returns an unsubscribe function.
     */
    subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): () => void;
}
//# sourceMappingURL=event-bus.d.ts.map